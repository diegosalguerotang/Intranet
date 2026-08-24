// scripts/previa-planilla-unificada.mjs — vista previa REAL de la planilla
// unificada contra producción, sin escribir nada (previsualizar_planilla_
// unificada revierte todo por PV999). Preflight antes de importar de verdad
// desde RRH-05. Usa el parser del proyecto, igual que la pantalla.
//   Uso: . .\scripts\token-supabase.ps1
//        node scripts/previa-planilla-unificada.mjs [ruta.xlsx]
//   (por defecto: tests/fixtures/OFICINA_JUL_2026_UNIFICADO.xlsx, gitignored)
import { readFileSync } from "node:fs";
import { leerXlsx, nombresHojas } from "../src/lib/importar/xlsx.js";
import { parsearPlanillaUnificada } from "../src/lib/importar/planilla-unificada.js";

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
const RUTA = process.argv[2] ?? new URL("../tests/fixtures/OFICINA_JUL_2026_UNIFICADO.xlsx", import.meta.url);

const bytes = new Uint8Array(readFileSync(RUTA));
const hojas = await nombresHojas(bytes);
const parseo = parsearPlanillaUnificada(await leerXlsx(bytes), { hoja: hojas[0] });
console.log(`Hoja «${hojas[0]}» → período ${parseo.periodo ?? "(no detectado)"}`);
console.log(`Filas válidas: ${parseo.filas.length} · errores: ${parseo.errores.length} · advertencias: ${(parseo.advertencias ?? []).length}`);
for (const e of parseo.errores.slice(0, 10)) console.log("  error:", e);
for (const a of (parseo.advertencias ?? []).slice(0, 10)) console.log("  advertencia:", a);
if (!parseo.periodo) { console.error("Sin período no hay vista previa (teclearlo es cosa de la pantalla)."); process.exit(1); }

const filasJson = JSON.stringify(parseo.filas).replaceAll("'", "''");
const r = await fetch("https://api.supabase.com/v1/projects/mzpbdkrmokfxrrsotfgs/database/query", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: `select previsualizar_planilla_unificada('${filasJson}'::jsonb, '${parseo.periodo}') as r` }),
});
const cuerpo = await r.text();
let res;
try { res = JSON.parse(cuerpo)?.[0]?.r; } catch { console.error("Respuesta cruda:", cuerpo.slice(0, 1500)); process.exit(1); }
if (!res) { console.error("Sin resumen:", cuerpo.slice(0, 1500)); process.exit(1); }

console.log("\n=== VISTA PREVIA (nada se escribió) ===");
for (const [emp, resu] of Object.entries(res.empresas ?? {})) {
  console.log(`\n· ${emp}:`);
  for (const [k, v] of Object.entries(resu)) {
    if (Array.isArray(v)) console.log(`  ${k} (${v.length})${v.length && v.length <= 15 ? ": " + v.map((x) => typeof x === "object" ? JSON.stringify(x) : x).join(", ") : ""}`);
    else console.log(`  ${k}: ${JSON.stringify(v)}`);
  }
}
const resto = Object.fromEntries(Object.entries(res).filter(([k]) => k !== "empresas"));
if (Object.keys(resto).length) console.log("\nGlobal:", JSON.stringify(resto, null, 1));
