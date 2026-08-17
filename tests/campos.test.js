import { describe, it, expect } from "vitest";
import { soloDigitos, normalizarCelular } from "../src/lib/campos.js";

// Bug reportado por Diego (2026-08-17): el campo celular de RRH-04 no llegaba
// a 9 dígitos. Causa raíz: maxLength del HTML corta el texto CRUDO antes de
// quitar los no-dígitos — pegar «987 654 321» truncaba a 9 caracteres crudos
// y dejaba 7 dígitos. El límite debe aplicarse DESPUÉS de sanear.
describe("soloDigitos", () => {
  it("un pegado con espacios conserva todos los dígitos hasta el límite", () => {
    expect(soloDigitos("987 654 321", 9)).toBe("987654321");
  });
  it("un DNI con puntos queda completo", () => {
    expect(soloDigitos("09.113.655", 8)).toBe("09113655");
  });
  it("recorta al máximo después de sanear, no antes", () => {
    expect(soloDigitos("9876543210", 9)).toBe("987654321");
  });
  it("sin dígitos devuelve vacío", () => {
    expect(soloDigitos("abc-", 9)).toBe("");
  });
});

describe("normalizarCelular", () => {
  it("teclear 9 dígitos llega a 9", () => {
    expect(normalizarCelular("987654321")).toBe("987654321");
  });
  it("pegar con formato de contacto conserva los 9", () => {
    expect(normalizarCelular("987 654 321")).toBe("987654321");
  });
  it("pegar con +51 suelta el prefijo de país", () => {
    expect(normalizarCelular("+51 987 654 321")).toBe("987654321");
  });
  it("un 51 que es parte del número no se recorta", () => {
    expect(normalizarCelular("519876543")).toBe("519876543");
  });
});
