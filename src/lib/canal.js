// Canal hacia Supabase (corrección de seguridad · fase 6a, decisión P10).
//
// La elección se toma por CONFIGURACIÓN, con fallo cerrado: en cualquier
// paquete de producción el navegador habla SOLO con su propio dominio (el
// proxy /api/supa inyecta la apikey del lado del servidor y convierte
// x-sesion en Authorization). El canal directo a *.supabase.co existe
// únicamente en desarrollo (vite dev no tiene proxy) y ahí se puede forzar el
// proxy con VITE_CANAL_DIRECTO=0 (por ejemplo bajo `vercel dev`).
// Antes (v8) se decidía por el hostname (`*.vercel.app`): un dominio propio
// habría mandado al navegador directo a Supabase con la clave a la vista.
export function decidirCanal({ dev, directo } = {}) {
  if (dev !== true) return "proxy";
  return String(directo ?? "").trim() === "0" ? "proxy" : "directo";
}

const limpiar = (v) => (typeof v === "string" ? v.replace(/^[﻿​\s]+|[﻿​\s]+$/g, "") : "");

export function urlCanal(canal, { origin, urlDirecta } = {}) {
  if (canal === "proxy") return `${limpiar(origin) || ""}/api/supa`;
  return limpiar(urlDirecta);
}
