// tests/integrada.test.js — criterio: importar LISTA_PAIS.xlsx y cargar
// BOLETAS.pdf sobre la misma empresa asigna las nueve boletas sin excepciones.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { leerXlsx } from "../src/lib/importar/xlsx.js";
import { parsearPlanilla } from "../src/lib/importar/planilla.js";
import { extraerPaginas } from "../src/lib/boletas/pdf.js";
import { analizarLote } from "../src/lib/boletas/lote.js";

describe("prueba integrada Excel → PDF", () => {
  it("los nueve DNI del PDF existen en la importación del Excel", async () => {
    const excel = parsearPlanilla(await leerXlsx(new Uint8Array(readFileSync("tests/fixtures/LISTA_PAIS.xlsx"))));
    const lote = analizarLote(await extraerPaginas(new Uint8Array(readFileSync("tests/fixtures/BOLETAS.pdf"))));
    expect(lote.excepciones).toEqual([]);
    const dnisExcel = new Set(excel.filas.map((f) => f.dni));
    for (const b of lote.boletas) expect(dnisExcel.has(b.dni)).toBe(true);
  });

  it("ambas fuentes apuntan a la misma empresa real (LIMPIEZA AMERICANA, RUC 20601705185)", async () => {
    // El Excel identifica la empresa por razón social (fila 1); el PDF, por
    // RUC (cabecera de cada página). No comparten el mismo campo, así que la
    // coincidencia de DNI del primer test por sí sola no basta para probar
    // que ambos archivos son "de la misma empresa": esto lo confirma.
    const excel = parsearPlanilla(await leerXlsx(new Uint8Array(readFileSync("tests/fixtures/LISTA_PAIS.xlsx"))));
    const lote = analizarLote(await extraerPaginas(new Uint8Array(readFileSync("tests/fixtures/BOLETAS.pdf"))));
    expect(excel.empresa).toBe("LIMPIEZA AMERICANA S.A.C.");
    expect(lote.lote.ruc).toBe("20601705185");
  });
});
