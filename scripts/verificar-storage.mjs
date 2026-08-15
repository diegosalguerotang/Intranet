// scripts/verificar-storage.mjs — Task 12: verifica el canal binario a
// Supabase Storage que usará la subida de boletas (Task 14).
//
// Parte PRE-DEPLOY (siempre corre):
//   1. Inspecciona pg_policies: las políticas de storage.objects para el
//      bucket `documentos` deben depender de usuarios_admin (no solo del
//      bucket) — endurecimiento ronda 1.
//   2. Con condiciones REALES (no solo inspección de la definición SQL, que
//      dejó pasar el bug de la ronda 2 — auth.jwt() no resolvía en el
//      contexto de storage-api): si SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD_INICIAL
//      están seteadas, hace login real y sube un PDF DIRECTO (sin proxy) con
//      ese JWT, reproduciendo el escenario 403 reportado. Si no están, cae a
//      simular auth.uid() con set_config() contra un usuarios_admin activo
//      real y confirma que public.es_admin_activo() resuelve true/false.
//   3. Sube un PDF pequeño DIRECTO a Supabase Storage con la service key
//      (patrón de adjuntar-pdfs-demo.mjs), lo descarga por su URL pública y
//      compara SHA-256 byte a byte.
//   & scripts/token-supabase.ps1 | Out-Null; node scripts/verificar-storage.mjs
//   (opcional) $env:SUPERADMIN_EMAIL=...; $env:SUPERADMIN_PASSWORD_INICIAL=...
//
// Parte POST-DEPLOY (solo con --proxy, después de hacer push/deployar):
// repite la subida/descarga pero a través de
// https://intranet-general.vercel.app/api/supa/storage/v1/object/... usando
// un JWT real del superadmin (patrón de verificar-e2e-login.mjs), probando
// así que api/supa.js reenvía binarios sin corromperlos.
//   $env:SUPERADMIN_EMAIL=...; $env:SUPERADMIN_PASSWORD_INICIAL=...
//   node scripts/verificar-storage.mjs --proxy
import { createHash } from "node:crypto";

const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const SUPA = `https://${PROYECTO}.supabase.co`;
const RUTA = "pruebas/verificacion.pdf";
const conProxy = process.argv.includes("--proxy");

let fallas = 0;
const caso = (nombre, ok, detalle) => {
  console.log(`${ok ? "✔" : "✘"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  if (!ok) fallas++;
};
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// PDF mínimo válido de una página (mismo generador que adjuntar-pdfs-demo.mjs,
// autocontenido, sin dependencias).
function pdfPrueba() {
  const contenido = "BT /F1 14 Tf 50 780 Td (Verificacion Task 12 - canal binario a Storage) Tj ET";
  const objetos = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
    `4 0 obj << /Length ${contenido.length} >> stream\n${contenido}\nendstream endobj`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
  ];
  let cuerpo = "%PDF-1.4\n";
  const offsets = [0];
  for (const o of objetos) { offsets.push(cuerpo.length); cuerpo += o + "\n"; }
  const xref = cuerpo.length;
  cuerpo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objetos.length; i++) cuerpo += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  cuerpo += `trailer << /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(cuerpo, "latin1");
}

// Prueba negativa factible por SQL (sin simular un JWT de portal): confirma
// vía Management API que las políticas de storage.objects para el bucket
// `documentos` exigen pertenencia a usuarios_admin (estado activo) y no solo
// `bucket_id = 'documentos'` — que es justo el hueco que dejaba pasar a
// cualquier trabajador del Portal (también `authenticated`).
//
// Ronda 3: deben ser TRES políticas, no dos. storage-api sube con
// `INSERT ... RETURNING`, y bajo RLS el RETURNING exige que la fila insertada
// sea visible por alguna política SELECT — sin `documentos_leer`, el insert
// pasaba `with_check` pero el RETURNING fallaba con 403/42501 ("new row
// violates row-level security policy"), aunque la política y
// es_admin_activo() estuvieran correctas. Lección: cualquier política de
// storage con RETURNING (como usa el SDK) necesita también su política SELECT.
async function verificarPoliticaEndurecida(token) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "select policyname, cmd, qual, with_check from pg_policies " +
        "where schemaname='storage' and tablename='objects' and policyname like 'documentos_%'",
    }),
  });
  const texto = await r.text();
  if (!r.ok) { caso("políticas de Storage exigen usuarios_admin activo", false, `HTTP ${r.status} ${texto}`); return; }
  const filas = JSON.parse(texto);
  const esperadas = ["documentos_leer", "documentos_subir", "documentos_actualizar"];
  const encontradas = filas.map((f) => f.policyname);
  caso("existen las tres políticas (leer, subir, actualizar)",
    filas.length === 3 && esperadas.every((p) => encontradas.includes(p)),
    `encontradas: ${encontradas.join(", ") || "ninguna"}`);
  for (const f of filas) {
    const condicion = `${f.qual ?? ""} ${f.with_check ?? ""}`;
    // Ronda 2: la condición ya no compara auth.jwt()->>'email' inline (no
    // resolvía en producción); ahora delega en la función helper
    // public.es_admin_activo() (auth.uid() → auth.users → usuarios_admin).
    const endurecida = condicion.includes("es_admin_activo");
    caso(`${f.policyname} exige es_admin_activo() (no solo bucket_id)`, endurecida,
      endurecida ? undefined : `condición no llama a es_admin_activo(): ${condicion.trim()}`);
  }
}

// Ronda 2 de la revisión: la política endurecida con auth.jwt()->>'email' se
// probó "en el papel" (pg_policies) pero fallaba en producción con un JWT
// real (403), porque auth.jwt() no resuelve de forma fiable en el contexto
// de evaluación de storage-api. El fix (auth.uid() vía la función
// public.es_admin_activo()) necesita una prueba con condiciones reales, no
// solo inspección de la definición SQL. Camino preferido: login real del
// superadmin + subida DIRECTA (sin proxy) con ese JWT, reproduciendo
// exactamente el escenario que el controlador reportó como 403.
async function verificarConJwtReal(token) {
  const KEY = "sb_publishable_qgPwZ8-4neRlKQXpCe9tnw_Dix4Ddwg";
  const { SUPERADMIN_EMAIL: EMAIL, SUPERADMIN_PASSWORD_INICIAL: CLAVE } = process.env;

  if (EMAIL && CLAVE) {
    console.log("(SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD_INICIAL presentes: probando el camino real)");
    const login = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: CLAVE }),
    });
    const sesion = await login.json();
    caso("login del superadmin obtiene JWT real", login.ok && !!sesion.access_token,
      login.ok ? undefined : `HTTP ${login.status}`);
    if (!sesion.access_token) return;

    const pdf = pdfPrueba();
    const up = await fetch(`${SUPA}/storage/v1/object/documentos/pruebas/jwt-directo.pdf`, {
      method: "POST",
      headers: { apikey: KEY, Authorization: `Bearer ${sesion.access_token}`, "Content-Type": "application/pdf", "x-upsert": "true" },
      body: pdf,
    });
    caso("subida DIRECTA (sin proxy) con JWT real del superadmin — reproduce el 403 reportado", up.ok,
      up.ok ? undefined : `HTTP ${up.status} ${await up.text()}`);
    return;
  }

  console.log("(SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD_INICIAL no están seteadas en esta sesión — "
    + "cae al camino simulado: set_config('request.jwt.claim.sub', …) contra un usuarios_admin activo real)");
  const query = `
with admin_activo as materialized (
  select set_config('request.jwt.claim.sub',
    (select au.id::text from auth.users au join usuarios_admin u on u.correo = au.email where u.estado='activo' limit 1),
    true) as claim
),
resultado_true as materialized (
  select public.es_admin_activo() as v from admin_activo
),
reset_falso as materialized (
  select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true) as claim
  from resultado_true
),
resultado_false as materialized (
  select public.es_admin_activo() as v from reset_falso
)
select (select v from resultado_true) as con_admin_real,
       (select v from resultado_false) as con_uid_inexistente;`;
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const texto = await r.text();
  if (!r.ok) { caso("es_admin_activo() con claim simulado", false, `HTTP ${r.status} ${texto}`); return; }
  const [fila] = JSON.parse(texto);
  caso("es_admin_activo() da true con auth.uid() de un usuarios_admin activo real", fila?.con_admin_real === true,
    `resultado=${fila?.con_admin_real}`);
  caso("es_admin_activo() da false con un uid inexistente", fila?.con_uid_inexistente === false,
    `resultado=${fila?.con_uid_inexistente}`);
}

async function verificarDirecto() {
  console.log("\n== Parte pre-deploy: subida DIRECTA a Supabase Storage ==");
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }

  await verificarPoliticaEndurecida(token);
  await verificarConJwtReal(token);

  const keys = await (await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();
  const SERVICE = keys.find((k) => k.name === "service_role")?.api_key;
  if (!SERVICE) { console.error("No se pudo obtener la service key."); process.exit(1); }
  const cab = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };

  const pdf = pdfPrueba();
  const hashOriginal = sha256(pdf);

  const up = await fetch(`${SUPA}/storage/v1/object/documentos/${RUTA}`, {
    method: "POST",
    headers: { ...cab, "Content-Type": "application/pdf", "x-upsert": "true" },
    body: pdf,
  });
  caso("subida directa a Storage (upsert)", up.ok, up.ok ? undefined : `HTTP ${up.status} ${await up.text()}`);

  const url = `${SUPA}/storage/v1/object/public/documentos/${RUTA}`;
  const down = await fetch(url);
  const bajado = Buffer.from(await down.arrayBuffer());
  const hashBajado = sha256(bajado);

  caso("descarga por URL pública responde 200", down.ok, down.ok ? undefined : `HTTP ${down.status}`);
  caso("tamaño idéntico byte a byte", bajado.length === pdf.length,
    `subido=${pdf.length}B descargado=${bajado.length}B`);
  caso("SHA-256 idéntico (sin corrupción)", hashBajado === hashOriginal,
    `subido=${hashOriginal.slice(0, 12)}… descargado=${hashBajado.slice(0, 12)}…`);

  return pdf;
}

async function verificarProxy(pdfReferencia) {
  console.log("\n== Parte post-deploy: subida vía proxy /api/supa (--proxy) ==");
  const BASE = "https://intranet-general.vercel.app";
  const KEY = "sb_publishable_qgPwZ8-4neRlKQXpCe9tnw_Dix4Ddwg";
  const { SUPERADMIN_EMAIL: EMAIL, SUPERADMIN_PASSWORD_INICIAL: CLAVE } = process.env;
  if (!EMAIL || !CLAVE) { console.error("Faltan SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD_INICIAL."); process.exit(1); }

  const login = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: CLAVE }),
  });
  const sesion = await login.json();
  caso("login del superadmin obtiene JWT real", login.ok && !!sesion.access_token,
    login.ok ? undefined : `HTTP ${login.status}`);
  if (!sesion.access_token) { console.error("Sin JWT, no se puede continuar la parte --proxy."); process.exit(1); }

  const pdf = pdfReferencia ?? pdfPrueba();
  const hashOriginal = sha256(pdf);
  const rutaProxy = `storage/v1/object/documentos/${RUTA}`;

  const up = await fetch(`${BASE}/api/supa/${rutaProxy}`, {
    method: "POST",
    headers: { "content-type": "application/pdf", "x-upsert": "true", "x-sesion": sesion.access_token },
    body: pdf,
  });
  caso("subida vía proxy /api/supa (binario, sin corromper)", up.ok,
    up.ok ? undefined : `HTTP ${up.status} ${await up.text()}`);

  const down = await fetch(`${BASE}/api/supa/storage/v1/object/public/documentos/${RUTA}`);
  const bajado = Buffer.from(await down.arrayBuffer());
  const hashBajado = sha256(bajado);
  caso("descarga vía proxy responde 200", down.ok, down.ok ? undefined : `HTTP ${down.status}`);
  caso("SHA-256 idéntico vía proxy (sin corrupción)", hashBajado === hashOriginal,
    `subido=${hashOriginal.slice(0, 12)}… descargado=${hashBajado.slice(0, 12)}…`);
}

const pdfDirecto = await verificarDirecto();
if (conProxy) await verificarProxy(pdfDirecto);
else console.log("\n(parte --proxy omitida: correr después de deployar con `node scripts/verificar-storage.mjs --proxy`)");

console.log(fallas ? `\n${fallas} caso(s) fallaron.` : "\nTodos los casos pasaron.");
process.exit(fallas ? 1 : 0);
