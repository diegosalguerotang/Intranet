// api/admin-usuarios.js: la compuerta del segundo factor va justo después de
// validar la sesión y antes de cualquier operación con la llave de servicio.
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

process.env.SUPA_SERVICE_KEY = "clave-servicio-de-prueba";
process.env.VITE_SUPABASE_ANON_KEY = "sb_publishable_prueba";
vi.mock("../../api/_correo.js", () => ({ enviar: vi.fn(async () => ({})), plantilla: (t, c) => `${t}${c}`, botonCorreo: () => "" }));

let handler;
beforeAll(async () => { ({ default: handler } = await import("../../api/admin-usuarios.js")); });
const estado = {};
const llamadas = [];
const rastro = [];   // filas insertadas en correo_envios
const json = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = vi.fn(async (url, init = {}) => {
  const u = String(url); llamadas.push(u);
  if (u.includes("/auth/v1/user")) return json({ email: "diego@ejemplo.pe" });
  if (u.includes("/rest/v1/rpc/mi_segundo_factor")) return json(estado.factor);
  if (u.includes("/rest/v1/v_mi_acceso")) return json([{ esSuperadmin: true, matriz: {} }]);
  if (u.includes("/rest/v1/rpc/api_admin_por_id")) return json([{ id: 7, correo: "x@ejemplo.pe" }]);
  if (u.includes("/rest/v1/rpc/api_admin_marcar_clave")) return json(null);
  if (u.includes("/rest/v1/rpc/eliminar_usuario_admin")) return json(null);
  if (u.includes("/rest/v1/correo_envios")) { rastro.push(JSON.parse(init.body)); return json(null, 201); }
  // Invitación nativa caída → el endpoint cae al camino de clave provisional.
  if (u.includes("/auth/v1/invite")) return json({ msg: "smtp" }, 500);
  if (u.includes("/auth/v1/admin/users") && init.method === "POST") return json({ id: "u9" });
  if (u.includes("/auth/v1/admin/users")) return json({ users: [] });
  throw new Error(`ruta no simulada: ${u}`);
});
beforeEach(() => { llamadas.length = 0; rastro.length = 0; estado.factor = { exigido: true, verificado: true }; });
const llamar = async (cuerpo) => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
  await handler({ method: "POST", body: cuerpo, headers: { "x-sesion": "jwt-diego" }, socket: {} }, res);
  return { status: res.status.mock.calls[0][0], json: res.json.mock.calls[0][0] };
};

describe("compuerta del segundo factor", () => {
  it("un superadmin con el código pendiente recibe 403 y no se toca ni v_mi_acceso ni la cuenta", async () => {
    estado.factor = { exigido: true, verificado: false };
    const r = await llamar({ accion: "eliminar", usuario_id: 7 });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe("Verifica el código de ingreso antes de operar.");
    expect(llamadas.some((u) => u.includes("v_mi_acceso") || u.includes("eliminar_usuario_admin"))).toBe(false);
  });
  it("verificado: sigue el flujo normal (eliminar llega a la base)", async () => {
    const r = await llamar({ accion: "eliminar", usuario_id: 7 });
    expect(r.status).toBe(200);
    expect(llamadas.some((u) => u.includes("eliminar_usuario_admin"))).toBe(true);
  });
});

describe("rastro del correo de acceso", () => {
  it("crear con invitación caída → clave provisional por correo y fila acceso-admin «enviado» sin ip ni sujeto", async () => {
    const r = await llamar({ accion: "crear", usuario_id: 7 });
    expect(r.status).toBe(200);
    expect(r.json.enviadoCorreo).toBe("x@ejemplo.pe");
    expect(rastro).toEqual([{ accion: "acceso-admin", ip: null, sujeto: null, destinatario: "x@ejemplo.pe", resultado: "enviado", detalle: null }]);
  });
});
