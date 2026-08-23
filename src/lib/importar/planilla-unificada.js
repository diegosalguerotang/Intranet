// Parser del padrón de planilla UNIFICADA (#10, spec 2026-08-21): un .xlsx
// limpio con varias razones sociales (resueltas por RUC, jamás por el texto),
// documentos como TEXTO con ceros conservados y cuenta bancaria SIEMPRE texto.
// Patrón de los importadores del proyecto (planilla.js/activos.js): puro y
// síncrono sobre las filas de leerXlsx; el período sale del NOMBRE de la hoja.
import { resolverBanco } from "./bancos.js";

// Encabezados exactos del formato (12 columnas A:L). Si no están todos, el
// archivo NO es este formato: se dice y se detiene (convive con PLATRA1).
const ENCABEZADOS = [
  "EMPRESA", "RUC", "CONTRATO", "CÓDIGO", "NOMBRE COMPLETO", "TIPO DE DOCUMENTO",
  "NRO DE DOCUMENTO", "CENTRO DE COSTO", "SEDE", "FECHA DE INGRESO", "BANCO", "NRO DE CUENTA",
];

const limpiar = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

// Comparación de documentos contra el maestro: quitar ceros a la IZQUIERDA en
// ambos lados (la forma canónica es la del maestro). Jamás rellenar a
// longitud fija: rompería el CE 003308122. Mayúsculas por los alfanuméricos.
export const sinCerosDoc = (doc) => limpiar(doc).toUpperCase().replace(/^0+(?=.)/, "");

const MESES = { ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, SEP: 9, OCT: 10, NOV: 11, DIC: 12 };

// «OFICINA JUL 2026» → '2026-07'. Si no se puede interpretar, null (la
// pantalla lo pedirá; nunca se deduce del nombre del ARCHIVO).
export function periodoDeHoja(nombre) {
  const m = limpiar(nombre).toUpperCase().match(/\b(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SET|SEP|OCT|NOV|DIC)[A-ZÁÉÍÓÚ]*\s+(\d{4})\b/);
  if (!m) return null;
  return `${m[2]}-${String(MESES[m[1]]).padStart(2, "0")}`;
}

// Centro de costo (truncado a 18 en el origen): primer token = código
// (llave); el resto = descripción cortada. En PROMANT el código viene
// repetido («1501 1501 G. ADM-C») → se dedupe.
function partirCentroCosto(texto) {
  const partes = limpiar(texto).split(" ").filter(Boolean);
  if (partes.length === 0) return { codigo: null, desc: null };
  const [codigo, ...resto] = partes;
  if (resto[0] === codigo) resto.shift();
  return { codigo, desc: resto.join(" ") || null };
}

const TIPOS_DOC = { DNI: /^[0-9]{8}$/, CE: /^[0-9A-Z]{9,12}$/, PASAPORTE: /^[0-9A-Z]{6,15}$/ };

export function parsearPlanillaUnificada(filas, { hoja } = {}) {
  const encabezado = (filas?.[0] ?? []).map(limpiar).map((s) => s.toUpperCase());
  const faltantes = ENCABEZADOS.filter((e) => !encabezado.includes(e));
  if (faltantes.length > 0) {
    throw new Error(
      `El archivo no es el formato de planilla unificada: faltan las columnas ${faltantes.join(", ")}. ` +
      "Si es un reporte PLATRA1, usa la importación de planilla normal.");
  }
  const col = Object.fromEntries(ENCABEZADOS.map((e) => [e, encabezado.indexOf(e)]));

  const resultado = [];
  const errores = [];
  const vistos = new Map(); // ruc → Set de documentos sin ceros (duplicado misma RS = error)

  filas.slice(1).forEach((cruda, i) => {
    const linea = i + 2; // fila visible en el Excel
    const c = (nombre) => limpiar(cruda[col[nombre]]);
    if (ENCABEZADOS.every((e) => c(e) === "")) return; // fila totalmente vacía

    const denominacion = c("EMPRESA");
    const ruc = c("RUC");
    const codigo = c("CÓDIGO");
    const nombre = c("NOMBRE COMPLETO");
    const tipoDoc = c("TIPO DE DOCUMENTO").toUpperCase() === "CE" ? "CE"
      : c("TIPO DE DOCUMENTO").toUpperCase().startsWith("PAS") ? "Pasaporte" : "DNI";
    const documento = c("NRO DE DOCUMENTO").toUpperCase();
    const bancoTexto = c("BANCO");
    const cuenta = c("NRO DE CUENTA");
    const advertencias = [];

    if (!/^[0-9]{11}$/.test(ruc)) {
      errores.push(`Fila ${linea}: el RUC «${ruc}» no tiene 11 dígitos.`); return;
    }
    if (!nombre) { errores.push(`Fila ${linea}: sin nombre.`); return; }
    const reglaDoc = TIPOS_DOC[tipoDoc.toUpperCase()] ?? TIPOS_DOC.DNI;
    if (!reglaDoc.test(documento)) {
      errores.push(`Fila ${linea}: el documento «${documento}» no es válido para el tipo ${tipoDoc}.`); return;
    }
    if (codigo !== documento) {
      // Son campos distintos que HOY coinciden: si difieren, excepción a mano.
      errores.push(`Fila ${linea} (${nombre}): el CÓDIGO «${codigo}» difiere del documento «${documento}» — revísalo a mano.`);
      return;
    }
    const banco = resolverBanco(bancoTexto);
    if (!banco) {
      errores.push(`Fila ${linea} (${nombre}): el banco «${bancoTexto}» no está en el catálogo — nada se guarda como texto libre.`);
      return;
    }
    if (!cuenta) { errores.push(`Fila ${linea} (${nombre}): sin número de cuenta.`); return; }
    if (banco.codigo === "bcp" && cuenta.length === 20) {
      advertencias.push("Cuenta BCP de 20 dígitos (posible CCI): se importa igual, verifica con el banco.");
    }

    // Duplicado con la MISMA razón social = excepción bloqueante de la fila;
    // con empresas distintas es válido (dos vínculos).
    const clave = sinCerosDoc(documento);
    if (!vistos.has(ruc)) vistos.set(ruc, new Set());
    if (vistos.get(ruc).has(clave)) {
      errores.push(`Fila ${linea} (${nombre}): el documento ${documento} está repetido dentro de la misma razón social.`);
      return;
    }
    vistos.get(ruc).add(clave);

    const cc = partirCentroCosto(c("CENTRO DE COSTO"));
    resultado.push({
      ruc, denominacion,
      contrato: c("CONTRATO") || null,
      codigo, nombre, tipoDoc, documento,
      centroCostoCodigo: cc.codigo, centroCostoDesc: cc.desc,
      sede: c("SEDE") || null,
      fechaIngreso: c("FECHA DE INGRESO") || null,
      bancoCodigo: banco.codigo, bancoNombre: banco.nombre,
      cuenta, cuentaLongitud: cuenta.length,
      advertencias,
    });
  });

  const porRuc = new Map();
  for (const f of resultado) {
    if (!porRuc.has(f.ruc)) porRuc.set(f.ruc, { ruc: f.ruc, denominacion: f.denominacion, filas: 0 });
    porRuc.get(f.ruc).filas += 1;
  }

  return {
    periodo: periodoDeHoja(hoja),
    hoja: hoja ?? null,
    empresas: [...porRuc.values()],
    filas: resultado,
    errores,
  };
}
