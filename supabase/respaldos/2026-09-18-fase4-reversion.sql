-- supabase/respaldos/2026-09-18-fase4-reversion.sql
-- Reversión completa de la FASE 4 (GENERADA por scripts/fase4-generar.mjs):
-- quita las políticas nuevas, recrea EXACTAMENTE las anteriores desde
-- interno.respaldo_fase4, devuelve las 9 vistas del Portal a dueño y retira
-- los ayudantes.
begin;
set local search_path = public, interno, extensions;

do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
            where (schemaname in ('public', 'interno') and policyname in ('adm_lectura', 'adm_escritura', 'propio', 'sesion'))
               or (schemaname = 'storage' and policyname in ('documentos_leer', 'documentos_subir', 'documentos_actualizar'))
  loop execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename); end loop;
  for r in select * from interno.respaldo_fase4 loop
    execute format('create policy %I on %I.%I as %s for %s to %s %s %s',
      r.politica, r.esquema, r.tabla, r.permisiva, r.cmd,
      array_to_string(r.roles, ', '),
      case when r.qual is not null then 'using (' || r.qual || ')' else '' end,
      case when r.with_check is not null then 'with check (' || r.with_check || ')' else '' end);
  end loop;
end $$;
alter view public.v_portal_boletas reset (security_invoker);
alter view public.v_portal_comunicados reset (security_invoker);
alter view public.v_portal_datos reset (security_invoker);
alter view public.v_portal_mes reset (security_invoker);
alter view public.v_portal_pendientes reset (security_invoker);
alter view public.v_portal_perfil reset (security_invoker);
alter view public.v_portal_rit reset (security_invoker);
alter view public.v_portal_solicitudes reset (security_invoker);
alter view public.v_portal_tickets reset (security_invoker);
drop function if exists public.fn_alcance_empresa(text), public.fn_alcance_persona(text), public.fn_alcance_vinculo(bigint), public.fn_alcance_documento(bigint), public.fn_alcance_memorandum(text), public.fn_alcance_activo(text), public.fn_alcance_solicitud(bigint), public.fn_es_mi_dni(text), public.fn_mi_vinculo(bigint), public.fn_mi_solicitud(bigint), public.fn_comunicado_me_alcanza(bigint), public.fn_mi_sede(text), public.fn_mi_perfil(text, integer), public.fn_dni_auditoria(jsonb, jsonb);
revoke execute on function correo_llamador() from authenticated;
drop table interno.respaldo_fase4;

do $$
declare n int;
begin
  select count(*) into n from pg_policies where schemaname in ('public', 'interno') and policyname = 'lectura_admin';
  if n < 30 then raise exception 'reversión fase4: no volvieron las políticas interinas (%)', n; end if;
  select count(*) into n from pg_policies where schemaname in ('public', 'interno') and policyname in ('adm_lectura', 'adm_escritura', 'propio', 'sesion');
  if n > 0 then raise exception 'reversión fase4: quedan % políticas nuevas', n; end if;
end $$;
commit;
