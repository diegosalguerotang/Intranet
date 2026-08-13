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
let marcoWin = null; // realm del iframe, fuente de clases nativas sin parchear
function obtenerFetchNativo() {
  if (typeof document === "undefined") return (...args) => fetch(...args);
  try {
    const marco = document.createElement("iframe");
    marco.style.display = "none";
    marco.setAttribute("aria-hidden", "true");
    document.documentElement.appendChild(marco);
    const nativo = marco.contentWindow?.fetch;
    if (typeof nativo === "function") {
      marcoWin = marco.contentWindow;
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
      if (k.toLowerCase() === "apikey") continue; // ya viaja por URL; la cabecera solo da al interceptor algo que corromper
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

// Reparación del realm principal. Visto en campo: el interceptor parchea la
// clase Headers y su set() revienta con "String contains non ISO-8859-1", lo
// que mata TODA petición REST de supabase-js ANTES de llegar a nuestro fetch
// (supabase-js construye `new Headers()` internamente). Los métodos WebIDL
// funcionan entre realms, así que se restauran desde el iframe limpio.
export let estadoHeaders = "sanas";
(function repararHeaders() {
  const rotas = (() => {
    try { new Headers().set("x-prueba", "ok"); return false; } catch { return true; }
  })();
  if (!rotas) return;
  estadoHeaders = "rotas-sin-reparar";
  if (!marcoWin?.Headers) return;
  try {
    new marcoWin.Headers().set("x-prueba", "ok"); // ¿el iframe también está parcheado?
    const limpio = marcoWin.Headers.prototype;
    for (const m of ["set", "append", "delete", "get", "has", "forEach", "entries", "keys", "values"]) {
      if (typeof limpio[m] === "function") { try { Headers.prototype[m] = limpio[m]; } catch { /* seguir */ } }
    }
    window.Headers = marcoWin.Headers;
    new Headers().set("x-prueba", "ok"); // verificación final
    estadoHeaders = "reparadas";
  } catch { /* iframe también comprometido: queda rotas-sin-reparar */ }
})();

// Autorreparación: si el canal fetch está roto por un interceptor, se conmuta
// a XHR de forma permanente. OJO: el error puede venir de otro realm (iframe
// o content script), así que se decide por el MENSAJE, nunca por instanceof.
const esFetchRoto = (e) =>
  /ISO-8859-1|Failed to read the 'headers'|Failed to execute 'fetch'|Failed to fetch|NetworkError|Load failed/i
    .test(e?.message ?? "");

// La clave API viaja SIEMPRE también por URL, en todos los canales: hay
// interceptores (antivirus) que dejan pasar la petición pero eliminan sus
// cabeceras, y el gateway responde 401 "falta apikey" — que aguas arriba se
// confunde con credenciales incorrectas. El gateway acepta la clave como
// parámetro (verificado con curl contra /auth y /rest vía el proxy).
function conApikeyEnUrl(input) {
  const destino = typeof input === "string" ? input : input.url;
  if (!destino || destino.includes("apikey=")) return input;
  return destino + (destino.includes("?") ? "&" : "?") + "apikey=" + encodeURIComponent(anonKey);
}

// Las cabeceras que el interceptor corrompe en tránsito NO deben viajar:
// visto en campo un 401 Invalid API key con la clave correcta, porque el
// gateway prefiere la cabecera (corrupta) sobre el parámetro de URL. La
// apikey se retira siempre (ya va por URL) y el Authorization anónimo
// también: para el gateway equivale a la apikey (verificado con curl:
// /auth y /rest responden bien sin ninguna cabecera de credencial).
function sinCabecerasFragiles(init) {
  if (!init?.headers) return init;
  try {
    const h = init.headers;
    const pares =
      Array.isArray(h) ? h : typeof h.entries === "function" ? [...h.entries()] : Object.entries(h);
    const limpias = pares.filter(([k, v]) => {
      const kl = String(k).toLowerCase();
      if (kl === "apikey") return false;
      if (kl === "authorization" && String(v).includes(anonKey)) return false;
      return true;
    });
    return { ...init, headers: limpias };
  } catch {
    return init; // cabeceras ilegibles: mejor enviarlas tal cual que reventar
  }
}

let usarXhr = false;
async function fetchRobusto(entrada, initEntrada) {
  const input = conApikeyEnUrl(entrada);
  const init = sinCabecerasFragiles(initEntrada);
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
