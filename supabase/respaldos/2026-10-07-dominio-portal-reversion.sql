-- supabase/respaldos/2026-10-07-dominio-portal-reversion.sql — deshace la migración del mismo nombre.
-- Restaura las cuatro funciones del commit 44097c5 (dominio portal.grupoer.pe).
-- Se NIEGA si auth.users ya tiene cuentas con el dominio nuevo: primero hay que
-- devolverlas con scripts/migrar-dominio-portal.mjs --revertir.
begin;
set local search_path = public, interno, extensions;

do $r$
begin
  if exists (select 1 from auth.users where email like '%@portal.servicios-intranet.net') then
    raise exception 'dominio-portal: hay cuentas con @portal.servicios-intranet.net en auth.users; corre migrar-dominio-portal.mjs --revertir antes';
  end if;
end $r$;

create or replace function portal_dni() returns text language sql stable security definer set search_path = public, interno, extensions as $$
  select p.dni from personas p
  where coalesce(auth.jwt()->>'email','') like '%@portal.grupoer.pe'
    and lower(p.dni) = split_part(auth.jwt()->>'email','@',1)
  limit 1
$$;

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

-- Verificación embebida: las cuatro funciones nombran solo el dominio portal.grupoer.pe,
-- siguen definer con search_path fijo y conservan sus privilegios.
do $v$
declare f text; p pg_proc;
begin
  foreach f in array array['public.portal_dni()', 'public.portal_registrar_ingreso(text, text, text)', 'public.api_login_permitido(text, text)', 'public.api_login_registrar(text, text, text, text)'] loop
    select * into p from pg_proc where oid = f::regprocedure;
    if p.prosrc !~ 'portal\.grupoer\.pe' or p.prosrc ~ 'portal\.servicios-intranet\.net' then
      raise exception 'dominio-portal: % no quedó con el dominio portal.grupoer.pe', f;
    end if;
    if not p.prosecdef or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%') then
      raise exception 'dominio-portal: % perdió definer o search_path', f;
    end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.portal_dni()', 'execute') or has_function_privilege('anon', 'public.portal_dni()', 'execute')
     or not has_function_privilege('anon', 'public.portal_registrar_ingreso(text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.api_login_permitido(text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.api_login_registrar(text, text, text, text)', 'execute')
     or not has_function_privilege('service_role', 'public.api_login_registrar(text, text, text, text)', 'execute') then
    raise exception 'dominio-portal: los privilegios no quedaron como se esperaba';
  end if;
end $v$;

commit;
