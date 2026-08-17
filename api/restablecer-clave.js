// Restablecimiento de clave del portal con token de recuperación (el enlace
// del correo lleva al portal /portal/restablecer, que POSTea aquí). El token
// es de un solo uso y vence en 1 hora; la clave nueva la elige el trabajador.
const SUPABASE = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const DOMINIO_PORTAL = "portal.grupoer.pe";
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

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!SERVICE) return res.status(500).json({ error: "Falta la clave de servicio." });
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido." });
  const cuerpo = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
  const token = String(cuerpo.token ?? "");
  const clave = String(cuerpo.clave ?? "");
  if (!token) return res.status(400).json({ error: "Falta el token del enlace." });
  if (clave.length < 6) return res.status(400).json({ error: "La clave debe tener al menos 6 caracteres." });

  const t = (await rest(
    `/rest/v1/correo_tokens?token=eq.${encodeURIComponent(token)}&proposito=eq.recuperacion&select=dni,expira_en,usado_en&limit=1`
  )).json?.[0];
  if (!t) return res.status(404).json({ error: "El enlace no es válido. Pide uno nuevo desde «Olvidé mi clave»." });
  if (t.usado_en) return res.status(410).json({ error: "Este enlace ya se usó. Pide uno nuevo si aún lo necesitas." });
  if (new Date(t.expira_en) < new Date()) {
    return res.status(410).json({ error: "El enlace venció (dura 1 hora). Pide uno nuevo desde «Olvidé mi clave»." });
  }

  const cuenta = (await rest(`/auth/v1/admin/users?per_page=1000`)).json?.users
    ?.find((u) => (u.email ?? "").toLowerCase() === `${t.dni}@${DOMINIO_PORTAL}`);
  if (!cuenta) return res.status(404).json({ error: "La cuenta del portal no existe." });

  const cambio = await rest(`/auth/v1/admin/users/${cuenta.id}`, {
    method: "PUT", body: JSON.stringify({ password: clave }),
  });
  if (!cambio.ok) return res.status(500).json({ error: "No se pudo guardar la clave nueva. Intenta de nuevo." });

  await rest(`/rest/v1/correo_tokens?token=eq.${encodeURIComponent(token)}`, {
    method: "PATCH", headers: { prefer: "return=minimal" },
    body: JSON.stringify({ usado_en: new Date().toISOString() }),
  });
  return res.status(200).json({ listo: true });
}
