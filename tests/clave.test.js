import { describe, it, expect } from "vitest";
import { marcarClaveCambiada } from "../src/lib/clave.js";

// El resultado de supabase.rpc() es un PostgrestBuilder: perezoso (solo dispara
// la petición cuando se le hace `then`) y SIN método `catch`. Este doble imita
// exactamente eso: si nadie hace `await`/`then`, la RPC nunca corre.
function rpcPerezosa(resultado, registro) {
  return (nombre, args) => ({
    then(res, rej) {
      registro.push({ nombre, args });
      return Promise.resolve(typeof resultado === "function" ? resultado() : resultado).then(res, rej);
    },
  });
}

describe("marcarClaveCambiada", () => {
  it("ejecuta de verdad la RPC marcar_clave_cambiada con el correo de la sesión", async () => {
    const llamadas = [];
    const supabase = { rpc: rpcPerezosa({ data: null, error: null }, llamadas) };
    const r = await marcarClaveCambiada(supabase, "renato.espinoza@promant.pe");
    expect(llamadas).toEqual([{ nombre: "marcar_clave_cambiada", args: { p_correo: "renato.espinoza@promant.pe" } }]);
    expect(r).toEqual({});
  });
  it("devuelve el error de la RPC en vez de tragárselo", async () => {
    const llamadas = [];
    const supabase = { rpc: rpcPerezosa({ data: null, error: { message: "Permiso insuficiente: solo sobre la propia cuenta." } }, llamadas) };
    const r = await marcarClaveCambiada(supabase, "x@grupoer.pe");
    expect(llamadas).toHaveLength(1);
    expect(r.error).toMatch(/Permiso insuficiente/);
  });
  it("captura una excepción de red como error", async () => {
    const supabase = { rpc: rpcPerezosa(() => { throw new Error("Failed to fetch"); }, []) };
    const r = await marcarClaveCambiada(supabase, "x@grupoer.pe");
    expect(r.error).toBe("Failed to fetch");
  });
  it("sin cliente o sin correo no llama y avisa", async () => {
    const llamadas = [];
    const supabase = { rpc: rpcPerezosa({ error: null }, llamadas) };
    expect((await marcarClaveCambiada(supabase, "")).error).toBeTruthy();
    expect((await marcarClaveCambiada(null, "x@grupoer.pe")).error).toBeTruthy();
    expect(llamadas).toHaveLength(0);
  });
});
