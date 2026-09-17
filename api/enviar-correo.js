// Motor de correo (fase 1, 2026-08-17 · endurecido en la FASE 0 de la
// corrección de seguridad, 2026-09-17 — decisión 8). Un solo endpoint con acciones:
//  · verificacion       : el propio trabajador (JWT del portal) recibe un enlace
//                         para validar su correo declarado.
//  · recuperacion       : PÚBLICA («olvidé mi clave» del portal). Respuesta
//                         SIEMPRE genérica (no revela si el DNI o el correo existen).
//  · recuperacion-admin : PÚBLICA («olvidé mi clave» del BackOffice). Ídem.
//  · aviso-ticket       : aviso de ticket nuevo a los correos de SOP-02.
//  · aviso-solicitud    : avisos del Centro de Solicitudes (creada/estado/resuelta).
//  · recordatorio-acuse : un admin (nivel ≥ 2 en Acuses) recuerda documentos pendientes.
//  (el envío del ACCESO al portal vive en api/portal-cuentas.js, que conoce la clave)
//
// Reglas de la fase 0 (todas fallan cerrado):
//  1. Lo que dispara una persona exige SESIÓN válida (x-sesion): el portal solo
//     avisa sobre sus propios tickets/solicitudes; el BackOffice, con cuenta activa.
//  2. Lo del sistema entra con un SECRETO compartido (x-correo-secreto, env
//     CORREO_SECRETO) comparado en tiempo constante. Sin la env var no hay vía.
//  3. LÍMITE DE TASA por IP y por sujeto (dni / correo / número) en ventana de
//     60 min, contado en la tabla correo_envios (solo service_role). Si la
//     tabla no responde, no se envía nada (503).
//  4. LISTA BLANCA: solo se escribe a correos del padrón (personas.correo) o de
//     cuentas administrativas (usuarios_admin.correo). Un aviso configurado a
//     un correo ajeno se omite y queda registrado como «rechazado».
//  Cada intento deja rastro en correo_envios (accion, ip, sujeto, destinatario, resultado).
// Proveedores (en orden): Resend (env RESEND_API_KEY) o SMTP (env SMTP_USER +
// SMTP_PASS — contraseña de aplicación de Gmail, ~500 correos/día). La
// contraseña vive SOLO en las variables de entorno del servidor (decisión 9).
import { createHash, timingSafeEqual } from "node:crypto";
import { enviar, plantilla, botonCorreo } from "./_correo.js";

const SUPABASE = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const APP = "https://intranet-general.vercel.app";
const DOMINIO_PORTAL = "portal.grupoer.pe";
const VENTANA_MIN = 60;
// Máximo de intentos por ventana. IP: cualquier acción. Sujeto: por acción.
export const LIMITES = {
  ip: 30,
  sujeto: { verificacion: 3, recuperacion: 3, "recuperacion-admin": 3, "aviso-ticket": 5, "aviso-solicitud": 10, "recordatorio-acuse": 5 },
};
const limpiar = (v) => (typeof v === "string" ? v.replace(/^[﻿​\s]+|[﻿​\s]+$/g, "") : v);
const SERVICE = limpiar(process.env.SUPA_SERVICE_KEY) || limpiar(process.env.SUPABASE_SERVICE_ROLE_KEY) || "";
const cabService = { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" };

async function rest(ruta, opciones = {}) {
  const r = await fetch(`${SUPABASE}${ruta}`, { ...opciones, headers: { ...cabService, ...opciones.headers } });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* sin JSON */ }
  return { ok: r.ok, status: r.status, json, headers: r.headers };
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

// --- Identidad del llamador --------------------------------------------------
const sha = (t) => createHash("sha256").update(String(t)).digest();
export const secretoCoincide = (recibido, esperado) =>
  Boolean(esperado) && Boolean(recibido) && timingSafeEqual(sha(recibido), sha(esperado));

// { tipo: 'sistema' } | { tipo: 'portal', dni } | { tipo: 'admin', correo, dni } | null
async function llamador(req) {
  const secreto = limpiar(process.env.CORREO_SECRETO) || "";
  const recibido = String(req.headers["x-correo-secreto"] ?? "");
  if (recibido) return secretoCoincide(recibido, secreto) ? { tipo: "sistema" } : null;
  const jwt = limpiar(req.headers["x-sesion"] ?? "");
  if (!jwt) return null;
  const quien = await rest("/auth/v1/user", { headers: { authorization: `Bearer ${jwt}`, apikey: SERVICE } });
  const correo = (quien.json?.email ?? "").toLowerCase();
  if (!quien.ok || !correo) return null;
  if (correo.endsWith(`@${DOMINIO_PORTAL}`)) return { tipo: "portal", dni: correo.split("@")[0].toUpperCase(), correo };
  const u = (await rest(`/rest/v1/usuarios_admin?correo=ilike.${encodeURIComponent(correo)}&estado=eq.activo&select=id,persona_dni&limit=1`)).json?.[0];
  if (!u) return null;
  return { tipo: "admin", correo, dni: u.persona_dni };
}

// --- Rastro, límite de tasa y lista blanca -----------------------------------
const ipDe = (req) => (String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket?.remoteAddress || "").slice(0, 64);

async function registrar(fila) {
  // Mejor esfuerzo: un fallo del rastro no anula un envío ya hecho.
  await rest("/rest/v1/correo_envios", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify(fila) }).catch(() => {});
}

// Intentos de la ventana para (campo = valor). Si no se puede contar → Infinity (cerrado).
async function contar(campo, valor) {
  if (!valor) return 0;
  const desde = new Date(Date.now() - VENTANA_MIN * 60_000).toISOString();
  const r = await rest(
    `/rest/v1/correo_envios?${campo}=eq.${encodeURIComponent(valor)}&creado_en=gte.${encodeURIComponent(desde)}&select=id&limit=1`,
    { headers: { prefer: "count=exact" } },
  ).catch(() => null);
  if (!r?.ok) return Infinity;
  const total = Number(String(r.headers?.get?.("content-range") ?? "").split("/")[1]);
  return Number.isFinite(total) ? total : Infinity;
}

// null si puede seguir; si no, { status, error } ya registrado.
async function limitar(accion, ip, sujeto) {
  const [porIp, porSujeto] = await Promise.all([contar("ip", ip), contar("sujeto", sujeto)]);
  const topeSujeto = LIMITES.sujeto[accion] ?? 5;
  if (porIp === Infinity || porSujeto === Infinity) {
    return { status: 503, error: "El registro de correo no está disponible: no se envía nada hasta que responda." };
  }
  if (porIp >= LIMITES.ip || porSujeto >= topeSujeto) {
    await registrar({ accion, ip, sujeto, resultado: "limitado", detalle: `ip=${porIp} sujeto=${porSujeto}` });
    return { status: 429, error: "Demasiados intentos. Espera una hora y vuelve a intentarlo." };
  }
  return null;
}

// Solo correos del padrón (personas) o de cuentas administrativas.
async function enPadron(correo) {
  const c = String(correo ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c)) return false;
  const p = await rest(`/rest/v1/personas?correo=ilike.${encodeURIComponent(c)}&select=dni&limit=1`);
  if (p.ok && p.json?.length) return true;
  const u = await rest(`/rest/v1/usuarios_admin?correo=ilike.${encodeURIComponent(c)}&select=id&limit=1`);
  return Boolean(u.ok && u.json?.length);
}

// Envía a una lista filtrada por la lista blanca y deja rastro de cada destino.
async function enviarALista(destinos, asunto, html, base) {
  let enviados = 0, omitidos = 0, ultimoError = null;
  for (const correo of [...new Set(destinos.filter(Boolean))]) {
    if (!(await enPadron(correo))) {
      omitidos += 1;
      await registrar({ ...base, destinatario: correo, resultado: "rechazado", detalle: "fuera del padrón" });
      continue;
    }
    const r = await enviar(correo, asunto, html);
    if (!r.error) enviados += 1; else ultimoError = r.error;
    await registrar({ ...base, destinatario: correo, resultado: r.error ? "error" : "enviado", detalle: r.error ?? null });
  }
  return { enviados, omitidos, ultimoError };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!SERVICE) return res.status(500).json({ error: "Falta la clave de servicio." });
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido." });
  const cuerpo = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
  const { accion } = cuerpo;
  const ip = ipDe(req);
  // Forma canónica del número de documento: mayúsculas (DNI/CE/pasaporte).
  const dni = String(cuerpo.dni ?? "").trim().toUpperCase();

  if (accion === "verificacion") {
    // La pide el propio trabajador con su sesión del portal.
    const quien = await llamador(req);
    if (quien?.tipo !== "portal") return res.status(401).json({ error: "Sesión del portal requerida." });
    const tope = await limitar(accion, ip, quien.dni);
    if (tope) return res.status(tope.status).json({ error: tope.error });
    // ilike sin comodines = igualdad insensible a mayúsculas (CE/pasaporte).
    const p = (await rest(`/rest/v1/personas?dni=ilike.${encodeURIComponent(quien.dni)}&select=dni,nombre,correo,correo_verificado&limit=1`)).json?.[0];
    if (!p?.correo) return res.status(400).json({ error: "No tienes correo declarado." });
    if (p.correo_verificado) return res.status(200).json({ yaVerificado: true });
    const token = await crearToken(p.dni, "verificacion", p.correo, 24 * 7);
    if (!token) return res.status(500).json({ error: "No se pudo generar el enlace." });
    const r = await enviar(p.correo, "Confirma tu correo — GrupoER", plantilla(
      "Confirma tu correo",
      `<p>Hola ${p.nombre.split(" ")[0]}: toca el botón para confirmar que este correo es tuyo.
          Así podrás recuperar tu clave si la olvidas.</p>
       ${botonCorreo(`${APP}/api/correo-accion?token=${token}`, "Confirmar mi correo")}
       <p style="font-size:12px;color:#999">El enlace vence en 7 días.</p>`));
    await registrar({ accion, ip, sujeto: p.dni, destinatario: p.correo, resultado: r.error ? "error" : "enviado", detalle: r.error ?? null });
    if (r.error) return res.status(503).json({ error: r.error });
    return res.status(200).json({ enviado: p.correo });
  }

  if (accion === "recuperacion") {
    // PÚBLICA. La respuesta jamás revela si el DNI o el correo existen.
    const generica = { mensaje: "Si tu correo está registrado y verificado, te llegará un enlace para crear una clave nueva." };
    if (!/^[0-9A-Z-]{4,20}$/.test(dni)) return res.status(200).json(generica);
    const tope = await limitar(accion, ip, dni);
    if (tope) return res.status(tope.status).json(tope.status === 429 ? { ...generica, error: tope.error } : { error: tope.error });
    const p = (await rest(`/rest/v1/personas?dni=eq.${dni}&select=nombre,correo,correo_verificado&limit=1`)).json?.[0];
    const cuenta = (await rest(`/rest/v1/cuentas_portal?dni=eq.${dni}&select=dni&limit=1`)).json?.[0];
    if (!p?.correo || !p.correo_verificado || !cuenta) {
      await registrar({ accion, ip, sujeto: dni, resultado: "rechazado", detalle: "sin correo verificado o sin cuenta" });
      return res.status(200).json(generica);
    }
    const token = await crearToken(dni, "recuperacion", p.correo, 1);
    if (token) {
      const r = await enviar(p.correo, "Crea una clave nueva — GrupoER", plantilla(
        "Crea una clave nueva para el portal",
        `<p>Hola ${p.nombre.split(" ")[0]}: pediste restablecer tu clave del Portal del Trabajador.</p>
         ${botonCorreo(`${APP}/portal/restablecer?token=${token}`, "Crear mi clave nueva")}
         <p style="font-size:12px;color:#999">El enlace vence en 1 hora y sirve una sola vez.
            Si no fuiste tú, ignora este correo.</p>`));
      await registrar({ accion, ip, sujeto: dni, destinatario: p.correo, resultado: r.error ? "error" : "enviado", detalle: r.error ?? null });
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
    const tope = await limitar(accion, ip, correo);
    if (tope) return res.status(tope.status).json(tope.status === 429 ? { ...generica, error: tope.error } : { error: tope.error });
    const u = (await rest(
      `/rest/v1/usuarios_admin?correo=eq.${encodeURIComponent(correo)}&estado=eq.activo&select=persona_dni,correo&limit=1`
    )).json?.[0];
    if (!u) {
      await registrar({ accion, ip, sujeto: correo, resultado: "rechazado", detalle: "no es usuario activo" });
      return res.status(200).json(generica);
    }
    const token = await crearToken(u.persona_dni, "recuperacion-admin", correo, 1);
    if (token) {
      const r = await enviar(correo, "Crea una clave nueva — BackOffice GrupoER", plantilla(
        "Crea una clave nueva para el BackOffice",
        `<p>Pediste restablecer tu clave del BackOffice de GrupoER.</p>
         ${botonCorreo(`${APP}/admin/restablecer?token=${token}`, "Crear mi clave nueva")}
         <p style="font-size:12px;color:#999">El enlace vence en 1 hora y sirve una sola vez.
            Si no fuiste tú, ignora este correo.</p>`));
      await registrar({ accion, ip, sujeto: correo, destinatario: correo, resultado: r.error ? "error" : "enviado", detalle: r.error ?? null });
    }
    return res.status(200).json(generica);
  }

  if (accion === "aviso-ticket") {
    // Aviso de ticket nuevo (SOP) a los correos configurados en ticket_avisos.
    // Lo dispara el portal (solo sobre SU ticket), el BackOffice (cuenta
    // activa) o el sistema (secreto). Solo destinos del padrón.
    const quien = await llamador(req);
    if (!quien) return res.status(401).json({ error: "Sesión válida requerida." });
    const numero = String(cuerpo.numero ?? "").trim();
    if (!/^TK-[0-9]+$/.test(numero)) return res.status(400).json({ error: "Número de ticket inválido." });
    const tope = await limitar(accion, ip, numero);
    if (tope) return res.status(tope.status).json({ error: tope.error });
    const t = (await rest(`/rest/v1/v_tickets?numero=eq.${encodeURIComponent(numero)}&select=*&limit=1`)).json?.[0];
    if (!t) return res.status(404).json({ error: "El ticket no existe." });
    if (quien.tipo === "portal" && String(t.solicitante_dni ?? "").toUpperCase() !== quien.dni) {
      await registrar({ accion, ip, sujeto: numero, resultado: "rechazado", detalle: `portal ${quien.dni} sobre ticket ajeno` });
      return res.status(403).json({ error: "Solo puedes avisar sobre tus propios tickets." });
    }
    const avisos = (await rest(`/rest/v1/ticket_avisos?activo=eq.true&select=correo`)).json ?? [];
    const destinos = avisos.map((a) => a.correo);
    if (!destinos.length) return res.status(200).json({ enviados: 0 });
    const html = plantilla(
      `Nuevo ticket ${t.numero}`,
      `<p><b>${t.tipo}</b>${t.subtipo ? ` · ${t.subtipo}` : ""}</p>
       <p>Solicitante: <b>${t.solicitante_nombre}</b>${t.area ? ` — ${t.area}` : ""}${t.solicitante_dni ? ` (DNI ${t.solicitante_dni})` : ""}</p>
       ${t.comentario ? `<p style="border-left:3px solid #3569a0;padding-left:10px;color:#555">${t.comentario}</p>` : ""}
       ${botonCorreo(`${APP}/soporte/tickets`, "Ver en la intranet")}`);
    const r = await enviarALista(destinos, `Ticket ${t.numero}: ${t.tipo} — GrupoER`, html, { accion, ip, sujeto: numero });
    if (!r.enviados && r.ultimoError) return res.status(503).json({ error: r.ultimoError });
    return res.status(200).json({ enviados: r.enviados, omitidos: r.omitidos });
  }

  if (accion === "aviso-solicitud") {
    // Centro de Solicitudes. evento: creada (avisos del tipo + copia al jefe),
    // estado (al solicitante), resuelta (solicitante + avisos). El correo
    // lleva resumen y enlace, jamás el PDF ni datos sensibles; el fallo NUNCA
    // bloquea el registro (quien llama es fire-and-forget).
    const quien = await llamador(req);
    if (!quien) return res.status(401).json({ error: "Sesión válida requerida." });
    const numero = String(cuerpo.numero ?? "").trim();
    const evento = String(cuerpo.evento ?? "creada");
    if (!/^[A-Z]{2,4}-[A-Z]{2,4}-\d{4}-\d{4}$/.test(numero)) {
      return res.status(400).json({ error: "Número de solicitud inválido." });
    }
    const tope = await limitar(accion, ip, numero);
    if (tope) return res.status(tope.status).json({ error: tope.error });
    const s = (await rest(`/rest/v1/v_solicitudes?numero=eq.${encodeURIComponent(numero)}&select=*&limit=1`)).json?.[0];
    if (!s) return res.status(404).json({ error: "La solicitud no existe." });
    if (quien.tipo === "portal" && String(s.solicitante_dni ?? "").toUpperCase() !== quien.dni) {
      await registrar({ accion, ip, sujeto: numero, resultado: "rechazado", detalle: `portal ${quien.dni} sobre solicitud ajena` });
      return res.status(403).json({ error: "Solo puedes avisar sobre tus propias solicitudes." });
    }

    const avisosTipo = (await rest(
      `/rest/v1/solicitud_avisos?activo=eq.true&or=(tipo_id.is.null,tipo_id.eq.${encodeURIComponent(s.tipo_id)})&select=correo,copia`
    )).json ?? [];
    const correoSolicitante = (await rest(
      `/rest/v1/personas?dni=eq.${s.solicitante_dni}&select=correo&limit=1`)).json?.[0]?.correo ?? null;
    const correoJefe = s.supervisor_dni
      ? ((await rest(`/rest/v1/personas?dni=eq.${s.supervisor_dni}&select=correo&limit=1`)).json?.[0]?.correo ?? null)
      : null;

    let destinos = [];
    if (evento === "creada") {
      destinos = avisosTipo.map((a) => a.correo);
      if (correoJefe) destinos.push(correoJefe);  // copia al jefe inmediato
    } else if (evento === "resuelta") {
      destinos = avisosTipo.filter((a) => !a.copia).map((a) => a.correo);
      if (correoSolicitante) destinos.push(correoSolicitante);
    } else {
      if (correoSolicitante) destinos = [correoSolicitante];
    }
    destinos = [...new Set(destinos)];
    if (!destinos.length) return res.status(200).json({ enviados: 0 });

    const titulo = evento === "creada" ? `Nueva solicitud ${s.numero}`
      : evento === "resuelta" ? `Solicitud ${s.numero}: ${s.estado}`
      : `Solicitud ${s.numero}: cambio de estado`;
    const html = plantilla(titulo,
      `<p><b>${s.tipo}</b> (${s.codigo_formato})</p>
       <p>Solicitante: <b>${s.solicitante_nombre}</b>${s.sede_nombre ? ` — ${s.sede_nombre}` : ""}</p>
       <p>Estado: <b>${s.estado}</b>${s.paso_titulo ? ` · esperando ${s.paso_titulo}` : ""}</p>
       ${botonCorreo(`${APP}/solicitudes`, "Ver en la intranet")}`);
    const r = await enviarALista(destinos, `${titulo} — GrupoER`, html, { accion, ip, sujeto: numero });
    if (!r.enviados && r.ultimoError) return res.status(503).json({ error: r.ultimoError });
    return res.status(200).json({ enviados: r.enviados, omitidos: r.omitidos });
  }

  if (accion === "recordatorio-acuse") {
    // La dispara un admin del BackOffice (JWT en x-sesion, nivel ≥ 2 en el
    // módulo Acuses): recuerda por correo al trabajador que tiene documentos
    // sin confirmar en el portal. No "reenvía" nada — el documento ya está en
    // su bandeja del portal desde la publicación; esto solo avisa.
    const quien = await llamador(req);
    if (!quien || quien.tipo === "sistema") return res.status(401).json({ error: "Sesión inválida o vencida." });
    if (quien.tipo === "portal") return res.status(403).json({ error: "Los trabajadores no envían recordatorios." });
    const yo = (await rest(`/rest/v1/v_mi_acceso?correo=eq.${encodeURIComponent(quien.correo)}&limit=1`)).json?.[0];
    const nivelAcuses = yo?.esSuperadmin ? 3 : (yo?.matriz?.acuses ?? 0);
    if (!yo || nivelAcuses < 2) {
      return res.status(403).json({ error: "Necesitas nivel de acción en el módulo Acuses." });
    }

    if (!/^[0-9A-Z-]{4,20}$/.test(dni)) return res.status(400).json({ error: "Documento inválido." });
    const tope = await limitar(accion, ip, dni);
    if (tope) return res.status(tope.status).json({ error: tope.error });
    const p = (await rest(`/rest/v1/personas?dni=ilike.${encodeURIComponent(dni)}&select=dni,nombre,correo&limit=1`)).json?.[0];
    if (!p) return res.status(404).json({ error: "La persona no existe en el maestro." });
    if (!p.correo) {
      return res.status(400).json({ error: "El trabajador no tiene correo registrado: se declara en su primer ingreso al portal o se agrega desde el Legajo (Editar datos)." });
    }
    const cuenta = (await rest(`/rest/v1/cuentas_portal?dni=ilike.${encodeURIComponent(p.dni)}&select=dni&limit=1`)).json?.[0];
    if (!cuenta) {
      return res.status(400).json({ error: "Aún no tiene cuenta del portal: créala desde Planilla (botón Portal) para que pueda entrar a confirmar." });
    }
    const pendientes = (await rest(
      `/rest/v1/v_acuses?dni=eq.${encodeURIComponent(p.dni)}&estado=in.(pendiente,nunca_ingreso)&select=doc,documento_id`
    )).json ?? [];
    if (!pendientes.length) return res.status(400).json({ error: "No tiene documentos pendientes de confirmar." });

    const lista = pendientes.slice(0, 5).map((x) => `<li>${x.doc}</li>`).join("");
    const demas = pendientes.length > 5 ? `<p style="font-size:12px;color:#999">…y ${pendientes.length - 5} más.</p>` : "";
    const r = await enviar(p.correo, "Tienes documentos por confirmar — GrupoER", plantilla(
      "Documentos pendientes de confirmar",
      `<p>Hola ${p.nombre.split(" ")[0]}: tienes ${pendientes.length} documento${pendientes.length === 1 ? "" : "s"}
          esperando tu confirmación de recepción en el Portal del Trabajador:</p>
       <ul>${lista}</ul>${demas}
       ${botonCorreo(`${APP}/portal`, "Entrar al portal y confirmar")}
       <p style="font-size:12px;color:#999">Entra con tu documento y tu clave del portal. Confirmar la recepción
          no significa estar de acuerdo con el contenido; solo deja constancia de que lo recibiste.</p>`));
    await registrar({ accion, ip, sujeto: p.dni, destinatario: p.correo, resultado: r.error ? "error" : "enviado", detalle: r.error ?? `por ${quien.correo}` });
    if (r.error) return res.status(503).json({ error: r.error });
    // Evidencia de notificación (D.Leg. 1310, 2026-08-26): una fila INSERT-only
    // por documento avisado. Si el log falla no se degrada el envío ya hecho.
    const filas = pendientes
      .filter((x) => x.documento_id)
      .map((x) => ({ documento_id: x.documento_id, canal: "correo", destinatario: p.correo, enviado_por: quien.correo }));
    if (filas.length) {
      await rest(`/rest/v1/notificaciones_documento`, { method: "POST", body: JSON.stringify(filas) });
    }
    return res.status(200).json({ enviado: p.correo, pendientes: pendientes.length, notificados: filas.length });
  }

  return res.status(400).json({ error: "Acción desconocida." });
}
