// api/rit.js — lectura permanente del Reglamento Interno de Trabajo (2026-08-19).
// El RIT del trabajador se resuelve por su planilla: sede → empresa (una sede
// con contrato propio declara su RIT y su personal lo «jala» solo). El bucket
// es privado: este endpoint valida la sesión y emite una URL firmada de 10
// minutos, igual que descargar-documento.
// · Cuenta del portal → SU reglamento (el de su sede/empresa).
// · Admin activo    → cualquier reglamento (?rit=id) o el general por defecto.
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
  if (!SERVICE) return res.status(500).json({ error: "Falta la clave de servicio." });
  const jwt = limpiar(req.headers["x-sesion"] ?? "");
  if (!jwt) return res.status(401).json({ error: "Sesión requerida." });

  const quien = await rest("/auth/v1/user", { headers: { authorization: `Bearer ${jwt}`, apikey: SERVICE } });
  const correo = (quien.json?.email ?? "").toLowerCase();
  if (!quien.ok || !correo) return res.status(401).json({ error: "Sesión inválida o vencida." });

  let rit = null;
  if (correo.endsWith(`@${DOMINIO_PORTAL}`)) {
    // Trabajador: su RIT via planilla (vínculo → sede → empresa). El número
    // en personas va en mayúsculas; el local-part en minúsculas (ilike).
    const dni = correo.split("@")[0];
    const p = (await rest(`/rest/v1/personas?dni=ilike.${encodeURIComponent(dni)}&select=dni&limit=1`)).json?.[0];
    if (!p) return res.status(403).json({ error: "No estás en el maestro de personal." });
    const vi = (await rest(
      `/rest/v1/vinculos?persona_dni=eq.${encodeURIComponent(p.dni)}&select=sede_id,empresa_id,fecha_fin&order=fecha_inicio.desc&limit=5`
    )).json ?? [];
    const vinculo = vi.find((v) => v.fecha_fin === null) ?? vi[0];
    if (!vinculo) return res.status(403).json({ error: "No tienes vínculo registrado." });
    const sede = vinculo.sede_id
      ? (await rest(`/rest/v1/sedes?id=eq.${encodeURIComponent(vinculo.sede_id)}&select=rit_id&limit=1`)).json?.[0]
      : null;
    let ritId = sede?.rit_id ?? null;
    if (!ritId) {
      const emp = (await rest(`/rest/v1/empresas?id=eq.${encodeURIComponent(vinculo.empresa_id)}&select=rit_id&limit=1`)).json?.[0];
      ritId = emp?.rit_id ?? null;
    }
    if (ritId) rit = (await rest(`/rest/v1/rits?id=eq.${encodeURIComponent(ritId)}&select=nombre,archivo_url&limit=1`)).json?.[0];
  } else {
    const admin = (await rest(
      `/rest/v1/usuarios_admin?correo=eq.${encodeURIComponent(correo)}&estado=eq.activo&select=id&limit=1`
    )).json?.[0];
    if (!admin) return res.status(403).json({ error: "Sesión sin acceso." });
    const ritId = String(req.query.rit ?? "general-2025").replace(/[^a-z0-9-]/g, "");
    rit = (await rest(`/rest/v1/rits?id=eq.${encodeURIComponent(ritId)}&select=nombre,archivo_url&limit=1`)).json?.[0];
  }

  if (!rit?.archivo_url) return res.status(404).json({ error: "El reglamento no tiene PDF disponible." });
  const firma = await rest(`/storage/v1/object/sign/documentos/${rit.archivo_url}`, {
    method: "POST",
    body: JSON.stringify({ expiresIn: EXPIRA_SEGUNDOS }),
  });
  const relativa = firma.json?.signedURL;
  if (!firma.ok || !relativa) return res.status(404).json({ error: "El archivo no está disponible." });
  return res.status(200).json({ url: `${SUPABASE}/storage/v1${relativa}`, nombre: rit.nombre });
}
