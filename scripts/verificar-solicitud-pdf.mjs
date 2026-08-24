// Verificación E2E del PDF de solicitudes (api/solicitud-pdf) en PRODUCCIÓN.
// Cierra el pendiente "probar PDF real en producción con sesión" del ciclo
// Centro de Solicitudes (2026-08-19).
//   Flujo: admin temporal (patrón 2026-08-19) → trabajador ZZPRUEBA →
//   solicitud de vacaciones aprobada por SQL → POST /api/solicitud-pdf con
//   x-sesion → verificar documento en legajo + PDF real vía
//   /api/descargar-documento → idempotencia y negativas → limpieza total.
//   env: SUPABASE_ACCESS_TOKEN (Management API). Opcional ADMIN_EMAIL/ADMIN_CLAVE.
//   Uso: . .\scripts\token-supabase.ps1; node scripts/verificar-solicitud-pdf.mjs
const APP = "https://intranet-general.vercel.app";
const SUPA = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const APIKEY = "sb_publishable_qgPwZ8-4neRlKQXpCe9tnw_Dix4Ddwg";
const { ADMIN_EMAIL, ADMIN_CLAVE, SUPABASE_ACCESS_TOKEN } = process.env;
if (!SUPABASE_ACCESS_TOKEN) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }

let fallos = 0;
const ok = (n) => console.log(`  ✔ ${n}`);
const mal = (n, d) => { fallos++; console.error(`  ✘ ${n} — ${String(d).slice(0, 250)}`); };
const json = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { crudo: t, status: r.status }; } };

const login = async (email, clave) => json(await fetch(`${APP}/api/supa/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: clave }),
}));
const sql = async (q) => json(await fetch(`https://api.supabase.com/v1/projects/mzpbdkrmokfxrrsotfgs/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: q }),
}));
const j = (o) => `'${JSON.stringify(o).replaceAll("'", "''")}'::jsonb`;

console.log("0 · Service key y sesión admin");
const claves = await json(await fetch("https://api.supabase.com/v1/projects/mzpbdkrmokfxrrsotfgs/api-keys?reveal=true", {
  headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` },
}));
const service = (Array.isArray(claves) ? claves : []).find((k) => k.type === "secret" || k.name === "service_role")?.api_key;
if (!service) { mal("service key", "la Management API no la devolvió"); process.exit(1); }
const cabService = { apikey: service, authorization: `Bearer ${service}`, "Content-Type": "application/json" };
const gotrue = async (ruta, opciones = {}) => {
  const r = await fetch(`${SUPA}${ruta}`, { ...opciones, headers: { ...cabService, ...opciones.headers } });
  return { ok: r.ok, status: r.status, json: await json(r) };
};
const borrarCuentaGoTrue = async (email) => {
  const lista = await gotrue("/auth/v1/admin/users?per_page=1000");
  const u = (lista.json.users ?? []).find((x) => (x.email ?? "").toLowerCase() === email.toLowerCase());
  if (!u) return false;
  return (await gotrue(`/auth/v1/admin/users/${u.id}`, { method: "DELETE" })).ok;
};

const CORREO_TEMP = "zzprueba-pdf@grupoer.pe";
let adminEmail = ADMIN_EMAIL, adminClave = ADMIN_CLAVE, adminTemporal = false;
if (!adminEmail || !adminClave) {
  adminTemporal = true;
  adminEmail = CORREO_TEMP;
  adminClave = "Zz" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
  await borrarCuentaGoTrue(CORREO_TEMP);
  await sql(`delete from usuarios_admin where correo = '${CORREO_TEMP}'`);
  const altaCuenta = await gotrue("/auth/v1/admin/users", {
    method: "POST", body: JSON.stringify({ email: adminEmail, password: adminClave, email_confirm: true }),
  });
  const [persona] = await sql(`select dni from personas p
    where not exists (select 1 from usuarios_admin u where u.persona_dni = p.dni) limit 1`);
  const [perfil] = await sql(`select id, version from perfiles
    where lower(nombre) like 'superadmin%' and estado = 'activo' order by version desc limit 1`);
  if (!altaCuenta.ok || !persona || !perfil) {
    mal("admin temporal", JSON.stringify({ cuenta: altaCuenta.status, persona, perfil })); process.exit(1);
  }
  const fila = await sql(`insert into usuarios_admin
    (persona_dni, perfil_id, perfil_version, correo, creado_por)
    values ('${persona.dni}', '${perfil.id}', ${perfil.version}, '${CORREO_TEMP}', 'verificar-solicitud-pdf')
    returning id`);
  if (!fila?.[0]?.id) { mal("usuarios_admin temporal", JSON.stringify(fila)); await borrarCuentaGoTrue(CORREO_TEMP); process.exit(1); }
  ok(`admin temporal listo (persona ${persona.dni}, perfil ${perfil.id} v${perfil.version})`);
}
const admin = await login(adminEmail, adminClave);
if (!admin.access_token) { mal("login admin", JSON.stringify(admin)); process.exit(1); }
ok(`sesión admin de ${adminEmail}`);

const pdfApi = async (cuerpo, conSesion = true) => {
  const r = await fetch(`${APP}/api/solicitud-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(conSesion ? { "x-sesion": admin.access_token } : {}) },
    body: JSON.stringify(cuerpo),
  });
  return { status: r.status, ...(await json(r)) };
};

console.log("1 · Trabajador de prueba y solicitud de vacaciones aprobada");
let DNI = null;
for (let i = 0; i < 5 && !DNI; i++) {
  const cand = "99" + String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
  const existe = await sql(`select 1 from personas where dni = '${cand}'`);
  if (Array.isArray(existe) && existe.length === 0) DNI = cand;
}
if (!DNI) { mal("dni de prueba", "no se encontró un DNI libre"); process.exit(1); }
const [sede] = await sql(`select s.id, s.empresa_id from sedes s
  join empresas e on e.id = s.empresa_id where e.estado = 'activa' limit 1`);
const alta = await fetch(`${APP}/api/supa/rest/v1/rpc/alta_trabajador?apikey=${APIKEY}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", authorization: `Bearer ${admin.access_token}` },
  body: JSON.stringify({ p_dni: DNI, p_nombre: `ZZPRUEBA PDF ${DNI}`, p_cargo: "Operario de limpieza",
    p_sede: sede.id, p_empresa: sede.empresa_id, p_ingreso: "2026-08-01" }),
});
alta.ok ? ok(`trabajador de prueba ${DNI} en ${sede.empresa_id}`) : mal("alta_trabajador", await alta.text());

const VAC = { tipo_goce: "Efectivas / Gozadas", desde: "2026-12-01", hasta: "2026-12-07",
  dias_gozados: 7, periodo: "ZZPRUEBA 2025-2026" };
const [{ n: numero }] = await sql(
  `select crear_solicitud_admin('${DNI}', 'vacaciones', ${j(VAC)}, 'verificar-solicitud-pdf') as n`);
const [{ id: solId }] = await sql(`select id from solicitudes where numero='${numero}'`);
await sql(`select resolver_solicitud(${solId}, 'aprobar', null, 'verificar-solicitud-pdf')`);
const [estado] = await sql(`select estado from solicitudes where id=${solId}`);
estado?.estado === "aprobada" ? ok(`solicitud ${numero} aprobada`) : mal("aprobar", JSON.stringify(estado));

// Segunda solicitud SIN aprobar, para la negativa.
const [{ n: numeroEnviada }] = await sql(
  `select crear_solicitud_admin('${DNI}', 'vacaciones', ${j({ ...VAC, desde: "2027-01-04", hasta: "2027-01-05", dias_gozados: 2 })}, 'verificar-solicitud-pdf') as n`);

console.log("2 · Negativas del endpoint");
const sinSesion = await pdfApi({ numero }, false);
sinSesion.status === 401 ? ok("sin x-sesion → 401") : mal("sin sesión", JSON.stringify(sinSesion));
const noAprobada = await pdfApi({ numero: numeroEnviada });
noAprobada.status === 400 ? ok("solicitud enviada (no aprobada) → 400") : mal("no aprobada", JSON.stringify(noAprobada));
const noExiste = await pdfApi({ numero: "VAC-ZZZ-2099-9999" });
noExiste.status === 404 ? ok("número inexistente → 404") : mal("inexistente", JSON.stringify(noExiste));

console.log("3 · Generación real del PDF");
const gen = await pdfApi({ numero });
const documentoId = gen.documentoId;
(gen.status === 200 && documentoId && gen.ruta) ? ok(`PDF generado y archivado (doc ${documentoId}, ${gen.ruta})`)
  : mal("generar", JSON.stringify(gen));

console.log("4 · El documento quedó en el legajo con exige_acuse");
const [doc] = await sql(`select d.tipo, d.titulo, d.archivo_url, d.exige_acuse, v.persona_dni
  from documentos d join vinculos v on v.id = d.vinculo_id where d.id = ${documentoId ?? 0}`);
(doc?.tipo === "solicitud" && doc?.persona_dni === DNI) ? ok(`en el legajo de ${DNI}: «${doc.titulo}»`)
  : mal("legajo", JSON.stringify(doc));
(doc?.exige_acuse === true) ? ok("vacaciones exige acuse (acuse=siempre)") : mal("exige_acuse", JSON.stringify(doc));
const [enlace] = await sql(`select documento_id from solicitudes where id=${solId}`);
(enlace?.documento_id === documentoId) ? ok("solicitudes.documento_id enlazado") : mal("enlace", JSON.stringify(enlace));

console.log("5 · El PDF se descarga por el camino real (URL firmada)");
const desc = await json(await fetch(`${APP}/api/descargar-documento?id=${documentoId}`, {
  headers: { "x-sesion": admin.access_token },
}));
if (!desc.url) mal("descargar-documento", JSON.stringify(desc));
else {
  const pdfBin = await fetch(desc.url);
  const cabecera = Buffer.from(await pdfBin.arrayBuffer()).subarray(0, 5).toString();
  cabecera === "%PDF-" ? ok(`PDF real descargado (${cabecera}…)`) : mal("contenido", `cabecera «${cabecera}»`);
}

console.log("6 · Idempotencia: repetir devuelve el mismo documento");
const otraVez = await pdfApi({ numero });
(otraVez.status === 200 && otraVez.yaExistia && otraVez.documentoId === documentoId)
  ? ok("segunda llamada → yaExistia con el mismo id") : mal("idempotencia", JSON.stringify(otraVez));

console.log("7 · Limpieza (solicitudes, documento, storage, trabajador, admin)");
await sql(`update solicitudes set documento_id = null where id = ${solId}`);
await sql(`
  alter table solicitud_eventos disable trigger tg_solicitud_eventos_inmutables;
  delete from solicitud_eventos where solicitud_id in (select id from solicitudes where creado_por='verificar-solicitud-pdf');
  alter table solicitud_eventos enable trigger tg_solicitud_eventos_inmutables;
  delete from solicitudes where creado_por='verificar-solicitud-pdf';
`);
if (documentoId) await sql(`delete from documentos where id = ${documentoId}`);
if (gen.ruta) {
  const borrar = await fetch(`${SUPA}/storage/v1/object/documentos/${gen.ruta}`, { method: "DELETE", headers: cabService });
  borrar.ok ? ok("PDF de prueba fuera del bucket") : mal("storage", `DELETE ${borrar.status}`);
}
await sql(`delete from vinculos where persona_dni = '${DNI}'`);
await sql(`delete from personas where dni = '${DNI}'`);
if (adminTemporal) {
  await sql(`delete from usuarios_admin where correo = '${CORREO_TEMP}'`);
  (await borrarCuentaGoTrue(CORREO_TEMP)) ? ok("admin temporal eliminado") : mal("borrar admin temporal", "no se pudo");
}
const resto = await sql(`select (select count(*) from personas where dni = '${DNI}') +
  (select count(*) from solicitudes where creado_por = 'verificar-solicitud-pdf') +
  (select count(*) from usuarios_admin where correo = '${CORREO_TEMP}') as n`);
(resto?.[0]?.n === 0) ? ok("BD limpia") : mal("limpieza", JSON.stringify(resto));

console.log(fallos === 0 ? "\nTODO EN VERDE" : `\n${fallos} PRUEBAS FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
