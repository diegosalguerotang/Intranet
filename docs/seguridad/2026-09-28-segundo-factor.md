# Seguridad · Segundo factor por correo para el Superadministrador

Fecha: 2026-09-28 · Base: proyecto Supabase `mzpbdkrmokfxrrsotfgs` · Estado: **APLICADO en producción el 2026-09-28 (migración `2026-09-28-segundo-factor.sql` ejecutada por Diego por Management API, `201`). Cliente desplegado (1469dbd). `verificar-factor` 12/12 verde y `verificar-despliegue` verde en producción; `funciones-y-permisos.md` regenerado (161 funciones, 0 sin guarda). Migración `2026-09-28-columnas-sensibles-rls.sql` aplicada (RLS en `interno.columnas_sensibles`, hueco preexistente de la fase 5) y `verificar-fase4` todo verde. Pendiente solo la prueba manual A3 de Diego.** Incidente del despliegue: el primer deploy (3365280) falló en «Deploying outputs» porque `api/segundo-factor.js` elevó a 13 las funciones serverless y el plan Hobby de Vercel admite 12; se retiró `api/eco.js` (espejo de diagnóstico del login) en 1469dbd.

Cierra el punto «2FA superadmin: POR DEFINIR» de `Accesos_y_Roles_Intranet_V1_0_1.md`. Diseño aprobado: `docs/superpowers/specs/2026-09-28-segundo-factor-correo-design.md`.

## 1. Qué hace

| Tema | Regla |
|---|---|
| A quién | Solo cuentas cuya categoría vigente es Superadministrador (`perfiles.es_superadmin`). Las demás entran solo con clave. El Portal no cambia. |
| Qué pide | Tras la clave correcta, un código de **6 dígitos** enviado al correo de la cuenta (`api/_correo.js`, Gmail SMTP). Vence a los **10 minutos**, **5 intentos**, uno vigente por sesión, **60 s** entre envíos. |
| Dónde se cumple | **En la base**: `fn_nivel_modulo` v4 devuelve 0 a un superadmin cuya sesión (claim `session_id` del JWT) no tiene marca vigente en `interno.factor_sesiones`. Caen en cascada `es_superadmin`, `nivel_en`, `requiere_*`, las políticas RLS y toda función que autoriza por nivel; las que deciden por `es_superadmin` directamente (`fn_ver_cuenta_bancaria`, `fn_nivel_memorandums`, `importar_planilla_unificada`) consultan `fn_factor_pendiente` (sección 7 de `factor.sql`); `importar_padron` e `importar_control` ya empiezan con `fn_nivel_modulo(…) < 2`. El canon lo vigila: `ensayar-canon` falla si aparece otra función ejecutable por `authenticated` que lea `es_superadmin` / `"esSuperadmin"` / `ver_datos_bancarios` sin pasar por el nivel ni por `fn_factor_pendiente`. Los endpoints con `x-sesion` que autorizan con la llave de servicio consultan `mi_segundo_factor()` y responden 403 (`api/_factor.js`). |
| Concurrencia | Las funciones `api_factor_*` toman un candado consultivo por sesión (`pg_advisory_xact_lock(hashtext(session_id))`) antes de leer o escribir su marca: dos verificaciones o dos renovaciones simultáneas de la misma sesión no pisan el estado ni cuentan intentos dos veces. |
| Equipo recordado | Casilla marcada por defecto: token de 256 bits en `localStorage['backoffice-dispositivo']`, solo su SHA-256 en `interno.dispositivos_confiables`, **30 días** sin renovación. `api_factor_dispositivo_crear` solo acepta sesiones verificadas por código (`via = 'correo'`): un equipo recordado no puede renovarse a sí mismo sin volver a pasar por el código. Revocable en ACC-05 («Olvidar todos los equipos recordados») o por SQL. |
| Vigencia de la marca | `politica_acceso.sesion_backoffice_horas` (hoy 8) desde la verificación; después se vuelve a pedir código (o equipo recordado). Con la app abierta, el cliente programa un temporizador hasta `expiraEn` (de `mi_segundo_factor`) que vuelve a resolver la sesión y muestra la pantalla del código; además, un 42501 recibido por un superadmin re-resuelve la sesión (una vez) en vez de quedar como «permiso insuficiente». Encender el interruptor en ACC-05 re-resuelve la propia sesión, que pide el código de inmediato. |
| Interruptor | `interno.politica_acceso.factor_superadmin` (encendido por defecto). Se edita en ACC-05 por un superadmin ya verificado. |
| Orden de puertas | Código → cambio obligatorio de clave → app. |

## 2. Piezas

- Canónico `supabase/factor.sql` (bloque `@@FACTOR@@` de `seguridad.sql`); migración `supabase/migraciones/2026-09-28-segundo-factor.sql` (una transacción, respaldo en `interno.respaldo_factor`, verificación embebida); reversión `supabase/respaldos/2026-09-28-segundo-factor-reversion.sql`; generador `scripts/factor-generar.mjs`.
- Funciones: `fn_factor_pendiente()` (interna), `fn_nivel_modulo` v4, `mi_segundo_factor()` (authenticated), `guardar_politica` con `p_factor_superadmin`, `api_factor_emitir / verificar / dispositivo_crear / dispositivo_usar / dispositivos_revocar` (solo `service_role`, con `pg_advisory_xact_lock(hashtext(session_id))` por sesión; `api_factor_dispositivo_crear` exige `via = 'correo'`).
- Endpoint `api/segundo-factor.js` (`enviar`, `verificar`, `dispositivo`, `olvidar`); helper `api/_factor.js`; compuerta en `admin-usuarios`, `portal-cuentas`, `solicitud-pdf`, `constancia-portal`, `consentimiento-pdf`, `descargar-documento`, `rit`, `enviar-correo`.
- Cliente: `src/pages/SegundoFactor.jsx`, `src/state.jsx` (`factorPendiente`, `factorVerificado`, `segundoFactor`), `src/layout/Shell.jsx`, ACC-05.
- Auditoría: `FACTOR_VERIFICADO`, `FACTOR_DISPOSITIVO`, `FACTOR_DISPOSITIVOS_REVOCADOS` (sin hashes ni códigos). Rastro de envíos en `correo_envios` (`accion = segundo-factor`).

## 3. Verificación

1. Ensayo local: `node scripts/ensayar-factor.mjs` (Postgres embebido + datos anonimizados; 21 casos: huecos, migración, reglas, funciones de guarda propia, reversión, reaplicación).
2. Unitarias: `npm test` (`tests/api/factor.test.js`, `segundo-factor.test.js`, `admin-usuarios.test.js`).
3. CI: `scripts/ensayar-canon.mjs` (22 invariantes: fases 0–6 y el segundo factor) y `verificar-fase4.mjs` (simula al superadmin con `session_id` + marca temporal).
4. Producción: `node scripts/verificar-factor.mjs` (superadmin temporal, código sembrado, equipo recordado, revocación, endpoints cerrados) y prueba manual de Diego (código real, reenviar, recordar equipo, segundo ingreso sin código, olvidar equipos).

## 4. Contingencia técnica (el correo no sale)

Sin códigos de respaldo (decisión de Diego). Pasos, con `. .\scripts\token-supabase.ps1`:

```
node -e "const q='update interno.politica_acceso set factor_superadmin = false where id = 1';fetch('https://api.supabase.com/v1/projects/mzpbdkrmokfxrrsotfgs/database/query',{method:'POST',headers:{Authorization:'Bearer '+process.env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query:q})}).then(r=>r.text()).then(console.log)"
```

Con eso todos los superadmins entran solo con clave. Arreglar el motor (`SMTP_PASS`, `scripts/verificar-smtp.mjs`) y volver a encender desde ACC-05 o con el mismo comando y `= true`.

**Incidente 2026-09-29 (primer uso real del factor):** el código no llegó. Rastro en `correo_envios` id 11: `El envío SMTP falló: Invalid login: 535-5.7.8 Username and Password not accepted` (Gmail, BadCredentials). La misma `SMTP_PASS` (rotada el 2026-09-18) había enviado correos el 2026-09-22, así que Google revocó la contraseña de aplicación entre esas fechas (ocurre al cambiar la clave de la cuenta Google, apagar la verificación en dos pasos o por revisión de seguridad). Diagnóstico rápido: `select detalle from correo_envios where accion = 'segundo-factor' order by id desc limit 1`. Arreglo: generar contraseña de aplicación nueva (cuenta Google → Seguridad → Verificación en dos pasos → Contraseñas de aplicaciones), `vercel env rm SMTP_PASS production -y` + `printf 'xxxx' | vercel env add SMTP_PASS production`, redeploy (`vercel redeploy <url de producción>`), y confirmar con un `enviar` real (fila `enviado` en `correo_envios`). Lección de pantalla: ante ese 503 la casilla se oculta (ningún código llegó) pero «Pedir un código nuevo» sigue disponible tras los 60 s, para que el operador reintente sin recargar cuando soporte arregle el motor.

## 5. Reversión completa

`supabase/respaldos/2026-09-28-segundo-factor-reversion.sql` por Management API (una transacción): elimina tablas y funciones nuevas, restaura `fn_nivel_modulo` v3, `guardar_politica` (firma vieja), las funciones de guarda propia (`fn_ver_cuenta_bancaria`, `fn_nivel_memorandums`, `importar_planilla_unificada`, cuerpo y EXECUTE respaldados) y `v_politica_acceso`, y quita la columna. El cliente desplegado tolera la ausencia de `mi_segundo_factor` (entra sin factor), pero **tras revertir la BD el cliente desplegado no puede guardar ACC-05** (llamada de 12 argumentos a una función de 11) hasta revertir también `src/state.jsx` (o volver a aplicar la migración).

## 6. Riesgos aceptados

- Token de equipo en `localStorage` (mismo riesgo que «Recordar mis datos»); revocable.
- Fuerza bruta: 5/10⁶ por código, 60 s entre envíos, límite por IP y por correo en el endpoint (`correo_envios`, 15 por hora por correo, 30 por IP). El cubo es propio de `segundo-factor`: `limitar` solo cuenta filas con `accion = segundo-factor` y excluye las `limitado` (los avisos de otras acciones tras el NAT de la oficina no dejan al superadmin sin BackOffice, y reintentar no alarga el bloqueo).
- La sesión única (`registrar_sesion_backoffice`) corre antes del factor: quien tenga solo la clave puede expulsar la sesión del superadmin real (decisión de la spec §4).
- Las políticas de `storage` para `rit/` usan `es_admin()` (cualquier administrativo activo): un superadmin pendiente puede leer los PDF del RIT directamente (dato de baja sensibilidad).
- Gmail ~500 correos/día: con equipo recordado son pocos al mes.
- Bloqueo del superadmin si cae el correo: solo la vía técnica de §4.
