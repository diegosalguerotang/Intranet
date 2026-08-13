// Cuentas del Portal del Trabajador (service key; nunca en el navegador).
// El llamador es un usuario del BackOffice (JWT en x-sesion) con nivel >= 2
// en el módulo personal. La cuenta técnica es {dni}@portal.grupoer.pe y el
// trabajador solo teclea su DNI. Claves provisionales NUMÉRICAS de 8 dígitos
// (el operario las tipea en un celular de gama baja).
const SUPABASE = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const DOMINIO = "portal.grupoer.pe";
const limpiar = (v) => (typeof v === "string" ? v.replace(/^[﻿​\s]+|[﻿​\s]+$/g, "") : v);
const SERVICE = limpiar(process.env.SUPA_SERVICE_KEY) || limpiar(process.env.SUPABASE_SERVICE_ROLE_KEY) || "";

const cabService = {
  apikey: SERVICE,
  authorization: `Bearer ${SERVICE}`,
  "content-type": "application/json",
};

function claveNumerica() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0];
  return String(10000000 + (n % 90000000)); // 8 dígitos, sin cero inicial
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
async function crearCuenta(dni, creadoPor) {
  if (!/^[0-9]{8}$/.test(dni)) return { dni, error: "DNI inválido." };
  const persona = (await rest(`/rest/v1/personas?dni=eq.${dni}&select=dni&limit=1`, { method: "GET" })).json?.[0];
  if (!persona) return { dni, error: "La persona no existe en el maestro." };
  const correo = `${dni}@${DOMINIO}`;
  const clave = claveNumerica();
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
  return { dni, clave };
}

async function restablecerCuenta(dni) {
  const correo = `${dni}@${DOMINIO}`;
  const cuenta = await buscarCuenta(correo);
  if (!cuenta) return { dni, error: "La cuenta del portal no existe: usa Crear cuenta." };
  const clave = claveNumerica();
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
  return { dni, clave };
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

  if (accion === "crear") {
    if (!dni) return res.status(400).json({ error: "Falta el dni." });
    const r = await crearCuenta(String(dni), autor);
    return res.status(r.error ? 400 : 200).json(r);
  }
  if (accion === "restablecer") {
    if (!dni) return res.status(400).json({ error: "Falta el dni." });
    const r = await restablecerCuenta(String(dni));
    return res.status(r.error ? 400 : 200).json(r);
  }
  if (accion === "crear-lote") {
    if (!Array.isArray(dnis) || dnis.length === 0) return res.status(400).json({ error: "Falta la lista de dnis." });
    if (dnis.length > 50) return res.status(400).json({ error: "Máximo 50 por lote." });
    const resultados = [];
    for (const d of dnis) resultados.push(await crearCuenta(String(d), autor));
    return res.status(200).json({ resultados });
  }
  return res.status(400).json({ error: "Acción desconocida." });
}
