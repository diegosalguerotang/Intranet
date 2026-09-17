// scripts/ensayar-fase1.mjs — ENSAYO en Postgres local de la FASE 1 (cimiento)
// y de su reversión. No toca producción.
//   base local = canónicos (ya con guardas) → fase 0 + 0b aplicadas → foto A
//   → fase 1 → catálogo + comportamiento (trabajador / admin sin superadmin /
//   superadmin / rol de servicio) → reversión → foto B == foto A → re-aplicar.
// Uso: node scripts/ensayar-fase1.mjs
import { readFileSync } from "node:fs";
import { arrancarPgLocal } from "./pg-local.mjs";
import { GUARDAS, NOMBRES } from "./fase1-generar.mjs";

// La fase 0 se aplica SIN su precondición (foto del paso 0): los canónicos ya
// traen los ayudantes de la fase 1 y la cuenta de funciones no coincide.
const FASE0 = readFileSync("supabase/migraciones/2026-09-17-fase0-contencion.sql", "utf8")
  .replace(/-- 0 · Precondición[\s\S]*?end \$\$;/, "-- (precondición omitida en el ensayo de la fase 1)")
  + "\n" + readFileSync("supabase/migraciones/2026-09-17-fase0b-tablas-backoffice.sql", "utf8");
const FASE1 = readFileSync("supabase/migraciones/2026-09-17-fase1-cimiento.sql", "utf8");
const REVERSION = readFileSync("supabase/respaldos/2026-09-17-fase1-reversion.sql", "utf8");
const CON_GRANT = NOMBRES.filter((n) => GUARDAS[n].grant);

let fallos = 0, ok = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`✓ ${nombre}`); }
  catch (e) {
    fallos++; console.error(`✗ ${nombre}: ${e.message}`);
    await cliente.query("rollback").catch(() => {});  // una migración fallida deja la transacción abortada
  }
};
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const bd = await arrancarPgLocal();
const { sql, cliente } = bd;
// La huérfana se elimina y no se restituye; los ayudantes existen en local
// desde los canónicos (en prod nacen con la fase 1 y la reversión los borra).
const IGNORAR = new Set(["fn:asignar_activo(text,text,text)", "fn:correo_llamador()", "fn:es_admin()", "fn:es_superadmin()",
  "fn:nivel_en(text)", "fn:requiere_nivel(text,integer,text)", "fn:requiere_superadmin()", "fn:requiere_correo_propio(text)"]);
const foto = async () => {
  const filas = await sql(`
    select 'fn:' || p.oid::regprocedure::text as objeto,
           coalesce(p.proacl::text, '') || '|definer=' || p.prosecdef::text || '|config=' || coalesce(array_to_string(p.proconfig, ';'), '') as valor
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    union all
    select 'rel:' || c.relname || ':' || c.relkind::text, coalesce(c.relacl::text, '') || '|rls=' || c.relrowsecurity::text
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'v', 'S')
    union all
    select 'pol:' || tablename || '.' || policyname, roles::text || '|' || cmd::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
      from pg_policies where schemaname = 'public'
    union all
    select 'def:' || defaclrole::regrole::text || ':' || coalesce(defaclnamespace::regnamespace::text, '-') || ':' || defaclobjtype::text, defaclacl::text
      from pg_default_acl
    order by 1`);
  const normal = (v) => v.replace(/\{([^}]*)\}/g, (_, s) => "{" + s.split(",").sort().join(",") + "}");
  return new Map(filas.filter((f) => !IGNORAR.has(f.objeto)).map((f) => [f.objeto, normal(f.valor)]));
};
const compararFotos = (a, b) => {
  const dif = [];
  for (const [k, v] of a) if (!b.has(k)) dif.push(`falta tras revertir: ${k}`); else if (b.get(k) !== v) dif.push(`difiere ${k}: antes=${v} después=${b.get(k)}`);
  for (const k of b.keys()) if (!a.has(k)) dif.push(`sobra tras revertir: ${k}`);
  return dif;
};

// Identidades: trabajadora Rosa (seed), superadmin Diego (seed), y un
// administrador SIN superadmin con Personal 3, Boletas 2, Activos 2 (creado aquí).
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
    return { filas: r.rows };
  } catch (e) { return { codigo: e.code, mensaje: e.message }; }
  finally { await cliente.query("rollback"); }
};
const claims = (id) => ({ role: "authenticated", email: id.correo, sub: id.sub });
const guardaDenego = (r) => r.codigo === "42501" && /Permiso insuficiente/.test(r.mensaje ?? "");
const fnDenegada = (r) => r.codigo === "42501" && /permission denied for function/i.test(r.mensaje ?? "");
const llamadaNula = async (nombre) => {
  const [f] = await sql(`select (select string_agg('null::' || format_type(t, null), ', ' order by o) from unnest(p.proargtypes) with ordinality as u(t, o)) as args
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = $1 order by p.pronargs desc limit 1`, [nombre]);
  return `select ${nombre}(${f.args ?? ""})`;
};

try {
  console.log("\n== 0 · Base: fase 0 + 0b aplicadas");
  await prueba("fase 0 y 0b se aplican en local", async () => { await sql(FASE0); });
  const fotoA = await foto();
  console.log(`   foto A: ${fotoA.size} entradas`);

  console.log("\n== 1 · Aplicar la fase 1");
  await prueba("la migración de la fase 1 se aplica sin errores (verificación embebida incluida)", async () => { await sql(FASE1); });

  console.log("\n== 2 · Catálogo");
  await prueba("ayudantes: definer, stable y con search_path", async () => {
    const l = await sql(`select proname, prosecdef, provolatile, coalesce(array_to_string(proconfig, ';'), '') as cfg from pg_proc p join pg_namespace s on s.oid=p.pronamespace
      where s.nspname='public' and proname in ('correo_llamador','es_admin','es_superadmin','nivel_en','requiere_nivel','requiere_superadmin','requiere_correo_propio') order by 1`);
    igual(l.length, 7, "ayudantes");
    for (const f of l) { igual(f.prosecdef, true, `${f.proname} definer`); igual(f.provolatile, "s", `${f.proname} stable`); if (!f.cfg.includes("search_path")) throw new Error(`${f.proname} sin search_path`); }
  });
  await prueba("una función nueva nace SIN execute para authenticated (default privileges)", async () => {
    await sql(`create function zz_nueva() returns int language sql as $$ select 1 $$`);
    const [{ a, s }] = await sql(`select has_function_privilege('authenticated','zz_nueva()','execute') as a, has_function_privilege('service_role','zz_nueva()','execute') as s`);
    await sql(`drop function zz_nueva()`);
    igual(a, false, "authenticated"); igual(s, true, "service_role");
  });
  await prueba("la sobrecarga huérfana asignar_activo(text,text,text) ya no existe", async () => {
    const [{ n }] = await sql(`select count(*)::int as n from pg_proc where proname='asignar_activo'`); igual(n, 1, "sobrecargas");
  });

  console.log("\n== 3 · Trabajador del Portal: las 25 administrativas re-otorgadas responden 42501 por la GUARDA");
  let denegadas = 0;
  for (const n of CON_GRANT) {
    const r = await como("authenticated", claims(TRABAJADOR), await llamadaNula(n));
    if (guardaDenego(r)) denegadas++; else { fallos++; console.error(`✗ trabajador: ${n} no fue denegada por la guarda (${r.codigo ?? "éxito"} ${r.mensaje ?? ""})`); }
  }
  ok++; console.log(`✓ trabajador: ${denegadas}/${CON_GRANT.length} denegadas con «Permiso insuficiente»`);
  await prueba("trabajador: eliminar_usuario_admin sigue sin EXECUTE (solo llave de servicio)", async () => {
    if (!fnDenegada(await como("authenticated", claims(TRABAJADOR), `select eliminar_usuario_admin(1)`))) throw new Error("no denegada por permiso de función");
  });
  await prueba("trabajador: es_admin() = false, es_superadmin() = false, nivel_en('personal') = 0", async () => {
    const r = await como("authenticated", claims(TRABAJADOR), `select es_admin() as a, es_superadmin() as s, nivel_en('personal') as n`);
    if (r.codigo) throw new Error(r.mensaje); igual(r.filas[0].a, false, "es_admin"); igual(r.filas[0].s, false, "es_superadmin"); igual(r.filas[0].n, 0, "nivel");
  });

  console.log("\n== 4 · Administrador SIN superadmin (Personal 3, Boletas 2, Activos 2, Memorándums 2)");
  await prueba("admin: es_admin() = true, es_superadmin() = false, nivel_en('personal') = 3", async () => {
    const r = await como("authenticated", claims(ADMIN), `select es_admin() as a, es_superadmin() as s, nivel_en('personal') as n`);
    if (r.codigo) throw new Error(r.mensaje); igual(r.filas[0].a, true, "es_admin"); igual(r.filas[0].s, false, "es_superadmin"); igual(r.filas[0].n, 3, "nivel");
  });
  for (const n of ["crear_usuario_admin", "guardar_perfil", "actualizar_usuario_admin", "suspender_usuario_admin", "reactivar_usuario_admin", "reenviar_clave", "eliminar_perfil", "desactivar_perfil", "guardar_politica"]) {
    await prueba(`admin sin superadmin: ${n} → Permiso insuficiente (solo superadmin)`, async () => {
      const r = await como("authenticated", claims(ADMIN), await llamadaNula(n));
      if (!guardaDenego(r)) throw new Error(`${r.codigo ?? "éxito"} ${r.mensaje ?? ""}`);
    });
  }
  await prueba("admin: alta_trabajador pasa la guarda (Personal 3) y falla después por validación", async () => {
    const r = await como("authenticated", claims(ADMIN), `select alta_trabajador('ZZ', 'x', 'x', 'x', 'x', current_date, null, null, null, null, null, 'DNI')`);
    if (guardaDenego(r)) throw new Error(r.mensaje); if (!r.codigo) throw new Error("no debería crear con DNI 'ZZ'");
  });
  await prueba("admin: publicar_comunicado → Permiso insuficiente (Comunicados 0)", async () => {
    const r = await como("authenticated", claims(ADMIN), await llamadaNula("publicar_comunicado"));
    if (!guardaDenego(r)) throw new Error(`${r.codigo ?? "éxito"} ${r.mensaje ?? ""}`);
  });
  await prueba("admin: resolver_memorandum → Permiso insuficiente (Memorándums 2 < 3) y notificar_memorandum pasa", async () => {
    const r1 = await como("authenticated", claims(ADMIN), `select resolver_memorandum('x','x')`);
    if (!guardaDenego(r1)) throw new Error(`resolver: ${r1.codigo ?? "éxito"} ${r1.mensaje ?? ""}`);
    const r2 = await como("authenticated", claims(ADMIN), `select notificar_memorandum('x')`);
    if (guardaDenego(r2)) throw new Error(`notificar: ${r2.mensaje}`);
  });
  await prueba("admin: marcar_clave_cambiada solo sobre SU correo", async () => {
    const propio = await como("authenticated", claims(ADMIN), `select marcar_clave_cambiada($1)`, [ADMIN.correo]);
    if (propio.codigo) throw new Error(`propio: ${propio.mensaje}`);
    const ajeno = await como("authenticated", claims(ADMIN), `select marcar_clave_cambiada($1)`, [SUPER.correo]);
    if (!guardaDenego(ajeno)) throw new Error(`ajeno: ${ajeno.codigo ?? "éxito"} ${ajeno.mensaje ?? ""}`);
  });
  await prueba("admin: crear_sede pasa por Personal (módulo alternativo)", async () => {
    const r = await como("authenticated", claims(ADMIN), `select crear_sede('promant', 'ZZ Sede', 'ZZ Cliente', 'x', 'ensayo', null)`);
    if (guardaDenego(r)) throw new Error(r.mensaje);
  });

  console.log("\n== 5 · Superadministrador");
  await prueba("superadmin: es_superadmin() = true y crear_usuario_admin pasa la guarda (falla por validación)", async () => {
    const r = await como("authenticated", claims(SUPER), `select es_superadmin() as s`);
    if (r.codigo) throw new Error(r.mensaje); igual(r.filas[0].s, true, "es_superadmin");
    const c = await como("authenticated", claims(SUPER), `select crear_usuario_admin('00000000','superadmin','x@x.com','', null, 'ensayo')`);
    if (guardaDenego(c) || fnDenegada(c)) throw new Error(c.mensaje); if (!c.codigo) throw new Error("no debería crear con DNI inexistente");
  });
  await prueba("superadmin: guardar_perfil y guardar_politica pasan la guarda", async () => {
    const p = await como("authenticated", claims(SUPER), `select guardar_perfil('zz-2','ZZ 2','',false,false,false,false,'{"personal":1}'::jsonb,null,'ensayo',false)`);
    if (p.codigo) throw new Error(`guardar_perfil: ${p.mensaje}`);
    const q = await como("authenticated", claims(SUPER), `select guardar_politica(8, 30, false, false, 5, 15, 'correo', 8, 8, 7, 'ensayo')`);
    if (guardaDenego(q)) throw new Error(`guardar_politica: ${q.mensaje}`);
  });

  console.log("\n== 6 · Rol de servicio / Management API (sin JWT)");
  await prueba("service_role: es_admin() y es_superadmin() = true; eliminar_usuario_admin ejecuta", async () => {
    const r = await como("service_role", { role: "service_role" }, `select es_admin() as a, es_superadmin() as s`);
    if (r.codigo) throw new Error(r.mensaje); igual(r.filas[0].a, true, "es_admin"); igual(r.filas[0].s, true, "es_superadmin");
    const e = await como("service_role", { role: "service_role" }, `select eliminar_usuario_admin(999999)`);
    if (e.codigo === "42501") throw new Error(e.mensaje);
  });
  await prueba("anon: sigue con exactamente las 4 RPC de login", async () => {
    const [{ l }] = await sql(`select string_agg(p.proname, ',' order by p.proname) as l from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and has_function_privilege('anon', p.oid, 'execute')`);
    igual(l, "portal_registrar_ingreso,portal_verificar_bloqueo,registrar_ingreso,verificar_bloqueo", "lista");
  });

  console.log("\n== 7 · Reversión");
  await prueba("la reversión se aplica sin errores", async () => { await sql(REVERSION); });
  await prueba("la foto de permisos tras revertir es idéntica a la de la fase 0", async () => {
    const dif = compararFotos(fotoA, await foto());
    if (dif.length) throw new Error(`${dif.length} diferencias:\n   ` + dif.slice(0, 15).join("\n   "));
  });
  await prueba("tras revertir, los cuerpos vuelven a NO tener la guarda", async () => {
    const [{ n }] = await sql(`select count(*)::int as n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname = any($1) and p.prosrc ~ 'requiere_(nivel|superadmin|correo_propio)\\('`, [NOMBRES]);
    igual(n, 0, "cuerpos con guarda");
  });
  console.log("\n== 8 · Re-aplicar");
  await prueba("la fase 1 vuelve a aplicarse sobre el estado revertido", async () => { await sql(FASE1); });
} finally {
  await bd.parar();
}
console.log(`\n${ok} correctas · ${fallos} fallo(s).`);
process.exit(fallos ? 1 : 0);
