# Corrección de seguridad · Fase 6 — Límites, canal y claves (plan)

Fecha: 2026-09-21 · Estado de partida: fases 0–5 aplicadas en producción (commit 74027c1).

## Hallazgos que motivan la fase (además de P10 y P11)

1. `registrar_ingreso` y `portal_registrar_ingreso` son ejecutables por `anon` sin ninguna guarda: un
   «exitoso» falso reinicia el bloqueo por intentos de cualquier cuenta; un aluvión de «fallido» la bloquea.
2. El bloqueo por intentos solo lo consulta el navegador (`verificar_bloqueo`); el servidor nunca lo aplica.
3. `api/supa.js` reenvía cualquier ruta a Supabase y usa una clave cableada si falta la env var; el canal
   directo se decide por el hostname (`*.vercel.app`), no por configuración (P10).
4. `vercel.json` conserva el rewrite `/supa/*` → Supabase directo (canal viejo, sin uso).
5. Supabase Auth: `password_min_length` 6 global (obligado por el Portal), sin exigencia de caracteres. La
   fuerza de la clave del BackOffice solo la valida el cliente (P11).
6. `fn_nivel_modulo` devuelve 99 a una sesión sin claims aunque el rol activo sea `authenticated`/`anon`
   (hallazgo de la fase 4; no alcanzable por PostgREST).
7. Todo el tráfico llega a Supabase desde las IP de Vercel: los límites por IP de Auth se comparten entre
   todos los usuarios. Un atacante que fuerce logins agota el cupo de todos.

## Tareas (en orden)

1. **6a · Canal (P10)** — BackOffice (`src/lib/supabase.js`) y Portal (`portal/src/lib/api.js`): proxy
   `/api/supa` por defecto; canal directo solo con `VITE_CANAL_DIRECTO=1` en modo desarrollo. En producción
   el paquete no lleva URL ni clave de Supabase. `api/supa.js`: lista blanca de rutas (`auth/v1`, `rest/v1`,
   `storage/v1`), env var obligatoria (fallo cerrado), rewrite `/supa` retirado. Pruebas unitarias.
2. **6b · SQL** (`supabase/limites.sql` + `scripts/fase6-generar.mjs` → migración, reversión, bloque
   `@@FASE6@@`): `fn_nivel_modulo` → 0 sin JWT para `authenticated`/`anon`; `registrar_ingreso` y
   `portal_registrar_ingreso` guardan la IP real (`x-ip-real` del proxy) y exigen JWT de la propia cuenta
   para «exitoso»; RPC de servicio `api_login_permitido(ip, correo)` (por IP y por cuenta, según la
   política); piso de 10 para la clave del BackOffice en `politica_acceso`/`guardar_politica`. Ensayo local
   (`ensayar-fase6`) y verificador de producción (`verificar-fase6`).
3. **6c · Claves (P11)** — BackOffice: mínimo 10 caracteres con letras y números (Portal sigue en 6, decisión
   de Diego del 2026-08-21). Se aplica en `validarClave`, `CambioClave`, `RestablecerAdmin`, `Politica`,
   `api/restablecer-clave.js` y en el proxy (`PUT auth/v1/user` de cuentas que no son del Portal).
4. **6d · Límites** — compuerta de login en el proxy (`auth/v1/token?grant_type=password`): por IP real y
   por cuenta, fallo cerrado si la base no responde; degradación explícita (solo cuenta) mientras la
   migración 6b no esté aplicada. Límite por IP en `api/restablecer-clave.js`. Manejo de 429 en ambos logins.
5. **6e · Cierre** — `docs/seguridad/2026-09-21-fase6-limites-canal-claves.md`, memoria, commit y push.
   La migración la aplica Diego («go») con `aplicar-sql`, luego `verificar-fase6`.

## Supuestos a confirmar con Diego

- P11: mínimo 10 con letras y números para el BackOffice (una constante, `CLAVE_MIN_BACKOFFICE`).
- Umbral por IP del login: 30 fallidos en 15 minutos (oficina con NAT compartido).
