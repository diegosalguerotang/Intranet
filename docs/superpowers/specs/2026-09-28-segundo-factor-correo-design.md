# Segundo factor por correo para el Superadministrador — diseño

Fecha: 2026-09-28. Estado: aprobado por Diego en conversación (decisiones abajo). Cierra el punto «2FA superadmin: POR DEFINIR» abierto en `Accesos_y_Roles_Intranet_V1_0_1.md` y en la spec de Categorías del 2026-08-13.

## 1. Decisiones de Diego

| Tema | Decisión |
|---|---|
| Mecanismo | Código de un solo uso enviado **por correo** (motor propio `api/_correo.js`, Gmail SMTP). No TOTP, no WhatsApp/SMS. |
| Alcance | Solo cuentas cuya categoría vigente es Superadministrador (`perfiles.es_superadmin`). El resto entra solo con clave. El Portal no cambia. |
| Frecuencia | En cada ingreso, salvo **equipo recordado**: tras verificar, el navegador guarda un token y no se vuelve a pedir en ese equipo por 30 días. |
| Cumplimiento | **En la base de datos**: hasta verificar, la sesión vale nivel 0 en toda la base, aunque alguien salte la pantalla o use la API. |
| Contingencia | **Solo vía técnica**: sin códigos de respaldo. Si el correo no sale, se apaga el interruptor de la política por Management API. |
| Anotación de la sesión | **Marca por sesión en BD** (`session_id` del JWT), no claim en el token. |
| Orden de puertas | Código **antes** que el cambio obligatorio de clave. |
| Casilla «Recordar este equipo» | Marcada por defecto. |
| Revocación de equipos | Botón «Olvidar todos los equipos recordados» en ACC-05. |

## 2. Reglas de negocio

- Tras la clave correcta, si la cuenta es superadmin y la política lo exige, el BackOffice pide un código de **6 dígitos** enviado al correo de la cuenta.
- El código **vence a los 10 minutos**, admite **5 intentos** y solo hay **uno vigente por sesión** (pedir otro invalida el anterior). No se puede pedir otro hasta **60 segundos** después del último envío.
- La marca de sesión verificada vence a las `politica_acceso.sesion_backoffice_horas` horas (hoy 8) desde la verificación; después la sesión vuelve a nivel 0 y la pantalla vuelve a pedir código (o usa el equipo recordado).
- Un equipo recordado vale **30 días** desde que se creó (no se renueva solo); se puede revocar desde ACC-05 o por SQL.
- El interruptor `politica_acceso.factor_superadmin` (encendido por defecto) apaga la exigencia para todos los superadmins. Es la vía de contingencia: `update interno.politica_acceso set factor_superadmin = false` por Management API (rol postgres, sin JWT). También se edita desde ACC-05 por un superadmin ya verificado.
- Nada cambia para las llamadas sin JWT de rol `postgres`/`service_role` (Management API, funciones serverless): siguen valiendo 99.

## 3. Modelo de datos (esquema `interno`, no publicado por PostgREST)

```
interno.factor_codigos
  id            bigint identity pk
  usuario_id    bigint not null references interno.usuarios_admin(id) on delete cascade
  session_id    uuid   not null
  codigo_hash   text   not null      -- sha256(codigo || session_id), hex
  creado_en     timestamptz not null default now()
  expira_en     timestamptz not null -- creado_en + 10 min
  intentos      int    not null default 0
  usado_en      timestamptz
  ip            text, agente text
  índice (session_id, creado_en desc)

interno.factor_sesiones
  session_id    uuid   pk
  usuario_id    bigint not null references interno.usuarios_admin(id) on delete cascade
  verificado_en timestamptz not null default now()
  expira_en     timestamptz not null -- verificado_en + sesion_backoffice_horas
  via           text   not null check (via in ('correo','dispositivo'))
  ip            text, agente text

interno.dispositivos_confiables
  id            bigint identity pk
  usuario_id    bigint not null references interno.usuarios_admin(id) on delete cascade
  token_hash    text   not null unique   -- sha256(token), hex
  creado_en     timestamptz not null default now()
  expira_en     timestamptz not null     -- creado_en + 30 días
  ultimo_uso    timestamptz
  revocado_en   timestamptz
  ip            text, agente text

interno.politica_acceso
  + factor_superadmin boolean not null default true
```

- Las tres tablas nuevas siguen las reglas de `interno`: sin USAGE para `anon`, sin GRANT a `authenticated`; solo las funciones definer las tocan. No llevan trigger de auditoría (no contienen datos personales; los hashes no son secretos reutilizables). Se limpian perezosamente: cada emisión borra los códigos vencidos del usuario; cada verificación borra las marcas vencidas del usuario.
- `v_politica_acceso` expone `factorSuperadmin`; `guardar_politica` gana el parámetro `p_factor_superadmin boolean` al final (firma vieja DROPeada, patrón del proyecto).

## 4. Guarda en la base

- `fn_factor_pendiente()` (definer, `stable`, `public`, ejecutable por `authenticated`): devuelve true cuando (a) la política exige el factor, (b) hay JWT con correo, (c) ese correo es un superadmin activo y (d) no existe fila vigente en `factor_sesiones` para `(auth.jwt() ->> 'session_id')::uuid`. Sin claim `session_id` → pendiente (nunca abre por ausencia).
- `fn_nivel_modulo(p_modulo)` **v4**: idéntica a la v3 (2026-09-14) salvo que, cuando el nivel calculado es 99 **por categoría** (hay correo en el JWT), devuelve 0 si `fn_factor_pendiente()`. El camino sin JWT (postgres/service_role → 99; anon/authenticated sin claims → 0) no cambia. Con eso caen en cascada `es_superadmin()`, `nivel_en()`, `requiere_nivel()`, `requiere_superadmin()`, las políticas RLS `adm_lectura`/`adm_escritura`, `fn_alcance_*` y toda RPC gated.
- `es_admin()` no cambia: un superadmin pendiente sigue siendo «administrador activo» para las políticas `sesion` (catálogos sin datos personales) y para `registrar_sesion_backoffice`/`mi_sesion_backoffice`, que van por `auth.uid()`. Eso es deseable: el login y la política de sesión única funcionan antes de verificar.
- **Fila propia garantizada**: la política `adm_lectura` de `interno.usuarios_admin` ya incluye `lower(correo) = correo_llamador()`, `perfiles` va por `fn_mi_perfil`, y `personas` deja ver la propia persona (fase 4). Por eso `v_usuarios_admin` y `v_mi_acceso` devuelven la fila del propio superadmin con nivel 0. El ensayo lo prueba explícitamente (§9).
- `mi_segundo_factor()` (definer, ejecutable por `authenticated`, identidad por `correo_llamador()`): devuelve `jsonb {exigido, esSuperadmin, verificado, expiraEn, correo}` donde `correo` va enmascarado (`d•••@gmail.com`). Es lo único que el cliente consulta por el proxy.
- Funciones de **servicio** (solo `service_role`, en `supabase/api-servicio.sql`; la identidad llega como parámetro porque la validó el endpoint contra GoTrue; **ninguna es ejecutable por el navegador**, así nadie puede registrar el hash de un código que él mismo conoce):
  - `api_factor_emitir(p_correo, p_session_id uuid, p_codigo_hash, p_ip, p_agente) → jsonb {ok | espera_seg | motivo}`: exige superadmin activo y política encendida; rechaza si el último código de esa sesión tiene menos de 60 s; invalida los anteriores de la sesión (usado_en = now()); inserta.
  - `api_factor_verificar(p_correo, p_session_id, p_codigo_hash, p_ip, p_agente) → jsonb {ok | motivo, intentos_restantes}`: toma el código vigente de la sesión; si no hay o venció → `vencido`; si `intentos >= 5` → `agotado`; si el hash no coincide → `intentos+1`, `incorrecto`; si coincide → `usado_en`, upsert en `factor_sesiones` (vía `correo`, expira = now() + política), fila de auditoría `FACTOR_VERIFICADO` (sin secretos).
  - `api_factor_dispositivo_crear(p_correo, p_session_id, p_token_hash, p_ip, p_agente) → void`: exige que esa sesión tenga marca vigente en `factor_sesiones` (un equipo solo se recuerda desde una sesión ya verificada); inserta con 30 días.
  - `api_factor_dispositivo_usar(p_correo, p_session_id, p_token_hash, p_ip, p_agente) → boolean`: token vigente, no revocado y del mismo usuario → upsert en `factor_sesiones` (vía `dispositivo`), `ultimo_uso`, auditoría `FACTOR_DISPOSITIVO`; si no → false (el endpoint no distingue por qué).
  - `api_factor_dispositivos_revocar(p_correo) → int`: `revocado_en = now()` en los vigentes del usuario; auditoría `FACTOR_DISPOSITIVOS_REVOCADOS`.
- Canónico nuevo `supabase/factor.sql` (tablas, columna de política, guardas, `mi_segundo_factor`, funciones de servicio y grants), cargado **después de `api-servicio.sql`** y antes de `seguridad.sql` (orden de MODELO.md y `scripts/pg-local.mjs` → sumar a `CANONICOS`). `fn_nivel_modulo` v4 vive en `accesos.sql` (donde está la v3) y `guardar_politica`/`v_politica_acceso` se actualizan en su canónico. Bloque `@@FACTOR@@` en `seguridad.sql` con los revokes/grants, como las fases anteriores.

## 5. Endpoint `api/segundo-factor.js`

POST, JSON, cabecera `x-sesion` con el JWT del BackOffice. Mismo esqueleto que `api/admin-usuarios.js`: valida el JWT con `GET /auth/v1/user` (llave de servicio) y **solo después** lee el claim `session_id` del payload de ese token ya validado (regla del proyecto: jamás decodificar a mano un JWT sin validar; aquí ya está validado por GoTrue). Correo del llamador en minúsculas; cuentas `@portal.grupoer.pe` → 403.

| acción | entrada | hace | responde |
|---|---|---|---|
| `enviar` | — | `limitar('segundo-factor', ip, correo)` (tope por sujeto 5/h como el resto); genera código con `crypto.randomInt(0, 1e6)` a 6 dígitos; `api_factor_emitir` con `sha256(codigo + session_id)`; envía correo (`plantilla`: «Tu código de ingreso», código en grande, vence en 10 min, «si no fuiste tú, cambia tu clave»); rastro en `correo_envios` (`accion = segundo-factor`, sujeto = correo, destinatario). Si el motor no está configurado o falla → **503** «No se pudo enviar el código. Avisa a soporte técnico.» y rastro `error`. | `{enviado: true, expiraEn}` / `{error, esperaSeg}` 429 |
| `verificar` | `{codigo, recordar}` | normaliza a 6 dígitos; `api_factor_verificar`; si ok y `recordar`: token de 32 bytes aleatorios base64url, `api_factor_dispositivo_crear(sha256(token))`. Rastro `correo_envios` solo en fallos (`rechazado` con motivo). | `{listo: true, dispositivo?: token}` / `{error, intentosRestantes}` 400 / `{error: 'vencido'}` 410 |
| `dispositivo` | `{token}` | `api_factor_dispositivo_usar(sha256(token))`. | `{listo: true}` / 401 `{error}` genérico |
| `olvidar` | — | `api_factor_dispositivos_revocar`. | `{revocados: n}` |

- Límite por IP (`limitar`) en `enviar` y `verificar`; `dispositivo` y `olvidar` solo exigen sesión válida.
- El endpoint nunca devuelve el código ni el hash; el único secreto que viaja al cliente es el token de equipo, una sola vez.
- `vercel.json`: sin cambios (función fija `api/segundo-factor.js`, sin segmentos dinámicos).

## 6. Cliente BackOffice

- `src/state.jsx`, resolvedor: tras leer la fila propia de `v_usuarios_admin` y `v_mi_acceso`, si `esSuperadmin` llama `rpc('mi_segundo_factor')`. Si `exigido && !verificado` → `setUser({... , factorPendiente: true})` **sin cargar el resto de vistas** (con nivel 0 saldrían vacías y dejarían la app en «sin datos»). Expone `factorVerificado()`: fuerza `tokenEnCurso = null` y vuelve a correr `resolver` con la sesión actual (carga completa, ahora con nivel 99).
- `src/layout/Shell.jsx`: `if (user.factorPendiente) return <SegundoFactor />;` **antes** de `if (user.requiereCambio) return <CambioClave />;`.
- `src/pages/SegundoFactor.jsx` (misma estética que CambioClave / login):
  1. Al montar, si `localStorage['backoffice-dispositivo']` existe → POST `dispositivo`; si `listo` → `factorVerificado()`; si no → borra el token guardado y sigue en 2.
  2. POST `enviar` automático; muestra «Enviamos un código a d•••@gmail.com» (correo de `mi_segundo_factor`), campo de 6 dígitos (`inputmode=numeric`, autoFocus, `autocomplete=one-time-code`), botón «Verificar», «Reenviar código» con cuenta regresiva de 60 s, casilla «Recordar este equipo por 30 días» (marcada por defecto) y «Salir» (`salir()` → login).
  3. `verificar` ok → si viene `dispositivo`, guardarlo en localStorage → `factorVerificado()`.
  4. Errores literales y accionables (patrón RestablecerAdmin): incorrecto con intentos restantes; vencido/agotado → botón «Pedir un código nuevo»; 429 → esperar; 503 → «No se pudo enviar el código. Avisa a soporte técnico.»; se oculta la casilla (ningún código llegó) pero «Pedir un código nuevo» sigue disponible tras los 60 s (ajuste 2026-09-29: antes se ocultaba también y la pantalla quedaba sin salida).
- `src/pages/accesos/Politica.jsx`: casilla «Exigir código por correo al Superadministrador» (`factorSuperadmin`, pasa a `guardarPolitica`) y botón «Olvidar todos los equipos recordados» (POST `olvidar`, muestra «N equipos olvidados»; también borra el token local).
- Política de sesión (inactividad 1 h, sesión única) sigue igual; `/admin/restablecer` no pasa por Shell y no se ve afectada. `marcar_clave_cambiada` exige correo propio, no nivel: CambioClave sigue funcionando tras el código.
- `src/data/mock.js` y `MODO_DEMO`: `factorPendiente: false`.

## 7. Impacto en suites y CI

- **Suites E2E con superadmin temporal por el proxy** (x-sesion): con la guarda nueva quedarían en nivel 0. Helper compartido `scripts/lib/marcar-factor.mjs` → `marcarSesionVerificada(accessToken)`: lee `session_id` del token, resuelve el usuario por correo e inserta en `interno.factor_sesiones` (vía Management API, rol postgres). Se aplica en cada suite que crea un admin temporal y llama por `/api/supa` o por endpoints con x-sesion; la lista exacta la fija el plan revisando `scripts/verificar-*.mjs` (candidatas: cuentas-masa, solicitud-pdf, constancia-pdf, movimientos, botones-bc, cumplimiento-boletas, privacidad, importacion-activos, diagnostico-login-e2e).
- `scripts/ensayar-canon.mjs` (CI, fase 7): invariante nuevo «superadmin con JWT y sin marca → `fn_nivel_modulo` = 0; con marca → 99; con política apagada → 99». Las simulaciones de identidad por `request.jwt.claims` que esperen 99 de un superadmin deben incluir `session_id` y marca, o apagar la política en su transacción.
- `scripts/verificar-fase4/5/6.mjs`: revisar las simulaciones de superadmin (mismo criterio). Las cuentas no superadmin (Karen, Daira) no cambian.
- `scripts/funciones-y-permisos.mjs`: regenerar (funciones nuevas con guarda; `api_factor_*` «solo service_role»).
- `tests/api/`: pruebas vitest del endpoint con la BD simulada (patrón existente): rutas felices, límites, 503 sin motor, nunca expone código/hash, `dispositivo` inválido → 401 genérico.

## 8. Seguridad y riesgos

- **Superficie**: el navegador solo alcanza `mi_segundo_factor()` (lectura de su propio estado) y el endpoint; las escrituras pasan por funciones `service_role`.
- **Fuerza bruta**: 5 intentos por código, 10 minutos de vida, `limitar()` por IP y por correo en el endpoint, 60 s entre envíos. Un código de 6 dígitos con 5 intentos da 5/10⁶ por sesión.
- **Hash del código** con `session_id` como sal: un volcado de `factor_codigos` no sirve fuera de esa sesión y dentro de sus 10 minutos.
- **Token de equipo**: 256 bits aleatorios; en BD solo su SHA-256; en el navegador en `localStorage` (mismo riesgo asumido que «Recordar mis datos»). Revocable en ACC-05.
- **Bloqueo del superadmin**: si el correo cae, el único camino es apagar `factor_superadmin` por Management API (decisión explícita de Diego, sin códigos de respaldo). Documentado en el informe de seguridad.
- **Gmail**: cada envío consume cupo (~500/día); con equipo recordado son pocos por mes.
- **Fuera de alcance**: 2FA para otras categorías, TOTP, WhatsApp/SMS, notificación al usuario cuando se registra un equipo nuevo.

## 9. Pruebas y despliegue

1. **Ensayo local** `scripts/ensayar-factor.mjs` sobre el Postgres embebido (entorno 2.5, sin datos reales): superadmin simulado con claims `{email, session_id}` → nivel 0 y `v_usuarios_admin`/`v_mi_acceso` devuelven su fila; con marca → 99; marca vencida → 0; política apagada → 99; emitir dos veces en <60 s → `espera`; 5 fallos → `agotado`; verificar ok → marca; dispositivo → marca sin código; revocar → dispositivo deja de valer; no superadmin → sin cambios.
2. **vitest** del endpoint (§7).
3. **Migración** `supabase/migraciones/2026-09-28-segundo-factor.sql` generada por `scripts/factor-generar.mjs` (una transacción, verificación de comportamiento embebida, reversión `2026-09-28-segundo-factor-reversion.sql` que elimina tablas/columna y restaura `fn_nivel_modulo` v3 y `guardar_politica` desde el respaldo). La aplica Diego con `!` (el clasificador de auto mode bloquea DDL en producción).
4. **Orden sin ventana de rotura**: migración en producción → push (el cliente viejo, sin pantalla, dejaría al superadmin con nivel 0 y datos vacíos, por eso el push va justo después y en horario de Diego) → deploy Ready → `scripts/verificar-factor.mjs` contra producción (admin temporal superadmin: login por proxy → `v_personal` vacía; `mi_segundo_factor` pendiente; `enviar` con el correo del temporal (CORREO_PRUEBA, el de Diego) o verificar con hash sembrado por Management API; `dispositivo` → nivel 99; `olvidar`; limpieza) → prueba manual de Diego en Chrome con su correo real (código, reenviar, recordar equipo, segundo ingreso sin código, olvidar equipos).
5. **Documentación**: `docs/seguridad/2026-09-28-segundo-factor.md` (qué, verificación, reversión, contingencia técnica paso a paso), README de seguridad §6 y §7, `supabase/MODELO.md` (orden de canónicos), `docs/funciones-y-permisos.md` regenerado, checklist e2e con el flujo nuevo.
