// scripts/verificar-smtp.mjs — Comprueba que las credenciales SMTP (Gmail) que
// usa api/_correo.js en Vercel SIGUEN siendo válidas. Solo hace el login SMTP
// (transporter.verify): no envía ningún correo. Lo corre DIEGO con `!`:
//
//   cd /c/Users/DiegoSalguero/Intranet && vercel env pull .env.smtp --environment=production --yes && node scripts/verificar-smtp.mjs .env.smtp; rm -f .env.smtp
//
// Resultado típico cuando Google revocó o rotó la contraseña de aplicación:
//   "Invalid login: 535-5.7.8 Username and Password not accepted" → generar una
//   contraseña de aplicación nueva y reemplazar SMTP_PASS en Vercel (ver
//   docs/seguridad/2026-09-17-fase0-contencion.md, rotación de Gmail).
import { readFileSync } from "node:fs";
import nodemailer from "nodemailer";

const ruta = process.argv[2];
if (!ruta) { console.error("Uso: node scripts/verificar-smtp.mjs <archivo .env descargado de Vercel>"); process.exit(1); }
const env = Object.fromEntries(
  readFileSync(ruta, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }),
);
const user = env.SMTP_USER ?? "", pass = env.SMTP_PASS ?? "";
// OJO (2026-09-18): `vercel env pull` NO descarga el valor de una variable
// marcada Sensitive: escribe el texto literal "[SENSITIVE]" (11 caracteres).
// En ese caso este script no puede probar nada; la prueba válida es un envío
// real desde producción (api/enviar-correo, acción recuperacion-admin) y leer
// el resultado en la tabla correo_envios.
if ([user, pass].includes("[SENSITIVE]")) {
  console.error("SMTP_USER/SMTP_PASS son Sensitive en Vercel: el pull trae \"[SENSITIVE]\", no el valor. Prueba con un envío real y mira correo_envios.");
  process.exit(2);
}
const oculto = user ? user.replace(/^(..).*(@.*)$/, "$1***$2") : "(vacío)";
console.log(`SMTP_USER: ${oculto} · SMTP_PASS: ${pass ? `${pass.length} caracteres` : "(vacío)"} · RESEND_API_KEY: ${env.RESEND_API_KEY ? "sí" : "no"}`);
if (!user || !pass) { console.error("Faltan SMTP_USER o SMTP_PASS en el entorno de producción."); process.exit(1); }
const transporte = nodemailer.createTransport({ host: env.SMTP_HOST || "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
try {
  await transporte.verify();
  console.log("✓ Login SMTP aceptado: las credenciales de Gmail funcionan.");
} catch (e) {
  console.error(`✗ Login SMTP rechazado: ${String(e.message).slice(0, 300)}`);
  process.exit(1);
}
