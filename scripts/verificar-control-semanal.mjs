// scripts/verificar-control-semanal.mjs — verificación E2E del control
// semanal (spec Tareas 31-08) contra PRODUCCIÓN.
//  · Parser y vista previa: con el archivo real (PV999, no escribe).
//  · Importación, tolerancia y recálculo reactivo: con un trabajador
//    SINTÉTICO ZZPRUEBA en 2027-02 (mes sin datos reales); se limpia todo.
//   Uso: . .\scripts\token-supabase.ps1
//        node scripts/verificar-control-semanal.mjs
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { leerXlsx } from "../src/lib/importar/xlsx.js";
import { parsearControlSemanal } from "../src/lib/importar/control-semanal.js";

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
const FIXTURE = fileURLToPath(new URL("../tests/fixtures/Control_Semanal_01-28_Agosto_2026.xlsx", import.meta.url));
if (!existsSync(FIXTURE)) { console.error("Falta el fixture local del control semanal."); process.exit(1); }

let ok = 0, mal = 0;
const prueba = (nombre, cond, detalle = "") => {
  if (cond) { ok++; console.log(`  ✓ ${nombre}`); }
  else { mal++; console.log(`  ✗ ${nombre}${detalle ? ` — ${detalle}` : ""}`); }
};
const sql = async (q) => {
  const r = await fetch("https://api.supabase.com/v1/projects/mzpbdkrmokfxrrsotfgs/database/query", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { error: t }; }
};
const esc = (x) => JSON.stringify(x).replaceAll("'", "''");

console.log("— Parser (archivo real) —");
const bytes = new Uint8Array(readFileSync(FIXTURE));
const p = parsearControlSemanal(
  await leerXlsx(bytes, { hoja: "Detalle Diario" }),
  await leerXlsx(bytes, { hoja: "Resumen Mensual" }));
prueba("41 trabajadores y 1148 registros importables (1271 − 123 post-reporte)",
  p.trabajadores.length === 41 && p.registros.length === 1148 && p.descartadas === 123,
  `${p.trabajadores.length}/${p.registros.length}/${p.descartadas}`);
prueba("las 54 filas «Revisar» no son faltas (se conservan con ese nombre)",
  p.registros.filter((x) => x.tipo === "revisar").length === 54);
prueba("el 6 de agosto es feriado «Batalla de Junin» en las 41 personas",
  p.registros.filter((x) => x.tipo === "feriado" && x.feriadoNombre === "Batalla de Junin").length === 41);
prueba("resumen mensual recalculado = archivo en las 41 personas (0 diferencias)",
  p.contrasteResumen.length === 0, `${p.contrasteResumen.length} diferencias`);
prueba("sin columnas EDITADO/MOTIVO se importa igual (nada editado)",
  p.registros.every((x) => x.editado === false));

console.log("— Vista previa E2E (PV999: nada se escribe) —");
const prev = (await sql(`select previsualizar_control('${esc(p.registros)}'::jsonb,
  '${esc(p.trabajadores)}'::jsonb, 'suite-b6') as r`))?.[0]?.r;
if (!prev?.porEmpresa) { console.error("Sin vista previa:", JSON.stringify(prev).slice(0, 400)); process.exit(1); }
prueba("el CE 003308122 resuelve sin rellenar a ocho (no es excepción)",
  !(prev.excepciones ?? []).some((e) => String(e.documento).includes("3308122")));
prueba("42242854 se reporta como documento sin vínculo en el padrón",
  (prev.excepciones ?? []).some((e) => e.documento === "42242854"));
prueba("la empresa de cada fila sale del padrón (suma por RS = resueltos)",
  Object.values(prev.porEmpresa).reduce((a, b) => a + b, 0) === prev.trabajadores);
prueba("la hora de entrada se poblaría en la ficha de todos los resueltos",
  (prev.horasPobladas ?? []).length === prev.trabajadores || (prev.discrepanciasHora ?? []).length > 0);
prueba("0 diferencias entre lo declarado y el recálculo propio",
  (prev.diferencias ?? []).length === 0, `${(prev.diferencias ?? []).length}`);
const nombrePadron = (await sql("select nombre from personas where dni = '40899594'"))?.[0]?.nombre;
prueba("el nombre mostrado es el del padrón (AIRE ATAYARI, no ATAYAURI)",
  nombrePadron === "AIRE ATAYARI IVAN", String(nombrePadron));

console.log("— Importación real sintética (ZZPRUEBA, 2027-02) —");
const DOC = "ZZPRUEBA-CTRL";
const limpiar = async () => sql(`
  delete from marcaciones where documento = '${DOC}';
  delete from asistencia_lotes where archivo like 'zzprueba-%';
  delete from horarios_entrada where persona_dni = '${DOC}';
  delete from feriados where fecha = '2027-02-04';
  delete from vinculos where persona_dni = '${DOC}';
  delete from personas where dni = '${DOC}';`);
await limpiar();
await sql(`
  insert into personas (dni, nombre, portal) values ('${DOC}', 'ZZ PRUEBA CONTROL', 'sin_celular');
  insert into vinculos (persona_dni, empresa_id, sede_id, cargo, fecha_inicio)
  values ('${DOC}', 'negliaf', fn_sede_para_importacion('negliaf', 'Por asignar', null), 'Prueba', '2027-01-01');`);

// 4 laborables con tardanza cruda 40/20/10/15 y un «revisar»: prueba EXACTA
// de la tolerancia (3 primeras con 30 min de gracia; cualquiera consume día).
const regs = [
  { doc: DOC, fecha: "2027-02-01", tipo: "laborable", m1: "08:40", raw: 40, efec: 10 },
  { doc: DOC, fecha: "2027-02-02", tipo: "laborable", m1: "08:20", raw: 20, efec: 0 },
  { doc: DOC, fecha: "2027-02-03", tipo: "laborable", m1: "08:10", raw: 10, efec: 0 },
  { doc: DOC, fecha: "2027-02-04", tipo: "laborable", m1: "08:15", raw: 15, efec: 15 },
  { doc: DOC, fecha: "2027-02-05", tipo: "revisar" },
].map((x) => {
  // Lo declarado debe decir lo que las marcas dicen (m1→13:00 + 14:00→17:00);
  // si no, el motor lo reporta como diferencia — que es justo su trabajo.
  const min = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const trab = x.m1 ? (min("13:00") - min(x.m1)) + (min("17:00") - min("14:00")) : null;
  return {
    documento: x.doc, docSinCeros: x.doc, fecha: x.fecha, tipo: x.tipo,
    feriadoNombre: null, m1: x.m1 ?? null, m2: x.m1 ? "13:00" : null,
    m3: x.m1 ? "14:00" : null, m4: x.m1 ? "17:00" : null, he: x.m1 ? "08:00" : null,
    minTrab: trab, minExceso: x.m1 ? 0 : null, minDeficit: trab != null ? 480 - trab : null,
    tardRaw: x.raw ?? null, tardEfec: x.efec ?? null,
    observacion: null, editado: false, motivoEdicion: null,
  };
});
const trabs = [{ documento: DOC, docSinCeros: DOC, nombreArchivo: "ZZ PRUEBA CONTROL", area: "ADM", he: "08:00" }];

const imp1 = (await sql(`select importar_control('${esc(regs)}'::jsonb, '${esc(trabs)}'::jsonb,
  'zzprueba-b6.xlsx', 'suite-b6') as r`))?.[0]?.r;
prueba("importó 5 filas del sintético", imp1?.filas === 5 && imp1?.trabajadores === 1, JSON.stringify(imp1)?.slice(0, 200));
prueba("pobló la hora de entrada en la primera importación",
  (imp1?.horasPobladas ?? []).length === 1);
prueba("la importación no encontró diferencias (declarado = regla del spec)",
  (imp1?.diferencias ?? []).length === 0, JSON.stringify(imp1?.diferencias));

const calc = await sql(`select fecha, tard_raw, tard_efec, calc->>'tardEfec' as calc_efec,
  calc->>'tipoEfectivo' as tipo_ef from marcaciones where documento = '${DOC}' order by fecha`);
prueba("tolerancia: 40→10, 20→0, 10→0 y la cuarta sin gracia 15→15",
  calc?.map((c) => c.calc_efec).join(",") === "10,0,0,15,null" ||
  calc?.map((c) => String(c.calc_efec)).join(",") === "10,0,0,15,null",
  JSON.stringify(calc));

const imp2 = (await sql(`select importar_control('${esc(regs)}'::jsonb, '${esc(trabs)}'::jsonb,
  'zzprueba-b6.xlsx', 'suite-b6') as r`))?.[0]?.r;
const n2 = (await sql(`select count(*)::int as n from marcaciones where documento = '${DOC}'`))?.[0]?.n;
prueba("reimportar el mismo archivo no duplica nada", imp2?.filas === 5 && n2 === 5, `${n2} filas`);

// Recalculo reactivo: feriado nuevo el 2027-02-04 → ese día deja de ser
// laborable, su tardanza desaparece y queda marcado con el motivo.
const nRec = (await sql(`select guardar_feriado('2027-02-04', 'Feriado de prueba', 'suite-b6') as n`))?.[0]?.n;
const dia4 = (await sql(`select calc->>'tipoEfectivo' as tipo_ef, calc->>'tardEfec' as efec, recalculado
  from marcaciones where documento = '${DOC}' and fecha = '2027-02-04'`))?.[0];
prueba("feriado nuevo reclasifica el día ya importado sin recargar el archivo",
  nRec >= 1 && dia4?.tipo_ef === "feriado" && dia4?.recalculado?.includes("Feriado de prueba"),
  JSON.stringify(dia4));
await sql(`select eliminar_feriado('2027-02-04', 'suite-b6')`);
const dia4b = (await sql(`select calc->>'tipoEfectivo' as tipo_ef, calc->>'tardEfec' as efec
  from marcaciones where documento = '${DOC}' and fecha = '2027-02-04'`))?.[0];
prueba("retirar el feriado restaura el cálculo original (15 min efectivos)",
  dia4b?.tipo_ef === "laborable" && String(dia4b?.efec) === "15", JSON.stringify(dia4b));

const tablero = (await sql(`select * from v_asistencia_mensual
  where documento = '${DOC}' and periodo = '2027-02'`))?.[0];
prueba("el tablero mensual agrupa con tardanza efectiva 25 y 2 días de tardanza",
  tablero?.tardEfec === 25 && tablero?.diasTardanza === 2 && tablero?.revisar === 1,
  JSON.stringify(tablero)?.slice(0, 200));

await limpiar();
const quedo = (await sql(`select count(*)::int as n from personas where dni = '${DOC}'`))?.[0]?.n;
prueba("limpieza completa del sintético", quedo === 0);

console.log(`\n${ok} pruebas OK, ${mal} fallaron.`);
process.exit(mal ? 1 : 0);
