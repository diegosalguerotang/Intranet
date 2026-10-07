// scripts/ensayar-politica.mjs — Ensayo LOCAL de la política de datos v3
// (2026-10-01): el punto 1 nombra a la razón social de la planilla del trabajador.
// Postgres embebido, canónicos + seguridad.sql, seeds de schema.sql (sin datos
// reales). pg-local arranca ya con el canon nuevo: primero se aplica la REVERSIÓN
// (estado anterior), luego la MIGRACIÓN, las reglas, y al final reversión +
// reaplicación. Uso: node scripts/ensayar-politica.mjs
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { arrancarPgLocal } from "./pg-local.mjs";
import { FECHA, MARCA } from "./politica-generar.mjs";
import { responsableDe } from "../api/_politica.js";

const MIGRACION = readFileSync(`supabase/migraciones/${FECHA}-politica-razon-social.sql`, "utf8");
const REVERSION = readFileSync(`supabase/respaldos/${FECHA}-politica-razon-social-reversion.sql`, "utf8");

let fallos = 0, ok = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); await cliente.query("rollback").catch(() => {}); }
};
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const bd = await arrancarPgLocal({ seguridad: true, datos: false });
const { sql, cliente } = bd;
await sql("set search_path = public, interno, extensions");

// Sesión del portal de un documento: transacción con rol y claims, SIEMPRE revertida.
const sesion = async (dni, fn, rol = "authenticated") => {
  await cliente.query("begin");
  try {
    await cliente.query(`set local role ${rol}`);
    await cliente.query(`select set_config('request.jwt.claims', $1, true)`,
      [dni ? JSON.stringify({ role: rol, email: `${dni.toLowerCase()}@portal.servicios-intranet.net` }) : ""]);
    return await fn(async (texto, params) => (await cliente.query(texto, params)).rows);
  } finally { await cliente.query("rollback"); }
};
const politicaVista = (q) => q(`select version, texto from v_declaraciones_vigentes where id = 'politica-datos'`);
const sha = (t) => createHash("sha256").update(t, "utf8").digest("hex");

// Seeds de schema.sql: dos vigentes de razones sociales distintas y un cesado.
const [A, B] = await sql(`select distinct on (v.empresa_id) v.persona_dni as dni, e.nombre, e.ruc
  from vinculos v join empresas e on e.id = v.empresa_id where v.fecha_fin is null order by v.empresa_id, v.persona_dni limit 2`);
const [CESADO] = await sql(`select v.persona_dni as dni, e.nombre, e.ruc from vinculos v join empresas e on e.id = v.empresa_id
  where v.fecha_fin is not null and not exists (select 1 from vinculos x where x.persona_dni = v.persona_dni and x.fecha_fin is null) limit 1`);
const SIN = "ZZSINVINC";
await sql(`insert into personas (dni, nombre) values ($1, 'ZZ SIN VINCULO')`, [SIN]);
await sql(`insert into cuentas_portal (dni, creado_por) select d, 'ensayo' from unnest($1::text[]) d on conflict do nothing`, [[A.dni, B.dni, SIN]]);
console.log(`A ${A.dni} (${A.nombre}) · B ${B.dni} (${B.nombre}) · cesado ${CESADO?.dni ?? "(ninguno)"}`);

const catalogo = async () => (await sql(`select f.oid is not null as existe,
  coalesce((select prosecdef from pg_proc where oid = f.oid), false) as definer,
  has_function_privilege('authenticated', f.oid, 'execute') as auth,
  has_function_privilege('anon', f.oid, 'execute') as anon,
  exists (select 1 from pg_class c, unnest(coalesce(c.reloptions, '{}')) o
          where c.oid = 'public.v_declaraciones_vigentes'::regclass and o in ('security_invoker=on', 'security_invoker=true')) as invoker,
  has_table_privilege('authenticated', 'public.v_declaraciones_vigentes', 'select') as vista,
  (select max(version) from declaraciones where id = 'politica-datos') as version
  from (select to_regprocedure('public.fn_politica_responsable()') as oid) f`))[0];

try {
  console.log("== 0 · estado anterior (reversión aplicada sobre el canon nuevo)");
  await prueba("la reversión aplica: sin función, política vigente v2 con el texto genérico, vista invoker", async () => {
    await sql(REVERSION);
    const c = await catalogo(); igual(`${c.existe}/${c.version}/${c.invoker}/${c.vista}`, "false/2/true/true", "catálogo");
    const [p] = await sesion(A.dni, politicaVista);
    igual(p.version, 2, "versión"); igual(/razón social del Grupo ER que figura como tu empleadora/.test(p.texto), true, "texto genérico");
    igual(p.texto.includes(A.nombre), false, "sin razón social");
  });

  console.log("\n== 1 · migración");
  await prueba("aplica en una transacción (verificación embebida incluida)", async () => { await sql(MIGRACION); });
  await prueba("catálogo: función NO definer, EXECUTE authenticated y no anon; vista invoker y legible; versión 3", async () => {
    const c = await catalogo();
    igual(`${c.existe}/${c.definer}/${c.auth}/${c.anon}/${c.invoker}/${c.vista}/${c.version}`, "true/false/true/false/true/true/3", "catálogo");
  });

  console.log("\n== 2 · lo que ve el trabajador");
  await prueba("cada trabajador ve SU razón social y RUC en el punto 1; sin marca; las demás declaraciones no cambian", async () => {
    for (const t of [A, B]) {
      const [p] = await sesion(t.dni, politicaVista);
      igual(p.version, 3, `versión de ${t.dni}`);
      igual(p.texto.includes(`El responsable del tratamiento es ${t.nombre} (RUC ${t.ruc}). Es la empresa de IntraTech`), true, `razón social de ${t.dni}`);
      igual(p.texto.includes(MARCA), false, "marca sin resolver");
      igual(responsableDe(t), `${t.nombre} (RUC ${t.ruc})`, "misma regla que api/_politica.js");
    }
    const [a] = await sesion(A.dni, politicaVista); const [b] = await sesion(B.dni, politicaVista);
    igual(a.texto === b.texto, false, "razones sociales distintas dan textos distintos");
    const [d] = await sesion(A.dni, (q) => q(`select (select texto from v_declaraciones_vigentes where id = 'recepcion-documento')
      = (select texto from declaraciones where id = 'recepcion-documento' order by version desc limit 1) as igual`));
    igual(d.igual, true, "recepcion-documento intacta");
  });
  if (CESADO) await prueba("un cesado ve la razón social de su último vínculo", async () => {
    const [p] = await sesion(CESADO.dni, politicaVista);
    igual(p.texto.includes(`${CESADO.nombre} (RUC ${CESADO.ruc})`), true, "cesado");
  });
  await prueba("sin vínculo: la vista dice «tu empleadora» y el primer ingreso se niega (no guarda nada)", async () => {
    const r = await sesion(SIN, async (q) => {
      const [p] = await politicaVista(q);
      await q("savepoint s");
      let msj = null;
      try { await q(`select portal_primer_ingreso('987654321', false, 3, null)`); } catch (e) { msj = e.message; await q("rollback to savepoint s"); }
      await q("reset role"); // consentimientos no es legible por la API: se lee como dueño
      const [{ n }] = await q(`select count(*)::int as n from consentimientos where dni = $1`, [SIN]);
      return { texto: p.texto, msj, n };
    });
    igual(r.texto.includes("El responsable del tratamiento es tu empleadora."), true, "genérico");
    igual(/razón social de tu planilla/.test(r.msj ?? ""), true, "rechazo"); igual(r.n, 0, "sin consentimiento");
  });
  await prueba("sin sesión del portal no hay filas; anon no ejecuta la función", async () => {
    igual((await sesion(null, politicaVista)).length, 0, "authenticated sin claims");
    let codigo = null;
    try { await sesion(null, (q) => q("select fn_politica_responsable()"), "anon"); } catch (e) { codigo = e.code; }
    igual(codigo, "42501", "anon");
  });

  console.log("\n== 3 · lo que queda guardado");
  await prueba("primer ingreso v3: consentimientos guarda EXACTAMENTE el texto mostrado (con la razón social), su huella y la versión", async () => {
    const r = await sesion(A.dni, async (q) => {
      const [p] = await politicaVista(q);
      await q(`select portal_primer_ingreso('987654321', false, $1, 'zz@ejemplo.invalido')`, [p.version]);
      await q("reset role");
      const [c] = await q(`select version, texto, hash_sha256 from consentimientos where dni = $1 and origen = 'primer_ingreso'`, [A.dni]);
      const [cp] = await q(`select politica_version, primer_ingreso_pendiente as pend from cuentas_portal where dni = $1`, [A.dni]);
      return { p, c, cp };
    });
    igual(r.c.texto === r.p.texto, true, "texto guardado = texto mostrado");
    igual(r.c.texto.includes(`${A.nombre} (RUC ${A.ruc})`), true, "razón social dentro del texto");
    igual(r.c.hash_sha256, sha(r.c.texto), "huella"); igual(r.c.version, 3, "versión");
    igual(`${r.cp.politica_version}/${r.cp.pend}`, "3/false", "cuenta");
  });
  await prueba("una aceptación de la v2 (cliente con la página vieja abierta) sigue guardando el texto v2 tal cual", async () => {
    const r = await sesion(B.dni, async (q) => {
      await q(`select portal_primer_ingreso('987654321', false, 2, null)`);
      await q("reset role");
      const [c] = await q(`select c.version, c.texto = d.texto as igual from consentimientos c join declaraciones d on d.id = 'politica-datos' and d.version = 2 where c.dni = $1`, [B.dni]);
      return c;
    });
    igual(`${r.version}/${r.igual}`, "2/true", "v2");
  });

  console.log("\n== 4 · reversión y reaplicación");
  await prueba("con un consentimiento de la v3 la reversión se NIEGA y no cambia nada", async () => {
    await sql(`insert into consentimientos (dni, declaracion_id, version, texto, hash_sha256) values ('ZZENSAYO', 'politica-datos', 3, 'x', 'x')`);
    let msj = null;
    try { await sql(REVERSION); } catch (e) { msj = e.message; await cliente.query("rollback"); }
    igual(/ya hay consentimientos de la versión 3/.test(msj ?? ""), true, "rechazo");
    const c = await catalogo(); igual(`${c.existe}/${c.version}`, "true/3", "intacto");
    await sql(`alter table consentimientos disable trigger trg_consentimientos_inmutables;
      delete from consentimientos where dni = 'ZZENSAYO';
      alter table consentimientos enable trigger trg_consentimientos_inmutables`);
  });
  await prueba("sin consentimientos v3 la reversión restaura el estado anterior; la migración se reaplica", async () => {
    await sql(REVERSION);
    let c = await catalogo(); igual(`${c.existe}/${c.version}/${c.invoker}/${c.vista}`, "false/2/true/true", "tras reversión");
    const viejo = (await sql(`select prosrc from pg_proc where oid = 'public.portal_primer_ingreso(text, boolean, integer, text)'::regprocedure`))[0].prosrc;
    igual(/fn_politica_responsable/.test(viejo), false, "cuerpo anterior");
    await sql(MIGRACION);
    c = await catalogo(); igual(`${c.existe}/${c.auth}/${c.anon}/${c.version}/${c.invoker}`, "true/true/false/3/true", "reaplicada");
  });
} finally {
  await bd.parar();
}
console.log(`\n${ok} ok · ${fallos} fallo(s)`);
process.exit(fallos ? 1 : 0);
