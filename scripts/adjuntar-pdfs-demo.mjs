// Crea el bucket de Storage `documentos` (lectura pública) y adjunta un PDF
// de demostración a cada documento seed sin archivo, actualizando
// documentos.archivo_url. Sin dependencias: el PDF se genera a mano.
//   ./scripts/token-supabase.ps1 no hace falta: usa la service key local vía
//   Management API para obtenerla (SUPABASE_ACCESS_TOKEN sí es necesario).
const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const SUPA = `https://${PROYECTO}.supabase.co`;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }

const keys = await (await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${token}` },
})).json();
const SERVICE = keys.find((k) => k.name === "service_role")?.api_key;
const cab = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };

// PDF mínimo válido de una página con texto (sin librerías).
function pdfDemo(lineas) {
  const contenido = [
    "BT /F1 16 Tf 50 780 Td (GRUPO ER — DOCUMENTO DE DEMOSTRACION) Tj ET",
    ...lineas.map((l, i) =>
      `BT /F1 11 Tf 50 ${740 - i * 22} Td (${l.replace(/[()\\]/g, "")}) Tj ET`),
    "BT /F1 9 Tf 50 60 Td (Archivo de ejemplo para pruebas del Portal del Trabajador.) Tj ET",
  ].join("\n");
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

// 1 · Bucket público de lectura (idempotente)
let r = await fetch(`${SUPA}/storage/v1/bucket`, {
  method: "POST",
  headers: { ...cab, "Content-Type": "application/json" },
  body: JSON.stringify({ id: "documentos", name: "documentos", public: true }),
});
console.log("bucket documentos:", r.status === 200 || r.status === 409 ? "listo" : `HTTP ${r.status} ${await r.text()}`);

// 2 · Documentos sin archivo
r = await fetch(`${SUPA}/rest/v1/documentos?archivo_url=is.null&select=id,titulo,tipo,periodo`, { headers: cab });
const docs = await r.json();
console.log(`documentos sin archivo: ${docs.length}`);

// 3 · Generar, subir y vincular
for (const d of docs) {
  const pdf = pdfDemo([
    `Documento: ${d.titulo}`,
    `Tipo: ${d.tipo}`,
    `Periodo: ${d.periodo ?? "-"}`,
    `Identificador interno: ${d.id}`,
  ]);
  const ruta = `demo/doc-${d.id}.pdf`;
  const up = await fetch(`${SUPA}/storage/v1/object/documentos/${ruta}`, {
    method: "POST",
    headers: { ...cab, "Content-Type": "application/pdf", "x-upsert": "true" },
    body: pdf,
  });
  if (!up.ok) { console.error(`  ✘ doc ${d.id}: ${up.status} ${await up.text()}`); continue; }
  const url = `${SUPA}/storage/v1/object/public/documentos/${ruta}`;
  const patch = await fetch(`${SUPA}/rest/v1/documentos?id=eq.${d.id}`, {
    method: "PATCH",
    headers: { ...cab, "Content-Type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({ archivo_url: url }),
  });
  console.log(patch.ok ? `  ✔ doc ${d.id} → ${ruta}` : `  ✘ doc ${d.id}: PATCH ${patch.status}`);
}
console.log("Hecho.");
