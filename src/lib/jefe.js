// Jefe inmediato de una solicitud (2026-10-01). El formulario lo elige de la
// lista de usuarios administrativos (jefes_disponibles: código, nunca
// documento) o escribe un nombre a mano; el servidor resuelve la persona.
//   · elegido de la lista → supervisor_usuario (puede dar su V°B° desde su buzón)
//   · escrito a mano      → supervisor_nombre  (el V°B° lo da la jefatura)
//   · vacío               → nada (el servidor propone el supervisor de la sede)
export const OTRO_JEFE = "__otro";
export const JEFE_VACIO = { usuario: "", nombre: "" };

export function datosConJefe(datos, jefe) {
  const usuario = String(jefe?.usuario ?? "").trim();
  const nombre = String(jefe?.nombre ?? "").trim();
  if (usuario && usuario !== OTRO_JEFE) return { ...datos, supervisor_usuario: usuario };
  if (nombre) return { ...datos, supervisor_nombre: nombre };
  return datos;
}

// Opciones del selector: sin el propio usuario cuando la solicitud es suya.
export const jefesElegibles = (lista, excluirPropio) =>
  (lista ?? []).filter((j) => j?.codigo && !(excluirPropio && j.soy_yo));
