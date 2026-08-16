// api/descargar-documento.js — descarga privada de documentos: valida la
// identidad del llamador y emite una URL firmada de 10 minutos. Los PDFs de
// boleta llevan datos personales impresos (Ley 29733): el bucket es privado
// y este endpoint es el ÚNICO camino de lectura.
const SUPABASE = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const DOMINIO_PORTAL = "portal.grupoer.pe";
const EXPIRA_SEGUNDOS = 600;
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
  const id = String(req.query.id ?? "");
  const jwt = limpiar(req.headers["x-sesion"] ?? "");
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: "Falta el id del documento." });
  if (!jwt) return res.status(401).json({ error: "Sesión requerida." });

  // ¿Quién llama? El JWT se valida contra GoTrue, jamás se decodifica a mano.
  const quien = await rest("/auth/v1/user", { headers: { authorization: `Bearer ${jwt}`, apikey: SERVICE } });
  const correo = (quien.json?.email ?? "").toLowerCase();
  if (!quien.ok || !correo) return res.status(401).json({ error: "Sesión inválida o vencida." });

  // Documento + DNI del vínculo (service key: la tabla es admin-solo por RLS).
  const doc = (await rest(
    `/rest/v1/documentos?id=eq.${id}&select=archivo_url,vinculo_id,vinculos(persona_dni)&limit=1`
  )).json?.[0];
  if (!doc) return res.status(404).json({ error: "El documento no existe." });
  if (!doc.archivo_url) return res.status(404).json({ error: "El documento no tiene archivo." });

  // Autorización: admin activo del BackOffice → todo; cuenta del portal → solo lo suyo.
  let autorizado = false;
  if (correo.endsWith(`@${DOMINIO_PORTAL}`)) {
    const dni = correo.split("@")[0];
    autorizado = doc.vinculos?.persona_dni === dni;
  } else {
    const admin = (await rest(
      `/rest/v1/usuarios_admin?correo=eq.${encodeURIComponent(correo)}&estado=eq.activo&select=id&limit=1`
    )).json?.[0];
    autorizado = Boolean(admin);
  }
  if (!autorizado) return res.status(403).json({ error: "No tienes acceso a este documento." });

  // URL firmada (la ruta jamás viene del cliente: sale de la BD).
  const firma = await rest(`/storage/v1/object/sign/documentos/${doc.archivo_url}`, {
    method: "POST",
    body: JSON.stringify({ expiresIn: EXPIRA_SEGUNDOS }),
  });
  const relativa = firma.json?.signedURL;
  if (!firma.ok || !relativa) return res.status(404).json({ error: "El archivo no está disponible." });
  return res.status(200).json({ url: `${SUPABASE}/storage/v1${relativa}` });
}
