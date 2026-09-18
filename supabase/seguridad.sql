-- ============================================================================
-- SEGURIDAD · estado canónico de permisos tras las FASES 0, 0b y 1 (contención + cimiento,
-- 2026-09-17). APLICAR SIEMPRE AL FINAL, después de schema.sql, accesos.sql,
-- portal.sql, solicitudes.sql y soporte.sql (y de las migraciones cuyo
-- canónico es la propia migración). Idempotente.
--
-- Es el espejo de migraciones/2026-09-17-fase0-contencion.sql sin la
-- precondición de la foto del paso 0. Los canónicos anteriores siguen creando
-- acceso_demo y concediendo EXECUTE a authenticated por default privileges;
-- este archivo lo deja como está producción. La fase 1 lo reescribirá con la
-- guarda central (región @@FASE1@@ generada por scripts/fase1-generar.mjs).
-- ============================================================================

-- 1 · Revocar EXECUTE en todas las funciones de public.
revoke execute on all functions in schema public from authenticated, anon, public;

-- 2a · Pre-login (por diseño sin sesión).
grant execute on function
  verificar_bloqueo(p_correo text),
  registrar_ingreso(p_correo text, p_resultado text, p_dispositivo text),
  portal_verificar_bloqueo(p_dni text),
  portal_registrar_ingreso(p_dni text, p_resultado text, p_dispositivo text)
to anon, authenticated;

-- 2b · Con verificación del llamador (56) + dependencias de vistas (2).
grant execute on function
  actualizar_ticket(p_id bigint, p_estado text, p_atendido_por text, p_nota text, p_por text),
  alternar_ticket_subtipo(p_id integer, p_activo boolean),
  alternar_ticket_tipo(p_id integer, p_activo boolean),
  asignar_rit_sede(p_sede text, p_rit text),
  crear_activo(p_codigo text, p_categoria text, p_empresa text, p_tipo text, p_marca text, p_modelo text, p_serie text, p_imei text, p_valor numeric, p_compra date, p_observaciones text),
  crear_rit(p_nombre text, p_archivo text, p_hash text, p_vigente date),
  crear_solicitud_admin(p_dni text, p_tipo text, p_datos jsonb, p_por text),
  crear_solicitud_propia(p_tipo text, p_datos jsonb),
  crear_ticket_admin(p_dni text, p_tipo integer, p_subtipo integer, p_comentario text, p_por text),
  decidir_propuesta_perfil(p_id bigint, p_decision text, p_por text),
  editar_trabajador(p_dni text, p_nombre text, p_celular text, p_correo text, p_banco text, p_cuenta text, p_cci text, p_tipo_documento text),
  eliminar_feriado(p_fecha date, p_por text),
  eliminar_sede(p_sede text),
  eliminar_solicitud_aviso(p_id bigint),
  eliminar_ticket_aviso(p_correo text),
  emitir_memorandum(p_dni text, p_tipo_sancion text, p_falta_id bigint, p_motivo text, p_suspension_dias integer, p_por text),
  es_admin_activo(),
  fijar_correo_persona(p_dni text, p_correo text),
  fijar_hora_entrada(p_dni text, p_hora time without time zone, p_desde date, p_por text),
  fn_hora_entrada(p_dni text, p_fecha date),
  fn_nivel_memorandums(),
  fn_nivel_modulo(p_modulo text),
  fn_persona_llamador(),
  fn_solicitud_insertar(p_dni text, p_tipo text, p_datos jsonb, p_por text),
  fn_ver_cuenta_bancaria(p_dni text),
  guardar_cargo_perfil(p_cargo text, p_destino text, p_perfil text, p_por text),
  guardar_clave_equipo(p_codigo text, p_clave text, p_por text),
  guardar_feriado(p_fecha date, p_nombre text, p_por text),
  guardar_solicitud_aviso(p_tipo text, p_correo text, p_copia boolean, p_activo boolean),
  guardar_ticket_aviso(p_correo text, p_activo boolean),
  guardar_ticket_subtipo(p_id integer, p_tipo integer, p_nombre text),
  guardar_ticket_tipo(p_id integer, p_nombre text),
  importar_asistencia(p_empresa text, p_registros jsonb, p_archivo text, p_resumen jsonb, p_por text),
  importar_control(p_registros jsonb, p_trabajadores jsonb, p_archivo text, p_por text),
  importar_padron(p_filas jsonb, p_por text, p_ceses jsonb),
  importar_planilla_unificada(p_filas jsonb, p_periodo text, p_por text, p_ceses jsonb),
  mi_sesion_backoffice(),
  portal_actualizar_datos(p_celular text, p_direccion text),
  portal_confirmar_lectura(p_comunicado_id bigint, p_dispositivo text),
  portal_confirmar_recepcion(p_documento_id bigint, p_dispositivo text),
  portal_crear_solicitud(p_tipo text, p_datos jsonb),
  portal_crear_ticket(p_tipo integer, p_subtipo integer, p_comentario text),
  portal_dni(),
  portal_marcar_visto(p_comunicado_id bigint),
  portal_mi_sesion(),
  portal_modo(p_dni text),
  portal_primer_ingreso(p_celular text, p_sin_celular boolean, p_politica_version integer, p_correo text),
  portal_registrar_sesion(p_marker text),
  portal_solicitar_cambio_cuenta(p_motivo text),
  previsualizar_control(p_registros jsonb, p_trabajadores jsonb, p_archivo text),
  previsualizar_padron(p_filas jsonb, p_ceses jsonb),
  previsualizar_planilla_unificada(p_filas jsonb, p_periodo text, p_ceses jsonb),
  publicar_rit(p_archivo_url text, p_hash text, p_titulo text),
  reenviar_solicitud(p_id bigint, p_datos jsonb, p_por text),
  registrar_acuse_asistido(p_dni text, p_lote text, p_motivo text, p_entrega timestamp with time zone, p_adjunto text, p_dispositivo text),
  registrar_sesion_backoffice(p_marker text),
  resolver_solicitud(p_id bigint, p_decision text, p_comentario text, p_por text),
  ver_clave_equipo(p_codigo text, p_por text)
to authenticated;

-- 2c · Ayudantes de identidad usados por las vistas del Portal: definer.
alter function portal_dni() security definer set search_path = public, extensions;
alter function portal_modo(p_dni text) security definer set search_path = public, extensions;

-- 3 · Sin acceso_demo.
do $$
declare r record;
begin
  for r in select tablename from pg_policies where schemaname = 'public' and policyname = 'acceso_demo'
  loop execute format('drop policy acceso_demo on public.%I', r.tablename); end loop;
end $$;

-- 4 · RLS en todas las tablas de public.
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop execute format('alter table public.%I enable row level security', r.relname); end loop;
end $$;

-- 5 · Tablas base que el BackOffice lee/escribe directo (mapa FUENTES de
--     src/state.jsx + Telefonía): solo administradores activos (fase 0 + 0b).
do $$
declare t text;
begin
  foreach t in array array['lineas', 'empresas', 'tardanzas', 'asistencia_config', 'plantillas'] loop
    execute format('drop policy if exists solo_admin on public.%I', t);
    execute format('create policy solo_admin on public.%I for all to authenticated using (public.es_admin_activo()) with check (public.es_admin_activo())', t);
  end loop;
end $$;

-- @@FASE1-INICIO@@ (generado por scripts/fase1-generar.mjs; no editar a mano)
-- 7 · Fase 1: administrativas con guarda central (25) y ayudantes consultables.
grant execute on function
  crear_usuario_admin(p_dni text, p_perfil text, p_correo text, p_celular text, p_clave text, p_por text),
  actualizar_usuario_admin(p_id bigint, p_perfil text, p_correo text, p_celular text, p_estado text),
  suspender_usuario_admin(p_id bigint),
  reactivar_usuario_admin(p_id bigint),
  reenviar_clave(p_id bigint, p_clave text),
  guardar_perfil(p_id text, p_nombre text, p_descripcion text, p_superadmin boolean, p_ver_remuneracion boolean, p_ver_documentos boolean, p_exportar boolean, p_matriz jsonb, p_empresas text[] , p_por text , p_ver_bancarios boolean),
  eliminar_perfil(p_id text),
  desactivar_perfil(p_id text),
  guardar_politica(p_backoffice_horas int, p_portal_dias int, p_multisesion_backoffice boolean, p_multisesion_portal boolean, p_intentos int, p_bloqueo_min int, p_recuperacion text, p_clave_min_portal int, p_clave_min_backoffice int, p_provisional_dias int, p_por text),
  marcar_clave_cambiada(p_correo text),
  alta_trabajador(p_dni text, p_nombre text, p_cargo text, p_sede text, p_empresa text, p_ingreso date, p_celular text , p_banco text , p_cuenta text , p_correo text , p_cci text , p_tipo_documento text),
  eliminar_trabajador(p_dni text),
  publicar_lote(p_empresa text, p_tipo text, p_periodo text, p_por text),
  publicar_lote_pdf(p_empresa text, p_tipo text, p_periodo text, p_por text, p_boletas jsonb),
  publicar_comunicado(p_titulo text, p_cuerpo text, p_vence date, p_exige boolean, p_segmento text, p_alcance int, p_empresa text , p_sede text),
  registrar_epp(p_dni text, p_items text, p_entrega date, p_reposicion date),
  previsualizar_asistencia(p_empresa text, p_registros jsonb, p_archivo text, p_resumen jsonb),
  importar_activos(p_empresa text, p_activos jsonb, p_razon_social text, p_archivo text, p_por text),
  previsualizar_importacion_activos(p_empresa text, p_activos jsonb, p_razon_social text, p_archivo text),
  crear_sede(p_empresa text, p_nombre text, p_cliente text, p_direccion text , p_por text , p_rit text),
  asignar_activo(p_codigo text, p_dni text, p_condicion text , p_antivirus boolean , p_comentario text),
  devolver_activo(p_codigo text, p_destino text, p_condicion text),
  editar_activo(p_codigo text, p_nuevo_codigo text, p_tipo text, p_marca text, p_modelo text, p_serie text, p_area text, p_asignado_sin_confirmar text, p_observaciones text, p_por text , p_ip text),
  resolver_memorandum(p_id text, p_decision text),
  notificar_memorandum(p_id text)
to authenticated;
grant execute on function es_admin(), es_superadmin(), nivel_en(text) to authenticated;
drop function if exists asignar_activo(text, text, text);
-- Toda función nueva nace SIN EXECUTE para nadie de la API (el grant es explícito).
-- Hace falta la entrada GLOBAL: el default del esquema se fusiona con el global/incorporado (PUBLIC).
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from public, authenticated, anon;
-- @@FASE1-FIN@@

-- 6 · Rastro del endpoint de correo. Solo service_role.
create table if not exists correo_envios (
  id           bigint generated always as identity primary key,
  creado_en    timestamptz not null default now(),
  accion       text not null,
  ip           text,
  sujeto       text,
  destinatario text,
  resultado    text not null check (resultado in ('enviado', 'rechazado', 'limitado', 'error')),
  detalle      text
);
create index if not exists ix_correo_envios_ip on correo_envios (ip, creado_en desc);
create index if not exists ix_correo_envios_sujeto on correo_envios (sujeto, creado_en desc);
alter table correo_envios enable row level security;
revoke all on table correo_envios from anon, authenticated, public;
revoke all on sequence correo_envios_id_seq from anon, authenticated, public;
grant select, insert on table correo_envios to service_role;
grant usage on sequence correo_envios_id_seq to service_role;

-- @@FASE2-INICIO@@ (generado por scripts/fase2-generar.mjs; no editar a mano)
-- 8 · Fase 2: 38 vistas con security_invoker (BackOffice + catálogos), políticas de
--     lectura para administradores y catálogos, SELECT en las tablas que no lo tenían.
--     Las 9 v_portal_* siguen como dueño hasta la fase 4.
-- 1 · GRANT SELECT en las 12 tablas bajo vistas que no tenían privilegio alguno
--     para authenticated. Las filas las decide RLS (política), no el grant.
grant select on table movimientos, notificaciones_documento, perfil_propuestas, rits, solicitud_avisos, solicitud_eventos, solicitud_tipos, solicitudes, ticket_avisos, ticket_subtipos, ticket_tipos, tickets to authenticated;

-- 2 · Políticas de lectura: lectura_admin (administrador activo) en 38 tablas;
--     lectura_sesion (administrador activo o trabajador identificado) en 4 catálogos.
do $$
declare t text;
begin
  foreach t in array array['activos', 'acuses', 'asignaciones', 'asistencia_lotes', 'auditoria', 'cargo_perfiles', 'comunicado_lecturas', 'comunicados', 'contratos', 'cuentas_portal', 'descargos', 'documentos', 'epp_entregas', 'feriados', 'lotes', 'marcaciones', 'memorandums', 'movimientos', 'notificaciones_documento', 'perfil_empresas', 'perfil_permisos', 'perfil_propuestas', 'perfiles', 'personas', 'politica_acceso', 'registro_accesos', 'rit_faltas', 'rits', 'sedes', 'solicitud_avisos', 'solicitud_eventos', 'solicitudes', 'solicitudes_cambio_cuenta', 'ticket_avisos', 'tickets', 'tipos_sancion', 'usuarios_admin', 'vinculos'] loop
    execute format('drop policy if exists lectura_admin on public.%I', t);
    execute format('create policy lectura_admin on public.%I for select to authenticated using (public.es_admin_activo())', t);
  end loop;
  foreach t in array array['declaraciones', 'solicitud_tipos', 'ticket_subtipos', 'ticket_tipos'] loop
    execute format('drop policy if exists lectura_sesion on public.%I', t);
    execute format('create policy lectura_sesion on public.%I for select to authenticated using (public.es_admin_activo() or public.portal_dni() is not null)', t);
  end loop;
end $$;

-- 3 · security_invoker en las 38 vistas del BackOffice y catálogos.
alter view public.v_actividad_persona set (security_invoker = on);
alter view public.v_activos set (security_invoker = on);
alter view public.v_acuses set (security_invoker = on);
alter view public.v_asistencia_lotes set (security_invoker = on);
alter view public.v_asistencia_mensual set (security_invoker = on);
alter view public.v_cargo_perfiles set (security_invoker = on);
alter view public.v_comunicado_pendientes set (security_invoker = on);
alter view public.v_comunicados set (security_invoker = on);
alter view public.v_contratos set (security_invoker = on);
alter view public.v_declaraciones_vigentes set (security_invoker = on);
alter view public.v_epp_entregas set (security_invoker = on);
alter view public.v_feriados set (security_invoker = on);
alter view public.v_lotes set (security_invoker = on);
alter view public.v_marcaciones set (security_invoker = on);
alter view public.v_memorandums set (security_invoker = on);
alter view public.v_mi_acceso set (security_invoker = on);
alter view public.v_mis_solicitudes set (security_invoker = on);
alter view public.v_movimientos_persona set (security_invoker = on);
alter view public.v_perfil_propuestas set (security_invoker = on);
alter view public.v_perfil_versiones set (security_invoker = on);
alter view public.v_perfiles set (security_invoker = on);
alter view public.v_personal set (security_invoker = on);
alter view public.v_politica_acceso set (security_invoker = on);
alter view public.v_registro_accesos set (security_invoker = on);
alter view public.v_rit_faltas set (security_invoker = on);
alter view public.v_rits set (security_invoker = on);
alter view public.v_sedes set (security_invoker = on);
alter view public.v_solicitud_avisos set (security_invoker = on);
alter view public.v_solicitud_eventos set (security_invoker = on);
alter view public.v_solicitud_tipos set (security_invoker = on);
alter view public.v_solicitudes set (security_invoker = on);
alter view public.v_ticket_avisos set (security_invoker = on);
alter view public.v_ticket_catalogo set (security_invoker = on);
alter view public.v_ticket_config set (security_invoker = on);
alter view public.v_tickets set (security_invoker = on);
alter view public.v_tipos_sancion set (security_invoker = on);
alter view public.v_usuarios_admin set (security_invoker = on);
alter view public.v_vinculos_persona set (security_invoker = on);
-- @@FASE2-FIN@@
