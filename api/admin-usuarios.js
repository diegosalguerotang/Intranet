// Operaciones de cuentas que exigen la service key (nunca en el navegador):
// crear la cuenta de ingreso de un usuario administrativo y eliminarla junto
// con el usuario. El llamador se identifica con su JWT en x-sesion (mismo
// patrón del proxy api/supa) y su permiso se verifica contra la BD:
//   crear   → nivel >= 2 en el módulo accesos (o superadmin)
//   eliminar→ nivel 3 en accesos o superadmin; nunca a sí mismo
const SUPABASE = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const limpiar = (v) => (typeof v === "string" ? v.replace(/^[﻿​\s]+|[﻿​\s]+$/g, "") : v);
const SERVICE = limpiar(process.env.SUPABASE_SERVICE_ROLE_KEY);

const cabService = {
  apikey: SERVICE,
  authorization: `Bearer ${SERVICE}`,
  "content-type": "application/json",
};

// Clave provisional legible que cumple el mínimo de 12 del BackOffice.
// Sin caracteres ambiguos (0/O, 1/l/I).
function generarClave() {
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  for (const b of bytes) s += abc[b % abc.length];
  return `Grupo-${s.slice(0, 4)}-${s.slice(4)}`; // p. ej. Grupo-K3MR-8XWQ (14)
}

async function rest(ruta, opciones = {}) {
  const r = await fetch(`${SUPABASE}${ruta}`, { ...opciones, headers: { ...cabService, ...opciones.headers } });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* respuesta no JSON */ }
  return { ok: r.ok, status: r.status, json, texto };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!SERVICE) return res.status(500).json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY." });
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido." });

  // 1 · ¿Quién llama? Su JWT debe ser una sesión válida de GoTrue.
  const sesion = req.headers["x-sesion"];
  if (!sesion) return res.status(401).json({ error: "Sesión requerida." });
  const quien = await rest("/auth/v1/user", { headers: { authorization: `Bearer ${sesion}` }, method: "GET" });
  const correoLlamador = quien.json?.email;
  if (!quien.ok || !correoLlamador) return res.status(401).json({ error: "Sesión inválida o vencida." });

  // 2 · ¿Qué puede? Nivel del llamador en el módulo accesos, desde la BD.
  const acceso = await rest(`/rest/v1/v_mi_acceso?correo=eq.${encodeURIComponent(correoLlamador)}&limit=1`, { method: "GET" });
  const yo = acceso.json?.[0];
  if (!yo) return res.status(403).json({ error: "No eres un usuario administrativo activo." });
  const nivelAccesos = yo.esSuperadmin ? 3 : (yo.matriz?.accesos ?? 0);

  const { accion, usuario_id } = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
  if (!usuario_id) return res.status(400).json({ error: "Falta usuario_id." });

  // Usuario objetivo, desde la tabla (con service key).
  const objetivoRes = await rest(`/rest/v1/usuarios_admin?id=eq.${encodeURIComponent(usuario_id)}&select=id,correo,persona_dni&limit=1`, { method: "GET" });
  const objetivo = objetivoRes.json?.[0];
  if (!objetivo) return res.status(404).json({ error: "El usuario no existe." });

  if (accion === "crear") {
    if (nivelAccesos < 2) return res.status(403).json({ error: "Necesitas nivel de acción en el módulo Accesos." });
    if (!objetivo.correo) return res.status(400).json({ error: "El usuario no tiene correo: sin correo no hay cuenta de ingreso." });

    const clave = generarClave();
    const alta = await rest("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: objetivo.correo, password: clave, email_confirm: true }),
    });
    if (!alta.ok) {
      const detalle = alta.json?.msg ?? alta.texto?.slice(0, 120) ?? "";
      const yaExiste = alta.status === 422 || /already/i.test(detalle);
      return res.status(alta.status).json({
        error: yaExiste ? "Esa cuenta de ingreso ya existe." : `No se pudo crear la cuenta: ${detalle}`,
      });
    }
    // Cambio obligatorio al primer ingreso; la clave NO se guarda en texto plano.
    await rest(`/rest/v1/usuarios_admin?id=eq.${encodeURIComponent(usuario_id)}`, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ requiere_cambio_clave: true, clave_provisional: null }),
    });
    return res.status(200).json({ clave });
  }

  if (accion === "eliminar") {
    if (nivelAccesos < 3) return res.status(403).json({ error: "Eliminar exige nivel de aprobación en el módulo Accesos." });
    if (objetivo.correo && objetivo.correo.toLowerCase() === correoLlamador.toLowerCase()) {
      return res.status(403).json({ error: "No puedes eliminarte a ti mismo." });
    }
    // Primero la BD (los invariantes viven ahí: último superadmin, etc.).
    const rpc = await rest("/rest/v1/rpc/eliminar_usuario_admin", {
      method: "POST",
      body: JSON.stringify({ p_id: usuario_id }),
    });
    if (!rpc.ok) {
      return res.status(400).json({ error: rpc.json?.message ?? "La base de datos rechazó la eliminación." });
    }
    // Después la cuenta de ingreso, si existe.
    if (objetivo.correo) {
      const lista = await rest(`/auth/v1/admin/users?per_page=1000`, { method: "GET" });
      const cuenta = (lista.json?.users ?? []).find(
        (u) => (u.email ?? "").toLowerCase() === objetivo.correo.toLowerCase()
      );
      if (cuenta) await rest(`/auth/v1/admin/users/${cuenta.id}`, { method: "DELETE" });
    }
    return res.status(200).json({ eliminado: true });
  }

  return res.status(400).json({ error: "Acción desconocida." });
}
