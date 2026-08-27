-- Eliminar sede (RRH-21, pedido de Diego 2026-08-27): borrar de verdad SOLO
-- sedes sin rastro — ni vínculos de trabajadores (históricos incluidos: los
-- legajos las referencian), ni activos, ni comunicados dirigidos a ella. Si
-- algo la referencia, el error dice cuánto de cada cosa. Exige nivel de
-- aprobación en Personal (sin JWT = llamada de servicio, pasa). Idempotente.

create or replace function eliminar_sede(p_sede text)
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare v_sede sedes%rowtype; v_vinculos int; v_activos int; v_comunicados int;
begin
  if fn_nivel_modulo('personal') < 3 then
    raise exception 'Eliminar sedes exige nivel de aprobación en Personal.';
  end if;
  select * into v_sede from sedes where id = p_sede;
  if not found then
    raise exception 'La sede % no existe.', p_sede;
  end if;
  select count(*) into v_vinculos from vinculos where sede_id = p_sede;
  select count(*) into v_activos from activos where sede_id = p_sede;
  select count(*) into v_comunicados from comunicados where sede_id = p_sede;
  if v_vinculos + v_activos + v_comunicados > 0 then
    raise exception 'No se puede eliminar «%»: la referencian % vínculo(s) de trabajadores, % activo(s) y % comunicado(s). El historial no se borra.',
      v_sede.nombre, v_vinculos, v_activos, v_comunicados;
  end if;
  delete from sedes where id = p_sede;
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('ELIMINAR_SEDE', 'sedes', to_jsonb(v_sede), null);
end $$;
