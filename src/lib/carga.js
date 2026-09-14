// src/lib/carga.js — Reglas puras de la carga inicial del BackOffice
// (hardening fase 1, 2026-09-14): con Supabase configurado la app arranca
// VACÍA y solo carga tras resolver un usuario activo; el mock existe
// únicamente para desarrollo local sin Supabase. Un fallo de lectura es un
// error visible, nunca datos de demostración.
export const dbVacia = (fuentes) => Object.fromEntries(Object.keys(fuentes).map((k) => [k, []]));

export const dbInicial = (conSupabase, fuentes, local) => (conSupabase ? dbVacia(fuentes) : local);

export const origenDesde = (conSupabase, resultados) => {
  if (!conSupabase) return "local";
  return resultados.every((r) => !r.error) ? "supabase" : "error";
};
