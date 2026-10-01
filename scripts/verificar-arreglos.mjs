// scripts/verificar-arreglos.mjs — Verificación en PRODUCCIÓN de los arreglos del
// 2026-09-30 tras aplicar 2026-09-30-arreglos-asistencia-boletas.sql: columna
// lotes.huella, cuerpos de importar_asistencia y publicar_lote_pdf, definer con
// search_path, guardas y privilegios intactos. Solo lecturas. Lo corre Diego con `!`:
//   export SUPABASE_ACCESS_TOKEN=$(powershell -NoProfile -Command '. .\scripts\token-supabase.ps1 *>$null; $env:SUPABASE_ACCESS_TOKEN' | tail -n 1 | tr -d "\r\n") && node scripts/verificar-arreglos.mjs
const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
let fallos = 0;
const prueba = async (n, fn) => { try { await fn(); console.log(`✓ ${n}`); } catch (e) { fallos++; console.error(`✗ ${n}: ${e.message}`); } };
const igual = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }),
  });
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`); return JSON.parse(t);
};

await prueba("lotes.huella existe (text) y los lotes previos la tienen nula", async () => {
  const [r] = await sql(`select (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'lotes' and column_name = 'huella') as tipo,
    (select count(*)::int from lotes where huella is not null) as con_huella, (select count(*)::int from lotes) as total`);
  igual(r.tipo, "text", "tipo"); console.log(`   lotes: ${r.total} · con huella: ${r.con_huella}`);
});
await prueba("importar_asistencia: borra solo origen = 'reloj', INSERT con do nothing, devuelve conservadas_control; definer + search_path; guarda propia intacta", async () => {
  const [g] = await sql(`select p.prosrc as a, p.prosecdef as def, exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%') as sp,
    has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('anon', p.oid, 'execute') as anon
    from pg_proc p where p.oid = 'public.importar_asistencia(text, jsonb, text, jsonb, text)'::regprocedure`);
  igual(/origen = 'reloj'/.test(g.a) && /on conflict \(empresa_id, documento, fecha\) do nothing/.test(g.a) && /conservadas_control/.test(g.a), true, "cuerpo");
  igual(/fn_nivel_modulo\('asistencia'\) < 2/.test(g.a), true, "guarda");
  igual(`${g.def}/${g.sp}/${g.auth}/${g.anon}`, "true/true/true/false", "definer/search_path/grants");
});
await prueba("publicar_lote_pdf: huella + lote repetido; definer + search_path; guarda requiere_nivel('boletas', 2) intacta", async () => {
  const [g] = await sql(`select p.prosrc as b, p.prosecdef as def, exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%') as sp,
    has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('anon', p.oid, 'execute') as anon
    from pg_proc p where p.oid = 'public.publicar_lote_pdf(text, text, text, text, jsonb)'::regprocedure`);
  igual(/l\.huella = v_huella/.test(g.b) && /'repetido', true/.test(g.b) && /extensions\.digest/.test(g.b), true, "cuerpo");
  igual(/requiere_nivel\('boletas', 2\)/.test(g.b), true, "guarda");
  igual(`${g.def}/${g.sp}/${g.auth}/${g.anon}`, "true/true/true/false", "definer/search_path/grants");
});
await prueba("ninguna security definer de public sin search_path (el arreglo no rompió el invariante de hardening)", async () => {
  const [r] = await sql(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')`);
  igual(r.n, 0, "definer sin search_path");
});
console.log(fallos ? `\n${fallos} fallo(s).` : "\nTodo verde.");
process.exit(fallos ? 1 : 0);
