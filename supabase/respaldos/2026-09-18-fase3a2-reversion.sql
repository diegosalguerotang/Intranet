-- supabase/respaldos/2026-09-18-fase3a2-reversion.sql
-- Reversión del paso 2 de la FASE 3a (GENERADA por scripts/fase3-generar.mjs):
-- tablas de vuelta a public, search_path y cuerpos como antes, sin esquema
-- interno. Las funciones de servicio siguen (las quita fase3a1-reversion.sql).
begin;
set local search_path = public, extensions;

alter table interno.usuarios_admin set schema public;
alter table interno.perfiles set schema public;
alter table interno.perfil_permisos set schema public;
alter table interno.perfil_empresas set schema public;
alter table interno.perfil_propuestas set schema public;
alter table interno.cargo_perfiles set schema public;
alter table interno.registro_accesos set schema public;
alter table interno.politica_acceso set schema public;
alter table interno.auditoria set schema public;
alter table interno.correo_tokens set schema public;

do $$
declare r record; actual text; nuevo text;
begin
  for r in select p.oid::regprocedure as firma, p.proconfig as cfg
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'
  loop
    select substr(c, length('search_path=') + 1) into actual from unnest(coalesce(r.cfg, '{}')) c where c like 'search_path=%' limit 1;
    if actual is null or actual not like '%interno%' then continue; end if;
    nuevo := regexp_replace(actual, ',\s*interno\s*', '', 'g');
    execute format('alter function %s set search_path = %s', r.firma, nuevo);
  end loop;
end $$;
-- Las funciones que no fijaban search_path antes de la fase 3a (disparadores y
-- auxiliares) quedan con 'public, extensions': más estricto que antes, mismo
-- comportamiento; la foto del ensayo lo normaliza explícitamente.

-- Cuerpos re-calificados en la fase 3a: vuelven a nombrar public.<tabla>.
do $$
declare r record;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f'
              and p.prosrc ~ '\minterno\.(usuarios_admin|perfiles|perfil_permisos|perfil_empresas|perfil_propuestas|cargo_perfiles|registro_accesos|politica_acceso|auditoria|correo_tokens)\M'
  loop
    execute regexp_replace(pg_get_functiondef(r.oid), '\minterno\.(usuarios_admin|perfiles|perfil_permisos|perfil_empresas|perfil_propuestas|cargo_perfiles|registro_accesos|politica_acceso|auditoria|correo_tokens)\M', 'public.\1', 'g');
  end loop;
end $$;

drop schema interno;

do $$
declare n int;
begin
  if exists (select 1 from pg_namespace where nspname = 'interno') then raise exception 'reversión fase3a2: el esquema sigue'; end if;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r' and c.relname in ('usuarios_admin', 'perfiles', 'perfil_permisos', 'perfil_empresas', 'perfil_propuestas', 'cargo_perfiles', 'registro_accesos', 'politica_acceso', 'auditoria', 'correo_tokens');
  if n <> 10 then raise exception 'reversión fase3a2: % tablas en public, esperadas 10', n; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%' and c like '%interno%');
  if n <> 0 then raise exception 'reversión fase3a2: % funciones aún con interno en search_path', n; end if;
end $$;
commit;
