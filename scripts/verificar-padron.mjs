// scripts/verificar-padron.mjs — verificación E2E del padrón definitivo
// (spec Tareas 31-08) contra PRODUCCIÓN sin escribir nada: la vista previa
// revierte por PV999 y los asserts de BD son de solo lectura.
//   Uso: . .\scripts\token-supabase.ps1
//        node scripts/verificar-padron.mjs
// Requiere el fixture local tests/fixtures/PLANILLA_UNIFICADA_ULTIMO.xlsx
// (no versionado: datos personales; copia de OneDrive/Tareas 31-08).
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { leerXlsx } from "../src/lib/importar/xlsx.js";
import { parsearPadron, sinCerosDoc } from "../src/lib/importar/padron.js";

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
const FIXTURE = fileURLToPath(new URL("../tests/fixtures/PLANILLA_UNIFICADA_ULTIMO.xlsx", import.meta.url));
if (!existsSync(FIXTURE)) { console.error("Falta el fixture local PLANILLA_UNIFICADA_ULTIMO.xlsx."); process.exit(1); }

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
const rpcPrevia = async (filas, ceses = []) =>
  sql(`select previsualizar_padron('${JSON.stringify(filas).replaceAll("'", "''")}'::jsonb,
       '${JSON.stringify(ceses)}'::jsonb) as r`);

console.log("— Parser (fixture real) —");
const filas = await leerXlsx(new Uint8Array(readFileSync(FIXTURE)));
const p = parsearPadron(filas);
prueba("79 filas válidas y 0 errores", p.filas.length === 79 && p.errores.length === 0,
  `${p.filas.length} filas, ${p.errores.length} errores`);
prueba("3 razones sociales por RUC con 39/29/11",
  p.empresas.map((e) => e.filas).join(",") === "39,29,11");
const ce = p.filas.filter((f) => f.tipoDocumento === "CE").map((f) => f.documento).sort().join(",");
prueba("los 3 CE conservan sus ceros", ce === "002771952,003308122,004193432", ce);
prueba("sinCerosDoc quita solo ceros a la izquierda",
  sinCerosDoc("003308122") === "3308122" && sinCerosDoc("70081272") === "70081272");
prueba("regla de siglo: hay ingresos de los noventa y 03/08/26 es 2026",
  p.filas.some((f) => f.fechaIngreso.startsWith("19")) &&
  p.filas.some((f) => f.fechaIngreso === "2026-08-03"));

console.log("— Catálogos en producción —");
const cat = (await sql(`select
  (select count(distinct id) from perfiles where id in
    ('supervisor-sede','rrhh-operativo','jefatura-rrhh','planilla','administracion-activos',
     'jefatura-administracion','sst-sig','sst-sig-jefatura','legal','operaciones',
     'contabilidad-finanzas','sistemas','direccion')) as trece,
  (select count(*) from centros_costo where activo) as ccs,
  (select count(*) from cargo_perfiles) as cargos,
  (select (fn_perfil_para_cargo('ASISTENTE')).destino) as generico,
  (select (fn_perfil_para_cargo('COORDINADOR DE RRHH/ADMINISTRACION')).perfil_id) as largo,
  (select (fn_perfil_para_cargo('CARGO INVENTADO XYZ')).destino) as desconocido`))?.[0] ?? {};
prueba("las 13 categorías de la matriz existen", cat.trece === 13, `hay ${cat.trece}`);
prueba("catálogo de centros de costo con 8 valores", cat.ccs === 8, `hay ${cat.ccs}`);
prueba("34 cargos mapeados", cat.cargos === 34, `hay ${cat.cargos}`);
prueba("ASISTENTE a secas queda sin sugerencia", cat.generico === "sin_sugerencia", cat.generico);
prueba("el cargo largo empareja por prefijo con el truncado", cat.largo === "jefatura-rrhh", cat.largo);
prueba("un cargo desconocido no recibe perfil por defecto", cat.desconocido === null, String(cat.desconocido));

console.log("— Vista previa E2E (PV999: nada se escribe) —");
const antes = (await sql("select count(*)::int as n from perfil_propuestas"))?.[0]?.n;
const prev = (await rpcPrevia(p.filas))?.[0]?.r;
if (!prev?.empresas) { console.error("Sin vista previa:", JSON.stringify(prev).slice(0, 400)); process.exit(1); }
const emps = Object.values(prev.empresas);
const suma = (k) => emps.reduce((n, e) => n + (e[k]?.length ?? 0), 0);
prueba("resolución por RUC de las 3 empresas", emps.length === 3, `${emps.length}`);
prueba("40 propuestas de perfil", suma("propuestas") === 40, `${suma("propuestas")}`);
prueba("34 clasificaciones de solo Portal", suma("soloPortal") === 34, `${suma("soloPortal")}`);
prueba("5 sin sugerencia (ASISTENTE genérico)", suma("sinSugerencia") === 5, `${suma("sinSugerencia")}`);
prueba("0 problemas de identidad", (prev.problemas ?? []).length === 0);
prueba("el CE 003308122 resuelve contra el maestro (no es alta)",
  !emps.some((e) => (e.altas ?? []).some((d) => String(d).includes("3308122"))));
prueba("posiblesCeses solo propone (lista sin efecto)", Array.isArray(prev.posiblesCeses));
const despues = (await sql("select count(*)::int as n from perfil_propuestas"))?.[0]?.n;
prueba("PV999 revirtió las propuestas (BD intacta)", antes === despues, `${antes} → ${despues}`);

console.log("— Rechazos totales —");
const conRucMalo = p.filas.map((f, i) => (i === 0 ? { ...f, ruc: "20999999999", razonSocial: "FANTASMA SAC" } : f));
const rucMalo = await rpcPrevia(conRucMalo);
prueba("RUC fuera de catálogo rechaza el archivo completo",
  JSON.stringify(rucMalo).includes("no está en el catálogo"));
const conCcMalo = p.filas.map((f, i) => (i === 0 ? { ...f, centroCosto: "MARKETING" } : f));
const ccMalo = await rpcPrevia(conCcMalo);
prueba("centro de costo desconocido rechaza el archivo completo",
  JSON.stringify(ccMalo).includes("fuera del catálogo"));

console.log(`\n${ok} pruebas OK, ${mal} fallaron.`);
process.exit(mal ? 1 : 0);
