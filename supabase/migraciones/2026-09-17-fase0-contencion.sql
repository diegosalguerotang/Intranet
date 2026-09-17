-- supabase/migraciones/2026-09-17-fase0-contencion.sql
-- Corrección de seguridad · FASE 0 — CONTENCIÓN (prompt de Diego con decisiones
-- cerradas el 2026-09-17; estado real medido en
-- docs/seguridad/2026-09-17-paso0-resultados.md).
--
-- UNA transacción. Reversión escrita y ensayada en Postgres local:
--   supabase/respaldos/2026-09-17-fase0-reversion.sql   (ensayo: scripts/ensayar-fase0.mjs)
-- Aplicar FUERA DE HORARIO (node scripts/aplicar-sql.mjs <este archivo>) y
-- verificar después con scripts/verificar-fase0.mjs.
--
-- EFECTO VISIBLE mientras dure la fase 0 (hasta que la fase 1 ponga guarda):
-- las 29 RPC administrativas que hoy no verifican al llamador quedan
-- INOPERATIVAS para todos, administradores incluidos: crear/editar/suspender/
-- reactivar/eliminar usuarios administrativos, reenviar clave, guardar
-- categorías y política de acceso, alta y baja de trabajador, publicar
-- boletas/comunicados, EPP, activos TI (importar, asignar, devolver, editar,
-- crear sede), resolver/notificar memorándums, previsualizar asistencia.
-- Todo falla cerrado: un módulo que deja de funcionar se detecta en minutos;
-- un permiso abierto no se detecta nunca.
--
-- Qué hace:
--  1. Revoca EXECUTE a authenticated, anon y PUBLIC en TODAS las funciones de public.
--  2. Re-otorga SOLO 62 funciones (lista del paso 0, no una suposición):
--     4 pre-login (anon + authenticated), 56 que verifican al llamador y 2 que
--     las vistas necesitan (fn_hora_entrada en v_personal/v_asistencia_mensual,
--     portal_modo en v_portal_perfil): PostgreSQL comprueba el EXECUTE de una
--     función usada por una vista contra quien CONSULTA la vista, no contra su
--     dueño. service_role no se toca (las funciones serverless siguen igual).
--  2c. portal_dni() y portal_modo() pasan a SECURITY DEFINER (search_path fijo):
--     eran invoker y, sin acceso_demo, las vistas v_portal_* quedarían vacías.
--  3. Elimina la política acceso_demo (using true / with check true) de las 31 tablas.
--  4. Activa RLS en las 22 tablas que no la tenían: sin política = cerrado.
--  5. lineas — única tabla base que el BackOffice escribe directo (Telefonía):
--     política solo_admin con es_admin_activo(), el mismo modelo que documentos.
--  6. correo_envios — rastro y límite de tasa del endpoint api/enviar-correo.js.
--     Solo service_role la ve.
--  7. Verificación embebida: si algo no cuadra, la transacción NO se aplica.
--
-- NO hace (fase 1): guardas nuevas, default privileges de funciones nuevas,
-- vistas security_invoker, políticas por rol, esquema privado.

begin;
set local search_path = public, extensions;

-- 0 · Precondición: la base debe seguir como la foto del paso 0. Si cambió,
--     hay que regenerar el paso 0 (scripts/paso0-seguridad.mjs) y revisar.
do $$
declare n_fn int; n_pol int; n_anon int;
begin
  select count(*) into n_fn from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prorettype <> 'trigger'::regtype
     and has_function_privilege('authenticated', p.oid, 'execute');
  select count(*) into n_anon from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
  select count(*) into n_pol from pg_policies where schemaname = 'public' and policyname = 'acceso_demo';
  if n_fn <> 106 or n_anon <> 4 or n_pol <> 31 then
    raise exception 'fase0: la base no coincide con la foto del paso 0 (authenticated=% de 106, anon=% de 4, acceso_demo=% de 31). Regenerar el paso 0 antes de aplicar.', n_fn, n_anon, n_pol;
  end if;
end $$;

-- 1 · Revocar EXECUTE en todas las funciones de public (authenticated, anon y PUBLIC).
revoke execute on all functions in schema public from authenticated, anon, public;

-- 2a · Pre-login (por diseño sin sesión): anon + authenticated.
grant execute on function
  verificar_bloqueo(p_correo text),
  registrar_ingreso(p_correo text, p_resultado text, p_dispositivo text),
  portal_verificar_bloqueo(p_dni text),
  portal_registrar_ingreso(p_dni text, p_resultado text, p_dispositivo text)
to anon, authenticated;

-- 2b · Con verificación del llamador (56) + dependencias de vistas (2).
grant execute on function
  actualizar_ticket(p_id bigint, p_estado text, p_atendido_por text, p_nota text, p_por text),
  alternar_ticket_subtipo(p_id integer, p_activo boolean),
  alternar_ticket_tipo(p_id integer, p_activo boolean),
  asignar_rit_sede(p_sede text, p_rit text),
  crear_activo(p_codigo text, p_categoria text, p_empresa text, p_tipo text, p_marca text, p_modelo text, p_serie text, p_imei text, p_valor numeric, p_compra date, p_observaciones text),
  crear_rit(p_nombre text, p_archivo text, p_hash text, p_vigente date),
  crear_solicitud_admin(p_dni text, p_tipo text, p_datos jsonb, p_por text),
  crear_solicitud_propia(p_tipo text, p_datos jsonb),
  crear_ticket_admin(p_dni text, p_tipo integer, p_subtipo integer, p_comentario text, p_por text),
  decidir_propuesta_perfil(p_id bigint, p_decision text, p_por text),
  editar_trabajador(p_dni text, p_nombre text, p_celular text, p_correo text, p_banco text, p_cuenta text, p_cci text, p_tipo_documento text),
  eliminar_feriado(p_fecha date, p_por text),
  eliminar_sede(p_sede text),
  eliminar_solicitud_aviso(p_id bigint),
  eliminar_ticket_aviso(p_correo text),
  emitir_memorandum(p_dni text, p_tipo_sancion text, p_falta_id bigint, p_motivo text, p_suspension_dias integer, p_por text),
  es_admin_activo(),
  fijar_correo_persona(p_dni text, p_correo text),
  fijar_hora_entrada(p_dni text, p_hora time without time zone, p_desde date, p_por text),
  fn_hora_entrada(p_dni text, p_fecha date),                       -- vista: v_personal, v_asistencia_mensual
  fn_nivel_memorandums(),
  fn_nivel_modulo(p_modulo text),
  fn_persona_llamador(),
  fn_solicitud_insertar(p_dni text, p_tipo text, p_datos jsonb, p_por text),
  fn_ver_cuenta_bancaria(p_dni text),
  guardar_cargo_perfil(p_cargo text, p_destino text, p_perfil text, p_por text),
  guardar_clave_equipo(p_codigo text, p_clave text, p_por text),
  guardar_feriado(p_fecha date, p_nombre text, p_por text),
  guardar_solicitud_aviso(p_tipo text, p_correo text, p_copia boolean, p_activo boolean),
  guardar_ticket_aviso(p_correo text, p_activo boolean),
  guardar_ticket_subtipo(p_id integer, p_tipo integer, p_nombre text),
  guardar_ticket_tipo(p_id integer, p_nombre text),
  importar_asistencia(p_empresa text, p_registros jsonb, p_archivo text, p_resumen jsonb, p_por text),
  importar_control(p_registros jsonb, p_trabajadores jsonb, p_archivo text, p_por text),
  importar_padron(p_filas jsonb, p_por text, p_ceses jsonb),
  importar_planilla_unificada(p_filas jsonb, p_periodo text, p_por text, p_ceses jsonb),
  mi_sesion_backoffice(),
  portal_actualizar_datos(p_celular text, p_direccion text),
  portal_confirmar_lectura(p_comunicado_id bigint, p_dispositivo text),
  portal_confirmar_recepcion(p_documento_id bigint, p_dispositivo text),
  portal_crear_solicitud(p_tipo text, p_datos jsonb),
  portal_crear_ticket(p_tipo integer, p_subtipo integer, p_comentario text),
  portal_dni(),
  portal_marcar_visto(p_comunicado_id bigint),
  portal_mi_sesion(),
  portal_modo(p_dni text),                                          -- vista: v_portal_perfil
  portal_primer_ingreso(p_celular text, p_sin_celular boolean, p_politica_version integer, p_correo text),
  portal_registrar_sesion(p_marker text),
  portal_solicitar_cambio_cuenta(p_motivo text),
  previsualizar_control(p_registros jsonb, p_trabajadores jsonb, p_archivo text),
  previsualizar_padron(p_filas jsonb, p_ceses jsonb),
  previsualizar_planilla_unificada(p_filas jsonb, p_periodo text, p_ceses jsonb),
  publicar_rit(p_archivo_url text, p_hash text, p_titulo text),
  reenviar_solicitud(p_id bigint, p_datos jsonb, p_por text),
  registrar_acuse_asistido(p_dni text, p_lote text, p_motivo text, p_entrega timestamp with time zone, p_adjunto text, p_dispositivo text),
  registrar_sesion_backoffice(p_marker text),
  resolver_solicitud(p_id bigint, p_decision text, p_comentario text, p_por text),
  ver_clave_equipo(p_codigo text, p_por text)
to authenticated;

-- 2c · portal_dni() y portal_modo() nacieron SECURITY INVOKER: dentro de las
--      vistas v_portal_* leen personas/vinculos con los permisos de la SESIÓN
--      (lección del 31-08 con fn_hora_entrada). Sin acceso_demo devolverían
--      vacío y el Portal quedaría ciego. Pasan a SECURITY DEFINER con
--      search_path fijo: son ayudantes de identidad de solo lectura, sin
--      parámetros que permitan leer datos ajenos (portal_dni deriva el DNI del
--      JWT; portal_modo solo clasifica vigencia).
alter function portal_dni() security definer set search_path = public, extensions;
alter function portal_modo(p_dni text) security definer set search_path = public, extensions;

-- 3 · Eliminar acceso_demo donde exista (eliminar, no modificar).
do $$
declare r record;
begin
  for r in select tablename from pg_policies where schemaname = 'public' and policyname = 'acceso_demo'
  loop
    execute format('drop policy acceso_demo on public.%I', r.tablename);
  end loop;
end $$;

-- 4 · RLS activa en TODAS las tablas de public (las 22 sin RLS quedan cerradas).
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', r.relname);
  end loop;
end $$;

-- 5 · lineas: solo administradores activos (el BackOffice la escribe directo).
drop policy if exists solo_admin on lineas;
create policy solo_admin on lineas
  for all to authenticated
  using (public.es_admin_activo())
  with check (public.es_admin_activo());

-- 6 · Rastro del endpoint de correo (límite de tasa y evidencia). Solo service_role.
create table if not exists correo_envios (
  id           bigint generated always as identity primary key,
  creado_en    timestamptz not null default now(),
  accion       text not null,
  ip           text,
  sujeto       text,               -- dni / correo / número de ticket o solicitud / correo del llamador
  destinatario text,
  resultado    text not null check (resultado in ('enviado', 'rechazado', 'limitado', 'error')),
  detalle      text
);
create index if not exists ix_correo_envios_ip on correo_envios (ip, creado_en desc);
create index if not exists ix_correo_envios_sujeto on correo_envios (sujeto, creado_en desc);
alter table correo_envios enable row level security;
revoke all on table correo_envios from anon, authenticated, public;
revoke all on sequence correo_envios_id_seq from anon, authenticated, public;
grant select, insert on table correo_envios to service_role;
grant usage on sequence correo_envios_id_seq to service_role;

-- 7 · Verificación embebida: si algo quedó distinto de lo esperado, no se aplica.
do $$
declare lista text; n int;
  esperadas constant text := 'actualizar_ticket,alternar_ticket_subtipo,alternar_ticket_tipo,asignar_rit_sede,crear_activo,crear_rit,crear_solicitud_admin,crear_solicitud_propia,crear_ticket_admin,decidir_propuesta_perfil,editar_trabajador,eliminar_feriado,eliminar_sede,eliminar_solicitud_aviso,eliminar_ticket_aviso,emitir_memorandum,es_admin_activo,fijar_correo_persona,fijar_hora_entrada,fn_hora_entrada,fn_nivel_memorandums,fn_nivel_modulo,fn_persona_llamador,fn_solicitud_insertar,fn_ver_cuenta_bancaria,guardar_cargo_perfil,guardar_clave_equipo,guardar_feriado,guardar_solicitud_aviso,guardar_ticket_aviso,guardar_ticket_subtipo,guardar_ticket_tipo,importar_asistencia,importar_control,importar_padron,importar_planilla_unificada,mi_sesion_backoffice,portal_actualizar_datos,portal_confirmar_lectura,portal_confirmar_recepcion,portal_crear_solicitud,portal_crear_ticket,portal_dni,portal_marcar_visto,portal_mi_sesion,portal_modo,portal_primer_ingreso,portal_registrar_ingreso,portal_registrar_sesion,portal_solicitar_cambio_cuenta,portal_verificar_bloqueo,previsualizar_control,previsualizar_padron,previsualizar_planilla_unificada,publicar_rit,reenviar_solicitud,registrar_acuse_asistido,registrar_ingreso,registrar_sesion_backoffice,resolver_solicitud,ver_clave_equipo,verificar_bloqueo';
begin
  select string_agg(p.proname, ',' order by p.proname) into lista
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
  if lista is distinct from 'portal_registrar_ingreso,portal_verificar_bloqueo,registrar_ingreso,verificar_bloqueo' then
    raise exception 'fase0: funciones ejecutables por anon = %', coalesce(lista, '(ninguna)');
  end if;
  select string_agg(distinct p.proname, ',' order by p.proname) into lista
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute');
  if lista is distinct from esperadas then
    raise exception 'fase0: la lista de funciones ejecutables por authenticated no es la esperada: %', coalesce(lista, '(ninguna)');
  end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute');
  if n <> 62 then raise exception 'fase0: % firmas ejecutables por authenticated, esperadas 62', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and policyname = 'acceso_demo';
  if n > 0 then raise exception 'fase0: siguen % políticas acceso_demo', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and (qual = 'true' or with_check = 'true');
  if n > 0 then raise exception 'fase0: % políticas con condición true', n; end if;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if n > 0 then raise exception 'fase0: % tablas de public sin RLS', n; end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'lineas' and policyname = 'solo_admin') then
    raise exception 'fase0: falta la política solo_admin en lineas';
  end if;
  if has_table_privilege('authenticated', 'public.correo_envios', 'select')
     or has_table_privilege('anon', 'public.correo_envios', 'select') then
    raise exception 'fase0: correo_envios es legible por anon/authenticated';
  end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('portal_dni', 'portal_modo') and p.prosecdef
     and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%');
  if n <> 2 then raise exception 'fase0: portal_dni/portal_modo no quedaron security definer con search_path'; end if;
end $$;

commit;
