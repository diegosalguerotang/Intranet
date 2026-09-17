# Corrección de seguridad · Paso 0 — Verificación antes de tocar

Fecha: 2026-09-17 · Base: proyecto Supabase `mzpbdkrmokfxrrsotfgs` (PostgreSQL 17.6) · Solo lectura.
Herramienta: `scripts/paso0-seguridad.mjs` (reejecutable; regenera los respaldos).
Respaldo de la fase 0 (reversión): `supabase/respaldos/2026-09-17-paso0-permisos.json`, `…-paso0-funciones.json`, `…-paso0-reversion.sql`.

Los documentos «Revisión de seguridad», «Diseño de la solución» y «consultas de verificación» que cita el prompt
no existen en el repo, en Descargas ni en OneDrive. Las consultas se escribieron a partir de la lista del prompt.

## 1. Funciones

| Medida | Valor |
|---|---|
| Funciones en `public` | 120 (10 de trigger, 110 llamables por RPC) |
| Ejecutables por `authenticated` | 106 |
| Ejecutables por `anon` | 4 (verificar_bloqueo, registrar_ingreso, portal_verificar_bloqueo, portal_registrar_ingreso) |
| SECURITY DEFINER entre las 106 | 91 |
| SECURITY DEFINER sin `search_path` fijo | **0** (ya se fijó el 2026-09-14 en toda la base) |
| Ejecutables por `authenticated` **sin ninguna verificación del llamador** | **50** |

Clasificación de las 50 sin guarda:

- **Previas al login (por diseño sin guarda), 4:** verificar_bloqueo, registrar_ingreso, portal_verificar_bloqueo, portal_registrar_ingreso.
- **Auxiliares internas que nadie llama desde el cliente, 17 (revocar sin impacto):** fn_es_prefijo_truncado, fn_hora_entrada, fn_min_hhmm, fn_perfil_para_cargo, fn_recalcular_control, fn_recalcular_mes_feriado, fn_resolver_banco, fn_sede_para_importacion, fn_solicitud_numero, fn_solicitud_validar, fn_sumar_dias, fn_ticket_insertar, fn_ticket_numero, fn_validar_documento, fn_valor_importado, portal_modo, puede, importar_planilla, previsualizar_importacion.
- **Administrativas usadas por el BackOffice SIN guarda, 29 — el fallo confirmado:**
  - Accesos y roles: **crear_usuario_admin, guardar_perfil**, actualizar_usuario_admin, suspender_usuario_admin, reactivar_usuario_admin, eliminar_usuario_admin (vía api/admin-usuarios.js), reenviar_clave, guardar_politica, eliminar_perfil, desactivar_perfil, marcar_clave_cambiada.
  - Personal/planilla: alta_trabajador, eliminar_trabajador, publicar_lote, publicar_lote_pdf, publicar_comunicado, registrar_epp, previsualizar_asistencia.
  - Activos/TI: importar_activos, previsualizar_importacion_activos, crear_sede, asignar_activo (2 sobrecargas), devolver_activo, editar_activo.
  - Disciplinario: resolver_memorandum, notificar_memorandum.

  Un trabajador del Portal con su JWT puede llamar `crear_usuario_admin` o `guardar_perfil` y darse la categoría de superadministrador. Estas funciones leen `usuarios_admin`, pero solo para escribir; ninguna comprueba quién llama.

- **Con guarda, 56:** 42 vía `fn_nivel_modulo(modulo)` (correo del JWT → usuarios_admin → perfil_permisos; superadmin = 99), 11 del Portal vía `portal_dni()` (dni del correo `@portal.grupoer.pe` del JWT), y el resto vía `fn_persona_llamador`, `fn_nivel_memorandums`, `es_admin_activo` (auth.uid), `fn_ver_cuenta_bancaria` (casilla ver_datos_bancarios).

Helpers de identidad que ya existen: `es_admin_activo()`, `fn_nivel_modulo(p_modulo)`, `fn_nivel_memorandums()`, `fn_persona_llamador()`, `portal_dni()`, `fn_cabecera(p_nombre)`. Todos resuelven la identidad **por petición** leyendo el JWT y consultando `usuarios_admin`: la opción B ya es el patrón de la base; `es_admin()`/`requiere_*` de la fase 1 se construyen sobre ellos, no sobre claims del token.

Ya cerradas a authenticated: fn_cabecera, fn_cifrar_cuenta, fn_clave_cuentas, fn_descifrar_cuenta. No hay llamadas del cliente a funciones inexistentes.

## 2. RLS y políticas

| Medida | Valor |
|---|---|
| Tablas en `public` | 54 |
| Con RLS **desactivada** | **22**: cargo_perfiles, centros_costo, consentimientos, correo_tokens, feriados, horarios_entrada, movimientos, notificaciones_documento, perfil_empresas, perfil_propuestas, rit_faltas, rits, solicitud_avisos, solicitud_correlativos, solicitud_eventos, solicitud_tipos, solicitudes, ticket_avisos, ticket_subtipos, ticket_tipos, tickets, tipos_sancion |
| Políticas totales | 32 |
| Con condición `true` | **31** — todas son `acceso_demo` (`for all to authenticated using (true) with check (true)`) |
| Tablas con `acceso_demo` | 31: activos, acuses, asignaciones, asistencia_config, asistencia_lotes, auditoria, bancos, cargos, comunicado_lecturas, comunicados, contratos, cuentas_portal, declaraciones, descargos, empresas, epp_entregas, lineas, lotes, marcaciones, memorandums, perfil_permisos, perfiles, personas, plantillas, politica_acceso, registro_accesos, sedes, solicitudes_cambio_cuenta, tardanzas, usuarios_admin, vinculos |
| Única política real | `documentos.documentos_admin` — `using (es_admin_activo()) with check (es_admin_activo())` (modelo a replicar) |

Nota: eliminar `acceso_demo` no cierra las 22 tablas sin RLS; a esas hay que activarles RLS además (fallan cerrado al no tener política).

## 3. Vistas

47 vistas (el prompt decía 46). **0 con `security_invoker`**: todas corren como su dueño (`postgres`) y saltan RLS. Hoy es precisamente lo que mantiene funcionando al BackOffice y al Portal (`v_portal_*` filtran por sesión dentro de la propia vista).

## 4. Permisos directos de `authenticated`

- Tablas: **ALL** (select/insert/update/delete/truncate/references/trigger) en 33; insert+select en las 5 de solo inserción (acuses, auditoria, comunicado_lecturas, descargos, registro_accesos); solo references/trigger/truncate en correo_tokens.
- Vistas: ALL en las 47. Secuencias: USAGE en 27/27.
- `anon` y `PUBLIC`: ningún grant sobre tablas ni vistas.
- Default privileges de `postgres` en public: authenticated y service_role reciben todo en tablas, secuencias y funciones nuevas (los de `supabase_admin` además incluyen anon; son de la plataforma).
- Esquemas con USAGE para authenticated y anon: public, auth, extensions, graphql, graphql_public, realtime, storage.

## 5. Datos sensibles

| Dónde | Estado real |
|---|---|
| `personas.cci` (text) | **Texto plano.** 1 valor de 81 filas, con formato de CCI (20 dígitos). Expuesto en `v_personal.cci` y en `fn_ver_cuenta_bancaria` |
| `personas.cuenta` (text) | Columna en texto plano **aún existe**, vacía (0 de 81). Sigue expuesta en `v_personal.cuenta` |
| `personas.cuenta_cifrada` (bytea) | 4 valores, pgcrypto + Vault (`clave_cuentas`); descifra solo `fn_ver_cuenta_bancaria` con casilla `ver_datos_bancarios` y auditoría |
| `activos.clave_equipo` (text) | **Texto plano** por diseño; hoy vacía (0 de 79). Lectura/escritura por RPC con guarda de superadmin (`ver_clave_equipo`, `guardar_clave_equipo`) |
| `usuarios_admin.clave_provisional` (text) | Texto plano; hoy vacía (0 de 4) |
| `auditoria` (histórico) | **64 filas con secretos en claro**: 57 UPDATE de personas con cci/cuenta en texto plano (13-08 → 31-08), 5 UPDATE de usuarios_admin con clave_provisional (13-08 → 17-08), 2 UPDATE de activos con clave_equipo (19-08). Son las filas de la migración de redacción (decisión 6) |
| Parámetros de seguridad | `politica_acceso` (mínimos de clave 6/6, intentos, bloqueo, recuperación) |
| Storage | bucket `documentos` privado, 3 políticas en `storage.objects` (leer/subir/actualizar) — revisar en fase 4 |

## 6. Estado del código relacionado con las decisiones

- **Endpoint de correo `api/enviar-correo.js`**: 6 acciones. Exigen sesión solo `verificacion` (portal) y `recordatorio-acuse` (BackOffice nivel ≥2). `recuperacion` y `recuperacion-admin` son públicas por diseño (respuesta genérica). `aviso-ticket` y `aviso-solicitud` no exigen sesión (bastan un número existente). **Sin límite de tasa y sin lista blanca de destinatarios**; los destinatarios salen de tablas (`ticket_avisos`, `solicitud_avisos`, correo de la persona), no del cuerpo de la petición.
- **Gmail**: contraseña de aplicación en env var `SMTP_PASS` de Vercel (nodemailer, `api/_correo.js`); alternativa `RESEND_API_KEY`. Nunca en el cliente.
- **Proxy**: el cliente (BackOffice y Portal) usa `/api/supa` **solo si el hostname termina en `vercel.app`**; en cualquier otro dominio o en local conecta directo a Supabase con la publishable key. No hay variable de entorno ni fallo cerrado (decisión 10 pendiente).
- **Clave del BackOffice**: mínimo efectivo 6 (`max(6, politica.claveLongitudMinBackoffice)`), sin exigencia de mayúscula/minúscula/símbolo (decisión 11 pendiente). `api/restablecer-clave.js` exige 6 + número + letra.
- **Llave de servicio**: solo en funciones serverless (`SUPA_SERVICE_KEY`), no en el cliente.

## 7. Diferencias respecto a lo que describía el prompt

1. `search_path` ya está fijo en el 100 % de las SECURITY DEFINER (el prompt lo daba por pendiente).
2. `anon` ya está cerrado desde el 2026-09-14: solo las 4 RPC del login.
3. Son 47 vistas, no 46; y 106 funciones abiertas a authenticated (no 121), de las que 50 carecen de guarda.
4. Hay 22 tablas **sin RLS**, que `acceso_demo` no cubre: la contención de fase 0 debe activarles RLS.
5. Impacto real de eliminar `acceso_demo` (y activar RLS en las 22 tablas sin ella): **mínimo**. El navegador del BackOffice solo toca una tabla base directa, `lineas` (insert/update en Telefonía, `src/state.jsx`); todo lo demás son vistas (que corren como dueño mientras no tengan `security_invoker`) y RPCs. El Portal solo lee `v_portal_*` y llama RPCs. Las funciones serverless (`api/*`) usan la llave de servicio y no dependen de políticas. Propuesta para la fase 0: política `solo_admin` (`es_admin_activo()`, como ya tiene `documentos`) únicamente en `lineas`; los trabajadores del Portal pierden todo acceso directo a tablas y los administradores siguen operando.
6. El CCI no está cifrado (1 valor real), la columna `cuenta` en claro sigue existiendo, y hay 64 filas de auditoría con secretos en claro.
