import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { leerXlsx } from "../../src/lib/importar/xlsx.js";
import { parsearPlanilla, normalizar } from "../../src/lib/importar/planilla.js";

const HOY = new Date("2026-08-15");
let filas;
beforeAll(async () => {
  filas = await leerXlsx(new Uint8Array(readFileSync("tests/fixtures/LISTA_PAIS.xlsx")));
});

describe("parsearPlanilla con LISTA_PAIS.xlsx", () => {
  it("extrae los nueve trabajadores sin errores", () => {
    const r = parsearPlanilla(filas, HOY);
    expect(r.errores).toEqual([]);
    expect(r.filas.length).toBe(9);
  });
  it("conserva el cero inicial del DNI", () => {
    const r = parsearPlanilla(filas, HOY);
    expect(r.filas.map((f) => f.dni)).toContain("09113655");
  });
  it("'/  /' en F.Cese es null, sin error", () => {
    const r = parsearPlanilla(filas, HOY);
    expect(r.filas.every((f) => f.cese === null)).toBe(true);
  });
  it("regla de siglo: 21/05/26 → 2026-05-21, 01/08/24 → 2024-08-01", () => {
    const r = parsearPlanilla(filas, HOY);
    const lucila = r.filas.find((f) => f.dni === "09113655");
    expect(lucila.ingreso).toBe("2026-05-21");
  });
  it("la razón social sale de la fila 1", () => {
    const r = parsearPlanilla(filas, HOY);
    expect(r.empresa).toBe("LIMPIEZA AMERICANA S.A.C.");
  });
  it("marca nombres truncados a 30 caracteres", () => {
    const r = parsearPlanilla(filas, HOY);
    const llerena = r.filas.find((f) => f.dni === "76926184");
    expect(llerena.nombreTruncado).toBe(true);
  });
});

describe("archivo multipágina sintético", () => {
  it("descarta cabeceras repetidas y filas de relleno", () => {
    const pagina2 = [
      ["LIMPIEZA AMERICANA S.A.C.                 PAG.    2"],
      ["PLATRA1        Registro de Trabajadores       14/08/2026"],
      ["   Centro de Costo : MIDIS - PAIS   "], ["   Situación : VIGENTE   "], [""],
      filas[5], // encabezados repetidos
      ["11111111", "PRUEBA UNO                     ", "11111111", "M", "SEDE CENTRAL", "OPERARIO(A) DE LIMPIEZA", "1600", "01/02/25", "/  /", "VIGENTE"],
    ];
    const r = parsearPlanilla([...filas, ...pagina2], HOY);
    expect(r.errores).toEqual([]);
    expect(r.filas.length).toBe(10);
  });
});

describe("validaciones", () => {
  it("fecha de ingreso futura es error de fila", () => {
    const malas = [...filas.slice(0, 6),
      ["22222222", "FUTURO                        ", "22222222", "M", "SEDE X", "CARGO", "1", "01/01/49", "/  /", "VIGENTE"]];
    const r = parsearPlanilla(malas, HOY);
    expect(r.errores.length).toBe(1);
    expect(r.errores[0]).toMatch(/futura/i);
  });
  it("sin encabezados reconocibles, se detiene con mensaje claro", () => {
    expect(() => parsearPlanilla([["nada"], ["de"], ["esto"]], HOY)).toThrow(/encabezados/i);
  });
  it("normalizar iguala acentos y Ñ", () => {
    expect(normalizar("ASTUPIÑAN")).toBe(normalizar("ASTUPIÑAN".normalize("NFD")));
  });
  it("DNI repetido en el archivo va a errores, no se importan dos filas para la misma persona", () => {
    const fila1 = ["33333333", "PRIMERA VEZ                   ", "33333333", "M", "SEDE X", "CARGO", "1", "01/01/25", "/  /", "VIGENTE"];
    const fila2 = ["33333333", "SEGUNDA VEZ                   ", "33333333", "M", "SEDE Y", "CARGO", "1", "01/02/25", "/  /", "VIGENTE"];
    const repetidas = [...filas.slice(0, 6), fila1, fila2];
    const r = parsearPlanilla(repetidas, HOY);
    expect(r.filas.filter((f) => f.dni === "33333333").length).toBe(1);
    expect(r.errores.length).toBe(1);
    expect(r.errores[0]).toMatch(/repetido en el archivo/i);
    expect(r.errores[0]).toMatch(/DNI 33333333/);
  });
});
