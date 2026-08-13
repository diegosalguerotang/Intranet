// Espejo de diagnóstico: devuelve cabeceras y query tal como LLEGARON al
// servidor, para ver si algo las altera en tránsito (así se cazó el BOM de
// la env var el 2026-08-13). SOLO refleja una lista blanca: las cabeceras
// que Vercel inyecta (x-vercel-oidc-token, firmas del proxy) jamás deben
// volver al cliente.
const REFLEJAR = ["apikey", "authorization", "x-prueba", "x-sesion", "content-type", "user-agent"];

export default function handler(req, res) {
  const cabeceras = {};
  for (const nombre of REFLEJAR) {
    if (req.headers[nombre] != null) cabeceras[nombre] = req.headers[nombre];
  }
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ metodo: req.method, query: req.query, cabeceras });
}
