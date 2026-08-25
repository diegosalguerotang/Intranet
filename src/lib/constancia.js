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
