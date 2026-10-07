// scripts/ensayar-canon.mjs — Corrección de seguridad · FASE 7: REGRESIÓN DEL
// CANON. Carga TODO el canon SQL (schema → accesos → portal → solicitudes →
// soporte → api-servicio → migraciones complementarias → seguridad.sql con
// todas las fases) en el Postgres local embebido, SIN datos ni token, y
// comprueba los invariantes que cada fase dejó. Corre en CI en cada push.
//   · fase 0/1: anon solo con las 4 RPC pre-login; toda función nueva nace sin
//     EXECUTE; toda SECURITY DEFINER con search_path fijo; RLS en todas las tablas.
//   · fase 2/4: ninguna política con condición `true`; 9 v_portal_* con
//     security_invoker; políticas del bucket documentos.
//   · fase 3: esquema interno cerrado a la API; api_* solo para service_role;
//     sin cuenta/cci en claro en personas; sin clave_equipo en activos.
//   · fase 5: columnas sensibles catalogadas; fn_auditar las redacta.
//   · fase 6: identidad con fallo cerrado; registro_accesos.fuente; compuerta
//     de login solo service_role; piso 10 de clave del BackOffice.
//   · 2026-09-22: Soporte TI fuera del portal (portal_crear_ticket cerrada);
//     ticket propio del usuario administrativo (crear_ticket_propio, v_mis_tickets).
//   · 2026-09-28: segundo factor por correo (superadmin con JWT vale 0 hasta
//     verificar; api_factor_* solo service_role; interruptor en la política;
//     toda función que decide «superadmin» por su cuenta consulta el factor).
//   · 2026-10-07: dominio técnico del Portal portal.servicios-intranet.net
//     (ninguna función usa el dominio anterior).
// Uso: node scripts/ensayar-canon.mjs
import { arrancarPgLocal } from "./pg-local.mjs";

let fallos = 0, ok = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); await cliente.query("rollback").catch(() => {}); }
};
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
const vacio = (filas, msj) => { if (filas.length) throw new Error(`${msj}: ${filas.map((f) => Object.values(f).join(" ")).join("; ")}`); };

const bd = await arrancarPgLocal({ seguridad: true, datos: false });
const { sql, cliente } = bd;
await sql("set search_path = public, interno, extensions");

const PRE_LOGIN = ["verificar_bloqueo(text)", "registrar_ingreso(text,text,text)", "portal_verificar_bloqueo(text)", "portal_registrar_ingreso(text,text,text)"];

try {
  console.log("== Fases 0 y 1 · Cimiento");
  await prueba("anon ejecuta exactamente las 4 RPC pre-login", async () => {
    const r = await sql(`select p.oid::regprocedure::text as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`);
    igual(r.map((x) => x.f.replace(/\s/g, "")).sort().join(","), [...PRE_LOGIN].sort().join(","), "funciones de anon");
  });
  await prueba("toda SECURITY DEFINER de public e interno fija search_path", async () => {
    vacio(await sql(`select p.oid::regprocedure::text as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'interno') and p.prosecdef
        and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))`), "sin search_path");
  });
  await prueba("toda tabla de public e interno a la que la API tenga algún privilegio tiene RLS activo", async () => {
    vacio(await sql(`select n.nspname || '.' || c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and n.nspname in ('public', 'interno') and not c.relrowsecurity
        and exists (select 1 from unnest(array['select', 'insert', 'update', 'delete']) p, unnest(array['anon', 'authenticated']) r where has_table_privilege(r, c.oid, p))`), "sin RLS con privilegios de la API");
  });
  await prueba("los privilegios por defecto no conceden EXECUTE a la API en funciones nuevas", async () => {
    await sql("begin; create function public.zz_nueva() returns int language sql as 'select 1';");
    const [r] = await sql(`select has_function_privilege('authenticated', 'public.zz_nueva()', 'execute') as a, has_function_privilege('anon', 'public.zz_nueva()', 'execute') as b`);
    await sql("rollback");
    igual(`${r.a}/${r.b}`, "false/false", "nace con EXECUTE");
  });
  await prueba("las guardas centrales existen y son consultables por authenticated", async () => {
    const [r] = await sql(`select bool_and(has_function_privilege('authenticated', f, 'execute')) as ok from unnest(array['public.es_admin()', 'public.es_superadmin()', 'public.nivel_en(text)']) f`);
    igual(r.ok, true, "guardas");
  });

  console.log("\n== Fases 2 y 4 · Vistas y RLS por rol");
  await prueba("ninguna política con condición true (lectura ni escritura)", async () => {
    vacio(await sql(`select schemaname || '.' || tablename || '.' || policyname as p from pg_policies
      where schemaname in ('public', 'interno', 'storage') and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')`), "política abierta");
  });
  await prueba("las 9 vistas del Portal corren como el que consulta (security_invoker)", async () => {
    const r = await sql(`select c.relname as v from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'v' and c.relname like 'v\\_portal\\_%'
        and not exists (select 1 from unnest(coalesce(c.reloptions, '{}')) o where o = 'security_invoker=true' or o = 'security_invoker=on')`);
    vacio(r, "vista de Portal como dueño");
    const [n] = await sql(`select count(*)::int as n from pg_views where schemaname = 'public' and viewname like 'v\\_portal\\_%'`);
    igual(n.n, 9, "vistas del Portal");
  });
  await prueba("bucket documentos: políticas por ruta (leer, subir, actualizar) y ninguna abierta", async () => {
    const r = await sql(`select policyname as p from pg_policies where schemaname = 'storage' and tablename = 'objects' order by 1`);
    igual(r.map((x) => x.p).join(","), "documentos_actualizar,documentos_leer,documentos_subir", "políticas del bucket");
  });
  await prueba("toda política administrativa se apoya en la identidad por petición (nivel_en, alcance o es_admin)", async () => {
    vacio(await sql(`select tablename || '.' || policyname as p from pg_policies where policyname in ('adm_lectura', 'adm_escritura') and coalesce(qual, '') || coalesce(with_check, '') !~ '(nivel_en|fn_alcance_|es_admin)'`), "política sin identidad");
  });

  console.log("\n== Fase 3 · Esquema interno y datos sensibles");
  await prueba("las tablas sensibles viven en interno: anon sin USAGE; toda tabla con privilegios de authenticated tiene RLS y política propia (las vistas invoker las atraviesan por RLS)", async () => {
    const tablas = ["usuarios_admin", "perfiles", "perfil_permisos", "perfil_empresas", "perfil_propuestas", "cargo_perfiles", "registro_accesos", "politica_acceso", "auditoria", "correo_tokens", "datos_bancarios", "columnas_sensibles"];
    const [s] = await sql(`select has_schema_privilege('anon', 'interno', 'usage') as anon`);
    igual(s.anon, false, "anon con USAGE en interno");
    const r = await sql(`select t, to_regclass('interno.' || t) is null as falta,
        has_table_privilege('authenticated', 'interno.' || t, 'select') as lee,
        coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('interno.' || t)), false) as rls,
        exists (select 1 from pg_policies p where p.schemaname = 'interno' and p.tablename = t) as politica
      from unnest($1::text[]) t`, [tablas]);
    const malas = r.filter((x) => x.falta || (x.lee && !(x.rls && x.politica)));
    vacio(malas.map((x) => ({ t: `${x.t}${x.falta ? " falta" : ""}${x.lee && !x.rls ? " sin RLS" : ""}${x.lee && !x.politica ? " sin política" : ""}` })), "interno abierto");
  });
  await prueba("api_* (servicio) solo para service_role", async () => {
    const r = await sql(`select p.oid::regprocedure::text as f, has_function_privilege('authenticated', p.oid, 'execute') as a, has_function_privilege('anon', p.oid, 'execute') as b, has_function_privilege('service_role', p.oid, 'execute') as s
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'api\\_%'`);
    if (r.length < 8) throw new Error(`solo ${r.length} funciones api_*`);
    vacio(r.filter((x) => x.a || x.b || !x.s).map((x) => ({ f: x.f })), "api_* mal concedida");
  });
  await prueba("personas sin cuenta/cci en claro; activos sin clave_equipo; CCI y cuenta cifrados en interno.datos_bancarios", async () => {
    vacio(await sql(`select attname from pg_attribute where attrelid = 'public.personas'::regclass and attname in ('cuenta', 'cci', 'cuenta_cifrada', 'banco') and not attisdropped`), "columna bancaria en personas");
    vacio(await sql(`select attname from pg_attribute where attrelid = 'public.activos'::regclass and attname = 'clave_equipo' and not attisdropped`), "clave_equipo en activos");
    const [r] = await sql(`select bool_and(exists (select 1 from pg_attribute where attrelid = 'interno.datos_bancarios'::regclass and attname = c and not attisdropped)) as ok from unnest(array['cuenta_cifrada', 'cci_cifrado', 'cuenta_ultimos4', 'cci_ultimos4']) c`);
    igual(r.ok, true, "datos_bancarios");
  });
  await prueba("fn_cabecera (x-ip-real) no es ejecutable por la API", async () => {
    const [r] = await sql(`select has_function_privilege('authenticated', 'public.fn_cabecera(text)', 'execute') as a, has_function_privilege('anon', 'public.fn_cabecera(text)', 'execute') as b`);
    igual(`${r.a}/${r.b}`, "false/false", "fn_cabecera");
  });

  console.log("\n== Fase 5 · Auditoría sin valores sensibles");
  await prueba("columnas sensibles catalogadas y fn_auditar las consulta; el histórico es inmutable", async () => {
    const [r] = await sql(`select (select count(*)::int from interno.columnas_sensibles) as n,
      ((select prosrc from pg_proc where oid = 'public.fn_auditar()'::regprocedure) ~ 'columnas_sensibles') as usa,
      exists (select 1 from pg_trigger where tgrelid = 'interno.auditoria'::regclass and tgname = 'trg_auditoria_inmutable' and tgenabled <> 'D') as inmutable`);
    if (r.n < 7) throw new Error(`catálogo con ${r.n} filas`); igual(r.usa, true, "fn_auditar"); igual(r.inmutable, true, "inmutabilidad");
  });

  console.log("\n== Fase 6 · Identidad, bitácora y límites");
  await prueba("rol activo authenticated/anon sin claims → nivel 0; sesión de servicio → 99", async () => {
    for (const rol of ["authenticated", "anon"]) {
      await sql(`begin; grant execute on function public.fn_nivel_modulo(text) to ${rol}; set local role ${rol};`);
      const [r] = await sql(`select fn_nivel_modulo('accesos') as n`); await sql("rollback");
      igual(r.n, 0, rol);
    }
    await sql("begin; set local role service_role;"); const [s] = await sql(`select fn_nivel_modulo('accesos') as n`); await sql("rollback");
    igual(s.n, 99, "service_role");
  });
  await prueba("registro_accesos.fuente con su check; los «exitoso» exigen sesión propia; verificar_bloqueo cuenta solo fallos del proxy", async () => {
    const [r] = await sql(`select (select pg_get_constraintdef(oid) from pg_constraint where conname = 'chk_registro_fuente') as chk,
      ((select prosrc from pg_proc where oid = 'public.registrar_ingreso(text, text, text)'::regprocedure) ~ 'correo_llamador') as ri,
      ((select prosrc from pg_proc where oid = 'public.portal_registrar_ingreso(text, text, text)'::regprocedure) ~ 'correo_llamador') as pri,
      ((select prosrc from pg_proc where oid = 'public.verificar_bloqueo(text)'::regprocedure) ~ 'fuente = ''proxy''') as vb,
      ((select prosrc from pg_proc where oid = 'public.portal_verificar_bloqueo(text)'::regprocedure) ~ 'fuente = ''proxy''') as pvb`);
    if (!/cliente/.test(r.chk ?? "") || !/proxy/.test(r.chk ?? "")) throw new Error(`check: ${r.chk}`);
    igual(`${r.ri}/${r.pri}/${r.vb}/${r.pvb}`, "true/true/true/true", "funciones");
    await sql(`begin; set local role anon; select set_config('request.jwt.claims', '{"role":"anon"}', true);`);
    let codigo = null;
    try { await sql(`select registrar_ingreso('nadie@ejemplo.invalido', 'exitoso', 'canon')`); } catch (e) { codigo = e.code; }
    await sql("rollback");
    igual(codigo, "42501", "exitoso sin sesión");
  });
  await prueba("compuerta de login solo service_role; política con piso 10 (default y constraint)", async () => {
    const [r] = await sql(`select has_function_privilege('authenticated', 'public.api_login_permitido(text, text)', 'execute') as a,
      has_function_privilege('service_role', 'public.api_login_registrar(text, text, text, text)', 'execute') as s,
      (select pg_get_constraintdef(oid) from pg_constraint where conname = 'chk_clave_min_backoffice') as chk,
      (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum where d.adrelid = 'interno.politica_acceso'::regclass and a.attname = 'clave_longitud_min_backoffice') as def`);
    igual(`${r.a}/${r.s}/${r.def}`, "false/true/10", "compuerta/default");
    if (!/>= 10/.test(r.chk ?? "")) throw new Error(`constraint: ${r.chk}`);
  });

  await prueba("Soporte TI fuera del portal: portal_crear_ticket rechaza siempre; crear_ticket_propio y v_mis_tickets para authenticated, con identidad por JWT (sin sesión: error / vacía)", async () => {
    let msj = null;
    try { await sql("select portal_crear_ticket(1, null, 'x')"); } catch (e) { msj = e.message; }
    if (!/ya no se atiende desde el portal/.test(msj ?? "")) throw new Error(`portal_crear_ticket: ${msj}`);
    const [g] = await sql(`select has_function_privilege('authenticated', 'public.crear_ticket_propio(int, int, text)', 'execute') as fn,
      has_function_privilege('anon', 'public.crear_ticket_propio(int, int, text)', 'execute') as fn_anon,
      has_table_privilege('authenticated', 'public.v_mis_tickets', 'select') as vista,
      exists (select 1 from information_schema.columns where table_name = 'v_mis_tickets' and column_name = 'nota_interna') as nota`);
    igual(`${g.fn}/${g.fn_anon}/${g.vista}/${g.nota}`, "true/false/true/false", "grants/columnas");
    await sql("begin");
    await sql("set local role authenticated");
    await sql("savepoint sin_jwt");
    let propio = null;
    try { await sql("select crear_ticket_propio(1, null, 'x')"); } catch (e) { propio = e.message; await sql("rollback to savepoint sin_jwt"); }
    const filas = await sql("select count(*)::int as n from v_mis_tickets");
    await sql("rollback");
    if (!/no está vinculado a una persona/.test(propio ?? "")) throw new Error(`crear_ticket_propio sin JWT: ${propio}`);
    igual(filas[0].n, 0, "v_mis_tickets sin JWT");
  });

  await prueba("corregir_fecha_ingreso (2026-09-22): EXECUTE solo para authenticated, con guarda de Personal", async () => {
    const [g] = await sql(`select has_function_privilege('authenticated', 'public.corregir_fecha_ingreso(text, date)', 'execute') as auth,
      has_function_privilege('anon', 'public.corregir_fecha_ingreso(text, date)', 'execute') as anon,
      (select prosrc from pg_proc where proname = 'corregir_fecha_ingreso') ~ 'requiere_nivel\\(''personal'', 2\\)' as guarda`);
    igual(`${g.auth}/${g.anon}/${g.guarda}`, "true/false/true", "grants/guarda");
  });

  await prueba("correo_fallos_recientes (2026-09-30): definer, EXECUTE solo authenticated, guarda requiere_superadmin; correo_envios sigue cerrada", async () => {
    const [g] = await sql(`select p.prosecdef as def,
      has_function_privilege('authenticated', 'public.correo_fallos_recientes()', 'execute') as auth,
      has_function_privilege('anon', 'public.correo_fallos_recientes()', 'execute') as anon,
      (p.prosrc ~ 'perform requiere_superadmin\\(\\)') as guarda,
      has_table_privilege('authenticated', 'public.correo_envios', 'select') as tabla
      from pg_proc p where p.oid = 'public.correo_fallos_recientes()'::regprocedure`);
    igual(`${g.def}/${g.auth}/${g.anon}/${g.guarda}/${g.tabla}`, "true/true/false/true/false", "correo");
  });

  await prueba("arreglos (2026-09-30): importar_asistencia solo borra origen = 'reloj' y no pisa el control; publicar_lote_pdf guarda huella y devuelve el lote repetido; lotes.huella existe", async () => {
    const [g] = await sql(`select
      (select prosrc from pg_proc where oid = 'public.importar_asistencia(text, jsonb, text, jsonb, text)'::regprocedure) as a,
      (select prosrc from pg_proc where oid = 'public.publicar_lote_pdf(text, text, text, text, jsonb)'::regprocedure) as p,
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'lotes' and column_name = 'huella') as h`);
    igual(/delete from marcaciones where empresa_id = p_empresa and origen = 'reloj'/.test(g.a) && /on conflict \(empresa_id, documento, fecha\) do nothing/.test(g.a), true, "reloj");
    igual(/l\.huella = v_huella/.test(g.p) && /'repetido', true/.test(g.p), true, "huella");
    igual(g.h, true, "columna");
  });

  await prueba("política de datos v3 (2026-10-01): la marca {{RESPONSABLE}} va una vez; fn_politica_responsable NO es definer, EXECUTE solo authenticated; la vista sigue invoker; portal_primer_ingreso la resuelve antes de guardar", async () => {
    const [g] = await sql(`select
      (select array_length(string_to_array(texto, '{{RESPONSABLE}}'), 1) from declaraciones where id = 'politica-datos' and version = 3) as marcas,
      (select prosecdef from pg_proc where oid = 'public.fn_politica_responsable()'::regprocedure) as def,
      has_function_privilege('authenticated', 'public.fn_politica_responsable()', 'execute') as auth,
      has_function_privilege('anon', 'public.fn_politica_responsable()', 'execute') as anon,
      exists (select 1 from pg_class c, unnest(coalesce(c.reloptions, '{}')) o where c.oid = 'public.v_declaraciones_vigentes'::regclass and o in ('security_invoker=on', 'security_invoker=true')) as invoker,
      (select prosrc from pg_proc where oid = 'public.portal_primer_ingreso(text, boolean, integer, text)'::regprocedure) ~ 'replace\\(v_texto, ''\\{\\{RESPONSABLE\\}\\}'', v_responsable\\)' as guarda`);
    igual(`${g.marcas}/${g.def}/${g.auth}/${g.anon}/${g.invoker}/${g.guarda}`, "2/false/true/false/true/true", "política");
  });

  await prueba("V°B° del jefe directo (2026-10-01): jefes_disponibles y solicitudes_por_mi_visto_bueno definer, EXECUTE solo authenticated, identidad del JWT y segundo factor; el documento del jefe no se acepta del cliente; resolver_solicitud admite al jefe designado", async () => {
    const [g] = await sql(`select
      bool_and(p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
               and p.prosrc ~ 'fn_factor_pendiente' and p.prosrc ~ 'fn_persona_llamador') as nuevas, count(*)::int as n
      from pg_proc p where p.oid in ('public.jefes_disponibles()'::regprocedure, 'public.solicitudes_por_mi_visto_bueno()'::regprocedure)`);
    const [c] = await sql(`select
      (select prosrc from pg_proc where oid = 'public.fn_solicitud_insertar(text, text, jsonb, text)'::regprocedure) as ins,
      (select prosrc from pg_proc where oid = 'public.resolver_solicitud(bigint, text, text, text)'::regprocedure) as res`);
    igual(`${g.nuevas}/${g.n}`, "true/2", "funciones nuevas");
    igual(/supervisor_usuario/.test(c.ins) && !/v_sup_dni := nullif\(trim\(coalesce\(p_datos->>'supervisor_dni'/.test(c.ins), true, "documento del cliente");
    igual(/v_caller = s\.supervisor_dni/.test(c.res) && /not fn_factor_pendiente\(\)/.test(c.res), true, "jefe designado");
  });
  await prueba("dominio del Portal (2026-10-07): todas las funciones de public/interno usan portal.servicios-intranet.net; portal_dni resuelve correctamente", async () => {
    vacio(await sql(`select p.oid::regprocedure::text as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'interno') and p.prosrc ~ 'portal\\.grupoer\\.pe'`), "dominio viejo");
    const [g] = await sql(`select bool_and(p.prosrc ~ 'portal\\.servicios-intranet\\.net') as nuevo, count(*)::int as n from pg_proc p
      where p.oid in ('public.portal_dni()'::regprocedure, 'public.portal_registrar_ingreso(text, text, text)'::regprocedure,
        'public.api_login_permitido(text, text)'::regprocedure, 'public.api_login_registrar(text, text, text, text)'::regprocedure)`);
    igual(`${g.nuevo}/${g.n}`, "true/4", "cuatro funciones");
    const [P] = await sql("select persona_dni as dni from vinculos where fecha_fin is null order by persona_dni limit 1");
    await sql("begin");
    try {
      await sql("set local role authenticated");
      await sql(`select set_config('request.jwt.claims', '${JSON.stringify({ role: "authenticated", email: `${P.dni.toLowerCase()}@portal.servicios-intranet.net` })}', true)`);
      const [r] = await sql("select portal_dni() as d"); igual(r.d, P.dni, "resuelve");
    } finally { await sql("rollback"); }
  });

  console.log("\n== Segundo factor (2026-09-28) · el superadmin vale 0 hasta verificar la sesión");
  await prueba("tablas de interno cerradas a la API; api_factor_* solo service_role; mi_segundo_factor solo authenticated; fn_nivel_modulo v4; interruptor encendido y expuesto en v_politica_acceso", async () => {
    const [t] = await sql(`select bool_and(to_regclass('interno.' || t) is not null and (select relrowsecurity from pg_class where oid = to_regclass('interno.' || t))
        and not has_table_privilege('authenticated', 'interno.' || t, 'select') and not has_table_privilege('anon', 'interno.' || t, 'select')) as ok
      from unnest(array['factor_codigos', 'factor_sesiones', 'dispositivos_confiables']) t`);
    igual(t.ok, true, "tablas");
    const [g] = await sql(`select has_function_privilege('authenticated', 'public.mi_segundo_factor()', 'execute') as mio,
      has_function_privilege('anon', 'public.mi_segundo_factor()', 'execute') as mio_anon,
      has_function_privilege('authenticated', 'public.fn_factor_pendiente()', 'execute') as pend,
      ((select prosrc from pg_proc where oid = 'public.fn_nivel_modulo(text)'::regprocedure) ~ 'fn_factor_pendiente') as v4,
      (select factor_superadmin from interno.politica_acceso where id = 1) as pol,
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'v_politica_acceso' and column_name = 'factorSuperadmin') as vista,
      to_regprocedure('public.guardar_politica(integer, integer, boolean, boolean, integer, integer, text, integer, integer, integer, text)') is null as vieja_fuera`);
    igual(`${g.mio}/${g.mio_anon}/${g.pend}/${g.v4}/${g.pol}/${g.vista}/${g.vieja_fuera}`, "true/false/false/true/true/true/true", "guarda");
  });
  await prueba("toda función ejecutable por authenticated que decide por es_superadmin / \"esSuperadmin\" / ver_datos_bancarios sin fn_nivel_modulo, nivel_en( ni requiere_ consulta fn_factor_pendiente", async () => {
    // `es_superadmin(` (la guarda central, que ya pasa por nivel_en) no cuenta:
    // solo la lectura directa de la columna o del campo de v_mi_acceso.
    vacio(await sql(`select p.oid::regprocedure::text as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
        and p.proname not in ('fn_nivel_modulo', 'fn_factor_pendiente', 'mi_segundo_factor')
        and p.prosrc ~ '(es_superadmin(?![[:space:]]*[(])|"esSuperadmin"|ver_datos_bancarios)'
        and p.prosrc !~ '(fn_nivel_modulo|nivel_en[(]|requiere_)'
        and p.prosrc !~ 'fn_factor_pendiente' order by 1`), "deciden «superadmin» sin ver el segundo factor");
  });
  await prueba("con claims de superadmin: sin marca → 0; con marca vigente → 99; con la política apagada → 99 (todo en una transacción que se revierte)", async () => {
    await sql("begin");
    try {
      await sql(`insert into public.personas (dni, nombre) values ('ZZFACTOR1', 'ZZ FACTOR CANON')`);
      const [pf] = await sql(`select id, version from interno.perfiles where es_superadmin and estado = 'activo' order by version desc limit 1`);
      await sql(`insert into interno.usuarios_admin (persona_dni, perfil_id, perfil_version, correo, creado_por) values ('ZZFACTOR1', '${pf.id}', ${pf.version}, 'zzfactor@ejemplo.invalido', 'ensayar-canon')`);
      await sql("grant execute on function public.fn_nivel_modulo(text) to authenticated");
      const claims = (sid) => `select set_config('request.jwt.claims', '${JSON.stringify({ role: "authenticated", email: "zzfactor@ejemplo.invalido", session_id: sid })}', true)`;
      const SID = "00000000-0000-4000-8000-0000000000fa";
      await sql("savepoint s1"); await sql("set local role authenticated"); await sql(claims(SID));
      let [r] = await sql("select fn_nivel_modulo('accesos') as n"); await sql("rollback to savepoint s1");
      igual(r.n, 0, "sin marca");
      await sql(`insert into interno.factor_sesiones (session_id, usuario_id, expira_en, via) select '${SID}', id, now() + interval '5 minutes', 'correo' from interno.usuarios_admin where correo = 'zzfactor@ejemplo.invalido'`);
      await sql("savepoint s2"); await sql("set local role authenticated"); await sql(claims(SID));
      [r] = await sql("select fn_nivel_modulo('accesos') as n"); await sql("rollback to savepoint s2");
      igual(r.n, 99, "con marca");
      await sql("update interno.politica_acceso set factor_superadmin = false where id = 1");
      await sql("savepoint s3"); await sql("set local role authenticated"); await sql(claims("00000000-0000-4000-8000-0000000000fb"));
      [r] = await sql("select fn_nivel_modulo('accesos') as n"); await sql("rollback to savepoint s3");
      igual(r.n, 99, "política apagada");
    } finally { await sql("rollback"); }
  });
} finally {
  await bd.parar();
}
console.log(`\n${ok} verdes, ${fallos} fallo(s).`);
process.exit(fallos ? 1 : 0);
