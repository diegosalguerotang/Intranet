// scripts/verificar-e2e-produccion.mjs — E2E real contra producción, por el
// MISMO canal que usa el navegador: TODO vía /api/supa/... (el proxy
// api/supa.js inyecta la apikey publishable y traduce la cabecera x-sesion en
// el Authorization real — ver src/lib/supabase.js, que usa exactamente esa
// base URL en el navegador). Este script NO habla directo con
// mzpbdkrmokfxrrsotfgs.supabase.co en ningún punto: ni para login, ni para
// REST/RPC, ni para Storage, ni para la descarga de verificación final.
//
// Sustituye al recorrido con la extensión de Chrome (no disponible en esta
// sesión) para el Paso 3 de Task 15: importar LISTA_PAIS.xlsx real y cargar
// BOLETAS.pdf real contra la empresa real (lamericana), con los parsers
// reales (los mismos módulos que usa la UI: src/lib/importar,
// src/lib/boletas), y publicar de verdad.
//
// OJO — NO BORRA NADA. Los 9 trabajadores de LISTA_PAIS.xlsx y sus 9 boletas
// de junio 2026 son el caso real: importarlos y publicarlos es el objetivo,
// no un efecto secundario a limpiar. Es re-ejecutable sin duplicar: la
// idempotencia la garantizan importar_planilla (sin_cambio si nada cambió) y
// publicar_lote_pdf (misma clave natural empresa+tipo+periodo → nueva
// versión, nunca fila repetida; mismo hash de archivo → mismo objeto en
// Storage vía x-upsert).
//
// env: SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD_INICIAL
// uso: $env:SUPERADMIN_EMAIL=...; $env:SUPERADMIN_PASSWORD_INICIAL=...
//      node scripts/verificar-e2e-produccion.mjs
import { readFileSync } from "node:fs";
import { leerXlsx } from "../src/lib/importar/xlsx.js";
import { parsearPlanilla } from "../src/lib/importar/planilla.js";
import { extraerPaginas } from "../src/lib/boletas/pdf.js";
import { analizarLote } from "../src/lib/boletas/lote.js";
import { dividirPdf, sha256Hex } from "../src/lib/boletas/dividir.js";

const APP = "https://intranet-general.vercel.app";
const EMPRESA = "lamericana";
const TIPO = "Boleta de pago";
const PERIODO = "2026-06";
const POR = "E2E producción";

const { SUPERADMIN_EMAIL: EMAIL, SUPERADMIN_PASSWORD_INICIAL: CLAVE } = process.env;
if (!EMAIL || !CLAVE) {
  console.error("Faltan SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD_INICIAL.");
  process.exit(1);
}

let fallos = 0;
const caso = (nombre, ok, detalle) => {
  console.log(`${ok ? "✔" : "✘"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  if (!ok) fallos++;
  return ok;
};
const detener = (motivo) => {
  console.error(`\nDETENIDO: ${motivo}`);
  console.log(fallos ? `\n${fallos} caso(s) fallaron.` : "\n1 caso(s) fallaron.");
  process.exit(1);
};
const json = async (r) => {
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { crudo: t }; }
};

// Todo pasa por /api/supa/<ruta>: mismo origen y mismo proxy que el
// navegador. x-sesion es la cabecera que api/supa.js convierte en
// `Authorization: Bearer <jwt>` real; la apikey la inyecta el proxio mismo.
async function supa(ruta, { method = "GET", headers = {}, body, sesion } = {}) {
  const cab = { ...headers };
  if (sesion) cab["x-sesion"] = sesion;
  return fetch(`${APP}/api/supa/${ruta}`, { method, headers: cab, body });
}
async function rpc(nombre, args, sesion) {
  const r = await supa(`rest/v1/rpc/${nombre}`, {
    method: "POST", sesion, headers: { "content-type": "application/json" }, body: JSON.stringify(args),
  });
  const cuerpo = await json(r);
  return { ok: r.ok, status: r.status, cuerpo };
}

// --- 1) Login real del superadmin, por el proxy -----------------------------
console.log("1 · Login del superadmin (vía /api/supa, mismo canal que el navegador)\n");
const loginR = await supa("auth/v1/token?grant_type=password", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: CLAVE }),
});
const sesionLogin = await json(loginR);
if (!caso("login del superadmin obtiene JWT real (vía proxy)", loginR.ok && !!sesionLogin.access_token,
  loginR.ok ? undefined : `HTTP ${loginR.status} ${JSON.stringify(sesionLogin)}`)) {
  detener("sin JWT no se puede continuar.");
}
const TOKEN = sesionLogin.access_token;

// --- 2) Importación de personal — LISTA_PAIS.xlsx ---------------------------
console.log("\n2 · Importación de personal — LISTA_PAIS.xlsx\n");
const filasXlsx = await leerXlsx(new Uint8Array(readFileSync("tests/fixtures/LISTA_PAIS.xlsx")));
const excel = parsearPlanilla(filasXlsx);
caso("LISTA_PAIS.xlsx parsea 9 filas sin errores", excel.errores.length === 0 && excel.filas.length === 9,
  `filas=${excel.filas.length} errores=${JSON.stringify(excel.errores)}`);

const previa = await rpc("previsualizar_importacion", { p_empresa: EMPRESA, p_filas: excel.filas }, TOKEN);
caso("previsualizar_importacion (vía proxy) responde OK", previa.ok,
  previa.ok ? undefined : `HTTP ${previa.status} ${JSON.stringify(previa.cuerpo)}`);

const importado = await rpc("importar_planilla", { p_empresa: EMPRESA, p_filas: excel.filas, p_por: POR }, TOKEN);
const r1 = importado.cuerpo ?? {};
const total1 = (r1.altas?.length ?? 0) + (r1.actualizaciones?.length ?? 0) + (r1.sin_cambio?.length ?? 0);
caso("importar_planilla (vía proxy): altas + actualizaciones + sin_cambio = 9", importado.ok && total1 === 9,
  importado.ok
    ? `altas=${r1.altas?.length ?? 0} actualizaciones=${r1.actualizaciones?.length ?? 0} sin_cambio=${r1.sin_cambio?.length ?? 0} nombresPorConfirmar=${r1.nombres_por_confirmar ?? 0}`
    : `HTTP ${importado.status} ${JSON.stringify(importado.cuerpo)}`);

const reimportado = await rpc("importar_planilla", { p_empresa: EMPRESA, p_filas: excel.filas, p_por: POR }, TOKEN);
const r2 = reimportado.cuerpo ?? {};
caso("reimportar de inmediato: los 9 quedan sin_cambio (idempotencia)",
  reimportado.ok && (r2.sin_cambio?.length ?? 0) === 9 && (r2.altas?.length ?? 0) === 0 && (r2.actualizaciones?.length ?? 0) === 0,
  reimportado.ok
    ? `altas=${r2.altas?.length ?? 0} actualizaciones=${r2.actualizaciones?.length ?? 0} sin_cambio=${r2.sin_cambio?.length ?? 0}`
    : `HTTP ${reimportado.status} ${JSON.stringify(reimportado.cuerpo)}`);

const personaR = await supa("rest/v1/personas?dni=eq.09113655&select=dni", { sesion: TOKEN });
const persona = await json(personaR);
caso("DNI 09113655 existe (vía proxy) y conserva el cero inicial", personaR.ok && persona[0]?.dni === "09113655",
  personaR.ok ? JSON.stringify(persona) : `HTTP ${personaR.status} ${JSON.stringify(persona)}`);

// --- 3) Carga de boletas — BOLETAS.pdf --------------------------------------
console.log("\n3 · Carga de boletas — BOLETAS.pdf\n");
const bytesPdf = new Uint8Array(readFileSync("tests/fixtures/BOLETAS.pdf"));
const paginas = await extraerPaginas(bytesPdf);
const lote = analizarLote(paginas);
if (!caso("BOLETAS.pdf: 9 boletas, 0 excepciones", lote.boletas.length === 9 && lote.excepciones.length === 0,
  `boletas=${lote.boletas.length} excepciones=${JSON.stringify(lote.excepciones)}`)) {
  detener("hay excepciones sin resolver: no se publica nada sin trabajador identificado.");
}

const grupos = lote.boletas.map((b) => b.paginas);
const partes = await dividirPdf(bytesPdf, grupos);
const boletasConHash = [];
for (let i = 0; i < lote.boletas.length; i++) {
  const b = lote.boletas[i];
  const hash = await sha256Hex(partes[i]);
  const ruta = `lotes/${EMPRESA}/${PERIODO}/${hash}.pdf`;
  const up = await supa(`storage/v1/object/documentos/${ruta}`, {
    method: "POST", sesion: TOKEN,
    headers: { "content-type": "application/pdf", "x-upsert": "true" },
    body: partes[i],
  });
  const okSubida = caso(`sube boleta No ${b.correlativo} (DNI ${b.dni}) a Storage vía proxy`, up.ok,
    up.ok ? undefined : `HTTP ${up.status} ${await up.text()}`);
  if (!okSubida) detener(`la subida de la boleta No ${b.correlativo} falló: no se puede publicar el lote a medias.`);
  boletasConHash.push({
    dni: b.dni, correlativo: b.correlativo, nombre: b.nombre, cargo: b.cargo, sede: b.sede,
    centroCosto: b.centroCosto, ingreso: b.ingreso, neto: b.neto, hash,
    // URL pública SERVIDA POR EL MISMO PROXY (idéntica a supabase.storage.getPublicUrl()
    // en el navegador, que usa /api/supa como baseUrl — ver src/lib/supabase.js).
    archivo_url: `${APP}/api/supa/storage/v1/object/public/documentos/${ruta}`,
  });
}

const publicado = await rpc("publicar_lote_pdf",
  { p_empresa: EMPRESA, p_tipo: TIPO, p_periodo: PERIODO, p_por: POR, p_boletas: boletasConHash }, TOKEN);
const rp = publicado.cuerpo ?? {};
caso("publicar_lote_pdf (vía proxy): lote publicado con 9 documentos", publicado.ok && rp.documentos === 9,
  publicado.ok ? `lote_id=${rp.lote_id} version=${rp.version} documentos=${rp.documentos}`
    : `HTTP ${publicado.status} ${JSON.stringify(publicado.cuerpo)}`);

const b1 = boletasConHash.find((b) => b.correlativo === 1);
const descarga = await fetch(b1.archivo_url); // pública: no necesita x-sesion, pero sigue siendo /api/supa
const bajado = new Uint8Array(await descarga.arrayBuffer());
const hashBajado = descarga.ok ? await sha256Hex(bajado) : null;
caso("el archivo público de la boleta No 1 (vía proxy) tiene el mismo SHA-256 enviado",
  descarga.ok && hashBajado === b1.hash,
  descarga.ok ? `enviado=${b1.hash.slice(0, 12)}… bajado=${hashBajado?.slice(0, 12)}…` : `HTTP ${descarga.status}`);

// --- 4) Resumen para Diego ----------------------------------------------------
console.log("\n4 · Resumen\n");
const vinculosEmpresaR = await supa(`rest/v1/vinculos?empresa_id=eq.${EMPRESA}&select=persona_dni`, { sesion: TOKEN });
const vinculosEmpresa = await json(vinculosEmpresaR);
const dnisEmpresa = [...new Set((vinculosEmpresa ?? []).map((v) => v.persona_dni))];
let porConfirmar = null;
if (dnisEmpresa.length) {
  const lista = dnisEmpresa.map((d) => `"${d}"`).join(",");
  const pcR = await supa(
    `rest/v1/personas?dni=in.(${lista})&nombre_por_confirmar=eq.true&select=dni`, { sesion: TOKEN });
  const pc = await json(pcR);
  porConfirmar = pcR.ok ? pc.length : null;
}

console.log(`Personas importadas de LISTA_PAIS.xlsx: 9 (altas=${r1.altas?.length ?? "?"} en la primera corrida)`);
console.log(`Lote publicado: id=${rp.lote_id ?? "?"} versión=${rp.version ?? "?"} documentos=${rp.documentos ?? "?"}`);
console.log(`Personas con vínculo en ${EMPRESA}: ${dnisEmpresa.length}`);
console.log(`De esas, con "nombre por confirmar": ${porConfirmar ?? "no se pudo calcular"}`);

console.log(fallos ? `\n${fallos} caso(s) fallaron.` : "\nTodos los casos pasaron.");
process.exit(fallos ? 1 : 0);
