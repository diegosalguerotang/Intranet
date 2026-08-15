// scripts/verificar-tres-ajustes.mjs — pruebas E2E de BD de los tres ajustes.
// Uso: & scripts/token-supabase.ps1 | Out-Null; node scripts/verificar-tres-ajustes.mjs
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

await prueba("L. Americana tiene el RUC real", async () => {
  const [e] = await sql("select ruc from empresas where id='lamericana'");
  igual(e.ruc, "20601705185", "ruc");
});
await prueba("BREMCO está retirada", async () => {
  const [e] = await sql("select estado from empresas where id='bremco'");
  igual(e.estado, "retirada", "estado");
});
await prueba("no se puede crear un vínculo en BREMCO", async () => {
  let fallo = false;
  try {
    await sql("insert into vinculos (persona_dni, empresa_id, sede_id, cargo, fecha_inicio) values ('45231876','bremco','essalud','Operario de limpieza','2026-01-01')");
  } catch { fallo = true; }
  igual(fallo, true, "el insert debió fallar");
});
await prueba("los históricos de BREMCO siguen consultables", async () => {
  const [r] = await sql("select count(*)::int n from vinculos where empresa_id='bremco'");
  igual(r.n >= 2, true, "vínculos históricos");
});
await prueba("catálogo de cargos existe", async () => {
  const [r] = await sql("select count(*)::int n from cargos");
  igual(r.n >= 8, true, "cargos seed");
});
await prueba("cargos tiene RLS habilitado", async () => {
  const [r] = await sql("select relrowsecurity from pg_class where relname='cargos'");
  igual(r.relrowsecurity, true, "relrowsecurity");
});
await prueba("el sistema muestra cuatro razones sociales activas", async () => {
  const [r] = await sql("select count(*)::int n from empresas where estado='activa'");
  igual(r.n, 4, "empresas activas");
});
console.log(fallos ? `\n${fallos} PRUEBAS FALLARON` : "\nTODAS LAS PRUEBAS PASARON");
process.exit(fallos ? 1 : 0);
