// Proxy /api/supa (fase 6, P10/P11 y límites): lista blanca de rutas, clave
// desde la configuración (fallo cerrado), credenciales del cliente descartadas
// y regeneradas, IP y agente reales hacia Supabase, compuerta de login (por IP
// y por cuenta, fallo cerrado si la base no responde, degradación explícita
// mientras la migración 6b no exista) y fuerza de la clave del BackOffice en
// el cambio de clave. Supabase se simula.
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { rutaPermitida } from "../../api/_canal.js";

let handler;
const llamadas = [];
// Estado del doble de Supabase.
const estado = {};
const reiniciar = () => Object.assign(estado, {
  permitido: { permitido: true },      // respuesta de api_login_permitido
  compuertaAusente: false,             // migración 6b no aplicada (PGRST202)
  compuertaCaida: false,               // la base no responde
  bloqueoAnon: false,                  // verificar_bloqueo / portal_verificar_bloqueo
  tokenStatus: 200,                    // respuesta de auth/v1/token
});
const json = (cuerpo, status = 200, headers = {}) =>
  new Response(cuerpo === null ? "" : JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json", ...headers } });

globalThis.fetch = vi.fn(async (url, init = {}) => {
  const u = String(url);
  llamadas.push({ url: u, init });
  if (u.includes("/rest/v1/rpc/api_login_permitido")) {
    if (estado.compuertaCaida) throw new TypeError("fetch failed");
    if (estado.compuertaAusente) return json({ code: "PGRST202", message: "Could not find the function" }, 404);
    return json(estado.permitido);
  }
  if (u.includes("/rest/v1/rpc/api_login_registrar")) return estado.compuertaAusente ? json({ code: "PGRST202" }, 404) : json(null, 204);
  if (u.includes("/rest/v1/rpc/verificar_bloqueo") || u.includes("/rest/v1/rpc/portal_verificar_bloqueo")) {
    if (estado.compuertaCaida) return json({ message: "boom" }, 500);
    return json(estado.bloqueoAnon);
  }
  if (u.includes("/auth/v1/token")) {
    return estado.tokenStatus === 200 ? json({ access_token: "jwt", refresh_token: "r" }) : json({ error: "invalid_grant", error_description: "Invalid login credentials" }, estado.tokenStatus);
  }
  return json({ ok: true }, 200, { "content-range": "0-0/1", "x-secreto": "no" });
});

beforeAll(async () => {
  process.env.VITE_SUPABASE_ANON_KEY = "﻿sb_publishable_prueba";
  process.env.SUPA_SERVICE_KEY = "clave-servicio-de-prueba";
  ({ default: handler } = await import("../../api/supa.js"));
});
beforeEach(() => { llamadas.length = 0; reiniciar(); });

const jwtCon = (payload) => `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`;

function peticion({ ruta, metodo = "GET", headers = {}, query = {}, cuerpo } = {}) {
  const partes = ruta.split("/");
  const req = { method: metodo, headers: { "x-forwarded-for": "190.1.2.3, 10.0.0.1", "user-agent": "Prueba/1", ...headers }, query: { ruta: partes, ...query }, socket: { remoteAddress: "10.0.0.9" } };
  req[Symbol.asyncIterator] = async function* () { if (cuerpo !== undefined) yield Buffer.from(typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo)); };
  const res = { codigo: 0, cabeceras: {}, cuerpo: null,
    status(c) { this.codigo = c; return this; }, setHeader(k, v) { this.cabeceras[k.toLowerCase()] = v; },
    send(b) { this.cuerpo = b; return this; }, json(o) { this.cuerpo = JSON.stringify(o); return this; } };
  return { req, res };
}
const hacia = (fragmento) => llamadas.filter((l) => l.url.includes(fragmento));
const cuerpoDe = (l) => JSON.parse(l.init.body);
const login = (email, extra = {}) => peticion({ ruta: "auth/v1/token", metodo: "POST", query: { grant_type: "password" }, cuerpo: { email, password: "lo-que-sea" }, ...extra });

describe("rutaPermitida", () => {
  it("acepta solo auth, rest y storage de Supabase", () => {
    expect(rutaPermitida("auth/v1/token")).toBe(true);
    expect(rutaPermitida("rest/v1/rpc/verificar_bloqueo")).toBe(true);
    expect(rutaPermitida("storage/v1/object/documentos/x.pdf")).toBe(true);
    expect(rutaPermitida("functions/v1/lo-que-sea")).toBe(false);
    expect(rutaPermitida("pg/")).toBe(false);
    expect(rutaPermitida("")).toBe(false);
    expect(rutaPermitida("auth/v1/../../rest")).toBe(false);
    expect(rutaPermitida("auth/v1/admin/users")).toBe(false);
  });
});

describe("handler /api/supa · canal", () => {
  it("rechaza con 404 una ruta fuera de la lista blanca sin tocar Supabase", async () => {
    const { req, res } = peticion({ ruta: "functions/v1/x" });
    await handler(req, res);
    expect(res.codigo).toBe(404);
    expect(llamadas).toHaveLength(0);
  });
  it("nunca reenvía la administración de Auth (los endpoints propios usan la llave de servicio)", async () => {
    const { req, res } = peticion({ ruta: "auth/v1/admin/users" });
    await handler(req, res);
    expect(res.codigo).toBe(404);
    expect(llamadas).toHaveLength(0);
  });
  it("inyecta la apikey saneada, convierte x-sesion en Authorization y descarta credenciales del cliente", async () => {
    const { req, res } = peticion({ ruta: "rest/v1/v_personal", headers: { "x-sesion": "jwt-1", apikey: "falsa", authorization: "Bearer falso", accept: "application/json" }, query: { select: "dni", apikey: "por-url" } });
    await handler(req, res);
    expect(res.codigo).toBe(200);
    const [{ url, init }] = llamadas;
    expect(url).toBe("https://mzpbdkrmokfxrrsotfgs.supabase.co/rest/v1/v_personal?select=dni");
    expect(init.headers.apikey).toBe("sb_publishable_prueba");
    expect(init.headers.authorization).toBe("Bearer jwt-1");
    expect(init.headers["x-ip-real"]).toBe("190.1.2.3");
    expect(init.headers["x-agente"]).toBe("Prueba/1");
    expect(res.cabeceras["content-range"]).toBe("0-0/1");
    expect(res.cabeceras["x-secreto"]).toBeUndefined();
    expect(res.cabeceras["cache-control"]).toBe("no-store");
  });
  it("sin sesión no manda Authorization (anon = solo apikey); un refresh no pasa por la compuerta", async () => {
    const { req, res } = peticion({ ruta: "auth/v1/token", metodo: "POST", query: { grant_type: "refresh_token" }, cuerpo: "{}" });
    await handler(req, res);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].init.headers.authorization).toBeUndefined();
    expect(llamadas[0].url).toContain("grant_type=refresh_token");
  });
});

describe("handler /api/supa · compuerta de login", () => {
  it("consulta api_login_permitido con la IP real y el correo antes de hablar con Auth, y reenvía si está permitido", async () => {
    const { req, res } = login("karen@grupoer.pe");
    await handler(req, res);
    expect(res.codigo).toBe(200);
    const [permiso] = hacia("api_login_permitido");
    expect(cuerpoDe(permiso)).toEqual({ p_ip: "190.1.2.3", p_correo: "karen@grupoer.pe" });
    expect(permiso.init.headers.authorization).toBe("Bearer clave-servicio-de-prueba");
    expect(hacia("auth/v1/token")).toHaveLength(1);
    expect(hacia("api_login_registrar")).toHaveLength(0);
    // el cuerpo del login viaja intacto (bytes originales)
    expect(cuerpoDe(hacia("auth/v1/token")[0])).toEqual({ email: "karen@grupoer.pe", password: "lo-que-sea" });
  });
  it("cuenta bloqueada: 429 con forma de error de Auth, anota «bloqueado» y no toca Auth", async () => {
    estado.permitido = { permitido: false, motivo: "cuenta" };
    const { req, res } = login("karen@grupoer.pe");
    await handler(req, res);
    expect(res.codigo).toBe(429);
    const cuerpo = JSON.parse(res.cuerpo);
    expect(cuerpo.error_code).toBe("over_request_rate_limit");
    expect(cuerpo.msg).toMatch(/Demasiados intentos/);
    expect(hacia("auth/v1/token")).toHaveLength(0);
    const [registro] = hacia("api_login_registrar");
    expect(cuerpoDe(registro)).toEqual({ p_correo: "karen@grupoer.pe", p_resultado: "bloqueado", p_ip: "190.1.2.3", p_agente: "Prueba/1" });
  });
  it("IP cerrada: mismo 429 aunque la cuenta no exista", async () => {
    estado.permitido = { permitido: false, motivo: "ip" };
    const { req, res } = login("nadie@ejemplo.invalido");
    await handler(req, res);
    expect(res.codigo).toBe(429);
    expect(hacia("auth/v1/token")).toHaveLength(0);
  });
  it("credenciales incorrectas: reenvía el 400 de Auth tal cual y anota «fallido» con IP y agente", async () => {
    estado.tokenStatus = 400;
    const { req, res } = login("45231876@portal.grupoer.pe");
    await handler(req, res);
    expect(res.codigo).toBe(400);
    expect(JSON.parse(res.cuerpo.toString()).error).toBe("invalid_grant");
    const [registro] = hacia("api_login_registrar");
    expect(cuerpoDe(registro)).toEqual({ p_correo: "45231876@portal.grupoer.pe", p_resultado: "fallido", p_ip: "190.1.2.3", p_agente: "Prueba/1" });
  });
  it("fallo cerrado: si la base no responde, 503 y no se habla con Auth", async () => {
    estado.compuertaCaida = true;
    const { req, res } = login("karen@grupoer.pe");
    await handler(req, res);
    expect(res.codigo).toBe(503);
    expect(hacia("auth/v1/token")).toHaveLength(0);
  });
  it("migración 6b ausente (PGRST202): degrada a verificar_bloqueo por cuenta y sigue", async () => {
    estado.compuertaAusente = true;
    let { req, res } = login("karen@grupoer.pe");
    await handler(req, res);
    expect(res.codigo).toBe(200);
    expect(hacia("rpc/verificar_bloqueo")).toHaveLength(1);
    expect(hacia("auth/v1/token")).toHaveLength(1);
    llamadas.length = 0;
    estado.bloqueoAnon = true;
    ({ req, res } = login("45231876@portal.grupoer.pe"));
    await handler(req, res);
    expect(res.codigo).toBe(429);
    expect(hacia("rpc/portal_verificar_bloqueo")).toHaveLength(1);
    expect(hacia("auth/v1/token")).toHaveLength(0);
  });
  it("sin correo en el cuerpo no hay a quién bloquear: se reenvía y Auth responde", async () => {
    const { req, res } = peticion({ ruta: "auth/v1/token", metodo: "POST", query: { grant_type: "password" }, cuerpo: "no es json" });
    await handler(req, res);
    expect(hacia("api_login_permitido")).toHaveLength(1);
    expect(cuerpoDe(hacia("api_login_permitido")[0]).p_correo).toBe("");
  });
});

describe("handler /api/supa · clave del BackOffice (P11)", () => {
  const cambio = (payload, password) => peticion({ ruta: "auth/v1/user", metodo: "PUT", headers: { "x-sesion": jwtCon(payload) }, cuerpo: { password } });
  it("una cuenta administrativa no puede fijar una clave corta o sin letras y números: 400 sin tocar Auth", async () => {
    for (const debil of ["Abc12345", "1234567890", "abcdefghij"]) {
      llamadas.length = 0;
      const { req, res } = cambio({ email: "karen@grupoer.pe" }, debil);
      await handler(req, res);
      expect(res.codigo).toBe(400);
      expect(JSON.parse(res.cuerpo).error_code).toBe("weak_password");
      expect(llamadas).toHaveLength(0);
    }
  });
  it("una clave fuerte pasa; el Portal conserva su propio mínimo (6)", async () => {
    let { req, res } = cambio({ email: "karen@grupoer.pe" }, "Clave-segura-2026");
    await handler(req, res);
    expect(res.codigo).toBe(200);
    expect(hacia("auth/v1/user")).toHaveLength(1);
    llamadas.length = 0;
    ({ req, res } = cambio({ email: "45231876@portal.grupoer.pe" }, "123456"));
    await handler(req, res);
    expect(res.codigo).toBe(200);
    expect(hacia("auth/v1/user")).toHaveLength(1);
  });
  it("sin sesión legible se reenvía y decide Auth (que exigirá el token)", async () => {
    const { req, res } = peticion({ ruta: "auth/v1/user", metodo: "PUT", cuerpo: { password: "123" } });
    await handler(req, res);
    expect(hacia("auth/v1/user")).toHaveLength(1);
  });
});
