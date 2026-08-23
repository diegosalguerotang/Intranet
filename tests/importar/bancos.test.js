import { describe, it, expect } from "vitest";
import { resolverBanco, BANCOS } from "../../src/lib/importar/bancos.js";

// Catálogo de bancos (#10 Fase 1): el archivo unificado trae el banco como
// texto libre y hasta mal escrito ("Banco Scotianbank"); el catálogo lo
// canoniza y nada se guarda como texto libre.
describe("resolverBanco", () => {
  it("resuelve el Scotianbank mal escrito del archivo real", () => {
    expect(resolverBanco("Banco Scotianbank")).toEqual({ codigo: "scotiabank", nombre: "Scotiabank" });
  });

  it("Banco Continental es BBVA (nombre histórico)", () => {
    expect(resolverBanco("Banco Continental")).toEqual({ codigo: "bbva", nombre: "BBVA" });
  });

  it("Banco Credito (sin tilde) es BCP", () => {
    expect(resolverBanco("Banco Credito")).toEqual({ codigo: "bcp", nombre: "BCP" });
  });

  it("acepta variantes con tildes, mayúsculas y sin prefijo Banco", () => {
    expect(resolverBanco("BANCO DE CRÉDITO DEL PERÚ")?.codigo).toBe("bcp");
    expect(resolverBanco("scotiabank")?.codigo).toBe("scotiabank");
    expect(resolverBanco("Interbank")?.codigo).toBe("interbank");
    expect(resolverBanco("BBVA")?.codigo).toBe("bbva");
    expect(resolverBanco("Banco de la Nación")?.codigo).toBe("nacion");
  });

  it("texto desconocido o vacío → null", () => {
    expect(resolverBanco("Banco Inexistente")).toBe(null);
    expect(resolverBanco("")).toBe(null);
    expect(resolverBanco(null)).toBe(null);
  });

  it("el catálogo expone código y nombre por banco", () => {
    for (const b of BANCOS) {
      expect(b.codigo).toMatch(/^[a-z]+$/);
      expect(b.nombre.length).toBeGreaterThan(1);
    }
  });
});
