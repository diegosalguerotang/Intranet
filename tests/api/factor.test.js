// Compuerta del segundo factor para los endpoints con x-sesion (api/_factor.js)
// y lectura de claims de un JWT ya validado (api/_clave.js).
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

let claimDeSesion, factorPendiente;
const estado = {};
const reiniciar = () => Object.assign(estado, { respuesta: { exigido: true, verificado: false }, status: 200, caido: false, crudo: undefined });
const json = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
const llamadas = [];
globalThis.fetch = vi.fn(async (url, init = {}) => {
  llamadas.push({ url: String(url), init });
  if (estado.caido) throw new TypeError("fetch failed");
  if (String(url).includes("/rest/v1/rpc/mi_segundo_factor") && estado.crudo !== undefined) return new Response(estado.crudo, { status: estado.status });
  if (String(url).includes("/rest/v1/rpc/mi_segundo_factor")) return json(estado.respuesta, estado.status);
  throw new Error(`ruta no simulada: ${url}`);
});
const jwtCon = (payload) => `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`;

beforeAll(async () => {
  process.env.VITE_SUPABASE_ANON_KEY = "sb_publishable_prueba";
  process.env.SUPA_SERVICE_KEY = "clave-servicio-de-prueba";
  ({ claimDeSesion } = await import("../../api/_clave.js"));
  ({ factorPendiente } = await import("../../api/_factor.js"));
});
beforeEach(() => { reiniciar(); llamadas.length = 0; });

describe("claimDeSesion", () => {
  it("lee un claim del payload y devuelve vacío si falta o el token no es JWT", () => {
    expect(claimDeSesion(jwtCon({ session_id: "abc", email: "A@B.pe" }), "session_id")).toBe("abc");
    expect(claimDeSesion(jwtCon({ email: "a@b.pe" }), "session_id")).toBe("");
    expect(claimDeSesion("no-es-jwt", "session_id")).toBe("");
    expect(claimDeSesion(undefined, "session_id")).toBe("");
  });
});

describe("factorPendiente", () => {
  it("llama a mi_segundo_factor con el JWT del usuario (no con la llave de servicio) y bloquea si exigido && !verificado", async () => {
    expect(await factorPendiente("jwt-usuario")).toBe(true);
    const l = llamadas[0];
    expect(l.url).toContain("/rest/v1/rpc/mi_segundo_factor");
    expect(l.init.headers.authorization).toBe("Bearer jwt-usuario");
    expect(l.init.headers.apikey).toBe("sb_publishable_prueba");
  });
  it("deja pasar si no es exigido o ya está verificado", async () => {
    estado.respuesta = { exigido: false, verificado: false };
    expect(await factorPendiente("jwt")).toBe(false);
    estado.respuesta = { exigido: true, verificado: true };
    expect(await factorPendiente("jwt")).toBe(false);
  });
  it("deja pasar solo si la función no existe (migración sin aplicar, PGRST202); cualquier otro fallo bloquea", async () => {
    estado.respuesta = { code: "PGRST202", message: "Could not find the function" }; estado.status = 404;
    expect(await factorPendiente("jwt")).toBe(false);
    estado.respuesta = { message: "boom" }; estado.status = 500;
    expect(await factorPendiente("jwt")).toBe(true);
    estado.caido = true;
    expect(await factorPendiente("jwt")).toBe(true);
  });
  it("200 con cuerpo no JSON, vacío o que no es un objeto → bloquea (fallo cerrado)", async () => {
    for (const crudo of ["<html>proxy</html>", "", "null", "\"texto\"", "42"]) {
      estado.crudo = crudo;
      expect(await factorPendiente("jwt")).toBe(true);
    }
  });
});
