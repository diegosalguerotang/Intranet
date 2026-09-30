// tests/seleccionPortal.test.js — Selección de trabajadores para cuentas del portal.
import { describe, it, expect } from "vitest";
import { esSeleccionable, alternarVisibles, depurar } from "../src/lib/seleccionPortal.js";

const P = [
  { dni: "1", empresa: "negliaf", estado: "vigente", tieneCuenta: false },
  { dni: "2", empresa: "negliaf", estado: "vigente", tieneCuenta: true },
  { dni: "3", empresa: "negliaf", estado: "cesado", tieneCuenta: false },
  { dni: "4", empresa: "promant", estado: "vigente", tieneCuenta: false },
  { dni: "5", empresa: "negliaf", estado: "vigente", tieneCuenta: false },
];

describe("esSeleccionable", () => {
  it("solo vigente, sin cuenta y de la empresa activa", () => {
    expect(P.map((p) => esSeleccionable(p, "negliaf"))).toEqual([true, false, false, false, true]);
  });
});
describe("alternarVisibles", () => {
  it("marcar añade solo los seleccionables de las filas visibles y no muta el Set original", () => {
    const antes = new Set(["9"]);
    const despues = alternarVisibles(antes, P, "negliaf", true);
    expect([...despues].sort()).toEqual(["1", "5", "9"]);
    expect([...antes]).toEqual(["9"]);
  });
  it("desmarcar quita solo los de las filas visibles", () => {
    const despues = alternarVisibles(new Set(["1", "5", "9"]), [P[0]], "negliaf", false);
    expect([...despues].sort()).toEqual(["5", "9"]);
  });
});
describe("depurar", () => {
  it("devuelve los marcados que siguen seleccionables, en el orden del maestro", () => {
    expect(depurar(new Set(["5", "2", "1", "3", "4", "zz"]), P, "negliaf")).toEqual(["1", "5"]);
  });
});
