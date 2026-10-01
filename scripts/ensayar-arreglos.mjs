// scripts/ensayar-arreglos.mjs — Ensayo LOCAL de los dos arreglos del 2026-09-30
// (Postgres embebido, canónicos + seguridad.sql, sin datos anonimizados; siembra propia ZZ).
// pg-local arranca ya con el canon nuevo, así que primero se aplica la REVERSIÓN
// para demostrar el defecto, luego la MIGRACIÓN para demostrar el arreglo, y al
// final reversión + reaplicación. Uso: node scripts/ensayar-arreglos.mjs
import { readFileSync } from "node:fs";
import { arrancarPgLocal } from "./pg-local.mjs";
import { FECHA } from "./arreglos-generar.mjs";

const MIGRACION = readFileSync(`supabase/migraciones/${FECHA}-arreglos-asistencia-boletas.sql`, "utf8");
const REVERSION = readFileSync(`supabase/respaldos/${FECHA}-arreglos-asistencia-boletas-reversion.sql`, "utf8");

let fallos = 0, ok = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); await cliente.query("rollback").catch(() => {}); }
};
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const bd = await arrancarPgLocal({ seguridad: true, datos: false });
const { sql, cliente } = bd;
await sql("set search_path = public, interno, extensions");

// Siembra: una empresa activa con dos vigentes del seed (sin datos reales).
const [{ empresa }] = await sql(`select v.empresa_id as empresa from vinculos v join empresas e on e.id = v.empresa_id
  where v.fecha_fin is null and coalesce(e.estado, 'activa') = 'activa' group by 1 having count(*) >= 2 order by 1 limit 1`);
const docs = (await sql(`select persona_dni as dni from vinculos where empresa_id = $1 and fecha_fin is null order by 1 limit 2`, [empresa])).map((r) => r.dni);
const D1 = "2025-03-01", D2 = "2025-03-02", D3 = "2025-03-03";
const reloj = (dias) => JSON.stringify(dias.flatMap((f) => docs.map((d) => ({ codigo: d, fecha: f, m1: "08:00", m2: "17:00" }))));
const sembrarControl = () => sql(`insert into marcaciones (empresa_id, documento, fecha, m1, m2, origen, tipo)
  values ($1, $2, $3, '07:55', '17:05', 'control', 'laborable'), ($1, $2, $4, '07:50', '17:00', 'control', 'laborable')
  on conflict (empresa_id, documento, fecha) do update set origen = 'control'`, [empresa, docs[0], D1, D2]);
const control = async () => (await sql(`select count(*)::int as n from marcaciones where empresa_id = $1 and origen = 'control' and fecha between $2 and $3`, [empresa, D1, D3]))[0].n;
const relojN = async () => (await sql(`select count(*)::int as n from marcaciones where empresa_id = $1 and origen = 'reloj' and fecha between $2 and $3`, [empresa, D1, D3]))[0].n;
const limpiar = () => sql(`delete from marcaciones where empresa_id = $1 and fecha between $2 and $3; delete from asistencia_lotes where empresa_id = $1 and rango_desde >= $2`, [empresa, D1, D3]);
const importarReloj = async (dias) => {
  await sql("set local role service_role");
  const [{ r }] = await sql(`select importar_asistencia($1, $2::jsonb, 'ensayo.xlsx', '{}'::jsonb, 'ensayo') as r`, [empresa, reloj(dias)]);
  await sql("reset role");
  return r;
};
const lote = (hashes) => JSON.stringify(docs.map((d, i) => ({ dni: d, hash: hashes[i], archivo_url: `lotes/${empresa}/2025-03/${hashes[i]}.pdf` })));
const publicar = async (hashes) => {
  await sql("set local role service_role");
  const [{ r }] = await sql(`select publicar_lote_pdf($1, 'Boleta de pago', '2025-03', 'ensayo', $2::jsonb) as r`, [empresa, lote(hashes)]);
  await sql("reset role");
  return r;
};
const lotesN = async () => (await sql(`select count(*)::int as n, coalesce(max(version), 0)::int as v from lotes where empresa_id = $1 and periodo = '2025-03'`, [empresa]))[0];
const limpiarLotes = () => sql(`delete from documentos where lote_id in (select id from lotes where empresa_id = $1 and periodo = '2025-03');
  delete from lotes where empresa_id = $1 and periodo = '2025-03'`, [empresa]);
console.log(`empresa ${empresa} · ${docs.length} vigentes de prueba`);

try {
  console.log("== 0 · estado anterior (reversión aplicada sobre el canon nuevo): el defecto existe");
  await prueba("la reversión aplica; lotes.huella no existe", async () => {
    await sql(REVERSION);
    const [r] = await sql(`select exists (select 1 from information_schema.columns where table_name = 'lotes' and column_name = 'huella') as h`);
    igual(r.h, false, "huella");
  });
  await prueba("A (antes): importar el reloj sobre un rango con control semanal BORRA el control", async () => {
    await sql("begin");
    try {
      await sembrarControl(); igual(await control(), 2, "control sembrado");
      await importarReloj([D1, D2, D3]);
      igual(await control(), 0, "control tras el reloj (defecto)");
    } finally { await sql("rollback"); }
  });
  await prueba("B (antes): publicar dos veces el mismo lote crea la versión 2 y marca reemplazada la 1", async () => {
    await sql("begin");
    try {
      const h = ["a".repeat(64), "b".repeat(64)];
      await publicar(h); const r2 = await publicar(h);
      igual(r2.version, 2, "versión"); igual(r2.repetido, undefined, "sin marca repetido");
      const [{ n }] = await sql(`select count(*)::int as n from documentos d join lotes l on l.id = d.lote_id where l.empresa_id = $1 and l.periodo = '2025-03' and d.estado = 'reemplazado'`, [empresa]);
      igual(n, 2, "reemplazadas");
    } finally { await sql("rollback"); }
  });

  console.log("\n== 1 · migración");
  await prueba("aplica en una transacción (verificación embebida incluida)", async () => { await sql(MIGRACION); });

  console.log("\n== 2 · A · el reloj conserva el control");
  await prueba("con control en D1 y D2: el reloj de D1..D3 entra solo en D3 para ese documento y en los tres días para el otro; conservadas_control = 2", async () => {
    await sql("begin");
    try {
      await sembrarControl();
      const r = await importarReloj([D1, D2, D3]);
      igual(await control(), 2, "control intacto");
      igual(await relojN(), 4, "reloj insertado (3 del segundo doc + D3 del primero)");
      igual(r.conservadas_control, 2, "conservadas_control");
      igual(r.filas, 6, "filas leídas");
    } finally { await sql("rollback"); }
  });
  await prueba("reimportar el reloj reemplaza solo el reloj (sin duplicar) y sigue sin tocar el control", async () => {
    await sql("begin");
    try {
      await sembrarControl();
      await importarReloj([D1, D2, D3]); await importarReloj([D1, D2, D3]);
      igual(await control(), 2, "control"); igual(await relojN(), 4, "reloj");
    } finally { await sql("rollback"); }
  });
  await prueba("sin control previo: comportamiento de siempre, conservadas_control = 0", async () => {
    await sql("begin");
    try {
      const r = await importarReloj([D1, D2]);
      igual(await relojN(), 4, "reloj"); igual(r.conservadas_control, 0, "conservadas");
    } finally { await sql("rollback"); }
  });

  console.log("\n== 3 · B · lote idéntico");
  await prueba("publicar, republicar idéntico → mismo lote, repetido=true, sin versión 2 ni documentos nuevos ni reemplazados", async () => {
    await sql("begin");
    try {
      const h = ["a".repeat(64), "b".repeat(64)];
      const r1 = await publicar(h); const r2 = await publicar(h);
      igual(r2.lote_id, r1.lote_id, "mismo lote"); igual(r2.repetido, true, "repetido"); igual(r2.version, 1, "versión");
      igual(r2.documentos, 2, "documentos");
      const l = await lotesN(); igual(`${l.n}/${l.v}`, "1/1", "lotes");
      const [{ n }] = await sql(`select count(*)::int as n from documentos where lote_id = $1 and estado = 'reemplazado'`, [r1.lote_id]);
      igual(n, 0, "reemplazadas");
      const [{ huella }] = await sql(`select huella from lotes where id = $1`, [r1.lote_id]);
      igual(/^[0-9a-f]{64}$/.test(huella ?? ""), true, "huella guardada");
    } finally { await sql("rollback"); }
  });
  await prueba("un PDF distinto (hash distinto) sí crea la versión 2 y marca reemplazada la 1; el orden de las boletas no cambia la huella", async () => {
    await sql("begin");
    try {
      const h = ["a".repeat(64), "b".repeat(64)];
      const r1 = await publicar(h);
      // mismo contenido, otro orden
      await sql("set local role service_role");
      const [{ r }] = await sql(`select publicar_lote_pdf($1, 'Boleta de pago', '2025-03', 'ensayo', $2::jsonb) as r`, [empresa, JSON.stringify(JSON.parse(lote(h)).reverse())]);
      await sql("reset role");
      igual(r.repetido, true, "orden distinto = mismo lote");
      const r3 = await publicar(["a".repeat(64), "c".repeat(64)]);
      igual(r3.version, 2, "versión nueva"); igual(r3.repetido, undefined, "no repetido");
      const [{ n }] = await sql(`select count(*)::int as n from documentos where lote_id = $1 and estado = 'reemplazado'`, [r1.lote_id]);
      igual(n, 2, "v1 reemplazada para los vínculos del lote nuevo");
    } finally { await sql("rollback"); }
  });

  console.log("\n== 4 · reversión y reaplicación");
  await prueba("la reversión restaura los cuerpos anteriores y quita la columna; la migración se reaplica", async () => {
    await sql(REVERSION);
    let [r] = await sql(`select exists (select 1 from information_schema.columns where table_name = 'lotes' and column_name = 'huella') as h,
      (select prosrc from pg_proc where oid = 'public.importar_asistencia(text, jsonb, text, jsonb, text)'::regprocedure) ~ 'origen = ''reloj''' as filtro`);
    igual(`${r.h}/${r.filtro}`, "false/false", "tras reversión");
    await sql(MIGRACION);
    [r] = await sql(`select exists (select 1 from information_schema.columns where table_name = 'lotes' and column_name = 'huella') as h`);
    igual(r.h, true, "reaplicada");
  });
} finally {
  await limpiar().catch(() => {}); await limpiarLotes().catch(() => {});
  await bd.parar();
}
console.log(`\n${ok} ok · ${fallos} fallo(s)`);
process.exit(fallos ? 1 : 0);
