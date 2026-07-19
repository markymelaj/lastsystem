-- =============================================================
-- Fundación Senderos de Libertad - Limpieza de datos demo
-- Archivo 003_cleanup_demo.sql
-- Ejecutar cuando la fundación quiera partir con datos reales.
-- Retira todo lo marcado como is_demo y las cuentas de portal .demo.
-- No borra la organización, roles, permisos ni configuración base.
-- Requiere haber ejecutado 007_demo_reset.sql (define la función).
-- =============================================================

select public.cleanup_demo_data();

-- Nota: las cuentas de acceso de demostración en Supabase Auth
-- (direccion@, profesional@, paciente@ y auditoria@senderos.demo)
-- se eliminan desde Authentication > Users o desde /api/reset-demo.
-- Si cargó archivos demo en Storage, elimínelos de clinical-documents.
