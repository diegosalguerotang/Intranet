// tests/boletas/lote.test.js
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { extraerPaginas } from "../../src/lib/boletas/pdf.js";
import { analizarLote, normalizarPeriodo } from "../../src/lib/boletas/lote.js";

let paginas;
beforeAll(async () => {
  paginas = await extraerPaginas(new Uint8Array(readFileSync("tests/fixtures/BOLETAS.pdf")));
});

describe("analizarLote con BOLETAS.pdf", () => {
  it("nueve boletas, nueve DNI distintos, correlativo 1..9, cero excepciones, con las 10 páginas de entrada (incluida la página en blanco)", () => {
    expect(paginas.length).toBe(10);
    const r = analizarLote(paginas);
    expect(r.excepciones).toEqual([]);
    expect(r.boletas.length).toBe(9);
    expect(new Set(r.boletas.map((b) => b.dni)).size).toBe(9);
    expect(r.boletas.map((b) => b.correlativo)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it("el periodo se normaliza a 2026-06 y el RUC es el real", () => {
    const r = analizarLote(paginas);
    expect(r.lote.periodo).toBe("2026-06");
    expect(r.lote.ruc).toBe("20601705185");
  });
  it("la página en blanco final se descarta en silencio: no es continuación ni excepción", () => {
    const r = analizarLote(paginas);
    // la boleta 9 (última con contenido) no debe haber absorbido la página en blanco
    const boleta9 = r.boletas.find((b) => b.correlativo === 9);
    expect(boleta9.paginas).toEqual([8]);
  });
  it("quitar una página intermedia reporta salto de correlativo (excepción del lote)", () => {
    const sin5 = paginas.filter((_, i) => i !== 4);
    const r = analizarLote(sin5);
    expect(r.excepciones.some((e) => e.tipo === "salto_correlativo")).toBe(true);
  });
  it("una página con RUC distinto es excepción", () => {
    const alteradas = [...paginas];
    alteradas[2] = alteradas[2].replace(/RUC:\s*\d{11}/, "RUC: 20999999999");
    const r = analizarLote(alteradas);
    expect(r.excepciones.some((e) => e.tipo === "ruc_distinto" && e.pagina === 3)).toBe(true);
  });
  it("un ancla 'No N' ilegible reporta salto_correlativo en vez de colarse como correlativo 0", () => {
    const alteradas = [...paginas];
    alteradas[0] = alteradas[0].replace(/\bNo\.?\s+1\b/, "No **");
    const r = analizarLote(alteradas);
    expect(r.excepciones.some((e) => e.tipo === "salto_correlativo" && e.pagina === 1)).toBe(true);
    // las demás 8 boletas siguen bien: DNI/RUC/periodo intactos, sin excepciones propias.
    const otras = r.boletas.filter((b) => b.paginas[0] !== 0);
    expect(otras.length).toBe(8);
    expect(otras.every((b) => Number.isFinite(b.correlativo))).toBe(true);
    expect(r.excepciones.some((e) => e.tipo === "codigo_distinto" || e.tipo === "ruc_distinto" || e.tipo === "periodo_distinto")).toBe(false);
  });

  it("CODIGO ≠ DNI es excepción, sin elegir por su cuenta", () => {
    const alteradas = [...paginas];
    alteradas[0] = alteradas[0].replace(/CODIGO:\s*\d+/, "CODIGO: 00000001");
    const r = analizarLote(alteradas);
    expect(r.excepciones.some((e) => e.tipo === "codigo_distinto" && e.pagina === 1)).toBe(true);
  });
  it("una página sin ancla BOLETA DE PAGO pertenece a la boleta anterior", () => {
    const conContinuacion = [...paginas.slice(0, 3), "conceptos adicionales sin ancla", ...paginas.slice(3)];
    const r = analizarLote(conContinuacion);
    expect(r.excepciones).toEqual([]);
    expect(r.boletas.length).toBe(9);
    expect(r.boletas[2].paginas).toEqual([2, 3]);
  });

  it("verificación humana: valores completos de la boleta 1", () => {
    const r = analizarLote(paginas);
    const b1 = r.boletas[0];
    expect(b1.correlativo).toBe(1);
    expect(b1.dni).toBe("08693165");
    expect(b1.codigo).toBe("08693165");
    expect(b1.nombre).toBe("CONTRERAS LOAYZA MARUJA");
    expect(b1.cargo).toBe("OPERARIO(A) DE LIMPI");
    expect(b1.sede).toBe("SEDE CENTRAL");
    expect(b1.centroCosto).toBe("1600 MIDIS - PAIS");
    expect(b1.ingreso).toBe("2024-08-01");
    expect(b1.neto).toBe(1080.66);
    expect(b1.paginas).toEqual([0]);
  });
});

describe("normalizarPeriodo", () => {
  it("convierte los meses en español", () => {
    expect(normalizarPeriodo("JUNIO-2026")).toBe("2026-06");
    expect(normalizarPeriodo("SETIEMBRE-2025")).toBe("2025-09");
  });
  it("tolera el kerning irregular del PDF (mes partido por un espacio espurio)", () => {
    expect(normalizarPeriodo("J UNIO - 2026")).toBe("2026-06");
  });
});
