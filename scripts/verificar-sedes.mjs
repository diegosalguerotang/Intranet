// scripts/verificar-sedes.mjs — pruebas del código de sede (S-0001…) y del
// RPC crear_sede contra la BD viva (Management API). Datos de prueba con
// nombre ZZ-PRUEBA, limpieza acotada al final.
// Uso: & scripts/token-supabase.ps1 | Out-Null; node scripts/verificar-sedes.mjs
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
const limpiar = () => sql("delete from sedes where nombre like 'ZZ-PRUEBA%'");

await limpiar();

await prueba("backfill: ninguna sede queda sin código y todos son únicos S-NNNN", async () => {
  const [sin] = await sql("select count(*)::int n from sedes where codigo is null");
  igual(sin.n, 0, "sin código");
  const [dup] = await sql(
    "select count(*)::int n from (select codigo from sedes group by codigo having count(*) > 1) d");
  igual(dup.n, 0, "duplicados");
  const [malos] = await sql("select count(*)::int n from sedes where codigo !~ '^S-[0-9]{4,}$'");
  igual(malos.n, 0, "formato");
});

await prueba("crear_sede asigna id estable y código de secuencia; queda auditoría", async () => {
  const [{ r }] = await sql(
    "select crear_sede('promant', 'ZZ-PRUEBA Sede Central', 'CLIENTE X', 'Av. Prueba 123', 'verificar-sedes') as r");
  igual(r.id, "promant-zz-prueba-sede-central", "id slug");
  igual(/^S-\d{4,}$/.test(r.codigo), true, `código (${r.codigo})`);
  const [s] = await sql(`select cliente, direccion from sedes where id = '${r.id}'`);
  igual(s.cliente, "CLIENTE X", "cliente");
  igual(s.direccion, "Av. Prueba 123", "dirección");
  const [au] = await sql(
    `select count(*)::int n from auditoria where accion='CREAR_SEDE' and datos_despues->>'id' = '${r.id}'`);
  igual(au.n >= 1, true, "auditoría");
});

await prueba("v_sedes expone código, dirección y estado", async () => {
  const [v] = await sql(
    "select codigo, direccion, estado from v_sedes where id = 'promant-zz-prueba-sede-central'");
  igual(/^S-\d{4,}$/.test(v.codigo), true, "código en la vista");
  igual(v.estado, "activa", "estado");
});

await prueba("negativa: nombre repetido en la misma empresa se rechaza", async () => {
  let error = null;
  try { await sql("select crear_sede('promant', 'zz-prueba SEDE CENTRAL', null)"); }
  catch (e) { error = e.message; }
  igual(error !== null && error.includes("Ya existe"), true, `error (${error})`);
});

await prueba("negativa: sin nombre o empresa retirada se rechaza", async () => {
  let e1 = null, e2 = null;
  try { await sql("select crear_sede('promant', '   ', null)"); } catch (e) { e1 = e.message; }
  try { await sql("select crear_sede('bremco', 'ZZ-PRUEBA Otra', null)"); } catch (e) { e2 = e.message; }
  igual(e1 !== null && e1.includes("nombre"), true, `sin nombre (${e1})`);
  igual(e2 !== null && e2.includes("no está activa"), true, `retirada (${e2})`);
});

await prueba("la importación de personal asigna código a la sede que crea", async () => {
  const id = await sql(
    "select fn_sede_para_importacion('promant', 'ZZ-PRUEBA IMPORTADA', 'CLIENTE Y') as id");
  const [s] = await sql(`select codigo from sedes where id = '${id[0].id}'`);
  igual(/^S-\d{4,}$/.test(s.codigo ?? ""), true, `código (${s.codigo})`);
});

await limpiar();
console.log(fallos ? `\n${fallos} PRUEBAS FALLARON` : "\nTODAS LAS PRUEBAS PASARON");
process.exit(fallos ? 1 : 0);
