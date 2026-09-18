// scripts/verificar-fase2.mjs — Verificación en PRODUCCIÓN de la fase 2
// (vistas con security_invoker) DESPUÉS de aplicar
// migraciones/2026-09-18-fase2-vistas.sql. Catálogo por Management API y
// comportamiento por el proxy con sesiones reales (solo lecturas).
//   env: SUPABASE_ACCESS_TOKEN; opcionales SUPERADMIN_EMAIL + SUPERADMIN_PASSWORD_INICIAL
//        o ADMIN_EMAIL + ADMIN_PASSWORD (cualquier administrador activo),
//        PORTAL_DNI + PORTAL_CLAVE (trabajador).
//   Uso: . .\scripts\token-supabase.ps1; node scripts/verificar-fase2.mjs
import { VISTAS_INVOKER, VISTAS_CATALOGO, VISTAS_PORTAL, TABLAS_ADMIN, TABLAS_SESION, TABLAS_GRANT } from "./fase2-generar.mjs";
const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const APP = "https://intranet-general.vercel.app";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
const { SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD_INICIAL, ADMIN_EMAIL, ADMIN_PASSWORD, PORTAL_DNI, PORTAL_CLAVE } = process.env;
const ADMINISTRATIVAS = VISTAS_INVOKER.filter((v) => !VISTAS_CATALOGO.includes(v));

let fallos = 0;
async function prueba(nombre, fn) {
  try { await fn(); console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); }
}
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}
const proxy = (ruta, init = {}) => fetch(`${APP}/api/supa/${ruta}`, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
async function login(email, password) {
  const r = await proxy("auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
  const j = await r.json(); if (typeof j.access_token !== "string") throw new Error(`login ${email}: ${JSON.stringify(j).slice(0, 160)}`);
  return j.access_token;
}
// Lectura de una relación por PostgREST con la sesión dada: devuelve el número
// de filas (máx. 1000) o lanza con el estado HTTP.
async function filas(jwt, rel) {
  const r = await proxy(`rest/v1/${rel}?select=*&limit=1000`, { headers: { "x-sesion": jwt, Prefer: "count=exact" } });
  const c = await r.text();
  if (r.status >= 400) throw new Error(`${rel}: ${r.status} ${c.slice(0, 120)}`);
  return JSON.parse(c).length;
}

console.log("== Catálogo");
await prueba(`${VISTAS_INVOKER.length} vistas con security_invoker; las ${VISTAS_PORTAL.length} del Portal como dueño`, async () => {
  const l = await sql(`select c.relname as v, 'security_invoker=on' = any(coalesce(c.reloptions, '{}')) as inv from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'v' order by 1`);
  igual(l.filter((x) => x.inv).map((x) => x.v).join(","), VISTAS_INVOKER.join(","), "invoker");
  igual(l.filter((x) => !x.inv).map((x) => x.v).join(","), VISTAS_PORTAL.join(","), "dueño");
});
await prueba(`${TABLAS_ADMIN.length} políticas lectura_admin y ${TABLAS_SESION.length} lectura_sesion, solo SELECT, ninguna con true`, async () => {
  const p = await sql(`select tablename, policyname, cmd, qual from pg_policies where schemaname = 'public' and policyname in ('lectura_admin', 'lectura_sesion') order by 1, 2`);
  igual(p.filter((x) => x.policyname === "lectura_admin").map((x) => x.tablename).join(","), [...TABLAS_ADMIN].sort().join(","), "lectura_admin");
  igual(p.filter((x) => x.policyname === "lectura_sesion").map((x) => x.tablename).join(","), [...TABLAS_SESION].sort().join(","), "lectura_sesion");
  for (const x of p) { igual(x.cmd, "SELECT", `${x.tablename}.${x.policyname}`); if (x.qual === "true") throw new Error(`${x.tablename}: política true`); }
  const [{ n }] = await sql(`select count(*)::int as n from pg_policies where schemaname = 'public' and (qual = 'true' or with_check = 'true')`);
  igual(n, 0, "políticas true en public");
});
await prueba(`las ${TABLAS_GRANT.length} tablas del grant tienen solo SELECT para authenticated; RLS activa en todas las tablas`, async () => {
  const l = await sql(`select t, has_table_privilege('authenticated', 'public.' || t, 'select') as s, has_table_privilege('authenticated', 'public.' || t, 'insert') or has_table_privilege('authenticated', 'public.' || t, 'update') or has_table_privilege('authenticated', 'public.' || t, 'delete') as w
    from unnest(array[${TABLAS_GRANT.map((t) => `'${t}'`).join(",")}]) t`);
  for (const x of l) { igual(x.s, true, `${x.t} select`); igual(x.w, false, `${x.t} escritura`); }
  const [{ n }] = await sql(`select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
  igual(n, 0, "tablas sin RLS");
});
await prueba("sesión authenticated sin identidad: 0 filas en v_personal, v_usuarios_admin y personas", async () => {
  const [r] = await sql(`select set_config('request.jwt.claims', '{"role":"authenticated","email":"nadie@ejemplo.invalido","sub":"00000000-0000-0000-0000-000000000000"}', true);
    set local role authenticated;
    select (select count(*) from public.v_personal)::int as a, (select count(*) from public.v_usuarios_admin)::int as b, (select count(*) from public.personas)::int as c;`);
  igual(`${r.a}/${r.b}/${r.c}`, "0/0/0", "filas");
});

console.log("\n== Administrador (BackOffice)");
const adminEmail = ADMIN_EMAIL ?? SUPERADMIN_EMAIL, adminClave = ADMIN_PASSWORD ?? SUPERADMIN_PASSWORD_INICIAL;
if (!adminEmail || !adminClave) console.log("(sin ADMIN_EMAIL/ADMIN_PASSWORD ni SUPERADMIN_* — se salta)");
else {
  let jwt;
  await prueba("login BackOffice", async () => { jwt = await login(adminEmail, adminClave); });
  if (jwt) {
    await prueba(`administrador: las ${VISTAS_INVOKER.length} vistas responden 200 y las de datos maestros traen filas`, async () => {
      const mal = [];
      for (const v of VISTAS_INVOKER) { try { const n = await filas(jwt, v); if (["v_personal", "v_sedes", "v_usuarios_admin", "v_perfiles", "v_politica_acceso"].includes(v) && n === 0) mal.push(`${v}: 0 filas`); } catch (e) { mal.push(e.message); } }
      if (mal.length) throw new Error("\n   " + mal.join("\n   "));
    });
  }
}

console.log("\n== Trabajador del Portal");
if (!PORTAL_DNI || !PORTAL_CLAVE) console.log("(sin PORTAL_DNI/PORTAL_CLAVE — se salta)");
else {
  let jwt;
  await prueba("login del Portal", async () => { jwt = await login(`${PORTAL_DNI.toLowerCase()}@portal.grupoer.pe`, PORTAL_CLAVE); });
  if (jwt) {
    await prueba(`trabajador: 0 filas en las ${ADMINISTRATIVAS.length} vistas administrativas (antes de la fase 2 las leía todas)`, async () => {
      const mal = [];
      for (const v of ADMINISTRATIVAS) { try { const n = await filas(jwt, v); if (n !== 0) mal.push(`${v}: ${n} filas`); } catch (e) { mal.push(e.message); } }
      if (mal.length) throw new Error("\n   " + mal.join("\n   "));
    });
    await prueba("trabajador: v_portal_perfil y v_portal_datos traen su fila; los catálogos responden", async () => {
      igual(await filas(jwt, "v_portal_perfil"), 1, "v_portal_perfil"); igual(await filas(jwt, "v_portal_datos"), 1, "v_portal_datos");
      for (const v of VISTAS_CATALOGO) await filas(jwt, v);
    });
    await prueba("trabajador: 0 filas al leer personas, vinculos, usuarios_admin y documentos directamente", async () => {
      for (const t of ["personas", "vinculos", "usuarios_admin", "documentos"]) igual(await filas(jwt, t), 0, t);
    });
  }
}

console.log(fallos ? `\n${fallos} fallo(s).` : "\nTodo verde.");
process.exit(fallos ? 1 : 0);
