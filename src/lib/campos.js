// src/lib/campos.js — saneadores de campos numéricos de formularios.
// Regla dura: el límite de largo se aplica DESPUÉS de quitar los no-dígitos.
// maxLength en el HTML corta el texto crudo (espacios y +51 incluidos) y por
// eso un número pegado con formato perdía dígitos (bug RRH-04, 2026-08-17).

export const soloDigitos = (valor, max) =>
  String(valor ?? "").replace(/\D/g, "").slice(0, max);

// Celular peruano: 9 dígitos. Un pegado desde contactos suele traer el +51:
// si sobran dígitos y empiezan por 51, es el prefijo de país y se suelta.
export function normalizarCelular(valor) {
  let d = String(valor ?? "").replace(/\D/g, "");
  if (d.length > 9 && d.startsWith("51")) d = d.slice(2);
  return d.slice(0, 9);
}
