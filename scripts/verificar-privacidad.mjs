// scripts/verificar-privacidad.mjs — pruebas E2E de BD de "Privacidad de
// documentos" (Task 1: bucket privado, rutas internas, RLS admin-solo).
// Se amplía en Tasks 2 y 4 con las partes de Portal/BackOffice.
// Uso: & scripts/token-supabase.ps1 | Out-Null; node scripts/verificar-privacidad.mjs
const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
let fallos = 0;
async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
async function prueba(nombre, fn) {
  try { await fn(); console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); }
}
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

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
  // Nota: el brief original filtraba por archivo_url like 'lotes/%' (boletas
  // reales de lamericana), pero esas filas ya no existen en documentos — el
  // lote real quedó borrado en algún momento por la limpieza de
  // verificar-tres-ajustes.mjs (Task 13), que usa el MISMO empresa_id
  // ('lamericana') y periodo ('2026-06') que las boletas reales para sus
  // datos sintéticos (ver concern en task-1-report.md). Los 9 PDF reales
  // siguen en Storage, huérfanos de fila en documentos, pero ya inaccesibles
  // por URL pública gracias al bucket privado (paso 1 de esta migración): se
  // prueba la misma propiedad con cualquier archivo_url existente.
  const [d] = await sql("select archivo_url from documentos where archivo_url is not null limit 1");
  igual(d != null, true, "debe existir al menos un documento con archivo_url para esta prueba");
  const r = await fetch(`https://mzpbdkrmokfxrrsotfgs.supabase.co/storage/v1/object/public/documentos/${d.archivo_url}`);
  igual(r.status !== 200, true, `respondió ${r.status}`);
});

console.log(fallos ? `\n${fallos} PRUEBAS FALLARON` : "\nTODAS LAS PRUEBAS PASARON");
process.exit(fallos ? 1 : 0);
