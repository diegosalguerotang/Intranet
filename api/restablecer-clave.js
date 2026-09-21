// Restablecimiento de clave del portal con token de recuperación (el enlace
// del correo lleva al portal /portal/restablecer, que POSTea aquí). El token
// es de un solo uso y vence en 1 hora; la clave nueva la elige el trabajador.
import { limitar, ipDe, registrar } from "./enviar-correo.js";
import { CLAVE_MIN_PORTAL, DOMINIO_PORTAL, validarClaveBackoffice } from "./_clave.js";
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

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!SERVICE) return res.status(500).json({ error: "Falta la clave de servicio." });
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido." });
  const cuerpo = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
  const token = String(cuerpo.token ?? "");
  const clave = String(cuerpo.clave ?? "");
  // Fase 6d: límite por IP real (misma ventana y tope que el correo) y rastro
  // de cada intento en correo_envios; el registro caído cierra el endpoint.
  const ip = ipDe(req);
  const limite = await limitar("restablecer-clave", ip, null);
  if (limite) return res.status(limite.status).json({ error: limite.error });
  const rastro = (resultado, detalle) => registrar({ accion: "restablecer-clave", ip, sujeto: token.slice(0, 12) || null, resultado, detalle });
  if (!token) return res.status(400).json({ error: "Falta el token del enlace." });
  if (clave.length < CLAVE_MIN_PORTAL) return res.status(400).json({ error: `La clave debe tener al menos ${CLAVE_MIN_PORTAL} caracteres.` });

  const t = (await rest("/rest/v1/rpc/api_token_leer", { method: "POST", body: JSON.stringify({ p_token: token, p_propositos: ["recuperacion", "recuperacion-admin"] }) })).json?.[0];
  if (!t) { await rastro("rechazado", "token desconocido"); return res.status(404).json({ error: "El enlace no es válido. Pide uno nuevo desde «Olvidé mi clave»." }); }
  if (t.usado_en) { await rastro("rechazado", "token usado"); return res.status(410).json({ error: "Este enlace ya se usó. Pide uno nuevo si aún lo necesitas." }); }
  if (new Date(t.expira_en) < new Date()) {
    await rastro("rechazado", "token vencido");
    return res.status(410).json({ error: "El enlace venció (dura 1 hora). Pide uno nuevo desde «Olvidé mi clave»." });
  }

  // Portal: la cuenta técnica del DNI, clave mínima 6 (Auth). BackOffice: el
  // piso de api/_clave.js (fase 6c, P11: 10 con letras y números).
  const esAdmin = t.proposito === "recuperacion-admin";
  const debil = esAdmin ? validarClaveBackoffice(clave) : null;
  if (debil) return res.status(400).json({ error: debil });
  const emailCuenta = esAdmin ? t.correo.toLowerCase() : `${t.dni.toLowerCase()}@${DOMINIO_PORTAL}`;
  const cuenta = (await rest(`/auth/v1/admin/users?per_page=1000`)).json?.users
    ?.find((u) => (u.email ?? "").toLowerCase() === emailCuenta);
  if (!cuenta) return res.status(404).json({ error: "La cuenta no existe." });

  const cambio = await rest(`/auth/v1/admin/users/${cuenta.id}`, {
    method: "PUT", body: JSON.stringify({ password: clave }),
  });
  if (!cambio.ok) return res.status(500).json({ error: "No se pudo guardar la clave nueva. Intenta de nuevo." });

  if (esAdmin) {
    // La eligió la propia persona: no hay cambio obligatorio pendiente.
    await rest("/rest/v1/rpc/api_admin_marcar_clave", { method: "POST", body: JSON.stringify({ p_id: null, p_correo: emailCuenta, p_requiere_cambio: false }) });
  }

  await rest("/rest/v1/rpc/api_token_usar", { method: "POST", body: JSON.stringify({ p_token: token }) });
  await rastro("enviado", esAdmin ? "clave del BackOffice restablecida" : "clave del Portal restablecida");
  return res.status(200).json({ listo: true, backoffice: esAdmin });
}
