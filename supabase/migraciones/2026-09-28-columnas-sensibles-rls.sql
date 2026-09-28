-- 2026-09-28 · RLS en interno.columnas_sensibles (corrección de seguridad,
-- pre-existente desde la fase 5: la tabla tenía los grants revocados de
-- public/anon/authenticated pero nunca activó row level security ni tuvo
-- política). scripts/verificar-fase4.mjs exige que toda tabla de public/interno
-- (salvo respaldo_%) tenga RLS activada, y que las tablas sin ninguna política
-- sean exactamente SIN_POLITICA de scripts/fase4-generar.mjs. Canónico:
-- supabase/auditoria.sql (línea junto al revoke de columnas_sensibles) + lista
-- SIN_POLITICA de scripts/fase4-generar.mjs (ahora incluye
-- "interno.columnas_sensibles"). Idempotente. Reversión: alter table
-- interno.columnas_sensibles disable row level security;
begin;
set local search_path = public, interno, extensions;

alter table interno.columnas_sensibles enable row level security;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'interno.columnas_sensibles'::regclass) then
    raise exception 'columnas_sensibles: RLS no quedó activada';
  end if;
  if has_table_privilege('authenticated', 'interno.columnas_sensibles', 'select') then
    raise exception 'columnas_sensibles: authenticated puede leerla';
  end if;
end $$;
commit;
