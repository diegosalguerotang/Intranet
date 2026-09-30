-- supabase/respaldos/2026-09-30-correo-fallos-reversion.sql — deshace la migración del mismo nombre.
-- El cliente desplegado tolera la ausencia de la función (la franja no aparece).
begin;
drop function if exists public.correo_fallos_recientes();
commit;
