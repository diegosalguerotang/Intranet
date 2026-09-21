-- supabase/limites.sql — Corrección de seguridad · FASE 6b (2026-09-21):
-- LÍMITES E IDENTIDAD.
--
-- Canónico de la fase 6b. Lo embebe la migración
-- migraciones/2026-09-21-fase6-limites.sql y el bloque @@FASE6@@ de
-- seguridad.sql. Idempotente. Se aplica con search_path = public, interno.
--
--  1 · fn_nivel_modulo: fallo cerrado sin JWT. Una sesión cuyo rol activo es
--      authenticated o anon vale 0 aunque no traiga claims (hallazgo de la
--      fase 4); 99 queda solo para postgres/supabase_admin y el rol de servicio.
--  2 · registro_accesos.fuente: quién anotó la fila. «cliente» (RPC desde el
--      navegador, sin sesión) o «proxy» (api_login_registrar, con la llave de
--      servicio, tras una respuesta real de Auth). Para el bloqueo por intentos
--      solo cuentan los fallos del proxy: nadie puede bloquear a otro anotando
--      fallos falsos.
--  3 · registrar_ingreso / portal_registrar_ingreso: un «exitoso» solo lo
--      registra la propia sesión (JWT con ese correo); guardan la IP real
--      (x-ip-real, que el proxy genera y el cliente no puede fijar).
--  4 · api_login_permitido / api_login_registrar: compuerta de login que aplica
--      el proxy ANTES de hablar con Auth: por cuenta (la política vigente) y por
--      IP real (30 fallos en 15 minutos).
--  5 · Piso de 10 caracteres para la clave del BackOffice (P11); el Portal
--      sigue en 6 (decisión de Diego del 2026-08-21).

-- 1 · Identidad sin JWT --------------------------------------------------------
create or replace function public.fn_nivel_modulo(p_modulo text)
returns int language plpgsql stable security definer set search_path = public, interno, extensions as $$
declare v_correo text; v_nivel int; v_rol text;
begin
  begin
    v_correo := nullif(auth.jwt() ->> 'email', '');
  exception when others then
    v_correo := null;
  end;
  if v_correo is null then
    -- Sin correo en el JWT hay dos casos legítimos con privilegio: el rol de
    -- servicio (claims de PostgREST con role=service_role) y una sesión
    -- directa de postgres/supabase_admin (Management API, migraciones).
    -- Fase 6b: se mira el rol ACTIVO (SET ROLE, GUC role) antes que el de la
    -- sesión; dentro de un SECURITY DEFINER current_user es el dueño, por eso
    -- no sirve. Una sesión con rol activo authenticated/anon sin claims vale 0.
    v_rol := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
                      nullif(current_setting('role', true), 'none'),
                      session_user::text);
    if v_rol in ('authenticated', 'anon') then return 0; end if;
    if v_rol in ('postgres', 'service_role', 'supabase_admin') then return 99; end if;
    return 0;
  end if;
  select case when p.es_superadmin then 99
              else coalesce((select pp.nivel from perfil_permisos pp
                             where pp.perfil_id = u.perfil_id
                               and pp.perfil_version = u.perfil_version
                               and pp.modulo = p_modulo), 0) end
  into v_nivel
  from usuarios_admin u
  join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
  where lower(u.correo) = lower(v_correo) and u.estado = 'activo';
  return coalesce(v_nivel, 0);
end $$;

-- 2 · Fuente del registro de accesos ------------------------------------------
alter table interno.registro_accesos add column if not exists fuente text not null default 'cliente';
alter table interno.registro_accesos drop constraint if exists chk_registro_fuente;
alter table interno.registro_accesos add constraint chk_registro_fuente check (fuente in ('cliente', 'proxy'));
create index if not exists registro_accesos_ip_idx on interno.registro_accesos (ip, fecha) where fuente = 'proxy';

-- 3 · Bitácoras de login ----------------------------------------------------------
create or replace function public.registrar_ingreso(p_correo text, p_resultado text, p_dispositivo text)
returns void language plpgsql security definer set search_path = public, interno, extensions as $$
declare u usuarios_admin%rowtype; v_correo text := lower(trim(coalesce(p_correo, '')));
begin
  if v_correo = '' then raise exception 'Falta el correo.'; end if;
  if p_resultado not in ('exitoso', 'fallido', 'bloqueado') then raise exception 'Resultado inválido.'; end if;
  -- Un ingreso «exitoso» solo lo registra la propia sesión. Antes cualquiera
  -- podía anotarlo sin sesión y reiniciar así el bloqueo de cualquier cuenta.
  if p_resultado = 'exitoso' and correo_llamador() is distinct from v_correo then
    raise insufficient_privilege using message = 'Solo la propia sesión puede registrar un ingreso exitoso.';
  end if;
  select * into u from usuarios_admin where lower(correo) = v_correo;
  insert into registro_accesos (usuario_id, dni, correo, perfil_id, perfil_version, superficie, resultado, ip, dispositivo, fuente)
  values (u.id, u.persona_dni, v_correo, u.perfil_id, u.perfil_version, 'backoffice', p_resultado,
          fn_cabecera('x-ip-real'), left(p_dispositivo, 200), 'cliente');
  if p_resultado = 'exitoso' and u.id is not null then
    update usuarios_admin set ultimo_ingreso = now() where id = u.id;
  end if;
end $$;

create or replace function public.portal_registrar_ingreso(p_dni text, p_resultado text, p_dispositivo text)
returns void language plpgsql security definer set search_path = public, interno, extensions as $$
declare v_dni text := trim(coalesce(p_dni, ''));
begin
  if v_dni = '' then raise exception 'Falta el documento.'; end if;
  if p_resultado not in ('exitoso', 'fallido', 'bloqueado') then raise exception 'Resultado inválido.'; end if;
  if p_resultado = 'exitoso' and correo_llamador() is distinct from lower(v_dni) || '@portal.grupoer.pe' then
    raise insufficient_privilege using message = 'Solo la propia sesión puede registrar un ingreso exitoso.';
  end if;
  insert into registro_accesos (dni, superficie, resultado, ip, dispositivo, fuente)
  values (v_dni, 'portal', p_resultado, fn_cabecera('x-ip-real'), left(p_dispositivo, 200), 'cliente');
  if p_resultado = 'exitoso' then
    update personas
    set portal = case when coalesce((select sin_celular from cuentas_portal c where c.dni = v_dni), false)
                      then 'sin_celular' else 'activo' end
    where dni = v_dni and portal <> 'suspendido';
  end if;
end $$;

-- Bloqueo por intentos: fallos consecutivos ANOTADOS POR EL PROXY posteriores
-- al último ingreso exitoso, dentro de la ventana de la política.
create or replace function public.verificar_bloqueo(p_correo text) returns boolean
language plpgsql stable security definer set search_path = public, interno, extensions as $$
declare pol politica_acceso%rowtype; ultimo_ok timestamptz; fallidos int; v_correo text := lower(trim(coalesce(p_correo, '')));
begin
  select * into pol from politica_acceso where id = 1;
  select max(fecha) into ultimo_ok from registro_accesos
  where lower(correo) = v_correo and superficie = 'backoffice' and resultado = 'exitoso';
  select count(*) into fallidos from registro_accesos
  where lower(correo) = v_correo and superficie = 'backoffice' and resultado = 'fallido' and fuente = 'proxy'
    and fecha > now() - make_interval(mins => pol.bloqueo_minutos)
    and (ultimo_ok is null or fecha > ultimo_ok);
  return fallidos >= pol.intentos_bloqueo;
end $$;

create or replace function public.portal_verificar_bloqueo(p_dni text) returns boolean
language plpgsql stable security definer set search_path = public, interno, extensions as $$
declare pol politica_acceso%rowtype; ultimo_ok timestamptz; fallidos int; v_dni text := lower(trim(coalesce(p_dni, '')));
begin
  select * into pol from politica_acceso where id = 1;
  select max(fecha) into ultimo_ok from registro_accesos
  where lower(dni) = v_dni and superficie = 'portal' and resultado = 'exitoso';
  select count(*) into fallidos from registro_accesos
  where lower(dni) = v_dni and superficie = 'portal' and resultado = 'fallido' and fuente = 'proxy'
    and fecha > now() - make_interval(mins => pol.bloqueo_minutos)
    and (ultimo_ok is null or fecha > ultimo_ok);
  return fallidos >= pol.intentos_bloqueo;
end $$;

-- 4 · Compuerta de login (solo la llave de servicio: la aplica el proxy) --------
-- Límite por IP real: fallos anotados por el proxy desde esa IP, en cualquier
-- cuenta y superficie. 30 en 15 minutos: una oficina con NAT compartido no lo
-- alcanza tecleando mal; un ataque sí.
create or replace function public.api_login_permitido(p_ip text, p_correo text)
returns jsonb language plpgsql stable security definer set search_path = public, interno, extensions as $$
declare v_correo text := lower(trim(coalesce(p_correo, ''))); v_ip text := left(trim(coalesce(p_ip, '')), 64); n int;
begin
  if v_ip <> '' then
    select count(*) into n from registro_accesos
    where ip = v_ip and fuente = 'proxy' and resultado = 'fallido' and fecha > now() - interval '15 minutes';
    if n >= 30 then return jsonb_build_object('permitido', false, 'motivo', 'ip'); end if;
  end if;
  if v_correo like '%@portal.grupoer.pe' then
    if portal_verificar_bloqueo(split_part(v_correo, '@', 1)) then return jsonb_build_object('permitido', false, 'motivo', 'cuenta'); end if;
  elsif v_correo <> '' then
    if verificar_bloqueo(v_correo) then return jsonb_build_object('permitido', false, 'motivo', 'cuenta'); end if;
  end if;
  return jsonb_build_object('permitido', true);
end $$;

-- El proxy anota lo que Auth respondió de verdad (fallido) o lo que él mismo
-- negó (bloqueado). La superficie y el documento salen del correo técnico.
create or replace function public.api_login_registrar(p_correo text, p_resultado text, p_ip text, p_agente text)
returns void language plpgsql security definer set search_path = public, interno, extensions as $$
declare u usuarios_admin%rowtype; v_correo text := lower(trim(coalesce(p_correo, '')));
begin
  if v_correo = '' then return; end if;
  if p_resultado not in ('fallido', 'bloqueado') then raise exception 'Resultado inválido para el proxy.'; end if;
  if v_correo like '%@portal.grupoer.pe' then
    insert into registro_accesos (dni, superficie, resultado, ip, dispositivo, fuente)
    values (upper(split_part(v_correo, '@', 1)), 'portal', p_resultado, left(trim(coalesce(p_ip, '')), 64), left(p_agente, 200), 'proxy');
  else
    select * into u from usuarios_admin where lower(correo) = v_correo;
    insert into registro_accesos (usuario_id, dni, correo, perfil_id, perfil_version, superficie, resultado, ip, dispositivo, fuente)
    values (u.id, u.persona_dni, v_correo, u.perfil_id, u.perfil_version, 'backoffice', p_resultado,
            left(trim(coalesce(p_ip, '')), 64), left(p_agente, 200), 'proxy');
  end if;
end $$;

revoke all on function api_login_permitido(text, text), api_login_registrar(text, text, text, text) from public, anon, authenticated;
grant execute on function api_login_permitido(text, text), api_login_registrar(text, text, text, text) to service_role;

-- 5 · Piso de la clave del BackOffice (P11) --------------------------------------
alter table interno.politica_acceso drop constraint if exists chk_clave_min_backoffice;
update interno.politica_acceso set clave_longitud_min_backoffice = 10 where id = 1 and clave_longitud_min_backoffice < 10;
alter table interno.politica_acceso alter column clave_longitud_min_backoffice set default 10;
alter table interno.politica_acceso add constraint chk_clave_min_backoffice check (clave_longitud_min_backoffice >= 10);

create or replace function public.guardar_politica(
  p_backoffice_horas int, p_portal_dias int,
  p_multisesion_backoffice boolean, p_multisesion_portal boolean,
  p_intentos int, p_bloqueo_min int, p_recuperacion text,
  p_clave_min_portal int, p_clave_min_backoffice int,
  p_provisional_dias int, p_por text
) returns void language plpgsql security definer set search_path = public, interno, extensions as $$
begin
  perform requiere_superadmin();  -- fase 1: guarda central
  if coalesce(p_clave_min_backoffice, 0) < 10 then raise exception 'La clave del BackOffice exige al menos 10 caracteres (P11).'; end if;
  if coalesce(p_clave_min_portal, 0) < 6 then raise exception 'La clave del Portal exige al menos 6 caracteres.'; end if;
  update politica_acceso
  set sesion_backoffice_horas       = p_backoffice_horas,
      sesion_portal_dias            = p_portal_dias,
      multisesion_backoffice        = p_multisesion_backoffice,
      multisesion_portal            = p_multisesion_portal,
      intentos_bloqueo              = p_intentos,
      bloqueo_minutos               = p_bloqueo_min,
      recuperacion_defecto          = p_recuperacion,
      clave_longitud_min_portal     = p_clave_min_portal,
      clave_longitud_min_backoffice = p_clave_min_backoffice,
      clave_provisional_dias        = p_provisional_dias,
      actualizado_por               = p_por,
      actualizado_en                = now()
  where id = 1;
end $$;
