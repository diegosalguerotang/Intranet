// scripts/comprobar-paquete.mjs — Corrección de seguridad · FASE 7: tras
// `vite build` (BackOffice) y `portal/vite build`, ningún archivo publicado
// puede llevar la URL del proyecto Supabase, la clave publishable, una clave
// secreta ni el rol de servicio (decisión P10: el navegador solo conoce su
// propio dominio). Corre en CI antes de desplegar y a mano tras compilar.
// Uso: node scripts/comprobar-paquete.mjs  (exige dist/ y portal/dist/)
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const PATRONES = [
  [/sb_publishable_qgP/, "clave publishable"],
  [/mzpbdkrmokfxrrsotfgs/, "referencia al proyecto Supabase"],
  [/sb_secret_[A-Za-z0-9_-]{16,}/, "clave secreta"],  // supabase-js menciona el prefijo suelto en su código
  [/SUPA_SERVICE_KEY|SMTP_PASS|CORREO_SECRETO/, "nombre de secreto del servidor"],
];

function archivos(dir) {
  const salida = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...archivos(ruta));
    else if (/\.(js|css|html|json|map)$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

let fallos = 0, revisados = 0;
for (const [dist, nombre] of [["dist", "BackOffice"], ["portal/dist", "Portal"]]) {
  if (!existsSync(dist)) { console.error(`✗ ${nombre}: no existe ${dist}/ (compila primero)`); fallos++; continue; }
  const lista = archivos(dist);
  if (!lista.some((a) => a.endsWith(".js"))) { console.error(`✗ ${nombre}: ${dist}/ sin scripts`); fallos++; continue; }
  for (const archivo of lista) {
    revisados++;
    const texto = readFileSync(archivo, "utf8");
    for (const [re, que] of PATRONES) {
      if (re.test(texto)) { console.error(`✗ ${nombre}: ${que} en ${archivo}`); fallos++; }
    }
  }
  console.log(`${fallos ? "·" : "✓"} ${nombre}: ${lista.length} archivos revisados en ${dist}/`);
}
console.log(fallos ? `\n${fallos} hallazgo(s) en ${revisados} archivos.` : `\nTodo verde: ${revisados} archivos sin credenciales.`);
process.exit(fallos ? 1 : 0);
