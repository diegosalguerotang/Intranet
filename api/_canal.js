// Reglas del proxy /api/supa (fase 6a, P10). Sin dependencias: se prueban solas.

// Solo las tres superficies que usan el BackOffice y el Portal. Nada de
// functions/, pg/, ni la administración de Auth (los endpoints propios la
// llaman con la llave de servicio, jamás el navegador).
export const PREFIJOS_PERMITIDOS = ["auth/v1/", "rest/v1/", "storage/v1/"];
export const PREFIJOS_VEDADOS = ["auth/v1/admin"];

export function rutaPermitida(ruta) {
  const r = String(ruta ?? "");
  if (!r || r.includes("..") || r.includes("//") || r.startsWith("/")) return false;
  if (PREFIJOS_VEDADOS.some((p) => r === p.replace(/\/$/, "") || r.startsWith(p))) return false;
  return PREFIJOS_PERMITIDOS.some((p) => r.startsWith(p));
}
