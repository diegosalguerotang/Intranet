-- supabase/respaldos/2026-10-01-jefe-directo-reversion.sql — deshace la migración del mismo nombre.
-- Restaura los cuerpos anteriores (commit cf29be7) y quita las tres funciones nuevas.
-- Las solicitudes creadas con jefe designado conservan su supervisor_dni (dato válido también
-- antes); solo deja de poder dar el V°B° desde su buzón. El cliente desplegado tolera la
-- ausencia de las funciones nuevas (lista vacía, campo de texto libre).
begin;
set local search_path = public, interno, extensions;

create or replace function fn_solicitud_insertar(p_dni text, p_tipo text, p_datos jsonb, p_por text)
returns text language plpgsql set search_path = public, interno, extensions as $$
declare
  t record; v record; p record;
  v_num text; v_sup_dni text; v_sup_nombre text; v_sede_nombre text;
  v_cadena jsonb; v_paso jsonb; v_id bigint;
begin
  select * into t from solicitud_tipos where id = p_tipo and activo;
  if t.id is null then
    raise exception 'El tipo de solicitud no existe o está inactivo.';
  end if;
  select pe.nombre into p from personas pe where pe.dni = p_dni;
  if p.nombre is null then
    raise exception 'El DNI % no está en el maestro de personal.', p_dni;
  end if;
  select vi.cargo, vi.sede_id, vi.empresa_id, vi.fecha_inicio into v
  from vinculos vi where vi.persona_dni = p_dni and vi.fecha_fin is null
  order by vi.fecha_inicio desc limit 1;
  if v.empresa_id is null then
    raise exception 'El trabajador % no tiene vínculo vigente.', p_dni;
  end if;

  perform fn_solicitud_validar(p_tipo, p_datos);

  select s.nombre, s.supervisor_dni into v_sede_nombre, v_sup_dni
  from sedes s where s.id = v.sede_id;
  -- El formulario puede corregir al jefe inmediato (la sede puede no tenerlo).
  if coalesce(trim(p_datos->>'supervisor_nombre'),'') <> '' then
    v_sup_nombre := trim(p_datos->>'supervisor_nombre');
    v_sup_dni := nullif(trim(coalesce(p_datos->>'supervisor_dni','')), '');
  elsif v_sup_dni is not null then
    select nombre into v_sup_nombre from personas where dni = v_sup_dni;
  end if;

  -- Cadena congelada, saltando pasos que resolvería el propio solicitante.
  v_cadena := '[]'::jsonb;
  for v_paso in select * from jsonb_array_elements(t.cadena) loop
    if v_paso->>'paso' = 'jefe' and v_sup_dni = p_dni then
      continue;  -- el solicitante es su propio jefe: el paso no existe para él
    end if;
    v_cadena := v_cadena || jsonb_build_array(v_paso);
  end loop;
  if jsonb_array_length(v_cadena) = 0 then
    raise exception 'La cadena de aprobación quedó vacía; revisa el tipo.';
  end if;

  v_num := fn_solicitud_numero(p_tipo, v.empresa_id);
  insert into solicitudes (numero, tipo_id, solicitante_dni, solicitante_nombre,
    cargo, sede_id, sede_nombre, empresa_id, fecha_ingreso,
    supervisor_dni, supervisor_nombre, datos, cadena, creado_por)
  values (v_num, p_tipo, p_dni, p.nombre, v.cargo, v.sede_id, v_sede_nombre,
    v.empresa_id, v.fecha_inicio, v_sup_dni, v_sup_nombre,
    p_datos - 'supervisor_nombre' - 'supervisor_dni', v_cadena, p_por)
  returning id into v_id;

  insert into solicitud_eventos (solicitud_id, accion, paso, paso_titulo, por, persona_dni)
  values (v_id, 'creada', 1, v_cadena->0->>'titulo', p_por, fn_persona_llamador());
  return v_num;
end $$;

create or replace function resolver_solicitud(p_id bigint, p_decision text, p_comentario text default null, p_por text default 'RRHH')
returns void language plpgsql security definer set search_path = public, interno, extensions as $$
declare
  s record; v_nivel int; v_caller text; v_paso jsonb; v_titulo text; v_ultimo boolean;
begin
  select * into s from solicitudes where id = p_id;
  if s.id is null then raise exception 'La solicitud no existe.'; end if;
  if p_decision not in ('aprobar','observar','rechazar','anular') then
    raise exception 'Decisión inválida.';
  end if;
  if p_decision in ('observar','rechazar','anular') and coalesce(trim(p_comentario),'') = '' then
    raise exception 'La decisión «%» exige un motivo.', p_decision;
  end if;

  v_caller := fn_persona_llamador();
  if v_caller is not null and v_caller = s.solicitante_dni then
    raise exception 'Nadie resuelve su propia solicitud: le corresponde al siguiente de la cadena.';
  end if;

  v_nivel := fn_nivel_modulo('solicitudes');

  if p_decision = 'anular' then
    if s.estado <> 'aprobada' then
      raise exception 'Solo una solicitud aprobada se anula; usa rechazar u observar.';
    end if;
    if v_nivel < 3 then
      raise exception 'Anular exige nivel de aprobación en Solicitudes.';
    end if;
    update solicitudes set estado = 'anulada', resuelto_en = now() where id = p_id;
    insert into solicitud_eventos (solicitud_id, accion, comentario, por, persona_dni)
    values (p_id, 'anulada', p_comentario, p_por, v_caller);
    return;
  end if;

  if s.estado <> 'enviada' then
    raise exception 'La solicitud está «%» y no admite esta decisión.', s.estado;
  end if;

  v_paso := s.cadena -> (s.paso_actual - 1);
  v_titulo := v_paso->>'titulo';
  -- Permiso sobre el paso actual: aprobación general, o el supervisor de la
  -- sede del solicitante (con nivel de acción) cuando el paso es «jefe».
  if v_nivel < 3 then
    if not (v_paso->>'paso' = 'jefe' and v_nivel >= 2 and v_caller is not null
            and exists (select 1 from sedes where id = s.sede_id and supervisor_dni = v_caller)) then
      raise exception 'Este paso (%) exige nivel de aprobación en Solicitudes.', v_titulo;
    end if;
  end if;

  if p_decision = 'observar' then
    update solicitudes set estado = 'observada' where id = p_id;
    insert into solicitud_eventos (solicitud_id, accion, paso, paso_titulo, comentario, por, persona_dni)
    values (p_id, 'observada', s.paso_actual, v_titulo, p_comentario, p_por, v_caller);
    return;
  end if;

  if p_decision = 'rechazar' then
    update solicitudes set estado = 'rechazada', resuelto_en = now() where id = p_id;
    insert into solicitud_eventos (solicitud_id, accion, paso, paso_titulo, comentario, por, persona_dni)
    values (p_id, 'rechazada', s.paso_actual, v_titulo, p_comentario, p_por, v_caller);
    return;
  end if;

  -- aprobar
  v_ultimo := s.paso_actual >= jsonb_array_length(s.cadena);
  if v_ultimo and s.tipo_id = 'papeleta-permiso'
     and coalesce(s.datos->>'adjunto_url','') = '' then
    raise exception 'La papeleta no se aprueba sin el original firmado adjunto.';
  end if;
  if v_ultimo then
    update solicitudes set estado = 'aprobada', paso_actual = paso_actual + 1, resuelto_en = now()
    where id = p_id;
    insert into solicitud_eventos (solicitud_id, accion, paso, paso_titulo, comentario, por, persona_dni)
    values (p_id, 'aprobada', s.paso_actual, v_titulo, p_comentario, p_por, v_caller);
  else
    update solicitudes set paso_actual = paso_actual + 1 where id = p_id;
    insert into solicitud_eventos (solicitud_id, accion, paso, paso_titulo, comentario, por, persona_dni)
    values (p_id, 'aprobada_paso', s.paso_actual, v_titulo, p_comentario, p_por, v_caller);
  end if;
end $$;

create or replace function reenviar_solicitud(p_id bigint, p_datos jsonb, p_por text default null)
returns void language plpgsql security definer set search_path = public, interno, extensions as $$
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
    -- El solicitante corrige lo suyo aunque no tenga nivel en el módulo.
    raise exception 'Se necesita nivel de acción en Solicitudes.';
  end if;

  perform fn_solicitud_validar(s.tipo_id, p_datos);
  insert into solicitud_eventos (solicitud_id, accion, datos_previos, por, persona_dni)
  values (p_id, 'reenviada', s.datos,
          coalesce(p_por, s.solicitante_nombre), coalesce(v_portal, v_caller));
  update solicitudes set datos = p_datos - 'supervisor_nombre' - 'supervisor_dni',
    estado = 'enviada', paso_actual = 1 where id = p_id;
end $$;

drop function if exists public.jefes_disponibles();
drop function if exists public.solicitudes_por_mi_visto_bueno();
drop function if exists public.api_admin_correo_por_dni(text);
commit;
