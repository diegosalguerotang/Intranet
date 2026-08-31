-- Hora de entrada del trabajador (spec Tareas 31-08): UNA sola hora por
-- persona, constante mientras no cambie su horario, VERSIONADA con fecha de
-- vigencia para que el recálculo de un mes pasado use la que regía entonces.
-- Jamás se supone una hora por defecto: sin hora no hay tardanza y el
-- trabajador aparece «pendiente de configurar».
-- La carga inicial la hace la primera importación del control semanal
-- (columna H.E.); después se contrasta y se edita desde la ficha.

create table if not exists horarios_entrada (
  persona_dni   text not null references personas(dni),
  vigente_desde date not null,
  hora          time not null,
  creado_por    text not null,
  creado_en     timestamptz not null default now(),
  primary key (persona_dni, vigente_desde)
);
revoke all on horarios_entrada from anon, authenticated;

-- Hora vigente para una fecha (null = pendiente de configurar). DEFINER
-- (corregido el mismo día): la tabla está revocada y una función invoker
-- dentro de v_personal daba 403 al navegador.
create or replace function fn_hora_entrada(p_dni text, p_fecha date default current_date)
returns time language sql stable security definer
set search_path = public, extensions as $$
  select hora from horarios_entrada
  where persona_dni = p_dni and vigente_desde <= p_fecha
  order by vigente_desde desc limit 1
$$;

-- Fijar (o corregir) la hora con su vigencia. p_hora null borra ESA vigencia
-- (deshacer un error); el historial de vigencias anteriores queda intacto.
create or replace function fijar_hora_entrada(p_dni text, p_hora time, p_desde date, p_por text)
returns void language plpgsql security definer
set search_path = public, extensions as $$
begin
  if fn_nivel_modulo('personal') < 2 then
    raise exception 'Tu categoría no permite fijar horas de entrada (requiere nivel de acción en Personal).';
  end if;
  if not exists (select 1 from personas where dni = p_dni) then
    raise exception 'La persona % no está en el maestro.', p_dni;
  end if;
  if p_desde is null then
    raise exception 'La hora de entrada necesita su fecha de vigencia.';
  end if;
  if p_hora is null then
    delete from horarios_entrada where persona_dni = p_dni and vigente_desde = p_desde;
  else
    insert into horarios_entrada (persona_dni, vigente_desde, hora, creado_por)
    values (p_dni, p_desde, p_hora, p_por)
    on conflict (persona_dni, vigente_desde) do update set hora = excluded.hora;
  end if;
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('FIJAR_HORA_ENTRADA', 'horarios_entrada', null,
    jsonb_build_object('dni', p_dni, 'hora', p_hora::text, 'desde', p_desde, 'por', p_por));
end $$;

-- v_personal + sexo, centro de costo y hora de entrada vigente (el canónico
-- vive al final de portal.sql por depender de cuentas_portal).
drop view if exists v_personal;
create view v_personal as
select p.dni, p.tipo_documento, p.nombre, v.cargo, v.sede_id as sede, v.empresa_id as empresa,
       to_char(v.fecha_inicio, 'YYYY-MM-DD') as ingreso,
       p.celular, p.portal,
       case when v.fecha_fin is null then 'vigente' else 'cesado' end as estado,
       p.banco,
       case when p.cuenta_ultimos4 is not null then '···· ' || p.cuenta_ultimos4 end as cuenta,
       to_char(v.fecha_fin, 'YYYY-MM-DD') as cese,
       v.id as vinculo_id,
       p.correo, p.correo_verificado as "correoVerificado",
       p.cci,
       exists (select 1 from cuentas_portal cp where cp.dni = p.dni) as "tieneCuenta",
       p.sexo,
       v.centro_costo as "centroCosto",
       to_char(fn_hora_entrada(p.dni), 'HH24:MI') as "horaEntrada"
from vinculos v join personas p on p.dni = v.persona_dni;
grant select on v_personal to authenticated;
