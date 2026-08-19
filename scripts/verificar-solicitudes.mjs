// scripts/verificar-solicitudes.mjs — pruebas del Centro de Solicitudes
// contra la BD viva (Management API). Las llamadas van sin JWT: fn_nivel_modulo
// devuelve 99 (servicio) y fn_persona_llamador() null, así que la regla de
// autoaprobación (que compara personas) se prueba en su rama estructural y el
// resto de gates en su rama permitida; portal_crear_solicitud sin sesión debe
// fallar. Datos de prueba con comentario ZZPRUEBA; limpieza al final
// (deshabilitando temporalmente el trigger de inmutabilidad, solo aquí).
// Uso: . .\scripts\token-supabase.ps1; node scripts/verificar-solicitudes.mjs
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
const esperaError = async (q, fragmento, msj) => {
  let error = null;
  try { await sql(q); } catch (e) { error = e.message; }
  if (!error || !error.includes(fragmento)) throw new Error(`${msj}: esperaba «${fragmento}», llegó ${error}`);
};
const j = (o) => `'${JSON.stringify(o).replaceAll("'", "''")}'::jsonb`;

const [{ dni: DNI }] = await sql(
  "select persona_dni as dni from vinculos where fecha_fin is null order by fecha_inicio desc limit 1");

const PAPELETA_OK = {
  salida: "2026-09-01T09:00", retorno: "2026-09-01T12:00",
  motivo: "Particular", fundamentacion: "ZZPRUEBA tramite personal",
};

await prueba("tipos sembrados: la papeleta NO es del portal; vacaciones sí", async () => {
  const [pap] = await sql("select portal, backoffice, jsonb_array_length(cadena)::int pasos from solicitud_tipos where id='papeleta-permiso'");
  igual(pap.portal, false, "papeleta portal");
  igual(pap.pasos, 2, "papeleta pasos");
  const [vac] = await sql("select portal, jsonb_array_length(cadena)::int pasos from solicitud_tipos where id='vacaciones'");
  igual(vac.portal, true, "vacaciones portal");
  igual(vac.pasos, 1, "vacaciones pasos");
});

let num1 = null;
await prueba("crear papeleta: correlativo PAP-RS-año-NNNN, estado enviada, datos congelados", async () => {
  const [{ n }] = await sql(
    `select crear_solicitud_admin('${DNI}', 'papeleta-permiso', ${j(PAPELETA_OK)}, 'verificar-solicitudes') as n`);
  num1 = n;
  igual(/^PAP-[A-Z]{1,4}-\d{4}-\d{4}$/.test(n), true, `número (${n})`);
  const [s] = await sql(`select estado, paso_actual, solicitante_nombre, empresa from v_solicitudes where numero='${n}'`);
  igual(s.estado, "enviada", "estado");
  igual(s.paso_actual, 1, "paso");
  igual(!!s.solicitante_nombre, true, "nombre congelado");
});

await prueba("el correlativo avanza en la misma RS y año", async () => {
  const [{ n }] = await sql(
    `select crear_solicitud_admin('${DNI}', 'papeleta-permiso', ${j({ ...PAPELETA_OK, adjunto_url: "solicitudes/adjuntos/zzprueba.pdf" })}, 'verificar-solicitudes') as n`);
  const seq1 = Number(num1.slice(-4)), seq2 = Number(n.slice(-4));
  igual(seq2, seq1 + 1, `secuencia (${num1} → ${n})`);
});

await prueba("negativa: retorno anterior a la salida se rechaza en validación", async () => {
  await esperaError(
    `select crear_solicitud_admin('${DNI}', 'papeleta-permiso', ${j({ ...PAPELETA_OK, retorno: "2026-09-01T08:00" })}, 'x')`,
    "retorno no puede ser anterior", "retorno inválido");
});

await prueba("negativa: motivo Otros sin especificación y sin fundamentación se rechazan", async () => {
  await esperaError(
    `select crear_solicitud_admin('${DNI}', 'papeleta-permiso', ${j({ ...PAPELETA_OK, motivo: "Otros" })}, 'x')`,
    "especificación es obligatoria", "sin especificación");
  await esperaError(
    `select crear_solicitud_admin('${DNI}', 'papeleta-permiso', ${j({ ...PAPELETA_OK, fundamentacion: " " })}, 'x')`,
    "fundamentación es obligatoria", "sin fundamentación");
});

await prueba("rechazar u observar sin motivo es imposible", async () => {
  const [{ id }] = await sql(`select id from solicitudes where numero='${num1}'`);
  await esperaError(`select resolver_solicitud(${id}, 'observar', null, 'x')`, "exige un motivo", "observar");
  await esperaError(`select resolver_solicitud(${id}, 'rechazar', '  ', 'x')`, "exige un motivo", "rechazar");
});

await prueba("observar → reenviar corregida: historial con las DOS versiones", async () => {
  const [{ id }] = await sql(`select id from solicitudes where numero='${num1}'`);
  await sql(`select resolver_solicitud(${id}, 'observar', 'ZZPRUEBA falta el sustento', 'verificar-solicitudes')`);
  const [s1] = await sql(`select estado from solicitudes where id=${id}`);
  igual(s1.estado, "observada", "estado observada");
  await sql(`select reenviar_solicitud(${id}, ${j({ ...PAPELETA_OK, fundamentacion: "ZZPRUEBA corregida", adjunto_url: "solicitudes/adjuntos/zzprueba.pdf" })}, 'verificar-solicitudes')`);
  const [s2] = await sql(`select estado, paso_actual, datos->>'fundamentacion' f from solicitudes where id=${id}`);
  igual(s2.estado, "enviada", "vuelve a la cadena");
  igual(s2.paso_actual, 1, "reinicia el paso");
  igual(s2.f, "ZZPRUEBA corregida", "datos nuevos");
  const [ev] = await sql(
    `select count(*)::int n from solicitud_eventos where solicitud_id=${id} and accion='reenviada' and datos_previos->>'fundamentacion'='ZZPRUEBA tramite personal'`);
  igual(ev.n, 1, "versión anterior en el historial");
});

await prueba("cadena de 2 pasos: V°B° del jefe y luego RRHH; sin adjunto NO se aprueba", async () => {
  const [{ n }] = await sql(
    `select crear_solicitud_admin('${DNI}', 'papeleta-permiso', ${j(PAPELETA_OK)}, 'verificar-solicitudes') as n`);
  const [{ id }] = await sql(`select id from solicitudes where numero='${n}'`);
  await sql(`select resolver_solicitud(${id}, 'aprobar', null, 'jefe-de-prueba')`);
  const [s1] = await sql(`select estado, paso_actual from solicitudes where id=${id}`);
  igual(s1.estado, "enviada", "sigue en cadena");
  igual(s1.paso_actual, 2, "pasó a RRHH");
  await esperaError(`select resolver_solicitud(${id}, 'aprobar', null, 'rrhh-de-prueba')`,
    "no se aprueba sin el original firmado", "aprobó sin adjunto");
});

let numAprobada = null;
await prueba("papeleta CON adjunto se aprueba en 2 pasos y queda inmutable (solo anular)", async () => {
  const [{ n }] = await sql(
    `select crear_solicitud_admin('${DNI}', 'papeleta-permiso', ${j({ ...PAPELETA_OK, adjunto_url: "solicitudes/adjuntos/zzprueba.pdf" })}, 'verificar-solicitudes') as n`);
  numAprobada = n;
  const [{ id }] = await sql(`select id from solicitudes where numero='${n}'`);
  await sql(`select resolver_solicitud(${id}, 'aprobar', null, 'jefe-de-prueba')`);
  await sql(`select resolver_solicitud(${id}, 'aprobar', null, 'rrhh-de-prueba')`);
  const [s] = await sql(`select estado, resuelto_en is not null r from solicitudes where id=${id}`);
  igual(s.estado, "aprobada", "aprobada");
  igual(s.r, true, "resuelto_en");
  await esperaError(`select resolver_solicitud(${id}, 'observar', 'x', 'x')`, "no admite esta decisión", "editar aprobada");
  await esperaError(`select resolver_solicitud(${id}, 'anular', null, 'x')`, "exige un motivo", "anular sin motivo");
  await sql(`select resolver_solicitud(${id}, 'anular', 'ZZPRUEBA anulada para la prueba', 'verificar-solicitudes')`);
  const [s2] = await sql(`select estado from solicitudes where id=${id}`);
  igual(s2.estado, "anulada", "anulada");
});

await prueba("vacaciones: 1 paso y la superposición con otra aprobada se ADVIERTE", async () => {
  const vac = { tipo_goce: "Efectivas", desde: "2026-10-01", hasta: "2026-10-07", dias_gozados: 7, periodo: "ZZPRUEBA" };
  const [{ n: nA }] = await sql(`select crear_solicitud_admin('${DNI}', 'vacaciones', ${j(vac)}, 'verificar-solicitudes') as n`);
  const [{ id: idA }] = await sql(`select id from solicitudes where numero='${nA}'`);
  await sql(`select resolver_solicitud(${idA}, 'aprobar', null, 'rrhh-de-prueba')`);
  const [a] = await sql(`select estado from solicitudes where id=${idA}`);
  igual(a.estado, "aprobada", "1 paso basta");
  const [{ n: nB }] = await sql(
    `select crear_solicitud_admin('${DNI}', 'vacaciones', ${j({ ...vac, desde: "2026-10-05", hasta: "2026-10-10" })}, 'verificar-solicitudes') as n`);
  const [b] = await sql(`select se_superpone, estado from v_solicitudes where numero='${nB}'`);
  igual(b.se_superpone, true, "advertencia de superposición");
  igual(b.estado, "enviada", "no bloquea");
});

await prueba("negativa: vacaciones con hasta < desde y días 0 se rechazan", async () => {
  await esperaError(
    `select crear_solicitud_admin('${DNI}', 'vacaciones', ${j({ tipo_goce: "Efectivas", desde: "2026-10-10", hasta: "2026-10-01", dias_gozados: 5 })}, 'x')`,
    "no puede ser anterior", "rango invertido");
  await esperaError(
    `select crear_solicitud_admin('${DNI}', 'vacaciones', ${j({ tipo_goce: "Efectivas", desde: "2026-10-01", hasta: "2026-10-02", dias_gozados: 0 })}, 'x')`,
    "mayores a cero", "cero días");
});

await prueba("portal: sin sesión no se crea nada y la vista propia está vacía", async () => {
  await esperaError(`select portal_crear_solicitud('vacaciones', ${j({ tipo_goce: "Efectivas", desde: "2026-11-01", hasta: "2026-11-02", dias_gozados: 2 })})`,
    "Sesión del portal inválida", "creó sin sesión");
  const [v] = await sql("select count(*)::int n from v_portal_solicitudes");
  igual(v.n, 0, "vista propia sin sesión");
});

await prueba("el historial de eventos es inmutable", async () => {
  await esperaError("update solicitud_eventos set comentario='hackeado' where id in (select id from solicitud_eventos limit 1)",
    "no se edita", "update permitido");
  await esperaError("delete from solicitud_eventos where id in (select id from solicitud_eventos limit 1)",
    "no se edita", "delete permitido");
});

await prueba("avisos: alta por tipo, CC y eliminación", async () => {
  await sql("select guardar_solicitud_aviso('vacaciones', 'zzprueba@correo.pe', true, true)");
  const [a] = await sql("select copia, activo, tipo from v_solicitud_avisos where correo='zzprueba@correo.pe'");
  igual(a.copia, true, "CC");
  igual(a.tipo, "Solicitud de vacaciones", "tipo");
  const [{ id }] = await sql("select id from solicitud_avisos where correo='zzprueba@correo.pe'");
  await sql(`select eliminar_solicitud_aviso(${id})`);
  const [b] = await sql("select count(*)::int n from solicitud_avisos where correo='zzprueba@correo.pe'");
  igual(b.n, 0, "eliminación");
});

await prueba("legajo: documentos.exige_acuse existe y v_portal_pendientes lo respeta", async () => {
  const cols = await sql("select column_name from information_schema.columns where table_name='documentos' and column_name='exige_acuse'");
  igual(cols.length, 1, "columna");
  const def = await sql("select definition from pg_views where viewname='v_portal_pendientes'");
  igual(def[0].definition.includes("exige_acuse"), true, "filtro en pendientes");
});

// Limpieza: SOLO los datos ZZPRUEBA de este script. El trigger de
// inmutabilidad se apaga un instante para poder borrar los eventos de prueba.
await sql(`
  alter table solicitud_eventos disable trigger tg_solicitud_eventos_inmutables;
  delete from solicitud_eventos where solicitud_id in (select id from solicitudes where creado_por='verificar-solicitudes' or datos::text like '%ZZPRUEBA%');
  alter table solicitud_eventos enable trigger tg_solicitud_eventos_inmutables;
  delete from solicitudes where creado_por='verificar-solicitudes' or datos::text like '%ZZPRUEBA%';
`);

console.log(fallos ? `\n${fallos} PRUEBAS FALLARON` : "\nTODAS LAS PRUEBAS PASARON");
process.exit(fallos ? 1 : 0);
