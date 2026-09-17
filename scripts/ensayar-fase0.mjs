// scripts/ensayar-fase0.mjs — ENSAYO en Postgres local de la migración de la
// fase 0 (contención) y de su reversión. No toca producción.
//
// Secuencia:  base local = canónicos + nivelación (scripts/pg-local.mjs)
//   1. foto A de permisos (ACL de funciones, tablas, vistas, secuencias, políticas, RLS, defaults)
//   2. aplica supabase/migraciones/2026-09-17-fase0-contencion.sql
//   3. comprueba catálogo + COMPORTAMIENTO con sesiones simuladas (claims JWT
//      como PostgREST): trabajador del portal, administrador, anon, service_role.
//      Cada función de public se prueba UNA POR UNA con su nombre.
//   4. aplica supabase/respaldos/2026-09-17-fase0-reversion.sql
//   5. foto B: debe ser IDÉNTICA a la foto A
//   6. vuelve a aplicar la migración (re-aplicable tras revertir)
// Uso: node scripts/ensayar-fase0.mjs      (salida: ✓/✗ por caso; código 1 si falla)
import { readFileSync } from "node:fs";
import { arrancarPgLocal } from "./pg-local.mjs";

// Fase 0 + su corrección 0b (tablas base que el BackOffice lee directo).
const MIGRACION = readFileSync("supabase/migraciones/2026-09-17-fase0-contencion.sql", "utf8")
  + "\n" + readFileSync("supabase/migraciones/2026-09-17-fase0b-tablas-backoffice.sql", "utf8");
const REVERSION = readFileSync("supabase/respaldos/2026-09-17-fase0-reversion.sql", "utf8");
const PRE_LOGIN = ["verificar_bloqueo", "registrar_ingreso", "portal_verificar_bloqueo", "portal_registrar_ingreso"];
const ESPERADAS = "actualizar_ticket,alternar_ticket_subtipo,alternar_ticket_tipo,asignar_rit_sede,crear_activo,crear_rit,crear_solicitud_admin,crear_solicitud_propia,crear_ticket_admin,decidir_propuesta_perfil,editar_trabajador,eliminar_feriado,eliminar_sede,eliminar_solicitud_aviso,eliminar_ticket_aviso,emitir_memorandum,es_admin_activo,fijar_correo_persona,fijar_hora_entrada,fn_hora_entrada,fn_nivel_memorandums,fn_nivel_modulo,fn_persona_llamador,fn_solicitud_insertar,fn_ver_cuenta_bancaria,guardar_cargo_perfil,guardar_clave_equipo,guardar_feriado,guardar_solicitud_aviso,guardar_ticket_aviso,guardar_ticket_subtipo,guardar_ticket_tipo,importar_asistencia,importar_control,importar_padron,importar_planilla_unificada,mi_sesion_backoffice,portal_actualizar_datos,portal_confirmar_lectura,portal_confirmar_recepcion,portal_crear_solicitud,portal_crear_ticket,portal_dni,portal_marcar_visto,portal_mi_sesion,portal_modo,portal_primer_ingreso,portal_registrar_ingreso,portal_registrar_sesion,portal_solicitar_cambio_cuenta,portal_verificar_bloqueo,previsualizar_control,previsualizar_padron,previsualizar_planilla_unificada,publicar_rit,reenviar_solicitud,registrar_acuse_asistido,registrar_ingreso,registrar_sesion_backoffice,resolver_solicitud,ver_clave_equipo,verificar_bloqueo".split(",");

let fallos = 0, ok = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); }
};
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const bd = await arrancarPgLocal();
const { sql, cliente } = bd;

// Foto de permisos comparable (misma consulta antes y después).
const foto = async () => {
  const filas = await sql(`
    select 'fn:' || p.oid::regprocedure::text as objeto,
           coalesce(p.proacl::text, '') || '|definer=' || p.prosecdef::text || '|config=' || coalesce(array_to_string(p.proconfig, ';'), '') as valor
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    union all
    select 'rel:' || c.relname || ':' || c.relkind::text, coalesce(c.relacl::text, '') || '|rls=' || c.relrowsecurity::text || '|forzada=' || c.relforcerowsecurity::text
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'v', 'S')
    union all
    select 'pol:' || tablename || '.' || policyname, roles::text || '|' || cmd::text || '|' || permissive::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
      from pg_policies where schemaname = 'public'
    union all
    select 'def:' || defaclrole::regrole::text || ':' || coalesce(defaclnamespace::regnamespace::text, '-') || ':' || defaclobjtype::text, defaclacl::text
      from pg_default_acl
    order by 1`);
  // El orden de las entradas de un ACL ({a=X,b=X} vs {b=X,a=X}) no es semántico.
  const normal = (v) => v.replace(/\{([^}]*)\}/g, (_, s) => "{" + s.split(",").sort().join(",") + "}");
  return new Map(filas.map((f) => [f.objeto, normal(f.valor)]));
};
const compararFotos = (a, b) => {
  const dif = [];
  for (const [k, v] of a) if (!b.has(k)) dif.push(`falta tras revertir: ${k}`); else if (b.get(k) !== v) dif.push(`difiere ${k}: antes=${v} después=${b.get(k)}`);
  for (const k of b.keys()) if (!a.has(k)) dif.push(`sobra tras revertir: ${k}`);
  return dif;
};

// Identidades simuladas (los seeds de los canónicos traen a Rosa 45231876 con
// vínculo vigente y al superadmin 40776655 dsalguero@grupoer.pe).
const TRABAJADOR = { dni: "45231876", correo: "45231876@portal.grupoer.pe", sub: "11111111-1111-1111-1111-111111111111" };
const ADMIN = { dni: "40776655", correo: "dsalguero@grupoer.pe", sub: "22222222-2222-2222-2222-222222222222" };
await sql(`insert into auth.users (id, email) values ($1, $2), ($3, $4)`, [TRABAJADOR.sub, TRABAJADOR.correo, ADMIN.sub, ADMIN.correo]);
await sql(`insert into cuentas_portal (dni) values ($1) on conflict do nothing`, [TRABAJADOR.dni]).catch(() => {});

// Ejecuta `texto` como un rol con claims, en una transacción que SIEMPRE se
// revierte. Devuelve { filas } o { codigo, mensaje } del error.
const como = async (rol, claims, texto, params) => {
  await cliente.query("begin");
  try {
    await cliente.query(`set local role ${rol}`);
    await cliente.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims ?? { role: rol })]);
    const r = await cliente.query(texto, params);
    return { filas: r.rows };
  } catch (e) {
    return { codigo: e.code, mensaje: e.message };
  } finally {
    await cliente.query("rollback");
  }
};
const claims = (rol, id) => ({ role: rol, email: id.correo, sub: id.sub });
const esperaPermisoDenegado = (r, msj) => {
  if (r.codigo !== "42501") throw new Error(`${msj}: esperaba 42501, obtuvo ${r.codigo ?? "éxito"} ${r.mensaje ?? ""}`);
};
const esperaNoDenegado = (r, msj) => {
  if (r.codigo === "42501") throw new Error(`${msj}: permiso denegado (${r.mensaje})`);
};
// Denegación DE LA FUNCIÓN (EXECUTE), no de una tabla que la función toque.
const funcionDenegada = (r) => r.codigo === "42501" && /permission denied for function/i.test(r.mensaje ?? "");

try {
  console.log("\n== 1 · Foto A de permisos");
  const fotoA = await foto();
  console.log(`   ${fotoA.size} entradas`);

  console.log("\n== 2 · Aplicar la migración de la fase 0");
  await prueba("la migración se aplica sin errores", async () => { await sql(MIGRACION); });

  console.log("\n== 3a · Catálogo");
  await prueba("anon ejecuta exactamente las 4 RPC de login", async () => {
    const l = await sql(`select string_agg(p.proname, ',' order by p.proname) as l from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`);
    igual(l[0].l, "portal_registrar_ingreso,portal_verificar_bloqueo,registrar_ingreso,verificar_bloqueo", "lista");
  });
  await prueba("authenticated ejecuta exactamente las 62 funciones esperadas", async () => {
    const l = await sql(`select p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute') order by 1`);
    igual(l.length, 62, "firmas"); igual([...new Set(l.map((x) => x.proname))].join(","), ESPERADAS.join(","), "nombres");
  });
  await prueba("ninguna política acceso_demo ni con condición true", async () => {
    const [{ n }] = await sql(`select count(*)::int as n from pg_policies where schemaname='public' and (policyname='acceso_demo' or qual='true' or with_check='true')`);
    igual(n, 0, "políticas");
  });
  await prueba("las 55 tablas de public tienen RLS (54 + correo_envios)", async () => {
    const [{ total, con }] = await sql(`select count(*)::int as total, count(*) filter (where relrowsecurity)::int as con from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind='r'`);
    igual(total, 55, "tablas"); igual(con, 55, "con RLS");
  });
  await prueba("service_role conserva EXECUTE en todas las funciones", async () => {
    const [{ n }] = await sql(`select count(*)::int as n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and not has_function_privilege('service_role', p.oid, 'execute')`);
    igual(n, 0, "funciones sin service_role");
  });

  console.log("\n== 3b · Trabajador del Portal: cada función de public, una por una");
  const funciones = await sql(`
    select p.proname as nombre, p.oid::regprocedure::text as firma, p.oid,
           (select string_agg('null::' || format_type(t, null), ', ' order by o) from unnest(p.proargtypes) with ordinality as u(t, o)) as args_nulos,
           has_function_privilege('authenticated', p.oid, 'execute') as ejecutable
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public' and p.prorettype <> 'trigger'::regtype order by 1, 2`);
  let denegadas = 0, permitidas = 0;
  for (const f of funciones) {
    const debeEjecutar = ESPERADAS.includes(f.nombre);
    let r = await como("authenticated", claims("authenticated", TRABAJADOR), `select ${f.nombre}(${f.args_nulos ?? ""})`);
    // Sobrecargas ambiguas con nulos (asignar_activo 3/5 args): decide el catálogo.
    if (r.codigo === "42725") r = f.ejecutable ? { filas: [] } : { codigo: "42501", mensaje: "permission denied for function (catálogo)" };
    if (debeEjecutar) {
      if (funcionDenegada(r)) { fallos++; console.error(`✗ trabajador: ${f.firma} debería poder ejecutarse: ${r.mensaje}`); } else permitidas++;
    } else if (!funcionDenegada(r)) { fallos++; console.error(`✗ trabajador: ${f.firma} NO fue denegada (${r.codigo ?? "éxito"} ${r.mensaje ?? ""})`); } else denegadas++;
  }
  ok++; console.log(`✓ trabajador: ${denegadas} funciones denegadas por permiso (42501) · ${permitidas} firmas de la lista siguen ejecutables`);
  await prueba("trabajador: crear_usuario_admin y guardar_perfil → permiso denegado (el fallo original)", async () => {
    esperaPermisoDenegado(await como("authenticated", claims("authenticated", TRABAJADOR),
      `select crear_usuario_admin('00000001','superadmin','x@x.com','', null, 'x')`), "crear_usuario_admin");
    esperaPermisoDenegado(await como("authenticated", claims("authenticated", TRABAJADOR),
      `select guardar_perfil('zz','ZZ','',true,false,false,false,'{}'::jsonb,null,'x',false)`), "guardar_perfil");
  });
  await prueba("trabajador: ninguna tabla base devuelve filas (RLS sin política) o está revocada", async () => {
    const tablas = await sql(`select c.relname from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind='r' order by 1`);
    for (const { relname } of tablas) {
      const r = await como("authenticated", claims("authenticated", TRABAJADOR), `select count(*)::int as n from ${relname}`);
      if (r.codigo === "42501") continue;
      if (r.codigo) throw new Error(`${relname}: ${r.mensaje}`);
      if (r.filas[0].n !== 0) throw new Error(`${relname}: devolvió ${r.filas[0].n} filas`);
    }
  });
  await prueba("trabajador: insertar en lineas → rechazado por RLS", async () => {
    const r = await como("authenticated", claims("authenticated", TRABAJADOR),
      `insert into lineas (numero, operador, plan, costo) values ('999000111','Claro','x',0)`);
    esperaPermisoDenegado(r, "insert lineas");
  });
  await prueba("trabajador: v_portal_perfil sigue respondiendo (portal_modo ejecutable) y es SU fila", async () => {
    const r = await como("authenticated", claims("authenticated", TRABAJADOR), `select * from v_portal_perfil`);
    esperaNoDenegado(r, "v_portal_perfil"); if (r.codigo) throw new Error(r.mensaje);
    igual(r.filas.length, 1, "filas"); igual(String(r.filas[0].dni ?? r.filas[0].documento ?? ""), TRABAJADOR.dni, "dni");
  });
  for (const v of ["v_portal_datos", "v_portal_boletas", "v_portal_pendientes", "v_portal_comunicados", "v_portal_solicitudes", "v_portal_tickets", "v_portal_mes", "v_portal_rit"]) {
    await prueba(`trabajador: ${v} responde sin error`, async () => {
      const r = await como("authenticated", claims("authenticated", TRABAJADOR), `select * from ${v} limit 5`);
      if (r.codigo) throw new Error(`${r.codigo} ${r.mensaje}`);
    });
  }
  await prueba("trabajador: portal_mi_sesion() y portal_dni() ejecutan", async () => {
    const r = await como("authenticated", claims("authenticated", TRABAJADOR), `select portal_dni() as d, portal_mi_sesion() as s`);
    if (r.codigo) throw new Error(`${r.codigo} ${r.mensaje}`); igual(r.filas[0].d, TRABAJADOR.dni, "portal_dni");
  });

  console.log("\n== 3c · Administrador (superadmin)");
  for (const v of ["v_personal", "v_asistencia_mensual", "v_usuarios_admin", "v_mi_acceso", "v_feriados", "v_perfiles", "v_solicitudes", "v_tickets", "v_activos"]) {
    await prueba(`admin: ${v} responde sin error`, async () => {
      const r = await como("authenticated", claims("authenticated", ADMIN), `select * from ${v} limit 5`);
      if (r.codigo) throw new Error(`${r.codigo} ${r.mensaje}`);
    });
  }
  await prueba("admin: v_personal devuelve filas (fn_hora_entrada sigue ejecutable desde la vista)", async () => {
    const r = await como("authenticated", claims("authenticated", ADMIN), `select count(*)::int as n from v_personal`);
    if (r.codigo) throw new Error(r.mensaje); if (r.filas[0].n < 1) throw new Error("0 filas");
  });
  await prueba("admin: fn_nivel_modulo('personal') = 99 y es_admin_activo() = true", async () => {
    const r = await como("authenticated", claims("authenticated", ADMIN), `select fn_nivel_modulo('personal') as n, es_admin_activo() as a`);
    if (r.codigo) throw new Error(r.mensaje); igual(r.filas[0].n, 99, "nivel"); igual(r.filas[0].a, true, "es_admin_activo");
  });
  await prueba("admin: lee las tablas base del mapa FUENTES (empresas con filas, tardanzas, asistencia_config, plantillas)", async () => {
    const r = await como("authenticated", claims("authenticated", ADMIN),
      `select (select count(*) from empresas)::int as e, (select count(*) from tardanzas)::int as t,
              (select count(*) from asistencia_config)::int as c, (select count(*) from plantillas)::int as p`);
    if (r.codigo) throw new Error(`${r.codigo} ${r.mensaje}`);
    if (r.filas[0].e < 1) throw new Error("empresas devolvió 0 filas: el BackOffice quedaría en blanco");
  });
  await prueba("trabajador: empresas sigue devolviendo 0 filas", async () => {
    const r = await como("authenticated", claims("authenticated", TRABAJADOR), `select count(*)::int as n from empresas`);
    if (r.codigo) throw new Error(r.mensaje); igual(r.filas[0].n, 0, "filas");
  });
  await prueba("admin: escribe en lineas por la política solo_admin (insert + update + delete)", async () => {
    const r = await como("authenticated", claims("authenticated", ADMIN),
      `insert into lineas (numero, operador, plan, costo) values ('999000111','Claro','ensayo',0);
       update lineas set plan = 'ensayo-2' where numero = '999000111';
       delete from lineas where numero = '999000111'`);
    if (r.codigo) throw new Error(`${r.codigo} ${r.mensaje}`);
  });
  await prueba("admin: editar_trabajador (con guarda) sigue ejecutable", async () => {
    const r = await como("authenticated", claims("authenticated", ADMIN),
      `select editar_trabajador('45231876', 'Rosa Quispe Huamán', '987654321', null, 'BCP', null, null, 'DNI')`);
    esperaNoDenegado(r, "editar_trabajador");
  });
  await prueba("admin: crear_usuario_admin queda INOPERATIVA hasta la fase 1 (falla cerrado)", async () => {
    esperaPermisoDenegado(await como("authenticated", claims("authenticated", ADMIN),
      `select crear_usuario_admin('45231876','superadmin','rosa@x.com','', null, 'x')`), "crear_usuario_admin");
  });
  await prueba("admin: correo_envios no es legible con sesión", async () => {
    esperaPermisoDenegado(await como("authenticated", claims("authenticated", ADMIN), `select * from correo_envios`), "correo_envios");
  });

  console.log("\n== 3d · anon y service_role");
  await prueba("anon: personas denegada; verificar_bloqueo ejecuta; crear_usuario_admin denegada", async () => {
    esperaPermisoDenegado(await como("anon", { role: "anon" }, `select * from personas`), "personas");
    esperaNoDenegado(await como("anon", { role: "anon" }, `select verificar_bloqueo('nadie@x.com')`), "verificar_bloqueo");
    esperaPermisoDenegado(await como("anon", { role: "anon" }, `select crear_usuario_admin('00000001','superadmin','x@x.com','', null, 'x')`), "crear_usuario_admin");
  });
  await prueba("service_role: inserta y lee correo_envios", async () => {
    const r = await como("service_role", { role: "service_role" },
      `insert into correo_envios (accion, ip, sujeto, destinatario, resultado) values ('ensayo','127.0.0.1','x','x@x','enviado');
       select count(*)::int as n from correo_envios`);
    if (r.codigo) throw new Error(`${r.codigo} ${r.mensaje}`);
  });

  console.log("\n== 4 · Reversión");
  await prueba("la reversión se aplica sin errores", async () => { await sql(REVERSION); });
  console.log("\n== 5 · Foto B = Foto A");
  await prueba("la foto de permisos tras revertir es idéntica a la original", async () => {
    const dif = compararFotos(fotoA, await foto());
    if (dif.length) throw new Error(`${dif.length} diferencias:\n   ` + dif.slice(0, 20).join("\n   "));
  });
  await prueba("trabajador vuelve a poder llamar crear_usuario_admin (estado previo, solo para probar la reversión)", async () => {
    esperaNoDenegado(await como("authenticated", claims("authenticated", TRABAJADOR),
      `select crear_usuario_admin('00000001','superadmin','x@x.com','', null, 'x')`), "crear_usuario_admin");
  });

  console.log("\n== 6 · Re-aplicar la migración tras revertir");
  await prueba("la migración vuelve a aplicarse sobre el estado revertido", async () => { await sql(MIGRACION); });
  await prueba("y deja el catálogo igual que la primera vez", async () => {
    const [{ n }] = await sql(`select count(*)::int as n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and has_function_privilege('authenticated', p.oid, 'execute')`);
    igual(n, 62, "firmas");
  });
} finally {
  await bd.parar();
}
console.log(`\n${ok} correctas · ${fallos} fallo(s).`);
process.exit(fallos ? 1 : 0);
