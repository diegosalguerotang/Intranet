-- Movimientos de planilla (2026-08-24): historial de altas, traslados,
-- ceses y retornos en el perfil del trabajador. Decisiones de Diego:
-- el traslado de RS SIEMPRE cierra el vínculo anterior; el cese JAMÁS es
-- automático (la ausencia solo propone, un humano confirma en la vista
-- previa); todo movimiento queda como historial inmutable en el legajo.
-- Parte 1: tabla insert-only + vistas. (Parte 2, las RPC v2, más abajo.)

create table if not exists movimientos (
  id              bigint generated always as identity primary key,
  persona_dni     text not null references personas(dni),
  tipo            text not null check (tipo in ('alta','traslado','cese','retorno')),
  empresa_origen  text references empresas(id),   -- traslado/cese
  empresa_destino text references empresas(id),   -- alta/traslado/retorno
  vinculo_cerrado bigint references vinculos(id),
  vinculo_abierto bigint references vinculos(id),
  fecha_efecto    date not null,
  periodo         text,                            -- 'YYYY-MM' de la planilla origen
  detalle         text,
  creado_por      text not null,
  creado_en       timestamptz not null default now()
);
create index if not exists ix_movimientos_persona on movimientos (persona_dni, creado_en desc);

create or replace function fn_movimientos_solo_insertar() returns trigger
language plpgsql as $$
begin
  raise exception 'El historial de movimientos no se edita ni se borra.';
end $$;
drop trigger if exists tg_movimientos_inmutables on movimientos;
create trigger tg_movimientos_inmutables
  before update or delete on movimientos
  for each row execute function fn_movimientos_solo_insertar();

-- Historial completo de vínculos de una persona, con nombres.
create or replace view v_vinculos_persona as
select v.id, v.persona_dni as dni, v.empresa_id as empresa,
       e.nombre as "empresaNombre", s.nombre as "sedeNombre",
       v.cargo, v.centro_costo as "centroCosto", v.contrato,
       to_char(v.fecha_inicio, 'YYYY-MM-DD') as inicio,
       to_char(v.fecha_fin, 'YYYY-MM-DD') as fin,
       (v.fecha_fin is null) as vigente
from vinculos v
join empresas e on e.id = v.empresa_id
join sedes s on s.id = v.sede_id
order by v.fecha_inicio desc, v.id desc;

create or replace view v_movimientos_persona as
select m.id, m.persona_dni as dni, m.tipo,
       eo.nombre as "deEmpresa", ed.nombre as "aEmpresa",
       to_char(m.fecha_efecto, 'YYYY-MM-DD') as fecha,
       m.periodo, m.detalle, m.creado_por as por,
       to_char(m.creado_en, 'YYYY-MM-DD HH24:MI') as registrado
from movimientos m
left join empresas eo on eo.id = m.empresa_origen
left join empresas ed on ed.id = m.empresa_destino
order by m.creado_en desc;

grant select on v_vinculos_persona, v_movimientos_persona to anon, authenticated;
revoke all on movimientos from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Parte 2: importar_planilla_unificada v2 — traslados que CIERRAN el vínculo
-- anterior, retornos, y ceses SOLO confirmados (p_ceses). Corte por defecto:
-- último día del mes anterior al período, jamás antes del inicio del vínculo.
-- ---------------------------------------------------------------------------
drop function if exists importar_planilla_unificada(jsonb, text, text);
drop function if exists importar_planilla_unificada(jsonb, text, text, jsonb);
create function importar_planilla_unificada(p_filas jsonb, p_periodo text, p_por text, p_ceses jsonb default '[]'::jsonb)
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
  -- Movimientos (2026-08-24):
  v_vinculo_otro bigint; v_emp_origen text; v_vinculo_nuevo bigint;
  v_es_retorno boolean; v_cierre date; v_posibles jsonb := '[]'::jsonb;
  v_cese_doc text;
begin
  if p_periodo is null or p_periodo !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'La importación necesita el período (AAAA-MM).';
  end if;
  v_cierre := (p_periodo || '-01')::date - 1;

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
      'sinCambio', '[]'::jsonb, 'cambiosCuenta', '[]'::jsonb,
      'traslados', '[]'::jsonb, 'retornos', '[]'::jsonb, 'cesados', '[]'::jsonb));
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
      -- La hoja unificada no trunca por ancho de columna: sus nombres son
      -- completos. Adoptar (más largo) o coincidir exacto CONFIRMA el nombre
      -- y limpia nombre_por_confirmar; un nombre distinto que no se adopta
      -- deja la marca como está.
      update personas set
        nombre = case when fn_es_prefijo_truncado(v_nombre, nombre) then nombre
                      when length(v_nombre) > length(nombre) then v_nombre else nombre end,
        nombre_por_confirmar = case
          when not fn_es_prefijo_truncado(v_nombre, nombre)
               and (length(v_nombre) > length(nombre) or v_nombre = nombre)
            then false
          else nombre_por_confirmar end,
        banco = v_banco_nombre,
        banco_id = f->>'bancoCodigo',
        cuenta_cifrada = case when v_cuenta_cambio then fn_cifrar_cuenta(v_cuenta) else cuenta_cifrada end,
        cuenta_ultimos4 = v_u4
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

    select id into v_vinculo from vinculos
    where persona_dni = v_canon and empresa_id = v_emp and fecha_fin is null;
    if v_vinculo is null then
      -- SEDE vacía → sede «Por asignar» de la empresa; FECHA vacía → primer
      -- día del período (referencial, solo para vínculos NUEVOS).
      v_sede := fn_sede_para_importacion(v_emp, coalesce(nullif(trim(f->>'sede'), ''), 'Por asignar'), null);
      v_fecha := coalesce(nullif(trim(f->>'fechaIngreso'), '')::date, (p_periodo || '-01')::date);
      insert into vinculos (persona_dni, empresa_id, sede_id, cargo, centro_costo, contrato, fecha_inicio)
      values (v_canon, v_emp, v_sede, 'Por definir', v_cc, nullif(trim(f->>'contrato'), ''), v_fecha)
      returning id into v_vinculo_nuevo;
      if v_vinculo_otro is not null then
        -- TRASLADO: cerrar el vínculo anterior (decisión de Diego 2026-08-24).
        update vinculos set fecha_fin = greatest(fecha_inicio, v_cierre) where id = v_vinculo_otro;
        insert into movimientos (persona_dni, tipo, empresa_origen, empresa_destino,
          vinculo_cerrado, vinculo_abierto, fecha_efecto, periodo, detalle, creado_por)
        values (v_canon, 'traslado', v_emp_origen, v_emp, v_vinculo_otro, v_vinculo_nuevo,
          greatest((select fecha_inicio from vinculos where id = v_vinculo_otro), v_cierre),
          p_periodo, 'Importación de planilla', p_por);
        v_res := jsonb_set(v_res, array[v_emp, 'traslados'], (v_res #> array[v_emp, 'traslados'])
          || jsonb_build_object('documento', v_canon, 'nombre', v_nombre,
               'desde', (select nombre from empresas where id = v_emp_origen)));
      elsif v_es_retorno then
        insert into movimientos (persona_dni, tipo, empresa_destino, vinculo_abierto,
          fecha_efecto, periodo, detalle, creado_por)
        values (v_canon, 'retorno', v_emp, v_vinculo_nuevo, v_fecha, p_periodo,
          'Importación de planilla', p_por);
        v_res := jsonb_set(v_res, array[v_emp, 'retornos'],
          (v_res #> array[v_emp, 'retornos']) || to_jsonb(v_canon));
      elsif v_matches is not null then
        v_res := jsonb_set(v_res, array[v_emp, 'vinculosNuevos'],
          (v_res #> array[v_emp, 'vinculosNuevos']) || to_jsonb(v_canon));
      else
        -- Alta nueva del maestro: también al historial.
        insert into movimientos (persona_dni, tipo, empresa_destino, vinculo_abierto,
          fecha_efecto, periodo, detalle, creado_por)
        values (v_canon, 'alta', v_emp, v_vinculo_nuevo, v_fecha, p_periodo,
          'Importación de planilla', p_por);
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

  -- POSIBLES CESES: vigentes de las empresas del archivo cuyo documento no
  -- aparece en NINGUNA fila (si apareció en otra RS ya fue traslado). Solo se
  -- proponen: el cese lo confirma un humano en p_ceses. Jamás cesar por ausencia.
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
    update vinculos set fecha_fin = greatest(fecha_inicio, v_cierre) where id = v_vinculo;
    insert into movimientos (persona_dni, tipo, empresa_origen, vinculo_cerrado,
      fecha_efecto, periodo, detalle, creado_por)
    values (v_canon, 'cese', v_emp_origen, v_vinculo,
      greatest((select fecha_inicio from vinculos where id = v_vinculo), v_cierre),
      p_periodo, 'Cese confirmado en importación de planilla', p_por);
    if v_res ? v_emp_origen then
      v_res := jsonb_set(v_res, array[v_emp_origen, 'cesados'],
        coalesce(v_res #> array[v_emp_origen, 'cesados'], '[]'::jsonb) || to_jsonb(v_canon));
    end if;
  end loop;

  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('IMPORTAR_PLANILLA_UNIFICADA', 'importar_planilla_unificada', null,
    jsonb_build_object('por', p_por, 'periodo', p_periodo,
      'empresas', v_res, 'problemas', v_problemas, 'ceses', p_ceses));

  return jsonb_build_object('periodo', p_periodo, 'empresas', v_res,
    'problemas', v_problemas, 'posiblesCeses', v_posibles);
end $$;

-- Vista previa sin escribir: mismo patrón PV999; passthrough de p_ceses para
-- que el resumen refleje lo que pasará (nada se aplica).
drop function if exists previsualizar_planilla_unificada(jsonb, text);
drop function if exists previsualizar_planilla_unificada(jsonb, text, jsonb);
create function previsualizar_planilla_unificada(p_filas jsonb, p_periodo text, p_ceses jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer as $$
declare v jsonb;
begin
  v := importar_planilla_unificada(p_filas, p_periodo, '(vista previa)', p_ceses);
  raise exception using errcode = 'PV999', message = v::text; -- revertir TODO
exception when sqlstate 'PV999' then
  return sqlerrm::jsonb;
end $$;
