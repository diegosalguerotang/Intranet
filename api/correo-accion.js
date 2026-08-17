// Aterrizaje del enlace de VERIFICACIÓN de correo (GET desde el email del
// trabajador). Valida el token de un solo uso, marca el correo como
// verificado y responde una página simple — no necesita sesión ni app.
const SUPABASE = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const limpiar = (v) => (typeof v === "string" ? v.replace(/^[﻿​\s]+|[﻿​\s]+$/g, "") : v);
const SERVICE = limpiar(process.env.SUPA_SERVICE_KEY) || limpiar(process.env.SUPABASE_SERVICE_ROLE_KEY) || "";
const cabService = { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" };

async function rest(ruta, opciones = {}) {
  const r = await fetch(`${SUPABASE}${ruta}`, { ...opciones, headers: { ...cabService, ...opciones.headers } });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* sin JSON */ }
  return { ok: r.ok, status: r.status, json };
}

const pagina = (titulo, cuerpo, ok) => `<!doctype html><html lang="es"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${titulo} — GrupoER</title></head>
<body style="font-family:Poppins,Arial,sans-serif;background:#f2f3f5;display:flex;min-height:100dvh;align-items:center;justify-content:center;margin:0">
<div style="background:#fff;border-radius:10px;padding:32px;max-width:420px;text-align:center;box-shadow:0 2px 10px rgba(29,63,114,.08)">
<div style="font-size:40px">${ok ? "✅" : "⚠️"}</div>
<h2 style="color:#3569a0;margin:8px 0 4px">${titulo}</h2>
<p style="color:#555;line-height:1.5">${cuerpo}</p>
</div></body></html>`;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const token = String(req.query.token ?? "");
  if (!token || !SERVICE) {
    return res.status(400).send(pagina("Enlace incompleto", "Vuelve a abrir el enlace desde tu correo.", false));
  }
  const t = (await rest(
    `/rest/v1/correo_tokens?token=eq.${encodeURIComponent(token)}&proposito=eq.verificacion&select=dni,correo,expira_en,usado_en&limit=1`
  )).json?.[0];
  if (!t) return res.status(404).send(pagina("Enlace no válido", "El enlace no existe o no es de verificación.", false));
  if (t.usado_en) return res.status(200).send(pagina("Correo ya confirmado", "Este enlace ya se usó: tu correo quedó verificado.", true));
  if (new Date(t.expira_en) < new Date()) {
    return res.status(410).send(pagina("Enlace vencido", "Pide un enlace nuevo desde Mis datos en el portal.", false));
  }
  // El correo declarado pudo cambiar después de emitir el enlace: solo se
  // verifica si sigue siendo el mismo.
  await rest(`/rest/v1/personas?dni=eq.${t.dni}&correo=eq.${encodeURIComponent(t.correo)}`, {
    method: "PATCH", headers: { prefer: "return=minimal" },
    body: JSON.stringify({ correo_verificado: true }),
  });
  await rest(`/rest/v1/correo_tokens?token=eq.${encodeURIComponent(token)}`, {
    method: "PATCH", headers: { prefer: "return=minimal" },
    body: JSON.stringify({ usado_en: new Date().toISOString() }),
  });
  return res.status(200).send(pagina("¡Correo confirmado!",
    "Ya puedes recuperar tu clave del portal con este correo si algún día la olvidas. Puedes cerrar esta ventana.", true));
}
