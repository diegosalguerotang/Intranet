// Núcleo compartido del motor de correo (el guion bajo evita que Vercel lo
// exponga como endpoint). Único proveedor: Resend (env RESEND_API_KEY, llave de
// solo envío limitada al dominio avisos.servicios-intranet.net; remitente en
// CORREO_REMITENTE). Gmail/SMTP se retiró el 2026-09-30: Google revocaba la
// contraseña de aplicación y dejaba sin segundo factor a los superadmins.
// Sin llave, devuelve el error claro y quien llama decide si es bloqueante.
const limpiar = (v) => (typeof v === "string" ? v.replace(/^[﻿​\s]+|[﻿​\s]+$/g, "") : v);
const RESEND = limpiar(process.env.RESEND_API_KEY) || "";
export const REMITENTE = limpiar(process.env.CORREO_REMITENTE) || "GrupoER <onboarding@resend.dev>";
// Resend limita las peticiones por segundo: ante 429 se espera y se reintenta
// UNA vez (cubre los envíos en lote de cuentas del portal).
export const PAUSA_429_MS = 1000;
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

export const motorConfigurado = () => Boolean(RESEND);

export async function enviar(destino, asunto, html) {
  if (!RESEND) return { error: "El motor de correo aún no está configurado (falta RESEND_API_KEY)." };
  const pedir = () => fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND}`, "content-type": "application/json" },
    body: JSON.stringify({ from: REMITENTE, to: [destino], subject: asunto, html }),
  });
  let r = await pedir();
  if (r.status === 429) { await pausa(PAUSA_429_MS); r = await pedir(); }
  if (!r.ok) return { error: `El proveedor de correo respondió ${r.status}: ${(await r.text()).slice(0, 200)}` };
  return {};
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
