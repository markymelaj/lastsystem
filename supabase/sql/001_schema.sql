-- =============================================================
-- Fundación Senderos de Libertad - ERP clínico administrativo
-- Archivo 001_schema.sql
-- Ejecutar completo en Supabase SQL Editor.
-- =============================================================

create extension if not exists pgcrypto;

-- -----------------------------
-- Core organization and security
-- -----------------------------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  cuit text unique,
  activity text,
  address text,
  city text,
  province text,
  country text default 'Argentina',
  contact_email text,
  whatsapp text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roles (
  code text primary key,
  name text not null,
  description text,
  is_internal boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.permissions (
  code text primary key,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role_code text not null references public.roles(code) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key(role_code, permission_code)
);

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  role_code text not null references public.roles(code),
  professional_id uuid,
  patient_id uuid,
  active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------
-- Patients
-- -----------------------------
create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  first_name text not null,
  last_name text not null,
  document_type text default 'DNI',
  document_number text,
  birth_date date,
  gender text,
  email text,
  phone text,
  address text,
  city text,
  province text,
  emergency_contact_name text,
  emergency_contact_phone text,
  admission_status text not null default 'preingreso',
  admission_date date,
  risk_level text not null default 'bajo',
  notes text,
  is_demo boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_patients_document on public.patients(document_number);
create index if not exists idx_patients_status on public.patients(admission_status);

create table if not exists public.patient_contacts (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  full_name text not null,
  relationship text,
  phone text,
  email text,
  is_authorized boolean not null default false,
  can_access_portal boolean not null default false,
  can_receive_updates boolean not null default false,
  notes text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.patient_status_history (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  previous_status text,
  new_status text not null,
  reason text,
  changed_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

-- -----------------------------
-- Professionals and programs
-- -----------------------------
create table if not exists public.professionals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  full_name text not null,
  role_title text not null,
  specialty text,
  license_number text,
  email text,
  phone text,
  bio text,
  active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_profiles_professional_fk') then
    alter table public.user_profiles add constraint user_profiles_professional_fk foreign key (professional_id) references public.professionals(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_profiles_patient_fk') then
    alter table public.user_profiles add constraint user_profiles_patient_fk foreign key (patient_id) references public.patients(id) on delete set null;
  end if;
end $$;

create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  name text not null,
  slug text unique,
  description text,
  duration_weeks integer,
  active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.program_stages (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  name text not null,
  stage_order integer not null default 1,
  description text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.patient_programs (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete restrict,
  responsible_professional_id uuid references public.professionals(id) on delete set null,
  current_stage text,
  start_date date not null default current_date,
  end_date date,
  status text not null default 'activo',
  goals text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(patient_id, program_id, start_date)
);

-- -----------------------------
-- Appointments
-- -----------------------------
create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  name text not null,
  address text,
  city text,
  active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  name text not null,
  room_type text,
  capacity integer default 1,
  active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.appointment_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  default_minutes integer not null default 50,
  requires_clinical_entry boolean not null default true,
  active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  patient_id uuid references public.patients(id) on delete set null,
  professional_id uuid references public.professionals(id) on delete set null,
  program_id uuid references public.programs(id) on delete set null,
  appointment_type_id uuid references public.appointment_types(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  room_id uuid references public.rooms(id) on delete set null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'solicitado',
  modality text not null default 'presencial',
  reason text,
  attendance_status text,
  notes text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_valid_range check (end_at > start_at)
);

create index if not exists idx_appointments_start on public.appointments(start_at);
create index if not exists idx_appointments_patient on public.appointments(patient_id);
create index if not exists idx_appointments_professional on public.appointments(professional_id);

create table if not exists public.appointment_status_history (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  previous_status text,
  new_status text not null,
  reason text,
  changed_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.waiting_list (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  appointment_type_id uuid references public.appointment_types(id) on delete set null,
  preferred_professional_id uuid references public.professionals(id) on delete set null,
  priority text not null default 'normal',
  requested_at timestamptz not null default now(),
  notes text,
  status text not null default 'pendiente',
  is_demo boolean not null default false
);

-- -----------------------------
-- Clinical record
-- -----------------------------
create table if not exists public.clinical_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  entry_type text not null,
  body_template text not null,
  active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.clinical_entries (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  professional_id uuid references public.professionals(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  program_id uuid references public.programs(id) on delete set null,
  entry_type text not null,
  title text not null,
  body text not null,
  status text not null default 'draft',
  visibility text not null default 'internal_clinical',
  signed_at timestamptz,
  rectifies_entry_id uuid references public.clinical_entries(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_clinical_entries_patient on public.clinical_entries(patient_id);

create table if not exists public.clinical_entry_versions (
  id uuid primary key default gen_random_uuid(),
  clinical_entry_id uuid not null references public.clinical_entries(id) on delete cascade,
  version_number integer not null,
  body text not null,
  status text not null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique(clinical_entry_id, version_number)
);

create table if not exists public.clinical_alerts (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  severity text not null default 'media',
  title text not null,
  description text,
  status text not null default 'activa',
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

-- -----------------------------
-- Documents and portal
-- -----------------------------
create table if not exists public.document_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'administrativo',
  requires_expiration boolean not null default false,
  active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.patient_documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  document_type_id uuid references public.document_types(id) on delete set null,
  title text not null,
  file_path text,
  mime_type text,
  size_bytes bigint,
  visibility text not null default 'private_administrative',
  status text not null default 'cargado',
  expires_at date,
  uploaded_by uuid references auth.users(id) on delete set null default auth.uid(),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.portal_document_releases (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.patient_documents(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  released_to text not null default 'patient',
  active boolean not null default true,
  released_by uuid references auth.users(id) on delete set null default auth.uid(),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.document_access_logs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.patient_documents(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  accessed_by uuid references auth.users(id) on delete set null default auth.uid(),
  action text not null default 'download',
  created_at timestamptz not null default now()
);

create table if not exists public.portal_requests (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients(id) on delete set null,
  requester_user_id uuid references auth.users(id) on delete set null default auth.uid(),
  request_type text not null,
  subject text not null,
  message text not null,
  status text not null default 'pendiente',
  assigned_to uuid references public.professionals(id) on delete set null,
  internal_response text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------
-- Finance
-- -----------------------------
create table if not exists public.financial_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  patient_id uuid references public.patients(id) on delete set null,
  movement_type text not null,
  category text not null,
  description text not null,
  amount numeric(14,2) not null,
  currency text not null default 'ARS',
  method text,
  status text not null default 'registrado',
  movement_date date not null default current_date,
  receipt_url text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------
-- Audit
-- -----------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_role text,
  action text not null,
  entity_table text,
  entity_id uuid,
  patient_id uuid references public.patients(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  risk_level text not null default 'normal',
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_patient on public.audit_logs(patient_id);
create index if not exists idx_audit_created on public.audit_logs(created_at desc);

-- -----------------------------
-- Helpers
-- -----------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.current_role_code()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role_code from public.user_profiles where id = auth.uid() and active = true), 'anonymous');
$$;

create or replace function public.is_internal_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role_code() in ('super_admin','direction','clinical_coordination','professional','medical','psychologist','social_worker','therapeutic_operator','admission','finance','auditor');
$$;

create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role_code() in ('super_admin','direction','clinical_coordination');
$$;

create or replace function public.can_access_clinical_data()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role_code() in ('super_admin','direction','clinical_coordination','professional','medical','psychologist','social_worker','therapeutic_operator');
$$;

create or replace function public.can_manage_documents()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role_code() in ('super_admin','direction','clinical_coordination','professional','medical','psychologist','social_worker','therapeutic_operator','admission');
$$;

create or replace function public.can_write_operational_data()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role_code() in ('super_admin','direction','clinical_coordination','admission');
$$;

create or replace function public.can_manage_appointments()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role_code() in ('super_admin','direction','clinical_coordination','admission','professional','medical','psychologist','social_worker','therapeutic_operator');
$$;

create or replace function public.can_manage_catalogs()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role_code() in ('super_admin','direction','clinical_coordination');
$$;

create or replace function public.add_audit_log(
  p_action text,
  p_entity_table text default null,
  p_entity_id uuid default null,
  p_patient_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_risk_level text default 'normal'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.audit_logs(actor_user_id, actor_role, action, entity_table, entity_id, patient_id, metadata, risk_level)
  values (auth.uid(), public.current_role_code(), p_action, p_entity_table, p_entity_id, p_patient_id, coalesce(p_metadata, '{}'::jsonb), p_risk_level)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.bootstrap_first_admin(display_name text default 'Administrador inicial')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Debe iniciar sesión para crear el primer administrador';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  if exists(select 1 from public.user_profiles where role_code = 'super_admin' and active = true) then
    return 'Ya existe un super_admin activo. Asigne permisos desde el panel.';
  end if;

  insert into public.user_profiles(id, email, full_name, role_code, active)
  values(auth.uid(), v_email, coalesce(nullif(display_name,''), v_email), 'super_admin', true)
  on conflict (id) do update set role_code = 'super_admin', active = true, updated_at = now();

  perform public.add_audit_log('BOOTSTRAP_FIRST_ADMIN', 'user_profiles', auth.uid(), null, jsonb_build_object('email', v_email), 'high');
  return 'Primer super_admin creado correctamente';
end;
$$;



-- -----------------------------
-- Updated_at triggers
-- -----------------------------
do $$
declare r record;
begin
  for r in select table_name from information_schema.columns where table_schema='public' and column_name='updated_at'
  loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', r.table_name, r.table_name);
    execute format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', r.table_name, r.table_name);
  end loop;
end $$;

-- -----------------------------
-- Seed base roles and permissions
-- -----------------------------
insert into public.roles(code, name, description, is_internal) values
('super_admin','Administrador técnico','Acceso completo técnico y configuración', true),
('direction','Dirección','Dirección institucional y supervisión general', true),
('clinical_coordination','Coordinación clínica','Supervisa pacientes, profesionales, tratamientos y turnos', true),
('professional','Profesional tratante','Profesional con acceso a pacientes asignados', true),
('medical','Médico','Registro clínico médico y seguimiento', true),
('psychologist','Psicología','Registro psicológico y seguimiento', true),
('social_worker','Trabajo social','Evaluación social y acompañamiento familiar', true),
('therapeutic_operator','Operador terapéutico','Intervenciones, talleres y asistencia', true),
('admission','Admisión y recepción','Alta de pacientes, turnos y documentación', true),
('finance','Administración','Finanzas, donaciones, becas y rendiciones', true),
('auditor','Auditoría','Acceso de lectura a trazabilidad y reportes', true),
('patient','Paciente','Portal del paciente', false),
('family','Familiar autorizado','Portal familiar con permisos limitados', false)
on conflict(code) do update set name=excluded.name, description=excluded.description, is_internal=excluded.is_internal;

insert into public.permissions(code, name, description) values
('patients.read','Ver pacientes','Lectura de fichas administrativas'),
('patients.write','Crear/editar pacientes','Alta y actualización administrativa'),
('clinical.read','Ver historia clínica','Lectura de registros clínicos'),
('clinical.write','Registrar historia clínica','Crear borradores y evoluciones'),
('clinical.sign','Cerrar/firmar registros','Firma o cierre de evoluciones'),
('documents.manage','Gestionar documentos','Carga, clasificación y liberación'),
('appointments.manage','Gestionar turnos','Agenda, asistencia y reprogramación'),
('programs.manage','Gestionar programas','Programas terapéuticos y etapas'),
('finance.manage','Gestionar finanzas','Pagos, donaciones, becas y rendiciones'),
('reports.read','Ver reportes','Indicadores de dirección'),
('audit.read','Ver auditoría','Trazabilidad y seguridad'),
('users.manage','Gestionar usuarios','Roles, permisos y perfiles')
on conflict(code) do update set name=excluded.name, description=excluded.description;

insert into public.role_permissions(role_code, permission_code)
select r.code, p.code from public.roles r cross join public.permissions p
where r.code in ('super_admin','direction')
on conflict do nothing;

insert into public.role_permissions(role_code, permission_code) values
('clinical_coordination','patients.read'),('clinical_coordination','patients.write'),('clinical_coordination','clinical.read'),('clinical_coordination','clinical.write'),('clinical_coordination','clinical.sign'),('clinical_coordination','documents.manage'),('clinical_coordination','appointments.manage'),('clinical_coordination','programs.manage'),('clinical_coordination','reports.read'),('clinical_coordination','audit.read'),
('professional','patients.read'),('professional','clinical.read'),('professional','clinical.write'),('professional','clinical.sign'),('professional','appointments.manage'),('professional','documents.manage'),
('medical','patients.read'),('medical','clinical.read'),('medical','clinical.write'),('medical','clinical.sign'),('medical','appointments.manage'),('medical','documents.manage'),
('psychologist','patients.read'),('psychologist','clinical.read'),('psychologist','clinical.write'),('psychologist','clinical.sign'),('psychologist','appointments.manage'),('psychologist','documents.manage'),
('social_worker','patients.read'),('social_worker','clinical.read'),('social_worker','clinical.write'),('social_worker','appointments.manage'),('social_worker','documents.manage'),
('therapeutic_operator','patients.read'),('therapeutic_operator','clinical.read'),('therapeutic_operator','clinical.write'),('therapeutic_operator','appointments.manage'),
('admission','patients.read'),('admission','patients.write'),('admission','appointments.manage'),('admission','documents.manage'),
('finance','patients.read'),('finance','finance.manage'),('finance','reports.read'),
('auditor','patients.read'),('auditor','reports.read'),('auditor','audit.read')
on conflict do nothing;

delete from public.role_permissions
where role_code in ('auditor','finance','admission')
  and permission_code like 'clinical.%';

-- -----------------------------
-- Row Level Security
-- -----------------------------
alter table public.organizations enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_profiles enable row level security;
alter table public.patients enable row level security;
alter table public.patient_contacts enable row level security;
alter table public.patient_status_history enable row level security;
alter table public.professionals enable row level security;
alter table public.programs enable row level security;
alter table public.program_stages enable row level security;
alter table public.patient_programs enable row level security;
alter table public.locations enable row level security;
alter table public.rooms enable row level security;
alter table public.appointment_types enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_status_history enable row level security;
alter table public.waiting_list enable row level security;
alter table public.clinical_templates enable row level security;
alter table public.clinical_entries enable row level security;
alter table public.clinical_entry_versions enable row level security;
alter table public.clinical_alerts enable row level security;
alter table public.document_types enable row level security;
alter table public.patient_documents enable row level security;
alter table public.portal_document_releases enable row level security;
alter table public.document_access_logs enable row level security;
alter table public.portal_requests enable row level security;
alter table public.financial_movements enable row level security;
alter table public.audit_logs enable row level security;

-- Drop policies if re-running
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname='public'
  LOOP
    EXECUTE format('drop policy if exists %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;

-- Shared config readable by authenticated users
create policy "auth read organizations" on public.organizations for select to authenticated using (true);
create policy "internal write organizations" on public.organizations for all to authenticated using (public.is_admin_user()) with check (public.is_admin_user());
create policy "auth read roles" on public.roles for select to authenticated using (true);
create policy "auth read permissions" on public.permissions for select to authenticated using (true);
create policy "auth read role_permissions" on public.role_permissions for select to authenticated using (public.is_admin_user());

-- Profiles
create policy "profiles self read" on public.user_profiles for select to authenticated using (id = auth.uid() or public.is_admin_user() or public.current_role_code()='auditor');
create policy "profiles admin insert" on public.user_profiles for insert to authenticated with check (public.is_admin_user());
create policy "profiles admin update" on public.user_profiles for update to authenticated using (public.is_admin_user()) with check (public.is_admin_user());
create policy "profiles admin delete" on public.user_profiles for delete to authenticated using (public.is_admin_user());

-- Operational policies. Auditors can read operational records and audit logs, but cannot write or view clinical/documents/finance.
create policy "internal patients read" on public.patients for select to authenticated using (public.is_internal_user());
create policy "patients insert restricted" on public.patients for insert to authenticated with check (public.can_write_operational_data());
create policy "patients update restricted" on public.patients for update to authenticated using (public.can_write_operational_data()) with check (public.can_write_operational_data());
create policy "patients delete restricted" on public.patients for delete to authenticated using (public.can_write_operational_data());
create policy "portal own patient read" on public.patients for select to authenticated using (id = (select patient_id from public.user_profiles where id = auth.uid()));

create policy "internal patient_contacts read" on public.patient_contacts for select to authenticated using (public.is_internal_user());
create policy "patient_contacts insert restricted" on public.patient_contacts for insert to authenticated with check (public.can_write_operational_data());
create policy "patient_contacts update restricted" on public.patient_contacts for update to authenticated using (public.can_write_operational_data()) with check (public.can_write_operational_data());
create policy "patient_contacts delete restricted" on public.patient_contacts for delete to authenticated using (public.can_write_operational_data());
create policy "portal own contacts read" on public.patient_contacts for select to authenticated using (patient_id = (select patient_id from public.user_profiles where id = auth.uid()));

create policy "internal status history read" on public.patient_status_history for select to authenticated using (public.is_internal_user());
create policy "status history insert restricted" on public.patient_status_history for insert to authenticated with check (public.can_write_operational_data());
create policy "status history update restricted" on public.patient_status_history for update to authenticated using (public.can_write_operational_data()) with check (public.can_write_operational_data());
create policy "status history delete restricted" on public.patient_status_history for delete to authenticated using (public.can_write_operational_data());

create policy "internal professionals read" on public.professionals for select to authenticated using (public.is_internal_user());
create policy "professionals insert restricted" on public.professionals for insert to authenticated with check (public.can_manage_catalogs());
create policy "professionals update restricted" on public.professionals for update to authenticated using (public.can_manage_catalogs()) with check (public.can_manage_catalogs());
create policy "professionals delete restricted" on public.professionals for delete to authenticated using (public.can_manage_catalogs());
create policy "portal professionals read" on public.professionals for select to authenticated using (true);

create policy "internal programs read" on public.programs for select to authenticated using (public.is_internal_user());
create policy "programs insert restricted" on public.programs for insert to authenticated with check (public.can_manage_catalogs());
create policy "programs update restricted" on public.programs for update to authenticated using (public.can_manage_catalogs()) with check (public.can_manage_catalogs());
create policy "programs delete restricted" on public.programs for delete to authenticated using (public.can_manage_catalogs());
create policy "portal programs read" on public.programs for select to authenticated using (active=true);

create policy "internal program_stages read" on public.program_stages for select to authenticated using (public.is_internal_user());
create policy "program_stages insert restricted" on public.program_stages for insert to authenticated with check (public.can_manage_catalogs());
create policy "program_stages update restricted" on public.program_stages for update to authenticated using (public.can_manage_catalogs()) with check (public.can_manage_catalogs());
create policy "program_stages delete restricted" on public.program_stages for delete to authenticated using (public.can_manage_catalogs());

create policy "internal patient_programs read" on public.patient_programs for select to authenticated using (public.is_internal_user());
create policy "patient_programs insert restricted" on public.patient_programs for insert to authenticated with check (public.can_write_operational_data());
create policy "patient_programs update restricted" on public.patient_programs for update to authenticated using (public.can_write_operational_data()) with check (public.can_write_operational_data());
create policy "patient_programs delete restricted" on public.patient_programs for delete to authenticated using (public.can_write_operational_data());
create policy "portal own patient_programs read" on public.patient_programs for select to authenticated using (patient_id = (select patient_id from public.user_profiles where id = auth.uid()));

create policy "internal locations read" on public.locations for select to authenticated using (public.is_internal_user());
create policy "locations write restricted" on public.locations for all to authenticated using (public.can_manage_catalogs()) with check (public.can_manage_catalogs());
create policy "portal locations read" on public.locations for select to authenticated using (active=true);

create policy "internal rooms read" on public.rooms for select to authenticated using (public.is_internal_user());
create policy "rooms write restricted" on public.rooms for all to authenticated using (public.can_manage_catalogs()) with check (public.can_manage_catalogs());

create policy "internal appointment_types read" on public.appointment_types for select to authenticated using (public.is_internal_user());
create policy "appointment_types write restricted" on public.appointment_types for all to authenticated using (public.can_manage_catalogs()) with check (public.can_manage_catalogs());
create policy "portal appointment_types read" on public.appointment_types for select to authenticated using (active=true);

create policy "internal appointments read" on public.appointments for select to authenticated using (public.is_internal_user());
create policy "appointments insert restricted" on public.appointments for insert to authenticated with check (public.can_manage_appointments());
create policy "appointments update restricted" on public.appointments for update to authenticated using (public.can_manage_appointments()) with check (public.can_manage_appointments());
create policy "appointments delete restricted" on public.appointments for delete to authenticated using (public.can_manage_appointments());
create policy "portal own appointments read" on public.appointments for select to authenticated using (patient_id = (select patient_id from public.user_profiles where id = auth.uid()));

create policy "internal appointment history read" on public.appointment_status_history for select to authenticated using (public.is_internal_user());
create policy "appointment history insert restricted" on public.appointment_status_history for insert to authenticated with check (public.can_manage_appointments());
create policy "appointment history update restricted" on public.appointment_status_history for update to authenticated using (public.can_manage_appointments()) with check (public.can_manage_appointments());
create policy "appointment history delete restricted" on public.appointment_status_history for delete to authenticated using (public.can_manage_appointments());

create policy "internal waiting_list read" on public.waiting_list for select to authenticated using (public.is_internal_user());
create policy "waiting_list insert restricted" on public.waiting_list for insert to authenticated with check (public.can_manage_appointments());
create policy "waiting_list update restricted" on public.waiting_list for update to authenticated using (public.can_manage_appointments()) with check (public.can_manage_appointments());
create policy "waiting_list delete restricted" on public.waiting_list for delete to authenticated using (public.can_manage_appointments());

create policy "internal clinical_templates all" on public.clinical_templates for all to authenticated using (public.can_access_clinical_data()) with check (public.can_access_clinical_data());
create policy "clinical access restricted" on public.clinical_entries for all to authenticated using (public.can_access_clinical_data()) with check (public.can_access_clinical_data());
create policy "clinical versions restricted" on public.clinical_entry_versions for all to authenticated using (public.can_access_clinical_data()) with check (public.can_access_clinical_data());
create policy "clinical alerts restricted" on public.clinical_alerts for all to authenticated using (public.can_access_clinical_data()) with check (public.can_access_clinical_data());

create policy "document types managed users" on public.document_types for all to authenticated using (public.can_manage_documents()) with check (public.can_manage_documents());
create policy "documents managed users" on public.patient_documents for all to authenticated using (public.can_manage_documents()) with check (public.can_manage_documents());
create policy "portal released documents read" on public.patient_documents for select to authenticated using (
  exists(
    select 1 from public.portal_document_releases r
    join public.user_profiles up on up.id = auth.uid()
    where r.document_id = patient_documents.id
      and r.active = true
      and r.patient_id = up.patient_id
      and (r.expires_at is null or r.expires_at > now())
  )
);
create policy "document releases managed users" on public.portal_document_releases for all to authenticated using (public.can_manage_documents()) with check (public.can_manage_documents());
create policy "portal own releases read" on public.portal_document_releases for select to authenticated using (patient_id = (select patient_id from public.user_profiles where id = auth.uid()) and active = true);
create policy "document access managed users" on public.document_access_logs for all to authenticated using (public.can_manage_documents()) with check (public.can_manage_documents());

create policy "internal portal_requests read" on public.portal_requests for select to authenticated using (public.is_internal_user());
create policy "internal portal_requests update" on public.portal_requests for update to authenticated using (public.can_write_operational_data()) with check (public.can_write_operational_data());
create policy "portal own requests read" on public.portal_requests for select to authenticated using (patient_id = (select patient_id from public.user_profiles where id = auth.uid()) or requester_user_id = auth.uid());
create policy "portal own requests insert" on public.portal_requests for insert to authenticated with check (requester_user_id = auth.uid() and patient_id = (select patient_id from public.user_profiles where id = auth.uid()));

create policy "internal finance all" on public.financial_movements for all to authenticated using (public.current_role_code() in ('super_admin','direction','finance')) with check (public.current_role_code() in ('super_admin','direction','finance'));
create policy "audit read restricted" on public.audit_logs for select to authenticated using (public.current_role_code() in ('super_admin','direction','clinical_coordination','auditor'));
create policy "audit insert authenticated" on public.audit_logs for insert to authenticated with check (auth.uid() is not null);

-- -----------------------------
-- Storage bucket and policies
-- -----------------------------
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values('clinical-documents', 'clinical-documents', false, 10485760, array['application/pdf','image/png','image/jpeg','image/webp','text/plain'])
on conflict(id) do update set public=false, file_size_limit=10485760;

drop policy if exists "internal clinical documents storage" on storage.objects;
drop policy if exists "portal released clinical documents storage" on storage.objects;

create policy "internal clinical documents storage"
on storage.objects for all to authenticated
using (bucket_id = 'clinical-documents' and public.can_manage_documents())
with check (bucket_id = 'clinical-documents' and public.can_manage_documents());

create policy "portal released clinical documents storage"
on storage.objects for select to authenticated
using (
  bucket_id = 'clinical-documents'
  and exists(
    select 1 from public.patient_documents d
    join public.portal_document_releases r on r.document_id = d.id
    join public.user_profiles up on up.id = auth.uid()
    where d.file_path = storage.objects.name
      and r.patient_id = up.patient_id
      and r.active = true
      and (r.expires_at is null or r.expires_at > now())
  )
);

