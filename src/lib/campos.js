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

// Validación de clave del BackOffice: al menos CLAVE_MIN_BACKOFFICE caracteres
// (fase 6c, decisión P11, 2026-09-21: 10; antes 6), con al menos un número y
// al menos una letra. La política (ACC-05) solo puede subir el mínimo. El
// servidor aplica la misma regla (api/_clave.js) en el proxy y en el
// restablecimiento. Devuelve el mensaje de error o null si es válida.
export const CLAVE_MIN_BACKOFFICE = 10;
export function validarClave(clave, minimo = CLAVE_MIN_BACKOFFICE) {
  const c = String(clave ?? "");
  const piso = Math.max(CLAVE_MIN_BACKOFFICE, Number(minimo) || 0);
  if (c.length < piso) return `La clave debe tener al menos ${piso} caracteres.`;
  if (!/[0-9]/.test(c)) return "La clave debe incluir al menos un número.";
  if (!/[a-zA-Z]/.test(c)) return "La clave debe incluir al menos una letra.";
  return null;
}
