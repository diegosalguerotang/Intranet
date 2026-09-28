// scripts/ensayar-factor.mjs — Ensayo LOCAL del segundo factor por correo
// (2026-09-28) sobre el entorno 2.5 en estado de la fase 6 + datos
// anonimizados. Demuestra el hueco (superadmin con JWT vale 99 sin verificar),
// aplica la migración, comprueba cada regla, ensaya la reversión y reaplica.
// Uso: node scripts/ensayar-factor.mjs
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { arrancarPgLocal, cargarDatosAnonimizados, aclNormal } from "./pg-local.mjs";
import { FECHA, sinFactor, FUNCIONES } from "./factor-generar.mjs";

const MIGRACION = readFileSync(`supabase/migraciones/${FECHA}-segundo-factor.sql`, "utf8");
const REVERSION = readFileSync(`supabase/respaldos/${FECHA}-segundo-factor-reversion.sql`, "utf8");
const SEGURIDAD_6 = sinFactor(readFileSync("supabase/seguridad.sql", "utf8"));
const hash = (t) => createHash("sha256").update(t).digest("hex");

let fallos = 0, ok = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); await cliente.query("rollback").catch(() => {}); }
};
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const bd = await arrancarPgLocal({ seguridad: false, datos: false });
const { sql, cliente } = bd;
await sql(SEGURIDAD_6);
// El volcado anonimizado es de antes de la fase 6 (2026-08-21): trae
// clave_longitud_min_backoffice = 6, por debajo del piso de 10 que la fase 6
// ya dejó como constraint en SEGURIDAD_6. Se quita el constraint para poder
// cargar el volcado y se repone igual que lo hace la propia migración de la
// fase 6 (piso primero, constraint después).
await sql("alter table interno.politica_acceso drop constraint if exists chk_clave_min_backoffice");
await cargarDatosAnonimizados(sql);
await sql("update interno.politica_acceso set clave_longitud_min_backoffice = 10 where id = 1 and clave_longitud_min_backoffice < 10");
await sql("alter table interno.politica_acceso add constraint chk_clave_min_backoffice check (clave_longitud_min_backoffice >= 10)");
await sql("set search_path = public, interno, extensions");

const como = async (rol, { claims, cabeceras, conservar = false, previo = [] } = {}, pasos) => {
  await cliente.query("begin");
  try {
    for (const p of previo) await cliente.query(p);
    if (rol) await cliente.query(`set local role ${rol}`);
    if (claims !== undefined) await cliente.query(`select set_config('request.jwt.claims', $1, true)`, [claims === null ? "" : JSON.stringify(claims)]);
    if (cabeceras) await cliente.query(`select set_config('request.headers', $1, true)`, [JSON.stringify(cabeceras)]);
    let r; for (const [texto, params] of pasos) r = await cliente.query(texto, params);
    await cliente.query(conservar ? "commit" : "rollback");
    return { filas: r.rows, n: r.rowCount };
  } catch (e) { await cliente.query("rollback"); return { codigo: e.code, mensaje: e.message }; }
};
const nivel = async (claims) => {
  const r = await como("authenticated", { claims, previo: ["grant execute on function public.fn_nivel_modulo(text) to authenticated"] }, [["select fn_nivel_modulo('accesos') as n"]]);
  if (r.codigo) throw new Error(`${r.codigo} ${r.mensaje}`); return r.filas[0].n;
};
const servicio = (pasos, conservar = true) => como("service_role", { claims: { role: "service_role" }, conservar }, pasos);
const sinError = (r, msj) => { if (r.codigo) throw new Error(`${msj}: ${r.codigo} ${r.mensaje}`); return r; };

const [SUPER] = await sql(`select ua.correo, au.id as sub from usuarios_admin ua join auth.users au on lower(au.email) = lower(ua.correo)
  join perfiles p on p.id = ua.perfil_id and p.version = ua.perfil_version where ua.estado = 'activo' and p.es_superadmin order by ua.id limit 1`);
const [NO_SUPER] = await sql(`select ua.correo, au.id as sub from usuarios_admin ua join auth.users au on lower(au.email) = lower(ua.correo)
  join perfiles p on p.id = ua.perfil_id and p.version = ua.perfil_version where ua.estado = 'activo' and not p.es_superadmin order by ua.id limit 1`);
const S1 = randomUUID(), S2 = randomUUID(), S3 = randomUUID(), S4 = randomUUID(), S5 = randomUUID(), S6 = randomUUID();
const claims = (correo, sub, session_id) => ({ role: "authenticated", email: correo, sub, ...(session_id ? { session_id } : {}) });
const superSin = claims(SUPER.correo, SUPER.sub);
const superS1 = claims(SUPER.correo, SUPER.sub, S1);
const [{ dni: DNI_CUENTA }] = await sql("select coalesce((select dni from datos_bancarios order by dni limit 1), (select dni from personas order by dni limit 1)) as dni");
console.log(`superadmin ${SUPER.correo} · no superadmin ${NO_SUPER?.correo ?? "(ninguno en los datos)"}`);

const foto = async () => {
  const filas = await sql(`select 'fn:' || p.oid::regprocedure::text as objeto, coalesce(p.proacl::text, '') || '|' || md5(p.prosrc) as valor from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    union all select 'view:v_politica_acceso', coalesce(c.relacl::text, '') || '|' || md5(pg_get_viewdef(c.oid)) || '|' || coalesce(array_to_string(c.reloptions, ','), '') from pg_class c where c.oid = 'public.v_politica_acceso'::regclass
    union all select 'col:' || attname, atttypid::regtype::text from pg_attribute where attrelid = 'interno.politica_acceso'::regclass and attnum > 0 and not attisdropped
    union all select 'tabla:' || relname, '' from pg_class where relnamespace = 'interno'::regnamespace and relkind = 'r'
    order by 1`);
  // El ACL (primer tramo antes de "|") no tiene un orden garantizado entre
  // concesiones equivalentes ({a=X,b=X} = {b=X,a=X}, igual que aclNormal en
  // pg-local.mjs): se normaliza antes de comparar para no acusar una
  // "diferencia" que es solo de orden.
  const normalizar = (v) => { const i = v.indexOf("|"); return i < 0 ? v : aclNormal(v.slice(0, i)) + v.slice(i); };
  return new Map(filas.map((f) => [f.objeto, normalizar(f.valor)]));
};
const compararFotos = (a, b) => { const d = []; for (const [k, v] of a) if (!b.has(k)) d.push(`falta: ${k}`); else if (b.get(k) !== v) d.push(`difiere: ${k}`); for (const k of b.keys()) if (!a.has(k)) d.push(`sobra: ${k}`); return d; };

try {
  console.log("== 0 · Base: fase 6 + datos. El hueco");
  const foto0 = await foto();
  await prueba("hoy: un superadmin con JWT vale 99 sin verificar nada", async () => { igual(await nivel(superSin), 99, "nivel"); });

  console.log("\n== 1 · Migración");
  await prueba("la migración se aplica sin errores (verificación embebida incluida)", async () => { await sql(MIGRACION); });
  await prueba(`respaldo con ${FUNCIONES.length} funciones + ${FUNCIONES.length} ACL + vista + ACL de vista; política con factor_superadmin = true`, async () => {
    const [r] = await sql(`select (select count(*)::int from interno.respaldo_factor) as total, (select factor_superadmin from interno.politica_acceso where id = 1) as pol,
      (select "factorSuperadmin" from public.v_politica_acceso) as vista`);
    igual(r.total, 2 * FUNCIONES.length + 2, "objetos"); igual(r.pol, true, "política"); igual(r.vista, true, "vista");
  });

  console.log("\n== 2 · Guarda en la base");
  await prueba("superadmin con JWT sin session_id → 0; con session_id sin marca → 0; sin JWT: postgres 99, service_role 99", async () => {
    igual(await nivel(superSin), 0, "sin session_id");
    igual(await nivel(superS1), 0, "sin marca");
    const r = sinError(await como(null, {}, [["select fn_nivel_modulo('accesos') as n"]]), "postgres"); igual(r.filas[0].n, 99, "postgres");
    const s = sinError(await servicio([["select fn_nivel_modulo('accesos') as n"]], false), "service_role"); igual(s.filas[0].n, 99, "service_role");
  });
  await prueba("pendiente: v_usuarios_admin y v_mi_acceso devuelven la fila propia; v_personal vacía; mi_segundo_factor exigido y no verificado con correo enmascarado", async () => {
    const r = sinError(await como("authenticated", { claims: superS1 }, [[`select (select count(*)::int from v_usuarios_admin where lower(correo) = lower($1)) as u, (select count(*)::int from v_mi_acceso) as m, (select count(*)::int from v_personal) as p, mi_segundo_factor() as f`, [SUPER.correo]]]), "vistas");
    const f = r.filas[0];
    igual(`${f.u}/${f.m}/${f.p}`, "1/1/0", "filas");
    igual(`${f.f.exigido}/${f.f.verificado}/${f.f.esSuperadmin}`, "true/false/true", "estado");
    if (!/^.•••@/.test(f.f.correo)) throw new Error(`correo sin enmascarar: ${f.f.correo}`);
  });
  await prueba("un administrador no superadmin no cambia: exigido=false y su nivel es el de su categoría", async () => {
    if (!NO_SUPER) return;
    const r = sinError(await como("authenticated", { claims: claims(NO_SUPER.correo, NO_SUPER.sub) }, [["select mi_segundo_factor() as f, es_superadmin() as s, nivel_en('personal') as n"]]), "no superadmin");
    igual(`${r.filas[0].f.exigido}/${r.filas[0].f.esSuperadmin}/${r.filas[0].s}`, "false/false/false", "estado");
    const [esperado] = await sql(`select coalesce(pp.nivel, 0) as nivel from usuarios_admin u
      join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
      left join perfil_permisos pp on pp.perfil_id = u.perfil_id and pp.perfil_version = u.perfil_version and pp.modulo = 'personal'
      where lower(u.correo) = lower($1)`, [NO_SUPER.correo]);
    igual(r.filas[0].n, esperado.nivel, "nivel de categoría (personal)");
  });
  await prueba("política apagada → 99 sin marca; encendida → 0", async () => {
    await sql("update interno.politica_acceso set factor_superadmin = false where id = 1");
    igual(await nivel(superS1), 99, "apagada");
    await sql("update interno.politica_acceso set factor_superadmin = true where id = 1");
    igual(await nivel(superS1), 0, "encendida");
  });

  console.log("\n== 3 · Códigos (funciones de servicio)");
  const CODIGO = "123456";
  await prueba("emitir: ok; segunda emisión en < 60 s → espera; no superadmin → no_superadmin; política apagada → apagado", async () => {
    let r = sinError(await servicio([["select api_factor_emitir($1, $2, $3, '203.0.113.7', 'Ensayo') as v", [SUPER.correo, S1, hash(CODIGO + S1)]]]), "emitir");
    igual(r.filas[0].v.ok, true, "ok");
    r = sinError(await servicio([["select api_factor_emitir($1, $2, $3, '203.0.113.7', 'Ensayo') as v", [SUPER.correo, S1, hash("000000" + S1)]]], false), "reemitir");
    igual(r.filas[0].v.motivo, "espera", "espera"); if (!(r.filas[0].v.espera_seg > 0 && r.filas[0].v.espera_seg <= 60)) throw new Error(`espera_seg ${r.filas[0].v.espera_seg}`);
    if (NO_SUPER) { r = sinError(await servicio([["select api_factor_emitir($1, $2, 'x', null, null) as v", [NO_SUPER.correo, S1]]], false), "otro"); igual(r.filas[0].v.motivo, "no_superadmin", "otro"); }
    await sql("update interno.politica_acceso set factor_superadmin = false where id = 1");
    r = sinError(await servicio([["select api_factor_emitir($1, $2, 'x', null, null) as v", [SUPER.correo, S2]]], false), "apagado"); igual(r.filas[0].v.motivo, "apagado", "apagado");
    await sql("update interno.politica_acceso set factor_superadmin = true where id = 1");
  });
  await prueba("verificar: 4 fallos bajan intentos_restantes 4→1, el 5.º agota; después ni el código correcto sirve", async () => {
    for (let i = 4; i >= 1; i--) {
      const r = sinError(await servicio([["select api_factor_verificar($1, $2, $3, '203.0.113.7', 'Ensayo') as v", [SUPER.correo, S1, hash("999999" + S1)]]]), `fallo ${i}`);
      igual(`${r.filas[0].v.motivo}/${r.filas[0].v.intentos_restantes}`, `incorrecto/${i}`, `fallo ${i}`);
    }
    let r = sinError(await servicio([["select api_factor_verificar($1, $2, $3, null, null) as v", [SUPER.correo, S1, hash("999999" + S1)]]]), "5.º");
    igual(r.filas[0].v.motivo, "agotado", "agotado");
    r = sinError(await servicio([["select api_factor_verificar($1, $2, $3, null, null) as v", [SUPER.correo, S1, hash(CODIGO + S1)]]]), "correcto tarde");
    igual(r.filas[0].v.ok, false, "agotado no admite el correcto");
  });
  await prueba("nuevo código tras 60 s: ok; el anterior queda inválido; el nuevo verifica y deja marca → nivel 99 y mi_segundo_factor verificado", async () => {
    await sql("update interno.factor_codigos set creado_en = creado_en - interval '61 seconds'");
    let r = sinError(await servicio([["select api_factor_emitir($1, $2, $3, '203.0.113.7', 'Ensayo') as v", [SUPER.correo, S1, hash("654321" + S1)]]]), "emitir");
    igual(r.filas[0].v.ok, true, "ok");
    const [c] = await sql("select count(*)::int as n from interno.factor_codigos where session_id = $1 and usado_en is null", [S1]); igual(c.n, 1, "un solo código vigente");
    const viejo = sinError(await servicio([["select api_factor_verificar($1, $2, $3, null, null) as v", [SUPER.correo, S1, hash(CODIGO + S1)]]]), "hash viejo tras reemitir");
    igual(viejo.filas[0].v.motivo, "incorrecto", "el código anterior ya no sirve (se compara contra el nuevo, no vencido)");
    r = sinError(await servicio([["select api_factor_verificar($1, $2, $3, '203.0.113.7', 'Ensayo') as v", [SUPER.correo, S1, hash("654321" + S1)]]]), "verificar");
    igual(r.filas[0].v.ok, true, "verificado");
    igual(await nivel(superS1), 99, "nivel");
    const m = sinError(await como("authenticated", { claims: superS1 }, [["select mi_segundo_factor() as f"]]), "mi_segundo_factor"); igual(m.filas[0].f.verificado, true, "verificado");
    const [a] = await sql("select count(*)::int as n from interno.auditoria where accion = 'FACTOR_VERIFICADO'"); igual(a.n, 1, "auditoría");
    const [u] = await sql("select count(*)::int as n from interno.factor_codigos where session_id = $1 and usado_en is null", [S1]); igual(u.n, 0, "código consumido");
  });
  await prueba("código vencido → vencido; marca vencida → 0 otra vez", async () => {
    sinError(await servicio([["select api_factor_emitir($1, $2, $3, null, null) as v", [SUPER.correo, S2, hash(CODIGO + S2)]]]), "emitir S2");
    await sql("update interno.factor_codigos set expira_en = now() - interval '1 second' where session_id = $1", [S2]);
    const r = sinError(await servicio([["select api_factor_verificar($1, $2, $3, null, null) as v", [SUPER.correo, S2, hash(CODIGO + S2)]]]), "vencido"); igual(r.filas[0].v.motivo, "vencido", "vencido");
    await sql("update interno.factor_sesiones set expira_en = now() - interval '1 second' where session_id = $1", [S1]);
    igual(await nivel(superS1), 0, "marca vencida");
    await sql("update interno.factor_sesiones set expira_en = now() + interval '1 hour' where session_id = $1", [S1]);
  });

  console.log("\n== 4 · Equipos recordados");
  const TOKEN = "token-de-ensayo-" + randomUUID();
  await prueba("crear exige sesión verificada (S2 sin marca → error); desde S1 verificado → ok", async () => {
    const r = await servicio([["select api_factor_dispositivo_crear($1, $2, $3, null, null)", [SUPER.correo, S2, hash(TOKEN)]]], false);
    if (!r.codigo) throw new Error("debió rechazar");
    sinError(await servicio([["select api_factor_dispositivo_crear($1, $2, $3, '203.0.113.7', 'Ensayo')", [SUPER.correo, S1, hash(TOKEN)]]]), "crear");
    const [d] = await sql("select count(*)::int as n from interno.dispositivos_confiables where token_hash = $1 and expira_en > now() + interval '29 days'", [hash(TOKEN)]); igual(d.n, 1, "30 días");
  });
  await prueba("usar el equipo desde una sesión nueva S3 → true, marca vía dispositivo, nivel 99; token desconocido → false; una sesión verificada por dispositivo no puede acuñar un token nuevo (equipo recordado: 30 días SIN renovación)", async () => {
    let r = sinError(await servicio([["select api_factor_dispositivo_usar($1, $2, $3, '203.0.113.7', 'Ensayo') as v", [SUPER.correo, S3, hash(TOKEN)]]]), "usar"); igual(r.filas[0].v, true, "usar");
    igual(await nivel(claims(SUPER.correo, SUPER.sub, S3)), 99, "nivel S3");
    const [m] = await sql("select via from interno.factor_sesiones where session_id = $1", [S3]); igual(m.via, "dispositivo", "vía");
    r = sinError(await servicio([["select api_factor_dispositivo_usar($1, $2, $3, null, null) as v", [SUPER.correo, S4, hash("otro")]]]), "otro"); igual(r.filas[0].v, false, "desconocido");
    igual(await nivel(claims(SUPER.correo, SUPER.sub, S4)), 0, "S4 sigue en 0");
    const rc = await servicio([["select api_factor_dispositivo_crear($1, $2, $3, null, null)", [SUPER.correo, S3, hash("otro-token")]]], false);
    if (!rc.codigo) throw new Error("una sesión verificada por dispositivo no debería poder crear un token nuevo (renovaría el equipo para siempre)");
  });
  await prueba("revocar → 1; el equipo deja de valer para S4; un equipo vencido (sin revocar) tampoco vale", async () => {
    let r = sinError(await servicio([["select api_factor_dispositivos_revocar($1) as n", [SUPER.correo]]]), "revocar"); igual(r.filas[0].n, 1, "revocados");
    r = sinError(await servicio([["select api_factor_dispositivo_usar($1, $2, $3, null, null) as v", [SUPER.correo, S4, hash(TOKEN)]]]), "usar revocado"); igual(r.filas[0].v, false, "revocado");
    const [a] = await sql("select count(*)::int as n from interno.auditoria where accion in ('FACTOR_DISPOSITIVO', 'FACTOR_DISPOSITIVOS_REVOCADOS')"); igual(a.n, 2, "auditoría");
    const TOKEN_VENCIDO = "token-vencido-" + randomUUID();
    sinError(await servicio([["select api_factor_dispositivo_crear($1, $2, $3, null, null)", [SUPER.correo, S1, hash(TOKEN_VENCIDO)]]]), "crear equipo a vencer");
    await sql("update interno.dispositivos_confiables set expira_en = now() - interval '1 second' where token_hash = $1", [hash(TOKEN_VENCIDO)]);
    r = sinError(await servicio([["select api_factor_dispositivo_usar($1, $2, $3, null, null) as v", [SUPER.correo, S6, hash(TOKEN_VENCIDO)]]]), "usar vencido"); igual(r.filas[0].v, false, "vencido, no revocado");
  });

  console.log("\n== 5 · Política y permisos");
  await prueba("guardar_politica (firma nueva) apaga y enciende el interruptor; la firma vieja ya no existe; v_politica_acceso lo expone", async () => {
    const args = (v) => `select guardar_politica(8, 30, false, true, 5, 15, 'whatsapp', 6, 10, 7, 'ensayo', ${v})`;
    let r = sinError(await como("authenticated", { claims: superS1, conservar: true }, [[args("false")], ['select "factorSuperadmin" as v from v_politica_acceso']]), "apagar"); igual(r.filas[0].v, false, "apagado");
    r = sinError(await como("authenticated", { claims: superS1, conservar: true }, [[args("true")], ['select "factorSuperadmin" as v from v_politica_acceso']]), "encender"); igual(r.filas[0].v, true, "encendido");
    r = sinError(await como("authenticated", { claims: superS1 }, [["select guardar_politica(8, 30, false, true, 5, 15, 'whatsapp', 6, 10, 7, 'ensayo')"], ['select "factorSuperadmin" as v from v_politica_acceso']]), "sin parámetro"); igual(r.filas[0].v, true, "sin parámetro conserva");
    const [f] = await sql("select to_regprocedure('public.guardar_politica(integer, integer, boolean, boolean, integer, integer, text, integer, integer, integer, text)') as vieja"); igual(f.vieja, null, "firma vieja");
  });
  await prueba("amenaza principal: un superadmin pendiente (con session_id, sin marca) no puede tocar la política (requiere_superadmin pasa por fn_nivel_modulo → 42501)", async () => {
    const superPendiente = claims(SUPER.correo, SUPER.sub, S5);
    const r = await como("authenticated", { claims: superPendiente }, [["select guardar_politica(8, 30, false, true, 5, 15, 'whatsapp', 6, 10, 7, 'ensayo')"]]);
    igual(r.codigo, "42501", "pendiente sin marca");
  });
  await prueba("guarda propia, superadmin pendiente: fn_ver_cuenta_bancaria → null, fn_nivel_memorandums → 0, previsualizar_planilla_unificada → 42501 «Verifica el código», previsualizar_padron rechazada (fn_nivel_modulo)", async () => {
    const superPendiente = claims(SUPER.correo, SUPER.sub, S5);
    let r = sinError(await como("authenticated", { claims: superPendiente }, [["select fn_ver_cuenta_bancaria($1) as c, fn_nivel_memorandums() as m", [DNI_CUENTA]]]), "cuenta/memorándums");
    igual(`${r.filas[0].c}/${r.filas[0].m}`, "null/0", "pendiente");
    r = await como("authenticated", { claims: superPendiente }, [["select previsualizar_planilla_unificada('[]'::jsonb, '2026-09', '[]'::jsonb)"]]);
    igual(r.codigo, "42501", "planilla unificada"); if (!/Verifica el código/.test(r.mensaje)) throw new Error(`mensaje: ${r.mensaje}`);
    r = await como("authenticated", { claims: superPendiente }, [["select previsualizar_padron('[]'::jsonb, '[]'::jsonb)"]]);
    if (!r.codigo) throw new Error("previsualizar_padron debió rechazar al superadmin pendiente");
  });
  await prueba("guarda propia, superadmin verificado (S1): cuenta bancaria no nula, fn_nivel_memorandums → 99, previsualizar_planilla_unificada sin «Verifica el código»", async () => {
    let r = sinError(await como("authenticated", { claims: superS1 }, [["select fn_ver_cuenta_bancaria($1) as c, fn_nivel_memorandums() as m", [DNI_CUENTA]]]), "cuenta/memorándums");
    if (r.filas[0].c === null) throw new Error("la cuenta bancaria no debería ser null con marca"); igual(r.filas[0].m, 99, "memorándums");
    r = await como("authenticated", { claims: superS1 }, [["select previsualizar_planilla_unificada('[]'::jsonb, '2026-09', '[]'::jsonb)"]]);
    if (r.codigo && /Verifica el código/.test(r.mensaje)) throw new Error(`con marca no debería pedir el código: ${r.mensaje}`);
  });
  await prueba("api_factor_* solo service_role; mi_segundo_factor solo authenticated; fn_factor_pendiente para nadie de la API; tablas sin acceso de la API", async () => {
    let r = await como("authenticated", { claims: superS1 }, [["select api_factor_dispositivos_revocar($1)", [SUPER.correo]]]); igual(r.codigo, "42501", "authenticated api_");
    r = await como("anon", { claims: { role: "anon" } }, [["select mi_segundo_factor()"]]); igual(r.codigo, "42501", "anon mi_segundo_factor");
    const [g] = await sql(`select bool_and(not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute') and has_function_privilege('service_role', f, 'execute')) as api,
      has_function_privilege('authenticated', 'public.fn_factor_pendiente()', 'execute') as pend,
      bool_and(not has_table_privilege('authenticated', 'interno.' || t, 'select') and not has_table_privilege('anon', 'interno.' || t, 'select')) as tablas
      from unnest(array['public.api_factor_emitir(text, uuid, text, text, text)', 'public.api_factor_verificar(text, uuid, text, text, text)', 'public.api_factor_dispositivo_crear(text, uuid, text, text, text)', 'public.api_factor_dispositivo_usar(text, uuid, text, text, text)', 'public.api_factor_dispositivos_revocar(text)']) f,
           unnest(array['factor_codigos', 'factor_sesiones', 'dispositivos_confiables']) t`);
    igual(`${g.api}/${g.pend}/${g.tablas}`, "true/false/true", "permisos");
  });

  console.log("\n== 6 · Reversión");
  await prueba("la reversión deja la foto idéntica a la inicial y el superadmin vuelve a valer 99 sin marca", async () => {
    await sql(REVERSION);
    const dif = compararFotos(foto0, await foto()); if (dif.length) throw new Error(dif.join("; "));
    igual(await nivel(superSin), 99, "hueco de vuelta (esperado)");
  });
  await prueba("la migración vuelve a aplicarse", async () => { await sql(MIGRACION); igual(await nivel(superSin), 0, "cerrado"); });
} finally {
  await bd.parar();
}
console.log(`\n${ok} verdes, ${fallos} fallo(s).`);
process.exit(fallos ? 1 : 0);
