// scripts/paso0-seguridad.mjs — PASO 0 de la corrección de seguridad (2026-09-17).
// SOLO LECTURA sobre la base. Responde las preguntas del prompt de corrección y
// guarda en supabase/respaldos/ el estado actual de permisos (reversión de la fase 0):
//   · <fecha>-paso0-permisos.json   → foto completa (ACL de funciones, tablas, vistas,
//                                     secuencias, default privileges, políticas, RLS)
//   · <fecha>-paso0-reversion.sql   → GRANT/CREATE POLICY que restituyen ese estado
//   · <fecha>-paso0-funciones.json  → clasificación de las 120 funciones (para docs/funciones-y-permisos.md)
// Uso (PowerShell):  . .\scripts\token-supabase.ps1; node scripts/paso0-seguridad.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const sql = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 400)}`);
  return JSON.parse(t);
};
const fecha = new Date().toISOString().slice(0, 10);
const dir = "supabase/respaldos"; mkdirSync(dir, { recursive: true });
const titulo = (t) => console.log(`\n== ${t} ==`);

// ---------- 1. Funciones ----------
const funciones = await sql(`
  select p.oid, p.proname as nombre, pg_get_function_identity_arguments(p.oid) as args,
         p.prokind as kind, pg_get_function_result(p.oid) as retorna,
         p.prosecdef as definer, p.provolatile as volatil,
         coalesce(array_to_string(p.proconfig, ';'), '') as config,
         has_function_privilege('anon', p.oid, 'execute') as anon,
         has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
         has_function_privilege('service_role', p.oid, 'execute') as service_role,
         coalesce(p.proacl::text, '') as acl,
         l.lanname as lenguaje, p.prosrc as cuerpo
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
  where n.nspname = 'public' order by p.proname`);
const nombres = new Set(funciones.map((f) => f.nombre));
const PATRONES = {
  auth_uid: /auth\.uid\s*\(/i, auth_jwt: /auth\.jwt\s*\(/i, jwt_claims: /request\.jwt/i,
  current_setting: /current_setting\s*\(/i, insufficient_privilege: /insufficient_privilege/i,
};
for (const f of funciones) {
  const cuerpo = f.cuerpo || "";
  f.llama = [...nombres].filter((n) => n !== f.nombre && new RegExp(`\\b${n}\\s*\\(`, "i").test(cuerpo));
  f.senales = Object.entries(PATRONES).filter(([, re]) => re.test(cuerpo)).map(([k]) => k);
  f.search_path_fijo = /search_path=/.test(f.config);
  f.es_trigger = f.retorna === "trigger";
}
// Guardas conocidas: funciones que leen la identidad del llamador (se calcula transitivamente 1 nivel).
const leeIdentidad = (f) => f.senales.length > 0;
const helpersIdentidad = funciones.filter(leeIdentidad).map((f) => f.nombre);
for (const f of funciones) {
  f.guarda = f.senales.filter((s) => s !== "current_setting" || true).length > 0
    || f.llama.some((n) => helpersIdentidad.includes(n));
  f.guarda_via = [...f.senales, ...f.llama.filter((n) => helpersIdentidad.includes(n))];
}
// Uso desde el código cliente
const leerArbol = (d, acc = []) => { for (const e of readdirSync(d)) { const p = join(d, e); if (e === "node_modules" || e === "dist") continue; statSync(p).isDirectory() ? leerArbol(p, acc) : /\.(jsx?|mjs)$/.test(e) && acc.push(readFileSync(p, "utf8")); } return acc; };
const codigo = { backoffice: leerArbol("src").join("\n"), portal: leerArbol("portal/src").join("\n"), api: leerArbol("api").join("\n") };
for (const f of funciones) {
  const re = new RegExp(`(rpc\\(\\s*['"\`]${f.nombre}['"\`]|/rpc/${f.nombre}\\b)`);
  f.usada_por = Object.entries(codigo).filter(([, src]) => re.test(src)).map(([k]) => k);
}
const llamables = funciones.filter((f) => !f.es_trigger);
const authOk = llamables.filter((f) => f.authenticated);
const definers = authOk.filter((f) => f.definer);
const sinSearchPath = definers.filter((f) => !f.search_path_fijo);
const sinGuarda = authOk.filter((f) => !f.guarda);
titulo("1. Funciones");
console.log(`  Funciones en public: ${funciones.length} (${funciones.filter((f) => f.es_trigger).length} de trigger, ${llamables.length} llamables por RPC)`);
console.log(`  Ejecutables por authenticated: ${authOk.length} · por anon: ${llamables.filter((f) => f.anon).length}`);
console.log(`  De las ejecutables por authenticated: SECURITY DEFINER ${definers.length} · de esas SIN search_path fijo ${sinSearchPath.length}`);
console.log(`  SECURITY DEFINER en total (incluye triggers) sin search_path: ${funciones.filter((f) => f.definer && !f.search_path_fijo).length}`);
console.log(`  Ejecutables por authenticated SIN ninguna verificación del llamador: ${sinGuarda.length}`);
console.log(`  Helpers que leen identidad del JWT: ${helpersIdentidad.join(", ")}`);
console.log("  -- Sin guarda (nombre · definer · search_path · usada por):");
for (const f of sinGuarda) console.log(`     ${f.nombre}(${f.args}) · ${f.definer ? "DEFINER" : "invoker"} · ${f.search_path_fijo ? "sp" : "SIN sp"} · ${f.usada_por.join("+") || "nadie"}`);
console.log("  -- Con guarda (nombre · vía · usada por):");
for (const f of authOk.filter((f) => f.guarda)) console.log(`     ${f.nombre} · ${f.guarda_via.join(",")} · ${f.usada_por.join("+") || "nadie"}`);
console.log("  -- NO ejecutables por authenticated (ya cerradas):");
for (const f of llamables.filter((f) => !f.authenticated)) console.log(`     ${f.nombre} · anon=${f.anon} · usada por ${f.usada_por.join("+") || "nadie"}`);
console.log("  -- Llamadas desde el cliente que NO existen en la base:");
const todas = [...codigo.backoffice.matchAll(/rpc\(\s*['"`]([a-z_0-9]+)/g), ...codigo.portal.matchAll(/rpc\(\s*['"`]([a-z_0-9]+)|\/rpc\/([a-z_0-9]+)/g), ...codigo.api.matchAll(/\/rpc\/([a-z_0-9]+)/g)].map((m) => m[1] || m[2]);
for (const n of [...new Set(todas)].filter((n) => !nombres.has(n))) console.log(`     ${n}`);

// ---------- 2. RLS y políticas ----------
const tablas = await sql(`
  select c.relname as tabla, c.relrowsecurity as rls, c.relforcerowsecurity as rls_forzada,
         (select count(*) from pg_policy p where p.polrelid = c.oid) as politicas, coalesce(c.relacl::text, '') as acl
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') order by 1`);
const politicas = await sql(`
  select schemaname, tablename, policyname, permissive, roles::text as roles, cmd, coalesce(qual,'') as qual, coalesce(with_check,'') as with_check
  from pg_policies where schemaname = 'public' order by tablename, policyname`);
const demo = politicas.filter((p) => p.policyname === "acceso_demo");
const sinRls = tablas.filter((t) => !t.rls);
const trueQual = politicas.filter((p) => p.qual.trim() === "true" || p.with_check.trim() === "true");
titulo("2. RLS y políticas");
console.log(`  Tablas en public: ${tablas.length} · con RLS desactivada: ${sinRls.length} (${sinRls.map((t) => t.tabla).join(", ") || "ninguna"})`);
console.log(`  Tablas con RLS activa y CERO políticas (fallan cerrado): ${tablas.filter((t) => t.rls && t.politicas == 0).map((t) => t.tabla).join(", ") || "ninguna"}`);
console.log(`  Políticas totales: ${politicas.length} · con condición true: ${trueQual.length}`);
console.log(`  Política acceso_demo: ${demo.length ? `EXISTE en ${demo.length} tablas` : "no existe"}`);
if (demo.length) {
  const formas = [...new Set(demo.map((p) => `cmd=${p.cmd} roles=${p.roles} qual=${p.qual} check=${p.with_check}`))];
  console.log(`     formas: ${formas.join(" || ")}`);
  console.log(`     tablas: ${demo.map((p) => p.tablename).join(", ")}`);
}
console.log("  -- Otras políticas (no acceso_demo):");
for (const p of politicas.filter((p) => p.policyname !== "acceso_demo")) console.log(`     ${p.tablename}.${p.policyname} [${p.cmd} ${p.roles}] qual=${p.qual.slice(0, 90)} check=${p.with_check.slice(0, 60)}`);

// ---------- 3. Vistas ----------
const vistas = await sql(`
  select c.relname as vista, coalesce(c.reloptions::text, '') as opciones, coalesce(c.relacl::text, '') as acl
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v' order by 1`);
const sinInvoker = vistas.filter((v) => !/security_invoker=(on|true)/.test(v.opciones));
titulo("3. Vistas");
console.log(`  Vistas: ${vistas.length} · sin security_invoker: ${sinInvoker.length} · con: ${vistas.length - sinInvoker.length} (${vistas.filter((v) => !sinInvoker.includes(v)).map((v) => v.vista).join(", ") || "-"})`);

// ---------- 4. Grants directos ----------
const grants = await sql(`
  select g.grantee, g.table_name as objeto, c.relkind as tipo, string_agg(g.privilege_type, ',' order by g.privilege_type) as privilegios
  from information_schema.role_table_grants g join pg_class c on c.relname = g.table_name
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = g.table_schema
  where g.table_schema = 'public' and g.grantee in ('anon','authenticated','PUBLIC')
  group by 1,2,3 order by 1,3,2`);
const secuencias = await sql(`
  select c.relname as secuencia, coalesce(c.relacl::text,'') as acl,
         has_sequence_privilege('authenticated', c.oid, 'usage') as auth_usage, has_sequence_privilege('anon', c.oid, 'usage') as anon_usage
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname='public' and c.relkind='S' order by 1`);
const defaults = await sql(`select defaclrole::regrole::text as rol, coalesce(defaclnamespace::regnamespace::text, '(global)') as esquema, defaclobjtype as tipo, defaclacl::text as acl from pg_default_acl order by 1,2,3`);
const esquemas = await sql(`select nspname as esquema, has_schema_privilege('authenticated', nspname, 'usage') as auth_usage, has_schema_privilege('anon', nspname, 'usage') as anon_usage from pg_namespace where nspname not like 'pg_%' and nspname <> 'information_schema' order by 1`);
titulo("4. Permisos directos de authenticated / anon");
const resumen = (rol, tipo) => { const g = grants.filter((x) => x.grantee === rol && x.tipo === tipo); const porPriv = {}; for (const x of g) (porPriv[x.privilegios] ||= []).push(x.objeto); return Object.entries(porPriv).map(([k, v]) => `${k}: ${v.length}`).join(" · ") || "ninguno"; };
for (const rol of ["authenticated", "anon", "PUBLIC"]) console.log(`  ${rol} → tablas [${resumen(rol, "r")}] · vistas [${resumen(rol, "v")}]`);
console.log(`  Secuencias con USAGE para authenticated: ${secuencias.filter((s) => s.auth_usage).length}/${secuencias.length} · anon: ${secuencias.filter((s) => s.anon_usage).length}`);
console.log(`  Esquemas con USAGE: ${esquemas.filter((e) => e.auth_usage || e.anon_usage).map((e) => `${e.esquema}(auth=${e.auth_usage},anon=${e.anon_usage})`).join(", ")}`);
console.log("  Default privileges:"); for (const d of defaults) console.log(`     ${d.rol} · ${d.esquema} · ${d.tipo} · ${d.acl}`);
const authTablas = grants.filter((x) => x.grantee === "authenticated" && x.tipo === "r");
console.log("  Tablas con grant directo a authenticated (tabla:privilegios):");
console.log("     " + authTablas.map((x) => `${x.objeto}:${x.privilegios.replace(/DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE/, "ALL")}`).join("  "));

// ---------- 5. Datos sensibles ----------
titulo("5. Datos sensibles (dónde viven, texto plano)");
const columnas = await sql(`
  select table_name as tabla, column_name as columna, data_type as tipo
  from information_schema.columns where table_schema='public'
    and (column_name ~* '(cci|clave|cuenta|contrase|password|secret|token|otp)')
  order by 1,2`);
for (const c of columnas) console.log(`  ${c.tabla}.${c.columna} (${c.tipo})`);
const sens = await sql(`
  select 'personas.cci' as campo, count(cci) as con_valor, count(*) filter (where cci ~ '^[0-9]{18,20}$') as formato_plano, count(*) as filas from personas
  union all select 'personas.cuenta (texto plano)', count(cuenta), count(*) filter (where cuenta ~ '^[0-9 -]{8,}$'), count(*) from personas
  union all select 'personas.cuenta_cifrada', count(cuenta_cifrada), 0, count(*) from personas
  union all select 'activos.clave_equipo', count(clave_equipo), count(clave_equipo), count(*) from activos
  union all select 'usuarios_admin.clave_provisional', count(clave_provisional), count(clave_provisional), count(*) from usuarios_admin
  union all select 'auditoria con cci/cuenta/clave en datos', count(*) filter (where (datos_antes::text || datos_despues::text) ~* '"(cci|cuenta|clave_equipo|clave_provisional)"\\s*:\\s*"[^"]{4,}"'), 0, count(*) from auditoria`);
for (const s of sens) console.log(`  ${s.campo}: con valor ${s.con_valor} de ${s.filas} filas · con formato de texto plano ${s.formato_plano}`);

// ---------- 6. Respaldo (reversión de la fase 0) ----------
const foto = { fecha: new Date().toISOString(), proyecto: PROYECTO, funciones: funciones.map(({ cuerpo, ...f }) => f), tablas, politicas, vistas, grants, secuencias, defaults, esquemas };
writeFileSync(`${dir}/${fecha}-paso0-permisos.json`, JSON.stringify(foto, null, 2));
writeFileSync(`${dir}/${fecha}-paso0-funciones.json`, JSON.stringify(funciones.map((f) => ({ nombre: f.nombre, args: f.args, definer: f.definer, search_path_fijo: f.search_path_fijo, anon: f.anon, authenticated: f.authenticated, es_trigger: f.es_trigger, guarda: f.guarda, guarda_via: f.guarda_via, llama: f.llama, usada_por: f.usada_por })), null, 2));
const q = (s) => `"${s.replace(/"/g, '""')}"`;
let rev = `-- Reversión de la fase 0 · foto de permisos tomada el ${foto.fecha}\n-- Restituye EXACTAMENTE los grants a anon/authenticated y las políticas que existían.\nbegin;\n\n-- Funciones\n`;
for (const f of funciones) for (const rol of ["anon", "authenticated"]) if (f[rol]) rev += `grant execute on function public.${q(f.nombre)}(${f.args}) to ${rol};\n`;
rev += `\n-- Tablas y vistas\n`;
for (const g of grants.filter((x) => x.grantee !== "PUBLIC")) rev += `grant ${g.privilegios} on public.${q(g.objeto)} to ${g.grantee};\n`;
rev += `\n-- Secuencias\n`;
for (const s of secuencias) for (const rol of ["anon", "authenticated"]) if (s[`${rol.slice(0, 4)}_usage`]) rev += `grant usage, select on sequence public.${q(s.secuencia)} to ${rol};\n`;
rev += `\n-- Políticas\n`;
for (const p of politicas) {
  rev += `drop policy if exists ${q(p.policyname)} on public.${q(p.tablename)};\n`;
  rev += `create policy ${q(p.policyname)} on public.${q(p.tablename)} as ${p.permissive.toLowerCase()} for ${p.cmd} to ${p.roles.replace(/[{}]/g, "")}`;
  if (p.qual) rev += ` using (${p.qual})`; if (p.with_check) rev += ` with check (${p.with_check})`; rev += ";\n";
}
rev += `\n-- RLS\n`;
for (const t of tablas) rev += `alter table public.${q(t.tabla)} ${t.rls ? "enable" : "disable"} row level security;\n`;
rev += `\ncommit;\n`;
writeFileSync(`${dir}/${fecha}-paso0-reversion.sql`, rev);
titulo("6. Respaldo");
console.log(`  ${dir}/${fecha}-paso0-permisos.json · ${dir}/${fecha}-paso0-funciones.json · ${dir}/${fecha}-paso0-reversion.sql (${rev.split("\n").length} líneas)`);
