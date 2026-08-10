import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL ?? "https://mzpbdkrmokfxrrsotfgs.supabase.co";
// Clave publishable: pública por diseño; el acceso real lo controlan RLS y los triggers.
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "sb_publishable_qgPwZ8-4neRlKQXpCe9tnw_Dix4Ddwg";

// Si aún no hay clave configurada, la app funciona con los datos de demostración locales.
export const supabaseListo = anonKey !== "__ANON_KEY__";
export const supabase = supabaseListo ? createClient(url, anonKey) : null;
