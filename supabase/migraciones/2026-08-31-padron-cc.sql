-- Padrón con centro de costo (spec Tareas 31-08): el formato DEFINITIVO de
-- 12 columnas reemplaza a PLATRA1 y al unificado con banco. Este archivo es
-- el canónico de las RPC del padrón (patrón 2026-08-24: las funciones de
-- planilla viven en la migración por fecha, no en schema.sql).
--
-- Reglas del spec que gobiernan aquí:
--  · Empresa por RUC, todo-o-nada a nivel ARCHIVO (las 3 RS o ninguna).
--  · El archivo NO trae banco/cuenta/sede/contrato: esta importación no los
--    toca. La ausencia de una columna no es una instrucción de vaciado.
--  · Centro de costo contra catálogo cerrado (8 valores): uno desconocido
--    rechaza el archivo completo. Un cargo nuevo, en cambio, se suma al
--    catálogo de cargos (aparecerán cargos nuevos; el perfil queda sin
--    sugerencia hasta que se administre la correspondencia).
--  · Nadie cesa por ausencia (posiblesCeses solo propone; p_ceses confirma).
--  · El área heredada se guarda y no agrupa ni filtra nada.

-- 1 · Ficha: sexo (del padrón). El área heredada va en el vínculo.
alter table personas add column if not exists sexo text check (sexo in ('M','F'));
alter table vinculos add column if not exists area_heredada text;

-- 2 · Catálogo de centros de costo: la agrupación OFICIAL de reportes y
-- tableros, compartida con el control de asistencia.
create table if not exists centros_costo (
  codigo text primary key,
  activo boolean not null default true
);
insert into centros_costo (codigo) values
  ('ADM'), ('RRHH'), ('OPE'), ('LOGISTICA'),
  ('COMERCIAL'), ('SIST/GG'), ('SST/GG'), ('LEGAL/GG')
on conflict (codigo) do nothing;
grant select on centros_costo to anon, authenticated;

-- 3 · Importación del padrón. Sin período: las fechas salen de F. INGRESO.
-- El corte de un traslado es el día anterior al inicio del vínculo nuevo;
-- el de un cese confirmado, la fecha del día (jamás antes del inicio).
drop function if exists importar_padron(jsonb, text, jsonb);
create function importar_padron(p_filas jsonb, p_por text, p_ceses jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_correo text; v_super boolean; v_alcance jsonb;
  f jsonb; r record;
  v_emp text;
  v_map jsonb := '{}'::jsonb;    -- ruc → empresa_id
  v_res jsonb := '{}'::jsonb;    -- empresa_id → resumen
  v_problemas jsonb := '[]'::jsonb;
  v_desconocidos text[];
  v_doc text; v_clave text; v_canon text; v_matches text[];
  v_nombre text; v_vinculo bigint; v_sede text; v_fecha date;
  v_cambio boolean; v_cargo_antes text;
  agregar_a text;
  v_vinculo_otro bigint; v_emp_origen text; v_vinculo_nuevo bigint;
  v_es_retorno boolean; v_posibles jsonb := '[]'::jsonb;
  v_cese_doc text;
begin
  if fn_nivel_modulo('personal') < 2 then
    raise exception 'Tu categoría no permite importar el padrón (requiere nivel de acción en Personal).';
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
  for r in select distinct f2->>'ruc' as ruc, f2->>'razonSocial' as den
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
      'sinCambio', '[]'::jsonb, 'cargosCambiaron', '[]'::jsonb,
      'traslados', '[]'::jsonb, 'retornos', '[]'::jsonb, 'cesados', '[]'::jsonb));
  end loop;

  -- Centro de costo contra el catálogo CERRADO: uno desconocido = archivo
  -- rechazado completo (es la agrupación oficial; un valor nuevo se decide
  -- en configuración, no en una importación).
  select array_agg(distinct f2->>'centroCosto') into v_desconocidos
  from jsonb_array_elements(p_filas) f2
  where not exists (select 1 from centros_costo c
                    where c.codigo = f2->>'centroCosto' and c.activo);
  if v_desconocidos is not null then
    raise exception 'Centro de costo fuera del catálogo: %. Agrégalo en configuración antes de importar.', array_to_string(v_desconocidos, ', ');
  end if;

  for f in select * from jsonb_array_elements(p_filas) loop
    v_emp := v_map ->> (f->>'ruc');
    v_doc := upper(trim(f->>'documento'));
    v_clave := regexp_replace(v_doc, '^0+(?=.)', '');
    v_nombre := trim(f->>'nombre');
    v_fecha := (f->>'fechaIngreso')::date;
    v_vinculo_otro := null; v_emp_origen := null; v_vinculo_nuevo := null; v_es_retorno := false;

    -- Resolución contra el maestro quitando ceros en ambos lados.
    select array_agg(dni) into v_matches from personas
    where regexp_replace(upper(dni), '^0+(?=.)', '') = v_clave;

    if coalesce(cardinality(v_matches), 0) > 1 then
      v_problemas := v_problemas || jsonb_build_object('documento', v_doc, 'nombre', v_nombre,
        'motivo', 'Coincide con más de una persona del maestro (' || array_to_string(v_matches, ', ') || '): resuélvelo a mano.');
      continue;
    end if;

    if v_matches is null then
      -- Alta: la forma del archivo pasa a ser la canónica. El nombre viene
      -- truncado a 30: si llega justo en el borde, queda por confirmar.
      insert into personas (dni, tipo_documento, nombre, sexo, portal, nombre_por_confirmar)
      values (v_doc, coalesce(nullif(f->>'tipoDocumento', ''), 'DNI'), v_nombre,
              nullif(f->>'sexo', ''), 'sin_celular', length(v_nombre) >= 30);
      v_canon := v_doc;
      v_res := jsonb_set(v_res, array[v_emp, 'altas'],
        (v_res #> array[v_emp, 'altas']) || to_jsonb(v_doc));
    else
      v_canon := v_matches[1];
      -- Nunca acortar un nombre con su prefijo; adoptar el más largo. Como el
      -- archivo trunca a 30, adoptar un nombre de 30 no confirma nada.
      update personas set
        nombre = case when fn_es_prefijo_truncado(v_nombre, nombre) then nombre
                      when length(v_nombre) > length(nombre) then v_nombre else nombre end,
        nombre_por_confirmar = case
          when length(v_nombre) > length(nombre) and length(v_nombre) < 30 then false
          else nombre_por_confirmar end,
        sexo = coalesce(nullif(f->>'sexo', ''), sexo)
      where dni = v_canon;

      -- ¿Traslado? Vínculo vigente en OTRA empresa cuyo documento no viene
      -- también bajo esa empresa en el archivo (doble RS legítima se respeta).
      select v.id, v.empresa_id into v_vinculo_otro, v_emp_origen from vinculos v
      where v.persona_dni = v_canon and v.fecha_fin is null and v.empresa_id <> v_emp
        and not exists (
          select 1 from jsonb_array_elements(p_filas) f3
          where regexp_replace(upper(trim(f3->>'documento')), '^0+(?=.)', '') = regexp_replace(upper(v_canon), '^0+(?=.)', '')
            and (v_map ->> (f3->>'ruc')) = v.empresa_id)
      limit 1;
      -- ¿Retorno? Tiene historia pero ningún vínculo vigente.
      select (not exists (select 1 from vinculos where persona_dni = v_canon and fecha_fin is null))
         and exists (select 1 from vinculos where persona_dni = v_canon)
        into v_es_retorno;
    end if;

    insert into cargos (nombre) values (nullif(trim(f->>'cargo'), ''))
    on conflict do nothing;

    select id into v_vinculo from vinculos
    where persona_dni = v_canon and empresa_id = v_emp and fecha_fin is null;
    if v_vinculo is null then
      -- El archivo no trae sede: los vínculos nuevos nacen en «Por asignar».
      v_sede := fn_sede_para_importacion(v_emp, 'Por asignar', null);
      insert into vinculos (persona_dni, empresa_id, sede_id, cargo, centro_costo,
                            area_heredada, fecha_inicio)
      values (v_canon, v_emp, v_sede, trim(f->>'cargo'), f->>'centroCosto',
              nullif(trim(f->>'areaHeredada'), ''), v_fecha)
      returning id into v_vinculo_nuevo;
      if v_vinculo_otro is not null then
        -- TRASLADO: cerrar el vínculo anterior (decisión de Diego 2026-08-24).
        update vinculos set fecha_fin = greatest(fecha_inicio, v_fecha - 1) where id = v_vinculo_otro;
        insert into movimientos (persona_dni, tipo, empresa_origen, empresa_destino,
          vinculo_cerrado, vinculo_abierto, fecha_efecto, detalle, creado_por)
        values (v_canon, 'traslado', v_emp_origen, v_emp, v_vinculo_otro, v_vinculo_nuevo,
          greatest((select fecha_inicio from vinculos where id = v_vinculo_otro), v_fecha - 1),
          'Importación de padrón', p_por);
        v_res := jsonb_set(v_res, array[v_emp, 'traslados'], (v_res #> array[v_emp, 'traslados'])
          || jsonb_build_object('documento', v_canon, 'nombre', v_nombre,
               'desde', (select nombre from empresas where id = v_emp_origen)));
      elsif v_es_retorno then
        insert into movimientos (persona_dni, tipo, empresa_destino, vinculo_abierto,
          fecha_efecto, detalle, creado_por)
        values (v_canon, 'retorno', v_emp, v_vinculo_nuevo, v_fecha,
          'Importación de padrón', p_por);
        v_res := jsonb_set(v_res, array[v_emp, 'retornos'],
          (v_res #> array[v_emp, 'retornos']) || to_jsonb(v_canon));
      elsif v_matches is not null then
        v_res := jsonb_set(v_res, array[v_emp, 'vinculosNuevos'],
          (v_res #> array[v_emp, 'vinculosNuevos']) || to_jsonb(v_canon));
      else
        insert into movimientos (persona_dni, tipo, empresa_destino, vinculo_abierto,
          fecha_efecto, detalle, creado_por)
        values (v_canon, 'alta', v_emp, v_vinculo_nuevo, v_fecha,
          'Importación de padrón', p_por);
      end if;
    else
      -- Vínculo existente: cargo, centro de costo, área y fecha de ingreso
      -- se alinean al padrón; sede y todo lo que el archivo NO trae, intacto.
      select cargo into v_cargo_antes from vinculos where id = v_vinculo;
      select (centro_costo is distinct from f->>'centroCosto'
           or cargo is distinct from trim(f->>'cargo')
           or area_heredada is distinct from nullif(trim(f->>'areaHeredada'), '')
           or fecha_inicio is distinct from v_fecha)
        into v_cambio from vinculos where id = v_vinculo;
      if v_cambio then
        update vinculos set centro_costo = f->>'centroCosto', cargo = trim(f->>'cargo'),
          area_heredada = nullif(trim(f->>'areaHeredada'), ''), fecha_inicio = v_fecha
        where id = v_vinculo;
        if v_cargo_antes is distinct from trim(f->>'cargo') then
          -- Un cambio de cargo no cambia el perfil: genera aviso (spec §5).
          v_res := jsonb_set(v_res, array[v_emp, 'cargosCambiaron'],
            (v_res #> array[v_emp, 'cargosCambiaron']) || jsonb_build_object(
              'documento', v_canon, 'nombre', v_nombre,
              'antes', v_cargo_antes, 'ahora', trim(f->>'cargo')));
        end if;
      end if;
      agregar_a := case when v_cambio then 'actualizaciones' else 'sinCambio' end;
      v_res := jsonb_set(v_res, array[v_emp, agregar_a],
        (v_res #> array[v_emp, agregar_a]) || to_jsonb(v_canon));
    end if;
  end loop;

  -- POSIBLES CESES: vigentes de las empresas del archivo cuyo documento no
  -- aparece en NINGUNA fila. Solo se proponen; jamás cesar por ausencia.
  select coalesce(jsonb_agg(jsonb_build_object('documento', x.dni, 'nombre', x.nombre,
           'empresa', x.empresa_id, 'empresaNombre', x.emp_nombre) order by x.emp_nombre, x.nombre), '[]'::jsonb)
    into v_posibles
  from (
    select p.dni, p.nombre, v.empresa_id, e.nombre as emp_nombre
    from vinculos v
    join personas p on p.dni = v.persona_dni
    join empresas e on e.id = v.empresa_id
    where v.fecha_fin is null
      and v.empresa_id in (select value from jsonb_each_text(v_map))
      and regexp_replace(upper(p.dni), '^0+(?=.)', '') not in (
        select regexp_replace(upper(trim(f2->>'documento')), '^0+(?=.)', '')
        from jsonb_array_elements(p_filas) f2)
  ) x;

  -- CESES CONFIRMADOS por el usuario en la vista previa.
  for v_cese_doc in select jsonb_array_elements_text(p_ceses) loop
    v_vinculo := null;
    select v.id, v.persona_dni, v.empresa_id into v_vinculo, v_canon, v_emp_origen
    from vinculos v join personas p on p.dni = v.persona_dni
    where v.fecha_fin is null
      and regexp_replace(upper(p.dni), '^0+(?=.)', '') = regexp_replace(upper(trim(v_cese_doc)), '^0+(?=.)', '')
    limit 1;
    if v_vinculo is null then
      v_problemas := v_problemas || jsonb_build_object('documento', v_cese_doc, 'nombre', '',
        'motivo', 'Cese confirmado pero sin vínculo vigente: revísalo.');
      continue;
    end if;
    update vinculos set fecha_fin = greatest(fecha_inicio, current_date) where id = v_vinculo;
    insert into movimientos (persona_dni, tipo, empresa_origen, vinculo_cerrado,
      fecha_efecto, detalle, creado_por)
    values (v_canon, 'cese', v_emp_origen, v_vinculo,
      greatest((select fecha_inicio from vinculos where id = v_vinculo), current_date),
      'Cese confirmado en importación de padrón', p_por);
    if v_res ? v_emp_origen then
      v_res := jsonb_set(v_res, array[v_emp_origen, 'cesados'],
        coalesce(v_res #> array[v_emp_origen, 'cesados'], '[]'::jsonb) || to_jsonb(v_canon));
    end if;
  end loop;

  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('IMPORTAR_PADRON', 'importar_padron', null,
    jsonb_build_object('por', p_por, 'empresas', v_res,
      'problemas', v_problemas, 'ceses', p_ceses));

  return jsonb_build_object('empresas', v_res,
    'problemas', v_problemas, 'posiblesCeses', v_posibles);
end $$;

-- Vista previa sin escribir: patrón PV999 (rollback por errcode).
drop function if exists previsualizar_padron(jsonb, jsonb);
create function previsualizar_padron(p_filas jsonb, p_ceses jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare v jsonb;
begin
  v := importar_padron(p_filas, '(vista previa)', p_ceses);
  raise exception using errcode = 'PV999', message = v::text; -- revertir TODO
exception when sqlstate 'PV999' then
  return sqlerrm::jsonb;
end $$;
