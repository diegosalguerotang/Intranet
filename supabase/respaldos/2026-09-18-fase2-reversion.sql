-- supabase/respaldos/2026-09-18-fase2-reversion.sql
-- Reversión completa de la FASE 2 (GENERADA por scripts/fase2-generar.mjs).
-- Deja la base exactamente como tras la fase 1: vistas como dueño, sin las
-- políticas lectura_admin/lectura_sesion y sin el SELECT concedido.
begin;
set local search_path = public, extensions;

alter view public.v_actividad_persona reset (security_invoker);
alter view public.v_activos reset (security_invoker);
alter view public.v_acuses reset (security_invoker);
alter view public.v_asistencia_lotes reset (security_invoker);
alter view public.v_asistencia_mensual reset (security_invoker);
alter view public.v_cargo_perfiles reset (security_invoker);
alter view public.v_comunicado_pendientes reset (security_invoker);
alter view public.v_comunicados reset (security_invoker);
alter view public.v_contratos reset (security_invoker);
alter view public.v_declaraciones_vigentes reset (security_invoker);
alter view public.v_epp_entregas reset (security_invoker);
alter view public.v_feriados reset (security_invoker);
alter view public.v_lotes reset (security_invoker);
alter view public.v_marcaciones reset (security_invoker);
alter view public.v_memorandums reset (security_invoker);
alter view public.v_mi_acceso reset (security_invoker);
alter view public.v_mis_solicitudes reset (security_invoker);
alter view public.v_movimientos_persona reset (security_invoker);
alter view public.v_perfil_propuestas reset (security_invoker);
alter view public.v_perfil_versiones reset (security_invoker);
alter view public.v_perfiles reset (security_invoker);
alter view public.v_personal reset (security_invoker);
alter view public.v_politica_acceso reset (security_invoker);
alter view public.v_registro_accesos reset (security_invoker);
alter view public.v_rit_faltas reset (security_invoker);
alter view public.v_rits reset (security_invoker);
alter view public.v_sedes reset (security_invoker);
alter view public.v_solicitud_avisos reset (security_invoker);
alter view public.v_solicitud_eventos reset (security_invoker);
alter view public.v_solicitud_tipos reset (security_invoker);
alter view public.v_solicitudes reset (security_invoker);
alter view public.v_ticket_avisos reset (security_invoker);
alter view public.v_ticket_catalogo reset (security_invoker);
alter view public.v_ticket_config reset (security_invoker);
alter view public.v_tickets reset (security_invoker);
alter view public.v_tipos_sancion reset (security_invoker);
alter view public.v_usuarios_admin reset (security_invoker);
alter view public.v_vinculos_persona reset (security_invoker);

do $$
declare t text;
begin
  foreach t in array array['activos', 'acuses', 'asignaciones', 'asistencia_lotes', 'auditoria', 'cargo_perfiles', 'comunicado_lecturas', 'comunicados', 'contratos', 'cuentas_portal', 'descargos', 'documentos', 'epp_entregas', 'feriados', 'lotes', 'marcaciones', 'memorandums', 'movimientos', 'notificaciones_documento', 'perfil_empresas', 'perfil_permisos', 'perfil_propuestas', 'perfiles', 'personas', 'politica_acceso', 'registro_accesos', 'rit_faltas', 'rits', 'sedes', 'solicitud_avisos', 'solicitud_eventos', 'solicitudes', 'solicitudes_cambio_cuenta', 'ticket_avisos', 'tickets', 'tipos_sancion', 'usuarios_admin', 'vinculos'] loop
    execute format('drop policy if exists lectura_admin on public.%I', t);
  end loop;
  foreach t in array array['declaraciones', 'solicitud_tipos', 'ticket_subtipos', 'ticket_tipos'] loop
    execute format('drop policy if exists lectura_sesion on public.%I', t);
  end loop;
end $$;

revoke select on table movimientos, notificaciones_documento, perfil_propuestas, rits, solicitud_avisos, solicitud_eventos, solicitud_tipos, solicitudes, ticket_avisos, ticket_subtipos, ticket_tipos, tickets from authenticated;

do $$
declare n int;
begin
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'v' and 'security_invoker=on' = any(coalesce(c.reloptions, '{}'));
  if n <> 0 then raise exception 'reversión fase2: quedan % vistas con security_invoker', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and policyname in ('lectura_admin', 'lectura_sesion');
  if n <> 0 then raise exception 'reversión fase2: quedan % políticas lectura_*', n; end if;
  select count(*) into n from unnest(array['movimientos', 'notificaciones_documento', 'perfil_propuestas', 'rits', 'solicitud_avisos', 'solicitud_eventos', 'solicitud_tipos', 'solicitudes', 'ticket_avisos', 'ticket_subtipos', 'ticket_tipos', 'tickets']) t where has_table_privilege('authenticated', 'public.' || t, 'select');
  if n <> 0 then raise exception 'reversión fase2: % tablas siguen con SELECT para authenticated', n; end if;
end $$;

commit;
