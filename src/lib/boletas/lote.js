// src/lib/boletas/lote.js — separación e identificación de boletas dentro del
// PDF consolidado. El DNI de «Documento : DNI» es el identificador
// AUTORITATIVO; el CODIGO solo se coteja. Nada se descarta solo: toda
// anomalía es una excepción que se resuelve a mano antes de publicar.
//
// El texto viene de pdfjs reagrupado por posición X/Y (Task 9): el espaciado
// entre tokens es irregular por kerning/justificación del PDF original (ver
// task-9-report.md), así que todas las regex usan \s+ liberal y no asumen un
// único espacio. Tampoco asumen que una "palabra" queda pegada: el mes de
// "PERIODO DE PAGO" puede llegar partido en dos ("J UNIO") por ese mismo
// reagrupado.
import { normalizar } from "../importar/planilla.js";

const MESES = { ENERO: "01", FEBRERO: "02", MARZO: "03", ABRIL: "04", MAYO: "05",
  JUNIO: "06", JULIO: "07", AGOSTO: "08", SETIEMBRE: "09", SEPTIEMBRE: "09",
  OCTUBRE: "10", NOVIEMBRE: "11", DICIEMBRE: "12" };

// "JUNIO-2026" → "2026-06". Insensible a acentos/mayúsculas (vía normalizar)
// y también al kerning irregular que puede partir el mes con un espacio
// espurio (ej. "J UNIO - 2026", visto en el fixture real): se elimina TODO
// el whitespace antes de separar mes y año, en vez de intentar tolerarlo con
// una clase de caracteres en el regex.
export function normalizarPeriodo(mesAaaa) {
  const compacto = normalizar(mesAaaa).replace(/\s+/g, "");
  const m = compacto.match(/^([A-Z]+)-(\d{4})$/);
  if (!m || !MESES[m[1]]) return null;
  return `${m[2]}-${MESES[m[1]]}`;
}

const buscar = (texto, re) => (texto.match(re) || [, null])[1];
const limpiar = (s) => (s ?? "").replace(/\s+/g, " ").trim() || null;

function parsearPagina(texto) {
  // Ancla de boleta: "... BOLETA DE PAGO JUNIO - 2026   No 1". El mes puede
  // venir con espacios internos espurios (kerning); normalizarPeriodo los
  // quita, así que aquí basta con no cortar la captura antes de tiempo.
  const cabecera = buscar(texto, /BOLETA DE PAGO\s+([A-ZÁÉÍÓÚÑ\s]+?-\s*\d{4})/i);
  if (!cabecera) return null; // página de continuación (o vacía, filtrada antes)

  const ing = buscar(texto, /Fec\.?\s*Ing\.?\s*:?\s*(\d{2}\/\d{2}\/\d{2})/i);
  let ingreso = null;
  if (ing) {
    const [d, m, aa] = ing.split("/");
    ingreso = `${Number(aa) <= 50 ? 2000 + Number(aa) : 1900 + Number(aa)}-${m}-${d}`;
  }
  const neto = buscar(texto, /Neto a pagar\s*:?\s*S\/\.?\s*([\d,]+\.\d{2})/i);
  return {
    periodoCabecera: normalizarPeriodo(cabecera),
    correlativo: Number(buscar(texto, /\bNo\.?\s+(\d+)\b/)),
    ruc: buscar(texto, /RUC\s*:?\s*(\d{11})/i),
    codigo: (buscar(texto, /CODIGO\s*:?\s*(\d+)/i) || "").trim() || null,
    periodoPago: normalizarPeriodo(
      buscar(texto, /PERIODO DE PAGO\s*:?\s*([A-ZÁÉÍÓÚÑ\s]+?-\s*\d{4})/i) || ""
    ),
    dni: buscar(texto, /Documento\s*:?\s*DNI\s*(\d{8})/i),
    ingreso,
    nombre: limpiar(buscar(texto, /Apellidos y Nombres\s*:?\s*(.+?)(?=\s*C\.?\s*Costo|$)/is)),
    // "C.Costo:1600 MIDIS   -   PAIS" es el resto de la línea (sin otro
    // campo detrás en el layout real): basta con cortar en el salto de línea.
    centroCosto: limpiar(buscar(texto, /C\.?\s*Costo\s*:?\s*(\d+\s+[^\n]*)/i)),
    // "Unid.Servicios: SEDE CENTRAL   Hor. Ord. : 240.00   ..." — a
    // diferencia de C.Costo, aquí SÍ hay más campos en la misma línea, así
    // que hace falta el lookahead a "Hor. Ord." para no tragárselos.
    sede: limpiar(buscar(texto, /Unid\.?\s*Servicios?\s*:?\s*(.+?)(?=\s*Hor\.?\s*Ord|\n|$)/i)),
    // Igual que sede: "Cargo   : OPERARIO(A) DE LIMPI   Dias Efec.: 30.00 ..."
    // tiene más campos detrás en la misma línea; se corta antes de "Dias Efec".
    cargo: limpiar(buscar(texto, /Cargo\s*:?\s*(.+?)(?=\s*Dias\s*Efec|\n|$)/i)),
    neto: neto ? Number(neto.replace(/,/g, "")) : null,
  };
}

export function analizarLote(paginas) {
  const boletas = [];
  const excepciones = [];
  paginas.forEach((texto, i) => {
    // Página vacía o de puro whitespace (ej. la página de cierre del lote,
    // confirmada en Task 9): no es continuación de la boleta anterior ni
    // excepción, se descarta en silencio.
    if (!texto || !texto.trim()) return;

    const datos = parsearPagina(texto);
    if (!datos) {
      // Página sin ancla pero CON texto: continuación de la boleta anterior.
      if (boletas.length) boletas[boletas.length - 1].paginas.push(i);
      else excepciones.push({ tipo: "sin_dni", pagina: i + 1, detalle: "La primera página no tiene el ancla BOLETA DE PAGO." });
      return;
    }
    boletas.push({ ...datos, paginas: [i] });
  });

  // RUC y periodo del lote: el valor mayoritario; las páginas que difieren son excepción.
  const moda = (valores) => {
    const conteo = new Map();
    valores.filter(Boolean).forEach((v) => conteo.set(v, (conteo.get(v) ?? 0) + 1));
    return [...conteo.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const ruc = moda(boletas.map((b) => b.ruc));
  const periodo = moda(boletas.map((b) => b.periodoPago ?? b.periodoCabecera));

  boletas.forEach((b) => {
    const pag = b.paginas[0] + 1;
    if (!b.dni) excepciones.push({ tipo: "sin_dni", pagina: pag, detalle: "Página sin DNI legible." });
    else if (b.codigo && b.codigo.padStart(8, "0") !== b.dni)
      excepciones.push({ tipo: "codigo_distinto", pagina: pag,
        detalle: `CODIGO ${b.codigo} ≠ Documento DNI ${b.dni}: resolver manualmente, no se elige solo.` });
    if (b.ruc && b.ruc !== ruc)
      excepciones.push({ tipo: "ruc_distinto", pagina: pag, detalle: `RUC ${b.ruc} distinto al del lote (${ruc}).` });
    const p = b.periodoPago ?? b.periodoCabecera;
    if (p && p !== periodo)
      excepciones.push({ tipo: "periodo_distinto", pagina: pag, detalle: `Periodo ${p} distinto al del lote (${periodo}).` });
  });

  // Correlativo 1..N sin saltos = ninguna página perdida (excepción del LOTE).
  const correlativos = boletas.map((b) => b.correlativo).filter((n) => Number.isFinite(n));
  const max = Math.max(0, ...correlativos);
  for (let n = 1; n <= max; n++) {
    if (!correlativos.includes(n))
      excepciones.push({ tipo: "salto_correlativo", pagina: null,
        detalle: `Falta el correlativo No ${n}: se perdió una página del lote.` });
  }

  // DNI repetido sin ser continuación (las continuaciones ya se fusionaron arriba).
  const vistos = new Map();
  boletas.forEach((b) => {
    if (!b.dni) return;
    if (vistos.has(b.dni))
      excepciones.push({ tipo: "dni_repetido", pagina: b.paginas[0] + 1,
        detalle: `El DNI ${b.dni} ya apareció en el correlativo No ${vistos.get(b.dni)}.` });
    else vistos.set(b.dni, b.correlativo);
  });

  return { lote: { ruc, periodo, mesTexto: null }, boletas, excepciones };
}
