import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dividirPdf, sha256Hex } from "../../src/lib/boletas/dividir.js";
import { extraerPaginas } from "../../src/lib/boletas/pdf.js";

const bytes = new Uint8Array(readFileSync("tests/fixtures/BOLETAS.pdf"));

describe("dividirPdf", () => {
  it("produce un PDF válido de una página por boleta", async () => {
    const partes = await dividirPdf(bytes, [[0], [1], [2]]);
    expect(partes.length).toBe(3);
    for (const p of partes) expect(new TextDecoder().decode(p.subarray(0, 5))).toBe("%PDF-");
    const texto = await extraerPaginas(partes[1]);
    expect(texto.length).toBe(1);
    expect(texto[0]).toMatch(/BOLETA DE PAGO/);
  });
  it("el hash es estable y hex de 64", async () => {
    const [p] = await dividirPdf(bytes, [[0]]);
    const h = await sha256Hex(p);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex(p)).toBe(h);
  });
});
