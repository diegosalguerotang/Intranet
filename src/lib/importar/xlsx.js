// src/lib/importar/xlsx.js — lector mínimo de .xlsx (ZIP + XML), sin dependencias.
// El archivo real es un reporte de texto plano de 10 columnas: no se necesita
// una librería de hoja de cálculo completa.

async function inflar(datos, metodo) {
  if (metodo === 0) return datos; // almacenado sin comprimir
  const ds = new DecompressionStream("deflate-raw");
  const salida = new Response(new Blob([datos]).stream().pipeThrough(ds));
  return new Uint8Array(await salida.arrayBuffer());
}

function leerEntradasZip(bytes) {
  // Fin del directorio central (EOCD): firma 0x06054b50, buscada desde el final.
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("El archivo no es un .xlsx válido (sin directorio ZIP).");
  const total = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entradas = new Map();
  for (let n = 0; n < total; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Directorio ZIP corrupto.");
    const metodo = dv.getUint16(p + 10, true);
    const tamComp = dv.getUint32(p + 20, true);
    const largoNombre = dv.getUint16(p + 28, true);
    const largoExtra = dv.getUint16(p + 30, true);
    const largoComent = dv.getUint16(p + 32, true);
    const offsetLocal = dv.getUint32(p + 42, true);
    const nombre = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + largoNombre));
    entradas.set(nombre, { metodo, tamComp, offsetLocal });
    p += 46 + largoNombre + largoExtra + largoComent;
  }
  return { dv, entradas };
}

async function extraer(bytes, dv, entrada) {
  const p = entrada.offsetLocal;
  const largoNombre = dv.getUint16(p + 26, true);
  const largoExtra = dv.getUint16(p + 28, true);
  const inicio = p + 30 + largoNombre + largoExtra;
  return inflar(bytes.subarray(inicio, inicio + entrada.tamComp), entrada.metodo);
}

const decodificarXml = (s) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
   .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
   .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
   .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

const colAIndice = (ref) => {
  let n = 0;
  for (const ch of ref) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

export async function leerXlsx(bytes) {
  const { dv, entradas } = leerEntradasZip(bytes);
  const texto = async (nombre) =>
    entradas.has(nombre) ? new TextDecoder().decode(await extraer(bytes, dv, entradas.get(nombre))) : "";

  const compartidas = [...(await texto("xl/sharedStrings.xml")).matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => decodificarXml(m[1].replace(/<[^>]+>/g, "")));

  const hoja = await texto("xl/worksheets/sheet1.xml");
  if (!hoja) throw new Error("El .xlsx no contiene la hoja esperada (xl/worksheets/sheet1.xml).");

  // Se indexa por el atributo r="N" de <row> (posición real de la fila en la hoja):
  // una fila vacía puede venir self-closing (<row r="N"/>, sin cuerpo) y no debe
  // desplazar a las filas siguientes.
  const filasPorIndice = [];
  let maxIndice = -1;
  for (const m of hoja.matchAll(/<row([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowAttrs = m[1];
    const cuerpo = m[2] ?? "";
    const numFila = Number((rowAttrs.match(/r="(\d+)"/) || [])[1]);
    const indice = Number.isFinite(numFila) && numFila > 0 ? numFila - 1 : maxIndice + 1;
    const fila = [];
    for (const c of cuerpo.matchAll(/<c ([^>]*?)\/?>(?:<v>([^<]*)<\/v>)?(?:<\/c>)?/g)) {
      const attrs = c[1];
      const ref = (attrs.match(/r="([A-Z]+)\d+"/) || [])[1];
      const hayValor = c[2] != null;
      let valor;
      if (/t="s"/.test(attrs)) valor = hayValor ? (compartidas[Number(c[2])] ?? "") : "";
      else valor = hayValor ? decodificarXml(c[2]) : "";
      if (ref) fila[colAIndice(ref)] = String(valor);
    }
    filasPorIndice[indice] = Array.from(fila, (v) => v ?? "");
    if (indice > maxIndice) maxIndice = indice;
  }
  const filas = [];
  for (let i = 0; i <= maxIndice; i++) filas.push(filasPorIndice[i] ?? []);
  return filas;
}
