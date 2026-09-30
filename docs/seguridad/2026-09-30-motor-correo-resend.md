# Motor de correo en Resend y aviso de fallos — 2026-09-30

Spec: `docs/superpowers/specs/2026-09-30-motor-correo-resend-design.md` · Plan: `docs/superpowers/plans/2026-09-30-motor-correo-resend.md`

## 1. Motivo

El motor de correo (`api/_correo.js`) enviaba por SMTP de Gmail con una contraseña de aplicación de una cuenta personal. Google la revocó dos veces (2026-09-18 y 2026-09-29). La segunda vez el segundo factor no llegó y los superadministradores no pudieron entrar (`correo_envios` id 11: `535 BadCredentials`; incidente en `2026-09-28-segundo-factor.md` §4). Además, las invitaciones y recuperaciones del BackOffice salían por el remitente nativo de Supabase: en inglés y con tope de 2–4 correos por hora.

## 2. Qué cambió

**Dominio y DNS.** Diego compró `servicios-intranet.net` en Vercel; el subdominio de envío `avisos.servicios-intranet.net` quedó verificado en Resend con registros cargados por `vercel dns add`: DKIM (`resend._domainkey.avisos`), MX y SPF de retorno (`send.avisos` → Amazon SES `sa-east-1`) y `_dmarc.avisos` con `p=none`.

**Variables de Vercel (producción y preview).** `RESEND_API_KEY` (llave «vercel-intranet», *Sending access*, limitada al dominio; Sensitive) y `CORREO_REMITENTE = GrupoER <no-responder@avisos.servicios-intranet.net>`. `SMTP_USER` y `SMTP_PASS` se retiran al cerrar (§5).

**Motor propio (`api/_correo.js`).** Resend es el único proveedor; el camino SMTP y `nodemailer` desaparecen. Ante `429` espera 1 s y reintenta una sola vez (envíos en lote). Sin llave, error claro y `motorConfigurado() = false`. Pruebas: `tests/api/_correo.test.js`.

**Rastro completo.** Los correos de acceso al portal (`api/portal-cuentas.js`, acción `acceso-portal`) y al BackOffice (`api/admin-usuarios.js`, acción `acceso-admin`) ahora dejan fila en `correo_envios`, **sin IP ni sujeto**: el límite de tasa cuenta por IP/sujeto sin distinguir acción y una creación masiva desde la oficina bloquearía una hora las demás acciones. Son filas informativas.

**Aviso de fallos.** `correo_fallos_recientes()` (canónico `supabase/correo.sql`, bloque `@@CORREO@@` de `seguridad.sql`, generador `scripts/correo-generar.mjs`): `security definer`, `search_path` fijo, primera línea `perform requiere_superadmin()` (pasa por el segundo factor), `EXECUTE` solo para `authenticated`. Devuelve los envíos con `resultado = 'error'` de las últimas 24 h (tope 100). `correo_envios` sigue sin política ni privilegios para la API: la función es el único camino de lectura. En el BackOffice, `src/layout/AvisoCorreo.jsx` muestra a los superadministradores una franja «N correos no se pudieron enviar en las últimas 24 horas» con detalle (hora, tipo, destinatario, error literal de Resend) y botón «Actualizar»; se carga después del segundo factor y cualquier error la deja vacía.

**Supabase Auth.** `scripts/configurar-correo-auth.mjs` (lo corre Diego; la llave «supabase-auth» entra por stdin) fija el SMTP de Resend (`smtp.resend.com:465`, usuario `resend`), remitente `GrupoER <no-responder@avisos.servicios-intranet.net>`, `rate_limit_email_sent = 30` por hora y las plantillas en español de invitación y recuperación (`supabase/plantillas-correo/*.html`). Los flujos del cliente no cambian.

**Interfaz.** El aviso de la creación masiva de cuentas del portal pasa a «tope diario del proveedor es 100» desde 80 envíos.

## 3. Operación

- **Cargar o rotar la llave** sin que pase por el chat ni por un archivo: copiar la llave en Resend y, en la consola de Claude Code, `! vercel env rm RESEND_API_KEY production -y && powershell -NoProfile -Command Get-Clipboard | tr -d '\r\n' | vercel env add RESEND_API_KEY production --sensitive` (ídem `preview`), luego `! vercel redeploy https://intranet-general.vercel.app`. Comprobar antes que el portapapeles tiene la llave: `powershell -NoProfile -Command Get-Clipboard | tr -d '\r\n' | awk '{ print length($0), substr($0,1,3) }'` → `36 re_`.
- **Tope diario:** plan gratis de Resend, 3,000 correos al mes y 100 al día. Superado el tope, cada envío queda como `error` (visible en la franja) y las claves del portal siguen en el CSV. El plan Pro (20 USD/mes) no tiene tope diario.
- **Contingencia si Resend no envía y nadie puede entrar:** `politica_acceso.factor_superadmin = false` por Management API (`2026-09-28-segundo-factor.md` §4).
- **Leer la franja:** el error es la respuesta literal de Resend. `API key is invalid` → llave mal cargada; `403` → llave restringida a otro dominio o dominio sin verificar; `429` dos veces seguidas → lote demasiado rápido (raro: ya se reintenta).
- **Rebotes:** Resend acepta el correo y el rebote llega después; se ve en el panel de Resend, no en la franja.
- **DMARC** queda en `p=none` mientras se observa la entrega; endurecer a `quarantine` es un cambio de DNS posterior.

## 4. Verificación

| Qué | Cómo | Resultado esperado |
|---|---|---|
| Motor, rastro, helper | `npm test` | 244 pruebas verdes |
| Función SQL en local | `node scripts/ensayar-correo.mjs` | 8 ok |
| Regresión del canon | `node scripts/ensayar-canon.mjs` | 23 invariantes |
| Producción | `node scripts/verificar-correo.mjs` (Diego, con token) | base, rastro sin errores de Gmail, Auth por Resend, variables de Vercel |
| Catálogo de funciones | `node scripts/funciones-y-permisos.mjs` | 165 funciones, 0 sin guarda |
| A mano | «¿Olvidaste tu clave?» en `/admin/login` | llega en español desde `no-responder@avisos.servicios-intranet.net` |

## 5. Estado

- 2026-09-30 · configuración: dominio verificado, variables cargadas, redeploy; el segundo factor llegó por Resend (`correo_envios` id 17, `enviado`). Primera carga de la llave falló (`API key is invalid`, ids 15–16): el portapapeles no tenía la llave; recargada y verificada.
- 2026-09-30 · código: Tareas 1–7 del plan construidas y ensayadas en local (244 pruebas, ensayo 8/8, canon 23).
- 2026-09-30 · despliegue CERRADO: migración `2026-09-30-correo-fallos.sql` aplicada por Diego; push `1098a6c`, CI `seguridad.yml` verde, deploy Ready; Supabase Auth configurado por el SMTP de Resend con `configurar-correo-auth.mjs` (plantillas ok); `SMTP_USER`/`SMTP_PASS` retiradas de Production y Preview; `verificar-correo.mjs` todo verde; `funciones-y-permisos.md` regenerado (165 funciones, 0 sin guarda). Pendiente de Diego: revocar la contraseña de aplicación en Google.
