-- Solicitud PROPIA desde el BackOffice (2026-08-19, pedido de Diego): un botón
-- global permite a CUALQUIER usuario administrativo activo crear su propia
-- solicitud (vacaciones, papeleta), tenga o no acceso al módulo Solicitudes.
-- El solicitante es la persona vinculada a su usuario (usuarios_admin.persona_dni);
-- la cadena de aprobación y la regla «nadie se aprueba a sí mismo» rigen igual.
-- Idempotente.

drop function if exists crear_solicitud_propia(text, jsonb);
create function crear_solicitud_propia(p_tipo text, p_datos jsonb)
returns text language plpgsql security definer as $$
declare v_dni text;
begin
  v_dni := fn_persona_llamador();
  if v_dni is null then
    raise exception 'Tu usuario no está vinculado a una persona del maestro de personal; pide a RRHH que lo corrija.';
  end if;
  if not exists (select 1 from solicitud_tipos where id = p_tipo and activo and backoffice) then
    raise exception 'Este tipo de solicitud no se crea desde el BackOffice.';
  end if;
  return fn_solicitud_insertar(v_dni, p_tipo, p_datos,
    (select nombre from personas where dni = v_dni));
end $$;

-- Mis solicitudes: SOLO las del llamador (sin nota alguna de terceros). No
-- exige módulo: cada quien ve lo suyo.
drop view if exists v_mis_solicitudes;
create view v_mis_solicitudes as
select s.id, s.numero, t.nombre as tipo, s.tipo_id, s.datos, s.estado,
       case when s.estado = 'enviada' then s.cadena -> (s.paso_actual - 1) ->> 'titulo' end as paso_titulo,
       to_char(s.creado_en, 'YYYY-MM-DD HH24:MI') as creado,
       (select e.comentario from solicitud_eventos e
        where e.solicitud_id = s.id and e.accion in ('observada','rechazada','anulada')
        order by e.en desc limit 1) as ultimo_comentario
from solicitudes s
join solicitud_tipos t on t.id = s.tipo_id
where s.solicitante_dni = fn_persona_llamador()
order by s.creado_en desc;
grant select on v_mis_solicitudes to authenticated;

-- reenviar_solicitud: el SOLICITANTE corrige lo suyo aunque no tenga nivel en
-- el módulo (antes solo portal o nivel de acción).
create or replace function reenviar_solicitud(p_id bigint, p_datos jsonb, p_por text default null)
returns void language plpgsql security definer as $$
declare s record; v_portal text; v_caller text;
begin
  select * into s from solicitudes where id = p_id;
  if s.id is null then raise exception 'La solicitud no existe.'; end if;
  if s.estado <> 'observada' then
    raise exception 'Solo una solicitud observada se corrige y reenvía.';
  end if;
  v_portal := portal_dni();
  v_caller := fn_persona_llamador();
  if v_portal is not null then
    if v_portal <> s.solicitante_dni then
      raise exception 'Solo el solicitante corrige su solicitud.';
    end if;
  elsif fn_nivel_modulo('solicitudes') < 2
        and coalesce(v_caller, '') <> s.solicitante_dni then
    raise exception 'Se necesita nivel de acción en Solicitudes.';
  end if;

  perform fn_solicitud_validar(s.tipo_id, p_datos);
  insert into solicitud_eventos (solicitud_id, accion, datos_previos, por, persona_dni)
  values (p_id, 'reenviada', s.datos,
          coalesce(p_por, s.solicitante_nombre), coalesce(v_portal, v_caller));
  update solicitudes set datos = p_datos - 'supervisor_nombre' - 'supervisor_dni',
    estado = 'enviada', paso_actual = 1 where id = p_id;
end $$;
