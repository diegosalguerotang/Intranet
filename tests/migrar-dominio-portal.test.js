// tests/migrar-dominio-portal.test.js — Reglas puras del renombre de cuentas
// técnicas del Portal (el script contra producción no se ejecuta al importarlo).
import { describe, it, expect } from "vitest";
import { correoNuevo, enmascarar } from "../scripts/migrar-dominio-portal.mjs";

describe("correoNuevo", () => {
  it("cambia solo el dominio y conserva la parte local en minúsculas", () => {
    expect(correoNuevo("45231876@portal.grupoer.pe", "portal.grupoer.pe", "portal.servicios-intranet.net")).toBe("45231876@portal.servicios-intranet.net");
    expect(correoNuevo("CE001234@PORTAL.grupoer.pe", "portal.grupoer.pe", "portal.servicios-intranet.net")).toBe("ce001234@portal.servicios-intranet.net");
  });
  it("devuelve null para correos de otro dominio o vacíos", () => {
    expect(correoNuevo("karen@grupoer.pe", "portal.grupoer.pe", "portal.servicios-intranet.net")).toBeNull();
    expect(correoNuevo("", "portal.grupoer.pe", "portal.servicios-intranet.net")).toBeNull();
    expect(correoNuevo(undefined, "portal.grupoer.pe", "portal.servicios-intranet.net")).toBeNull();
  });
  it("el camino inverso funciona igual", () => {
    expect(correoNuevo("45231876@portal.servicios-intranet.net", "portal.servicios-intranet.net", "portal.grupoer.pe")).toBe("45231876@portal.grupoer.pe");
  });
});

describe("enmascarar", () => {
  it("deja dos caracteres de la parte local y el dominio completo", () => {
    expect(enmascarar("45231876@portal.grupoer.pe")).toBe("45***@portal.grupoer.pe");
    expect(enmascarar("a@b.c")).toBe("a***@b.c");
  });
});
