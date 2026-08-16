# Privacidad de Documentos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar la exposición pública de las boletas reales: bucket privado, `archivo_url` como ruta interna, descarga solo con URL firmada emitida por un endpoint que verifica identidad, y RLS real sobre la tabla `documentos`.

**Architecture:** El bucket `documentos` deja de ser público y la BD guarda rutas, no URLs. Un endpoint serverless (`api/descargar-documento.js`, patrón de `api/portal-cuentas.js`: service key + `x-sesion`) identifica al llamador (admin activo del BackOffice → todo; cuenta `<dni>@portal.grupoer.pe` → solo sus documentos) y devuelve una URL firmada de 10 minutos. El Portal y el BackOffice consumen esa URL. La tabla `documentos` pasa de la política demo a admin-solo (las vistas/RPCs `security definer` siguen sirviendo al Portal y al BackOffice igual que hoy).

**Tech Stack:** Supabase Storage (signed URLs), PostgREST/RLS, función serverless Vercel, Preact (portal), React (BackOffice).

**Spec:** `docs/superpowers/specs/2026-08-16-privacidad-documentos-design.md`

## Global Constraints

- Ninguna credencial sale del navegador: la sesión viaja SOLO como cabecera `x-sesion`; jamás JWT en query strings ni URLs.
- La service key vive SOLO en el servidor (env `SUPA_SERVICE_KEY`, fallback `SUPABASE_SERVICE_ROLE_KEY`, saneadas de BOM con el `limpiar()` del proyecto).
- URL firmada: expiración 600 segundos.
- El Portal mantiene su presupuesto (<60KB total, sin dependencias nuevas).
- Migraciones idempotentes; `schema.sql`/`portal.sql` canónicos sincronizados.
- git SOLO desde el controlador (PowerShell + here-strings); los subagentes no lo ejecutan.
- Scripts de verificación con el patrón `✔/✘` + exit code de `scripts/verificar-*.mjs`.
- Nada se borra: las boletas reales publicadas quedan intactas (solo cambia cómo se accede).

---

### Task 1: Migración SQL — bucket privado, rutas y RLS de documentos

**Files:**
- Create: `supabase/migraciones/2026-08-16-privacidad-documentos.sql`
- Modify: `supabase/portal.sql` (comentario junto al `alter table documentos add column archivo_url`: ahora guarda RUTA del bucket, no URL)
- Modify: `supabase/schema.sql` (bloque SEGURIDAD: quitar `documentos` del array del `foreach` y documentar que su política vive en la migración de privacidad; el resto de tablas no cambia)
- Create: `scripts/verificar-privacidad.mjs` (solo parte BD en esta task; se amplía en Tasks 2 y 4)

**Interfaces:**
- Produces: `storage.buckets.documentos.public = false`; `documentos.archivo_url` con rutas tipo `lotes/lamericana/2026-06/<hash>.pdf` (sin `https://`); políticas `documentos_admin_select/insert/update/delete` sobre `public.documentos` para `authenticated` con `public.es_admin_activo()`; `anon` sin política sobre `documentos`.

- [ ] **Step 1: Escribir la migración idempotente**

```sql
-- supabase/migraciones/2026-08-16-privacidad-documentos.sql
-- Privacidad de documentos (Ley 29733): bucket privado, rutas internas y RLS
-- real sobre public.documentos. Spec: docs/superpowers/specs/2026-08-16-….md

-- 1 · Bucket privado: ninguna URL /object/public/... vuelve a servir archivos.
update storage.buckets set public = false where id = 'documentos';

-- 2 · archivo_url guarda la RUTA interna, nunca una URL completa.
update documentos
set archivo_url = regexp_replace(archivo_url, '^https?://[^/]+/storage/v1/object/public/documentos/', '')
where archivo_url ~ '^https?://';

-- 3 · RLS real: la tabla base solo es legible/escribible por admins activos.
--    El Portal lee por vistas/RPCs security definer (portal.sql) y el
--    BackOffice por vistas v_* y RPCs security definer: nada de eso pasa por
--    estas políticas. Se cierra la enumeración rest/v1/documentos por anon.
drop policy if exists acceso_demo on documentos;
drop policy if exists documentos_admin on documentos;
create policy documentos_admin on documentos
  for all to authenticated
  using (public.es_admin_activo())
  with check (public.es_admin_activo());
```

- [ ] **Step 2: Aplicar contra producción**

```powershell
Set-Location C:\Users\DiegoSalguero\Intranet
& scripts\token-supabase.ps1 | Out-Null
node scripts/aplicar-sql.mjs supabase/migraciones/2026-08-16-privacidad-documentos.sql
```

- [ ] **Step 3: Sincronizar canónicos** — en `schema.sql`, quitar `'documentos'` del array del bloque SEGURIDAD (`foreach t in array[...]`) y dejar un comentario de una línea («documentos: política admin-solo en migraciones/2026-08-16-privacidad-documentos.sql»); en `portal.sql`, comentario junto al `add column archivo_url`: «guarda la RUTA del bucket (lotes/...), no una URL — ver migración de privacidad». NO ejecutar ninguno de los dos.

- [ ] **Step 4: Escribir la parte BD de `scripts/verificar-privacidad.mjs`** (mismo esqueleto `sql()/prueba()/igual()` de `scripts/verificar-tres-ajustes.mjs`, Management API con `SUPABASE_ACCESS_TOKEN`):

```js
await prueba("el bucket documentos es privado", async () => {
  const [b] = await sql("select public from storage.buckets where id='documentos'");
  igual(b.public, false, "public");
});
await prueba("ninguna archivo_url guarda URL completa", async () => {
  const [r] = await sql("select count(*)::int n from documentos where archivo_url ~ '^https?://'");
  igual(r.n, 0, "urls completas");
});
await prueba("documentos sin política demo y con política admin", async () => {
  const pols = await sql("select policyname, roles::text from pg_policies where schemaname='public' and tablename='documentos'");
  igual(pols.some((p) => p.policyname === 'acceso_demo'), false, "acceso_demo fuera");
  igual(pols.some((p) => p.policyname === 'documentos_admin' && p.roles.includes('authenticated')), true, "documentos_admin");
});
await prueba("una URL pública antigua de boleta ya no responde 200", async () => {
  const [d] = await sql("select archivo_url from documentos where archivo_url like 'lotes/%' limit 1");
  const r = await fetch(`https://mzpbdkrmokfxrrsotfgs.supabase.co/storage/v1/object/public/documentos/${d.archivo_url}`);
  igual(r.status !== 200, true, `respondió ${r.status}`);
});
```

Run: `node scripts/verificar-privacidad.mjs` → TODAS LAS PRUEBAS PASARON.

- [ ] **Step 5: Suites previas siguen verdes** — `node scripts/verificar-tres-ajustes.mjs` (22/22; OJO: si alguna de sus pruebas de lote asume URL completa en archivo_url, actualizar ESA prueba a rutas — es parte de esta task) y `npm test` (40/40).

- [ ] **Step 6: Commit** — `feat(privacidad): bucket documentos privado, rutas internas y RLS admin-solo`

### Task 2: Endpoint de descarga con URL firmada

**Files:**
- Create: `api/descargar-documento.js`
- Modify: `scripts/verificar-privacidad.mjs` (pruebas del endpoint contra producción — se corren tras el deploy, gated por argumento `--endpoint`)

**Interfaces:**
- Consumes: rutas en `documentos.archivo_url` (Task 1); patrón service-key/`limpiar` de `api/portal-cuentas.js`; identidad GoTrue `GET /auth/v1/user` con el JWT del llamador.
- Produces: `GET /api/descargar-documento?id=<documentos.id>` con cabecera `x-sesion: <jwt>` → `200 {url}` (URL firmada 600 s) | `401` sin sesión válida | `403` sin permiso | `404` documento/archivo inexistente. Contrato que consumen la Task 3 (Portal/BackOffice).

- [ ] **Step 1: Implementación**

```js
// api/descargar-documento.js — descarga privada de documentos: valida la
// identidad del llamador y emite una URL firmada de 10 minutos. Los PDFs de
// boleta llevan datos personales impresos (Ley 29733): el bucket es privado
// y este endpoint es el ÚNICO camino de lectura.
const SUPABASE = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const DOMINIO_PORTAL = "portal.grupoer.pe";
const EXPIRA_SEGUNDOS = 600;
const limpiar = (v) => (typeof v === "string" ? v.replace(/^[\uFEFF\u200B\s]+|[\uFEFF\u200B\s]+$/g, "") : v);
const SERVICE = limpiar(process.env.SUPA_SERVICE_KEY) || limpiar(process.env.SUPABASE_SERVICE_ROLE_KEY) || "";
const cabService = { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" };

async function rest(ruta, opciones = {}) {
  const r = await fetch(`${SUPABASE}${ruta}`, { ...opciones, headers: { ...cabService, ...opciones.headers } });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* sin JSON */ }
  return { ok: r.ok, status: r.status, json };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const id = String(req.query.id ?? "");
  const jwt = limpiar(req.headers["x-sesion"] ?? "");
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: "Falta el id del documento." });
  if (!jwt) return res.status(401).json({ error: "Sesión requerida." });

  // ¿Quién llama? El JWT se valida contra GoTrue, jamás se decodifica a mano.
  const quien = await rest("/auth/v1/user", { headers: { authorization: `Bearer ${jwt}`, apikey: SERVICE } });
  const correo = (quien.json?.email ?? "").toLowerCase();
  if (!quien.ok || !correo) return res.status(401).json({ error: "Sesión inválida o vencida." });

  // Documento + DNI del vínculo (service key: la tabla es admin-solo por RLS).
  const doc = (await rest(
    `/rest/v1/documentos?id=eq.${id}&select=archivo_url,vinculo_id,vinculos(persona_dni)&limit=1`
  )).json?.[0];
  if (!doc) return res.status(404).json({ error: "El documento no existe." });
  if (!doc.archivo_url) return res.status(404).json({ error: "El documento no tiene archivo." });

  // Autorización: admin activo del BackOffice → todo; cuenta del portal → solo lo suyo.
  let autorizado = false;
  if (correo.endsWith(`@${DOMINIO_PORTAL}`)) {
    const dni = correo.split("@")[0];
    autorizado = doc.vinculos?.persona_dni === dni;
  } else {
    const admin = (await rest(
      `/rest/v1/usuarios_admin?correo=eq.${encodeURIComponent(correo)}&estado=eq.activo&select=id&limit=1`
    )).json?.[0];
    autorizado = Boolean(admin);
  }
  if (!autorizado) return res.status(403).json({ error: "No tienes acceso a este documento." });

  // URL firmada (la ruta jamás viene del cliente: sale de la BD).
  const firma = await rest(`/storage/v1/object/sign/documentos/${doc.archivo_url}`, {
    method: "POST",
    body: JSON.stringify({ expiresIn: EXPIRA_SEGUNDOS }),
  });
  const relativa = firma.json?.signedURL;
  if (!firma.ok || !relativa) return res.status(404).json({ error: "El archivo no está disponible." });
  return res.status(200).json({ url: `${SUPABASE}/storage/v1${relativa}` });
}
```

- [ ] **Step 2: Pruebas del endpoint en `verificar-privacidad.mjs`** bajo el flag `--endpoint` (se corren POST-deploy; usan `https://intranet-general.vercel.app`): (a) sin `x-sesion` → 401; (b) login admin (env `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD_INICIAL` vía `/api/supa/auth/v1/token`) + id de una boleta del lote real → 200 `{url}` y el GET de esa url devuelve `%PDF-` con el `hash_sha256` del documento; (c) login portal de un trabajador real del lote (correo `<dni>@portal.grupoer.pe`; su clave no se conoce → crea la sesión con el service-key flow NO: en su lugar usa `/auth/v1/admin/generate_link`… demasiado; ALTERNATIVA OBLIGATORIA: restablecer la clave de UNA cuenta portal de prueba con el endpoint existente `api/portal-cuentas.js` requiere UI; más simple: el script usa la Management API para leer `documentos.id` de dos trabajadores distintos y valida el caso portal con una cuenta cuya clave fija el propio script vía `PUT /auth/v1/admin/users/<uid>` con la service key obtenida como en `scripts/adjuntar-pdfs-demo.mjs` — documenta la clave temporal y déjala rotada al final); (d) esa sesión portal pide SU documento → 200 y el de OTRO DNI → 403; (e) id inexistente → 404.
- [ ] **Step 3: `node --check api/descargar-documento.js`** y `npm test` (nada roto). Las pruebas `--endpoint` NO se corren aún (falta deploy).
- [ ] **Step 4: Commit** — `feat(api): endpoint de descarga con URL firmada y verificacion de identidad`

### Task 3: Consumidores — Portal y BackOffice

**Files:**
- Modify: `portal/src/pages/Documento.jsx` (~líneas 28-40 y 108-115)
- Modify: `portal/src/lib/api.js` (helper nuevo `urlDocumento`)
- Modify: `src/pages/rrhh/Boletas.jsx` (~líneas 157-162: quitar `getPublicUrl`, enviar la ruta)

**Interfaces:**
- Consumes: contrato del endpoint (Task 2); `sesion.access_token` del cliente del portal.
- Produces: Portal muestra/descarga boletas vía URL firmada; BackOffice publica `archivo_url` = ruta.

- [ ] **Step 1: Helper en `portal/src/lib/api.js`** (junto a `pedir`; el endpoint vive FUERA de `/api/supa`, por eso no reutiliza `BASE`):

```js
// URL firmada para un documento (el bucket es privado). Solo producción/preview:
// en dev local no existe el endpoint serverless.
export async function urlDocumento(id) {
  if (!mismoOrigen) return { error: "La vista previa del PDF solo está disponible en el portal desplegado." };
  const r = await fetch(`${window.location.origin}/api/descargar-documento?id=${id}`, {
    headers: sesion?.access_token ? { "x-sesion": sesion.access_token } : {},
  });
  const json = await r.json().catch(() => null);
  if (!r.ok) return { error: json?.error ?? `HTTP ${r.status}` };
  return { url: json.url };
}
```

(Si `pedir` ya maneja refresh en 401, replica aquí el mismo reintento: ante 401, `await refrescar()` y un solo retry.)

- [ ] **Step 2: `Documento.jsx`** — reemplazar el uso directo de `doc.archivo_url`: al montar, si `doc.archivo_url` existe, llamar `urlDocumento(doc.id)`; estado `archivo`: "cargando" | "sin-archivo" | "error:<msj>" | URL firmada. El `<iframe src={urlFirmada}>` y el botón de descarga usan la URL firmada; si expira (usuario deja la pantalla abierta >10 min y falla la descarga), el botón vuelve a pedir otra. Eliminar el `fetch(HEAD)` actual (el endpoint ya valida existencia).
- [ ] **Step 3: `Boletas.jsx`** — en la subida (~157-162): eliminar `getPublicUrl`; `p.url = ruta` (la misma `ruta` construida para `upload`). Nada más cambia (la RPC recibe `archivo_url: p.url`).
- [ ] **Step 4: Builds** — `npm run build` (app) y `cd portal && npm run build` (verificar que el portal sigue bajo su presupuesto — el helper son ~15 líneas).
- [ ] **Step 5: Commit** — `feat(portal,rrhh): documentos privados consumidos via URL firmada`

### Task 4: Deploy + verificación completa en producción

**Files:**
- Modify: `scripts/verificar-privacidad.mjs` (ajustes que salgan de correrlo de verdad)
- Modify: `docs/superpowers/specs/2026-08-16-privacidad-documentos-design.md` (sección Estado final)

- [ ] **Step 1: Push (deploy)** — controlador.
- [ ] **Step 2: Correr TODO contra producción** (controlador o subagente con credenciales): `node scripts/verificar-privacidad.mjs --endpoint` (todas ✔), `node scripts/verificar-portal.mjs`, `node scripts/verificar-tres-ajustes.mjs`, `node scripts/verificar-e2e-login.mjs`, `npm test`. La prueba reina: la URL pública vieja de una boleta real → denegada; la misma boleta vía endpoint con el JWT del trabajador dueño → PDF con hash correcto.
- [ ] **Step 3: Estado final en el spec + commit** — `test(privacidad): verificacion E2E de documentos privados en produccion`

## Self-review

- Cobertura del spec: decisiones 1-6 → Tasks 1 (bucket/rutas/RLS), 2 (endpoint), 3 (consumidores), 4 (verificación). Fuera de alcance respetado.
- Sin placeholders; el único punto abierto (cómo obtiene el script la sesión portal de prueba) queda resuelto con instrucción concreta (PUT admin/users con service key + rotación final).
- Consistencia de firmas: `urlDocumento(id) → {url}|{error}`; endpoint `?id=` + `x-sesion` → `{url}`; `archivo_url` = ruta en Tasks 1-3.
