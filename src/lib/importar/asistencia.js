// src/lib/importar/asistencia.js — parser del reporte de marcaciones del reloj
// de asistencia (spec Tarea 21-08). Guarda marcaciones; NO clasifica ausencias.
//
// Reglas clave del spec:
//  · Mapear POR POSICIÓN: los encabezados D/F ("ENTRADA") y E/G ("SALIDA") se
//    repiten; armar el mapa por nombre colapsaría dos pares en uno.
//  · Columnas: A CODIGO(num, pierde el cero) · C FECHA(texto ISO) ·
//    D,E,F,G las 4 marcaciones (texto HH:MM) · B/H vienen "S/N".
//  · Las filas separadoras traen guiones en A y el resto vacío → se descartan.
//  · Una fila sin marcación NO es una falta; solo se registra "sin marcación".
//  · El periodo sale de la fecha mín/máx de los datos, no del nombre del archivo.
//  · Los días futuros (fecha > hoy) no se importan; se informa cuántos.
//  · El código NO se rellena a longitud fija: la resolución contra el maestro
//    (quitando ceros) se hace en el RPC. Aquí se conserva el código tal cual y
//    su forma sin ceros para cotejar después.
import { leerXlsx } from "./xlsx.js";

const HORA_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const esSeparadora = (a) => /^-{2,}$/.test(String(a ?? "").trim());
const aMinutos = (hhmm) => {
  const m = HORA_RE.exec(String(hhmm ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
// Forma canónica para cotejar códigos: sin ceros a la izquierda (el maestro
// manda; DNI de 7→8 y CE de 9 se resuelven igual). "0" no desaparece del todo.
export const sinCeros = (cod) => String(cod ?? "").trim().replace(/^0+(?=\d)/, "");

// Analiza las filas ya leídas (función pura, testeable sin BD).
export function analizarAsistencia(filas, { umbralDobleMin = 15, hoy } = {}) {
  if (!Array.isArray(filas) || filas.length < 2) {
    throw new Error("El archivo de asistencia está vacío o no se pudo leer.");
  }
  const cab = (filas[0] ?? []).map((c) => String(c ?? "").trim().toUpperCase());
  // Detección por encabezados (posición): A CODIGO, C FECHA, y al menos 8 columnas.
  if (cab.length < 8 || cab[0] !== "CODIGO" || cab[2] !== "FECHA") {
    throw new Error("Este archivo no tiene el formato del reporte de marcaciones (CODIGO / FECHA / ENTRADA…).");
  }
  const hoyISO = hoy ?? new Date().toISOString().slice(0, 10);

  const registros = [];   // filas de datos parseadas
  let separadoras = 0;
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i] ?? [];
    const a = String(f[0] ?? "").trim();
    if (esSeparadora(a)) { separadoras++; continue; }
    if (a === "" && String(f[2] ?? "").trim() === "") continue; // fila totalmente vacía
    const codigo = a;
    const fecha = String(f[2] ?? "").trim();
    const crudas = [f[3], f[4], f[5], f[6]].map((c) => String(c ?? "").trim());
    const presentes = crudas.map((c) => c !== "");
    // Las marcaciones se llenan de izquierda a derecha; un hueco intermedio es
    // una anomalía a reportar (no se corrige inventando la que falta).
    const primerVacio = presentes.indexOf(false);
    const hueco = primerVacio !== -1 && presentes.slice(primerVacio).some((p) => p);
    const marcas = crudas.filter((c) => c !== "");
    const anomalias = [];
    const nMarcas = marcas.length;
    if (hueco) anomalias.push("hueco");
    if (nMarcas % 2 === 1) anomalias.push("incompleto");
    // Doble marcación: dos consecutivas separadas por menos del umbral.
    const mins = marcas.map(aMinutos);
    for (let k = 1; k < mins.length; k++) {
      if (mins[k] != null && mins[k - 1] != null && mins[k] - mins[k - 1] < umbralDobleMin && mins[k] - mins[k - 1] >= 0) {
        anomalias.push("doble"); break;
      }
    }
    // Salida anterior a entrada: orden invertido en la secuencia.
    for (let k = 1; k < mins.length; k++) {
      if (mins[k] != null && mins[k - 1] != null && mins[k] < mins[k - 1]) { anomalias.push("invertido"); break; }
    }
    // Jornada sin refrigerio: un solo par que abarca 12 h o más.
    if (nMarcas === 2 && mins[0] != null && mins[1] != null && mins[1] - mins[0] >= 12 * 60) {
      anomalias.push("sin_refrigerio");
    }
    registros.push({ codigo, codigoCanonico: sinCeros(codigo), fecha, marcas, nMarcas, anomalias, futura: fecha > hoyISO });
  }

  const fechas = registros.map((r) => r.fecha).filter(Boolean).sort();
  const codigos = [...new Set(registros.map((r) => r.codigo))];
  const importables = registros.filter((r) => !r.futura);

  const stats = {
    trabajadores: codigos.length,
    filasDatos: registros.length,
    separadoras,
    conCuatro: registros.filter((r) => r.nMarcas === 4).length,
    conDos: registros.filter((r) => r.nMarcas === 2).length,
    incompletos: registros.filter((r) => r.anomalias.includes("incompleto")).length,
    sinMarca: registros.filter((r) => r.nMarcas === 0).length,
    dobles: registros.filter((r) => r.anomalias.includes("doble")).length,
    sinRefrigerio: registros.filter((r) => r.anomalias.includes("sin_refrigerio")).length,
    invertidos: registros.filter((r) => r.anomalias.includes("invertido")).length,
    huecos: registros.filter((r) => r.anomalias.includes("hueco")).length,
    futurasDescartadas: registros.filter((r) => r.futura).length,
  };

  return {
    rango: { desde: fechas[0] ?? null, hasta: fechas[fechas.length - 1] ?? null },
    codigos,
    registros,
    importables,
    stats,
  };
}

// Lee el .xlsx (hoja "Worksheet") y lo analiza.
export async function parsearAsistencia(bytes, opts = {}) {
  const filas = await leerXlsx(bytes, { hoja: "Worksheet" });
  return analizarAsistencia(filas, opts);
}
