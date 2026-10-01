// scripts/verificar-correo.mjs — Verificación en PRODUCCIÓN del motor de correo en
// Resend (2026-09-30): catálogo de correo_fallos_recientes, rastro reciente de
// correo_envios, configuración SMTP de Auth y variables de Vercel (solo nombres).
// Solo lecturas. Lo corre Diego con `!` (token: scripts/token-supabase.ps1):
//   export SUPABASE_ACCESS_TOKEN=$(powershell -NoProfile -Command '. .\scripts\token-supabase.ps1 *>$null; $env:SUPABASE_ACCESS_TOKEN' | tail -n 1 | tr -d "\r\n") && node scripts/verificar-correo.mjs
import { spawnSync } from "node:child_process";
const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
let fallos = 0;
const prueba = async (n, fn) => { try { await fn(); console.log(`✓ ${n}`); } catch (e) { fallos++; console.error(`✗ ${n}: ${e.message}`); } };
const igual = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
const api = async (ruta, init) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}${ruta}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`); return JSON.parse(t);
};
const sql = (q) => api("/database/query", { method: "POST", body: JSON.stringify({ query: q }) });

console.log("== Base");
await prueba("correo_fallos_recientes: definer con search_path, EXECUTE solo authenticated, guarda requiere_superadmin; correo_envios cerrada", async () => {
  const [g] = await sql(`select p.prosecdef as def, exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%') as sp,
    has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('anon', p.oid, 'execute') as anon,
    (p.prosrc ~ 'perform requiere_superadmin\\(\\)') as guarda, has_table_privilege('authenticated', 'public.correo_envios', 'select') as tabla
    from pg_proc p where p.oid = 'public.correo_fallos_recientes()'::regprocedure`);
  igual(`${g.def}/${g.sp}/${g.auth}/${g.anon}/${g.guarda}/${g.tabla}`, "true/true/true/false/true/false", "catálogo");
});
await prueba("rastro: últimos 10 envíos (informativo); ningún error de Gmail/SMTP después del último envío exitoso", async () => {
  const filas = await sql(`select to_char(creado_en at time zone 'America/Lima', 'DD/MM HH24:MI') as hora, accion, resultado, left(detalle, 80) as detalle from correo_envios order by id desc limit 10`);
  for (const f of filas) console.log(`   ${f.hora}  ${f.accion.padEnd(18)} ${f.resultado.padEnd(9)} ${f.detalle ?? ""}`);
  // El código ya no tiene camino SMTP: un 535/SMTP posterior al último «enviado»
  // significaría que producción corre un paquete viejo.
  const [{ n }] = await sql(`select count(*)::int as n from correo_envios where resultado = 'error' and detalle ~ '535|BadCredentials|SMTP'
    and creado_en > coalesce((select max(creado_en) from correo_envios where resultado = 'enviado'), '-infinity')`);
  igual(n, 0, "errores de Gmail tras el último envío exitoso");
});

console.log("\n== Supabase Auth");
await prueba("SMTP de Resend con el remitente del dominio y asuntos en español", async () => {
  const c = await api("/config/auth");
  igual(`${c.smtp_host}/${c.smtp_user}/${c.smtp_admin_email}/${c.smtp_sender_name}`, "smtp.resend.com/resend/no-responder@avisos.servicios-intranet.net/IntraTech", "smtp");
  igual(c.mailer_subjects_invite, "Tu acceso al BackOffice — IntraTech", "asunto invitación");
  igual(c.mailer_subjects_recovery, "Crea una clave nueva — BackOffice IntraTech", "asunto recuperación");
});

console.log("\n== Vercel (solo nombres de variables)");
await prueba("RESEND_API_KEY y CORREO_REMITENTE en Production y Preview; SMTP_USER/SMTP_PASS retiradas", async () => {
  const r = spawnSync("vercel", ["env", "ls"], { shell: true, encoding: "utf8" });
  const salida = `${r.stdout}\n${r.stderr}`;
  // Una fila por variable: nombre al inicio de la línea y el entorno en la misma línea.
  const tiene = (nombre, entorno) => new RegExp(`^\\s*${nombre}\\s+[^\\n]*\\b${entorno}\\b`, "m").test(salida);
  igual(`${tiene("RESEND_API_KEY", "Production")}/${tiene("RESEND_API_KEY", "Preview")}/${tiene("CORREO_REMITENTE", "Production")}`, "true/true/true", "resend");
  igual(/SMTP_USER|SMTP_PASS/.test(salida), false, "gmail sigue en Vercel");
});
console.log(fallos ? `\n${fallos} fallo(s).` : "\nTodo verde.");
process.exit(fallos ? 1 : 0);
