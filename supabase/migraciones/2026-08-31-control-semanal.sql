-- Control semanal de asistencia (spec Tareas 31-08) — BD. Este archivo es el
-- canónico de importar_control / previsualizar_control / fn_recalcular_control.
--
--  · marcaciones se amplía: el control trae el día CLASIFICADO (tipo), la hora
--    de entrada, horas/exceso/déficit/tardanzas DECLARADAS y observación.
--    Las cifras declaradas conviven con las recalculadas (columna calc).
--  · La identidad es SIEMPRE el documento (DNI o CE) comparado quitando ceros
--    contra el padrón; la empresa de cada fila sale del vínculo vigente.
--    Un documento sin vínculo es una EXCEPCIÓN, no un alta.
--  · «Revisar» no es falta. «Dia del reporte» solo vale su tardanza.
--  · Tolerancia (configurable, no en código): las 3 primeras tardanzas del
--    mes tienen 30 min de gracia; cualquier tardanza consume un día de
--    tolerancia aunque quede perdonada por completo.
--  · Reimportar el mismo rango reemplaza, jamás duplica.

-- 1 · Estructura
alter table marcaciones
  add column if not exists tipo text
    check (tipo in ('laborable','sabado_libre','domingo_libre','sabado_trabajo',
                    'domingo_trabajo','feriado','reporte','revisar')),
  add column if not exists feriado_nombre text,
  add column if not exists min_trab int,
  add column if not exists min_exceso int,
  add column if not exists min_deficit int,
  add column if not exists tard_raw int,
  add column if not exists tard_efec int,
  add column if not exists observacion text,
  add column if not exists editado boolean not null default false,
  add column if not exists motivo_edicion text,
  add column if not exists origen text not null default 'reloj'
    check (origen in ('reloj','control')),
  add column if not exists calc jsonb,
  add column if not exists recalculado text;

alter table asistencia_config
  add column if not exists tolerancia_dias int not null default 3 check (tolerancia_dias >= 0),
  add column if not exists tolerancia_min  int not null default 30 check (tolerancia_min >= 0),
  add column if not exists jornada_min     int not null default 480 check (jornada_min > 0);

-- El lote del control abarca varias razones sociales: empresa_id pasa a ser
-- opcional y el origen distingue reloj/control.
alter table asistencia_lotes alter column empresa_id drop not null;
alter table asistencia_lotes
  add column if not exists origen text not null default 'reloj'
    check (origen in ('reloj','control'));

create index if not exists ix_marcaciones_doc_fecha on marcaciones (documento, fecha);

-- 2 · Utilitario «HH:MM» → minutos (null si vacío o ilegible).
create or replace function fn_min_hhmm(t text) returns int
language sql immutable as $$
  select case when t ~ '^\d{1,3}:[0-5]\d$'
              then split_part(t, ':', 1)::int * 60 + split_part(t, ':', 2)::int end
$$;

-- 3 · Recalculo propio de un documento en un rango. Guarda `calc` en cada
-- fila y devuelve las DIFERENCIAS contra lo declarado (no elige ganador).
-- La tolerancia corre por mes calendario, en orden cronológico. Un día
-- cubierto por una solicitud aprobada (con desde/hasta) o por un feriado del
-- calendario queda justificado: sin tardanza ni déficit; si p_motivo viene,
-- las filas se marcan «recalculado» con ese motivo.
create or replace function fn_recalcular_control(
  p_documento text, p_desde date, p_hasta date, p_motivo text default null
) returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare
  cfg record; r record;
  v_slots int := 0; v_mes text := '';
  v_raw int; v_efec int; v_trab int; v_exc int; v_def int;
  v_he int; v_just text; v_feriado text; v_tipo text;
  v_m1 int; v_m2 int; v_m3 int; v_m4 int;
  v_calc jsonb; v_difs jsonb := '[]'::jsonb;
begin
  select tolerancia_dias, tolerancia_min, jornada_min into cfg from asistencia_config;
  for r in select * from marcaciones
           where documento = p_documento and origen = 'control'
             and fecha between p_desde and p_hasta
           order by fecha loop
    if to_char(r.fecha, 'YYYY-MM') <> v_mes then
      v_mes := to_char(r.fecha, 'YYYY-MM'); v_slots := 0;
    end if;
    v_raw := null; v_efec := null; v_trab := null; v_exc := null; v_def := null;
    v_he := fn_min_hhmm(to_char(fn_hora_entrada(p_documento, r.fecha), 'HH24:MI'));
    v_m1 := fn_min_hhmm(r.m1); v_m2 := fn_min_hhmm(r.m2);
    v_m3 := fn_min_hhmm(r.m3); v_m4 := fn_min_hhmm(r.m4);

    select s.numero into v_just from solicitudes s
    where s.solicitante_dni = p_documento and s.estado = 'aprobada'
      and coalesce(s.datos->>'desde', '') <> '' and coalesce(s.datos->>'hasta', '') <> ''
      and r.fecha between (s.datos->>'desde')::date and (s.datos->>'hasta')::date
    limit 1;
    select nombre into v_feriado from feriados where fecha = r.fecha;

    v_tipo := case
      when v_just is not null then 'justificado'
      when v_feriado is not null and r.tipo in ('laborable','revisar','reporte') then 'feriado'
      else r.tipo end;

    if v_tipo in ('laborable','reporte') and v_he is not null and v_m1 is not null then
      v_raw := greatest(v_m1 - v_he, 0);
      if v_raw > 0 then
        if v_slots < cfg.tolerancia_dias then
          v_slots := v_slots + 1;                       -- consume día de tolerancia
          v_efec := greatest(v_raw - cfg.tolerancia_min, 0);
        else
          v_efec := v_raw;                              -- a partir de la cuarta, sin gracia
        end if;
      else
        v_efec := 0;
      end if;
    end if;

    -- Horas solo verificables con las cuatro marcas (spec §3); el fin de
    -- semana trabajado registra horas sin exceso ni déficit.
    if v_m1 is not null and v_m2 is not null and v_m3 is not null and v_m4 is not null then
      if v_tipo = 'laborable' then
        v_trab := (v_m2 - v_m1) + (v_m4 - v_m3);
        v_exc := greatest(v_trab - cfg.jornada_min, 0);
        v_def := greatest(cfg.jornada_min - v_trab, 0);
      elsif v_tipo in ('sabado_trabajo','domingo_trabajo') then
        v_trab := (v_m2 - v_m1) + (v_m4 - v_m3);
      end if;
    end if;

    v_calc := jsonb_build_object(
      'tipoEfectivo', v_tipo, 'justificadoPor', v_just, 'feriado', v_feriado,
      'tardRaw', v_raw, 'tardEfec', v_efec,
      'minTrab', v_trab, 'minExceso', v_exc, 'minDeficit', v_def,
      'sinHora', (v_he is null and v_tipo in ('laborable','reporte')));

    update marcaciones set calc = v_calc,
      recalculado = case when v_tipo is distinct from r.tipo
                         then coalesce(p_motivo, recalculado) else recalculado end
    where empresa_id = r.empresa_id and documento = r.documento and fecha = r.fecha;

    -- Diferencias declarado vs recalculado, SOLO si el día no fue
    -- reclasificado (una reclasificación cambia las reglas, no es un error).
    if v_tipo = r.tipo then
      if v_raw is not null and r.tard_raw is not null and v_raw <> r.tard_raw then
        v_difs := v_difs || jsonb_build_object('documento', p_documento, 'fecha', r.fecha,
          'concepto', 'Tardanza cruda (min)', 'declarado', r.tard_raw, 'calculado', v_raw);
      end if;
      if v_efec is not null and r.tard_efec is not null and v_efec <> r.tard_efec then
        v_difs := v_difs || jsonb_build_object('documento', p_documento, 'fecha', r.fecha,
          'concepto', 'Tardanza efectiva (min)', 'declarado', r.tard_efec, 'calculado', v_efec);
      end if;
      if v_trab is not null and r.min_trab is not null and v_trab <> r.min_trab then
        v_difs := v_difs || jsonb_build_object('documento', p_documento, 'fecha', r.fecha,
          'concepto', 'Horas trabajadas (min)', 'declarado', r.min_trab, 'calculado', v_trab);
      end if;
      if v_exc is not null and r.min_exceso is not null and v_exc <> r.min_exceso then
        v_difs := v_difs || jsonb_build_object('documento', p_documento, 'fecha', r.fecha,
          'concepto', 'Exceso (min)', 'declarado', r.min_exceso, 'calculado', v_exc);
      end if;
      if v_def is not null and r.min_deficit is not null and v_def <> r.min_deficit then
        v_difs := v_difs || jsonb_build_object('documento', p_documento, 'fecha', r.fecha,
          'concepto', 'Déficit (min)', 'declarado', r.min_deficit, 'calculado', v_def);
      end if;
    end if;
  end loop;
  return v_difs;
end $$;

-- 4 · Importación del control semanal. p_trabajadores: [{documento,
-- docSinCeros, nombreArchivo, he}], p_registros: filas del parser.
drop function if exists importar_control(jsonb, jsonb, text, text);
create function importar_control(
  p_registros jsonb, p_trabajadores jsonb, p_archivo text, p_por text
) returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_correo text; v_super boolean; v_alcance jsonb;
  t jsonb; f jsonb; r record;
  v_matches text[]; v_canon text; v_emp text;
  v_mapa jsonb := '{}'::jsonb;        -- docSinCeros → {canon, empresa}
  v_excepciones jsonb := '[]'::jsonb;
  v_discrepancias jsonb := '[]'::jsonb;
  v_sin_hora jsonb := '[]'::jsonb;
  v_pobladas jsonb := '[]'::jsonb;
  v_por_empresa jsonb := '{}'::jsonb;
  v_desde date; v_hasta date; v_filas int := 0;
  v_actual time; v_dif jsonb; v_difs jsonb := '[]'::jsonb;
  v_lote bigint; v_docs text[] := '{}';
begin
  if fn_nivel_modulo('asistencia') < 2 then
    raise exception 'Tu categoría no permite importar asistencias (requiere nivel de acción en Asistencia).';
  end if;
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

  select min((f2->>'fecha')::date), max((f2->>'fecha')::date), count(*)::int
    into v_desde, v_hasta, v_filas
  from jsonb_array_elements(p_registros) f2;
  if v_filas = 0 then raise exception 'El control no trae filas importables.'; end if;

  -- Identidad: documento contra el padrón quitando ceros; la empresa sale
  -- del vínculo vigente. Sin padrón no hay fila: excepción, jamás un alta.
  for t in select * from jsonb_array_elements(p_trabajadores) loop
    select array_agg(dni) into v_matches from personas
    where regexp_replace(upper(dni), '^0+(?=.)', '') = upper(t->>'docSinCeros');
    if v_matches is null then
      v_excepciones := v_excepciones || jsonb_build_object('documento', t->>'documento',
        'nombre', t->>'nombreArchivo', 'motivo', 'No está en el padrón: repórtalo, no se importa en silencio.');
      continue;
    end if;
    if cardinality(v_matches) > 1 then
      v_excepciones := v_excepciones || jsonb_build_object('documento', t->>'documento',
        'nombre', t->>'nombreArchivo', 'motivo', 'Coincide con más de una persona del maestro: resuélvelo a mano.');
      continue;
    end if;
    v_canon := v_matches[1];
    select vi.empresa_id into v_emp from vinculos vi
    where vi.persona_dni = v_canon and vi.fecha_fin is null
    order by vi.fecha_inicio desc limit 1;
    if v_emp is null then
      v_excepciones := v_excepciones || jsonb_build_object('documento', t->>'documento',
        'nombre', t->>'nombreArchivo', 'motivo', 'Está en el maestro pero sin vínculo vigente.');
      continue;
    end if;
    if not coalesce(v_super, false) and not (coalesce(v_alcance, '[]'::jsonb) ? v_emp) then
      raise exception 'El control incluye trabajadores de una razón social fuera de tu alcance: importación rechazada completa.';
    end if;
    v_mapa := v_mapa || jsonb_build_object(upper(t->>'docSinCeros'),
      jsonb_build_object('canon', v_canon, 'empresa', v_emp));
    v_docs := v_docs || v_canon;
    v_por_empresa := jsonb_set(v_por_empresa, array[v_emp],
      to_jsonb(coalesce((v_por_empresa->>v_emp)::int, 0) + 1));

    -- Hora de entrada: la primera importación la puebla en la ficha; las
    -- siguientes contrastan y REPORTAN — la importación no decide cuál vale.
    if coalesce(t->>'he', '') <> '' then
      v_actual := fn_hora_entrada(v_canon, v_desde);
      if v_actual is null then
        insert into horarios_entrada (persona_dni, vigente_desde, hora, creado_por)
        values (v_canon, v_desde, (t->>'he')::time, p_por)
        on conflict (persona_dni, vigente_desde) do update set hora = excluded.hora;
        v_pobladas := v_pobladas || to_jsonb(v_canon);
      elsif to_char(v_actual, 'HH24:MI') <> (t->>'he') then
        v_discrepancias := v_discrepancias || jsonb_build_object('documento', v_canon,
          'nombre', (select nombre from personas where dni = v_canon),
          'ficha', to_char(v_actual, 'HH24:MI'), 'archivo', t->>'he',
          'motivo', 'O cambió de horario y hay que actualizar la ficha, o el archivo tiene un error.');
      end if;
    else
      v_sin_hora := v_sin_hora || jsonb_build_object('documento', v_canon,
        'nombre', (select nombre from personas where dni = v_canon));
    end if;
  end loop;

  -- Reemplazo por rango (idempotente) + inserción, SOLO de los resueltos.
  delete from marcaciones
  where origen = 'control' and documento = any(v_docs)
    and fecha between v_desde and v_hasta;

  for f in select * from jsonb_array_elements(p_registros) loop
    if not v_mapa ? upper(f->>'docSinCeros') then continue; end if;
    v_canon := v_mapa #>> array[upper(f->>'docSinCeros'), 'canon'];
    v_emp   := v_mapa #>> array[upper(f->>'docSinCeros'), 'empresa'];
    insert into marcaciones (empresa_id, documento, fecha, m1, m2, m3, m4,
      tipo, feriado_nombre, min_trab, min_exceso, min_deficit,
      tard_raw, tard_efec, observacion, editado, motivo_edicion, origen)
    values (v_emp, v_canon, (f->>'fecha')::date,
      nullif(f->>'m1', ''), nullif(f->>'m2', ''), nullif(f->>'m3', ''), nullif(f->>'m4', ''),
      f->>'tipo', nullif(f->>'feriadoNombre', ''),
      (f->>'minTrab')::int, (f->>'minExceso')::int, (f->>'minDeficit')::int,
      (f->>'tardRaw')::int, (f->>'tardEfec')::int,
      nullif(f->>'observacion', ''), coalesce((f->>'editado')::boolean, false),
      nullif(f->>'motivoEdicion', ''), 'control')
    on conflict (empresa_id, documento, fecha) do update set
      m1 = excluded.m1, m2 = excluded.m2, m3 = excluded.m3, m4 = excluded.m4,
      tipo = excluded.tipo, feriado_nombre = excluded.feriado_nombre,
      min_trab = excluded.min_trab, min_exceso = excluded.min_exceso,
      min_deficit = excluded.min_deficit, tard_raw = excluded.tard_raw,
      tard_efec = excluded.tard_efec, observacion = excluded.observacion,
      editado = excluded.editado, motivo_edicion = excluded.motivo_edicion,
      origen = 'control', calc = null, recalculado = null;
  end loop;

  insert into asistencia_lotes (empresa_id, archivo, rango_desde, rango_hasta,
                                trabajadores, filas, anomalias, creado_por, origen)
  values (null, p_archivo, v_desde, v_hasta, cardinality(v_docs), v_filas,
          v_excepciones, p_por, 'control')
  returning id into v_lote;
  update marcaciones set lote_id = v_lote
  where origen = 'control' and documento = any(v_docs) and fecha between v_desde and v_hasta;

  -- Recalculo propio de cada trabajador: las cifras declaradas y las
  -- calculadas conviven; si difieren se muestra, no se elige ganador.
  for t in select distinct value from jsonb_array_elements(to_jsonb(v_docs)) loop
    v_dif := fn_recalcular_control(t #>> '{}', v_desde, v_hasta, null);
    v_difs := v_difs || v_dif;
  end loop;

  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('IMPORTAR_CONTROL', 'marcaciones', null,
    jsonb_build_object('por', p_por, 'archivo', p_archivo, 'desde', v_desde,
      'hasta', v_hasta, 'trabajadores', cardinality(v_docs), 'filas', v_filas,
      'excepciones', v_excepciones));

  return jsonb_build_object(
    'desde', to_char(v_desde, 'YYYY-MM-DD'), 'hasta', to_char(v_hasta, 'YYYY-MM-DD'),
    'lote', v_lote, 'filas', v_filas, 'trabajadores', cardinality(v_docs),
    'porEmpresa', v_por_empresa, 'excepciones', v_excepciones,
    'horasPobladas', v_pobladas, 'discrepanciasHora', v_discrepancias,
    'sinHora', v_sin_hora, 'diferencias', v_difs);
end $$;

drop function if exists previsualizar_control(jsonb, jsonb, text);
create function previsualizar_control(p_registros jsonb, p_trabajadores jsonb, p_archivo text)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare v jsonb;
begin
  v := importar_control(p_registros, p_trabajadores, p_archivo, '(vista previa)');
  raise exception using errcode = 'PV999', message = v::text; -- revertir TODO
exception when sqlstate 'PV999' then
  return sqlerrm::jsonb;
end $$;

-- 5 · Lecturas (drop: cambian columnas intermedias y replace no lo permite)
drop view if exists v_asistencia_lotes;
drop view if exists v_marcaciones;
create view v_asistencia_lotes as
select l.id, l.empresa_id as empresa,
       coalesce(e.nombre, 'Todo el grupo') as empresa_nombre,
       l.origen, l.archivo,
       to_char(l.rango_desde, 'YYYY-MM-DD') as desde,
       to_char(l.rango_hasta, 'YYYY-MM-DD') as hasta,
       l.trabajadores, l.filas, l.anomalias, l.creado_por,
       to_char(l.creado_en, 'YYYY-MM-DD HH24:MI') as creado_en
from asistencia_lotes l
left join empresas e on e.id = l.empresa_id
order by l.id desc;

create view v_marcaciones as
select m.empresa_id as empresa, m.documento, p.nombre,
       (p.dni is not null) as reconocido,
       to_char(m.fecha, 'YYYY-MM-DD') as fecha,
       m.m1, m.m2, m.m3, m.m4, m.lote_id,
       m.tipo, m.feriado_nombre as "feriadoNombre",
       m.min_trab as "minTrab", m.min_exceso as "minExceso",
       m.min_deficit as "minDeficit", m.tard_raw as "tardRaw",
       m.tard_efec as "tardEfec", m.observacion, m.editado,
       m.motivo_edicion as "motivoEdicion", m.origen, m.calc, m.recalculado
from marcaciones m
left join personas p on p.dni = m.documento;

-- Tablero mensual: agrupa por la MISMA llave que Personal (centro de costo
-- del vínculo vigente); el alcance por razón social lo aplica la pantalla
-- sobre la columna empresa (y la BD sobre el selector del Shell).
create or replace view v_asistencia_mensual as
select m.documento, coalesce(p.nombre, m.documento) as nombre,
       m.empresa_id as empresa,
       vi.centro_costo as "centroCosto",
       to_char(m.fecha, 'YYYY-MM') as periodo,
       count(*) filter (where m.tipo = 'laborable') as laborables,
       count(*) filter (where m.tipo = 'revisar'
                          and coalesce(m.calc->>'tipoEfectivo', 'revisar') = 'revisar') as revisar,
       count(*) filter (where m.tipo in ('sabado_trabajo','domingo_trabajo')) as "finSemana",
       sum(coalesce(m.min_trab, 0))::int as "minTrab",
       sum(coalesce(m.tard_raw, 0))::int as "tardRaw",
       sum(coalesce(m.tard_efec, 0))::int as "tardEfec",
       count(*) filter (where coalesce(m.tard_efec, 0) > 0) as "diasTardanza",
       count(*) filter (where m.recalculado is not null) as recalculados,
       count(*) filter (where m.editado) as editados,
       (fn_hora_entrada(m.documento) is null) as "sinHora",
       to_char(fn_hora_entrada(m.documento), 'HH24:MI') as "horaEntrada"
from marcaciones m
left join personas p on p.dni = m.documento
left join vinculos vi on vi.persona_dni = m.documento
  and vi.empresa_id = m.empresa_id and vi.fecha_fin is null
where m.origen = 'control'
group by m.documento, p.nombre, m.empresa_id, vi.centro_costo, to_char(m.fecha, 'YYYY-MM');

grant select on v_asistencia_lotes, v_marcaciones, v_asistencia_mensual to authenticated;
