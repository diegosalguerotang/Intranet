// src/lib/correoFallos.js — Textos del aviso de correos fallidos que ven los
// superadministradores (2026-09-30). Las acciones son las de correo_envios.
const ETIQUETAS = {
  "segundo-factor": "Código de ingreso",
  "acceso-portal": "Acceso al portal",
  "acceso-admin": "Acceso al BackOffice",
  verificacion: "Verificación de correo",
  recuperacion: "Recuperación de clave (portal)",
  "recuperacion-admin": "Recuperación de clave (BackOffice)",
  "aviso-ticket": "Aviso de ticket",
  "aviso-solicitud": "Aviso de solicitud",
  "recordatorio-acuse": "Recordatorio de acuse",
};
export const etiquetaAccion = (accion) => ETIQUETAS[accion] ?? accion;

// La función de la base devuelve como máximo 100 filas (TOPE): con 100 el
// total real puede ser mayor y se dice «100 o más».
export const TOPE = 100;
export const resumenFallos = (filas) => {
  const n = filas?.length ?? 0;
  if (!n) return null;
  if (n >= TOPE) return `${TOPE} o más correos no se pudieron enviar en las últimas 24 horas`;
  return n === 1
    ? "1 correo no se pudo enviar en las últimas 24 horas"
    : `${n} correos no se pudieron enviar en las últimas 24 horas`;
};

const dd = (x) => String(x).padStart(2, "0");
export const formatearHora = (iso) => {
  const f = new Date(iso);
  return `${dd(f.getDate())}/${dd(f.getMonth() + 1)} ${dd(f.getHours())}:${dd(f.getMinutes())}`;
};
