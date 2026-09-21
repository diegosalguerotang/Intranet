// Reglas de clave e identidad de cuenta (fase 6c, decisión P11). Sin
// dependencias: las usan el proxy (api/supa.js), api/restablecer-clave.js y
// las pruebas. El cliente (src/lib/campos.js) repite el mismo piso; la prueba
// tests/api/clave.test.js exige que coincidan.
//
// BackOffice: al menos 10 caracteres, con letras y números. La política de
// acceso (ACC-05) solo puede SUBIR ese mínimo. Portal: 6 (celulares de gama
// baja; decisión de Diego del 2026-08-21), lo aplica Auth (password_min_length).
export const CLAVE_MIN_BACKOFFICE = 10;
export const CLAVE_MIN_PORTAL = 6;
export const DOMINIO_PORTAL = "portal.grupoer.pe";

export function validarClaveBackoffice(clave, minimo = CLAVE_MIN_BACKOFFICE) {
  const c = String(clave ?? "");
  const piso = Math.max(CLAVE_MIN_BACKOFFICE, Number(minimo) || 0);
  if (c.length < piso) return `La clave debe tener al menos ${piso} caracteres.`;
  if (!/[0-9]/.test(c)) return "La clave debe incluir al menos un número.";
  if (!/[a-zA-Z]/.test(c)) return "La clave debe incluir al menos una letra.";
  return null;
}

export const esCorreoPortal = (correo) => String(correo ?? "").trim().toLowerCase().endsWith(`@${DOMINIO_PORTAL}`);

// Correo del JWT de la sesión, SIN verificar la firma: sirve para decidir qué
// regla aplicar, nunca para autorizar (Auth verifica el token al recibirlo;
// un token falso no cambia ninguna clave).
export function correoDeSesion(jwt) {
  try {
    const partes = String(jwt ?? "").split(".");
    if (partes.length !== 3) return "";
    const carga = JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8"));
    return String(carga?.email ?? "").trim().toLowerCase();
  } catch {
    return "";
  }
}
