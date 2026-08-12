// Restablece la clave de un usuario administrativo (operación de operador,
// equivalente al "restablecimiento manual"). La clave llega por variable de
// entorno, nunca por código ni argumentos.
//   env: RESET_EMAIL · RESET_CLAVE (≥12) · RESET_SIN_CAMBIO=1 (opcional: no
//        exigir cambio en el siguiente ingreso) · SUPABASE_ACCESS_TOKEN
const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const SUPA_URL = `https://${PROYECTO}.supabase.co`;
const { RESET_EMAIL, RESET_CLAVE, RESET_SIN_CAMBIO, SUPABASE_ACCESS_TOKEN } = process.env;
if (!RESET_EMAIL || !RESET_CLAVE || !SUPABASE_ACCESS_TOKEN) {
  console.error("Faltan RESET_EMAIL / RESET_CLAVE / SUPABASE_ACCESS_TOKEN.");
  process.exit(1);
}
if (RESET_CLAVE.length < 12) {
  console.error("La clave del BackOffice debe tener 12 caracteres o más.");
  process.exit(1);
}

const keys = await (await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` },
})).json();
const service = keys.find((k) => k.name === "service_role")?.api_key;
if (!service) { console.error("No se encontró la service_role."); process.exit(1); }
const cab = { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" };

const { users = [] } = await (await fetch(`${SUPA_URL}/auth/v1/admin/users?per_page=1000`, { headers: cab })).json();
const u = users.find((x) => (x.email ?? "").toLowerCase() === RESET_EMAIL.toLowerCase());
if (!u) { console.error(`No existe cuenta Auth para ${RESET_EMAIL}.`); process.exit(1); }

const r = await fetch(`${SUPA_URL}/auth/v1/admin/users/${u.id}`, {
  method: "PUT", headers: cab, body: JSON.stringify({ password: RESET_CLAVE }),
});
if (!r.ok) { console.error(`HTTP ${r.status}: ${await r.text()}`); process.exit(1); }

if (RESET_SIN_CAMBIO === "1") {
  const sql = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `update usuarios_admin set requiere_cambio_clave = false, clave_provisional = null where lower(correo) = lower('${RESET_EMAIL.replace(/'/g, "''")}');` }),
  });
  if (!sql.ok) { console.error(`SQL HTTP ${sql.status}: ${await sql.text()}`); process.exit(1); }
  console.log("Clave restablecida; NO se exigirá cambio en el siguiente ingreso.");
} else {
  console.log("Clave restablecida; se exigirá cambio en el siguiente ingreso.");
}
