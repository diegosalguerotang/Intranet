// Cierra el acceso a nivel de proveedor de identidad (Cierre de Acceso v1.0):
// · disable_signup: no existe ningún endpoint público de registro de cuentas.
// · password_min_length 12: mínimo del BackOffice (única superficie con Auth).
// Requiere SUPABASE_ACCESS_TOKEN (cargar con scripts/token-supabase.ps1).

const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }

const base = `https://api.supabase.com/v1/projects/${PROYECTO}/config/auth`;
const cab = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

const patch = await fetch(base, {
  method: "PATCH",
  headers: cab,
  body: JSON.stringify({ disable_signup: true, password_min_length: 12 }),
});
if (!patch.ok) { console.error(`PATCH HTTP ${patch.status}: ${await patch.text()}`); process.exit(1); }

const get = await fetch(base, { headers: cab });
const cfg = await get.json();
console.log(`disable_signup: ${cfg.disable_signup} · password_min_length: ${cfg.password_min_length}`);
if (cfg.disable_signup !== true || cfg.password_min_length !== 12) {
  console.error("La configuración no quedó como se esperaba.");
  process.exit(1);
}
console.log("Config de Auth verificada.");
