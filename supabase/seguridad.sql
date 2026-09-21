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

-- @@FASE3-INICIO@@ (generado por scripts/fase3-generar.mjs; no editar a mano)
-- 9 · Fase 3a: esquema privado interno con 10 tablas; search_path de todas las
--     funciones ampliado; cuerpos con esquema explícito re-calificados. Las
--     funciones de servicio están en el canónico api-servicio.sql.
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
-- @@FASE3-FIN@@

-- @@FASE3B-INICIO@@ (generado por scripts/fase3b-generar.mjs desde supabase/bancario.sql; no editar a mano)
-- 10 · Fase 3b: datos bancarios en interno.datos_bancarios; personas sin columnas bancarias.
-- supabase/bancario.sql — Corrección de seguridad · FASE 3b (2026-09-18):
-- DATOS BANCARIOS en el esquema privado `interno`.
--
-- Canónico de la fase 3b. Lo embebe la migración
-- migraciones/2026-09-18-fase3b-datos-bancarios.sql y el bloque @@FASE3B@@ de
-- seguridad.sql (espejo local). Idempotente: se puede aplicar dos veces.
--
-- Qué hace (decisiones P2, P4 y P7 de Decisiones_Seguridad_QA):
--  · tabla interno.datos_bancarios (banco, cuenta cifrada + últimos 4, CCI
--    CIFRADO + últimos 4): PostgREST no la publica; RLS + lectura_admin como el
--    resto de interno (las vistas security_invoker la leen con permisos del
--    administrador; la fila la decide la política).
--  · personas pierde cuenta (texto plano: se ELIMINA, P7), cci (pasa cifrado,
--    P4), cuenta_cifrada, cuenta_ultimos4, banco y banco_id.
--  · v_personal y v_portal_datos muestran solo máscaras («···· 1234»).
--  · fn_ver_cuenta_bancaria sigue siendo el ÚNICO camino al valor completo
--    (casilla «Ver datos bancarios» o superadmin; cada consulta en auditoría)
--    y ahora devuelve también el CCI descifrado.
--  · auditoría de la tabla nueva SIN valores (dni, banco, últimos 4).
--  · alta_trabajador, editar_trabajador e importar_planilla_unificada escriben
--    por fn_guardar_datos_bancarios (interna). Semántica en edición e
--    importación: vacío = conservar, '-' = borrar, otro texto = reemplazar
--    (cifrado), igual que ya hacía la cuenta; ahora también para el CCI.

-- 1 · Tabla -------------------------------------------------------------------
create table if not exists interno.datos_bancarios (
  dni             text primary key references personas(dni) on delete cascade,
  banco           text,
  banco_id        text references bancos(codigo),
  cuenta_cifrada  bytea,
  cuenta_ultimos4 text,
  cci_cifrado     bytea,
  cci_ultimos4    text,
  actualizado_en  timestamptz not null default now(),
  actualizado_por text
);
alter table interno.datos_bancarios enable row level security;
revoke all on table interno.datos_bancarios from public, anon;
grant select on table interno.datos_bancarios to authenticated;
grant all on table interno.datos_bancarios to service_role;
drop policy if exists lectura_admin on interno.datos_bancarios;
create policy lectura_admin on interno.datos_bancarios for select to authenticated using (public.es_admin_activo());

-- 2 · Ayudantes internos (nadie de la API los ejecuta) --------------------------
create or replace function fn_ultimos4(p_texto text) returns text
language sql immutable as $$
  select case when nullif(trim(coalesce(p_texto, '')), '') is null then null
              else right(regexp_replace(trim(p_texto), '[^0-9A-Za-z]', '', 'g'), 4) end
$$;
revoke all on function fn_ultimos4(text) from public, anon, authenticated;

-- Única escritura de datos bancarios. p_cuenta / p_cci: null o vacío =
-- conservar; '-' = borrar; otro texto = reemplazar cifrado. Banco: con
-- p_pisar_banco lo escrito manda (incluido null); sin él, null conserva.
create or replace function fn_guardar_datos_bancarios(
  p_dni text, p_banco text, p_banco_id text, p_cuenta text, p_cci text,
  p_pisar_banco boolean, p_por text default null
) returns void
language plpgsql security definer set search_path = public, interno, extensions as $$
declare v_cuenta text := nullif(trim(coalesce(p_cuenta, '')), '');
        v_cci    text := nullif(trim(coalesce(p_cci, '')), '');
begin
  if not exists (select 1 from datos_bancarios where dni = p_dni) then
    if v_cuenta = '-' then v_cuenta := null; end if;
    if v_cci = '-' then v_cci := null; end if;
    if v_cuenta is null and v_cci is null and p_banco is null and p_banco_id is null then return; end if;
    insert into datos_bancarios (dni, banco, banco_id, cuenta_cifrada, cuenta_ultimos4, cci_cifrado, cci_ultimos4, actualizado_por)
    values (p_dni, p_banco, p_banco_id, fn_cifrar_cuenta(v_cuenta), fn_ultimos4(v_cuenta), fn_cifrar_cuenta(v_cci), fn_ultimos4(v_cci), p_por);
    return;
  end if;
  update datos_bancarios set
    banco           = case when p_pisar_banco then p_banco    else coalesce(p_banco, banco) end,
    banco_id        = case when p_pisar_banco then p_banco_id else coalesce(p_banco_id, banco_id) end,
    cuenta_cifrada  = case when v_cuenta is null then cuenta_cifrada  when v_cuenta = '-' then null else fn_cifrar_cuenta(v_cuenta) end,
    cuenta_ultimos4 = case when v_cuenta is null then cuenta_ultimos4 when v_cuenta = '-' then null else fn_ultimos4(v_cuenta) end,
    cci_cifrado     = case when v_cci is null then cci_cifrado  when v_cci = '-' then null else fn_cifrar_cuenta(v_cci) end,
    cci_ultimos4    = case when v_cci is null then cci_ultimos4 when v_cci = '-' then null else fn_ultimos4(v_cci) end,
    actualizado_en  = now(),
    actualizado_por = coalesce(p_por, actualizado_por)
  where dni = p_dni;
end $$;
revoke all on function fn_guardar_datos_bancarios(text, text, text, text, text, boolean, text) from public, anon, authenticated;

-- 3 · Auditoría sin secretos ---------------------------------------------------
create or replace function fn_auditar_datos_bancarios() returns trigger
language plpgsql security definer set search_path = public, interno, extensions as $$
declare v_por text;
begin
  begin v_por := nullif(auth.jwt() ->> 'email', ''); exception when others then v_por := null; end;
  insert into auditoria (usuario, accion, tabla, datos_antes, datos_despues)
  values (coalesce(v_por, current_user::text), 'CAMBIO_DATOS_BANCARIOS', 'datos_bancarios',
    case when tg_op in ('UPDATE', 'DELETE') then jsonb_build_object('dni', old.dni, 'banco', old.banco, 'ultimos4', old.cuenta_ultimos4, 'cciUltimos4', old.cci_ultimos4) end,
    case when tg_op in ('INSERT', 'UPDATE') then jsonb_build_object('dni', new.dni, 'banco', new.banco, 'ultimos4', new.cuenta_ultimos4, 'cciUltimos4', new.cci_ultimos4) end);
  return coalesce(new, old);
end $$;
drop trigger if exists trg_auditar_datos_bancarios on interno.datos_bancarios;
create trigger trg_auditar_datos_bancarios
  after insert or update or delete on interno.datos_bancarios
  for each row execute function fn_auditar_datos_bancarios();

-- 4 · Vistas: solo máscaras (mismas columnas y orden que antes) ----------------
create or replace view v_personal as
select p.dni, p.tipo_documento, p.nombre, v.cargo, v.sede_id as sede, v.empresa_id as empresa,
       to_char(v.fecha_inicio, 'YYYY-MM-DD') as ingreso,
       p.celular, p.portal,
       case when v.fecha_fin is null then 'vigente' else 'cesado' end as estado,
       db.banco,
       case when db.cuenta_ultimos4 is not null then '···· ' || db.cuenta_ultimos4 end as cuenta,
       to_char(v.fecha_fin, 'YYYY-MM-DD') as cese,
       v.id as vinculo_id,
       p.correo, p.correo_verificado as "correoVerificado",
       case when db.cci_ultimos4 is not null then '···· ' || db.cci_ultimos4 end as cci,
       exists (select 1 from cuentas_portal cp where cp.dni = p.dni) as "tieneCuenta",
       p.sexo,
       v.centro_costo as "centroCosto",
       to_char(fn_hora_entrada(p.dni), 'HH24:MI') as "horaEntrada"
from vinculos v
join personas p on p.dni = v.persona_dni
left join interno.datos_bancarios db on db.dni = p.dni;
alter view v_personal set (security_invoker = on);

create or replace view v_portal_datos as
select pe.dni, pe.nombre, pe.celular, pe.direccion, db.banco,
       case when db.cuenta_ultimos4 is null then null
            else '···· ' || db.cuenta_ultimos4 end as "cuentaEnmascarada",
       coalesce(vig.cargo, '—') as cargo,
       em.corto as empresa, s.nombre as sede,
       exists (select 1 from solicitudes_cambio_cuenta sc
               where sc.dni = pe.dni and sc.estado = 'pendiente') as "solicitudPendiente"
from personas pe
left join interno.datos_bancarios db on db.dni = pe.dni
left join lateral (select * from vinculos v where v.persona_dni = pe.dni and v.fecha_fin is null
                   order by v.fecha_inicio desc limit 1) vig on true
left join sedes s on s.id = vig.sede_id
left join empresas em on em.id = vig.empresa_id
where pe.dni = portal_dni();

-- 5 · Copia de lo existente y retiro de las columnas de personas (una sola vez)
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'personas' and column_name = 'cuenta_cifrada') then
    alter table interno.datos_bancarios disable trigger trg_auditar_datos_bancarios;
    insert into interno.datos_bancarios (dni, banco, banco_id, cuenta_cifrada, cuenta_ultimos4, cci_cifrado, cci_ultimos4, actualizado_por)
    select dni, banco, banco_id,
           coalesce(cuenta_cifrada, fn_cifrar_cuenta(cuenta)),
           coalesce(cuenta_ultimos4, fn_ultimos4(cuenta)),
           fn_cifrar_cuenta(cci), fn_ultimos4(cci), 'fase 3b'
    from personas
    where cuenta_cifrada is not null or cuenta is not null or cci is not null or banco is not null or banco_id is not null
    on conflict (dni) do nothing;
    alter table interno.datos_bancarios enable trigger trg_auditar_datos_bancarios;
    alter table personas
      drop column cuenta, drop column cci, drop column cuenta_cifrada,
      drop column cuenta_ultimos4, drop column banco, drop column banco_id;
  end if;
end $$;

-- 6 · Funciones que leen o escriben datos bancarios ------------------------------
-- Único camino de lectura de cuenta y CCI completos. Registra en auditoría
-- SIEMPRE (tenga permiso o no); devuelve null sin permiso. Ley 29733.
create or replace function fn_ver_cuenta_bancaria(p_dni text) returns jsonb
language plpgsql security definer set search_path = public, interno, extensions as $$
declare v_correo text; v_ok boolean; v_cuenta text; v_banco text; v_cci text;
begin
  begin
    v_correo := nullif(auth.jwt() ->> 'email', '');
  exception when others then
    v_correo := null;
  end;
  select (p.es_superadmin or p.ver_datos_bancarios) into v_ok
  from usuarios_admin u
  join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
  where lower(u.correo) = lower(coalesce(v_correo, '')) and u.estado = 'activo';
  v_ok := coalesce(v_ok, false);
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('VER_CUENTA_BANCARIA', 'datos_bancarios', null,
          jsonb_build_object('dni', p_dni, 'por', v_correo, 'autorizado', v_ok));
  if not v_ok then return null; end if;
  select fn_descifrar_cuenta(db.cuenta_cifrada), db.banco, fn_descifrar_cuenta(db.cci_cifrado)
    into v_cuenta, v_banco, v_cci from datos_bancarios db where db.dni = p_dni;
  return jsonb_build_object('cuenta', v_cuenta, 'banco', v_banco, 'cci', v_cci);
end $$;

-- Alta (misma firma): personas sin columnas bancarias; lo bancario por el ayudante.
create or replace function alta_trabajador(
  p_dni text, p_nombre text, p_cargo text, p_sede text, p_empresa text,
  p_ingreso date, p_celular text default null,
  p_banco text default null, p_cuenta text default null, p_correo text default null,
  p_cci text default null, p_tipo_documento text default 'DNI'
) returns void language plpgsql security definer set search_path = public, interno, extensions as $$
declare v_num text; v_banco_id text; v_banco text;
begin
  perform requiere_nivel('personal', 2);  -- fase 1: guarda central
  v_num := fn_validar_documento(p_tipo_documento, p_dni);
  v_banco_id := fn_resolver_banco(p_banco);
  v_banco := coalesce((select nombre from bancos where codigo = v_banco_id),
                      nullif(trim(coalesce(p_banco, '')), ''));
  insert into personas (dni, tipo_documento, nombre, celular, portal, correo)
  values (v_num, p_tipo_documento, p_nombre, p_celular,
          case when p_celular is null then 'sin_celular' else 'nunca_ingreso' end,
          nullif(lower(trim(coalesce(p_correo, ''))), ''))
  on conflict (dni) do update
    set tipo_documento = excluded.tipo_documento,
        celular = coalesce(excluded.celular, personas.celular),
        correo  = coalesce(excluded.correo, personas.correo);
  -- Igual que antes: lo que viene vacío conserva lo registrado.
  perform fn_guardar_datos_bancarios(v_num, v_banco, v_banco_id, p_cuenta, p_cci, false, 'alta_trabajador');

  if exists (select 1 from vinculos where persona_dni = v_num
             and empresa_id = p_empresa and fecha_fin is null) then
    raise exception 'La persona % ya tiene un vínculo vigente con esta empresa.', v_num;
  end if;

  insert into vinculos (persona_dni, empresa_id, sede_id, cargo, fecha_inicio)
  values (v_num, p_empresa, p_sede, p_cargo, p_ingreso);
end $$;

-- Edición (misma firma). Cuenta y CCI: vacío conserva, '-' borra, otro texto
-- reemplaza cifrado. Banco: lo escrito manda. La auditoría de personas no
-- lleva datos bancarios (ya no están en la fila).
create or replace function editar_trabajador(
  p_dni text, p_nombre text, p_celular text, p_correo text, p_banco text, p_cuenta text,
  p_cci text default null, p_tipo_documento text default null
) returns void language plpgsql security definer set search_path = public, interno, extensions as $$
declare j_antes jsonb; j_despues jsonb; v_correo text; v_banco text; v_banco_id text;
begin
  if fn_nivel_modulo('personal') < 2 then
    raise exception 'Tu categoría no permite editar datos de Personal.';
  end if;
  if not exists (select 1 from personas where dni = p_dni) then
    raise exception 'La persona % no existe.', p_dni;
  end if;
  if nullif(trim(coalesce(p_nombre, '')), '') is null then
    raise exception 'El nombre no puede quedar vacío.';
  end if;
  if p_tipo_documento is not null then
    perform fn_validar_documento(p_tipo_documento, p_dni);
  end if;
  v_correo := nullif(lower(trim(coalesce(p_correo, ''))), '');
  if v_correo is not null and v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo no tiene un formato válido.';
  end if;
  v_banco := nullif(trim(coalesce(p_banco, '')), '');
  v_banco_id := fn_resolver_banco(v_banco);
  v_banco := coalesce((select nombre from bancos where codigo = v_banco_id), v_banco);

  select to_jsonb(p) into j_antes from personas p where dni = p_dni;
  update personas set
    nombre = trim(p_nombre),
    nombre_por_confirmar = false,
    tipo_documento = coalesce(p_tipo_documento, tipo_documento),
    celular = nullif(trim(coalesce(p_celular, '')), ''),
    correo_verificado = case when v_correo is distinct from correo then false else correo_verificado end,
    correo = v_correo
  where dni = p_dni;
  select to_jsonb(p) into j_despues from personas p where dni = p_dni;
  perform fn_guardar_datos_bancarios(p_dni, v_banco, v_banco_id, p_cuenta, p_cci, true, 'editar_trabajador');

  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('EDITAR_TRABAJADOR', 'personas', j_antes, j_despues);
end $$;

-- importar_planilla_unificada: se re-crea a partir de su cuerpo VIGENTE con
-- cuatro sustituciones exactas (cada patrón debe aparecer una sola vez; si
-- no, falla y nada cambia). Así no se pisa ningún ajuste posterior del cuerpo.
do $$
declare d text; n int; pat text; rep text; i int;
  pats text[] := array[
    $p$insert into personas \(dni, tipo_documento, nombre, portal, banco, banco_id,\s*cuenta_cifrada, cuenta_ultimos4\)\s*values \(v_doc, coalesce\(f->>'tipoDoc', 'DNI'\), v_nombre, 'sin_celular',\s*v_banco_nombre, f->>'bancoCodigo', fn_cifrar_cuenta\(v_cuenta\), v_u4\);$p$,
    $p$select fn_descifrar_cuenta\(cuenta_cifrada\) into v_cuenta_actual from personas where dni = v_canon;$p$,
    $p$\(select jsonb_build_object\('banco', banco, 'ultimos4', cuenta_ultimos4\)\s*from personas where dni = v_canon\)$p$,
    $p$,\s*banco = v_banco_nombre,\s*banco_id = f->>'bancoCodigo',\s*cuenta_cifrada = case when v_cuenta_cambio then fn_cifrar_cuenta\(v_cuenta\) else cuenta_cifrada end,\s*cuenta_ultimos4 = v_u4\s*where dni = v_canon;$p$];
  reps text[] := array[
    $r$insert into personas (dni, tipo_documento, nombre, portal)
      values (v_doc, coalesce(f->>'tipoDoc', 'DNI'), v_nombre, 'sin_celular');
      perform fn_guardar_datos_bancarios(v_doc, v_banco_nombre, f->>'bancoCodigo', v_cuenta, null, true, p_por);$r$,
    $r$select fn_descifrar_cuenta(cuenta_cifrada) into v_cuenta_actual from datos_bancarios where dni = v_canon;$r$,
    $r$(select jsonb_build_object('banco', banco, 'ultimos4', cuenta_ultimos4) from datos_bancarios where dni = v_canon)$r$,
    $r$
      where dni = v_canon;
      perform fn_guardar_datos_bancarios(v_canon, v_banco_nombre, f->>'bancoCodigo',
        case when v_cuenta_cambio then coalesce(v_cuenta, '-') else null end, null, true, p_por);$r$];
begin
  d := pg_get_functiondef('public.importar_planilla_unificada(jsonb, text, text, jsonb)'::regprocedure);
  if d ~ 'from datos_bancarios where dni = v_canon' then return; end if;  -- ya transformada (idempotente)
  for i in 1..4 loop
    select count(*) into n from regexp_matches(d, pats[i], 'g');
    if n <> 1 then raise exception 'fase3b: el patrón % de importar_planilla_unificada aparece % veces (esperada 1)', i, n; end if;
    d := regexp_replace(d, pats[i], reps[i]);
  end loop;
  execute d;
end $$;

-- @@FASE3B-FIN@@

-- @@FASE3C-INICIO@@ (generado por scripts/fase3c-generar.mjs desde supabase/claves-equipos.sql; no editar a mano)
-- 11 · Fase 3c: claves de equipos → referencia al gestor de contraseñas (P5); sin columna secreta.
-- supabase/claves-equipos.sql — Corrección de seguridad · FASE 3c (2026-09-18):
-- CLAVES DE EQUIPOS. Decisión P5 (Decisiones_Seguridad_QA): la intranet NO
-- guarda claves de equipos; guarda un PUNTERO al gestor de contraseñas (el
-- nombre de la entrada), que no es un secreto. Con eso no queda nada que mover
-- al esquema privado: la columna secreta desaparece.
--
-- Canónico de la fase 3c. Lo embebe la migración
-- migraciones/2026-09-18-fase3c-claves-equipos.sql y el bloque @@FASE3C@@ de
-- seguridad.sql. Idempotente. En producción no había ninguna clave guardada
-- (0 de 79 activos, 2026-09-18); si la hubiera, la migración se detiene:
-- primero se pasa al gestor y se deja en null.
--
--  · activos.clave_equipo (texto plano) se ELIMINA; nace activos.clave_gestor
--    (referencia en el gestor de contraseñas).
--  · v_activos: tiene_clave pasa a significar «tiene referencia» y expone la
--    referencia (columna nueva al final; misma vista security_invoker).
--  · guardar_clave_equipo / ver_clave_equipo (misma firma, el cliente no
--    cambia): guardan y devuelven la referencia. Guardar exige nivel de acción
--    en Activos (antes solo superadmin: ya no es un secreto) y queda en
--    auditoría con la referencia; ver exige solo ver Activos y no se audita.

-- 1 · Columna nueva y vista (antes de retirar la columna vieja: la vista depende de ella).
alter table activos add column if not exists clave_gestor text;
comment on column activos.clave_gestor is 'Referencia (nombre de la entrada) en el gestor de contraseñas. Nunca la clave (decisión P5, 2026-09-18).';

create or replace view v_activos as
select ac.codigo, ac.categoria, ac.marca, ac.modelo, ac.serie, ac.imei,
       case when ac.estado_fisico = 'baja' then 'baja'
            when ac.estado_fisico = 'mantenimiento' then 'mantenimiento'
            when asg.id is not null then 'asignado'
            else 'disponible' end as estado,
       asg.persona_dni as asignado,
       asg.antivirus, asg.comentario as comentario_asignacion,
       coalesce(vi.sede_id, ac.sede_id) as sede,
       ac.empresa_id as empresa, ac.valor,
       to_char(ac.compra, 'YYYY-MM-DD') as compra,
       ac.tipo, ac.area, ac.asignado_sin_confirmar, ac.usuario_anterior, ac.observaciones,
       ac.por_corregir, ac.ip,
       (ac.clave_gestor is not null) as tiene_clave,
       ac.clave_gestor
from activos ac
left join asignaciones asg on asg.activo_codigo = ac.codigo and asg.devuelto_en is null
left join vinculos vi on vi.persona_dni = asg.persona_dni and vi.fecha_fin is null;
alter view v_activos set (security_invoker = on);

-- 2 · Retiro de la columna secreta (una sola vez; se niega si hay claves guardadas).
do $$
declare n int;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'activos' and column_name = 'clave_equipo') then
    select count(*) into n from activos where clave_equipo is not null;
    if n > 0 then
      raise exception 'fase3c: % activos tienen clave guardada en la intranet: pásalas al gestor de contraseñas y déjalas en null antes (decisión P5)', n;
    end if;
    alter table activos drop column clave_equipo;
  end if;
end $$;

-- 3 · Funciones (misma firma que antes).
create or replace function guardar_clave_equipo(p_codigo text, p_clave text, p_por text default 'Gestión de TI')
returns void language plpgsql security definer set search_path = public, interno, extensions as $$
declare v text := nullif(trim(coalesce(p_clave, '')), '');
begin
  perform requiere_nivel('activos', 2);  -- guarda central (fase 1)
  if not exists (select 1 from activos where codigo = p_codigo) then
    raise exception 'El activo % no existe.', p_codigo;
  end if;
  if v is not null and length(v) > 120 then
    raise exception 'La referencia al gestor de contraseñas es demasiado larga (máximo 120 caracteres).';
  end if;
  update activos set clave_gestor = v where codigo = p_codigo;
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('REFERENCIA_CLAVE_GUARDADA', 'activos',
    jsonb_build_object('codigo', p_codigo, 'por', p_por), jsonb_build_object('referencia', v));
end $$;

create or replace function ver_clave_equipo(p_codigo text, p_por text default 'Gestión de TI')
returns text language plpgsql stable security definer set search_path = public, interno, extensions as $$
declare v text;
begin
  if fn_nivel_modulo('activos') < 1 then
    raise exception 'Tu categoría no permite ver Activos.';
  end if;
  select clave_gestor into v from activos where codigo = p_codigo;
  return v;
end $$;

-- @@FASE3C-FIN@@

-- @@FASE4-INICIO@@ (generado por scripts/fase4-generar.mjs; no editar a mano)
-- 12 · Fase 4: RLS por rol (ver supabase/rls.sql).
-- supabase/rls.sql — Corrección de seguridad · FASE 4 (2026-09-18): RLS POR ROL.
-- GENERADO por scripts/fase4-generar.mjs (la matriz vive ahí; no editar a mano).
-- Lo embeben la migración migraciones/2026-09-18-fase4-rls.sql y el bloque
-- @@FASE4@@ de seguridad.sql. Idempotente.
--
-- Política propia por tabla, denegación por defecto, ninguna condición true:
--   adm_lectura   administrador activo: nivel_en(módulo) ≥ 1 y alcance por razón social
--   propio        trabajador del Portal: solo sus registros, por su documento
--   sesion        catálogos sin datos personales: cualquier sesión identificada
--   adm_escritura solo donde el BackOffice escribe la tabla directo (nivel ≥ 2)
-- El alcance FILTRA filas (vacío, no error). Las políticas interinas de la fase
-- 2 (lectura_admin, lectura_sesion) y de la fase 0 (solo_admin, documentos_admin)
-- se retiran. Las 9 vistas del Portal pasan a security_invoker.

-- 1 · Ayudantes de alcance (SECURITY DEFINER, STABLE, search_path fijo). Los
--     evalúa el rol que consulta, así que authenticated necesita EXECUTE.
create or replace function fn_alcance_empresa(p_empresa text) returns boolean
language sql stable security definer set search_path = public, interno, extensions as $$
  select p_empresa is null
      or es_superadmin()
      or exists (select 1 from usuarios_admin u
                 join perfil_empresas pe on pe.perfil_id = u.perfil_id and pe.version = u.perfil_version
                 where lower(u.correo) = correo_llamador() and u.estado = 'activo' and pe.empresa_id = p_empresa)
$$;
create or replace function fn_alcance_persona(p_dni text) returns boolean
language sql stable security definer set search_path = public, interno, extensions as $$
  select p_dni is not null and (es_superadmin()
      or exists (select 1 from vinculos v where v.persona_dni = p_dni and fn_alcance_empresa(v.empresa_id))
      or not exists (select 1 from vinculos v where v.persona_dni = p_dni))
$$;
create or replace function fn_alcance_vinculo(p_id bigint) returns boolean
language sql stable security definer set search_path = public, interno, extensions as $$
  select exists (select 1 from vinculos v where v.id = p_id and fn_alcance_empresa(v.empresa_id))
$$;
create or replace function fn_alcance_documento(p_id bigint) returns boolean
language sql stable security definer set search_path = public, interno, extensions as $$
  select exists (select 1 from documentos d where d.id = p_id and fn_alcance_vinculo(d.vinculo_id))
$$;
create or replace function fn_alcance_memorandum(p_id text) returns boolean
language sql stable security definer set search_path = public, interno, extensions as $$
  select exists (select 1 from memorandums m where m.id = p_id and fn_alcance_vinculo(m.vinculo_id))
$$;
create or replace function fn_alcance_activo(p_codigo text) returns boolean
language sql stable security definer set search_path = public, interno, extensions as $$
  select exists (select 1 from activos a where a.codigo = p_codigo and fn_alcance_empresa(a.empresa_id))
$$;
create or replace function fn_alcance_solicitud(p_id bigint) returns boolean
language sql stable security definer set search_path = public, interno, extensions as $$
  select exists (select 1 from solicitudes s where s.id = p_id
                 and ((nivel_en('solicitudes') >= 1 and fn_alcance_empresa(s.empresa_id)) or s.solicitante_dni = fn_persona_llamador()))
$$;
-- Trabajador del Portal: sus propios registros, resueltos por su documento.
create or replace function fn_es_mi_dni(p_dni text) returns boolean
language sql stable security definer set search_path = public, interno, extensions as $$
  select p_dni is not null and p_dni = portal_dni()
$$;
create or replace function fn_mi_vinculo(p_id bigint) returns boolean
language sql stable security definer set search_path = public, interno, extensions as $$
  select exists (select 1 from vinculos v where v.id = p_id and v.persona_dni = portal_dni())
$$;
create or replace function fn_mi_solicitud(p_id bigint) returns boolean
language sql stable security definer set search_path = public, interno, extensions as $$
  select exists (select 1 from solicitudes s where s.id = p_id and s.solicitante_dni = portal_dni())
$$;
-- Un comunicado alcanza al trabajador si su segmento (empresa/sede, o todo el
-- grupo cuando van vacíos) coincide con algún vínculo vigente suyo.
create or replace function fn_comunicado_me_alcanza(p_id bigint) returns boolean
language sql stable security definer set search_path = public, interno, extensions as $$
  select portal_dni() is not null and exists (
    select 1 from comunicados c join vinculos v on v.persona_dni = portal_dni() and v.fecha_fin is null
    where c.id = p_id and (c.empresa_id is null or c.empresa_id = v.empresa_id) and (c.sede_id is null or c.sede_id = v.sede_id))
$$;
create or replace function fn_mi_sede(p_id text) returns boolean
language sql stable security definer set search_path = public, interno, extensions as $$
  select exists (select 1 from vinculos v where v.sede_id = p_id and v.persona_dni = portal_dni())
$$;
-- Categoría del propio administrador (v_mi_acceso la necesita sin módulo Accesos).
create or replace function fn_mi_perfil(p_perfil text, p_version integer) returns boolean
language sql stable security definer set search_path = public, interno, extensions as $$
  select exists (select 1 from usuarios_admin u where lower(u.correo) = correo_llamador() and u.estado = 'activo'
                 and u.perfil_id = p_perfil and u.perfil_version = p_version)
$$;
-- DNI que referencia una fila de auditoría (misma regla que v_actividad_persona).
create or replace function fn_dni_auditoria(p_antes jsonb, p_despues jsonb) returns text
language sql immutable as $$
  select coalesce(nullif(d ->> 'persona_dni', ''), nullif(d ->> 'dni', ''), nullif(d ->> 'p_dni', ''), nullif(d ->> 'dni_check', ''))
  from (select coalesce(p_despues, p_antes) as d) x
$$;
revoke all on function fn_alcance_empresa(text), fn_alcance_persona(text), fn_alcance_vinculo(bigint), fn_alcance_documento(bigint), fn_alcance_memorandum(text), fn_alcance_activo(text), fn_alcance_solicitud(bigint), fn_es_mi_dni(text), fn_mi_vinculo(bigint), fn_mi_solicitud(bigint), fn_comunicado_me_alcanza(bigint), fn_mi_sede(text), fn_mi_perfil(text, integer), fn_dni_auditoria(jsonb, jsonb) from public, anon;
grant execute on function fn_alcance_empresa(text), fn_alcance_persona(text), fn_alcance_vinculo(bigint), fn_alcance_documento(bigint), fn_alcance_memorandum(text), fn_alcance_activo(text), fn_alcance_solicitud(bigint), fn_es_mi_dni(text), fn_mi_vinculo(bigint), fn_mi_solicitud(bigint), fn_comunicado_me_alcanza(bigint), fn_mi_sede(text), fn_mi_perfil(text, integer), fn_dni_auditoria(jsonb, jsonb) to authenticated, service_role;
-- Las políticas se evalúan como el rol que consulta: authenticated necesita
-- poder llamar a correo_llamador() (devuelve solo su propio correo).
grant execute on function correo_llamador() to authenticated;

-- 2 · Políticas interinas fuera.
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
            where schemaname in ('public', 'interno') and policyname in ('lectura_admin', 'lectura_sesion', 'solo_admin', 'documentos_admin', 'acceso_demo')
  loop execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename); end loop;
end $$;

-- 3 · Políticas por tabla.
-- public.personas
drop policy if exists adm_lectura on public.personas;
drop policy if exists adm_escritura on public.personas;
drop policy if exists propio on public.personas;
drop policy if exists sesion on public.personas;
create policy adm_lectura on public.personas for select to authenticated using ((select public.es_admin()) and (public.fn_alcance_persona(dni) or dni = (select public.fn_persona_llamador())));
create policy propio on public.personas for select to authenticated using (public.fn_es_mi_dni(dni));
-- public.vinculos
drop policy if exists adm_lectura on public.vinculos;
drop policy if exists adm_escritura on public.vinculos;
drop policy if exists propio on public.vinculos;
drop policy if exists sesion on public.vinculos;
create policy adm_lectura on public.vinculos for select to authenticated using ((select public.es_admin()) and public.fn_alcance_empresa(empresa_id));
create policy propio on public.vinculos for select to authenticated using (public.fn_es_mi_dni(persona_dni));
-- public.cuentas_portal
drop policy if exists adm_lectura on public.cuentas_portal;
drop policy if exists adm_escritura on public.cuentas_portal;
drop policy if exists propio on public.cuentas_portal;
drop policy if exists sesion on public.cuentas_portal;
create policy adm_lectura on public.cuentas_portal for select to authenticated using ((select public.nivel_en('personal')) >= 1 and public.fn_alcance_persona(dni));
create policy propio on public.cuentas_portal for select to authenticated using (public.fn_es_mi_dni(dni));
-- public.consentimientos
drop policy if exists adm_lectura on public.consentimientos;
drop policy if exists adm_escritura on public.consentimientos;
drop policy if exists propio on public.consentimientos;
drop policy if exists sesion on public.consentimientos;
create policy adm_lectura on public.consentimientos for select to authenticated using ((select public.nivel_en('personal')) >= 1 and public.fn_alcance_persona(dni));
create policy propio on public.consentimientos for select to authenticated using (public.fn_es_mi_dni(dni));
-- public.solicitudes_cambio_cuenta
drop policy if exists adm_lectura on public.solicitudes_cambio_cuenta;
drop policy if exists adm_escritura on public.solicitudes_cambio_cuenta;
drop policy if exists propio on public.solicitudes_cambio_cuenta;
drop policy if exists sesion on public.solicitudes_cambio_cuenta;
create policy adm_lectura on public.solicitudes_cambio_cuenta for select to authenticated using ((select public.nivel_en('personal')) >= 1 and public.fn_alcance_persona(dni));
create policy propio on public.solicitudes_cambio_cuenta for select to authenticated using (public.fn_es_mi_dni(dni));
-- public.movimientos
drop policy if exists adm_lectura on public.movimientos;
drop policy if exists adm_escritura on public.movimientos;
drop policy if exists propio on public.movimientos;
drop policy if exists sesion on public.movimientos;
create policy adm_lectura on public.movimientos for select to authenticated using ((select public.nivel_en('personal')) >= 1 and public.fn_alcance_persona(persona_dni));
-- public.epp_entregas
drop policy if exists adm_lectura on public.epp_entregas;
drop policy if exists adm_escritura on public.epp_entregas;
drop policy if exists propio on public.epp_entregas;
drop policy if exists sesion on public.epp_entregas;
create policy adm_lectura on public.epp_entregas for select to authenticated using ((select public.nivel_en('personal')) >= 1 and public.fn_alcance_persona(dni));
-- public.horarios_entrada
drop policy if exists adm_lectura on public.horarios_entrada;
drop policy if exists adm_escritura on public.horarios_entrada;
drop policy if exists propio on public.horarios_entrada;
drop policy if exists sesion on public.horarios_entrada;
create policy adm_lectura on public.horarios_entrada for select to authenticated using ((select public.nivel_en('asistencia')) >= 1 and public.fn_alcance_persona(persona_dni));
-- interno.datos_bancarios
drop policy if exists adm_lectura on interno.datos_bancarios;
drop policy if exists adm_escritura on interno.datos_bancarios;
drop policy if exists propio on interno.datos_bancarios;
drop policy if exists sesion on interno.datos_bancarios;
create policy adm_lectura on interno.datos_bancarios for select to authenticated using ((select public.nivel_en('personal')) >= 1 and public.fn_alcance_persona(dni));
create policy propio on interno.datos_bancarios for select to authenticated using (public.fn_es_mi_dni(dni));
-- public.documentos
drop policy if exists adm_lectura on public.documentos;
drop policy if exists adm_escritura on public.documentos;
drop policy if exists propio on public.documentos;
drop policy if exists sesion on public.documentos;
create policy adm_lectura on public.documentos for select to authenticated using ((select public.nivel_en('boletas')) >= 1 and public.fn_alcance_vinculo(vinculo_id));
create policy propio on public.documentos for select to authenticated using (public.fn_mi_vinculo(vinculo_id));
create policy adm_escritura on public.documentos for all to authenticated using ((select public.nivel_en('boletas')) >= 2 and public.fn_alcance_vinculo(vinculo_id)) with check ((select public.nivel_en('boletas')) >= 2 and public.fn_alcance_vinculo(vinculo_id));
-- public.lotes
drop policy if exists adm_lectura on public.lotes;
drop policy if exists adm_escritura on public.lotes;
drop policy if exists propio on public.lotes;
drop policy if exists sesion on public.lotes;
create policy adm_lectura on public.lotes for select to authenticated using ((select public.nivel_en('boletas')) >= 1 and public.fn_alcance_empresa(empresa_id));
-- public.notificaciones_documento
drop policy if exists adm_lectura on public.notificaciones_documento;
drop policy if exists adm_escritura on public.notificaciones_documento;
drop policy if exists propio on public.notificaciones_documento;
drop policy if exists sesion on public.notificaciones_documento;
create policy adm_lectura on public.notificaciones_documento for select to authenticated using ((select public.nivel_en('boletas')) >= 1 and public.fn_alcance_documento(documento_id));
-- public.plantillas
drop policy if exists adm_lectura on public.plantillas;
drop policy if exists adm_escritura on public.plantillas;
drop policy if exists propio on public.plantillas;
drop policy if exists sesion on public.plantillas;
create policy adm_lectura on public.plantillas for select to authenticated using ((select public.nivel_en('boletas')) >= 1 and public.fn_alcance_empresa(empresa_id));
create policy adm_escritura on public.plantillas for all to authenticated using ((select public.nivel_en('boletas')) >= 2 and public.fn_alcance_empresa(empresa_id)) with check ((select public.nivel_en('boletas')) >= 2 and public.fn_alcance_empresa(empresa_id));
-- public.acuses
drop policy if exists adm_lectura on public.acuses;
drop policy if exists adm_escritura on public.acuses;
drop policy if exists propio on public.acuses;
drop policy if exists sesion on public.acuses;
create policy adm_lectura on public.acuses for select to authenticated using ((select public.nivel_en('acuses')) >= 1 and public.fn_alcance_documento(documento_id));
create policy propio on public.acuses for select to authenticated using (public.fn_es_mi_dni(dni_check));
-- public.comunicados
drop policy if exists adm_lectura on public.comunicados;
drop policy if exists adm_escritura on public.comunicados;
drop policy if exists propio on public.comunicados;
drop policy if exists sesion on public.comunicados;
create policy adm_lectura on public.comunicados for select to authenticated using ((select public.nivel_en('comunicados')) >= 1 and public.fn_alcance_empresa(empresa_id));
create policy propio on public.comunicados for select to authenticated using (public.fn_comunicado_me_alcanza(id));
-- public.comunicado_lecturas
drop policy if exists adm_lectura on public.comunicado_lecturas;
drop policy if exists adm_escritura on public.comunicado_lecturas;
drop policy if exists propio on public.comunicado_lecturas;
drop policy if exists sesion on public.comunicado_lecturas;
create policy adm_lectura on public.comunicado_lecturas for select to authenticated using ((select public.nivel_en('comunicados')) >= 1 and public.fn_alcance_persona(dni));
create policy propio on public.comunicado_lecturas for select to authenticated using (public.fn_es_mi_dni(dni));
-- public.memorandums
drop policy if exists adm_lectura on public.memorandums;
drop policy if exists adm_escritura on public.memorandums;
drop policy if exists propio on public.memorandums;
drop policy if exists sesion on public.memorandums;
create policy adm_lectura on public.memorandums for select to authenticated using ((select public.nivel_en('memorandums')) >= 1 and public.fn_alcance_vinculo(vinculo_id));
-- public.descargos
drop policy if exists adm_lectura on public.descargos;
drop policy if exists adm_escritura on public.descargos;
drop policy if exists propio on public.descargos;
drop policy if exists sesion on public.descargos;
create policy adm_lectura on public.descargos for select to authenticated using ((select public.nivel_en('memorandums')) >= 1 and public.fn_alcance_memorandum(memorandum_id));
-- public.tipos_sancion
drop policy if exists adm_lectura on public.tipos_sancion;
drop policy if exists adm_escritura on public.tipos_sancion;
drop policy if exists propio on public.tipos_sancion;
drop policy if exists sesion on public.tipos_sancion;
create policy adm_lectura on public.tipos_sancion for select to authenticated using ((select public.es_admin()));
-- public.rit_faltas
drop policy if exists adm_lectura on public.rit_faltas;
drop policy if exists adm_escritura on public.rit_faltas;
drop policy if exists propio on public.rit_faltas;
drop policy if exists sesion on public.rit_faltas;
create policy adm_lectura on public.rit_faltas for select to authenticated using ((select public.es_admin()));
-- public.rits
drop policy if exists adm_lectura on public.rits;
drop policy if exists adm_escritura on public.rits;
drop policy if exists propio on public.rits;
drop policy if exists sesion on public.rits;
create policy adm_lectura on public.rits for select to authenticated using ((select public.es_admin()));
create policy propio on public.rits for select to authenticated using ((select public.portal_dni()) is not null);
-- public.contratos
drop policy if exists adm_lectura on public.contratos;
drop policy if exists adm_escritura on public.contratos;
drop policy if exists propio on public.contratos;
drop policy if exists sesion on public.contratos;
create policy adm_lectura on public.contratos for select to authenticated using ((select public.nivel_en('contratos')) >= 1 and public.fn_alcance_vinculo(vinculo_id));
-- public.tardanzas
drop policy if exists adm_lectura on public.tardanzas;
drop policy if exists adm_escritura on public.tardanzas;
drop policy if exists propio on public.tardanzas;
drop policy if exists sesion on public.tardanzas;
create policy adm_lectura on public.tardanzas for select to authenticated using ((select public.nivel_en('tardanzas')) >= 1 and public.fn_alcance_persona(dni));
create policy propio on public.tardanzas for select to authenticated using (public.fn_es_mi_dni(dni));
create policy adm_escritura on public.tardanzas for all to authenticated using ((select public.nivel_en('tardanzas')) >= 2 and public.fn_alcance_persona(dni)) with check ((select public.nivel_en('tardanzas')) >= 2 and public.fn_alcance_persona(dni));
-- public.marcaciones
drop policy if exists adm_lectura on public.marcaciones;
drop policy if exists adm_escritura on public.marcaciones;
drop policy if exists propio on public.marcaciones;
drop policy if exists sesion on public.marcaciones;
create policy adm_lectura on public.marcaciones for select to authenticated using ((select public.nivel_en('asistencia')) >= 1 and public.fn_alcance_empresa(empresa_id));
-- public.asistencia_lotes
drop policy if exists adm_lectura on public.asistencia_lotes;
drop policy if exists adm_escritura on public.asistencia_lotes;
drop policy if exists propio on public.asistencia_lotes;
drop policy if exists sesion on public.asistencia_lotes;
create policy adm_lectura on public.asistencia_lotes for select to authenticated using ((select public.nivel_en('asistencia')) >= 1 and public.fn_alcance_empresa(empresa_id));
-- public.asistencia_config
drop policy if exists adm_lectura on public.asistencia_config;
drop policy if exists adm_escritura on public.asistencia_config;
drop policy if exists propio on public.asistencia_config;
drop policy if exists sesion on public.asistencia_config;
create policy adm_lectura on public.asistencia_config for select to authenticated using ((select public.nivel_en('asistencia')) >= 1);
create policy adm_escritura on public.asistencia_config for all to authenticated using ((select public.nivel_en('asistencia')) >= 2) with check ((select public.nivel_en('asistencia')) >= 2);
-- public.feriados
drop policy if exists adm_lectura on public.feriados;
drop policy if exists adm_escritura on public.feriados;
drop policy if exists propio on public.feriados;
drop policy if exists sesion on public.feriados;
create policy adm_lectura on public.feriados for select to authenticated using ((select public.es_admin()));
-- public.activos
drop policy if exists adm_lectura on public.activos;
drop policy if exists adm_escritura on public.activos;
drop policy if exists propio on public.activos;
drop policy if exists sesion on public.activos;
create policy adm_lectura on public.activos for select to authenticated using ((select public.nivel_en('activos')) >= 1 and public.fn_alcance_empresa(empresa_id));
-- public.asignaciones
drop policy if exists adm_lectura on public.asignaciones;
drop policy if exists adm_escritura on public.asignaciones;
drop policy if exists propio on public.asignaciones;
drop policy if exists sesion on public.asignaciones;
create policy adm_lectura on public.asignaciones for select to authenticated using ((select public.nivel_en('activos')) >= 1 and public.fn_alcance_activo(activo_codigo));
-- public.lineas
drop policy if exists adm_lectura on public.lineas;
drop policy if exists adm_escritura on public.lineas;
drop policy if exists propio on public.lineas;
drop policy if exists sesion on public.lineas;
create policy adm_lectura on public.lineas for select to authenticated using ((select public.nivel_en('activos')) >= 1);
create policy adm_escritura on public.lineas for all to authenticated using ((select public.nivel_en('activos')) >= 2) with check ((select public.nivel_en('activos')) >= 2);
-- public.tickets
drop policy if exists adm_lectura on public.tickets;
drop policy if exists adm_escritura on public.tickets;
drop policy if exists propio on public.tickets;
drop policy if exists sesion on public.tickets;
create policy adm_lectura on public.tickets for select to authenticated using ((select public.nivel_en('soporte')) >= 1 and public.fn_alcance_empresa(empresa_id));
create policy propio on public.tickets for select to authenticated using (public.fn_es_mi_dni(solicitante_dni));
-- public.ticket_tipos
drop policy if exists adm_lectura on public.ticket_tipos;
drop policy if exists adm_escritura on public.ticket_tipos;
drop policy if exists propio on public.ticket_tipos;
drop policy if exists sesion on public.ticket_tipos;
create policy sesion on public.ticket_tipos for select to authenticated using (((select public.es_admin()) or (select public.portal_dni()) is not null));
-- public.ticket_subtipos
drop policy if exists adm_lectura on public.ticket_subtipos;
drop policy if exists adm_escritura on public.ticket_subtipos;
drop policy if exists propio on public.ticket_subtipos;
drop policy if exists sesion on public.ticket_subtipos;
create policy sesion on public.ticket_subtipos for select to authenticated using (((select public.es_admin()) or (select public.portal_dni()) is not null));
-- public.ticket_avisos
drop policy if exists adm_lectura on public.ticket_avisos;
drop policy if exists adm_escritura on public.ticket_avisos;
drop policy if exists propio on public.ticket_avisos;
drop policy if exists sesion on public.ticket_avisos;
create policy adm_lectura on public.ticket_avisos for select to authenticated using ((select public.nivel_en('soporte')) >= 1);
-- public.solicitudes
drop policy if exists adm_lectura on public.solicitudes;
drop policy if exists adm_escritura on public.solicitudes;
drop policy if exists propio on public.solicitudes;
drop policy if exists sesion on public.solicitudes;
create policy adm_lectura on public.solicitudes for select to authenticated using (((select public.nivel_en('solicitudes')) >= 1 and public.fn_alcance_empresa(empresa_id)) or solicitante_dni = (select public.fn_persona_llamador()));
create policy propio on public.solicitudes for select to authenticated using (public.fn_es_mi_dni(solicitante_dni));
-- public.solicitud_eventos
drop policy if exists adm_lectura on public.solicitud_eventos;
drop policy if exists adm_escritura on public.solicitud_eventos;
drop policy if exists propio on public.solicitud_eventos;
drop policy if exists sesion on public.solicitud_eventos;
create policy adm_lectura on public.solicitud_eventos for select to authenticated using (public.fn_alcance_solicitud(solicitud_id));
create policy propio on public.solicitud_eventos for select to authenticated using (public.fn_mi_solicitud(solicitud_id));
-- public.solicitud_tipos
drop policy if exists adm_lectura on public.solicitud_tipos;
drop policy if exists adm_escritura on public.solicitud_tipos;
drop policy if exists propio on public.solicitud_tipos;
drop policy if exists sesion on public.solicitud_tipos;
create policy sesion on public.solicitud_tipos for select to authenticated using (((select public.es_admin()) or (select public.portal_dni()) is not null));
-- public.solicitud_avisos
drop policy if exists adm_lectura on public.solicitud_avisos;
drop policy if exists adm_escritura on public.solicitud_avisos;
drop policy if exists propio on public.solicitud_avisos;
drop policy if exists sesion on public.solicitud_avisos;
create policy adm_lectura on public.solicitud_avisos for select to authenticated using ((select public.nivel_en('solicitudes')) >= 1);
-- public.empresas
drop policy if exists adm_lectura on public.empresas;
drop policy if exists adm_escritura on public.empresas;
drop policy if exists propio on public.empresas;
drop policy if exists sesion on public.empresas;
create policy adm_lectura on public.empresas for select to authenticated using ((select public.es_admin()));
create policy propio on public.empresas for select to authenticated using ((select public.portal_dni()) is not null);
create policy adm_escritura on public.empresas for all to authenticated using ((select public.nivel_en('configuracion')) >= 2) with check ((select public.nivel_en('configuracion')) >= 2);
-- public.sedes
drop policy if exists adm_lectura on public.sedes;
drop policy if exists adm_escritura on public.sedes;
drop policy if exists propio on public.sedes;
drop policy if exists sesion on public.sedes;
create policy adm_lectura on public.sedes for select to authenticated using ((select public.es_admin()) and public.fn_alcance_empresa(empresa_id));
create policy propio on public.sedes for select to authenticated using (public.fn_mi_sede(id));
-- public.bancos
drop policy if exists adm_lectura on public.bancos;
drop policy if exists adm_escritura on public.bancos;
drop policy if exists propio on public.bancos;
drop policy if exists sesion on public.bancos;
create policy adm_lectura on public.bancos for select to authenticated using ((select public.es_admin()));
-- public.cargos
drop policy if exists adm_lectura on public.cargos;
drop policy if exists adm_escritura on public.cargos;
drop policy if exists propio on public.cargos;
drop policy if exists sesion on public.cargos;
create policy adm_lectura on public.cargos for select to authenticated using ((select public.es_admin()));
-- public.centros_costo
drop policy if exists adm_lectura on public.centros_costo;
drop policy if exists adm_escritura on public.centros_costo;
drop policy if exists propio on public.centros_costo;
drop policy if exists sesion on public.centros_costo;
create policy adm_lectura on public.centros_costo for select to authenticated using ((select public.es_admin()));
-- public.declaraciones
drop policy if exists adm_lectura on public.declaraciones;
drop policy if exists adm_escritura on public.declaraciones;
drop policy if exists propio on public.declaraciones;
drop policy if exists sesion on public.declaraciones;
create policy sesion on public.declaraciones for select to authenticated using (((select public.es_admin()) or (select public.portal_dni()) is not null));
-- interno.usuarios_admin
drop policy if exists adm_lectura on interno.usuarios_admin;
drop policy if exists adm_escritura on interno.usuarios_admin;
drop policy if exists propio on interno.usuarios_admin;
drop policy if exists sesion on interno.usuarios_admin;
create policy adm_lectura on interno.usuarios_admin for select to authenticated using ((select public.nivel_en('accesos')) >= 1 or lower(correo) = (select public.correo_llamador()));
-- interno.perfiles
drop policy if exists adm_lectura on interno.perfiles;
drop policy if exists adm_escritura on interno.perfiles;
drop policy if exists propio on interno.perfiles;
drop policy if exists sesion on interno.perfiles;
create policy adm_lectura on interno.perfiles for select to authenticated using ((select public.nivel_en('accesos')) >= 1 or public.fn_mi_perfil(id, version));
-- interno.perfil_permisos
drop policy if exists adm_lectura on interno.perfil_permisos;
drop policy if exists adm_escritura on interno.perfil_permisos;
drop policy if exists propio on interno.perfil_permisos;
drop policy if exists sesion on interno.perfil_permisos;
create policy adm_lectura on interno.perfil_permisos for select to authenticated using ((select public.nivel_en('accesos')) >= 1 or public.fn_mi_perfil(perfil_id, perfil_version));
-- interno.perfil_empresas
drop policy if exists adm_lectura on interno.perfil_empresas;
drop policy if exists adm_escritura on interno.perfil_empresas;
drop policy if exists propio on interno.perfil_empresas;
drop policy if exists sesion on interno.perfil_empresas;
create policy adm_lectura on interno.perfil_empresas for select to authenticated using ((select public.nivel_en('accesos')) >= 1 or public.fn_mi_perfil(perfil_id, version));
-- interno.perfil_propuestas
drop policy if exists adm_lectura on interno.perfil_propuestas;
drop policy if exists adm_escritura on interno.perfil_propuestas;
drop policy if exists propio on interno.perfil_propuestas;
drop policy if exists sesion on interno.perfil_propuestas;
create policy adm_lectura on interno.perfil_propuestas for select to authenticated using ((select public.nivel_en('accesos')) >= 1);
-- interno.cargo_perfiles
drop policy if exists adm_lectura on interno.cargo_perfiles;
drop policy if exists adm_escritura on interno.cargo_perfiles;
drop policy if exists propio on interno.cargo_perfiles;
drop policy if exists sesion on interno.cargo_perfiles;
create policy adm_lectura on interno.cargo_perfiles for select to authenticated using ((select public.nivel_en('accesos')) >= 1);
-- interno.registro_accesos
drop policy if exists adm_lectura on interno.registro_accesos;
drop policy if exists adm_escritura on interno.registro_accesos;
drop policy if exists propio on interno.registro_accesos;
drop policy if exists sesion on interno.registro_accesos;
create policy adm_lectura on interno.registro_accesos for select to authenticated using ((select public.nivel_en('auditoria')) >= 1 or (select public.nivel_en('accesos')) >= 1);
-- interno.politica_acceso
drop policy if exists adm_lectura on interno.politica_acceso;
drop policy if exists adm_escritura on interno.politica_acceso;
drop policy if exists propio on interno.politica_acceso;
drop policy if exists sesion on interno.politica_acceso;
create policy adm_lectura on interno.politica_acceso for select to authenticated using ((select public.es_admin()));
-- interno.auditoria
drop policy if exists adm_lectura on interno.auditoria;
drop policy if exists adm_escritura on interno.auditoria;
drop policy if exists propio on interno.auditoria;
drop policy if exists sesion on interno.auditoria;
create policy adm_lectura on interno.auditoria for select to authenticated using ((select public.nivel_en('auditoria')) >= 1 or ((select public.nivel_en('personal')) >= 1 and public.fn_alcance_persona(public.fn_dni_auditoria(datos_antes, datos_despues))));

-- 4 · Bucket «documentos»: conocer la ruta no basta. Lectura y escritura por
--     prefijo de ruta, módulo y (donde la ruta la lleva) razón social. El Portal
--     descarga por la API (llave de servicio + comprobación del dueño), no directo.
drop policy if exists documentos_leer on storage.objects;
drop policy if exists documentos_subir on storage.objects;
drop policy if exists documentos_actualizar on storage.objects;
create policy documentos_leer on storage.objects for select to authenticated using (
  bucket_id = 'documentos' and (
       (name like 'lotes/%' and (select public.nivel_en('boletas')) >= 1 and public.fn_alcance_empresa(split_part(name, '/', 2)))
    or (name like 'cargos/%' and (select public.nivel_en('acuses')) >= 1)
    or (name like 'rit/%' and (select public.es_admin()))
    or (name like 'solicitudes/adjuntos/%' and (select public.nivel_en('solicitudes')) >= 1)
    or (name like 'solicitudes/%' and name not like 'solicitudes/adjuntos/%' and (select public.nivel_en('solicitudes')) >= 1 and public.fn_alcance_empresa(split_part(name, '/', 2)))
  ));
create policy documentos_subir on storage.objects for insert to authenticated with check (
  bucket_id = 'documentos' and (
       (name like 'lotes/%' and (select public.nivel_en('boletas')) >= 2 and public.fn_alcance_empresa(split_part(name, '/', 2)))
    or (name like 'cargos/%' and (select public.nivel_en('acuses')) >= 2)
    or (name like 'rit/%' and ((select public.nivel_en('configuracion')) >= 2 or (select public.nivel_en('personal')) >= 2))
    or (name like 'solicitudes/adjuntos/%' and ((select public.nivel_en('solicitudes')) >= 1 or (select public.portal_dni()) is not null))
  ));
create policy documentos_actualizar on storage.objects for update to authenticated
  using (bucket_id = 'documentos' and (
       (name like 'lotes/%' and (select public.nivel_en('boletas')) >= 2 and public.fn_alcance_empresa(split_part(name, '/', 2)))
    or (name like 'cargos/%' and (select public.nivel_en('acuses')) >= 2)
    or (name like 'rit/%' and ((select public.nivel_en('configuracion')) >= 2 or (select public.nivel_en('personal')) >= 2))))
  with check (bucket_id = 'documentos');

-- 5 · Las 9 vistas del Portal corren con los permisos del trabajador.
alter view public.v_portal_boletas set (security_invoker = on);
alter view public.v_portal_comunicados set (security_invoker = on);
alter view public.v_portal_datos set (security_invoker = on);
alter view public.v_portal_mes set (security_invoker = on);
alter view public.v_portal_pendientes set (security_invoker = on);
alter view public.v_portal_perfil set (security_invoker = on);
alter view public.v_portal_rit set (security_invoker = on);
alter view public.v_portal_solicitudes set (security_invoker = on);
alter view public.v_portal_tickets set (security_invoker = on);

-- @@FASE4-FIN@@

-- @@FASE5-INICIO@@ (generado por scripts/fase5-generar.mjs desde supabase/auditoria.sql; no editar a mano)
-- 13 · Fase 5a: auditoría sin valores sensibles (la redacción del histórico, 5b, es una migración de datos).
-- supabase/auditoria.sql — Corrección de seguridad · FASE 5 (2026-09-18):
-- AUDITORÍA SIN VALORES SENSIBLES.
--
-- Canónico de la fase 5a. Lo embebe la migración
-- migraciones/2026-09-18-fase5a-auditoria-sensible.sql y el bloque @@FASE5@@
-- de seguridad.sql. Idempotente.
--
--  · interno.columnas_sensibles: la LISTA DEFINIDA (tabla, columna) cuyos
--    valores nunca deben quedar en la auditoría. Editarla es una migración.
--  · fn_auditar: para esas columnas registra que hubo cambio, no el valor
--    («[sensible]» / «[sensible: cambiado]»; null se conserva como null).
--  · fn_redactar_historico: la regla que aplica la migración de redacción del
--    histórico (fase 5b), única, aprobada y registrada en la propia auditoría.

create table if not exists interno.columnas_sensibles (
  tabla   text not null,
  columna text not null,
  motivo  text not null,
  primary key (tabla, columna)
);
revoke all on table interno.columnas_sensibles from public, anon, authenticated;
insert into interno.columnas_sensibles (tabla, columna, motivo) values
  ('usuarios_admin', 'clave_provisional', 'clave de acceso (hoy siempre null; la API no la guarda)'),
  ('usuarios_admin', 'sesion_actual',     'marcador de sesión única del BackOffice'),
  ('cuentas_portal', 'sesion_actual',     'marcador de sesión única del Portal'),
  ('personas',       'cuenta',            'cuenta bancaria en claro (columna retirada en la fase 3b; regla defensiva)'),
  ('personas',       'cci',               'CCI en claro (columna retirada en la fase 3b; regla defensiva)'),
  ('personas',       'cuenta_cifrada',    'cuenta cifrada (columna retirada en la fase 3b; regla defensiva)'),
  ('activos',        'clave_equipo',      'clave de equipo (columna retirada en la fase 3c; regla defensiva)')
on conflict (tabla, columna) do update set motivo = excluded.motivo;

create or replace function fn_auditar() returns trigger
language plpgsql security definer set search_path = public, interno, extensions as $$
declare j_antes jsonb; j_despues jsonb; c record; v_cambio boolean;
begin
  j_antes := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  j_despues := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  for c in select columna from interno.columnas_sensibles where tabla = tg_table_name loop
    v_cambio := (j_antes -> c.columna) is distinct from (j_despues -> c.columna);
    if j_antes ? c.columna and (j_antes -> c.columna) <> 'null'::jsonb then
      j_antes := jsonb_set(j_antes, array[c.columna], '"[sensible]"'::jsonb);
    end if;
    if j_despues ? c.columna and (j_despues -> c.columna) <> 'null'::jsonb then
      j_despues := jsonb_set(j_despues, array[c.columna], case when v_cambio then '"[sensible: cambiado]"'::jsonb else '"[sensible]"'::jsonb end);
    end if;
  end loop;
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values (tg_op, tg_table_name, j_antes, j_despues);
  return coalesce(new, old);
end $$;

-- Regla de redacción del histórico: las claves de secretos con valor pasan a
-- «[redactado 2026-09-18]»; el resto de la fila queda intacto.
create or replace function fn_redactar_historico(p_datos jsonb) returns jsonb
language sql immutable as $$
  select case when p_datos is null then null else (
    select coalesce(jsonb_object_agg(e.key,
      case when e.key in ('cci', 'cuenta', 'cuenta_cifrada', 'clave_provisional', 'clave_equipo', 'sesion_actual')
                and e.value <> 'null'::jsonb and (e.value #>> '{}') <> ''
           then '"[redactado 2026-09-18]"'::jsonb else e.value end), '{}'::jsonb)
    from jsonb_each(p_datos) e) end
$$;
revoke all on function fn_redactar_historico(jsonb) from public, anon, authenticated;

-- @@FASE5-FIN@@

-- @@FASE6-INICIO@@ (generado por scripts/fase6-generar.mjs desde supabase/limites.sql; no editar a mano)
-- 14 · Fase 6b: identidad con fallo cerrado, bitácora de login con IP real y fuente, compuerta de login para el proxy, piso de clave del BackOffice.
-- supabase/limites.sql — Corrección de seguridad · FASE 6b (2026-09-21):
-- LÍMITES E IDENTIDAD.
--
-- Canónico de la fase 6b. Lo embebe la migración
-- migraciones/2026-09-21-fase6-limites.sql y el bloque @@FASE6@@ de
-- seguridad.sql. Idempotente. Se aplica con search_path = public, interno.
--
--  1 · fn_nivel_modulo: fallo cerrado sin JWT. Una sesión cuyo rol activo es
--      authenticated o anon vale 0 aunque no traiga claims (hallazgo de la
--      fase 4); 99 queda solo para postgres/supabase_admin y el rol de servicio.
--  2 · registro_accesos.fuente: quién anotó la fila. «cliente» (RPC desde el
--      navegador, sin sesión) o «proxy» (api_login_registrar, con la llave de
--      servicio, tras una respuesta real de Auth). Para el bloqueo por intentos
--      solo cuentan los fallos del proxy: nadie puede bloquear a otro anotando
--      fallos falsos.
--  3 · registrar_ingreso / portal_registrar_ingreso: un «exitoso» solo lo
--      registra la propia sesión (JWT con ese correo); guardan la IP real
--      (x-ip-real, que el proxy genera y el cliente no puede fijar).
--  4 · api_login_permitido / api_login_registrar: compuerta de login que aplica
--      el proxy ANTES de hablar con Auth: por cuenta (la política vigente) y por
--      IP real (30 fallos en 15 minutos).
--  5 · Piso de 10 caracteres para la clave del BackOffice (P11); el Portal
--      sigue en 6 (decisión de Diego del 2026-08-21).

-- 1 · Identidad sin JWT --------------------------------------------------------
create or replace function public.fn_nivel_modulo(p_modulo text)
returns int language plpgsql stable security definer set search_path = public, interno, extensions as $$
declare v_correo text; v_nivel int; v_rol text;
begin
  begin
    v_correo := nullif(auth.jwt() ->> 'email', '');
  exception when others then
    v_correo := null;
  end;
  if v_correo is null then
    -- Sin correo en el JWT hay dos casos legítimos con privilegio: el rol de
    -- servicio (claims de PostgREST con role=service_role) y una sesión
    -- directa de postgres/supabase_admin (Management API, migraciones).
    -- Fase 6b: se mira el rol ACTIVO (SET ROLE, GUC role) antes que el de la
    -- sesión; dentro de un SECURITY DEFINER current_user es el dueño, por eso
    -- no sirve. Una sesión con rol activo authenticated/anon sin claims vale 0.
    v_rol := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
                      nullif(current_setting('role', true), 'none'),
                      session_user::text);
    if v_rol in ('authenticated', 'anon') then return 0; end if;
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

-- 2 · Fuente del registro de accesos ------------------------------------------
alter table interno.registro_accesos add column if not exists fuente text not null default 'cliente';
alter table interno.registro_accesos drop constraint if exists chk_registro_fuente;
alter table interno.registro_accesos add constraint chk_registro_fuente check (fuente in ('cliente', 'proxy'));
create index if not exists registro_accesos_ip_idx on interno.registro_accesos (ip, fecha) where fuente = 'proxy';

-- 3 · Bitácoras de login ----------------------------------------------------------
create or replace function public.registrar_ingreso(p_correo text, p_resultado text, p_dispositivo text)
returns void language plpgsql security definer set search_path = public, interno, extensions as $$
declare u usuarios_admin%rowtype; v_correo text := lower(trim(coalesce(p_correo, '')));
begin
  if v_correo = '' then raise exception 'Falta el correo.'; end if;
  if p_resultado not in ('exitoso', 'fallido', 'bloqueado') then raise exception 'Resultado inválido.'; end if;
  -- Un ingreso «exitoso» solo lo registra la propia sesión. Antes cualquiera
  -- podía anotarlo sin sesión y reiniciar así el bloqueo de cualquier cuenta.
  if p_resultado = 'exitoso' and correo_llamador() is distinct from v_correo then
    raise insufficient_privilege using message = 'Solo la propia sesión puede registrar un ingreso exitoso.';
  end if;
  select * into u from usuarios_admin where lower(correo) = v_correo;
  insert into registro_accesos (usuario_id, dni, correo, perfil_id, perfil_version, superficie, resultado, ip, dispositivo, fuente)
  values (u.id, u.persona_dni, v_correo, u.perfil_id, u.perfil_version, 'backoffice', p_resultado,
          fn_cabecera('x-ip-real'), left(p_dispositivo, 200), 'cliente');
  if p_resultado = 'exitoso' and u.id is not null then
    update usuarios_admin set ultimo_ingreso = now() where id = u.id;
  end if;
end $$;

create or replace function public.portal_registrar_ingreso(p_dni text, p_resultado text, p_dispositivo text)
returns void language plpgsql security definer set search_path = public, interno, extensions as $$
declare v_dni text := trim(coalesce(p_dni, ''));
begin
  if v_dni = '' then raise exception 'Falta el documento.'; end if;
  if p_resultado not in ('exitoso', 'fallido', 'bloqueado') then raise exception 'Resultado inválido.'; end if;
  if p_resultado = 'exitoso' and correo_llamador() is distinct from lower(v_dni) || '@portal.grupoer.pe' then
    raise insufficient_privilege using message = 'Solo la propia sesión puede registrar un ingreso exitoso.';
  end if;
  insert into registro_accesos (dni, superficie, resultado, ip, dispositivo, fuente)
  values (v_dni, 'portal', p_resultado, fn_cabecera('x-ip-real'), left(p_dispositivo, 200), 'cliente');
  if p_resultado = 'exitoso' then
    update personas
    set portal = case when coalesce((select sin_celular from cuentas_portal c where c.dni = v_dni), false)
                      then 'sin_celular' else 'activo' end
    where dni = v_dni and portal <> 'suspendido';
  end if;
end $$;

-- Bloqueo por intentos: fallos consecutivos ANOTADOS POR EL PROXY posteriores
-- al último ingreso exitoso, dentro de la ventana de la política.
create or replace function public.verificar_bloqueo(p_correo text) returns boolean
language plpgsql stable security definer set search_path = public, interno, extensions as $$
declare pol politica_acceso%rowtype; ultimo_ok timestamptz; fallidos int; v_correo text := lower(trim(coalesce(p_correo, '')));
begin
  select * into pol from politica_acceso where id = 1;
  select max(fecha) into ultimo_ok from registro_accesos
  where lower(correo) = v_correo and superficie = 'backoffice' and resultado = 'exitoso';
  select count(*) into fallidos from registro_accesos
  where lower(correo) = v_correo and superficie = 'backoffice' and resultado = 'fallido' and fuente = 'proxy'
    and fecha > now() - make_interval(mins => pol.bloqueo_minutos)
    and (ultimo_ok is null or fecha > ultimo_ok);
  return fallidos >= pol.intentos_bloqueo;
end $$;

create or replace function public.portal_verificar_bloqueo(p_dni text) returns boolean
language plpgsql stable security definer set search_path = public, interno, extensions as $$
declare pol politica_acceso%rowtype; ultimo_ok timestamptz; fallidos int; v_dni text := lower(trim(coalesce(p_dni, '')));
begin
  select * into pol from politica_acceso where id = 1;
  select max(fecha) into ultimo_ok from registro_accesos
  where lower(dni) = v_dni and superficie = 'portal' and resultado = 'exitoso';
  select count(*) into fallidos from registro_accesos
  where lower(dni) = v_dni and superficie = 'portal' and resultado = 'fallido' and fuente = 'proxy'
    and fecha > now() - make_interval(mins => pol.bloqueo_minutos)
    and (ultimo_ok is null or fecha > ultimo_ok);
  return fallidos >= pol.intentos_bloqueo;
end $$;

-- 4 · Compuerta de login (solo la llave de servicio: la aplica el proxy) --------
-- Límite por IP real: fallos anotados por el proxy desde esa IP, en cualquier
-- cuenta y superficie. 30 en 15 minutos: una oficina con NAT compartido no lo
-- alcanza tecleando mal; un ataque sí.
create or replace function public.api_login_permitido(p_ip text, p_correo text)
returns jsonb language plpgsql stable security definer set search_path = public, interno, extensions as $$
declare v_correo text := lower(trim(coalesce(p_correo, ''))); v_ip text := left(trim(coalesce(p_ip, '')), 64); n int;
begin
  if v_ip <> '' then
    select count(*) into n from registro_accesos
    where ip = v_ip and fuente = 'proxy' and resultado = 'fallido' and fecha > now() - interval '15 minutes';
    if n >= 30 then return jsonb_build_object('permitido', false, 'motivo', 'ip'); end if;
  end if;
  if v_correo like '%@portal.grupoer.pe' then
    if portal_verificar_bloqueo(split_part(v_correo, '@', 1)) then return jsonb_build_object('permitido', false, 'motivo', 'cuenta'); end if;
  elsif v_correo <> '' then
    if verificar_bloqueo(v_correo) then return jsonb_build_object('permitido', false, 'motivo', 'cuenta'); end if;
  end if;
  return jsonb_build_object('permitido', true);
end $$;

-- El proxy anota lo que Auth respondió de verdad (fallido) o lo que él mismo
-- negó (bloqueado). La superficie y el documento salen del correo técnico.
create or replace function public.api_login_registrar(p_correo text, p_resultado text, p_ip text, p_agente text)
returns void language plpgsql security definer set search_path = public, interno, extensions as $$
declare u usuarios_admin%rowtype; v_correo text := lower(trim(coalesce(p_correo, '')));
begin
  if v_correo = '' then return; end if;
  if p_resultado not in ('fallido', 'bloqueado') then raise exception 'Resultado inválido para el proxy.'; end if;
  if v_correo like '%@portal.grupoer.pe' then
    insert into registro_accesos (dni, superficie, resultado, ip, dispositivo, fuente)
    values (upper(split_part(v_correo, '@', 1)), 'portal', p_resultado, left(trim(coalesce(p_ip, '')), 64), left(p_agente, 200), 'proxy');
  else
    select * into u from usuarios_admin where lower(correo) = v_correo;
    insert into registro_accesos (usuario_id, dni, correo, perfil_id, perfil_version, superficie, resultado, ip, dispositivo, fuente)
    values (u.id, u.persona_dni, v_correo, u.perfil_id, u.perfil_version, 'backoffice', p_resultado,
            left(trim(coalesce(p_ip, '')), 64), left(p_agente, 200), 'proxy');
  end if;
end $$;

revoke all on function api_login_permitido(text, text), api_login_registrar(text, text, text, text) from public, anon, authenticated;
grant execute on function api_login_permitido(text, text), api_login_registrar(text, text, text, text) to service_role;

-- 5 · Piso de la clave del BackOffice (P11) --------------------------------------
alter table interno.politica_acceso drop constraint if exists chk_clave_min_backoffice;
update interno.politica_acceso set clave_longitud_min_backoffice = 10 where id = 1 and clave_longitud_min_backoffice < 10;
alter table interno.politica_acceso alter column clave_longitud_min_backoffice set default 10;
alter table interno.politica_acceso add constraint chk_clave_min_backoffice check (clave_longitud_min_backoffice >= 10);

create or replace function public.guardar_politica(
  p_backoffice_horas int, p_portal_dias int,
  p_multisesion_backoffice boolean, p_multisesion_portal boolean,
  p_intentos int, p_bloqueo_min int, p_recuperacion text,
  p_clave_min_portal int, p_clave_min_backoffice int,
  p_provisional_dias int, p_por text
) returns void language plpgsql security definer set search_path = public, interno, extensions as $$
begin
  perform requiere_superadmin();  -- fase 1: guarda central
  if coalesce(p_clave_min_backoffice, 0) < 10 then raise exception 'La clave del BackOffice exige al menos 10 caracteres (P11).'; end if;
  if coalesce(p_clave_min_portal, 0) < 6 then raise exception 'La clave del Portal exige al menos 6 caracteres.'; end if;
  update politica_acceso
  set sesion_backoffice_horas       = p_backoffice_horas,
      sesion_portal_dias            = p_portal_dias,
      multisesion_backoffice        = p_multisesion_backoffice,
      multisesion_portal            = p_multisesion_portal,
      intentos_bloqueo              = p_intentos,
      bloqueo_minutos               = p_bloqueo_min,
      recuperacion_defecto          = p_recuperacion,
      clave_longitud_min_portal     = p_clave_min_portal,
      clave_longitud_min_backoffice = p_clave_min_backoffice,
      clave_provisional_dias        = p_provisional_dias,
      actualizado_por               = p_por,
      actualizado_en                = now()
  where id = 1;
end $$;

-- @@FASE6-FIN@@
