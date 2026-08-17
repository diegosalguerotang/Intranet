import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { leerXlsx } from "../../src/lib/importar/xlsx.js";
import { parsearActivos, normalizarRazonSocial, resolverEmpresaArchivo } from "../../src/lib/importar/activos.js";

// Criterios de aceptación de Importacion_Activos.docx, verificados contra el
// archivo de muestra real (Formato 7.1 SUNAT usado como inventario).
// `crudo` = el archivo tal cual (los criterios del doc se escribieron sobre
// él); `r` = comportamiento del producto, con la recodificación de impresoras
// por número de serie que Diego decidió el 2026-08-17.
let filas, r, crudo;
beforeAll(async () => {
  filas = await leerXlsx(
    new Uint8Array(readFileSync("tests/fixtures/EQUIPOS_DE_COMPUTO_ACTIVOS_FIJOS.xlsx")),
    { hoja: "AF EQUIPO DE COMPUTO" }
  );
  r = parsearActivos(filas);
  crudo = parsearActivos(filas, { recodificarImpresoras: false });
});

describe("parsearActivos con el fixture real", () => {
  it("valida el Formato 7.1 y extrae la razón social de la cabecera", () => {
    expect(r.errores).toEqual([]);
    expect(r.razonSocial).toBe("PROMANT SERVICIOS SOCIEDAD COMERCIAL DE RESPONSABILIDAD LIMITADA");
  });

  it("detecta 72 filas de activo y 65 códigos únicos (archivo tal cual)", () => {
    expect(crudo.activos.length).toBe(72);
    // El código DEL ARCHIVO: los sufijos -R2 de las repeticiones son del
    // sistema, no del archivo (codigoArchivo conserva el original).
    expect(new Set(crudo.activos.map((a) => a.codigoArchivo ?? a.codigo)).size).toBe(65);
  });

  it("reporta los cinco códigos duplicados del archivo tal cual", () => {
    const porCodigo = Object.fromEntries(crudo.duplicados.map((d) => [d.codigo, d]));
    expect(Object.keys(porCodigo).sort()).toEqual(
      ["EPSON 2025", "EPSON2018", "EPSON2019", "EPSON2024", "PROLT51"]
    );
    expect(porCodigo.EPSON2018.filas.length).toBe(3);
    expect(porCodigo.EPSON2024.filas.length).toBe(3);
    expect(porCodigo["EPSON 2025"].filas.length).toBe(2);
    expect(porCodigo.EPSON2019.filas.length).toBe(2);
  });

  it("cada duplicado trae las filas implicadas y el usuario de cada una", () => {
    const prolt51 = crudo.duplicados.find((d) => d.codigo === "PROLT51");
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

// Decisión de Diego (2026-08-17): las impresoras se codifican por número de
// serie — EPSON+año no identifica un equipo. La recodificación es el
// comportamiento por defecto del producto.
describe("recodificación de impresoras por número de serie", () => {
  it("recodifica las 11 impresoras con serie real y lo reporta", () => {
    expect(r.recodificados.length).toBe(11);
    const f79 = r.recodificados.find((x) => x.fila === 79);
    expect(f79.codigoArchivo).toBe("EPSON2018");
    expect(f79.codigo).toBe("S42K314023");
  });

  it("el activo recodificado usa la serie como código y conserva el del archivo en observaciones", () => {
    const imp = r.activos.find((a) => a.fila === 79);
    expect(imp.codigo).toBe("S42K314023");
    expect(imp.codigoArchivo).toBe("EPSON2018");
    expect(imp.observaciones).toContain("EPSON2018");
  });

  it("los duplicados de impresoras quedan resueltos: solo PROLT51 sigue repetido", () => {
    expect(r.duplicados.map((d) => d.codigo)).toEqual(["PROLT51"]);
  });

  it("una impresora sin serie real conserva el código del archivo", () => {
    const zebra = r.activos.find((a) => a.fila === 84);
    expect(zebra.codigo).toBe("ZEBRA2024");
    expect(zebra.codigoArchivo).toBeUndefined();
  });

  it("las fotocopiadoras no se recodifican", () => {
    expect(r.activos.find((a) => a.fila === 88).codigo).toBe("KONIKA COLOR");
  });

});

// Decisión de Diego (2026-08-17, segunda): un código repetido dentro del
// archivo ya NO bloquea la importación — entra marcado «repetido, falta
// corregir». Como el código es la identidad, las repeticiones reciben un
// código provisional con sufijo -R2, -R3… hasta la corrección definitiva.
describe("códigos repetidos entran marcados «falta corregir»", () => {
  it("las dos filas PROLT51 se importan: la primera con su código, la segunda con sufijo", () => {
    const f20 = r.activos.find((a) => a.fila === 20);
    const f67 = r.activos.find((a) => a.fila === 67);
    expect(f20.codigo).toBe("PROLT51");
    expect(f67.codigo).toBe("PROLT51-R2");
    expect(f67.codigoArchivo).toBe("PROLT51");
  });
  it("ambas ocurrencias quedan marcadas como repetido", () => {
    expect(r.activos.find((a) => a.fila === 20).repetido).toBe(true);
    expect(r.activos.find((a) => a.fila === 67).repetido).toBe(true);
    expect(r.activos.filter((a) => a.repetido).length).toBe(2);
  });
  it("tras el sufijo no queda ningún código duplicado en el resultado", () => {
    expect(new Set(r.activos.map((a) => a.codigo)).size).toBe(r.activos.length);
  });
  it("el aviso de duplicado sigue reportándose con las filas y usuarios", () => {
    const d = r.duplicados.find((x) => x.codigo === "PROLT51");
    expect(d.filas).toEqual([20, 67]);
    expect(d.usuarios).toEqual(["FABRIZZIO NUEVA", "CHRISTIAN CHAMBI"]);
  });
  it("las filas no repetidas no llevan la marca", () => {
    expect(r.activos.find((a) => a.codigo === "PROLT01").repetido).toBe(false);
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

describe("resolverEmpresaArchivo", () => {
  const CATALOGO = [
    { id: "promant", nombre: "PROMANT SERVICIOS", estado: "activa" },
    { id: "negliaf", nombre: "NEGLIAF S.R.L.", estado: "activa" },
    { id: "bremco", nombre: "BREMCO S.C.R.L.", estado: "retirada" },
  ];
  const DENOMINACION = "PROMANT SERVICIOS SOCIEDAD COMERCIAL DE RESPONSABILIDAD LIMITADA";
  const superadmin = { esSuperadmin: true, empresas: [] };

  it("la denominación completa del archivo resuelve a la empresa del catálogo", () => {
    const r = resolverEmpresaArchivo(DENOMINACION, CATALOGO, superadmin);
    expect(r.empresa.id).toBe("promant");
  });
  it("una razón social fuera del catálogo se rechaza entera", () => {
    const r = resolverEmpresaArchivo("EMPRESA FANTASMA S.A.C.", CATALOGO, superadmin);
    expect(r.rechazo).toBeTruthy();
    expect(r.empresa).toBeUndefined();
  });
  it("fuera del alcance del usuario se deniega con EL MISMO mensaje, sin revelar si existe", () => {
    const limitado = { esSuperadmin: false, empresas: ["negliaf"] };
    const fueraAlcance = resolverEmpresaArchivo(DENOMINACION, CATALOGO, limitado);
    const noExiste = resolverEmpresaArchivo("EMPRESA FANTASMA S.A.C.", CATALOGO, limitado);
    // El mensaje solo puede hacer eco de lo que el usuario subió (la razón del
    // archivo): quitada esa parte, ambos rechazos son EL MISMO texto.
    const plantilla = (m) => m.replace(/«[^»]*»/, "«…»");
    expect(plantilla(fueraAlcance.rechazo)).toBe(plantilla(noExiste.rechazo));
    expect(fueraAlcance.empresa).toBeUndefined();
  });
  it("dentro del alcance no superadmin sí resuelve", () => {
    const limitado = { esSuperadmin: false, empresas: ["promant"] };
    expect(resolverEmpresaArchivo(DENOMINACION, CATALOGO, limitado).empresa.id).toBe("promant");
  });
  it("una empresa retirada dentro del alcance se rechaza diciéndolo", () => {
    const r = resolverEmpresaArchivo("BREMCO S.C.R.L.", CATALOGO, superadmin);
    expect(r.rechazo).toMatch(/retirada/i);
  });
});
