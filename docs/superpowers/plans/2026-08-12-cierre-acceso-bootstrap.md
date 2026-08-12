# Cierre de Acceso y Bootstrap del Superadministrador — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Cerrar el login del BackOffice según `LOGIN/Cierre_de_Acceso_y_Bootstrap_V1_0.md`: autenticación real con Supabase Auth en `/admin/login` (correo + clave, bcrypt, sin autorregistro), mensaje de error único, intentos y bloqueos registrados en ACC-06, clave mínima diferenciada en ACC-05, y seed idempotente del primer superadministrador con cambio de clave obligatorio.

**Architecture:** Supabase Auth como proveedor (signup deshabilitado a nivel de proyecto — no existe endpoint público de registro; hash bcrypt gestionado por GoTrue). La sesión vive en el cliente supabase-js; `state.jsx` deriva el usuario de la sesión + `v_usuarios_admin` (solo entra quien tiene usuario administrativo activo — cuenta Auth sin fila en `usuarios_admin` se expulsa con el mismo mensaje genérico). Bitácora y bloqueo por RPCs `security definer`. El Portal del Trabajador NO se toca (no existe aún; `/login` queda redirigido a `/admin/login` hasta que exista).

**Fuera de alcance (siguiente ciclo, consultar a Diego):** Fases 2 y 7 del prompt — autorización por petición en el servidor para TODOS los módulos = reemplazar la política RLS `acceso_demo` por políticas por rol basadas en `puede()` + vistas `security_invoker`. 2FA: POR DEFINIR en la spec.

## Global Constraints

- Mensaje de error ÚNICO en login: "Usuario o clave incorrectos" (cuenta inexistente = clave equivocada).
- Ninguna clave en el repositorio ni en el código: el seed lee `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD_INICIAL`, `SUPERADMIN_DNI` del entorno.
- Seed idempotente: correrlo dos veces no duplica ni resetea claves.
- Clave mínima BackOffice: 12 (también en la config del proyecto Supabase); Portal: 6 (campo separado en ACC-05, para cuando exista el Portal).
- Todo intento (exitoso/fallido/bloqueado) se registra en `registro_accesos`, incluidos correos inexistentes.
- SQL vía `scripts/aplicar-sql.mjs` + `scripts/token-supabase.ps1`. Verificación: `npm run build` + pruebas E2E por Node.

---

### Task A: Esquema — bitácora de login, bloqueo, clave diferenciada y cambio obligatorio

**Files:** Modify `supabase/accesos.sql` (canónico) · Create `scripts/aplicar-login.sql` (delta idempotente para el proyecto ya sembrado) · Modify `src/data/mock.js`, `src/state.jsx` (formas nuevas)

- `usuarios_admin` + col `requiere_cambio_clave boolean not null default false`.
- `registro_accesos` + col `correo text` (intentos de correos inexistentes); `v_registro_accesos.usuario = coalesce(nombre, dni, correo, '—')`.
- `politica_acceso`: `clave_longitud_min` se divide en `clave_longitud_min_portal` (default 6, check ≥6) y `clave_longitud_min_backoffice` (default 12, check ≥12). Vista y `guardar_politica` con la firma nueva (`p_clave_min_portal`, `p_clave_min_backoffice`); `state.jsx.guardarPolitica` y mock `POLITICA_ACCESO` alineados; `v_usuarios_admin` expone `"requiereCambio"`.
- RPCs nuevas (security definer):
  - `verificar_bloqueo(p_correo)` → boolean: fallidos consecutivos (posteriores al último exitoso) dentro de la ventana `bloqueo_minutos` ≥ `intentos_bloqueo`.
  - `registrar_ingreso(p_correo, p_resultado, p_dispositivo)` → void: inserta en `registro_accesos` vinculando usuario y perfil vigente si existen; si exitoso, actualiza `ultimo_ingreso`.
  - `marcar_clave_cambiada(p_correo)` → void: `requiere_cambio_clave=false`, `clave_provisional=null`.
- Aplicar delta y verificar: conteos, `verificar_bloqueo` con datos sintéticos, firma nueva de `guardar_politica`.

### Task B: Config Auth del proyecto — signup cerrado y clave mínima 12

**Files:** Create `scripts/configurar-auth.mjs`

- `PATCH https://api.supabase.com/v1/projects/mzpbdkrmokfxrrsotfgs/config/auth` con `{ disable_signup: true, password_min_length: 12 }` (token de Management API). Verificar con GET que quedó aplicado.

### Task C: Seed idempotente del primer superadministrador

**Files:** Create `scripts/seed-superadmin.mjs`

- Lee `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD_INICIAL`, `SUPERADMIN_DNI` del entorno (aborta si faltan).
- Obtiene la service_role key vía Management API (`GET /v1/projects/{ref}/api-keys?reveal=true`) con `SUPABASE_ACCESS_TOKEN` — nunca se guarda en disco.
- Con supabase-js admin: si NO existe usuario Auth con ese correo → `createUser({ email, password, email_confirm: true })`; si existe → NO toca la clave.
- SQL (Management API): persona con `SUPERADMIN_DNI` si no existe; perfil `superadmin` si no existe; `usuarios_admin` si no existe (con `requiere_cambio_clave=true`); si ya existe, solo garantiza `requiere_cambio_clave=true` **cuando el usuario Auth es recién creado** (no en re-ejecuciones puras).
- Ejecutarlo DOS veces y verificar: 1 usuario Auth, 1 usuario_admin, clave intacta (login sigue funcionando con la clave original).

### Task D: Frontend — /admin/login, cambio de clave obligatorio y sesión real

**Files:** Create `src/pages/AdminLogin.jsx`, `src/pages/CambioClave.jsx` · Modify `src/state.jsx`, `src/layout/Shell.jsx`, `src/App.jsx` · Delete uso de `src/pages/Login.jsx` (demo)

- `state.jsx`: `user` se deriva de la sesión (`supabase.auth.getSession()` + `onAuthStateChange`) → busca `v_usuarios_admin` por correo; si no hay fila o está suspendido → `signOut()` (cierre real: existir en Auth no basta). `user = { id, nombre, rol: perfilNombre, correo, esSuperadmin, requiereCambio }`. Estado `cargandoSesion` para no parpadear al recargar.
- `AdminLogin` (`/admin/login`): correo + clave; flujo: `verificar_bloqueo` → si bloqueado registra `bloqueado` y muestra "Demasiados intentos fallidos. Vuelve a intentarlo en unos minutos."; si no → `signInWithPassword`; fallo → `registrar_ingreso(fallido)` + "Usuario o clave incorrectos" (único); éxito → validar fila en `v_usuarios_admin` (si no → signOut + mismo mensaje genérico + registro fallido) → `registrar_ingreso(exitoso)`.
- `CambioClave`: si `user.requiereCambio`, el Shell la muestra en lugar del Outlet (no se puede operar ninguna pantalla). Clave nueva ≥ 12 (mínimo del proyecto + validación UI), confirmación, `auth.updateUser({ password })` + `marcar_clave_cambiada`.
- `Shell`: sin sesión → `Navigate /admin/login`; "Cerrar sesión" → `auth.signOut()`.
- Rutas: `/admin/login` → AdminLogin; `/login` → `Navigate /admin/login` (hasta que exista el Portal). El login demo por DNI desaparece.
- `Politica.jsx`: dos campos de clave mínima (Portal min 6 / BackOffice min 12).

### Task E: Verificación E2E, deploy y entrega de credenciales

- Node + supabase-js (clave publishable): login con clave errónea → error + fila `fallido` en `v_registro_accesos`; N intentos → `verificar_bloqueo=true`; login correcto → sesión y `requiereCambio=true`; `signup` → rechazado (signup deshabilitado).
- `npm run build`, commit, push → Vercel; verificar en producción que `/admin/login` responde y las rutas internas redirigen.
- Actualizar memoria del proyecto y entregar a Diego el correo + clave inicial (de un solo uso: el sistema exige cambiarla al primer ingreso).
