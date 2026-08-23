import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { leerXlsx, nombresHojas } from "../../src/lib/importar/xlsx.js";
import { parsearPlanillaUnificada, sinCerosDoc } from "../../src/lib/importar/planilla-unificada.js";

// Fixture REAL (OFICINA JUL 2026, 79 personas con cuentas bancarias): NO se
// commitea por privacidad — vive solo en esta máquina (OneDrive/Tarea 21-08).
// Sin él, esta suite se salta sola en vez de romper el npm test de un clone.
const FIXTURE = "tests/fixtures/OFICINA_JUL_2026_UNIFICADO.xlsx";
const hay = existsSync(FIXTURE);

let filas, hojas, r;
beforeAll(async () => {
  if (!hay) return;
  const bytes = new Uint8Array(readFileSync(FIXTURE));
  hojas = await nombresHojas(bytes);
  filas = await leerXlsx(bytes);
  r = parsearPlanillaUnificada(filas, { hoja: hojas[0] });
});

describe.skipIf(!hay)("planilla unificada — criterios de aceptación", () => {
  it("detección: 79 filas válidas y 3 razones sociales por RUC (39/29/11)", () => {
    expect(r.filas.length).toBe(79);
    expect(r.errores.length).toBe(0);
    const porRuc = Object.fromEntries(r.empresas.map((e) => [e.ruc, e.filas]));
    expect(porRuc["20605159398"]).toBe(39); // NEGLIAF
    expect(porRuc["20545837880"]).toBe(29); // PROMANT
    expect(porRuc["20601705185"]).toBe(11); // L. Americana
  });

  it("período desde el nombre de la hoja: OFICINA JUL 2026 → 2026-07", () => {
    expect(r.periodo).toBe("2026-07");
  });

  it("un archivo sin las 12 columnas NO se interpreta como este formato", () => {
    expect(() => parsearPlanillaUnificada([["A", "B"], ["1", "2"]], {}))
      .toThrow(/formato de planilla unificada/i);
  });

  it("los 3 CE conservan sus ceros iniciales y su tipo", () => {
    const ces = r.filas.filter((f) => f.tipoDoc === "CE").map((f) => f.documento).sort();
    expect(ces).toEqual(["002771952", "003308122", "004193432"]);
  });

  it("los 76 DNI son texto de 8 dígitos (ceros conservados)", () => {
    const dnis = r.filas.filter((f) => f.tipoDoc === "DNI");
    expect(dnis.length).toBe(76);
    expect(dnis.every((f) => /^[0-9]{8}$/.test(f.documento))).toBe(true);
  });

  it("la comparación contra el maestro quita ceros en ambos lados, sin rellenar", () => {
    expect(sinCerosDoc("003308122")).toBe(sinCerosDoc("3308122"));
    expect(sinCerosDoc("09972665")).toBe(sinCerosDoc("9972665"));
    expect(sinCerosDoc("00A12")).toBe("A12"); // alfanumérico: solo ceros IZQUIERDOS
  });

  it("las cuentas del Continental conservan el 00110 inicial (texto, jamás número)", () => {
    const cont = r.filas.filter((f) => f.bancoCodigo === "bbva");
    expect(cont.length).toBe(34);
    expect(cont.every((f) => f.cuenta.startsWith("00110"))).toBe(true);
  });

  it("banco por catálogo: Scotianbank mal escrito → scotiabank; Credito → bcp", () => {
    expect(r.filas.filter((f) => f.bancoCodigo === "scotiabank").length).toBe(35);
    expect(r.filas.filter((f) => f.bancoCodigo === "bcp").length).toBe(10);
  });

  it("las 2 cuentas BCP de 20 dígitos entran con ADVERTENCIA (posible CCI)", () => {
    const con20 = r.filas.filter((f) => f.bancoCodigo === "bcp" && f.cuenta.length === 20);
    expect(con20.length).toBe(2);
    expect(con20.every((f) => f.advertencias.some((a) => /20 dígitos/.test(a)))).toBe(true);
    const normales = r.filas.filter((f) => f.bancoCodigo === "bcp" && f.cuenta.length !== 20);
    expect(normales.every((f) => f.advertencias.length === 0)).toBe(true);
  });

  it("centro de costo: código y descripción separados; el token repetido de PROMANT se dedupe", () => {
    const promant = r.filas.find((f) => f.centroCostoCodigo === "1501");
    expect(promant.centroCostoDesc).toBe("G. ADM-C");
    const simple = r.filas.find((f) => f.centroCostoCodigo === "1401");
    expect(simple.centroCostoDesc).toBe("ADMINISTRACIO");
  });

  it("SEDE y FECHA DE INGRESO vacías no generan valor", () => {
    expect(r.filas.every((f) => f.sede === null && f.fechaIngreso === null)).toBe(true);
  });

  it("CÓDIGO y NRO DE DOCUMENTO coinciden en las 79; si difieren es error de fila", () => {
    expect(r.filas.every((f) => f.codigo === f.documento)).toBe(true);
    const alteradas = filas.map((f, i) => (i === 1 ? Object.assign([...f], { 3: "99999999" }) : f));
    const r2 = parsearPlanillaUnificada(alteradas, { hoja: hojas[0] });
    expect(r2.filas.length).toBe(78);
    expect(r2.errores.some((e) => /CÓDIGO.*documento|difiere/i.test(e))).toBe(true);
  });

  it("banco fuera del catálogo = error de fila (nada de texto libre)", () => {
    const alteradas = filas.map((f, i) => (i === 2 ? Object.assign([...f], { 10: "Banco Falabella" }) : f));
    const r3 = parsearPlanillaUnificada(alteradas, { hoja: hojas[0] });
    expect(r3.filas.length).toBe(78);
    expect(r3.errores.some((e) => /banco/i.test(e))).toBe(true);
  });

  it("nombres de hasta 46 caracteres, siempre con contrato y denominación", () => {
    expect(Math.max(...r.filas.map((f) => f.nombre.length))).toBe(46);
    expect(r.filas.every((f) => f.contrato && f.denominacion)).toBe(true);
  });
});
