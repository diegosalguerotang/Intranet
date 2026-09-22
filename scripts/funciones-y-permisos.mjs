// scripts/funciones-y-permisos.mjs — Corrección de seguridad · FASE 8:
// regenera docs/funciones-y-permisos.md desde el estado REAL de producción
// (pg_proc + ACL + cuerpo), no desde la foto del paso 0. Clasifica cada
// función de `public` por su guarda y por quién puede ejecutarla.
//   env: SUPABASE_ACCESS_TOKEN
//   Uso: . .\scripts\token-supabase.ps1; node scripts/funciones-y-permisos.mjs
import { writeFileSync } from "node:fs";
const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }),
  });
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`); return JSON.parse(t);
}

const filas = await sql(`select p.proname as nombre, pg_get_function_identity_arguments(p.oid) as args, p.prosrc as cuerpo,
    p.prosecdef as definer, p.prorettype = 'trigger'::regtype as es_trigger,
    has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth,
    has_function_privilege('service_role', p.oid, 'execute') as servicio,
    exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') as sp
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by p.proname, 2`);
const fecha = new Date().toISOString().slice(0, 10);

function clasificar(f) {
  const c = f.cuerpo ?? "";
  const g = [];
  let m;
  if (/requiere_superadmin\(\)/.test(c)) g.push("superadmin");
  const re = /requiere_nivel\('([a-z_]+)',\s*(\d)(?:,\s*'([a-z_]+)')?\)/g;
  while ((m = re.exec(c))) g.push(`${m[1]}${m[3] ? ` o ${m[3]}` : ""} · nivel ${m[2]}`);
  if (/requiere_correo_propio/.test(c)) g.push("solo la propia cuenta (correo del JWT)");
  if (/fn_nivel_modulo|nivel_en\(/.test(c) && !g.length) g.push("guarda propia sobre fn_nivel_modulo/nivel_en");
  if (/fn_nivel_memorandums/.test(c) && !g.length) g.push("guarda propia sobre fn_nivel_memorandums (sanción según nivel)");
  if (/es_admin_activo\(\)|es_admin\(\)/.test(c) && !g.length) g.push("es_admin");
  if (/portal_dni\(\)|fn_persona_llamador\(\)/.test(c)) g.push("identidad del JWT (portal_dni / fn_persona_llamador)");
  if (/correo_llamador\(\)|auth\.jwt\(\)|auth\.uid\(\)/.test(c) && !g.some((x) => /propia|superadmin|nivel|identidad/.test(x))) g.push("identidad del JWT (correo_llamador / auth.jwt / auth.uid): alcance o sesión propia resueltos en el cuerpo");
  // Cerradas: el cuerpo es solo un RAISE (p. ej. portal_crear_ticket desde 2026-09-22). No hacen nada.
  if (!g.length && /^\s*begin\s+raise exception\b[^;]*;\s*end\s*$/i.test(c.trim())) g.push("cerrada: siempre rechaza (sin efecto)");
  // Vistas previas: envoltorio que llama a la función de importación (misma guarda) y revierte.
  if (!g.length && (m = /:=\s*(importar_[a-z_]+)\(/.exec(c))) g.push(`delega en ${m[1]} (su guarda) y revierte (vista previa)`);
  const ejecutan = [f.anon && "anon", f.auth && "authenticated", f.servicio && "service_role"].filter(Boolean).join(" + ") || "ninguno";
  let grupo;
  if (f.es_trigger) grupo = "trigger";
  else if (f.anon) grupo = "pre-login";
  else if (f.nombre.startsWith("api_")) grupo = "servicio (api/*.js con llave de servicio)";
  else if (f.nombre.startsWith("portal_") || /portal_dni/.test(g.join())) grupo = "autoservicio del trabajador";
  else if (/^(mi_sesion|registrar_sesion)_backoffice$/.test(f.nombre)) grupo = "administrativa (sesión propia)";
  else if (f.nombre.startsWith("fn_") || /^(es_|nivel_en|requiere_|correo_llamador)/.test(f.nombre)) grupo = "ayudante";
  else if (f.auth) grupo = "administrativa";
  else grupo = "interna";
  return { grupo, guarda: g.join("; ") || (f.auth ? "SIN GUARDA (revisar)" : "—"), ejecutan };
}

const clasificadas = filas.map((f) => ({ f, ...clasificar(f) }));
const sinGuarda = clasificadas.filter((x) => x.grupo === "administrativa" && /SIN GUARDA/.test(x.guarda));
const sinSp = filas.filter((f) => f.definer && !f.sp);
const conteo = {};
for (const x of clasificadas) conteo[x.grupo] = (conteo[x.grupo] ?? 0) + 1;

const md = [
  `# Funciones y permisos — estado real de producción (${fecha})`, ``,
  `Generado por \`scripts/funciones-y-permisos.mjs\` desde \`pg_proc\` de producción (proyecto \`${PROYECTO}\`): firma, guarda detectada en el cuerpo y roles con EXECUTE. Regenerar tras cada fase.`, ``,
  `**Reglas vigentes (fases 0–6):** toda función nueva nace SIN EXECUTE para la API (\`ALTER DEFAULT PRIVILEGES\`); \`anon\` solo ejecuta las 4 RPC pre-login; las administrativas se guardan con \`requiere_superadmin()\` / \`requiere_nivel(modulo, nivel[, alternativo])\` o con su guarda propia sobre \`fn_nivel_modulo\` (misma identidad por petición: correo del JWT → \`usuarios_admin\` activo → categoría vigente; sin JWT y con rol activo \`authenticated\`/\`anon\` vale 0); el autoservicio del trabajador deriva la identidad del JWT (\`portal_dni()\`, \`fn_persona_llamador()\`), nunca de un parámetro; las \`api_*\` solo las ejecuta \`service_role\` (funciones serverless); toda SECURITY DEFINER fija \`search_path\`.`, ``,
  `| Grupo | Funciones |`, `|---|---|`,
  ...Object.entries(conteo).sort().map(([g, n]) => `| ${g} | ${n} |`),
  ``,
  `| Función | Grupo | Guarda / regla | EXECUTE |`, `|---|---|---|---|`,
  ...clasificadas.map(({ f, grupo, guarda, ejecutan }) => `| \`${f.nombre}(${f.args})\` | ${grupo} | ${guarda} | ${ejecutan} |`),
  ``,
  `Comprobaciones al generar: ${sinGuarda.length} administrativa(s) sin guarda detectable${sinGuarda.length ? ` (${sinGuarda.map((x) => x.f.nombre).join(", ")})` : ""}; ${sinSp.length} SECURITY DEFINER sin \`search_path\` fijo.`, ``,
].join("\n");
writeFileSync("docs/funciones-y-permisos.md", md);
console.log(`docs/funciones-y-permisos.md: ${filas.length} funciones · ${JSON.stringify(conteo)} · sin guarda: ${sinGuarda.length} · sin search_path: ${sinSp.length}`);
if (sinGuarda.length) console.log("  revisar:", sinGuarda.map((x) => `${x.f.nombre}(${x.f.args})`).join("; "));
