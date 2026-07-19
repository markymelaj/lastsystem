-- =============================================================
-- Senderos de Libertad - puesta a punto operativa y de seguridad
-- Ejecutar después de 001_schema.sql y, si corresponde, 002_seed_demo.sql.
-- =============================================================
begin;

create extension if not exists btree_gist;

-- Identidad, zona horaria y autorizaciones familiares.
alter table public.organizations add column if not exists timezone text not null default 'America/Argentina/Mendoza';
update public.organizations set timezone=coalesce(nullif(timezone,''),'America/Argentina/Mendoza');

insert into public.roles(code,name,description,is_internal)
values ('communications','Comunicaciones','Emite comunicados institucionales sin acceso clínico',true)
on conflict(code) do update set name=excluded.name,description=excluded.description,is_internal=excluded.is_internal;

insert into public.permissions(code,name,description)
values ('communications.manage','Gestionar comunicados','Crear y enviar comunicados institucionales')
on conflict(code) do update set name=excluded.name,description=excluded.description;

insert into public.role_permissions(role_code,permission_code)
values ('communications','communications.manage'),('direction','communications.manage'),
       ('clinical_coordination','communications.manage'),('admission','communications.manage')
on conflict do nothing;

alter table public.user_profiles
  add column if not exists account_kind text,
  add column if not exists family_contact_id uuid references public.patient_contacts(id) on delete set null;

update public.user_profiles
set account_kind=case when role_code='patient' then 'patient' when role_code='family' then 'family' else 'internal' end
where account_kind is null;

alter table public.user_profiles alter column account_kind set default 'internal';

create table if not exists public.family_authorizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  patient_contact_id uuid not null references public.patient_contacts(id) on delete restrict,
  relationship text,
  can_view_profile boolean not null default false,
  can_view_appointments boolean not null default true,
  can_receive_updates boolean not null default true,
  can_upload_documents boolean not null default false,
  can_view_documents boolean not null default false,
  active boolean not null default true,
  valid_until date,
  authorized_by uuid references auth.users(id) on delete set null default auth.uid(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,patient_id)
);

-- Conserva cualquier acceso familiar ya existente, transformándolo en autorización explícita.
insert into public.patient_contacts(patient_id,full_name,email,is_authorized,can_access_portal,can_receive_updates,notes)
select up.patient_id,up.full_name,up.email,true,true,true,'Contacto creado durante migración de acceso familiar.'
from public.user_profiles up
where up.account_kind='family' and up.patient_id is not null
and not exists (
  select 1 from public.patient_contacts c
  where c.patient_id=up.patient_id and lower(coalesce(c.email,''))=lower(coalesce(up.email,''))
);

insert into public.family_authorizations(
  user_id,patient_id,patient_contact_id,relationship,can_view_appointments,can_receive_updates,active
)
select up.id,up.patient_id,c.id,c.relationship,true,true,true
from public.user_profiles up
join lateral (
  select id,relationship from public.patient_contacts c
  where c.patient_id=up.patient_id and lower(coalesce(c.email,''))=lower(coalesce(up.email,''))
  order by c.created_at desc limit 1
) c on true
where up.account_kind='family' and up.patient_id is not null
on conflict(user_id,patient_id) do nothing;

update public.user_profiles set patient_id=null where account_kind='family' and patient_id is not null;
alter table public.user_profiles alter column account_kind set not null;
alter table public.user_profiles drop constraint if exists user_profiles_account_kind_consistent;
alter table public.user_profiles add constraint user_profiles_account_kind_consistent check (
  (account_kind='patient' and role_code='patient' and patient_id is not null and professional_id is null and family_contact_id is null)
  or (account_kind='family' and role_code='family' and patient_id is null and professional_id is null)
  or (account_kind='internal' and role_code not in ('patient','family') and patient_id is null and family_contact_id is null)
);
create unique index if not exists user_profiles_email_ci_unique on public.user_profiles(lower(email));

create or replace function public.validate_family_authorization()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not exists (
    select 1 from public.user_profiles u
    where u.id=new.user_id and u.account_kind='family' and u.role_code='family' and u.active
  ) then raise exception 'La autorización debe pertenecer a una cuenta familiar activa'; end if;
  if not exists (
    select 1 from public.patient_contacts c
    where c.id=new.patient_contact_id and c.patient_id=new.patient_id
      and c.is_authorized and c.can_access_portal
  ) then raise exception 'El contacto familiar no está autorizado para este paciente'; end if;
  if new.valid_until is not null and new.valid_until<current_date then
    raise exception 'La autorización no puede comenzar vencida';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_validate_family_authorization on public.family_authorizations;
create trigger trg_validate_family_authorization before insert or update on public.family_authorizations
for each row execute function public.validate_family_authorization();

-- Agenda y preparación para Google Calendar.
create table if not exists public.professional_availability_rules (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  room_id uuid references public.rooms(id) on delete set null,
  weekday smallint not null check(weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  effective_from date not null default current_date,
  effective_until date,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(end_time>start_time),
  check(effective_until is null or effective_until>=effective_from)
);
create index if not exists professional_availability_lookup on public.professional_availability_rules(professional_id,weekday,active);

create table if not exists public.calendar_blocks (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid references public.professionals(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  block_type text not null default 'manual' check(block_type in ('manual','leave','holiday','meeting','external_busy','maintenance')),
  title text not null,
  notes text,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(professional_id is not null or room_id is not null),
  check(end_at>start_at)
);
create index if not exists calendar_blocks_range on public.calendar_blocks(start_at,end_at) where active;

create table if not exists public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  provider text not null default 'google' check(provider='google'),
  calendar_id text,
  external_account_email text,
  sync_direction text not null default 'senderos_to_google' check(sync_direction in ('senderos_to_google','busy_from_google','two_way_busy_only')),
  status text not null default 'pending_credentials' check(status in ('pending_credentials','connected','paused','error','revoked')),
  token_ciphertext text,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(professional_id,provider)
);

create table if not exists public.calendar_sync_outbox (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references public.calendar_connections(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete cascade,
  operation text not null check(operation in ('upsert','cancel')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check(status in ('pending','processing','completed','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists calendar_sync_pending on public.calendar_sync_outbox(status,available_at)
where status in ('pending','failed');

alter table public.appointments drop constraint if exists appointments_no_professional_overlap;
alter table public.appointments add constraint appointments_no_professional_overlap
exclude using gist (professional_id with =,tstzrange(start_at,end_at,'[)') with &&)
where (professional_id is not null and status not in ('cancelado','reprogramado'));

alter table public.appointments drop constraint if exists appointments_no_room_overlap;
alter table public.appointments add constraint appointments_no_room_overlap
exclude using gist (room_id with =,tstzrange(start_at,end_at,'[)') with &&)
where (room_id is not null and status not in ('cancelado','reprogramado'));

-- Documentos de portal: se reciben, revisan y recién entonces ingresan al legajo.
alter table public.patient_documents
  add column if not exists storage_bucket text not null default 'clinical-documents',
  add column if not exists source text not null default 'internal' check(source in ('internal','portal_submission')),
  add column if not exists approved_submission_id uuid;
alter table public.portal_document_releases
  add column if not exists recipient_user_id uuid references auth.users(id) on delete cascade;

create table if not exists public.document_requirements (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  document_type_id uuid references public.document_types(id) on delete set null,
  title text not null,
  instructions text,
  due_date date,
  allow_patient boolean not null default true,
  allow_family boolean not null default true,
  status text not null default 'requested' check(status in ('requested','received','approved','rejected','cancelled','expired')),
  requested_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.portal_document_submissions (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.document_requirements(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  submitted_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  file_path text not null,
  original_filename text not null,
  mime_type text,
  size_bytes bigint,
  status text not null default 'submitted' check(status in ('submitted','approved','rejected','withdrawn')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  reviewer_note text,
  approved_document_id uuid references public.patient_documents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists document_requirements_patient_status on public.document_requirements(patient_id,status);
create index if not exists portal_document_submissions_requirement on public.portal_document_submissions(requirement_id,status);

-- Gestión financiera manual: cargos, abonos, estados y conciliación.
create table if not exists public.financial_charges (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients(id) on delete set null,
  category text not null,
  description text not null,
  issued_at date not null default current_date,
  due_date date,
  amount numeric(14,2) not null check(amount>0),
  currency text not null default 'ARS',
  paid_amount numeric(14,2) not null default 0 check(paid_amount>=0),
  status text not null default 'open' check(status in ('draft','open','partial','paid','waived','cancelled','overdue')),
  payer_name text,
  agreement_reference text,
  notes text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(due_date is null or due_date>=issued_at)
);
create table if not exists public.financial_payments (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid references public.financial_charges(id) on delete set null,
  patient_id uuid references public.patients(id) on delete set null,
  amount numeric(14,2) not null check(amount>0),
  currency text not null default 'ARS',
  method text not null check(method in ('cash','bank_transfer','debit_card','credit_card','pos','agreement','scholarship','other')),
  reference text,
  payer_name text,
  paid_at timestamptz not null default now(),
  status text not null default 'confirmed' check(status in ('submitted','confirmed','rejected','reversed')),
  receipt_path text,
  recorded_by uuid references auth.users(id) on delete set null default auth.uid(),
  verified_by uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists financial_charges_patient_status on public.financial_charges(patient_id,status);
create index if not exists financial_payments_charge on public.financial_payments(charge_id,status);

-- Comunicados institucionales con destinatarios y comprobante de lectura.
create table if not exists public.communications (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  audience text not null check(audience in ('professionals','patients','families','patient_network')),
  patient_id uuid references public.patients(id) on delete set null,
  program_id uuid references public.programs(id) on delete set null,
  channel text not null default 'in_app' check(channel in ('in_app','email')),
  status text not null default 'sent' check(status in ('draft','sent','cancelled')),
  contains_clinical_data boolean not null default false check(not contains_clinical_data),
  sent_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.communication_recipients (
  id uuid primary key default gen_random_uuid(),
  communication_id uuid not null references public.communications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  channel text not null default 'in_app' check(channel in ('in_app','email')),
  delivery_status text not null default 'queued' check(delivery_status in ('queued','sent','failed','read')),
  delivered_at timestamptz,
  read_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  unique(communication_id,user_id,channel)
);
create index if not exists communication_recipients_user on public.communication_recipients(user_id,created_at desc);

-- Funciones de alcance: rol interno, paciente propio o autorización familiar vigente.
create or replace function public.is_internal_user()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.user_profiles where id=auth.uid() and active and account_kind='internal');
$$;

create or replace function public.can_access_patient_portal(p_patient_id uuid,p_scope text default null)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.user_profiles u
    where u.id=auth.uid() and u.active and (
      (u.account_kind='patient' and u.patient_id=p_patient_id)
      or (u.account_kind='family' and exists(
        select 1 from public.family_authorizations fa
        where fa.user_id=u.id and fa.patient_id=p_patient_id and fa.active
          and (fa.valid_until is null or fa.valid_until>=current_date)
          and case p_scope
            when 'profile' then fa.can_view_profile
            when 'appointments' then fa.can_view_appointments
            when 'documents' then fa.can_view_documents
            when 'upload_documents' then fa.can_upload_documents
            when 'communications' then fa.can_receive_updates
            when 'requests' then fa.can_receive_updates
            else false
          end
      ))
    )
  );
$$;

create or replace function public.can_access_patient_operational(p_patient_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select case
    when public.current_role_code() in ('super_admin','direction','clinical_coordination','admission','finance','auditor','communications') then true
    when public.current_role_code() in ('professional','medical','psychologist','social_worker','therapeutic_operator') then exists(
      select 1 from public.user_profiles u where u.id=auth.uid() and u.professional_id is not null and (
        exists(select 1 from public.patient_programs pp where pp.patient_id=p_patient_id and pp.responsible_professional_id=u.professional_id and pp.status='activo')
        or exists(select 1 from public.appointments a where a.patient_id=p_patient_id and a.professional_id=u.professional_id and a.status not in ('cancelado','reprogramado'))
      )
    )
    else false
  end;
$$;

create or replace function public.can_access_patient_clinical(p_patient_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select case
    when public.current_role_code() in ('super_admin','direction','clinical_coordination') then true
    when public.current_role_code() in ('professional','medical','psychologist','social_worker','therapeutic_operator') then exists(
      select 1 from public.user_profiles u where u.id=auth.uid() and u.professional_id is not null and (
        exists(select 1 from public.patient_programs pp where pp.patient_id=p_patient_id and pp.responsible_professional_id=u.professional_id and pp.status='activo')
        or exists(select 1 from public.appointments a where a.patient_id=p_patient_id and a.professional_id=u.professional_id and a.status not in ('cancelado','reprogramado'))
      )
    )
    else false
  end;
$$;

create or replace function public.can_manage_professional_schedule(p_professional_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.current_role_code() in ('super_admin','direction','clinical_coordination','admission')
  or exists(select 1 from public.user_profiles where id=auth.uid() and active and professional_id=p_professional_id
            and role_code in ('professional','medical','psychologist','social_worker','therapeutic_operator'));
$$;

create or replace function public.can_send_communications()
returns boolean language sql stable security definer set search_path=public as $$
  select public.current_role_code() in ('super_admin','direction','clinical_coordination','admission','communications');
$$;

create or replace function public.can_manage_finance()
returns boolean language sql stable security definer set search_path=public as $$
  select public.current_role_code() in ('super_admin','direction','finance');
$$;

create or replace function public.can_view_released_document(p_document_id uuid,p_patient_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.portal_document_releases r
    join public.user_profiles u on u.id=auth.uid() and u.active
    where r.document_id=p_document_id and r.patient_id=p_patient_id and r.active
      and (r.expires_at is null or r.expires_at>now())
      and (
        (u.account_kind='patient' and u.patient_id=p_patient_id and r.released_to='patient')
        or (u.account_kind='family' and r.released_to='family'
            and (r.recipient_user_id is null or r.recipient_user_id=auth.uid())
            and public.can_access_patient_portal(p_patient_id,'documents'))
      )
  );
$$;

-- Agenda: bloqueos, disponibilidad y transacciones seguras.
create or replace function public.check_appointment_block_conflicts()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status in ('cancelado','reprogramado') then return new; end if;
  if new.professional_id is not null then perform pg_advisory_xact_lock(hashtext('professional:'||new.professional_id::text)); end if;
  if new.room_id is not null then perform pg_advisory_xact_lock(hashtext('room:'||new.room_id::text)); end if;
  if exists(
    select 1 from public.calendar_blocks b
    where b.active and tstzrange(b.start_at,b.end_at,'[)') && tstzrange(new.start_at,new.end_at,'[)')
      and ((new.professional_id is not null and b.professional_id=new.professional_id)
        or (new.room_id is not null and b.room_id=new.room_id))
  ) then raise exception 'El horario está bloqueado para el profesional o la sala'; end if;
  return new;
end;
$$;
drop trigger if exists trg_check_appointment_block_conflicts on public.appointments;
create trigger trg_check_appointment_block_conflicts
before insert or update of status,professional_id,room_id,start_at,end_at on public.appointments
for each row execute function public.check_appointment_block_conflicts();

create or replace function public.check_calendar_block_conflicts()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not new.active then return new; end if;
  if new.professional_id is not null then perform pg_advisory_xact_lock(hashtext('professional:'||new.professional_id::text)); end if;
  if new.room_id is not null then perform pg_advisory_xact_lock(hashtext('room:'||new.room_id::text)); end if;
  if exists(
    select 1 from public.appointments a
    where a.status not in ('cancelado','reprogramado')
      and tstzrange(a.start_at,a.end_at,'[)') && tstzrange(new.start_at,new.end_at,'[)')
      and ((new.professional_id is not null and a.professional_id=new.professional_id)
        or (new.room_id is not null and a.room_id=new.room_id))
  ) then raise exception 'El bloqueo se superpone con un turno vigente'; end if;
  return new;
end;
$$;
drop trigger if exists trg_check_calendar_block_conflicts on public.calendar_blocks;
create trigger trg_check_calendar_block_conflicts
before insert or update of active,professional_id,room_id,start_at,end_at on public.calendar_blocks
for each row execute function public.check_calendar_block_conflicts();

create or replace function public.create_appointment_secure(
  p_patient_id uuid,p_professional_id uuid,p_appointment_type_id uuid,
  p_start_at timestamptz,p_end_at timestamptz,p_program_id uuid default null,
  p_room_id uuid default null,p_location_id uuid default null,p_modality text default 'presencial',p_reason text default null
)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_tz text; v_start timestamp; v_end timestamp;
begin
  if not public.can_manage_appointments() then raise exception 'No autorizado para agendar turnos'; end if;
  if not public.can_manage_professional_schedule(p_professional_id) then raise exception 'Solo puede agendar turnos propios'; end if;
  if p_end_at<=p_start_at then raise exception 'La hora de fin debe ser posterior a la de inicio'; end if;
  select coalesce(timezone,'America/Argentina/Mendoza') into v_tz from public.organizations order by created_at limit 1;
  v_start:=p_start_at at time zone coalesce(v_tz,'America/Argentina/Mendoza');
  v_end:=p_end_at at time zone coalesce(v_tz,'America/Argentina/Mendoza');
  if v_start::date<>v_end::date then raise exception 'Un turno debe resolverse dentro de una misma jornada'; end if;
  if not exists(
    select 1 from public.professional_availability_rules r
    where r.professional_id=p_professional_id and r.active
      and r.weekday=extract(dow from v_start)::smallint
      and v_start::time>=r.start_time and v_end::time<=r.end_time
      and v_start::date>=r.effective_from and (r.effective_until is null or v_start::date<=r.effective_until)
  ) then raise exception 'El profesional no tiene disponibilidad definida para ese horario'; end if;
  insert into public.appointments(patient_id,professional_id,appointment_type_id,program_id,room_id,location_id,start_at,end_at,status,modality,reason,created_by)
  values(p_patient_id,p_professional_id,p_appointment_type_id,p_program_id,p_room_id,p_location_id,p_start_at,p_end_at,'confirmado',coalesce(p_modality,'presencial'),p_reason,auth.uid())
  returning id into v_id;
  perform public.add_audit_log('APPOINTMENT_CREATED','appointments',v_id,p_patient_id,jsonb_build_object('professional_id',p_professional_id,'start_at',p_start_at),'normal');
  return v_id;
end;
$$;

create or replace function public.update_appointment_status_secure(
  p_appointment_id uuid,p_status text,p_attendance_status text default null,p_reason text default null
)
returns void language plpgsql security definer set search_path=public as $$
declare v_patient uuid;
begin
  select patient_id into v_patient from public.appointments where id=p_appointment_id;
  if v_patient is null then raise exception 'Turno inexistente'; end if;
  if not public.can_manage_appointments() or not public.can_access_patient_operational(v_patient) then raise exception 'No autorizado'; end if;
  if p_status not in ('solicitado','confirmado','asistido','ausente','cancelado','reprogramado') then raise exception 'Estado inválido'; end if;
  update public.appointments set status=p_status,attendance_status=coalesce(p_attendance_status,attendance_status),
    notes=case when coalesce(p_reason,'')='' then notes else concat_ws(E'\\n',notes,p_reason) end
  where id=p_appointment_id;
end;
$$;

create or replace function public.record_appointment_status_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.status is distinct from new.status then
    insert into public.appointment_status_history(appointment_id,previous_status,new_status,changed_by)
    values(new.id,old.status,new.status,auth.uid());
    perform public.add_audit_log('APPOINTMENT_STATUS_CHANGED','appointments',new.id,new.patient_id,jsonb_build_object('status',new.status),'normal');
  end if;
  return new;
end;
$$;
drop trigger if exists trg_appointment_status_history on public.appointments;
create trigger trg_appointment_status_history after update of status on public.appointments
for each row execute function public.record_appointment_status_change();

create or replace function public.queue_calendar_sync_event()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.calendar_sync_outbox(connection_id,appointment_id,operation,payload)
  select c.id,new.id,case when new.status in ('cancelado','reprogramado') then 'cancel' else 'upsert' end,
    jsonb_build_object('appointment_id',new.id,'start_at',new.start_at,'end_at',new.end_at,'status',new.status)
  from public.calendar_connections c
  where c.professional_id=new.professional_id and c.provider='google' and c.status='connected';
  return new;
end;
$$;
drop trigger if exists trg_queue_calendar_sync on public.appointments;
create trigger trg_queue_calendar_sync after insert or update of start_at,end_at,status,room_id on public.appointments
for each row execute function public.queue_calendar_sync_event();

-- Historia clínica: firma inmutable y versionado de borradores.
create or replace function public.protect_clinical_entry()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_professional uuid;
begin
  if tg_op='DELETE' then raise exception 'La historia clínica no se elimina; use una rectificación'; end if;
  if not public.can_access_patient_clinical(new.patient_id) then raise exception 'No autorizado para este paciente'; end if;
  select professional_id into v_professional from public.user_profiles where id=auth.uid();
  if public.current_role_code() in ('professional','medical','psychologist','social_worker','therapeutic_operator') then
    if v_professional is null then raise exception 'El usuario clínico no tiene profesional vinculado'; end if;
    if new.professional_id is null then new.professional_id:=v_professional; end if;
    if new.professional_id<>v_professional then raise exception 'No puede registrar en nombre de otro profesional'; end if;
  end if;
  if tg_op='UPDATE' then
    if old.status='signed' then raise exception 'Un registro firmado no se edita; cree una rectificación'; end if;
    if old.body is distinct from new.body or old.title is distinct from new.title then
      insert into public.clinical_entry_versions(clinical_entry_id,version_number,body,status,created_by)
      values(old.id,coalesce((select max(version_number)+1 from public.clinical_entry_versions where clinical_entry_id=old.id),1),old.body,old.status,auth.uid());
    end if;
  end if;
  if new.status='signed' then new.signed_at:=coalesce(new.signed_at,now()); end if;
  return new;
end;
$$;
drop trigger if exists trg_protect_clinical_entry on public.clinical_entries;
create trigger trg_protect_clinical_entry before insert or update or delete on public.clinical_entries
for each row execute function public.protect_clinical_entry();

create or replace function public.refresh_charge_balance()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_charge uuid; v_paid numeric(14,2); v_total numeric(14,2);
begin
  v_charge:=coalesce(new.charge_id,old.charge_id);
  if v_charge is null then return coalesce(new,old); end if;
  select amount into v_total from public.financial_charges where id=v_charge;
  select coalesce(sum(amount),0) into v_paid from public.financial_payments where charge_id=v_charge and status='confirmed';
  update public.financial_charges set paid_amount=v_paid,
    status=case when status in ('waived','cancelled') then status when v_paid<=0 then 'open' when v_paid<v_total then 'partial' else 'paid' end
  where id=v_charge;
  return coalesce(new,old);
end;
$$;
drop trigger if exists trg_refresh_charge_balance on public.financial_payments;
create trigger trg_refresh_charge_balance after insert or update or delete on public.financial_payments
for each row execute function public.refresh_charge_balance();

create or replace function public.mark_communication_read(p_recipient_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.communication_recipients
  set read_at=coalesce(read_at,now()),delivery_status='read'
  where id=p_recipient_id and user_id=auth.uid();
end;
$$;

-- RLS y políticas restringidas.
alter table public.family_authorizations enable row level security;
alter table public.professional_availability_rules enable row level security;
alter table public.calendar_blocks enable row level security;
alter table public.calendar_connections enable row level security;
alter table public.calendar_sync_outbox enable row level security;
alter table public.document_requirements enable row level security;
alter table public.portal_document_submissions enable row level security;
alter table public.financial_charges enable row level security;
alter table public.financial_payments enable row level security;
alter table public.communications enable row level security;
alter table public.communication_recipients enable row level security;

drop policy if exists "internal patients read" on public.patients;
drop policy if exists "portal own patient read" on public.patients;
create policy "scoped patients read" on public.patients for select to authenticated
using(public.can_access_patient_operational(id) or public.can_access_patient_portal(id,'profile'));

drop policy if exists "internal patient_contacts read" on public.patient_contacts;
drop policy if exists "portal own contacts read" on public.patient_contacts;
create policy "scoped contacts read" on public.patient_contacts for select to authenticated
using(public.can_access_patient_operational(patient_id) or public.can_access_patient_portal(patient_id,'profile'));

drop policy if exists "internal patient_programs read" on public.patient_programs;
drop policy if exists "portal own patient_programs read" on public.patient_programs;
create policy "scoped patient programs read" on public.patient_programs for select to authenticated
using(public.can_access_patient_operational(patient_id) or public.can_access_patient_portal(patient_id,'profile'));

drop policy if exists "internal appointments read" on public.appointments;
drop policy if exists "portal own appointments read" on public.appointments;
drop policy if exists "appointments insert restricted" on public.appointments;
drop policy if exists "appointments update restricted" on public.appointments;
drop policy if exists "appointments delete restricted" on public.appointments;
create policy "scoped appointments read" on public.appointments for select to authenticated
using(public.can_access_patient_operational(patient_id) or public.can_access_patient_portal(patient_id,'appointments'));
create policy "appointments secure insert only" on public.appointments for insert to authenticated with check(false);
create policy "appointments secure update only" on public.appointments for update to authenticated using(false) with check(false);
create policy "appointments delete denied" on public.appointments for delete to authenticated using(false);

drop policy if exists "clinical access restricted" on public.clinical_entries;
create policy "clinical scoped read" on public.clinical_entries for select to authenticated using(public.can_access_patient_clinical(patient_id));
create policy "clinical scoped insert" on public.clinical_entries for insert to authenticated
with check(created_by=auth.uid() and public.can_access_patient_clinical(patient_id));
create policy "clinical own drafts update" on public.clinical_entries for update to authenticated
using(created_by=auth.uid() and status='draft' and public.can_access_patient_clinical(patient_id))
with check(created_by=auth.uid() and public.can_access_patient_clinical(patient_id));
create policy "clinical delete denied" on public.clinical_entries for delete to authenticated using(false);

drop policy if exists "clinical versions restricted" on public.clinical_entry_versions;
create policy "clinical versions scoped read" on public.clinical_entry_versions for select to authenticated
using(exists(select 1 from public.clinical_entries ce where ce.id=clinical_entry_id and public.can_access_patient_clinical(ce.patient_id)));
create policy "clinical versions no direct write" on public.clinical_entry_versions for all to authenticated using(false) with check(false);

drop policy if exists "documents managed users" on public.patient_documents;
drop policy if exists "portal released documents read" on public.patient_documents;
create policy "documents scoped internal manage" on public.patient_documents for all to authenticated
using(public.can_manage_documents() and (public.current_role_code() in ('super_admin','direction','clinical_coordination','admission') or public.can_access_patient_clinical(patient_id)))
with check(public.can_manage_documents() and (public.current_role_code() in ('super_admin','direction','clinical_coordination','admission') or public.can_access_patient_clinical(patient_id)));
create policy "portal scoped released documents read" on public.patient_documents for select to authenticated
using(public.can_view_released_document(id,patient_id));

drop policy if exists "portal own releases read" on public.portal_document_releases;
create policy "portal scoped releases read" on public.portal_document_releases for select to authenticated
using(public.can_view_released_document(document_id,patient_id));

drop policy if exists "internal portal_requests read" on public.portal_requests;
drop policy if exists "portal own requests read" on public.portal_requests;
drop policy if exists "portal own requests insert" on public.portal_requests;
create policy "scoped portal requests read" on public.portal_requests for select to authenticated
using(public.is_internal_user() or requester_user_id=auth.uid() or public.can_access_patient_portal(patient_id,'requests'));
create policy "scoped portal requests insert" on public.portal_requests for insert to authenticated
with check(requester_user_id=auth.uid() and public.can_access_patient_portal(patient_id,'requests'));

create policy "family authorizations own read" on public.family_authorizations for select to authenticated
using(user_id=auth.uid() or public.is_admin_user());
create policy "family authorizations admin manage" on public.family_authorizations for all to authenticated
using(public.is_admin_user()) with check(public.is_admin_user());

create policy "availability internal read" on public.professional_availability_rules for select to authenticated using(public.is_internal_user());
create policy "availability owner manage" on public.professional_availability_rules for all to authenticated
using(public.can_manage_professional_schedule(professional_id)) with check(public.can_manage_professional_schedule(professional_id));

create policy "calendar blocks internal read" on public.calendar_blocks for select to authenticated using(public.is_internal_user());
create policy "calendar blocks schedule manage" on public.calendar_blocks for all to authenticated
using((professional_id is null or public.can_manage_professional_schedule(professional_id)) and public.can_manage_appointments())
with check((professional_id is null or public.can_manage_professional_schedule(professional_id)) and public.can_manage_appointments());

create policy "calendar connections own read" on public.calendar_connections for select to authenticated
using(public.is_admin_user() or exists(select 1 from public.user_profiles u where u.id=auth.uid() and u.professional_id=calendar_connections.professional_id));
create policy "calendar connections admin manage" on public.calendar_connections for all to authenticated
using(public.is_admin_user()) with check(public.is_admin_user());
create policy "calendar outbox admin read" on public.calendar_sync_outbox for select to authenticated using(public.is_admin_user());

create policy "document requirements internal manage" on public.document_requirements for all to authenticated
using(public.can_manage_documents()) with check(public.can_manage_documents());
create policy "document requirements portal read" on public.document_requirements for select to authenticated
using(status in ('requested','rejected') and public.can_access_patient_portal(patient_id,'upload_documents'));
create policy "portal submissions internal manage" on public.portal_document_submissions for all to authenticated
using(public.can_manage_documents()) with check(public.can_manage_documents());
create policy "portal submissions own read" on public.portal_document_submissions for select to authenticated using(submitted_by=auth.uid());
create policy "portal submissions scoped insert" on public.portal_document_submissions for insert to authenticated
with check(submitted_by=auth.uid() and public.can_access_patient_portal(patient_id,'upload_documents')
  and file_path like auth.uid()::text || '/%'
  and exists(select 1 from public.document_requirements r where r.id=requirement_id and r.patient_id=patient_id and r.status in ('requested','rejected')));

create policy "financial charges manage" on public.financial_charges for all to authenticated
using(public.can_manage_finance()) with check(public.can_manage_finance());
create policy "financial payments manage" on public.financial_payments for all to authenticated
using(public.can_manage_finance()) with check(public.can_manage_finance());

create policy "communications sender manage" on public.communications for all to authenticated
using(public.can_send_communications()) with check(public.can_send_communications());
create policy "communication recipients own read" on public.communication_recipients for select to authenticated
using(user_id=auth.uid() or public.can_send_communications());
create policy "communication recipients no direct write" on public.communication_recipients for all to authenticated using(false) with check(false);

drop policy if exists "audit insert authenticated" on public.audit_logs;
create policy "audit direct insert denied" on public.audit_logs for insert to authenticated with check(false);

-- Recepción separada y privada para archivos subidos desde el portal.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('portal-submissions','portal-submissions',false,10485760,array['application/pdf','image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=false,file_size_limit=10485760;
drop policy if exists "portal submissions uploader select" on storage.objects;
drop policy if exists "portal submissions uploader insert" on storage.objects;
drop policy if exists "portal submissions internal manage" on storage.objects;
create policy "portal submissions uploader select" on storage.objects for select to authenticated
using(bucket_id='portal-submissions' and name like auth.uid()::text || '/%');
create policy "portal submissions uploader insert" on storage.objects for insert to authenticated
with check(bucket_id='portal-submissions' and name like auth.uid()::text || '/%');
create policy "portal submissions internal manage" on storage.objects for all to authenticated
using(bucket_id='portal-submissions' and public.can_manage_documents())
with check(bucket_id='portal-submissions' and public.can_manage_documents());

-- El primer administrador se provisiona mediante una API protegida por secreto de entorno.
revoke execute on function public.bootstrap_first_admin(text) from public,anon,authenticated;
revoke execute on function public.add_audit_log(text,text,uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.create_appointment_secure(uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,uuid,text,text) to authenticated;
grant execute on function public.update_appointment_status_secure(uuid,text,text,text) to authenticated;
grant execute on function public.mark_communication_read(uuid) to authenticated;

commit;

