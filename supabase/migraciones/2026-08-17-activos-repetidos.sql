-- Códigos repetidos entran marcados «falta corregir» (decisión de Diego,
-- 2026-08-17, segunda del día): el duplicado dentro del archivo ya no bloquea
-- la importación — la pantalla sufija las repeticiones (PROLT51-R2) y cada
-- ocurrencia llega con repetido=true. Idempotente; aplicar tras
-- 2026-08-17-importacion-activos.sql.

alter table activos add column if not exists por_corregir boolean not null default false;

-- El RPC ahora escribe por_corregir desde el campo `repetido` de cada fila.
-- Es un ESTADO, no un dato del archivo: se aplica siempre (true al importar
-- una repetición, false cuando el archivo corregido ya no repite el código).
-- La defensa contra códigos duplicados EN EL PAYLOAD se conserva: tras el
-- sufijado del parser no deben existir; si llegan, algo anda mal y se bloquea.
create or replace function importar_activos(
  p_empresa text, p_activos jsonb, p_razon_social text, p_archivo text, p_por text
) returns jsonb language plpgsql security definer as $$
declare
  a jsonb; v_codigo text; v_otra text; c text;
  v_altas text[] := '{}'; v_sin text[] := '{}'; v_acts jsonb := '[]'::jsonb;
  v_cambios jsonb; j_antes jsonb; j_despues jsonb;
  v_campos text[] := array['marca','modelo','serie','tipo','area',
    'asignado_sin_confirmar','usuario_anterior','observaciones','por_corregir'];
begin
  if (select estado from empresas where id = p_empresa) is distinct from 'activa' then
    raise exception 'La empresa % no está activa: importación rechazada completa.', p_empresa;
  end if;

  select d.codigo into v_codigo from (
    select trim(x->>'codigo') as codigo
    from jsonb_array_elements(p_activos) x
    group by 1 having count(*) > 1 limit 1) d;
  if v_codigo is not null then
    raise exception 'El código % aparece más de una vez en el lote recibido: no se importa ningún activo.', v_codigo;
  end if;

  for a in select * from jsonb_array_elements(p_activos) loop
    v_codigo := trim(coalesce(a->>'codigo', ''));
    if v_codigo = '' then
      raise exception 'Hay una fila sin código: no se importa ningún activo.';
    end if;

    select empresa_id into v_otra from activos where codigo = v_codigo;
    if v_otra is not null and v_otra <> p_empresa then
      raise exception 'El código % ya está registrado en la empresa %. Puede ser un traslado entre empresas: es una operación distinta y no se resuelve importando.', v_codigo, v_otra;
    end if;

    if v_otra is null then
      insert into activos (codigo, categoria, empresa_id, marca, modelo, serie,
                           tipo, area, asignado_sin_confirmar, usuario_anterior, observaciones,
                           por_corregir)
      values (v_codigo, 'Cómputo', p_empresa,
              nullif(trim(coalesce(a->>'marca', '')), ''),
              nullif(trim(coalesce(a->>'modelo', '')), ''),
              nullif(trim(coalesce(a->>'serie', '')), ''),
              nullif(trim(coalesce(a->>'tipo', '')), ''),
              nullif(trim(coalesce(a->>'area', '')), ''),
              nullif(trim(coalesce(a->>'usuario', '')), ''),
              nullif(trim(coalesce(a->>'usuarioAnterior', '')), ''),
              nullif(trim(coalesce(a->>'observaciones', '')), ''),
              coalesce((a->>'repetido')::boolean, false));
      v_altas := v_altas || v_codigo;
    else
      select to_jsonb(ac) into j_antes from activos ac where codigo = v_codigo;
      update activos set
        marca = fn_valor_importado(a->>'marca', marca),
        modelo = fn_valor_importado(a->>'modelo', modelo),
        serie = fn_valor_importado(a->>'serie', serie),
        tipo = fn_valor_importado(a->>'tipo', tipo),
        area = fn_valor_importado(a->>'area', area),
        asignado_sin_confirmar = fn_valor_importado(a->>'usuario', asignado_sin_confirmar),
        usuario_anterior = fn_valor_importado(a->>'usuarioAnterior', usuario_anterior),
        observaciones = fn_valor_importado(a->>'observaciones', observaciones),
        por_corregir = coalesce((a->>'repetido')::boolean, false)
      where codigo = v_codigo;
      select to_jsonb(ac) into j_despues from activos ac where codigo = v_codigo;

      v_cambios := '{}'::jsonb;
      foreach c in array v_campos loop
        if j_antes->c is distinct from j_despues->c then
          v_cambios := v_cambios ||
            jsonb_build_object(c, jsonb_build_object('antes', j_antes->c, 'despues', j_despues->c));
        end if;
      end loop;
      if v_cambios = '{}'::jsonb then
        v_sin := v_sin || v_codigo;
      else
        v_acts := v_acts || jsonb_build_object('codigo', v_codigo, 'cambios', v_cambios);
      end if;
    end if;
  end loop;

  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('IMPORTAR_ACTIVOS', 'importar_activos', null,
    jsonb_build_object('por', p_por, 'empresa', p_empresa,
      'razon_social_confirmada', p_razon_social, 'archivo', p_archivo,
      'altas', to_jsonb(v_altas), 'actualizaciones', v_acts, 'sin_cambio', to_jsonb(v_sin)));

  return jsonb_build_object('altas', to_jsonb(v_altas),
    'actualizaciones', v_acts, 'sin_cambio', to_jsonb(v_sin));
end $$;

-- v_activos expone el estado (columna nueva AL FINAL).
create or replace view v_activos as
select ac.codigo, ac.categoria, ac.marca, ac.modelo, ac.serie, ac.imei,
       case when ac.estado_fisico = 'baja' then 'baja'
            when ac.estado_fisico = 'mantenimiento' then 'mantenimiento'
            when asg.id is not null then 'asignado'
            else 'disponible' end as estado,
       asg.persona_dni as asignado,
       coalesce(vi.sede_id, ac.sede_id) as sede,
       ac.empresa_id as empresa, ac.valor,
       to_char(ac.compra, 'YYYY-MM-DD') as compra,
       ac.tipo, ac.area, ac.asignado_sin_confirmar, ac.usuario_anterior, ac.observaciones,
       ac.por_corregir
from activos ac
left join asignaciones asg on asg.activo_codigo = ac.codigo and asg.devuelto_en is null
left join vinculos vi on vi.persona_dni = asg.persona_dni and vi.fecha_fin is null;
