// Reproduce el login EXACTAMENTE como la app (supabase-js del proyecto),
// para cazar la cabecera con caracteres no ISO-8859-1.
import { createClient } from "@supabase/supabase-js";

// Igual que src/lib/supabase.js en producción (vía proxy y directo):
for (const url of ["https://intranet-general.vercel.app/supa", "https://mzpbdkrmokfxrrsotfgs.supabase.co"]) {
  const supabase = createClient(url, "sb_publishable_qgPwZ8-4neRlKQXpCe9tnw_Dix4Ddwg", {
    global: {
      fetch: (input, init) => {
        // Inspecciona las cabeceras antes de enviar
        const headers = init?.headers ?? {};
        for (const [k, v] of Object.entries(headers)) {
          const malo = [...String(v)].some((c) => c.codePointAt(0) > 255);
          if (malo) console.log(`  ⚠ CABECERA INVÁLIDA en ${url}: ${k} = ${JSON.stringify(v)}`);
        }
        return fetch(input, init);
      },
    },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: "diegosalguerotang@gmail.com",
    password: "clave-incorrecta-a-proposito",
  });
  console.log(`${url} → ${error ? `${error.name ?? "?"} status=${error.status ?? "?"} msg=${(error.message ?? "").slice(0, 90)}` : "OK " + !!data.session}`);
}
