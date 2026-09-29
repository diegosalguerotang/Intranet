-- supabase/respaldos/2026-09-29-licencias-office-reversion.sql — deshace la migración del mismo nombre.
-- Borra las licencias y sus afiliaciones (no toca el padrón). El cliente desplegado
-- tolera la ausencia de la fuente v_licencias_office (la lista queda vacía).
begin;
set local search_path = public, interno, extensions;
drop view if exists v_licencias_office;
drop function if exists guardar_licencia_office(bigint, text, text, text);
drop function if exists afiliar_licencia_office(bigint, text, text, bigint);
drop function if exists desafiliar_licencia_office(bigint);
drop table if exists licencias_office_personas;
drop table if exists licencias_office;
commit;
