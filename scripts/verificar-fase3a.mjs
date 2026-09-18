// scripts/verificar-fase3a.mjs — Verificación en PRODUCCIÓN de la fase 3a
// (esquema privado). Sirve en los dos momentos del despliegue:
//   · tras fase3a1 (funciones de servicio) + deploy de api/*.js: las funciones
//     existen, solo service_role las ejecuta, y los endpoints siguen vivos;
//   · tras fase3a2 (tablas movidas): catálogo completo + PostgREST no publica
//     `interno` + las tablas ya no responden por /rest/v1/<tabla> + vistas vivas.
// Catálogo por Management API; comportamiento por el proxy (solo lecturas y un
// envío real de recuperación a un correo administrativo, que deja rastro).
//   env: SUPABASE_ACCESS_TOKEN; opcionales ADMIN_EMAIL + ADMIN_PASSWORD (o SUPERADMIN_*),
//        CORREO_PRUEBA (correo de un administrador activo: recibe el enlace de prueba).
//   Uso: . .\scripts\token-supabase.ps1; node scripts/verificar-fase3a.mjs
import { ESQUEMA, TABLAS, TABLAS_CON_LECTURA_ADMIN, FUNCIONES_SERVICIO, VISTAS_DEPENDIENTES } from "./fase3-generar.mjs";
const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const APP = "https://intranet-general.vercel.app";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
const { SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD_INICIAL, ADMIN_EMAIL, ADMIN_PASSWORD, CORREO_PRUEBA } = process.env;

let fallos = 0;
async function prueba(nombre, fn) {
  try { await fn(); console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); }
}
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
const api = async (ruta, init = {}) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}${ruta}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`); return JSON.parse(t);
};
const sql = (q) => api("/database/query", { method: "POST", body: JSON.stringify({ query: q }) });
const proxy = (ruta, init = {}) => fetch(`${APP}/api/supa/${ruta}`, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
async function login(email, password) {
  const r = await proxy("auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
  const j = await r.json(); if (typeof j.access_token !== "string") throw new Error(`login ${email}: ${JSON.stringify(j).slice(0, 160)}`);
  return j.access_token;
}

const [{ movidas }] = await sql(`select count(*)::int as movidas from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = '${ESQUEMA}' and c.relkind = 'r'`);
const paso2 = movidas === TABLAS.length;
console.log(`== Catálogo (${paso2 ? "fase3a2 aplicada: tablas en interno" : "solo fase3a1: tablas aún en public"})`);
await prueba(`${FUNCIONES_SERVICIO.length} funciones de servicio: existen, definer, search_path con ${ESQUEMA}; solo service_role las ejecuta`, async () => {
  const l = await sql(`select f, to_regprocedure('public.' || f) is not null as existe,
      coalesce((select p.prosecdef and array_to_string(p.proconfig, ';') like '%${ESQUEMA}%' from pg_proc p where p.oid = to_regprocedure('public.' || f)), false) as ok,
      has_function_privilege('authenticated', to_regprocedure('public.' || f), 'execute') as au, has_function_privilege('anon', to_regprocedure('public.' || f), 'execute') as an,
      has_function_privilege('service_role', to_regprocedure('public.' || f), 'execute') as sr
    from unnest(array[${FUNCIONES_SERVICIO.map((f) => `'${f}'`).join(",")}]) f`);
  for (const x of l) { igual(x.existe, true, x.f); igual(x.ok, true, `${x.f} definer+search_path`); igual(`${x.au}${x.an}${x.sr}`, "falsefalsetrue", `${x.f} permisos`); }
});
await prueba("PostgREST publica solo public y graphql_public (interno no existe para la API)", async () => {
  const cfg = await api("/postgrest");
  igual(cfg.db_schema.split(",").map((s) => s.trim()).sort().join(","), "graphql_public,public", "db_schema");
});
if (paso2) {
  await prueba(`${TABLAS.length} tablas en ${ESQUEMA} con RLS, ninguna en public; ${TABLAS_CON_LECTURA_ADMIN.length} lectura_admin; anon sin USAGE`, async () => {
    const l = await sql(`select c.relname as t, c.relrowsecurity as rls, (select count(*)::int from pg_policies p where p.schemaname = '${ESQUEMA}' and p.tablename = c.relname and p.policyname = 'lectura_admin') as pol
      from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = '${ESQUEMA}' and c.relkind = 'r' order by 1`);
    igual(l.map((x) => x.t).join(","), [...TABLAS].sort().join(","), "tablas");
    for (const x of l) { igual(x.rls, true, `${x.t} rls`); igual(x.pol, TABLAS_CON_LECTURA_ADMIN.includes(x.t) ? 1 : 0, `${x.t} lectura_admin`); }
    const [{ n }] = await sql(`select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' and c.relname in (${TABLAS.map((t) => `'${t}'`).join(",")})`);
    igual(n, 0, "en public");
    const [p] = await sql(`select has_schema_privilege('anon', '${ESQUEMA}', 'usage') as a, has_schema_privilege('authenticated', '${ESQUEMA}', 'usage') as u, has_schema_privilege('service_role', '${ESQUEMA}', 'usage') as s`);
    igual(`${p.a}${p.u}${p.s}`, "falsetruetrue", "usage");
  });
  await prueba("todas las funciones de public llevan interno en search_path y ninguna nombra public.<tabla movida>", async () => {
    const [{ a, b }] = await sql(`select (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.prokind = 'f'
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%' and c like '%${ESQUEMA}%'))::int as a,
      (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.prokind = 'f' and p.prosrc ~ '\\mpublic\\.(${TABLAS.join("|")})\\M')::int as b`);
    igual(`${a}/${b}`, "0/0", "funciones");
  });
  await prueba(`las ${VISTAS_DEPENDIENTES.length} vistas dependientes responden; sesión sin identidad ve 0 filas`, async () => {
    const [r] = await sql(`select set_config('request.jwt.claims', '{"role":"authenticated","email":"nadie@ejemplo.invalido","sub":"00000000-0000-0000-0000-000000000000"}', true);
      set local role authenticated;
      select ${VISTAS_DEPENDIENTES.map((v) => `(select count(*) from public.${v})::int as ${v}`).join(", ")};`);
    for (const [k, v] of Object.entries(r)) igual(v, 0, k);
  });
}

console.log("\n== API (proxy)");
await prueba("recuperación de clave del BackOffice (usa api_admin_por_correo + api_token_crear): responde 200 y deja rastro", async () => {
  const correo = CORREO_PRUEBA ?? ADMIN_EMAIL ?? SUPERADMIN_EMAIL;
  if (!correo) throw new Error("define CORREO_PRUEBA (correo de un administrador activo)");
  const r = await fetch(`${APP}/api/enviar-correo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "recuperacion-admin", correo }) });
  igual(r.status, 200, "estado");
  await new Promise((res) => setTimeout(res, 3000));
  const [f] = await sql(`select resultado, detalle from correo_envios where accion = 'recuperacion-admin' and sujeto = '${correo.toLowerCase().replace(/'/g, "''")}' order by creado_en desc limit 1`);
  if (!f || f.resultado !== "enviado") throw new Error(`rastro: ${JSON.stringify(f)} (si es «rechazado: no es usuario activo», el correo no es de un administrador; si es «limitado», espera 1 hora)`);
});
const adminEmail = ADMIN_EMAIL ?? SUPERADMIN_EMAIL, adminClave = ADMIN_PASSWORD ?? SUPERADMIN_PASSWORD_INICIAL;
if (!adminEmail || !adminClave) console.log("(sin ADMIN_EMAIL/ADMIN_PASSWORD ni SUPERADMIN_* — se saltan las pruebas con sesión)");
else {
  let jwt;
  await prueba("login BackOffice", async () => { jwt = await login(adminEmail, adminClave); });
  if (jwt) {
    await prueba("administrador: v_usuarios_admin y v_perfiles responden por PostgREST con filas", async () => {
      for (const v of ["v_usuarios_admin", "v_perfiles", "v_politica_acceso"]) {
        const r = await proxy(`rest/v1/${v}?select=*&limit=5`, { headers: { "x-sesion": jwt } }); const j = await r.json();
        if (r.status !== 200 || !Array.isArray(j) || j.length === 0) throw new Error(`${v}: ${r.status} ${JSON.stringify(j).slice(0, 100)}`);
      }
    });
    if (paso2) await prueba("administrador: /rest/v1/usuarios_admin y /rest/v1/auditoria ya NO existen para la API (404/406/400)", async () => {
      for (const t of ["usuarios_admin", "auditoria", "correo_tokens"]) {
        const r = await proxy(`rest/v1/${t}?select=*&limit=1`, { headers: { "x-sesion": jwt } });
        if (r.status === 200) throw new Error(`${t}: 200 (sigue publicada)`);
      }
    });
    await prueba("administrador: las funciones de servicio se le niegan por RPC (401/403/404)", async () => {
      const r = await proxy(`rest/v1/rpc/api_admin_por_correo`, { method: "POST", headers: { "x-sesion": jwt }, body: JSON.stringify({ p_correo: adminEmail, p_solo_activo: true }) });
      if (r.status === 200) throw new Error("200: authenticated puede llamar api_admin_por_correo");
    });
    await prueba("administrador: rit general y descarga siguen autorizando por api_admin_por_correo (api/rit.js)", async () => {
      const r = await fetch(`${APP}/api/rit?rit=general-2025`, { headers: { "x-sesion": jwt } });
      if (r.status === 403) throw new Error("403: api/rit no reconoce al administrador");
      if (r.status >= 500) throw new Error(`${r.status}: api/rit falla`);
    });
  }
}

console.log(fallos ? `\n${fallos} fallo(s).` : "\nTodo verde.");
process.exit(fallos ? 1 : 0);
