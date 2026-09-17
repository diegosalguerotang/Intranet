// scripts/fase1-generar.mjs — Generador de la FASE 1 (cimiento) de la
// corrección de seguridad. Dos modos:
//   node scripts/fase1-generar.mjs reversion
//       Arranca el Postgres local con los canónicos TAL COMO ESTÁN (antes de
//       insertar guardas) y escribe supabase/respaldos/<fecha>-fase1-reversion.sql
//       con los cuerpos actuales de las funciones administrativas
//       (pg_get_functiondef), la eliminación de los ayudantes nuevos y la
//       restitución de grants y default privileges de la fase 0.
//   node scripts/fase1-generar.mjs migracion
//       Lee los canónicos YA EDITADOS (con la guarda insertada), extrae el
//       bloque create function de cada administrativa y escribe
//       supabase/migraciones/<fecha>-fase1-cimiento.sql y docs/funciones-y-permisos.md.
// La tabla GUARDAS es la decisión de diseño: qué exige cada función.
import { readFileSync, writeFileSync } from "node:fs";

export const FECHA = "2026-09-17";
// Función administrativa → guarda. `grant`: si el cliente la llama (true) o
// solo las funciones serverless con llave de servicio (false).
export const GUARDAS = {
  crear_usuario_admin:               { guarda: "perform requiere_superadmin();", grant: true,  modulo: "accesos", nivel: "superadmin" },
  actualizar_usuario_admin:          { guarda: "perform requiere_superadmin();", grant: true,  modulo: "accesos", nivel: "superadmin" },
  suspender_usuario_admin:           { guarda: "perform requiere_superadmin();", grant: true,  modulo: "accesos", nivel: "superadmin" },
  reactivar_usuario_admin:           { guarda: "perform requiere_superadmin();", grant: true,  modulo: "accesos", nivel: "superadmin" },
  eliminar_usuario_admin:            { guarda: "perform requiere_superadmin();", grant: false, modulo: "accesos", nivel: "superadmin (solo api/admin-usuarios.js con llave de servicio)" },
  reenviar_clave:                    { guarda: "perform requiere_superadmin();", grant: true,  modulo: "accesos", nivel: "superadmin" },
  guardar_perfil:                    { guarda: "perform requiere_superadmin();", grant: true,  modulo: "accesos", nivel: "superadmin" },
  eliminar_perfil:                   { guarda: "perform requiere_superadmin();", grant: true,  modulo: "accesos", nivel: "superadmin" },
  desactivar_perfil:                 { guarda: "perform requiere_superadmin();", grant: true,  modulo: "accesos", nivel: "superadmin" },
  guardar_politica:                  { guarda: "perform requiere_superadmin();", grant: true,  modulo: "accesos", nivel: "superadmin" },
  marcar_clave_cambiada:             { guarda: "perform requiere_correo_propio(p_correo);", grant: true, modulo: "accesos", nivel: "el propio administrador (su correo)" },
  alta_trabajador:                   { guarda: "perform requiere_nivel('personal', 2);", grant: true, modulo: "personal", nivel: 2 },
  eliminar_trabajador:               { guarda: "perform requiere_nivel('personal', 3);", grant: true, modulo: "personal", nivel: 3 },
  publicar_lote:                     { guarda: "perform requiere_nivel('boletas', 2);", grant: true, modulo: "boletas", nivel: 2 },
  publicar_lote_pdf:                 { guarda: "perform requiere_nivel('boletas', 2);", grant: true, modulo: "boletas", nivel: 2 },
  publicar_comunicado:               { guarda: "perform requiere_nivel('comunicados', 2);", grant: true, modulo: "comunicados", nivel: 2 },
  registrar_epp:                     { guarda: "perform requiere_nivel('activos', 2);", grant: true, modulo: "activos", nivel: 2 },
  previsualizar_asistencia:          { guarda: "perform requiere_nivel('asistencia', 2);", grant: true, modulo: "asistencia", nivel: 2 },
  importar_activos:                  { guarda: "perform requiere_nivel('activos', 2);", grant: true, modulo: "activos", nivel: 2 },
  previsualizar_importacion_activos: { guarda: "perform requiere_nivel('activos', 2);", grant: true, modulo: "activos", nivel: 2 },
  crear_sede:                        { guarda: "perform requiere_nivel('configuracion', 2, 'personal');", grant: true, modulo: "configuracion o personal", nivel: 2 },
  asignar_activo:                    { guarda: "perform requiere_nivel('activos', 2);", grant: true, modulo: "activos", nivel: 2 },
  devolver_activo:                   { guarda: "perform requiere_nivel('activos', 2);", grant: true, modulo: "activos", nivel: 2 },
  editar_activo:                     { guarda: "perform requiere_nivel('activos', 2);", grant: true, modulo: "activos", nivel: 2 },
  resolver_memorandum:               { guarda: "perform requiere_nivel('memorandums', 3);", grant: true, modulo: "memorandums", nivel: 3 },
  notificar_memorandum:              { guarda: "perform requiere_nivel('memorandums', 2);", grant: true, modulo: "memorandums", nivel: 2 },
};
export const NOMBRES = Object.keys(GUARDAS);
const CANONICOS = ["schema.sql", "accesos.sql", "portal.sql", "solicitudes.sql", "soporte.sql"].map((f) => "supabase/" + f);
const AYUDANTES = ["correo_llamador()", "es_admin()", "es_superadmin()", "nivel_en(text)", "requiere_nivel(text, integer, text)", "requiere_superadmin()", "requiere_correo_propio(text)"];

// Bloque `create [or replace] function <n>(` … `$$;` de un canónico.
function bloques(nombre) {
  const out = [];
  for (const f of CANONICOS) {
    const s = readFileSync(f, "utf8");
    const re = new RegExp(`^create (?:or replace )?function ${nombre}\\s*\\([\\s\\S]*?\\$\\$;\\s*$`, "gm");
    let m; while ((m = re.exec(s))) out.push({ archivo: f, texto: m[0] });
  }
  return out;
}

const modo = process.argv[2];

if (modo === "reversion") {
  const { arrancarPgLocal } = await import("./pg-local.mjs");
  const bd = await arrancarPgLocal();
  try {
    const defs = await bd.sql(`
      select p.proname as nombre, p.oid::regprocedure::text as firma, pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.proname = any($1)
        and p.oid::regprocedure::text <> 'asignar_activo(text,text,text)'  -- huérfana: su cuerpo real no está en el repo
      order by 1, 2`, [NOMBRES]);
    const grants = NOMBRES.filter((n) => GUARDAS[n].grant);
    const sql = [
      `-- supabase/respaldos/${FECHA}-fase1-reversion.sql`,
      `-- REVERSIÓN de migraciones/${FECHA}-fase1-cimiento.sql: devuelve la base al estado de la FASE 0`,
      `-- (cuerpos SIN guarda tal como estaban en producción, sin ayudantes nuevos, sin grants a las`,
      `-- administrativas, default privileges de la fase 0). Generada por scripts/fase1-generar.mjs`,
      `-- desde los canónicos previos a la edición; ensayada por scripts/ensayar-fase1.mjs.`,
      `-- NO restituye la sobrecarga huérfana asignar_activo(text,text,text): su cuerpo no está en el`,
      `-- repositorio y ningún cliente la usaba.`,
      `begin;`, `set local search_path = public, extensions;`, ``,
      `-- 1 · Cuerpos originales (${defs.length})`,
      ...defs.map((d) => d.def.trim() + ";\n"),
      `-- 2 · Grants: volver al estado de la fase 0 (ninguna administrativa ejecutable por authenticated)`,
      ...defs.map((d) => `revoke execute on function ${d.firma} from authenticated;`),
      ``,
      `-- 3 · Ayudantes de la fase 1`,
      ...AYUDANTES.map((a) => `drop function if exists public.${a};`),
      ``,
      `-- 4 · Default privileges como en la fase 0 (funciones nuevas nacen ejecutables por authenticated)`,
      `alter default privileges for role postgres in schema public grant execute on functions to authenticated;`,
      ``, `commit;`, ``,
    ].join("\n");
    writeFileSync(`supabase/respaldos/${FECHA}-fase1-reversion.sql`, sql);
    console.log(`Reversión escrita: ${defs.length} funciones, ${grants.length} con grant en la fase 1.`);
  } finally { await bd.parar(); }
}

if (modo === "migracion") {
  const bloquesGuardados = [];
  for (const n of NOMBRES) {
    const bs = bloques(n);
    if (!bs.length) throw new Error(`Sin bloque canónico para ${n}`);
    for (const b of bs) {
      if (!b.texto.includes(GUARDAS[n].guarda)) throw new Error(`${n} en ${b.archivo} no tiene la guarda insertada: ${GUARDAS[n].guarda}`);
      bloquesGuardados.push(`-- ${n} · ${b.archivo}\n` + b.texto.replace(/^create function/m, "create or replace function"));
    }
  }
  const conGrant = NOMBRES.filter((n) => GUARDAS[n].grant);
  const firmas = conGrant.map((n) => bloques(n)[0].texto.match(new RegExp(`^create (?:or replace )?function ${n}\\s*\\(([\\s\\S]*?)\\)\\s*returns`, "m"))[1].replace(/\s+/g, " ").replace(/default [^,]+/g, "").trim())
    .map((args, i) => `  ${conGrant[i]}(${args})`);
  const paso0 = JSON.parse(readFileSync("supabase/respaldos/2026-09-17-paso0-funciones.json", "utf8"));
  const fase0 = "actualizar_ticket,alternar_ticket_subtipo,alternar_ticket_tipo,asignar_rit_sede,crear_activo,crear_rit,crear_solicitud_admin,crear_solicitud_propia,crear_ticket_admin,decidir_propuesta_perfil,editar_trabajador,eliminar_feriado,eliminar_sede,eliminar_solicitud_aviso,eliminar_ticket_aviso,emitir_memorandum,es_admin_activo,fijar_correo_persona,fijar_hora_entrada,fn_hora_entrada,fn_nivel_memorandums,fn_nivel_modulo,fn_persona_llamador,fn_solicitud_insertar,fn_ver_cuenta_bancaria,guardar_cargo_perfil,guardar_clave_equipo,guardar_feriado,guardar_solicitud_aviso,guardar_ticket_aviso,guardar_ticket_subtipo,guardar_ticket_tipo,importar_asistencia,importar_control,importar_padron,importar_planilla_unificada,mi_sesion_backoffice,portal_actualizar_datos,portal_confirmar_lectura,portal_confirmar_recepcion,portal_crear_solicitud,portal_crear_ticket,portal_dni,portal_marcar_visto,portal_mi_sesion,portal_modo,portal_primer_ingreso,portal_registrar_ingreso,portal_registrar_sesion,portal_solicitar_cambio_cuenta,portal_verificar_bloqueo,previsualizar_control,previsualizar_padron,previsualizar_planilla_unificada,publicar_rit,reenviar_solicitud,registrar_acuse_asistido,registrar_ingreso,registrar_sesion_backoffice,resolver_solicitud,ver_clave_equipo,verificar_bloqueo".split(",");
  const esperadas = [...new Set([...fase0, ...conGrant, "es_admin", "es_superadmin", "nivel_en"])].sort();
  const grants = `grant execute on function\n${firmas.join(",\n")}\nto authenticated;`;
  const plantilla = readFileSync("supabase/fase1-plantilla.sql", "utf8");
  const migracion = plantilla
    .replace("-- @@BLOQUES@@", () => bloquesGuardados.join("\n\n"))  // replacer función: los $$ del cuerpo no se interpretan
    .replace("-- @@GRANTS@@", () => grants)
    .replaceAll("@@ESPERADAS@@", esperadas.join(","))
    .replaceAll("@@N_ESPERADAS@@", String(esperadas.length));
  writeFileSync(`supabase/migraciones/${FECHA}-fase1-cimiento.sql`, migracion);
  console.log(`Migración escrita: ${bloquesGuardados.length} bloques, ${conGrant.length} grants, ${esperadas.length} nombres esperados.`);
  // Región de la fase 1 en el canónico de permisos.
  const seg = readFileSync("supabase/seguridad.sql", "utf8");
  const region = `-- @@FASE1-INICIO@@ (generado por scripts/fase1-generar.mjs; no editar a mano)\n-- 7 · Fase 1: administrativas con guarda central (${conGrant.length}) y ayudantes consultables.\n${grants}\ngrant execute on function es_admin(), es_superadmin(), nivel_en(text) to authenticated;\ndrop function if exists asignar_activo(text, text, text);\n-- Toda función nueva nace SIN EXECUTE para nadie de la API (el grant es explícito).\n-- Hace falta la entrada GLOBAL: el default del esquema se fusiona con el global/incorporado (PUBLIC).\nalter default privileges for role postgres revoke execute on functions from public;\nalter default privileges for role postgres in schema public revoke execute on functions from public, authenticated, anon;\n-- @@FASE1-FIN@@`;
  if (!seg.includes("-- @@FASE1-INICIO@@")) throw new Error("seguridad.sql sin marcadores @@FASE1-INICIO@@/@@FASE1-FIN@@");
  writeFileSync("supabase/seguridad.sql", seg.replace(/-- @@FASE1-INICIO@@[\s\S]*?-- @@FASE1-FIN@@/, region));

  // docs/funciones-y-permisos.md — clasificación de las 120 funciones.
  const PRE_LOGIN = ["verificar_bloqueo", "registrar_ingreso", "portal_verificar_bloqueo", "portal_registrar_ingreso"];
  const AUTOSERVICIO = ["portal_actualizar_datos", "portal_confirmar_lectura", "portal_confirmar_recepcion", "portal_crear_solicitud", "portal_crear_ticket", "portal_marcar_visto", "portal_mi_sesion", "portal_primer_ingreso", "portal_registrar_sesion", "portal_solicitar_cambio_cuenta", "crear_solicitud_propia", "reenviar_solicitud", "portal_dni", "portal_modo"];
  const filas = [];
  for (const f of paso0.filter((f) => !f.es_trigger)) {
    const firma = `${f.nombre}(${f.args})`;
    if (f.nombre === "asignar_activo" && f.args === "p_codigo text, p_dni text, p_condicion text") { filas.push([firma, "eliminada", "sobrecarga huérfana sin uso; se elimina en la fase 1", "no"]); continue; }
    if (PRE_LOGIN.includes(f.nombre)) filas.push([firma, "pre-login", "sin sesión por diseño (bloqueo e intentos)", "anon + authenticated"]);
    else if (AUTOSERVICIO.includes(f.nombre)) filas.push([firma, "autoservicio del trabajador", f.guarda_via.join(", ") || "identidad por JWT (portal_dni)", "authenticated"]);
    else if (GUARDAS[f.nombre]) filas.push([firma, "administrativa", `${GUARDAS[f.nombre].modulo} · nivel ${GUARDAS[f.nombre].nivel}`, GUARDAS[f.nombre].grant ? "authenticated" : "solo service_role"]);
    else if (esperadas.includes(f.nombre)) filas.push([firma, "administrativa", `guarda propia: ${f.guarda_via.join(", ")}`, "authenticated"]);
    else filas.push([firma, "interna", "solo la llaman otras funciones (security definer) o vistas", "ninguno (service_role)"]);
  }
  const md = [
    `# Funciones y permisos — clasificación (fase 1, ${FECHA})`, ``,
    `Fuente: foto del paso 0 (\`supabase/respaldos/2026-09-17-paso0-funciones.json\`) + decisiones de la fase 1 (\`scripts/fase1-generar.mjs\`, tabla GUARDAS).`,
    `Regenerar con \`node scripts/fase1-generar.mjs migracion\`.`, ``,
    `Grupos: **pre-login** (sin sesión), **autoservicio del trabajador** (identidad derivada del JWT, sin parámetros de identidad),`,
    `**administrativa** (guarda central: \`requiere_nivel(modulo, nivel[, modulo_alternativo])\` o \`requiere_superadmin()\`; las anteriores a la fase 1 mantienen su guarda propia sobre \`fn_nivel_modulo\`, que es la misma regla), **interna** (sin EXECUTE para nadie salvo service_role).`, ``,
    `Ayudantes de la fase 1 (SECURITY DEFINER, STABLE, search_path fijo): \`correo_llamador()\`, \`es_admin()\`, \`es_superadmin()\`, \`nivel_en(modulo)\`, \`requiere_nivel(modulo, nivel, modulo_alternativo)\`, \`requiere_superadmin()\`, \`requiere_correo_propio(correo)\`. Los tres primeros son consultables por el cliente; los \`requiere_*\` lanzan \`insufficient_privilege\` (42501).`, ``,
    `Regla de nacimiento: \`ALTER DEFAULT PRIVILEGES\` deja toda función nueva SIN EXECUTE para authenticated; el grant es explícito y está listado en \`supabase/seguridad.sql\`.`, ``,
    `| Función | Grupo | Guarda / regla | EXECUTE |`, `|---|---|---|---|`,
    ...filas.map((r) => `| \`${r[0]}\` | ${r[1]} | ${r[2]} | ${r[3]} |`),
    ``, `Funciones de trigger (10): sin EXECUTE para los roles de la API; las dispara el motor al escribir.`, ``,
  ].join("\n");
  writeFileSync("docs/funciones-y-permisos.md", md);
  console.log(`docs/funciones-y-permisos.md: ${filas.length} funciones clasificadas.`);
}
