// scripts/verificar-fase0.mjs — Verificación en PRODUCCIÓN de la fase 0
// (contención) DESPUÉS de aplicar migraciones/2026-09-17-fase0-contencion.sql.
// Solo lectura (las llamadas RPC que hace son con argumentos nulos y deben
// fallar por PERMISO antes de ejecutar nada).
//   env: SUPABASE_ACCESS_TOKEN (Management API)
//        opcionales: SUPERADMIN_EMAIL + SUPERADMIN_PASSWORD_INICIAL (sesión BackOffice)
//                    PORTAL_DNI + PORTAL_CLAVE (sesión de un trabajador del Portal:
//                    prueba UNA POR UNA que ninguna función administrativa se ejecuta)
//   Uso: . .\scripts\token-supabase.ps1; node scripts/verificar-fase0.mjs
const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const SUPA = `https://${PROYECTO}.supabase.co`;
const APP = "https://intranet-general.vercel.app";
const KEY = "sb_publishable_qgPwZ8-4neRlKQXpCe9tnw_Dix4Ddwg";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
const { SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD_INICIAL, PORTAL_DNI, PORTAL_CLAVE } = process.env;
const ESPERADAS = "actualizar_ticket,alternar_ticket_subtipo,alternar_ticket_tipo,asignar_rit_sede,crear_activo,crear_rit,crear_solicitud_admin,crear_solicitud_propia,crear_ticket_admin,decidir_propuesta_perfil,editar_trabajador,eliminar_feriado,eliminar_sede,eliminar_solicitud_aviso,eliminar_ticket_aviso,emitir_memorandum,es_admin_activo,fijar_correo_persona,fijar_hora_entrada,fn_hora_entrada,fn_nivel_memorandums,fn_nivel_modulo,fn_persona_llamador,fn_solicitud_insertar,fn_ver_cuenta_bancaria,guardar_cargo_perfil,guardar_clave_equipo,guardar_feriado,guardar_solicitud_aviso,guardar_ticket_aviso,guardar_ticket_subtipo,guardar_ticket_tipo,importar_asistencia,importar_control,importar_padron,importar_planilla_unificada,mi_sesion_backoffice,portal_actualizar_datos,portal_confirmar_lectura,portal_confirmar_recepcion,portal_crear_solicitud,portal_crear_ticket,portal_dni,portal_marcar_visto,portal_mi_sesion,portal_modo,portal_primer_ingreso,portal_registrar_ingreso,portal_registrar_sesion,portal_solicitar_cambio_cuenta,portal_verificar_bloqueo,previsualizar_control,previsualizar_padron,previsualizar_planilla_unificada,publicar_rit,reenviar_solicitud,registrar_acuse_asistido,registrar_ingreso,registrar_sesion_backoffice,resolver_solicitud,ver_clave_equipo,verificar_bloqueo".split(",");

let fallos = 0;
async function prueba(nombre, fn) {
  try { await fn(); console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); }
}
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
const enLista = (v, lista, msj) => { if (!lista.includes(v)) throw new Error(`${msj}: ${JSON.stringify(v)} no está en ${JSON.stringify(lista)}`); };
async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}
const proxy = (ruta, init = {}) => fetch(`${APP}/api/supa/${ruta}`, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
const directo = (ruta, init = {}) => fetch(`${SUPA}/${ruta}`, { ...init, headers: { apikey: KEY, "Content-Type": "application/json", ...(init.headers ?? {}) } });
const denegadaFn = (status, cuerpo) => [401, 403].includes(status) && /permission denied for function/i.test(cuerpo);

console.log("== Catálogo");
await prueba("anon ejecuta exactamente las 4 RPC de login", async () => {
  const [{ l }] = await sql(`select string_agg(p.proname, ',' order by p.proname) as l from pg_proc p join pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and has_function_privilege('anon', p.oid, 'execute')`);
  igual(l, "portal_registrar_ingreso,portal_verificar_bloqueo,registrar_ingreso,verificar_bloqueo", "lista");
});
await prueba("authenticated ejecuta exactamente las 62 firmas esperadas", async () => {
  const l = await sql(`select p.proname from pg_proc p join pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and has_function_privilege('authenticated', p.oid, 'execute') order by 1`);
  igual(l.length, 62, "firmas"); igual([...new Set(l.map((x) => x.proname))].join(","), ESPERADAS.join(","), "nombres");
});
await prueba("ninguna política acceso_demo ni con condición true", async () => {
  const [{ n }] = await sql(`select count(*)::int as n from pg_policies where schemaname='public' and (policyname='acceso_demo' or qual='true' or with_check='true')`);
  igual(n, 0, "políticas");
});
await prueba("todas las tablas de public tienen RLS", async () => {
  const [{ n }] = await sql(`select count(*)::int as n from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind='r' and not c.relrowsecurity`);
  igual(n, 0, "tablas sin RLS");
});
await prueba("lineas tiene la política solo_admin y correo_envios existe cerrada", async () => {
  const [{ n }] = await sql(`select count(*)::int as n from pg_policies where schemaname='public' and tablename='lineas' and policyname='solo_admin'`);
  igual(n, 1, "solo_admin");
  const [{ a, s }] = await sql(`select has_table_privilege('authenticated','public.correo_envios','select') as a, has_table_privilege('service_role','public.correo_envios','insert') as s`);
  igual(a, false, "authenticated lee correo_envios"); igual(s, true, "service_role inserta");
});
await prueba("portal_dni y portal_modo son security definer con search_path", async () => {
  const [{ n }] = await sql(`select count(*)::int as n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public'
    and p.proname in ('portal_dni','portal_modo') and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')`);
  igual(n, 2, "definers");
});
await prueba("service_role conserva EXECUTE en todas las funciones", async () => {
  const [{ n }] = await sql(`select count(*)::int as n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and not has_function_privilege('service_role', p.oid, 'execute')`);
  igual(n, 0, "sin service_role");
});

console.log("\n== Sin sesión");
await prueba("anon: rpc crear_usuario_admin denegada por permiso", async () => {
  const r = await directo("rest/v1/rpc/crear_usuario_admin", { method: "POST", body: JSON.stringify({ p_dni: "00000000", p_perfil: "x", p_correo: "x@x.com", p_celular: "", p_clave: null, p_por: "verificar" }) });
  const c = await r.text(); if (!denegadaFn(r.status, c)) throw new Error(`${r.status} ${c.slice(0, 120)}`);
});
await prueba("anon: rpc verificar_bloqueo sigue abierta", async () => {
  const r = await directo("rest/v1/rpc/verificar_bloqueo", { method: "POST", body: JSON.stringify({ p_correo: "nadie@ejemplo.com" }) });
  enLista(r.status, [200, 204], `status (${(await r.text()).slice(0, 120)})`);
});
await prueba("endpoint de correo: aviso-ticket sin sesión → 401", async () => {
  const r = await fetch(`${APP}/api/enviar-correo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "aviso-ticket", numero: "TK-0001" }) });
  igual(r.status, 401, `status (${(await r.text()).slice(0, 120)})`);
});

async function login(email, password) {
  const r = await proxy("auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
  const j = await r.json(); if (typeof j.access_token !== "string") throw new Error(`login ${email}: ${JSON.stringify(j).slice(0, 160)}`);
  return j.access_token;
}

console.log("\n== Sesión de superadministrador");
if (!SUPERADMIN_EMAIL || !SUPERADMIN_PASSWORD_INICIAL) console.log("(sin SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD_INICIAL — se saltan)");
else {
  let jwt;
  await prueba("login BackOffice por el proxy", async () => { jwt = await login(SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD_INICIAL); });
  for (const v of ["v_personal", "v_usuarios_admin", "v_mi_acceso", "v_asistencia_mensual", "v_feriados", "v_sedes", "v_solicitudes", "v_tickets"]) {
    await prueba(`admin: ${v} se lee`, async () => {
      const r = await proxy(`rest/v1/${v}?select=*&limit=1`, { headers: { "x-sesion": jwt } });
      igual(r.status, 200, `status (${(await r.text()).slice(0, 120)})`);
    });
  }
  await prueba("admin: v_personal devuelve filas (fn_hora_entrada ejecutable desde la vista)", async () => {
    const r = await proxy(`rest/v1/v_personal?select=dni&limit=1`, { headers: { "x-sesion": jwt } });
    const j = await r.json(); igual(Array.isArray(j) && j.length, 1, "filas");
  });
  await prueba("admin: fn_nivel_modulo('personal') = 99", async () => {
    const r = await proxy("rest/v1/rpc/fn_nivel_modulo", { method: "POST", headers: { "x-sesion": jwt }, body: JSON.stringify({ p_modulo: "personal" }) });
    igual(await r.json(), 99, "nivel");
  });
  await prueba("admin: crear_usuario_admin queda INOPERATIVA hasta la fase 1 (permiso denegado)", async () => {
    const r = await proxy("rest/v1/rpc/crear_usuario_admin", { method: "POST", headers: { "x-sesion": jwt }, body: JSON.stringify({ p_dni: "00000000", p_perfil: "x", p_correo: "x@x.com", p_celular: "", p_clave: null, p_por: "verificar" }) });
    const c = await r.text(); if (!denegadaFn(r.status, c)) throw new Error(`${r.status} ${c.slice(0, 120)}`);
  });
  await prueba("admin: editar_trabajador (con guarda) NO está denegada por permiso", async () => {
    const r = await proxy("rest/v1/rpc/editar_trabajador", { method: "POST", headers: { "x-sesion": jwt }, body: JSON.stringify({ p_dni: "00000000-INEXISTENTE", p_nombre: "x", p_celular: null, p_correo: null, p_banco: null, p_cuenta: null, p_cci: null, p_tipo_documento: "DNI" }) });
    const c = await r.text(); if (denegadaFn(r.status, c)) throw new Error(`${r.status} ${c.slice(0, 120)}`);
  });
  await prueba("admin: lineas se lee por la política solo_admin", async () => {
    const r = await proxy(`rest/v1/lineas?select=numero&limit=1`, { headers: { "x-sesion": jwt } });
    igual(r.status, 200, `status (${(await r.text()).slice(0, 120)})`);
  });
}

console.log("\n== Sesión de trabajador del Portal: cada función administrativa, una por una");
if (!PORTAL_DNI || !PORTAL_CLAVE) console.log("(sin PORTAL_DNI/PORTAL_CLAVE — se salta la prueba una por una)");
else {
  let jwt;
  await prueba("login del Portal por el proxy", async () => { jwt = await login(`${PORTAL_DNI.toLowerCase()}@portal.grupoer.pe`, PORTAL_CLAVE); });
  await prueba("trabajador: v_portal_perfil devuelve SU fila", async () => {
    const r = await proxy(`rest/v1/v_portal_perfil?select=*`, { headers: { "x-sesion": jwt } });
    const j = await r.json(); igual(Array.isArray(j) && j.length, 1, `filas (${JSON.stringify(j).slice(0, 120)})`);
  });
  await prueba("trabajador: personas y usuarios_admin no devuelven filas", async () => {
    for (const t of ["personas", "usuarios_admin", "tickets", "solicitudes"]) {
      const r = await proxy(`rest/v1/${t}?select=*&limit=1`, { headers: { "x-sesion": jwt } });
      const c = await r.text(); if (r.status === 200 && JSON.parse(c).length) throw new Error(`${t} devolvió filas`);
      enLista(r.status, [200, 401, 403], `${t} status`);
    }
  });
  const funciones = await sql(`
    select p.proname as nombre, p.oid::regprocedure::text as firma,
           coalesce((select jsonb_object_agg(a.nombre, null) from unnest(p.proargnames[1:p.pronargs]) as a(nombre)), '{}'::jsonb) as args
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public' and p.prorettype <> 'trigger'::regtype and not has_function_privilege('authenticated', p.oid, 'execute')
    order by 1, 2`);
  let denegadas = 0; const noDenegadas = [];
  for (const f of funciones) {
    const r = await proxy(`rest/v1/rpc/${f.nombre}`, { method: "POST", headers: { "x-sesion": jwt }, body: JSON.stringify(f.args) });
    const c = await r.text();
    if (denegadaFn(r.status, c)) { denegadas++; console.log(`  ✓ denegada: ${f.firma}`); }
    else if (r.status === 300 || (r.status === 404 && /Could not find the function/i.test(c))) { console.log(`  · ambigua/no resoluble por nombre, catálogo la niega: ${f.firma}`); denegadas++; }
    else noDenegadas.push(`${f.firma} → ${r.status} ${c.slice(0, 100)}`);
  }
  await prueba(`trabajador: ${denegadas} funciones denegadas por permiso, ${noDenegadas.length} no denegadas`, async () => {
    if (noDenegadas.length) throw new Error("\n   " + noDenegadas.join("\n   "));
  });
  await prueba("trabajador: portal_mi_sesion() ejecuta", async () => {
    const r = await proxy("rest/v1/rpc/portal_mi_sesion", { method: "POST", headers: { "x-sesion": jwt }, body: "{}" });
    enLista(r.status, [200, 204], `status (${(await r.text()).slice(0, 120)})`);
  });
}

console.log(fallos ? `\n${fallos} fallo(s).` : "\nTodo verde.");
process.exit(fallos ? 1 : 0);
