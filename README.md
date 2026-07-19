# Senderos de Libertad — sistema operativo

Sistema clínico-administrativo y portal seguro para pacientes y familiares autorizados.

## Componentes

- `/`: sitio institucional.
- `/sistema/`: operación interna, agenda, historia clínica, documentos, pagos, usuarios, comunicados y auditoría.
- `/portal/`: turnos, documentos liberados, carga de documentación solicitada, solicitudes y comunicados.
- `/api/`: provisión segura de cuentas, descarga auditada, revisión de documentos y comunicaciones.
- `/supabase/sql/`: esquema base y migraciones operativas.

## Instalación

1. Copiar `.env.example` a `.env.local` y completar las credenciales de Supabase.
2. Ejecutar en orden `001_schema.sql`, `002_seed_demo.sql`, `004_operational_hardening.sql`, `005_finalize_hardening.sql`, `006_portal_document_scopes.sql` y `007_demo_reset.sql` (este último carga la demo completa).
3. Provisionar el primer administrador según `docs/OPERACION_PRODUCCION.md`.
4. Para producción: ejecutar `003_cleanup_demo.sql` si hubo demo (retira los datos de ejemplo), eliminar las cuentas `@senderos.demo`, desactivar `ENABLE_DEMO_SETUP` y eliminar `BOOTSTRAP_ADMIN_TOKEN`. Dirección puede volver la demo al estado inicial con el botón **Restaurar demo**.

## Verificación

`npm run check` valida la sintaxis de todas las pantallas y APIs.

## Operación

La guía completa, roles, agenda, documentos, pagos, comunicaciones y preparación para Google Calendar está en `docs/OPERACION_PRODUCCION.md`.
