// scripts/previa-control.mjs — vista previa REAL del control semanal contra
// producción, sin escribir nada (previsualizar_control revierte por PV999).
// Preflight antes de importar desde RRH-22. Usa el parser del proyecto.
//   Uso: . .\scripts\token-supabase.ps1
//        node scripts/previa-control.mjs [ruta.xlsx]
import { readFileSync } from "node:fs";
import { leerXlsx } from "../src/lib/importar/xlsx.js";
import { parsearControlSemanal } from "../src/lib/importar/control-semanal.js";

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
const RUTA = process.argv[2] ?? new URL("../tests/fixtures/Control_Semanal_01-28_Agosto_2026.xlsx", import.meta.url);

const bytes = new Uint8Array(readFileSync(RUTA));
const detalle = await leerXlsx(bytes, { hoja: "Detalle Diario" });
const resumen = await leerXlsx(bytes, { hoja: "Resumen Mensual" });
const p = parsearControlSemanal(detalle, resumen);
console.log(`Trabajadores: ${p.trabajadores.length} · registros: ${p.registros.length} · descartadas post-reporte: ${p.descartadas}`);
console.log(`Filas reportadas por el parser: ${p.reportadas.length} · errores: ${p.errores.length}`);
console.log(`Contraste del resumen mensual: ${p.contrasteResumen.length === 0 ? "coincide en todos" : "DIFIERE"}`);
for (const d of (p.contrasteResumen ?? []).slice(0, 10)) console.log("  resumen:", JSON.stringify(d));

const esc = (x) => JSON.stringify(x).replaceAll("'", "''");
const r = await fetch("https://api.supabase.com/v1/projects/mzpbdkrmokfxrrsotfgs/database/query", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query:
    `select previsualizar_control('${esc(p.registros)}'::jsonb, '${esc(p.trabajadores)}'::jsonb, 'previa-control') as r` }),
});
const cuerpo = await r.text();
let res;
try { res = JSON.parse(cuerpo)?.[0]?.r; } catch { console.error("Respuesta cruda:", cuerpo.slice(0, 1200)); process.exit(1); }
if (!res) { console.error("Sin resumen:", cuerpo.slice(0, 1200)); process.exit(1); }

console.log("\n=== VISTA PREVIA (nada se escribió) ===");
console.log(`Rango: ${res.desde} → ${res.hasta} · ${res.trabajadores} trabajadores resueltos · ${res.filas} filas`);
console.log("Por empresa:", JSON.stringify(res.porEmpresa));
console.log(`Excepciones (${(res.excepciones ?? []).length}):`);
for (const e of res.excepciones ?? []) console.log("  ·", e.documento, e.nombre, "—", e.motivo);
console.log(`Horas de entrada pobladas: ${(res.horasPobladas ?? []).length} · discrepantes: ${(res.discrepanciasHora ?? []).length} · sin hora: ${(res.sinHora ?? []).length}`);
for (const d of res.discrepanciasHora ?? []) console.log("  hora:", JSON.stringify(d));
console.log(`Diferencias declarado vs recalculado: ${(res.diferencias ?? []).length}`);
for (const d of (res.diferencias ?? []).slice(0, 15)) console.log("  dif:", JSON.stringify(d));
