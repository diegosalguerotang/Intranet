// tests/api/_politica.test.js — Política de datos v3: la marca {{RESPONSABLE}}
// se resuelve con la razón social de la planilla. La regla debe coincidir con
// fn_politica_responsable() de supabase/portal.sql (la ensaya scripts/ensayar-politica.mjs).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MARCA_RESPONSABLE, responsableDe, textoPolitica } from "../../api/_politica.js";

describe("responsable del tratamiento", () => {
  it("razón social con RUC entre paréntesis", () => {
    expect(responsableDe({ nombre: "NEGLIAF S.R.L.", ruc: "20605159398" })).toBe("NEGLIAF S.R.L. (RUC 20605159398)");
  });
  it("sin RUC: solo la razón social; sin empresa: null", () => {
    expect(responsableDe({ nombre: "Consorcio Clean" })).toBe("Consorcio Clean");
    expect(responsableDe({})).toBe(null);
    expect(responsableDe(null)).toBe(null);
  });
});

describe("texto de la política", () => {
  const plantilla = `El responsable del tratamiento es ${MARCA_RESPONSABLE}. Fin.`;
  it("sustituye la marca por la razón social", () => {
    expect(textoPolitica(plantilla, { nombre: "PROMANT SERVICIOS", ruc: "20545837880" }))
      .toBe("El responsable del tratamiento es PROMANT SERVICIOS (RUC 20545837880). Fin.");
  });
  it("un nombre con «$» se copia literal", () => {
    expect(textoPolitica(plantilla, { nombre: "A$&B $1" })).toBe("El responsable del tratamiento es A$&B $1. Fin.");
  });
  it("sin empresa usa el genérico; un texto sin marca (v1, v2) sale igual", () => {
    expect(textoPolitica(plantilla, null)).toBe("El responsable del tratamiento es tu empleadora. Fin.");
    expect(textoPolitica("Texto v2 sin marca.", { nombre: "X", ruc: "1" })).toBe("Texto v2 sin marca.");
  });
  it("la política v3 del canon lleva la marca exactamente una vez, en el punto 1", () => {
    const sql = readFileSync("supabase/portal.sql", "utf8");
    const v3 = sql.slice(sql.indexOf("('politica-datos', 3, 'portal',"));
    const texto = v3.slice(0, v3.indexOf("on conflict (id, version) do nothing;"));
    expect(texto.split(MARCA_RESPONSABLE)).toHaveLength(2);
    expect(texto).toMatch(/1\. QUIÉN TRATA TUS DATOS\r?\nEl responsable del tratamiento es \{\{RESPONSABLE\}\}\./);
  });
});
