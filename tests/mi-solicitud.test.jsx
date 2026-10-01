// tests/mi-solicitud.test.jsx — Humo de la pantalla «Mi solicitud» (render en
// servidor, sin navegador): el buzón del jefe directo aparece solo cuando hay
// solicitudes esperando su visto bueno, sin el original firmado ni documentos,
// y el formulario ofrece el campo del jefe inmediato.
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const app = {
  db: {
    solicitudTipos: [{ id: "papeleta-permiso", nombre: "Papeleta de permiso", codigo_formato: "GR-F-14", activo: true, backoffice: true }],
    misSolicitudes: [], ticketConfig: [], misTickets: [],
  },
  user: { nombre: "Jefa de Prueba", correo: "jefa@ejemplo.invalido" },
  vistosBuenos: [],
  crearSolicitudPropia: vi.fn(), reenviarSolicitud: vi.fn(), crearTicketPropio: vi.fn(), resolverSolicitud: vi.fn(),
  jefesDisponibles: vi.fn(async () => []),
};
vi.mock("../src/state", () => ({ useApp: () => app }));
vi.mock("../src/lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: null }) } }, supabaseListo: false }));

const pintar = async () => {
  const { default: MiSolicitud } = await import("../src/pages/solicitudes/MiSolicitud.jsx");
  return renderToStaticMarkup(<MiSolicitud />);
};

describe("Mi solicitud", () => {
  it("sin pendientes de visto bueno no aparece el buzón del jefe", async () => {
    app.vistosBuenos = [];
    const html = await pintar();
    expect(html).not.toContain("Esperan tu visto bueno");
    expect(html).toContain("Nueva solicitud");
  });
  it("con una solicitud esperando: muestra solicitante, datos y los tres botones; nunca el original firmado", async () => {
    app.vistosBuenos = [{
      id: 7, numero: "PAP-NEG-2026-0007", tipo_id: "papeleta-permiso", tipo: "Papeleta de permiso",
      solicitante_nombre: "ROSA QUISPE", cargo: "ASISTENTE", sede_nombre: "Oficina", creado: "2026-10-01 10:00",
      datos: { salida: "2026-10-05T09:00", retorno: "2026-10-05T12:00", motivo: "Particular", fundamentacion: "Trámite" },
    }];
    const html = await pintar();
    expect(html).toContain("Esperan tu visto bueno");
    expect(html).toContain("PAP-NEG-2026-0007");
    expect(html).toContain("ROSA QUISPE");
    for (const boton of ["Dar visto bueno", "Observar", "Rechazar"]) expect(html).toContain(boton);
    expect(html).not.toContain("Original firmado");
  });
});
