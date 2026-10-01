// Segundo factor por correo para el Superadministrador (2026-09-28).
// POST JSON con el JWT del BackOffice en x-sesion. Acciones:
//   enviar      → código de 6 dígitos al correo de la cuenta (10 min, 5 intentos,
//                 60 s entre envíos; la base guarda sha256(codigo || session_id)).
//   verificar   → {codigo, recordar}; si ok, la sesión queda marcada en la base
//                 (fn_nivel_modulo vuelve a dar 99) y, con recordar, se entrega
//                 UNA vez un token de equipo (30 días) del que la base guarda el hash.
//   dispositivo → {token}: marca la sesión sin código si el equipo sigue vigente.
//   olvidar     → revoca todos los equipos recordados del llamador.
// Identidad: GET /auth/v1/user valida el JWT; solo DESPUÉS se lee su claim
// session_id (api/_clave.js → claimDeSesion). Las escrituras van por
// api_factor_* con la llave de servicio (el navegador no puede ejecutarlas).
// Nunca se devuelve el código ni un hash; el único secreto que viaja es el
// token de equipo, una sola vez. Límite de tasa y rastro en correo_envios.
import { createHash, randomInt, randomBytes } from "node:crypto";
import { enviar, plantilla, motorConfigurado } from "./_correo.js";
import { limitar, registrar, ipDe } from "./enviar-correo.js";
import { claimDeSesion, esCorreoPortal } from "./_clave.js";

const SUPABASE = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const ACCION = "segundo-factor";
const MSJ_SIN_CORREO = "No se pudo enviar el código. Avisa a soporte técnico.";
const limpiar = (v) => (typeof v === "string" ? v.replace(/^[﻿​\s]+|[﻿​\s]+$/g, "") : v);
const SERVICE = limpiar(process.env.SUPA_SERVICE_KEY) || limpiar(process.env.SUPABASE_SERVICE_ROLE_KEY) || "";
const cabService = { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" };
const sha = (t) => createHash("sha256").update(String(t)).digest("hex");
const enmascarar = (correo) => correo.replace(/^(.)[^@]*(@.*)$/, "$1•••$2");

async function rest(ruta, opciones = {}) {
  const r = await fetch(`${SUPABASE}${ruta}`, { ...opciones, headers: { ...cabService, ...opciones.headers } });
  const texto = await r.text();
  let json = null; try { json = texto ? JSON.parse(texto) : null; } catch { /* sin JSON */ }
  return { ok: r.ok, status: r.status, json };
}
const rpc = (nombre, args) => rest(`/rest/v1/rpc/${nombre}`, { method: "POST", body: JSON.stringify(args) });

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!SERVICE) return res.status(500).json({ error: "Falta la clave de servicio." });
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido." });

  // 1 · Identidad: sesión válida en GoTrue; recién entonces el claim session_id.
  const sesion = limpiar(req.headers["x-sesion"] ?? "");
  if (!sesion) return res.status(401).json({ error: "Sesión requerida." });
  const quien = await rest("/auth/v1/user", { method: "GET", headers: { authorization: `Bearer ${sesion}` } });
  const correo = String(quien.json?.email ?? "").trim().toLowerCase();
  if (!quien.ok || !correo) return res.status(401).json({ error: "Sesión inválida o vencida." });
  if (esCorreoPortal(correo)) return res.status(403).json({ error: "El Portal no usa segundo factor." });
  const sessionId = claimDeSesion(sesion, "session_id");
  if (!sessionId) return res.status(401).json({ error: "La sesión no trae identificador. Vuelve a ingresar." });

  const ip = ipDe(req);
  const agente = String(req.headers["user-agent"] ?? "").trim().slice(0, 200);
  const cuerpo = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
  const { accion } = cuerpo;
  const comunes = { p_correo: correo, p_session_id: sessionId, p_ip: ip, p_agente: agente };

  if (accion === "enviar") {
    const tope = await limitar(ACCION, ip, correo);
    if (tope) return res.status(tope.status).json({ error: tope.error });
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const e = await rpc("api_factor_emitir", { ...comunes, p_codigo_hash: sha(codigo + sessionId) });
    const v = e.json ?? {};
    if (!e.ok) return res.status(503).json({ error: "La base no respondió. Inténtalo de nuevo." });
    if (!v.ok) {
      if (v.motivo === "espera") return res.status(429).json({ error: `Espera ${v.espera_seg} segundos antes de pedir otro código.`, esperaSeg: v.espera_seg });
      return res.status(403).json({ error: "Tu cuenta no requiere código de ingreso." });
    }
    if (!motorConfigurado()) {
      await registrar({ accion: ACCION, ip, sujeto: correo, destinatario: correo, resultado: "error", detalle: "motor sin configurar" });
      return res.status(503).json({ error: MSJ_SIN_CORREO });
    }
    const r = await enviar(correo, "Tu código de ingreso — IntraTech", plantilla(
      "Tu código de ingreso",
      `<p>Para entrar al BackOffice escribe este código:</p>
       <p style="font-size:30px;letter-spacing:8px;font-weight:bold;margin:12px 0">${codigo}</p>
       <p>Vence en 10 minutos y sirve una sola vez.</p>
       <p>Si no fuiste tú, cambia tu clave cuanto antes.</p>`));
    await registrar({ accion: ACCION, ip, sujeto: correo, destinatario: correo, resultado: r.error ? "error" : "enviado", detalle: r.error ?? null });
    if (r.error) return res.status(503).json({ error: MSJ_SIN_CORREO });
    return res.status(200).json({ enviado: true, expiraEn: v.expira_en, correo: enmascarar(correo) });
  }

  if (accion === "verificar") {
    const codigo = String(cuerpo.codigo ?? "").replace(/\D/g, "");
    if (codigo.length !== 6) return res.status(400).json({ error: "Escribe los 6 dígitos del código." });
    const tope = await limitar(ACCION, ip, correo);
    if (tope) return res.status(tope.status).json({ error: tope.error });
    const e = await rpc("api_factor_verificar", { ...comunes, p_codigo_hash: sha(codigo + sessionId) });
    const v = e.json ?? {};
    if (!e.ok) return res.status(503).json({ error: "La base no respondió. Inténtalo de nuevo." });
    if (!v.ok) {
      await registrar({ accion: ACCION, ip, sujeto: correo, destinatario: correo, resultado: "rechazado", detalle: v.motivo ?? "rechazado" });
      if (v.motivo === "incorrecto") return res.status(400).json({ error: "Código incorrecto.", intentosRestantes: v.intentos_restantes ?? 0 });
      if (v.motivo === "vencido" || v.motivo === "agotado") return res.status(410).json({ error: v.motivo });
      return res.status(403).json({ error: "Tu cuenta no requiere código de ingreso." });
    }
    const respuesta = { listo: true };
    if (cuerpo.recordar === true) {
      const token = randomBytes(32).toString("base64url");
      const d = await rpc("api_factor_dispositivo_crear", { ...comunes, p_token_hash: sha(token) });
      if (d.ok) respuesta.dispositivo = token;
    }
    return res.status(200).json(respuesta);
  }

  if (accion === "dispositivo") {
    const token = String(cuerpo.token ?? "").trim();
    if (!token) return res.status(400).json({ error: "Falta el token del equipo." });
    const d = await rpc("api_factor_dispositivo_usar", { ...comunes, p_token_hash: sha(token) });
    if (!d.ok || d.json !== true) return res.status(403).json({ error: "Equipo no reconocido." });
    return res.status(200).json({ listo: true });
  }

  if (accion === "olvidar") {
    const d = await rpc("api_factor_dispositivos_revocar", { p_correo: correo });
    if (!d.ok) return res.status(503).json({ error: "La base no respondió. Inténtalo de nuevo." });
    return res.status(200).json({ revocados: Number(d.json ?? 0) });
  }

  return res.status(400).json({ error: "Acción desconocida." });
}
