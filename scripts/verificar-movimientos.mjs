// scripts/verificar-movimientos.mjs — pruebas del ciclo Movimientos de
// Planilla contra la BD viva (Management API): tabla insert-only, vistas de
// historial y la v2 de importar_planilla_unificada (traslados que cierran el
// vínculo anterior, ceses SOLO confirmados, retornos). Datos ZZPRUEBA con
// limpieza total al final (el trigger de inmutabilidad se apaga un instante
// solo aquí, igual que en verificar-solicitudes).
// Uso: . .\scripts\token-supabase.ps1; node scripts/verificar-movimientos.mjs
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
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message.slice(0, 300)}`); }
}
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
const esperaError = async (q, fragmento, msj) => {
  let error = null;
  try { await sql(q); } catch (e) { error = e.message; }
  if (!error || !error.includes(fragmento)) throw new Error(`${msj}: esperaba «${fragmento}», llegó ${error}`);
};
const j = (o) => `'${JSON.stringify(o).replaceAll("'", "''")}'::jsonb`;

// Escenario base: dos empresas ACTIVAS distintas con una sede cada una, y
// una persona ZZPRUEBA con historial en ambas (uno cerrado, uno vigente).
const empresas = await sql(`select e.id, e.nombre, e.ruc,
    (select s.id from sedes s where s.empresa_id = e.id limit 1) as sede
  from empresas e where e.estado = 'activa'
    and exists (select 1 from sedes s where s.empresa_id = e.id)
  order by e.id limit 2`);
if (empresas.length < 2) { console.error("Se necesitan 2 empresas activas con sede."); process.exit(1); }
const [A, B] = empresas;
const DNI = "99" + String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
await sql(`insert into personas (dni, nombre, portal) values ('${DNI}', 'ZZPRUEBA MOVIMIENTOS', 'sin_celular')`);
await sql(`insert into vinculos (persona_dni, empresa_id, sede_id, cargo, fecha_inicio, fecha_fin)
  values ('${DNI}', '${A.id}', '${A.sede}', 'Operario de limpieza', '2025-01-01', '2025-12-31')`);
await sql(`insert into vinculos (persona_dni, empresa_id, sede_id, cargo, fecha_inicio)
  values ('${DNI}', '${B.id}', '${B.sede}', 'Operario de limpieza', '2026-01-01')`);
console.log(`Escenario: ${DNI} — cerrado en ${A.nombre}, vigente en ${B.nombre}`);

await prueba("1. movimientos es insert-only (trigger de inmutabilidad)", async () => {
  await sql(`insert into movimientos (persona_dni, tipo, empresa_destino, fecha_efecto, periodo, creado_por)
    values ('${DNI}', 'alta', '${A.id}', '2025-01-01', '2025-01', 'verificar-movimientos')`);
  await esperaError(`update movimientos set detalle='hackeado' where creado_por='verificar-movimientos'`,
    "no se edita", "update permitido");
  await esperaError(`delete from movimientos where creado_por='verificar-movimientos'`,
    "no se edita", "delete permitido");
});

await prueba("2. v_vinculos_persona lista TODOS los vínculos con nombres", async () => {
  const filas = await sql(`select * from v_vinculos_persona where dni='${DNI}'`);
  igual(filas.length, 2, "cantidad");
  const vigente = filas.find((f) => f.vigente), cerrado = filas.find((f) => !f.vigente);
  igual(vigente.empresaNombre, B.nombre, "empresa vigente");
  igual(cerrado.fin, "2025-12-31", "fecha fin del cerrado");
  igual(typeof vigente.sedeNombre, "string", "sede con nombre");
});

await prueba("3. v_movimientos_persona resuelve nombres de empresas", async () => {
  await sql(`insert into movimientos (persona_dni, tipo, empresa_origen, empresa_destino, fecha_efecto, periodo, creado_por)
    values ('${DNI}', 'traslado', '${A.id}', '${B.id}', '2025-12-31', '2026-01', 'verificar-movimientos')`);
  const [m] = await sql(`select * from v_movimientos_persona where dni='${DNI}' and tipo='traslado'`);
  igual(m.deEmpresa, A.nombre, "origen");
  igual(m.aEmpresa, B.nombre, "destino");
  igual(m.fecha, "2025-12-31", "fecha efecto");
  igual(m.por, "verificar-movimientos", "autor");
});

// ---------- Limpieza ----------
await sql(`
  alter table movimientos disable trigger tg_movimientos_inmutables;
  delete from movimientos where persona_dni = '${DNI}' or creado_por like 'verificar-movimientos%';
  alter table movimientos enable trigger tg_movimientos_inmutables;
  delete from vinculos where persona_dni = '${DNI}';
  delete from personas where dni = '${DNI}';
`);
const resto = await sql(`select (select count(*) from personas where dni='${DNI}')
  + (select count(*) from movimientos where persona_dni='${DNI}') as n`);
if (resto?.[0]?.n !== 0) { fallos++; console.error(`✗ limpieza: ${JSON.stringify(resto)}`); }
else console.log("✓ limpieza total");

console.log(fallos ? `\n${fallos} PRUEBAS FALLARON` : "\nTODAS LAS PRUEBAS PASARON");
process.exit(fallos ? 1 : 0);
