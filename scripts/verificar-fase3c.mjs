// scripts/verificar-fase3c.mjs — Verificación en PRODUCCIÓN de la fase 3c
// (claves de equipos → referencia al gestor de contraseñas) tras aplicar
// migraciones/2026-09-18-fase3c-claves-equipos.sql. Solo lecturas y sesiones
// simuladas por la Management API.
//   env: SUPABASE_ACCESS_TOKEN
//   Uso: . .\scripts\token-supabase.ps1; node scripts/verificar-fase3c.mjs
import { FUNCIONES } from "./fase3c-generar.mjs";
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
await prueba("activos sin clave_equipo y con clave_gestor; v_activos la expone y sigue security_invoker", async () => {
  const [r] = await sql(`select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'activos' and column_name = 'clave_equipo')::int as vieja,
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'activos' and column_name = 'clave_gestor')::int as nueva,
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'v_activos' and column_name = 'clave_gestor')::int as vista,
    ('security_invoker=on' = any(coalesce((select reloptions from pg_class where oid = 'public.v_activos'::regclass), '{}'))) as inv`);
  igual(`${r.vieja}/${r.nueva}/${r.vista}/${r.inv}`, "0/1/1/true", "columnas y vista");
});
await prueba("las dos funciones ya no nombran clave_equipo y siguen ejecutables por authenticated (la guarda decide)", async () => {
  const l = await sql(`select f, has_function_privilege('authenticated', ('public.' || f)::regprocedure, 'execute') as a,
      (select p.prosrc !~ 'clave_equipo\\M' from pg_proc p where p.oid = ('public.' || f)::regprocedure) as limpia
    from unnest(array[${FUNCIONES.map((f) => `'${f}'`).join(", ")}]) f`);
  for (const x of l) { igual(x.a, true, `${x.f} execute`); igual(x.limpia, true, `${x.f} cuerpo`); }
});
console.log("\n== Comportamiento (sesiones simuladas)");
await prueba("superadministrador real: v_activos mismas filas que el total y ver_clave_equipo responde", async () => {
  const [{ total }] = await sql(`select count(*)::int as total from public.v_activos`);
  const [r] = await sql(`select set_config('request.jwt.claims', json_build_object('role','authenticated','email',u.email,'sub',u.id)::text, true) from auth.users u where u.email = 'diegosalguerotang@gmail.com';
    set local role authenticated;
    select (select count(*) from public.v_activos)::int as n, public.ver_clave_equipo((select codigo from public.v_activos order by codigo limit 1), 'verificar') as v;`);
  igual(r.n, total, "filas");
});
await prueba("sesión sin identidad: v_activos 0 filas y guardar_clave_equipo → Permiso insuficiente", async () => {
  const [r] = await sql(`select set_config('request.jwt.claims', '{"role":"authenticated","email":"nadie@ejemplo.invalido","sub":"00000000-0000-0000-0000-000000000000"}', true);
    set local role authenticated;
    select (select count(*) from public.v_activos)::int as n;`);
  igual(r.n, 0, "filas");
  let denegado = false;
  try {
    await sql(`select set_config('request.jwt.claims', '{"role":"authenticated","email":"nadie@ejemplo.invalido","sub":"00000000-0000-0000-0000-000000000000"}', true);
      set local role authenticated; select public.guardar_clave_equipo('ZZ-NADA', 'x', 'verificar');`);
  } catch (e) { denegado = /Permiso insuficiente|insufficient_privilege|42501/.test(e.message); if (!denegado) throw e; }
  igual(denegado, true, "guarda");
});
console.log(fallos ? `\n${fallos} fallo(s).` : "\nTodo verde.");
process.exit(fallos ? 1 : 0);
