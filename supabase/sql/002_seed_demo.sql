-- =============================================================
-- Fundación Senderos de Libertad - Datos de ejemplo (base)
-- Archivo 002_seed_demo.sql
--
-- La carga completa de la demostración (equipo, personas acompañadas,
-- agenda, historia clínica, documentos y finanzas) se realiza desde
-- 007_demo_reset.sql mediante la función public.seed_demo_data(), que
-- necesita las tablas creadas en 004. Este archivo solo deja lista la
-- ficha de la organización para quienes ejecutan 001 y 002 de entrada.
--
-- Orden recomendado de instalación:
--   001_schema.sql
--   002_seed_demo.sql            (este archivo, opcional)
--   004_operational_hardening.sql
--   005_finalize_hardening.sql
--   006_portal_document_scopes.sql
--   007_demo_reset.sql           (carga la demo completa)
-- =============================================================

insert into public.organizations(name, legal_name, cuit, activity, address, city, province, country, is_demo)
values('Fundación Senderos de Libertad','Fundación Senderos de Libertad','30-71928002-8','Servicios relacionados con la salud humana n.c.p.','República de Siria 115, Piso 2','Mendoza','Mendoza','Argentina', false)
on conflict(cuit) do update set name=excluded.name, legal_name=excluded.legal_name, activity=excluded.activity, address=excluded.address, city=excluded.city, province=excluded.province;
