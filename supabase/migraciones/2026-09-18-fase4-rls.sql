-- supabase/migraciones/2026-09-18-fase4-rls.sql
-- Corrección de seguridad · FASE 4 — RLS POR ROL. GENERADA por scripts/fase4-generar.mjs.
-- UNA transacción. Reversión: supabase/respaldos/2026-09-18-fase4-reversion.sql
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

-- supabase/rls.sql — Corrección de seguridad · FASE 4 (2026-09-18): RLS POR ROL.
-- GENERADO por scripts/fase4-generar.mjs (la matriz vive ahí; no editar a mano).
-- Lo embeben la migración migraciones/2026-09-18-fase4-rls.sql y el bloque
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

-- 1 · Ayudantes de alcance (SECURITY DEFINER, STABLE, search_path fijo). Los
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
revoke all on function fn_alcance_empresa(text), fn_alcance_persona(text), fn_alcance_vinculo(bigint), fn_alcance_documento(bigint), fn_alcance_memorandum(text), fn_alcance_activo(text), fn_alcance_solicitud(bigint), fn_es_mi_dni(text), fn_mi_vinculo(bigint), fn_mi_solicitud(bigint), fn_comunicado_me_alcanza(bigint), fn_mi_sede(text), fn_mi_perfil(text, integer), fn_dni_auditoria(jsonb, jsonb) from public, anon;
grant execute on function fn_alcance_empresa(text), fn_alcance_persona(text), fn_alcance_vinculo(bigint), fn_alcance_documento(bigint), fn_alcance_memorandum(text), fn_alcance_activo(text), fn_alcance_solicitud(bigint), fn_es_mi_dni(text), fn_mi_vinculo(bigint), fn_mi_solicitud(bigint), fn_comunicado_me_alcanza(bigint), fn_mi_sede(text), fn_mi_perfil(text, integer), fn_dni_auditoria(jsonb, jsonb) to authenticated, service_role;
-- Las políticas se evalúan como el rol que consulta: authenticated necesita
-- poder llamar a correo_llamador() (devuelve solo su propio correo).
grant execute on function correo_llamador() to authenticated;

-- 2 · Políticas interinas fuera.
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
            where schemaname in ('public', 'interno') and policyname in ('lectura_admin', 'lectura_sesion', 'solo_admin', 'documentos_admin', 'acceso_demo')
  loop execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename); end loop;
end $$;

-- 3 · Políticas por tabla.
-- public.personas
drop policy if exists adm_lectura on public.personas;
drop policy if exists adm_escritura on public.personas;
drop policy if exists propio on public.personas;
drop policy if exists sesion on public.personas;
create policy adm_lectura on public.personas for select to authenticated using ((select public.es_admin()) and (public.fn_alcance_persona(dni) or dni = (select public.fn_persona_llamador())));
create policy propio on public.personas for select to authenticated using (public.fn_es_mi_dni(dni));
-- public.vinculos
drop policy if exists adm_lectura on public.vinculos;
drop policy if exists adm_escritura on public.vinculos;
drop policy if exists propio on public.vinculos;
drop policy if exists sesion on public.vinculos;
create policy adm_lectura on public.vinculos for select to authenticated using ((select public.es_admin()) and public.fn_alcance_empresa(empresa_id));
create policy propio on public.vinculos for select to authenticated using (public.fn_es_mi_dni(persona_dni));
-- public.cuentas_portal
drop policy if exists adm_lectura on public.cuentas_portal;
drop policy if exists adm_escritura on public.cuentas_portal;
drop policy if exists propio on public.cuentas_portal;
drop policy if exists sesion on public.cuentas_portal;
create policy adm_lectura on public.cuentas_portal for select to authenticated using ((select public.nivel_en('personal')) >= 1 and public.fn_alcance_persona(dni));
create policy propio on public.cuentas_portal for select to authenticated using (public.fn_es_mi_dni(dni));
-- public.consentimientos
drop policy if exists adm_lectura on public.consentimientos;
drop policy if exists adm_escritura on public.consentimientos;
drop policy if exists propio on public.consentimientos;
drop policy if exists sesion on public.consentimientos;
create policy adm_lectura on public.consentimientos for select to authenticated using ((select public.nivel_en('personal')) >= 1 and public.fn_alcance_persona(dni));
create policy propio on public.consentimientos for select to authenticated using (public.fn_es_mi_dni(dni));
-- public.solicitudes_cambio_cuenta
drop policy if exists adm_lectura on public.solicitudes_cambio_cuenta;
drop policy if exists adm_escritura on public.solicitudes_cambio_cuenta;
drop policy if exists propio on public.solicitudes_cambio_cuenta;
drop policy if exists sesion on public.solicitudes_cambio_cuenta;
create policy adm_lectura on public.solicitudes_cambio_cuenta for select to authenticated using ((select public.nivel_en('personal')) >= 1 and public.fn_alcance_persona(dni));
create policy propio on public.solicitudes_cambio_cuenta for select to authenticated using (public.fn_es_mi_dni(dni));
-- public.movimientos
drop policy if exists adm_lectura on public.movimientos;
drop policy if exists adm_escritura on public.movimientos;
drop policy if exists propio on public.movimientos;
drop policy if exists sesion on public.movimientos;
create policy adm_lectura on public.movimientos for select to authenticated using ((select public.nivel_en('personal')) >= 1 and public.fn_alcance_persona(persona_dni));
-- public.epp_entregas
drop policy if exists adm_lectura on public.epp_entregas;
drop policy if exists adm_escritura on public.epp_entregas;
drop policy if exists propio on public.epp_entregas;
drop policy if exists sesion on public.epp_entregas;
create policy adm_lectura on public.epp_entregas for select to authenticated using ((select public.nivel_en('personal')) >= 1 and public.fn_alcance_persona(dni));
-- public.horarios_entrada
drop policy if exists adm_lectura on public.horarios_entrada;
drop policy if exists adm_escritura on public.horarios_entrada;
drop policy if exists propio on public.horarios_entrada;
drop policy if exists sesion on public.horarios_entrada;
create policy adm_lectura on public.horarios_entrada for select to authenticated using ((select public.nivel_en('asistencia')) >= 1 and public.fn_alcance_persona(persona_dni));
-- interno.datos_bancarios
drop policy if exists adm_lectura on interno.datos_bancarios;
drop policy if exists adm_escritura on interno.datos_bancarios;
drop policy if exists propio on interno.datos_bancarios;
drop policy if exists sesion on interno.datos_bancarios;
create policy adm_lectura on interno.datos_bancarios for select to authenticated using ((select public.nivel_en('personal')) >= 1 and public.fn_alcance_persona(dni));
create policy propio on interno.datos_bancarios for select to authenticated using (public.fn_es_mi_dni(dni));
-- public.documentos
drop policy if exists adm_lectura on public.documentos;
drop policy if exists adm_escritura on public.documentos;
drop policy if exists propio on public.documentos;
drop policy if exists sesion on public.documentos;
create policy adm_lectura on public.documentos for select to authenticated using ((select public.nivel_en('boletas')) >= 1 and public.fn_alcance_vinculo(vinculo_id));
create policy propio on public.documentos for select to authenticated using (public.fn_mi_vinculo(vinculo_id));
create policy adm_escritura on public.documentos for all to authenticated using ((select public.nivel_en('boletas')) >= 2 and public.fn_alcance_vinculo(vinculo_id)) with check ((select public.nivel_en('boletas')) >= 2 and public.fn_alcance_vinculo(vinculo_id));
-- public.lotes
drop policy if exists adm_lectura on public.lotes;
drop policy if exists adm_escritura on public.lotes;
drop policy if exists propio on public.lotes;
drop policy if exists sesion on public.lotes;
create policy adm_lectura on public.lotes for select to authenticated using ((select public.nivel_en('boletas')) >= 1 and public.fn_alcance_empresa(empresa_id));
-- public.notificaciones_documento
drop policy if exists adm_lectura on public.notificaciones_documento;
drop policy if exists adm_escritura on public.notificaciones_documento;
drop policy if exists propio on public.notificaciones_documento;
drop policy if exists sesion on public.notificaciones_documento;
create policy adm_lectura on public.notificaciones_documento for select to authenticated using ((select public.nivel_en('boletas')) >= 1 and public.fn_alcance_documento(documento_id));
-- public.plantillas
drop policy if exists adm_lectura on public.plantillas;
drop policy if exists adm_escritura on public.plantillas;
drop policy if exists propio on public.plantillas;
drop policy if exists sesion on public.plantillas;
create policy adm_lectura on public.plantillas for select to authenticated using ((select public.nivel_en('boletas')) >= 1 and public.fn_alcance_empresa(empresa_id));
create policy adm_escritura on public.plantillas for all to authenticated using ((select public.nivel_en('boletas')) >= 2 and public.fn_alcance_empresa(empresa_id)) with check ((select public.nivel_en('boletas')) >= 2 and public.fn_alcance_empresa(empresa_id));
-- public.acuses
drop policy if exists adm_lectura on public.acuses;
drop policy if exists adm_escritura on public.acuses;
drop policy if exists propio on public.acuses;
drop policy if exists sesion on public.acuses;
create policy adm_lectura on public.acuses for select to authenticated using ((select public.nivel_en('acuses')) >= 1 and public.fn_alcance_documento(documento_id));
create policy propio on public.acuses for select to authenticated using (public.fn_es_mi_dni(dni_check));
-- public.comunicados
drop policy if exists adm_lectura on public.comunicados;
drop policy if exists adm_escritura on public.comunicados;
drop policy if exists propio on public.comunicados;
drop policy if exists sesion on public.comunicados;
create policy adm_lectura on public.comunicados for select to authenticated using ((select public.nivel_en('comunicados')) >= 1 and public.fn_alcance_empresa(empresa_id));
create policy propio on public.comunicados for select to authenticated using (public.fn_comunicado_me_alcanza(id));
-- public.comunicado_lecturas
drop policy if exists adm_lectura on public.comunicado_lecturas;
drop policy if exists adm_escritura on public.comunicado_lecturas;
drop policy if exists propio on public.comunicado_lecturas;
drop policy if exists sesion on public.comunicado_lecturas;
create policy adm_lectura on public.comunicado_lecturas for select to authenticated using ((select public.nivel_en('comunicados')) >= 1 and public.fn_alcance_persona(dni));
create policy propio on public.comunicado_lecturas for select to authenticated using (public.fn_es_mi_dni(dni));
-- public.memorandums
drop policy if exists adm_lectura on public.memorandums;
drop policy if exists adm_escritura on public.memorandums;
drop policy if exists propio on public.memorandums;
drop policy if exists sesion on public.memorandums;
create policy adm_lectura on public.memorandums for select to authenticated using ((select public.nivel_en('memorandums')) >= 1 and public.fn_alcance_vinculo(vinculo_id));
-- public.descargos
drop policy if exists adm_lectura on public.descargos;
drop policy if exists adm_escritura on public.descargos;
drop policy if exists propio on public.descargos;
drop policy if exists sesion on public.descargos;
create policy adm_lectura on public.descargos for select to authenticated using ((select public.nivel_en('memorandums')) >= 1 and public.fn_alcance_memorandum(memorandum_id));
-- public.tipos_sancion
drop policy if exists adm_lectura on public.tipos_sancion;
drop policy if exists adm_escritura on public.tipos_sancion;
drop policy if exists propio on public.tipos_sancion;
drop policy if exists sesion on public.tipos_sancion;
create policy adm_lectura on public.tipos_sancion for select to authenticated using ((select public.es_admin()));
-- public.rit_faltas
drop policy if exists adm_lectura on public.rit_faltas;
drop policy if exists adm_escritura on public.rit_faltas;
drop policy if exists propio on public.rit_faltas;
drop policy if exists sesion on public.rit_faltas;
create policy adm_lectura on public.rit_faltas for select to authenticated using ((select public.es_admin()));
-- public.rits
drop policy if exists adm_lectura on public.rits;
drop policy if exists adm_escritura on public.rits;
drop policy if exists propio on public.rits;
drop policy if exists sesion on public.rits;
create policy adm_lectura on public.rits for select to authenticated using ((select public.es_admin()));
create policy propio on public.rits for select to authenticated using ((select public.portal_dni()) is not null);
-- public.contratos
drop policy if exists adm_lectura on public.contratos;
drop policy if exists adm_escritura on public.contratos;
drop policy if exists propio on public.contratos;
drop policy if exists sesion on public.contratos;
create policy adm_lectura on public.contratos for select to authenticated using ((select public.nivel_en('contratos')) >= 1 and public.fn_alcance_vinculo(vinculo_id));
-- public.tardanzas
drop policy if exists adm_lectura on public.tardanzas;
drop policy if exists adm_escritura on public.tardanzas;
drop policy if exists propio on public.tardanzas;
drop policy if exists sesion on public.tardanzas;
create policy adm_lectura on public.tardanzas for select to authenticated using ((select public.nivel_en('tardanzas')) >= 1 and public.fn_alcance_persona(dni));
create policy propio on public.tardanzas for select to authenticated using (public.fn_es_mi_dni(dni));
create policy adm_escritura on public.tardanzas for all to authenticated using ((select public.nivel_en('tardanzas')) >= 2 and public.fn_alcance_persona(dni)) with check ((select public.nivel_en('tardanzas')) >= 2 and public.fn_alcance_persona(dni));
-- public.marcaciones
drop policy if exists adm_lectura on public.marcaciones;
drop policy if exists adm_escritura on public.marcaciones;
drop policy if exists propio on public.marcaciones;
drop policy if exists sesion on public.marcaciones;
create policy adm_lectura on public.marcaciones for select to authenticated using ((select public.nivel_en('asistencia')) >= 1 and public.fn_alcance_empresa(empresa_id));
-- public.asistencia_lotes
drop policy if exists adm_lectura on public.asistencia_lotes;
drop policy if exists adm_escritura on public.asistencia_lotes;
drop policy if exists propio on public.asistencia_lotes;
drop policy if exists sesion on public.asistencia_lotes;
create policy adm_lectura on public.asistencia_lotes for select to authenticated using ((select public.nivel_en('asistencia')) >= 1 and public.fn_alcance_empresa(empresa_id));
-- public.asistencia_config
drop policy if exists adm_lectura on public.asistencia_config;
drop policy if exists adm_escritura on public.asistencia_config;
drop policy if exists propio on public.asistencia_config;
drop policy if exists sesion on public.asistencia_config;
create policy adm_lectura on public.asistencia_config for select to authenticated using ((select public.nivel_en('asistencia')) >= 1);
create policy adm_escritura on public.asistencia_config for all to authenticated using ((select public.nivel_en('asistencia')) >= 2) with check ((select public.nivel_en('asistencia')) >= 2);
-- public.feriados
drop policy if exists adm_lectura on public.feriados;
drop policy if exists adm_escritura on public.feriados;
drop policy if exists propio on public.feriados;
drop policy if exists sesion on public.feriados;
create policy adm_lectura on public.feriados for select to authenticated using ((select public.es_admin()));
-- public.activos
drop policy if exists adm_lectura on public.activos;
drop policy if exists adm_escritura on public.activos;
drop policy if exists propio on public.activos;
drop policy if exists sesion on public.activos;
create policy adm_lectura on public.activos for select to authenticated using ((select public.nivel_en('activos')) >= 1 and public.fn_alcance_empresa(empresa_id));
-- public.asignaciones
drop policy if exists adm_lectura on public.asignaciones;
drop policy if exists adm_escritura on public.asignaciones;
drop policy if exists propio on public.asignaciones;
drop policy if exists sesion on public.asignaciones;
create policy adm_lectura on public.asignaciones for select to authenticated using ((select public.nivel_en('activos')) >= 1 and public.fn_alcance_activo(activo_codigo));
-- public.lineas
drop policy if exists adm_lectura on public.lineas;
drop policy if exists adm_escritura on public.lineas;
drop policy if exists propio on public.lineas;
drop policy if exists sesion on public.lineas;
create policy adm_lectura on public.lineas for select to authenticated using ((select public.nivel_en('activos')) >= 1);
create policy adm_escritura on public.lineas for all to authenticated using ((select public.nivel_en('activos')) >= 2) with check ((select public.nivel_en('activos')) >= 2);
-- public.tickets
drop policy if exists adm_lectura on public.tickets;
drop policy if exists adm_escritura on public.tickets;
drop policy if exists propio on public.tickets;
drop policy if exists sesion on public.tickets;
create policy adm_lectura on public.tickets for select to authenticated using ((select public.nivel_en('soporte')) >= 1 and public.fn_alcance_empresa(empresa_id));
create policy propio on public.tickets for select to authenticated using (public.fn_es_mi_dni(solicitante_dni));
-- public.ticket_tipos
drop policy if exists adm_lectura on public.ticket_tipos;
drop policy if exists adm_escritura on public.ticket_tipos;
drop policy if exists propio on public.ticket_tipos;
drop policy if exists sesion on public.ticket_tipos;
create policy sesion on public.ticket_tipos for select to authenticated using (((select public.es_admin()) or (select public.portal_dni()) is not null));
-- public.ticket_subtipos
drop policy if exists adm_lectura on public.ticket_subtipos;
drop policy if exists adm_escritura on public.ticket_subtipos;
drop policy if exists propio on public.ticket_subtipos;
drop policy if exists sesion on public.ticket_subtipos;
create policy sesion on public.ticket_subtipos for select to authenticated using (((select public.es_admin()) or (select public.portal_dni()) is not null));
-- public.ticket_avisos
drop policy if exists adm_lectura on public.ticket_avisos;
drop policy if exists adm_escritura on public.ticket_avisos;
drop policy if exists propio on public.ticket_avisos;
drop policy if exists sesion on public.ticket_avisos;
create policy adm_lectura on public.ticket_avisos for select to authenticated using ((select public.nivel_en('soporte')) >= 1);
-- public.solicitudes
drop policy if exists adm_lectura on public.solicitudes;
drop policy if exists adm_escritura on public.solicitudes;
drop policy if exists propio on public.solicitudes;
drop policy if exists sesion on public.solicitudes;
create policy adm_lectura on public.solicitudes for select to authenticated using (((select public.nivel_en('solicitudes')) >= 1 and public.fn_alcance_empresa(empresa_id)) or solicitante_dni = (select public.fn_persona_llamador()));
create policy propio on public.solicitudes for select to authenticated using (public.fn_es_mi_dni(solicitante_dni));
-- public.solicitud_eventos
drop policy if exists adm_lectura on public.solicitud_eventos;
drop policy if exists adm_escritura on public.solicitud_eventos;
drop policy if exists propio on public.solicitud_eventos;
drop policy if exists sesion on public.solicitud_eventos;
create policy adm_lectura on public.solicitud_eventos for select to authenticated using (public.fn_alcance_solicitud(solicitud_id));
create policy propio on public.solicitud_eventos for select to authenticated using (public.fn_mi_solicitud(solicitud_id));
-- public.solicitud_tipos
drop policy if exists adm_lectura on public.solicitud_tipos;
drop policy if exists adm_escritura on public.solicitud_tipos;
drop policy if exists propio on public.solicitud_tipos;
drop policy if exists sesion on public.solicitud_tipos;
create policy sesion on public.solicitud_tipos for select to authenticated using (((select public.es_admin()) or (select public.portal_dni()) is not null));
-- public.solicitud_avisos
drop policy if exists adm_lectura on public.solicitud_avisos;
drop policy if exists adm_escritura on public.solicitud_avisos;
drop policy if exists propio on public.solicitud_avisos;
drop policy if exists sesion on public.solicitud_avisos;
create policy adm_lectura on public.solicitud_avisos for select to authenticated using ((select public.nivel_en('solicitudes')) >= 1);
-- public.empresas
drop policy if exists adm_lectura on public.empresas;
drop policy if exists adm_escritura on public.empresas;
drop policy if exists propio on public.empresas;
drop policy if exists sesion on public.empresas;
create policy adm_lectura on public.empresas for select to authenticated using ((select public.es_admin()));
create policy propio on public.empresas for select to authenticated using ((select public.portal_dni()) is not null);
create policy adm_escritura on public.empresas for all to authenticated using ((select public.nivel_en('configuracion')) >= 2) with check ((select public.nivel_en('configuracion')) >= 2);
-- public.sedes
drop policy if exists adm_lectura on public.sedes;
drop policy if exists adm_escritura on public.sedes;
drop policy if exists propio on public.sedes;
drop policy if exists sesion on public.sedes;
create policy adm_lectura on public.sedes for select to authenticated using ((select public.es_admin()) and public.fn_alcance_empresa(empresa_id));
create policy propio on public.sedes for select to authenticated using (public.fn_mi_sede(id));
-- public.bancos
drop policy if exists adm_lectura on public.bancos;
drop policy if exists adm_escritura on public.bancos;
drop policy if exists propio on public.bancos;
drop policy if exists sesion on public.bancos;
create policy adm_lectura on public.bancos for select to authenticated using ((select public.es_admin()));
-- public.cargos
drop policy if exists adm_lectura on public.cargos;
drop policy if exists adm_escritura on public.cargos;
drop policy if exists propio on public.cargos;
drop policy if exists sesion on public.cargos;
create policy adm_lectura on public.cargos for select to authenticated using ((select public.es_admin()));
-- public.centros_costo
drop policy if exists adm_lectura on public.centros_costo;
drop policy if exists adm_escritura on public.centros_costo;
drop policy if exists propio on public.centros_costo;
drop policy if exists sesion on public.centros_costo;
create policy adm_lectura on public.centros_costo for select to authenticated using ((select public.es_admin()));
-- public.declaraciones
drop policy if exists adm_lectura on public.declaraciones;
drop policy if exists adm_escritura on public.declaraciones;
drop policy if exists propio on public.declaraciones;
drop policy if exists sesion on public.declaraciones;
create policy sesion on public.declaraciones for select to authenticated using (((select public.es_admin()) or (select public.portal_dni()) is not null));
-- interno.usuarios_admin
drop policy if exists adm_lectura on interno.usuarios_admin;
drop policy if exists adm_escritura on interno.usuarios_admin;
drop policy if exists propio on interno.usuarios_admin;
drop policy if exists sesion on interno.usuarios_admin;
create policy adm_lectura on interno.usuarios_admin for select to authenticated using ((select public.nivel_en('accesos')) >= 1 or lower(correo) = (select public.correo_llamador()));
-- interno.perfiles
drop policy if exists adm_lectura on interno.perfiles;
drop policy if exists adm_escritura on interno.perfiles;
drop policy if exists propio on interno.perfiles;
drop policy if exists sesion on interno.perfiles;
create policy adm_lectura on interno.perfiles for select to authenticated using ((select public.nivel_en('accesos')) >= 1 or public.fn_mi_perfil(id, version));
-- interno.perfil_permisos
drop policy if exists adm_lectura on interno.perfil_permisos;
drop policy if exists adm_escritura on interno.perfil_permisos;
drop policy if exists propio on interno.perfil_permisos;
drop policy if exists sesion on interno.perfil_permisos;
create policy adm_lectura on interno.perfil_permisos for select to authenticated using ((select public.nivel_en('accesos')) >= 1 or public.fn_mi_perfil(perfil_id, perfil_version));
-- interno.perfil_empresas
drop policy if exists adm_lectura on interno.perfil_empresas;
drop policy if exists adm_escritura on interno.perfil_empresas;
drop policy if exists propio on interno.perfil_empresas;
drop policy if exists sesion on interno.perfil_empresas;
create policy adm_lectura on interno.perfil_empresas for select to authenticated using ((select public.nivel_en('accesos')) >= 1 or public.fn_mi_perfil(perfil_id, version));
-- interno.perfil_propuestas
drop policy if exists adm_lectura on interno.perfil_propuestas;
drop policy if exists adm_escritura on interno.perfil_propuestas;
drop policy if exists propio on interno.perfil_propuestas;
drop policy if exists sesion on interno.perfil_propuestas;
create policy adm_lectura on interno.perfil_propuestas for select to authenticated using ((select public.nivel_en('accesos')) >= 1);
-- interno.cargo_perfiles
drop policy if exists adm_lectura on interno.cargo_perfiles;
drop policy if exists adm_escritura on interno.cargo_perfiles;
drop policy if exists propio on interno.cargo_perfiles;
drop policy if exists sesion on interno.cargo_perfiles;
create policy adm_lectura on interno.cargo_perfiles for select to authenticated using ((select public.nivel_en('accesos')) >= 1);
-- interno.registro_accesos
drop policy if exists adm_lectura on interno.registro_accesos;
drop policy if exists adm_escritura on interno.registro_accesos;
drop policy if exists propio on interno.registro_accesos;
drop policy if exists sesion on interno.registro_accesos;
create policy adm_lectura on interno.registro_accesos for select to authenticated using ((select public.nivel_en('auditoria')) >= 1 or (select public.nivel_en('accesos')) >= 1);
-- interno.politica_acceso
drop policy if exists adm_lectura on interno.politica_acceso;
drop policy if exists adm_escritura on interno.politica_acceso;
drop policy if exists propio on interno.politica_acceso;
drop policy if exists sesion on interno.politica_acceso;
create policy adm_lectura on interno.politica_acceso for select to authenticated using ((select public.es_admin()));
-- interno.auditoria
drop policy if exists adm_lectura on interno.auditoria;
drop policy if exists adm_escritura on interno.auditoria;
drop policy if exists propio on interno.auditoria;
drop policy if exists sesion on interno.auditoria;
create policy adm_lectura on interno.auditoria for select to authenticated using ((select public.nivel_en('auditoria')) >= 1 or ((select public.nivel_en('personal')) >= 1 and public.fn_alcance_persona(public.fn_dni_auditoria(datos_antes, datos_despues))));

-- 4 · Bucket «documentos»: conocer la ruta no basta. Lectura y escritura por
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

-- 5 · Las 9 vistas del Portal corren con los permisos del trabajador.
alter view public.v_portal_boletas set (security_invoker = on);
alter view public.v_portal_comunicados set (security_invoker = on);
alter view public.v_portal_datos set (security_invoker = on);
alter view public.v_portal_mes set (security_invoker = on);
alter view public.v_portal_pendientes set (security_invoker = on);
alter view public.v_portal_perfil set (security_invoker = on);
alter view public.v_portal_rit set (security_invoker = on);
alter view public.v_portal_solicitudes set (security_invoker = on);
alter view public.v_portal_tickets set (security_invoker = on);

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
     and (s.nspname || '.' || c.relname) not in ('public.correo_envios', 'public.solicitud_correlativos', 'interno.correo_tokens');
  if l is not null then raise exception 'fase4: tablas con RLS y sin ninguna política (fuera de la lista «nadie»): %', l; end if;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'v' and 'security_invoker=on' = any(coalesce(c.reloptions, '{}'));
  if n <> 47 then raise exception 'fase4: % vistas con security_invoker, esperadas 47', n; end if;
  select count(*) into n from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('documentos_leer', 'documentos_subir', 'documentos_actualizar');
  if n <> 3 then raise exception 'fase4: % políticas del bucket, esperadas 3', n; end if;
  select count(*) into n from unnest(array['fn_alcance_empresa(text)', 'fn_alcance_persona(text)', 'fn_alcance_vinculo(bigint)', 'fn_alcance_documento(bigint)', 'fn_alcance_memorandum(text)', 'fn_alcance_activo(text)', 'fn_alcance_solicitud(bigint)', 'fn_es_mi_dni(text)', 'fn_mi_vinculo(bigint)', 'fn_mi_solicitud(bigint)', 'fn_comunicado_me_alcanza(bigint)', 'fn_mi_sede(text)', 'fn_mi_perfil(text, integer)', 'fn_dni_auditoria(jsonb, jsonb)']) f
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
