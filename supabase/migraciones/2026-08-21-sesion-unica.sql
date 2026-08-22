-- 2026-08-21 · Sesión única por cuenta (gana el login nuevo) para BackOffice y
-- Portal. Cada login registra un MARCADOR único en el servidor; la app compara
-- su marcador contra el del servidor y se autoexpulsa si cambió (otro equipo
-- entró). El cierre por inactividad de 10 min es del lado del cliente.
-- Idempotente (add column if not exists + create or replace).

alter table usuarios_admin add column if not exists sesion_actual text;
alter table cuentas_portal add column if not exists sesion_actual text;

-- BackOffice: el usuario que llama se resuelve por el email del JWT contra
-- auth.users (usuarios_admin.id es bigint, no el uuid de Auth; mismo criterio
-- que es_admin_activo()).
create or replace function registrar_sesion_backoffice(p_marker text)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  update usuarios_admin u
  set sesion_actual = p_marker
  from auth.users au
  where au.id = auth.uid() and au.email = u.correo;
end $$;

create or replace function mi_sesion_backoffice()
returns text language sql security definer set search_path = public, auth as $$
  select u.sesion_actual from usuarios_admin u
  join auth.users au on au.email = u.correo
  where au.id = auth.uid()
$$;

-- Portal: el trabajador se resuelve por portal_dni() (dni del JWT).
create or replace function portal_registrar_sesion(p_marker text)
returns void language plpgsql security definer as $$
begin
  update cuentas_portal set sesion_actual = p_marker where dni = portal_dni();
end $$;

create or replace function portal_mi_sesion()
returns text language sql security definer as $$
  select sesion_actual from cuentas_portal where dni = portal_dni()
$$;

grant execute on function registrar_sesion_backoffice(text), mi_sesion_backoffice(),
  portal_registrar_sesion(text), portal_mi_sesion() to authenticated, anon;
