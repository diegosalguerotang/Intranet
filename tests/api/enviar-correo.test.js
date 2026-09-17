// Endpoint de correo endurecido (fase 0 de la corrección de seguridad):
// sesión, secreto del sistema en tiempo constante, límite de tasa y lista
// blanca de destinatarios. Supabase y el proveedor de correo se simulan.
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

process.env.SUPA_SERVICE_KEY = "clave-servicio-de-prueba";
const enviados = [];
vi.mock("../../api/_correo.js", () => ({
  enviar: vi.fn(async (destino, asunto) => { enviados.push({ destino, asunto }); return {}; }),
  plantilla: (t, c) => `${t}${c}`,
  botonCorreo: (h, t) => `<a href="${h}">${t}</a>`,
}));

let handler, secretoCoincide;
beforeAll(async () => { ({ default: handler, secretoCoincide } = await import("../../api/enviar-correo.js")); });

// --- Doble de Supabase: rutas REST y auth ------------------------------------
const estado = {};
const reiniciar = () => Object.assign(estado, {
  sesiones: { "jwt-rosa": "45231876@portal.grupoer.pe", "jwt-luis": "41887203@portal.grupoer.pe", "jwt-admin": "dsalguero@grupoer.pe", "jwt-ajeno": "otro@ejemplo.com" },
  admins: [{ id: 1, correo: "dsalguero@grupoer.pe", persona_dni: "40776655", estado: "activo" }],
  personas: [
    { dni: "45231876", nombre: "Rosa Quispe", correo: "rosa@gmail.com", correo_verificado: true },
    { dni: "41887203", nombre: "Luis Zapata", correo: "luis@gmail.com", correo_verificado: false },
    { dni: "40776655", nombre: "Diego S", correo: "dsalguero@grupoer.pe", correo_verificado: true },
  ],
  cuentas: ["45231876"],
  tickets: [{ numero: "TK-0007", tipo: "Correo", solicitante_dni: "45231876", solicitante_nombre: "Rosa Quispe" }],
  ticketAvisos: ["dsalguero@grupoer.pe", "ti-externo@proveedor.com"],
  registros: [],           // filas insertadas en correo_envios
  conteos: {},             // { "ip:1.2.3.4": n, "sujeto:x": n } que devuelve el count=exact
  tablaCaida: false,
});
const q = (url) => Object.fromEntries(new URL(url).searchParams);
const valorEq = (v) => decodeURIComponent(String(v ?? "")).replace(/^(eq|ilike)\./, "");

globalThis.fetch = vi.fn(async (url, init = {}) => {
  const u = String(url), p = q(u);
  const json = (cuerpo, status = 200, headers = {}) =>
    new Response(cuerpo === null ? "" : JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json", ...headers } });
  if (u.includes("/auth/v1/user")) {
    const jwt = String(init.headers?.authorization ?? "").replace("Bearer ", "");
    const email = estado.sesiones[jwt];
    return email ? json({ email }) : json({ error: "invalid" }, 401);
  }
  if (u.includes("/rest/v1/correo_envios")) {
    if (estado.tablaCaida) return json({ error: "relation does not exist" }, 404);
    if (init.method === "POST") { estado.registros.push(JSON.parse(init.body)); return json(null, 201); }
    const clave = p.ip ? `ip:${valorEq(p.ip)}` : `sujeto:${valorEq(p.sujeto)}`;
    const n = estado.conteos[clave] ?? 0;
    return json([], 200, { "content-range": `0-0/${n}` });
  }
  if (u.includes("/rest/v1/usuarios_admin")) {
    const correo = valorEq(p.correo).toLowerCase();
    return json(estado.admins.filter((a) => a.correo === correo && (!p.estado || a.estado === valorEq(p.estado))));
  }
  if (u.includes("/rest/v1/personas")) {
    if (p.correo) return json(estado.personas.filter((x) => x.correo.toLowerCase() === valorEq(p.correo).toLowerCase()));
    return json(estado.personas.filter((x) => x.dni.toUpperCase() === valorEq(p.dni).toUpperCase()));
  }
  if (u.includes("/rest/v1/cuentas_portal")) return json(estado.cuentas.includes(valorEq(p.dni)) ? [{ dni: valorEq(p.dni) }] : []);
  if (u.includes("/rest/v1/v_tickets")) return json(estado.tickets.filter((t) => t.numero === valorEq(p.numero)));
  if (u.includes("/rest/v1/ticket_avisos")) return json(estado.ticketAvisos.map((correo) => ({ correo })));
  if (u.includes("/rest/v1/correo_tokens")) return json(null, 201);
  throw new Error(`ruta no simulada: ${u}`);
});

const llamar = async (cuerpo, headers = {}, ip = "1.2.3.4") => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
  await handler({ method: "POST", body: cuerpo, headers: { "x-forwarded-for": ip, ...headers }, socket: {} }, res);
  return { status: res.status.mock.calls[0][0], json: res.json.mock.calls[0][0] };
};

beforeEach(() => { reiniciar(); enviados.length = 0; delete process.env.CORREO_SECRETO; });

describe("secreto del sistema", () => {
  it("compara en tiempo constante y exige que exista la env var", () => {
    expect(secretoCoincide("abc", "abc")).toBe(true);
    expect(secretoCoincide("abc", "abd")).toBe(false);
    expect(secretoCoincide("abc", "")).toBe(false);
    expect(secretoCoincide("", "abc")).toBe(false);
    expect(secretoCoincide("abc", "abcd")).toBe(false);
  });
  it("aviso-ticket con el secreto correcto entra como sistema; con uno incorrecto o sin env var, 401", async () => {
    process.env.CORREO_SECRETO = "s3cr3to";
    expect((await llamar({ accion: "aviso-ticket", numero: "TK-0007" }, { "x-correo-secreto": "s3cr3to" })).status).toBe(200);
    expect((await llamar({ accion: "aviso-ticket", numero: "TK-0007" }, { "x-correo-secreto": "malo" })).status).toBe(401);
    delete process.env.CORREO_SECRETO;
    expect((await llamar({ accion: "aviso-ticket", numero: "TK-0007" }, { "x-correo-secreto": "s3cr3to" })).status).toBe(401);
  });
});

describe("aviso-ticket: sesión y alcance", () => {
  it("sin sesión → 401 y no envía nada", async () => {
    const r = await llamar({ accion: "aviso-ticket", numero: "TK-0007" });
    expect(r.status).toBe(401); expect(enviados).toHaveLength(0);
  });
  it("sesión inválida → 401", async () => {
    expect((await llamar({ accion: "aviso-ticket", numero: "TK-0007" }, { "x-sesion": "jwt-falso" })).status).toBe(401);
  });
  it("sesión que no es portal ni administrador activo → 401", async () => {
    expect((await llamar({ accion: "aviso-ticket", numero: "TK-0007" }, { "x-sesion": "jwt-ajeno" })).status).toBe(401);
  });
  it("trabajador del portal sobre un ticket AJENO → 403 y rastro «rechazado»", async () => {
    const r = await llamar({ accion: "aviso-ticket", numero: "TK-0007" }, { "x-sesion": "jwt-luis" });
    expect(r.status).toBe(403); expect(enviados).toHaveLength(0);
    expect(estado.registros.at(-1)).toMatchObject({ accion: "aviso-ticket", sujeto: "TK-0007", resultado: "rechazado" });
  });
  it("trabajador sobre SU ticket: envía solo a destinos del padrón y omite el ajeno", async () => {
    const r = await llamar({ accion: "aviso-ticket", numero: "TK-0007" }, { "x-sesion": "jwt-rosa" });
    expect(r.status).toBe(200); expect(r.json).toEqual({ enviados: 1, omitidos: 1 });
    expect(enviados.map((e) => e.destino)).toEqual(["dsalguero@grupoer.pe"]);
    expect(estado.registros.find((x) => x.destinatario === "ti-externo@proveedor.com")).toMatchObject({ resultado: "rechazado", detalle: "fuera del padrón" });
    expect(estado.registros.find((x) => x.destinatario === "dsalguero@grupoer.pe")).toMatchObject({ resultado: "enviado", ip: "1.2.3.4" });
  });
  it("administrador activo avisa sobre cualquier ticket", async () => {
    expect((await llamar({ accion: "aviso-ticket", numero: "TK-0007" }, { "x-sesion": "jwt-admin" })).status).toBe(200);
  });
  it("administrador suspendido → 401", async () => {
    estado.admins[0].estado = "suspendido";
    expect((await llamar({ accion: "aviso-ticket", numero: "TK-0007" }, { "x-sesion": "jwt-admin" })).status).toBe(401);
  });
});

describe("límite de tasa", () => {
  it("recuperación pública: 3 intentos por DNI en la hora; el 4.º devuelve 429 sin enviar", async () => {
    estado.conteos["sujeto:45231876"] = 3;
    const r = await llamar({ accion: "recuperacion", dni: "45231876" });
    expect(r.status).toBe(429); expect(enviados).toHaveLength(0);
    expect(estado.registros.at(-1)).toMatchObject({ accion: "recuperacion", resultado: "limitado" });
  });
  it("recuperación pública dentro del límite envía y deja rastro «enviado»", async () => {
    const r = await llamar({ accion: "recuperacion", dni: "45231876" });
    expect(r.status).toBe(200); expect(enviados).toHaveLength(1);
    expect(estado.registros.at(-1)).toMatchObject({ resultado: "enviado", destinatario: "rosa@gmail.com" });
  });
  it("la IP se limita en cualquier acción (30 por hora)", async () => {
    estado.conteos["ip:9.9.9.9"] = 30;
    expect((await llamar({ accion: "recuperacion-admin", correo: "dsalguero@grupoer.pe" }, {}, "9.9.9.9")).status).toBe(429);
    expect((await llamar({ accion: "aviso-ticket", numero: "TK-0007" }, { "x-sesion": "jwt-admin" }, "9.9.9.9")).status).toBe(429);
    expect(enviados).toHaveLength(0);
  });
  it("si la tabla correo_envios no responde, falla cerrado con 503 y no envía", async () => {
    estado.tablaCaida = true;
    const r = await llamar({ accion: "recuperacion", dni: "45231876" });
    expect(r.status).toBe(503); expect(enviados).toHaveLength(0);
  });
});

describe("recuperación: respuesta genérica", () => {
  it("DNI sin cuenta o sin correo verificado → 200 genérico, nada enviado, rastro «rechazado»", async () => {
    const r = await llamar({ accion: "recuperacion", dni: "41887203" });
    expect(r.status).toBe(200); expect(r.json.mensaje).toMatch(/Si tu correo/);
    expect(enviados).toHaveLength(0);
    expect(estado.registros.at(-1)).toMatchObject({ resultado: "rechazado" });
  });
  it("recuperación-admin de un correo inexistente → 200 genérico sin envío", async () => {
    const r = await llamar({ accion: "recuperacion-admin", correo: "nadie@grupoer.pe" });
    expect(r.status).toBe(200); expect(enviados).toHaveLength(0);
  });
});

describe("verificación", () => {
  it("exige sesión del portal; un administrador no puede pedirla", async () => {
    expect((await llamar({ accion: "verificacion" })).status).toBe(401);
    expect((await llamar({ accion: "verificacion" }, { "x-sesion": "jwt-admin" })).status).toBe(401);
  });
  it("el trabajador con correo sin verificar recibe el enlace en SU correo", async () => {
    const r = await llamar({ accion: "verificacion" }, { "x-sesion": "jwt-luis" });
    expect(r.status).toBe(200); expect(r.json).toEqual({ enviado: "luis@gmail.com" });
    expect(estado.registros.at(-1)).toMatchObject({ accion: "verificacion", sujeto: "41887203", resultado: "enviado" });
  });
});

describe("recordatorio de acuse", () => {
  it("el sistema (secreto) no puede enviar recordatorios: es una acción de persona", async () => {
    process.env.CORREO_SECRETO = "s3cr3to";
    expect((await llamar({ accion: "recordatorio-acuse", dni: "45231876" }, { "x-correo-secreto": "s3cr3to" })).status).toBe(401);
  });
  it("un trabajador del portal → 403", async () => {
    expect((await llamar({ accion: "recordatorio-acuse", dni: "45231876" }, { "x-sesion": "jwt-rosa" })).status).toBe(403);
  });
});
