// Fija el dominio oficial en Supabase Auth: site_url = servicios-intranet.net
// y deja el dominio de Vercel en uri_allow_list (antes lo cubría site_url).
// Uso: node scripts/configurar-dominio-auth.mjs [--aplicar]   (sin --aplicar solo lee)
// Requiere SUPABASE_ACCESS_TOKEN (scripts/token-supabase.ps1).

const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const OFICIAL = "https://servicios-intranet.net";
const NECESARIAS = [
  "https://servicios-intranet.net/**",
  "https://www.servicios-intranet.net/**",
  "https://intranet-general.vercel.app/**",
];
const token = (process.env.SUPABASE_ACCESS_TOKEN || "").trim();
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }

const base = `https://api.supabase.com/v1/projects/${PROYECTO}/config/auth`;
const cab = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const leer = async () => {
  const r = await fetch(base, { headers: cab });
  if (!r.ok) { console.error(`GET HTTP ${r.status}: ${await r.text()}`); process.exit(1); }
  const c = await r.json();
  return { site_url: c.site_url, uri_allow_list: c.uri_allow_list };
};

const antes = await leer();
console.log("ANTES:", JSON.stringify(antes));
if (!process.argv.includes("--aplicar")) process.exit(0);

const lista = (antes.uri_allow_list || "").split(",").map((s) => s.trim()).filter(Boolean);
for (const u of NECESARIAS) if (!lista.includes(u)) lista.push(u);

const p = await fetch(base, {
  method: "PATCH",
  headers: cab,
  body: JSON.stringify({ site_url: OFICIAL, uri_allow_list: lista.join(",") }),
});
if (!p.ok) { console.error(`PATCH HTTP ${p.status}: ${await p.text()}`); process.exit(1); }

const despues = await leer();
console.log("DESPUES:", JSON.stringify(despues));
const ok = despues.site_url === OFICIAL && NECESARIAS.every((u) => (despues.uri_allow_list || "").split(",").includes(u));
if (!ok) { console.error("La configuración no quedó como se esperaba."); process.exit(1); }
console.log("site_url y uri_allow_list verificados.");
