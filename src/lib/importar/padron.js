// Parser del padrón unificado en su formato DEFINITIVO (spec Tareas 31-08):
// 12 columnas con centro de costo y cargo, tres razones sociales resueltas por
// RUC, sin datos bancarios. Reemplaza a PLATRA1 y al unificado con banco: es el
// único formato que RRH-05 reconoce de aquí en adelante. Puro y síncrono sobre
// las filas de leerXlsx, como los demás importadores del proyecto.

// Encabezados exactos del formato (A:L, fila 1). Si no coinciden en posición,
// el archivo no se interpreta: se dice y se detiene.
const ENCABEZADOS = [
  "EMPRESA", "RUC", "CÓDIGO", "NOMBRES", "TIPO DE DOCUMENTO", "N DOC",
  "SEXO", "CENTRO DE COSTO", "AREA", "CARGO", "F. INGRESO", "SITUACION",
];

const limpiar = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

// Comparación de documentos contra el maestro: quitar ceros a la IZQUIERDA en
// ambos lados; la forma canónica es la del maestro. Jamás rellenar a longitud
// fija (rompería el CE 003308122). Mayúsculas por los alfanuméricos.
export const sinCerosDoc = (doc) => limpiar(doc).toUpperCase().replace(/^0+(?=.)/, "");

const TIPOS_DOC = { DNI: /^[0-9]{8}$/, CE: /^[0-9A-Z]{9,12}$/, PASAPORTE: /^[0-9A-Z]{6,15}$/ };

// dd/mm/aa (regla de siglo acordada: 00-50 → 2000-2050, 51-99 → 1951-1999) o
// dd/mm/aaaa. Devuelve 'AAAA-MM-DD' o null si no es una fecha real.
function fechaISO(texto) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(limpiar(texto));
  if (!m) return null;
  const dia = Number(m[1]), mes = Number(m[2]);
  let anio = Number(m[3]);
  if (m[3].length === 2) anio += anio <= 50 ? 2000 : 1900;
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export function parsearPadron(filas) {
  const encabezado = (filas?.[0] ?? []).map(limpiar).map((s) => s.toUpperCase());
  const coincide = ENCABEZADOS.length <= encabezado.length &&
    ENCABEZADOS.every((e, i) => encabezado[i] === e);
  if (!coincide) {
    throw new Error(
      "El archivo no tiene el formato del padrón de planilla (12 columnas: " +
      ENCABEZADOS.join(", ") + "). No se interpreta.");
  }

  const resultado = [];
  const errores = [];
  const vistos = new Map(); // ruc → Set de documentos sin ceros (repetido en la misma RS = error)

  filas.slice(1).forEach((cruda, i) => {
    const fila = i + 2; // número de fila visible en el Excel
    const c = (n) => limpiar(cruda[ENCABEZADOS.indexOf(n)]);
    if (ENCABEZADOS.every((e) => c(e) === "")) return; // fila totalmente vacía
    const falla = (error) => errores.push({ fila, error });

    const razonSocial = c("EMPRESA");
    const ruc = c("RUC");
    const codigo = c("CÓDIGO").toUpperCase();
    const nombre = c("NOMBRES");
    const tipoTexto = c("TIPO DE DOCUMENTO").toUpperCase();
    const tipoDocumento = tipoTexto === "CE" ? "CE" : tipoTexto.startsWith("PAS") ? "Pasaporte" : "DNI";
    const documento = c("N DOC").toUpperCase();
    const sexo = c("SEXO").toUpperCase();
    const situacion = c("SITUACION").toUpperCase();

    if (!/^[0-9]{11}$/.test(ruc)) return falla(`El RUC «${ruc}» no tiene 11 dígitos.`);
    if (!nombre) return falla("Sin nombre.");
    if (!TIPOS_DOC[tipoDocumento.toUpperCase()].test(documento)) {
      return falla(`El documento «${documento}» no es válido para el tipo ${tipoDocumento}.`);
    }
    if (codigo !== documento) {
      // Campos distintos que HOY coinciden en todas las filas: si difieren, a mano.
      return falla(`El CÓDIGO «${codigo}» difiere del documento «${documento}» — revísalo a mano.`);
    }
    if (sexo !== "M" && sexo !== "F") return falla(`Sexo «${sexo}» no reconocido (M o F).`);
    if (situacion !== "VIGENTE") {
      // El archivo viene filtrado por VIGENTE: otro valor es una excepción a revisar.
      return falla(`Situación «${situacion}» distinta de VIGENTE — el archivo debe venir filtrado.`);
    }
    const fechaIngreso = fechaISO(c("F. INGRESO"));
    if (!fechaIngreso) return falla(`La fecha de ingreso «${c("F. INGRESO")}» no se puede interpretar (dd/mm/aa).`);

    // Repetido dentro de la MISMA razón social = error de fila; en empresas
    // distintas es válido (dos vínculos).
    const clave = sinCerosDoc(documento);
    if (!vistos.has(ruc)) vistos.set(ruc, new Set());
    if (vistos.get(ruc).has(clave)) {
      return falla(`El documento ${documento} está repetido dentro de la misma razón social.`);
    }
    vistos.get(ruc).add(clave);

    resultado.push({
      fila, ruc, razonSocial, codigo, nombre, tipoDocumento, documento, sexo,
      centroCosto: c("CENTRO DE COSTO"),
      areaHeredada: c("AREA") || null, // se guarda por herencia; jamás agrupa ni filtra
      cargo: c("CARGO"),
      fechaIngreso, situacion,
    });
  });

  const porRuc = new Map();
  for (const f of resultado) {
    if (!porRuc.has(f.ruc)) porRuc.set(f.ruc, { ruc: f.ruc, razonSocial: f.razonSocial, filas: 0 });
    porRuc.get(f.ruc).filas += 1;
  }

  return { empresas: [...porRuc.values()], filas: resultado, errores };
}
