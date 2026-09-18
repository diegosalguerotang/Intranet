-- supabase/respaldos/2026-09-18-fase3c-reversion.sql
-- Reversión completa de la FASE 3c (GENERADA por scripts/fase3c-generar.mjs):
-- vuelve activos.clave_equipo (vacía: nunca hubo claves), definiciones
-- originales de las funciones y de v_activos desde el respaldo, y se retira
-- clave_gestor (la referencia se pierde; anotar antes si hace falta).
begin;
set local search_path = public, interno, extensions;

alter table activos add column if not exists clave_equipo text;
-- La vista original tiene una columna menos: «create or replace» no puede quitar
-- columnas, así que se recrea (y se devuelven sus permisos: todo a authenticated
-- y service_role, como el resto de vistas de public).
drop view public.v_activos;
do $$
declare r record;
begin
  for r in select definicion from interno.respaldo_fase3c where objeto like 'view:%' loop execute r.definicion; end loop;
  for r in select definicion from interno.respaldo_fase3c where objeto like 'fn:%' order by objeto loop execute r.definicion; end loop;
end $$;
alter view v_activos set (security_invoker = on);
grant all on public.v_activos to authenticated, service_role;
alter table activos drop column if exists clave_gestor;
drop table interno.respaldo_fase3c;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'activos' and column_name = 'clave_equipo') then
    raise exception 'reversión fase3c: falta clave_equipo'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'v_activos' and column_name = 'clave_gestor') then
    raise exception 'reversión fase3c: v_activos sigue exponiendo clave_gestor'; end if;
end $$;
commit;
