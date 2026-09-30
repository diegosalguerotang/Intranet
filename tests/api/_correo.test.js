// tests/api/_correo.test.js — Motor de correo: Resend es el único proveedor.
// fetch se simula; el módulo lee la env al importarse, por eso cada prueba lo
// vuelve a importar con vi.resetModules().
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const respuesta = (status, cuerpo) => new Response(cuerpo, { status });
let llamadas;
const cargar = async (env) => {
  vi.resetModules();
  for (const k of ["RESEND_API_KEY", "CORREO_REMITENTE", "SMTP_USER", "SMTP_PASS"]) delete process.env[k];
  Object.assign(process.env, env);
  return import("../../api/_correo.js");
};
beforeEach(() => { llamadas = []; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("enviar por Resend", () => {
  it("POST a api.resend.com con Bearer, remitente de la env y el destino; 200 → {}", async () => {
    globalThis.fetch = vi.fn(async (url, init) => { llamadas.push({ url: String(url), init }); return respuesta(200, "{}"); });
    const { enviar, motorConfigurado, REMITENTE } = await cargar({ RESEND_API_KEY: "re_prueba", CORREO_REMITENTE: "GrupoER <no-responder@avisos.ejemplo>" });
    expect(motorConfigurado()).toBe(true);
    expect(REMITENTE).toBe("GrupoER <no-responder@avisos.ejemplo>");
    expect(await enviar("a@ejemplo.pe", "Asunto", "<p>Hola</p>")).toEqual({});
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].url).toBe("https://api.resend.com/emails");
    expect(llamadas[0].init.headers.Authorization).toBe("Bearer re_prueba");
    expect(JSON.parse(llamadas[0].init.body)).toEqual({ from: "GrupoER <no-responder@avisos.ejemplo>", to: ["a@ejemplo.pe"], subject: "Asunto", html: "<p>Hola</p>" });
  });
  it("un error del proveedor devuelve el estado y los primeros 200 caracteres del cuerpo", async () => {
    globalThis.fetch = vi.fn(async () => respuesta(400, JSON.stringify({ message: "API key is invalid" })));
    const { enviar } = await cargar({ RESEND_API_KEY: "re_prueba" });
    const r = await enviar("a@ejemplo.pe", "x", "y");
    expect(r.error).toMatch(/^El proveedor de correo respondió 400: .*API key is invalid/);
  });
  it("429 → espera PAUSA_429_MS y reintenta UNA vez; si la segunda va bien devuelve {}", async () => {
    let n = 0;
    globalThis.fetch = vi.fn(async () => (++n === 1 ? respuesta(429, "rate limit") : respuesta(200, "{}")));
    const { enviar, PAUSA_429_MS } = await cargar({ RESEND_API_KEY: "re_prueba" });
    const p = enviar("a@ejemplo.pe", "x", "y");
    await vi.advanceTimersByTimeAsync(PAUSA_429_MS);
    expect(await p).toEqual({});
    expect(n).toBe(2);
  });
  it("429 dos veces → error 429, sin tercer intento", async () => {
    let n = 0;
    globalThis.fetch = vi.fn(async () => { n++; return respuesta(429, "rate limit"); });
    const { enviar, PAUSA_429_MS } = await cargar({ RESEND_API_KEY: "re_prueba" });
    const p = enviar("a@ejemplo.pe", "x", "y");
    await vi.advanceTimersByTimeAsync(PAUSA_429_MS * 2);
    expect((await p).error).toMatch(/respondió 429/);
    expect(n).toBe(2);
  });
  it("sin RESEND_API_KEY: motor sin configurar, error claro y ningún fetch; SMTP_USER/SMTP_PASS ya no cuentan", async () => {
    globalThis.fetch = vi.fn();
    const { enviar, motorConfigurado, REMITENTE } = await cargar({ SMTP_USER: "x@gmail.com", SMTP_PASS: "clave" });
    expect(motorConfigurado()).toBe(false);
    expect(REMITENTE).toBe("GrupoER <onboarding@resend.dev>");
    expect((await enviar("a@ejemplo.pe", "x", "y")).error).toBe("El motor de correo aún no está configurado (falta RESEND_API_KEY).");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("la llave y el remitente se sanean de BOM y espacios", async () => {
    globalThis.fetch = vi.fn(async (url, init) => { llamadas.push({ init }); return respuesta(200, "{}"); });
    const { enviar, REMITENTE } = await cargar({ RESEND_API_KEY: "﻿ re_prueba \n", CORREO_REMITENTE: " GrupoER <a@b.c> " });
    await enviar("a@ejemplo.pe", "x", "y");
    expect(llamadas[0].init.headers.Authorization).toBe("Bearer re_prueba");
    expect(REMITENTE).toBe("GrupoER <a@b.c>");
  });
});
