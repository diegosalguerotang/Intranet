-- Edición de activos (pedida por Diego 2026-08-17): tras importar el
-- inventario hay que poder corregir el código (caso PROLT51 / PROLT51-R2
-- «falta corregir») y los datos del equipo. El código es la identidad (PK con
-- referencias): las FKs pasan a ON UPDATE CASCADE para que renombrar arrastre
-- asignaciones y líneas. Renombrar el código LIMPIA por_corregir (la
-- corrección de identidad es exactamente eso). Idempotente.

alter table asignaciones drop constraint if exists asignaciones_activo_codigo_fkey;
alter table asignaciones add constraint asignaciones_activo_codigo_fkey
  foreign key (activo_codigo) references activos(codigo) on update cascade;
alter table lineas drop constraint if exists lineas_equipo_fkey;
alter table lineas add constraint lineas_equipo_fkey
  foreign key (equipo) references activos(codigo) on update cascade;

create or replace function editar_activo(
  p_codigo text, p_nuevo_codigo text, p_tipo text, p_marca text, p_modelo text,
  p_serie text, p_area text, p_asignado_sin_confirmar text, p_observaciones text,
  p_por text default 'Administración'
) returns void language plpgsql security definer as $$
declare v_nuevo text; j_antes jsonb; j_despues jsonb;
begin
  if not exists (select 1 from activos where codigo = p_codigo) then
    raise exception 'El activo % no existe.', p_codigo;
  end if;
  v_nuevo := trim(coalesce(p_nuevo_codigo, ''));
  if v_nuevo = '' then
    raise exception 'El activo necesita un código.';
  end if;
  if v_nuevo <> p_codigo and exists (select 1 from activos where codigo = v_nuevo) then
    raise exception 'Ya existe un activo con el código %.', v_nuevo;
  end if;

  select to_jsonb(ac) into j_antes from activos ac where codigo = p_codigo;
  -- Edición manual: lo que se escribe MANDA (vaciar un campo sí lo borra —
  -- regla distinta de la importación, donde un vacío jamás borra).
  update activos set
    codigo = v_nuevo,
    tipo = nullif(trim(coalesce(p_tipo, '')), ''),
    marca = nullif(trim(coalesce(p_marca, '')), ''),
    modelo = nullif(trim(coalesce(p_modelo, '')), ''),
    serie = nullif(trim(coalesce(p_serie, '')), ''),
    area = nullif(trim(coalesce(p_area, '')), ''),
    asignado_sin_confirmar = nullif(trim(coalesce(p_asignado_sin_confirmar, '')), ''),
    observaciones = nullif(trim(coalesce(p_observaciones, '')), ''),
    por_corregir = case when v_nuevo <> p_codigo then false else por_corregir end
  where codigo = p_codigo;
  select to_jsonb(ac) into j_despues from activos ac where codigo = v_nuevo;

  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('EDITAR_ACTIVO', 'activos',
    j_antes || jsonb_build_object('por', p_por), j_despues);
end $$;
