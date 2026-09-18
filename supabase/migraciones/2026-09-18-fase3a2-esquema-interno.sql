-- supabase/migraciones/2026-09-18-fase3a2-esquema-interno.sql
-- Corrección de seguridad · FASE 3a, paso 2 — ESQUEMA PRIVADO. GENERADA por
-- scripts/fase3-generar.mjs (la lista de tablas vive ahí; no editar a mano).
--
-- UNA transacción. Reversión: supabase/respaldos/2026-09-18-fase3a2-reversion.sql
-- (ensayo: scripts/ensayar-fase3a.mjs sobre el entorno de la fase 2.5).
-- Requiere fase3a1 aplicada Y api/*.js desplegado con las funciones de servicio.
--
-- Qué hace: crea el esquema interno (no publicado por PostgREST), mueve
-- 10 tablas, amplía el search_path de todas las funciones, re-califica
-- los cuerpos con esquema explícito y verifica.

begin;
set local search_path = public, extensions;

-- 0 · Precondición: fase3a1 aplicada (funciones de servicio) y esquema interno inexistente.
do $$
declare n int;
begin
  select count(*) into n from unnest(array['api_admin_por_correo(text, boolean)', 'api_admin_por_id(bigint)', 'api_admin_marcar_clave(bigint, text, boolean)', 'api_token_crear(text, text, text, text, timestamptz)', 'api_token_leer(text, text[])', 'api_token_usar(text)']) f where to_regprocedure('public.' || f) is not null;
  if n <> 6 then raise exception 'fase3a2: faltan funciones de servicio (fase3a1): %/6', n; end if;
  if exists (select 1 from pg_namespace where nspname = 'interno') then raise exception 'fase3a2: el esquema interno ya existe (¿fase 3a aplicada?)'; end if;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r' and c.relname in ('usuarios_admin', 'perfiles', 'perfil_permisos', 'perfil_empresas', 'perfil_propuestas', 'cargo_perfiles', 'registro_accesos', 'politica_acceso', 'auditoria', 'correo_tokens');
  if n <> 10 then raise exception 'fase3a2: se esperaban 10 tablas en public, hay %', n; end if;
end $$;

-- 1 · Esquema privado: existe, no lo publica PostgREST (db_schema = public, graphql_public)
--     y solo authenticated (vistas security_invoker) y service_role pueden resolver nombres en él.
create schema if not exists interno;
revoke all on schema interno from public, anon;
grant usage on schema interno to authenticated, service_role;

-- 2 · Mover las 10 tablas (datos, ACL, RLS, políticas, disparadores, índices y secuencias viajan con ellas).
alter table public.usuarios_admin set schema interno;
alter table public.perfiles set schema interno;
alter table public.perfil_permisos set schema interno;
alter table public.perfil_empresas set schema interno;
alter table public.perfil_propuestas set schema interno;
alter table public.cargo_perfiles set schema interno;
alter table public.registro_accesos set schema interno;
alter table public.politica_acceso set schema interno;
alter table public.auditoria set schema interno;
alter table public.correo_tokens set schema interno;

-- 3 · search_path de TODAS las funciones de public: 'public, interno, …'.
do $$
declare r record; actual text; nuevo text;
begin
  for r in select p.oid::regprocedure as firma, p.proconfig as cfg
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'
  loop
    select substr(c, length('search_path=') + 1) into actual from unnest(coalesce(r.cfg, '{}')) c where c like 'search_path=%' limit 1;
    if actual is not null and actual like '%interno%' then continue; end if;
    nuevo := case when actual is null then 'public, interno, extensions'
                  when actual ~ '^\s*public\s*,' then regexp_replace(actual, '^\s*public\s*,', 'public, interno,')
                  else 'public, interno, ' || actual end;
    execute format('alter function %s set search_path = %s', r.firma, nuevo);
  end loop;
end $$;

-- 3b · Cuerpos que nombran las tablas con esquema explícito (public.usuarios_admin…)
--      no resuelven por search_path: se re-crean con interno.<tabla> (permisos y dueño se conservan).
do $$
declare r record;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f'
              and p.prosrc ~ '\mpublic\.(usuarios_admin|perfiles|perfil_permisos|perfil_empresas|perfil_propuestas|cargo_perfiles|registro_accesos|politica_acceso|auditoria|correo_tokens)\M'
  loop
    execute regexp_replace(pg_get_functiondef(r.oid), '\mpublic\.(usuarios_admin|perfiles|perfil_permisos|perfil_empresas|perfil_propuestas|cargo_perfiles|registro_accesos|politica_acceso|auditoria|correo_tokens)\M', 'interno.\1', 'g');
  end loop;
end $$;

-- 4 · Verificación embebida (falla → rollback de toda la transacción).
do $$
declare n int; l text;
begin
  select string_agg(c.relname, ',' order by c.relname) into l from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'interno' and c.relkind = 'r';
  if l is distinct from 'auditoria,cargo_perfiles,correo_tokens,perfil_empresas,perfil_permisos,perfil_propuestas,perfiles,politica_acceso,registro_accesos,usuarios_admin' then raise exception 'fase3a2: tablas en interno distintas de las esperadas: %', l; end if;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r' and c.relname in ('usuarios_admin', 'perfiles', 'perfil_permisos', 'perfil_empresas', 'perfil_propuestas', 'cargo_perfiles', 'registro_accesos', 'politica_acceso', 'auditoria', 'correo_tokens');
  if n <> 0 then raise exception 'fase3a2: % tablas siguen en public', n; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prokind = 'f'
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%' and c like '%interno%');
  if n <> 0 then raise exception 'fase3a2: % funciones de public sin interno en search_path', n; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prokind = 'f' and p.prosrc ~ '\mpublic\.(usuarios_admin|perfiles|perfil_permisos|perfil_empresas|perfil_propuestas|cargo_perfiles|registro_accesos|politica_acceso|auditoria|correo_tokens)\M';
  if n <> 0 then raise exception 'fase3a2: % funciones siguen nombrando public.<tabla movida>', n; end if;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'interno' and c.relkind = 'r' and not c.relrowsecurity;
  if n <> 0 then raise exception 'fase3a2: % tablas de interno sin RLS', n; end if;
  select count(*) into n from pg_policies where schemaname = 'interno' and policyname = 'lectura_admin';
  if n <> 9 then raise exception 'fase3a2: % políticas lectura_admin en interno, esperadas 9', n; end if;
  if has_schema_privilege('anon', 'interno', 'usage') then raise exception 'fase3a2: anon tiene USAGE en interno'; end if;
  if not has_schema_privilege('authenticated', 'interno', 'usage') or not has_schema_privilege('service_role', 'interno', 'usage') then
    raise exception 'fase3a2: authenticated/service_role sin USAGE en interno'; end if;
  select count(*) into n from unnest(array['api_admin_por_correo(text, boolean)', 'api_admin_por_id(bigint)', 'api_admin_marcar_clave(bigint, text, boolean)', 'api_token_crear(text, text, text, text, timestamptz)', 'api_token_leer(text, text[])', 'api_token_usar(text)']) f
   where has_function_privilege('authenticated', ('public.' || f)::regprocedure, 'execute')
      or has_function_privilege('anon', ('public.' || f)::regprocedure, 'execute')
      or not has_function_privilege('service_role', ('public.' || f)::regprocedure, 'execute');
  if n <> 0 then raise exception 'fase3a: % funciones de servicio con permisos incorrectos', n; end if;
  -- Las 9 vistas que dependen de las tablas movidas siguen vivas.
  perform count(*) from public.v_usuarios_admin;
  perform count(*) from public.v_perfiles;
  perform count(*) from public.v_perfil_versiones;
  perform count(*) from public.v_registro_accesos;
  perform count(*) from public.v_politica_acceso;
  perform count(*) from public.v_mi_acceso;
  perform count(*) from public.v_cargo_perfiles;
  perform count(*) from public.v_perfil_propuestas;
  perform count(*) from public.v_actividad_persona;
  -- Comportamiento: sin identidad, nada; el login anónimo sigue resolviendo (lee interno vía definer);
  -- la función de servicio resuelve la tabla movida.
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"nadie@ejemplo.invalido","sub":"00000000-0000-0000-0000-000000000000"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.v_usuarios_admin;
  if n <> 0 then execute 'reset role'; raise exception 'fase3a2: v_usuarios_admin devolvió % filas a una sesión sin identidad', n; end if;
  if public.es_admin() then execute 'reset role'; raise exception 'fase3a2: es_admin() verdadero sin identidad'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  perform public.verificar_bloqueo('nadie@ejemplo.invalido');
  execute 'reset role';
  perform public.api_admin_por_correo('nadie@ejemplo.invalido', true);
end $$;
commit;
