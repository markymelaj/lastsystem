# Arquitectura del sistema

## Enfoque

Aplicación web estática con funciones serverless y Supabase como backend.

```text
Web pública  -> HTML/CSS/JS
Sistema      -> /sistema/ + Supabase Auth + Supabase DB
Portal       -> /portal/ + Supabase Auth + RLS
Credenciales -> /api/*.js con service role solo en servidor
```

## Componentes

### Frontend público

- `index.html`
- `styles.css`
- `script.js`

No depende de Supabase.

### Sistema interno

- `sistema/index.html`
- `sistema/app.js`
- `sistema/styles.css`

Usa Supabase Auth y consulta tablas protegidas por RLS.

### Portal

- `portal/index.html`
- `portal/app.js`
- `portal/styles.css`

Muestra únicamente información vinculada al paciente del usuario autenticado.

### API server-side

- `api/public-config.js`
- `api/create-user.js`
- `api/update-user-access.js`
- `api/init-demo-users.js`

Estas funciones corren en Vercel. Son necesarias porque la creación de usuarios de Supabase Auth requiere `SUPABASE_SERVICE_ROLE_KEY`.

### Supabase

- Auth: usuarios y sesiones.
- PostgreSQL: datos operativos.
- RLS: control de acceso.
- Storage: documentos clínicos privados.

## Roles usados

- `super_admin`
- `direction`
- `clinical_coordination`
- `medical`
- `psychologist`
- `social_worker`
- `therapeutic_operator`
- `professional`
- `admission`
- `finance`
- `auditor`
- `patient`
- `family`

## Regla de acceso sensible

- Dirección y coordinación clínica pueden ver operación completa.
- Profesionales ven módulos clínicos según rol.
- Auditoría controla operación y logs sin historia clínica ni documentos clínicos confidenciales.
- Pacientes/familiares solo ven portal y documentos liberados.
