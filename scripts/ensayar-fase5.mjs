// scripts/ensayar-fase5.mjs — Ensayo LOCAL de la FASE 5 (auditoría sin valores
// sensibles + redacción del histórico) sobre el entorno 2.5 en estado de la
// fase 4. Siembra filas de auditoría con secretos (el volcado no las trae:
// el extractor las anonimiza) y comprueba el disparador nuevo y la redacción.
// Uso: node scripts/ensayar-fase5.mjs
import { readFileSync } from "node:fs";
import { arrancarPgLocal, cargarDatosAnonimizados } from "./pg-local.mjs";
import { FECHA, CLAVES_REDACTADAS, MARCA, sinFase5 } from "./fase5-generar.mjs";

const MIG_A = readFileSync(`supabase/migraciones/${FECHA}-fase5a-auditoria-sensible.sql`, "utf8");
const MIG_B = readFileSync(`supabase/migraciones/${FECHA}-fase5b-redaccion-historico.sql`, "utf8");
const REV_A = readFileSync(`supabase/respaldos/${FECHA}-fase5a-reversion.sql`, "utf8");
const SEGURIDAD_4 = sinFase5(readFileSync("supabase/seguridad.sql", "utf8"));

let fallos = 0, ok = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); await cliente.query("rollback").catch(() => {}); }
};
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const bd = await arrancarPgLocal({ seguridad: false, datos: false });
const { sql, cliente } = bd;
await sql(SEGURIDAD_4);
await cargarDatosAnonimizados(sql);
await sql("set search_path = public, interno, extensions");

const [U] = await sql(`select id, correo from usuarios_admin order by id limit 1`);
const [P] = await sql(`select dni from personas order by dni limit 1`);
// Histórico con secretos, como lo dejó el sistema antes de la 3b/3c.
await sql(`insert into interno.auditoria (usuario, accion, tabla, datos_antes, datos_despues) values
  ('ensayo', 'UPDATE', 'personas', jsonb_build_object('dni', $1::text, 'cci', '00212345678901234567', 'cuenta', '1919191919', 'cuenta_cifrada', 'wcBMA…', 'cuenta_ultimos4', '1919', 'celular', '987654321'), jsonb_build_object('dni', $1::text, 'cci', '00212345678901234568', 'cuenta', null, 'cuenta_ultimos4', '1919', 'celular', '987654321')),
  ('ensayo', 'UPDATE', 'usuarios_admin', jsonb_build_object('id', 1, 'clave_provisional', 'Grupo-AAAA-BBBB', 'sesion_actual', 'sesionvieja'), jsonb_build_object('id', 1, 'clave_provisional', null, 'sesion_actual', 'sesionnueva')),
  ('ensayo', 'UPDATE', 'activos', jsonb_build_object('codigo', 'X-1', 'clave_equipo', 'secreto'), jsonb_build_object('codigo', 'X-1', 'clave_equipo', 'secreto2')),
  ('ensayo', 'UPDATE', 'cuentas_portal', jsonb_build_object('dni', $1::text, 'sesion_actual', null), jsonb_build_object('dni', $1::text, 'sesion_actual', 'abc'))`, [P.dni]);
const foto = async () => {
  const filas = await sql(`select 'fn:' || p.oid::regprocedure::text as objeto, coalesce(p.proacl::text, '') || '|' || md5(p.prosrc) as valor from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    union all select 'rel:' || n.nspname || '.' || c.relname, coalesce(c.relacl::text, '') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'interno' and c.relkind = 'r' order by 1`);
  return new Map(filas.map((f) => [f.objeto, f.valor]));
};
const compararFotos = (a, b) => { const d = []; for (const [k, v] of a) if (!b.has(k)) d.push(`falta: ${k}`); else if (b.get(k) !== v) d.push(`difiere: ${k}`); for (const k of b.keys()) if (!a.has(k)) d.push(`sobra: ${k}`); return d; };
const secretos = async () => (await sql(`select count(*)::int as n from interno.auditoria a where a.datos_antes::text ~ '(00212345678901234567|1919191919|wcBMA|Grupo-AAAA-BBBB|sesionvieja|secreto)' or a.datos_despues::text ~ '(00212345678901234568|sesionnueva|secreto2|"abc")'`))[0].n;

try {
  console.log("== 0 · Base: fase 4 + datos + histórico sembrado con secretos");
  const foto0 = await foto();
  await prueba("hoy: el disparador copia valores sensibles tal cual (clave_provisional y sesion_actual)", async () => {
    await sql(`update usuarios_admin set clave_provisional = 'Grupo-ZZZZ-1111', sesion_actual = 'marcador-1' where id = $1`, [U.id]);
    const [r] = await sql(`select datos_despues::text as d from interno.auditoria where tabla = 'usuarios_admin' order by id desc limit 1`);
    if (!/Grupo-ZZZZ-1111/.test(r.d)) throw new Error("no copió el valor (¿ya redacta?)");
    igual(await secretos(), 4, "filas sembradas");
  });

  console.log("\n== 1 · Fase 5a: disparador");
  await prueba("la migración 5a se aplica sin errores (verificación embebida incluida)", async () => { await sql(MIG_A); });
  await prueba("desde ahora: la auditoría registra que hubo cambio, no el valor; null sigue null; lo no sensible se conserva", async () => {
    await sql(`update usuarios_admin set clave_provisional = 'Grupo-YYYY-2222', sesion_actual = 'marcador-2', celular = '999' where id = $1`, [U.id]);
    const [r] = await sql(`select datos_antes as a, datos_despues as d from interno.auditoria where tabla = 'usuarios_admin' order by id desc limit 1`);
    if (JSON.stringify(r.d).includes("Grupo-YYYY-2222") || JSON.stringify(r.d).includes("marcador-2")) throw new Error(`valor en claro: ${JSON.stringify(r.d)}`);
    igual(r.d.clave_provisional, "[sensible: cambiado]", "clave cambiada"); igual(r.d.sesion_actual, "[sensible: cambiado]", "sesión cambiada"); igual(r.a.clave_provisional, "[sensible]", "antes"); igual(r.d.celular, "999", "no sensible");
    await sql(`update usuarios_admin set celular = '998' where id = $1`, [U.id]);
    const [s] = await sql(`select datos_despues as d from interno.auditoria where tabla = 'usuarios_admin' order by id desc limit 1`);
    igual(s.d.clave_provisional, "[sensible]", "sin cambio de clave → [sensible]");
    await sql(`update usuarios_admin set clave_provisional = null, sesion_actual = null where id = $1`, [U.id]);
    const [t] = await sql(`select datos_despues as d from interno.auditoria where tabla = 'usuarios_admin' order by id desc limit 1`);
    igual(t.d.clave_provisional, null, "null se conserva");
  });
  await prueba("la auditoría de personas (sin columnas bancarias ya) queda igual que antes", async () => {
    await sql(`update personas set nombre = nombre || ' ' where dni = $1`, [P.dni]);
    const [r] = await sql(`select datos_despues as d from interno.auditoria where tabla = 'personas' order by id desc limit 1`);
    if (!r.d.nombre) throw new Error("sin nombre en la auditoría");
  });

  console.log("\n== 2 · Fase 5b: redacción del histórico (solo con aprobación)");
  const conSecretosAntes = await secretos();
  await prueba("sin aprobación (sin fase5b.aprobado_por) la migración se niega", async () => {
    await cliente.query("begin"); let e;
    try { await cliente.query(MIG_B.replace(/^begin;/m, "").replace(/commit;\s*$/m, "")); } catch (x) { e = x; } finally { await cliente.query("rollback"); }
    if (!e || !/falta la aprobación/.test(e.message)) throw new Error(`esperaba negativa: ${e?.message ?? "pasó"}`);
  });
  await prueba("con aprobación: redacta todas las claves de secretos, deja el rastro con conteos y reactiva la inmutabilidad", async () => {
    await cliente.query("begin");
    try { await cliente.query(`set local fase5b.aprobado_por = 'Diego Salguero Tang'`); await cliente.query(MIG_B.replace(/^begin;/m, "").replace(/commit;\s*$/m, "")); await cliente.query("commit"); }
    catch (x) { await cliente.query("rollback"); throw x; }
    igual(await secretos(), 0, "secretos restantes");
    const [r] = await sql(`select datos_despues as d from interno.auditoria where accion = 'REDACCION_HISTORICO' order by id desc limit 1`);
    igual(r.d.aprobado_por, "Diego Salguero Tang", "aprobador"); if (!r.d.claves || !r.d.claves.cci) throw new Error(`rastro sin conteos: ${JSON.stringify(r.d)}`);
    const [m] = await sql(`select datos_antes as a, datos_despues as d from interno.auditoria where tabla = 'personas' and datos_antes ? 'cci' order by id limit 1`);
    igual(m.a.cci, MARCA, "cci redactado"); igual(m.a.cuenta, MARCA, "cuenta redactada"); igual(m.a.cuenta_ultimos4, "1919", "últimos 4 intactos"); igual(m.a.celular, "987654321", "celular intacto"); igual(m.d.cuenta, null, "null intacto");
    const u = await (async () => { try { await sql(`update interno.auditoria set usuario = 'x' where id = (select max(id) from interno.auditoria)`); return "pasó"; } catch (e) { return e.message; } })();
    if (!/inmutables/.test(u)) throw new Error(`la inmutabilidad no volvió: ${u}`);
    void conSecretosAntes;
  });
  await prueba("la redacción no se re-aplica (nada que redactar)", async () => {
    await cliente.query("begin"); let e;
    try { await cliente.query(`set local fase5b.aprobado_por = 'x'`); await cliente.query(MIG_B.replace(/^begin;/m, "").replace(/commit;\s*$/m, "")); } catch (x) { e = x; } finally { await cliente.query("rollback"); }
    if (!e || !/nada que redactar/.test(e.message)) throw new Error(`esperaba negativa: ${e?.message ?? "pasó"}`);
  });

  console.log("\n== 3 · Reversión de 5a");
  await prueba("la reversión de 5a se aplica y la foto de funciones y tablas de interno es idéntica a la de la fase 4", async () => {
    await sql(REV_A);
    const dif = compararFotos(foto0, await foto()); if (dif.length) throw new Error(dif.join("; "));
  });
  await prueba("la fase 5a vuelve a aplicarse", async () => { await sql(MIG_A); });
  for (const k of CLAVES_REDACTADAS) void k;
} finally {
  await bd.parar();
}
console.log(`\n${ok} verdes, ${fallos} fallo(s).`);
process.exit(fallos ? 1 : 0);
