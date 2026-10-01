// tests/jefe.test.js — Jefe inmediato de una solicitud: qué viaja al servidor.
import { describe, it, expect } from "vitest";
import { datosConJefe, jefesElegibles, OTRO_JEFE } from "../src/lib/jefe.js";

const datos = { motivo: "Particular" };

describe("datosConJefe", () => {
  it("elegido de la lista: viaja el código de usuario, jamás un documento ni el nombre", () => {
    expect(datosConJefe(datos, { usuario: "U-0011", nombre: "ignorado" })).toEqual({ motivo: "Particular", supervisor_usuario: "U-0011" });
  });
  it("otra persona: viaja solo el nombre escrito", () => {
    expect(datosConJefe(datos, { usuario: OTRO_JEFE, nombre: "  Ana Silva " })).toEqual({ motivo: "Particular", supervisor_nombre: "Ana Silva" });
  });
  it("vacío (o «otra persona» sin nombre): no añade nada y no muta la entrada", () => {
    expect(datosConJefe(datos, { usuario: "", nombre: "" })).toBe(datos);
    expect(datosConJefe(datos, { usuario: OTRO_JEFE, nombre: " " })).toBe(datos);
    expect(datosConJefe(datos, null)).toBe(datos);
    expect(datos).toEqual({ motivo: "Particular" });
  });
});

describe("jefesElegibles", () => {
  const lista = [{ codigo: "U-0001", nombre: "A", soy_yo: true }, { codigo: "U-0002", nombre: "B", soy_yo: false }, { nombre: "sin código" }];
  it("en la solicitud propia no aparece uno mismo", () => {
    expect(jefesElegibles(lista, true).map((j) => j.codigo)).toEqual(["U-0002"]);
  });
  it("a nombre de otro aparecen todos los que tienen código; lista ausente = vacía", () => {
    expect(jefesElegibles(lista, false).map((j) => j.codigo)).toEqual(["U-0001", "U-0002"]);
    expect(jefesElegibles(null, true)).toEqual([]);
  });
});
