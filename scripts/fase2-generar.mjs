// scripts/fase2-generar.mjs — Corrección de seguridad · FASE 2 (vistas con
// security_invoker). ÚNICA fuente de las listas: qué vistas pasan a correr con
// los permisos del consultante, cuáles siguen como dueño (Portal, hasta la
// fase 4), qué tablas reciben política de lectura y qué tablas necesitan
// GRANT SELECT. Genera:
//   supabase/migraciones/2026-09-18-fase2-vistas.sql   (una transacción)
//   supabase/respaldos/2026-09-18-fase2-reversion.sql  (una transacción)
//   bloque @@FASE2-INICIO@@ … @@FASE2-FIN@@ de supabase/seguridad.sql (espejo)
// Uso: node scripts/fase2-generar.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const FECHA = "2026-09-18";

// 38 vistas que solo consume el BackOffice (sesión de administrador) más los
// 3 catálogos que también lee el Portal. Con security_invoker el consultante
// necesita SELECT + política en cada tabla de abajo.
export const VISTAS_INVOKER = [
  "v_actividad_persona", "v_activos", "v_acuses", "v_asistencia_lotes", "v_asistencia_mensual",
  "v_cargo_perfiles", "v_comunicado_pendientes", "v_comunicados", "v_contratos", "v_declaraciones_vigentes",
  "v_epp_entregas", "v_feriados", "v_lotes", "v_marcaciones", "v_memorandums", "v_mi_acceso",
  "v_mis_solicitudes", "v_movimientos_persona", "v_perfil_propuestas", "v_perfil_versiones", "v_perfiles",
  "v_personal", "v_politica_acceso", "v_registro_accesos", "v_rit_faltas", "v_rits", "v_sedes",
  "v_solicitud_avisos", "v_solicitud_eventos", "v_solicitud_tipos", "v_solicitudes", "v_ticket_avisos",
  "v_ticket_catalogo", "v_ticket_config", "v_tickets", "v_tipos_sancion", "v_usuarios_admin", "v_vinculos_persona",
];
// Vistas de catálogo (subconjunto de arriba): sin datos personales, sobre las
// tablas con lectura_sesion. Las tres primeras las lee el Portal; v_ticket_config
// es del BackOffice pero sale de las MISMAS tablas que v_ticket_catalogo (solo
// añade los tipos inactivos), así que un trabajador también la puede leer.
export const VISTAS_CATALOGO = ["v_declaraciones_vigentes", "v_solicitud_tipos", "v_ticket_catalogo", "v_ticket_config"];
// 9 vistas del Portal: filtran por portal_dni() DENTRO de la vista y hoy dependen
// de correr como dueño. Pasan a security_invoker en la fase 4, junto con las
// políticas por trabajador sobre sus tablas. Son las «vistas que dependían de
// saltarse los permisos» que el prompt pide anotar.
export const VISTAS_PORTAL = [
  "v_portal_boletas", "v_portal_comunicados", "v_portal_datos", "v_portal_mes", "v_portal_pendientes",
  "v_portal_perfil", "v_portal_rit", "v_portal_solicitudes", "v_portal_tickets",
];
// Tablas base bajo las 38 vistas (cierre transitivo, inventario del 2026-09-18),
// menos empresas y tardanzas (ya tienen solo_admin FOR ALL desde la fase 0b) y
// menos los 4 catálogos. Política lectura_admin: SELECT para administradores activos.
export const TABLAS_ADMIN = [
  "activos", "acuses", "asignaciones", "asistencia_lotes", "auditoria", "cargo_perfiles", "comunicado_lecturas",
  "comunicados", "contratos", "cuentas_portal", "descargos", "documentos", "epp_entregas", "feriados", "lotes",
  "marcaciones", "memorandums", "movimientos", "notificaciones_documento", "perfil_empresas", "perfil_permisos",
  "perfil_propuestas", "perfiles", "personas", "politica_acceso", "registro_accesos", "rit_faltas", "rits", "sedes",
  "solicitud_avisos", "solicitud_eventos", "solicitudes", "solicitudes_cambio_cuenta", "ticket_avisos", "tickets",
  "tipos_sancion", "usuarios_admin", "vinculos",
];
// Catálogos sin datos personales que lee cualquier sesión de la aplicación
// (administrador activo o trabajador identificado). Política lectura_sesion.
export const TABLAS_SESION = ["declaraciones", "solicitud_tipos", "ticket_subtipos", "ticket_tipos"];
// Tablas bajo las vistas SIN ningún privilegio para authenticated en producción
// (foto del paso 0). Solo SELECT: las filas las decide la política.
export const TABLAS_GRANT = [
  "movimientos", "notificaciones_documento", "perfil_propuestas", "rits", "solicitud_avisos", "solicitud_eventos",
  "solicitud_tipos", "solicitudes", "ticket_avisos", "ticket_subtipos", "ticket_tipos", "tickets",
];

const lista = (arr) => arr.map((x) => `'${x}'`).join(", ");
const sqlArray = (arr) => `array[${lista(arr)}]`;

const CUERPO = `-- 1 · GRANT SELECT en las ${TABLAS_GRANT.length} tablas bajo vistas que no tenían privilegio alguno
--     para authenticated. Las filas las decide RLS (política), no el grant.
grant select on table ${TABLAS_GRANT.join(", ")} to authenticated;

-- 2 · Políticas de lectura: lectura_admin (administrador activo) en ${TABLAS_ADMIN.length} tablas;
--     lectura_sesion (administrador activo o trabajador identificado) en ${TABLAS_SESION.length} catálogos.
do $$
declare t text;
begin
  foreach t in array ${sqlArray(TABLAS_ADMIN)} loop
    execute format('drop policy if exists lectura_admin on public.%I', t);
    execute format('create policy lectura_admin on public.%I for select to authenticated using (public.es_admin_activo())', t);
  end loop;
  foreach t in array ${sqlArray(TABLAS_SESION)} loop
    execute format('drop policy if exists lectura_sesion on public.%I', t);
    execute format('create policy lectura_sesion on public.%I for select to authenticated using (public.es_admin_activo() or public.portal_dni() is not null)', t);
  end loop;
end $$;

-- 3 · security_invoker en las ${VISTAS_INVOKER.length} vistas del BackOffice y catálogos.
${VISTAS_INVOKER.map((v) => `alter view public.${v} set (security_invoker = on);`).join("\n")}
`;

export const VERIFICACION = `-- 4 · Verificación embebida (falla → rollback de toda la transacción).
do $$
declare n int; l text;
begin
  select string_agg(c.relname, ',' order by c.relname) into l
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'v' and 'security_invoker=on' = any(c.reloptions);
  if l is distinct from '${VISTAS_INVOKER.join(",")}' then
    raise exception 'fase2: vistas con security_invoker distintas de las esperadas: %', l; end if;
  select string_agg(c.relname, ',' order by c.relname) into l
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'v' and not ('security_invoker=on' = any(coalesce(c.reloptions, '{}')));
  if l is distinct from '${VISTAS_PORTAL.join(",")}' then
    raise exception 'fase2: vistas que siguen como dueño distintas de las 9 del Portal: %', l; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and policyname = 'lectura_admin';
  if n <> ${TABLAS_ADMIN.length} then raise exception 'fase2: % políticas lectura_admin, esperadas ${TABLAS_ADMIN.length}', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and policyname = 'lectura_sesion';
  if n <> ${TABLAS_SESION.length} then raise exception 'fase2: % políticas lectura_sesion, esperadas ${TABLAS_SESION.length}', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and (qual = 'true' or with_check = 'true');
  if n > 0 then raise exception 'fase2: % políticas con condición true', n; end if;
  select count(*) into n from unnest(${sqlArray(TABLAS_GRANT)}) t
   where not has_table_privilege('authenticated', 'public.' || t, 'select')
      or has_table_privilege('authenticated', 'public.' || t, 'insert')
      or has_table_privilege('authenticated', 'public.' || t, 'update')
      or has_table_privilege('authenticated', 'public.' || t, 'delete');
  if n > 0 then raise exception 'fase2: % tablas del grant sin SELECT o con escritura para authenticated', n; end if;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r'
     and c.relname in (select unnest(${sqlArray([...TABLAS_ADMIN, ...TABLAS_SESION])})) and not c.relrowsecurity;
  if n > 0 then raise exception 'fase2: % tablas con política pero sin RLS activa', n; end if;
  -- Comportamiento: una sesión authenticated sin identidad conocida no ve nada
  -- ni por las vistas del BackOffice ni por las tablas.
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"nadie@ejemplo.invalido","sub":"00000000-0000-0000-0000-000000000000"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.v_personal;
  if n <> 0 then execute 'reset role'; raise exception 'fase2: v_personal devolvió % filas a una sesión sin identidad', n; end if;
  select count(*) into n from public.v_usuarios_admin;
  if n <> 0 then execute 'reset role'; raise exception 'fase2: v_usuarios_admin devolvió % filas a una sesión sin identidad', n; end if;
  select count(*) into n from public.personas;
  if n <> 0 then execute 'reset role'; raise exception 'fase2: personas devolvió % filas a una sesión sin identidad', n; end if;
  select count(*) into n from public.v_solicitud_tipos;
  if n <> 0 then execute 'reset role'; raise exception 'fase2: v_solicitud_tipos devolvió % filas a una sesión sin identidad', n; end if;
  execute 'reset role';
end $$;
`;

export const MIGRACION = `-- supabase/migraciones/${FECHA}-fase2-vistas.sql
-- Corrección de seguridad · FASE 2 — VISTAS. GENERADA por scripts/fase2-generar.mjs
-- (las listas viven ahí; no editar a mano: cambiar el generador y regenerar).
--
-- UNA transacción. Reversión: supabase/respaldos/${FECHA}-fase2-reversion.sql
-- (ensayo: scripts/ensayar-fase2.mjs). Requiere las fases 0, 0b y 1 aplicadas.
--
-- Por qué NO son las 47 vistas (desvío respecto del prompt, documentado en
-- docs/seguridad/${FECHA}-fase2-vistas.md): el prompt daba por hecho que en
-- esta fase las políticas seguían permisivas. La fase 0 eliminó acceso_demo y
-- activó RLS en todas las tablas (fallan cerrado). Con security_invoker y sin
-- políticas TODAS las vistas devuelven vacío o «permission denied» a todos
-- (inventario ${FECHA}, estado B). Por eso esta fase trae la política mínima
-- que necesita cada grupo:
--  · ${VISTAS_INVOKER.length} vistas del BackOffice (+3 catálogos) → security_invoker = on, con
--    lectura_admin (es_admin_activo()) en sus ${TABLAS_ADMIN.length} tablas base y lectura_sesion
--    en ${TABLAS_SESION.length} catálogos. Un trabajador del Portal deja de poder leer v_personal,
--    v_usuarios_admin, etc. (hoy puede: las vistas corren como dueño).
--  · ${VISTAS_PORTAL.length} vistas v_portal_* siguen como dueño: filtran por portal_dni() dentro
--    y necesitan políticas por trabajador (fase 4). Quedan anotadas.
-- Lo que un trabajador puede leer NO cambia salvo para restringirse; lo que un
-- administrador puede leer por vistas no cambia; un administrador pasa a poder
-- leer directamente (solo SELECT) las tablas base de sus vistas.

begin;
set local search_path = public, extensions;

-- 0 · Precondición: fases 0, 0b y 1 aplicadas; ninguna vista con security_invoker.
do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('es_admin', 'es_superadmin', 'nivel_en', 'requiere_nivel', 'requiere_superadmin');
  if n < 5 then raise exception 'fase2: falta la fase 1 (guarda central: % de 5 ayudantes)', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and policyname = 'solo_admin';
  if n <> 5 then raise exception 'fase2: se esperaban 5 políticas solo_admin (fase 0b), hay %', n; end if;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'v';
  if n <> ${VISTAS_INVOKER.length + VISTAS_PORTAL.length} then raise exception 'fase2: se esperaban ${VISTAS_INVOKER.length + VISTAS_PORTAL.length} vistas, hay %', n; end if;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'v' and 'security_invoker=on' = any(coalesce(c.reloptions, '{}'));
  if n <> 0 then raise exception 'fase2: ya hay % vistas con security_invoker (¿fase 2 aplicada?)', n; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('es_admin_activo', 'portal_dni') and p.prosecdef and p.provolatile = 's'
     and has_function_privilege('authenticated', p.oid, 'execute');
  if n <> 2 then raise exception 'fase2: es_admin_activo() y portal_dni() deben ser definer, stable y ejecutables por authenticated (%/2)', n; end if;
end $$;

${CUERPO}
${VERIFICACION}
commit;
`;

export const REVERSION = `-- supabase/respaldos/${FECHA}-fase2-reversion.sql
-- Reversión completa de la FASE 2 (GENERADA por scripts/fase2-generar.mjs).
-- Deja la base exactamente como tras la fase 1: vistas como dueño, sin las
-- políticas lectura_admin/lectura_sesion y sin el SELECT concedido.
begin;
set local search_path = public, extensions;

${VISTAS_INVOKER.map((v) => `alter view public.${v} reset (security_invoker);`).join("\n")}

do $$
declare t text;
begin
  foreach t in array ${sqlArray(TABLAS_ADMIN)} loop
    execute format('drop policy if exists lectura_admin on public.%I', t);
  end loop;
  foreach t in array ${sqlArray(TABLAS_SESION)} loop
    execute format('drop policy if exists lectura_sesion on public.%I', t);
  end loop;
end $$;

revoke select on table ${TABLAS_GRANT.join(", ")} from authenticated;

do $$
declare n int;
begin
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'v' and 'security_invoker=on' = any(coalesce(c.reloptions, '{}'));
  if n <> 0 then raise exception 'reversión fase2: quedan % vistas con security_invoker', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and policyname in ('lectura_admin', 'lectura_sesion');
  if n <> 0 then raise exception 'reversión fase2: quedan % políticas lectura_*', n; end if;
  select count(*) into n from unnest(${sqlArray(TABLAS_GRANT)}) t where has_table_privilege('authenticated', 'public.' || t, 'select');
  if n <> 0 then raise exception 'reversión fase2: % tablas siguen con SELECT para authenticated', n; end if;
end $$;

commit;
`;

export const ESPEJO = `-- @@FASE2-INICIO@@ (generado por scripts/fase2-generar.mjs; no editar a mano)
-- 8 · Fase 2: ${VISTAS_INVOKER.length} vistas con security_invoker (BackOffice + catálogos), políticas de
--     lectura para administradores y catálogos, SELECT en las tablas que no lo tenían.
--     Las ${VISTAS_PORTAL.length} v_portal_* siguen como dueño hasta la fase 4.
${CUERPO}-- @@FASE2-FIN@@`;

// Quita el bloque de la fase 2 del espejo (para ensayar la migración sobre el
// estado de la fase 1).
export const sinFase2 = (texto) => texto.replace(/-- @@FASE2-INICIO@@[\s\S]*?-- @@FASE2-FIN@@\n?/, "");

const esPrincipal = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esPrincipal) {
  writeFileSync(`supabase/migraciones/${FECHA}-fase2-vistas.sql`, MIGRACION);
  writeFileSync(`supabase/respaldos/${FECHA}-fase2-reversion.sql`, REVERSION);
  const ruta = "supabase/seguridad.sql";
  const actual = readFileSync(ruta, "utf8");
  const limpio = sinFase2(actual).replace(/\s+$/, "");
  writeFileSync(ruta, `${limpio}\n\n${ESPEJO}\n`);
  console.log(`Generados: migración (${VISTAS_INVOKER.length} vistas, ${TABLAS_ADMIN.length}+${TABLAS_SESION.length} políticas, ${TABLAS_GRANT.length} grants), reversión y bloque de seguridad.sql.`);
}
