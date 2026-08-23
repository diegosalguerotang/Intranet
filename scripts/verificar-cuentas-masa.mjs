// Verificación E2E de #13 (cuentas del portal en masa) contra producción.
//   env: SUPABASE_ACCESS_TOKEN (Management API; con él se obtiene la service
//        key al vuelo y se arma un ADMIN TEMPORAL — patrón 2026-08-19 — que
//        se borra al final). Opcional: ADMIN_EMAIL/ADMIN_CLAVE para usar una
//        cuenta real en vez del temporal.
//   Uso: . .\scripts\token-supabase.ps1; node scripts/verificar-cuentas-masa.mjs
// No prueba el envío REAL de correo (la persona de prueba no tiene correo):
// el camino con correo queda cubierto por el flujo manual C1c del checklist.
const APP = "https://intranet-general.vercel.app";
const SUPA = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const APIKEY = "sb_publishable_qgPwZ8-4neRlKQXpCe9tnw_Dix4Ddwg";
const { ADMIN_EMAIL, ADMIN_CLAVE, SUPABASE_ACCESS_TOKEN } = process.env;
if (!SUPABASE_ACCESS_TOKEN) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }

let fallos = 0;
const ok = (n) => console.log(`  ✔ ${n}`);
const mal = (n, d) => { fallos++; console.error(`  ✘ ${n} — ${String(d).slice(0, 200)}`); };
const json = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { crudo: t, status: r.status }; } };

const login = async (email, clave) => json(await fetch(`${APP}/api/supa/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: clave }),
}));
const sql = async (q) => json(await fetch(`https://api.supabase.com/v1/projects/mzpbdkrmokfxrrsotfgs/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: q }),
}));

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

// Admin temporal (si no hay credenciales reales en el entorno): cuenta GoTrue
// + fila superadmin en usuarios_admin sobre una persona SIN usuario; el
// trigger de registro_accesos solo permite la desvinculación, así que el
// borrado final deja rastro pero no basura.
const CORREO_TEMP = "zzprueba-masa@grupoer.pe";
let adminEmail = ADMIN_EMAIL, adminClave = ADMIN_CLAVE, adminTemporal = false;
if (!adminEmail || !adminClave) {
  adminTemporal = true;
  adminEmail = CORREO_TEMP;
  adminClave = "Zz" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
  await borrarCuentaGoTrue(CORREO_TEMP); // resto de una corrida anterior
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
    values ('${persona.dni}', '${perfil.id}', ${perfil.version}, '${CORREO_TEMP}', 'verificar-cuentas-masa')
    returning id`);
  if (!fila?.[0]?.id) { mal("usuarios_admin temporal", JSON.stringify(fila)); await borrarCuentaGoTrue(CORREO_TEMP); process.exit(1); }
  ok(`admin temporal listo (persona ${persona.dni}, perfil ${perfil.id} v${perfil.version})`);
}
const admin = await login(adminEmail, adminClave);
if (!admin.access_token) { mal("login admin", JSON.stringify(admin)); process.exit(1); }
ok(`sesión admin de ${adminEmail}`);

const endpoint = async (cuerpo) => {
  const r = await fetch(`${APP}/api/portal-cuentas`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-sesion": admin.access_token },
    body: JSON.stringify(cuerpo),
  });
  return { status: r.status, ...(await json(r)) };
};

// DNI numérico de 8 que no exista (prefijo 99 + 6 aleatorios).
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
  body: JSON.stringify({ p_dni: DNI, p_nombre: `ZZPRUEBA MASA ${DNI}`, p_cargo: "Operario de limpieza",
    p_sede: sede.id, p_empresa: sede.empresa_id, p_ingreso: "2026-08-01" }),
});
alta.ok ? ok(`persona de prueba ${DNI} en ${sede.empresa_id}`) : mal("alta_trabajador", await alta.text());

console.log("1 · crear-lote sin correo → clave aleatoria de 6 dígitos");
const lote = await endpoint({ accion: "crear-lote", dnis: [DNI] });
const r1 = lote.resultados?.[0] ?? {};
(/^[0-9]{6}$/.test(r1.clave ?? "")) ? ok(`clave de 6 dígitos (${r1.clave})`) : mal("clave", JSON.stringify(lote));
(r1.clave !== "111111") ? ok("ya no es la fija 111111") : mal("clave fija", "salió 111111 (azar degenerado: reintenta)");
(!r1.enviado) ? ok("sin correo registrado no viaja 'enviado'") : mal("enviado", JSON.stringify(r1));
(r1.nombre ?? "").startsWith("ZZPRUEBA") ? ok("el resultado trae el nombre (para el CSV)") : mal("nombre", JSON.stringify(r1));

console.log("2 · La clave devuelta abre sesión en el portal");
const ses1 = await login(`${DNI}@portal.grupoer.pe`, r1.clave);
ses1.access_token ? ok("login del trabajador 200") : mal("login portal", JSON.stringify(ses1));

console.log("3 · v_personal refleja tieneCuenta");
const vp = await json(await fetch(`${SUPA}/rest/v1/v_personal?dni=eq.${DNI}&select=dni,"tieneCuenta"&apikey=${APIKEY}`, {
  headers: { authorization: `Bearer ${admin.access_token}` },
}));
(vp?.[0]?.tieneCuenta === true) ? ok("tieneCuenta = true") : mal("v_personal", JSON.stringify(vp));

console.log("4 · Reintentos y topes");
const otra = await endpoint({ accion: "crear", dni: DNI });
(otra.status === 400 && /ya existe/i.test(otra.error ?? "")) ? ok("crear duplicado → 400 'ya existe'") : mal("duplicado", JSON.stringify(otra));
const once = await endpoint({ accion: "crear-lote", dnis: Array.from({ length: 11 }, (_, i) => `000000${i}`) });
(once.status === 400 && /Máximo 10/.test(once.error ?? "")) ? ok("lote de 11 → 400 'Máximo 10'") : mal("tope", JSON.stringify(once));

console.log("5 · Restablecer rota la clave");
const rst = await endpoint({ accion: "restablecer", dni: DNI });
(/^[0-9]{6}$/.test(rst.clave ?? "") && rst.clave !== r1.clave) ? ok(`clave nueva distinta (${rst.clave})`) : mal("restablecer", JSON.stringify(rst));
const vieja = await login(`${DNI}@portal.grupoer.pe`, r1.clave);
(!vieja.access_token) ? ok("la clave vieja ya no entra") : mal("clave vieja", "sigue entrando");
const nueva = await login(`${DNI}@portal.grupoer.pe`, rst.clave);
nueva.access_token ? ok("la clave nueva entra") : mal("clave nueva", JSON.stringify(nueva));

console.log("6 · Limpieza (cuentas GoTrue + BD)");
(await borrarCuentaGoTrue(`${DNI}@portal.grupoer.pe`)) ? ok("cuenta del portal de prueba eliminada")
  : mal("borrar cuenta portal", "no se encontró o no se pudo borrar");
await sql(`delete from cuentas_portal where dni = '${DNI}'`);
await sql(`delete from vinculos where persona_dni = '${DNI}'`);
await sql(`delete from personas where dni = '${DNI}'`);
if (adminTemporal) {
  await sql(`delete from usuarios_admin where correo = '${CORREO_TEMP}'`);
  (await borrarCuentaGoTrue(CORREO_TEMP)) ? ok("admin temporal eliminado") : mal("borrar admin temporal", "no se pudo");
}
const resto = await sql(`select (select count(*) from personas where dni = '${DNI}') +
  (select count(*) from cuentas_portal where dni = '${DNI}') +
  (select count(*) from usuarios_admin where correo = '${CORREO_TEMP}') as n`);
(resto?.[0]?.n === 0) ? ok("BD limpia (persona, vínculo, cuenta y admin de prueba fuera)") : mal("limpieza", JSON.stringify(resto));

console.log(fallos === 0 ? "\nTODO EN VERDE" : `\n${fallos} PRUEBAS FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
