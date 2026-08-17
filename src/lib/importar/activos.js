// src/lib/importar/activos.js — parser del Formato 7.1 de SUNAT ("Registro de
// Activos Fijos") usado por el grupo como inventario operativo. No es una hoja
// limpia: cabecera de reporte, encabezados repartidos en CUATRO filas apiladas
// con celdas combinadas, separadoras de área, filas agregadas y totales al pie.
// Todo se localiza por CONTENIDO, nunca por posición fija.
import { normalizar } from "./planilla.js";

// La comparación contra el catálogo de empresas ignora mayúsculas, acentos,
// espacios múltiples y la forma societaria completa o abreviada: el archivo
// trae "… SOCIEDAD COMERCIAL DE RESPONSABILIDAD LIMITADA" y el catálogo suele
// tener la forma corta (incluso sin sufijo).
const FORMAS_SOCIETARIAS = [
  "SOCIEDAD COMERCIAL DE RESPONSABILIDAD LIMITADA",
  "SOCIEDAD DE RESPONSABILIDAD LIMITADA",
  "SOCIEDAD ANONIMA CERRADA", "SOCIEDAD ANONIMA ABIERTA", "SOCIEDAD ANONIMA",
  "S C R L", "S R L", "S A C", "S A A", "E I R L", "S A",
  "SCRL", "SRL", "SAC", "SAA", "EIRL", "SA",
];
export function normalizarRazonSocial(s) {
  let n = normalizar(String(s ?? "").replace(/[.,]/g, " "));
  for (const f of FORMAS_SOCIETARIAS) {
    if (n.endsWith(` ${f}`)) { n = n.slice(0, -(f.length + 1)).trimEnd(); break; }
  }
  return n;
}

// Resuelve la razón social del archivo contra el catálogo dentro del alcance
// del usuario. La del archivo MANDA (no es un selector). Fuera del catálogo y
// fuera del alcance producen EXACTAMENTE el mismo rechazo: no se revela si la
// empresa existe. Retirada dentro del alcance sí se dice (no filtra nada).
const RECHAZO_GENERICO = (razon) =>
  `La razón social del archivo («${razon}») no corresponde a ninguna empresa disponible. Importación rechazada: ningún activo se aplica.`;

export function resolverEmpresaArchivo(razonSocial, empresas, acceso) {
  const objetivo = normalizarRazonSocial(razonSocial);
  const empresa = empresas.find((e) => normalizarRazonSocial(e.nombre) === objetivo);
  if (!empresa) return { rechazo: RECHAZO_GENERICO(razonSocial) };
  const alcanzada = acceso?.esSuperadmin || (acceso?.empresas ?? []).includes(empresa.id);
  if (!alcanzada) return { rechazo: RECHAZO_GENERICO(razonSocial) };
  if ((empresa.estado ?? "activa") === "retirada") {
    return { rechazo: `${empresa.nombre} está retirada del grupo: no admite importaciones.` };
  }
  return { empresa };
}

// "Forma de número de serie": la columna trae sobre todo procesadores y
// fabricantes (INTEL CORE I3, AMD RYZEN…). Solo se cruza serie repetida cuando
// el valor parece una serie de verdad: largo, con varios dígitos y sin
// espacios (ningún procesador cumple las tres a la vez).
const esSerieReal = (s) => s.length >= 8 && (s.match(/\d/g) ?? []).length >= 2 && !s.includes(" ");

// El modelo puede venir numérico ("20392.0"): entero sin decimales, jamás
// fecha ni notación científica.
const formatearModelo = (s) => (/^\d+\.0+$/.test(s) ? s.split(".")[0] : s);

const PALABRAS_ENCABEZADO = /(USUARIO|CODIGO|ACTIVO|DETALLE|DESCRIPCION|MARCA|MODELO|SERIE|PLACA|OBSERVACIO|COMPONENTE)/;
const FILAS_ENCABEZADO = 4; // el Formato 7.1 apila los encabezados en 4 filas

export function parsearActivos(filas, { recodificarImpresoras = true } = {}) {
  const r = {
    razonSocial: null, errores: [], activos: [], aRevisar: [],
    duplicados: [], seriesRepetidas: [], advertenciasTipo: [], areas: [],
    recodificados: [],
  };
  const celda = (fila, col) => (col >= 0 ? String(fila?.[col] ?? "").trim() : "");

  // 1 · Es el Formato 7.1: la marca vive en la cabecera del reporte.
  if (!filas.slice(0, 3).some((f) => (f ?? []).join(" ").includes("FORMATO 7.1"))) {
    r.errores.push('El archivo no es el Formato 7.1 ("REGISTRO DE ACTIVOS FIJOS"): no encuentro esa marca en la cabecera.');
    return r;
  }

  // 2 · Razón social: la celda no vacía a la derecha de la etiqueta.
  for (const f of filas.slice(0, 8)) {
    const i = (f ?? []).findIndex((c) => normalizar(c).includes("DENOMINACION O RAZON SOCIAL"));
    if (i >= 0) {
      r.razonSocial = (f.slice(i + 1).map((c) => String(c ?? "").trim()).find(Boolean)) ?? null;
      break;
    }
  }

  // 3 · Encabezados por contenido: la fila donde conviven USUARIO y CÓDIGO.
  const iEnc = filas.findIndex((f) =>
    (f ?? []).some((c) => normalizar(c) === "USUARIO") &&
    (f ?? []).some((c) => normalizar(c).includes("CODIGO")));
  if (iEnc < 0) {
    r.errores.push("No encuentro la fila de encabezados (USUARIO / CÓDIGO / DETALLE…). ¿Es el Formato 7.1 exportado a Excel?");
    return r;
  }

  // Texto apilado de cada columna (las 4 filas de encabezado concatenadas).
  const apilado = [];
  for (let j = iEnc; j < iEnc + FILAS_ENCABEZADO; j++) {
    (filas[j] ?? []).forEach((c, colIdx) => {
      apilado[colIdx] = `${apilado[colIdx] ?? ""} ${normalizar(c)}`.trim();
    });
  }
  const buscarCol = (condicion) => apilado.findIndex((t) => t && condicion(t));
  const col = {
    usuario: buscarCol((t) => t.includes("USUARIO") && !t.includes("ANTERIOR")),
    codigo: buscarCol((t) => t.includes("CODIGO")),
    detalle: buscarCol((t) => t.includes("DETALLE") || t.includes("DESCRIPCION")),
    marca: buscarCol((t) => t.includes("MARCA")),
    modelo: buscarCol((t) => t.includes("MODELO") && !t.includes("MARCA")),
    serie: buscarCol((t) => t.includes("SERIE") || t.includes("PLACA")),
    usuarioAnterior: buscarCol((t) => t.includes("USUARIO ANTERIOR")),
    observaciones: buscarCol((t) => t.includes("OBSERVACIO")),
    componentes: buscarCol((t) => t.includes("COMPONENTE")),
  };
  // Correlativo: la columna a la izquierda de USUARIO con más celdas numéricas
  // en la zona de datos (en la muestra, la B: 1.0, 2.0…).
  let correlativoCol = -1, mejorConteo = 0;
  for (let c = 0; c < col.usuario; c++) {
    let n = 0;
    for (let i = iEnc + FILAS_ENCABEZADO; i < filas.length; i++) {
      if (/^\d+(\.\d+)?$/.test(celda(filas[i], c))) n++;
    }
    if (n > mejorConteo) { mejorConteo = n; correlativoCol = c; }
  }

  // 4 · Recorrido de datos. La separadora inicial puede compartir la ÚLTIMA
  // fila de encabezados (caso RRHH en la muestra).
  let area = null;
  const inicial = celda(filas[iEnc + FILAS_ENCABEZADO - 1], col.usuario);
  if (inicial && !PALABRAS_ENCABEZADO.test(normalizar(inicial))) {
    area = inicial;
    r.areas.push(inicial);
  }

  for (let i = iEnc + FILAS_ENCABEZADO; i < filas.length; i++) {
    const fila = filas[i] ?? [];
    if (!fila.some((c) => String(c ?? "").trim())) continue; // vacía
    const usuario = celda(fila, col.usuario);
    const codigo = celda(fila, col.codigo);
    const correlativo = celda(fila, correlativoCol);
    // Pie del reporte: desde la primera fila de TOTAL, todo lo demás son
    // conteos y rótulos de resumen. Nada de ahí es un activo.
    if (normalizar(usuario).startsWith("TOTAL") || normalizar(codigo).startsWith("TOTAL")) break;

    const hayCorrelativo = /^\d+(\.\d+)?$/.test(correlativo);
    if (hayCorrelativo && codigo) {
      // Un activo: correlativo en su columna Y código. Ambas cosas.
      const partes = [celda(fila, col.observaciones), celda(fila, col.componentes)].filter(Boolean);
      r.activos.push({
        fila: i + 1,
        correlativo,
        codigo,
        tipo: celda(fila, col.detalle),
        marca: celda(fila, col.marca),
        modelo: formatearModelo(celda(fila, col.modelo)),
        serie: celda(fila, col.serie),
        serieReal: esSerieReal(celda(fila, col.serie)),
        usuario,
        usuarioAnterior: celda(fila, col.usuarioAnterior),
        area,
        observaciones: partes.join(" · "),
      });
    } else if (hayCorrelativo && !codigo) {
      // Fila agregada (varios equipos en un renglón) o sin código: a revisar,
      // jamás un activo.
      r.aRevisar.push({
        fila: i + 1,
        motivo: "Tiene correlativo pero no código: puede representar varios equipos en un solo renglón.",
        usuario,
        observaciones: celda(fila, col.observaciones),
      });
    } else if (!hayCorrelativo && !codigo && usuario) {
      // Separadora de área: su valor acompaña a todas las filas siguientes.
      area = usuario;
      r.areas.push(usuario);
    }
    // Cualquier otra cosa (restos de encabezado, rótulos sueltos) se ignora.
  }

  // 5 · Recodificación de impresoras por número de serie (decisión de Diego,
  // 2026-08-17): marca+año no identifica un equipo, la serie sí. Solo
  // impresoras con serie de forma real; el código del archivo queda en
  // observaciones y en codigoArchivo. Corre ANTES de detectar duplicados:
  // con esto los choques EPSON+año del archivo real quedan resueltos.
  if (recodificarImpresoras) {
    for (const a of r.activos) {
      if (!normalizar(a.tipo).includes("IMPRESORA") || !a.serieReal) continue;
      r.recodificados.push({ fila: a.fila, codigoArchivo: a.codigo, codigo: a.serie });
      a.codigoArchivo = a.codigo;
      a.codigo = a.serie;
      a.observaciones = [a.observaciones, `Código del archivo: ${a.codigoArchivo}`]
        .filter(Boolean).join(" · ");
    }
  }

  // 6 · Duplicados dentro del archivo (bloqueantes): mismo código 2+ veces.
  const porCodigo = new Map();
  for (const a of r.activos) {
    if (!porCodigo.has(a.codigo)) porCodigo.set(a.codigo, []);
    porCodigo.get(a.codigo).push(a);
  }
  for (const [codigo, grupo] of porCodigo) {
    if (grupo.length > 1) {
      r.duplicados.push({
        codigo,
        filas: grupo.map((a) => a.fila),
        usuarios: grupo.map((a) => a.usuario),
      });
    }
  }

  // 7 · Serie repetida (advertencia): dos códigos DISTINTOS con la misma serie
  // con forma real. Probablemente el mismo equipo cargado dos veces.
  const porSerie = new Map();
  for (const a of r.activos) {
    if (!a.serieReal) continue;
    if (!porSerie.has(a.serie)) porSerie.set(a.serie, []);
    porSerie.get(a.serie).push(a);
  }
  for (const [serie, grupo] of porSerie) {
    const codigos = [...new Set(grupo.map((a) => a.codigo))];
    if (codigos.length > 1) {
      r.seriesRepetidas.push({ serie, codigos, filas: grupo.map((a) => a.fila) });
    }
  }

  // 8 · Validación cruzada: el prefijo del código declara el tipo. Se advierte,
  // no se corrige: cualquiera de los dos campos puede ser el equivocado.
  for (const a of r.activos) {
    const tipo = normalizar(a.tipo);
    const contradice =
      (a.codigo.startsWith("PROLT") && tipo.includes("PC") && !tipo.includes("LAPTOP")) ||
      (a.codigo.startsWith("PROPC") && tipo.includes("LAPTOP"));
    if (contradice) {
      r.advertenciasTipo.push({ fila: a.fila, codigo: a.codigo, tipo: a.tipo });
    }
  }

  return r;
}
