import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { leerXlsx } from "../../src/lib/importar/xlsx.js";
import { analizarAsistencia, sinCeros } from "../../src/lib/importar/asistencia.js";

// El archivo se exportó el 2026-08-21; los días 22 y 23 son futuros.
const HOY = "2026-08-21";
let filas, r;
beforeAll(async () => {
  filas = await leerXlsx(new Uint8Array(readFileSync("tests/fixtures/Asistencia_21_8_2026.xlsx")), { hoja: "Worksheet" });
  r = analizarAsistencia(filas, { umbralDobleMin: 15, hoy: HOY });
});

describe("parser de asistencia — criterios de aceptación del spec", () => {
  it("41 trabajadores y 943 filas de datos; 41 separadoras descartadas", () => {
    expect(r.stats.trabajadores).toBe(41);
    expect(r.stats.filasDatos).toBe(943);
    expect(r.stats.separadoras).toBe(41);
  });

  it("cada trabajador tiene 23 días, del 2026-08-01 al 2026-08-23", () => {
    expect(r.rango.desde).toBe("2026-08-01");
    expect(r.rango.hasta).toBe("2026-08-23");
    const porTrab = new Map();
    for (const reg of r.registros) porTrab.set(reg.codigo, (porTrab.get(reg.codigo) ?? 0) + 1);
    expect([...porTrab.values()].every((n) => n === 23)).toBe(true);
  });

  it("los 11 códigos de siete dígitos se reconocen y su forma sin ceros coteja", () => {
    const sieteDigitos = r.codigos.filter((c) => /^\d{7}$/.test(c));
    expect(sieteDigitos.length).toBe(11);
    // 9972665 (7) coteja con el DNI 09972665 (8) al quitar ceros.
    expect(sinCeros("9972665")).toBe(sinCeros("09972665"));
  });

  it("377 días con 4 marcaciones y 69 con 2", () => {
    expect(r.stats.conCuatro).toBe(377);
    expect(r.stats.conDos).toBe(69);
  });

  it("383 filas sin marcación (no generan falta) y suman con el resto = 943", () => {
    expect(r.stats.sinMarca).toBe(383);
    expect(r.stats.conCuatro + r.stats.conDos + r.stats.incompletos + r.stats.sinMarca).toBe(943);
  });

  it("114 días incompletos y 4 jornadas sin refrigerio", () => {
    expect(r.stats.incompletos).toBe(114);
    expect(r.stats.sinRefrigerio).toBe(4);
  });

  // El spec dice "2 dobles (8 min y 3 min)", pero solo contó las de la ENTRADA.
  // La regla literal ("dos consecutivas < 15 min") encuentra 6 pares reales bajo
  // 15 min (2,2,3,5,8,10 min) en entrada/refrigerio/salida. Sobre-marcar es
  // seguro: solo se listan para revisión de RRHH, no bloquean. Diego confirmó
  // la regla literal el 2026-08-21.
  it("dobles marcaciones: 6 pares reales bajo el umbral de 15 min (regla literal)", () => {
    expect(r.stats.dobles).toBe(6);
  });

  it("los días 22 y 23 (futuros) se descartan de la importación: 82 filas", () => {
    expect(r.stats.futurasDescartadas).toBe(82); // 2 días × 41 trabajadores
    expect(r.importables.every((f) => f.fecha <= HOY)).toBe(true);
    expect(r.importables.length).toBe(943 - 82);
  });

  it("las 4 marcaciones de un día se guardan como 4 (no se pierde ninguna por el encabezado repetido)", () => {
    const cuatro = r.registros.find((reg) => reg.nMarcas === 4);
    expect(cuatro.marcas.length).toBe(4);
    expect(cuatro.marcas.every((m) => /^\d{1,2}:\d{2}$/.test(m))).toBe(true);
  });
});
