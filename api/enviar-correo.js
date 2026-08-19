// Motor de correo (fase 1, 2026-08-17). Un solo webhook con tres acciones:
//  · credenciales : un admin (nivel ≥2 en Personal) envía el acceso del portal
//                   al correo declarado del trabajador. Opcional al crear la
//                   cuenta: si hay correo, se ofrece; si no, se entrega en mano.
//  · verificacion : el propio trabajador (JWT del portal) recibe un enlace
//                   para validar su correo declarado.
//  · recuperacion : PÚBLICA («olvidé mi clave»): si el DNI tiene correo
//                   VERIFICADO se envía un enlace de restablecimiento; la
//                   respuesta es SIEMPRE la misma (no revela si existe).
// Proveedores (en orden): Resend (env RESEND_API_KEY) o SMTP (env SMTP_USER +
// SMTP_PASS, por defecto Gmail: basta una «contraseña de aplicación» del
// propio Gmail de Diego, sin crear cuentas nuevas — ~500 correos/día).
// Sin ninguno, las acciones responden 503 con un mensaje claro.
import { enviar, plantilla, botonCorreo } from "./_correo.js";

const SUPABASE = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const APP = "https://intranet-general.vercel.app";
const DOMINIO_PORTAL = "portal.grupoer.pe";
const CLAVE_INICIAL = "111111";
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

async function crearToken(dni, proposito, correo, horas) {
  const token = (globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2)).replace(/-/g, "") +
                (globalThis.crypto?.randomUUID?.() ?? "").replace(/-/g, "");
  const alta = await rest("/rest/v1/correo_tokens", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ token, dni, proposito, correo,
      expira_en: new Date(Date.now() + horas * 3600_000).toISOString() }),
  });
  return alta.ok ? token : null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!SERVICE) return res.status(500).json({ error: "Falta la clave de servicio." });
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido." });
  const cuerpo = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
  const { accion } = cuerpo;
  const dni = String(cuerpo.dni ?? "").trim();

  if (accion === "credenciales") {
    // El acceso lo envía un usuario del BackOffice con nivel en Personal.
    const jwt = limpiar(req.headers["x-sesion"] ?? "");
    if (!jwt) return res.status(401).json({ error: "Sesión requerida." });
    const quien = await rest("/auth/v1/user", { headers: { authorization: `Bearer ${jwt}`, apikey: SERVICE } });
    const correoLlamador = (quien.json?.email ?? "").toLowerCase();
    if (!quien.ok || !correoLlamador || correoLlamador.endsWith(`@${DOMINIO_PORTAL}`)) {
      return res.status(401).json({ error: "Sesión inválida." });
    }
    const acceso = await rest(`/rest/v1/v_mi_acceso?correo=eq.${encodeURIComponent(correoLlamador)}&limit=1`);
    const yo = acceso.json?.[0];
    const nivel = yo?.esSuperadmin ? 3 : (yo?.matriz?.personal ?? 0);
    if (!yo || nivel < 2) return res.status(403).json({ error: "Necesitas nivel de acción en Personal." });

    const p = (await rest(`/rest/v1/personas?dni=eq.${dni}&select=nombre,correo&limit=1`)).json?.[0];
    if (!p) return res.status(404).json({ error: "La persona no existe." });
    if (!p.correo) return res.status(400).json({ error: "La persona no tiene correo registrado." });
    const r = await enviar(p.correo, "Tu acceso al Portal del Trabajador — GrupoER", plantilla(
      "Tu acceso al Portal del Trabajador",
      `<p>Hola ${p.nombre.split(" ")[0]}: ya puedes entrar al portal.</p>
       <p><b>Dirección:</b> <a href="${APP}/portal">${APP}/portal</a><br/>
          <b>Usuario:</b> tu DNI (${dni})<br/>
          <b>Clave inicial:</b> ${CLAVE_INICIAL}</p>
       <p>En tu primer ingreso el portal te pedirá crear tu clave personal.</p>`));
    if (r.error) return res.status(503).json({ error: r.error });
    return res.status(200).json({ enviado: p.correo });
  }

  if (accion === "verificacion") {
    // La pide el propio trabajador con su sesión del portal.
    const jwt = limpiar(req.headers["x-sesion"] ?? "");
    const quien = await rest("/auth/v1/user", { headers: { authorization: `Bearer ${jwt}`, apikey: SERVICE } });
    const correoCuenta = (quien.json?.email ?? "").toLowerCase();
    if (!quien.ok || !correoCuenta.endsWith(`@${DOMINIO_PORTAL}`)) {
      return res.status(401).json({ error: "Sesión del portal requerida." });
    }
    const miDni = correoCuenta.split("@")[0];
    const p = (await rest(`/rest/v1/personas?dni=eq.${miDni}&select=nombre,correo,correo_verificado&limit=1`)).json?.[0];
    if (!p?.correo) return res.status(400).json({ error: "No tienes correo declarado." });
    if (p.correo_verificado) return res.status(200).json({ yaVerificado: true });
    const token = await crearToken(miDni, "verificacion", p.correo, 24 * 7);
    if (!token) return res.status(500).json({ error: "No se pudo generar el enlace." });
    const r = await enviar(p.correo, "Confirma tu correo — GrupoER", plantilla(
      "Confirma tu correo",
      `<p>Hola ${p.nombre.split(" ")[0]}: toca el botón para confirmar que este correo es tuyo.
          Así podrás recuperar tu clave si la olvidas.</p>
       <p><a href="${APP}/api/correo-accion?token=${token}"
             style="background:#3569a0;color:#fff;padding:10px 22px;border-radius:10px;text-decoration:none">
          Confirmar mi correo</a></p>
       <p style="font-size:12px;color:#999">El enlace vence en 7 días.</p>`));
    if (r.error) return res.status(503).json({ error: r.error });
    return res.status(200).json({ enviado: p.correo });
  }

  if (accion === "recuperacion") {
    // PÚBLICA. La respuesta jamás revela si el DNI o el correo existen.
    const generica = { mensaje: "Si tu correo está registrado y verificado, te llegará un enlace para crear una clave nueva." };
    if (!/^[0-9]{8}$/.test(dni)) return res.status(200).json(generica);
    const p = (await rest(`/rest/v1/personas?dni=eq.${dni}&select=nombre,correo,correo_verificado&limit=1`)).json?.[0];
    const cuenta = (await rest(`/rest/v1/cuentas_portal?dni=eq.${dni}&select=dni&limit=1`)).json?.[0];
    if (!p?.correo || !p.correo_verificado || !cuenta) return res.status(200).json(generica);
    const token = await crearToken(dni, "recuperacion", p.correo, 1);
    if (token) {
      await enviar(p.correo, "Crea una clave nueva — GrupoER", plantilla(
        "Crea una clave nueva para el portal",
        `<p>Hola ${p.nombre.split(" ")[0]}: pediste restablecer tu clave del Portal del Trabajador.</p>
         <p><a href="${APP}/portal/restablecer?token=${token}"
               style="background:#3569a0;color:#fff;padding:10px 22px;border-radius:10px;text-decoration:none">
            Crear mi clave nueva</a></p>
         <p style="font-size:12px;color:#999">El enlace vence en 1 hora y sirve una sola vez.
            Si no fuiste tú, ignora este correo.</p>`));
    }
    return res.status(200).json(generica);
  }

  if (accion === "recuperacion-admin") {
    // PÚBLICA («olvidé mi clave» del BackOffice). Respuesta siempre genérica.
    const generica = { mensaje: "Si el correo pertenece a un usuario activo, te llegará un enlace para crear una clave nueva." };
    const correo = String(cuerpo.correo ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo) || correo.endsWith(`@${DOMINIO_PORTAL}`)) {
      return res.status(200).json(generica);
    }
    const u = (await rest(
      `/rest/v1/usuarios_admin?correo=eq.${encodeURIComponent(correo)}&estado=eq.activo&select=persona_dni,correo&limit=1`
    )).json?.[0];
    if (!u) return res.status(200).json(generica);
    const token = await crearToken(u.persona_dni, "recuperacion-admin", correo, 1);
    if (token) {
      await enviar(correo, "Crea una clave nueva — BackOffice GrupoER", plantilla(
        "Crea una clave nueva para el BackOffice",
        `<p>Pediste restablecer tu clave del BackOffice de GrupoER.</p>
         ${botonCorreo(`${APP}/admin/restablecer?token=${token}`, "Crear mi clave nueva")}
         <p style="font-size:12px;color:#999">El enlace vence en 1 hora y sirve una sola vez.
            Si no fuiste tú, ignora este correo.</p>`));
    }
    return res.status(200).json(generica);
  }

  if (accion === "aviso-ticket") {
    // Aviso de ticket nuevo (SOP): a los correos configurados en ticket_avisos.
    // La dispara el portal o el BackOffice tras crear; solo necesita el número
    // de un ticket EXISTENTE (no crea nada ni revela más que el aviso).
    const numero = String(cuerpo.numero ?? "").trim();
    if (!/^TK-[0-9]+$/.test(numero)) return res.status(400).json({ error: "Número de ticket inválido." });
    const t = (await rest(`/rest/v1/v_tickets?numero=eq.${encodeURIComponent(numero)}&select=*&limit=1`)).json?.[0];
    if (!t) return res.status(404).json({ error: "El ticket no existe." });
    const avisos = (await rest(`/rest/v1/ticket_avisos?activo=eq.true&select=correo`)).json ?? [];
    const destinos = avisos.map((a) => a.correo);
    if (!destinos.length) return res.status(200).json({ enviados: 0 });
    const html = plantilla(
      `Nuevo ticket ${t.numero}`,
      `<p><b>${t.tipo}</b>${t.subtipo ? ` · ${t.subtipo}` : ""}</p>
       <p>Solicitante: <b>${t.solicitante_nombre}</b>${t.area ? ` — ${t.area}` : ""}${t.solicitante_dni ? ` (DNI ${t.solicitante_dni})` : ""}</p>
       ${t.comentario ? `<p style="border-left:3px solid #3569a0;padding-left:10px;color:#555">${t.comentario}</p>` : ""}
       ${botonCorreo(`${APP}/soporte/tickets`, "Ver en la intranet")}`);
    let enviados = 0;
    for (const correo of destinos) {
      const r = await enviar(correo, `Ticket ${t.numero}: ${t.tipo} — GrupoER`, html);
      if (!r.error) enviados += 1;
      else if (enviados === 0 && correo === destinos[destinos.length - 1]) {
        return res.status(503).json({ error: r.error });
      }
    }
    return res.status(200).json({ enviados });
  }

  return res.status(400).json({ error: "Acción desconocida." });
}
