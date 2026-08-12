import { createClient } from "@supabase/supabase-js";

// En el despliegue, la app habla SOLO con su propio dominio: Vercel reenvía
// /supa/* a Supabase (rewrite en vercel.json). Así el navegador nunca contacta
// a un tercero y los proxys/antivirus corporativos que bloquean *.supabase.co
// no rompen ni el login ni los datos. En desarrollo local se va directo.
const mismoOrigen = typeof window !== "undefined" && window.location.hostname.endsWith("vercel.app");
const url = mismoOrigen
  ? `${window.location.origin}/supa`
  : import.meta.env.VITE_SUPABASE_URL ?? "https://mzpbdkrmokfxrrsotfgs.supabase.co";

// Clave publishable: pública por diseño; el acceso real lo controlan RLS y los triggers.
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "sb_publishable_qgPwZ8-4neRlKQXpCe9tnw_Dix4Ddwg";

// Algunos antivirus y extensiones parchean window.fetch e inyectan cabeceras
// con caracteres no ISO-8859-1 que rompen TODA petición de la app (visto en
// campo: "Failed to read the 'headers' property… non ISO-8859-1 code point").
// Tomamos el fetch nativo de un iframe recién creado, fuera del alcance del
// parche. El iframe queda en el DOM: si se retira, su realm (y su fetch) muere.
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

// Canal alternativo sobre XMLHttpRequest: los interceptores que parchean
// fetch (incluso dentro de iframes) casi nunca tocan XHR. Implementa lo
// mínimo que supabase-js necesita de la interfaz fetch.
export function fetchXhr(input, init = {}) {
  return new Promise((resolve, reject) => {
    let destino = typeof input === "string" ? input : input.url;
    const h = init.headers ?? {};
    const pares = h instanceof Headers ? [...h.entries()] : Array.isArray(h) ? h : Object.entries(h);
    // La clave API viaja TAMBIÉN por URL: Supabase la acepta ahí, y así
    // sobrevive a interceptores que eliminan o corrompen cabeceras.
    const apikey = pares.find(([k]) => k.toLowerCase() === "apikey")?.[1];
    if (apikey && !destino.includes("apikey=")) {
      destino += (destino.includes("?") ? "&" : "?") + "apikey=" + encodeURIComponent(apikey);
    }
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

// Autorreparación: si el canal fetch está roto por un interceptor, se conmuta
// a XHR de forma permanente. OJO: el error puede venir de otro realm (iframe
// o content script), así que se decide por el MENSAJE, nunca por instanceof.
const esFetchRoto = (e) =>
  /ISO-8859-1|Failed to read the 'headers'|Failed to execute 'fetch'|Failed to fetch|NetworkError|Load failed/i
    .test(e?.message ?? "");

let usarXhr = false;
async function fetchRobusto(input, init) {
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
export const supabaseUrl = url;
export const supabaseAnonKey = anonKey;
