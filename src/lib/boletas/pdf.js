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

const TOLERANCIA_Y = 2; // unidades PDF: ítems de una misma línea visual pueden
// diferir en fracciones (ej. 300.49 vs 300.51) por redondeo del generador.

// Agrupa ítems de texto (con posición {x, y} y contenido {s}) en líneas,
// tolerando pequeñas variaciones de Y en vez de exigir igualdad exacta.
// Ordena por Y descendente (arriba hacia abajo) y agrupa consecutivos cuya Y
// no se aleje más de TOLERANCIA_Y del ancla del grupo (la Y del primer ítem
// del grupo, fija — no una media móvil, para no arrastrar el grupo). Dentro
// de cada línea, ordena por X ascendente (izquierda a derecha).
export function agruparLineas(items) {
  const ordenados = [...items].sort((a, b) => b.y - a.y);
  const grupos = [];
  let grupoActual = null;
  let ancla = null;
  for (const item of ordenados) {
    if (grupoActual !== null && Math.abs(item.y - ancla) <= TOLERANCIA_Y) {
      grupoActual.push(item);
    } else {
      grupoActual = [item];
      grupos.push(grupoActual);
      ancla = item.y;
    }
  }
  return grupos.map((grupo) =>
    [...grupo].sort((a, b) => a.x - b.x).map((i) => i.s).join(" ")
  );
}

export async function extraerPaginas(bytes) {
  const pdfjs = await cargarPdfjs();
  // pdfjs toma posesión del ArrayBuffer y lo detacha: sin la copia, el
  // caller (Boletas.jsx, scripts/verificar-e2e-produccion.mjs) se queda con
  // un buffer vacío si reusa `bytes` después de llamar extraerPaginas().
  const opciones = { data: bytes.slice(), useSystemFonts: true };
  if (!esNavegador) opciones.disableWorker = true; // Node: sin worker thread
  const doc = await pdfjs.getDocument(opciones).promise;
  try {
    const paginas = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const pagina = await doc.getPage(n);
      try {
        const contenido = await pagina.getTextContent();
        const items = contenido.items.map((item) => ({
          x: item.transform[4],
          y: item.transform[5],
          s: item.str,
        }));
        paginas.push(agruparLineas(items).join("\n"));
      } finally {
        pagina.cleanup();
      }
    }
    return paginas;
  } finally {
    await doc.destroy();
  }
}
