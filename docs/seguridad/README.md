# Seguridad de la Intranet — arquitectura resultante (fases 0–7, 2026-09-17 → 2026-09-21)

Este documento es la referencia de seguridad del sistema tras la corrección de seguridad (sustituye a la sección de seguridad que faltaba en el documento funcional; la Arquitectura Funcional v1.0 tiene diez secciones y ninguna de seguridad). Cada fase tiene su informe en esta carpeta con lo aplicado, lo verificado y su reversión.

## 1. Modelo de amenazas que se cubre

- Un navegador (BackOffice o Portal) con o sin sesión que intente leer, escribir o ejecutar más de lo que su rol permite, o que use el canal de la API directamente sin pasar por las pantallas.
- Un token o clave filtrada del cliente: el paquete publicado no contiene ninguna credencial (§3).
- Un administrador con alcance limitado (razón social, módulo, nivel) que intente ver más de lo suyo (§4).
- Fuerza bruta y bloqueo malicioso de cuentas (§6).
- Exposición de datos sensibles en tablas, vistas, auditoría o respaldos (§5).

No cubre: compromiso de la llave de servicio de Supabase o de las variables de Vercel (quedan solo en funciones serverless), ni ataques a la propia plataforma.

## 2. Identidad por petición (fase 1)

La identidad se resuelve **en cada consulta** en la base de datos, nunca en la interfaz: correo del JWT → `interno.usuarios_admin` activo → categoría vigente (`perfiles` + `perfil_permisos` + `perfil_empresas`). Ayudantes: `correo_llamador()`, `es_admin()`, `es_superadmin()`, `nivel_en(modulo)`, `requiere_nivel(modulo, nivel[, alternativo])`, `requiere_superadmin()`, `requiere_correo_propio(correo)`. Toda RPC administrativa empieza por una de esas guardas (`docs/funciones-y-permisos.md`, generado desde producción). Sin JWT, una sesión cuyo rol activo es `authenticated` o `anon` vale nivel 0 (fase 6); solo `postgres`, `supabase_admin` y `service_role` valen 99.

El trabajador del Portal se identifica por su correo técnico `dni@portal.grupoer.pe` (`portal_dni()`, `fn_persona_llamador()`); ninguna RPC de autoservicio recibe la identidad como parámetro.

`anon` ejecuta exactamente cuatro RPC (`verificar_bloqueo`, `registrar_ingreso`, `portal_verificar_bloqueo`, `portal_registrar_ingreso`) y nada más; los privilegios por defecto dejan toda función nueva sin EXECUTE para la API.

## 3. Canal (fases 0 y 6a, decisión P10)

El navegador habla **solo con su propio dominio**: `/api/supa` (Vercel) inyecta la clave publishable del lado del servidor, convierte `x-sesion` en `Authorization`, descarta cualquier credencial que llegue del cliente, añade `x-ip-real` y `x-agente` (evidencia; el cliente no puede fijarlos) y solo reenvía `auth/v1`, `rest/v1` y `storage/v1` (nunca `auth/v1/admin`). La decisión es por configuración con fallo cerrado (`src/lib/canal.js`, `portal/src/lib/api.js`): todo paquete de producción usa el proxy; el canal directo existe solo en `vite dev`. El paquete publicado no contiene URL ni clave de Supabase (`scripts/comprobar-paquete.mjs`, en CI). Las funciones serverless (`api/*.js`) usan la llave de servicio desde variables de entorno de Vercel y las funciones `api_*` de la base (solo `service_role`).

## 4. Datos: esquema `interno`, RLS por rol y vistas (fases 0b, 2, 3a, 4)

- Las tablas sensibles viven en `interno` (`usuarios_admin`, `perfiles`, `perfil_*`, `cargo_perfiles`, `registro_accesos`, `politica_acceso`, `auditoria`, `correo_tokens`, `datos_bancarios`, `columnas_sensibles`), esquema que PostgREST no publica: la API no puede tocarlas por `/rest/v1/<tabla>`; `anon` no tiene USAGE.
- RLS por rol en las 53 tablas de datos, generado desde una matriz (`scripts/fase4-generar.mjs` → `supabase/rls.sql`): `adm_lectura` (administrador activo con `nivel_en(modulo) ≥ 1` y alcance por razón social: `fn_alcance_*`), `propio` (trabajador: solo sus filas), `sesion` (catálogos sin datos personales), `adm_escritura` solo donde el BackOffice escribe una tabla directa. Ninguna política con condición `true`. El alcance filtra filas (vacío, no error).
- Las 9 vistas `v_portal_*` corren como el que consulta (`security_invoker`); las vistas administrativas exponen máscaras (cuenta y CCI: últimos 4).
- Bucket `documentos` privado, políticas por prefijo de ruta (`lotes/<empresa>`, `cargos/`, `rit/`, `solicitudes/<empresa>`).

## 5. Datos sensibles y auditoría (fases 3b, 3c, 5)

- Cuenta bancaria y CCI cifrados con pgcrypto y la llave del Vault en `interno.datos_bancarios` (`cuenta_cifrada`, `cci_cifrado`, máscaras `*_ultimos4`); la columna en claro de `personas` se eliminó. Descifrado solo con `fn_ver_cuenta_bancaria` (permiso `ver_bancarios` de la categoría), con rastro de auditoría.
- Claves de equipos: ya no se guardan; `activos.clave_gestor` es la referencia en el gestor de contraseñas (P5).
- Auditoría inmutable (`interno.auditoria`, trigger `trg_auditoria_inmutable`). `interno.columnas_sensibles` lista las columnas cuyo valor nunca se registra (`[sensible]` / `[sensible: cambiado]`). El histórico anterior se redactó una sola vez con aprobación explícita y rastro `REDACCION_HISTORICO` (P6). Criterio de notificación de brecha: `criterio-notificacion-brecha.md` (P16).
- Registros probatorios (`acuses`, `descargos`, `registro_accesos`): solo inserción, con IP y agente reales.

## 6. Claves, bloqueo y límites (fase 6)

- Clave del BackOffice: mínimo 10 caracteres con letras y números (P11), aplicado en el cliente, en `api/restablecer-clave.js` y en el proxy (`PUT auth/v1/user` de cuentas administrativas). Portal: 6 (Auth). Cambio obligatorio al primer ingreso; la clave provisional nunca se guarda en claro.
- Bloqueo por intentos según la política ACC-05 (hoy 10 intentos en 5 minutos), calculado **solo con los fallos que anota el proxy** tras una respuesta real de Auth (`registro_accesos.fuente = 'proxy'`); un «exitoso» solo lo registra la propia sesión. Compuerta en el proxy antes de hablar con Auth: por cuenta y por IP real (30 fallos en 15 minutos); si la base no responde, el acceso no se abre (503).
- Correo (`api/enviar-correo.js`): sesión o secreto del sistema en tiempo constante, lista blanca de destinatarios (padrón), límite por IP y por sujeto, rastro en `correo_envios`. Restablecimiento de clave por enlace: token de un solo uso, 1 hora, límite por IP.
- Riesgo residual: Supabase ve solo las IP de Vercel, así que sus propios límites por IP se comparten entre todos los usuarios (detalle en el informe de la fase 6).

## 7. Cómo se comprueba (fase 7)

| Cuándo | Qué | Herramienta |
|---|---|---|
| Cada push / PR | pruebas unitarias (proxy, canal, claves, correo, importaciones), compilación, paquetes sin credenciales, regresión del canon SQL en un Postgres embebido (17 invariantes de las fases 0–6) | `.github/workflows/seguridad.yml` → `npm test`, `scripts/comprobar-paquete.mjs`, `scripts/ensayar-canon.mjs` |
| Cada despliegue de producción | comprobaciones HTTP sin token: paquetes limpios, lista blanca del proxy, anon cerrado, pre-login vivo, clave débil rechazada, compuerta viva, canal viejo retirado | `scripts/verificar-despliegue.mjs` |
| Cada despliegue, opcional | verificadores de las fases 4, 5 y 6 contra la base (lecturas y transacciones revertidas) | job `produccion`, requiere el secreto `SUPABASE_ACCESS_TOKEN` del repositorio (`gh secret set SUPABASE_ACCESS_TOKEN`) |
| Antes de cada migración | ensayo local con reversión sobre el entorno 2.5 (datos anonimizados) | `scripts/ensayar-faseN.mjs`, `scripts/pg-local.mjs`, `scripts/entorno-pruebas.mjs` |
| A mano | `verificar-faseN.mjs`, `verificar-cierre-anon.mjs`, `diagnostico-permisos.mjs` | con `scripts/token-supabase.ps1` |

Regla de trabajo: cada cambio de esquema es un canónico (`supabase/*.sql`) + un generador (`scripts/faseN-generar.mjs`) que produce la migración en UNA transacción, su reversión y el bloque `@@FASEN@@` de `supabase/seguridad.sql`; se ensaya en local, se aplica con el «go» y se verifica en producción.

## 8. Índice de informes

| Fecha | Fase | Informe |
|---|---|---|
| 2026-09-17 | Paso 0 · verificación antes de tocar | `2026-09-17-paso0-resultados.md` |
| 2026-09-17 | 0 · contención · forense | `2026-09-17-fase0-contencion.md`, `2026-09-17-fase0-forense.md` |
| 2026-09-17 | 1 · cimiento (guarda central) | `2026-09-17-fase1-cimiento.md` |
| 2026-09-18 | 2 · vistas · inventario · entorno de pruebas | `2026-09-18-fase2-vistas.md`, `2026-09-18-fase2-inventario.md`, `2026-09-18-fase2_5-entorno-pruebas.md` |
| 2026-09-18 | 3a · esquema interno · 3b · datos bancarios · 3c · claves de equipos | `2026-09-18-fase3a-esquema-interno.md`, `2026-09-18-fase3b-datos-bancarios.md`, `2026-09-18-fase3c-claves-equipos.md` |
| 2026-09-18 | 4 · RLS por rol | `2026-09-18-fase4-rls.md` |
| 2026-09-18 | 5 · datos sensibles y auditoría · P16 | `2026-09-18-fase5-datos-sensibles.md`, `criterio-notificacion-brecha.md` |
| 2026-09-21 | 6 · límites, canal y claves | `2026-09-21-fase6-limites-canal-claves.md` |
| 2026-09-21 | 7 · comprobaciones en CI · 8 · documentación | este documento, `../funciones-y-permisos.md`, `../../supabase/MODELO.md` |
