// scripts/diagnostico-permisos.mjs — SOLO LECTURA. Radiografía de permisos
// del esquema public en producción: RLS por tabla, políticas, grants a
// anon/authenticated sobre tablas y vistas, y privilegios por defecto.
//   env: SUPABASE_ACCESS_TOKEN.  Uso: . .\scripts\token-supabase.ps1; node scripts/diagnostico-permisos.mjs
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
const sql = async (query) => {
  const r = await fetch("https://api.supabase.com/v1/projects/mzpbdkrmokfxrrsotfgs/database/query", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
};
const fila = (r) => Object.values(r).join(" | ");
console.log("== Tablas: RLS, nº políticas, grants SELECT a anon/authenticated ==");
(await sql(`select c.relname as tabla, c.relrowsecurity as rls,
  (select count(*) from pg_policy p where p.polrelid=c.oid) as politicas,
  coalesce((select string_agg(g.grantee||':'||g.privilege_type, ',' order by g.grantee, g.privilege_type)
     from information_schema.role_table_grants g where g.table_schema='public' and g.table_name=c.relname and g.grantee in ('anon','authenticated')), '-') as grants
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' order by c.relrowsecurity, c.relname`)).forEach((r) => console.log("  " + fila(r)));
console.log("== Vistas: security_invoker y grants ==");
(await sql(`select c.relname as vista, coalesce(c.reloptions::text,'-') as opciones,
  coalesce((select string_agg(g.grantee||':'||g.privilege_type, ',' order by g.grantee)
     from information_schema.role_table_grants g where g.table_schema='public' and g.table_name=c.relname and g.grantee in ('anon','authenticated')), '-') as grants
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='v' order by c.relname`)).forEach((r) => console.log("  " + fila(r)));
console.log("== Privilegios por defecto en public ==");
(await sql(`select defaclrole::regrole::text as rol, coalesce(defaclnamespace::regnamespace::text, '(global)') as esquema, defaclobjtype as tipo, defaclacl::text as acl from pg_default_acl order by 1,2,3`)).forEach((r) => console.log("  " + fila(r)));
console.log("== Funciones ejecutables por anon ==");
(await sql(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege('anon', p.oid, 'execute') order by 1`)).forEach((r) => console.log("  " + fila(r)));
