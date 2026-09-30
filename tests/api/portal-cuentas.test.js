// tests/api/portal-cuentas.test.js — Cuentas del portal: cada correo de acceso
// deja rastro en correo_envios (sin ip ni sujeto: es informativo, no limita).
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

process.env.SUPA_SERVICE_KEY = "clave-servicio-de-prueba";
process.env.VITE_SUPABASE_ANON_KEY = "sb_publishable_prueba";
const motor = { falla: false };
vi.mock("../../api/_correo.js", () => ({
  enviar: vi.fn(async () => (motor.falla ? { error: "El proveedor de correo respondió 429: rate limit" } : {})),
  plantilla: (t, c) => `${t}${c}`, botonCorreo: () => "",
}));

let handler;
beforeAll(async () => { ({ default: handler } = await import("../../api/portal-cuentas.js")); });
const rastro = [];
const json = (cuerpo, status = 200) => new Response(cuerpo === null ? null : JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = vi.fn(async (url, init = {}) => {
  const u = String(url);
  if (u.includes("/auth/v1/user")) return json({ email: "diego@ejemplo.pe" });
  if (u.includes("/rest/v1/rpc/mi_segundo_factor")) return json({ exigido: false, verificado: true });
  if (u.includes("/rest/v1/v_mi_acceso")) return json([{ esSuperadmin: true, matriz: {} }]);
  if (u.includes("/rest/v1/personas")) return json([{ dni: "12345678", nombre: "ANA PRUEBA", correo: "ana@ejemplo.pe" }]);
  if (u.includes("/auth/v1/admin/users") && (init.method ?? "GET") === "POST") return json({ id: "u1" });
  if (u.includes("/rest/v1/cuentas_portal")) return json(null, 201);
  if (u.includes("/rest/v1/correo_envios")) { rastro.push(JSON.parse(init.body)); return json(null, 201); }
  throw new Error(`ruta no simulada: ${u}`);
});
beforeEach(() => { rastro.length = 0; motor.falla = false; });
const llamar = async (cuerpo) => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
  await handler({ method: "POST", body: cuerpo, headers: { "x-sesion": "jwt", "x-forwarded-for": "190.1.2.3" }, socket: {} }, res);
  return { status: res.status.mock.calls[0][0], json: res.json.mock.calls[0][0] };
};

describe("rastro del correo de acceso", () => {
  it("crear con correo → 200, enviado y una fila acceso-portal «enviado» sin ip ni sujeto", async () => {
    const r = await llamar({ accion: "crear", dni: "12345678", enviarCorreo: true });
    expect(r.status).toBe(200);
    expect(r.json.enviado).toBe("ana@ejemplo.pe");
    expect(rastro).toEqual([{ accion: "acceso-portal", ip: null, sujeto: null, destinatario: "ana@ejemplo.pe", resultado: "enviado", detalle: null }]);
  });
  it("si el proveedor falla: la cuenta igual se crea, viaja errorCorreo y la fila dice «error» con el detalle", async () => {
    motor.falla = true;
    const r = await llamar({ accion: "crear", dni: "12345678", enviarCorreo: true });
    expect(r.status).toBe(200);
    expect(r.json.clave).toMatch(/^\d{6}$/);
    expect(r.json.errorCorreo).toMatch(/429/);
    expect(rastro[0]).toMatchObject({ accion: "acceso-portal", resultado: "error", detalle: expect.stringMatching(/429/) });
  });
  it("sin enviarCorreo no hay envío ni rastro", async () => {
    await llamar({ accion: "crear", dni: "12345678" });
    expect(rastro).toEqual([]);
  });
});
