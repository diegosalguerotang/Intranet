// Descarga de PDFs de endpoints propios (/api/*) con la sesión en x-sesion.
// El nombre del archivo lo decide el servidor (Content-Disposition); si no
// llega, se usa el fallback. Enlace en DOM + revoke diferido (Safari/iOS).
import { supabase } from "./supabase.js";

export async function descargarPdfSesion(ruta, nombreFallback = "documento.pdf") {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) return { error: "Sin sesión activa." };
  const r = await fetch(ruta, { headers: { "x-sesion": token } });
  if (!r.ok) {
    const json = await r.json().catch(() => ({}));
    return { error: json.error ?? `Error ${r.status}` };
  }
  const disp = r.headers.get("content-disposition") ?? "";
  const m = /filename\*=UTF-8''([^;]+)/.exec(disp);
  const nombre = m ? decodeURIComponent(m[1]) : nombreFallback;
  const url = URL.createObjectURL(await r.blob());
  const el = Object.assign(document.createElement("a"), { href: url, download: nombre });
  document.body.appendChild(el);
  el.click();
  el.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return { ok: true };
}
