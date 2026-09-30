// tests/correoFallos.test.js — Aviso de correos fallidos (superadmin).
import { describe, it, expect } from "vitest";
import { etiquetaAccion, resumenFallos, formatearHora } from "../src/lib/correoFallos.js";

describe("etiquetaAccion", () => {
  it("traduce las acciones conocidas y deja la desconocida tal cual", () => {
    expect(etiquetaAccion("segundo-factor")).toBe("Código de ingreso");
    expect(etiquetaAccion("acceso-portal")).toBe("Acceso al portal");
    expect(etiquetaAccion("acceso-admin")).toBe("Acceso al BackOffice");
    expect(etiquetaAccion("recuperacion-admin")).toBe("Recuperación de clave (BackOffice)");
    expect(etiquetaAccion("rara")).toBe("rara");
  });
});
describe("resumenFallos", () => {
  it("null sin filas; singular y plural", () => {
    expect(resumenFallos([])).toBeNull();
    expect(resumenFallos(undefined)).toBeNull();
    expect(resumenFallos([{}])).toBe("1 correo no se pudo enviar en las últimas 24 horas");
    expect(resumenFallos([{}, {}, {}])).toBe("3 correos no se pudieron enviar en las últimas 24 horas");
  });
  it("al llegar al tope de la función dice «100 o más»", () => {
    expect(resumenFallos(Array.from({ length: 100 }, () => ({})))).toBe("100 o más correos no se pudieron enviar en las últimas 24 horas");
  });
});
describe("formatearHora", () => {
  it("día/mes y hora local con dos dígitos", () => {
    const iso = new Date(2026, 8, 30, 14, 7).toISOString();
    expect(formatearHora(iso)).toBe("30/09 14:07");
  });
});
