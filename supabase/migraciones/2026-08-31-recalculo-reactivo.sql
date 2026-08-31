-- Recálculo reactivo del control semanal (spec Tareas 31-08 §6): cuando
-- cambia algo que afecta un día ya importado —una solicitud aprobada, un
-- feriado agregado o retirado— se recalcula SOLO lo afectado y se marca
-- «recalculado» indicando qué lo cambió. Es la razón principal de guardar
-- las marcaciones y no solo los totales. Este archivo pasa a ser el
-- canónico de fn_recalcular_control (mejora sobre 2026-08-31-control-semanal:
-- la marca «recalculado» se pone cuando el CÁLCULO cambió, no solo el tipo).

-- 1 · fn_recalcular_control v2
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
      recalculado = case when p_motivo is not null and v_calc is distinct from r.calc
                         then p_motivo else recalculado end
    where empresa_id = r.empresa_id and documento = r.documento and fecha = r.fecha;

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

-- 2 · Solicitud APROBADA con rango de fechas → recalcular los meses tocados
-- del solicitante (la tolerancia corre por mes: se recalcula el mes entero,
-- pero solo cambian —y se marcan— los días cuyo cálculo cambió).
create or replace function fn_solicitud_recalcula_asistencia() returns trigger
language plpgsql security definer
set search_path = public, extensions as $$
declare v_desde date; v_hasta date;
begin
  if new.estado = 'aprobada' and old.estado is distinct from 'aprobada'
     and coalesce(new.datos->>'desde', '') <> '' and coalesce(new.datos->>'hasta', '') <> '' then
    v_desde := date_trunc('month', (new.datos->>'desde')::date)::date;
    v_hasta := (date_trunc('month', (new.datos->>'hasta')::date) + interval '1 month - 1 day')::date;
    perform fn_recalcular_control(new.solicitante_dni, v_desde, v_hasta,
      'Solicitud ' || new.numero || ' aprobada');
  end if;
  return new;
end $$;
drop trigger if exists tg_solicitud_recalcula_asistencia on solicitudes;
create trigger tg_solicitud_recalcula_asistencia
  after update on solicitudes
  for each row execute function fn_solicitud_recalcula_asistencia();

-- 3 · Feriados ADMINISTRADOS: alta y baja con recálculo del mes afectado
-- para todos los que tengan control importado ese día/mes.
create or replace function fn_recalcular_mes_feriado(p_fecha date, p_motivo text)
returns int language plpgsql security definer
set search_path = public, extensions as $$
declare v_doc text; v_n int := 0;
  v_desde date := date_trunc('month', p_fecha)::date;
  v_hasta date := (date_trunc('month', p_fecha) + interval '1 month - 1 day')::date;
begin
  for v_doc in select distinct documento from marcaciones
               where origen = 'control' and fecha between v_desde and v_hasta loop
    perform fn_recalcular_control(v_doc, v_desde, v_hasta, p_motivo);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function guardar_feriado(p_fecha date, p_nombre text, p_por text)
returns int language plpgsql security definer
set search_path = public, extensions as $$
declare v_n int;
begin
  if fn_nivel_modulo('configuracion') < 2 and fn_nivel_modulo('asistencia') < 2 then
    raise exception 'Tu categoría no permite administrar el calendario de feriados.';
  end if;
  if coalesce(trim(p_nombre), '') = '' then
    raise exception 'El feriado necesita su nombre.';
  end if;
  insert into feriados (fecha, nombre) values (p_fecha, trim(p_nombre))
  on conflict (fecha) do update set nombre = excluded.nombre;
  v_n := fn_recalcular_mes_feriado(p_fecha, 'Feriado «' || trim(p_nombre) || '» agregado al calendario');
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('GUARDAR_FERIADO', 'feriados', null,
    jsonb_build_object('fecha', p_fecha, 'nombre', trim(p_nombre), 'por', p_por, 'recalculados', v_n));
  return v_n;
end $$;

create or replace function eliminar_feriado(p_fecha date, p_por text)
returns int language plpgsql security definer
set search_path = public, extensions as $$
declare v_nombre text; v_n int;
begin
  if fn_nivel_modulo('configuracion') < 2 and fn_nivel_modulo('asistencia') < 2 then
    raise exception 'Tu categoría no permite administrar el calendario de feriados.';
  end if;
  delete from feriados where fecha = p_fecha returning nombre into v_nombre;
  if v_nombre is null then raise exception 'No hay feriado el %.', p_fecha; end if;
  v_n := fn_recalcular_mes_feriado(p_fecha, 'Feriado «' || v_nombre || '» retirado del calendario');
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('ELIMINAR_FERIADO', 'feriados',
    jsonb_build_object('fecha', p_fecha, 'nombre', v_nombre), jsonb_build_object('por', p_por, 'recalculados', v_n));
  return v_n;
end $$;

create or replace view v_feriados as
select to_char(fecha, 'YYYY-MM-DD') as fecha, nombre from feriados order by fecha;
grant select on v_feriados to authenticated;
