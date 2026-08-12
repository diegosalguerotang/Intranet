// Cambia el correo de un usuario administrativo en ambos lados: la cuenta del
// proveedor de identidad (GoTrue) y el padrón usuarios_admin. La clave no se
// toca. env: CORREO_ACTUAL · CORREO_NUEVO · SUPABASE_ACCESS_TOKEN
const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const SUPA_URL = `https://${PROYECTO}.supabase.co`;
const { CORREO_ACTUAL, CORREO_NUEVO, SUPABASE_ACCESS_TOKEN } = process.env;
if (!CORREO_ACTUAL || !CORREO_NUEVO || !SUPABASE_ACCESS_TOKEN) {
  console.error("Faltan CORREO_ACTUAL / CORREO_NUEVO / SUPABASE_ACCESS_TOKEN.");
  process.exit(1);
}

const keys = await (await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` },
})).json();
const service = keys.find((k) => k.name === "service_role")?.api_key;
if (!service) { console.error("No se encontró la service_role."); process.exit(1); }
const cab = { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" };

const { users = [] } = await (await fetch(`${SUPA_URL}/auth/v1/admin/users?per_page=1000`, { headers: cab })).json();
const u = users.find((x) => (x.email ?? "").toLowerCase() === CORREO_ACTUAL.toLowerCase());
if (!u) { console.error(`No existe cuenta Auth para ${CORREO_ACTUAL}.`); process.exit(1); }

const r = await fetch(`${SUPA_URL}/auth/v1/admin/users/${u.id}`, {
  method: "PUT", headers: cab,
  body: JSON.stringify({ email: CORREO_NUEVO, email_confirm: true }),
});
if (!r.ok) { console.error(`GoTrue HTTP ${r.status}: ${await r.text()}`); process.exit(1); }

const esc = (s) => s.replace(/'/g, "''");
const sql = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    query: `update usuarios_admin set correo = '${esc(CORREO_NUEVO)}' where lower(correo) = lower('${esc(CORREO_ACTUAL)}');
            select correo, estado from v_usuarios_admin where correo = '${esc(CORREO_NUEVO)}';`,
  }),
});
const res = await sql.json();
if (!sql.ok) { console.error(`SQL: ${JSON.stringify(res)}`); process.exit(1); }
console.log(`Correo actualizado en Auth y en el padrón: ${JSON.stringify(res)}`);
