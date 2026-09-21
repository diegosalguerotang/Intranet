// Proxy blindado hacia Supabase: el cliente no envía credenciales — aquí se
// inyecta la apikey y la cabecera x-sesion se convierte en el Authorization
// real. Mantiene el mismo-origen (hay redes que bloquean *.supabase.co) y
// tolera proxys corporativos que alteren cabeceras. La apikey es la
// publishable (pública por diseño); el acceso real lo controlan RLS y los
// triggers.
//
// Fase 6 (2026-09-21):
//  · P10, fallo cerrado: la apikey sale SOLO de la configuración (sin valor
//    cableado de respaldo: si falta, el canal no abre) y solo se reenvían las
//    rutas de la lista blanca (api/_canal.js).
//  · Compuerta de login: antes de pasar un login por clave a Auth se consulta
//    api_login_permitido (por IP real y por cuenta, con la llave de servicio).
//    Si la base no responde, 503 y no se abre nada. Un fallo real de Auth se
//    anota con api_login_registrar: son los únicos fallos que cuentan para el
//    bloqueo por intentos (el navegador no puede fabricarlos). Mientras la
//    migración 6b no exista (PGRST202) se degrada a verificar_bloqueo por
//    cuenta y se avisa en el registro.
//  · P11: el cambio de clave de una cuenta administrativa exige el piso del
//    BackOffice (api/_clave.js); Auth solo conoce el mínimo del Portal.
import { rutaPermitida } from "./_canal.js";
import { validarClaveBackoffice, esCorreoPortal, correoDeSesion } from "./_clave.js";

const SUPABASE = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
// La env var en Vercel llegó a guardarse con un BOM invisible que hacía
// reventar fetch al ponerla como cabecera: sanear siempre lo que venga de env.
const limpiar = (v) => (typeof v === "string" ? v.replace(/^[﻿​\s]+|[﻿​\s]+$/g, "") : v);
const APIKEY = limpiar(process.env.VITE_SUPABASE_ANON_KEY) || "";
const SERVICE = limpiar(process.env.SUPA_SERVICE_KEY) || limpiar(process.env.SUPABASE_SERVICE_ROLE_KEY) || "";

// Solo cabeceras operativas: cualquier credencial que llegue del cliente se
// descarta (puede venir corrupta por el interceptor) y se regenera aquí.
const ENTRAN = ["content-type", "accept", "prefer", "accept-profile", "content-profile", "range", "range-unit", "x-client-info", "x-upsert"];
const SALEN = ["content-type", "content-range", "content-profile", "preference-applied", "x-total-count", "www-authenticate"];

const MSJ_LIMITE = "Demasiados intentos. Espera unos minutos y vuelve a intentar.";
const MSJ_CERRADO = "El control de intentos no está disponible: no se abre el acceso hasta que responda.";
// Misma forma que los errores de Auth: supabase-js y el Portal muestran `msg`.
const errorAuth = (res, status, error_code, msg) => res.status(status).json({ code: status, error_code, msg });

// bodyParser apagado: los PDFs de boletas (Task 14) suben binario y el
// bodyParser JSON + res.send(texto) de antes los corrompía. El passthrough
// crudo (Buffer tal cual, sin parsear) sirve igual para JSON: PostgREST
// recibe los mismos bytes que envió el cliente.
export const config = { api: { bodyParser: false } };

async function leerCuerpo(req) {
  const trozos = [];
  for await (const t of req) trozos.push(t);
  return trozos.length ? Buffer.concat(trozos) : undefined;
}
const jsonDe = (buf) => { try { return buf ? JSON.parse(buf.toString("utf8")) : {}; } catch { return {}; } };

// --- Compuerta de login ---------------------------------------------------------
// RPC con la llave de servicio → { ok, ausente, caido, json }.
async function rpcServicio(nombre, args) {
  if (!SERVICE) return { ausente: true };
  try {
    const r = await fetch(`${SUPABASE}/rest/v1/rpc/${nombre}`, {
      method: "POST", headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" }, body: JSON.stringify(args),
    });
    const texto = await r.text();
    let json = null; try { json = texto ? JSON.parse(texto) : null; } catch { /* sin JSON */ }
    if (r.status === 404 && json?.code === "PGRST202") return { ausente: true };
    if (!r.ok) return { caido: true, status: r.status };
    return { ok: true, json };
  } catch {
    return { caido: true };
  }
}
// Sin la migración 6b: bloqueo por cuenta con las RPC pre-login (anon).
async function bloqueoPorCuenta(correo) {
  if (!correo) return { ok: true, bloqueado: false };
  const portal = esCorreoPortal(correo);
  const nombre = portal ? "portal_verificar_bloqueo" : "verificar_bloqueo";
  const args = portal ? { p_dni: correo.split("@")[0] } : { p_correo: correo };
  try {
    const r = await fetch(`${SUPABASE}/rest/v1/rpc/${nombre}`, { method: "POST", headers: { apikey: APIKEY, "content-type": "application/json" }, body: JSON.stringify(args) });
    if (!r.ok) return { caido: true };
    return { ok: true, bloqueado: (await r.json()) === true };
  } catch {
    return { caido: true };
  }
}
const anotar = (correo, resultado, ip, agente) =>
  rpcServicio("api_login_registrar", { p_correo: correo, p_resultado: resultado, p_ip: ip, p_agente: agente }).catch(() => {});

// null si puede seguir; si no, { status, error_code, msg }.
async function compuertaLogin({ correo, ip, agente }) {
  const r = await rpcServicio("api_login_permitido", { p_ip: ip, p_correo: correo });
  if (r.ok) {
    if (r.json?.permitido === true) return null;
    await anotar(correo, "bloqueado", ip, agente);
    return { status: 429, error_code: "over_request_rate_limit", msg: MSJ_LIMITE };
  }
  if (r.ausente) {
    console.warn("[supa] api_login_permitido ausente: compuerta degradada a verificar_bloqueo (¿migración 6b sin aplicar?)");
    const b = await bloqueoPorCuenta(correo);
    if (b.ok) return b.bloqueado ? { status: 429, error_code: "over_request_rate_limit", msg: MSJ_LIMITE } : null;
  }
  return { status: 503, error_code: "unexpected_failure", msg: MSJ_CERRADO };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!APIKEY) return res.status(500).json({ error: "Canal no configurado." });
  const ruta = (req.query.ruta ? [].concat(req.query.ruta) : []).join("/");
  if (!rutaPermitida(ruta)) return res.status(404).json({ error: "Ruta no permitida." });

  const destino = new URL(`${SUPABASE}/${ruta}`);
  for (const [k, v] of Object.entries(req.query)) {
    if (k === "ruta" || k.toLowerCase() === "apikey") continue;
    for (const valor of [].concat(v)) destino.searchParams.append(k, valor);
  }

  const cabeceras = { apikey: APIKEY };
  for (const nombre of ENTRAN) {
    if (req.headers[nombre]) cabeceras[nombre] = req.headers[nombre];
  }
  const sesion = req.headers["x-sesion"];
  if (sesion) cabeceras.authorization = `Bearer ${sesion}`;

  // Evidencia probatoria (2026-08-26): IP y user-agent REALES del cliente,
  // generados aquí (nunca aceptados del cliente — ENTRAN no los incluye, así
  // que cualquier x-ip-real/x-agente entrante ya fue descartado). Los RPCs de
  // acuse y de login los leen de request.headers.
  const reenviada = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  const ip = (reenviada || req.socket?.remoteAddress || "").slice(0, 64);
  if (ip) cabeceras["x-ip-real"] = ip;
  const agente = String(req.headers["user-agent"] ?? "").trim().slice(0, 200);
  if (agente) cabeceras["x-agente"] = agente;

  const metodo = req.method ?? "GET";
  const cuerpo = (metodo !== "GET" && metodo !== "HEAD") ? await leerCuerpo(req) : undefined;

  // Login por clave: compuerta por IP y por cuenta antes de hablar con Auth.
  const esLogin = ruta === "auth/v1/token" && metodo === "POST" && String(req.query.grant_type ?? "") === "password";
  const correoLogin = esLogin ? String(jsonDe(cuerpo)?.email ?? "").trim().toLowerCase() : "";
  if (esLogin) {
    const negado = await compuertaLogin({ correo: correoLogin, ip, agente });
    if (negado) return errorAuth(res, negado.status, negado.error_code, negado.msg);
  }

  // Cambio de clave de una cuenta administrativa: piso del BackOffice (P11).
  if (ruta === "auth/v1/user" && (metodo === "PUT" || metodo === "PATCH")) {
    const datos = jsonDe(cuerpo);
    const correo = correoDeSesion(sesion);
    if (datos?.password !== undefined && correo && !esCorreoPortal(correo)) {
      const error = validarClaveBackoffice(datos.password);
      if (error) return errorAuth(res, 400, "weak_password", error);
    }
  }

  const respuesta = await fetch(destino, { method: metodo, headers: cabeceras, body: cuerpo });
  const buf = Buffer.from(await respuesta.arrayBuffer());
  if (esLogin && correoLogin && [400, 401, 403].includes(respuesta.status)) {
    await anotar(correoLogin, "fallido", ip, agente);
  }
  res.status(respuesta.status);
  for (const nombre of SALEN) {
    const valor = respuesta.headers.get(nombre);
    if (valor) res.setHeader(nombre, valor);
  }
  res.send(buf);
}
