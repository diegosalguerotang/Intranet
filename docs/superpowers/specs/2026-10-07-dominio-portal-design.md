# Dominio técnico de las cuentas del Portal — diseño

**Fecha:** 2026-10-07 · **Estado:** aprobado por Diego (diseño conversado el mismo día)

## 1. Por qué

Cada trabajador entra al Portal con su número de documento y una clave. Por debajo, Supabase Auth necesita un correo único por cuenta, así que el sistema fabrica uno técnico: `dni@portal.grupoer.pe`. El trabajador nunca lo ve y ese dominio no recibe correo.

El 2026-10-01 la intranet pasó a `servicios-intranet.net` y a la marca IntraTech. El dominio técnico quedó fuera de ese cambio y sigue nombrando a `grupoer.pe`, que ya no es la marca ni un dominio que el proyecto controle. Hoy hay 2 cuentas del Portal en producción y 0 trabajadores reales usándolo: es el momento barato de migrarlo.

Decisión de Diego (2026-10-07): el dominio técnico pasa a **`portal.servicios-intranet.net`**, con corte limpio (sin periodo de doble dominio).

## 2. Alcance

Un solo cambio de valor, aplicado en todos los sitios donde el dominio decide la identidad del Portal. No cambia ninguna regla de negocio, ninguna pantalla ni ningún texto que vea el trabajador.

### 2.1 Base de datos (canónico + migración)

Cuatro funciones comparan el correo del JWT con el dominio:

| Función | Canónico | Qué hace con el dominio |
|---|---|---|
| `portal_dni()` | `supabase/portal.sql` | Resuelve la persona del Portal a partir del correo del JWT. Base de toda la RLS del Portal. |
| `api_login_registrar` | `supabase/limites.sql` (bloque `@@FASE6@@` de seguridad.sql) | Solo la propia sesión `dni@dominio` puede registrar un ingreso exitoso. |
| `api_login_permitido` | `supabase/limites.sql` | Si el correo es del Portal, consulta el bloqueo por cuenta. |
| `api_login_registrar_proxy` | `supabase/limites.sql` | Si el correo es del Portal, registra el fallo con superficie `portal`. |

- Se editan los canónicos `portal.sql` y `limites.sql` con el dominio nuevo.
- **No se regenera el bloque `@@FASE6@@` ni la migración histórica `2026-09-21-fase6-limites.sql`** (son historia; `fase6-generar.mjs` las reescribiría). En su lugar, un generador nuevo `scripts/dominio-portal-generar.mjs` extrae las cuatro funciones del canónico nuevo y los cuerpos viejos de git (`COMMIT_PREVIO = 44097c5`), y produce:
  - `supabase/migraciones/2026-10-07-dominio-portal.sql`: redefine las cuatro funciones con el dominio nuevo, en una transacción, con verificación embebida (las cuatro funciones existen, llevan el dominio nuevo y ninguna conserva el viejo; `portal_dni` sigue `stable`; las `api_*` siguen definer con `search_path` fijo y solo las ejecuta `service_role`).
  - `supabase/respaldos/2026-10-07-dominio-portal-reversion.sql`: cuerpos viejos. **Se niega** si ya existe alguna cuenta en `auth.users` con el dominio nuevo (revertir el SQL sin revertir Auth dejaría a esas cuentas sin identidad).
  - Bloque `@@DOMINIO-INICIO@@ … @@DOMINIO-FIN@@` al final de `supabase/seguridad.sql`, espejo de la migración, para que pg-local y los ensayos arranquen con el estado nuevo. `sinFase6` de `fase6-generar.mjs` recorta también `DOMINIO`, igual que recorta `FACTOR` y `LICENCIAS`, para que `ensayar-fase6` siga reproduciendo la fase 6 histórica.
- Ensayo local `scripts/ensayar-dominio-portal.mjs` (pg-local con seguridad): reversión → estado viejo acepta `dni@portal.grupoer.pe` y rechaza el nuevo; migración → al revés; reversión + reaplicación idempotentes; la reversión se niega con una cuenta del dominio nuevo en `auth.users`.
- Invariante 27 en `scripts/ensayar-canon.mjs`: ninguna función de `public` ni de `interno` contiene `portal.grupoer.pe`; `portal_dni()` resuelve con el dominio nuevo.

### 2.2 Cuentas existentes en Supabase Auth

Script `scripts/migrar-dominio-portal.mjs` (Management API con `SUPABASE_ACCESS_TOKEN`, de ahí la llave de servicio, como hace `verificar-cuentas-masa.mjs`):

- Sin argumentos: lista las cuentas de `auth.users` cuyo correo termina en `@portal.grupoer.pe` y muestra cuántas son y a qué correo pasarían. No escribe.
- `--aplicar`: por cada una, `PUT /auth/v1/admin/users/{id}` con `email = <parte local>@portal.servicios-intranet.net` y `email_confirm = true`. La parte local (el DNI en minúsculas) no se toca. Al terminar, vuelve a listar y falla si queda alguna con el dominio viejo.
- `--verificar`: solo comprueba que no quede ninguna cuenta con el dominio viejo y que cada cuenta con el dominio nuevo tenga su fila en `cuentas_portal`.
- `--revertir`: el camino inverso (del dominio nuevo al viejo), solo para la reversión del punto 5.

Lo corre Diego con `!` en Git Bash, envuelto como los demás: `powershell -NoProfile -Command ". ./scripts/token-supabase.ps1; node scripts/migrar-dominio-portal.mjs --aplicar"`.

El cambio de correo por la API de administración no envía correo (el dominio nuevo tampoco recibe). Una sesión abierta con el JWT viejo deja de resolverse en `portal_dni()` en cuanto se aplica la migración SQL, y el Portal la expulsa al primer RPC. Con 2 cuentas de prueba es aceptable.

### 2.3 Código

- `api/_clave.js` ya exporta `DOMINIO_PORTAL` y `esCorreoPortal`. Cambia el valor y **los otros ocho archivos de `api/` dejan de repetir la constante** y la importan de ahí: `consentimiento-pdf`, `constancia-portal`, `descargar-documento`, `enviar-correo`, `portal-cuentas`, `rit`, `solicitud-pdf` (hoy compara con un literal), `supa` (solo el comentario). Un solo sitio para el valor.
- `portal/src/lib/api.js`: cambia `DOMINIO_PORTAL`. El cliente del Portal sigue fabricando `correoDe(dni)` igual.
- No se añade ninguna función a `api/` (Vercel Hobby, tope de 12 ya alcanzado).

### 2.4 Pruebas y scripts

- vitest: `tests/api/clave.test.js`, `enviar-correo.test.js`, `segundo-factor.test.js`, `supa.test.js` pasan al dominio nuevo. Se añade un caso en `clave.test.js`: `esCorreoPortal("x@portal.grupoer.pe")` es `false` (el dominio viejo ya no es del Portal).
- Scripts de operación y verificación contra producción: `verificar-portal`, `verificar-cuentas-masa`, `verificar-constancia-pdf`, `verificar-cumplimiento-boletas`, `verificar-privacidad`, `verificar-tipo-documento`, `estado-produccion`, `limpiar-produccion`, `entorno-pruebas` (y su patrón de correos ficticios `9xxxxxxx@portal…`). Todos al dominio nuevo.
- Ensayos locales (`ensayar-fase0…6`, `ensayar-jefe`, `ensayar-politica`, `ensayar-canon`): usan el dominio como claim del JWT de prueba. Regla: cada ensayo usa el dominio que exige el estado de la base que reproduce. Los que evalúan `portal_dni()` sobre el canon nuevo pasan al dominio nuevo; `ensayar-fase6` reproduce la fase 6 histórica (funciones `api_login_*` con el dominio viejo) y conserva el viejo para esas llamadas. Se corren todos y se ajusta cada uno según lo que falle; `ensayar-fase0` y `ensayar-fase1` ya no reproducen desde el 2026-09-22 y no cuentan.
- Los verificadores de fase (`verificar-fase0…6`, `fase0-forense`, `fase2-inventario`) comparan contra producción: los que filtran `auth.users` por dominio pasan al nuevo.

### 2.5 DNS

En el DNS de Vercel para `servicios-intranet.net`:

- `portal MX 0 .` (MX nulo, RFC 7505): cualquier servidor que intente entregar a `@portal.servicios-intranet.net` rechaza de inmediato, sin probar la IP del comodín `*` que hoy apunta a Vercel.
- `portal TXT "v=spf1 -all"`: nadie puede enviar en nombre de ese subdominio.

Si Vercel rechaza el MX nulo, se deja solo el SPF y se anota en el informe.

### 2.6 Documentación

- `docs/estado-del-proyecto.md` §3 (autenticación del Portal) y `docs/seguridad/README.md`: el dominio nuevo.
- `supabase/MODELO.md`: una línea en la sección del Portal con el dominio técnico y la fecha del cambio.
- `docs/seguridad/2026-10-07-dominio-portal.md`: informe corto (qué, por qué, cómo se aplicó, cómo se revierte, resultado de los verificadores).
- «Documentos Intranet» en OneDrive: `Léeme.txt` (direcciones a `servicios-intranet.net` y nota del dominio técnico) y la hoja de cuentas del Portal en `Accesos BackOffice y Portal.xlsx` si muestra el correo técnico.
- `docs/funciones-y-permisos.md` regenerado (se espera que siga en 169 funciones, 0 sin guarda).

## 3. Fuera de alcance

- Los correos de ejemplo `@grupoer.pe` de los seeds de `accesos.sql` (usuarios administrativos de prueba; no son del Portal).
- Specs, planes, informes y diffs históricos bajo `docs/` y `.superpowers/` que citan el dominio viejo.
- `.vercel/output/` (build local antiguo, fuera de git).
- Doble dominio, dominio configurable en tabla o variable de entorno (descartados: con 2 cuentas no compensan, y `portal_dni()` sostiene la RLS del Portal).

## 4. Orden de aplicación

1. Yo: canónicos, generador, migración, ensayos, código, pruebas y docs en commits locales. vitest, `ensayar-dominio-portal`, `ensayar-canon`, `ensayar-fase4`, `ensayar-fase6`, `ensayar-jefe`, `ensayar-politica` y `vite build` verdes antes de pedir nada a Diego.
2. Diego con `!`: aplica `supabase/migraciones/2026-10-07-dominio-portal.sql` (Management API).
3. Diego con `!`: `node scripts/migrar-dominio-portal.mjs --aplicar`.
4. Yo: `git push origin main` → CI `seguridad.yml` verde → deploy Ready en `intranet-general` e `intranet-portal`.
5. Yo: `vercel dns add` de los dos registros del punto 2.5.
6. Yo: `verificar-despliegue`, `verificar-fase4`, `verificar-fase6`, `verificar-portal`, `verificar-cuentas-masa`, `migrar-dominio-portal --verificar`, `funciones-y-permisos` (169).
7. Diego: entra al Portal con una de las dos cuentas (documento + clave de siempre). Es la prueba real.

Entre el paso 2 y el 4 el Portal no deja entrar (la base ya exige el dominio nuevo y el cliente aún manda el viejo). Son minutos y no hay trabajadores reales.

## 5. Reversión

En orden inverso: `git revert` del código → `migrar-dominio-portal` no tiene reversión propia: se vuelve a correr con los dominios intercambiados (`--revertir`, que renombra de nuevo a `@portal.grupoer.pe`) → `respaldos/2026-10-07-dominio-portal-reversion.sql` (se niega mientras exista alguna cuenta con el dominio nuevo, por eso Auth va antes).

## 6. Criterio de cierre

- Ninguna cuenta en `auth.users` con `@portal.grupoer.pe`; las 2 existentes entran al Portal con su clave de siempre.
- `grep -rI "portal.grupoer.pe"` sobre `api/`, `portal/src/`, `tests/` y `supabase/*.sql` no devuelve nada salvo el bloque histórico `@@FASE6@@` de seguridad.sql. En `scripts/` solo lo nombran los ensayos históricos de fase (por la regla del punto 2.4), `dominio-portal-generar.mjs` (reversión) y `migrar-dominio-portal.mjs` (busca las cuentas viejas).
- CI verde, verificadores del paso 6 verdes, informe y memoria cerrados.
