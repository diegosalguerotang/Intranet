# Funciones y permisos — clasificación (fase 1, 2026-09-17)

Fuente: foto del paso 0 (`supabase/respaldos/2026-09-17-paso0-funciones.json`) + decisiones de la fase 1 (`scripts/fase1-generar.mjs`, tabla GUARDAS).
Regenerar con `node scripts/fase1-generar.mjs migracion`.

Grupos: **pre-login** (sin sesión), **autoservicio del trabajador** (identidad derivada del JWT, sin parámetros de identidad),
**administrativa** (guarda central: `requiere_nivel(modulo, nivel[, modulo_alternativo])` o `requiere_superadmin()`; las anteriores a la fase 1 mantienen su guarda propia sobre `fn_nivel_modulo`, que es la misma regla), **interna** (sin EXECUTE para nadie salvo service_role).

Ayudantes de la fase 1 (SECURITY DEFINER, STABLE, search_path fijo): `correo_llamador()`, `es_admin()`, `es_superadmin()`, `nivel_en(modulo)`, `requiere_nivel(modulo, nivel, modulo_alternativo)`, `requiere_superadmin()`, `requiere_correo_propio(correo)`. Los tres primeros son consultables por el cliente; los `requiere_*` lanzan `insufficient_privilege` (42501).

Regla de nacimiento: `ALTER DEFAULT PRIVILEGES` deja toda función nueva SIN EXECUTE para authenticated; el grant es explícito y está listado en `supabase/seguridad.sql`.

| Función | Grupo | Guarda / regla | EXECUTE |
|---|---|---|---|
| `actualizar_ticket(p_id bigint, p_estado text, p_atendido_por text, p_nota text, p_por text)` | administrativa | guarda propia: fn_nivel_modulo | authenticated |
| `actualizar_usuario_admin(p_id bigint, p_perfil text, p_correo text, p_celular text, p_estado text)` | administrativa | accesos · nivel superadmin | authenticated |
| `alta_trabajador(p_dni text, p_nombre text, p_cargo text, p_sede text, p_empresa text, p_ingreso date, p_celular text, p_banco text, p_cuenta text, p_correo text, p_cci text, p_tipo_documento text)` | administrativa | personal · nivel 2 | authenticated |
| `alternar_ticket_subtipo(p_id integer, p_activo boolean)` | administrativa | guarda propia: fn_nivel_modulo | authenticated |
| `alternar_ticket_tipo(p_id integer, p_activo boolean)` | administrativa | guarda propia: fn_nivel_modulo | authenticated |
| `asignar_activo(p_codigo text, p_dni text, p_condicion text, p_antivirus boolean, p_comentario text)` | administrativa | activos · nivel 2 | authenticated |
| `asignar_activo(p_codigo text, p_dni text, p_condicion text)` | eliminada | sobrecarga huérfana sin uso; se elimina en la fase 1 | no |
| `asignar_rit_sede(p_sede text, p_rit text)` | administrativa | guarda propia: fn_nivel_modulo | authenticated |
| `crear_activo(p_codigo text, p_categoria text, p_empresa text, p_tipo text, p_marca text, p_modelo text, p_serie text, p_imei text, p_valor numeric, p_compra date, p_observaciones text)` | administrativa | guarda propia: fn_nivel_modulo, fn_persona_llamador | authenticated |
| `crear_rit(p_nombre text, p_archivo text, p_hash text, p_vigente date)` | administrativa | guarda propia: fn_nivel_modulo | authenticated |
| `crear_sede(p_empresa text, p_nombre text, p_cliente text, p_direccion text, p_por text, p_rit text)` | administrativa | configuracion o personal · nivel 2 | authenticated |
| `crear_solicitud_admin(p_dni text, p_tipo text, p_datos jsonb, p_por text)` | administrativa | guarda propia: fn_nivel_modulo | authenticated |
| `crear_solicitud_propia(p_tipo text, p_datos jsonb)` | autoservicio del trabajador | fn_persona_llamador | authenticated |
| `crear_ticket_admin(p_dni text, p_tipo integer, p_subtipo integer, p_comentario text, p_por text)` | administrativa | guarda propia: fn_nivel_modulo | authenticated |
| `crear_usuario_admin(p_dni text, p_perfil text, p_correo text, p_celular text, p_clave text, p_por text)` | administrativa | accesos · nivel superadmin | authenticated |
| `decidir_propuesta_perfil(p_id bigint, p_decision text, p_por text)` | administrativa | guarda propia: fn_nivel_modulo | authenticated |
| `desactivar_perfil(p_id text)` | administrativa | accesos · nivel superadmin | authenticated |
| `devolver_activo(p_codigo text, p_destino text, p_condicion text)` | administrativa | activos · nivel 2 | authenticated |
| `editar_activo(p_codigo text, p_nuevo_codigo text, p_tipo text, p_marca text, p_modelo text, p_serie text, p_area text, p_asignado_sin_confirmar text, p_observaciones text, p_por text, p_ip text)` | administrativa | activos · nivel 2 | authenticated |
| `editar_trabajador(p_dni text, p_nombre text, p_celular text, p_correo text, p_banco text, p_cuenta text, p_cci text, p_tipo_documento text)` | administrativa | guarda propia: fn_nivel_modulo | authenticated |
| `eliminar_feriado(p_fecha date, p_por text)` | administrativa | guarda propia: fn_nivel_modulo | authenticated |
| `eliminar_perfil(p_id text)` | administrativa | accesos · nivel superadmin | authenticated |
| `eliminar_sede(p_sede text)` | administrativa | guarda propia: fn_nivel_modulo | authenticated |
| `eliminar_solicitud_aviso(p_id bigint)` | administrativa | guarda propia: fn_nivel_modulo | authenticated |
| `eliminar_ticket_aviso(p_correo text)` | administrativa | guarda propia: fn_nivel_modulo | authenticated |
| `eliminar_trabajador(p_dni text)` | administrativa | personal · nivel 3 | authenticated |
| `eliminar_usuario_admin(p_id bigint)` | administrativa | accesos · nivel superadmin (solo api/admin-usuarios.js con llave de servicio) | solo service_role |
| `emitir_memorandum(p_dni text, p_tipo_sancion text, p_falta_id bigint, p_motivo text, p_suspension_dias integer, p_por text)` | administrativa | guarda propia: fn_nivel_memorandums | authenticated |
| `es_admin_activo()` | administrativa | guarda propia: auth_uid | authenticated |
| `fijar_correo_persona(p_dni text, p_correo text)` | administrativa | guarda propia: fn_nivel_modulo | authenticated |
| `fijar_hora_entrada(p_dni text, p_hora time without time zone, p_desde date, p_por text)` | administrativa | guarda propia: fn_nivel_modulo | authenticated |
| `fn_cabecera(p_nombre text)` | interna | solo la llaman otras funciones (security definer) o vistas | ninguno (service_role) |
| `fn_cifrar_cuenta(p_texto text)` | interna | solo la llaman otras funciones (security definer) o vistas | ninguno (service_role) |
| `fn_clave_cuentas()` | interna | solo la llaman otras funciones (security definer) o vistas | ninguno (service_role) |
| `fn_descifrar_cuenta(p_cifrado bytea)` | interna | solo la llaman otras funciones (security definer) o vistas | ninguno (service_role) |
| `fn_es_prefijo_truncado(p_nuevo text, p_actual text)` | interna | solo la llaman otras funciones (security definer) o vistas | ninguno (service_role) |
| `fn_hora_entrada(p_dni text, p_fecha date)` | administrativa | guarda propia:  | authenticated |
| `fn_min_hhmm(t text)` | interna | solo la llaman otras funciones (security definer) o vistas | ninguno (service_role) |
| `fn_nivel_memorandums()` | administrativa | guarda propia: auth_jwt | authenticated |
| `fn_nivel_modulo(p_modulo text)` | administrativa | guarda propia: auth_jwt, jwt_claims, current_setting | authenticated |
| `fn_perfil_para_cargo(p_cargo text)` | interna | solo la llaman otras funciones (security definer) o vistas | ninguno (service_role) |
| `fn_persona_llamador()` | administrativa | guarda propia: auth_jwt | authenticated |
| `fn_recalcular_control(p_documento text, p_desde date, p_hasta date, p_motivo text)` | interna | solo la llaman otras funciones (security definer) o vistas | ninguno (service_role) |
| `fn_recalcular_mes_feriado(p_fecha date, p_motivo text)` | interna | solo la llaman otras funciones (security definer) o vistas | ninguno (service_role) |
| `fn_resolver_banco(p_texto text)` | interna | solo la llaman otras funciones (security definer) o vistas | ninguno (service_role) |
| `fn_sede_para_importacion(p_empresa text, p_sede text, p_cliente text)` | interna | solo la llaman otras funciones (security definer) o vistas | ninguno (service_role) |
| `fn_solicitud_insertar(p_dni text, p_tipo text, p_datos jsonb, p_por text)` | administrativa | guarda propia: fn_persona_llamador | authenticated |
| `fn_solicitud_numero(p_tipo text, p_empresa text)` | interna | solo la llaman otras funciones (security definer) o vistas | ninguno (service_role) |
| `fn_solicitud_validar(p_tipo text, p_datos jsonb)` | interna | solo la llaman otras funciones (security definer) o vistas | ninguno (service_role) |
| `fn_sumar_dias(p_desde date, p_dias integer, p_habiles boolean)` | interna | solo la llaman otras funciones (security definer) o vistas | ninguno (service_role) |
| `fn_ticket_insertar(p_dni text, p_tipo integer, p_subtipo integer, p_comentario text)` | interna | solo la llaman otras funciones (security definer) o vistas | ninguno (service_role) |
| `fn_ticket_numero()` | interna | solo la llaman otras funciones (security definer) o vistas | ninguno (service_role) |
| `fn_validar_documento(p_tipo text, p_numero text)` | interna | solo la llaman otras funciones (security definer) o vistas | ninguno (service_role) |
| `fn_valor_importado(p_nuevo text, p_actual text)` | interna | solo la llaman otras funciones (security definer) o vistas | ninguno (service_role) |
| `fn_ver_cuenta_bancaria(p_dni text)` | administrativa | guarda propia: auth_jwt | authenticated |
| `guardar_cargo_perfil(p_cargo text, p_destino text, p_perfil text, p_por text)` | administrativa | guarda propia: fn_nivel_modulo | authenticated |
| `guardar_clave_equipo(p_codigo text, p_clave text, p_por text)` | administrativa | guarda propia: fn_nivel_modulo | authenticated |
| `guardar_feriado(p_fecha date, p_nombre text, p_por text)` | administrativa | guarda propia: fn_nivel_modulo | authenticated |
| `guardar_perfil(p_id text, p_nombre text, p_descripcion text, p_superadmin boolean, p_ver_remuneracion boolean, p_ver_documentos boolean, p_exportar boolean, p_matriz jsonb, p_empresas text[], p_por text, p_ver_bancarios boolean)` | administrativa | accesos · nivel superadmin | authenticated |
| `guardar_politica(p_backoffice_horas integer, p_portal_dias integer, p_multisesion_backoffice boolean, p_multisesion_portal boolean, p_intentos integer, p_bloqueo_min integer, p_recuperacion text, p_clave_min_portal integer, p_clave_min_backoffice integer, p_provisional_dias integer, p_por text)` | administrativa | accesos · nivel superadmin | authenticated |
| `guardar_solicitud_aviso(p_tipo text, p_correo text, p_copia boolean, p_activo boolean)` | administrativa | guarda propia: fn_nivel_modulo | authenticated |
| `guardar_ticket_aviso(p_correo text, p_activo boolean)` | administrativa | guarda propia: fn_nivel_modulo | authenticated |
| `guardar_ticket_subtipo(p_id integer, p_tipo integer, p_nombre text)` | administrativa | guarda propia: fn_nivel_modulo | authenticated |
| `guardar_ticket_tipo(p_id integer, p_nombre text)` | administrativa | guarda propia: fn_nivel_modulo | authenticated |
| `importar_activos(p_empresa text, p_activos jsonb, p_razon_social text, p_archivo text, p_por text)` | administrativa | activos · nivel 2 | authenticated |
| `importar_asistencia(p_empresa text, p_registros jsonb, p_archivo text, p_resumen jsonb, p_por text)` | administrativa | guarda propia: fn_nivel_modulo | authenticated |
| `importar_control(p_registros jsonb, p_trabajadores jsonb, p_archivo text, p_por text)` | administrativa | guarda propia: auth_jwt, fn_nivel_modulo | authenticated |
| `importar_padron(p_filas jsonb, p_por text, p_ceses jsonb)` | administrativa | guarda propia: auth_jwt, fn_nivel_modulo | authenticated |
| `importar_planilla(p_empresa text, p_filas jsonb, p_por text)` | interna | solo la llaman otras funciones (security definer) o vistas | ninguno (service_role) |
| `importar_planilla_unificada(p_filas jsonb, p_periodo text, p_por text, p_ceses jsonb)` | administrativa | guarda propia: auth_jwt | authenticated |
| `marcar_clave_cambiada(p_correo text)` | administrativa | accesos · nivel el propio administrador (su correo) | authenticated |
| `mi_sesion_backoffice()` | administrativa | guarda propia: auth_uid | authenticated |
| `notificar_memorandum(p_id text)` | administrativa | memorandums · nivel 2 | authenticated |
| `portal_actualizar_datos(p_celular text, p_direccion text)` | autoservicio del trabajador | portal_dni | authenticated |
| `portal_confirmar_lectura(p_comunicado_id bigint, p_dispositivo text)` | autoservicio del trabajador | fn_cabecera, portal_dni | authenticated |
| `portal_confirmar_recepcion(p_documento_id bigint, p_dispositivo text)` | autoservicio del trabajador | fn_cabecera, portal_dni | authenticated |
| `portal_crear_solicitud(p_tipo text, p_datos jsonb)` | autoservicio del trabajador | portal_dni | authenticated |
| `portal_crear_ticket(p_tipo integer, p_subtipo integer, p_comentario text)` | autoservicio del trabajador | portal_dni | authenticated |
| `portal_dni()` | autoservicio del trabajador | auth_jwt | authenticated |
| `portal_marcar_visto(p_comunicado_id bigint)` | autoservicio del trabajador | portal_dni | authenticated |
| `portal_mi_sesion()` | autoservicio del trabajador | portal_dni | authenticated |
| `portal_modo(p_dni text)` | autoservicio del trabajador | identidad por JWT (portal_dni) | authenticated |
| `portal_primer_ingreso(p_celular text, p_sin_celular boolean, p_politica_version integer, p_correo text)` | autoservicio del trabajador | fn_cabecera, portal_dni | authenticated |
| `portal_registrar_ingreso(p_dni text, p_resultado text, p_dispositivo text)` | pre-login | sin sesión por diseño (bloqueo e intentos) | anon + authenticated |
| `portal_registrar_sesion(p_marker text)` | autoservicio del trabajador | portal_dni | authenticated |
| `portal_solicitar_cambio_cuenta(p_motivo text)` | autoservicio del trabajador | portal_dni | authenticated |
| `portal_verificar_bloqueo(p_dni text)` | pre-login | sin sesión por diseño (bloqueo e intentos) | anon + authenticated |
| `previsualizar_asistencia(p_empresa text, p_registros jsonb, p_archivo text, p_resumen jsonb)` | administrativa | asistencia · nivel 2 | authenticated |
| `previsualizar_control(p_registros jsonb, p_trabajadores jsonb, p_archivo text)` | administrativa | guarda propia: importar_control | authenticated |
| `previsualizar_importacion(p_empresa text, p_filas jsonb)` | interna | solo la llaman otras funciones (security definer) o vistas | ninguno (service_role) |
| `previsualizar_importacion_activos(p_empresa text, p_activos jsonb, p_razon_social text, p_archivo text)` | administrativa | activos · nivel 2 | authenticated |
| `previsualizar_padron(p_filas jsonb, p_ceses jsonb)` | administrativa | guarda propia: importar_padron | authenticated |
| `previsualizar_planilla_unificada(p_filas jsonb, p_periodo text, p_ceses jsonb)` | administrativa | guarda propia: importar_planilla_unificada | authenticated |
| `publicar_comunicado(p_titulo text, p_cuerpo text, p_vence date, p_exige boolean, p_segmento text, p_alcance integer, p_empresa text, p_sede text)` | administrativa | comunicados · nivel 2 | authenticated |
| `publicar_lote(p_empresa text, p_tipo text, p_periodo text, p_por text)` | administrativa | boletas · nivel 2 | authenticated |
| `publicar_lote_pdf(p_empresa text, p_tipo text, p_periodo text, p_por text, p_boletas jsonb)` | administrativa | boletas · nivel 2 | authenticated |
| `publicar_rit(p_archivo_url text, p_hash text, p_titulo text)` | administrativa | guarda propia: fn_nivel_modulo | authenticated |
| `puede(p_usuario bigint, p_modulo text, p_nivel integer, p_empresa text, p_sede text)` | interna | solo la llaman otras funciones (security definer) o vistas | ninguno (service_role) |
| `reactivar_usuario_admin(p_id bigint)` | administrativa | accesos · nivel superadmin | authenticated |
| `reenviar_clave(p_id bigint, p_clave text)` | administrativa | accesos · nivel superadmin | authenticated |
| `reenviar_solicitud(p_id bigint, p_datos jsonb, p_por text)` | autoservicio del trabajador | fn_nivel_modulo, fn_persona_llamador, portal_dni | authenticated |
| `registrar_acuse_asistido(p_dni text, p_lote text, p_motivo text, p_entrega timestamp with time zone, p_adjunto text, p_dispositivo text)` | administrativa | guarda propia: fn_cabecera, fn_nivel_modulo, fn_persona_llamador | authenticated |
| `registrar_epp(p_dni text, p_items text, p_entrega date, p_reposicion date)` | administrativa | activos · nivel 2 | authenticated |
| `registrar_ingreso(p_correo text, p_resultado text, p_dispositivo text)` | pre-login | sin sesión por diseño (bloqueo e intentos) | anon + authenticated |
| `registrar_sesion_backoffice(p_marker text)` | administrativa | guarda propia: auth_uid | authenticated |
| `resolver_memorandum(p_id text, p_decision text)` | administrativa | memorandums · nivel 3 | authenticated |
| `resolver_solicitud(p_id bigint, p_decision text, p_comentario text, p_por text)` | administrativa | guarda propia: fn_nivel_modulo, fn_persona_llamador | authenticated |
| `suspender_usuario_admin(p_id bigint)` | administrativa | accesos · nivel superadmin | authenticated |
| `ver_clave_equipo(p_codigo text, p_por text)` | administrativa | guarda propia: fn_nivel_modulo | authenticated |
| `verificar_bloqueo(p_correo text)` | pre-login | sin sesión por diseño (bloqueo e intentos) | anon + authenticated |

Funciones de trigger (10): sin EXECUTE para los roles de la API; las dispara el motor al escribir.
