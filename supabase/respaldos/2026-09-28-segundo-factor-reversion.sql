-- supabase/respaldos/2026-09-28-segundo-factor-reversion.sql
-- Reversión del segundo factor: retira funciones y tablas nuevas, restaura
-- fn_nivel_modulo (v3) y guardar_politica (firma vieja) desde
-- interno.respaldo_factor —cuerpo Y el EXECUTE que cada una tenía, leído del
-- ACL respaldado ('acl:…'), no asumido— devuelve v_politica_acceso a su
-- definición anterior y quita la columna del interruptor.
begin;
set local search_path = public, interno, extensions;
drop function if exists public.fn_factor_pendiente();
drop function if exists public.mi_segundo_factor();
drop function if exists public.api_factor_emitir(text, uuid, text, text, text);
drop function if exists public.api_factor_verificar(text, uuid, text, text, text);
drop function if exists public.api_factor_dispositivo_crear(text, uuid, text, text, text);
drop function if exists public.api_factor_dispositivo_usar(text, uuid, text, text, text);
drop function if exists public.api_factor_dispositivos_revocar(text);
drop function if exists public.guardar_politica(integer, integer, boolean, boolean, integer, integer, text, integer, integer, integer, text, boolean);
do $$ declare r record; v_fn text; v_acl text; begin
  for r in select objeto, definicion from interno.respaldo_factor where objeto like 'fn:%' loop
    execute r.definicion;
    v_fn := substring(r.objeto from 4);
    select definicion into v_acl from interno.respaldo_factor where objeto = 'acl:' || v_fn;
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
    if v_acl ~ 'anon=' then execute format('grant execute on function %s to anon', v_fn); end if;
    if v_acl ~ 'authenticated=' then execute format('grant execute on function %s to authenticated', v_fn); end if;
    if v_acl ~ 'service_role=' then execute format('grant execute on function %s to service_role', v_fn); end if;
  end loop;
end $$;
drop view if exists public.v_politica_acceso;
alter table interno.politica_acceso drop column if exists factor_superadmin;
do $$ declare r record; begin
  select definicion into r from interno.respaldo_factor where objeto = 'view:v_politica_acceso';
  execute 'create view public.v_politica_acceso with (security_invoker = on) as ' || r.definicion;
end $$;
revoke all on public.v_politica_acceso from anon, public;
grant select on public.v_politica_acceso to authenticated, service_role;
drop table if exists interno.factor_codigos, interno.factor_sesiones, interno.dispositivos_confiables;
drop table interno.respaldo_factor;
do $$ begin
  if to_regclass('interno.factor_sesiones') is not null then raise exception 'reversión factor: factor_sesiones sigue existiendo'; end if;
  if (select prosrc from pg_proc where oid = 'public.fn_nivel_modulo(text)'::regprocedure) ~ 'fn_factor_pendiente' then raise exception 'reversión factor: fn_nivel_modulo sigue en v4'; end if;
  if to_regprocedure('public.guardar_politica(integer, integer, boolean, boolean, integer, integer, text, integer, integer, integer, text)') is null then raise exception 'reversión factor: guardar_politica vieja no volvió'; end if;
  if to_regprocedure('public.mi_segundo_factor()') is not null then raise exception 'reversión factor: mi_segundo_factor sigue existiendo'; end if;
end $$;
commit;
