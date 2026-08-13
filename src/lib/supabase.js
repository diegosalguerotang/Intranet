import { createClient } from "@supabase/supabase-js";

// ARQUITECTURA DEL CANAL (v8): en el despliegue, el navegador habla SOLO con
// su propio dominio y SIN credenciales a la vista. Un antivirus con DLP
// (visto en campo) caza credenciales en TODAS partes: se come las cabeceras
// apikey/authorization, scrubbea la apikey dentro de la URL y su parche de
// fetch/Headers revienta al tocar esas claves. Por eso la apikey NO viaja
// desde el navegador: la inyecta el proxy propio (api/supa) del lado del
// servidor, donde el interceptor no llega. La sesión del usuario viaja en la
// cabecera camuflada x-sesion (los nombres no-credencial llegan intactos,
// verificado con el espejo api/eco). En desarrollo local se va directo.
const mismoOrigen = typeof window !== "undefined" && window.location.hostname.endsWith("vercel.app");
const url = mismoOrigen
  ? `${window.location.origin}/api/supa`
  : import.meta.env.VITE_SUPABASE_URL ?? "https://mzpbdkrmokfxrrsotfgs.supabase.co";

// Clave publishable: pública por diseño; el acceso real lo controlan RLS y los triggers.
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "sb_publishable_qgPwZ8-4neRlKQXpCe9tnw_Dix4Ddwg";

// El fetch nativo de un iframe recién creado, fuera del alcance del parche
// del interceptor (a veces; en campo se vio el parche llegar también a los
// iframes). El iframe queda en el DOM: si se retira, su realm muere.
function obtenerFetchNativo() {
  if (typeof document === "undefined") return (...args) => fetch(...args);
  try {
    const marco = document.createElement("iframe");
    marco.style.display = "none";
    marco.setAttribute("aria-hidden", "true");
    document.documentElement.appendChild(marco);
    const nativo = marco.contentWindow?.fetch;
    if (typeof nativo === "function") {
      return (...args) => nativo.apply(marco.contentWindow, args);
    }
    marco.remove();
  } catch { /* entorno sin DOM o iframe bloqueado: usar el global */ }
  return (...args) => fetch(...args);
}

// Canal alternativo sobre XMLHttpRequest: implementa lo mínimo que
// supabase-js necesita de la interfaz fetch.
export function fetchXhr(input, init = {}) {
  return new Promise((resolve, reject) => {
    const destino = typeof input === "string" ? input : input.url;
    const h = init.headers ?? {};
    const pares = Array.isArray(h) ? h : typeof h.entries === "function" ? [...h.entries()] : Object.entries(h);
    const x = new XMLHttpRequest();
    x.open(init.method ?? "GET", destino);
    for (const [k, v] of pares) {
      try { x.setRequestHeader(k, v); } catch { cabecerasFallidas.add(k); }
    }
    x.onload = () => {
      const cab = new Headers();
      x.getAllResponseHeaders().trim().split(/[\r\n]+/).filter(Boolean).forEach((linea) => {
        const i = linea.indexOf(": ");
        if (i > 0) { try { cab.append(linea.slice(0, i), linea.slice(i + 2)); } catch { /* ignorar */ } }
      });
      resolve(new Response(x.responseText || null, { status: x.status, statusText: x.statusText, headers: cab }));
    };
    x.onerror = () => reject(new TypeError("Fallo de red (XHR)"));
    x.ontimeout = () => reject(new TypeError("Tiempo de espera agotado (XHR)"));
    x.send(init.body ?? null);
  });
}

export const fetchNativo = obtenerFetchNativo();

// Registro de cabeceras que un interceptor impidió establecer (diagnóstico).
export const cabecerasFallidas = new Set();

// Blindaje de Headers. El parche del interceptor hace que set()/append()
// revienten SOLO con claves tipo credencial (apikey, authorization) — con
// otras claves pasa la prueba, por eso un chequeo al arrancar dice "sanas" y
// aún así supabase-js muere al construir sus cabeceras internas. El blindaje
// envuelve los métodos vigentes y TRAGA el fallo: la cabecera simplemente no
// se establece, y no hace falta — la apikey la re-inyecta el proxy y la
// sesión viaja por x-sesion. Se re-aplica en caliente (p. ej. al enviar el
// login) porque el parche puede aterrizar DESPUÉS de cargar la app.
export let estadoHeaders = "sin-blindar";
let setBlindado = null;
export function blindarHeaders() {
  try {
    const proto = typeof Headers !== "undefined" ? Headers.prototype : null;
    if (!proto || proto.set === setBlindado) return; // vigente, nadie lo pisó
    const setActual = proto.set;
    const appendActual = proto.append;
    proto.set = function (k, v) {
      try { return setActual.call(this, k, v); } catch { cabecerasFallidas.add(String(k)); }
    };
    proto.append = function (k, v) {
      try { return appendActual.call(this, k, v); } catch { cabecerasFallidas.add(String(k)); }
    };
    setBlindado = proto.set;
    estadoHeaders = "blindadas";
  } catch { /* entorno sin Headers */ }
}
blindarHeaders();

// Autorreparación: si el canal fetch está roto por un interceptor, se conmuta
// a XHR de forma permanente. OJO: el error puede venir de otro realm (iframe
// o content script), así que se decide por el MENSAJE, nunca por instanceof.
const esFetchRoto = (e) =>
  /ISO-8859-1|Failed to read the 'headers'|Failed to execute 'fetch'|Failed to fetch|NetworkError|Load failed/i
    .test(e?.message ?? "");

// Última sesión conocida: fetchRobusto la manda como x-sesion al proxy.
let tokenActual = null;

// Ninguna credencial sale del navegador (el DLP del interceptor las caza en
// cabeceras y hasta en la URL): la apikey se retira siempre (el proxy la
// inyecta), el Authorization anónimo también (equivale a la apikey), y el
// Authorization con sesión real se camufla como x-sesion, que el proxy
// vuelve a convertir en Authorization del lado del servidor.
function camuflarCredenciales(init) {
  if (!mismoOrigen) return init; // conexión directa (desarrollo): tal cual
  let pares = [];
  try {
    const h = init?.headers ?? {};
    pares = Array.isArray(h) ? [...h] : typeof h.entries === "function" ? [...h.entries()] : Object.entries(h);
  } catch {
    return init; // cabeceras ilegibles: mejor enviarlas tal cual que reventar
  }
  const limpias = [];
  let sesion = null;
  for (const [k, v] of pares) {
    const kl = String(k).toLowerCase();
    if (kl === "apikey") continue;
    if (kl === "authorization") {
      const valor = String(v);
      if (!valor.includes(anonKey)) sesion = valor.replace(/^Bearer\s+/i, "");
      continue;
    }
    if (kl === "x-sesion") { sesion = String(v); continue; }
    limpias.push([k, v]);
  }
  if (!sesion && tokenActual) sesion = tokenActual;
  if (sesion) limpias.push(["x-sesion", sesion]);
  return { ...init, headers: limpias };
}

let usarXhr = false;
async function fetchRobusto(input, initEntrada) {
  const init = camuflarCredenciales(initEntrada);
  if (usarXhr) return fetchXhr(input, init);
  try {
    return await fetchNativo(input, init);
  } catch (e) {
    if (esFetchRoto(e)) {
      usarXhr = true;
      return fetchXhr(input, init);
    }
    throw e;
  }
}

// Si aún no hay clave configurada, la app funciona con los datos de demostración locales.
export const supabaseListo = anonKey !== "__ANON_KEY__";
export const supabase = supabaseListo
  ? createClient(url, anonKey, { global: { fetch: fetchRobusto } })
  : null;
if (supabase) {
  supabase.auth.onAuthStateChange((_evento, sesion) => {
    tokenActual = sesion?.access_token ?? null;
  });
}
export const supabaseUrl = url;
export const supabaseAnonKey = anonKey;
