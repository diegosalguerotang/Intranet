# Diseño — Privacidad de documentos (Ley 29733)

Fecha: 2026-08-16 · Aprobado por Diego el 2026-08-16.

**Motivo:** las boletas reales publicadas (lote BOL-L. -202606-001) contienen cuenta bancaria y
CUSPP impresos, y el bucket `documentos` era público con `documentos.archivo_url` legible por
`anon`. Hallazgo Important-2 de la revisión final del ciclo Tres Ajustes.

## Decisiones

1. **Bucket privado.** `storage.buckets.documentos` pasa a `public = false`. Ninguna URL
   `/object/public/...` vuelve a servir un archivo.

2. **`documentos.archivo_url` guarda la RUTA interna del bucket** (`lotes/<empresa>/<periodo>/
   <hash>.pdf`), nunca una URL completa:
   - Migración de datos: filas existentes con URL pública se convierten a ruta (strip del
     prefijo `https://<proyecto>.supabase.co/storage/v1/object/public/documentos/`).
   - `publicar_lote_pdf`: sin cambios de firma; la UI (Boletas.jsx) deja de llamar
     `getPublicUrl` y envía la ruta que ya construye para subir.

3. **Endpoint de descarga `api/descargar-documento.js`** (patrón serverless existente:
   service key vía env `SUPA_SERVICE_KEY`, sesión en cabecera `x-sesion`):
   - Entrada: `?id=<documentos.id>` + `x-sesion` (JWT).
   - Identifica al llamador con GoTrue (`auth.getUser(jwt)` / GET /auth/v1/user):
     - correo en `usuarios_admin` con `estado='activo'` → acceso a cualquier documento;
     - correo `<dni>@portal.grupoer.pe` → solo documentos cuyo `vinculos.persona_dni = <dni>`
       (mismo criterio que `portal_dni()`);
     - cualquier otro → 403.
   - Busca el documento por id con service key, firma la ruta con
     `storage.from('documentos').createSignedUrl(ruta, 600)` (10 minutos) y responde
     `{ url }`. Errores con mensaje claro y status correcto (401 sin sesión, 403 sin
     permiso, 404 documento o archivo inexistente).
   - Sirve también para el BackOffice (mismo endpoint, JWT de admin).

4. **Consumidores:**
   - Portal `portal/src/pages/Documento.jsx`: `archivo_url` ahora es ruta → pide
     `{url}` al endpoint vía el cliente artesanal (x-sesion) y usa la URL firmada en el
     iframe y en el botón de descarga. El HEAD-check actual se adapta (el fetch del
     endpoint ya confirma existencia).
   - BackOffice: hoy no muestra las boletas publicadas por URL; `Boletas.jsx` solo deja de
     usar `getPublicUrl` al publicar.

5. **RLS real sobre la tabla `documentos`:** se elimina la política demo `acceso_demo`
   SOLO de `documentos` y se crea `documentos_admin` (`for all to authenticated using/with
   check (public.es_admin_activo())`). `anon` queda sin acceso. No rompe nada: el Portal
   lee por vistas/RPCs `security definer` limitadas por sesión y el BackOffice lee vistas
   `v_*` (definer) y escribe vía RPC `security definer`.

6. **Verificación (`scripts/verificar-privacidad.mjs`):**
   - URL pública antigua de una boleta → ya no responde 200.
   - REST anónimo y de portal a `rest/v1/documentos` → denegado/vacío.
   - Endpoint con JWT admin → `{url}` firmada que descarga el PDF con el SHA-256 correcto.
   - Endpoint con JWT de portal (cuenta real de uno de los 9) → su boleta sí; la de otro
     DNI → 403.
   - Suites existentes en verde: `verificar-portal.mjs`, `verificar-tres-ajustes.mjs`,
     `verificar-e2e-login.mjs`, `npm test`.

## Fuera de alcance

- RLS del resto de tablas (fase "RLS con puede()" pendiente de siempre).
- Adjuntos de acuses asistidos (`acuses.adjunto_url`): reutilizarán este mecanismo cuando
  existan reales; hoy solo hay demos.
- Rotación de las URLs demo previas del seed (quedan inservibles con el bucket privado —
  aceptado).

## Riesgos

- El Portal es Preact con presupuesto <60KB: el cambio es un fetch más, sin dependencias.
- Las cuentas del portal usan GoTrue igual que los admins: el endpoint distingue por el
  dominio del correo — si algún día cambia el dominio técnico, actualizar la constante.

## Estado final (2026-08-17)

CICLO CERRADO Y VERIFICADO EN PRODUCCIÓN. Las 4 tareas del plan ejecutadas:

1. Migración aplicada: bucket `documentos` privado, `archivo_url` con rutas internas,
   política `documentos_admin` (admin-solo) y `acceso_demo` eliminada de `documentos`.
2. `api/descargar-documento.js` deployado: único camino de lectura (URL firmada 600 s).
3. Consumidores migrados: Portal (`urlDocumento` + `Documento.jsx` con visor/descarga por
   URL firmada, descarga fresca al clic) y BackOffice (`Boletas.jsx` publica rutas).
   `verificar-e2e-produccion.mjs` adaptado al mundo privado (publica rutas y verifica por
   el endpoint, no por URL pública).
4. Lote real republicado por el canal real (BOL-L. -202606-001 v1, 9 boletas) y TODO verde:
   - `verificar-privacidad.mjs --endpoint`: 9/9 — incluye caso portal real
     (cuenta 08693165@portal.grupoer.pe creada vía `api/portal-cuentas`; su boleta → 200,
     la de otro DNI → 403, clave temporal rotada al final).
   - `verificar-e2e-produccion.mjs`: todos los casos (URL firmada baja el PDF con SHA-256
     exacto; URL pública antigua → 400).
   - `verificar-portal.mjs`, `verificar-tres-ajustes.mjs`, `verificar-e2e-login.mjs`,
     `npm test` (40/40): todo en verde.

Nota: el hash `hash_sha256` de los documentos DEMO del seed no coincide con sus PDF
adjuntados (dato demo antiguo, sin efecto en boletas reales).
