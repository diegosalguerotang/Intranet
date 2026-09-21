// Cliente mínimo de Supabase para el portal (~2KB): solo lo que el portal
// usa — login por clave, refresh, cambio de clave, vistas y RPCs. En
// producción habla SOLO con su propio dominio: el proxy /api/supa (de la app
// principal, compartido por el microfrontend) inyecta la apikey del lado del
// servidor y convierte x-sesion en Authorization. El navegador jamás envía
// credenciales de API.
//
// Fase 6a (P10, 2026-09-21): la elección es por CONFIGURACIÓN con fallo
// cerrado (misma regla que src/lib/canal.js del BackOffice): todo paquete de
// producción usa el proxy; el canal directo existe solo en desarrollo (vite
// dev no tiene proxy) y ahí VITE_CANAL_DIRECTO=0 fuerza el proxy. Antes se
// decidía por el hostname (*.vercel.app).
const mismoOrigen = !(import.meta.env.DEV && String(import.meta.env.VITE_CANAL_DIRECTO ?? "").trim() !== "0");
const BASE = mismoOrigen
  ? `${typeof window !== "undefined" ? window.location.origin : ""}/api/supa`
  : "https://mzpbdkrmokfxrrsotfgs.supabase.co";
// Solo para desarrollo local (el proxy no existe): clave publishable, pública
// por diseño. La rama se elimina del paquete de producción al compilar.
const APIKEY_DEV = import.meta.env.DEV ? "sb_publishable_qgPwZ8-4neRlKQXpCe9tnw_Dix4Ddwg" : "";

export const DOMINIO_PORTAL = "portal.grupoer.pe";
// El correo técnico va SIEMPRE en minúsculas (CE/pasaporte traen letras).
export const correoDe = (dni) => `${String(dni).toLowerCase()}@${DOMINIO_PORTAL}`;

const CLAVE_SESION = "portal-sesion";
let sesion = null;
try { sesion = JSON.parse(localStorage.getItem(CLAVE_SESION) ?? "null"); } catch { /* sin sesión */ }

function guardarSesion(s) {
  sesion = s;
  if (s) localStorage.setItem(CLAVE_SESION, JSON.stringify(s));
  else localStorage.removeItem(CLAVE_SESION);
}

function cabeceras(conSesion) {
  const h = { "content-type": "application/json" };
  if (!mismoOrigen) { h.apikey = APIKEY_DEV; }
  if (conSesion && sesion?.access_token) {
    if (mismoOrigen) h["x-sesion"] = sesion.access_token;
    else h.authorization = `Bearer ${sesion.access_token}`;
  }
  return h;
}

async function refrescar() {
  if (!sesion?.refresh_token) return false;
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST", headers: cabeceras(false),
    body: JSON.stringify({ refresh_token: sesion.refresh_token }),
  });
  if (!r.ok) { guardarSesion(null); return false; }
  guardarSesion(await r.json());
  return true;
}

async function pedir(ruta, { metodo = "GET", cuerpo, conSesion = true, reintento = true } = {}) {
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: cabeceras(conSesion),
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  if (r.status === 401 && conSesion && reintento && (await refrescar())) {
    return pedir(ruta, { metodo, cuerpo, conSesion, reintento: false });
  }
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* sin JSON */ }
  if (!r.ok) {
    const mensaje = json?.message ?? json?.msg ?? json?.error_description ?? `Error ${r.status}`;
    return { error: { status: r.status, message: mensaje } };
  }
  return { data: json };
}

// Token actual para los endpoints propios (/api/*) que van FUERA de /api/supa.
export const tokenSesion = () => sesion?.access_token ?? null;

export const auth = {
  haySesion: () => !!sesion?.access_token,
  async entrar(dni, clave) {
    const r = await pedir("/auth/v1/token?grant_type=password", {
      metodo: "POST", conSesion: false,
      cuerpo: { email: correoDe(dni), password: clave },
    });
    if (r.error) return r;
    guardarSesion(r.data);
    return { data: true };
  },
  async cambiarClave(nueva) {
    return pedir("/auth/v1/user", { metodo: "PUT", cuerpo: { password: nueva } });
  },
  async salir() {
    if (sesion?.access_token) await pedir("/auth/v1/logout", { metodo: "POST" }).catch(() => {});
    guardarSesion(null);
  },
};

// URL firmada para ver/descargar un documento (el bucket es privado; Ley
// 29733). El endpoint vive FUERA de /api/supa — solo existe en el portal
// desplegado, no en dev local. Mismo reintento ante 401 que `pedir`.
export async function urlDocumento(id, reintento = true) {
  if (!mismoOrigen) return { error: "La vista previa del PDF solo está disponible en el portal desplegado." };
  const r = await fetch(`${window.location.origin}/api/descargar-documento?id=${encodeURIComponent(id)}`, {
    headers: sesion?.access_token ? { "x-sesion": sesion.access_token } : {},
  });
  if (r.status === 401 && reintento && (await refrescar())) return urlDocumento(id, false);
  const json = await r.json().catch(() => null);
  if (!r.ok) return { error: json?.error ?? `Error ${r.status}` };
  return { url: json.url };
}

// Lectura de vistas: vista("v_portal_boletas", "select=*") → { data: [...] }
export const vista = (nombre, filtro = "select=*") =>
  pedir(`/rest/v1/${nombre}?${filtro}`);

export const rpc = (nombre, args = {}, opciones = {}) =>
  pedir(`/rest/v1/rpc/${nombre}`, { metodo: "POST", cuerpo: args, ...opciones });
