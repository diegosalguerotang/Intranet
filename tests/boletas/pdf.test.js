import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { extraerPaginas } from "../../src/lib/boletas/pdf.js";

let paginas;
beforeAll(async () => {
  paginas = await extraerPaginas(new Uint8Array(readFileSync("tests/fixtures/BOLETAS.pdf")));
});

describe("extraerPaginas con BOLETAS.pdf", () => {
  // El PDF real tiene 10 páginas: 9 boletas (No 1..No 9) + una página final
  // en blanco (sin capa de texto) que el generador de la planilla agrega al
  // cierre del lote. Se reporta el conteo real en vez de forzar 9 (ver
  // task-9-report.md): el parser de anclas (Task 10) debe ignorar páginas
  // sin contenido en lugar de asumir 9 páginas totales.
  it("devuelve diez páginas; nueve con capa de texto de boleta y una final en blanco", () => {
    expect(paginas.length).toBe(10);
    const conTexto = paginas.filter((p) => p.trim().length > 0);
    expect(conTexto.length).toBe(9);
    expect(paginas[9].trim()).toBe(""); // página final en blanco
  });

  it("cada página con texto es una boleta distinta (No 1..No 9)", () => {
    expect(paginas[0]).toMatch(/BOLETA DE PAGO/);
    expect(paginas[0]).toMatch(/RUC:\s*20601705185/);
    for (let i = 0; i < 9; i++) {
      expect(paginas[i]).toMatch(new RegExp(`No ${i + 1}\\b`));
    }
  });

  it("la página 1 contiene las anclas que usará el parser (Task 10)", () => {
    expect(paginas[0]).toMatch(/CODIGO:/);
    expect(paginas[0]).toMatch(/Documento/);
    expect(paginas[0]).toMatch(/Neto a pagar/);
  });
});
