// scripts/ensayar-fase3a.mjs — Ensayo LOCAL de la FASE 3a (esquema privado
// `interno`) sobre el ENTORNO DE PRUEBAS de la fase 2.5: esquema de producción
// + fases 0, 0b, 1 y 2 (seguridad.sql sin el bloque de la fase 3) + datos de
// producción anonimizados.
//
// Comprueba, con sesiones simuladas como PostgREST:
//   · la migración se aplica (verificación embebida incluida);
//   · las 10 tablas están en interno y ninguna en public; RLS y políticas viajan;
//   · un superadministrador y un administrador siguen leyendo las 9 vistas que
//     dependen de esas tablas con las mismas filas; la guarda central sigue
//     funcionando (es_admin, nivel_en, crear_usuario_admin pasa la guarda);
//   · un trabajador sigue en 0 y no puede leer interno.* directamente (RLS);
//   · anon sigue pudiendo hacer login (verificar_bloqueo / registrar_ingreso
//     leen interno vía definer) y NO tiene USAGE en interno;
//   · los disparadores de auditoría escriben en interno.auditoria;
//   · las funciones de servicio responden a service_role y se niegan a
//     authenticated y anon;
//   · la reversión deja la foto de permisos idéntica y la migración se re-aplica.
// Uso: node scripts/ensayar-fase3a.mjs   (requiere supabase/pruebas/datos-anonimizados.sql)
import { readFileSync } from "node:fs";
import { arrancarPgLocal, cargarDatosAnonimizados } from "./pg-local.mjs";
import { FECHA, ESQUEMA, TABLAS, TABLAS_CON_LECTURA_ADMIN, FUNCIONES_SERVICIO, sinFase3 } from "./fase3-generar.mjs";

const MIGRACION_1 = readFileSync(`supabase/migraciones/${FECHA}-fase3a1-funciones-servicio.sql`, "utf8");
const MIGRACION_2 = readFileSync(`supabase/migraciones/${FECHA}-fase3a2-esquema-interno.sql`, "utf8");
const REVERSION_2 = readFileSync(`supabase/respaldos/${FECHA}-fase3a2-reversion.sql`, "utf8");
const REVERSION_1 = readFileSync(`supabase/respaldos/${FECHA}-fase3a1-reversion.sql`, "utf8");
const SEGURIDAD_FASE2 = sinFase3(readFileSync("supabase/seguridad.sql", "utf8"));
const VISTAS = ["v_usuarios_admin", "v_perfiles", "v_perfil_versiones", "v_registro_accesos", "v_politica_acceso", "v_mi_acceso", "v_cargo_perfiles", "v_perfil_propuestas", "v_actividad_persona"];

let fallos = 0, ok = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`✓ ${nombre}`); }
  catch (e) {
    fallos++; console.error(`✗ ${nombre}: ${e.message}`);
    // Una migración fallida (begin … commit en un solo texto) deja la conexión
    // en transacción abortada: se limpia para que las pruebas siguientes corran.
    await cliente.query("rollback").catch(() => {});
  }
};
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

// El canónico api-servicio.sql ya crea las funciones de servicio: el ensayo
// parte del estado ANTERIOR a la fase 3a, así que se quitan primero (la
// migración las vuelve a crear).
// correo_envios nace en seguridad.sql (fase 0), así que el estado de seguridad
// se carga ANTES que el volcado anonimizado.
const bd = await arrancarPgLocal({ seguridad: false, datos: false });
const { sql, cliente } = bd;
await sql(SEGURIDAD_FASE2);
await cargarDatosAnonimizados(sql);
await sql(FUNCIONES_SERVICIO.map((f) => `drop function if exists public.${f};`).join("\n"));

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
// Varias sentencias con la misma sesión simulada (una transacción, se revierte al final).
const comoVarias = async (rol, claims, pasos) => {
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
const contar = async (rol, cl, rel) => {
  const r = await como(rol, cl, `select count(*)::int as n from ${rel}`);
  if (r.codigo) throw new Error(`${rel}: ${r.codigo} ${r.mensaje}`);
  return r.filas[0].n;
};
const conteoDueno = async (rel) => (await sql(`select count(*)::int as n from ${rel}`))[0].n;

// Identidades del volcado anonimizado: un superadmin activo con cuenta, un
// administrador sin marca (si lo hay) y una persona cualquiera como trabajador.
const [SUPER] = await sql(`select ua.correo, au.id as sub from usuarios_admin ua join auth.users au on lower(au.email) = lower(ua.correo)
  join perfiles p on p.id = ua.perfil_id and p.version = ua.perfil_version where ua.estado = 'activo' and p.es_superadmin order by ua.id limit 1`);
const [ADMIN] = await sql(`select ua.correo, au.id as sub from usuarios_admin ua join auth.users au on lower(au.email) = lower(ua.correo)
  join perfiles p on p.id = ua.perfil_id and p.version = ua.perfil_version where ua.estado = 'activo' and not p.es_superadmin order by ua.id limit 1`);
const [PERSONA] = await sql(`select dni from personas where dni ~ '^9[0-9]{7}$' order by dni limit 1`);
const TRABAJADOR = { correo: `${PERSONA.dni}@portal.grupoer.pe`, sub: "11111111-1111-1111-1111-111111111111" };
if (!SUPER) throw new Error("el volcado no trae un superadministrador activo con cuenta");

// Foto de permisos: incluye el esquema en la clave (las tablas cambian de esquema
// y deben volver). Las 20 funciones sin search_path antes de la fase 3a quedan
// con 'public, extensions' tras revertir: se normaliza (más estricto, mismo efecto).
const foto = async () => {
  const filas = await sql(`
    select 'fn:' || p.oid::regprocedure::text as objeto,
           coalesce(p.proacl::text, '') || '|definer=' || p.prosecdef::text || '|config=' ||
           coalesce(nullif(array_to_string(p.proconfig, ';'), ''), 'search_path=public, extensions') as valor
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', '${ESQUEMA}')
    union all
    select 'rel:' || n.nspname || '.' || c.relname || ':' || c.relkind::text, coalesce(c.relacl::text, '') || '|rls=' || c.relrowsecurity::text || '|opts=' || coalesce(array_to_string(c.reloptions, ';'), '')
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', '${ESQUEMA}') and c.relkind in ('r', 'v', 'S')
    union all
    select 'pol:' || schemaname || '.' || tablename || '.' || policyname, roles::text || '|' || cmd::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
      from pg_policies where schemaname in ('public', '${ESQUEMA}')
    union all
    select 'def:' || defaclrole::regrole::text || ':' || coalesce(defaclnamespace::regnamespace::text, '-') || ':' || defaclobjtype::text, defaclacl::text
      from pg_default_acl
    union all
    select 'esq:' || nspname, coalesce(nspacl::text, '') from pg_namespace where nspname in ('public', '${ESQUEMA}')
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

const antes = {};
try {
  console.log("== 0 · Base: entorno 2.5 con fases 0 + 0b + 1 + 2");
  await prueba("las 10 tablas están en public y no existe el esquema interno", async () => {
    const [{ n }] = await sql(`select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' and c.relname = any($1)`, [TABLAS]);
    igual(n, TABLAS.length, "tablas"); igual((await sql(`select count(*)::int as n from pg_namespace where nspname = $1`, [ESQUEMA]))[0].n, 0, "esquema");
  });
  const foto0 = await foto();
  for (const v of VISTAS) antes[v] = { dueno: await conteoDueno(v), superadmin: await contar("authenticated", claims(SUPER), v), admin: ADMIN ? await contar("authenticated", claims(ADMIN), v) : null, trabajador: await contar("authenticated", claims(TRABAJADOR), v) };
  antes.auditoria = await conteoDueno("auditoria");

  console.log("\n== 1 · Aplicar la fase 3a");
  await prueba("paso 1: las funciones de servicio se crean y funcionan con las tablas aún en public", async () => {
    await sql(MIGRACION_1);
    const s = await como("service_role", { role: "service_role" }, `select * from api_admin_por_correo($1, true)`, [SUPER.correo]);
    if (s.codigo || s.filas.length !== 1) throw new Error(`service_role antes de mover: ${s.codigo ?? `${s.filas?.length} filas`} ${s.mensaje ?? ""}`);
  });
  await prueba("paso 2: la migración del esquema se aplica sin errores (verificación embebida incluida)", async () => { await sql(MIGRACION_2); });
  await prueba(`catálogo: ${TABLAS.length} tablas en ${ESQUEMA} con RLS y lectura_admin; ninguna en public; secuencias movidas`, async () => {
    const l = await sql(`select c.relname as t, c.relrowsecurity as rls, (select count(*)::int from pg_policies p where p.schemaname = $1 and p.tablename = c.relname and p.policyname = 'lectura_admin') as pol
      from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = $1 and c.relkind = 'r' order by 1`, [ESQUEMA]);
    igual(l.map((x) => x.t).join(","), [...TABLAS].sort().join(","), "tablas");
    for (const x of l) { igual(x.rls, true, `${x.t} rls`); igual(x.pol, TABLAS_CON_LECTURA_ADMIN.includes(x.t) ? 1 : 0, `${x.t} lectura_admin`); }
    const [{ n }] = await sql(`select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = $1 and c.relkind = 'S'`, [ESQUEMA]);
    igual(n, 4, "secuencias en interno");
  });
  await prueba("catálogo: todas las funciones de public llevan interno en search_path; ninguna sin search_path", async () => {
    const [{ n }] = await sql(`select count(*)::int as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%' and c like '%interno%')`);
    igual(n, 0, "sin interno");
    const [{ m }] = await sql(`select count(*)::int as m from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.prokind = 'f'
      and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%' and c like '%interno%interno%')`);
    igual(m, 0, "interno duplicado");
  });
  await prueba("catálogo: anon sin USAGE en interno; authenticated y service_role con USAGE", async () => {
    const [r] = await sql(`select has_schema_privilege('anon', $1, 'usage') as a, has_schema_privilege('authenticated', $1, 'usage') as u, has_schema_privilege('service_role', $1, 'usage') as s`, [ESQUEMA]);
    igual(`${r.a}${r.u}${r.s}`, "falsetruetrue", "usage");
  });

  console.log("\n== 2 · Comportamiento");
  await prueba("superadministrador: las 9 vistas devuelven las mismas filas que antes; es_admin y nivel_en('accesos') = 99", async () => {
    for (const v of VISTAS) igual(await contar("authenticated", claims(SUPER), v), antes[v].superadmin, v);
    const r = await como("authenticated", claims(SUPER), `select es_admin() as a, es_superadmin() as s, nivel_en('accesos') as n`);
    igual(`${r.filas[0].a}/${r.filas[0].s}/${r.filas[0].n}`, "true/true/99", "guarda");
  });
  await prueba("superadministrador: crear_usuario_admin pasa la guarda y falla por validación (DNI inexistente)", async () => {
    const r = await como("authenticated", claims(SUPER), `select crear_usuario_admin('00000000', 'superadmin', 'x@x.com', '', null, 'ensayo')`);
    if (!r.codigo || /Permiso insuficiente|permission denied|does not exist/i.test(r.mensaje) && /relation|schema/i.test(r.mensaje)) throw new Error(`${r.codigo ?? "pasó"} ${r.mensaje ?? ""}`);
  });
  if (ADMIN) await prueba("administrador sin marca: las 9 vistas igual que antes; es_superadmin = false", async () => {
    for (const v of VISTAS) igual(await contar("authenticated", claims(ADMIN), v), antes[v].admin, v);
    igual((await como("authenticated", claims(ADMIN), `select es_superadmin() as s`)).filas[0].s, false, "superadmin");
  }); else console.log("  (el volcado no trae un administrador sin marca de superadmin: se salta)");
  await prueba("trabajador: 0 filas en las 9 vistas y en interno.usuarios_admin / interno.auditoria directo (RLS); es_admin = false", async () => {
    for (const v of VISTAS) igual(await contar("authenticated", claims(TRABAJADOR), v), 0, v);
    for (const t of ["usuarios_admin", "auditoria", "registro_accesos", "perfiles"]) igual(await contar("authenticated", claims(TRABAJADOR), `${ESQUEMA}.${t}`), 0, t);
    igual((await como("authenticated", claims(TRABAJADOR), `select es_admin() as a`)).filas[0].a, false, "es_admin");
  });
  await prueba("anon: verificar_bloqueo y portal_verificar_bloqueo responden (leen interno vía definer); no puede tocar interno.* directo", async () => {
    for (const q of [`select verificar_bloqueo('nadie@ejemplo.invalido')`, `select portal_verificar_bloqueo('00000000')`]) {
      const r = await como("anon", { role: "anon" }, q); if (r.codigo) throw new Error(`${q}: ${r.codigo} ${r.mensaje}`);
    }
    const r = await como("anon", { role: "anon" }, `select count(*) from ${ESQUEMA}.usuarios_admin`);
    igual(r.codigo, "42501", "anon interno");
  });
  await prueba("los disparadores de auditoría escriben en interno.auditoria (guardar_feriado como superadmin)", async () => {
    const r = await comoVarias("authenticated", claims(SUPER), [[`select guardar_feriado('2099-12-31'::date, 'Feriado de ensayo', 'ensayo')`], [`select count(*)::int as n from ${ESQUEMA}.auditoria`]]);
    if (r.codigo) throw new Error(`${r.codigo} ${r.mensaje}`);
    const n = r.filas[0].n; if (n <= antes.auditoria) throw new Error(`auditoría no creció: ${n} ≤ ${antes.auditoria}`);
  });
  await prueba("funciones de servicio: responden a service_role; authenticated y anon → permission denied", async () => {
    const s = await como("service_role", { role: "service_role" }, `select * from api_admin_por_correo($1, true)`, [SUPER.correo]);
    if (s.codigo || s.filas.length !== 1) throw new Error(`service_role: ${s.codigo ?? `${s.filas?.length} filas`} ${s.mensaje ?? ""}`);
    const t = await comoVarias("service_role", { role: "service_role" }, [[`select api_token_crear('zz-ensayo', $1, 'recuperacion-admin', $2, now() + interval '1 hour')`, [PERSONA.dni, SUPER.correo]], [`select * from api_token_leer('zz-ensayo', array['recuperacion-admin'])`]]);
    if (t.codigo || t.filas.length !== 1) throw new Error(`tokens: ${t.codigo ?? `${t.filas?.length} filas`} ${t.mensaje ?? ""}`);
    const m = await como("service_role", { role: "service_role" }, `select api_admin_marcar_clave(null, $1, false) as n`, [SUPER.correo]);
    if (m.codigo || m.filas[0].n !== 1) throw new Error(`marcar_clave: ${m.codigo ?? m.filas?.[0]?.n} ${m.mensaje ?? ""}`);
    for (const [rol, cl] of [["authenticated", claims(SUPER)], ["anon", { role: "anon" }]]) {
      const r = await como(rol, cl, `select * from api_admin_por_correo($1, true)`, [SUPER.correo]);
      igual(r.codigo, "42501", `${rol} api_admin_por_correo`);
    }
  });
  await prueba("la migración NO se re-aplica sobre sí misma (precondición)", async () => {
    const r = await como("postgres", null, MIGRACION_2);
    if (!r.codigo || !/ya existe/.test(r.mensaje ?? "")) throw new Error(`esperaba fallo de precondición: ${r.codigo ?? "pasó"} ${r.mensaje ?? ""}`);
  });

  console.log("\n== 3 · Reversión y re-aplicación");
  await prueba("las reversiones se aplican sin errores (paso 2 y luego paso 1)", async () => { await sql(REVERSION_2); await sql(REVERSION_1); });
  await prueba("la foto de permisos tras revertir es idéntica a la de la fase 2", async () => {
    const dif = compararFotos(foto0, await foto());
    if (dif.length) throw new Error(`${dif.length} diferencias:\n   ` + dif.slice(0, 15).join("\n   "));
  });
  await prueba("tras revertir, superadmin y trabajador ven lo mismo que al principio", async () => {
    igual(await contar("authenticated", claims(SUPER), "v_usuarios_admin"), antes.v_usuarios_admin.superadmin, "superadmin");
    igual(await contar("authenticated", claims(TRABAJADOR), "v_usuarios_admin"), 0, "trabajador");
  });
  await prueba("la fase 3a vuelve a aplicarse sobre el estado revertido (paso 1 y paso 2)", async () => { await sql(MIGRACION_1); await sql(MIGRACION_2); });
} finally {
  await bd.parar();
}
console.log(`\n${ok} verdes, ${fallos} fallo(s).`);
process.exit(fallos ? 1 : 0);
