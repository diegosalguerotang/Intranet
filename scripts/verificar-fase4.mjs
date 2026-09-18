// scripts/verificar-fase4.mjs — Verificación en PRODUCCIÓN de la fase 4 (RLS
// por rol) tras aplicar migraciones/2026-09-18-fase4-rls.sql. Catálogo y
// comportamiento con sesiones simuladas de cuentas REALES (solo lecturas):
// el superadministrador, un administrador de TI (activos 2) y otro de RRHH
// (personal 3), más una sesión sin identidad.
//   env: SUPABASE_ACCESS_TOKEN
//   Uso: . .\scripts\token-supabase.ps1; node scripts/verificar-fase4.mjs
import { MATRIZ, SIN_POLITICA, AYUDANTES, POLITICAS_BUCKET } from "./fase4-generar.mjs";
const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }

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
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`); return JSON.parse(t);
}
// Consulta como una cuenta real (por correo) o sin identidad.
const como = (correo, consulta) => sql(`${correo
  ? `select set_config('request.jwt.claims', json_build_object('role','authenticated','email',u.email,'sub',u.id)::text, true) from auth.users u where u.email = '${correo}';`
  : `select set_config('request.jwt.claims', '{"role":"authenticated","email":"nadie@ejemplo.invalido","sub":"00000000-0000-0000-0000-000000000000"}', true);`}
  set local role authenticated; ${consulta}`);
const lista = (arr) => arr.map((x) => `'${x}'`).join(", ");

console.log("== Catálogo");
await prueba("0 políticas con condición true; ninguna interina; toda tabla con RLS; sin política solo la lista «nadie»", async () => {
  const [r] = await sql(`select (select count(*) from pg_policies where schemaname in ('public','interno','storage') and (qual = 'true' or with_check = 'true'))::int as t,
    (select count(*) from pg_policies where schemaname in ('public','interno') and policyname in ('lectura_admin','lectura_sesion','solo_admin','documentos_admin','acceso_demo'))::int as interinas,
    (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname in ('public','interno') and c.relkind = 'r' and c.relname not like 'respaldo_%' and not c.relrowsecurity)::int as sin_rls,
    (select string_agg(s.nspname || '.' || c.relname, ',' order by 1) from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname in ('public','interno') and c.relkind = 'r' and c.relname not like 'respaldo_%'
       and not exists (select 1 from pg_policies p where p.schemaname = s.nspname and p.tablename = c.relname)) as sin_politica`);
  igual(`${r.t}/${r.interinas}/${r.sin_rls}`, "0/0/0", "true/interinas/sin rls"); igual(r.sin_politica, [...SIN_POLITICA].sort().join(","), "sin política");
});
await prueba(`la matriz cubre todas las tablas; 47 vistas security_invoker; ${POLITICAS_BUCKET.length} políticas del bucket; ayudantes sin acceso de anon`, async () => {
  const [r] = await sql(`select (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname in ('public','interno') and c.relkind = 'r' and c.relname not like 'respaldo_%')::int as tablas,
    (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'v' and 'security_invoker=on' = any(coalesce(c.reloptions, '{}')))::int as inv,
    (select count(*) from pg_policies where schemaname = 'storage' and policyname in (${lista(POLITICAS_BUCKET)}))::int as bucket,
    (select count(*) from unnest(array[${lista(AYUDANTES)}]) f where has_function_privilege('anon', ('public.' || f)::regprocedure, 'execute') or not has_function_privilege('authenticated', ('public.' || f)::regprocedure, 'execute'))::int as mal`);
  igual(r.tablas, Object.keys(MATRIZ).length + SIN_POLITICA.length, "tablas cubiertas"); igual(`${r.inv}/${r.bucket}/${r.mal}`, `47/${POLITICAS_BUCKET.length}/0`, "vistas/bucket/ayudantes");
});

console.log("\n== Comportamiento (cuentas reales, sesiones simuladas)");
const totales = (await sql(`select (select count(*) from public.v_personal)::int as personal, (select count(*) from public.v_activos)::int as activos, (select count(*) from public.v_usuarios_admin)::int as usuarios, (select count(*) from public.v_acuses)::int as acuses`))[0];
await prueba("superadministrador: ve todo el padrón, todos los activos y todos los usuarios", async () => {
  const [r] = await como("diegosalguerotang@gmail.com", `select (select count(*) from public.v_personal)::int as p, (select count(*) from public.v_activos)::int as a, (select count(*) from public.v_usuarios_admin)::int as u, (select count(*) from public.v_mi_acceso)::int as m;`);
  igual(`${r.p}/${r.a}/${r.u}`, `${totales.personal}/${totales.activos}/${totales.usuarios}`, "totales"); if (r.m < 1) throw new Error("v_mi_acceso vacío");
});
await prueba("Karen (TI inventario, activos 2, todas las empresas): activos completos, padrón visible, acuses 0, solo SU usuario y SU categoría", async () => {
  const [r] = await como("karen.gusman@promant.pe", `select (select count(*) from public.v_activos)::int as a, (select count(*) from public.v_personal)::int as p, (select count(*) from public.v_acuses)::int as ac, (select count(*) from public.v_usuarios_admin)::int as u, (select count(*) from public.v_perfiles)::int as pf, (select count(*) from public.v_mi_acceso)::int as m;`);
  igual(r.a, totales.activos, "activos"); igual(r.p, totales.personal, "padrón"); igual(r.ac, 0, "acuses"); igual(`${r.u}/${r.pf}/${r.m}`, "1/1/1", "propio");
});
await prueba("Daira (RRHH coordinación, personal 3): padrón completo, activos 0, registro de accesos 0", async () => {
  const [r] = await como("asistente.rrhh2@promant.pe", `select (select count(*) from public.v_personal)::int as p, (select count(*) from public.v_activos)::int as a, (select count(*) from public.v_registro_accesos)::int as reg;`);
  igual(r.p, totales.personal, "padrón"); igual(`${r.a}/${r.reg}`, "0/0", "activos/registro");
});
await prueba("sesión sin identidad: 0 en padrón, Portal, empresas, sedes y bucket", async () => {
  const [r] = await como(null, `select (select count(*) from public.v_personal)::int as p, (select count(*) from public.v_portal_perfil)::int as pp, (select count(*) from public.empresas)::int as e, (select count(*) from public.sedes)::int as s, (select count(*) from storage.objects)::int as o;`);
  igual(`${r.p}/${r.pp}/${r.e}/${r.s}/${r.o}`, "0/0/0/0/0", "filas");
});
await prueba("fuera de alcance = vacío, no error: Karen pide un usuario administrativo ajeno por PostgREST-like y recibe 0 filas", async () => {
  const [r] = await como("karen.gusman@promant.pe", `select count(*)::int as n from public.v_usuarios_admin where correo = 'diegosalguerotang@gmail.com';`);
  igual(r.n, 0, "filas");
});

console.log(fallos ? `\n${fallos} fallo(s).` : "\nTodo verde.");
process.exit(fallos ? 1 : 0);
