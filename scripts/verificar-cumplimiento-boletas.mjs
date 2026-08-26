// Verificación E2E del ciclo CUMPLIMIENTO DE BOLETAS (2026-08-26) en
// PRODUCCIÓN: IP/user-agent reales en los acuses (los inyecta el proxy
// /api/supa — anti-spoof incluido), consentimientos con estándar probatorio,
// log de notificaciones, constancia ampliada y consentimiento-pdf.
// Patrón admin temporal (2026-08-19) + cuentas de portal reales. La limpieza
// apaga un instante los triggers de inmutabilidad (acuses, consentimientos,
// notificaciones), patrón verificar-movimientos.
//   env: SUPABASE_ACCESS_TOKEN (Management API).
//   Uso: . .\scripts\token-supabase.ps1; node scripts/verificar-cumplimiento-boletas.mjs
const APP = "https://intranet-general.vercel.app";
const SUPA = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const { SUPABASE_ACCESS_TOKEN } = process.env;
if (!SUPABASE_ACCESS_TOKEN) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }

let fallos = 0;
const ok = (n) => console.log(`  ✔ ${n}`);
const mal = (n, d) => { fallos++; console.error(`  ✘ ${n} — ${String(d).slice(0, 250)}`); };
const json = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { crudo: t, status: r.status }; } };
const sql = async (q) => json(await fetch(`https://api.supabase.com/v1/projects/mzpbdkrmokfxrrsotfgs/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: q }),
}));
const login = async (email, clave) => json(await fetch(`${APP}/api/supa/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: clave }),
}));
// RPC vía el proxy REAL (x-sesion): así el proxy inyecta x-ip-real/x-agente.
const rpcProxy = async (fn, cuerpo, token, extras = {}) => {
  const r = await fetch(`${APP}/api/supa/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-sesion": token, ...extras },
    body: JSON.stringify(cuerpo),
  });
  return { status: r.status, json: await json(r) };
};

console.log("0 · Service key, admin temporal y datos de prueba");
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
  if (u) await gotrue(`/auth/v1/admin/users/${u.id}`, { method: "DELETE" });
};

const CORREO_TEMP = "zzprueba-cumpl@grupoer.pe";
const adminClave = "Zz" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
await borrarCuentaGoTrue(CORREO_TEMP);
await sql(`delete from usuarios_admin where correo = '${CORREO_TEMP}'`);
const altaCuenta = await gotrue("/auth/v1/admin/users", {
  method: "POST", body: JSON.stringify({ email: CORREO_TEMP, password: adminClave, email_confirm: true }),
});
const [personaAdmin] = await sql(`select dni from personas p
  where dni not like 'ZZ%' and dni not like '9%' and not exists (select 1 from usuarios_admin u where u.persona_dni = p.dni) limit 1`);
const [perfil] = await sql(`select id, version from perfiles
  where lower(nombre) like 'superadmin%' and estado = 'activo' order by version desc limit 1`);
if (!altaCuenta.ok || !personaAdmin || !perfil) {
  mal("admin temporal", JSON.stringify({ cuenta: altaCuenta.status, personaAdmin, perfil })); process.exit(1);
}
await sql(`insert into usuarios_admin (persona_dni, perfil_id, perfil_version, correo, creado_por)
  values ('${personaAdmin.dni}', '${perfil.id}', ${perfil.version}, '${CORREO_TEMP}', 'verificar-cumplimiento')`);
const admin = await login(CORREO_TEMP, adminClave);
if (!admin.access_token) { mal("login admin", JSON.stringify(admin)); process.exit(1); }
ok("admin temporal con sesión");

// Trabajador vigente con DOS documentos sin acuse (uno para la confirmación
// real, otro para el anti-spoof) y cuenta de portal real.
const DNI = "96" + String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
const [sede] = await sql(`select s.id, s.empresa_id from sedes s
  join empresas e on e.id = s.empresa_id where e.estado = 'activa' limit 1`);
await sql(`insert into personas (dni, nombre, portal) values ('${DNI}', 'ZZPRUEBA CUMPLIMIENTO', 'activo')`);
const [vinc] = await sql(`insert into vinculos (persona_dni, empresa_id, sede_id, cargo, fecha_inicio)
  values ('${DNI}', '${sede.empresa_id}', '${sede.id}', 'Operario de limpieza', '2026-01-01') returning id`);
const HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const [doc1] = await sql(`insert into documentos (vinculo_id, tipo, titulo, periodo, hash_sha256)
  values (${vinc.id}, 'Boleta de pago', 'Boleta de pago Julio 2026', '2026-07', '${HASH}') returning id`);
const [doc2] = await sql(`insert into documentos (vinculo_id, tipo, titulo, periodo, hash_sha256)
  values (${vinc.id}, 'Boleta de pago', 'Boleta anti-spoof', '2026-07', '${HASH}') returning id`);
await sql(`insert into cuentas_portal (dni, creado_por) values ('${DNI}', 'verificar-cumplimiento')`);
const clavePortal = "Cl" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
await borrarCuentaGoTrue(`${DNI}@portal.grupoer.pe`);
const altaPortal = await gotrue("/auth/v1/admin/users", {
  method: "POST", body: JSON.stringify({ email: `${DNI}@portal.grupoer.pe`, password: clavePortal, email_confirm: true }),
});
if (!altaPortal.ok) mal("cuenta portal", altaPortal.status);
const dueno = await login(`${DNI}@portal.grupoer.pe`, clavePortal);
if (!dueno.access_token) { mal("login portal", "sin token"); process.exit(1); }
ok(`trabajador ${DNI} con documentos ${doc1.id}/${doc2.id} y sesión de portal`);

console.log("1 · F1: el acuse real captura IP y user-agent del servidor");
const conf1 = await rpcProxy("portal_confirmar_recepcion",
  { p_documento_id: doc1.id, p_dispositivo: "suite cumplimiento" }, dueno.access_token,
  { "user-agent": "SuiteCumplimiento/1.0" });
conf1.status === 200 ? ok("confirmación vía proxy → 200") : mal("confirmar", `${conf1.status} ${JSON.stringify(conf1.json)}`);
const [ac1] = await sql(`select ip, agente, dispositivo from acuses where documento_id = ${doc1.id}`);
(ac1?.ip && /^[0-9a-fA-F.:]+$/.test(ac1.ip)) ? ok(`IP capturada (${ac1.ip})`) : mal("ip", JSON.stringify(ac1));
ac1?.agente === "SuiteCumplimiento/1.0" ? ok("user-agent del servidor capturado") : mal("agente", JSON.stringify(ac1));

console.log("2 · F1: anti-spoof — una x-ip-real del cliente se descarta");
const conf2 = await rpcProxy("portal_confirmar_recepcion",
  { p_documento_id: doc2.id, p_dispositivo: "suite anti-spoof" }, dueno.access_token,
  { "x-ip-real": "1.2.3.4", "x-agente": "Falso/9.9" });
conf2.status === 200 ? ok("confirmación 2 → 200") : mal("confirmar 2", conf2.status);
const [ac2] = await sql(`select ip, agente from acuses where documento_id = ${doc2.id}`);
(ac2?.ip && ac2.ip !== "1.2.3.4") ? ok("la IP guardada NO es la falsificada") : mal("spoof ip", JSON.stringify(ac2));
ac2?.agente !== "Falso/9.9" ? ok("el agente guardado NO es el falsificado") : mal("spoof agente", JSON.stringify(ac2));

console.log("3 · F2: el primer ingreso deja consentimiento probatorio");
const [politica] = await sql(`select max(version) as v from declaraciones where id = 'politica-datos'`);
const pi = await rpcProxy("portal_primer_ingreso",
  { p_celular: "999888777", p_sin_celular: false, p_politica_version: politica.v }, dueno.access_token,
  { "user-agent": "SuiteCumplimiento/1.0" });
pi.status === 200 || pi.status === 204 ? ok("portal_primer_ingreso OK") : mal("primer ingreso", `${pi.status} ${JSON.stringify(pi.json)}`);
const [cons] = await sql(`select origen, ip, agente, version,
    (hash_sha256 = encode(extensions.digest(texto, 'sha256'), 'hex')) as hash_ok,
    length(texto) as largo
  from consentimientos where dni = '${DNI}' and origen = 'primer_ingreso'`);
cons ? ok("fila de consentimiento creada") : mal("consentimiento", "sin fila");
cons?.hash_ok ? ok("hash SHA-256 del texto coincide") : mal("hash consentimiento", JSON.stringify(cons));
(cons?.ip && cons?.agente === "SuiteCumplimiento/1.0") ? ok("consentimiento con IP y agente") : mal("consent ip/agente", JSON.stringify(cons));
(cons?.largo ?? 0) > 500 ? ok(`texto íntegro copiado (${cons.largo} caracteres)`) : mal("texto consentimiento", cons?.largo);

console.log("4 · F2/F3: inmutabilidad de consentimientos y notificaciones");
const up1 = await sql(`update consentimientos set ip = 'hack' where dni = '${DNI}'`);
String(JSON.stringify(up1)).includes("inmutable") ? ok("consentimientos inmutables") : mal("update consentimiento", JSON.stringify(up1).slice(0, 150));
await sql(`insert into notificaciones_documento (documento_id, destinatario, enviado_por)
  values (${doc1.id}, 'zz@ejemplo.pe', 'suite')`);
const up2 = await sql(`update notificaciones_documento set destinatario = 'hack' where documento_id = ${doc1.id}`);
String(JSON.stringify(up2)).includes("inmutable") ? ok("notificaciones inmutables") : mal("update notificación", JSON.stringify(up2).slice(0, 150));
const [va] = await sql(`select publicado, notificaciones, "ultimaNotificacion", empresa, nombre
  from v_acuses where documento_id = ${doc1.id}`);
(va?.publicado && va?.empresa === sede.empresa_id && va?.nombre) ? ok("v_acuses con publicado/empresa/nombre") : mal("v_acuses", JSON.stringify(va));
(va?.notificaciones === 1 && va?.ultimaNotificacion) ? ok("v_acuses refleja la notificación") : mal("v_acuses notif", JSON.stringify(va));

console.log("5 · F4: constancia ampliada sigue descargando");
const rc = await fetch(`${APP}/api/constancia-portal?id=${doc1.id}`, { headers: { "x-sesion": admin.access_token } });
const bufC = Buffer.from(await rc.arrayBuffer());
(rc.status === 200 && bufC.subarray(0, 5).toString() === "%PDF-" && bufC.length > 2000)
  ? ok(`constancia PDF 200 (${bufC.length} bytes)`) : mal("constancia", `${rc.status} ${bufC.toString().slice(0, 120)}`);

console.log("6 · F2: consentimiento-pdf (individual, masivo y negativas)");
const cp1 = await fetch(`${APP}/api/consentimiento-pdf?dni=${DNI}`, { headers: { "x-sesion": admin.access_token } });
const bufI = Buffer.from(await cp1.arrayBuffer());
(cp1.status === 200 && bufI.subarray(0, 5).toString() === "%PDF-")
  ? ok(`individual → 200 PDF (${bufI.length} bytes)`) : mal("individual", `${cp1.status} ${bufI.toString().slice(0, 120)}`);
const cp2 = await fetch(`${APP}/api/consentimiento-pdf?empresa=${sede.empresa_id}`, { headers: { "x-sesion": admin.access_token } });
const bufM = Buffer.from(await cp2.arrayBuffer());
(cp2.status === 200 && bufM.subarray(0, 5).toString() === "%PDF-" && bufM.length > bufI.length / 2)
  ? ok(`masivo por RS → 200 PDF (${bufM.length} bytes)`) : mal("masivo", `${cp2.status} ${bufM.toString().slice(0, 120)}`);
const cp3 = await fetch(`${APP}/api/consentimiento-pdf?dni=${DNI}`);
cp3.status === 401 ? ok("sin sesión → 401") : mal("sin sesión", cp3.status);
const cp4 = await fetch(`${APP}/api/consentimiento-pdf?dni=${DNI}`, { headers: { "x-sesion": dueno.access_token } });
cp4.status === 403 ? ok("sesión de portal → 403") : mal("portal", cp4.status);

console.log("7 · Limpieza total");
await sql(`
  alter table acuses disable trigger trg_acuses_inmutables;
  delete from acuses where documento_id in (${doc1.id}, ${doc2.id});
  alter table acuses enable trigger trg_acuses_inmutables;
  alter table notificaciones_documento disable trigger trg_notificaciones_inmutables;
  delete from notificaciones_documento where documento_id in (${doc1.id}, ${doc2.id});
  alter table notificaciones_documento enable trigger trg_notificaciones_inmutables;
  alter table consentimientos disable trigger trg_consentimientos_inmutables;
  delete from consentimientos where dni = '${DNI}';
  alter table consentimientos enable trigger trg_consentimientos_inmutables;
  delete from documentos where id in (${doc1.id}, ${doc2.id});
  delete from cuentas_portal where dni = '${DNI}';
  delete from vinculos where persona_dni = '${DNI}';
  delete from usuarios_admin where correo = '${CORREO_TEMP}';
  delete from personas where dni = '${DNI}';
`);
await borrarCuentaGoTrue(CORREO_TEMP);
await borrarCuentaGoTrue(`${DNI}@portal.grupoer.pe`);
const resto = await sql(`select (select count(*) from personas where dni = '${DNI}')
  + (select count(*) from documentos where id in (${doc1.id}, ${doc2.id}))
  + (select count(*) from consentimientos where dni = '${DNI}')
  + (select count(*) from usuarios_admin where correo = '${CORREO_TEMP}') as n`);
resto?.[0]?.n === 0 ? ok("datos ZZ fuera") : mal("limpieza", JSON.stringify(resto));

console.log(fallos === 0 ? "\nTODO EN VERDE" : `\n${fallos} PRUEBAS FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
