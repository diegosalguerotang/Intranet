import { describe, it, expect } from "vitest";
import { normalizarGrupo, normalizarCorreoLicencia, correoValido, tokensNombre, sugerirPersona } from "../src/lib/licencias.js";

// ADQ-09 · Licencias Office (2026-09-29): las normalizaciones deben coincidir
// con los CHECK de la base (grupo en mayúsculas, correo en minúsculas) y la
// sugerencia de persona con el criterio de la carga inicial (todos los tokens
// del nombre de la fuente aparecen en el nombre del padrón).
const PADRON = [
  { dni: "72386204", nombre: "MAYTA QUEVEDO ARTURO ANIBAL" },
  { dni: "07819030", nombre: "MAYTA QUISPE ANIBAL" },
  { dni: "47296190", nombre: "ALBAÑIL MUÑOZ DIANA CAROLINA" },
  { dni: "70122408", nombre: "Jean Paul Camacho Gómez" },
];

describe("normalizaciones", () => {
  it("grupo en mayúsculas, sin espacios extremos y con guion bajo interno", () => {
    expect(normalizarGrupo("  rrhh gerencia ")).toBe("RRHH_GERENCIA");
  });
  it("correo en minúsculas y sin espacios", () => {
    expect(normalizarCorreoLicencia(" G_RRHH@PROMANTSERV.onmicrosoft.com ")).toBe("g_rrhh@promantserv.onmicrosoft.com");
  });
  it("correoValido acepta un buzón y rechaza texto suelto", () => {
    expect(correoValido("rrhh@promantserv.onmicrosoft.com")).toBe(true);
    expect(correoValido("rrhh@")).toBe(false);
  });
  it("tokensNombre quita tildes y mayúsculas pero conserva la eñe", () => {
    expect(tokensNombre("Diana Albañil")).toEqual(["DIANA", "ALBAÑIL"]);
    expect(tokensNombre("Gómez, Jean-Paul")).toEqual(["GOMEZ", "JEAN", "PAUL"]);
  });
});

describe("sugerirPersona", () => {
  it("coincidencia única por tokens, sin importar orden ni tildes", () => {
    expect(sugerirPersona("jean paul camacho", PADRON)?.dni).toBe("70122408");
    expect(sugerirPersona("DIANA ALBAÑIL", PADRON)?.dni).toBe("47296190");
  });
  it("ambigua → null; con exclusión se resuelve por descarte", () => {
    expect(sugerirPersona("ANIBAL MAYTA", PADRON)).toBeNull();
    expect(sugerirPersona("ANIBAL MAYTA", PADRON, ["72386204"])?.dni).toBe("07819030");
  });
  it("sin coincidencia o sin nombre → null", () => {
    expect(sugerirPersona("ESPERANZA QUEVEDO", PADRON)).toBeNull();
    expect(sugerirPersona("", PADRON)).toBeNull();
  });
});
