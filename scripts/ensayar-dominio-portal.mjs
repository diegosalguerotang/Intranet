// scripts/ensayar-dominio-portal.mjs — Ensayo LOCAL del cambio de dominio
// técnico de las cuentas del Portal (2026-10-07). Postgres embebido, canónicos
// + seguridad.sql (ya con el bloque @@DOMINIO@@), seeds de schema.sql. Primero
// la REVERSIÓN (estado anterior: solo el dominio viejo identifica), luego la
// MIGRACIÓN (solo el nuevo), la negativa de la reversión con cuentas nuevas en
// auth.users, y reversión + reaplicación. Uso: node scripts/ensayar-dominio-portal.mjs
import { readFileSync } from "node:fs";
import { arrancarPgLocal } from "./pg-local.mjs";
import { FECHA, DOMINIO_VIEJO, DOMINIO_NUEVO } from "./lib/dominio-portal.mjs";

const MIGRACION = readFileSync(`supabase/migraciones/${FECHA}-dominio-portal.sql`, "utf8");
const REVERSION = readFileSync(`supabase/respaldos/${FECHA}-dominio-portal-reversion.sql`, "utf8");

let fallos = 0, ok = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); await cliente.query("rollback").catch(() => {}); }
};
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const bd = await arrancarPgLocal({ seguridad: true, datos: false });
const { sql, cliente } = bd;
await sql("set search_path = public, interno, extensions");

// Pasos como un rol de la API con claims, en una transacción que se revierte
// salvo que se pida conservar. Devuelve filas o { codigo, mensaje }.
const como = async (rol, claims, pasos, conservar = false) => {
  await cliente.query("begin");
  try {
    await cliente.query(`set local role ${rol}`);
    await cliente.query(`select set_config('request.jwt.claims', $1, true)`, [claims ? JSON.stringify(claims) : ""]);
    let r; for (const [texto, params] of pasos) r = await cliente.query(texto, params);
    await cliente.query(conservar ? "commit" : "rollback");
    return { filas: r.rows };
  } catch (e) { await cliente.query("rollback"); return { codigo: e.code, mensaje: e.message }; }
};
const correo = (dni, dominio) => `${dni.toLowerCase()}@${dominio}`;
const claims = (dni, dominio) => ({ role: "authenticated", email: correo(dni, dominio), sub: "11111111-1111-1111-1111-111111111111" });
const servicio = (pasos, conservar = true) => como("service_role", { role: "service_role" }, pasos, conservar);
const dniResuelto = async (dni, dominio) => (await como("authenticated", claims(dni, dominio), [["select portal_dni() as d"]])).filas?.[0]?.d ?? null;

// Una persona con vínculo vigente de los seeds; cuenta del portal para ella.
const [P] = await sql(`select v.persona_dni as dni from vinculos v where v.fecha_fin is null order by v.persona_dni limit 1`);
await sql(`insert into cuentas_portal (dni, creado_por) values ($1, 'ensayo') on conflict do nothing`, [P.dni]);
const [POL] = await sql("select intentos_bloqueo as intentos from politica_acceso where id = 1");
console.log(`Trabajador ${P.dni} · política ${POL.intentos} intentos`);

const catalogo = async () => (await sql(`select bool_and(p.prosecdef) as definer,
  bool_and(exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) as sp,
  bool_and(p.prosrc ~ '${DOMINIO_NUEVO.replace(/\./g, "\\.")}') as nuevo, bool_or(p.prosrc ~ '${DOMINIO_VIEJO.replace(/\./g, "\\.")}') as viejo,
  has_function_privilege('anon', 'public.portal_registrar_ingreso(text, text, text)', 'execute') as anon_pri,
  has_function_privilege('authenticated', 'public.portal_dni()', 'execute') as auth_dni,
  has_function_privilege('authenticated', 'public.api_login_registrar(text, text, text, text)', 'execute') as auth_api
  from pg_proc p where p.oid in ('public.portal_dni()'::regprocedure, 'public.portal_registrar_ingreso(text, text, text)'::regprocedure,
    'public.api_login_permitido(text, text)'::regprocedure, 'public.api_login_registrar(text, text, text, text)'::regprocedure)`))[0];

try {
  console.log("== 0 · estado anterior (reversión aplicada sobre el canon nuevo)");
  await prueba("la reversión aplica: solo el dominio viejo identifica al trabajador", async () => {
    await sql(REVERSION);
    const c = await catalogo(); igual(`${c.nuevo}/${c.viejo}`, "false/true", "cuerpos");
    igual(await dniResuelto(P.dni, DOMINIO_VIEJO), P.dni, "viejo resuelve");
    igual(await dniResuelto(P.dni, DOMINIO_NUEVO), null, "nuevo no resuelve");
  });

  console.log("\n== 1 · migración");
  await prueba("aplica en una transacción (verificación embebida incluida)", async () => { await sql(MIGRACION); });
  await prueba("catálogo: definer + search_path; solo el dominio nuevo; privilegios intactos", async () => {
    const c = await catalogo();
    igual(`${c.definer}/${c.sp}/${c.nuevo}/${c.viejo}/${c.anon_pri}/${c.auth_dni}/${c.auth_api}`, "true/true/true/false/true/true/false", "catálogo");
  });

  console.log("\n== 2 · identidad");
  await prueba("portal_dni: el dominio nuevo resuelve al trabajador; el viejo ya no", async () => {
    igual(await dniResuelto(P.dni, DOMINIO_NUEVO), P.dni, "nuevo");
    igual(await dniResuelto(P.dni, DOMINIO_VIEJO), null, "viejo");
  });
  await prueba("portal_registrar_ingreso: el «exitoso» solo lo registra la propia sesión con el dominio nuevo", async () => {
    let r = await como("authenticated", claims(P.dni, DOMINIO_VIEJO), [["select portal_registrar_ingreso($1, 'exitoso', 'ensayo')", [P.dni]]]);
    igual(r.codigo, "42501", "viejo rechazado");
    r = await como("authenticated", claims(P.dni, DOMINIO_NUEVO), [["select portal_registrar_ingreso($1, 'exitoso', 'ensayo')", [P.dni]]], true);
    if (r.codigo) throw new Error(`nuevo: ${r.codigo} ${r.mensaje}`);
  });
  await prueba("api_login_registrar/permitido: el correo nuevo cuenta como Portal (superficie portal, bloqueo por documento)", async () => {
    for (let i = 0; i < POL.intentos; i++) await servicio([["select api_login_registrar($1, 'fallido', '203.0.113.9', 'Ensayo')", [correo(P.dni, DOMINIO_NUEVO)]]]);
    const [fila] = await sql("select dni, superficie, fuente from registro_accesos where fuente = 'proxy' order by id desc limit 1");
    igual(`${fila.dni}/${fila.superficie}`, `${P.dni.toUpperCase()}/portal`, "fila del proxy");
    const r = await servicio([["select api_login_permitido('203.0.113.9', $1) as v", [correo(P.dni, DOMINIO_NUEVO)]]], false);
    igual(`${r.filas[0].v.permitido}/${r.filas[0].v.motivo}`, "false/cuenta", "compuerta");
    const v = await servicio([["select api_login_registrar($1, 'fallido', '203.0.113.9', 'Ensayo')", [correo(P.dni, DOMINIO_VIEJO)]]]);
    if (v.codigo) throw new Error(`viejo: ${v.codigo} ${v.mensaje}`);
    const [otra] = await sql("select superficie from registro_accesos where fuente = 'proxy' order by id desc limit 1");
    igual(otra.superficie, "backoffice", "el dominio viejo ya no es Portal");
  });

  console.log("\n== 3 · reversión");
  await prueba("se niega mientras auth.users tenga una cuenta con el dominio nuevo", async () => {
    await sql(`insert into auth.users (email) values ($1)`, [correo(P.dni, DOMINIO_NUEVO)]);
    let fallo = null; try { await sql(REVERSION); } catch (e) { fallo = e.message; }
    await cliente.query("rollback").catch(() => {});   // la reversión abre begin; y revienta dentro: cerrar la transacción abortada
    igual(/migrar-dominio-portal\.mjs --revertir/.test(fallo ?? ""), true, "mensaje de la negativa");
    const c = await catalogo(); igual(c.nuevo, true, "sigue el nuevo");
    await sql(`delete from auth.users where email = $1`, [correo(P.dni, DOMINIO_NUEVO)]);
  });
  await prueba("sin cuentas nuevas la reversión restaura el dominio viejo; la migración vuelve a aplicarse", async () => {
    await sql(REVERSION);
    igual(await dniResuelto(P.dni, DOMINIO_VIEJO), P.dni, "viejo de vuelta");
    await sql(MIGRACION);
    igual(await dniResuelto(P.dni, DOMINIO_NUEVO), P.dni, "nuevo de vuelta");
  });
} finally {
  await bd.parar();
}
console.log(`\n${ok} verdes, ${fallos} fallo(s).`);
process.exit(fallos ? 1 : 0);
