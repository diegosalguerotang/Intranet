-- ============================================================================
-- SEGURIDAD · estado canónico de permisos tras la FASE 0 (contención,
-- 2026-09-17). APLICAR SIEMPRE AL FINAL, después de schema.sql, accesos.sql,
-- portal.sql, solicitudes.sql y soporte.sql (y de las migraciones cuyo
-- canónico es la propia migración). Idempotente.
--
-- Es el espejo de migraciones/2026-09-17-fase0-contencion.sql sin la
-- precondición de la foto del paso 0. Los canónicos anteriores siguen creando
-- acceso_demo y concediendo EXECUTE a authenticated por default privileges;
-- este archivo lo deja como está producción. La fase 1 lo reescribirá con la
-- guarda central y los default privileges cerrados.
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
