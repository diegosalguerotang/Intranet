// src/lib/constancia.js — PDF de la constancia de entrega (RRH-12), generado
// EN EL NAVEGADOR con pdf-lib desde el registro inmutable del acuse: todos los
// campos llegan ya armados desde la pantalla, aquí nada se recalcula ni se
// consulta. El mismo módulo corre en node para la suite vitest.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const A4 = [595.28, 841.89];
const MARGEN = 56;
const TINTA = rgb(0.13, 0.15, 0.18);
const GRIS = rgb(0.45, 0.47, 0.5);
const LINEA = rgb(0.85, 0.86, 0.88);

// Helvetica es WinAnsi (CP1252): cualquier carácter fuera de ese repertorio
// haría reventar encodeText, así que se sustituye por «·» antes de dibujar.
const winAnsi = (s) =>
  String(s ?? "").replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”…€]/g, "·");

// Corte por palabras al ancho dado; un token que solo no cabe (el hash de 64)
// se parte por caracteres.
function envolver(texto, fuente, cuerpo, ancho) {
  const lineas = [];
  let actual = "";
  const cabe = (s) => fuente.widthOfTextAtSize(s, cuerpo) <= ancho;
  for (const palabra of texto.split(/\s+/).filter(Boolean)) {
    let candidata = actual ? `${actual} ${palabra}` : palabra;
    if (cabe(candidata)) { actual = candidata; continue; }
    if (actual) { lineas.push(actual); actual = ""; }
    let resto = palabra;
    while (!cabe(resto)) {
      let corte = resto.length - 1;
      while (corte > 1 && !cabe(resto.slice(0, corte))) corte--;
      lineas.push(resto.slice(0, corte));
      resto = resto.slice(corte);
    }
    actual = resto;
  }
  if (actual) lineas.push(actual);
  return lineas.length ? lineas : [""];
}

// { numero, campos: [[etiqueta, valor], …], notaAsistido?, declaracion?,
//   titulo?, subtitulo? } → Uint8Array. El título se parametrizó (2026-08-25)
// para reutilizar el generador en el legajo y el expediente disciplinario.
export async function generarConstanciaPdf({
  numero, campos, notaAsistido, declaracion,
  titulo = "CONSTANCIA DE ENTREGA DE DOCUMENTO LABORAL",
  subtitulo = "Generada desde el registro inmutable de acuses",
}) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage(A4);
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const anchoUtil = A4[0] - MARGEN * 2;
  let y = A4[1] - MARGEN;

  const escribir = (texto, { fuente = normal, cuerpo = 10.5, color = TINTA, salto = 4 } = {}) => {
    for (const linea of envolver(winAnsi(texto), fuente, cuerpo, anchoUtil)) {
      y -= cuerpo;
      pagina.drawText(linea, { x: MARGEN, y, size: cuerpo, font: fuente, color });
      y -= salto;
    }
  };

  escribir(titulo, { fuente: negrita, cuerpo: 13, salto: 5 });
  escribir(`N° ${winAnsi(numero)} · ${winAnsi(subtitulo)}`, { cuerpo: 9, color: GRIS, salto: 10 });
  pagina.drawLine({ start: { x: MARGEN, y }, end: { x: A4[0] - MARGEN, y }, thickness: 0.75, color: LINEA });
  y -= 14;

  for (const [etiqueta, valor] of campos) {
    escribir(String(etiqueta ?? "").toUpperCase(), { fuente: negrita, cuerpo: 7.5, color: GRIS, salto: 2.5 });
    escribir(valor ?? "—", { salto: 9 });
  }

  if (notaAsistido) {
    y -= 6;
    escribir(notaAsistido, { cuerpo: 9.5, color: GRIS, salto: 3.5 });
  }
  if (declaracion) {
    y -= 6;
    escribir(`Declaración aceptada por el trabajador: «${declaracion}» El texto se guarda junto con el acuse, no como referencia a la plantilla.`, { cuerpo: 9.5, color: GRIS, salto: 3.5 });
  }

  pagina.drawText(winAnsi("Intranet GrupoER — documento generado sin firma manuscrita; el registro digital del acuse la sustituye."), {
    x: MARGEN, y: MARGEN - 14, size: 8, font: normal, color: GRIS,
  });
  return doc.save();
}

// Reporte de fiscalización (2026-08-26): el inspector pide un CONSOLIDADO por
// período y empresa, no clic por clic. A4 apaisado, tabla con salto de página,
// hash completo por fila. filas = [{dni, nombre, doc, publicado, notificado,
// confirmado, modalidad, hash}, …] ya formateadas — aquí nada se recalcula.
export async function generarReporteAcusesPdf({ empresa, ruc, periodo, generadoEl, filas }) {
  const APAISADO = [841.89, 595.28];
  const M = 40;
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);

  // [etiqueta, ancho, clave, fuente?]
  const COLS = [
    ["DNI / DOC.", 62, "dni", mono],
    ["TRABAJADOR", 130, "nombre"],
    ["DOCUMENTO", 120, "doc"],
    ["PUBLICADO", 64, "publicado"],
    ["NOTIFICADO", 64, "notificado"],
    ["CONFIRMADO", 64, "confirmado"],
    ["MODALIDAD", 44, "modalidad"],
    ["HASH SHA-256 DEL ARCHIVO", 214, "hash", mono],
  ];

  let pagina, y, n = 0;
  const cabecera = () => {
    pagina = doc.addPage(APAISADO);
    y = APAISADO[1] - M;
    pagina.drawText("REPORTE DE ENTREGA ELECTRÓNICA DE DOCUMENTOS LABORALES", {
      x: M, y, size: 12, font: negrita, color: TINTA,
    });
    y -= 14;
    pagina.drawText(winAnsi(`${empresa}${ruc ? ` — RUC ${ruc}` : ""} · Período: ${periodo || "todos"} · Generado: ${generadoEl} (UTC-5, América/Lima) · ${filas.length} documentos`), {
      x: M, y, size: 8, font: normal, color: GRIS,
    });
    y -= 16;
    let x = M;
    for (const [etiqueta, ancho] of COLS) {
      pagina.drawText(etiqueta, { x, y, size: 6.5, font: negrita, color: GRIS });
      x += ancho;
    }
    y -= 4;
    pagina.drawLine({ start: { x: M, y }, end: { x: APAISADO[0] - M, y }, thickness: 0.75, color: LINEA });
    y -= 11;
  };

  cabecera();
  for (const f of filas) {
    if (y < M + 24) cabecera();
    let x = M;
    for (const [, ancho, clave, fuente] of COLS) {
      const fnt = fuente ?? normal;
      const cuerpo = fnt === mono ? 5.6 : 6.8;
      let valor = winAnsi(f[clave] ?? "—");
      while (valor.length > 1 && fnt.widthOfTextAtSize(valor, cuerpo) > ancho - 5) valor = valor.slice(0, -1);
      pagina.drawText(valor, { x, y, size: cuerpo, font: fnt, color: TINTA });
      x += ancho;
    }
    y -= 11;
    if (++n % 5 === 0) {
      pagina.drawLine({ start: { x: M, y: y + 8 }, end: { x: APAISADO[0] - M, y: y + 8 }, thickness: 0.3, color: LINEA });
    }
  }

  const pie = "Generado desde el registro inmutable de acuses de la Intranet GrupoER (D.Leg. 1310, art. 3.2). " +
    "«Publicado» = puesta a disposición en el portal; «Notificado» = último aviso por correo registrado; " +
    "«Confirmado» = acuse de recepción del trabajador. Marcas de tiempo del reloj del servidor (NTP), zona UTC-5.";
  for (const p of doc.getPages()) {
    p.drawText(winAnsi(pie), { x: M, y: M - 18, size: 6.5, font: normal, color: GRIS });
  }
  return doc.save();
}

// Une varios PDFs (Uint8Array) en uno solo, en orden — una constancia por
// página para «Exportar constancias del lote» (RRH-11).
export async function unirPdfs(lista) {
  const unido = await PDFDocument.create();
  for (const bytes of lista) {
    const parte = await PDFDocument.load(bytes);
    const paginas = await unido.copyPages(parte, parte.getPageIndices());
    for (const p of paginas) unido.addPage(p);
  }
  return unido.save();
}
