// src/lib/seleccionPortal.js — Selección de trabajadores en Planilla para crear
// cuentas del portal en bloque (2026-09-30). Seleccionable = vigente, sin
// cuenta y de la razón social activa; lo demás no lleva casilla.
export const esSeleccionable = (p, empresaId) =>
  p.empresa === empresaId && p.estado === "vigente" && !p.tieneCuenta;

// Nuevo Set: añade (marcar=true) o quita los seleccionables de las filas visibles.
export const alternarVisibles = (seleccion, filas, empresaId, marcar) => {
  const nuevo = new Set(seleccion);
  for (const p of filas) {
    if (!esSeleccionable(p, empresaId)) continue;
    if (marcar) nuevo.add(p.dni); else nuevo.delete(p.dni);
  }
  return nuevo;
};

// DNI marcados que siguen siendo seleccionables, en el orden del maestro.
export const depurar = (seleccion, personal, empresaId) =>
  personal.filter((p) => seleccion.has(p.dni) && esSeleccionable(p, empresaId)).map((p) => p.dni);
