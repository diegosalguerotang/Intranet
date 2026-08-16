// src/lib/importar/planilla.js — parser del reporte PLATRA1 exportado a Excel.
// Reporte de impresión, no hoja limpia: cabecera en filas 1-5 (todo en col A),
// encabezados con "|" en la fila 6, datos después; en archivos multipágina el
// bloque cabecera+encabezados se repite. Todo es texto con relleno de espacios.

export const normalizar = (s) =>
  String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toUpperCase()
    .replace(/\s+/g, " ").trim();

const ETIQUETAS = ["CODIGO", "NOMBRES", "DNI", "SEXO", "UNIDAD SERVICIO",
  "CARGO", "C.COSTO", "F.INGRES", "F.CESE", "SITUACIO"];

const esFilaEncabezados = (fila) =>
  ETIQUETAS.every((e, i) => normalizar(String(fila[i] ?? "").replace(/\|/g, "")) === e);

// dd/mm/aa → ISO. Regla de siglo: 00–50 = 20xx; 51–99 = 19xx. "/  /" → null.
function parsearFecha(celda) {
  const limpio = String(celda ?? "").trim();
  if (!limpio || /^\/\s*\/$/.test(limpio)) return { fecha: null };
  const m = limpio.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (!m) return { error: `fecha ilegible «${limpio}»` };
  const [, d, mes, aa] = m;
  const anio = Number(aa) <= 50 ? 2000 + Number(aa) : 1900 + Number(aa);
  const fecha = `${anio}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (isNaN(Date.parse(fecha))) return { error: `fecha inválida «${limpio}»` };
  return { fecha };
}

export function parsearPlanilla(filas, hoy = new Date()) {
  // Cabecera del reporte (primer bloque).
  const fila1 = String(filas[0]?.[0] ?? "");
  const empresa = fila1.replace(/PAG\..*$/i, "").trim();
  if (!empresa) throw new Error("No encuentro la razón social en la fila 1 del reporte.");
  const emitido = (String(filas[1]?.[0] ?? "").match(/\d{2}\/\d{2}\/\d{4}/) || [null])[0];
  const centroCosto = (String(filas[2]?.[0] ?? "").match(/Centro de Costo\s*:\s*(.+)/i) || [, null])[1]?.trim() ?? null;
  const situacionFiltro = (String(filas[3]?.[0] ?? "").match(/Situación\s*:\s*(.+)/i) || [, null])[1]?.trim() ?? null;

  // Encabezados por CONTENIDO, no por posición.
  const iEnc = filas.findIndex(esFilaEncabezados);
  if (iEnc < 0) throw new Error(
    "No encuentro la fila de encabezados (Código | Nombres | DNI | …). ¿Es el reporte PLATRA1 exportado a Excel?");

  const empresaNorm = normalizar(empresa);
  const datos = [];
  const errores = [];
  const hoyIso = hoy.toISOString().slice(0, 10);
  const vistos = new Map(); // dni -> número de la primera fila válida (dedup dentro del archivo)

  filas.forEach((fila, i) => {
    if (i <= iEnc) return;
    const a = String(fila[0] ?? "").trim();
    // Bloques repetidos de cabecera en archivos multipágina + relleno.
    if (!fila.some((c) => String(c ?? "").trim())) return;               // vacía
    if (normalizar(a).startsWith(empresaNorm) || a.startsWith("PLATRA1")) return;
    if (/^(Centro de Costo|Situación)\s*:/i.test(String(fila[0] ?? "").trim())) return;
    if (esFilaEncabezados(fila)) return;

    const [codigo, nombres, dni, sexo, sede, cargo, cc, fIng, fCese, situacion] =
      fila.map((c) => String(c ?? "").trim());
    const num = i + 1;
    if (!/^\d{8}$/.test(dni)) { errores.push(`Fila ${num}: DNI «${dni}» no tiene 8 dígitos.`); return; }
    const ingreso = parsearFecha(fIng);
    if (ingreso.error) { errores.push(`Fila ${num}: F.Ingres ${ingreso.error}.`); return; }
    if (!ingreso.fecha) { errores.push(`Fila ${num}: falta la fecha de ingreso.`); return; }
    if (ingreso.fecha > hoyIso) { errores.push(`Fila ${num}: fecha de ingreso futura (${ingreso.fecha}).`); return; }
    const cese = parsearFecha(fCese);
    if (cese.error) { errores.push(`Fila ${num}: F.Cese ${cese.error}.`); return; }
    // El parser NO deduplica de por sí (RPCs como importar_planilla asumen
    // una fila por DNI); un DNI repetido en el archivo va a errores, jamás
    // se importan silenciosamente dos filas para la misma persona.
    if (vistos.has(dni)) {
      errores.push(`Fila ${num}: DNI ${dni} repetido en el archivo (ya en fila ${vistos.get(dni)}).`);
      return;
    }
    vistos.set(dni, num);

    datos.push({
      codigo, nombres, dni, sexo, sede, cargo, centroCosto: cc,
      ingreso: ingreso.fecha, cese: cese.fecha, situacion,
      nombreTruncado: nombres.length >= 30,
    });
  });

  return { empresa, emitido, centroCosto, situacionFiltro, filas: datos, errores };
}
