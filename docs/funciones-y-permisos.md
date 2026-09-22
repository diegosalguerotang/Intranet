# Funciones y permisos — estado real de producción (2026-09-22)

Generado por `scripts/funciones-y-permisos.mjs` desde `pg_proc` de producción (proyecto `mzpbdkrmokfxrrsotfgs`): firma, guarda detectada en el cuerpo y roles con EXECUTE. Regenerar tras cada fase.

**Reglas vigentes (fases 0–6):** toda función nueva nace SIN EXECUTE para la API (`ALTER DEFAULT PRIVILEGES`); `anon` solo ejecuta las 4 RPC pre-login; las administrativas se guardan con `requiere_superadmin()` / `requiere_nivel(modulo, nivel[, alternativo])` o con su guarda propia sobre `fn_nivel_modulo` (misma identidad por petición: correo del JWT → `usuarios_admin` activo → categoría vigente; sin JWT y con rol activo `authenticated`/`anon` vale 0); el autoservicio del trabajador deriva la identidad del JWT (`portal_dni()`, `fn_persona_llamador()`), nunca de un parámetro; las `api_*` solo las ejecuta `service_role` (funciones serverless); toda SECURITY DEFINER fija `search_path`.

| Grupo | Funciones |
|---|---|
| administrativa (sesión propia) | 2 |
| administrativa | 58 |
| autoservicio del trabajador | 25 |
| ayudante | 42 |
| interna | 4 |
| pre-login | 4 |
| servicio (api/*.js con llave de servicio) | 8 |
| trigger | 11 |

| Función | Grupo | Guarda / regla | EXECUTE |
|---|---|---|---|
| `actualizar_ticket(p_id bigint, p_estado text, p_atendido_por text, p_nota text, p_por text)` | administrativa | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `actualizar_usuario_admin(p_id bigint, p_perfil text, p_correo text, p_celular text, p_estado text)` | administrativa | superadmin | authenticated + service_role |
| `alta_trabajador(p_dni text, p_nombre text, p_cargo text, p_sede text, p_empresa text, p_ingreso date, p_celular text, p_banco text, p_cuenta text, p_correo text, p_cci text, p_tipo_documento text)` | administrativa | personal · nivel 2 | authenticated + service_role |
| `alternar_ticket_subtipo(p_id integer, p_activo boolean)` | administrativa | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `alternar_ticket_tipo(p_id integer, p_activo boolean)` | administrativa | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `api_admin_marcar_clave(p_id bigint, p_correo text, p_requiere_cambio boolean)` | servicio (api/*.js con llave de servicio) | — | service_role |
| `api_admin_por_correo(p_correo text, p_solo_activo boolean)` | servicio (api/*.js con llave de servicio) | — | service_role |
| `api_admin_por_id(p_id bigint)` | servicio (api/*.js con llave de servicio) | — | service_role |
| `api_login_permitido(p_ip text, p_correo text)` | servicio (api/*.js con llave de servicio) | — | service_role |
| `api_login_registrar(p_correo text, p_resultado text, p_ip text, p_agente text)` | servicio (api/*.js con llave de servicio) | — | service_role |
| `api_token_crear(p_token text, p_dni text, p_proposito text, p_correo text, p_expira_en timestamp with time zone)` | servicio (api/*.js con llave de servicio) | — | service_role |
| `api_token_leer(p_token text, p_propositos text[])` | servicio (api/*.js con llave de servicio) | — | service_role |
| `api_token_usar(p_token text)` | servicio (api/*.js con llave de servicio) | — | service_role |
| `asignar_activo(p_codigo text, p_dni text, p_condicion text, p_antivirus boolean, p_comentario text)` | administrativa | activos · nivel 2 | authenticated + service_role |
| `asignar_rit_sede(p_sede text, p_rit text)` | administrativa | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `corregir_fecha_ingreso(p_dni text, p_fecha date)` | administrativa | personal · nivel 2 | authenticated + service_role |
| `correo_llamador()` | ayudante | identidad del JWT (correo_llamador / auth.jwt / auth.uid): alcance o sesión propia resueltos en el cuerpo | authenticated + service_role |
| `crear_activo(p_codigo text, p_categoria text, p_empresa text, p_tipo text, p_marca text, p_modelo text, p_serie text, p_imei text, p_valor numeric, p_compra date, p_observaciones text)` | autoservicio del trabajador | guarda propia sobre fn_nivel_modulo/nivel_en; identidad del JWT (portal_dni / fn_persona_llamador) | authenticated + service_role |
| `crear_rit(p_nombre text, p_archivo text, p_hash text, p_vigente date)` | administrativa | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `crear_sede(p_empresa text, p_nombre text, p_cliente text, p_direccion text, p_por text, p_rit text)` | administrativa | configuracion o personal · nivel 2 | authenticated + service_role |
| `crear_solicitud_admin(p_dni text, p_tipo text, p_datos jsonb, p_por text)` | administrativa | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `crear_solicitud_propia(p_tipo text, p_datos jsonb)` | autoservicio del trabajador | identidad del JWT (portal_dni / fn_persona_llamador) | authenticated + service_role |
| `crear_ticket_admin(p_dni text, p_tipo integer, p_subtipo integer, p_comentario text, p_por text)` | administrativa | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `crear_ticket_propio(p_tipo integer, p_subtipo integer, p_comentario text)` | autoservicio del trabajador | identidad del JWT (portal_dni / fn_persona_llamador) | authenticated + service_role |
| `crear_usuario_admin(p_dni text, p_perfil text, p_correo text, p_celular text, p_clave text, p_por text)` | administrativa | superadmin | authenticated + service_role |
| `decidir_propuesta_perfil(p_id bigint, p_decision text, p_por text)` | administrativa | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `desactivar_perfil(p_id text)` | administrativa | superadmin | authenticated + service_role |
| `devolver_activo(p_codigo text, p_destino text, p_condicion text)` | administrativa | activos · nivel 2 | authenticated + service_role |
| `editar_activo(p_codigo text, p_nuevo_codigo text, p_tipo text, p_marca text, p_modelo text, p_serie text, p_area text, p_asignado_sin_confirmar text, p_observaciones text, p_por text, p_ip text)` | administrativa | activos · nivel 2 | authenticated + service_role |
| `editar_trabajador(p_dni text, p_nombre text, p_celular text, p_correo text, p_banco text, p_cuenta text, p_cci text, p_tipo_documento text)` | administrativa | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `eliminar_feriado(p_fecha date, p_por text)` | administrativa | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `eliminar_perfil(p_id text)` | administrativa | superadmin | authenticated + service_role |
| `eliminar_sede(p_sede text)` | administrativa | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `eliminar_solicitud_aviso(p_id bigint)` | administrativa | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `eliminar_ticket_aviso(p_correo text)` | administrativa | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `eliminar_trabajador(p_dni text)` | administrativa | personal · nivel 3 | authenticated + service_role |
| `eliminar_usuario_admin(p_id bigint)` | interna | superadmin | service_role |
| `emitir_memorandum(p_dni text, p_tipo_sancion text, p_falta_id bigint, p_motivo text, p_suspension_dias integer, p_por text)` | administrativa | guarda propia sobre fn_nivel_memorandums (sanción según nivel) | authenticated + service_role |
| `es_admin()` | ayudante | identidad del JWT (correo_llamador / auth.jwt / auth.uid): alcance o sesión propia resueltos en el cuerpo | authenticated + service_role |
| `es_admin_activo()` | ayudante | identidad del JWT (correo_llamador / auth.jwt / auth.uid): alcance o sesión propia resueltos en el cuerpo | authenticated + service_role |
| `es_superadmin()` | ayudante | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `fijar_correo_persona(p_dni text, p_correo text)` | administrativa | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `fijar_hora_entrada(p_dni text, p_hora time without time zone, p_desde date, p_por text)` | administrativa | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `fn_alcance_activo(p_codigo text)` | ayudante | SIN GUARDA (revisar) | authenticated + service_role |
| `fn_alcance_documento(p_id bigint)` | ayudante | SIN GUARDA (revisar) | authenticated + service_role |
| `fn_alcance_empresa(p_empresa text)` | ayudante | identidad del JWT (correo_llamador / auth.jwt / auth.uid): alcance o sesión propia resueltos en el cuerpo | authenticated + service_role |
| `fn_alcance_memorandum(p_id text)` | ayudante | SIN GUARDA (revisar) | authenticated + service_role |
| `fn_alcance_persona(p_dni text)` | ayudante | SIN GUARDA (revisar) | authenticated + service_role |
| `fn_alcance_solicitud(p_id bigint)` | autoservicio del trabajador | guarda propia sobre fn_nivel_modulo/nivel_en; identidad del JWT (portal_dni / fn_persona_llamador) | authenticated + service_role |
| `fn_alcance_vinculo(p_id bigint)` | ayudante | SIN GUARDA (revisar) | authenticated + service_role |
| `fn_auditar()` | trigger | — | service_role |
| `fn_auditar_datos_bancarios()` | trigger | identidad del JWT (correo_llamador / auth.jwt / auth.uid): alcance o sesión propia resueltos en el cuerpo | service_role |
| `fn_bloquear_cambios()` | trigger | cerrada: siempre rechaza (sin efecto) | service_role |
| `fn_cabecera(p_nombre text)` | ayudante | — | service_role |
| `fn_cifrar_cuenta(p_texto text)` | ayudante | — | service_role |
| `fn_clave_cuentas()` | ayudante | — | service_role |
| `fn_comunicado_me_alcanza(p_id bigint)` | autoservicio del trabajador | identidad del JWT (portal_dni / fn_persona_llamador) | authenticated + service_role |
| `fn_descifrar_cuenta(p_cifrado bytea)` | ayudante | — | service_role |
| `fn_dni_auditoria(p_antes jsonb, p_despues jsonb)` | ayudante | SIN GUARDA (revisar) | authenticated + service_role |
| `fn_es_mi_dni(p_dni text)` | autoservicio del trabajador | identidad del JWT (portal_dni / fn_persona_llamador) | authenticated + service_role |
| `fn_es_prefijo_truncado(p_nuevo text, p_actual text)` | ayudante | — | service_role |
| `fn_guardar_datos_bancarios(p_dni text, p_banco text, p_banco_id text, p_cuenta text, p_cci text, p_pisar_banco boolean, p_por text)` | ayudante | — | service_role |
| `fn_hora_entrada(p_dni text, p_fecha date)` | ayudante | SIN GUARDA (revisar) | authenticated + service_role |
| `fn_mi_perfil(p_perfil text, p_version integer)` | ayudante | identidad del JWT (correo_llamador / auth.jwt / auth.uid): alcance o sesión propia resueltos en el cuerpo | authenticated + service_role |
| `fn_mi_sede(p_id text)` | autoservicio del trabajador | identidad del JWT (portal_dni / fn_persona_llamador) | authenticated + service_role |
| `fn_mi_solicitud(p_id bigint)` | autoservicio del trabajador | identidad del JWT (portal_dni / fn_persona_llamador) | authenticated + service_role |
| `fn_mi_vinculo(p_id bigint)` | autoservicio del trabajador | identidad del JWT (portal_dni / fn_persona_llamador) | authenticated + service_role |
| `fn_min_hhmm(t text)` | ayudante | — | service_role |
| `fn_movimientos_solo_insertar()` | trigger | cerrada: siempre rechaza (sin efecto) | service_role |
| `fn_nivel_memorandums()` | ayudante | identidad del JWT (correo_llamador / auth.jwt / auth.uid): alcance o sesión propia resueltos en el cuerpo | authenticated + service_role |
| `fn_nivel_modulo(p_modulo text)` | ayudante | identidad del JWT (correo_llamador / auth.jwt / auth.uid): alcance o sesión propia resueltos en el cuerpo | authenticated + service_role |
| `fn_perfil_nombre_unico()` | trigger | — | service_role |
| `fn_perfil_para_cargo(p_cargo text)` | ayudante | — | service_role |
| `fn_persona_llamador()` | ayudante | identidad del JWT (correo_llamador / auth.jwt / auth.uid): alcance o sesión propia resueltos en el cuerpo | authenticated + service_role |
| `fn_proteger_ultimo_superadmin()` | trigger | — | service_role |
| `fn_recalcular_control(p_documento text, p_desde date, p_hasta date, p_motivo text)` | ayudante | — | service_role |
| `fn_recalcular_mes_feriado(p_fecha date, p_motivo text)` | ayudante | — | service_role |
| `fn_redactar_historico(p_datos jsonb)` | ayudante | — | service_role |
| `fn_registro_solo_desvincular()` | trigger | — | service_role |
| `fn_resolver_banco(p_texto text)` | ayudante | — | service_role |
| `fn_sede_para_importacion(p_empresa text, p_sede text, p_cliente text)` | ayudante | — | service_role |
| `fn_solicitud_eventos_inmutables()` | trigger | cerrada: siempre rechaza (sin efecto) | service_role |
| `fn_solicitud_insertar(p_dni text, p_tipo text, p_datos jsonb, p_por text)` | autoservicio del trabajador | identidad del JWT (portal_dni / fn_persona_llamador) | authenticated + service_role |
| `fn_solicitud_numero(p_tipo text, p_empresa text)` | ayudante | — | service_role |
| `fn_solicitud_recalcula_asistencia()` | trigger | — | service_role |
| `fn_solicitud_validar(p_tipo text, p_datos jsonb)` | ayudante | — | service_role |
| `fn_solo_empresa_activa()` | trigger | — | service_role |
| `fn_sumar_dias(p_desde date, p_dias integer, p_habiles boolean)` | ayudante | — | service_role |
| `fn_superadmin_sin_matriz()` | trigger | — | service_role |
| `fn_ticket_insertar(p_dni text, p_tipo integer, p_subtipo integer, p_comentario text)` | ayudante | — | service_role |
| `fn_ticket_numero()` | ayudante | — | service_role |
| `fn_ultimos4(p_texto text)` | ayudante | — | service_role |
| `fn_validar_documento(p_tipo text, p_numero text)` | ayudante | — | service_role |
| `fn_valor_importado(p_nuevo text, p_actual text)` | ayudante | — | service_role |
| `fn_ver_cuenta_bancaria(p_dni text)` | ayudante | identidad del JWT (correo_llamador / auth.jwt / auth.uid): alcance o sesión propia resueltos en el cuerpo | authenticated + service_role |
| `guardar_cargo_perfil(p_cargo text, p_destino text, p_perfil text, p_por text)` | administrativa | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `guardar_clave_equipo(p_codigo text, p_clave text, p_por text)` | administrativa | activos · nivel 2 | authenticated + service_role |
| `guardar_feriado(p_fecha date, p_nombre text, p_por text)` | administrativa | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `guardar_perfil(p_id text, p_nombre text, p_descripcion text, p_superadmin boolean, p_ver_remuneracion boolean, p_ver_documentos boolean, p_exportar boolean, p_matriz jsonb, p_empresas text[], p_por text, p_ver_bancarios boolean)` | administrativa | superadmin | authenticated + service_role |
| `guardar_politica(p_backoffice_horas integer, p_portal_dias integer, p_multisesion_backoffice boolean, p_multisesion_portal boolean, p_intentos integer, p_bloqueo_min integer, p_recuperacion text, p_clave_min_portal integer, p_clave_min_backoffice integer, p_provisional_dias integer, p_por text)` | administrativa | superadmin | authenticated + service_role |
| `guardar_solicitud_aviso(p_tipo text, p_correo text, p_copia boolean, p_activo boolean)` | administrativa | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `guardar_ticket_aviso(p_correo text, p_activo boolean)` | administrativa | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `guardar_ticket_subtipo(p_id integer, p_tipo integer, p_nombre text)` | administrativa | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `guardar_ticket_tipo(p_id integer, p_nombre text)` | administrativa | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `importar_activos(p_empresa text, p_activos jsonb, p_razon_social text, p_archivo text, p_por text)` | administrativa | activos · nivel 2 | authenticated + service_role |
| `importar_asistencia(p_empresa text, p_registros jsonb, p_archivo text, p_resumen jsonb, p_por text)` | administrativa | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `importar_control(p_registros jsonb, p_trabajadores jsonb, p_archivo text, p_por text)` | administrativa | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `importar_padron(p_filas jsonb, p_por text, p_ceses jsonb)` | administrativa | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `importar_planilla(p_empresa text, p_filas jsonb, p_por text)` | interna | — | service_role |
| `importar_planilla_unificada(p_filas jsonb, p_periodo text, p_por text, p_ceses jsonb)` | administrativa | identidad del JWT (correo_llamador / auth.jwt / auth.uid): alcance o sesión propia resueltos en el cuerpo | authenticated + service_role |
| `marcar_clave_cambiada(p_correo text)` | administrativa | solo la propia cuenta (correo del JWT) | authenticated + service_role |
| `mi_sesion_backoffice()` | administrativa (sesión propia) | identidad del JWT (correo_llamador / auth.jwt / auth.uid): alcance o sesión propia resueltos en el cuerpo | authenticated + service_role |
| `nivel_en(p_modulo text)` | ayudante | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `notificar_memorandum(p_id text)` | administrativa | memorandums · nivel 2 | authenticated + service_role |
| `portal_actualizar_datos(p_celular text, p_direccion text)` | autoservicio del trabajador | identidad del JWT (portal_dni / fn_persona_llamador) | authenticated + service_role |
| `portal_confirmar_lectura(p_comunicado_id bigint, p_dispositivo text)` | autoservicio del trabajador | identidad del JWT (portal_dni / fn_persona_llamador) | authenticated + service_role |
| `portal_confirmar_recepcion(p_documento_id bigint, p_dispositivo text)` | autoservicio del trabajador | identidad del JWT (portal_dni / fn_persona_llamador) | authenticated + service_role |
| `portal_crear_solicitud(p_tipo text, p_datos jsonb)` | autoservicio del trabajador | identidad del JWT (portal_dni / fn_persona_llamador) | authenticated + service_role |
| `portal_crear_ticket(p_tipo integer, p_subtipo integer, p_comentario text)` | autoservicio del trabajador | cerrada: siempre rechaza (sin efecto) | authenticated + service_role |
| `portal_dni()` | autoservicio del trabajador | identidad del JWT (correo_llamador / auth.jwt / auth.uid): alcance o sesión propia resueltos en el cuerpo | authenticated + service_role |
| `portal_marcar_visto(p_comunicado_id bigint)` | autoservicio del trabajador | identidad del JWT (portal_dni / fn_persona_llamador) | authenticated + service_role |
| `portal_mi_sesion()` | autoservicio del trabajador | identidad del JWT (portal_dni / fn_persona_llamador) | authenticated + service_role |
| `portal_modo(p_dni text)` | autoservicio del trabajador | SIN GUARDA (revisar) | authenticated + service_role |
| `portal_primer_ingreso(p_celular text, p_sin_celular boolean, p_politica_version integer, p_correo text)` | autoservicio del trabajador | identidad del JWT (portal_dni / fn_persona_llamador) | authenticated + service_role |
| `portal_registrar_ingreso(p_dni text, p_resultado text, p_dispositivo text)` | pre-login | identidad del JWT (correo_llamador / auth.jwt / auth.uid): alcance o sesión propia resueltos en el cuerpo | anon + authenticated + service_role |
| `portal_registrar_sesion(p_marker text)` | autoservicio del trabajador | identidad del JWT (portal_dni / fn_persona_llamador) | authenticated + service_role |
| `portal_solicitar_cambio_cuenta(p_motivo text)` | autoservicio del trabajador | identidad del JWT (portal_dni / fn_persona_llamador) | authenticated + service_role |
| `portal_verificar_bloqueo(p_dni text)` | pre-login | SIN GUARDA (revisar) | anon + authenticated + service_role |
| `previsualizar_asistencia(p_empresa text, p_registros jsonb, p_archivo text, p_resumen jsonb)` | administrativa | asistencia · nivel 2 | authenticated + service_role |
| `previsualizar_control(p_registros jsonb, p_trabajadores jsonb, p_archivo text)` | administrativa | delega en importar_control (su guarda) y revierte (vista previa) | authenticated + service_role |
| `previsualizar_importacion(p_empresa text, p_filas jsonb)` | interna | delega en importar_planilla (su guarda) y revierte (vista previa) | service_role |
| `previsualizar_importacion_activos(p_empresa text, p_activos jsonb, p_razon_social text, p_archivo text)` | administrativa | activos · nivel 2 | authenticated + service_role |
| `previsualizar_padron(p_filas jsonb, p_ceses jsonb)` | administrativa | delega en importar_padron (su guarda) y revierte (vista previa) | authenticated + service_role |
| `previsualizar_planilla_unificada(p_filas jsonb, p_periodo text, p_ceses jsonb)` | administrativa | delega en importar_planilla_unificada (su guarda) y revierte (vista previa) | authenticated + service_role |
| `publicar_comunicado(p_titulo text, p_cuerpo text, p_vence date, p_exige boolean, p_segmento text, p_alcance integer, p_empresa text, p_sede text)` | administrativa | comunicados · nivel 2 | authenticated + service_role |
| `publicar_lote(p_empresa text, p_tipo text, p_periodo text, p_por text)` | administrativa | boletas · nivel 2 | authenticated + service_role |
| `publicar_lote_pdf(p_empresa text, p_tipo text, p_periodo text, p_por text, p_boletas jsonb)` | administrativa | boletas · nivel 2 | authenticated + service_role |
| `publicar_rit(p_archivo_url text, p_hash text, p_titulo text)` | administrativa | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `puede(p_usuario bigint, p_modulo text, p_nivel integer, p_empresa text, p_sede text)` | interna | — | service_role |
| `reactivar_usuario_admin(p_id bigint)` | administrativa | superadmin | authenticated + service_role |
| `reenviar_clave(p_id bigint, p_clave text)` | administrativa | superadmin | authenticated + service_role |
| `reenviar_solicitud(p_id bigint, p_datos jsonb, p_por text)` | autoservicio del trabajador | guarda propia sobre fn_nivel_modulo/nivel_en; identidad del JWT (portal_dni / fn_persona_llamador) | authenticated + service_role |
| `registrar_acuse_asistido(p_dni text, p_lote text, p_motivo text, p_entrega timestamp with time zone, p_adjunto text, p_dispositivo text)` | autoservicio del trabajador | guarda propia sobre fn_nivel_modulo/nivel_en; identidad del JWT (portal_dni / fn_persona_llamador) | authenticated + service_role |
| `registrar_epp(p_dni text, p_items text, p_entrega date, p_reposicion date)` | administrativa | activos · nivel 2 | authenticated + service_role |
| `registrar_ingreso(p_correo text, p_resultado text, p_dispositivo text)` | pre-login | identidad del JWT (correo_llamador / auth.jwt / auth.uid): alcance o sesión propia resueltos en el cuerpo | anon + authenticated + service_role |
| `registrar_sesion_backoffice(p_marker text)` | administrativa (sesión propia) | identidad del JWT (correo_llamador / auth.jwt / auth.uid): alcance o sesión propia resueltos en el cuerpo | authenticated + service_role |
| `requiere_correo_propio(p_correo text)` | ayudante | es_admin; identidad del JWT (correo_llamador / auth.jwt / auth.uid): alcance o sesión propia resueltos en el cuerpo | service_role |
| `requiere_nivel(p_modulo text, p_nivel integer, p_modulo_alt text)` | ayudante | guarda propia sobre fn_nivel_modulo/nivel_en | service_role |
| `requiere_superadmin()` | ayudante | — | service_role |
| `resolver_memorandum(p_id text, p_decision text)` | administrativa | memorandums · nivel 3 | authenticated + service_role |
| `resolver_solicitud(p_id bigint, p_decision text, p_comentario text, p_por text)` | autoservicio del trabajador | guarda propia sobre fn_nivel_modulo/nivel_en; identidad del JWT (portal_dni / fn_persona_llamador) | authenticated + service_role |
| `suspender_usuario_admin(p_id bigint)` | administrativa | superadmin | authenticated + service_role |
| `ver_clave_equipo(p_codigo text, p_por text)` | administrativa | guarda propia sobre fn_nivel_modulo/nivel_en | authenticated + service_role |
| `verificar_bloqueo(p_correo text)` | pre-login | SIN GUARDA (revisar) | anon + authenticated + service_role |

Comprobaciones al generar: 0 administrativa(s) sin guarda detectable; 0 SECURITY DEFINER sin `search_path` fijo.
