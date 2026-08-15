import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("fixtures", () => {
  it("LISTA_PAIS.xlsx existe y es un ZIP (xlsx)", () => {
    const buf = readFileSync("tests/fixtures/LISTA_PAIS.xlsx");
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
  });
  it("BOLETAS.pdf existe y es un PDF", () => {
    const buf = readFileSync("tests/fixtures/BOLETAS.pdf");
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
