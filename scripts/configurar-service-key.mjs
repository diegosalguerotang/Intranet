// Configura en Vercel la env var SUPA_SERVICE_KEY con la service key REAL del
// proyecto Supabase (la SUPABASE_SERVICE_ROLE_KEY que dejó el marketplace no
// corresponde a este proyecto). La clave viaja por stdin: nunca por consola.
//   ./scripts/token-supabase.ps1; node scripts/configurar-service-key.mjs
import { spawnSync } from "node:child_process";

const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }

const keys = await (await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${token}` },
})).json();
const service = keys.find((k) => k.name === "service_role")?.api_key;
if (!service) { console.error("No se encontró la service_role."); process.exit(1); }

for (const entorno of ["production", "preview"]) {
  spawnSync("vercel", ["env", "rm", "SUPA_SERVICE_KEY", entorno, "--yes"], { shell: true, encoding: "utf8" });
  const r = spawnSync("vercel", ["env", "add", "SUPA_SERVICE_KEY", entorno, "--sensitive"], {
    shell: true, input: service, encoding: "utf8",
  });
  console.log(`${entorno}: ${r.status === 0 ? "SUPA_SERVICE_KEY configurada" : `FALLO — ${r.stderr?.slice(0, 200)}`}`);
}
