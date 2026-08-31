// Parser del CONTROL SEMANAL de asistencia en su formato actual (spec Tareas
// 31-08): el archivo que ya se produce se sube tal cual — el parser se adapta
// al archivo, no al revés. Se importa SOLO la hoja «Detalle Diario» (una fila
// por trabajador y día); «Resumen Mensual» no se importa: se RECALCULA desde
// el detalle y se contrasta contra el del archivo (mejor prueba de que el
// motor entiende lo mismo que quien lo preparó).
//
// Reglas clave:
//  · Una fila es de datos si la columna B trae documento (los banners de área
//    y los subtotales por trabajador no lo traen; jamás depender de celdas
//    combinadas ni posiciones).
//  · Cifra única: h:mm se guarda en MINUTOS; el decimal solo coteja (si
//    difieren, alguien editó una versión y no la otra → se reporta la fila).
//  · H.E. es la HORA DE ENTRADA del trabajador (no la jornada): una sola por
//    persona en el mes; se verifica que ENT1 − TardRaw = H.E.
//  · «Revisar» NO es falta; «Dia del reporte» = jornada parcial (solo vale la
//    tardanza); «Sin datos (post-reporte)» se descarta informando cuántas.
//  · Columnas W EDITADO / X MOTIVO son opcionales: sin ellas, nada fue
//    editado; con EDITADO=Si el motivo es obligatorio (se reporta si falta).
//  · Un TIPO fuera de la lista o dos H.E. distintas en el mismo trabajador
//    DETIENEN la lectura (spec: detenerse y preguntar).
import { sinCerosDoc } from "./padron.js";

const ENCABEZADOS = [
  "APELLIDOS Y NOMBRES", "DNI", "AREA", "FECHA", "DIA", "TIPO",
  "ENT 1", "SAL 1", "ENT 2", "SAL 2", "H.E.", "N",
  "Hrs Trab", "Hrs (dec)", "Horas Exceso", "Exceso (dec)",
  "Horas Deficit", "Deficit (dec)", "Tard Raw (min)", "Tard Efec (min)",
  "Tard Efec (h:mm)", "OBSERVACION",
];

const limpiar = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

// El TIPO viene con texto libre controlado; el feriado trae su nombre en el
// paréntesis y cambia cada mes: se extrae, jamás se compara el texto entero.
function clasificarTipo(texto) {
  const t = limpiar(texto);
  if (/^FERIADO\b/i.test(t)) {
    const m = /\(([^)]*)\)/.exec(t);
    return { tipo: "feriado", feriadoNombre: m ? limpiar(m[1]) : null };
  }
  const MAPA = {
    "Laborable": "laborable",
    "Sabado - libre": "sabado_libre",
    "Domingo - libre": "domingo_libre",
    "Sabado (trabajo)": "sabado_trabajo",
    "Domingo (trabajo)": "domingo_trabajo",
    "Dia del reporte": "reporte",
    "Revisar (sin marca)": "revisar",
    "Sin datos (post-reporte)": "descartada",
  };
  const tipo = MAPA[t];
  if (!tipo) throw new Error(`Valor de TIPO fuera de la lista: «${t}». Detén la importación y confírmalo.`);
  return { tipo, feriadoNombre: null };
}

// «HH:MM» → minutos enteros (null si vacío o ilegible).
export const aMinutos = (v) => {
  const m = /^(\d{1,3}):([0-5]\d)$/.exec(limpiar(v));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const aNumero = (v) => (v === "" || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

// h:mm (col canónica) contra su copia decimal en horas: ±1 minuto de gracia
// por redondeo. Devuelve null si cuadran o no hay con qué cotejar.
const cotejar = (minutos, dec) => {
  const esperado = dec == null ? null : Math.round(dec * 60);
  if (minutos == null || esperado == null) return null;
  return Math.abs(minutos - esperado) > 1 ? esperado : null;
};

export function parsearControlSemanal(filasDetalle, filasResumen = null) {
  const cab = (filasDetalle?.[0] ?? []).map(limpiar);
  const coincide = ENCABEZADOS.every((e, i) => cab[i] === e);
  if (!coincide) {
    throw new Error("El archivo no tiene el formato del control semanal (hoja «Detalle Diario» con " +
      "APELLIDOS Y NOMBRES, DNI, …, OBSERVACION). No se interpreta.");
  }
  const tieneEditado = cab[22] === "EDITADO";

  const registros = [];
  const reportadas = [];   // filas que se importan pero con inconsistencia que revisar
  const errores = [];      // filas que NO se importan
  const porDoc = new Map();  // documento → {he:Set, nombreArchivo, area, dias, postRep, registros[]}
  let descartadas = 0;

  filasDetalle.slice(1).forEach((cruda, idx) => {
    const fila = idx + 2; // número de fila visible en el Excel
    const documento = limpiar(cruda[1]);
    if (!documento) return; // banner de área, subtotal o fila vacía

    if (!porDoc.has(documento)) {
      porDoc.set(documento, {
        documento, docSinCeros: sinCerosDoc(documento),
        nombreArchivo: limpiar(cruda[0]), area: limpiar(cruda[2]),
        he: new Set(), dias: 0, postRep: 0, registros: [],
      });
    }
    const trab = porDoc.get(documento);

    const { tipo, feriadoNombre } = clasificarTipo(cruda[5]);
    const heTexto = limpiar(cruda[10]);
    if (heTexto) trab.he.add(heTexto);

    if (tipo === "descartada") { descartadas++; trab.postRep++; return; }

    const fecha = limpiar(cruda[3]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      errores.push({ fila, error: `Fecha ilegible «${fecha}» (se espera AAAA-MM-DD).` });
      return;
    }

    const [m1, m2, m3, m4] = [6, 7, 8, 9].map((c) => limpiar(cruda[c]) || null);
    const minTrab = aMinutos(cruda[12]);
    const minExceso = aMinutos(cruda[14]);
    const minDeficit = aMinutos(cruda[16]);
    const tardRaw = aNumero(cruda[18]);
    const tardEfec = aNumero(cruda[19]);

    // Cotejo h:mm ↔ decimal (y Tard Efec ↔ su copia h:mm): un solo valor manda.
    for (const [nombre, min, dec] of [
      ["Hrs Trab", minTrab, aNumero(cruda[13])],
      ["Horas Exceso", minExceso, aNumero(cruda[15])],
      ["Horas Deficit", minDeficit, aNumero(cruda[17])],
    ]) {
      const otro = cotejar(min, dec);
      if (otro != null) {
        reportadas.push({ fila, documento, fecha, motivo:
          `${nombre} difiere de su copia decimal (${min} min vs ${otro} min): alguien editó una versión y no la otra.` });
      }
    }
    const efecHmm = aMinutos(cruda[20]);
    if (tardEfec != null && efecHmm != null && tardEfec !== efecHmm) {
      reportadas.push({ fila, documento, fecha, motivo:
        `Tard Efec difiere de su copia h:mm (${tardEfec} vs ${efecHmm} min).` });
    }

    // H.E. se verifica restando la tardanza cruda a la primera marca.
    const heMin = aMinutos(heTexto);
    const m1Min = aMinutos(m1);
    if (heMin != null && m1Min != null && tardRaw != null) {
      const cuadra = (m1Min - tardRaw === heMin) || (tardRaw === 0 && m1Min <= heMin);
      if (!cuadra) {
        reportadas.push({ fila, documento, fecha, motivo:
          `La H.E. (${heTexto}) no cuadra con ENT1 − tardanza cruda (${m1} − ${tardRaw} min).` });
      }
    }

    // Marcaciones corregidas a mano: sin motivo son indistinguibles de las
    // inventadas. Mientras las columnas no existan, nada fue editado.
    let editado = false, motivoEdicion = null;
    if (tieneEditado) {
      editado = /^si$/i.test(limpiar(cruda[22]).replace("í", "i"));
      motivoEdicion = limpiar(cruda[23]) || null;
      if (editado && !motivoEdicion) {
        reportadas.push({ fila, documento, fecha, motivo:
          "EDITADO dice Si sin MOTIVO DE EDICION: una corrección sin motivo no se puede defender." });
      }
    }

    trab.dias++;
    const registro = {
      documento, docSinCeros: trab.docSinCeros, fecha, tipo, feriadoNombre,
      m1, m2, m3, m4, he: heTexto || null,
      minTrab, minExceso, minDeficit, tardRaw, tardEfec,
      observacion: limpiar(cruda[21]) || null, editado, motivoEdicion,
    };
    registros.push(registro);
    trab.registros.push(registro);
  });

  // Una sola hora de entrada por trabajador en el mes (spec §3).
  for (const t of porDoc.values()) {
    if (t.he.size > 1) {
      throw new Error(`${t.nombreArchivo} (${t.documento}) trae ${t.he.size} horas de entrada distintas ` +
        `en el mismo mes (${[...t.he].join(", ")}). Detén la importación y confírmalo.`);
    }
  }

  const fechas = registros.map((x) => x.fecha).sort();
  const trabajadores = [...porDoc.values()].map((t) => ({
    documento: t.documento, docSinCeros: t.docSinCeros,
    nombreArchivo: t.nombreArchivo, area: t.area,
    he: t.he.size ? [...t.he][0] : null, dias: t.dias, postRep: t.postRep,
  }));

  return {
    rango: fechas.length ? { desde: fechas[0], hasta: fechas[fechas.length - 1] } : null,
    trabajadores, registros, descartadas, reportadas, errores,
    contrasteResumen: filasResumen ? contrastarResumen(porDoc, filasResumen) : null,
  };
}

// --- Resumen Mensual: se RECALCULA desde el detalle declarado y se coteja ---
// Derivaciones verificadas contra la muestra de agosto:
//  · Dias Trab (L-V) = laborables con al menos una marca; 4 Marcas e
//    Incompletos lo parten. · El total de horas suma TODO (laborables + fin
//    de semana trabajado); exceso/déficit solo laborables; F.Sem repite lo
//    del fin de semana por separado. · Dias Tardanza cuenta
//    tardanza EFECTIVA > 0; Tolerancia (dias) cuenta días perdonados
//    (raw > efec) — un día de 3 minutos consume tolerancia aunque quede en
//    cero. · Min Ahorrados = raw − efec. · Vac/Com/DM: tipos aún no vistos.
const hmm = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;

function recalcularResumen(t) {
  const marcas = (x) => [x.m1, x.m2, x.m3, x.m4].filter(Boolean).length;
  const lab = t.registros.filter((x) => x.tipo === "laborable");
  const labMarcas = lab.filter((x) => marcas(x) > 0);
  const fsem = t.registros.filter((x) => x.tipo === "sabado_trabajo" || x.tipo === "domingo_trabajo");
  const suma = (xs, k) => xs.reduce((n, x) => n + (x[k] ?? 0), 0);
  const raw = suma(t.registros, "tardRaw");
  const efec = suma(t.registros, "tardEfec");
  return {
    "Dias Trab (L-V)": labMarcas.length,
    "4 Marcas": labMarcas.filter((x) => marcas(x) === 4).length,
    "Incompletos": labMarcas.filter((x) => marcas(x) < 4).length,
    "Total Horas Trabajadas": suma(t.registros, "minTrab"),
    "Horas Exceso": suma(lab, "minExceso"),
    "Horas Deficit": suma(lab, "minDeficit"),
    "Dias Tardanza": t.registros.filter((x) => (x.tardEfec ?? 0) > 0).length,
    "Tard Raw (min)": raw,
    "Tard Efec (min)": efec,
    "Tolerancia (dias)": t.registros.filter((x) => (x.tardRaw ?? 0) > (x.tardEfec ?? 0)).length,
    "Min Ahorrados": raw - efec,
    "F.Sem Dias": fsem.length,
    "F.Sem Hrs": suma(fsem, "minTrab"),
    "Feriados": t.registros.filter((x) => x.tipo === "feriado").length,
    "Reporte": t.registros.filter((x) => x.tipo === "reporte").length,
    "Post-Rep": t.postRep,
    "Revisar": t.registros.filter((x) => x.tipo === "revisar").length,
    "Vac": 0, "Com": 0, "DM": 0,
  };
}

// Columnas del archivo → cómo leerlas (las decimales y las copias h:mm no se
// cotejan aquí: duplican columnas ya contrastadas en el detalle).
const COLS_RESUMEN = [
  [3, "Dias Trab (L-V)", aNumero], [4, "4 Marcas", aNumero], [5, "Incompletos", aNumero],
  [6, "Total Horas Trabajadas", aMinutos], [8, "Horas Exceso", aMinutos],
  [10, "Horas Deficit", aMinutos], [12, "Dias Tardanza", aNumero],
  [13, "Tard Raw (min)", aNumero], [14, "Tard Efec (min)", aNumero],
  [16, "Tolerancia (dias)", aNumero], [17, "Min Ahorrados", aNumero],
  [18, "F.Sem Dias", aNumero], [19, "F.Sem Hrs", aMinutos],
  [20, "Feriados", aNumero], [21, "Reporte", aNumero], [22, "Post-Rep", aNumero],
  [23, "Revisar", aNumero], [24, "Vac", aNumero], [25, "Com", aNumero], [26, "DM", aNumero],
];

function contrastarResumen(porDoc, filasResumen) {
  const diferencias = [];
  const esHoras = new Set(["Total Horas Trabajadas", "Horas Exceso", "Horas Deficit", "F.Sem Hrs"]);
  for (const f of filasResumen.slice(1)) {
    const documento = limpiar(f[1]);
    if (!documento) continue; // encabezado de área o TOTAL
    const t = porDoc.get(documento);
    if (!t) {
      diferencias.push({ documento, columna: "(fila)", archivo: limpiar(f[0]), recalculado: "no está en el detalle" });
      continue;
    }
    const propio = recalcularResumen(t);
    for (const [col, nombre, leer] of COLS_RESUMEN) {
      const archivo = leer(f[col]) ?? 0;
      const nuestro = propio[nombre];
      if (archivo !== nuestro) {
        diferencias.push({
          documento, columna: nombre,
          archivo: esHoras.has(nombre) ? hmm(archivo) : archivo,
          recalculado: esHoras.has(nombre) ? hmm(nuestro) : nuestro,
        });
      }
    }
  }
  return diferencias;
}
