// scripts/verificar-fase3b.mjs — Verificación en PRODUCCIÓN de la fase 3b
// (datos bancarios en interno.datos_bancarios) tras aplicar
// migraciones/2026-09-18-fase3b-datos-bancarios.sql. Catálogo y comportamiento
// por la Management API (sesiones simuladas como PostgREST); solo lecturas.
//   env: SUPABASE_ACCESS_TOKEN
//   Uso: . .\scripts\token-supabase.ps1; node scripts/verificar-fase3b.mjs
import { COLUMNAS_PERSONAS, FUNCIONES_NUEVAS } from "./fase3b-generar.mjs";
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
const lista = (arr) => arr.map((x) => `'${x}'`).join(", ");

console.log("== Catálogo");
await prueba(`personas sin las ${COLUMNAS_PERSONAS.length} columnas bancarias; interno.datos_bancarios con RLS, lectura_admin y sin acceso de anon`, async () => {
  const [{ n }] = await sql(`select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'personas' and column_name in (${lista(COLUMNAS_PERSONAS)})`);
  igual(n, 0, "columnas en personas");
  const [t] = await sql(`select relrowsecurity as rls, has_table_privilege('anon', 'interno.datos_bancarios', 'select') as an,
    has_table_privilege('authenticated', 'interno.datos_bancarios', 'select') as au, has_table_privilege('authenticated', 'interno.datos_bancarios', 'update') as w,
    (select count(*) from pg_policies where schemaname = 'interno' and tablename = 'datos_bancarios' and policyname = 'lectura_admin')::int as pol
    from pg_class where oid = 'interno.datos_bancarios'::regclass`);
  igual(`${t.rls}/${t.an}/${t.au}/${t.w}/${t.pol}`, "true/false/true/false/1", "tabla");
});
await prueba("las filas copiadas coinciden con el conteo respaldado y todos los CCI están cifrados", async () => {
  const [r] = await sql(`select (select count(*) from interno.datos_bancarios)::int as filas,
    (select definicion from interno.respaldo_fase3b where objeto = 'conteo:personas_con_datos')::int as esperado,
    (select count(*) from interno.datos_bancarios where cci_cifrado is not null)::int as cci,
    (select definicion from interno.respaldo_fase3b where objeto = 'conteo:cci')::int as cci_esperado`);
  igual(r.filas, r.esperado, "filas"); igual(r.cci, r.cci_esperado, "cci");
});
await prueba("ayudantes internos sin EXECUTE para la API; fn_ver_cuenta_bancaria sigue disponible a authenticated", async () => {
  const l = await sql(`select f, has_function_privilege('authenticated', ('public.' || f)::regprocedure, 'execute') as a from unnest(array[${lista(FUNCIONES_NUEVAS)}]) f`);
  for (const x of l) igual(x.a, false, x.f);
  const [{ a }] = await sql(`select has_function_privilege('authenticated', 'public.fn_ver_cuenta_bancaria(text)', 'execute') as a`);
  igual(a, true, "fn_ver_cuenta_bancaria");
});
await prueba("v_personal (security_invoker) y v_portal_datos no leen ya columnas bancarias de personas; importar_planilla_unificada transformada", async () => {
  const [r] = await sql(`select ('security_invoker=on' = any(coalesce((select reloptions from pg_class where oid = 'public.v_personal'::regclass), '{}'))) as inv,
    (select count(*) from pg_views where schemaname = 'public' and definition ~ '\\mp(e)?\\.(cci|cuenta_cifrada|cuenta_ultimos4|banco_id)\\M')::int as vistas,
    (select count(*) from pg_proc where proname = 'importar_planilla_unificada' and prosrc ~ 'fn_guardar_datos_bancarios')::int as imp`);
  igual(`${r.inv}/${r.vistas}/${r.imp}`, "true/0/1", "vistas y función");
});

console.log("\n== Comportamiento (sesiones simuladas)");
await prueba("superadministrador real: v_personal mismas filas que el total; cuenta y CCI enmascarados (nunca 20 dígitos)", async () => {
  const [r] = await sql(`select set_config('request.jwt.claims', json_build_object('role','authenticated','email',u.email,'sub',u.id)::text, true) from auth.users u where u.email = 'diegosalguerotang@gmail.com';
    set local role authenticated;
    select (select count(*) from public.v_personal)::int as n, (select count(*) from public.v_personal where cci ~ '^[0-9]{10,}$' or cuenta ~ '^[0-9]{10,}$')::int as claros,
           (select count(*) from public.v_personal where cci like '···· %')::int as enmascarados;`);
  const [{ total }] = await sql(`select count(*)::int as total from public.v_personal`);
  igual(r.n, total, "filas"); igual(r.claros, 0, "valores en claro");
  if (r.enmascarados < 1) throw new Error("ningún CCI enmascarado: ¿se copiaron los datos?");
});
await prueba("sesión sin identidad: 0 filas en v_personal; fn_ver_cuenta_bancaria devuelve null", async () => {
  const [r] = await sql(`select set_config('request.jwt.claims', '{"role":"authenticated","email":"nadie@ejemplo.invalido","sub":"00000000-0000-0000-0000-000000000000"}', true);
    set local role authenticated;
    select (select count(*) from public.v_personal)::int as n, public.fn_ver_cuenta_bancaria('00000000') as j;`);
  igual(r.n, 0, "filas"); igual(r.j, null, "sin permiso");
});
await prueba("auditoría: la consulta anterior quedó registrada como no autorizada y ninguna fila de auditoría lleva un CCI en claro", async () => {
  const [r] = await sql(`select (select count(*) from interno.auditoria where accion = 'VER_CUENTA_BANCARIA' and datos_despues ->> 'autorizado' = 'false' and datos_despues ->> 'dni' = '00000000')::int as reg,
    (select count(*) from interno.auditoria where tabla = 'datos_bancarios' and (datos_despues::text ~ '"cci"' or datos_despues::text ~ '"cuenta"'))::int as claros`);
  if (r.reg < 1) throw new Error("sin registro de la consulta denegada"); igual(r.claros, 0, "auditoría con valores");
});

console.log(fallos ? `\n${fallos} fallo(s).` : "\nTodo verde.");
process.exit(fallos ? 1 : 0);
