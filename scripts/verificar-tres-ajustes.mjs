// scripts/verificar-tres-ajustes.mjs — pruebas E2E de BD de los tres ajustes.
// Uso: & scripts/token-supabase.ps1 | Out-Null; node scripts/verificar-tres-ajustes.mjs
const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
let fallos = 0;
async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
async function prueba(nombre, fn) {
  try { await fn(); console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); }
}
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

await prueba("L. Americana tiene el RUC real", async () => {
  const [e] = await sql("select ruc from empresas where id='lamericana'");
  igual(e.ruc, "20601705185", "ruc");
});
await prueba("BREMCO está retirada", async () => {
  const [e] = await sql("select estado from empresas where id='bremco'");
  igual(e.estado, "retirada", "estado");
});
await prueba("no se puede crear un vínculo en BREMCO", async () => {
  let fallo = false;
  try {
    await sql("insert into vinculos (persona_dni, empresa_id, sede_id, cargo, fecha_inicio) values ('45231876','bremco','essalud','Operario de limpieza','2026-01-01')");
  } catch { fallo = true; }
  igual(fallo, true, "el insert debió fallar");
});
await prueba("los históricos de BREMCO siguen consultables", async () => {
  const [r] = await sql("select count(*)::int n from vinculos where empresa_id='bremco'");
  igual(r.n >= 2, true, "vínculos históricos");
});
await prueba("catálogo de cargos existe", async () => {
  const [r] = await sql("select count(*)::int n from cargos");
  igual(r.n >= 8, true, "cargos seed");
});
await prueba("cargos tiene RLS habilitado", async () => {
  const [r] = await sql("select relrowsecurity from pg_class where relname='cargos'");
  igual(r.relrowsecurity, true, "relrowsecurity");
});
await prueba("el sistema muestra cuatro razones sociales activas", async () => {
  const [r] = await sql("select count(*)::int n from empresas where estado='activa'");
  igual(r.n, 4, "empresas activas");
});
// --- Task 7: RPCs previsualizar_importacion / importar_planilla -----------
// DNIs claramente sintéticos (099999xx) para no chocar con datos reales; se
// limpian SIEMPRE al final, incluso si alguna prueba falla en el camino.
const EMPRESA_TEST = "lamericana";
const DNI1 = "09999921";
const DNI2 = "09999922";
const SEDE_TEST = "SEDE VERIFICACION E2E";
const filasPrueba = JSON.stringify([
  { codigo: "V01", nombres: "VERIFICACION UNO", dni: DNI1, sexo: "M", sede: SEDE_TEST,
    cargo: "Operario de limpieza", centroCosto: "CC VERIFICACION", ingreso: "2026-01-01",
    cese: null, situacion: "ACTIVO", nombreTruncado: false },
  { codigo: "V02", nombres: "VERIFICACION DOS NOMBRE BASTANTE LARGO PARA TRUNCAR", dni: DNI2, sexo: "F",
    sede: SEDE_TEST, cargo: "Supervisor de sede", centroCosto: "CC VERIFICACION", ingreso: "2026-02-01",
    cese: null, situacion: "ACTIVO", nombreTruncado: true },
]).replace(/'/g, "''");

async function limpiarDatosPrueba() {
  await sql(`delete from vinculos where persona_dni in ('${DNI1}','${DNI2}')`);
  await sql(`delete from personas where dni in ('${DNI1}','${DNI2}')`);
  await sql(`delete from sedes where empresa_id = '${EMPRESA_TEST}' and nombre = '${SEDE_TEST}'`);
}

await limpiarDatosPrueba(); // por si quedó basura de una corrida anterior fallida

try {
  await prueba("importar_planilla: alta conserva el DNI con cero a la izquierda", async () => {
    const [fila] = await sql(`select importar_planilla('${EMPRESA_TEST}', '${filasPrueba}'::jsonb, 'verificacion') as r`);
    const { altas } = fila.r;
    igual(altas.includes(DNI1) && altas.includes(DNI2), true, "altas debe incluir ambos DNI");
    const [p] = await sql(`select dni from personas where dni = '${DNI1}'`);
    igual(p.dni, DNI1, "el DNI debe conservar el cero inicial");
  });

  await prueba("importar_planilla: reimportar la misma fila da sin_cambio (idempotente)", async () => {
    const [fila] = await sql(`select importar_planilla('${EMPRESA_TEST}', '${filasPrueba}'::jsonb, 'verificacion') as r`);
    const { altas, sin_cambio } = fila.r;
    igual(altas.length, 0, "no debe haber altas nuevas al reimportar");
    igual([...sin_cambio].sort().join(","), [DNI1, DNI2].sort().join(","), "ambos DNI deben quedar sin_cambio");
  });

  await prueba("previsualizar_importacion no deja rastro", async () => {
    const [antes] = await sql(`select count(*)::int n from personas where dni in ('${DNI1}','${DNI2}')`);
    const [fila] = await sql(`select previsualizar_importacion('${EMPRESA_TEST}', '${filasPrueba}'::jsonb) as r`);
    igual([...fila.r.sin_cambio].sort().join(","), [DNI1, DNI2].sort().join(","), "la vista previa debe clasificar sin_cambio");
    const [despues] = await sql(`select count(*)::int n from personas where dni in ('${DNI1}','${DNI2}')`);
    igual(despues.n, antes.n, "previsualizar_importacion no debe alterar el conteo de personas");
  });

  await prueba("fila sin fecha de cese no cesa a nadie", async () => {
    const [antes] = await sql(`select count(*)::int n from vinculos where persona_dni in ('${DNI1}','${DNI2}') and fecha_fin is null`);
    await sql(`select importar_planilla('${EMPRESA_TEST}', '${filasPrueba}'::jsonb, 'verificacion') as r`);
    const [despues] = await sql(`select count(*)::int n from vinculos where persona_dni in ('${DNI1}','${DNI2}') and fecha_fin is null`);
    igual(despues.n, antes.n, "los vínculos vigentes no deben cesar por ausencia de fecha de cese");
    igual(despues.n, 2, "ambos vínculos de prueba deben seguir vigentes");
  });

  await prueba("importar_planilla deja rastro en auditoria con p_por", async () => {
    const marca = `verificacion-auditoria-${Date.now()}`;
    await sql(`select importar_planilla('${EMPRESA_TEST}', '${filasPrueba}'::jsonb, '${marca}') as r`);
    const [fila] = await sql(
      `select datos_despues from auditoria where accion = 'IMPORTAR_PLANILLA' and datos_despues->>'por' = '${marca}' order by id desc limit 1`
    );
    igual(fila?.datos_despues?.por, marca, "debe existir una fila de auditoria con el p_por exacto de esta llamada");
    igual(fila?.datos_despues?.empresa, EMPRESA_TEST, "la fila de auditoria debe registrar la empresa importada");
  });
} finally {
  await limpiarDatosPrueba();
}

await prueba("limpieza de datos de prueba de importación queda completa", async () => {
  const [r] = await sql(`select count(*)::int n from personas where dni in ('${DNI1}','${DNI2}')`);
  igual(r.n, 0, "no deben quedar personas de prueba");
});

await prueba("previsualizar_importacion con empresa que no existe en el catálogo se rechaza entera (defensa en profundidad tras el filtro de UI)", async () => {
  // El emparejamiento por razón social vive en la UI (Personal.jsx), pero la
  // RPC es la última línea de defensa: p_empresa debe existir en `empresas`
  // y estar activa, o rechaza la llamada completa (cero filas se procesan).
  let mensaje = null;
  try {
    await sql("select previsualizar_importacion('empresa-que-no-existe-en-el-catalogo', '[]'::jsonb) as r");
  } catch (e) {
    mensaje = e.message;
  }
  igual(mensaje !== null, true, "la llamada con una empresa inexistente debe fallar");
  igual(mensaje?.includes("no está activa"), true,
    `el mensaje debe ser el rechazo de negocio claro: ${mensaje}`);
});

await prueba("previsualizar_importacion con empresa retirada da el rechazo de negocio, no un error de casteo", async () => {
  let mensaje = null;
  try {
    await sql("select previsualizar_importacion('bremco', '[]'::jsonb) as r");
  } catch (e) {
    mensaje = e.message;
  }
  igual(mensaje !== null, true, "la llamada con una empresa retirada debe fallar");
  igual(mensaje?.includes("no está activa"), true,
    `el mensaje debe ser el rechazo de negocio claro, no un error de casteo jsonb: ${mensaje}`);
  igual(mensaje?.toLowerCase().includes("invalid input syntax"), false,
    "la colisión de SQLSTATE P0001 no debe filtrar un error de casteo jsonb");
});

// --- Task 13: RPC publicar_lote_pdf ----------------------------------------
// DNIs sintéticos 0999990x (distintos de los 099999xx de importar_planilla,
// para no chocar entre bloques). Vínculo vigente REAL en lamericana (empresa
// activa real del grupo), sede sintética propia para no interferir con la
// sede que crea/borra el bloque de importar_planilla.
const EMPRESA_PDF = "lamericana";
const DNI_A = "09999901";
const DNI_B = "09999902";
const DNI_C = "09999903"; // a propósito: NUNCA tiene vínculo, prueba (b)
// Fuera del lote pero CON celular vigente en la misma empresa: si avisos
// contara toda la empresa (el bug original) en vez de solo los DNIs del
// lote, estos tres inflarían el conteo por encima de las 2 boletas del lote.
const DNI_D1 = "09999906";
const DNI_D2 = "09999907";
const DNI_D3 = "09999908";
const DNI_E = "09999905"; // exclusivo de la prueba de upgrade de sedes.nombre
const SEDE_PDF_ID = "lamericana-sede-pdf-e2e";
const SEDE_PDF_NOMBRE = "SEDE PUBLICAR LOTE PDF E2E";
const SEDE_TRUNC_ID = "lamericana-sede-pdf-trunc-e2e";
const SEDE_TRUNC_CORTA = "SEDE PRUEBA TRUN";
const SEDE_TRUNC_COMPLETA = "SEDE PRUEBA TRUNCADA";
const TIPO_PDF = "Boleta de pago";
const PERIODO_PDF = "2026-06";
const PERIODO_EXTRA = "2026-07"; // periodo propio para no interferir con el versionado de PERIODO_PDF
const POR_PDF = "verificacion-lote-pdf";

function boletasJson(items) {
  return JSON.stringify(items).replace(/'/g, "''");
}

const DNIS_PDF = [DNI_A, DNI_B, DNI_C, DNI_D1, DNI_D2, DNI_D3, DNI_E];

async function limpiarDatosPruebaPdf() {
  // Sin filtro por tipo: la prueba de sedes.nombre publica con tipo
  // 'Gratificación' en PERIODO_EXTRA para no compartir versión con la de
  // avisos ('Boleta de pago'), así que el barrido debe cubrir cualquier tipo.
  await sql(`delete from documentos where lote_id in (
    select id from lotes where empresa_id = '${EMPRESA_PDF}' and periodo in ('${PERIODO_PDF}','${PERIODO_EXTRA}')
  )`);
  await sql(`delete from lotes where empresa_id = '${EMPRESA_PDF}' and periodo in ('${PERIODO_PDF}','${PERIODO_EXTRA}')`);
  await sql(`delete from vinculos where persona_dni in (${DNIS_PDF.map((d) => `'${d}'`).join(",")}) and empresa_id = '${EMPRESA_PDF}'`);
  await sql(`delete from personas where dni in (${DNIS_PDF.map((d) => `'${d}'`).join(",")})`);
  await sql(`delete from sedes where id in ('${SEDE_PDF_ID}','${SEDE_TRUNC_ID}')`);
}

await limpiarDatosPruebaPdf(); // por si quedó basura de una corrida anterior fallida

let loteV1 = null;
try {
  await sql(`insert into sedes (id, empresa_id, nombre, cliente) values
    ('${SEDE_PDF_ID}', '${EMPRESA_PDF}', '${SEDE_PDF_NOMBRE}', 'Por asignar'),
    ('${SEDE_TRUNC_ID}', '${EMPRESA_PDF}', '${SEDE_TRUNC_CORTA}', 'Por asignar')`);
  await sql(`insert into personas (dni, nombre, portal) values
    ('${DNI_A}', 'VERIFICACION PDF UNO', 'sin_celular'),
    ('${DNI_B}', 'VERIFICACION PDF DOS', 'sin_celular'),
    ('${DNI_D1}', 'VERIFICACION PDF FUERA UNO', 'activo'),
    ('${DNI_D2}', 'VERIFICACION PDF FUERA DOS', 'activo'),
    ('${DNI_D3}', 'VERIFICACION PDF FUERA TRES', 'activo'),
    ('${DNI_E}', 'VERIFICACION PDF SEDE TRUNCADA', 'sin_celular')`);
  await sql(`update personas set celular = '987650001' where dni = '${DNI_D1}'`);
  await sql(`update personas set celular = '987650002' where dni = '${DNI_D2}'`);
  await sql(`update personas set celular = '987650003' where dni = '${DNI_D3}'`);
  await sql(`insert into vinculos (persona_dni, empresa_id, sede_id, cargo, centro_costo, fecha_inicio) values
    ('${DNI_A}', '${EMPRESA_PDF}', '${SEDE_PDF_ID}', 'Operario de limpieza', 'CC PDF E2E', '2026-01-01'),
    ('${DNI_B}', '${EMPRESA_PDF}', '${SEDE_PDF_ID}', 'Supervisor de sede', 'CC PDF E2E', '2026-01-01'),
    ('${DNI_D1}', '${EMPRESA_PDF}', '${SEDE_PDF_ID}', 'Operario de limpieza', 'CC PDF E2E', '2026-01-01'),
    ('${DNI_D2}', '${EMPRESA_PDF}', '${SEDE_PDF_ID}', 'Operario de limpieza', 'CC PDF E2E', '2026-01-01'),
    ('${DNI_D3}', '${EMPRESA_PDF}', '${SEDE_PDF_ID}', 'Operario de limpieza', 'CC PDF E2E', '2026-01-01'),
    ('${DNI_E}', '${EMPRESA_PDF}', '${SEDE_TRUNC_ID}', 'Operario de limpieza', 'CC PDF E2E', '2026-01-01')`);

  await prueba("publicar_lote_pdf: lote con 2 boletas de DNIs con vínculo vigente crea 2 documentos con hash y url", async () => {
    const boletas = boletasJson([
      { dni: DNI_A, correlativo: 1, nombre: "VERIFICACION PDF UNO", cargo: "Operario de limpieza",
        sede: SEDE_PDF_NOMBRE, centroCosto: "CC PDF E2E", ingreso: "2026-01-01", neto: 1500.5,
        hash: "hashA1", archivo_url: "https://storage.test/hashA1.pdf",
        ruc: "20601705185", periodoCabecera: "JUNIO 2026", periodoPago: "2026-06" },
      { dni: DNI_B, correlativo: 2, nombre: "VERIFICACION PDF DOS", cargo: "Supervisor de sede",
        sede: SEDE_PDF_NOMBRE, centroCosto: "CC PDF E2E", ingreso: "2026-01-01", neto: 1800.25,
        hash: "hashB1", archivo_url: "https://storage.test/hashB1.pdf" },
    ]);
    const [fila] = await sql(
      `select publicar_lote_pdf('${EMPRESA_PDF}','${TIPO_PDF}','${PERIODO_PDF}','${POR_PDF}','${boletas}'::jsonb) as r`
    );
    igual(fila.r.documentos, 2, "documentos publicados");
    igual(fila.r.version, 1, "versión inicial");
    loteV1 = fila.r.lote_id;
    const docs = await sql(
      `select v.persona_dni as dni, d.hash_sha256, d.archivo_url, d.neto::float as neto
       from documentos d join vinculos v on v.id = d.vinculo_id where d.lote_id = '${loteV1}' order by v.persona_dni`
    );
    igual(docs.length, 2, "dos filas de documentos");
    igual(docs[0].dni, DNI_A, "dni del primer documento");
    igual(docs[0].hash_sha256, "hashA1", "hash del primer documento");
    igual(docs[0].archivo_url, "https://storage.test/hashA1.pdf", "url del primer documento");
    igual(docs[0].neto, 1500.5, "neto del primer documento");
    igual(docs[1].dni, DNI_B, "dni del segundo documento");
    igual(docs[1].hash_sha256, "hashB1", "hash del segundo documento");
  });

  await prueba("publicar_lote_pdf: DNI sin vínculo vigente rechaza el lote completo (cero filas nuevas)", async () => {
    const boletas = boletasJson([
      { dni: DNI_A, nombre: "VERIFICACION PDF UNO", neto: 1500.5, hash: "hashA2", archivo_url: "https://storage.test/hashA2.pdf" },
      { dni: DNI_C, nombre: "SIN VINCULO", neto: 1000, hash: "hashC2", archivo_url: "https://storage.test/hashC2.pdf" },
    ]);
    let mensaje = null;
    try {
      await sql(`select publicar_lote_pdf('${EMPRESA_PDF}','${TIPO_PDF}','${PERIODO_PDF}','${POR_PDF}','${boletas}'::jsonb) as r`);
    } catch (e) { mensaje = e.message; }
    igual(mensaje !== null, true, "la llamada con un DNI sin vínculo debe fallar");
    igual(mensaje?.includes("vínculo vigente"), true, `mensaje debe indicar falta de vínculo vigente: ${mensaje}`);
    const [lts] = await sql(`select count(*)::int n from lotes where empresa_id = '${EMPRESA_PDF}' and tipo = '${TIPO_PDF}' and periodo = '${PERIODO_PDF}'`);
    igual(lts.n, 1, "no debe haberse creado un segundo lote (transaccional)");
    const [dcs] = await sql(`select count(*)::int n from documentos where lote_id = '${loteV1}'`);
    igual(dcs.n, 2, "los documentos del lote v1 no deben verse alterados");
  });

  let loteV2 = null;
  await prueba("publicar_lote_pdf: republicar el mismo periodo crea versión 2 y deja v1 'reemplazado' sin tocar acuses", async () => {
    const [acusesAntes] = await sql("select count(*)::int n from acuses");
    const boletas = boletasJson([
      { dni: DNI_A, nombre: "VERIFICACION PDF UNO", neto: 1550, hash: "hashA3", archivo_url: "https://storage.test/hashA3.pdf" },
      { dni: DNI_B, nombre: "VERIFICACION PDF DOS", neto: 1850, hash: "hashB3", archivo_url: "https://storage.test/hashB3.pdf" },
    ]);
    const [fila] = await sql(
      `select publicar_lote_pdf('${EMPRESA_PDF}','${TIPO_PDF}','${PERIODO_PDF}','${POR_PDF}','${boletas}'::jsonb) as r`
    );
    igual(fila.r.version, 2, "segunda versión");
    igual(fila.r.documentos, 2, "documentos de la versión 2");
    loteV2 = fila.r.lote_id;
    const v1 = await sql(`select estado from documentos where lote_id = '${loteV1}'`);
    igual(v1.every((d) => d.estado === "reemplazado"), true, "todos los documentos de v1 deben quedar 'reemplazado'");
    const [acusesDespues] = await sql("select count(*)::int n from acuses");
    igual(acusesDespues.n, acusesAntes.n, "el conteo de acuses no debe cambiar al versionar (jamás se tocan)");
  });

  await prueba("publicar_lote_pdf: avisos cuenta solo los DNIs del lote, no toda la empresa (fix post-revisión)", async () => {
    // DNI_D1/D2/D3 tienen celular vigente en lamericana pero NO están en el
    // lote: si avisos contara la empresa entera (el bug), daría 3. El lote es
    // parcial (2 boletas, A y B, ninguna con celular): el valor correcto es 0.
    const boletas = boletasJson([
      { dni: DNI_A, nombre: "VERIFICACION PDF UNO", neto: 1500.5, hash: "hashAvisos1", archivo_url: "https://storage.test/hashAvisos1.pdf" },
      { dni: DNI_B, nombre: "VERIFICACION PDF DOS", neto: 1800.25, hash: "hashAvisos2", archivo_url: "https://storage.test/hashAvisos2.pdf" },
    ]);
    const [fila] = await sql(
      `select publicar_lote_pdf('${EMPRESA_PDF}','${TIPO_PDF}','${PERIODO_EXTRA}','${POR_PDF}','${boletas}'::jsonb) as r`
    );
    const [lote] = await sql(`select avisos from lotes where id = '${fila.r.lote_id}'`);
    igual(lote.avisos <= 2, true, `avisos no debe exceder el tamaño del lote (2 boletas): ${lote.avisos}`);
    igual(lote.avisos, 0, "ninguna boleta del lote (A, B) tiene celular; avisos debe ser 0, no contar D1/D2/D3");
  });

  await prueba("publicar_lote_pdf: sedes.nombre truncado se completa con el que trae la boleta (regla anti-prefijo)", async () => {
    const [sedeAntes] = await sql(`select nombre from sedes where id = '${SEDE_TRUNC_ID}'`);
    igual(sedeAntes.nombre, SEDE_TRUNC_CORTA, "la sede debe partir con el nombre truncado");
    const boletas = boletasJson([
      { dni: DNI_E, nombre: "VERIFICACION PDF SEDE TRUNCADA", cargo: "Operario de limpieza",
        sede: SEDE_TRUNC_COMPLETA, neto: 1200, hash: "hashSede1", archivo_url: "https://storage.test/hashSede1.pdf" },
    ]);
    await sql(`select publicar_lote_pdf('${EMPRESA_PDF}','Gratificación','${PERIODO_EXTRA}','${POR_PDF}','${boletas}'::jsonb) as r`);
    const [sedeDespues] = await sql(`select nombre from sedes where id = '${SEDE_TRUNC_ID}'`);
    igual(sedeDespues.nombre, SEDE_TRUNC_COMPLETA, "sedes.nombre debe completarse con el nombre íntegro de la boleta");
  });

  await prueba("motor documental (documentos/lotes) no tiene columnas de cuentas bancarias ni CUSPP", async () => {
    const [r] = await sql(
      `select count(*)::int n from information_schema.columns
       where column_name ~* 'cuenta|cuspp' and table_name in ('documentos','lotes')`
    );
    igual(r.n, 0, "no debe existir ninguna columna de cuenta/CUSPP en documentos ni lotes");
  });
} finally {
  await limpiarDatosPruebaPdf();
}

await prueba("limpieza de datos de prueba de publicar_lote_pdf queda completa", async () => {
  const [r] = await sql(`select count(*)::int n from personas where dni in (${DNIS_PDF.map((d) => `'${d}'`).join(",")})`);
  igual(r.n, 0, "no deben quedar personas de prueba");
  const [l] = await sql(`select count(*)::int n from lotes where empresa_id = '${EMPRESA_PDF}' and periodo in ('${PERIODO_PDF}','${PERIODO_EXTRA}')`);
  igual(l.n, 0, "no deben quedar lotes de prueba");
  const [s] = await sql(`select count(*)::int n from sedes where id in ('${SEDE_PDF_ID}','${SEDE_TRUNC_ID}')`);
  igual(s.n, 0, "no deben quedar sedes de prueba");
});

console.log(fallos ? `\n${fallos} PRUEBAS FALLARON` : "\nTODAS LAS PRUEBAS PASARON");
process.exit(fallos ? 1 : 0);
