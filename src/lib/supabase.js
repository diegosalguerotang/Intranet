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

// Si aún no hay clave configurada, la app funciona con los datos de demostración locales.
export const supabaseListo = anonKey !== "__ANON_KEY__";
export const supabase = supabaseListo ? createClient(url, anonKey) : null;
export const supabaseUrl = url;
