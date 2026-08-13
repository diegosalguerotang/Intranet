// Baja el mínimo global de clave de GoTrue a 6 para el Portal del Trabajador
// (el BackOffice sigue exigiendo 12 en sus pantallas y sus claves generadas
// son de 14). Requiere SUPABASE_ACCESS_TOKEN (scripts/token-supabase.ps1).
const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }

const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/config/auth`, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ password_min_length: 6 }),
});
const json = await r.json();
if (!r.ok) { console.error(`HTTP ${r.status}:`, JSON.stringify(json).slice(0, 300)); process.exit(1); }
console.log("password_min_length ahora:", json.password_min_length);
