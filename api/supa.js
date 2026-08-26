// Proxy blindado hacia Supabase: el cliente no envía credenciales — aquí se
// inyecta la apikey y la cabecera x-sesion se convierte en el Authorization
// real. Mantiene el mismo-origen (hay redes que bloquean *.supabase.co) y
// tolera proxys corporativos que alteren cabeceras. La apikey es la
// publishable (pública por diseño); el acceso real lo controlan RLS y los
// triggers, igual que con el rewrite /supa anterior.
const SUPABASE = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
// La env var en Vercel llegó a guardarse con un BOM invisible que hacía
// reventar fetch al ponerla como cabecera: sanear siempre lo que venga de env.
const limpiar = (v) => (typeof v === "string" ? v.replace(/^[\uFEFF\u200B\s]+|[\uFEFF\u200B\s]+$/g, "") : v);
const APIKEY = limpiar(process.env.VITE_SUPABASE_ANON_KEY) || "sb_publishable_qgPwZ8-4neRlKQXpCe9tnw_Dix4Ddwg";

// Solo cabeceras operativas: cualquier credencial que llegue del cliente se
// descarta (puede venir corrupta por el interceptor) y se regenera aquí.
const ENTRAN = ["content-type", "accept", "prefer", "accept-profile", "content-profile", "range", "range-unit", "x-client-info", "x-upsert"];
const SALEN = ["content-type", "content-range", "content-profile", "preference-applied", "x-total-count", "www-authenticate"];

// bodyParser apagado: los PDFs de boletas (Task 14) suben binario y el
// bodyParser JSON + res.send(texto) de antes los corrompía. El passthrough
// crudo (Buffer tal cual, sin parsear) sirve igual para JSON: PostgREST
// recibe los mismos bytes que envió el cliente.
export const config = { api: { bodyParser: false } };

async function leerCuerpo(req) {
  const trozos = [];
  for await (const t of req) trozos.push(t);
  return trozos.length ? Buffer.concat(trozos) : undefined;
}

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

  // Evidencia probatoria (2026-08-26): IP y user-agent REALES del cliente,
  // generados aquí (nunca aceptados del cliente — ENTRAN no los incluye, así
  // que cualquier x-ip-real/x-agente entrante ya fue descartado). Los RPCs de
  // acuse los leen de request.headers y los guardan en el registro inmutable.
  const reenviada = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  const ip = reenviada || req.socket?.remoteAddress || "";
  if (ip) cabeceras["x-ip-real"] = ip.slice(0, 64);
  const agente = String(req.headers["user-agent"] ?? "").trim();
  if (agente) cabeceras["x-agente"] = agente.slice(0, 200);

  const cuerpo = (req.method !== "GET" && req.method !== "HEAD") ? await leerCuerpo(req) : undefined;

  const respuesta = await fetch(destino, { method: req.method, headers: cabeceras, body: cuerpo });
  const buf = Buffer.from(await respuesta.arrayBuffer());
  res.status(respuesta.status);
  for (const nombre of SALEN) {
    const valor = respuesta.headers.get(nombre);
    if (valor) res.setHeader(nombre, valor);
  }
  res.setHeader("Cache-Control", "no-store");
  res.send(buf);
}
