// Núcleo compartido del motor de correo (el guion bajo evita que Vercel lo
// exponga como endpoint). Proveedores en orden: Resend (RESEND_API_KEY) o
// SMTP con nodemailer (SMTP_USER + SMTP_PASS; default Gmail 465). Sin
// ninguno, devuelve el error claro y quien llama decide si es bloqueante.
const limpiar = (v) => (typeof v === "string" ? v.replace(/^[﻿​\s]+|[﻿​\s]+$/g, "") : v);
const RESEND = limpiar(process.env.RESEND_API_KEY) || "";
const SMTP_USER = limpiar(process.env.SMTP_USER) || "";
const SMTP_PASS = limpiar(process.env.SMTP_PASS) || "";
const SMTP_HOST = limpiar(process.env.SMTP_HOST) || "smtp.gmail.com";
export const REMITENTE = limpiar(process.env.CORREO_REMITENTE) ||
  (SMTP_USER ? `GrupoER <${SMTP_USER}>` : "GrupoER <onboarding@resend.dev>");

export const motorConfigurado = () => Boolean(RESEND || (SMTP_USER && SMTP_PASS));

export async function enviar(destino, asunto, html) {
  if (RESEND) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND}`, "content-type": "application/json" },
      body: JSON.stringify({ from: REMITENTE, to: [destino], subject: asunto, html }),
    });
    if (!r.ok) return { error: `El proveedor de correo respondió ${r.status}: ${(await r.text()).slice(0, 200)}` };
    return {};
  }
  if (SMTP_USER && SMTP_PASS) {
    try {
      const { default: nodemailer } = await import("nodemailer");
      const transporte = nodemailer.createTransport({
        host: SMTP_HOST, port: 465, secure: true,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });
      await transporte.sendMail({ from: REMITENTE, to: destino, subject: asunto, html });
      return {};
    } catch (e) {
      return { error: `El envío SMTP falló: ${String(e.message).slice(0, 200)}` };
    }
  }
  return { error: "El motor de correo aún no está configurado (falta RESEND_API_KEY o SMTP_USER/SMTP_PASS)." };
}

export const plantilla = (titulo, cuerpo) => `
  <div style="font-family:Poppins,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#333">
    <h2 style="color:#3569a0;margin-bottom:4px">GrupoER</h2>
    <h3 style="margin-top:0">${titulo}</h3>
    ${cuerpo}
    <p style="font-size:12px;color:#999;margin-top:28px">Si no esperabas este correo, ignóralo: nada cambia sin tu acción.</p>
  </div>`;

export const botonCorreo = (href, texto) =>
  `<p><a href="${href}" style="background:#3569a0;color:#fff;padding:10px 22px;border-radius:10px;text-decoration:none">${texto}</a></p>`;
