// Cuentas del Portal del Trabajador (service key; nunca en el navegador).
// El llamador es un usuario del BackOffice (JWT en x-sesion) con nivel >= 2
// en el módulo personal. La cuenta técnica es {dni}@portal.grupoer.pe y el
// trabajador solo teclea su DNI. La clave inicial es ALEATORIA de 6 dígitos
// (decisión de Diego 2026-08-21, #13: la fija 111111 del 2026-08-17 se retiró
// porque ya hay canales para repartirla — correo, o CSV/pantalla para entrega
// en mano); este endpoint es el ÚNICO que la conoce y, si se pide, él mismo
// envía el correo de acceso. El primer ingreso del portal OBLIGA a crear una
// clave propia y declarar el celular antes de poder usar nada.
import { randomInt } from "node:crypto";
import { enviar, plantilla } from "./_correo.js";

const SUPABASE = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const APP = "https://intranet-general.vercel.app";
const DOMINIO = "portal.grupoer.pe";
const limpiar = (v) => (typeof v === "string" ? v.replace(/^[﻿​\s]+|[﻿​\s]+$/g, "") : v);
const SERVICE = limpiar(process.env.SUPA_SERVICE_KEY) || limpiar(process.env.SUPABASE_SERVICE_ROLE_KEY) || "";

const cabService = {
  apikey: SERVICE,
  authorization: `Bearer ${SERVICE}`,
  "content-type": "application/json",
};

const claveAleatoria = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

// Correo de acceso: solo lo manda este endpoint (nadie más conoce la clave).
async function correoAcceso(persona, dni, clave) {
  const r = await enviar(persona.correo, "Tu acceso al Portal del Trabajador — GrupoER", plantilla(
    "Tu acceso al Portal del Trabajador",
    `<p>Hola ${persona.nombre.split(" ")[0]}: ya puedes entrar al portal.</p>
     <p><b>Dirección:</b> <a href="${APP}/portal">${APP}/portal</a><br/>
        <b>Usuario:</b> tu número de documento (${dni})<br/>
        <b>Clave inicial:</b> ${clave}</p>
     <p>En tu primer ingreso el portal te pedirá crear tu clave personal.</p>`));
  return r.error ? { errorCorreo: r.error } : { enviado: persona.correo };
}

async function rest(ruta, opciones = {}) {
  const r = await fetch(`${SUPABASE}${ruta}`, { ...opciones, headers: { ...cabService, ...opciones.headers } });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* no JSON */ }
  return { ok: r.ok, status: r.status, json, texto };
}

async function buscarCuenta(correo) {
  const lista = await rest(`/auth/v1/admin/users?per_page=1000`, { method: "GET" });
  return (lista.json?.users ?? []).find((u) => (u.email ?? "").toLowerCase() === correo.toLowerCase());
}

// crear: cuenta GoTrue + fila en cuentas_portal (primer ingreso pendiente).
// El número puede ser DNI, CE o pasaporte (alfanumérico): la verdad es el
// maestro, no un regex; el correo técnico va SIEMPRE en minúsculas.
async function crearCuenta(dni, creadoPor, conCorreo = false) {
  if (!/^[0-9A-Za-z-]{4,20}$/.test(dni)) return { dni, error: "Número de documento inválido." };
  const persona = (await rest(
    `/rest/v1/personas?dni=eq.${encodeURIComponent(dni.toUpperCase())}&select=dni,nombre,correo&limit=1`, { method: "GET" }
  )).json?.[0];
  if (!persona) return { dni, error: "La persona no existe en el maestro." };
  dni = persona.dni; // forma canónica (mayúsculas)
  const correo = `${dni.toLowerCase()}@${DOMINIO}`;
  const clave = claveAleatoria();
  const alta = await rest("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email: correo, password: clave, email_confirm: true }),
  });
  if (!alta.ok) {
    const detalle = alta.json?.msg ?? "";
    const yaExiste = alta.status === 422 || /already/i.test(detalle);
    return { dni, error: yaExiste ? "La cuenta ya existe: usa Restablecer clave." : `No se pudo crear: ${detalle}` };
  }
  await rest("/rest/v1/cuentas_portal", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ dni, primer_ingreso_pendiente: true, creado_por: creadoPor }),
  });
  // El envío de correo jamás deshace la cuenta: si falla, viaja errorCorreo.
  const aviso = conCorreo && persona.correo ? await correoAcceso(persona, dni, clave) : {};
  return { dni, nombre: persona.nombre, clave, ...aviso };
}

async function restablecerCuenta(dni, conCorreo = false) {
  dni = dni.toUpperCase();
  const correo = `${dni.toLowerCase()}@${DOMINIO}`;
  const cuenta = await buscarCuenta(correo);
  if (!cuenta) return { dni, error: "La cuenta del portal no existe: usa Crear cuenta." };
  const persona = (await rest(
    `/rest/v1/personas?dni=eq.${encodeURIComponent(dni)}&select=dni,nombre,correo&limit=1`, { method: "GET" }
  )).json?.[0];
  const clave = claveAleatoria();
  const cambio = await rest(`/auth/v1/admin/users/${cuenta.id}`, {
    method: "PUT",
    body: JSON.stringify({ password: clave }),
  });
  if (!cambio.ok) return { dni, error: "No se pudo restablecer la clave." };
  await rest(`/rest/v1/cuentas_portal?dni=eq.${dni}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ primer_ingreso_pendiente: true }),
  });
  const aviso = conCorreo && persona?.correo ? await correoAcceso(persona, dni, clave) : {};
  return { dni, nombre: persona?.nombre, clave, ...aviso };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!SERVICE) return res.status(500).json({ error: "Falta la clave de servicio." });
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido." });

  const sesion = req.headers["x-sesion"];
  if (!sesion) return res.status(401).json({ error: "Sesión requerida." });
  const quien = await rest("/auth/v1/user", { headers: { authorization: `Bearer ${sesion}` }, method: "GET" });
  const correoLlamador = quien.json?.email;
  if (!quien.ok || !correoLlamador) return res.status(401).json({ error: "Sesión inválida o vencida." });
  if (correoLlamador.toLowerCase().endsWith(`@${DOMINIO}`)) {
    return res.status(403).json({ error: "Los trabajadores no administran cuentas." });
  }
  const acceso = await rest(`/rest/v1/v_mi_acceso?correo=eq.${encodeURIComponent(correoLlamador)}&limit=1`, { method: "GET" });
  const yo = acceso.json?.[0];
  const nivelPersonal = yo?.esSuperadmin ? 3 : (yo?.matriz?.personal ?? 0);
  if (!yo || nivelPersonal < 2) {
    return res.status(403).json({ error: "Necesitas nivel de acción en el módulo Personal." });
  }

  const cuerpo = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
  const { accion, dni, dnis } = cuerpo;
  const autor = correoLlamador;

  const conCorreo = Boolean(cuerpo.enviarCorreo);

  if (accion === "crear") {
    if (!dni) return res.status(400).json({ error: "Falta el dni." });
    const r = await crearCuenta(String(dni), autor, conCorreo);
    return res.status(r.error ? 400 : 200).json(r);
  }
  if (accion === "restablecer") {
    if (!dni) return res.status(400).json({ error: "Falta el dni." });
    const r = await restablecerCuenta(String(dni), conCorreo);
    return res.status(r.error ? 400 : 200).json(r);
  }
  if (accion === "crear-lote") {
    if (!Array.isArray(dnis) || dnis.length === 0) return res.status(400).json({ error: "Falta la lista de dnis." });
    // Tope corto porque cada envío SMTP suma segundos: el cliente troza en 10.
    if (dnis.length > 10) return res.status(400).json({ error: "Máximo 10 por lote (el cliente envía por partes)." });
    const resultados = [];
    for (const d of dnis) resultados.push(await crearCuenta(String(d), autor, conCorreo));
    return res.status(200).json({ resultados });
  }
  return res.status(400).json({ error: "Acción desconocida." });
}
