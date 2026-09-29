// scripts/verificar-licencias.mjs — Verificación en PRODUCCIÓN de Licencias Office
// (ADQ-09) tras aplicar la migración 2026-09-29-licencias-office.sql y la carga
// scripts/licencias-2026-09-29.sql: catálogo (RLS, políticas, vista invoker,
// grants de las 3 RPC, disparadores) y carga (20 grupos, 43 afiliaciones
// abiertas: 39 con DNI y 4 por afiliar con nombre). Solo lecturas.
// Uso: . .\scripts\token-supabase.ps1; node scripts/verificar-licencias.mjs
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

console.log("== Catálogo");
await prueba("2 tablas con RLS y adm_lectura por nivel de activos; sin adm_escritura (solo RPC)", async () => {
  const [r] = await sql(`select
    (select bool_and(relrowsecurity) from pg_class where relname in ('licencias_office', 'licencias_office_personas')) as rls,
    (select count(*) from pg_policies where tablename in ('licencias_office', 'licencias_office_personas') and policyname = 'adm_lectura'
       and qual like '%nivel_en(''activos''%')::int as lectura,
    (select count(*) from pg_policies where tablename in ('licencias_office', 'licencias_office_personas') and policyname <> 'adm_lectura')::int as otras`);
  igual(`${r.rls}/${r.lectura}/${r.otras}`, "true/2/0", "políticas");
});
await prueba("v_licencias_office con security_invoker; tablas y vista: SELECT para authenticated, nada para anon, sin escritura directa", async () => {
  const [r] = await sql(`select
    exists (select 1 from pg_class where relname = 'v_licencias_office' and 'security_invoker=on' = any(coalesce(reloptions, '{}'))) as inv,
    (select bool_and(has_table_privilege('authenticated', t, 'select') and not has_table_privilege('authenticated', t, 'insert')
                     and not has_table_privilege('authenticated', t, 'update') and not has_table_privilege('anon', t, 'select'))
       from unnest(array['public.licencias_office', 'public.licencias_office_personas', 'public.v_licencias_office']) t) as priv`);
  igual(`${r.inv}/${r.priv}`, "true/true", "vista/privilegios");
});
await prueba("3 RPC: EXECUTE para authenticated y service_role, no anon; definer con search_path; guarda fn_nivel_modulo('activos')", async () => {
  const r = await sql(`select p.oid::regprocedure::text as f, has_function_privilege('authenticated', p.oid, 'execute') as u,
      has_function_privilege('service_role', p.oid, 'execute') as s, has_function_privilege('anon', p.oid, 'execute') as a,
      p.prosecdef as def, exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%') as sp,
      (p.prosrc ~ 'fn_nivel_modulo\\(''activos''\\) < 2') as guarda
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('guardar_licencia_office', 'afiliar_licencia_office', 'desafiliar_licencia_office') order by 1`);
  igual(r.length, 3, "cantidad");
  const malas = r.filter((x) => !(x.u && x.s && !x.a && x.def && x.sp && x.guarda)).map((x) => x.f);
  igual(malas.join(","), "", "funciones mal configuradas");
});
await prueba("disparadores de auditoría en las 2 tablas", async () => {
  const [r] = await sql(`select count(*)::int as n from pg_trigger where tgname in ('trg_auditar_licencias_office', 'trg_auditar_licencias_office_personas') and not tgisinternal`);
  igual(r.n, 2, "disparadores");
});

console.log("\n== Carga inicial");
await prueba("20 grupos activos pagados por PROMANT, correos del tenant en minúsculas", async () => {
  const [r] = await sql(`select count(*)::int as n, count(*) filter (where estado = 'activa' and paga = 'promant')::int as ok,
    count(*) filter (where correo = lower(correo) and correo like '%@promantserv.onmicrosoft.com')::int as tenant from licencias_office`);
  igual(`${r.n}/${r.ok}/${r.tenant}`, "20/20/20", "grupos");
});
await prueba("43 afiliaciones abiertas: 39 con DNI del padrón y 4 por afiliar; la vista suma 43", async () => {
  const [r] = await sql(`select count(*)::int as t, count(dni)::int as c, (count(*) - count(dni))::int as s,
    count(*) filter (where dni is not null and not exists (select 1 from personas p where p.dni = licencias_office_personas.dni))::int as huerfanos
    from licencias_office_personas where hasta is null`);
  igual(`${r.t}/${r.c}/${r.s}/${r.huerfanos}`, "43/39/4/0", "afiliaciones");
  const [v] = await sql(`select sum(cantidad)::int as n, sum("porAfiliar")::int as pa from v_licencias_office`);
  igual(`${v.n}/${v.pa}`, "43/4", "vista");
});
await prueba("los 4 por afiliar son exactamente los de la fuente", async () => {
  const r = await sql(`select nombre from licencias_office_personas where hasta is null and dni is null order by nombre`);
  igual(r.map((x) => x.nombre).join("|"), "ANA SANABRIA|EMILIO JUAREZ|ESPERANZA QUEVEDO|MARIANO VILLANUEVA", "por afiliar");
});
await prueba("Aníbal Mayta resuelto por descarte (07819030) y Arturo Mayta (72386204) en LOGISTICA_01", async () => {
  const r = await sql(`select string_agg(lp.dni, ',' order by lp.dni) as dnis from licencias_office l join licencias_office_personas lp on lp.licencia_id = l.id and lp.hasta is null where l.grupo = 'LOGISTICA_01'`);
  igual(r[0].dnis, "07819030,72386204", "LOGISTICA_01");
});

console.log(fallos ? `\n${fallos} fallo(s).` : "\nTodo verde.");
process.exit(fallos ? 1 : 0);
