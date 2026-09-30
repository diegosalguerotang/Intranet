// scripts/ensayar-correo.mjs — Ensayo LOCAL de correo_fallos_recientes() sobre el
// entorno 2.5 (seguridad hasta LICENCIAS + datos anonimizados): estado previo,
// migración, catálogo, guardas (superadmin verificado / pendiente / no superadmin /
// sin claims / anon), reversión y reaplicación. Uso: node scripts/ensayar-correo.mjs
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { arrancarPgLocal, cargarDatosAnonimizados } from "./pg-local.mjs";
import { FECHA, sinCorreo } from "./correo-generar.mjs";

const MIGRACION = readFileSync(`supabase/migraciones/${FECHA}-correo-fallos.sql`, "utf8");
const REVERSION = readFileSync(`supabase/respaldos/${FECHA}-correo-fallos-reversion.sql`, "utf8");
const SEGURIDAD_PREVIA = sinCorreo(readFileSync("supabase/seguridad.sql", "utf8"));

let fallos = 0, ok = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); await cliente.query("rollback").catch(() => {}); }
};
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const bd = await arrancarPgLocal({ seguridad: false, datos: false });
const { sql, cliente } = bd;
await sql(SEGURIDAD_PREVIA);
// Volcado anterior a la fase 6: mismo ajuste del piso de clave que ensayar-factor.
await sql("alter table interno.politica_acceso drop constraint if exists chk_clave_min_backoffice");
await cargarDatosAnonimizados(sql);
await sql("update interno.politica_acceso set clave_longitud_min_backoffice = 10 where id = 1 and clave_longitud_min_backoffice < 10");
await sql("alter table interno.politica_acceso add constraint chk_clave_min_backoffice check (clave_longitud_min_backoffice >= 10)");
await sql("set search_path = public, interno, extensions");

const como = async (rol, claims, texto) => {
  await cliente.query("begin");
  try {
    await cliente.query(`set local role ${rol}`);
    await cliente.query(`select set_config('request.jwt.claims', $1, true)`, [claims === null ? "" : JSON.stringify(claims)]);
    const r = await cliente.query(texto);
    return { filas: r.rows };
  } catch (e) { return { codigo: e.code, mensaje: e.message }; }
  finally { await cliente.query("rollback"); }
};
const [SUPER] = await sql(`select ua.correo, au.id as sub from usuarios_admin ua join auth.users au on lower(au.email) = lower(ua.correo)
  join perfiles p on p.id = ua.perfil_id and p.version = ua.perfil_version where ua.estado = 'activo' and p.es_superadmin order by ua.id limit 1`);
const [NO_SUPER] = await sql(`select ua.correo, au.id as sub from usuarios_admin ua join auth.users au on lower(au.email) = lower(ua.correo)
  join perfiles p on p.id = ua.perfil_id and p.version = ua.perfil_version where ua.estado = 'activo' and not p.es_superadmin order by ua.id limit 1`);
const claims = (u, session_id) => ({ role: "authenticated", email: u.correo, sub: u.sub, ...(session_id ? { session_id } : {}) });
// Tras la reversión la función no existe: has_function_privilege lanzaría error,
// por eso los privilegios se consultan por oid (null si no está).
const catalogo = async () => (await sql(`select f.oid is not null as existe,
  has_function_privilege('authenticated', f.oid, 'execute') as auth,
  has_function_privilege('anon', f.oid, 'execute') as anon,
  has_table_privilege('authenticated', 'public.correo_envios', 'select') as tabla
  from (select to_regprocedure('public.correo_fallos_recientes()') as oid) f`))[0];
console.log(`superadmin ${SUPER.correo} · no superadmin ${NO_SUPER?.correo ?? "(ninguno en los datos)"}`);

try {
  console.log("== 0 · antes de la migración");
  await prueba("la función no existe; correo_envios cerrada a authenticated", async () => {
    const [r] = await sql(`select to_regprocedure('public.correo_fallos_recientes()') is not null as existe,
      has_table_privilege('authenticated', 'public.correo_envios', 'select') as tabla`);
    igual(`${r.existe}/${r.tabla}`, "false/false", "estado previo");
  });

  console.log("\n== 1 · migración");
  await prueba("aplica en una transacción (verificación embebida incluida)", async () => { await sql(MIGRACION); });
  await prueba("catálogo: definer, EXECUTE solo authenticated (no anon), tabla sigue cerrada", async () => {
    const c = await catalogo(); igual(`${c.existe}/${c.auth}/${c.anon}/${c.tabla}`, "true/true/false/false", "catálogo");
  });

  console.log("\n== 2 · reglas");
  await sql(`insert into correo_envios (creado_en, accion, ip, sujeto, destinatario, resultado, detalle) values
    (now() - interval '1 hour', 'segundo-factor', '203.0.113.1', 'zz@ejemplo.invalido', 'zz@ejemplo.invalido', 'error', 'El proveedor de correo respondió 400: API key is invalid'),
    (now() - interval '2 hours', 'acceso-portal', null, null, 'zz2@ejemplo.invalido', 'error', 'El proveedor de correo respondió 429: rate limit'),
    (now() - interval '25 hours', 'acceso-admin', null, null, 'viejo@ejemplo.invalido', 'error', 'antiguo'),
    (now() - interval '10 minutes', 'segundo-factor', '203.0.113.1', 'zz@ejemplo.invalido', 'zz@ejemplo.invalido', 'enviado', null),
    (now() - interval '10 minutes', 'recuperacion', '203.0.113.1', '12345678', null, 'limitado', 'ip=30')`);
  await sql("update interno.politica_acceso set factor_superadmin = false where id = 1");
  await prueba("superadmin (factor apagado): ve los 2 errores de 24 h, el más reciente primero; no ve el antiguo ni enviado/limitado", async () => {
    const r = await como("authenticated", claims(SUPER), "select accion, destinatario, detalle from correo_fallos_recientes()");
    if (r.codigo) throw new Error(`${r.codigo} ${r.mensaje}`);
    igual(r.filas.map((f) => `${f.accion}:${f.destinatario}`).join("|"), "segundo-factor:zz@ejemplo.invalido|acceso-portal:zz2@ejemplo.invalido", "filas");
    igual(/API key is invalid/.test(r.filas[0].detalle), true, "detalle");
  });
  await sql("update interno.politica_acceso set factor_superadmin = true where id = 1");
  await prueba("superadmin con el segundo factor pendiente (session_id sin marca) → 42501", async () => {
    const r = await como("authenticated", claims(SUPER, randomUUID()), "select * from correo_fallos_recientes()");
    igual(r.codigo, "42501", "pendiente");
  });
  await prueba("administrador no superadmin → 42501; authenticated sin claims → 42501; anon → 42501 (sin EXECUTE)", async () => {
    if (NO_SUPER) igual((await como("authenticated", claims(NO_SUPER), "select * from correo_fallos_recientes()")).codigo, "42501", "no superadmin");
    igual((await como("authenticated", null, "select * from correo_fallos_recientes()")).codigo, "42501", "sin claims");
    igual((await como("anon", { role: "anon" }, "select * from correo_fallos_recientes()")).codigo, "42501", "anon");
  });
  await prueba("nadie de la API lee correo_envios directo", async () => {
    igual((await como("authenticated", claims(SUPER), "select count(*) from correo_envios")).codigo, "42501", "tabla");
  });

  console.log("\n== 3 · reversión y reaplicación");
  await prueba("la reversión quita la función y deja la tabla cerrada; la migración se reaplica", async () => {
    await sql(REVERSION);
    let c = await catalogo(); igual(`${c.existe}/${c.tabla}`, "false/false", "tras reversión");
    await sql(MIGRACION);
    c = await catalogo(); igual(`${c.existe}/${c.auth}/${c.anon}`, "true/true/false", "reaplicada");
  });
} finally {
  await bd.parar();
}
console.log(`\n${ok} ok · ${fallos} fallo(s)`);
process.exit(fallos ? 1 : 0);
