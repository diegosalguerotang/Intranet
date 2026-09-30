// scripts/configurar-correo-auth.mjs — Supabase Auth envía por el SMTP de Resend
// (2026-09-30): invitaciones y recuperaciones del BackOffice salen en español,
// desde el mismo remitente del motor propio y sin el tope nativo de 2-4/hora.
// La llave («supabase-auth», Sending access, dominio avisos.servicios-intranet.net)
// entra por STDIN y jamás se imprime. Lo corre DIEGO con `!`:
//   export SUPABASE_ACCESS_TOKEN=$(powershell -NoProfile -Command '. .\scripts\token-supabase.ps1 *>$null; $env:SUPABASE_ACCESS_TOKEN' | tail -n 1 | tr -d "\r\n")
//   powershell -NoProfile -Command Get-Clipboard | tr -d '\r\n' | node scripts/configurar-correo-auth.mjs
import { readFileSync } from "node:fs";

const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const REMITENTE = "no-responder@avisos.servicios-intranet.net";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
const llave = readFileSync(0, "utf8").replace(/^[﻿\s]+|[\s]+$/g, "");
if (!/^re_[A-Za-z0-9_]{20,}$/.test(llave)) { console.error("La entrada no parece una llave de Resend (re_…)."); process.exit(1); }

const base = `https://api.supabase.com/v1/projects/${PROYECTO}/config/auth`;
const cab = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const deseado = {
  smtp_host: "smtp.resend.com", smtp_port: "465", smtp_user: "resend", smtp_pass: llave,
  smtp_admin_email: REMITENTE, smtp_sender_name: "GrupoER", smtp_max_frequency: 60,
  rate_limit_email_sent: 30,
  mailer_subjects_invite: "Tu acceso al BackOffice — GrupoER",
  mailer_templates_invite_content: readFileSync("supabase/plantillas-correo/invitacion.html", "utf8"),
  mailer_subjects_recovery: "Crea una clave nueva — BackOffice GrupoER",
  mailer_templates_recovery_content: readFileSync("supabase/plantillas-correo/recuperacion.html", "utf8"),
};
const patch = await fetch(base, { method: "PATCH", headers: cab, body: JSON.stringify(deseado) });
if (!patch.ok) { console.error(`PATCH HTTP ${patch.status}: ${(await patch.text()).split(llave).join("[llave]").slice(0, 300)}`); process.exit(1); }

const cfg = await (await fetch(base, { headers: cab })).json();
const esperado = {
  smtp_host: "smtp.resend.com", smtp_port: "465", smtp_user: "resend", smtp_admin_email: REMITENTE, smtp_sender_name: "GrupoER",
  mailer_subjects_invite: deseado.mailer_subjects_invite, mailer_subjects_recovery: deseado.mailer_subjects_recovery,
};
const malas = Object.entries(esperado).filter(([k, v]) => String(cfg[k]) !== String(v)).map(([k]) => k);
console.log(`smtp_host: ${cfg.smtp_host} · smtp_user: ${cfg.smtp_user} · remitente: ${cfg.smtp_sender_name} <${cfg.smtp_admin_email}> · rate_limit_email_sent: ${cfg.rate_limit_email_sent}`);
console.log(`plantillas: invitación ${cfg.mailer_templates_invite_content?.includes("Crear mi clave") ? "ok" : "NO"} · recuperación ${cfg.mailer_templates_recovery_content?.includes("Crear clave nueva") ? "ok" : "NO"}`);
if (malas.length) { console.error(`No quedó como se esperaba: ${malas.join(", ")}`); process.exit(1); }
console.log("Config de correo de Auth verificada.");
