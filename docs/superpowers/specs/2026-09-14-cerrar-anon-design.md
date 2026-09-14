# Hardening de acceso · Fase 1: cerrar el rol anónimo — Diseño

**Fecha:** 2026-09-14 · **Estado:** aprobado por Diego en conversación, pendiente de revisión escrita.

## 1. Problema

El esquema de producción sigue en el modo «SEGURIDAD (nivel demostración)» con el que nació el proyecto, cuando todavía no existía Supabase Auth (`supabase/schema.sql`, bloque a partir de la línea ~2459; réplicas en `accesos.sql` ~668 y `portal.sql` ~496). Verificado el 2026-09-14 con `scripts/diagnostico-permisos.mjs` (solo lectura) y con curl:

- Política `acceso_demo` `for all to anon, authenticated using (true) with check (true)` en 32 tablas (22 en schema.sql, 6 en accesos.sql, 4 en portal.sql). Otras 22 tablas no tienen RLS.
- Los privilegios por defecto del esquema `public` (roles `postgres` y `supabase_admin`) otorgan todos los privilegios a `anon` y `authenticated` sobre tablas, vistas, secuencias y funciones nuevas. Por eso las 46 vistas `v_*` y casi todas las tablas son legibles por `anon` aunque el canónico solo diga `grant select ... to authenticated`.
- Todas las RPCs de negocio son ejecutables por `anon`. Su único candado es `fn_nivel_modulo`, que devuelve **99 cuando no hay JWT** (`accesos.sql:320`, redefinida igual en `migraciones/2026-08-17-editar-trabajador.sql`). Es decir, un anónimo pasa el gate como superadmin.

Consecuencia comprobada: con solo la clave publishable (visible en el bundle), directo a `mzpbdkrmokfxrrsotfgs.supabase.co` o vía `/api/supa`, sin usuario ni contraseña, se leen `personas` (celular, dirección, correo, CCI, cuenta cifrada), `usuarios_admin` (incluida `clave_provisional` y `sesion_actual`), `registro_accesos`, `auditoria`, `cuentas_portal`, `vinculos`, `activos`, `sedes`, y se pueden invocar RPCs como `importar_padron` o `eliminar_trabajador`.

Por qué «funcionaba» así: el BackOffice carga TODAS las vistas al arrancar, antes del login (`src/state.jsx`, `useEffect` que llama `recargar()` al montar), con el rol anónimo. Y si una vista falla, ese módulo cae en silencio a los datos mock (`LOCAL`) con solo el rótulo «Datos locales de demostración» en el Shell.

## 2. Objetivo de la fase 1

Que **sin JWT no se lea ni se ejecute nada**, salvo las 4 RPCs que el login necesita antes de tener sesión. Que los objetos nuevos nazcan cerrados. Que el BackOffice cargue datos solo con usuario y nunca muestre datos demo en producción.

**Fuera de alcance (fase 2, spec aparte):** cerrar al rol `authenticated` (hoy un trabajador del portal con su JWT puede leer tablas ajenas), políticas RLS por rol, vistas `security_invoker`, filtro extra en el proxy `api/supa.js`.

## 3. Decisiones

| Decisión | Elección | Motivo |
|---|---|---|
| Dónde cerrar | En la base de datos, no en el proxy | La publishable key es pública; un filtro en el proxy se salta llamando directo a supabase.co. |
| Gate sin JWT | `fn_nivel_modulo` devuelve 99 sin JWT **solo** si el rol de sesión es `postgres` o `service_role`; para `anon` devuelve 0 | Las suites E2E llaman RPCs gated por Management API (rol `postgres`) y deben seguir funcionando; un anónimo por PostgREST queda en 0. |
| RPCs abiertas a anon | `verificar_bloqueo`, `registrar_ingreso`, `portal_verificar_bloqueo`, `portal_registrar_ingreso` | Son las únicas que el BackOffice (`AdminLogin.jsx`) y el portal (`Ingreso.jsx`, `conSesion: false`) invocan antes de tener sesión. Todo lo demás (restablecer clave, correos, RIT) va por funciones serverless con service key. |
| Política `acceso_demo` | Se recrea solo `to authenticated` | Mantiene el comportamiento actual para usuarios con sesión (fase 2 la sustituye). |
| Fallo de carga en producción | Error visible + reintentar; nunca datos mock | Decisión de Diego 2026-09-14. El mock queda solo cuando no hay Supabase configurado (desarrollo local). |
| Orden de despliegue | 1.º frontend, 2.º migración | El frontend nuevo funciona con la BD abierta; al revés, el BackOffice arrancaría sin datos hasta el segundo deploy. |

## 4. Diseño

### 4.1 Migración `supabase/migraciones/2026-09-14-cerrar-anon.sql` (idempotente)

Bloques, en este orden:

1. **Revocar a `anon` todo lo existente en `public`:** `revoke all on all tables in schema public from anon` (cubre vistas), `... on all sequences ...`, `... on all functions ...`.
2. **Privilegios por defecto:** `alter default privileges for role postgres in schema public revoke all on tables/sequences/functions from anon`; ídem `for role supabase_admin`. Así lo que se cree después nace cerrado para anon sin depender de que cada migración lo recuerde.
3. **Política `acceso_demo`:** para cada tabla que la tenga (consulta `pg_policies`), `drop policy` y `create policy acceso_demo on <t> for all to authenticated using (true) with check (true)`.
4. **`fn_nivel_modulo` v3:** misma lógica, pero cuando `v_correo is null` el resultado depende del rol que hizo la petición. Dentro de una función `security definer` `current_user` es el dueño (`postgres`), así que no sirve; se usa `coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), session_user::text)`. PostgREST siempre fija `request.jwt.claim.role` (`anon`, `authenticated` o `service_role`); por Management API no existe y cae en `session_user` = `postgres`. Regla: rol `postgres` o `service_role` → 99 (suites y serverless); cualquier otro → 0. La suite prueba los dos caminos.
5. **Re-otorgar EXECUTE a anon** en las 4 RPCs de login.
6. Verificación embebida al final (`do $$ ... raise exception ... $$`) que falle si `has_table_privilege('anon','personas','select')` o `has_function_privilege('anon','importar_padron(jsonb)','execute')` siguen siendo verdaderos, y si alguna de las 4 RPCs de login dejó de serlo.

Canónicos: en `schema.sql` el bloque «SEGURIDAD (nivel demostración)» pasa a llamarse «SEGURIDAD · anon cerrado (2026-09-14)» y contiene los bloques 1, 2, 3 y 5; `acceso_demo` en `accesos.sql` y `portal.sql` se crea `to authenticated`; `fn_nivel_modulo` v3 en `accesos.sql` y la migración `2026-08-17-editar-trabajador.sql` queda como histórico (no se edita). Cualquier `grant ... to anon` explícito del canónico (`schema.sql` líneas ~259, ~382, ~895) se reduce a `authenticated`.

### 4.2 Frontend BackOffice (`src/state.jsx`, `src/layout/Shell.jsx`)

- **Carga tras sesión:** se elimina el `useEffect` que llama `recargar()` al montar. `resolver(session)` llama `recargar()` después de `setUser(...)` con usuario activo, y `salir()` vuelve `db` a vacío. Cambio de sesión (`onAuthStateChange` con usuario distinto) recarga.
- **Sin mock en producción:** `db` arranca con `LOCAL` únicamente si `!supabaseListo` (sin Supabase configurado). Con Supabase, arranca con colecciones vacías (`Object.fromEntries(Object.keys(FUENTES).map(k => [k, []]))`). `origen` pasa a tres valores: `"supabase"`, `"local"` (solo sin Supabase) y `"error"` (alguna vista falló).
- **Aviso de error:** el Shell, cuando `origen === "error"`, muestra una franja «No se pudieron cargar los datos. Reintentar» que llama `recargar()`. El rótulo «Datos locales de demostración» solo aparece con `origen === "local"`.
- Las llamadas puntuales `recargar("clave")` de las acciones no cambian.

El portal (`portal/src`) no cambia: ya usa RPC sin sesión solo para bloqueo/registro de ingreso y todo lo demás con `x-sesion`.

### 4.3 Suite `scripts/verificar-cierre-anon.mjs`

Directo contra `https://mzpbdkrmokfxrrsotfgs.supabase.co` con solo la publishable key (sin pasar por el proxy) y también vía `/api/supa` para el camino del navegador:

1. `GET rest/v1/personas`, `usuarios_admin`, `v_personal`, `v_usuarios_admin`, `registro_accesos`, `cuentas_portal` → 401 o 403 (nunca 200 con filas).
2. `POST rest/v1/rpc/importar_padron` y `rpc/eliminar_trabajador` sin sesión → 401/403 (permiso de ejecución), no un error de negocio.
3. `POST rest/v1/rpc/verificar_bloqueo`, `registrar_ingreso`, `portal_verificar_bloqueo`, `portal_registrar_ingreso` sin sesión → 200.
4. Con `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD_INICIAL`: login BackOffice completa y `v_usuarios_admin` + `v_mi_acceso` + `v_personal` con `x-sesion` → 200.
5. Por Management API (SQL): `select fn_nivel_modulo('personal')` → 99 (camino `session_user = postgres`); `set role anon; select fn_nivel_modulo('personal')` → 0.
6. Radiografía final: `diagnostico-permisos.mjs` reporta 0 grants a anon en tablas y vistas, y solo 4 funciones ejecutables por anon.

Criterio de éxito global: esta suite verde, las 10 suites existentes verdes (padrón, control semanal, tres ajustes, cumplimiento boletas, solicitudes, solicitud-pdf, cuentas masa, fijar correo, sedes, asistencia), `vitest` 145/145, y prueba manual de Diego: login BackOffice muestra el padrón real, login portal muestra sus datos.

### 4.4 Riesgos y mitigación

- **Suites que llaman RPC por PostgREST sin sesión** (`verificar-cuentas-masa`, `verificar-cumplimiento-boletas`, `verificar-solicitud-pdf`, `verificar-portal`, `verificar-e2e-*`): la mayoría hace login como admin temporal antes; las que dependan del gate abierto se ajustan a crear sesión (patrón admin temporal 2026-08-19). Se detecta corriéndolas tras la migración.
- **Vistas que llaman funciones invoker** (lección 2026-08-31): revocar a anon no las afecta porque las lecturas ya irán con `authenticated`.
- **Funciones serverless** (`api/*.js`): usan `SUPA_SERVICE_KEY`; `service_role` no se toca.
- **Rollback:** la migración es reversible re-otorgando a anon (`grant select on all tables in schema public to anon` + política original); se documenta en el propio archivo como bloque comentado.

## 5. Entregables

1. Spec (este archivo) + plan en `docs/superpowers/plans/2026-09-14-cerrar-anon.md`.
2. Suite `scripts/verificar-cierre-anon.mjs` (escrita primero; falla antes de la migración).
3. Frontend: `src/state.jsx`, `src/layout/Shell.jsx` + tests vitest de la lógica de `origen`.
4. Migración + canónicos actualizados.
5. Despliegue: push frontend → deploy Ready → Diego aplica la migración vía `! powershell -NoProfile -Command "..."` con `aplicar-sql.mjs` (el clasificador bloquea al agente) → suites → prueba manual.
6. Memoria del proyecto y `supabase/MODELO.md` actualizados (sección de seguridad).
