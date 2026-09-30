# Motor de correo en Resend — diseño

**Fecha:** 2026-09-30 · **Estado:** aprobado por Diego (diseño conversado el mismo día)

## 1. Por qué

El motor de correo corría sobre una contraseña de aplicación de un Gmail personal. Google la revocó dos veces (2026-09-18 y 2026-09-29) y en la segunda dejó a los superadministradores sin poder entrar: el segundo factor viaja por correo. Además, las invitaciones y recuperaciones del BackOffice salían por el remitente nativo de Supabase: en inglés y con tope de 2 a 4 correos por hora.

Decisiones de Diego (2026-09-30):

1. Enviar desde un subdominio de un dominio propio. Compró `servicios-intranet.net` en Vercel; el subdominio de envío es `avisos.servicios-intranet.net`.
2. Pasar a Resend **los dos canales**: el motor propio y el correo de Supabase Auth.
3. Retirar Gmail por completo (sin respaldo automático).
4. Avisar de los envíos fallidos **dentro del BackOffice**, a los superadministradores.

## 2. Lo que ya está hecho (2026-09-30, sin cambios de código)

- Dominio `avisos.servicios-intranet.net` verificado en Resend. Registros en el DNS de Vercel (`vercel dns add servicios-intranet.net …`): DKIM `resend._domainkey.avisos`, MX y SPF en `send.avisos` (Amazon SES `sa-east-1`), `_dmarc.avisos` con `p=none`.
- Variables en Vercel (producción y preview): `RESEND_API_KEY` (llave «vercel-intranet», permiso *Sending access* limitado al dominio) y `CORREO_REMITENTE = GrupoER <no-responder@avisos.servicios-intranet.net>`.
- Producción redesplegada; el segundo factor ya llega por Resend (`correo_envios` id 17, `enviado`). `api/_correo.js` prefería Resend cuando existe la llave, por eso bastó la configuración.
- Gmail (`SMTP_USER`, `SMTP_PASS`) sigue en Vercel hasta el cierre de este ciclo.

Plan de Resend: gratis (3,000 correos al mes, **100 al día**, 3 dominios). Si una creación masiva de cuentas se acerca al tope, el plan Pro (20 USD/mes) no tiene tope diario.

## 3. Alcance

Cuatro piezas. Ninguna agrega funciones a `api/` (el plan Hobby de Vercel admite 12 y ya hay 12).

### 3.1 Motor propio: Resend como único proveedor

`api/_correo.js`:

- Se elimina el camino SMTP y la importación dinámica de `nodemailer`. `motorConfigurado()` pasa a ser `Boolean(RESEND)`. El remitente por defecto, si faltara `CORREO_REMITENTE`, es `GrupoER <onboarding@resend.dev>` (solo sirve para pruebas; en producción la variable existe).
- `enviar(destino, asunto, html)` llama a `POST https://api.resend.com/emails` como hoy. **Reintento:** si Resend responde `429`, espera 1 s y reintenta una sola vez; si vuelve a fallar devuelve el error. Cubre los envíos en lote (cuentas del portal por tramos de 10). Cualquier otro estado no-2xx devuelve `{ error: "El proveedor de correo respondió <status>: <primeros 200 caracteres>" }`, como hoy.
- Sin llave: `{ error: "El motor de correo aún no está configurado (falta RESEND_API_KEY)." }`.

Se retiran `nodemailer` de `package.json`, `scripts/verificar-smtp.mjs` y toda mención operativa a `SMTP_USER`/`SMTP_PASS` en los documentos de estado (README, MODELO.md, `docs/seguridad/README.md`). Los informes históricos por fecha no se editan. `scripts/comprobar-paquete.mjs` suma `RESEND_API_KEY` a los nombres de secreto que jamás deben aparecer en el bundle.

`src/pages/rrhh/Personal.jsx` (modal de cuentas en masa): el aviso «tope diario de Gmail ronda los 500» pasa a avisar desde 80 envíos que el tope diario de Resend es 100.

### 3.2 Rastro de los correos de acceso

Hoy `api/portal-cuentas.js` (acceso al portal) y `api/admin-usuarios.js` (acceso al BackOffice) envían sin dejar fila en `correo_envios`; su error solo lo ve quien disparó el envío. Ambos pasan a registrar cada intento con `registrar()` de `api/enviar-correo.js` (como ya hace `api/segundo-factor.js`):

| Acción | Dónde | `destinatario` | `resultado` | `detalle` |
|---|---|---|---|---|
| `acceso-portal` | portal-cuentas (crear, restablecer, crear-lote) | correo de la persona | enviado / error | error del proveedor o null |
| `acceso-admin` | admin-usuarios (crear, reenviar con clave provisional) | correo de la cuenta | enviado / error | ídem |

`ip` y `sujeto` van en **null** a propósito: el límite de tasa de `limitar()` cuenta filas por IP y por sujeto sin distinguir acción, y una creación masiva desde la oficina (una sola IP tras el NAT) bloquearía durante una hora las demás acciones. Estas filas son solo rastro: no limitan nada. El comportamiento actual de mejor esfuerzo se conserva (si el correo falla, la clave igual se muestra en pantalla o va al CSV).

### 3.3 Correo de Supabase Auth por Resend

Script nuevo `scripts/configurar-correo-auth.mjs`, que corre Diego con `!` porque lleva la llave:

- Lee la segunda llave de Resend («supabase-auth», *Sending access*, mismo dominio) por **stdin** (`Get-Clipboard | tr -d '\r\n' | node …`), nunca por argumento ni por el chat.
- `PATCH /v1/projects/<ref>/config/auth` con: `smtp_host = smtp.resend.com`, `smtp_port = 465`, `smtp_user = resend`, `smtp_pass = <llave>`, `smtp_admin_email = no-responder@avisos.servicios-intranet.net`, `smtp_sender_name = GrupoER`, `rate_limit_email_sent = 30` (por hora; hoy el nativo permite 2–4), y las dos plantillas que el sistema usa:
  - invitación (`mailer_subjects_invite` = «Tu acceso al BackOffice — GrupoER», `mailer_templates_invite_content`),
  - recuperación (`mailer_subjects_recovery` = «Crea una clave nueva — BackOffice GrupoER», `mailer_templates_recovery_content`).
- Las plantillas viven versionadas en `supabase/plantillas-correo/invitacion.html` y `recuperacion.html`, con el mismo estilo de `plantilla()` de `_correo.js` y el marcador `{{ .ConfirmationURL }}`. Signup, magic link y cambio de correo no se usan (signup deshabilitado) y no se tocan.
- Al terminar hace `GET` de la configuración y comprueba host, puerto, usuario, remitente y asuntos; sale con código 1 si algo no coincide. Nunca imprime la llave.

Los flujos del cliente no cambian: `crear_usuario_admin` sigue invitando por GoTrue, «reenviar» sigue prefiriendo `/auth/v1/recover` y `/admin/olvide-clave` sigue usando `resetPasswordForEmail`. Lo único que cambia es el remitente, el idioma y el tope.

### 3.4 Aviso de fallos en el BackOffice

**Base de datos.** Canónico nuevo `supabase/correo.sql`, embebido como bloque `@@CORREO@@` al final de `supabase/seguridad.sql` por `scripts/correo-generar.mjs` (mismo patrón que `@@LICENCIAS@@`: fuera de `CANONICOS` de pg-local; los `sinFaseN` lo recortan). Genera `supabase/migraciones/2026-09-30-correo-fallos.sql` y `supabase/respaldos/2026-09-30-correo-fallos-reversion.sql`.

Función `correo_fallos_recientes()`:

- `security definer`, `search_path = public, interno, extensions`, primera línea `perform requiere_superadmin()` (la guarda de la fase 1, que ya consulta el segundo factor).
- Devuelve las filas de `correo_envios` con `resultado = 'error'` y `creado_en >= now() - interval '24 hours'`, columnas `id, creado_en, accion, destinatario, detalle`, orden descendente, tope 100.
- `revoke all … from public, anon; grant execute … to authenticated`. `correo_envios` sigue sin política y sin privilegios para `authenticated`: el único camino de lectura es esta función. El inventario de la fase 4 (`SIN_POLITICA`) no cambia.

**Cliente.**

- `src/state.jsx`: fuente `correoFallos` cargada solo si `user.acceso.esSuperadmin` y después de resolver el segundo factor (un superadmin con factor pendiente recibiría 42501). Cualquier error deja la lista vacía sin aviso: la franja nunca bloquea la carga. Acción `recargarCorreoFallos()`.
- `src/components/Shell.jsx`: si hay filas, franja (tono pendiente) bajo la cabecera: «N correos no se pudieron enviar en las últimas 24 horas · Ver detalle». El detalle abre un modal con tabla (hora, tipo de correo con nombre legible, destinatario, error) y botón «Actualizar». Sin filas, no se muestra nada. No hay «marcar como visto»: desaparece sola cuando pasan 24 horas sin fallos.

### 3.5 Fuera de alcance

- Rebotes posteriores a la entrega (Resend acepta el correo y el rebote llega después): se ven en el panel de Resend, no en el aviso. Un webhook exigiría una función más en `api/`.
- Cambiar el dominio de la intranet (`intranet-general.vercel.app`) al nuevo dominio. Los enlaces de los correos siguen apuntando ahí.
- Buzón de respuesta: `no-responder@` no recibe correo.

## 4. Pruebas

- **vitest:** `tests/api/_correo.test.js` nuevo (fetch simulado: 200 → `{}`; 4xx → error con estado y texto; 429 → reintento único y luego éxito; 429 dos veces → error; sin llave → mensaje claro; nunca llama a nodemailer). Las pruebas de `enviar-correo`, `segundo-factor`, `portal-cuentas` y `admin-usuarios` se ajustan al rastro nuevo y a la ausencia de SMTP.
- **Ensayo local:** `scripts/ensayar-correo.mjs` sobre pg-local con seguridad + factor: la función existe con guarda; el superadmin con factor marcado lee los errores de 24 h y no los antiguos ni los `enviado`; un admin sin superadmin recibe 42501; `authenticated` sin JWT y `anon` no pueden ejecutarla ni leer `correo_envios`; la migración es re-aplicable y la reversión deja el catálogo sin la función.
- **Producción (`scripts/verificar-correo.mjs`, lo corre Diego con `!`):** catálogo (función, definer, search_path, grants), últimas filas de `correo_envios` con acción y resultado, configuración de Auth (`smtp_host`, remitente, asuntos) leída por Management API. Comprueba también que `RESEND_API_KEY` y `CORREO_REMITENTE` existen en Vercel y que `SMTP_USER`/`SMTP_PASS` ya no (por `vercel env ls`, sin valores).
- `scripts/funciones-y-permisos.mjs` regenerado: 165 funciones, 0 sin guarda.

## 5. Orden de despliegue

1. Código y pruebas en local (3.1, 3.2, 3.4 cliente, plantillas, scripts). Commits locales.
2. Diego aplica `2026-09-30-correo-fallos.sql` con `!` (Management API).
3. Push → CI `seguridad.yml` verde → deploy Ready.
4. Diego corre `verificar-correo.mjs` y entra al BackOffice: sin fallos recientes no debe verse franja; el detalle se prueba forzando un envío a un correo inválido desde una cuenta de prueba, o con las filas 15 y 16 del incidente si aún están dentro de las 24 h.
5. Diego crea la llave «supabase-auth» en Resend y corre `configurar-correo-auth.mjs` con `!`; prueba «olvidé mi clave» desde `/admin/olvide-clave` con su correo: llega en español desde `no-responder@avisos.servicios-intranet.net`.
6. Diego borra `SMTP_USER` y `SMTP_PASS` de Vercel (producción y preview) y redespliega. Revoca la contraseña de aplicación en Google.
7. Documentación (`docs/seguridad/README.md`, `MODELO.md`, informe de cierre) y memoria.

Vuelta atrás: hasta el paso 6, quitar `RESEND_API_KEY` y redesplegar devuelve el motor a Gmail. Después del 6, el camino de vuelta es cargar de nuevo una `RESEND_API_KEY` válida; Gmail ya no existe.

## 6. Riesgos y contingencias

- **Resend caído o llave revocada:** el segundo factor no llega y los superadministradores no entran. Contingencia documentada en `docs/seguridad/2026-09-28-segundo-factor.md` §4: `politica_acceso.factor_superadmin = false` por Management API.
- **Tope diario de 100:** la creación masiva avisa desde 80 envíos. Superado el tope, Resend responde error y cada fila queda como `error` (visible en la franja); las claves siguen en el CSV.
- **Reputación del dominio nuevo:** DMARC en `p=none` mientras se observa; los primeros correos pueden caer en spam. Endurecer a `quarantine` es un cambio de DNS posterior, fuera de este ciclo.
