// scripts/ensayar-licencias.mjs — Ensayo LOCAL del canónico supabase/licencias.sql
// (Postgres embebido, canónicos + seguridad.sql, sin datos): catálogo, guardas
// por nivel y reglas de negocio (normalización, duplicados, afiliar/desafiliar,
// conteos de la vista, auditoría). Uso: node scripts/ensayar-licencias.mjs
import { arrancarPgLocal } from "./pg-local.mjs";

let fallos = 0, ok = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); await cliente.query("rollback").catch(() => {}); }
};
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
// Dentro de una transacción abierta: savepoint para que el error esperado no la aborte.
const falla = async (fn, patron, msj) => {
  await sql("savepoint zz_falla");
  let e = null; try { await fn(); } catch (x) { e = x.message; }
  await sql("rollback to savepoint zz_falla");
  if (!patron.test(e ?? "")) throw new Error(`${msj}: esperaba /${patron.source}/, obtuve ${JSON.stringify(e)}`);
};

const bd = await arrancarPgLocal({ seguridad: true, datos: false });
const { sql, cliente } = bd;
await sql("set search_path = public, interno, extensions");

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

try {
  console.log("== Licencias Office · catálogo");
  await prueba("2 tablas con RLS y adm_lectura; vista invoker; 3 RPC para authenticated y service_role, no anon; 2 disparadores", async () => {
    const [r] = await sql(`select
      (select count(*) from pg_policies where tablename in ('licencias_office', 'licencias_office_personas') and policyname = 'adm_lectura')::int as pol,
      (select bool_and(relrowsecurity) from pg_class where relname in ('licencias_office', 'licencias_office_personas')) as rls,
      exists (select 1 from pg_class where relname = 'v_licencias_office' and 'security_invoker=on' = any(coalesce(reloptions, '{}'))) as inv,
      (select bool_and(has_function_privilege('authenticated', f, 'execute') and has_function_privilege('service_role', f, 'execute')
                       and not has_function_privilege('anon', f, 'execute'))
         from unnest(array['guardar_licencia_office(bigint,text,text,text)', 'afiliar_licencia_office(bigint,text,text,bigint)',
                           'desafiliar_licencia_office(bigint)']) f) as fn,
      (select count(*) from pg_trigger where tgname like 'trg_auditar_licencias_office%')::int as trg,
      (select bool_and(has_table_privilege('authenticated', t, 'select') and not has_table_privilege('authenticated', t, 'insert')
                       and not has_table_privilege('anon', t, 'select'))
         from unnest(array['licencias_office', 'licencias_office_personas', 'v_licencias_office']) t) as priv`);
    igual(`${r.pol}/${r.rls}/${r.inv}/${r.fn}/${r.trg}/${r.priv}`, "2/true/true/true/2/true", "catálogo");
  });

  console.log("\n== Guardas");
  await prueba("authenticated sin claims: guardar/afiliar/desafiliar → 42501; la vista devuelve 0 filas", async () => {
    for (const q of ["select guardar_licencia_office(null, 'ZZ_PRUEBA', 'zz@ejemplo.invalido', 'activa')",
                     "select afiliar_licencia_office(1, null, 'ZZ')", "select desafiliar_licencia_office(1)"]) {
      const r = await como("authenticated", null, q);
      igual(r.codigo, "42501", q);
    }
    const v = await como("authenticated", null, "select count(*)::int as n from v_licencias_office");
    igual(v.filas?.[0]?.n, 0, "vista sin nivel");
  });

  console.log("\n== Reglas de negocio (servicio, nivel 99; transacción revertida)");
  await prueba("guarda normalizando; rechaza duplicado, correo inválido y estado inválido", async () => {
    await sql("begin");
    try {
      await sql("set local role service_role");
      const [{ id }] = await sql("select guardar_licencia_office(null, ' zz grupo ', ' ZZ_Grupo@Ejemplo.INVALIDO ', null) as id");
      const [g] = await sql("select grupo, correo, estado from licencias_office where id = $1", [id]);
      igual(`${g.grupo}|${g.correo}|${g.estado}`, "ZZ GRUPO|zz_grupo@ejemplo.invalido|activa", "normalizado");
      await falla(() => sql("select guardar_licencia_office(null, 'ZZ GRUPO', 'otro@ejemplo.invalido', 'activa')"), /Ya existe/, "duplicado grupo");
      await falla(() => sql("select guardar_licencia_office(null, 'OTRO', 'zz_grupo@ejemplo.invalido', 'activa')"), /Ya existe/, "duplicado correo");
      await falla(() => sql("select guardar_licencia_office(null, 'OTRO', 'sin-arroba', 'activa')"), /Correo del buzón inválido/, "correo");
      await falla(() => sql("select guardar_licencia_office(null, 'OTRO', 'otro@ejemplo.invalido', 'rara')"), /Estado inválido/, "estado");
      await sql("select guardar_licencia_office($1, 'ZZ GRUPO', 'zz_grupo@ejemplo.invalido', 'suspendida')", [id]);
      const [g2] = await sql("select estado from licencias_office where id = $1", [id]);
      igual(g2.estado, "suspendida", "editar estado");
      await falla(() => sql("select guardar_licencia_office(999999, 'NADIE', 'nadie@ejemplo.invalido', 'activa')"), /no existe/, "id inexistente");
    } finally { await sql("rollback"); }
  });
  await prueba("afilia por DNI y por nombre, resuelve un «por afiliar», rechaza duplicado abierto y DNI inexistente; la vista cuenta; desafilia una sola vez; auditoría", async () => {
    await sql("begin");
    try {
      await sql("insert into personas (dni, nombre) values ('ZZLIC0001', 'ZZ PRUEBA UNO'), ('ZZLIC0002', 'ZZ PRUEBA DOS')");
      await sql("set local role service_role");
      const [{ id }] = await sql("select guardar_licencia_office(null, 'ZZ GRUPO', 'zz_grupo@ejemplo.invalido', 'activa') as id");
      const [{ f1 }] = await sql("select afiliar_licencia_office($1, 'ZZLIC0001') as f1", [id]);
      const [{ f2 }] = await sql("select afiliar_licencia_office($1, null, 'ZZ POR AFILIAR') as f2", [id]);
      await falla(() => sql("select afiliar_licencia_office($1, 'ZZLIC0001')", [id]), /ya está afiliada/, "doble afiliación");
      await falla(() => sql("select afiliar_licencia_office($1, 'NOEXISTE')", [id]), /no está en el padrón/, "DNI inexistente");
      await falla(() => sql("select afiliar_licencia_office($1, null, '  ')", [id]), /Indica el DNI/, "sin datos");
      await falla(() => sql("select afiliar_licencia_office(999999, 'ZZLIC0002')"), /El grupo no existe/, "grupo inexistente");
      let [v] = await sql(`select cantidad, "porAfiliar" as pa, personas from v_licencias_office where id = $1`, [id]);
      igual(`${v.cantidad}/${v.pa}`, "2/1", "vista antes de resolver");
      igual(v.personas.map((p) => `${p.nombre}:${p.afiliado}`).join(","), "ZZ POR AFILIAR:false,ZZ PRUEBA UNO:true", "personas de la vista");
      await sql("select afiliar_licencia_office($1, 'ZZLIC0002', null, $2)", [id, f2]);
      [v] = await sql(`select cantidad, "porAfiliar" as pa from v_licencias_office where id = $1`, [id]);
      igual(`${v.cantidad}/${v.pa}`, "2/0", "vista tras resolver");
      const [fila] = await sql("select dni, nombre from licencias_office_personas where id = $1", [f2]);
      igual(`${fila.dni}|${fila.nombre}`, "ZZLIC0002|ZZ PRUEBA DOS", "nombre del padrón al afiliar");
      await sql("select desafiliar_licencia_office($1)", [f1]);
      await falla(() => sql("select desafiliar_licencia_office($1)", [f1]), /ya está cerrada/, "doble cierre");
      [v] = await sql("select cantidad from v_licencias_office where id = $1", [id]);
      igual(v.cantidad, 1, "vista tras desafiliar");
      const [{ f3 }] = await sql("select afiliar_licencia_office($1, 'ZZLIC0001') as f3", [id]);
      igual(f3 > f1, true, "re-afiliar tras cerrar abre una fila nueva");
      const [a] = await sql("select count(*)::int as n from auditoria where tabla like 'licencias_office%'");
      igual(a.n, 6, `auditoría (${a.n})`);
    } finally { await sql("rollback"); }
  });
} finally {
  await bd.parar();
}
console.log(`\n${ok} ok · ${fallos} fallo(s)`);
process.exit(fallos ? 1 : 0);
