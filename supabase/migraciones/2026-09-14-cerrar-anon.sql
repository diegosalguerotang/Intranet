-- supabase/migraciones/2026-09-14-cerrar-anon.sql
-- Hardening de acceso · Fase 1: cerrar el rol anónimo (spec
-- docs/superpowers/specs/2026-09-14-cerrar-anon-design.md). Idempotente.
-- Desplegar DESPUÉS del frontend que carga datos tras la sesión.
--
-- Rollback (solo para volver al estado de demostración; NUNCA reabrir las
-- funciones de cifrado):
--   grant select on all tables in schema public to anon;
--   grant execute on all functions in schema public to anon;
--   revoke all on function fn_clave_cuentas(), fn_cifrar_cuenta(text),
--     fn_descifrar_cuenta(bytea), fn_cabecera(text) from public, anon, authenticated;
--   alter default privileges for role postgres in schema public grant all on tables to anon;
--   alter default privileges for role postgres in schema public grant all on sequences to anon;
--   alter default privileges for role postgres in schema public grant all on functions to anon;
--   y recrear acceso_demo con "to anon, authenticated".

begin;

set local search_path = public, extensions;

-- 1 · Revocar a anon todo lo existente (tablas y vistas, secuencias, funciones).
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- 1b · Funciones que anon aún ejecuta por herencia de PUBLIC: se cierra PUBLIC
--      y se conserva explícitamente lo que ya tenían authenticated/service_role.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('revoke all on function %s from public', f.fn);
    execute format('grant execute on function %s to authenticated, service_role', f.fn);
  end loop;
end $$;

-- fn_cabecera: las cabeceras son evidencia, no entrada del usuario (2026-08-26);
-- el bucle 1b la habría reabierto a authenticated por venir de PUBLIC.
revoke all on function fn_cabecera(text) from public, anon, authenticated;

-- 2 · Privilegios por defecto: lo nuevo nace cerrado para anon.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;
-- Las funciones nuevas heredan EXECUTE de PUBLIC por el default interno de
-- Postgres (los defaults por esquema se FUSIONAN con él): hay que cerrarlo
-- también. Lo nuevo queda para postgres/authenticated/service_role.
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public grant execute on functions to authenticated, service_role;
do $$
begin
  -- supabase_admin también tiene default ACL; postgres no siempre puede tocarla.
  alter default privileges for role supabase_admin in schema public revoke all on tables from anon;
  alter default privileges for role supabase_admin in schema public revoke all on sequences from anon;
  alter default privileges for role supabase_admin in schema public revoke all on functions from anon;
  alter default privileges for role supabase_admin in schema public revoke execute on functions from public;
exception when insufficient_privilege then
  raise notice 'default privileges de supabase_admin no modificables desde este rol (sin efecto: los objetos los crea postgres)';
end $$;

-- 3 · acceso_demo queda solo para authenticated (fase 2 la sustituye por RLS real).
do $$
declare t text;
begin
  for t in select tablename from pg_policies where schemaname = 'public' and policyname = 'acceso_demo' loop
    execute format('drop policy acceso_demo on %I', t);
    execute format('create policy acceso_demo on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- 4 · fn_nivel_modulo v3: sin JWT, solo postgres/service_role son 99; anon es 0.
create or replace function fn_nivel_modulo(p_modulo text)
returns int language plpgsql stable security definer set search_path = public, extensions as $$
declare v_correo text; v_nivel int; v_rol text;
begin
  begin
    v_correo := nullif(auth.jwt() ->> 'email', '');
  exception when others then
    v_correo := null;
  end;
  if v_correo is null then
    -- Dentro de un security definer current_user es el dueño; el rol real
    -- viene en los claims de PostgREST o, sin ellos (Management API), en
    -- session_user.
    v_rol := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', session_user::text);
    if v_rol in ('postgres', 'service_role', 'supabase_admin') then return 99; end if;
    return 0;
  end if;
  select case when p.es_superadmin then 99
              else coalesce((select pp.nivel from perfil_permisos pp
                             where pp.perfil_id = u.perfil_id
                               and pp.perfil_version = u.perfil_version
                               and pp.modulo = p_modulo), 0) end
  into v_nivel
  from usuarios_admin u
  join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
  where lower(u.correo) = lower(v_correo) and u.estado = 'activo';
  return coalesce(v_nivel, 0);
end $$;

-- 5 · Solo las 4 RPCs de login siguen abiertas a anon.
grant execute on function verificar_bloqueo(text) to anon;
grant execute on function registrar_ingreso(text, text, text) to anon;
grant execute on function portal_verificar_bloqueo(text) to anon;
grant execute on function portal_registrar_ingreso(text, text, text) to anon;

-- Único frente anónimo: fijar search_path (convención 2026-08-24).
alter function verificar_bloqueo(text) set search_path = public, extensions;
alter function registrar_ingreso(text, text, text) set search_path = public, extensions;
alter function portal_verificar_bloqueo(text) set search_path = public, extensions;
alter function portal_registrar_ingreso(text, text, text) set search_path = public, extensions;

-- 6 · Verificación embebida: si algo quedó abierto, la migración no se aplica.
do $$
declare n int; lista text;
begin
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind in ('r', 'v') and has_table_privilege('anon', c.oid, 'select');
  if n > 0 then raise exception 'cerrar-anon: % tablas/vistas siguen legibles por anon', n; end if;
  select string_agg(p.proname, ',' order by p.proname) into lista
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
  if lista is distinct from 'portal_registrar_ingreso,portal_verificar_bloqueo,registrar_ingreso,verificar_bloqueo' then
    raise exception 'cerrar-anon: funciones ejecutables por anon = %', coalesce(lista, '(ninguna)');
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and policyname = 'acceso_demo' and 'anon' = any(roles);
  if n > 0 then raise exception 'cerrar-anon: % políticas acceso_demo siguen incluyendo a anon', n; end if;
  -- Solo public y los defaults globales: los de storage/graphql son de la
  -- plataforma Supabase y no se tocan.
  select count(*) into n from pg_default_acl
   where defaclrole = 'postgres'::regrole
     and (defaclnamespace = 'public'::regnamespace or defaclnamespace = 0)
     and defaclacl::text like '%anon=%';
  if n > 0 then raise exception 'cerrar-anon: % default ACL de postgres (public o global) siguen incluyendo a anon', n; end if;
  select count(*) into n from pg_default_acl
   where defaclnamespace = 'public'::regnamespace and defaclrole = 'postgres'::regrole
     and defaclobjtype = 'f' and defaclacl::text ~ '[{,]=X/';
  if n > 0 then raise exception 'cerrar-anon: los privilegios por defecto de postgres en functions siguen abiertos a PUBLIC'; end if;
end $$;

commit;
