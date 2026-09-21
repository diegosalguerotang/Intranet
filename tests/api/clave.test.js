// Fase 6c (P11): la fuerza de la clave del BackOffice se decide en UN sitio
// del servidor (api/_clave.js) y el cliente usa el mismo piso.
import { describe, it, expect } from "vitest";
import { CLAVE_MIN_BACKOFFICE, CLAVE_MIN_PORTAL, validarClaveBackoffice, esCorreoPortal, correoDeSesion } from "../../api/_clave.js";
import { CLAVE_MIN_BACKOFFICE as PISO_CLIENTE } from "../../src/lib/campos.js";

describe("validarClaveBackoffice", () => {
  it("el piso es 10, con al menos una letra y un número; el Portal sigue en 6", () => {
    expect(CLAVE_MIN_BACKOFFICE).toBe(10);
    expect(CLAVE_MIN_PORTAL).toBe(6);
    expect(PISO_CLIENTE).toBe(CLAVE_MIN_BACKOFFICE);
  });
  it("rechaza corta, solo números y solo letras; acepta una fuerte", () => {
    expect(validarClaveBackoffice("Abc12345")).toMatch(/al menos 10/);
    expect(validarClaveBackoffice("1234567890")).toMatch(/letra/);
    expect(validarClaveBackoffice("abcdefghij")).toMatch(/número/);
    expect(validarClaveBackoffice("Clave-segura-2026")).toBeNull();
    expect(validarClaveBackoffice("")).toMatch(/al menos 10/);
  });
  it("una política más exigente sube el mínimo; una más laxa no lo baja", () => {
    expect(validarClaveBackoffice("Abcdef12345", 14)).toMatch(/al menos 14/);
    expect(validarClaveBackoffice("Abcdef1234", 6)).toBeNull();
  });
});

describe("identidad del correo", () => {
  it("distingue cuentas del Portal", () => {
    expect(esCorreoPortal("45231876@portal.grupoer.pe")).toBe(true);
    expect(esCorreoPortal("Karen@GRUPOER.pe")).toBe(false);
    expect(esCorreoPortal("")).toBe(false);
  });
  it("lee el correo del JWT sin verificarlo (Auth lo verifica); basura → vacío", () => {
    const jwt = `a.${Buffer.from(JSON.stringify({ email: "Karen@grupoer.pe" })).toString("base64url")}.c`;
    expect(correoDeSesion(jwt)).toBe("karen@grupoer.pe");
    expect(correoDeSesion("no-es-jwt")).toBe("");
    expect(correoDeSesion(undefined)).toBe("");
  });
});
