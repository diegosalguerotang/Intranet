-- supabase/migraciones/2026-09-17-fase1-cimiento.sql
-- Corrección de seguridad · FASE 1 — CIMIENTO. GENERADA por
-- scripts/fase1-generar.mjs a partir de supabase/fase1-plantilla.sql y de los
-- canónicos (schema.sql / accesos.sql) con la guarda ya insertada. No editar a
-- mano: cambiar la plantilla o la tabla GUARDAS y regenerar.
--
-- UNA transacción. Reversión: supabase/respaldos/2026-09-17-fase1-reversion.sql
-- (ensayo: scripts/ensayar-fase1.mjs). Requiere la fase 0 y 0b aplicadas.
--
-- Qué hace:
--  1. Guarda central (SECURITY DEFINER, STABLE, search_path fijo): correo_llamador(),
--     es_admin(), es_superadmin(), nivel_en(modulo), requiere_nivel(modulo, nivel
--     [, modulo_alternativo]), requiere_superadmin(), requiere_correo_propio(correo).
--     Los requiere_* lanzan insufficient_privilege (42501). Identidad por PETICIÓN
--     (opción B): correo del JWT → usuarios_admin activo → categoría vigente.
--  2. Re-crea las 26 funciones administrativas que no verificaban al llamador con
--     la guarda como PRIMERA instrucción del cuerpo. Las que crean accesos o
--     designan roles exigen requiere_superadmin(); marcar_clave_cambiada solo
--     sobre la propia cuenta; el resto requiere_nivel(modulo, nivel).
--  3. Re-fija search_path en toda security definer (create or replace lo borra).
--  4. Elimina la sobrecarga huérfana asignar_activo(text,text,text).
--  5. GRANT EXECUTE explícito y listado a authenticated (25 administrativas +
--     es_admin/es_superadmin/nivel_en). eliminar_usuario_admin NO se concede:
--     solo la llama api/admin-usuarios.js con la llave de servicio.
--  6. ALTER DEFAULT PRIVILEGES: una función nueva nace sin EXECUTE para authenticated.
--  7. Verificación embebida: listas exactas, 0 definers sin search_path, ninguna
--     función ejecutable por authenticated sin guarda (salvo la lista explícita).
-- Restituye lo que la fase 0 dejó inoperativo: crear/editar usuarios y
-- categorías (solo superadmin), alta/baja de trabajador, publicar boletas y
-- comunicados, EPP, activos TI, sedes y memorándums.

begin;
set local search_path = public, extensions;

-- 0 · Precondición: fase 0 + 0b aplicadas.
do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute');
  if n <> 62 then raise exception 'fase1: se esperaba la base en estado de fase 0 (62 firmas ejecutables por authenticated, hay %)', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and policyname = 'solo_admin';
  if n <> 5 then raise exception 'fase1: se esperaban 5 políticas solo_admin (fase 0b), hay %', n; end if;
end $$;

-- 1 · Guarda central ---------------------------------------------------------
create or replace function correo_llamador() returns text
language sql stable security definer set search_path = public, extensions as $$
  select nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '')
$$;
comment on function correo_llamador() is 'Correo del JWT de la petición en minúsculas; null sin sesión.';

create or replace function nivel_en(p_modulo text) returns int
language sql stable security definer set search_path = public, extensions as $$
  select fn_nivel_modulo(p_modulo)
$$;
comment on function nivel_en(text) is 'Nivel del llamador en el módulo (0..3; 99 = superadmin o rol de servicio sin JWT). Misma regla que fn_nivel_modulo.';

create or replace function es_superadmin() returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select nivel_en('accesos') >= 99
$$;

create or replace function es_admin() returns boolean
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if correo_llamador() is null then return es_superadmin(); end if;  -- postgres / service_role sin JWT
  return exists (select 1 from usuarios_admin u where lower(u.correo) = correo_llamador() and u.estado = 'activo');
end $$;

create or replace function requiere_nivel(p_modulo text, p_nivel int, p_modulo_alt text default null) returns void
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if nivel_en(p_modulo) >= p_nivel then return; end if;
  if p_modulo_alt is not null and nivel_en(p_modulo_alt) >= p_nivel then return; end if;
  raise insufficient_privilege using message = format('Permiso insuficiente: requiere nivel %s en %s%s.',
    p_nivel, p_modulo, case when p_modulo_alt is null then '' else ' o en ' || p_modulo_alt end);
end $$;

create or replace function requiere_superadmin() returns void
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not es_superadmin() then
    raise insufficient_privilege using message = 'Permiso insuficiente: solo un superadministrador puede hacerlo.';
  end if;
end $$;

create or replace function requiere_correo_propio(p_correo text) returns void
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not es_admin() or lower(coalesce(p_correo, '')) is distinct from correo_llamador() then
    raise insufficient_privilege using message = 'Permiso insuficiente: solo sobre la propia cuenta.';
  end if;
end $$;

revoke all on function correo_llamador(), nivel_en(text), es_superadmin(), es_admin(),
  requiere_nivel(text, int, text), requiere_superadmin(), requiere_correo_propio(text) from public, anon, authenticated;

-- 2 · Funciones administrativas con la guarda insertada ----------------------
-- @@BLOQUES@@

-- 3 · search_path fijo en toda security definer (create or replace lo borra).
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as firma from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef
              and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
  loop execute format('alter function %s set search_path = public, extensions', r.firma); end loop;
end $$;

-- 4 · Sobrecarga huérfana (anterior a gestión TI del 19-08; sin uso).
drop function if exists asignar_activo(text, text, text);

-- 5 · GRANT explícito y listado.
-- @@GRANTS@@
grant execute on function es_admin(), es_superadmin(), nivel_en(text) to authenticated;
grant execute on function correo_llamador(), requiere_nivel(text, int, text), requiere_superadmin(), requiere_correo_propio(text),
  es_admin(), es_superadmin(), nivel_en(text) to service_role;

-- 6 · Una función nueva nace sin EXECUTE para nadie salvo su dueño y service_role.
--     PostgreSQL FUSIONA el default del esquema con el global (o el incorporado,
--     que concede EXECUTE a PUBLIC): el cierre del 14-09 solo tocó el esquema y
--     por eso toda función nueva seguía naciendo ejecutable por PUBLIC. Hace
--     falta también la entrada GLOBAL.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from public, authenticated, anon;

-- 7 · Verificación embebida.
do $$
declare lista text; n int;
  esperadas constant text := '@@ESPERADAS@@';
  sin_guarda constant text[] := array['verificar_bloqueo', 'registrar_ingreso', 'portal_verificar_bloqueo', 'portal_registrar_ingreso',
                                      'fn_hora_entrada', 'portal_modo', 'es_admin', 'es_superadmin', 'nivel_en'];
begin
  select string_agg(p.proname, ',' order by p.proname) into lista
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
  if lista is distinct from 'portal_registrar_ingreso,portal_verificar_bloqueo,registrar_ingreso,verificar_bloqueo' then
    raise exception 'fase1: funciones ejecutables por anon = %', coalesce(lista, '(ninguna)');
  end if;
  select string_agg(distinct p.proname, ',' order by p.proname) into lista
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute');
  if lista is distinct from esperadas then
    raise exception 'fase1: la lista de funciones ejecutables por authenticated no es la esperada: %', coalesce(lista, '(ninguna)');
  end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute');
  if n <> @@N_ESPERADAS@@ then raise exception 'fase1: % firmas ejecutables por authenticated, esperadas @@N_ESPERADAS@@ (¿sobrecarga?)', n; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prosecdef
     and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'));
  if n > 0 then raise exception 'fase1: % security definer sin search_path', n; end if;
  -- Ninguna función ejecutable por authenticated sin verificación del llamador.
  select string_agg(p.proname, ',' order by p.proname) into lista
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
     and not (p.proname = any(sin_guarda))
     and p.prosrc !~ '(requiere_nivel|requiere_superadmin|requiere_correo_propio|fn_nivel_modulo|fn_nivel_memorandums|portal_dni|fn_persona_llamador|es_admin_activo|auth\.(uid|jwt)|importar_control|importar_padron|importar_planilla_unificada|fn_ver_cuenta_bancaria)';
  if lista is not null then raise exception 'fase1: funciones ejecutables por authenticated SIN guarda: %', lista; end if;
  -- Prueba de comportamiento: una función recién creada no la ejecuta nadie de la API.
  execute 'create function public.zz_fase1_nacimiento() returns int language sql as $f$ select 1 $f$';
  if has_function_privilege('authenticated', 'public.zz_fase1_nacimiento()', 'execute')
     or has_function_privilege('anon', 'public.zz_fase1_nacimiento()', 'execute') then
    execute 'drop function public.zz_fase1_nacimiento()';
    raise exception 'fase1: una función nueva sigue naciendo ejecutable por authenticated/anon (default privileges)';
  end if;
  if not has_function_privilege('service_role', 'public.zz_fase1_nacimiento()', 'execute') then
    execute 'drop function public.zz_fase1_nacimiento()';
    raise exception 'fase1: service_role perdió el EXECUTE por defecto';
  end if;
  execute 'drop function public.zz_fase1_nacimiento()';
  if exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
             where s.nspname = 'public' and p.oid::regprocedure::text = 'asignar_activo(text,text,text)') then
    raise exception 'fase1: la sobrecarga huérfana asignar_activo(text,text,text) sigue existiendo';
  end if;
end $$;

commit;
