// scripts/ensayar-fase2.mjs — Ensayo LOCAL de la FASE 2 (vistas con
// security_invoker) sobre el estado de producción tras la fase 1 (fases 0 + 0b
// + 1 = supabase/seguridad.sql sin el bloque de la fase 2).
//
// Comprueba, con sesiones simuladas como PostgREST (set role + request.jwt.claims):
//   · la migración se aplica (verificación embebida incluida);
//   · NINGUNA vista del BackOffice se vacía para un administrador ni para un
//     superadministrador (misma cantidad de filas que antes);
//   · un trabajador del Portal deja de leer las vistas administrativas (0 filas)
//     y sigue leyendo los catálogos y sus 9 vistas v_portal_* igual que antes;
//   · un trabajador no lee tablas base directamente ni puede escribirlas;
//   · una sesión sin identidad no lee nada;
//   · la reversión deja la foto de permisos idéntica y la migración se re-aplica.
// Uso: node scripts/ensayar-fase2.mjs
import { readFileSync } from "node:fs";
import { arrancarPgLocal } from "./pg-local.mjs";
import { FECHA, VISTAS_INVOKER, VISTAS_CATALOGO, VISTAS_PORTAL, TABLAS_ADMIN, TABLAS_SESION, TABLAS_GRANT, sinFase2 } from "./fase2-generar.mjs";

const MIGRACION = readFileSync(`supabase/migraciones/${FECHA}-fase2-vistas.sql`, "utf8");
const REVERSION = readFileSync(`supabase/respaldos/${FECHA}-fase2-reversion.sql`, "utf8");
const SEGURIDAD_FASE1 = sinFase2(readFileSync("supabase/seguridad.sql", "utf8"));
const ADMINISTRATIVAS = VISTAS_INVOKER.filter((v) => !VISTAS_CATALOGO.includes(v));

let fallos = 0, ok = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); }
};
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const bd = await arrancarPgLocal({ seguridad: false });
const { sql, cliente } = bd;

// Identidades (las mismas de ensayar-fase1): trabajadora Rosa y superadmin
// Diego del seed; un administrador sin marca creado ANTES del estado de
// seguridad (crear_usuario_admin exige superadmin desde la fase 1).
const TRABAJADOR = { dni: "45231876", correo: "45231876@portal.grupoer.pe", sub: "11111111-1111-1111-1111-111111111111" };
const SUPER = { dni: "40776655", correo: "dsalguero@grupoer.pe", sub: "22222222-2222-2222-2222-222222222222" };
const ADMIN = { dni: "41887203", correo: "luis.rrhh@grupoer.pe", sub: "33333333-3333-3333-3333-333333333333" };
await sql(`insert into auth.users (id, email) values ($1, $2), ($3, $4), ($5, $6)`,
  [TRABAJADOR.sub, TRABAJADOR.correo, SUPER.sub, SUPER.correo, ADMIN.sub, ADMIN.correo]);
await sql(`select guardar_perfil('zz-rrhh', 'ZZ RRHH ensayo', '', false, false, false, false,
  '{"personal":3,"boletas":2,"activos":2,"memorandums":2}'::jsonb, null, 'ensayo', false)`);
await sql(`select crear_usuario_admin($1, 'zz-rrhh', $2, '', null, 'ensayo')`, [ADMIN.dni, ADMIN.correo]);

const como = async (rol, claims, texto, params) => {
  await cliente.query("begin");
  try {
    await cliente.query(`set local role ${rol}`);
    await cliente.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims ?? { role: rol })]);
    const r = await cliente.query(texto, params);
    return { filas: r.rows, n: r.rowCount };
  } catch (e) { return { codigo: e.code, mensaje: e.message }; }
  finally { await cliente.query("rollback"); }
};
const claims = (id) => ({ role: "authenticated", email: id.correo, sub: id.sub });
const NADIE = { role: "authenticated", email: "nadie@ejemplo.invalido", sub: "00000000-0000-0000-0000-000000000000" };
const contar = async (cl, rel) => {
  const r = await como("authenticated", cl, `select count(*)::int as n from public.${rel}`);
  if (r.codigo) throw new Error(`${rel}: ${r.codigo} ${r.mensaje}`);
  return r.filas[0].n;
};
const conteoDueno = async (rel) => (await sql(`select count(*)::int as n from public.${rel}`))[0].n;

// Foto de permisos (misma que ensayar-fase1) para comprobar la reversión.
const foto = async () => {
  const filas = await sql(`
    select 'fn:' || p.oid::regprocedure::text as objeto,
           coalesce(p.proacl::text, '') || '|definer=' || p.prosecdef::text || '|config=' || coalesce(array_to_string(p.proconfig, ';'), '') as valor
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    union all
    select 'rel:' || c.relname || ':' || c.relkind::text, coalesce(c.relacl::text, '') || '|rls=' || c.relrowsecurity::text || '|opts=' || coalesce(array_to_string(c.reloptions, ';'), '')
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'v', 'S')
    union all
    select 'pol:' || tablename || '.' || policyname, roles::text || '|' || cmd::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
      from pg_policies where schemaname = 'public'
    union all
    select 'def:' || defaclrole::regrole::text || ':' || coalesce(defaclnamespace::regnamespace::text, '-') || ':' || defaclobjtype::text, defaclacl::text
      from pg_default_acl
    order by 1`);
  const normal = (v) => v.replace(/\{([^}]*)\}/g, (_, s) => "{" + s.split(",").sort().join(",") + "}");
  return new Map(filas.map((f) => [f.objeto, normal(f.valor)]));
};
const compararFotos = (a, b) => {
  const dif = [];
  for (const [k, v] of a) if (!b.has(k)) dif.push(`falta tras revertir: ${k}`); else if (b.get(k) !== v) dif.push(`difiere ${k}: antes=${v} después=${b.get(k)}`);
  for (const k of b.keys()) if (!a.has(k)) dif.push(`sobra tras revertir: ${k}`);
  return dif;
};

const TODAS = [...VISTAS_INVOKER, ...VISTAS_PORTAL];
const antes = {};
const anotadas = []; // vistas que HOY un trabajador lee y no debería (dependen de correr como dueño)

try {
  console.log("== 0 · Base: fases 0 + 0b + 1 (seguridad.sql sin el bloque de la fase 2)");
  await prueba("el estado de la fase 1 se carga en local", async () => { await sql(SEGURIDAD_FASE1); });
  await prueba("ninguna vista tiene security_invoker antes de empezar", async () => {
    const [{ n }] = await sql(`select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'v' and 'security_invoker=on' = any(coalesce(c.reloptions, '{}'))`);
    igual(n, 0, "vistas invoker");
  });
  const foto0 = await foto();
  await prueba("hoy (vistas como dueño) un trabajador lee las vistas administrativas: se anotan", async () => {
    for (const v of TODAS) antes[v] = { dueno: await conteoDueno(v), admin: await contar(claims(ADMIN), v), superadmin: await contar(claims(SUPER), v), trabajador: await contar(claims(TRABAJADOR), v) };
    for (const v of ADMINISTRATIVAS) if (antes[v].trabajador > 0) anotadas.push(`${v} (${antes[v].trabajador} filas)`);
    if (!anotadas.some((a) => a.startsWith("v_personal "))) throw new Error("se esperaba que hoy un trabajador pudiera leer v_personal (es lo que la fase 2 cierra)");
    console.log(`   ${anotadas.length} vistas administrativas legibles hoy por un trabajador: ${anotadas.join(", ")}`);
  });

  console.log("\n== 1 · Aplicar la fase 2");
  await prueba("la migración se aplica sin errores (verificación embebida incluida)", async () => { await sql(MIGRACION); });
  await prueba(`catálogo: ${VISTAS_INVOKER.length} vistas con security_invoker y ${VISTAS_PORTAL.length} como dueño`, async () => {
    const l = await sql(`select c.relname as v, 'security_invoker=on' = any(coalesce(c.reloptions, '{}')) as inv from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'v' order by 1`);
    igual(l.filter((x) => x.inv).map((x) => x.v).join(","), VISTAS_INVOKER.join(","), "invoker");
    igual(l.filter((x) => !x.inv).map((x) => x.v).join(","), VISTAS_PORTAL.join(","), "dueño");
  });
  await prueba(`catálogo: ${TABLAS_ADMIN.length} lectura_admin + ${TABLAS_SESION.length} lectura_sesion, solo SELECT, ninguna con true`, async () => {
    const p = await sql(`select tablename, policyname, cmd, qual from pg_policies where schemaname = 'public' and policyname in ('lectura_admin', 'lectura_sesion') order by 1, 2`);
    igual(p.filter((x) => x.policyname === "lectura_admin").length, TABLAS_ADMIN.length, "lectura_admin");
    igual(p.filter((x) => x.policyname === "lectura_sesion").length, TABLAS_SESION.length, "lectura_sesion");
    for (const x of p) { igual(x.cmd, "SELECT", `${x.tablename}.${x.policyname} cmd`); if (x.qual === "true") throw new Error(`${x.tablename}: política true`); }
  });
  await prueba(`catálogo: las ${TABLAS_GRANT.length} tablas reciben solo SELECT`, async () => {
    for (const t of TABLAS_GRANT) {
      const [r] = await sql(`select has_table_privilege('authenticated', 'public.${t}', 'select') as s, has_table_privilege('authenticated', 'public.${t}', 'insert') as i, has_table_privilege('authenticated', 'public.${t}', 'update') as u, has_table_privilege('authenticated', 'public.${t}', 'delete') as d`);
      igual(`${r.s}${r.i}${r.u}${r.d}`, "truefalsefalsefalse", t);
    }
  });

  console.log("\n== 2 · Comportamiento");
  await prueba(`administrador: las ${VISTAS_INVOKER.length} vistas devuelven las mismas filas que antes (ninguna pantalla se vacía)`, async () => {
    const mal = [];
    for (const v of VISTAS_INVOKER) { const n = await contar(claims(ADMIN), v); if (n !== antes[v].dueno) mal.push(`${v}: ${n} ≠ ${antes[v].dueno}`); }
    if (mal.length) throw new Error(mal.join("; "));
  });
  await prueba(`superadministrador: las ${VISTAS_INVOKER.length} vistas devuelven las mismas filas que antes`, async () => {
    const mal = [];
    for (const v of VISTAS_INVOKER) { const n = await contar(claims(SUPER), v); if (n !== antes[v].dueno) mal.push(`${v}: ${n} ≠ ${antes[v].dueno}`); }
    if (mal.length) throw new Error(mal.join("; "));
  });
  await prueba(`trabajador: 0 filas en las ${ADMINISTRATIVAS.length} vistas administrativas (antes leía ${anotadas.length})`, async () => {
    const mal = [];
    for (const v of ADMINISTRATIVAS) { const n = await contar(claims(TRABAJADOR), v); if (n !== 0) mal.push(`${v}: ${n}`); }
    if (mal.length) throw new Error(mal.join("; "));
  });
  await prueba(`trabajador: los ${VISTAS_CATALOGO.length} catálogos siguen legibles (mismas filas que antes)`, async () => {
    for (const v of VISTAS_CATALOGO) igual(await contar(claims(TRABAJADOR), v), antes[v].dueno, v);
  });
  await prueba(`trabajador: las ${VISTAS_PORTAL.length} vistas v_portal_* devuelven lo mismo que antes; al administrador 0`, async () => {
    for (const v of VISTAS_PORTAL) { igual(await contar(claims(TRABAJADOR), v), antes[v].trabajador, `${v} trabajador`); igual(await contar(claims(ADMIN), v), 0, `${v} admin`); }
    const conFilas = VISTAS_PORTAL.filter((v) => antes[v].trabajador > 0);
    if (conFilas.length < 3) throw new Error(`el seed debería dar filas al trabajador en varias v_portal_*; solo ${conFilas.join(", ")}`);
  });
  await prueba("trabajador: 0 filas al leer directamente cualquier tabla base con SELECT (RLS), salvo catálogos", async () => {
    const mal = [];
    for (const t of TABLAS_ADMIN) { const n = await contar(claims(TRABAJADOR), t); if (n !== 0) mal.push(`${t}: ${n}`); }
    if (mal.length) throw new Error(mal.join("; "));
    for (const t of TABLAS_SESION) if ((await contar(claims(TRABAJADOR), t)) !== (await conteoDueno(t))) throw new Error(`${t}: catálogo no legible`);
  });
  await prueba("trabajador: no puede escribir (sin grant → permission denied; con grant → 0 filas afectadas por RLS)", async () => {
    const i = await como("authenticated", claims(TRABAJADOR), `insert into solicitud_tipos (id, nombre) values ('zz', 'zz')`);
    if (i.codigo !== "42501") throw new Error(`insert solicitud_tipos: ${i.codigo ?? "pasó"} ${i.mensaje ?? ""}`);
    const u = await como("authenticated", claims(TRABAJADOR), `update personas set nombre = 'zz' where dni = $1`, [TRABAJADOR.dni]);
    if (u.codigo || u.n !== 0) throw new Error(`update personas: ${u.codigo ?? `${u.n} filas`} ${u.mensaje ?? ""}`);
    const d = await como("authenticated", claims(TRABAJADOR), `delete from comunicados`);
    if (d.codigo || d.n !== 0) throw new Error(`delete comunicados: ${d.codigo ?? `${d.n} filas`} ${d.mensaje ?? ""}`);
  });
  await prueba("administrador: lee directamente las tablas base (lectura interina documentada) pero no escribe salvo las 5 de FUENTES", async () => {
    igual(await contar(claims(ADMIN), "personas"), await conteoDueno("personas"), "personas");
    const u = await como("authenticated", claims(ADMIN), `update personas set nombre = 'zz' where dni = $1`, [TRABAJADOR.dni]);
    if (u.codigo || u.n !== 0) throw new Error(`update personas como admin: ${u.codigo ?? `${u.n} filas`} ${u.mensaje ?? ""}`);
    const e = await como("authenticated", claims(ADMIN), `update empresas set nombre = nombre`);
    if (e.codigo || e.n === 0) throw new Error(`update empresas como admin (solo_admin FOR ALL): ${e.codigo ?? "0 filas"} ${e.mensaje ?? ""}`);
  });
  await prueba("sesión sin identidad: 0 filas en vistas, catálogos y tablas", async () => {
    for (const r of ["v_personal", "v_usuarios_admin", "v_solicitud_tipos", "personas", "solicitud_tipos", "v_portal_perfil"]) igual(await contar(NADIE, r), 0, r);
  });
  await prueba("anon: sigue sin leer vistas ni tablas", async () => {
    for (const r of ["v_personal", "v_solicitud_tipos", "personas", "solicitud_tipos"]) {
      const x = await como("anon", { role: "anon" }, `select count(*) from public.${r}`);
      if (x.codigo !== "42501") throw new Error(`${r}: ${x.codigo ?? "pasó"}`);
    }
  });
  await prueba("la migración NO se re-aplica sobre sí misma (precondición)", async () => {
    const r = await como("postgres", null, MIGRACION);
    if (!r.codigo || !/ya hay \d+ vistas con security_invoker/.test(r.mensaje ?? "")) throw new Error(`esperaba fallo de precondición: ${r.codigo ?? "pasó"} ${r.mensaje ?? ""}`);
  });

  console.log("\n== 3 · Reversión y re-aplicación");
  await prueba("la reversión se aplica sin errores", async () => { await sql(REVERSION); });
  await prueba("la foto de permisos tras revertir es idéntica a la de la fase 1", async () => {
    const dif = compararFotos(foto0, await foto());
    if (dif.length) throw new Error(`${dif.length} diferencias:\n   ` + dif.slice(0, 15).join("\n   "));
  });
  await prueba("tras revertir, el trabajador vuelve a leer v_personal (estado anterior, el que la fase 2 cierra)", async () => {
    igual(await contar(claims(TRABAJADOR), "v_personal"), antes.v_personal.dueno, "v_personal");
  });
  await prueba("la fase 2 vuelve a aplicarse sobre el estado revertido", async () => { await sql(MIGRACION); });
  await prueba("y el comportamiento es el mismo (admin lee, trabajador no)", async () => {
    igual(await contar(claims(ADMIN), "v_personal"), antes.v_personal.dueno, "admin");
    igual(await contar(claims(TRABAJADOR), "v_personal"), 0, "trabajador");
  });
} finally {
  await bd.parar();
}
console.log(`\n${ok} verdes, ${fallos} fallo(s).`);
process.exit(fallos ? 1 : 0);
