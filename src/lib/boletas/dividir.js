// src/lib/boletas/dividir.js — cada boleta se entrega como SU PDF: las
// páginas exactas del consolidado, sin recomprimir. El hash identifica el
// archivo exacto entregado (huella del acuse).
import { PDFDocument } from "pdf-lib";

export async function dividirPdf(bytes, grupos) {
  const origen = await PDFDocument.load(bytes);
  const partes = [];
  for (const paginas of grupos) {
    const destino = await PDFDocument.create();
    const copiadas = await destino.copyPages(origen, paginas);
    copiadas.forEach((p) => destino.addPage(p));
    partes.push(await destino.save());
  }
  return partes;
}

export async function sha256Hex(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
