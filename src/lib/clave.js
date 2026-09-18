// Marca en la base que la clave provisional ya fue reemplazada
// (RPC marcar_clave_cambiada, con guarda: solo sobre la propia cuenta).
//
// Por qué existe este helper (bucle de clave provisional, 2026-09-18): el
// resultado de supabase.rpc() es un PostgrestBuilder PEREZOSO —la petición
// solo se dispara al hacerle `then`/`await`— y NO tiene método `catch`. La
// forma anterior, `supabase.rpc(...).catch?.(() => {})`, evaluaba a undefined
// sin ejecutar nada: requiere_cambio_clave nunca se limpiaba y el login volvía
// a pedir el reemplazo con la clave ya cambiada. Aquí la RPC se espera de
// verdad y el error se devuelve para mostrarlo, no para tragarlo.
export async function marcarClaveCambiada(supabase, correo) {
  if (!supabase || !correo) return { error: "Sin sesión o sin correo para registrar el cambio." };
  try {
    const { error } = await supabase.rpc("marcar_clave_cambiada", { p_correo: correo });
    return error ? { error: error.message ?? String(error) } : {};
  } catch (e) {
    return { error: e?.message ?? String(e) };
  }
}
