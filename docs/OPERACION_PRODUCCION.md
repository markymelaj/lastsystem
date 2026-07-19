# Operación segura de Senderos

## Instalación

Ejecutar, en este orden, los SQL `001_schema.sql`, `002_seed_demo.sql`, `004_operational_hardening.sql`, `005_finalize_hardening.sql`, `006_portal_document_scopes.sql` y `007_demo_reset.sql`. El archivo `007` define las funciones de demostración y carga los datos de ejemplo (incluidas las finanzas). En producción, limpiar la demo con `003_cleanup_demo.sql`, eliminar las cuentas `@senderos.demo` y dejar `ENABLE_DEMO_SETUP=false`. Dirección puede restaurar la demo al estado inicial con el botón **Restaurar demo** (endpoint `/api/reset-demo`, disponible solo fuera de producción).

## Primer administrador

La interfaz ya no crea administradores desde una sesión de navegador. Configurar transitoriamente `BOOTSTRAP_ADMIN_TOKEN` y llamar una única vez a `POST /api/bootstrap-admin` con ese valor en `x-bootstrap-token`. Eliminar la variable al finalizar.

## Roles y familias

Las cuentas internas, de paciente y de familiar están separadas. Una cuenta familiar requiere una o varias autorizaciones vigentes asociadas a contactos autorizados y jamás puede ser de auditoría. Los permisos se limitan por paciente y alcance: perfil, turnos, comunicaciones, carga de archivos y documentos liberados.

## Agenda y Calendar

Primero cargar disponibilidad por profesional. La base bloquea solapamientos de profesional y sala, además de bloqueos manuales, licencias y reuniones. La zona horaria institucional es `America/Argentina/Mendoza`.

Google Calendar queda preparado mediante `calendar_connections` y `calendar_sync_outbox`. El sistema sigue siendo la fuente de verdad; no habilitar OAuth ni guardar tokens sin cifrado de servidor, y no sincronizar datos clínicos.

## Documentos, pagos y comunicados

Los archivos de pacientes/familiares llegan a `portal-submissions` y deben aprobarse antes de pasar al legajo clínico. Los pagos manuales usan cargos, abonos, saldo y auditoría; no se borran, se revierten. Los comunicados tienen destinatarios y confirmación de lectura; el canal email queda en cola hasta integrar un proveedor transaccional.

## Checklist

- Desactivar demo y eliminar `BOOTSTRAP_ADMIN_TOKEN`.
- Configurar MFA para cuentas internas y backups.
- Probar un turno solapado, un bloqueo y un cambio de estado.
- Probar autorización familiar, carga/aprobación de documento y descarga autorizada.
- Probar cargo, pago parcial y comunicado.
