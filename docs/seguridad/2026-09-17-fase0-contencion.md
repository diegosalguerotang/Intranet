# Corrección de seguridad · Fase 0 — Contención

Fecha: 2026-09-17 · Base: proyecto Supabase `mzpbdkrmokfxrrsotfgs` · Estado: **migración APLICADA en producción el 2026-09-17 (catálogo verificado 7/7); pendientes: verificación con sesiones, rotación de Gmail y push del código**.

Prompt de Diego: `Downloads/Prompt_Correccion_Seguridad.docx` (decisiones cerradas en `Decisiones_Seguridad_QA.docx`). Estado real medido: `2026-09-17-paso0-resultados.md`.

## 1. Entregables

| Pieza | Archivo | Estado |
|---|---|---|
| Migración única (transaccional, con verificación embebida) | `supabase/migraciones/2026-09-17-fase0-contencion.sql` | ensayada 42/42 |
| Reversión completa | `supabase/respaldos/2026-09-17-fase0-reversion.sql` | ensayada: deja la foto de permisos idéntica |
| Postgres local para ensayar (no hay Docker ni Postgres en la máquina) | `scripts/pg-local.mjs` (+ devDependency `embedded-postgres` 17) | reproduce prod: 120 fns / 54 tablas / 47 vistas / 32 políticas, ACL iguales |
| Ensayo de la migración y la reversión | `scripts/ensayar-fase0.mjs` | 42 casos verdes |
| Endpoint de correo endurecido (decisión 8) | `api/enviar-correo.js` + `tests/api/enviar-correo.test.js` | 19 pruebas; vitest 170/170 |
| Verificación en producción tras aplicar | `scripts/verificar-fase0.mjs` | lo corre Diego |
| Informe forense (solo lectura) | `scripts/fase0-forense.mjs` → `docs/seguridad/<fecha>-fase0-forense.md` | lo corre Diego |
| Espejo canónico del estado de permisos | `supabase/seguridad.sql` (aplicar al final; `PG_LOCAL_FASE0=1` en pg-local) | listo |

## 2. Qué hace la migración

1. `REVOKE EXECUTE` a `authenticated`, `anon` y `PUBLIC` en las 120 funciones de `public`.
2. `GRANT EXECUTE` solo a **62 firmas** (lista del paso 0): 4 pre-login (anon + authenticated), 56 que verifican al llamador (`fn_nivel_modulo`, `portal_dni`, `fn_persona_llamador`, `es_admin_activo`, `auth.uid/jwt`) y 2 que las vistas necesitan (`fn_hora_entrada` en `v_personal`/`v_asistencia_mensual`, `portal_modo` en `v_portal_perfil`). PostgreSQL comprueba el EXECUTE de una función usada por una vista contra quien consulta la vista, no contra su dueño. `service_role` no se toca.
3. `portal_dni()` y `portal_modo()` pasan a `SECURITY DEFINER` con `search_path` fijo (ver §5, hallazgo 1).
4. Se **elimina** `acceso_demo` en las 31 tablas.
5. RLS activa en las 22 tablas que no la tenían (sin política = cerrado).
6. `lineas`: política `solo_admin` con `es_admin_activo()` (única tabla base que el BackOffice escribe directo).
7. Tabla `correo_envios` (rastro y límite de tasa del endpoint de correo), visible solo para `service_role`.
8. Verificación embebida: listas exactas de anon/authenticated, 0 `acceso_demo`, 0 políticas `true`, 0 tablas sin RLS, `solo_admin` presente, `correo_envios` cerrada, `portal_dni`/`portal_modo` definer. Si algo no cuadra, **no se aplica**. También aborta si la base ya no coincide con la foto del paso 0 (106 funciones abiertas, 4 anon, 31 `acceso_demo`).

## 3. Efecto en la operación mientras dure la fase 0

Quedan **inoperativas para todos, administradores incluidos**, las 29 RPC administrativas sin guarda (falla cerrado hasta que la fase 1 les ponga `requiere_nivel`/`requiere_superadmin`):

- Accesos y roles: `crear_usuario_admin`, `actualizar_usuario_admin`, `suspender_usuario_admin`, `reactivar_usuario_admin`, `reenviar_clave`, `guardar_perfil`, `eliminar_perfil`, `desactivar_perfil`, `guardar_politica`, `marcar_clave_cambiada`. (`eliminar_usuario_admin` la llama `api/admin-usuarios.js` con la llave de servicio: sigue funcionando.)
- Planilla: `alta_trabajador`, `eliminar_trabajador`, `publicar_lote`, `publicar_lote_pdf`, `publicar_comunicado`, `registrar_epp`, `previsualizar_asistencia`.
- Activos TI: `importar_activos`, `previsualizar_importacion_activos`, `crear_sede`, `asignar_activo` (2 sobrecargas), `devolver_activo`, `editar_activo`.
- Disciplinario: `resolver_memorandum`, `notificar_memorandum`.

La interfaz mostrará «permission denied for function …» en esas acciones. Sigue operativo todo lo demás: login, Portal completo (vistas `v_portal_*` y sus RPC), Planilla (lectura, edición de trabajador, importación de padrón y control semanal, hora de entrada, correos), Solicitudes, Soporte, Acuses, feriados, categorías de cargo, memorándums (emitir), Telefonía (`lineas`).

Un trabajador del Portal con su JWT ya **no** puede ejecutar ninguna función administrativa (probado una por una: 47 firmas denegadas, incluidas `crear_usuario_admin` y `guardar_perfil`) ni leer filas de ninguna tabla base.

## 4. Endpoint de correo (`api/enviar-correo.js`)

- **Sesión**: `aviso-ticket` y `aviso-solicitud` exigen `x-sesion`; el Portal solo sobre sus propios tickets/solicitudes; el BackOffice con cuenta activa. `verificacion` (portal) y `recordatorio-acuse` (admin nivel ≥ 2) igual que antes. Los 4 sitios del cliente ya mandan la sesión (`Tickets.jsx`, `formularios.jsx`, portal `Solicitudes.jsx` y `Soporte.jsx`).
- **Secreto del sistema**: cabecera `x-correo-secreto` comparada en tiempo constante (SHA-256 + `timingSafeEqual`) contra la env `CORREO_SECRETO`. Sin la env no hay vía. Hoy ningún proceso del sistema lo usa; queda para webhooks/scripts.
- **Límite de tasa** (ventana 60 min, contado en `correo_envios`): 30 por IP en cualquier acción; por sujeto: recuperación/verificación 3, aviso-ticket 5, aviso-solicitud 10, recordatorio 5. Si la tabla no responde → 503 y no se envía (falla cerrado).
- **Lista blanca**: solo se escribe a correos de `personas.correo` o `usuarios_admin.correo`. Un aviso configurado en SOP-02 / solicitud_avisos a un correo fuera del padrón se **omite** y queda como `rechazado` en `correo_envios`. **OJO Diego:** si TI usa una lista de distribución (p. ej. `ti@grupoer.pe`) que no es correo de ninguna persona, dejará de recibir avisos; la decisión 8 lo exige así.
- Cada intento deja rastro (`accion`, `ip`, `sujeto`, `destinatario`, `resultado`, `detalle`).

## 5. Hallazgos durante el ensayo (choques con lo construido — se informan, no se ocultan)

1. **`portal_dni()` y `portal_modo()` eran SECURITY INVOKER.** Dentro de las vistas `v_portal_*` leen `personas`/`vinculos` con los permisos de la sesión; sin `acceso_demo` devolvían vacío y el Portal quedaba ciego (el ensayo lo detectó: `v_portal_perfil` 0 filas). Se pasan a definer con `search_path` fijo. Son ayudantes de identidad de solo lectura; `portal_dni` deriva el DNI del JWT y no acepta parámetros. Es el mismo caso de `fn_hora_entrada` del 31-08. La reversión los devuelve a invoker.
2. **Derivas de los canónicos respecto a producción**, corregidas en el repo: `vinculos.contrato` faltaba en `schema.sql`; `v_feriados` no estaba en ningún canónico; la política `documentos_admin` vivía solo en la migración del 16-08 (ahora en `accesos.sql`). Además prod conserva una sobrecarga huérfana `asignar_activo(text,text,text)` (cuerpo no está en el repo; fase 1 debería eliminarla), `perfil_empresas` nació sin RLS y `rits` sin grant a authenticated; `pg-local.mjs` lo nivela.
3. `fn_solicitud_insertar` (invoker, con guarda) deja de poder leer `solicitud_tipos` si se llama directo con sesión; solo la usan RPC definer, así que no afecta.

## 6. Procedimiento de aplicación (Diego, fuera de horario)

El clasificador de esta sesión bloquea leer y escribir producción, por eso los pasos 1-4 los corre Diego con `!` (el `!` corre en bash; por eso el `powershell -NoProfile -Command`).

1. **Migración** (una transacción; si falla la verificación, no cambia nada):
   ```
   ! powershell -NoProfile -Command ". .\scripts\token-supabase.ps1; node scripts/aplicar-sql.mjs supabase/migraciones/2026-09-17-fase0-contencion.sql"
   ```
2. **Verificar** (catálogo + comportamiento; con credenciales prueba una por una desde una sesión del Portal):
   ```
   ! powershell -NoProfile -Command ". .\scripts\token-supabase.ps1; $env:SUPERADMIN_EMAIL='…'; $env:SUPERADMIN_PASSWORD_INICIAL='…'; $env:PORTAL_DNI='…'; $env:PORTAL_CLAVE='…'; node scripts/verificar-fase0.mjs"
   ```
3. **Informe forense** (solo lectura):
   ```
   ! powershell -NoProfile -Command ". .\scripts\token-supabase.ps1; node scripts/fase0-forense.mjs"
   ```
4. **Rotar la contraseña de aplicación de Gmail** (decisión 9): cuenta Google → Seguridad → Verificación en dos pasos → Contraseñas de aplicaciones → revocar la actual y crear una nueva; en Vercel reemplazar `SMTP_PASS` (Production y Preview): `vercel env rm SMTP_PASS production` y `vercel env add SMTP_PASS production` (o el panel). Opcional: `CORREO_SECRETO` con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
5. **Desplegar el código** (endpoint + clientes) DESPUÉS de la migración, porque el endpoint falla cerrado sin `correo_envios`: `git push` (el commit ya está hecho en local). Vercel redespliega y toma la env nueva.
6. Si algo sale mal: `node scripts/aplicar-sql.mjs supabase/respaldos/2026-09-17-fase0-reversion.sql` (y `git revert` del commit si ya se desplegó).

## 7. Queda para la fase 1

Guarda central (`es_admin`, `es_superadmin`, `nivel_en`, `requiere_nivel`, `requiere_superadmin`), guardas en las 29 RPC (y las 17 auxiliares), `docs/funciones-y-permisos.md`, `ALTER DEFAULT PRIVILEGES` para que una función nueva nazca sin permiso, eliminar la sobrecarga huérfana de `asignar_activo`, y restituir lo que la fase 0 dejó inoperativo.
