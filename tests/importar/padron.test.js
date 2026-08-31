import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { leerXlsx } from "../../src/lib/importar/xlsx.js";
import { parsearPadron, sinCerosDoc } from "../../src/lib/importar/padron.js";

// Fixture REAL del formato definitivo (spec Tareas 31-08): 79 filas, 3 razones
// sociales por RUC, centro de costo y cargo. Contiene nombres y documentos
// reales, así que NO se commitea: vive local (copia de OneDrive/Tareas 31-08).
const FIXTURE = fileURLToPath(new URL("../fixtures/PLANILLA_UNIFICADA_ULTIMO.xlsx", import.meta.url));
const hay = existsSync(FIXTURE);

let filas, r;
beforeAll(async () => {
  if (!hay) return;
  const bytes = new Uint8Array(readFileSync(FIXTURE));
  filas = await leerXlsx(bytes);
  r = parsearPadron(filas);
});

// Copia superficial de las filas crudas para armar variantes sintéticas.
const clonar = () => filas.map((f) => [...f]);

describe.skipIf(!hay)("padrón unificado con centro de costo", () => {
  it("reconoce el formato por sus 12 encabezados y lee las 79 filas sin errores", () => {
    expect(r.filas).toHaveLength(79);
    expect(r.errores).toHaveLength(0);
  });

  it("no interpreta un archivo cuyos encabezados no coinciden", () => {
    const v = clonar();
    v[0][7] = "AREA DE COSTO";
    expect(() => parsearPadron(v)).toThrow(/formato/i);
  });

  it("empareja las tres razones sociales por RUC con 39, 29 y 11 filas", () => {
    expect(r.empresas).toEqual([
      { ruc: "20605159398", razonSocial: "NEGOCIOS DE LIMPIEZA Y AFINES S.R.L.", filas: 39 },
      { ruc: "20545837880", razonSocial: "PROMANT SERVICIOS SRL", filas: 29 },
      { ruc: "20601705185", razonSocial: "LIMPIEZA AMERICANA S.A.C.", filas: 11 },
    ]);
  });

  it("aplica trim a todo: nombres, sexo y situación llegan sin relleno", () => {
    const ivan = r.filas.find((f) => f.documento === "40899594");
    expect(ivan.nombre).toBe("AIRE ATAYARI IVAN");
    expect(ivan.sexo).toBe("M");
    expect(ivan.situacion).toBe("VIGENTE");
    const sexos = { M: 0, F: 0 };
    for (const f of r.filas) sexos[f.sexo]++;
    expect(sexos).toEqual({ M: 52, F: 27 });
  });

  it("conserva íntegros los tres carnés de extranjería, sin rellenar a ocho", () => {
    const ce = r.filas.filter((f) => f.tipoDocumento === "CE").map((f) => f.documento).sort();
    expect(ce).toEqual(["002771952", "003308122", "004193432"]);
    expect(sinCerosDoc("003308122")).toBe("3308122");
    expect(sinCerosDoc("70081272")).toBe("70081272");
  });

  it("regla de siglo: 03/08/26 queda en 2026 y los ingresos de los noventa en 19xx", () => {
    expect(r.filas.some((f) => f.fechaIngreso === "2026-08-03")).toBe(true);
    const anios = r.filas.map((f) => Number(f.fechaIngreso.slice(0, 4)));
    expect(Math.min(...anios)).toBeLessThanOrEqual(1996);
    expect(Math.max(...anios)).toBeLessThanOrEqual(2050);
  });

  it("centro de costo con sus ocho valores y la distribución del spec", () => {
    const cc = {};
    for (const f of r.filas) cc[f.centroCosto] = (cc[f.centroCosto] ?? 0) + 1;
    expect(cc).toEqual({
      LOGISTICA: 23, OPE: 18, ADM: 14, RRHH: 13,
      COMERCIAL: 3, "SST/GG": 3, "SIST/GG": 3, "LEGAL/GG": 2,
    });
  });

  it("el área heredada se guarda aparte y no reemplaza al centro de costo", () => {
    const ivan = r.filas.find((f) => f.documento === "40899594");
    expect(ivan.centroCosto).toBe("LOGISTICA");
    expect(ivan.areaHeredada).toBe("PLANTA");
  });

  it("el cargo llega sin relleno y hay 34 distintos", () => {
    const legal = r.filas.find((f) => f.documento === "70081272");
    expect(legal.cargo).toBe("ASISTENTE LEGAL");
    expect(new Set(r.filas.map((f) => f.cargo)).size).toBe(34);
  });

  it("CÓDIGO distinto de N DOC es error de fila", () => {
    const v = clonar();
    v[1][2] = "99999999";
    const rv = parsearPadron(v);
    expect(rv.errores).toHaveLength(1);
    expect(rv.errores[0].fila).toBe(2);
    expect(rv.errores[0].error).toMatch(/CÓDIGO/);
    expect(rv.filas).toHaveLength(78);
  });

  it("un documento repetido en la misma razón social es error de fila", () => {
    const v = clonar();
    v[2] = [...v[1]];
    const rv = parsearPadron(v);
    expect(rv.errores.some((e) => /repetido/i.test(e.error))).toBe(true);
  });

  it("una situación distinta de VIGENTE se reporta como fila con problema", () => {
    const v = clonar();
    v[1][11] = "CESADO";
    const rv = parsearPadron(v);
    expect(rv.errores).toHaveLength(1);
    expect(rv.errores[0].error).toMatch(/VIGENTE/);
  });

  it("una fecha de ingreso ilegible es error de fila", () => {
    const v = clonar();
    v[1][10] = "agosto 23";
    const rv = parsearPadron(v);
    expect(rv.errores).toHaveLength(1);
    expect(rv.errores[0].error).toMatch(/fecha/i);
  });
});
