-- 2026-08-22 · #10 Fase 4: RPCs de la importación de planilla UNIFICADA.
-- Un archivo con varias razones sociales resueltas por RUC (jamás por texto);
-- todo-o-nada a nivel ARCHIVO si una RS no existe / está retirada / queda
-- fuera del alcance del llamador. El documento se compara contra el maestro
-- QUITANDO CEROS a la izquierda en ambos lados (canónica = la del maestro;
-- jamás rellenar). Cuenta bancaria cifrada (Fase 2); banco por catálogo
-- (Fase 1). SEDE/FECHA vacías no pisan valores; nombre solo mejora-prefijo;
-- nadie se cesa por ausencia (archivo parcial). Idempotente.

alter table vinculos add column if not exists contrato text;

-- RUC reales (doc de Diego, Tarea 21-08): los del seed demo no casaban con
-- el archivo. L.Americana ya tenía el real desde Tres Ajustes.
update empresas set ruc = '20605159398' where id = 'negliaf' and ruc = '20501234567';
update empresas set ruc = '20545837880' where id = 'promant' and ruc = '20523456789';

drop function if exists importar_planilla_unificada(jsonb, text, text);
create function importar_planilla_unificada(p_filas jsonb, p_periodo text, p_por text)
returns jsonb language plpgsql security definer as $$
declare
  v_correo text; v_super boolean; v_alcance jsonb;
  f jsonb; r record;
  v_emp text;
  v_map jsonb := '{}'::jsonb;    -- ruc → empresa_id
  v_res jsonb := '{}'::jsonb;    -- empresa_id → resumen
  v_problemas jsonb := '[]'::jsonb;
  v_doc text; v_clave text; v_canon text; v_matches text[];
  v_nombre text; v_cuenta text; v_cuenta_actual text; v_cuenta_cambio boolean;
  v_vinculo bigint; v_sede text; v_fecha date; v_cambio boolean;
  v_cc text; v_u4 text; v_banco_nombre text;
  agregar_a text;
begin
  if p_periodo is null or p_periodo !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'La importación necesita el período (AAAA-MM).';
  end if;

  -- Alcance del llamador (sin JWT = llamada de servicio: todo permitido).
  begin
    v_correo := nullif(auth.jwt() ->> 'email', '');
  exception when others then
    v_correo := null;
  end;
  if v_correo is not null then
    select "esSuperadmin", empresas into v_super, v_alcance
    from v_mi_acceso where lower(correo) = lower(v_correo);
    if not found then raise exception 'Tu sesión no tiene acceso al BackOffice.'; end if;
  else
    v_super := true;
  end if;

  -- Todo o nada a nivel ARCHIVO: cada RUC debe existir, estar activo y estar
  -- dentro del alcance ANTES de tocar una sola fila.
  for r in select distinct f2->>'ruc' as ruc, f2->>'denominacion' as den
           from jsonb_array_elements(p_filas) f2 loop
    select id into v_emp from empresas where ruc = r.ruc;
    if v_emp is null then
      raise exception 'La razón social «%» (RUC %) no está en el catálogo: importación rechazada completa, ninguna fila se aplica.', r.den, r.ruc;
    end if;
    if (select estado from empresas where id = v_emp) <> 'activa' then
      raise exception 'La razón social «%» está retirada del grupo: importación rechazada completa.', r.den;
    end if;
    if not coalesce(v_super, false) and not (coalesce(v_alcance, '[]'::jsonb) ? v_emp) then
      raise exception 'La razón social «%» está fuera de tu alcance: importación rechazada completa.', r.den;
    end if;
    v_map := v_map || jsonb_build_object(r.ruc, v_emp);
    v_res := v_res || jsonb_build_object(v_emp, jsonb_build_object(
      'ruc', r.ruc, 'nombre', (select nombre from empresas where id = v_emp),
      'altas', '[]'::jsonb, 'vinculosNuevos', '[]'::jsonb, 'actualizaciones', '[]'::jsonb,
      'sinCambio', '[]'::jsonb, 'cambiosCuenta', '[]'::jsonb));
  end loop;

  insert into cargos (nombre) values ('Por definir') on conflict do nothing;

  for f in select * from jsonb_array_elements(p_filas) loop
    v_emp := v_map ->> (f->>'ruc');
    v_doc := upper(trim(f->>'documento'));
    v_clave := regexp_replace(v_doc, '^0+(?=.)', '');
    v_nombre := trim(f->>'nombre');
    v_cuenta := trim(f->>'cuenta');
    v_u4 := right(regexp_replace(v_cuenta, '[^0-9A-Za-z]', '', 'g'), 4);
    v_cc := nullif(trim(concat_ws(' ', f->>'centroCostoCodigo', f->>'centroCostoDesc')), '');
    v_banco_nombre := (select nombre from bancos where codigo = f->>'bancoCodigo');
    v_cuenta_cambio := false;

    -- Resolución contra el maestro quitando ceros en ambos lados.
    select array_agg(dni) into v_matches from personas
    where regexp_replace(upper(dni), '^0+(?=.)', '') = v_clave;

    if coalesce(cardinality(v_matches), 0) > 1 then
      v_problemas := v_problemas || jsonb_build_object('documento', v_doc, 'nombre', v_nombre,
        'motivo', 'Coincide con más de una persona del maestro (' || array_to_string(v_matches, ', ') || '): resuélvelo a mano.');
      continue;
    end if;

    if v_matches is null then
      -- Alta: la forma del archivo pasa a ser la canónica.
      insert into personas (dni, tipo_documento, nombre, portal, banco, banco_id,
                            cuenta_cifrada, cuenta_ultimos4)
      values (v_doc, coalesce(f->>'tipoDoc', 'DNI'), v_nombre, 'sin_celular',
              v_banco_nombre, f->>'bancoCodigo', fn_cifrar_cuenta(v_cuenta), v_u4);
      v_canon := v_doc;
      v_res := jsonb_set(v_res, array[v_emp, 'altas'],
        (v_res #> array[v_emp, 'altas']) || to_jsonb(v_doc));
    else
      v_canon := v_matches[1];
      select fn_descifrar_cuenta(cuenta_cifrada) into v_cuenta_actual from personas where dni = v_canon;
      if v_cuenta_actual is distinct from v_cuenta then
        -- Cambio de cuenta = marcado EXPLÍCITO (banco + últimos 4 de ambas).
        v_cuenta_cambio := true;
        v_res := jsonb_set(v_res, array[v_emp, 'cambiosCuenta'],
          (v_res #> array[v_emp, 'cambiosCuenta']) || jsonb_build_object(
            'documento', v_canon, 'nombre', v_nombre,
            'antes', (select jsonb_build_object('banco', banco, 'ultimos4', cuenta_ultimos4)
                      from personas where dni = v_canon),
            'despues', jsonb_build_object('banco', v_banco_nombre, 'ultimos4', v_u4)));
      end if;
      update personas set
        nombre = case when fn_es_prefijo_truncado(v_nombre, nombre) then nombre
                      when length(v_nombre) > length(nombre) then v_nombre else nombre end,
        banco = v_banco_nombre,
        banco_id = f->>'bancoCodigo',
        cuenta_cifrada = case when v_cuenta_cambio then fn_cifrar_cuenta(v_cuenta) else cuenta_cifrada end,
        cuenta_ultimos4 = v_u4
      where dni = v_canon;
    end if;

    select id into v_vinculo from vinculos
    where persona_dni = v_canon and empresa_id = v_emp and fecha_fin is null;
    if v_vinculo is null then
      -- SEDE vacía → sede «Por asignar» de la empresa; FECHA vacía → primer
      -- día del período (referencial, solo para vínculos NUEVOS).
      v_sede := fn_sede_para_importacion(v_emp, coalesce(nullif(trim(f->>'sede'), ''), 'Por asignar'), null);
      v_fecha := coalesce(nullif(trim(f->>'fechaIngreso'), '')::date, (p_periodo || '-01')::date);
      insert into vinculos (persona_dni, empresa_id, sede_id, cargo, centro_costo, contrato, fecha_inicio)
      values (v_canon, v_emp, v_sede, 'Por definir', v_cc, nullif(trim(f->>'contrato'), ''), v_fecha);
      if v_matches is not null then
        v_res := jsonb_set(v_res, array[v_emp, 'vinculosNuevos'],
          (v_res #> array[v_emp, 'vinculosNuevos']) || to_jsonb(v_canon));
      end if;
    else
      -- SEDE/FECHA vacías NO pisan lo registrado; contrato y c. de costo sí.
      select (centro_costo is distinct from v_cc
           or contrato is distinct from nullif(trim(f->>'contrato'), ''))
        into v_cambio from vinculos where id = v_vinculo;
      if v_cambio then
        update vinculos set centro_costo = v_cc, contrato = nullif(trim(f->>'contrato'), '')
        where id = v_vinculo;
      end if;
      agregar_a := case when v_cambio or v_cuenta_cambio then 'actualizaciones' else 'sinCambio' end;
      v_res := jsonb_set(v_res, array[v_emp, agregar_a],
        (v_res #> array[v_emp, agregar_a]) || to_jsonb(v_canon));
    end if;
  end loop;

  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('IMPORTAR_PLANILLA_UNIFICADA', 'importar_planilla_unificada', null,
    jsonb_build_object('por', p_por, 'periodo', p_periodo,
      'empresas', v_res, 'problemas', v_problemas));

  return jsonb_build_object('periodo', p_periodo, 'empresas', v_res, 'problemas', v_problemas);
end $$;

-- Vista previa sin escribir: mismo patrón PV999 de PLATRA1/activos.
drop function if exists previsualizar_planilla_unificada(jsonb, text);
create function previsualizar_planilla_unificada(p_filas jsonb, p_periodo text)
returns jsonb language plpgsql security definer as $$
declare v jsonb;
begin
  v := importar_planilla_unificada(p_filas, p_periodo, '(vista previa)');
  raise exception using errcode = 'PV999', message = v::text; -- revertir TODO
exception when sqlstate 'PV999' then
  return sqlerrm::jsonb;
end $$;
