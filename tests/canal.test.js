// Fase 6a (P10): el canal hacia Supabase se decide por CONFIGURACIÓN con fallo
// cerrado, nunca por el hostname. En producción el navegador habla SOLO con su
// propio dominio (/api/supa); el canal directo existe únicamente en desarrollo.
import { describe, it, expect } from "vitest";
import { decidirCanal, urlCanal } from "../src/lib/canal.js";

describe("decidirCanal", () => {
  it("en producción usa el proxy aunque alguien ponga la variable de canal directo", () => {
    expect(decidirCanal({ dev: false, directo: "1" })).toBe("proxy");
    expect(decidirCanal({ dev: false })).toBe("proxy");
  });
  it("en desarrollo va directo (vite dev no tiene proxy)", () => {
    expect(decidirCanal({ dev: true })).toBe("directo");
    expect(decidirCanal({ dev: true, directo: "1" })).toBe("directo");
  });
  it("en desarrollo VITE_CANAL_DIRECTO=0 fuerza el proxy (vercel dev)", () => {
    expect(decidirCanal({ dev: true, directo: "0" })).toBe("proxy");
    expect(decidirCanal({ dev: true, directo: " 0 " })).toBe("proxy");
  });
  it("cualquier valor raro o ausente se trata como fallo cerrado fuera de desarrollo", () => {
    expect(decidirCanal({})).toBe("proxy");
    expect(decidirCanal({ dev: undefined, directo: undefined })).toBe("proxy");
  });
});

describe("urlCanal", () => {
  it("con proxy la URL es el propio origen + /api/supa", () => {
    expect(urlCanal("proxy", { origin: "https://intranet-general.vercel.app" })).toBe("https://intranet-general.vercel.app/api/supa");
  });
  it("con proxy y sin ventana (pruebas) queda relativa", () => {
    expect(urlCanal("proxy", {})).toBe("/api/supa");
  });
  it("directo usa la URL configurada, saneada de BOM y espacios", () => {
    expect(urlCanal("directo", { urlDirecta: "﻿https://x.supabase.co " })).toBe("https://x.supabase.co");
  });
});
