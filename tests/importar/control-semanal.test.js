import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { leerXlsx } from "../../src/lib/importar/xlsx.js";
import { parsearControlSemanal } from "../../src/lib/importar/control-semanal.js";

// Fixture REAL del control semanal (spec Tareas 31-08): 2 hojas, 41
// trabajadores, agosto 2026 cortado el día 28. Contiene nombres y documentos
// reales, así que NO se commitea: vive local (copia de OneDrive/Tareas 31-08).
const FIXTURE = fileURLToPath(new URL("../fixtures/Control_Semanal_01-28_Agosto_2026.xlsx", import.meta.url));
const hay = existsSync(FIXTURE);

let detalle, resumen, r;
beforeAll(async () => {
  if (!hay) return;
  const bytes = new Uint8Array(readFileSync(FIXTURE));
  detalle = await leerXlsx(bytes, { hoja: "Detalle Diario" });
  resumen = await leerXlsx(bytes, { hoja: "Resumen Mensual" });
  r = parsearControlSemanal(detalle, resumen);
});

const clonarDetalle = () => detalle.map((f) => [...f]);

describe.skipIf(!hay)("lectura del control semanal (Detalle Diario)", () => {
  it("importa 41 trabajadores y 1148 registros; las 123 filas post-reporte se descartan informando", () => {
    expect(r.trabajadores).toHaveLength(41);
    expect(r.registros).toHaveLength(1148);
    expect(r.descartadas).toBe(123);
  });

  it("los banners de área y los subtotales por trabajador no generan registros", () => {
    // Una fila es de datos si la columna B tiene documento: todo registro lo tiene.
    expect(r.registros.every((x) => x.documento !== "")).toBe(true);
    // 8 áreas + 41 subtotales viven en la hoja y ninguno llegó como registro.
    expect(new Set(r.registros.map((x) => x.documento)).size).toBe(41);
  });

  it("clasifica los nueve tipos del spec con sus conteos", () => {
    const conteo = {};
    for (const x of r.registros) conteo[x.tipo] = (conteo[x.tipo] ?? 0) + 1;
    expect(conteo).toEqual({
      laborable: 684, domingo_libre: 162, sabado_libre: 137, revisar: 54,
      feriado: 41, reporte: 41, sabado_trabajo: 27, domingo_trabajo: 2,
    });
  });

  it("extrae el nombre del feriado del paréntesis, sin comparar el texto completo", () => {
    const feriados = r.registros.filter((x) => x.tipo === "feriado");
    expect(feriados.every((x) => x.feriadoNombre === "Batalla de Junin")).toBe(true);
    expect(feriados.every((x) => x.fecha === "2026-08-06")).toBe(true);
  });

  it("la hora de entrada es una por trabajador con los siete valores de la muestra", () => {
    const dist = {};
    for (const t of r.trabajadores) dist[t.he ?? "sin"] = (dist[t.he ?? "sin"] ?? 0) + 1;
    expect(dist).toEqual({ "08:30": 19, "09:30": 6, "10:00": 5, "08:00": 4, "09:00": 4, "07:00": 2, "06:30": 1 });
  });

  it("guarda un solo valor por cifra: h:mm en minutos, cotejado contra el decimal (0 diferencias en la muestra)", () => {
    expect(r.reportadas).toEqual([]);
    const once = r.registros.find((x) => x.documento === "8795173" && x.fecha === "2026-08-11");
    expect(once.minTrab).toBe(7 * 60 + 13);
    expect(once.minDeficit).toBe(47);
    expect(once.tardRaw).toBe(3);
    expect(once.tardEfec).toBe(0);
  });

  it("el día del reporte solo vale la tardanza: sin horas ni déficit", () => {
    const reporte = r.registros.filter((x) => x.tipo === "reporte");
    expect(reporte.every((x) => x.minTrab === null && x.minDeficit === null)).toBe(true);
    expect(reporte.some((x) => (x.tardRaw ?? 0) > 0)).toBe(true); // la mañana del 28 sí cuenta
  });

  it("el rango importable va del 1 al 28 de agosto (el corte descarta lo posterior)", () => {
    expect(r.rango).toEqual({ desde: "2026-08-01", hasta: "2026-08-28" });
  });

  it("el resumen mensual recalculado coincide con el del archivo en las 41 personas", () => {
    expect(r.contrasteResumen).toEqual([]);
  });

  it("un valor de TIPO fuera de la lista detiene la lectura", () => {
    const v = clonarDetalle();
    const i = v.findIndex((f, k) => k > 0 && String(f[1] ?? "").trim() !== "");
    v[i][5] = "Medio dia (inventado)";
    expect(() => parsearControlSemanal(v)).toThrow(/TIPO/);
  });

  it("dos horas de entrada distintas en el mismo trabajador detienen la lectura", () => {
    const v = clonarDetalle();
    const i = v.findIndex((f, k) => k > 0 && String(f[1] ?? "").trim() === "8795173" && String(f[10] ?? "").trim() !== "");
    v[i][10] = "11:45";
    expect(() => parsearControlSemanal(v)).toThrow(/horas de entrada/i);
  });

  it("un decimal editado sin su h:mm se reporta con la fila", () => {
    const v = clonarDetalle();
    const i = v.findIndex((f, k) => k > 0 && String(f[1] ?? "").trim() !== "" && String(f[12] ?? "").trim() !== "");
    v[i][13] = Number(v[i][13]) + 2; // alguien editó la versión decimal y no la h:mm
    const rv = parsearControlSemanal(v);
    expect(rv.reportadas.some((x) => x.fila === i + 1 && /difiere/i.test(x.motivo))).toBe(true);
  });

  it("sin las columnas EDITADO y MOTIVO el archivo se importa igual, como no editado", () => {
    expect(r.registros.every((x) => x.editado === false && x.motivoEdicion === null)).toBe(true);
  });

  it("con columnas EDITADO/MOTIVO: un Si sin motivo se reporta; con motivo se conserva", () => {
    const v = clonarDetalle();
    v[0] = [...v[0], "EDITADO", "MOTIVO DE EDICION"];
    const i1 = v.findIndex((f, k) => k > 0 && String(f[1] ?? "").trim() !== "");
    const i2 = v.findIndex((f, k) => k > i1 && String(f[1] ?? "").trim() !== "");
    v[i1] = [...v[i1]]; v[i1][22] = "Si"; v[i1][23] = "Marcó al recordar, hora corregida con el supervisor";
    v[i2] = [...v[i2]]; v[i2][22] = "Si"; v[i2][23] = "";
    const rv = parsearControlSemanal(v);
    const reg1 = rv.registros.find((x) => x.documento === String(v[i1][1]).trim() && x.fecha === v[i1][3]);
    expect(reg1.editado).toBe(true);
    expect(reg1.motivoEdicion).toMatch(/supervisor/);
    expect(rv.reportadas.some((x) => x.fila === i2 + 1 && /motivo/i.test(x.motivo))).toBe(true);
  });

  it("una fila con H.E. que no cuadra contra la primera marca y la tardanza se reporta", () => {
    const v = clonarDetalle();
    const i = v.findIndex((f, k) => k > 0 && String(f[1] ?? "").trim() === "8795173" && f[3] === "2026-08-11");
    v[i] = [...v[i]]; v[i][18] = 40; // tard raw editada: ya no es ENT1 − H.E.
    const rv = parsearControlSemanal(v);
    expect(rv.reportadas.some((x) => x.fila === i + 1 && /H\.E\./.test(x.motivo))).toBe(true);
  });
});
