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

// Si aún no hay clave configurada, la app funciona con los datos de demostración locales.
export const supabaseListo = anonKey !== "__ANON_KEY__";
export const supabase = supabaseListo
  ? createClient(url, anonKey, { global: { fetch: obtenerFetchNativo() } })
  : null;
export const supabaseUrl = url;
