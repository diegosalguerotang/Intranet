// scripts/diagnostico-login-e2e.mjs — reproduce EXACTAMENTE la secuencia del
// login del BackOffice (AdminLogin.jsx) a través del proxy de producción,
// cronometrando cada paso, con un admin TEMPORAL que se borra al final.
// Para diagnosticar «se queda en Verificando…» sin usar credenciales reales.
//   Uso: . .\scripts\token-supabase.ps1
//        node scripts/diagnostico-login-e2e.mjs
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }

const PROXY = "https://intranet-general.vercel.app/api/supa";
const REF = "mzpbdkrmokfxrrsotfgs";
const EMAIL = "zzdiag-login@grupoer.pe";
const CLAVE = "diag" + Math.random().toString(36).slice(2, 8) + "1a";
const DNI = "ZZDIAG-LOGIN";

const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { error: t }; }
};

// Llave service para crear/borrar la cuenta GoTrue (patrón cuentas-masa).
const llaves = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${token}` },
})).json();
const SERVICE = llaves.find?.((k) => k.type === "secret" || k.name === "service_role")?.api_key
  ?? llaves.find?.((k) => k.name?.includes("service"))?.api_key;
if (!SERVICE) { console.error("No se pudo obtener la service key."); process.exit(1); }
const SUPA = `https://${REF}.supabase.co`;

const limpiar = async () => {
  await sql(`delete from usuarios_admin where correo = '${EMAIL}';
             delete from personas where dni = '${DNI}';`);
  const lista = await (await fetch(`${SUPA}/auth/v1/admin/users?page=1&per_page=100`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  })).json();
  const u = (lista.users ?? []).find((x) => x.email === EMAIL);
  if (u) await fetch(`${SUPA}/auth/v1/admin/users/${u.id}`, {
    method: "DELETE", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
};
await limpiar();

// Admin temporal superadmin sobre persona propia (persona_dni es UNIQUE).
await sql(`insert into personas (dni, nombre, portal) values ('${DNI}', 'ZZ DIAG LOGIN', 'sin_celular');`);
const crear = await (await fetch(`${SUPA}/auth/v1/admin/users`, {
  method: "POST",
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: CLAVE, email_confirm: true }),
})).json();
if (!crear.id) { console.error("No se pudo crear la cuenta:", JSON.stringify(crear).slice(0, 300)); await limpiar(); process.exit(1); }
await sql(`insert into usuarios_admin (persona_dni, correo, perfil_id, perfil_version, estado, creado_por)
  select '${DNI}', '${EMAIL}', id, max(version), 'activo', 'diagnostico'
  from perfiles where es_superadmin group by id limit 1;`);

// ——— La secuencia EXACTA del navegador, por el PROXY ———
const paso = async (nombre, fn) => {
  const t0 = performance.now();
  try {
    const r = await fn();
    const ms = Math.round(performance.now() - t0);
    console.log(`  ${String(ms).padStart(5)} ms · ${nombre} · HTTP ${r.status}`);
    return r;
  } catch (e) {
    console.log(`  FALLÓ · ${nombre} · ${e.message}`);
    return null;
  }
};
const json = { "Content-Type": "application/json" };

console.log("Secuencia del login (como el navegador, vía /api/supa):");
await paso("1 verificar_bloqueo", () => fetch(`${PROXY}/rest/v1/rpc/verificar_bloqueo`, {
  method: "POST", headers: json, body: JSON.stringify({ p_correo: EMAIL }) }));
const rTok = await paso("2 token (clave correcta)", () => fetch(`${PROXY}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: json, body: JSON.stringify({ email: EMAIL, password: CLAVE }) }));
const ses = rTok ? (await rTok.json()).access_token : null;
if (!ses) { console.error("Sin token: no se puede seguir."); await limpiar(); process.exit(1); }
// x-sesion lleva el token CRUDO: el proxy le antepone «Bearer » él mismo.
const auth = { ...json, "x-sesion": ses };
await paso("3 v_usuarios_admin (padrón activo)", () => fetch(
  `${PROXY}/rest/v1/v_usuarios_admin?select=id,estado&correo=eq.${encodeURIComponent(EMAIL)}`, { headers: auth }));
await paso("4 registrar_ingreso exitoso", () => fetch(`${PROXY}/rest/v1/rpc/registrar_ingreso`, {
  method: "POST", headers: auth, body: JSON.stringify({ p_correo: EMAIL, p_resultado: "exitoso", p_dispositivo: "diagnóstico" }) }));
await paso("5 registrar_sesion_backoffice", () => fetch(`${PROXY}/rest/v1/rpc/registrar_sesion_backoffice`, {
  method: "POST", headers: auth, body: JSON.stringify({ p_marker: "diag-" + Date.now() }) }));

console.log("Carga posterior (lo que espera «Verificando sesión…»):");
await paso("6 v_mi_acceso", () => fetch(`${PROXY}/rest/v1/v_mi_acceso?select=*`, { headers: auth }));
for (const v of ["v_personal", "v_perfiles", "v_usuarios_admin", "empresas", "v_sedes",
                 "v_asistencia_lotes", "v_comunicados", "v_solicitudes", "v_acuses", "v_activos"]) {
  await paso(`7 ${v}`, () => fetch(`${PROXY}/rest/v1/${v}?select=*&limit=1000`, { headers: auth }));
}
await paso("8 mi_sesion_backoffice (sondeo de sesión única)", () => fetch(`${PROXY}/rest/v1/rpc/mi_sesion_backoffice`, {
  method: "POST", headers: auth, body: "{}" }));

await limpiar();
console.log("Limpieza hecha (admin temporal eliminado).");
