// scripts/ensayar-fase4.mjs — Ensayo LOCAL de la FASE 4 (RLS por rol) sobre
// el entorno 2.5 en estado de la fase 3c + datos anonimizados. Crea dos
// categorías de prueba (una con alcance a UNA razón social y módulos limitados;
// otra de TI) y comprueba que cada sesión ve exactamente lo que le toca.
// Uso: node scripts/ensayar-fase4.mjs
import { readFileSync } from "node:fs";
import { arrancarPgLocal, cargarDatosAnonimizados } from "./pg-local.mjs";
import { FECHA, MATRIZ, SIN_POLITICA, VISTAS_PORTAL, AYUDANTES, sinFase4 } from "./fase4-generar.mjs";

const MIGRACION = readFileSync(`supabase/migraciones/${FECHA}-fase4-rls.sql`, "utf8");
const REVERSION = readFileSync(`supabase/respaldos/${FECHA}-fase4-reversion.sql`, "utf8");
const SEGURIDAD_3C = sinFase4(readFileSync("supabase/seguridad.sql", "utf8"));

let fallos = 0, ok = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); await cliente.query("rollback").catch(() => {}); }
};
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const bd = await arrancarPgLocal({ seguridad: false, datos: false });
const { sql, cliente } = bd;
await sql(SEGURIDAD_3C);
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
const contar = async (cl, rel) => { const r = await como("authenticated", cl, [[`select count(*)::int as n from ${rel}`]]); if (r.codigo) throw new Error(`${rel}: ${r.codigo} ${r.mensaje}`); return r.filas[0].n; };
const total = async (q, params) => (await sql(q, params))[0].n;

// --- Identidades ------------------------------------------------------------
const [SUPER] = await sql(`select ua.correo, au.id as sub from usuarios_admin ua join auth.users au on lower(au.email) = lower(ua.correo)
  join perfiles p on p.id = ua.perfil_id and p.version = ua.perfil_version where ua.estado = 'activo' and p.es_superadmin order by ua.id limit 1`);
// Razón social con más vínculos vigentes y otra distinta.
const [E1] = await sql(`select empresa_id as id from vinculos where fecha_fin is null group by 1 order by count(*) desc limit 1`);
const [E2] = await sql(`select id from empresas where id <> $1 order by id limit 1`, [E1.id]);
// Trabajador: persona con vínculo vigente en E1.
const [P] = await sql(`select v.persona_dni as dni, v.sede_id as sede from vinculos v where v.empresa_id = $1 and v.fecha_fin is null and v.persona_dni ~ '^9' order by v.persona_dni limit 1`, [E1.id]);
const TRABAJADOR = { correo: `${P.dni}@portal.grupoer.pe`, sub: "11111111-1111-1111-1111-111111111111" };
// Administrador con alcance a E1 y módulos limitados; administrador de TI con todas las empresas.
const RESTRINGIDO = { dni: null, correo: "zz.alcance@pruebas.invalido", sub: "22222222-2222-2222-2222-222222222223" };
const TI = { dni: null, correo: "zz.ti@pruebas.invalido", sub: "33333333-3333-3333-3333-333333333334" };
const dnis = await sql(`select dni from personas where dni not in (select persona_dni from usuarios_admin) and dni <> $1 order by dni limit 2`, [P.dni]);
RESTRINGIDO.dni = dnis[0].dni; TI.dni = dnis[1].dni;
await sql(`insert into auth.users (id, email) values ($1, $2), ($3, $4)`, [RESTRINGIDO.sub, RESTRINGIDO.correo, TI.sub, TI.correo]);
await sql(`select guardar_perfil('zz-alcance', 'ZZ alcance E1', '', false, false, false, false, '{"personal":1,"boletas":1,"comunicados":2}'::jsonb, array[$1], 'ensayo', false)`, [E1.id]);
await sql(`select guardar_perfil('zz-ti', 'ZZ TI', '', false, false, false, false, '{"activos":2,"soporte":1}'::jsonb, null, 'ensayo', false)`);
await sql(`select crear_usuario_admin($1, 'zz-alcance', $2, '', null, 'ensayo')`, [RESTRINGIDO.dni, RESTRINGIDO.correo]);
await sql(`select crear_usuario_admin($1, 'zz-ti', $2, '', null, 'ensayo')`, [TI.dni, TI.correo]);
// Datos para probar segmentos y el bucket: dos comunicados y cinco objetos.
await sql(`insert into comunicados (titulo, cuerpo, publicado, vence, exige_acuse, segmento, alcance, leidos, empresa_id, sede_id) values
  ('Comunicado E1', 'x', current_date, current_date + 30, true, 'empresa', 0, 0, $1, null),
  ('Comunicado E2', 'x', current_date, current_date + 30, true, 'empresa', 0, 0, $2, null),
  ('Comunicado grupo', 'x', current_date, current_date + 30, false, 'grupo', 0, 0, null, null)`, [E1.id, E2.id]);
await sql(`insert into storage.objects (bucket_id, name) values ('documentos', $1), ('documentos', $2), ('documentos', 'cargos/L-1/x.jpg'), ('documentos', 'rit/general.pdf'), ('documentos', $3)`,
  [`lotes/${E1.id}/2026-09/a.pdf`, `lotes/${E2.id}/2026-09/b.pdf`, `solicitudes/${E1.id}/S-0001.pdf`]);

const foto = async () => {
  const filas = await sql(`
    select 'pol:' || schemaname || '.' || tablename || '.' || policyname as objeto, permissive || '|' || roles::text || '|' || cmd::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '') as valor
      from pg_policies where schemaname in ('public', 'interno', 'storage')
    union all
    select 'rel:' || n.nspname || '.' || c.relname, coalesce(c.relacl::text, '') || '|rls=' || c.relrowsecurity::text || '|opts=' || coalesce(array_to_string(c.reloptions, ';'), '')
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'interno') and c.relkind in ('r', 'v')
    union all
    select 'fn:' || p.oid::regprocedure::text, coalesce(p.proacl::text, '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
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
  console.log(`== 0 · Base: fase 3c + datos (E1=${E1.id}, E2=${E2.id}, trabajador ${P.dni})`);
  const foto0 = await foto();
  const T = {
    personal: await total(`select count(*)::int as n from v_personal`),
    personalE1: await total(`select count(*)::int as n from v_personal where empresa = $1`, [E1.id]),
    activos: await total(`select count(*)::int as n from v_activos`),
    sedesE1: await total(`select count(*)::int as n from sedes where empresa_id = $1`, [E1.id]),
    usuarios: await total(`select count(*)::int as n from v_usuarios_admin`),
    comunicadosE1: await total(`select count(*)::int as n from comunicados where empresa_id = $1 or empresa_id is null`, [E1.id]),
    misSedes: await total(`select count(distinct sede_id)::int as n from vinculos where persona_dni = $1`, [P.dni]),
    boletasP: await total(`select count(*)::int as n from documentos d join vinculos v on v.id = d.vinculo_id where v.persona_dni = $1`, [P.dni]),
  };
  await prueba("hoy: el administrador restringido (personal 1, solo E1) ve TODO el padrón y todas las sedes (lectura_admin interina)", async () => {
    igual(await contar(claims(RESTRINGIDO), "v_personal"), T.personal, "v_personal"); igual(await contar(claims(RESTRINGIDO), "v_activos"), T.activos, "v_activos");
  });

  console.log("\n== 1 · Aplicar la fase 4");
  await prueba("la migración se aplica sin errores (verificación embebida incluida)", async () => { await sql(MIGRACION); });
  await prueba("catálogo: 0 políticas true; toda tabla con RLS; sin política solo la lista «nadie»; 47 vistas invoker; 3 del bucket; ayudantes cerrados a anon", async () => {
    igual(await total(`select count(*)::int as n from pg_policies where schemaname in ('public','interno','storage') and (qual = 'true' or with_check = 'true')`), 0, "true");
    const sin = await sql(`select s.nspname || '.' || c.relname as t from pg_class c join pg_namespace s on s.oid = c.relnamespace
      where s.nspname in ('public','interno') and c.relkind = 'r' and c.relname not like 'respaldo_%' and not exists (select 1 from pg_policies p where p.schemaname = s.nspname and p.tablename = c.relname) order by 1`);
    igual(sin.map((x) => x.t).join(","), [...SIN_POLITICA].sort().join(","), "sin política");
    igual(await total(`select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'v' and 'security_invoker=on' = any(coalesce(c.reloptions, '{}'))`), 47, "invoker");
    igual(await total(`select count(*)::int as n from pg_policies where schemaname = 'storage'`), 3, "bucket");
    for (const f of AYUDANTES) { const [x] = await sql(`select has_function_privilege('anon', $1, 'execute') as a, has_function_privilege('authenticated', $1, 'execute') as u`, [`public.${f}`]); igual(`${x.a}${x.u}`, "falsetrue", f); }
    igual(Object.keys(MATRIZ).length + SIN_POLITICA.length, await total(`select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname in ('public','interno') and c.relkind = 'r' and c.relname not like 'respaldo_%'`), "la matriz cubre todas las tablas");
  });

  console.log("\n== 2 · Comportamiento");
  await prueba("superadministrador: sigue viendo todo (padrón, activos, usuarios)", async () => {
    igual(await contar(claims(SUPER), "v_personal"), T.personal, "v_personal"); igual(await contar(claims(SUPER), "v_activos"), T.activos, "v_activos"); igual(await contar(claims(SUPER), "v_usuarios_admin"), T.usuarios, "v_usuarios_admin");
  });
  await prueba("administrador restringido: padrón y sedes SOLO de E1; activos 0; comunicados de E1 y del grupo; su propio acceso y nada más", async () => {
    igual(await contar(claims(RESTRINGIDO), "v_personal"), T.personalE1, "v_personal E1");
    igual(await contar(claims(RESTRINGIDO), "v_sedes"), T.sedesE1, "v_sedes E1");
    igual(await contar(claims(RESTRINGIDO), "v_activos"), 0, "v_activos");
    igual(await contar(claims(RESTRINGIDO), "v_comunicados"), T.comunicadosE1, "v_comunicados");
    igual(await contar(claims(RESTRINGIDO), "v_mi_acceso"), 1, "v_mi_acceso"); igual(await contar(claims(RESTRINGIDO), "v_usuarios_admin"), 1, "v_usuarios_admin propio");
    igual(await contar(claims(RESTRINGIDO), "v_perfiles"), 1, "v_perfiles propio"); igual(await contar(claims(RESTRINGIDO), "v_registro_accesos"), 0, "registro");
    const esperadoAud = await total(`select count(*)::int as n from interno.auditoria a where public.fn_dni_auditoria(a.datos_antes, a.datos_despues) is not null
      and (exists (select 1 from vinculos v where v.persona_dni = public.fn_dni_auditoria(a.datos_antes, a.datos_despues) and v.empresa_id = $1)
           or not exists (select 1 from vinculos v where v.persona_dni = public.fn_dni_auditoria(a.datos_antes, a.datos_despues)))`, [E1.id]);
    igual(await contar(claims(RESTRINGIDO), "interno.auditoria"), esperadoAud, "auditoría: solo filas de personas de E1 (sin módulo Auditoría)");
  });
  await prueba("administrador restringido: pedir una persona de OTRA razón social devuelve vacío, no error", async () => {
    const [otra] = await sql(`select v.persona_dni as dni from vinculos v where v.empresa_id <> $1 and v.persona_dni not in (select persona_dni from vinculos where empresa_id = $1) limit 1`, [E1.id]);
    if (!otra) throw new Error("no hay persona exclusiva de otra empresa en el volcado");
    const r = await como("authenticated", claims(RESTRINGIDO), [[`select count(*)::int as n from v_personal where dni = $1`, [otra.dni]]]);
    if (r.codigo) throw new Error(`error en vez de vacío: ${r.codigo} ${r.mensaje}`); igual(r.filas[0].n, 0, "filas");
  });
  await prueba("administrador de TI (activos 2, todas las empresas): activos completos, padrón completo, acuses 0, sin escribir empresas", async () => {
    igual(await contar(claims(TI), "v_activos"), T.activos, "v_activos"); igual(await contar(claims(TI), "v_personal"), T.personal, "v_personal"); igual(await contar(claims(TI), "v_acuses"), 0, "v_acuses");
    const w = await como("authenticated", claims(TI), [[`update empresas set nombre = nombre`]]); if (w.codigo || w.n !== 0) throw new Error(`empresas: ${w.codigo ?? `${w.n} filas`} ${w.mensaje ?? ""}`);
    const l = await como("authenticated", claims(TI), [[`insert into lineas (numero, operador, plan, costo, estado) values ('999000111', 'Ensayo', 'Plan ensayo', 0, 'activa')`]]); if (l.codigo) throw new Error(`lineas (activos 2 debe poder): ${l.codigo} ${l.mensaje}`);
  });
  await prueba("trabajador: sus 9 vistas del Portal (ahora invoker) responden con SUS datos; comunicados solo los dirigidos a él", async () => {
    igual(await contar(claims(TRABAJADOR), "v_portal_perfil"), 1, "perfil"); igual(await contar(claims(TRABAJADOR), "v_portal_datos"), 1, "datos");
    igual(await contar(claims(TRABAJADOR), "v_portal_boletas"), T.boletasP, "boletas");
    igual(await contar(claims(TRABAJADOR), "v_portal_comunicados"), 2, "comunicados (E1 + grupo)");
    for (const v of VISTAS_PORTAL) await contar(claims(TRABAJADOR), v);
    igual(await contar(claims(TRABAJADOR), "sedes"), T.misSedes, "sedes propias");
    if ((await contar(claims(TRABAJADOR), "empresas")) < 1) throw new Error("empresas: el trabajador necesita el catálogo");
  });
  await prueba("trabajador: solo su fila en v_personal y personas; 0 en activos, usuarios, auditoría y toda tabla ajena", async () => {
    igual(await contar(claims(TRABAJADOR), "v_personal"), 1, "v_personal (su propia fila)");
    for (const r of ["v_activos", "v_usuarios_admin", "interno.auditoria", "interno.usuarios_admin", "interno.datos_bancarios", "acuses", "memorandums", "tickets"]) igual(await contar(claims(TRABAJADOR), r), 0, r);
    igual(await contar(claims(TRABAJADOR), "personas"), 1, "personas"); igual(await contar(claims(TRABAJADOR), "interno.datos_bancarios"), 0, "datos_bancarios (sin fila propia en el volcado)");
  });
  await prueba("bucket: el restringido ve lotes de E1, el RIT y la solicitud de E1; ni lotes de E2 ni cargos; no puede subir (boletas 1); el trabajador nada; superadmin todo", async () => {
    const r = await como("authenticated", claims(RESTRINGIDO), [[`select name from storage.objects where bucket_id = 'documentos' order by name`]]);
    if (r.codigo) throw new Error(`${r.codigo} ${r.mensaje}`);
    igual(r.filas.map((x) => x.name).join("|"), [`lotes/${E1.id}/2026-09/a.pdf`, "rit/general.pdf"].sort().join("|"), "restringido (boletas 1, sin solicitudes ni acuses)");
    const i = await como("authenticated", claims(RESTRINGIDO), [[`insert into storage.objects (bucket_id, name) values ('documentos', $1)`, [`lotes/${E1.id}/2026-09/c.pdf`]]]);
    igual(i.codigo, "42501", "subir sin nivel 2");
    igual(await contar(claims(TRABAJADOR), "storage.objects"), 0, "trabajador"); igual(await contar(claims(SUPER), "storage.objects"), 5, "superadmin");
  });
  await prueba("sesión sin identidad y anon: nada", async () => {
    const NADIE = { role: "authenticated", email: "nadie@ejemplo.invalido", sub: "00000000-0000-0000-0000-000000000000" };
    for (const r of ["v_personal", "v_portal_perfil", "empresas", "sedes", "storage.objects"]) igual(await contar(NADIE, r), 0, r);
    const a = await como("anon", { role: "anon" }, [[`select count(*) from personas`]]); igual(a.codigo, "42501", "anon");
  });
  await prueba("la migración NO se re-aplica sobre sí misma (precondición)", async () => {
    const r = await como("postgres", null, [[MIGRACION]]);
    if (!r.codigo || !/ya existe/.test(r.mensaje ?? "")) throw new Error(`esperaba fallo de precondición: ${r.codigo ?? "pasó"} ${r.mensaje ?? ""}`);
  });

  console.log("\n== 3 · Reversión y re-aplicación");
  await prueba("la reversión se aplica sin errores", async () => { await sql(REVERSION); });
  await prueba("la foto (políticas, relaciones, vistas, permisos de funciones) es idéntica a la de la fase 3c", async () => {
    const dif = compararFotos(foto0, await foto());
    if (dif.length) throw new Error(`${dif.length} diferencias:\n   ` + dif.slice(0, 15).join("\n   "));
  });
  await prueba("tras revertir, el restringido vuelve a ver todo el padrón (estado interino)", async () => { igual(await contar(claims(RESTRINGIDO), "v_personal"), T.personal, "v_personal"); });
  await prueba("la fase 4 vuelve a aplicarse sobre el estado revertido", async () => { await sql(MIGRACION); });
} finally {
  await bd.parar();
}
console.log(`\n${ok} verdes, ${fallos} fallo(s).`);
process.exit(fallos ? 1 : 0);
