// scripts/verificar-fijar-correo.mjs — pruebas del RPC fijar_correo_persona
// contra la BD viva (Management API). Datos ZZPRUEBAC, limpieza al final.
// Uso: & scripts/token-supabase.ps1 | Out-Null; node scripts/verificar-fijar-correo.mjs
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
const limpiar = async () => { await sql("delete from personas where dni like 'ZZPRUEBAC%'"); };

await limpiar();
await sql("insert into personas (dni, nombre) values ('ZZPRUEBAC1', 'ZZ Prueba Correo')");

await prueba("fija un correo nuevo: minúsculas, sin verificar y con auditoría", async () => {
  await sql("select fijar_correo_persona('ZZPRUEBAC1', '  Persona@Correo.COM ')");
  const [p] = await sql("select correo, correo_verificado from personas where dni = 'ZZPRUEBAC1'");
  igual(p.correo, "persona@correo.com", "correo normalizado");
  igual(p.correo_verificado, false, "verificado");
  const [au] = await sql(
    "select count(*)::int n from auditoria where accion='FIJAR_CORREO' and datos_despues->>'dni' = 'ZZPRUEBAC1'");
  igual(au.n >= 1, true, "auditoría");
});

await prueba("cambiar el correo vuelve a dejarlo sin verificar", async () => {
  await sql("update personas set correo_verificado = true where dni = 'ZZPRUEBAC1'");
  await sql("select fijar_correo_persona('ZZPRUEBAC1', 'otro@correo.com')");
  const [p] = await sql("select correo, correo_verificado from personas where dni = 'ZZPRUEBAC1'");
  igual(p.correo, "otro@correo.com", "correo");
  igual(p.correo_verificado, false, "verificado");
});

await prueba("repetir el MISMO correo conserva la verificación", async () => {
  await sql("update personas set correo_verificado = true where dni = 'ZZPRUEBAC1'");
  await sql("select fijar_correo_persona('ZZPRUEBAC1', 'OTRO@correo.com')");
  const [p] = await sql("select correo_verificado from personas where dni = 'ZZPRUEBAC1'");
  igual(p.correo_verificado, true, "verificado debía conservarse");
});

await prueba("negativa: formato inválido se rechaza sin tocar nada", async () => {
  let error = null;
  try { await sql("select fijar_correo_persona('ZZPRUEBAC1', 'no-es-correo')"); }
  catch (e) { error = e.message; }
  igual(error !== null && error.includes("formato"), true, `error (${error})`);
  const [p] = await sql("select correo from personas where dni = 'ZZPRUEBAC1'");
  igual(p.correo, "otro@correo.com", "el correo debía quedar intacto");
});

await prueba("vaciar borra el correo", async () => {
  await sql("select fijar_correo_persona('ZZPRUEBAC1', '')");
  const [p] = await sql("select correo from personas where dni = 'ZZPRUEBAC1'");
  igual(p.correo, null, "correo");
});

await prueba("negativa: persona inexistente se rechaza", async () => {
  let error = null;
  try { await sql("select fijar_correo_persona('ZZPRUEBAC9', 'x@y.pe')"); }
  catch (e) { error = e.message; }
  igual(error !== null && error.includes("no existe"), true, `error (${error})`);
});

await prueba("no toca nombre, celular ni la marca por confirmar", async () => {
  await sql("update personas set celular = '999888777', nombre_por_confirmar = true where dni = 'ZZPRUEBAC1'");
  await sql("select fijar_correo_persona('ZZPRUEBAC1', 'final@correo.com')");
  const [p] = await sql(
    "select nombre, celular, nombre_por_confirmar from personas where dni = 'ZZPRUEBAC1'");
  igual(p.nombre, "ZZ Prueba Correo", "nombre");
  igual(p.celular, "999888777", "celular");
  igual(p.nombre_por_confirmar, true, "por confirmar debía conservarse");
});

await limpiar();
console.log(fallos ? `\n${fallos} PRUEBAS FALLARON` : "\nTODAS LAS PRUEBAS PASARON");
process.exit(fallos ? 1 : 0);
