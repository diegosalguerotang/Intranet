// scripts/fase4-generar.mjs — Corrección de seguridad · FASE 4 (RLS por rol).
// ÚNICA fuente de la MATRIZ de políticas. Genera:
//   supabase/rls.sql                                  (canónico: ayudantes + políticas + vistas + bucket)
//   supabase/migraciones/2026-09-18-fase4-rls.sql     (una transacción: precondición, respaldo de las
//                                                      políticas vigentes en interno.respaldo_fase4, rls.sql,
//                                                      verificación con comportamiento)
//   supabase/respaldos/2026-09-18-fase4-reversion.sql (una transacción: políticas anteriores desde el respaldo)
//   bloque @@FASE4-INICIO@@ … @@FASE4-FIN@@ de supabase/seguridad.sql
// Uso: node scripts/fase4-generar.mjs
//
// Reglas del prompt (fase 4): política propia por tabla con denegación por
// defecto; ninguna condición true; el trabajador solo alcanza sus registros
// (por documento); el administrativo lo que permita nivel_en(módulo) y su
// alcance por razón social; el alcance filtra filas (vacío, no error);
// políticas equivalentes en el bucket de documentos.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const FECHA = "2026-09-18";

// Expresiones reutilizables. Las funciones de nivel se envuelven en (select …)
// para que PostgreSQL las evalúe una vez por consulta (initplan), no por fila.
const nivel = (m, n = 1) => `(select public.nivel_en('${m}')) >= ${n}`;
const admin = `(select public.es_admin())`;
const sesion = `((select public.es_admin()) or (select public.portal_dni()) is not null)`;

// MATRIZ: tabla → { adm: lectura de administrador, trab: lectura del trabajador,
// escr: escritura directa del BackOffice (insert/update/delete) }. Sin entrada = nadie.
export const MATRIZ = {
  // ---- padrón (lo necesita cualquier módulo de RRHH para nombres) ----------
  "public.personas":                  { adm: `${admin} and (public.fn_alcance_persona(dni) or dni = (select public.fn_persona_llamador()))`, trab: `public.fn_es_mi_dni(dni)` },
  "public.vinculos":                  { adm: `${admin} and public.fn_alcance_empresa(empresa_id)`, trab: `public.fn_es_mi_dni(persona_dni)` },
  "public.cuentas_portal":            { adm: `${nivel("personal")} and public.fn_alcance_persona(dni)`, trab: `public.fn_es_mi_dni(dni)` },
  "public.consentimientos":           { adm: `${nivel("personal")} and public.fn_alcance_persona(dni)`, trab: `public.fn_es_mi_dni(dni)` },
  "public.solicitudes_cambio_cuenta": { adm: `${nivel("personal")} and public.fn_alcance_persona(dni)`, trab: `public.fn_es_mi_dni(dni)` },
  "public.movimientos":               { adm: `${nivel("personal")} and public.fn_alcance_persona(persona_dni)` },
  "public.epp_entregas":              { adm: `${nivel("personal")} and public.fn_alcance_persona(dni)` },
  "public.horarios_entrada":          { adm: `${nivel("asistencia")} and public.fn_alcance_persona(persona_dni)` },
  "interno.datos_bancarios":          { adm: `${nivel("personal")} and public.fn_alcance_persona(dni)`, trab: `public.fn_es_mi_dni(dni)` },
  // ---- boletas y documentos --------------------------------------------------
  "public.documentos":                { adm: `${nivel("boletas")} and public.fn_alcance_vinculo(vinculo_id)`, trab: `public.fn_mi_vinculo(vinculo_id)`, escr: `${nivel("boletas", 2)} and public.fn_alcance_vinculo(vinculo_id)` },
  "public.lotes":                     { adm: `${nivel("boletas")} and public.fn_alcance_empresa(empresa_id)` },
  "public.notificaciones_documento":  { adm: `${nivel("boletas")} and public.fn_alcance_documento(documento_id)` },
  "public.plantillas":                { adm: `${nivel("boletas")} and public.fn_alcance_empresa(empresa_id)`, escr: `${nivel("boletas", 2)} and public.fn_alcance_empresa(empresa_id)` },
  "public.acuses":                    { adm: `${nivel("acuses")} and public.fn_alcance_documento(documento_id)`, trab: `public.fn_es_mi_dni(dni_check)` },
  // ---- comunicados ------------------------------------------------------------
  "public.comunicados":               { adm: `${nivel("comunicados")} and public.fn_alcance_empresa(empresa_id)`, trab: `public.fn_comunicado_me_alcanza(id)` },
  "public.comunicado_lecturas":       { adm: `${nivel("comunicados")} and public.fn_alcance_persona(dni)`, trab: `public.fn_es_mi_dni(dni)` },
  // ---- disciplina -------------------------------------------------------------
  "public.memorandums":               { adm: `${nivel("memorandums")} and public.fn_alcance_vinculo(vinculo_id)` },
  "public.descargos":                 { adm: `${nivel("memorandums")} and public.fn_alcance_memorandum(memorandum_id)` },
  "public.tipos_sancion":             { adm: admin },
  "public.rit_faltas":                { adm: admin },
  "public.rits":                      { adm: admin, trab: `(select public.portal_dni()) is not null` },
  // ---- contratos, tardanzas, asistencia -----------------------------------------
  "public.contratos":                 { adm: `${nivel("contratos")} and public.fn_alcance_vinculo(vinculo_id)` },
  "public.tardanzas":                 { adm: `${nivel("tardanzas")} and public.fn_alcance_persona(dni)`, trab: `public.fn_es_mi_dni(dni)`, escr: `${nivel("tardanzas", 2)} and public.fn_alcance_persona(dni)` },
  "public.marcaciones":               { adm: `${nivel("asistencia")} and public.fn_alcance_empresa(empresa_id)` },
  "public.asistencia_lotes":          { adm: `${nivel("asistencia")} and public.fn_alcance_empresa(empresa_id)` },
  "public.asistencia_config":         { adm: nivel("asistencia"), escr: nivel("asistencia", 2) },
  "public.feriados":                  { adm: admin },
  // ---- gestión de TI ---------------------------------------------------------------
  "public.activos":                   { adm: `${nivel("activos")} and public.fn_alcance_empresa(empresa_id)` },
  "public.asignaciones":              { adm: `${nivel("activos")} and public.fn_alcance_activo(activo_codigo)` },
  "public.lineas":                    { adm: nivel("activos"), escr: nivel("activos", 2) },
  "public.tickets":                   { adm: `${nivel("soporte")} and public.fn_alcance_empresa(empresa_id)`, trab: `public.fn_es_mi_dni(solicitante_dni)` },
  "public.ticket_tipos":              { sesion: true },
  "public.ticket_subtipos":           { sesion: true },
  "public.ticket_avisos":             { adm: nivel("soporte") },
  // ---- solicitudes -------------------------------------------------------------------
  "public.solicitudes":               { adm: `(${nivel("solicitudes")} and public.fn_alcance_empresa(empresa_id)) or solicitante_dni = (select public.fn_persona_llamador())`, trab: `public.fn_es_mi_dni(solicitante_dni)` },
  "public.solicitud_eventos":         { adm: `public.fn_alcance_solicitud(solicitud_id)`, trab: `public.fn_mi_solicitud(solicitud_id)` },
  "public.solicitud_tipos":           { sesion: true },
  "public.solicitud_avisos":          { adm: nivel("solicitudes") },
  // ---- catálogos de la organización --------------------------------------------------
  "public.empresas":                  { adm: admin, trab: `(select public.portal_dni()) is not null`, escr: nivel("configuracion", 2) },
  "public.sedes":                     { adm: `${admin} and public.fn_alcance_empresa(empresa_id)`, trab: `public.fn_mi_sede(id)` },
  "public.bancos":                    { adm: admin },
  "public.cargos":                    { adm: admin },
  "public.centros_costo":             { adm: admin },
  "public.declaraciones":             { sesion: true },
  // ---- accesos, auditoría y parámetros (interno) ----------------------------------------
  "interno.usuarios_admin":           { adm: `${nivel("accesos")} or lower(correo) = (select public.correo_llamador())` },
  "interno.perfiles":                 { adm: `${nivel("accesos")} or public.fn_mi_perfil(id, version)` },
  "interno.perfil_permisos":          { adm: `${nivel("accesos")} or public.fn_mi_perfil(perfil_id, perfil_version)` },
  "interno.perfil_empresas":          { adm: `${nivel("accesos")} or public.fn_mi_perfil(perfil_id, version)` },
  "interno.perfil_propuestas":        { adm: nivel("accesos") },
  "interno.cargo_perfiles":           { adm: nivel("accesos") },
  "interno.registro_accesos":         { adm: `${nivel("auditoria")} or ${nivel("accesos")}` },
  "interno.politica_acceso":          { adm: admin },
  "interno.auditoria":                { adm: `${nivel("auditoria")} or (${nivel("personal")} and public.fn_alcance_persona(public.fn_dni_auditoria(datos_antes, datos_despues)))` },
  // Sin política (nadie desde la API; solo funciones definer / servicio):
  // public.correo_envios, public.solicitud_correlativos, interno.correo_tokens, interno.respaldo_*.
};
export const SIN_POLITICA = ["public.correo_envios", "public.solicitud_correlativos", "interno.correo_tokens"];
export const VISTAS_PORTAL = ["v_portal_boletas", "v_portal_comunicados", "v_portal_datos", "v_portal_mes", "v_portal_pendientes", "v_portal_perfil", "v_portal_rit", "v_portal_solicitudes", "v_portal_tickets"];
export const AYUDANTES = ["fn_alcance_empresa(text)", "fn_alcance_persona(text)", "fn_alcance_vinculo(bigint)", "fn_alcance_documento(bigint)", "fn_alcance_memorandum(text)",
  "fn_alcance_activo(text)", "fn_alcance_solicitud(bigint)", "fn_es_mi_dni(text)", "fn_mi_vinculo(bigint)", "fn_mi_solicitud(bigint)", "fn_comunicado_me_alcanza(bigint)",
  "fn_mi_sede(text)", "fn_mi_perfil(text, integer)", "fn_dni_auditoria(jsonb, jsonb)"];
export const POLITICAS_NUEVAS = ["adm_lectura", "adm_escritura", "propio", "sesion"];
export const POLITICAS_BUCKET = ["documentos_leer", "documentos_subir", "documentos_actualizar"];

const AYUDANTES_SQL = `-- 1 · Ayudantes de alcance (SECURITY DEFINER, STABLE, search_path fijo). Los
--     evalúa el rol que consulta, así que authenticated necesita EXECUTE.
create or replace function fn_alcance_empresa(p_empresa text) returns boolean
language sql stable security definer set search_path = public, interno, extensions as $$
  select p_empresa is null
      or es_superadmin()
      or exists (select 1 from usuarios_admin u
                 join perfil_empresas pe on pe.perfil_id = u.perfil_id and pe.version = u.perfil_version
                 where lower(u.correo) = correo_llamador() and u.estado = 'activo' and pe.empresa_id = p_empresa)
$$;
create or replace function fn_alcance_persona(p_dni text) returns boolean
language sql stable security definer set search_path = public, interno, extensions as $$
  select p_dni is not null and (es_superadmin()
      or exists (select 1 from vinculos v where v.persona_dni = p_dni and fn_alcance_empresa(v.empresa_id))
      or not exists (select 1 from vinculos v where v.persona_dni = p_dni))
$$;
create or replace function fn_alcance_vinculo(p_id bigint) returns boolean
language sql stable security definer set search_path = public, interno, extensions as $$
  select exists (select 1 from vinculos v where v.id = p_id and fn_alcance_empresa(v.empresa_id))
$$;
create or replace function fn_alcance_documento(p_id bigint) returns boolean
language sql stable security definer set search_path = public, interno, extensions as $$
  select exists (select 1 from documentos d where d.id = p_id and fn_alcance_vinculo(d.vinculo_id))
$$;
create or replace function fn_alcance_memorandum(p_id text) returns boolean
language sql stable security definer set search_path = public, interno, extensions as $$
  select exists (select 1 from memorandums m where m.id = p_id and fn_alcance_vinculo(m.vinculo_id))
$$;
create or replace function fn_alcance_activo(p_codigo text) returns boolean
language sql stable security definer set search_path = public, interno, extensions as $$
  select exists (select 1 from activos a where a.codigo = p_codigo and fn_alcance_empresa(a.empresa_id))
$$;
create or replace function fn_alcance_solicitud(p_id bigint) returns boolean
language sql stable security definer set search_path = public, interno, extensions as $$
  select exists (select 1 from solicitudes s where s.id = p_id
                 and ((nivel_en('solicitudes') >= 1 and fn_alcance_empresa(s.empresa_id)) or s.solicitante_dni = fn_persona_llamador()))
$$;
-- Trabajador del Portal: sus propios registros, resueltos por su documento.
create or replace function fn_es_mi_dni(p_dni text) returns boolean
language sql stable security definer set search_path = public, interno, extensions as $$
  select p_dni is not null and p_dni = portal_dni()
$$;
create or replace function fn_mi_vinculo(p_id bigint) returns boolean
language sql stable security definer set search_path = public, interno, extensions as $$
  select exists (select 1 from vinculos v where v.id = p_id and v.persona_dni = portal_dni())
$$;
create or replace function fn_mi_solicitud(p_id bigint) returns boolean
language sql stable security definer set search_path = public, interno, extensions as $$
  select exists (select 1 from solicitudes s where s.id = p_id and s.solicitante_dni = portal_dni())
$$;
-- Un comunicado alcanza al trabajador si su segmento (empresa/sede, o todo el
-- grupo cuando van vacíos) coincide con algún vínculo vigente suyo.
create or replace function fn_comunicado_me_alcanza(p_id bigint) returns boolean
language sql stable security definer set search_path = public, interno, extensions as $$
  select portal_dni() is not null and exists (
    select 1 from comunicados c join vinculos v on v.persona_dni = portal_dni() and v.fecha_fin is null
    where c.id = p_id and (c.empresa_id is null or c.empresa_id = v.empresa_id) and (c.sede_id is null or c.sede_id = v.sede_id))
$$;
create or replace function fn_mi_sede(p_id text) returns boolean
language sql stable security definer set search_path = public, interno, extensions as $$
  select exists (select 1 from vinculos v where v.sede_id = p_id and v.persona_dni = portal_dni())
$$;
-- Categoría del propio administrador (v_mi_acceso la necesita sin módulo Accesos).
create or replace function fn_mi_perfil(p_perfil text, p_version integer) returns boolean
language sql stable security definer set search_path = public, interno, extensions as $$
  select exists (select 1 from usuarios_admin u where lower(u.correo) = correo_llamador() and u.estado = 'activo'
                 and u.perfil_id = p_perfil and u.perfil_version = p_version)
$$;
-- DNI que referencia una fila de auditoría (misma regla que v_actividad_persona).
create or replace function fn_dni_auditoria(p_antes jsonb, p_despues jsonb) returns text
language sql immutable as $$
  select coalesce(nullif(d ->> 'persona_dni', ''), nullif(d ->> 'dni', ''), nullif(d ->> 'p_dni', ''), nullif(d ->> 'dni_check', ''))
  from (select coalesce(p_despues, p_antes) as d) x
$$;
revoke all on function ${AYUDANTES.join(", ")} from public, anon;
grant execute on function ${AYUDANTES.join(", ")} to authenticated, service_role;
-- Las políticas se evalúan como el rol que consulta: authenticated necesita
-- poder llamar a correo_llamador() (devuelve solo su propio correo).
grant execute on function correo_llamador() to authenticated;
`;

function politicasSQL() {
  const out = [];
  for (const [tabla, m] of Object.entries(MATRIZ)) {
    const [esq, t] = tabla.split(".");
    out.push(`-- ${tabla}`);
    for (const p of POLITICAS_NUEVAS) out.push(`drop policy if exists ${p} on ${esq}.${t};`);
    if (m.sesion) out.push(`create policy sesion on ${esq}.${t} for select to authenticated using (${sesion});`);
    if (m.adm) out.push(`create policy adm_lectura on ${esq}.${t} for select to authenticated using (${m.adm});`);
    if (m.trab) out.push(`create policy propio on ${esq}.${t} for select to authenticated using (${m.trab});`);
    if (m.escr) out.push(`create policy adm_escritura on ${esq}.${t} for all to authenticated using (${m.escr}) with check (${m.escr});`);
  }
  return out.join("\n");
}

const BUCKET_SQL = `-- 4 · Bucket «documentos»: conocer la ruta no basta. Lectura y escritura por
--     prefijo de ruta, módulo y (donde la ruta la lleva) razón social. El Portal
--     descarga por la API (llave de servicio + comprobación del dueño), no directo.
drop policy if exists documentos_leer on storage.objects;
drop policy if exists documentos_subir on storage.objects;
drop policy if exists documentos_actualizar on storage.objects;
create policy documentos_leer on storage.objects for select to authenticated using (
  bucket_id = 'documentos' and (
       (name like 'lotes/%' and (select public.nivel_en('boletas')) >= 1 and public.fn_alcance_empresa(split_part(name, '/', 2)))
    or (name like 'cargos/%' and (select public.nivel_en('acuses')) >= 1)
    or (name like 'rit/%' and (select public.es_admin()))
    or (name like 'solicitudes/adjuntos/%' and (select public.nivel_en('solicitudes')) >= 1)
    or (name like 'solicitudes/%' and name not like 'solicitudes/adjuntos/%' and (select public.nivel_en('solicitudes')) >= 1 and public.fn_alcance_empresa(split_part(name, '/', 2)))
  ));
create policy documentos_subir on storage.objects for insert to authenticated with check (
  bucket_id = 'documentos' and (
       (name like 'lotes/%' and (select public.nivel_en('boletas')) >= 2 and public.fn_alcance_empresa(split_part(name, '/', 2)))
    or (name like 'cargos/%' and (select public.nivel_en('acuses')) >= 2)
    or (name like 'rit/%' and ((select public.nivel_en('configuracion')) >= 2 or (select public.nivel_en('personal')) >= 2))
    or (name like 'solicitudes/adjuntos/%' and ((select public.nivel_en('solicitudes')) >= 1 or (select public.portal_dni()) is not null))
  ));
create policy documentos_actualizar on storage.objects for update to authenticated
  using (bucket_id = 'documentos' and (
       (name like 'lotes/%' and (select public.nivel_en('boletas')) >= 2 and public.fn_alcance_empresa(split_part(name, '/', 2)))
    or (name like 'cargos/%' and (select public.nivel_en('acuses')) >= 2)
    or (name like 'rit/%' and ((select public.nivel_en('configuracion')) >= 2 or (select public.nivel_en('personal')) >= 2))))
  with check (bucket_id = 'documentos');
`;

export const RLS_SQL = `-- supabase/rls.sql — Corrección de seguridad · FASE 4 (${FECHA}): RLS POR ROL.
-- GENERADO por scripts/fase4-generar.mjs (la matriz vive ahí; no editar a mano).
-- Lo embeben la migración migraciones/${FECHA}-fase4-rls.sql y el bloque
-- @@FASE4@@ de seguridad.sql. Idempotente.
--
-- Política propia por tabla, denegación por defecto, ninguna condición true:
--   adm_lectura   administrador activo: nivel_en(módulo) ≥ 1 y alcance por razón social
--   propio        trabajador del Portal: solo sus registros, por su documento
--   sesion        catálogos sin datos personales: cualquier sesión identificada
--   adm_escritura solo donde el BackOffice escribe la tabla directo (nivel ≥ 2)
-- El alcance FILTRA filas (vacío, no error). Las políticas interinas de la fase
-- 2 (lectura_admin, lectura_sesion) y de la fase 0 (solo_admin, documentos_admin)
-- se retiran. Las 9 vistas del Portal pasan a security_invoker.

${AYUDANTES_SQL}
-- 2 · Políticas interinas fuera.
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
            where schemaname in ('public', 'interno') and policyname in ('lectura_admin', 'lectura_sesion', 'solo_admin', 'documentos_admin', 'acceso_demo')
  loop execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename); end loop;
end $$;

-- 3 · Políticas por tabla.
${politicasSQL()}

${BUCKET_SQL}
-- 5 · Las 9 vistas del Portal corren con los permisos del trabajador.
${VISTAS_PORTAL.map((v) => `alter view public.${v} set (security_invoker = on);`).join("\n")}
`;

const TABLAS = Object.keys(MATRIZ);
export const MIGRACION = `-- supabase/migraciones/${FECHA}-fase4-rls.sql
-- Corrección de seguridad · FASE 4 — RLS POR ROL. GENERADA por scripts/fase4-generar.mjs.
-- UNA transacción. Reversión: supabase/respaldos/${FECHA}-fase4-reversion.sql
-- (ensayo: scripts/ensayar-fase4.mjs). Requiere las fases 3a, 3b y 3c aplicadas.
-- Sin cambios en el cliente. Cambio de comportamiento esperado: cada
-- administrador ve solo las filas de los módulos y razones sociales de su
-- categoría; el Portal solo muestra comunicados dirigidos al trabajador.

begin;
set local search_path = public, interno, extensions;

-- 0 · Precondición.
do $$
declare n int;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'activos' and column_name = 'clave_gestor') then
    raise exception 'fase4: se esperaba la fase 3c aplicada'; end if;
  if to_regclass('interno.respaldo_fase4') is not null then raise exception 'fase4: interno.respaldo_fase4 ya existe (¿fase 4 aplicada?)'; end if;
  select count(*) into n from pg_policies where schemaname in ('public', 'interno') and policyname = 'lectura_admin';
  if n < 30 then raise exception 'fase4: se esperaban las políticas interinas de la fase 2 (lectura_admin), hay %', n; end if;
end $$;

-- 1 · Respaldo de TODAS las políticas vigentes (public, interno, storage) y de las opciones de las vistas del Portal.
create table interno.respaldo_fase4 (esquema text, tabla text, politica text, permisiva text, roles text[], cmd text, qual text, with_check text, primary key (esquema, tabla, politica));
revoke all on table interno.respaldo_fase4 from public, anon, authenticated;
insert into interno.respaldo_fase4 select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies where schemaname in ('public', 'interno', 'storage');

${RLS_SQL}
-- 6 · Verificación embebida (falla → rollback de toda la transacción).
do $$
declare n int; l text;
begin
  select count(*) into n from pg_policies where schemaname in ('public', 'interno', 'storage') and (qual = 'true' or with_check = 'true');
  if n > 0 then raise exception 'fase4: % políticas con condición true', n; end if;
  select count(*) into n from pg_policies where schemaname in ('public', 'interno') and policyname in ('lectura_admin', 'lectura_sesion', 'solo_admin', 'documentos_admin', 'acceso_demo');
  if n > 0 then raise exception 'fase4: quedan % políticas interinas', n; end if;
  select string_agg(s.nspname || '.' || c.relname, ',' order by 1) into l
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname in ('public', 'interno') and c.relkind = 'r' and c.relname not like 'respaldo_%'
     and not c.relrowsecurity;
  if l is not null then raise exception 'fase4: tablas sin RLS: %', l; end if;
  select string_agg(s.nspname || '.' || c.relname, ',' order by 1) into l
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname in ('public', 'interno') and c.relkind = 'r' and c.relname not like 'respaldo_%'
     and not exists (select 1 from pg_policies p where p.schemaname = s.nspname and p.tablename = c.relname)
     and (s.nspname || '.' || c.relname) not in (${SIN_POLITICA.map((t) => `'${t}'`).join(", ")});
  if l is not null then raise exception 'fase4: tablas con RLS y sin ninguna política (fuera de la lista «nadie»): %', l; end if;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'v' and 'security_invoker=on' = any(coalesce(c.reloptions, '{}'));
  if n <> 47 then raise exception 'fase4: % vistas con security_invoker, esperadas 47', n; end if;
  select count(*) into n from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in (${POLITICAS_BUCKET.map((p) => `'${p}'`).join(", ")});
  if n <> 3 then raise exception 'fase4: % políticas del bucket, esperadas 3', n; end if;
  select count(*) into n from unnest(array[${AYUDANTES.map((f) => `'${f}'`).join(", ")}]) f
   where not has_function_privilege('authenticated', ('public.' || f)::regprocedure, 'execute') or has_function_privilege('anon', ('public.' || f)::regprocedure, 'execute');
  if n <> 0 then raise exception 'fase4: % ayudantes con permisos incorrectos', n; end if;
  -- Comportamiento: sin identidad, nada en ninguna vista.
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"nadie@ejemplo.invalido","sub":"00000000-0000-0000-0000-000000000000"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.v_personal; if n <> 0 then execute 'reset role'; raise exception 'fase4: v_personal % filas sin identidad', n; end if;
  select count(*) into n from public.v_portal_perfil; if n <> 0 then execute 'reset role'; raise exception 'fase4: v_portal_perfil % filas sin identidad', n; end if;
  select count(*) into n from public.v_mi_acceso; if n <> 0 then execute 'reset role'; raise exception 'fase4: v_mi_acceso % filas sin identidad', n; end if;
  select count(*) into n from public.empresas; if n <> 0 then execute 'reset role'; raise exception 'fase4: empresas % filas sin identidad', n; end if;
  execute 'reset role';
end $$;
commit;
`;

export const REVERSION = `-- supabase/respaldos/${FECHA}-fase4-reversion.sql
-- Reversión completa de la FASE 4 (GENERADA por scripts/fase4-generar.mjs):
-- quita las políticas nuevas, recrea EXACTAMENTE las anteriores desde
-- interno.respaldo_fase4, devuelve las 9 vistas del Portal a dueño y retira
-- los ayudantes.
begin;
set local search_path = public, interno, extensions;

do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
            where (schemaname in ('public', 'interno') and policyname in (${POLITICAS_NUEVAS.map((p) => `'${p}'`).join(", ")}))
               or (schemaname = 'storage' and policyname in (${POLITICAS_BUCKET.map((p) => `'${p}'`).join(", ")}))
  loop execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename); end loop;
  for r in select * from interno.respaldo_fase4 loop
    execute format('create policy %I on %I.%I as %s for %s to %s %s %s',
      r.politica, r.esquema, r.tabla, r.permisiva, r.cmd,
      array_to_string(r.roles, ', '),
      case when r.qual is not null then 'using (' || r.qual || ')' else '' end,
      case when r.with_check is not null then 'with check (' || r.with_check || ')' else '' end);
  end loop;
end $$;
${VISTAS_PORTAL.map((v) => `alter view public.${v} reset (security_invoker);`).join("\n")}
drop function if exists ${AYUDANTES.map((f) => `public.${f}`).join(", ")};
revoke execute on function correo_llamador() from authenticated;
drop table interno.respaldo_fase4;

do $$
declare n int;
begin
  select count(*) into n from pg_policies where schemaname in ('public', 'interno') and policyname = 'lectura_admin';
  if n < 30 then raise exception 'reversión fase4: no volvieron las políticas interinas (%)', n; end if;
  select count(*) into n from pg_policies where schemaname in ('public', 'interno') and policyname in (${POLITICAS_NUEVAS.map((p) => `'${p}'`).join(", ")});
  if n > 0 then raise exception 'reversión fase4: quedan % políticas nuevas', n; end if;
end $$;
commit;
`;

export const ESPEJO = `-- @@FASE4-INICIO@@ (generado por scripts/fase4-generar.mjs; no editar a mano)
-- 12 · Fase 4: RLS por rol (ver supabase/rls.sql).
${RLS_SQL}
-- @@FASE4-FIN@@`;

// Quita la fase 4 y todas las posteriores: el ensayo parte del estado de la 3c.
export const sinFase4 = (texto) => texto.replace(/-- @@FASE[4-9][A-Z]?-INICIO@@[\s\S]*?-- @@FASE[4-9][A-Z]?-FIN@@\n?/g, "");

const esPrincipal = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esPrincipal) {
  writeFileSync("supabase/rls.sql", RLS_SQL);
  writeFileSync(`supabase/migraciones/${FECHA}-fase4-rls.sql`, MIGRACION);
  writeFileSync(`supabase/respaldos/${FECHA}-fase4-reversion.sql`, REVERSION);
  const ruta = "supabase/seguridad.sql";
  // El generador solo reemplaza SU bloque; los posteriores se conservan.
  const actual = readFileSync(ruta, "utf8");
  const propio = /-- @@FASE4-INICIO@@[\s\S]*?-- @@FASE4-FIN@@\n?/;
  writeFileSync(ruta, propio.test(actual) ? actual.replace(propio, () => `${ESPEJO}\n`) : `${actual.replace(/\s+$/, "")}\n\n${ESPEJO}\n`);
  const n = Object.values(MATRIZ).reduce((a, m) => a + (m.adm ? 1 : 0) + (m.trab ? 1 : 0) + (m.escr ? 1 : 0) + (m.sesion ? 1 : 0), 0);
  console.log(`Generados: rls.sql (${TABLAS.length} tablas, ${n} políticas, ${AYUDANTES.length} ayudantes), migración, reversión y bloque @@FASE4@@.`);
}
