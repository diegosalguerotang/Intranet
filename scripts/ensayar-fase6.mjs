// scripts/ensayar-fase6.mjs — Ensayo LOCAL de la FASE 6b (límites e identidad)
// sobre el entorno 2.5 en estado de la fase 5 + datos anonimizados. Primero
// demuestra los huecos (un «exitoso» falso sin sesión; nivel 99 sin JWT con rol
// activo authenticated), aplica la migración y comprueba cada regla; al final
// ensaya la reversión y vuelve a aplicar.
// Uso: node scripts/ensayar-fase6.mjs
import { readFileSync } from "node:fs";
import { arrancarPgLocal, cargarDatosAnonimizados } from "./pg-local.mjs";
import { FECHA, LIMITE_IP_FALLIDOS, CLAVE_MIN_BACKOFFICE, sinFase6 } from "./fase6-generar.mjs";

const MIGRACION = readFileSync(`supabase/migraciones/${FECHA}-fase6-limites.sql`, "utf8");
const REVERSION = readFileSync(`supabase/respaldos/${FECHA}-fase6-reversion.sql`, "utf8");
const SEGURIDAD_5 = sinFase6(readFileSync("supabase/seguridad.sql", "utf8"));

let fallos = 0, ok = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); await cliente.query("rollback").catch(() => {}); }
};
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const bd = await arrancarPgLocal({ seguridad: false, datos: false });
const { sql, cliente } = bd;
await sql(SEGURIDAD_5);
await cargarDatosAnonimizados(sql);
await sql("set search_path = public, interno, extensions");

// Ejecuta pasos como un rol de la API, con claims y cabeceras opcionales, en
// una transacción que se revierte salvo que se pida conservar.
const como = async (rol, { claims, cabeceras, conservar = false, previo = [] } = {}, pasos) => {
  await cliente.query("begin");
  try {
    for (const p of previo) await cliente.query(p);  // como postgres, antes de cambiar de rol
    if (rol) await cliente.query(`set local role ${rol}`);
    if (claims !== undefined) await cliente.query(`select set_config('request.jwt.claims', $1, true)`, [claims === null ? "" : JSON.stringify(claims)]);
    if (cabeceras) await cliente.query(`select set_config('request.headers', $1, true)`, [JSON.stringify(cabeceras)]);
    let r; for (const [texto, params] of pasos) r = await cliente.query(texto, params);
    await cliente.query(conservar ? "commit" : "rollback");
    return { filas: r.rows, n: r.rowCount };
  } catch (e) { await cliente.query("rollback"); return { codigo: e.code, mensaje: e.message }; }
};
// fn_nivel_modulo no es ejecutable por anon: se concede solo dentro de la transacción (se revierte).
const nivel = async (rol, opciones) => { const r = await como(rol, { ...opciones, previo: ["grant execute on function public.fn_nivel_modulo(text) to anon, authenticated"] }, [["select fn_nivel_modulo('accesos') as n"]]); if (r.codigo) throw new Error(`${r.codigo} ${r.mensaje}`); return r.filas[0].n; };
const servicio = (pasos, conservar = true) => como("service_role", { claims: { role: "service_role" }, conservar }, pasos);

// --- Identidades ------------------------------------------------------------
const [SUPER] = await sql(`select ua.correo, au.id as sub from usuarios_admin ua join auth.users au on lower(au.email) = lower(ua.correo)
  join perfiles p on p.id = ua.perfil_id and p.version = ua.perfil_version where ua.estado = 'activo' and p.es_superadmin order by ua.id limit 1`);
const [P] = await sql(`select v.persona_dni as dni from vinculos v where v.fecha_fin is null and v.persona_dni ~ '^9' order by v.persona_dni limit 1`);
const superClaims = { role: "authenticated", email: SUPER.correo, sub: SUPER.sub };
const portalClaims = { role: "authenticated", email: `${P.dni.toLowerCase()}@portal.grupoer.pe`, sub: "11111111-1111-1111-1111-111111111111" };
const anon = { claims: { role: "anon" } };
const IP_ATAQUE = "198.51.100.9";
// La política vigente en los datos (producción: 10 intentos en 5 minutos).
const [POL] = await sql("select intentos_bloqueo as intentos, bloqueo_minutos as minutos from politica_acceso where id = 1");
console.log(`Política: ${POL.intentos} intentos / ${POL.minutos} min · superadmin ${SUPER.correo} · trabajador ${P.dni}`);

const foto = async () => {
  const filas = await sql(`select 'fn:' || p.oid::regprocedure::text as objeto, coalesce(p.proacl::text, '') || '|' || md5(p.prosrc) as valor from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    union all select 'chk:' || conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'interno.politica_acceso'::regclass
    union all select 'val:clave_min_bo', clave_longitud_min_backoffice::text from interno.politica_acceso where id = 1
    union all select 'def:clave_min_bo', coalesce(pg_get_expr(d.adbin, d.adrelid), '') from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum where d.adrelid = 'interno.politica_acceso'::regclass and a.attname = 'clave_longitud_min_backoffice'
    order by 1`);
  return new Map(filas.map((f) => [f.objeto, f.valor]));
};
const compararFotos = (a, b) => { const d = []; for (const [k, v] of a) if (!b.has(k)) d.push(`falta: ${k}`); else if (b.get(k) !== v) d.push(`difiere: ${k}`); for (const k of b.keys()) if (!a.has(k)) d.push(`sobra: ${k}`); return d; };

try {
  console.log("== 0 · Base: fase 5 + datos. Los huecos que cierra la fase 6");
  const foto0 = await foto();
  await prueba("hoy: sin sesión (anon) cualquiera registra un «exitoso» de la cuenta del superadministrador", async () => {
    const r = await como("anon", anon, [["select registrar_ingreso($1, 'exitoso', 'ensayo')", [SUPER.correo]]]);
    if (r.codigo) throw new Error(`debería pasar y falló: ${r.codigo} ${r.mensaje}`);
  });
  await prueba("hoy: con rol activo authenticated y sin claims, fn_nivel_modulo devuelve 99", async () => {
    igual(await nivel("authenticated", { claims: null }), 99, "nivel");
  });

  console.log("\n== 1 · Migración");
  await prueba("la migración de la fase 6 se aplica sin errores (verificación embebida incluida)", async () => { await sql(MIGRACION); });
  await prueba("la política quedó en el piso de " + CLAVE_MIN_BACKOFFICE + " y el respaldo guarda 6 funciones + permisos + constraint + valor + default", async () => {
    const [r] = await sql(`select (select clave_longitud_min_backoffice from interno.politica_acceso where id = 1) as v,
      (select count(*)::int from interno.respaldo_fase6 where objeto like 'fn:%') as fn, (select count(*)::int from interno.respaldo_fase6) as total`);
    igual(r.v >= CLAVE_MIN_BACKOFFICE, true, "valor"); igual(r.fn, 6, "funciones"); igual(r.total, 15, "objetos respaldados");
  });

  console.log("\n== 2 · Identidad sin JWT (fallo cerrado)");
  await prueba("rol activo authenticated sin claims → 0; anon sin claims → 0", async () => {
    igual(await nivel("authenticated", { claims: null }), 0, "authenticated");
    igual(await nivel("anon", { claims: null }), 0, "anon");
  });
  await prueba("claims role=authenticated sin correo → 0; sesión postgres sin JWT → 99; rol de servicio → 99", async () => {
    igual(await nivel("authenticated", { claims: { role: "authenticated" } }), 0, "sin correo");
    igual(await nivel(null, { claims: null }), 99, "postgres");
    igual(await nivel("service_role", { claims: { role: "service_role" } }), 99, "service_role");
    igual(await nivel("service_role", { claims: null }), 99, "service_role sin claims (rol activo)");
  });
  await prueba("con JWT sigue igual: superadmin 99, trabajador del Portal 0", async () => {
    igual(await nivel("authenticated", { claims: superClaims }), 99, "superadmin");
    igual(await nivel("authenticated", { claims: portalClaims }), 0, "trabajador");
  });

  console.log("\n== 3 · Bitácora del BackOffice");
  await prueba("anon ya no puede registrar un «exitoso» ajeno (42501); fallido y bloqueado siguen abiertos (pre-login) y guardan la IP real", async () => {
    const r = await como("anon", anon, [["select registrar_ingreso($1, 'exitoso', 'ensayo')", [SUPER.correo]]]);
    igual(r.codigo, "42501", "exitoso anon");
    const f = await como("anon", { ...anon, cabeceras: { "x-ip-real": "203.0.113.7", "x-agente": "Ensayo" }, conservar: true },
      [["select registrar_ingreso($1, 'fallido', 'ensayo')", [SUPER.correo]]]);
    if (f.codigo) throw new Error(`fallido anon: ${f.codigo} ${f.mensaje}`);
    const [fila] = await sql("select ip, fuente, resultado from registro_accesos order by id desc limit 1");
    igual(`${fila.ip}/${fila.fuente}/${fila.resultado}`, "203.0.113.7/cliente/fallido", "fila");
  });
  await prueba("la propia sesión sí registra su «exitoso» y actualiza ultimo_ingreso", async () => {
    const r = await como("authenticated", { claims: superClaims, cabeceras: { "x-ip-real": "203.0.113.7" }, conservar: true },
      [["select registrar_ingreso($1, 'exitoso', 'ensayo')", [SUPER.correo]],
       ["select (select ultimo_ingreso > now() - interval '1 minute' from usuarios_admin where lower(correo) = lower($1)) as reciente, (select fuente from registro_accesos order by id desc limit 1) as fuente", [SUPER.correo]]]);
    if (r.codigo) throw new Error(`${r.codigo} ${r.mensaje}`);
    igual(`${r.filas[0].reciente}/${r.filas[0].fuente}`, "true/cliente", "exitoso propio");
  });
  await prueba("los «fallido» anotados por el navegador NO bloquean (aunque superen la política); los anotados por el proxy SÍ; la compuerta lo refleja", async () => {
    for (let i = 0; i < POL.intentos; i++) await como("anon", { ...anon, conservar: true }, [["select registrar_ingreso($1, 'fallido', 'ensayo')", [SUPER.correo]]]);
    let r = await como("anon", anon, [["select verificar_bloqueo($1) as b", [SUPER.correo]]]);
    igual(r.filas[0].b, false, `tras ${POL.intentos} del cliente`);
    for (let i = 0; i < POL.intentos; i++) await servicio([["select api_login_registrar($1, 'fallido', '203.0.113.7', 'Ensayo')", [SUPER.correo]]]);
    r = await como("anon", anon, [["select verificar_bloqueo($1) as b", [SUPER.correo]]]);
    igual(r.filas[0].b, true, `tras ${POL.intentos} del proxy`);
    r = await servicio([["select api_login_permitido('203.0.113.7', $1) as v", [SUPER.correo]]], false);
    igual(r.filas[0].v.motivo, "cuenta", "compuerta"); igual(r.filas[0].v.permitido, false, "permitido");
  });
  await prueba("un «exitoso» de la propia sesión levanta el bloqueo", async () => {
    await como("authenticated", { claims: superClaims, conservar: true }, [["select registrar_ingreso($1, 'exitoso', 'ensayo')", [SUPER.correo]]]);
    const r = await servicio([["select api_login_permitido('203.0.113.7', $1) as v", [SUPER.correo]]], false);
    igual(r.filas[0].v.permitido, true, "permitido");
  });

  console.log("\n== 4 · Límite por IP real");
  await prueba(`${LIMITE_IP_FALLIDOS} fallos del proxy desde una IP (cuentas distintas) cierran esa IP y no otra`, async () => {
    for (let i = 0; i < LIMITE_IP_FALLIDOS; i++) await servicio([["select api_login_registrar($1, 'fallido', $2, 'Ensayo')", [`intento${i}@ejemplo.invalido`, IP_ATAQUE]]]);
    let r = await servicio([["select api_login_permitido($1, 'otra@ejemplo.invalido') as v", [IP_ATAQUE]]], false);
    igual(`${r.filas[0].v.permitido}/${r.filas[0].v.motivo}`, "false/ip", "IP atacante");
    r = await servicio([["select api_login_permitido('203.0.113.8', 'otra@ejemplo.invalido') as v"]], false);
    igual(r.filas[0].v.permitido, true, "otra IP");
    r = await servicio([["select api_login_permitido('', $1) as v", [SUPER.correo]]], false);
    igual(r.filas[0].v.permitido, true, "sin IP: solo cuenta");
  });

  console.log("\n== 5 · Portal");
  await prueba("anon no registra un «exitoso» ajeno del Portal; la propia sesión sí; el proxy bloquea por documento", async () => {
    let r = await como("anon", anon, [["select portal_registrar_ingreso($1, 'exitoso', 'ensayo')", [P.dni]]]);
    igual(r.codigo, "42501", "exitoso anon");
    r = await como("authenticated", { claims: portalClaims, conservar: true }, [["select portal_registrar_ingreso($1, 'exitoso', 'ensayo')", [P.dni]]]);
    if (r.codigo) throw new Error(`exitoso propio: ${r.codigo} ${r.mensaje}`);
    for (let i = 0; i < POL.intentos; i++) await servicio([["select api_login_registrar($1, 'fallido', '203.0.113.9', 'Ensayo')", [`${P.dni.toLowerCase()}@portal.grupoer.pe`]]]);
    r = await como("anon", anon, [["select portal_verificar_bloqueo($1) as b", [P.dni]]]);
    igual(r.filas[0].b, true, "bloqueo portal");
    r = await servicio([["select api_login_permitido('203.0.113.9', $1) as v", [`${P.dni.toLowerCase()}@portal.grupoer.pe`]]], false);
    igual(r.filas[0].v.motivo, "cuenta", "compuerta portal");
    const [fila] = await sql(`select dni, superficie, fuente from registro_accesos where superficie = 'portal' and fuente = 'proxy' order by id desc limit 1`);
    igual(`${fila.dni}/${fila.superficie}`, `${P.dni.toUpperCase()}/portal`, "fila del proxy");
  });

  console.log("\n== 6 · Política (P11) y permisos");
  await prueba(`guardar_politica rechaza un mínimo < ${CLAVE_MIN_BACKOFFICE} para el BackOffice y acepta ${CLAVE_MIN_BACKOFFICE + 2}; el constraint frena una escritura directa`, async () => {
    const args = (min) => [`select guardar_politica(8, 30, false, true, 5, 15, 'whatsapp', 6, ${min}, 7, 'ensayo')`];
    let r = await como("authenticated", { claims: superClaims }, [args(8)]);
    if (!r.codigo || !/al menos 10/.test(r.mensaje)) throw new Error(`debió rechazar 8: ${JSON.stringify(r)}`);
    r = await como("authenticated", { claims: superClaims, conservar: true }, [args(CLAVE_MIN_BACKOFFICE + 2), ["select clave_longitud_min_backoffice as v from politica_acceso where id = 1"]]);
    if (r.codigo) throw new Error(`debió aceptar: ${r.codigo} ${r.mensaje}`);
    igual(r.filas[0].v, CLAVE_MIN_BACKOFFICE + 2, "valor");
    r = await como(null, {}, [["update interno.politica_acceso set clave_longitud_min_backoffice = 6 where id = 1"]]);
    igual(r.codigo, "23514", "constraint");
  });
  await prueba("api_login_* solo para service_role; anon conserva las 4 RPC pre-login", async () => {
    let r = await como("authenticated", { claims: superClaims }, [["select api_login_permitido('1.1.1.1', 'x@y')"]]);
    igual(r.codigo, "42501", "authenticated");
    r = await como("anon", anon, [["select api_login_registrar('x@y', 'fallido', '1.1.1.1', 'z')"]]);
    igual(r.codigo, "42501", "anon");
    const [g] = await sql(`select bool_and(has_function_privilege('anon', f, 'execute')) as ok from unnest(array['public.verificar_bloqueo(text)', 'public.registrar_ingreso(text, text, text)', 'public.portal_verificar_bloqueo(text)', 'public.portal_registrar_ingreso(text, text, text)']) f`);
    igual(g.ok, true, "pre-login");
  });

  console.log("\n== 7 · Reversión");
  await prueba("la reversión restaura funciones, permisos y política; la foto es idéntica a la inicial", async () => {
    await sql(REVERSION);
    const dif = compararFotos(foto0, await foto()); if (dif.length) throw new Error(dif.join("; "));
    igual(await nivel("authenticated", { claims: null }), 99, "hueco de vuelta (esperado tras revertir)");
  });
  await prueba("la fase 6 vuelve a aplicarse", async () => { await sql(MIGRACION); igual(await nivel("authenticated", { claims: null }), 0, "cerrado"); });
} finally {
  await bd.parar();
}
console.log(`\n${ok} verdes, ${fallos} fallo(s).`);
process.exit(fallos ? 1 : 0);
