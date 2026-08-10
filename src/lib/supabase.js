import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL ?? "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "__ANON_KEY__";

// Si aún no hay clave configurada, la app funciona con los datos de demostración locales.
export const supabaseListo = anonKey !== "__ANON_KEY__";
export const supabase = supabaseListo ? createClient(url, anonKey) : null;
