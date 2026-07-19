-- =============================================================
-- Fundación Senderos de Libertad
-- Archivo 007_demo_reset.sql
-- Carga, limpieza y restauración de los datos de demostración.
-- Ejecutar después de 001, 002, 004, 005 y 006.
--
-- Define tres funciones:
--   public.seed_demo_data()    -> carga (idempotente) el conjunto de ejemplo
--   public.cleanup_demo_data() -> retira todo lo marcado como is_demo
--   public.reset_demo_data()   -> limpia y vuelve a cargar el estado de ejemplo
-- =============================================================
begin;

-- -----------------------------------------------------------------
-- Carga idempotente de los datos de ejemplo.
-- Incluye finanzas (cargos y pagos) que viven en las tablas creadas
-- en 004, por eso este seed corre después del hardening.
-- -----------------------------------------------------------------
create or replace function public.seed_demo_data()
returns void
language plpgsql
security definer
set search_path = public
as $seed$
declare
  v_org uuid;
begin
  -- Datos controlados: se inhiben triggers de protección/validación para poder
  -- sembrar historia clínica y agenda de ejemplo tal como quedarían en operación.
  set local session_replication_role = 'replica';

  insert into public.organizations(name, legal_name, cuit, activity, address, city, province, country, is_demo)
  values('Fundación Senderos de Libertad','Fundación Senderos de Libertad','30-71928002-8','Servicios relacionados con la salud humana n.c.p.','República de Siria 115, Piso 2','Mendoza','Mendoza','Argentina', false)
  on conflict(cuit) do update set name=excluded.name, legal_name=excluded.legal_name, activity=excluded.activity, address=excluded.address, city=excluded.city, province=excluded.province;

  select id into v_org from public.organizations where cuit='30-71928002-8';

  -- Programas
  insert into public.programs(org_id, name, slug, description, duration_weeks, is_demo)
  select v_org, v.name, v.slug, v.description, v.duration_weeks, true
  from (values
  ('Prevención y sensibilización','prevencion-sensibilizacion','Talleres educativos, charlas para familias, docentes y referentes comunitarios, campañas de concientización y reducción del estigma.',8),
  ('Orientación y tratamiento','orientacion-tratamiento','Primera orientación, evaluación, consejería, terapia individual, grupos de apoyo, centro de día y coordinación con redes de salud.',24),
  ('Acompañamiento familiar','acompanamiento-familiar','Apoyo a familiares, límites saludables, codependencia y herramientas para sostener el proceso.',12),
  ('Reinserción social y laboral','reinsercion-social-laboral','Habilidades para la vida, capacitación, orientación laboral, empleo, emprendimiento y redes de apoyo.',20),
  ('Programa Online','programa-online','Orientación, terapia y seguimiento virtual para personas que no pueden asistir presencialmente.',12)
  ) v(name, slug, description, duration_weeks)
  on conflict(slug) do update set description=excluded.description, duration_weeks=excluded.duration_weeks, is_demo=true;

  insert into public.program_stages(program_id, name, stage_order, description, is_demo)
  select p.id, s.name, s.stage_order, s.description, true
  from public.programs p
  join (values
  ('orientacion-tratamiento','Primer contacto',1,'Escucha inicial, orientación y contención.'),
  ('orientacion-tratamiento','Evaluación',2,'Revisión del caso, red familiar, nivel de riesgo y alternativas.'),
  ('orientacion-tratamiento','Plan de apoyo',3,'Definición de terapia, grupo, centro de día, residencia o derivación.'),
  ('orientacion-tratamiento','Tratamiento',4,'Acompañamiento individual, grupal y familiar.'),
  ('reinsercion-social-laboral','Reinserción',5,'Autonomía, rutina, vínculos, capacitación y oportunidades.'),
  ('reinsercion-social-laboral','Seguimiento',6,'Continuidad, redes de apoyo e indicadores de avance.'),
  ('acompanamiento-familiar','Orientación familiar',1,'Espacio para referentes y familiares.'),
  ('prevencion-sensibilizacion','Taller comunitario',1,'Charlas y acciones preventivas.'),
  ('programa-online','Ingreso online',1,'Orientación inicial remota y agenda virtual.')
  ) s(slug, name, stage_order, description) on p.slug=s.slug
  on conflict do nothing;

  -- Sede, salas y catálogos
  insert into public.locations(org_id, name, address, city, active, is_demo)
  select v_org, 'Sede Mendoza', 'República de Siria 115, Piso 2', 'Mendoza', true, true
  where not exists(select 1 from public.locations where name='Sede Mendoza');

  insert into public.rooms(location_id, name, room_type, capacity, active, is_demo)
  select l.id, v.name, v.room_type, v.capacity, true, true
  from public.locations l
  cross join (values
  ('Consultorio psicológico','individual',2),
  ('Consultorio médico','individual',2),
  ('Sala familiar','familiar',5),
  ('Sala de grupos','grupal',18),
  ('Atención online','virtual',1)
  ) v(name, room_type, capacity)
  where l.name='Sede Mendoza' and not exists(select 1 from public.rooms r where r.location_id=l.id and r.name=v.name);

  insert into public.appointment_types(name, default_minutes, requires_clinical_entry, is_demo)
  select * from (values
  ('Orientación inicial',45,true,true),
  ('Evaluación interdisciplinaria',60,true,true),
  ('Terapia individual',50,true,true),
  ('Grupo de apoyo',90,true,true),
  ('Acompañamiento familiar',60,true,true),
  ('Seguimiento online',45,true,true),
  ('Actividad de prevención',90,false,true),
  ('Gestión administrativa',30,false,true),
  ('Asesoría legal',45,false,true),
  ('Entrevista de voluntariado',45,false,true)
  ) v(name, default_minutes, requires_clinical_entry, is_demo)
  where not exists(select 1 from public.appointment_types a where a.name=v.name);

  insert into public.document_types(name, category, requires_expiration, is_demo)
  select * from (values
  ('DNI / documento de identidad','administrativo',false,true),
  ('Consentimiento informado','legal-clinico',false,true),
  ('Autorización de familiar o tutor','legal',false,true),
  ('Evaluación inicial','clinico',false,true),
  ('Informe psicológico','clinico',false,true),
  ('Informe social','clinico',false,true),
  ('Informe médico','clinico',false,true),
  ('Certificado emitido','administrativo',false,true),
  ('Comprobante de aporte o donación','financiero',false,true)
  ) v(name, category, requires_expiration, is_demo)
  where not exists(select 1 from public.document_types d where d.name=v.name);

  insert into public.clinical_templates(name, entry_type, body_template, active, is_demo)
  select * from (values
  ('Primer contacto','primer_contacto',E'Motivo de consulta:\n\nPersona que solicita orientación:\n\nSituación actual:\n\nRed familiar/referente:\n\nRiesgo inmediato:\n\nPróximo paso:\n',true,true),
  ('Evaluación interdisciplinaria','evaluacion_interdisciplinaria',E'Antecedentes relevantes:\n\nEvaluación clínica/psicológica/social:\n\nNivel de riesgo:\n\nRecursos familiares/comunitarios:\n\nPlan sugerido:\n',true,true),
  ('Evolución individual','evolucion_individual',E'Objetivo de la sesión:\n\nObservaciones:\n\nAcuerdos:\n\nTareas o indicaciones:\n\nPróximo turno:\n',true,true),
  ('Reunión familiar','reunion_familiar',E'Participantes:\n\nSituación familiar actual:\n\nLímites y acuerdos:\n\nOrientaciones:\n\nSeguimiento:\n',true,true),
  ('Informe de seguimiento','informe_seguimiento',E'Resumen del período:\n\nAvances:\n\nDificultades:\n\nRed de apoyo:\n\nPróximas acciones:\n',true,true)
  ) v(name, entry_type, body_template, active, is_demo)
  where not exists(select 1 from public.clinical_templates t where t.name=v.name);

  -- Equipo profesional
  insert into public.professionals(org_id, full_name, role_title, specialty, license_number, email, phone, bio, active, is_demo)
  select v_org, v.full_name, v.role_title, v.specialty, v.license_number, v.email, v.phone, v.bio, true, true
  from (values
  ('Dra. Valeria Moreno','Psiquiatra','Evaluación clínica y manejo médico','MP-45021','valeria.moreno@senderos.demo','+54 9 261 000 1001','Coordina la evaluación clínica de ingreso y el seguimiento médico del equipo.'),
  ('Lic. Martín Quiroga','Psicólogo','Terapia individual, grupal y familiar','MP-45022','martin.quiroga@senderos.demo','+54 9 261 000 1002','Referente terapéutico del programa de orientación y tratamiento.'),
  ('Lic. Ana Rivas','Asistente social','Redes, familia y reinserción','MP-45023','ana.rivas@senderos.demo','+54 9 261 000 1003','Trabaja los vínculos familiares y la reinserción social y laboral.'),
  ('Carlos Medina','Asistente terapéutico','Acompañamiento cotidiano y talleres',null,'carlos.medina@senderos.demo','+54 9 261 000 1004','Acompaña la rutina diaria y los talleres de la casa.'),
  ('Sofía Herrera','Nutricionista','Hábitos, alimentación y bienestar','MP-45024','sofia.herrera@senderos.demo','+54 9 261 000 1005','Aborda la recuperación de hábitos y el bienestar físico.'),
  ('Paula Torres','Musicoterapeuta','Espacios expresivos y grupales','MP-45025','paula.torres@senderos.demo','+54 9 261 000 1006','Conduce los espacios expresivos y de musicoterapia grupal.'),
  ('Diego Salvatierra','Profesor de educación física','Rutina, cuerpo y bienestar',null,'diego.salvatierra@senderos.demo','+54 9 261 000 1007','Coordina la actividad física y el trabajo corporal.'),
  ('Dra. Laura Benegas','Asesora legal','Orientación institucional y derivaciones legales','MT-8842','laura.benegas@senderos.demo','+54 9 261 000 1008','Brinda orientación legal a la institución y a las familias.'),
  ('Equipo de voluntariado','Voluntariado','Apoyo comunitario, talleres y acompañamiento transversal',null,'voluntariado@senderos.demo','+54 9 261 000 1009','Suma apoyo comunitario en talleres y actividades abiertas.')
  ) v(full_name, role_title, specialty, license_number, email, phone, bio)
  where not exists(select 1 from public.professionals p where p.email=v.email);

  -- Personas acompañadas (ejemplo, ficticias)
  insert into public.patients(org_id, first_name, last_name, document_type, document_number, birth_date, gender, email, phone, address, city, province, emergency_contact_name, emergency_contact_phone, admission_status, admission_date, risk_level, notes, is_demo)
  select v_org, v.*
  from (values
  ('Mateo','Roldán','DNI','99000101','1997-05-12'::date,'masculino','mateo.roldan@paciente.demo','+54 9 261 111 0001','Barrio San Martín 145','Mendoza','Mendoza','Laura Roldán','+54 9 261 222 0001','en_tratamiento',(current_date - interval '23 days')::date,'medio','Ingreso por consumo problemático de alcohol. Sostiene terapia individual y grupal; red familiar presente.',true),
  ('Lucía','Giménez','DNI','99000102','2001-09-04'::date,'femenino','lucia.gimenez@paciente.demo','+54 9 261 111 0002','Calle Los Álamos 88','Godoy Cruz','Mendoza','Patricia Giménez','+54 9 261 222 0002','evaluacion',(current_date - interval '6 days')::date,'bajo','En etapa de evaluación interdisciplinaria. Deriva de un taller de prevención.',true),
  ('Santiago','Páez','DNI','99000103','1989-11-18'::date,'masculino','santiago.paez@paciente.demo','+54 9 261 111 0003','Ruta 60 Km 3','Guaymallén','Mendoza','Elena Páez','+54 9 261 222 0003','seguimiento',(current_date - interval '105 days')::date,'bajo','En proceso de reinserción laboral, con seguimiento mensual.',true),
  ('Rocío','Molina','DNI','99000104','1994-01-21'::date,'femenino','rocio.molina@paciente.demo','+54 9 261 111 0004','Pasaje Belgrano 210','Las Heras','Mendoza','Claudia Molina','+54 9 261 222 0004','preingreso',(current_date - interval '1 day')::date,'alto','Primer contacto reciente. Requiere orientación inicial y contención.',true)
  ) v(first_name,last_name,document_type,document_number,birth_date,gender,email,phone,address,city,province,emergency_contact_name,emergency_contact_phone,admission_status,admission_date,risk_level,notes,is_demo)
  where not exists(select 1 from public.patients p where p.document_number=v.document_number);

  insert into public.patient_contacts(patient_id, full_name, relationship, phone, email, is_authorized, can_access_portal, can_receive_updates, notes, is_demo)
  select p.id, p.emergency_contact_name, 'Familiar referente', p.emergency_contact_phone, null, true, true, true, 'Referente autorizado para el portal y las comunicaciones.', true
  from public.patients p where p.is_demo=true and not exists(select 1 from public.patient_contacts c where c.patient_id=p.id);

  insert into public.patient_programs(patient_id, program_id, responsible_professional_id, current_stage, start_date, status, goals, is_demo)
  select p.id, pr.id, prof.id,
  case when p.first_name='Rocío' then 'Primer contacto' when p.first_name='Lucía' then 'Evaluación' when p.first_name='Santiago' then 'Seguimiento' else 'Tratamiento' end,
  coalesce(p.admission_date,current_date), 'activo', 'Sostener asistencia, fortalecer la red familiar y ordenar los próximos pasos.', true
  from public.patients p
  join public.programs pr on pr.slug = case when p.first_name='Santiago' then 'reinsercion-social-laboral' when p.first_name='Lucía' then 'orientacion-tratamiento' when p.first_name='Rocío' then 'orientacion-tratamiento' else 'acompanamiento-familiar' end
  left join public.professionals prof on prof.email='martin.quiroga@senderos.demo'
  where p.is_demo=true
  on conflict do nothing;

  insert into public.appointments(org_id, patient_id, professional_id, program_id, appointment_type_id, location_id, room_id, start_at, end_at, status, modality, reason, attendance_status, notes, is_demo)
  select v_org, p.id, prof.id, pp.program_id, at.id, l.id, r.id,
  (date_trunc('day', now()) + offs.start_offset)::timestamptz,
  (date_trunc('day', now()) + offs.end_offset)::timestamptz,
  offs.status, offs.modality, offs.reason, null, null, true
  from public.patients p
  join public.patient_programs pp on pp.patient_id=p.id
  join public.professionals prof on prof.email = case when p.first_name='Lucía' then 'valeria.moreno@senderos.demo' when p.first_name='Santiago' then 'ana.rivas@senderos.demo' else 'martin.quiroga@senderos.demo' end
  join public.appointment_types at on at.name = case when p.first_name='Rocío' then 'Orientación inicial' when p.first_name='Lucía' then 'Evaluación interdisciplinaria' when p.first_name='Santiago' then 'Acompañamiento familiar' else 'Terapia individual' end
  join public.locations l on l.name='Sede Mendoza'
  join public.rooms r on r.location_id=l.id and r.name = case when p.first_name='Santiago' then 'Sala familiar' else 'Consultorio psicológico' end
  join lateral (select
  case when p.first_name='Mateo' then interval '1 day 10 hours' when p.first_name='Lucía' then interval '2 days 9 hours' when p.first_name='Santiago' then interval '3 days 15 hours' else interval '1 day 16 hours' end as start_offset,
  case when p.first_name='Mateo' then interval '1 day 10 hours 50 minutes' when p.first_name='Lucía' then interval '2 days 10 hours' when p.first_name='Santiago' then interval '3 days 16 hours' else interval '1 day 16 hours 45 minutes' end as end_offset,
  'confirmado'::text as status,
  case when p.first_name='Rocío' then 'online' else 'presencial' end as modality,
  case when p.first_name='Rocío' then 'Primer contacto' else 'Seguimiento del proceso' end as reason
  ) offs on true
  where p.is_demo=true and not exists(select 1 from public.appointments a where a.patient_id=p.id and a.is_demo=true);

  insert into public.clinical_entries(patient_id, professional_id, appointment_id, program_id, entry_type, title, body, status, visibility, signed_at, is_demo)
  select p.id, prof.id, null, pp.program_id,
  case when p.first_name='Rocío' then 'primer_contacto' when p.first_name='Lucía' then 'evaluacion_interdisciplinaria' else 'evolucion_individual' end,
  case when p.first_name='Rocío' then 'Primer contacto' when p.first_name='Lucía' then 'Evaluación inicial' else 'Evolución de seguimiento' end,
  case
    when p.first_name='Rocío' then E'Motivo de consulta: pedido de orientación de la familia.\n\nSituación actual: primer acercamiento, se ofrece contención y se acuerda una evaluación.\n\nRiesgo inmediato: se trabaja la contención y el sostén familiar.\n\nPróximo paso: coordinar la evaluación interdisciplinaria.'
    when p.first_name='Lucía' then E'Antecedentes: deriva de un taller de prevención.\n\nEvaluación: se completa la mirada clínica, psicológica y social.\n\nNivel de riesgo: bajo, con red familiar presente.\n\nPlan sugerido: ingreso a orientación y tratamiento con terapia individual.'
    else E'Objetivo de la sesión: sostener el proceso y revisar acuerdos.\n\nObservaciones: buena adherencia, participa de los espacios grupales.\n\nAcuerdos: continuar con la rutina y las tareas propuestas.\n\nPróximo turno: según agenda.'
  end,
  'signed','internal_clinical', now() - interval '1 day', true
  from public.patients p
  join public.patient_programs pp on pp.patient_id=p.id
  left join public.professionals prof on prof.email='martin.quiroga@senderos.demo'
  where p.is_demo=true and not exists(select 1 from public.clinical_entries ce where ce.patient_id=p.id and ce.is_demo=true);

  -- Documentación: una requerida y un documento ya incorporado y liberado al portal.
  insert into public.document_requirements(patient_id, document_type_id, title, instructions, allow_patient, allow_family, status)
  select p.id, dt.id, 'Consentimiento informado', 'Descargar, firmar y volver a subir en formato PDF o foto legible.', true, true, 'requested'
  from public.patients p
  join public.document_types dt on dt.name='Consentimiento informado'
  where p.is_demo=true and p.first_name='Rocío'
    and not exists(select 1 from public.document_requirements dr where dr.patient_id=p.id and dr.title='Consentimiento informado');

  insert into public.patient_documents(patient_id, document_type_id, title, file_path, mime_type, size_bytes, visibility, status, source, is_demo)
  select p.id, dt.id, 'Certificado de asistencia', null, 'application/pdf', 0, 'private_administrative', 'validado', 'internal', true
  from public.patients p
  join public.document_types dt on dt.name='Certificado emitido'
  where p.is_demo=true and p.first_name='Santiago'
    and not exists(select 1 from public.patient_documents d where d.patient_id=p.id and d.title='Certificado de asistencia');

  insert into public.portal_document_releases(document_id, patient_id, released_to, active)
  select d.id, d.patient_id, 'patient', true
  from public.patient_documents d
  join public.patients p on p.id=d.patient_id
  where p.is_demo=true and d.title='Certificado de asistencia'
    and not exists(select 1 from public.portal_document_releases r where r.document_id=d.id and r.patient_id=d.patient_id);

  insert into public.portal_requests(patient_id, request_type, subject, message, status, is_demo)
  select p.id, 'turno', 'Consulta por próximo turno', 'Quería consultar si es posible adelantar mi próximo turno. Muchas gracias.', 'pendiente', true
  from public.patients p
  where p.document_number='99000101'
    and not exists(select 1 from public.portal_requests r where r.patient_id=p.id and r.is_demo=true);

  -- Finanzas de ejemplo: un cargo con un pago parcial conciliado (tablas de 004).
  -- El trigger de conciliación está inhibido bajo replica, por eso el cargo
  -- ya se inserta con el saldo parcial que refleja el pago de ejemplo.
  insert into public.financial_charges(patient_id, category, description, issued_at, due_date, amount, currency, paid_amount, status, payer_name, notes)
  select p.id, 'aporte', 'Aporte mensual de acompañamiento', (current_date - interval '10 days')::date, (current_date + interval '5 days')::date, 40000, 'ARS', 25000, 'partial', p.emergency_contact_name, 'Aporte sugerido según escala social.'
  from public.patients p
  where p.is_demo=true and p.first_name='Mateo'
    and not exists(select 1 from public.financial_charges c where c.patient_id=p.id);

  insert into public.financial_payments(charge_id, patient_id, amount, currency, method, reference, payer_name, status, notes)
  select c.id, c.patient_id, 25000, 'ARS', 'bank_transfer', 'TRF-0001', c.payer_name, 'confirmed', 'Pago parcial recibido por transferencia.'
  from public.financial_charges c
  join public.patients p on p.id=c.patient_id
  where p.is_demo=true and p.first_name='Mateo'
    and not exists(select 1 from public.financial_payments fp where fp.charge_id=c.id);

  insert into public.audit_logs(action, entity_table, entity_id, patient_id, metadata, risk_level)
  select 'SEED_DEMO_DATA','patients',p.id,p.id,jsonb_build_object('message','Carga demo inicial'), 'normal'
  from public.patients p where p.is_demo=true and not exists(select 1 from public.audit_logs a where a.action='SEED_DEMO_DATA' and a.patient_id=p.id);
end;
$seed$;

-- -----------------------------------------------------------------
-- Limpieza: retira todo lo marcado como is_demo y las cuentas de portal
-- de demostración. Usa replica para poder retirar historia clínica de
-- ejemplo (protegida por trigger) sin afectar la operación real.
-- -----------------------------------------------------------------
create or replace function public.cleanup_demo_data()
returns void
language plpgsql
security definer
set search_path = public
as $cleanup$
begin
  set local session_replication_role = 'replica';

  delete from public.user_profiles where email like '%@senderos.demo';

  delete from public.audit_logs where action='SEED_DEMO_DATA' or metadata->>'message'='Carga demo inicial'
    or patient_id in (select id from public.patients where is_demo=true);
  delete from public.communication_recipients where communication_id in (select id from public.communications where created_at is not null and id in (select communication_id from public.communication_recipients cr join public.user_profiles up on up.id=cr.user_id where up.email like '%@senderos.demo'));
  delete from public.financial_payments where patient_id in (select id from public.patients where is_demo=true);
  delete from public.financial_charges where patient_id in (select id from public.patients where is_demo=true);
  delete from public.financial_movements where is_demo=true;
  delete from public.portal_requests where is_demo=true;
  delete from public.portal_document_submissions where patient_id in (select id from public.patients where is_demo=true);
  delete from public.document_requirements where patient_id in (select id from public.patients where is_demo=true);
  delete from public.portal_document_releases where patient_id in (select id from public.patients where is_demo=true);
  delete from public.document_access_logs where patient_id in (select id from public.patients where is_demo=true);
  delete from public.patient_documents where is_demo=true or patient_id in (select id from public.patients where is_demo=true);
  delete from public.clinical_entry_versions where clinical_entry_id in (select id from public.clinical_entries where is_demo=true);
  delete from public.clinical_alerts where is_demo=true or patient_id in (select id from public.patients where is_demo=true);
  delete from public.clinical_entries where is_demo=true or patient_id in (select id from public.patients where is_demo=true);
  delete from public.calendar_blocks where professional_id in (select id from public.professionals where is_demo=true);
  delete from public.professional_availability_rules where professional_id in (select id from public.professionals where is_demo=true);
  delete from public.waiting_list where is_demo=true;
  delete from public.appointment_status_history where appointment_id in (select id from public.appointments where is_demo=true);
  delete from public.appointments where is_demo=true or patient_id in (select id from public.patients where is_demo=true);
  delete from public.patient_programs where is_demo=true or patient_id in (select id from public.patients where is_demo=true);
  delete from public.patient_status_history where patient_id in (select id from public.patients where is_demo=true);
  delete from public.family_authorizations where patient_id in (select id from public.patients where is_demo=true);
  delete from public.patient_contacts where is_demo=true or patient_id in (select id from public.patients where is_demo=true);
  delete from public.patients where is_demo=true;
  delete from public.professionals where is_demo=true;
  delete from public.rooms where is_demo=true;
  delete from public.locations where is_demo=true;
  delete from public.program_stages where is_demo=true;
  delete from public.programs where is_demo=true;
  delete from public.clinical_templates where is_demo=true;
  delete from public.document_types where is_demo=true;
  delete from public.appointment_types where is_demo=true;
end;
$cleanup$;

-- -----------------------------------------------------------------
-- Restauración: limpia y vuelve a dejar el estado de ejemplo.
-- La recreación de las cuentas de acceso (Supabase Auth) la realiza
-- la función server-side /api/reset-demo después de esta llamada.
-- -----------------------------------------------------------------
create or replace function public.reset_demo_data()
returns void
language plpgsql
security definer
set search_path = public
as $reset$
begin
  perform public.cleanup_demo_data();
  perform public.seed_demo_data();
end;
$reset$;

revoke execute on function public.seed_demo_data() from public, anon, authenticated;
revoke execute on function public.cleanup_demo_data() from public, anon, authenticated;
revoke execute on function public.reset_demo_data() from public, anon, authenticated;
grant execute on function public.reset_demo_data() to service_role;

-- Carga inicial de la demo (idempotente).
select public.seed_demo_data();

commit;
