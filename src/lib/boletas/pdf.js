// src/lib/boletas/pdf.js — extracción de texto por página. Sin OCR: la
// planilla genera PDFs con capa de texto (confirmado con la muestra real).
const esNavegador = typeof window !== "undefined";

async function cargarPdfjs() {
  if (esNavegador) {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc =
      new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    return pdfjs;
  }
  return import("pdfjs-dist/legacy/build/pdf.mjs"); // Node (tests), sin worker
}

export async function extraerPaginas(bytes) {
  const pdfjs = await cargarPdfjs();
  const opciones = { data: bytes, useSystemFonts: true };
  if (!esNavegador) opciones.disableWorker = true; // Node: sin worker thread
  const doc = await pdfjs.getDocument(opciones).promise;
  const paginas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pagina = await doc.getPage(n);
    const contenido = await pagina.getTextContent();
    // Reagrupar por coordenada Y para conservar las líneas del reporte.
    const lineas = new Map();
    for (const item of contenido.items) {
      const y = Math.round(item.transform[5]);
      if (!lineas.has(y)) lineas.set(y, []);
      lineas.get(y).push({ x: item.transform[4], s: item.str });
    }
    const texto = [...lineas.entries()].sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.x - b.x).map((i) => i.s).join(" "))
      .join("\n");
    paginas.push(texto);
  }
  await doc.destroy();
  return paginas;
}
