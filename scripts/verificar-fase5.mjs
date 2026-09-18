// scripts/verificar-fase5.mjs — Verificación en PRODUCCIÓN de la fase 5:
//   5a (disparador sin valores sensibles): catálogo + prueba de comportamiento
//      en una transacción que se revierte (no deja rastro);
//   5b (redacción del histórico): si aún NO se aplicó, imprime el INVENTARIO de
//      lo que redactaría (para la aprobación); si ya se aplicó, comprueba que
//      no queda ningún secreto y que existe el rastro REDACCION_HISTORICO.
//   env: SUPABASE_ACCESS_TOKEN
//   Uso: . .\scripts\token-supabase.ps1; node scripts/verificar-fase5.mjs
import { CLAVES_REDACTADAS, MARCA, SQL_CON_SECRETOS } from "./fase5-generar.mjs";
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

console.log("== 5a · Disparador sin valores sensibles");
await prueba("columnas_sensibles con 7 reglas, cerrada a la API; fn_auditar la consulta; fn_redactar_historico cerrada", async () => {
  const [r] = await sql(`select (select count(*) from interno.columnas_sensibles)::int as n,
    ((select prosrc from pg_proc where oid = 'public.fn_auditar()'::regprocedure) ~ 'columnas_sensibles') as usa,
    has_table_privilege('authenticated', 'interno.columnas_sensibles', 'select') as lee,
    has_function_privilege('authenticated', 'public.fn_redactar_historico(jsonb)', 'execute') as ejec`);
  igual(`${r.n}/${r.usa}/${r.lee}/${r.ejec}`, "7/true/false/false", "catálogo");
});
await prueba("comportamiento (transacción revertida): un cambio de sesion_actual queda como [sensible: cambiado], nunca el valor", async () => {
  const [r] = await sql(`begin;
    update interno.usuarios_admin set sesion_actual = 'zz-verificacion-fase5' where id = (select min(id) from interno.usuarios_admin);
    select datos_despues ->> 'sesion_actual' as v, (datos_despues::text like '%zz-verificacion-fase5%') as claro from interno.auditoria where tabla = 'usuarios_admin' order by id desc limit 1;
    rollback;`);
  igual(r.v, "[sensible: cambiado]", "marca"); igual(r.claro, false, "valor en claro");
});

console.log("\n== 5b · Redacción del histórico");
const [{ aplicada }] = await sql(`select exists (select 1 from interno.auditoria where accion = 'REDACCION_HISTORICO') as aplicada`);
if (!aplicada) {
  const filas = await sql(`select count(*)::int as n, min(fecha)::date as desde, max(fecha)::date as hasta from (${SQL_CON_SECRETOS}) x join interno.auditoria a on a.id = x.id`);
  const claves = await sql(`select e.key as clave, count(*)::int as filas from interno.auditoria a
    cross join lateral jsonb_each(coalesce(a.datos_antes, '{}'::jsonb) || coalesce(a.datos_despues, '{}'::jsonb)) e
    where e.key in (${lista(CLAVES_REDACTADAS)}) and e.value <> 'null'::jsonb and (e.value #>> '{}') <> '' and (e.value #>> '{}') <> '${MARCA}' group by 1 order by 1`);
  const tablas = await sql(`select a.tabla, a.accion, count(*)::int as n from (${SQL_CON_SECRETOS}) x join interno.auditoria a on a.id = x.id group by 1, 2 order by 3 desc`);
  console.log(`PENDIENTE DE APROBACIÓN. La redacción tocaría ${filas[0].n} filas (${filas[0].desde} → ${filas[0].hasta}):`);
  for (const c of claves) console.log(`  · ${c.clave}: ${c.filas} valores`);
  for (const t of tablas) console.log(`  · ${t.tabla} ${t.accion}: ${t.n} filas`);
  console.log(`Marca: «${MARCA}». Se conservan cuenta_ultimos4, celular, correo y el resto de cada fila.`);
} else {
  await prueba("ya aplicada: ningún secreto queda en el histórico; rastro REDACCION_HISTORICO con aprobador y conteos; inmutabilidad activa", async () => {
    const [r] = await sql(`select (select count(*) from (${SQL_CON_SECRETOS}) x)::int as restantes,
      (select datos_despues from interno.auditoria where accion = 'REDACCION_HISTORICO' order by id desc limit 1) as rastro,
      (select tgenabled from pg_trigger where tgrelid = 'interno.auditoria'::regclass and tgname = 'trg_auditoria_inmutable') as trg`);
    igual(r.restantes, 0, "secretos"); igual(r.trg, "O", "inmutabilidad"); if (!r.rastro?.aprobado_por) throw new Error("rastro sin aprobador");
    console.log(`  aprobó: ${r.rastro.aprobado_por} · ${r.rastro.fecha} · filas ${r.rastro.filas} · claves ${JSON.stringify(r.rastro.claves)}`);
  });
}
console.log(fallos ? `\n${fallos} fallo(s).` : "\nTodo verde.");
process.exit(fallos ? 1 : 0);
