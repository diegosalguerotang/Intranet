// Endpoint del segundo factor por correo (api/segundo-factor.js). Supabase y
// el motor de correo se simulan. Lo que se exige: identidad por GoTrue, código
// de 6 dígitos hasheado con el session_id, nunca devuelve código ni hash,
// límites, 503 sin motor, equipo recordado y revocación.
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { createHash } from "node:crypto";

process.env.SUPA_SERVICE_KEY = "clave-servicio-de-prueba";
process.env.VITE_SUPABASE_ANON_KEY = "sb_publishable_prueba";
const enviados = [];
const motor = { configurado: true, falla: false };
vi.mock("../../api/_correo.js", () => ({
  motorConfigurado: () => motor.configurado,
  enviar: vi.fn(async (destino, asunto, html) => { if (motor.falla) return { error: "SMTP caído" }; enviados.push({ destino, asunto, html }); return {}; }),
  plantilla: (t, c) => `${t}${c}`, botonCorreo: (h, t) => `<a href="${h}">${t}</a>`,
}));

let handler;
beforeAll(async () => { ({ default: handler } = await import("../../api/segundo-factor.js")); });

const sha = (t) => createHash("sha256").update(t).digest("hex");
const jwtCon = (payload) => `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`;
const SID = "11111111-2222-4333-8444-555555555555";
const JWT_SUPER = jwtCon({ email: "diego@ejemplo.pe", session_id: SID });
const JWT_SIN_SID = jwtCon({ email: "diego@ejemplo.pe" });
const JWT_PORTAL = jwtCon({ email: "12345678@portal.grupoer.pe", session_id: SID });

const estado = {};
const rpc = [];   // llamadas a api_factor_* con sus argumentos
const reiniciar = () => Object.assign(estado, {
  sesiones: { [JWT_SUPER]: "diego@ejemplo.pe", [JWT_SIN_SID]: "diego@ejemplo.pe", [JWT_PORTAL]: "12345678@portal.grupoer.pe" },
  envios: 0,                                     // filas en correo_envios (para limitar)
  consultas: [],                                 // URLs de los GET de conteo a correo_envios
  emitir: { ok: true, expira_en: "2026-09-28T12:10:00Z" },
  verificar: { ok: true, expira_en: "2026-09-28T20:00:00Z" },
  dispositivoUsar: true, revocados: 2,
});
const json = (cuerpo, status = 200, headers = {}) => new Response(cuerpo === null || status === 204 ? null : JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json", ...headers } });
globalThis.fetch = vi.fn(async (url, init = {}) => {
  const u = String(url);
  if (u.includes("/auth/v1/user")) {
    const jwt = String(init.headers?.authorization ?? "").replace("Bearer ", "");
    const email = estado.sesiones[jwt];
    return email ? json({ email }) : json({ error: "invalid" }, 401);
  }
  if (u.includes("/rest/v1/correo_envios") && (init.method ?? "GET") === "GET") { estado.consultas = (estado.consultas ?? []).concat(u); return json([], 200, { "content-range": `0-0/${estado.envios}` }); }
  if (u.includes("/rest/v1/correo_envios")) { estado.rastro = (estado.rastro ?? []).concat(JSON.parse(init.body)); return json(null, 201); }
  const m = /\/rest\/v1\/rpc\/(api_factor_\w+)/.exec(u);
  if (m) {
    const args = JSON.parse(init.body); rpc.push({ fn: m[1], args });
    if (m[1] === "api_factor_emitir") return json(estado.emitir);
    if (m[1] === "api_factor_verificar") return json(estado.verificar);
    if (m[1] === "api_factor_dispositivo_crear") return json(null, 204);
    if (m[1] === "api_factor_dispositivo_usar") return json(estado.dispositivoUsar);
    if (m[1] === "api_factor_dispositivos_revocar") return json(estado.revocados);
  }
  throw new Error(`ruta no simulada: ${u}`);
});
beforeEach(() => { reiniciar(); enviados.length = 0; rpc.length = 0; motor.configurado = true; motor.falla = false; });

const llamar = async (cuerpo, jwt = JWT_SUPER, metodo = "POST") => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
  await handler({ method: metodo, body: cuerpo, headers: { "x-forwarded-for": "190.1.2.3", "user-agent": "Prueba/1", ...(jwt ? { "x-sesion": jwt } : {}) }, socket: {} }, res);
  return { status: res.status.mock.calls[0][0], json: res.json.mock.calls[0][0] };
};

describe("identidad", () => {
  it("405 sin POST; 401 sin sesión o con sesión inválida; 403 para una cuenta del portal; 401 si el token validado no trae session_id", async () => {
    expect((await llamar({ accion: "enviar" }, JWT_SUPER, "GET")).status).toBe(405);
    expect((await llamar({ accion: "enviar" }, null)).status).toBe(401);
    expect((await llamar({ accion: "enviar" }, "jwt-falso")).status).toBe(401);
    expect((await llamar({ accion: "enviar" }, JWT_PORTAL)).status).toBe(403);
    expect((await llamar({ accion: "enviar" }, JWT_SIN_SID)).status).toBe(401);
  });
  it("valida la sesión con GoTrue ANTES de leer el claim (nunca decodifica un token no validado)", async () => {
    await llamar({ accion: "enviar" }, "jwt-falso");
    expect(rpc).toHaveLength(0);
  });
});

describe("enviar", () => {
  it("emite un código de 6 dígitos, lo hashea con el session_id, manda el correo y responde sin el código", async () => {
    const r = await llamar({ accion: "enviar" });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ enviado: true, expiraEn: "2026-09-28T12:10:00Z", correo: "d•••@ejemplo.pe" });
    const e = rpc.find((x) => x.fn === "api_factor_emitir");
    expect(e.args).toMatchObject({ p_correo: "diego@ejemplo.pe", p_session_id: SID, p_ip: "190.1.2.3", p_agente: "Prueba/1" });
    expect(enviados).toHaveLength(1);
    const codigo = /\b(\d{6})\b/.exec(enviados[0].html)?.[1];
    expect(codigo).toMatch(/^\d{6}$/);
    expect(e.args.p_codigo_hash).toBe(sha(codigo + SID));
    expect(JSON.stringify(r.json)).not.toContain(codigo);
    expect(JSON.stringify(r.json)).not.toContain(e.args.p_codigo_hash);
    expect(estado.rastro.at(-1)).toMatchObject({ accion: "segundo-factor", sujeto: "diego@ejemplo.pe", resultado: "enviado" });
  });
  it("429 con esperaSeg cuando la base pide esperar; 403 si no es superadmin o la política está apagada; no manda correo", async () => {
    estado.emitir = { ok: false, motivo: "espera", espera_seg: 42 };
    let r = await llamar({ accion: "enviar" });
    expect(r.status).toBe(429); expect(r.json.esperaSeg).toBe(42);
    estado.emitir = { ok: false, motivo: "no_superadmin" };
    r = await llamar({ accion: "enviar" }); expect(r.status).toBe(403);
    estado.emitir = { ok: false, motivo: "apagado" };
    r = await llamar({ accion: "enviar" }); expect(r.status).toBe(403);
    expect(enviados).toHaveLength(0);
  });
  it("503 con el texto acordado si el motor no está configurado o el envío falla; deja rastro «error»", async () => {
    motor.configurado = false;
    let r = await llamar({ accion: "enviar" });
    expect(r.status).toBe(503); expect(r.json.error).toBe("No se pudo enviar el código. Avisa a soporte técnico.");
    motor.configurado = true; motor.falla = true;
    r = await llamar({ accion: "enviar" });
    expect(r.status).toBe(503);
    expect(estado.rastro.at(-1)).toMatchObject({ accion: "segundo-factor", resultado: "error" });
  });
  it("429 por límite de tasa (correo_envios) sin tocar la base ni el motor", async () => {
    estado.envios = 30;
    const r = await llamar({ accion: "enviar" });
    expect(r.status).toBe(429);
    expect(rpc).toHaveLength(0); expect(enviados).toHaveLength(0);
  });
  it("el límite de tasa tiene cubo propio: por IP y por sujeto cuenta solo accion=segundo-factor y excluye los «limitado»", async () => {
    await llamar({ accion: "enviar" });
    expect(estado.consultas).toHaveLength(2);
    for (const c of estado.consultas) { expect(c).toContain("accion=eq.segundo-factor"); expect(c).toContain("resultado=neq.limitado"); }
    expect(estado.consultas.some((c) => c.includes("ip=eq."))).toBe(true);
    expect(estado.consultas.some((c) => c.includes("sujeto=eq."))).toBe(true);
  });
});

describe("verificar", () => {
  it("normaliza el código, manda el hash con el session_id y responde listo; con recordar crea un equipo y devuelve el token una sola vez", async () => {
    let r = await llamar({ accion: "verificar", codigo: " 12 34-56 ", recordar: false });
    expect(r.status).toBe(200); expect(r.json).toEqual({ listo: true });
    expect(rpc.find((x) => x.fn === "api_factor_verificar").args.p_codigo_hash).toBe(sha("123456" + SID));
    expect(rpc.find((x) => x.fn === "api_factor_dispositivo_crear")).toBeUndefined();
    rpc.length = 0;
    r = await llamar({ accion: "verificar", codigo: "123456", recordar: true });
    expect(r.status).toBe(200); expect(r.json.listo).toBe(true);
    expect(r.json.dispositivo).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(rpc.find((x) => x.fn === "api_factor_dispositivo_crear").args.p_token_hash).toBe(sha(r.json.dispositivo));
  });
  it("400 con intentosRestantes si es incorrecto; 410 vencido/agotado; código mal formado → 400 sin ir a la base; deja rastro «rechazado» solo en fallos", async () => {
    estado.verificar = { ok: false, motivo: "incorrecto", intentos_restantes: 3 };
    let r = await llamar({ accion: "verificar", codigo: "000000" });
    expect(r.status).toBe(400); expect(r.json).toEqual({ error: "Código incorrecto.", intentosRestantes: 3 });
    expect(estado.rastro.at(-1)).toMatchObject({ accion: "segundo-factor", resultado: "rechazado", detalle: "incorrecto" });
    estado.verificar = { ok: false, motivo: "vencido" };
    r = await llamar({ accion: "verificar", codigo: "000000" }); expect(r.status).toBe(410); expect(r.json.error).toBe("vencido");
    estado.verificar = { ok: false, motivo: "agotado", intentos_restantes: 0 };
    r = await llamar({ accion: "verificar", codigo: "000000" }); expect(r.status).toBe(410); expect(r.json.error).toBe("agotado");
    rpc.length = 0;
    r = await llamar({ accion: "verificar", codigo: "12" }); expect(r.status).toBe(400); expect(rpc).toHaveLength(0);
  });
});

describe("dispositivo y olvidar", () => {
  it("dispositivo: hashea el token y responde listo; token no reconocido → 403 genérico (no 401: el cliente reserva 401 para salir)", async () => {
    let r = await llamar({ accion: "dispositivo", token: "abc" });
    expect(r.status).toBe(200); expect(r.json).toEqual({ listo: true });
    expect(rpc.find((x) => x.fn === "api_factor_dispositivo_usar").args.p_token_hash).toBe(sha("abc"));
    estado.dispositivoUsar = false;
    r = await llamar({ accion: "dispositivo", token: "abc" });
    expect(r.status).toBe(403); expect(r.json).toEqual({ error: "Equipo no reconocido." });
    r = await llamar({ accion: "dispositivo" }); expect(r.status).toBe(400);
  });
  it("olvidar: revoca todos los equipos del llamador y responde el número", async () => {
    const r = await llamar({ accion: "olvidar" });
    expect(r.status).toBe(200); expect(r.json).toEqual({ revocados: 2 });
    expect(rpc.find((x) => x.fn === "api_factor_dispositivos_revocar").args).toEqual({ p_correo: "diego@ejemplo.pe" });
  });
  it("acción desconocida → 400", async () => { expect((await llamar({ accion: "x" })).status).toBe(400); });
});
