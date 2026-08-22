-- 2026-08-21 · Asistencia (fase 2): RPCs de importación y vistas de lectura.
-- Las tablas (marcaciones, asistencia_lotes, asistencia_config) son del
-- groundwork 2026-08-21-asistencia.sql. Patrón importar_activos + PV999.
-- Idempotente.

-- Importación transaccional con REEMPLAZO POR RANGO: reimportar el mismo
-- periodo sustituye lo que había (jamás duplica). La resolución de códigos
-- contra el maestro compara QUITANDO CEROS a la izquierda (decisión Diego
-- 2026-08-21: DNI 7→8 y CE 003308122 resuelven igual); documento guardado =
-- dni canónico del maestro si resuelve, si no el código sin ceros.
create or replace function importar_asistencia(
  p_empresa text, p_registros jsonb, p_archivo text, p_resumen jsonb, p_por text
) returns jsonb language plpgsql security definer as $$
declare
  v_lote bigint; v_desde date; v_hasta date; v_filas int;
  v_reconocidos int; v_no_reconocidos text[];
begin
  if fn_nivel_modulo('asistencia') < 2 then
    raise exception 'Tu categoría no permite importar asistencias (requiere nivel de acción en el módulo Asistencia).';
  end if;
  if (select estado from empresas where id = p_empresa) is distinct from 'activa' then
    raise exception 'La empresa % no está activa: importación rechazada completa.', p_empresa;
  end if;
  if p_registros is null or jsonb_array_length(p_registros) = 0 then
    raise exception 'El archivo no trae filas de marcación importables.';
  end if;

  drop table if exists tmp_asist; drop table if exists tmp_doc;
  -- with ordinality: conserva el orden del archivo (ord) para poder decidir
  -- después, ante una colisión de mismo canónico+fecha, cuál fila es "la
  -- última" sin depender de ON CONFLICT (ver INSERT más abajo).
  create temp table tmp_asist on commit drop as
  select trim(x->>'codigo')                as codigo,
         ltrim(trim(x->>'codigo'), '0')    as canonico,
         (x->>'fecha')::date               as fecha,
         nullif(trim(coalesce(x->>'m1','')), '') as m1,
         nullif(trim(coalesce(x->>'m2','')), '') as m2,
         nullif(trim(coalesce(x->>'m3','')), '') as m3,
         nullif(trim(coalesce(x->>'m4','')), '') as m4,
         ord
  from jsonb_array_elements(p_registros) with ordinality as t(x, ord);

  select min(fecha), max(fecha), count(*)::int into v_desde, v_hasta, v_filas from tmp_asist;
  -- Defensa del servidor: el parser ya descartó los días futuros en el cliente.
  if v_hasta > current_date then
    raise exception 'El archivo trae marcaciones de fechas futuras (%): no se importa nada.', v_hasta;
  end if;

  -- Mapa código→documento: personas con vínculo (vigente o histórico) en la
  -- empresa elegida. distinct on: si dos dni del maestro colapsan al mismo
  -- canónico (no debería pasar), gana uno y no revienta la importación.
  create temp table tmp_doc on commit drop as
  select distinct on (ltrim(p.dni, '0')) ltrim(p.dni, '0') as canonico, p.dni
  from personas p
  where exists (select 1 from vinculos v
                where v.persona_dni = p.dni and v.empresa_id = p_empresa)
  order by ltrim(p.dni, '0'), p.dni;

  select count(distinct t.canonico) into v_reconocidos
  from tmp_asist t join tmp_doc d using (canonico);
  if v_reconocidos = 0 then
    raise exception 'Ningún código del archivo corresponde a un trabajador de esta empresa: revisa que hayas elegido la razón social correcta.';
  end if;
  select coalesce(array_agg(distinct t.codigo), '{}') into v_no_reconocidos
  from tmp_asist t left join tmp_doc d using (canonico) where d.dni is null;

  insert into asistencia_lotes (empresa_id, archivo, rango_desde, rango_hasta,
                                trabajadores, filas, anomalias, creado_por)
  values (p_empresa, p_archivo, v_desde, v_hasta,
          (select count(distinct canonico) from tmp_asist), v_filas,
          coalesce(p_resumen, '{}'::jsonb), p_por)
  returning id into v_lote;

  -- Reemplazo por rango: lo que había de esa empresa en el periodo se va.
  delete from marcaciones where empresa_id = p_empresa and fecha between v_desde and v_hasta;

  -- Si dos códigos del archivo resuelven a la misma persona y fecha (p. ej.
  -- 9972665 y 09972665), no se puede usar ON CONFLICT DO UPDATE: dentro de
  -- un mismo INSERT, Postgres no permite que la cláusula afecte la misma
  -- fila dos veces ("ON CONFLICT DO UPDATE command cannot affect row a
  -- second time") y como el DELETE por rango ya barrió lo previo, ese es el
  -- único caso en que se podría disparar. Se resuelve antes del INSERT:
  -- nos quedamos con la fila de mayor `ord` (la última del archivo) por
  -- (documento, fecha) — "la última fila manda", sin depender de conflicto.
  insert into marcaciones (empresa_id, documento, fecha, m1, m2, m3, m4, lote_id)
  select p_empresa, dedup.documento, dedup.fecha, dedup.m1, dedup.m2, dedup.m3, dedup.m4, v_lote
  from (
    select distinct on (coalesce(d.dni, t.canonico), t.fecha)
           coalesce(d.dni, t.canonico) as documento, t.fecha, t.m1, t.m2, t.m3, t.m4
    from tmp_asist t left join tmp_doc d using (canonico)
    order by coalesce(d.dni, t.canonico), t.fecha, t.ord desc
  ) dedup;

  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('IMPORTAR_ASISTENCIA', 'marcaciones', null,
    jsonb_build_object('por', p_por, 'empresa', p_empresa, 'archivo', p_archivo,
      'lote', v_lote, 'desde', v_desde, 'hasta', v_hasta, 'filas', v_filas,
      'reconocidos', v_reconocidos, 'no_reconocidos', to_jsonb(v_no_reconocidos)));

  return jsonb_build_object('lote', v_lote,
    'desde', to_char(v_desde, 'YYYY-MM-DD'), 'hasta', to_char(v_hasta, 'YYYY-MM-DD'),
    'filas', v_filas, 'reconocidos', v_reconocidos,
    'no_reconocidos', to_jsonb(v_no_reconocidos));
end $$;

-- Vista previa sin rastro: mismo patrón PV999 verificado de los otros importadores.
create or replace function previsualizar_asistencia(
  p_empresa text, p_registros jsonb, p_archivo text, p_resumen jsonb
) returns jsonb language plpgsql security definer as $$
declare v jsonb;
begin
  v := importar_asistencia(p_empresa, p_registros, p_archivo, p_resumen, '(vista previa)');
  raise exception using errcode = 'PV999', message = v::text; -- revertir TODO
exception when sqlstate 'PV999' then
  return sqlerrm::jsonb;
end $$;

-- Lecturas: la interfaz nunca lee tablas crudas cuando hay contrato de datos.
create or replace view v_asistencia_lotes as
select l.id, l.empresa_id as empresa, e.nombre as empresa_nombre, l.archivo,
       to_char(l.rango_desde, 'YYYY-MM-DD') as desde,
       to_char(l.rango_hasta, 'YYYY-MM-DD') as hasta,
       l.trabajadores, l.filas, l.anomalias, l.creado_por,
       to_char(l.creado_en, 'YYYY-MM-DD HH24:MI') as creado_en
from asistencia_lotes l
join empresas e on e.id = l.empresa_id
order by l.id desc;

create or replace view v_marcaciones as
select m.empresa_id as empresa, m.documento, p.nombre,
       (p.dni is not null) as reconocido,
       to_char(m.fecha, 'YYYY-MM-DD') as fecha,
       m.m1, m.m2, m.m3, m.m4, m.lote_id
from marcaciones m
left join personas p on p.dni = m.documento;
