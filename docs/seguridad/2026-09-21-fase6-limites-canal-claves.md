# Corrección de seguridad · Fase 6 — Límites, canal y claves

Fecha: 2026-09-21 · Base: proyecto Supabase `mzpbdkrmokfxrrsotfgs` · Estado: **código y migración listos y ensayados (17/17 local, 204 pruebas unitarias); migración 6b PENDIENTE del «go» de Diego.** El cliente y el proxy se despliegan con el push y funcionan con el esquema actual (degradación explícita hasta aplicar la 6b).

## 1. Qué cierra la fase

| Punto | Estado |
|---|---|
| P10 · Proxy por configuración con fallo cerrado | **6a, hecho.** El navegador (BackOffice y Portal) usa `/api/supa` en TODO paquete de producción; el canal directo existe solo en `vite dev`. El paquete publicado ya no contiene ni la URL ni la clave de Supabase. El proxy exige la apikey por configuración (sin valor cableado) y solo reenvía `auth/v1`, `rest/v1` y `storage/v1` (nunca `auth/v1/admin`). Rewrite `/supa/*` retirado. |
| P11 · Clave del BackOffice fuerte | **6c, hecho.** Mínimo **10** con letras y números (`api/_clave.js` y `src/lib/campos.js`, prueba que exige que coincidan). Se aplica en el cliente (cambio obligatorio, restablecimiento, ACC-05), en `api/restablecer-clave.js` y **en el proxy** (`PUT auth/v1/user` de una cuenta que no es del Portal). Auth sigue en 6 (mínimo del Portal, decisión del 2026-08-21). |
| Hallazgo fase 4 · nivel 99 sin JWT | **6b.** `fn_nivel_modulo` mira el rol ACTIVO (`SET ROLE`) antes que el de sesión: `authenticated`/`anon` sin claims valen 0. |
| Límites de tasa restantes | **6b + 6d.** Compuerta de login en el proxy por IP real y por cuenta; bitácora con guarda de sesión; límite por IP en el restablecimiento de clave. |

## 2. Hallazgos nuevos (al planificar)

1. `registrar_ingreso` y `portal_registrar_ingreso` eran ejecutables por `anon` sin guarda: un «exitoso» falso reiniciaba el bloqueo por intentos de cualquier cuenta y un aluvión de «fallido» la bloqueaba (denegación de servicio a un administrador conociendo su correo).
2. El bloqueo por intentos solo lo consultaba el navegador; quien llamara a Auth por el proxy sin pasar por la pantalla no tenía freno propio.
3. Todo el tráfico llega a Supabase desde las IP de salida de Vercel. Los límites por IP de Auth (cubo de 30 por endpoint) se comparten entre todos los usuarios; el reenvío de IP de Supabase (`Sb-Forwarded-For`) lo fija su propia capa y no puede alimentarse desde nuestro proxy. Ver §6.

## 3. Fase 6b · SQL (`supabase/limites.sql`, migración `2026-09-21-fase6-limites.sql`)

- `registro_accesos.fuente` ∈ {`cliente`, `proxy`}: quién anotó la fila. **Solo los fallos del proxy cuentan para el bloqueo** (`verificar_bloqueo`, `portal_verificar_bloqueo`): los anota `api_login_registrar` con la llave de servicio tras una respuesta real de Auth (400/401/403), o cuando la compuerta niega («bloqueado»). Nadie puede fabricarlos desde el navegador.
- `registrar_ingreso` / `portal_registrar_ingreso`: un «exitoso» exige que el JWT lleve ese correo (`correo_llamador()`); guardan la IP real (`x-ip-real`, que genera el proxy) y el dispositivo. «fallido»/«bloqueado» siguen abiertos a `anon` (bitácora ACC-06 de la pantalla), ya sin efecto sobre el bloqueo.
- `api_login_permitido(ip, correo)` → `{permitido, motivo: 'ip' | 'cuenta'}`: por IP, **30 fallos del proxy en 15 minutos** (cualquier cuenta y superficie); por cuenta, la política vigente (hoy 10 intentos en 5 minutos). `api_login_registrar(correo, resultado, ip, agente)`. Ambas solo para `service_role`.
- `fn_nivel_modulo`: `coalesce(claims.role, GUC role, session_user)`; `authenticated`/`anon` → 0; `postgres`/`service_role`/`supabase_admin` → 99.
- Política: `clave_longitud_min_backoffice` ≥ 10 (constraint, default y valor), `guardar_politica` lo exige.
- Respaldo en `interno.respaldo_fase6` (6 funciones + permisos, constraint, default y valor); reversión `supabase/respaldos/2026-09-21-fase6-reversion.sql` (la columna `fuente` y su índice se conservan). Ensayo `scripts/ensayar-fase6.mjs` 17/17 (demuestra los huecos, aplica, comprueba cada regla, revierte con foto idéntica y vuelve a aplicar). Verificador `scripts/verificar-fase6.mjs` (producción, transacciones revertidas + comprobaciones HTTP del proxy).

## 4. Fase 6d · Compuerta en el proxy (`api/supa.js`)

Para `POST auth/v1/token?grant_type=password`: antes de reenviar, `api_login_permitido(ip real, correo)`. Negado → **429** con la forma de error de Auth (`over_request_rate_limit`, `msg`), se anota «bloqueado» y no se toca Auth. Base sin respuesta → **503, fallo cerrado**. Migración 6b ausente (PGRST202) → degrada a `verificar_bloqueo`/`portal_verificar_bloqueo` por cuenta y lo deja en el registro de Vercel. Tras un 400/401/403 de Auth se anota «fallido» con IP y agente. Los logins muestran el `msg` del 429 y no lo registran como clave incorrecta. `api/restablecer-clave.js`: límite por IP (30 por hora, `correo_envios`) y rastro de cada intento.

## 5. Cómo aplicar (Diego)

```
. .\scripts\token-supabase.ps1
node scripts/aplicar-sql.mjs supabase/migraciones/2026-09-21-fase6-limites.sql
node scripts/verificar-fase6.mjs
```

Luego: entrar al BackOffice (superadmin) y al Portal; en ACC-05 comprobar que la clave mínima del BackOffice marca 10; en ACC-06 las filas nuevas traen IP. Para revertir: `aplicar-sql supabase/respaldos/2026-09-21-fase6-reversion.sql`.

## 6. Supuestos y riesgo residual

- **P11 = 10 con letras y números** (una constante en dos sitios con prueba de igualdad). El 2026-08-21 se había bajado a 6; el plan de seguridad del 2026-09-17 pide «fuerte». Cambiarlo es editar `CLAVE_MIN_BACKOFFICE` en `api/_clave.js` y `src/lib/campos.js` y el piso en `supabase/limites.sql`.
- **Umbral por IP: 30 fallos en 15 minutos** (oficina con NAT compartido).
- **Límites por IP de Auth compartidos**: como Supabase ve solo las IP de Vercel, un ataque masivo que nuestra compuerta no frene a tiempo (30 fallos por IP atacante; con muchas IP) puede agotar el cubo de Auth para todos. La compuerta reduce mucho la superficie (cada IP atacante se cierra en 30 intentos y las cuentas en 10) pero no lo elimina. Señal: 429 en los logins de usuarios legítimos; respuesta: revisar `registro_accesos` (fuente `proxy`) y el Vercel Firewall. Supabase no permite fijar la cabecera de IP real desde un proxy propio (solo su `Sb-Forwarded-For` interno).
- Un «fallido» anotado por el navegador ya no bloquea: el bloqueo depende de que el login pase por el proxy, que es el único canal en producción (P10).

## 7. Pendiente

- Fase 7: verificadores en CI (`verificar-fase*.mjs` + ensayos como regresión). Fase 8: documentación (sección 16 del funcional, `funciones-y-permisos.md`, `MODELO.md`).
