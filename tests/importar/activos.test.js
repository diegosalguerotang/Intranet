import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { leerXlsx } from "../../src/lib/importar/xlsx.js";
import { parsearActivos, normalizarRazonSocial } from "../../src/lib/importar/activos.js";

// Criterios de aceptación de Importacion_Activos.docx, verificados contra el
// archivo de muestra real (Formato 7.1 SUNAT usado como inventario).
let filas, r;
beforeAll(async () => {
  filas = await leerXlsx(
    new Uint8Array(readFileSync("tests/fixtures/EQUIPOS_DE_COMPUTO_ACTIVOS_FIJOS.xlsx")),
    { hoja: "AF EQUIPO DE COMPUTO" }
  );
  r = parsearActivos(filas);
});

describe("parsearActivos con el fixture real", () => {
  it("valida el Formato 7.1 y extrae la razón social de la cabecera", () => {
    expect(r.errores).toEqual([]);
    expect(r.razonSocial).toBe("PROMANT SERVICIOS SOCIEDAD COMERCIAL DE RESPONSABILIDAD LIMITADA");
  });

  it("detecta 72 filas de activo y 65 códigos únicos", () => {
    expect(r.activos.length).toBe(72);
    expect(new Set(r.activos.map((a) => a.codigo)).size).toBe(65);
  });

  it("reporta los cinco códigos duplicados como bloqueantes", () => {
    const porCodigo = Object.fromEntries(r.duplicados.map((d) => [d.codigo, d]));
    expect(Object.keys(porCodigo).sort()).toEqual(
      ["EPSON 2025", "EPSON2018", "EPSON2019", "EPSON2024", "PROLT51"]
    );
    expect(porCodigo.EPSON2018.filas.length).toBe(3);
    expect(porCodigo.EPSON2024.filas.length).toBe(3);
    expect(porCodigo["EPSON 2025"].filas.length).toBe(2);
    expect(porCodigo.EPSON2019.filas.length).toBe(2);
  });

  it("cada duplicado trae las filas implicadas y el usuario de cada una", () => {
    const prolt51 = r.duplicados.find((d) => d.codigo === "PROLT51");
    expect(prolt51.filas).toEqual([20, 67]);
    expect(prolt51.usuarios).toEqual(["FABRIZZIO NUEVA", "CHRISTIAN CHAMBI"]);
  });

  it("reconoce las nueve separadoras y su valor queda como área de las filas siguientes", () => {
    expect(r.areas).toEqual([
      "RRHH", "LOGISTICA", "OPERACIONES", "ADMINISTRACION", "ALMACEN",
      "SUPERVISORES", "IMPRESORA", "FOTOCOPIADORA", "LAPTOP STOCK",
    ]);
    const porCodigo = Object.fromEntries(r.activos.map((a) => [a.codigo, a]));
    expect(porCodigo.PROLT01.area).toBe("RRHH");        // bajo la separadora de la fila 10
    expect(porCodigo.PROLT13.area).toBe("LOGISTICA");
    expect(porCodigo["KONIKA COLOR"].area).toBe("FOTOCOPIADORA");
  });

  it("las filas de totales al pie no generan activos", () => {
    expect(r.activos.every((a) => !/^TOTAL/i.test(a.codigo) && !/FUNCIONANDO/.test(a.codigo))).toBe(true);
    expect(r.activos.every((a) => a.fila < 95)).toBe(true);
  });

  it("la fila agregada de las nueve laptops va a revisión y no crea un activo", () => {
    const agregada = r.aRevisar.find((x) => x.fila === 92);
    expect(agregada).toBeTruthy();
    expect(agregada.usuario).toContain("LAPTOP");
    expect(r.activos.some((a) => a.fila === 92)).toBe(false);
  });

  it("los códigos llegan sin espacios al inicio ni al final", () => {
    expect(r.activos.every((a) => a.codigo === a.codigo.trim() && a.codigo.length > 0)).toBe(true);
  });

  it("un modelo numérico se guarda como entero, no como decimal ni fecha", () => {
    const lenovo = r.activos.find((a) => a.codigo === "PROLT24");
    expect(lenovo.modelo).toBe("20392");
    expect(r.activos.every((a) => !/\.\d+$/.test(a.modelo))).toBe(true);
  });

  it("advierte las tres filas donde el prefijo del código contradice el detalle", () => {
    expect(r.advertenciasTipo.map((x) => x.codigo).sort()).toEqual(["PROLT09", "PROPC08", "PROPC40"]);
    expect(r.advertenciasTipo.map((x) => x.fila).sort((a, b) => a - b)).toEqual([17, 18, 62]);
  });

  it("serie repetida solo advierte valores con forma de número de serie", () => {
    const series = r.seriesRepetidas.map((s) => s.serie);
    expect(series).toContain("LNVNB161216"); // dos laptops con la misma serie real
    expect(series).not.toContain("INTEL CORE I3");
    expect(series).not.toContain("AMD RYZEN");
    expect(series).not.toContain("12TH GEN INTEL");
    const lnv = r.seriesRepetidas.find((s) => s.serie === "LNVNB161216");
    expect(lnv.codigos.sort()).toEqual(["PROLT04", "PROLT07"]);
  });

  it("la importación no vincula al maestro: el usuario queda como texto sin confirmar", () => {
    const servidor = r.activos.find((a) => a.codigo === "SERVIDOR");
    expect(servidor.usuario).toBe("SERVIDOR");
    const piso = r.activos.find((a) => a.codigo === "KONIKA COLOR");
    expect(piso.usuario).toBe("TERCER PISO");
  });

  it("concatena observaciones y componentes con ' · ' cuando hay ambos", () => {
    const conNota = r.activos.filter((a) => a.observaciones);
    expect(conNota.length).toBeGreaterThan(0);
    expect(r.activos.every((a) => !/^\s|\s$/.test(a.observaciones))).toBe(true);
  });
});

describe("parsearActivos con archivos inválidos", () => {
  it("un archivo sin la marca FORMATO 7.1 se rechaza entero con mensaje claro", () => {
    const malo = parsearActivos([["OTRA COSA"], [], ["datos"]]);
    expect(malo.errores.length).toBe(1);
    expect(malo.errores[0]).toMatch(/Formato 7\.1/i);
    expect(malo.activos).toEqual([]);
  });

  it("sin fila de encabezados se detiene con mensaje claro", () => {
    const sinEncabezados = parsearActivos([
      ['FORMATO 7.1: "REGISTRO DE ACTIVOS FIJOS"'], [], [], [],
      ["", "", "", "", "", "", "DENOMINACIÓN O RAZÓN SOCIAL:", "EMPRESA X"],
      [], ["solo", "datos", "sueltos"],
    ]);
    expect(sinEncabezados.errores.some((e) => /encabezados/i.test(e))).toBe(true);
    expect(sinEncabezados.activos).toEqual([]);
  });
});

describe("normalizarRazonSocial", () => {
  it("la denominación completa coincide con la forma corta del catálogo", () => {
    expect(normalizarRazonSocial("PROMANT SERVICIOS SOCIEDAD COMERCIAL DE RESPONSABILIDAD LIMITADA"))
      .toBe(normalizarRazonSocial("PROMANT SERVICIOS"));
    expect(normalizarRazonSocial("PROMANT SERVICIOS SOCIEDAD COMERCIAL DE RESPONSABILIDAD LIMITADA"))
      .toBe(normalizarRazonSocial("PROMANT SERVICIOS S.R.L."));
  });
  it("normaliza mayúsculas, acentos y espacios múltiples", () => {
    expect(normalizarRazonSocial("  Limpieza   Americana  S.A.C. "))
      .toBe(normalizarRazonSocial("LIMPIEZA AMERICANA SAC"));
  });
  it("dos razones sociales distintas no se confunden", () => {
    expect(normalizarRazonSocial("PROMANT SERVICIOS"))
      .not.toBe(normalizarRazonSocial("NEGLIAF S.R.L."));
  });
});
