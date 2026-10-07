// scripts/migrar-dominio-portal.mjs — Renombra en Supabase Auth las cuentas
// técnicas del Portal: dni@portal.grupoer.pe → dni@portal.servicios-intranet.net
// (2026-10-07). La parte local (DNI en minúsculas) no cambia. GoTrue no envía
// correo (email_confirm) y el dominio nuevo tampoco recibe.
//   sin argumentos → lista cuántas cuentas cambiarían (no escribe)
//   --aplicar      → renombra viejo → nuevo y comprueba que no quede ninguna vieja
//   --revertir     → renombra nuevo → viejo (reversión; antes del SQL de reversión)
//   --verificar    → 0 cuentas viejas y cada cuenta nueva con fila en cuentas_portal
// Lo corre Diego con `!`:
//   powershell -NoProfile -Command ". ./scripts/token-supabase.ps1; node scripts/migrar-dominio-portal.mjs --aplicar"
// Requiere SUPABASE_ACCESS_TOKEN (Management API; de ahí sale la llave de servicio).
import { fileURLToPath } from "node:url";
import { DOMINIO_VIEJO, DOMINIO_NUEVO } from "./lib/dominio-portal.mjs";

const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const SUPA = `https://${PROYECTO}.supabase.co`;

export const correoNuevo = (correo, de, a) => {
  const c = String(correo ?? "").trim().toLowerCase();
  return c && c.endsWith(`@${de}`) ? `${c.slice(0, -(de.length + 1))}@${a}` : null;
};
export const enmascarar = (correo) => {
  const [local, dominio] = String(correo ?? "").split("@");
  return `${local.slice(0, 2)}***@${dominio ?? ""}`;
};

const json = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { crudo: t, status: r.status }; } };

async function principal() {
  const token = (process.env.SUPABASE_ACCESS_TOKEN || "").trim();
  if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
  const modo = process.argv.includes("--aplicar") ? "aplicar" : process.argv.includes("--revertir") ? "revertir" : process.argv.includes("--verificar") ? "verificar" : "listar";
  const [DE, A] = modo === "revertir" ? [DOMINIO_NUEVO, DOMINIO_VIEJO] : [DOMINIO_VIEJO, DOMINIO_NUEVO];

  const claves = await json(await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${token}` } }));
  const service = (Array.isArray(claves) ? claves : []).find((k) => k.type === "secret" || k.name === "service_role")?.api_key;
  if (!service) { console.error("La Management API no devolvió la llave de servicio."); process.exit(1); }
  const cab = { apikey: service, authorization: `Bearer ${service}`, "Content-Type": "application/json" };
  const gotrue = async (ruta, opciones = {}) => { const r = await fetch(`${SUPA}${ruta}`, { ...opciones, headers: { ...cab, ...opciones.headers } }); return { ok: r.ok, status: r.status, json: await json(r) }; };
  const sql = async (q) => json(await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) }));

  const usuarios = async () => {
    const r = await gotrue("/auth/v1/admin/users?per_page=1000");
    if (!r.ok) { console.error(`GoTrue HTTP ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`); process.exit(1); }
    return r.json.users ?? [];
  };
  const conDominio = (lista, d) => lista.filter((u) => correoNuevo(u.email, d, d) !== null);

  if (modo === "verificar") {
    const todos = await usuarios();
    const viejas = conDominio(todos, DOMINIO_VIEJO).length, nuevas = conDominio(todos, DOMINIO_NUEVO).length;
    const [h] = await sql(`select count(*)::int as huerfanas from auth.users u where u.email like '%@${DOMINIO_NUEVO}'
      and not exists (select 1 from cuentas_portal c where lower(c.dni) = split_part(u.email, '@', 1))`);
    const [p] = await sql("select count(*)::int as cuentas from cuentas_portal");
    console.log(`viejas: ${viejas} · nuevas: ${nuevas} · cuentas_portal: ${p?.cuentas} · nuevas sin fila en cuentas_portal: ${h?.huerfanas}`);
    const bien = viejas === 0 && h?.huerfanas === 0 && nuevas === p?.cuentas;
    console.log(bien ? "VERIFICADO: todas las cuentas del Portal están en el dominio nuevo." : "NO VERIFICADO.");
    process.exit(bien ? 0 : 1);
  }

  const pendientes = conDominio(await usuarios(), DE);
  console.log(`${pendientes.length} cuenta(s) con @${DE} → @${A}`);
  for (const u of pendientes) console.log(`  ${enmascarar(u.email)} → ${enmascarar(correoNuevo(u.email, DE, A))}`);
  if (modo === "listar") { console.log("(sin cambios; usa --aplicar)"); return; }

  let errores = 0;
  for (const u of pendientes) {
    const r = await gotrue(`/auth/v1/admin/users/${u.id}`, { method: "PUT", body: JSON.stringify({ email: correoNuevo(u.email, DE, A), email_confirm: true }) });
    if (!r.ok) { errores++; console.error(`  ✘ ${enmascarar(u.email)}: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`); }
    else console.log(`  ✔ ${enmascarar(r.json.email ?? "")}`);
  }
  const quedan = conDominio(await usuarios(), DE).length;
  console.log(`quedan con @${DE}: ${quedan} · errores: ${errores}`);
  process.exit(quedan === 0 && errores === 0 ? 0 : 1);
}

const esPrincipal = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esPrincipal) await principal();
