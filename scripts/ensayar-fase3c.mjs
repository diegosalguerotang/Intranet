// scripts/ensayar-fase3c.mjs — Ensayo LOCAL de la FASE 3c (claves de equipos →
// referencia al gestor de contraseñas) sobre el entorno 2.5 en estado de la
// fase 3b (seguridad.sql sin el bloque 3c) + datos anonimizados.
// Uso: node scripts/ensayar-fase3c.mjs
import { readFileSync } from "node:fs";
import { arrancarPgLocal, cargarDatosAnonimizados } from "./pg-local.mjs";
import { FECHA, sinFase3c } from "./fase3c-generar.mjs";

const MIGRACION = readFileSync(`supabase/migraciones/${FECHA}-fase3c-claves-equipos.sql`, "utf8");
const REVERSION = readFileSync(`supabase/respaldos/${FECHA}-fase3c-reversion.sql`, "utf8");
const SEGURIDAD_3B = sinFase3c(readFileSync("supabase/seguridad.sql", "utf8"));

let fallos = 0, ok = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); await cliente.query("rollback").catch(() => {}); }
};
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const bd = await arrancarPgLocal({ seguridad: false, datos: false });
const { sql, cliente } = bd;
await sql(SEGURIDAD_3B);
await cargarDatosAnonimizados(sql);
await sql("set search_path = public, interno, extensions");

const como = async (rol, claims, pasos) => {
  await cliente.query("begin");
  try {
    await cliente.query(`set local role ${rol}`);
    await cliente.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims ?? { role: rol })]);
    let r; for (const [texto, params] of pasos) r = await cliente.query(texto, params);
    return { filas: r.rows, n: r.rowCount };
  } catch (e) { return { codigo: e.code, mensaje: e.message }; }
  finally { await cliente.query("rollback"); }
};
const claims = (u) => ({ role: "authenticated", email: u.correo, sub: u.sub });
const [SUPER] = await sql(`select ua.correo, au.id as sub from usuarios_admin ua join auth.users au on lower(au.email) = lower(ua.correo)
  join perfiles p on p.id = ua.perfil_id and p.version = ua.perfil_version where ua.estado = 'activo' and p.es_superadmin order by ua.id limit 1`);
// Administrador con Activos ≥ 2 pero sin marca de superadmin, si el volcado lo trae.
const [TI] = await sql(`select ua.correo, au.id as sub from usuarios_admin ua join auth.users au on lower(au.email) = lower(ua.correo)
  join perfiles p on p.id = ua.perfil_id and p.version = ua.perfil_version
  join perfil_permisos pp on pp.perfil_id = p.id and pp.perfil_version = p.version and pp.modulo = 'activos' and pp.nivel >= 2
  where ua.estado = 'activo' and not p.es_superadmin order by ua.id limit 1`);
const [PERSONA] = await sql(`select dni from personas where dni ~ '^9[0-9]{7}$' order by dni limit 1`);
const TRABAJADOR = { correo: `${PERSONA.dni}@portal.grupoer.pe`, sub: "11111111-1111-1111-1111-111111111111" };
const [ACTIVO] = await sql(`select codigo from activos order by codigo limit 1`);
if (!SUPER || !ACTIVO) throw new Error("el volcado no trae superadministrador o activos");

const foto = async () => {
  const filas = await sql(`
    select 'fn:' || p.oid::regprocedure::text as objeto,
           coalesce(p.proacl::text, '') || '|definer=' || p.prosecdef::text || '|config=' || coalesce(array_to_string(p.proconfig, ';'), '') as valor
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'interno')
    union all
    select 'rel:' || n.nspname || '.' || c.relname || ':' || c.relkind::text, coalesce(c.relacl::text, '') || '|rls=' || c.relrowsecurity::text || '|opts=' || coalesce(array_to_string(c.reloptions, ';'), '')
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'interno') and c.relkind in ('r', 'v', 'S')
    union all
    select 'col:' || table_name || '.' || column_name, data_type from information_schema.columns where table_schema = 'public' and table_name in ('activos', 'v_activos')
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

try {
  console.log("== 0 · Base: entorno 2.5 en estado de la fase 3b");
  const foto0 = await foto();
  const [{ antes }] = await sql(`select count(*)::int as antes from v_activos`);
  await prueba("hoy: activos.clave_equipo existe (vacía) y ver_clave_equipo es solo superadmin", async () => {
    const [{ n }] = await sql(`select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'activos' and column_name = 'clave_equipo'`); igual(n, 1, "columna");
    if (TI) { const r = await como("authenticated", claims(TI), [[`select ver_clave_equipo($1, 'ensayo')`, [ACTIVO.codigo]]]); if (!r.codigo) throw new Error("un administrador de TI no debería poder hoy"); }
  });
  await prueba("con una clave guardada la migración se NIEGA (hay que pasarla al gestor primero)", async () => {
    await sql(`update activos set clave_equipo = 'secreto' where codigo = $1`, [ACTIVO.codigo]);
    const r = await como("postgres", null, [[MIGRACION]]);
    if (!r.codigo || !/pásalas al gestor/.test(r.mensaje ?? "")) throw new Error(`esperaba negativa: ${r.codigo ?? "pasó"} ${r.mensaje ?? ""}`);
    await sql(`update activos set clave_equipo = null where codigo = $1`, [ACTIVO.codigo]);
  });

  console.log("\n== 1 · Aplicar la fase 3c");
  await prueba("la migración se aplica sin errores (verificación embebida incluida)", async () => { await sql(MIGRACION); });
  await prueba("catálogo: sin clave_equipo, con clave_gestor; v_activos la expone y sigue security_invoker; mismas filas", async () => {
    const [{ a, b }] = await sql(`select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'activos' and column_name = 'clave_equipo')::int as a,
      (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'v_activos' and column_name = 'clave_gestor')::int as b`);
    igual(`${a}/${b}`, "0/1", "columnas");
    igual((await sql(`select count(*)::int as n from v_activos`))[0].n, antes, "filas");
  });
  await prueba("superadministrador: guarda la referencia, la lee por ver_clave_equipo y por v_activos; la auditoría lleva la referencia (no es secreto)", async () => {
    const r = await como("authenticated", claims(SUPER), [
      [`select guardar_clave_equipo($1, 'Bitwarden · LAP-014', 'ensayo')`, [ACTIVO.codigo]],
      [`select ver_clave_equipo($1, 'ensayo') as v, (select clave_gestor from v_activos where codigo = $1) as w, (select tiene_clave from v_activos where codigo = $1) as t, (select datos_despues ->> 'referencia' from auditoria where accion = 'REFERENCIA_CLAVE_GUARDADA' order by id desc limit 1) as a`, [ACTIVO.codigo]]]);
    if (r.codigo) throw new Error(`${r.codigo} ${r.mensaje}`);
    igual(r.filas[0].v, "Bitwarden · LAP-014", "ver"); igual(r.filas[0].w, "Bitwarden · LAP-014", "vista"); igual(r.filas[0].t, true, "tiene_clave"); igual(r.filas[0].a, "Bitwarden · LAP-014", "auditoría");
  });
  if (TI) await prueba("administrador con Activos ≥ 2 (sin superadmin): ahora sí guarda y lee la referencia", async () => {
    const r = await como("authenticated", claims(TI), [[`select guardar_clave_equipo($1, 'KeePass/TI/PC-01', 'ensayo')`, [ACTIVO.codigo]], [`select ver_clave_equipo($1, 'ensayo') as v`, [ACTIVO.codigo]]]);
    if (r.codigo) throw new Error(`${r.codigo} ${r.mensaje}`); igual(r.filas[0].v, "KeePass/TI/PC-01", "ver");
  }); else console.log("  (el volcado no trae un administrador de TI sin superadmin: se salta)");
  await prueba("trabajador: guardar → Permiso insuficiente; ver → sin categoría; v_activos 0 filas", async () => {
    const g = await como("authenticated", claims(TRABAJADOR), [[`select guardar_clave_equipo($1, 'x', 'ensayo')`, [ACTIVO.codigo]]]);
    igual(g.codigo, "42501", "guardar");
    const v = await como("authenticated", claims(TRABAJADOR), [[`select ver_clave_equipo($1, 'ensayo')`, [ACTIVO.codigo]]]);
    if (!v.codigo) throw new Error("ver_clave_equipo no exigió nivel");
    const c = await como("authenticated", claims(TRABAJADOR), [[`select count(*)::int as n from v_activos`]]); igual(c.filas[0].n, 0, "v_activos");
  });
  await prueba("la migración NO se re-aplica sobre sí misma (precondición)", async () => {
    const r = await como("postgres", null, [[MIGRACION]]);
    if (!r.codigo || !/no existe|ya existe/.test(r.mensaje ?? "")) throw new Error(`esperaba fallo de precondición: ${r.codigo ?? "pasó"} ${r.mensaje ?? ""}`);
  });

  console.log("\n== 2 · Reversión y re-aplicación");
  await prueba("la reversión se aplica sin errores", async () => { await sql(REVERSION); });
  await prueba("la foto (funciones, relaciones, columnas de activos y v_activos) es idéntica a la de la fase 3b", async () => {
    const dif = compararFotos(foto0, await foto());
    if (dif.length) throw new Error(`${dif.length} diferencias:\n   ` + dif.slice(0, 15).join("\n   "));
  });
  await prueba("la fase 3c vuelve a aplicarse sobre el estado revertido", async () => { await sql(MIGRACION); });
} finally {
  await bd.parar();
}
console.log(`\n${ok} verdes, ${fallos} fallo(s).`);
process.exit(fallos ? 1 : 0);
