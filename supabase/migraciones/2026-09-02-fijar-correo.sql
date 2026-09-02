-- 2026-09-02 — fijar_correo_persona: fija SOLO el correo de contacto (paso
-- «completar correos» del modal masivo de cuentas del portal, RRH-02).
-- No se reutiliza editar_trabajador: ese RPC reemplaza toda la fila («lo
-- escrito manda») y limpia nombre_por_confirmar como efecto colateral.
-- Idempotente. Spec: docs/superpowers/specs/2026-09-02-completar-correos-masa-design.md

drop function if exists fijar_correo_persona(text, text);
create function fijar_correo_persona(p_dni text, p_correo text)
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare v_correo text; j_antes jsonb; j_despues jsonb;
begin
  if fn_nivel_modulo('personal') < 2 then
    raise exception 'Tu categoría no permite editar datos de Personal.';
  end if;
  if not exists (select 1 from personas where dni = p_dni) then
    raise exception 'La persona % no existe.', p_dni;
  end if;
  v_correo := nullif(lower(trim(coalesce(p_correo, ''))), '');
  if v_correo is not null and v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo no tiene un formato válido.';
  end if;
  select jsonb_build_object('dni', dni, 'correo', correo, 'correo_verificado', correo_verificado)
    into j_antes from personas where dni = p_dni;
  update personas set
    correo_verificado = case when v_correo is distinct from correo then false else correo_verificado end,
    correo = v_correo
  where dni = p_dni;
  select jsonb_build_object('dni', dni, 'correo', correo, 'correo_verificado', correo_verificado)
    into j_despues from personas where dni = p_dni;
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('FIJAR_CORREO', 'personas', j_antes, j_despues);
end $$;
