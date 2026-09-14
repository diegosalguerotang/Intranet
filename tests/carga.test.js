import { describe, it, expect } from "vitest";
import { dbVacia, dbInicial, origenDesde } from "../src/lib/carga.js";

const FUENTES = { empresas: "empresas", personal: "v_personal" };
const LOCAL = { empresas: [{ id: "demo" }], personal: [{ dni: "00000000" }] };

describe("carga del estado", () => {
  it("dbVacia: una lista vacía por cada clave de FUENTES", () => {
    expect(dbVacia(FUENTES)).toEqual({ empresas: [], personal: [] });
  });
  it("dbInicial: con Supabase arranca vacío, nunca con mock", () => {
    expect(dbInicial(true, FUENTES, LOCAL)).toEqual({ empresas: [], personal: [] });
  });
  it("dbInicial: sin Supabase (desarrollo local) usa el mock", () => {
    expect(dbInicial(false, FUENTES, LOCAL)).toBe(LOCAL);
  });
  it("origenDesde: sin Supabase → local", () => {
    expect(origenDesde(false, [])).toBe("local");
  });
  it("origenDesde: todas las lecturas sin error → supabase", () => {
    expect(origenDesde(true, [{ data: [] }, { data: [] }])).toBe("supabase");
  });
  it("origenDesde: cualquier lectura con error → error (jamás mock)", () => {
    expect(origenDesde(true, [{ data: [] }, { error: { message: "permission denied" } }])).toBe("error");
  });
});
