// scripts/verificar-storage.mjs — Task 12: verifica el canal binario a
// Supabase Storage que usará la subida de boletas (Task 14).
//
// Parte PRE-DEPLOY (siempre corre): sube un PDF pequeño DIRECTO a Supabase
// Storage con la service key (patrón de adjuntar-pdfs-demo.mjs), lo
// descarga por su URL pública y compara SHA-256 byte a byte.
//   & scripts/token-supabase.ps1 | Out-Null; node scripts/verificar-storage.mjs
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

async function verificarDirecto() {
  console.log("\n== Parte pre-deploy: subida DIRECTA a Supabase Storage ==");
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }

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
