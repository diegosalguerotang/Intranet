import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { leerXlsx } from "../../src/lib/importar/xlsx.js";

const bytes = new Uint8Array(readFileSync("tests/fixtures/LISTA_PAIS.xlsx"));

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
});
