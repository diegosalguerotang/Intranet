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

// ---------- v2 de importar_planilla_unificada (pruebas 4–9) ----------
// Escenario: P1 traslado A→B, P2 vigente en A ausente del archivo (posible
// cese), P3 cesada que retorna a A, P4 alta nueva. Período 2026-09 → el
// corte por defecto es 2026-08-31.
const base = "993" + String(Math.floor(Math.random() * 100_000)).padStart(5, "0").slice(0, 5);
const P1 = base + "1", P2 = base + "2", P3 = base + "3", P4 = base + "4";
const [banco] = await sql(`select codigo, nombre from bancos order by codigo limit 1`);
for (const [dni, emp, sede, fin] of [[P1, A, A.sede, null], [P2, A, A.sede, null], [P3, A, A.sede, "'2026-03-31'"]]) {
  await sql(`insert into personas (dni, nombre, portal) values ('${dni}', 'ZZPRUEBA MOV ${dni}', 'sin_celular')`);
  await sql(`insert into vinculos (persona_dni, empresa_id, sede_id, cargo, fecha_inicio, fecha_fin)
    values ('${dni}', '${emp.id}', '${sede}', 'Operario de limpieza', '2026-01-01', ${fin ?? "null"})`);
}
const fila = (emp, doc, nombre) => ({ ruc: emp.ruc, denominacion: emp.nombre, documento: doc,
  nombre, tipoDoc: "DNI", cuenta: "12345678901234567890", bancoCodigo: banco.codigo,
  sede: "", fechaIngreso: "", contrato: "PLAZO FIJO", centroCostoCodigo: "", centroCostoDesc: "" });
const FILAS = [fila(B, P1, `ZZPRUEBA MOV ${P1}`), fila(A, P3, `ZZPRUEBA MOV ${P3}`), fila(A, P4, `ZZPRUEBA MOV ${P4}`)];
let r1 = null; // resultado de la importación real sin ceses

await prueba("4. traslado: cierra el vínculo anterior y abre el nuevo, con movimiento", async () => {
  [{ r: r1 }] = await sql(`select importar_planilla_unificada(${j(FILAS)}, '2026-09', 'verificar-movimientos-v2') as r`);
  const [viejo] = await sql(`select fecha_fin from vinculos where persona_dni='${P1}' and empresa_id='${A.id}'`);
  igual(viejo.fecha_fin, "2026-08-31", "fecha_fin del vínculo viejo");
  const [nuevo] = await sql(`select count(*)::int n from vinculos where persona_dni='${P1}' and empresa_id='${B.id}' and fecha_fin is null`);
  igual(nuevo.n, 1, "vínculo nuevo vigente en destino");
  const [m] = await sql(`select empresa_origen, empresa_destino,
      vinculo_cerrado is not null cerr, vinculo_abierto is not null abie, periodo
    from movimientos where persona_dni='${P1}' and tipo='traslado'`);
  igual(m.empresa_origen, A.id, "origen");
  igual(m.empresa_destino, B.id, "destino");
  igual(m.cerr && m.abie, true, "ambos vínculos referenciados");
  igual(m.periodo, "2026-09", "período");
});

await prueba("5. el resumen reporta traslados[] (y ya no como vínculo nuevo)", async () => {
  const t = r1.empresas[B.id].traslados;
  igual(t.length, 1, "traslados");
  igual(t[0].documento, P1, "documento");
  igual(t[0].desde, A.nombre, "desde");
  igual(r1.empresas[B.id].vinculosNuevos.includes(P1), false, "no duplica en vinculosNuevos");
});

await prueba("6. ausencia sin confirmar: propone el cese pero NO cesa", async () => {
  const pc = (r1.posiblesCeses ?? []).filter((c) => c.documento === P2);
  igual(pc.length, 1, "P2 en posiblesCeses");
  igual(pc[0].empresaNombre, A.nombre, "empresa del posible cese");
  const [v] = await sql(`select count(*)::int n from vinculos where persona_dni='${P2}' and fecha_fin is null`);
  igual(v.n, 1, "P2 sigue vigente (jamás cesa solo)");
});

await prueba("7. cese CONFIRMADO: cierra el vínculo y deja movimiento", async () => {
  await sql(`select importar_planilla_unificada(${j(FILAS)}, '2026-09', 'verificar-movimientos-v2', ${j([P2])})`);
  const [v] = await sql(`select fecha_fin from vinculos where persona_dni='${P2}'`);
  igual(v.fecha_fin, "2026-08-31", "fecha de cese");
  const [m] = await sql(`select empresa_origen, periodo, creado_por from movimientos where persona_dni='${P2}' and tipo='cese'`);
  igual(m.empresa_origen, A.id, "empresa del cese");
  igual(m.creado_por, "verificar-movimientos-v2", "autor");
});

await prueba("8. retorno: vínculo nuevo + movimiento, reportado en retornos[]", async () => {
  const [v] = await sql(`select count(*)::int n from vinculos where persona_dni='${P3}' and fecha_fin is null`);
  igual(v.n, 1, "vínculo nuevo vigente");
  const [m] = await sql(`select count(*)::int n from movimientos where persona_dni='${P3}' and tipo='retorno'`);
  igual(m.n, 1, "movimiento retorno (solo de la 1.ª corrida)");
  igual(r1.empresas[A.id].retornos.includes(P3), true, "en retornos[]");
  igual(r1.empresas[A.id].altas.includes(P3), false, "no es alta");
});

await prueba("9. alta nueva deja movimiento; la vista previa no escribe nada", async () => {
  const [m] = await sql(`select count(*)::int n from movimientos where persona_dni='${P4}' and tipo='alta'`);
  igual(m.n, 1, "movimiento alta de P4");
  const antes = (await sql(`select count(*)::int n from movimientos`))[0].n;
  const [{ p }] = await sql(`select previsualizar_planilla_unificada(${j(FILAS)}, '2026-09', ${j([P4])}) as p`);
  igual(Array.isArray(p.posiblesCeses), true, "la vista previa trae posiblesCeses");
  const despues = (await sql(`select count(*)::int n from movimientos`))[0].n;
  igual(despues, antes, "PV999 no dejó movimientos");
  const [v] = await sql(`select count(*)::int n from vinculos where persona_dni='${P4}' and fecha_fin is null`);
  igual(v.n, 1, "el cese de la vista previa tampoco se aplicó");
});

// ---------- Limpieza ----------
await sql(`
  alter table movimientos disable trigger tg_movimientos_inmutables;
  delete from movimientos where persona_dni in ('${DNI}','${P1}','${P2}','${P3}','${P4}');
  alter table movimientos enable trigger tg_movimientos_inmutables;
  delete from vinculos where persona_dni in ('${DNI}','${P1}','${P2}','${P3}','${P4}');
  delete from personas where dni in ('${DNI}','${P1}','${P2}','${P3}','${P4}');
`);
const resto = await sql(`select (select count(*) from personas where dni in ('${DNI}','${P1}','${P2}','${P3}','${P4}'))
  + (select count(*) from movimientos where persona_dni in ('${DNI}','${P1}','${P2}','${P3}','${P4}')) as n`);
if (resto?.[0]?.n !== 0) { fallos++; console.error(`✗ limpieza: ${JSON.stringify(resto)}`); }
else console.log("✓ limpieza total");

console.log(fallos ? `\n${fallos} PRUEBAS FALLARON` : "\nTODAS LAS PRUEBAS PASARON");
process.exit(fallos ? 1 : 0);
