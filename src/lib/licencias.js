// ADQ-09 · Licencias Office (2026-09-29): normalizaciones compartidas con los
// CHECK de la base (grupo en mayúsculas, correo en minúsculas) y la sugerencia
// de persona por nombre, con el mismo criterio que la carga inicial: todos los
// tokens del nombre de la fuente aparecen en el nombre del padrón.
export const normalizarGrupo = (t) => String(t ?? "").trim().toUpperCase().replace(/\s+/g, "_");
export const normalizarCorreoLicencia = (t) => String(t ?? "").replace(/\s+/g, "").toLowerCase();
export const correoValido = (c) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c ?? "");

// Quita agudo, grave, circunflejo y diéresis; conserva la virgulilla (Ñ).
export const tokensNombre = (t) =>
  String(t ?? "").normalize("NFD").replace(/[̀-̂̈]/g, "").normalize("NFC").toUpperCase()
    .replace(/[^A-Z0-9Ñ]+/g, " ").trim().split(/\s+/).filter(Boolean);

export function sugerirPersona(nombreFuente, padron, excluirDnis = []) {
  const toks = tokensNombre(nombreFuente);
  if (!toks.length) return null;
  const fuera = new Set(excluirDnis);
  const candidatos = (padron ?? []).filter((p) => {
    if (fuera.has(p.dni)) return false;
    const propios = new Set(tokensNombre(p.nombre));
    return toks.every((k) => propios.has(k));
  });
  return candidatos.length === 1 ? candidatos[0] : null;
}
