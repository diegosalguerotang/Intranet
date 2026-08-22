// scripts/verificar-asistencia.mjs — pruebas E2E de BD del módulo Asistencia
// (#8): importar_asistencia / previsualizar_asistencia. Datos sintéticos con
// prefijo ZZ y rango 2020-01-01..2020-01-02 (jamás toca marcaciones reales).
// Uso: & scripts/token-supabase.ps1 | Out-Null; node scripts/verificar-asistencia.mjs
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

// Persona sintética: dni con cero inicial para probar la regla "quitando
// ceros" (el código del reloj llega sin el cero). Formato válido del check
// personas_dni_formato: ^[0-9A-Z-]{4,20}$.
const DNI = "0ZZPRUEBA9";      // documento canónico del maestro
const COD = "ZZPRUEBA9";       // código como lo trae el reloj (sin el cero)
const NADIE = "ZZNADIE99";     // código que no resuelve contra el maestro
const reg = (codigo, fecha, m = {}) => JSON.stringify({ codigo, fecha, m1: "07:55", m2: "12:01", m3: "13:00", m4: "17:05", ...m });
const importar = (empresa, registros, archivo = "zzprueba-asistencia.xlsx") =>
  sql(`select importar_asistencia('${empresa}', '[${registros.map((r) => r.replace(/'/g, "''")).join(",")}]'::jsonb, '${archivo}', '{"origen":"verificacion"}'::jsonb, 'verificacion') as r`);

const limpiar = async () => {
  await sql(`delete from marcaciones where documento in ('${DNI}','${COD}','${NADIE}')`);
  await sql(`delete from asistencia_lotes where archivo = 'zzprueba-asistencia.xlsx'`);
  await sql(`delete from vinculos where persona_dni = '${DNI}'`);
  await sql(`delete from personas where dni = '${DNI}'`);
};
await limpiar();

// Alta de la persona de prueba con vínculo en promant (sede real cualquiera).
await sql(`insert into personas (dni, nombre) values ('${DNI}', 'ZZ PRUEBA ASISTENCIA')`);
await sql(`insert into vinculos (persona_dni, empresa_id, sede_id, cargo, fecha_inicio)
           select '${DNI}', 'promant', id, 'PRUEBA', '2019-12-01' from sedes where empresa_id = 'promant' limit 1`);

await prueba("0 códigos reconocidos: bloquea y no deja rastro", async () => {
  let error = null;
  try { await importar("promant", [reg(NADIE, "2020-01-01")]); }
  catch (e) { error = e.message; }
  igual(error !== null, true, "debió fallar");
  igual(/razón social correcta/.test(error), true, `mensaje accionable (${error})`);
  const [n] = await sql(`select count(*)::int n from marcaciones where documento = '${NADIE}'`);
  igual(n.n, 0, "sin marcaciones");
  const [l] = await sql(`select count(*)::int n from asistencia_lotes where archivo = 'zzprueba-asistencia.xlsx'`);
  igual(l.n, 0, "sin lote");
});

await prueba("fecha futura: bloquea todo", async () => {
  let error = null;
  try { await importar("promant", [reg(COD, "2099-01-01")]); }
  catch (e) { error = e.message; }
  igual(error !== null && /futuras/.test(error), true, `debió fallar por futuras (${error})`);
});

await prueba("importa: documento = dni canónico del maestro; el no reconocido entra con su código", async () => {
  const [{ r }] = await importar("promant", [reg(COD, "2020-01-01"), reg(NADIE, "2020-01-01")]);
  igual(r.reconocidos, 1, "reconocidos");
  igual(r.no_reconocidos.length, 1, "no reconocidos");
  igual(r.no_reconocidos[0], NADIE, "cuál no resolvió");
  const filas = await sql(`select documento, m1 from marcaciones where fecha = '2020-01-01' and empresa_id = 'promant' and documento in ('${DNI}','${NADIE}') order by documento`);
  igual(filas.length, 2, "2 marcaciones");
  igual(filas.some((f) => f.documento === DNI), true, "resuelto al dni con cero del maestro");
});

await prueba("lote registrado con rango y conteos", async () => {
  const [l] = await sql(`select empresa_id, rango_desde::text d, rango_hasta::text h, trabajadores, filas from asistencia_lotes where archivo = 'zzprueba-asistencia.xlsx' order by id desc limit 1`);
  igual(l.empresa_id, "promant", "empresa");
  igual(l.d, "2020-01-01", "desde");
  igual(l.trabajadores, 2, "códigos distintos");
  igual(l.filas, 2, "filas");
});

await prueba("reemplazo por rango: reimportar sustituye, no duplica", async () => {
  await importar("promant", [reg(COD, "2020-01-01", { m1: "08:10" }), reg(COD, "2020-01-02")]);
  const filas = await sql(`select fecha::text f, m1 from marcaciones where documento = '${DNI}' order by fecha`);
  igual(filas.length, 2, "2 días, sin duplicados");
  igual(filas[0].m1, "08:10", "el nuevo valor manda");
  const [n] = await sql(`select count(*)::int n from marcaciones where documento = '${NADIE}'`);
  igual(n.n, 0, "el reemplazo barrió la fila vieja del rango");
});

await prueba("previsualizar: devuelve el resumen y no deja rastro (PV999)", async () => {
  const [antes] = await sql(`select count(*)::int n from marcaciones where empresa_id = 'promant' and fecha between '2020-01-01' and '2020-01-02'`);
  const [{ r }] = await sql(`select previsualizar_asistencia('promant', '[${reg(COD, "2020-01-02", { m1: "09:00" }).replace(/'/g, "''")}]'::jsonb, 'zzprueba-asistencia.xlsx', '{}'::jsonb) as r`);
  igual(r.reconocidos, 1, "resumen de la vista previa");
  const [despues] = await sql(`select count(*)::int n from marcaciones where empresa_id = 'promant' and fecha between '2020-01-01' and '2020-01-02'`);
  igual(despues.n, antes.n, "sin rastro");
  const filas = await sql(`select m1 from marcaciones where documento = '${DNI}' and fecha = '2020-01-02'`);
  igual(filas[0].m1, "07:55", "la marcación real no cambió");
});

await prueba("vistas: v_asistencia_lotes y v_marcaciones exponen el contrato", async () => {
  const [l] = await sql(`select empresa_nombre, desde, hasta from v_asistencia_lotes where archivo = 'zzprueba-asistencia.xlsx' order by id desc limit 1`);
  igual(typeof l.empresa_nombre, "string", "nombre de empresa");
  const [m] = await sql(`select nombre, reconocido from v_marcaciones where documento = '${DNI}' and fecha = '2020-01-01'`);
  igual(m.reconocido, true, "reconocido");
  igual(m.nombre, "ZZ PRUEBA ASISTENCIA", "nombre del maestro");
});

// Colisión dentro del mismo archivo: DNI ("0ZZPRUEBA9") y COD ("ZZPRUEBA9")
// canonicalizan igual (ltrim de ceros) y ambos resuelven a la misma persona
// del maestro, así que terminan en el MISMO documento y la MISMA fecha. El
// RPC ya no usa ON CONFLICT (ver comentario en la migración: no se puede
// afectar la misma fila dos veces dentro de un solo INSERT); en vez de eso
// deduplica ANTES del insert con `distinct on (documento, fecha) ... order by
// ord desc`, quedándose con la ÚLTIMA fila del arreglo p_registros. Se
// verifica ese comportamiento explícitamente.
await prueba("colisión mismo canónico+fecha en el archivo: dedupe antes del insert, gana la última fila", async () => {
  const [{ r }] = await importar("promant", [
    reg(DNI, "2020-01-01", { m1: "05:00" }),
    reg(COD, "2020-01-01", { m1: "06:00" }),
  ]);
  igual(r.filas, 2, "cuenta las 2 filas del archivo");
  igual(r.reconocidos, 1, "un solo canónico reconocido");
  igual(r.no_reconocidos.length, 0, "sin no reconocidos");
  const filas = await sql(`select documento, m1 from marcaciones where empresa_id = 'promant' and fecha = '2020-01-01' and documento = '${DNI}'`);
  igual(filas.length, 1, "una sola marcación pese a la colisión");
  igual(filas[0].m1, "06:00", "gana la última fila del arreglo p_registros, no ON CONFLICT");
  const [l] = await sql(`select trabajadores from asistencia_lotes where archivo = 'zzprueba-asistencia.xlsx' order by id desc limit 1`);
  igual(l.trabajadores, 1, "un solo código distinto en el lote (mismo canónico)");
});

await limpiar();
console.log(fallos ? `\n${fallos} prueba(s) fallaron.` : "\nTodas las pruebas pasaron.");
process.exit(fallos ? 1 : 0);
