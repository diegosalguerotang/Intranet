-- Edición de datos del trabajador desde el legajo (pedido de Diego
-- 2026-08-17): superadministrador o categoría con nivel de ACCIÓN (>=2) en el
-- módulo Personal. Edición manual: lo escrito MANDA (vaciar celular/correo/
-- banco/cuenta sí borra); el nombre no puede quedar vacío y corregirlo limpia
-- la marca «por confirmar». Cambiar el correo lo deja pendiente de verificar.

-- Nivel del llamador en CUALQUIER módulo (generaliza fn_nivel_memorandums).
create or replace function fn_nivel_modulo(p_modulo text)
returns int language plpgsql stable security definer as $$
declare v_correo text; v_nivel int;
begin
  begin
    v_correo := nullif(auth.jwt() ->> 'email', '');
  exception when others then
    v_correo := null;
  end;
  if v_correo is null then return 99; end if; -- llamadas de servicio
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

create or replace function editar_trabajador(
  p_dni text, p_nombre text, p_celular text, p_correo text, p_banco text, p_cuenta text
) returns void language plpgsql security definer as $$
declare j_antes jsonb; j_despues jsonb; v_correo text;
begin
  if fn_nivel_modulo('personal') < 2 then
    raise exception 'Tu categoría no permite editar datos de Personal.';
  end if;
  if not exists (select 1 from personas where dni = p_dni) then
    raise exception 'La persona % no existe.', p_dni;
  end if;
  if nullif(trim(coalesce(p_nombre, '')), '') is null then
    raise exception 'El nombre no puede quedar vacío.';
  end if;
  v_correo := nullif(lower(trim(coalesce(p_correo, ''))), '');
  if v_correo is not null and v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo no tiene un formato válido.';
  end if;

  select to_jsonb(p) - 'cuenta' into j_antes from personas p where dni = p_dni;
  update personas set
    nombre = trim(p_nombre),
    nombre_por_confirmar = false,           -- una corrección manual lo confirma
    celular = nullif(trim(coalesce(p_celular, '')), ''),
    banco = nullif(trim(coalesce(p_banco, '')), ''),
    cuenta = nullif(trim(coalesce(p_cuenta, '')), ''),
    correo_verificado = case when v_correo is distinct from correo then false else correo_verificado end,
    correo = v_correo
  where dni = p_dni;
  select to_jsonb(p) - 'cuenta' into j_despues from personas p where dni = p_dni;

  -- La cuenta bancaria es dato sensible: la auditoría registra el cambio sin
  -- guardar el número en claro.
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('EDITAR_TRABAJADOR', 'personas', j_antes, j_despues);
end $$;
