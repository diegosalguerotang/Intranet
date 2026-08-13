// Proxy blindado hacia Supabase. El navegador de algunos usuarios tiene un
// interceptor (antivirus con DLP) que caza credenciales en cabeceras y hasta
// dentro de la URL, así que desde el cliente NO viaja ninguna: aquí, del lado
// del servidor —donde el interceptor no llega—, se inyecta la apikey y se
// convierte la cabecera camuflada x-sesion en el Authorization real.
// La apikey es la publishable (pública por diseño); el acceso real lo
// controlan RLS y los triggers, igual que con el rewrite /supa anterior.
const SUPABASE = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const APIKEY = process.env.VITE_SUPABASE_ANON_KEY ?? "sb_publishable_qgPwZ8-4neRlKQXpCe9tnw_Dix4Ddwg";

// Solo cabeceras operativas: cualquier credencial que llegue del cliente se
// descarta (puede venir corrupta por el interceptor) y se regenera aquí.
const ENTRAN = ["content-type", "accept", "prefer", "accept-profile", "content-profile", "range", "range-unit", "x-client-info"];
const SALEN = ["content-type", "content-range", "content-profile", "preference-applied", "x-total-count", "www-authenticate"];

export default async function handler(req, res) {
  const ruta = (req.query.ruta ? [].concat(req.query.ruta) : []).join("/");
  const destino = new URL(`${SUPABASE}/${ruta}`);
  for (const [k, v] of Object.entries(req.query)) {
    if (k === "ruta" || k.toLowerCase() === "apikey") continue;
    for (const valor of [].concat(v)) destino.searchParams.append(k, valor);
  }

  const cabeceras = { apikey: APIKEY };
  for (const nombre of ENTRAN) {
    if (req.headers[nombre]) cabeceras[nombre] = req.headers[nombre];
  }
  const sesion = req.headers["x-sesion"];
  if (sesion) cabeceras.authorization = `Bearer ${sesion}`;

  let cuerpo;
  if (req.method !== "GET" && req.method !== "HEAD") {
    cuerpo = typeof req.body === "string" ? req.body : req.body != null ? JSON.stringify(req.body) : undefined;
  }

  const respuesta = await fetch(destino, { method: req.method, headers: cabeceras, body: cuerpo });
  const texto = await respuesta.text();
  res.status(respuesta.status);
  for (const nombre of SALEN) {
    const valor = respuesta.headers.get(nombre);
    if (valor) res.setHeader(nombre, valor);
  }
  res.setHeader("Cache-Control", "no-store");
  res.send(texto);
}
