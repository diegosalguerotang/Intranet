-- 2026-09-22 · Fecha de ingreso editable desde el legajo (Diego: «debería
-- poder editarse manualmente»). Hasta hoy solo se fijaba en el alta.
-- Canónico: supabase/schema.sql (corregir_fecha_ingreso) + lista 2b de
-- supabase/seguridad.sql. Idempotente. Reversión: drop function
-- corregir_fecha_ingreso(text, date).
begin;
set local search_path = public, interno, extensions;

create or replace function corregir_fecha_ingreso(p_dni text, p_fecha date)
returns void language plpgsql security definer
set search_path = public, interno, extensions as $$
declare v vinculos%rowtype; v_choque date;
begin
  perform requiere_nivel('personal', 2);
  if p_fecha is null then
    raise exception 'Indica la fecha de ingreso.';
  end if;
  if p_fecha > current_date then
    raise exception 'La fecha de ingreso no puede ser futura.';
  end if;
  select * into v from vinculos
  where persona_dni = p_dni and fecha_fin is null
  order by fecha_inicio desc limit 1;
  if v.id is null then
    raise exception 'La persona % no tiene un vínculo vigente.', p_dni;
  end if;
  select max(fecha_fin) into v_choque from vinculos
  where persona_dni = p_dni and empresa_id = v.empresa_id and id <> v.id and fecha_fin is not null;
  if v_choque is not null and p_fecha <= v_choque then
    raise exception 'La fecha pisa un vínculo anterior en la misma empresa (cesado el %).', to_char(v_choque, 'YYYY-MM-DD');
  end if;
  if v.fecha_inicio = p_fecha then
    return;
  end if;
  update vinculos set fecha_inicio = p_fecha where id = v.id;
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('CORREGIR_FECHA_INGRESO', 'vinculos',
          jsonb_build_object('vinculo_id', v.id, 'dni', p_dni, 'empresa', v.empresa_id, 'fecha_inicio', v.fecha_inicio),
          jsonb_build_object('vinculo_id', v.id, 'dni', p_dni, 'empresa', v.empresa_id, 'fecha_inicio', p_fecha));
end $$;
revoke all on function corregir_fecha_ingreso(text, date) from public, anon;
grant execute on function corregir_fecha_ingreso(text, date) to authenticated, service_role;

-- Comprobación en la misma transacción (sin JWT el rol es postgres → nivel 99):
-- una fecha futura se rechaza; una persona sin vínculo vigente se rechaza.
do $$
declare v_msj text;
begin
  begin
    perform corregir_fecha_ingreso('00000000', current_date + 1);
    raise exception 'debía rechazar la fecha futura';
  exception when others then
    v_msj := sqlerrm;
    if v_msj not like 'La fecha de ingreso no puede ser futura%' then raise; end if;
  end;
  begin
    perform corregir_fecha_ingreso('00000000', current_date);
    raise exception 'debía rechazar la persona sin vínculo';
  exception when others then
    v_msj := sqlerrm;
    if v_msj not like 'La persona % no tiene un vínculo vigente%' then raise; end if;
  end;
  if not has_function_privilege('authenticated', 'corregir_fecha_ingreso(text,date)', 'execute') then
    raise exception 'corregir_fecha_ingreso sin EXECUTE para authenticated';
  end if;
end $$;
commit;
