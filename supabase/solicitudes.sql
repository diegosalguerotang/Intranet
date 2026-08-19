-- ============================================================================
-- CENTRO DE SOLICITUDES — motor de solicitudes con tipos configurables
-- (2026-08-19, spec Tareas 19-08/Centro_de_Solicitudes_RRHH.docx, fases
-- aprobadas por Diego). Primeros tipos: papeleta de permiso GR-F-14 (NEGLIAF,
-- solo BackOffice, 2 pasos) y vacaciones GR-F-012 (PROMANT, Portal+BackOffice,
-- 1 paso). Frontera: incidencias TI van a Soporte; aquí van pedidos FORMALES
-- con cadena de V°B°, correlativo y documento al legajo.
-- Reglas duras: nadie se aprueba a sí mismo; rechazar/observar/anular exigen
-- motivo; una aprobada no se edita (se anula y se crea otra); el historial de
-- eventos es INMUTABLE; retorno < salida se rechaza.
-- APLICAR SIEMPRE DESPUÉS DE accesos.sql Y portal.sql. Idempotente.
-- ============================================================================

drop view if exists v_solicitudes, v_solicitud_tipos, v_portal_solicitudes, v_solicitud_avisos;
drop function if exists portal_crear_solicitud(text, jsonb);
drop function if exists crear_solicitud_admin(text, text, jsonb, text);
drop function if exists resolver_solicitud(bigint, text, text, text);
drop function if exists reenviar_solicitud(bigint, jsonb, text);
drop function if exists guardar_solicitud_aviso(text, text, boolean, boolean);
drop function if exists eliminar_solicitud_aviso(bigint);
drop function if exists fn_solicitud_insertar(text, text, jsonb, text);
drop function if exists fn_solicitud_validar(text, jsonb);
drop function if exists fn_solicitud_numero(text, text);
drop function if exists fn_persona_llamador();

create table if not exists solicitud_tipos (
  id              text primary key,            -- 'papeleta-permiso', 'vacaciones'
  nombre          text not null unique,
  prefijo         text not null,               -- PAP, VAC (correlativo)
  codigo_formato  text not null,               -- GR-F-14, GR-F-012
  version         text not null default '01',
  empresa_id      text not null references empresas(id),  -- membrete del PDF
  portal          boolean not null default false,          -- ¿se crea desde el Portal?
  backoffice      boolean not null default true,
  cadena          jsonb not null,              -- [{"paso":"jefe","titulo":"…"},…] EN ORDEN
  genera_documento boolean not null default true,
  acuse           text not null default 'nunca'
    check (acuse in ('nunca','siempre','motivo_particular')),
  activo          boolean not null default true
);

create table if not exists solicitud_correlativos (
  tipo_id    text not null references solicitud_tipos(id),
  empresa_id text not null references empresas(id),
  anio       int  not null,
  ultimo     int  not null default 0,
  primary key (tipo_id, empresa_id, anio)
);

create table if not exists solicitudes (
  id                bigint generated always as identity primary key,
  numero            text not null unique,      -- PAP-NEG-2026-0001
  tipo_id           text not null references solicitud_tipos(id),
  -- Solicitante CONGELADO al crear (el vínculo puede cambiar después):
  solicitante_dni   text not null references personas(dni),
  solicitante_nombre text not null,
  cargo             text,
  sede_id           text,
  sede_nombre       text,
  empresa_id        text not null references empresas(id), -- RS del solicitante
  fecha_ingreso     date,
  supervisor_dni    text,
  supervisor_nombre text,
  datos             jsonb not null,            -- campos del formulario del tipo
  cadena            jsonb not null,            -- congelada (con pasos saltados fuera)
  paso_actual       int not null default 1,    -- 1..len(cadena); >len ⇒ aprobada
  estado            text not null default 'enviada'
    check (estado in ('enviada','observada','aprobada','rechazada','anulada')),
  documento_id      bigint references documentos(id),  -- PDF archivado al aprobar
  creado_en         timestamptz not null default now(),
  creado_por        text not null,
  resuelto_en       timestamptz                -- aprobada/rechazada/anulada
);

create table if not exists solicitud_eventos (
  id            bigint generated always as identity primary key,
  solicitud_id  bigint not null references solicitudes(id),
  accion        text not null,                 -- creada|aprobada_paso|observada|reenviada|rechazada|anulada|aprobada
  paso          int,
  paso_titulo   text,
  comentario    text,
  datos_previos jsonb,                         -- snapshot al reenviar (las dos versiones quedan)
  por           text not null,                 -- quién operó (nombre)
  persona_dni   text,                          -- persona del operador si se conoce
  en            timestamptz not null default now()  -- reloj del SERVIDOR
);

-- Historial inmutable: mismo criterio que registro_accesos.
create or replace function fn_solicitud_eventos_inmutables() returns trigger
language plpgsql as $$
begin
  raise exception 'El historial de una solicitud no se edita ni se borra.';
end $$;
drop trigger if exists tg_solicitud_eventos_inmutables on solicitud_eventos;
create trigger tg_solicitud_eventos_inmutables
  before update or delete on solicitud_eventos
  for each row execute function fn_solicitud_eventos_inmutables();

create table if not exists solicitud_avisos (
  id      bigint generated always as identity primary key,
  tipo_id text references solicitud_tipos(id),  -- null = todos los tipos
  correo  text not null,
  copia   boolean not null default false,        -- false = destinatario, true = CC
  activo  boolean not null default true,
  unique (tipo_id, correo)
);

-- --------------------------- helpers ---------------------------------------

-- Persona del llamador (correo del JWT → usuarios_admin). Null para llamadas
-- de servicio o cuentas del portal.
create function fn_persona_llamador() returns text
language plpgsql stable security definer as $$
declare v_correo text; v_dni text;
begin
  begin
    v_correo := nullif(auth.jwt() ->> 'email', '');
  exception when others then
    v_correo := null;
  end;
  if v_correo is null then return null; end if;
  select u.persona_dni into v_dni from usuarios_admin u
  where lower(u.correo) = lower(v_correo) and u.estado = 'activo';
  return v_dni;
end $$;

-- Correlativo por tipo + razón social + año: PAP-NEG-2026-0001.
create function fn_solicitud_numero(p_tipo text, p_empresa text) returns text
language plpgsql as $$
declare v_prefijo text; v_corto text; v_anio int; v_n int;
begin
  select prefijo into v_prefijo from solicitud_tipos where id = p_tipo;
  select upper(substr(regexp_replace(corto, '[^A-Za-z]', '', 'g'), 1, 3)) into v_corto
  from empresas where id = p_empresa;
  v_anio := extract(year from now())::int;
  insert into solicitud_correlativos (tipo_id, empresa_id, anio, ultimo)
  values (p_tipo, p_empresa, v_anio, 1)
  on conflict (tipo_id, empresa_id, anio) do update set ultimo = solicitud_correlativos.ultimo + 1
  returning ultimo into v_n;
  return v_prefijo || '-' || v_corto || '-' || v_anio || '-' || lpad(v_n::text, 4, '0');
end $$;

-- Validación de los datos según el tipo. El retorno anterior a la salida se
-- RECHAZA (criterio de aceptación); las superposiciones son advertencia y
-- viven en v_solicitudes, no aquí.
create function fn_solicitud_validar(p_tipo text, p_datos jsonb) returns void
language plpgsql as $$
begin
  if p_tipo = 'papeleta-permiso' then
    if coalesce(p_datos->>'salida','') = '' or coalesce(p_datos->>'retorno','') = '' then
      raise exception 'La papeleta necesita fecha y hora de salida y de retorno.';
    end if;
    if (p_datos->>'retorno')::timestamptz <= (p_datos->>'salida')::timestamptz then
      raise exception 'El retorno no puede ser anterior (ni igual) a la salida.';
    end if;
    if coalesce(p_datos->>'motivo','') not in ('Salud','Particular','Comisión','Otros') then
      raise exception 'Motivo inválido: Salud, Particular, Comisión u Otros.';
    end if;
    if p_datos->>'motivo' = 'Otros' and coalesce(trim(p_datos->>'especificacion'),'') = '' then
      raise exception 'Con motivo «Otros» la especificación es obligatoria.';
    end if;
    if coalesce(trim(p_datos->>'fundamentacion'),'') = '' then
      raise exception 'La fundamentación es obligatoria.';
    end if;
  elsif p_tipo = 'vacaciones' then
    if coalesce(p_datos->>'desde','') = '' or coalesce(p_datos->>'hasta','') = '' then
      raise exception 'La solicitud necesita las fechas desde y hasta.';
    end if;
    if (p_datos->>'hasta')::date < (p_datos->>'desde')::date then
      raise exception 'La fecha «hasta» no puede ser anterior a «desde».';
    end if;
    if coalesce((p_datos->>'dias_gozados')::numeric, 0) <= 0 then
      raise exception 'Los días gozados deben ser mayores a cero.';
    end if;
    -- Las DOS casillas del formato GR-F-012 real (corregido 2026-08-19).
    if coalesce(p_datos->>'tipo_goce','') not in ('Efectivas / Gozadas','Pagadas / Trabajadas') then
      raise exception 'Tipo inválido: «Efectivas / Gozadas» o «Pagadas / Trabajadas».';
    end if;
  end if;
end $$;

-- Inserta congelando el vínculo y la cadena. El paso «jefe» se salta si el
-- supervisor de la sede ES el propio solicitante (nadie se aprueba a sí mismo).
create function fn_solicitud_insertar(p_dni text, p_tipo text, p_datos jsonb, p_por text)
returns text language plpgsql as $$
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

-- --------------------------- RPCs ------------------------------------------

-- Portal (web responsive): el dni sale del JWT; SOLO tipos con portal=true.
create function portal_crear_solicitud(p_tipo text, p_datos jsonb)
returns text language plpgsql security definer as $$
declare v_dni text;
begin
  v_dni := portal_dni();
  if v_dni is null then
    raise exception 'Sesión del portal inválida.';
  end if;
  if not exists (select 1 from solicitud_tipos where id = p_tipo and activo and portal) then
    raise exception 'Este tipo de solicitud no se crea desde el portal.';
  end if;
  return fn_solicitud_insertar(v_dni, p_tipo, p_datos, (select nombre from personas where dni = v_dni));
end $$;

-- BackOffice: a nombre de un trabajador. Nivel solicitudes ≥ 2.
create function crear_solicitud_admin(p_dni text, p_tipo text, p_datos jsonb, p_por text default 'RRHH')
returns text language plpgsql security definer as $$
begin
  if fn_nivel_modulo('solicitudes') < 2 then
    raise exception 'Se necesita nivel de acción en Solicitudes.';
  end if;
  if not exists (select 1 from solicitud_tipos where id = p_tipo and activo and backoffice) then
    raise exception 'Este tipo de solicitud no se crea desde el BackOffice.';
  end if;
  return fn_solicitud_insertar(p_dni, p_tipo, p_datos, p_por);
end $$;

-- Mover el estado. Reglas: nadie resuelve su propia solicitud; el paso «jefe»
-- lo puede resolver el supervisor de la sede con nivel de acción, cualquier
-- otro paso exige nivel de aprobación; observar/rechazar/anular exigen motivo;
-- anular solo aprobadas y solo nivel de aprobación; la papeleta no se aprueba
-- en su último paso sin el original firmado adjunto.
create function resolver_solicitud(p_id bigint, p_decision text, p_comentario text default null, p_por text default 'RRHH')
returns void language plpgsql security definer as $$
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

-- Una observada vuelve al solicitante, que corrige y reenvía; el historial
-- conserva las dos versiones (snapshot en el evento).
create function reenviar_solicitud(p_id bigint, p_datos jsonb, p_por text default null)
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
  elsif fn_nivel_modulo('solicitudes') < 2 then
    raise exception 'Se necesita nivel de acción en Solicitudes.';
  end if;

  perform fn_solicitud_validar(s.tipo_id, p_datos);
  insert into solicitud_eventos (solicitud_id, accion, datos_previos, por, persona_dni)
  values (p_id, 'reenviada', s.datos,
          coalesce(p_por, s.solicitante_nombre), coalesce(v_portal, v_caller));
  update solicitudes set datos = p_datos - 'supervisor_nombre' - 'supervisor_dni',
    estado = 'enviada', paso_actual = 1 where id = p_id;
end $$;

-- Avisos configurables (nunca correos en el código). Nivel de aprobación.
create function guardar_solicitud_aviso(p_tipo text, p_correo text, p_copia boolean default false, p_activo boolean default true)
returns void language plpgsql security definer as $$
begin
  if fn_nivel_modulo('solicitudes') < 3 then
    raise exception 'Se necesita nivel de aprobación en Solicitudes.';
  end if;
  insert into solicitud_avisos (tipo_id, correo, copia, activo)
  values (p_tipo, lower(trim(p_correo)), p_copia, p_activo)
  on conflict (tipo_id, correo) do update set copia = excluded.copia, activo = excluded.activo;
end $$;

create function eliminar_solicitud_aviso(p_id bigint)
returns void language plpgsql security definer as $$
begin
  if fn_nivel_modulo('solicitudes') < 3 then
    raise exception 'Se necesita nivel de aprobación en Solicitudes.';
  end if;
  delete from solicitud_avisos where id = p_id;
end $$;

-- --------------------------- vistas ----------------------------------------

create view v_solicitudes as
select s.id, s.numero, s.tipo_id, t.nombre as tipo, t.codigo_formato,
       s.solicitante_dni, pe.tipo_documento as solicitante_tipo_documento,
       s.solicitante_nombre, s.cargo,
       s.sede_id, s.sede_nombre, s.empresa_id as empresa,
       to_char(s.fecha_ingreso, 'YYYY-MM-DD') as fecha_ingreso,
       s.supervisor_dni, s.supervisor_nombre,
       s.datos, s.cadena, s.paso_actual, s.estado,
       case when s.estado = 'enviada' then s.cadena -> (s.paso_actual - 1) ->> 'titulo' end as paso_titulo,
       s.documento_id,
       to_char(s.creado_en, 'YYYY-MM-DD HH24:MI') as creado, s.creado_en, s.creado_por,
       to_char(s.resuelto_en, 'YYYY-MM-DD HH24:MI') as resuelto, s.resuelto_en,
       -- Advertencias para el aprobador (jamás bloqueos):
       (s.tipo_id = 'papeleta-permiso' and exists (
          select 1 from solicitudes o
          where o.id <> s.id and o.tipo_id = 'papeleta-permiso'
            and o.solicitante_dni = s.solicitante_dni and o.estado = 'aprobada'
            and (o.datos->>'salida')::date = (s.datos->>'salida')::date))
        or (s.tipo_id = 'vacaciones' and exists (
          select 1 from solicitudes o
          where o.id <> s.id and o.tipo_id = 'vacaciones'
            and o.solicitante_dni = s.solicitante_dni and o.estado = 'aprobada'
            and (o.datos->>'desde')::date <= (s.datos->>'hasta')::date
            and (o.datos->>'hasta')::date >= (s.datos->>'desde')::date))
       as se_superpone
from solicitudes s
join solicitud_tipos t on t.id = s.tipo_id
join personas pe on pe.dni = s.solicitante_dni
order by s.creado_en desc;

create view v_solicitud_tipos as
select id, nombre, prefijo, codigo_formato, version, empresa_id,
       portal, backoffice, cadena, genera_documento, acuse, activo
from solicitud_tipos order by nombre;

create view v_solicitud_avisos as
select a.id, a.tipo_id, t.nombre as tipo, a.correo, a.copia, a.activo
from solicitud_avisos a
left join solicitud_tipos t on t.id = a.tipo_id
order by coalesce(t.nombre, ''), a.correo;

-- Portal (web responsive): SOLO las del dni de la sesión.
create view v_portal_solicitudes as
select s.numero, t.nombre as tipo, s.datos, s.estado,
       case when s.estado = 'enviada' then s.cadena -> (s.paso_actual - 1) ->> 'titulo' end as paso_titulo,
       to_char(s.creado_en, 'YYYY-MM-DD HH24:MI') as creado,
       s.id,
       (select e.comentario from solicitud_eventos e
        where e.solicitud_id = s.id and e.accion in ('observada','rechazada','anulada')
        order by e.en desc limit 1) as ultimo_comentario
from solicitudes s
join solicitud_tipos t on t.id = s.tipo_id
where s.solicitante_dni = portal_dni()
order by s.creado_en desc;

-- Historial de una solicitud (BackOffice).
drop view if exists v_solicitud_eventos;
create view v_solicitud_eventos as
select e.solicitud_id, e.accion, e.paso, e.paso_titulo, e.comentario,
       e.datos_previos, e.por, to_char(e.en, 'YYYY-MM-DD HH24:MI') as en
from solicitud_eventos e order by e.en;

-- --------------------------- permisos --------------------------------------

revoke all on solicitudes, solicitud_tipos, solicitud_eventos, solicitud_avisos, solicitud_correlativos
  from anon, authenticated;
grant select on v_solicitudes, v_solicitud_tipos, v_solicitud_avisos, v_solicitud_eventos to authenticated;
grant select on v_portal_solicitudes to authenticated;

-- --------------------------- seed ------------------------------------------
-- Los dos tipos iniciales. La papeleta NO se crea desde el portal: el permiso
-- se gestiona en persona ante el supervisor y el sistema registra esa gestión.
insert into solicitud_tipos (id, nombre, prefijo, codigo_formato, version, empresa_id,
                             portal, backoffice, cadena, genera_documento, acuse) values
  ('papeleta-permiso', 'Papeleta de permiso', 'PAP', 'GR-F-14', '01', 'negliaf',
   false, true,
   '[{"paso":"jefe","titulo":"V°B° del jefe inmediato"},{"paso":"rrhh","titulo":"V°B° de RRHH"}]',
   true, 'motivo_particular'),
  ('vacaciones', 'Solicitud de vacaciones', 'VAC', 'GR-F-012', '01', 'promant',
   true, true,
   '[{"paso":"rrhh","titulo":"V°B° de Gerencia de RRHH"}]',
   true, 'nunca')
on conflict (id) do nothing;

-- Destinatario inicial (se administra desde SOL-03, jamás en el código).
insert into solicitud_avisos (tipo_id, correo, copia, activo)
select null, 'diegosalguerotang@gmail.com', false, true
where not exists (select 1 from solicitud_avisos where tipo_id is null and correo = 'diegosalguerotang@gmail.com');
