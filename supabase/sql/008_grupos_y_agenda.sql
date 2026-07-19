-- =============================================================
-- Fundación Senderos de Libertad
-- Archivo 008_grupos_y_agenda.sql
-- Ejecutar después de 001, 002, 004, 005, 006 y 007.
--
-- Contenido:
--   1. FIX: disponibilidad demo (sin esto, agendar turnos falla siempre).
--   2. Talleres y terapia grupal: group_sessions + inscripciones con cupo.
--   3. Motor de slots: get_available_slots (agenda con bloqueo real).
--   4. Auto-reserva desde el portal: request_appointment_portal.
--   5. Cola de sincronización con Google Calendar para sesiones grupales.
--   6. Reintento seguro de políticas de Storage (proyectos Supabase nuevos).
-- =============================================================
begin;

-- -----------------------------------------------------------------
-- 1. Talleres y terapia grupal
-- -----------------------------------------------------------------
create table if not exists public.group_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  session_type text not null check(session_type in ('taller','terapia_grupal')),
  title text not null,
  description text,
  program_id uuid references public.programs(id) on delete set null,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  room_id uuid references public.rooms(id) on delete set null,
  capacity integer not null default 12 check(capacity between 1 and 200),
  start_at timestamptz not null,
  end_at timestamptz not null,
  modality text not null default 'presencial' check(modality in ('presencial','online')),
  status text not null default 'programado' check(status in ('programado','realizado','cancelado')),
  open_enrollment boolean not null default true,
  notes text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(end_at > start_at)
);
create index if not exists group_sessions_agenda on public.group_sessions(start_at, professional_id) where status <> 'cancelado';

create table if not exists public.group_session_enrollments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.group_sessions(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  status text not null default 'inscripto' check(status in ('inscripto','asistio','ausente','cancelado')),
  enrolled_via text not null default 'sistema' check(enrolled_via in ('sistema','portal')),
  enrolled_by uuid references auth.users(id) on delete set null default auth.uid(),
  notes text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id, patient_id)
);
create index if not exists group_enrollments_patient on public.group_session_enrollments(patient_id, created_at desc);

drop trigger if exists trg_group_sessions_updated_at on public.group_sessions;
create trigger trg_group_sessions_updated_at before update on public.group_sessions
for each row execute function public.set_updated_at();
drop trigger if exists trg_group_session_enrollments_updated_at on public.group_session_enrollments;
create trigger trg_group_session_enrollments_updated_at before update on public.group_session_enrollments
for each row execute function public.set_updated_at();

alter table public.group_sessions enable row level security;
alter table public.group_session_enrollments enable row level security;

-- Lectura interna completa; portal ve lo publicado o aquello donde participa.
drop policy if exists "group sessions internal read" on public.group_sessions;
create policy "group sessions internal read" on public.group_sessions for select to authenticated
using(public.is_internal_user());
drop policy if exists "group sessions portal read" on public.group_sessions;
create policy "group sessions portal read" on public.group_sessions for select to authenticated
using(
  (status = 'programado' and open_enrollment = true)
  or exists(
    select 1 from public.group_session_enrollments e
    where e.session_id = group_sessions.id
      and public.can_access_patient_portal(e.patient_id, 'appointments')
  )
);
drop policy if exists "group sessions manage" on public.group_sessions;
create policy "group sessions manage" on public.group_sessions for all to authenticated
using(public.can_manage_appointments() and public.can_manage_professional_schedule(professional_id))
with check(public.can_manage_appointments() and public.can_manage_professional_schedule(professional_id));

drop policy if exists "group enrollments internal manage" on public.group_session_enrollments;
create policy "group enrollments internal manage" on public.group_session_enrollments for all to authenticated
using(public.can_manage_appointments() and public.can_access_patient_operational(patient_id))
with check(public.can_manage_appointments() and public.can_access_patient_operational(patient_id));
drop policy if exists "group enrollments internal read" on public.group_session_enrollments;
create policy "group enrollments internal read" on public.group_session_enrollments for select to authenticated
using(public.is_internal_user());
drop policy if exists "group enrollments portal read" on public.group_session_enrollments;
create policy "group enrollments portal read" on public.group_session_enrollments for select to authenticated
using(public.can_access_patient_portal(patient_id, 'appointments'));
-- La inscripción/baja desde el portal se hace solo por RPC (control de cupo con lock).

-- -----------------------------------------------------------------
-- Conflictos: una sesión grupal no puede pisar turnos, bloqueos
-- ni otras sesiones del mismo profesional o sala.
-- -----------------------------------------------------------------
create or replace function public.check_group_session_conflicts()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status = 'cancelado' then return new; end if;
  if new.end_at <= new.start_at then raise exception 'La hora de fin debe ser posterior a la de inicio'; end if;
  perform pg_advisory_xact_lock(hashtext('professional:'||new.professional_id::text));
  if new.room_id is not null then perform pg_advisory_xact_lock(hashtext('room:'||new.room_id::text)); end if;
  if exists(
    select 1 from public.appointments a
    where a.status not in ('cancelado','reprogramado')
      and tstzrange(a.start_at,a.end_at,'[)') && tstzrange(new.start_at,new.end_at,'[)')
      and (a.professional_id = new.professional_id or (new.room_id is not null and a.room_id = new.room_id))
  ) then raise exception 'La sesión se superpone con un turno individual vigente'; end if;
  if exists(
    select 1 from public.calendar_blocks b
    where b.active
      and tstzrange(b.start_at,b.end_at,'[)') && tstzrange(new.start_at,new.end_at,'[)')
      and ((b.professional_id is not null and b.professional_id = new.professional_id)
        or (new.room_id is not null and b.room_id = new.room_id))
  ) then raise exception 'El horario elegido está bloqueado'; end if;
  if exists(
    select 1 from public.group_sessions g
    where g.id <> coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid)
      and g.status = 'programado'
      and tstzrange(g.start_at,g.end_at,'[)') && tstzrange(new.start_at,new.end_at,'[)')
      and (g.professional_id = new.professional_id or (new.room_id is not null and g.room_id = new.room_id))
  ) then raise exception 'Se superpone con otro taller o grupo ya programado'; end if;
  return new;
end;
$$;
drop trigger if exists trg_check_group_session_conflicts on public.group_sessions;
create trigger trg_check_group_session_conflicts
before insert or update of start_at,end_at,professional_id,room_id,status on public.group_sessions
for each row execute function public.check_group_session_conflicts();

-- Los turnos individuales tampoco pueden pisar una sesión grupal.
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
  if exists(
    select 1 from public.group_sessions g
    where g.status='programado'
      and tstzrange(g.start_at,g.end_at,'[)') && tstzrange(p_start_at,p_end_at,'[)')
      and (g.professional_id=p_professional_id or (p_room_id is not null and g.room_id=p_room_id))
  ) then raise exception 'El profesional o la sala están ocupados por un taller o grupo en ese horario'; end if;
  insert into public.appointments(patient_id,professional_id,appointment_type_id,program_id,room_id,location_id,start_at,end_at,status,modality,reason,created_by)
  values(p_patient_id,p_professional_id,p_appointment_type_id,p_program_id,p_room_id,p_location_id,p_start_at,p_end_at,'confirmado',coalesce(p_modality,'presencial'),p_reason,auth.uid())
  returning id into v_id;
  perform public.add_audit_log('APPOINTMENT_CREATED','appointments',v_id,p_patient_id,jsonb_build_object('professional_id',p_professional_id,'start_at',p_start_at),'normal');
  return v_id;
end;
$$;

-- -----------------------------------------------------------------
-- 2. Motor de slots: disponibilidad − turnos − bloqueos − grupos.
-- -----------------------------------------------------------------
create or replace function public.get_available_slots(
  p_professional_id uuid, p_date date, p_duration_minutes integer default 50
)
returns table(slot_start timestamptz, slot_end timestamptz)
language plpgsql stable security definer set search_path=public as $$
declare v_tz text; v_dur interval; v_min integer;
begin
  if auth.uid() is null then raise exception 'No autorizado'; end if;
  v_min := coalesce(p_duration_minutes, 50);
  if v_min < 15 then v_min := 15; end if;
  if v_min > 480 then v_min := 480; end if;
  v_dur := make_interval(mins => v_min);
  select coalesce(timezone,'America/Argentina/Mendoza') into v_tz from public.organizations order by created_at limit 1;
  v_tz := coalesce(v_tz,'America/Argentina/Mendoza');
  return query
  with rules as (
    select r.start_time, r.end_time
    from public.professional_availability_rules r
    where r.professional_id = p_professional_id and r.active
      and r.weekday = extract(dow from p_date)::smallint
      and p_date >= r.effective_from
      and (r.effective_until is null or p_date <= r.effective_until)
  ),
  grid as (
    select gs as local_start
    from rules r,
    lateral generate_series((p_date + r.start_time)::timestamp, (p_date + r.end_time)::timestamp - v_dur, interval '30 minutes') gs
  ),
  slots as (
    select distinct (g.local_start at time zone v_tz) as s_start,
           (g.local_start at time zone v_tz) + v_dur as s_end
    from grid g
  )
  select s.s_start, s.s_end
  from slots s
  where s.s_start > now()
    and not exists(
      select 1 from public.appointments a
      where a.professional_id = p_professional_id
        and a.status not in ('cancelado','reprogramado')
        and tstzrange(a.start_at,a.end_at,'[)') && tstzrange(s.s_start,s.s_end,'[)'))
    and not exists(
      select 1 from public.calendar_blocks b
      where b.active and b.professional_id = p_professional_id
        and tstzrange(b.start_at,b.end_at,'[)') && tstzrange(s.s_start,s.s_end,'[)'))
    and not exists(
      select 1 from public.group_sessions g
      where g.professional_id = p_professional_id and g.status = 'programado'
        and tstzrange(g.start_at,g.end_at,'[)') && tstzrange(s.s_start,s.s_end,'[)'))
  order by s.s_start;
end;
$$;

-- -----------------------------------------------------------------
-- 3. Auto-reserva desde el portal (queda en estado "solicitado").
-- -----------------------------------------------------------------
create or replace function public.request_appointment_portal(
  p_professional_id uuid, p_appointment_type_id uuid, p_start_at timestamptz,
  p_modality text default 'presencial', p_reason text default null
)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_patient uuid; v_minutes integer; v_end timestamptz; v_id uuid; v_tz text; v_modality text;
begin
  select u.patient_id into v_patient from public.user_profiles u
  where u.id = auth.uid() and u.active and u.account_kind = 'patient';
  if v_patient is null then raise exception 'Solo las cuentas de paciente pueden solicitar turnos desde el portal'; end if;
  select at.default_minutes into v_minutes from public.appointment_types at where at.id = p_appointment_type_id and at.active;
  if v_minutes is null then raise exception 'Tipo de turno inválido'; end if;
  if p_start_at <= now() then raise exception 'Ese horario ya pasó. Elegí otro.'; end if;
  select coalesce(timezone,'America/Argentina/Mendoza') into v_tz from public.organizations order by created_at limit 1;
  v_tz := coalesce(v_tz,'America/Argentina/Mendoza');
  if not exists(
    select 1 from public.get_available_slots(p_professional_id, (p_start_at at time zone v_tz)::date, v_minutes) s
    where s.slot_start = p_start_at
  ) then raise exception 'Ese horario ya no está disponible. Elegí otro.'; end if;
  v_end := p_start_at + make_interval(mins => v_minutes);
  v_modality := case when p_modality in ('presencial','online') then p_modality else 'presencial' end;
  insert into public.appointments(patient_id,professional_id,appointment_type_id,start_at,end_at,status,modality,reason,created_by)
  values (v_patient,p_professional_id,p_appointment_type_id,p_start_at,v_end,'solicitado',v_modality,left(coalesce(p_reason,''),500),auth.uid())
  returning id into v_id;
  perform public.add_audit_log('APPOINTMENT_REQUESTED_PORTAL','appointments',v_id,v_patient,
    jsonb_build_object('professional_id',p_professional_id,'start_at',p_start_at),'normal');
  return v_id;
end;
$$;

-- -----------------------------------------------------------------
-- 4. Inscripciones a talleres y grupos (cupo protegido con lock).
-- -----------------------------------------------------------------
create or replace function public.enroll_group_session(p_session_id uuid, p_patient_id uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_session public.group_sessions%rowtype; v_patient uuid; v_via text; v_count integer; v_id uuid; v_status text;
begin
  select * into v_session from public.group_sessions where id = p_session_id;
  if v_session.id is null then raise exception 'La sesión no existe'; end if;
  if v_session.status <> 'programado' then raise exception 'Este espacio no admite inscripciones'; end if;
  if v_session.start_at <= now() then raise exception 'La sesión ya comenzó'; end if;

  if exists(select 1 from public.user_profiles u where u.id = auth.uid() and u.active and u.account_kind = 'patient') then
    select u.patient_id into v_patient from public.user_profiles u where u.id = auth.uid();
    if p_patient_id is not null and p_patient_id <> v_patient then raise exception 'No autorizado'; end if;
    if not v_session.open_enrollment then raise exception 'La inscripción a este espacio se coordina con el equipo'; end if;
    v_via := 'portal';
  elsif public.can_manage_appointments() then
    v_patient := p_patient_id;
    if v_patient is null then raise exception 'Seleccione el paciente a inscribir'; end if;
    if not public.can_access_patient_operational(v_patient) then raise exception 'No autorizado para ese paciente'; end if;
    v_via := 'sistema';
  else
    raise exception 'No autorizado';
  end if;

  perform pg_advisory_xact_lock(hashtext('gsession:'||p_session_id::text));
  select e.id, e.status into v_id, v_status
  from public.group_session_enrollments e
  where e.session_id = p_session_id and e.patient_id = v_patient;
  if v_id is not null and v_status <> 'cancelado' then raise exception 'Ya está inscripto en este espacio'; end if;

  select count(*) into v_count from public.group_session_enrollments e
  where e.session_id = p_session_id and e.status in ('inscripto','asistio');
  if v_count >= v_session.capacity then raise exception 'No quedan cupos disponibles'; end if;

  if v_id is not null then
    update public.group_session_enrollments
    set status = 'inscripto', enrolled_via = v_via, enrolled_by = auth.uid(), updated_at = now()
    where id = v_id;
  else
    insert into public.group_session_enrollments(session_id, patient_id, status, enrolled_via, enrolled_by)
    values (p_session_id, v_patient, 'inscripto', v_via, auth.uid())
    returning id into v_id;
  end if;
  perform public.add_audit_log('GROUP_ENROLLMENT','group_session_enrollments',v_id,v_patient,
    jsonb_build_object('session_id',p_session_id,'via',v_via),'normal');
  return v_id;
end;
$$;

create or replace function public.cancel_group_enrollment(p_enrollment_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_row record;
begin
  select e.id, e.patient_id, e.session_id, g.start_at into v_row
  from public.group_session_enrollments e join public.group_sessions g on g.id = e.session_id
  where e.id = p_enrollment_id;
  if v_row.id is null then raise exception 'Inscripción inexistente'; end if;
  if exists(select 1 from public.user_profiles u where u.id = auth.uid() and u.active and u.account_kind = 'patient' and u.patient_id = v_row.patient_id) then
    if v_row.start_at <= now() then raise exception 'La sesión ya comenzó; comunicate con el equipo'; end if;
  elsif not (public.can_manage_appointments() and public.can_access_patient_operational(v_row.patient_id)) then
    raise exception 'No autorizado';
  end if;
  update public.group_session_enrollments set status = 'cancelado', updated_at = now() where id = p_enrollment_id;
  perform public.add_audit_log('GROUP_ENROLLMENT_CANCELLED','group_session_enrollments',p_enrollment_id,v_row.patient_id,'{}'::jsonb,'normal');
end;
$$;

create or replace function public.set_group_attendance(p_enrollment_id uuid, p_status text)
returns void language plpgsql security definer set search_path=public as $$
declare v_patient uuid;
begin
  if p_status not in ('inscripto','asistio','ausente') then raise exception 'Estado inválido'; end if;
  select patient_id into v_patient from public.group_session_enrollments where id = p_enrollment_id;
  if v_patient is null then raise exception 'Inscripción inexistente'; end if;
  if not (public.can_manage_appointments() and public.can_access_patient_operational(v_patient)) then raise exception 'No autorizado'; end if;
  update public.group_session_enrollments set status = p_status, updated_at = now() where id = p_enrollment_id;
end;
$$;

create or replace function public.update_group_session_status(p_session_id uuid, p_status text)
returns void language plpgsql security definer set search_path=public as $$
declare v_prof uuid;
begin
  if p_status not in ('programado','realizado','cancelado') then raise exception 'Estado inválido'; end if;
  select professional_id into v_prof from public.group_sessions where id = p_session_id;
  if v_prof is null then raise exception 'Sesión inexistente'; end if;
  if not (public.can_manage_appointments() and public.can_manage_professional_schedule(v_prof)) then raise exception 'No autorizado'; end if;
  update public.group_sessions set status = p_status, updated_at = now() where id = p_session_id;
  perform public.add_audit_log('GROUP_SESSION_STATUS','group_sessions',p_session_id,null,jsonb_build_object('status',p_status),'normal');
end;
$$;

-- Vista segura para el portal: sesiones abiertas con cupo y mi estado.
create or replace function public.get_open_group_sessions(p_patient_id uuid)
returns table(
  id uuid, session_type text, title text, description text, professional_name text,
  room_name text, start_at timestamptz, end_at timestamptz, modality text,
  capacity integer, enrolled_count bigint, my_enrollment_id uuid, my_status text
)
language plpgsql stable security definer set search_path=public as $$
begin
  if not (public.is_internal_user() or public.can_access_patient_portal(p_patient_id,'appointments')) then
    raise exception 'No autorizado';
  end if;
  return query
  select g.id, g.session_type, g.title, g.description, p.full_name, r.name,
         g.start_at, g.end_at, g.modality, g.capacity,
         (select count(*) from public.group_session_enrollments e where e.session_id = g.id and e.status in ('inscripto','asistio')),
         me.id, me.status
  from public.group_sessions g
  join public.professionals p on p.id = g.professional_id
  left join public.rooms r on r.id = g.room_id
  left join public.group_session_enrollments me on me.session_id = g.id and me.patient_id = p_patient_id
  where g.status = 'programado' and g.start_at > now()
    and (g.open_enrollment = true or me.id is not null)
  order by g.start_at;
end;
$$;

-- -----------------------------------------------------------------
-- 5. Google Calendar: cola también para sesiones grupales.
-- -----------------------------------------------------------------
alter table public.calendar_sync_outbox
  add column if not exists group_session_id uuid references public.group_sessions(id) on delete cascade;

create or replace function public.queue_group_session_sync()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.calendar_sync_outbox(group_session_id, operation, payload)
  values (new.id,
    case when new.status = 'cancelado' then 'cancel' else 'upsert' end,
    jsonb_build_object('professional_id', new.professional_id, 'title', 'Espacio grupal — Senderos',
      'start_at', new.start_at, 'end_at', new.end_at, 'kind', new.session_type));
  return new;
end;
$$;
drop trigger if exists trg_queue_group_session_sync on public.group_sessions;
create trigger trg_queue_group_session_sync
after insert or update of start_at,end_at,status,room_id on public.group_sessions
for each row execute function public.queue_group_session_sync();

drop policy if exists "calendar outbox admin read" on public.calendar_sync_outbox;
create policy "calendar outbox admin read" on public.calendar_sync_outbox for select to authenticated using (public.is_admin_user());

-- -----------------------------------------------------------------
-- 6. Demo: disponibilidad, talleres y grupos de ejemplo.
--    (Este era el bug que impedía agendar turnos en la demo.)
-- -----------------------------------------------------------------
create or replace function public.seed_demo_agenda()
returns void language plpgsql security definer set search_path=public as $agenda$
declare v_org uuid; v_room_grupos uuid; v_room_psico uuid;
begin
  set local session_replication_role = 'replica';
  select id into v_org from public.organizations where cuit='30-71928002-8';
  select id into v_room_grupos from public.rooms where name='Sala de grupos' limit 1;
  select id into v_room_psico from public.rooms where name='Consultorio psicológico' limit 1;

  -- Disponibilidad: lunes a viernes, mañana y tarde, para todo el equipo demo.
  insert into public.professional_availability_rules(professional_id, weekday, start_time, end_time, effective_from, active)
  select p.id, d.weekday, t.start_time, t.end_time, (current_date - 90), true
  from public.professionals p
  cross join (values (1),(2),(3),(4),(5)) d(weekday)
  cross join (values ('09:00'::time,'13:00'::time),('14:00'::time,'19:00'::time)) t(start_time,end_time)
  where p.is_demo = true
    and not exists(
      select 1 from public.professional_availability_rules r
      where r.professional_id = p.id and r.weekday = d.weekday and r.start_time = t.start_time);

  -- Un bloqueo de ejemplo para mostrar la agenda con horarios no disponibles.
  insert into public.calendar_blocks(professional_id, title, block_type, start_at, end_at, active)
  select p.id, 'Capacitación externa', 'meeting',
    (date_trunc('day', now()) + interval '4 days 9 hours'),
    (date_trunc('day', now()) + interval '4 days 13 hours'), true
  from public.professionals p
  where p.email = 'valeria.moreno@senderos.demo'
    and not exists(select 1 from public.calendar_blocks b where b.professional_id = p.id and b.title = 'Capacitación externa');

  -- Talleres y terapia grupal de ejemplo, abiertos al portal.
  insert into public.group_sessions(org_id, session_type, title, description, program_id, professional_id, room_id, capacity, start_at, end_at, modality, status, open_enrollment, is_demo)
  select v_org, v.session_type, v.title, v.description, pr.id, p.id,
    case when v.session_type = 'terapia_grupal' then v_room_grupos else coalesce(v_room_grupos, v_room_psico) end,
    v.capacity,
    (date_trunc('day', now()) + v.start_offset),
    (date_trunc('day', now()) + v.end_offset),
    'presencial', 'programado', true, true
  from (values
    ('terapia_grupal','Terapia grupal semanal','Espacio terapéutico grupal para personas en tratamiento. Coordinado por el equipo de psicología.','orientacion-tratamiento','martin.quiroga@senderos.demo',12, interval '2 days 18 hours', interval '2 days 19 hours 30 minutes'),
    ('taller','Taller de prevención de recaídas','Herramientas prácticas para identificar señales de alerta y sostener el proceso.','orientacion-tratamiento','carlos.medina@senderos.demo',16, interval '5 days 10 hours', interval '5 days 11 hours 30 minutes'),
    ('taller','Taller de musicoterapia','Espacio expresivo grupal abierto a personas en tratamiento y seguimiento.','acompanamiento-familiar','paula.torres@senderos.demo',14, interval '6 days 15 hours', interval '6 days 16 hours 30 minutes')
  ) v(session_type,title,description,program_slug,prof_email,capacity,start_offset,end_offset)
  join public.professionals p on p.email = v.prof_email
  left join public.programs pr on pr.slug = v.program_slug
  where not exists(select 1 from public.group_sessions g where g.title = v.title and g.is_demo = true);

  -- Inscripciones de ejemplo.
  insert into public.group_session_enrollments(session_id, patient_id, status, enrolled_via, is_demo)
  select g.id, p.id, 'inscripto', v.via, true
  from (values
    ('Terapia grupal semanal','99000101','sistema'),
    ('Terapia grupal semanal','99000103','sistema'),
    ('Taller de musicoterapia','99000102','portal')
  ) v(title, doc, via)
  join public.group_sessions g on g.title = v.title and g.is_demo = true
  join public.patients p on p.document_number = v.doc
  where not exists(select 1 from public.group_session_enrollments e where e.session_id = g.id and e.patient_id = p.id);
end;
$agenda$;

create or replace function public.cleanup_demo_agenda()
returns void language plpgsql security definer set search_path=public as $$
begin
  set local session_replication_role = 'replica';
  delete from public.calendar_sync_outbox where group_session_id in (select id from public.group_sessions where is_demo=true);
  delete from public.group_session_enrollments where is_demo=true
    or session_id in (select id from public.group_sessions where is_demo=true)
    or patient_id in (select id from public.patients where is_demo=true);
  delete from public.group_sessions where is_demo=true
    or professional_id in (select id from public.professionals where is_demo=true);
end;
$$;

create or replace function public.reset_demo_data()
returns void language plpgsql security definer set search_path=public as $reset$
begin
  perform public.cleanup_demo_agenda();
  perform public.cleanup_demo_data();
  perform public.seed_demo_data();
  perform public.seed_demo_agenda();
end;
$reset$;

-- -----------------------------------------------------------------
-- 7. Storage: reintento seguro de políticas.
--    En proyectos Supabase creados desde 2025, "create policy" sobre
--    storage.objects puede fallar desde el SQL editor por permisos.
--    Este bloque lo intenta y, si no puede, avisa sin romper la
--    migración: crearlas desde Dashboard → Storage → Policies con
--    las mismas expresiones.
-- -----------------------------------------------------------------
do $storage$
begin
  begin
    drop policy if exists "internal clinical documents storage" on storage.objects;
    create policy "internal clinical documents storage"
    on storage.objects for all to authenticated
    using (bucket_id = 'clinical-documents' and public.can_manage_documents())
    with check (bucket_id = 'clinical-documents' and public.can_manage_documents());

    drop policy if exists "portal released clinical documents storage" on storage.objects;
    create policy "portal released clinical documents storage"
    on storage.objects for select to authenticated
    using (
      bucket_id = 'clinical-documents'
      and exists(
        select 1 from public.patient_documents d
        join public.portal_document_releases r on r.document_id = d.id
        join public.user_profiles up on up.id = auth.uid()
        where d.file_path = storage.objects.name
          and r.patient_id = up.patient_id and r.active = true
          and (r.expires_at is null or r.expires_at > now())
      )
    );

    drop policy if exists "portal submissions uploader select" on storage.objects;
    create policy "portal submissions uploader select" on storage.objects for select to authenticated
    using (bucket_id='portal-submissions' and name like auth.uid()::text || '/%');

    drop policy if exists "portal submissions uploader insert" on storage.objects;
    create policy "portal submissions uploader insert" on storage.objects for insert to authenticated
    with check (bucket_id='portal-submissions' and name like auth.uid()::text || '/%');

    drop policy if exists "portal submissions internal manage" on storage.objects;
    create policy "portal submissions internal manage" on storage.objects for all to authenticated
    using (bucket_id='portal-submissions' and public.can_manage_documents())
    with check (bucket_id='portal-submissions' and public.can_manage_documents());

    raise notice 'Políticas de Storage aplicadas correctamente.';
  exception when others then
    raise notice 'ATENCIÓN: no se pudieron crear las políticas de Storage por SQL (%). Crearlas desde Dashboard > Storage > Policies; sin ellas, la subida de archivos falla para todos los roles.', sqlerrm;
  end;
end;
$storage$;

-- -----------------------------------------------------------------
-- Permisos
-- -----------------------------------------------------------------
grant execute on function public.get_available_slots(uuid,date,integer) to authenticated;
grant execute on function public.request_appointment_portal(uuid,uuid,timestamptz,text,text) to authenticated;
grant execute on function public.enroll_group_session(uuid,uuid) to authenticated;
grant execute on function public.cancel_group_enrollment(uuid) to authenticated;
grant execute on function public.set_group_attendance(uuid,text) to authenticated;
grant execute on function public.update_group_session_status(uuid,text) to authenticated;
grant execute on function public.get_open_group_sessions(uuid) to authenticated;
revoke execute on function public.seed_demo_agenda() from public, anon, authenticated;
revoke execute on function public.cleanup_demo_agenda() from public, anon, authenticated;
revoke execute on function public.reset_demo_data() from public, anon, authenticated;
grant execute on function public.reset_demo_data() to service_role;

-- Carga inmediata (idempotente): destraba la agenda de la demo ya instalada.
select public.seed_demo_agenda();

commit;
