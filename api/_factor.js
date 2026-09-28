// Compuerta del segundo factor (2026-09-28) para los endpoints que autorizan
// con la llave de servicio a partir de un JWT en x-sesion: un superadmin que
// aún no verificó el código vale nivel 0 en la base, y aquí también.
// Se consulta mi_segundo_factor() CON EL JWT DEL USUARIO (rol authenticated),
// nunca con la llave de servicio (sin correo en el JWT la guarda no aplica).
// Fallo cerrado: si la base no responde, se bloquea. Única excepción: la
// función no existe (PGRST202, migración sin aplicar) → no hay factor que exigir.
const SUPABASE = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const limpiar = (v) => (typeof v === "string" ? v.replace(/^[﻿​\s]+|[﻿​\s]+$/g, "") : v);
const APIKEY = limpiar(process.env.VITE_SUPABASE_ANON_KEY) || limpiar(process.env.SUPA_SERVICE_KEY) || limpiar(process.env.SUPABASE_SERVICE_ROLE_KEY) || "";

export const MSJ_FACTOR = "Verifica el código de ingreso antes de operar.";

export async function factorPendiente(jwt) {
  try {
    const r = await fetch(`${SUPABASE}/rest/v1/rpc/mi_segundo_factor`, {
      method: "POST",
      headers: { apikey: APIKEY, authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      body: "{}",
    });
    const texto = await r.text();
    let json = null; try { json = texto ? JSON.parse(texto) : null; } catch { /* sin JSON */ }
    if (r.status === 404 && json?.code === "PGRST202") return false;
    if (!r.ok) return true;
    return Boolean(json?.exigido) && !json?.verificado;
  } catch {
    return true;
  }
}
