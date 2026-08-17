import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { leerXlsx } from "../../src/lib/importar/xlsx.js";

const bytes = new Uint8Array(readFileSync("tests/fixtures/LISTA_PAIS.xlsx"));

// Helper local: arma un .xlsx sintético mínimo (ZIP con entradas "almacenadas",
// método 0, sin comprimir) a partir del XML de la hoja y, opcionalmente, de
// sharedStrings. Sirve para probar casos de borde que el fixture real no cubre,
// sin tocar el fixture ni depender de DeflateStream para comprimir en el test.
function construirXlsxSintetico(sheetXml, sharedXml) {
  const archivos = {
    "xl/worksheets/sheet1.xml": sheetXml,
  };
  if (sharedXml != null) archivos["xl/sharedStrings.xml"] = sharedXml;

  const encoder = new TextEncoder();
  const nombres = Object.keys(archivos);
  const locales = [];
  const offsets = [];
  let offset = 0;

  for (const nombre of nombres) {
    const nombreBytes = encoder.encode(nombre);
    const datos = encoder.encode(archivos[nombre]);
    const local = new Uint8Array(30 + nombreBytes.length + datos.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true); // firma local file header
    dv.setUint16(4, 20, true); // version needed
    dv.setUint16(6, 0, true); // gp flag
    dv.setUint16(8, 0, true); // método: 0 = almacenado (sin comprimir)
    dv.setUint16(10, 0, true); // hora
    dv.setUint16(12, 0, true); // fecha
    dv.setUint32(14, 0, true); // crc-32 (no verificado por el lector)
    dv.setUint32(18, datos.length, true); // tamaño comprimido
    dv.setUint32(22, datos.length, true); // tamaño sin comprimir
    dv.setUint16(26, nombreBytes.length, true);
    dv.setUint16(28, 0, true); // extra length
    local.set(nombreBytes, 30);
    local.set(datos, 30 + nombreBytes.length);
    offsets.push(offset);
    locales.push(local);
    offset += local.length;
  }

  const centralInicio = offset;
  const centrales = [];
  nombres.forEach((nombre, i) => {
    const nombreBytes = encoder.encode(nombre);
    const datos = encoder.encode(archivos[nombre]);
    const central = new Uint8Array(46 + nombreBytes.length);
    const dv = new DataView(central.buffer);
    dv.setUint32(0, 0x02014b50, true); // firma central directory
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(8, 0, true);
    dv.setUint16(10, 0, true); // método: almacenado
    dv.setUint16(12, 0, true);
    dv.setUint16(14, 0, true);
    dv.setUint32(16, 0, true);
    dv.setUint32(20, datos.length, true);
    dv.setUint32(24, datos.length, true);
    dv.setUint16(28, nombreBytes.length, true);
    dv.setUint16(30, 0, true);
    dv.setUint16(32, 0, true);
    dv.setUint16(34, 0, true);
    dv.setUint16(36, 0, true);
    dv.setUint32(38, 0, true);
    dv.setUint32(42, offsets[i], true);
    central.set(nombreBytes, 46);
    centrales.push(central);
    offset += central.length;
  });
  const centralSize = offset - centralInicio;

  const eocd = new Uint8Array(22);
  const dvEocd = new DataView(eocd.buffer);
  dvEocd.setUint32(0, 0x06054b50, true);
  dvEocd.setUint16(4, 0, true);
  dvEocd.setUint16(6, 0, true);
  dvEocd.setUint16(8, nombres.length, true);
  dvEocd.setUint16(10, nombres.length, true);
  dvEocd.setUint32(12, centralSize, true);
  dvEocd.setUint32(16, centralInicio, true);
  dvEocd.setUint16(20, 0, true);

  const total = new Uint8Array(offset + 22);
  let p = 0;
  for (const l of locales) { total.set(l, p); p += l.length; }
  for (const c of centrales) { total.set(c, p); p += c.length; }
  total.set(eocd, p);
  return total;
}

describe("leerXlsx", () => {
  it("lee las 15 filas del reporte", async () => {
    const filas = await leerXlsx(bytes);
    expect(filas.length).toBe(15);
  });
  it("fila 1 trae la razón social con relleno", async () => {
    const filas = await leerXlsx(bytes);
    expect(filas[0][0]).toContain("LIMPIEZA AMERICANA S.A.C.");
    expect(filas[0][0]).toContain("PAG.");
  });
  it("los DNI llegan como texto con cero inicial", async () => {
    const filas = await leerXlsx(bytes);
    expect(filas[6][2].trim()).toBe("09113655");
  });

  it("una fila vacía self-closing no desplaza a las filas siguientes", async () => {
    const sharedXml = `<?xml version="1.0"?><sst><si><t>primera</t></si><si><t>tercera</t></si></sst>`;
    const sheetXml = `<?xml version="1.0"?><worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c></row>
      <row r="2"/>
      <row r="3"><c r="A3" t="s"><v>1</v></c></row>
    </sheetData></worksheet>`;
    const xlsxBytes = construirXlsxSintetico(sheetXml, sharedXml);

    const filas = await leerXlsx(xlsxBytes);

    expect(filas.length).toBe(3);
    expect(filas[0][0]).toBe("primera");
    expect(filas[1]).toEqual([]); // fila 2, vacía, no debe faltar ni correr las demás
    expect(filas[2][0]).toBe("tercera");
  });

  // El libro de activos trae 12 hojas y la primera está OCULTA: sin selección
  // por nombre, el lector caería en una hoja equivocada.
  describe("hoja por nombre (libro de activos, 12 hojas)", () => {
    const activos = new Uint8Array(readFileSync("tests/fixtures/EQUIPOS_DE_COMPUTO_ACTIVOS_FIJOS.xlsx"));

    it("lee la hoja 'AF EQUIPO DE COMPUTO' por nombre", async () => {
      const filas = await leerXlsx(activos, { hoja: "AF EQUIPO DE COMPUTO" });
      expect(filas[0].join(" ")).toContain("FORMATO 7.1");
      expect(filas[4].join(" ")).toContain("PROMANT SERVICIOS");
    });
    it("una hoja inexistente detiene con un mensaje claro que la nombra", async () => {
      await expect(leerXlsx(activos, { hoja: "NO EXISTE" })).rejects.toThrow(/NO EXISTE/);
    });
    it("sin opción de hoja conserva el comportamiento actual (primera hoja física)", async () => {
      const filas = await leerXlsx(activos);
      expect(filas.every((f) => !f.join(" ").includes("FORMATO 7.1"))).toBe(true);
    });
  });

  it("una celda t=\"s\" sin <v> resuelve a cadena vacía, no a compartidas[0]", async () => {
    const sharedXml = `<?xml version="1.0"?><sst><si><t>NO_DEBE_APARECER</t></si><si><t>NOVACIA</t></si></sst>`;
    const sheetXml = `<?xml version="1.0"?><worksheet><sheetData>
      <row r="1"><c r="A1" t="s"/><c r="B1" t="s"><v>1</v></c></row>
    </sheetData></worksheet>`;
    const xlsxBytes = construirXlsxSintetico(sheetXml, sharedXml);

    const filas = await leerXlsx(xlsxBytes);

    expect(filas[0][0]).toBe("");
    expect(filas[0][1]).toBe("NOVACIA");
  });
});
