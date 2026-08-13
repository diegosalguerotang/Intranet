// Espejo de diagnóstico: devuelve las cabeceras y la query tal como LLEGARON
// al servidor. Es la única forma de ver qué altera un interceptor
// (antivirus/proxy) en tránsito, porque desde el propio navegador la petición
// siempre se ve limpia. Solo expone lo que el cliente ya envió, nada más.
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ metodo: req.method, query: req.query, cabeceras: req.headers });
}
