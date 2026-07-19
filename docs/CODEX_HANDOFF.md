# Handoff técnico para Codex

## Contexto del proyecto

El repo contiene la web institucional de Fundación Senderos de Libertad y un sistema interno clínico-administrativo agregado en rutas separadas. La web pública no debe reescribirse ni cambiarse sin pedido explícito. La prioridad siguiente es afinar el sistema interno para que una fundación real pueda operar sin conocimientos técnicos.

## Decisiones tomadas

- Mantener la web pública en raíz.
- Agregar sistema interno en `/sistema/`.
- Agregar portal de pacientes/familiares en `/portal/`.
- Usar Supabase como backend: Auth, PostgreSQL, RLS y Storage privado.
- Usar funciones server-side de Vercel para crear credenciales con `SUPABASE_SERVICE_ROLE_KEY` sin exponerla en frontend.
- Usar datos demo coherentes con la web: prevención, orientación/tratamiento, acompañamiento familiar, reinserción social/laboral y programa online.
- Usar profesionales demo según áreas indicadas en la web: psiquiatría, psicología, trabajo social, asistencia terapéutica, nutrición, musicoterapia, educación física, asesoría legal y voluntariado.
- Auditoría debe poder controlar operación y trazabilidad, pero no consultar historia clínica ni documentos clínicos confidenciales.

## Web pública

Archivos:

- `index.html`
- `styles.css`
- `script.js`
- `assets/`

Cambio visual actual:

- Bloque `Acompañamiento familiar` usa `assets/familia-acompanamiento.png`, fotografía provista por el usuario.

Regla:

- No agregar textos internos, aclaraciones técnicas ni textos de prueba en la web pública.
- No cambiar el tono institucional sin pedido del cliente.
- El acceso a sistema y portal ya está visible desde el menú y el hero.

## Sistema interno

Ruta: `/sistema/`

Archivos:

- `sistema/index.html`
- `sistema/app.js`
- `sistema/styles.css`

Módulos disponibles:

- Dashboard.
- Pacientes.
- Profesionales.
- Turnos.
- Historia clínica.
- Documentos.
- Programas.
- Accesos.
- Finanzas.
- Auditoría.

Flujos implementados:

### Alta de paciente

Desde `Pacientes`:

1. Cargar nombre, apellido, DNI, nacimiento, teléfono, email, estado y riesgo.
2. Cargar familiar/referente.
3. Asignar programa inicial.
4. Asignar profesional responsable.
5. Opcional: crear acceso al portal en el mismo formulario.

### Alta de profesional

Desde `Profesionales`:

1. Cargar nombre completo, cargo, especialidad, matrícula, email y teléfono.
2. Opcional: crear acceso al sistema en el mismo formulario.
3. Seleccionar rol de acceso.

### Crear credenciales

Desde `Accesos`:

- Crear acceso para paciente.
- Crear acceso para familiar autorizado.
- Crear acceso para profesional.

El frontend llama a `/api/create-user` con token de sesión. La función valida que el usuario actual sea `super_admin`, `direction` o `clinical_coordination`.

## Portal

Ruta: `/portal/`

Archivos:

- `portal/index.html`
- `portal/app.js`
- `portal/styles.css`

Disponible para pacientes y familiares autorizados:

- Ver datos básicos vinculados.
- Ver programas asignados.
- Ver próximos turnos.
- Ver documentos liberados.
- Enviar solicitudes.

Regla:

- El portal no debe mostrar historia clínica completa, notas internas ni documentación no liberada.

## Backend / API Vercel

Archivos:

- `api/public-config.js`
- `api/init-demo-users.js`
- `api/create-user.js`
- `api/update-user-access.js`

### `api/public-config.js`

Expone únicamente:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### `api/init-demo-users.js`

Crea o actualiza usuarios demo:

- `direccion@senderos.demo`
- `profesional@senderos.demo`
- `paciente@senderos.demo`
- `auditoria@senderos.demo`

Contraseña:

- `Senderos2026!`

Solo debe quedar habilitado con:

```env
ENABLE_DEMO_SETUP=true
```

Para producción real:

```env
ENABLE_DEMO_SETUP=false
```

### `api/create-user.js`

Crea usuarios reales desde el sistema interno. Usa `SUPABASE_SERVICE_ROLE_KEY` solo del lado servidor.

Puede crear usuarios vinculados a:

- `patient_id`
- `professional_id`

### `api/update-user-access.js`

Permite actualizar estado activo y contraseña.

Pendiente para mejorar:

- Agregar UI completa para activar/desactivar desde tabla.
- Agregar reset de contraseña con confirmación.
- Agregar registro de auditoría más detallado para cada cambio.

## Base de datos

SQL:

- `supabase/sql/001_schema.sql`
- `supabase/sql/002_seed_demo.sql`
- `supabase/sql/003_cleanup_demo.sql`

Tablas principales:

- `organizations`
- `roles`
- `permissions`
- `role_permissions`
- `user_profiles`
- `patients`
- `patient_contacts`
- `patient_status_history`
- `professionals`
- `programs`
- `program_stages`
- `patient_programs`
- `locations`
- `rooms`
- `appointment_types`
- `appointments`
- `appointment_status_history`
- `waiting_list`
- `clinical_templates`
- `clinical_entries`
- `clinical_entry_versions`
- `clinical_alerts`
- `document_types`
- `patient_documents`
- `portal_document_releases`
- `document_access_logs`
- `portal_requests`
- `financial_movements`
- `audit_logs`

RLS está activado en las tablas principales.

Funciones importantes:

- `current_role_code()`
- `is_admin_user()`
- `is_internal_user()`
- `can_access_clinical_data()`
- `can_write_operational_data()`
- `can_manage_appointments()`
- `can_manage_documents()`
- `can_manage_catalogs()`
- `add_audit_log(...)`
- `bootstrap_first_admin(...)`

## Datos demo

Archivo: `supabase/sql/002_seed_demo.sql`

Carga:

- Organización demo.
- Roles y permisos.
- Programas.
- Etapas.
- Profesionales.
- Pacientes ficticios.
- Contactos.
- Asignación a programas.
- Tipos de turno.
- Salas.
- Turnos.
- Plantillas clínicas.
- Evoluciones demo.
- Documentos demo.
- Solicitudes de portal.
- Movimientos financieros.
- Auditoría inicial.

El error de fecha `birth_date` fue corregido casteando fechas como `date`.

## Seguridad actual

Implementado:

- Supabase Auth.
- RLS en tablas.
- Perfiles y roles.
- Service role solo en serverless functions.
- Storage privado `clinical-documents`.
- Auditoría base.
- Perfil auditor sin acceso a historia clínica ni documentos clínicos privados.

Pendiente para endurecer:

- Agregar 2FA para roles internos.
- Registrar IP y user-agent reales en auditoría desde API.
- Separar permisos por paciente asignado para profesionales.
- Agregar expiración de sesiones reforzada.
- Agregar confirmación antes de exportar o descargar documentos.
- Agregar políticas específicas para familiares autorizados con alcance por documento.

## Prioridades recomendadas para seguir

### Prioridad 1: estabilidad operativa

- Validar todos los formularios con mensajes claros.
- Agregar estados de carga por acción.
- Evitar doble submit.
- Mejorar errores de Supabase para usuarios no técnicos.
- Agregar edición de paciente y profesional.
- Agregar búsqueda y filtros reales.

### Prioridad 2: turnos

- Crear agenda calendario diaria/semanal/mensual.
- Bloquear horarios por profesional.
- Validar choque de sala y profesional.
- Agregar asistencia: asistió, ausente, canceló, reprogramó.
- Desde turno asistido, crear evolución clínica vinculada.

### Prioridad 3: historia clínica

- Separar borrador, cerrado y rectificación.
- Evitar edición libre después del cierre.
- Agregar firma simple del profesional.
- Crear vista cronológica por paciente.
- Agregar plantillas por tipo de intervención.

### Prioridad 4: documentos

- Subida real de archivos a `clinical-documents`.
- Clasificación de documento: clínico, administrativo, portal.
- Liberación controlada al portal.
- Log de descargas.

### Prioridad 5: portal

- Solicitud de turno desde portal.
- Solicitud de corrección de datos.
- Mensajes seguros sin contenido clínico sensible.
- Vista de documentos liberados con vencimiento.

### Prioridad 6: administración

- Movimientos por paciente, donante o convenio.
- Estados de pago.
- Becas.
- Reporte mensual.
- Exportación CSV.

### Prioridad 7: dirección y auditoría

- Dashboard ejecutivo.
- Métricas por programa.
- Turnos sin evolución.
- Documentos pendientes.
- Pacientes por estado.
- Accesos a información sensible.

## Checklist antes de mostrar

1. Deploy nuevo en Vercel terminado.
2. Variables cargadas en Vercel.
3. `001_schema.sql` ejecutado.
4. `002_seed_demo.sql` ejecutado.
5. Entrar a `/sistema/`.
6. Presionar `Preparar accesos demo`.
7. Probar login dirección.
8. Probar login profesional.
9. Probar login paciente en `/portal/`.
10. Probar login auditoría y verificar que no vea historia clínica.

## Checklist antes de operación real

1. Ejecutar `003_cleanup_demo.sql`.
2. Cambiar `ENABLE_DEMO_SETUP=false`.
3. Crear usuarios reales.
4. Revisar roles y permisos.
5. Configurar dominio definitivo.
6. Activar políticas internas de contraseñas.
7. Definir responsable de auditoría.
8. Definir protocolo de carga de historia clínica.
9. Definir protocolo de liberación de documentos al portal.
10. Realizar backup inicial.

## Notas de cuidado

- No usar WhatsApp como registro oficial de historia clínica.
- No guardar documentos sensibles en rutas públicas.
- No permitir que el paciente vea evoluciones clínicas completas por defecto.
- No borrar historia clínica: usar rectificación o anulación justificada.
- No exponer `SUPABASE_SERVICE_ROLE_KEY` en frontend.
- No dejar `ENABLE_DEMO_SETUP=true` en producción real.
