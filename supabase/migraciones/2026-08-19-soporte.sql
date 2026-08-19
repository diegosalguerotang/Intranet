-- ============================================================================
-- MÓDULO SOPORTE — tickets de incidencias TI (2026-08-19)
-- Copiado funcionalmente del sistema PHP de PROMANT (promant.pe/correo) con
-- las mejoras del proyecto: solicitante real del maestro, numeración legible
-- TK-0001, catálogo activable, niveles del módulo `soporte` de Accesos.
-- Frontera acordada con Diego: incidencias TI aquí; las solicitudes formales
-- con cadena de aprobación van al Centro de Solicitudes (motor aparte).
-- APLICAR SIEMPRE DESPUÉS DE accesos.sql Y portal.sql (usa fn_nivel_modulo
-- y portal_dni). Idempotente.
-- ============================================================================

drop view if exists v_tickets, v_ticket_catalogo, v_ticket_config, v_ticket_avisos, v_portal_tickets;
drop function if exists portal_crear_ticket(int, int, text);
drop function if exists crear_ticket_admin(text, int, int, text, text);
drop function if exists actualizar_ticket(bigint, text, text, text, text);
drop function if exists guardar_ticket_tipo(int, text);
drop function if exists guardar_ticket_subtipo(int, int, text);
drop function if exists alternar_ticket_tipo(int, boolean);
drop function if exists alternar_ticket_subtipo(int, boolean);
drop function if exists guardar_ticket_aviso(text, boolean);
drop function if exists eliminar_ticket_aviso(text);

create table if not exists ticket_tipos (
  id     int generated always as identity primary key,
  nombre text not null unique,
  activo boolean not null default true
);

create table if not exists ticket_subtipos (
  id      int generated always as identity primary key,
  tipo_id int not null references ticket_tipos(id) on delete cascade,
  nombre  text not null,
  activo  boolean not null default true,
  unique (tipo_id, nombre)
);

create sequence if not exists seq_ticket_numero;

create table if not exists tickets (
  id                 bigint generated always as identity primary key,
  numero             text not null unique,
  creado_en          timestamptz not null default now(),
  solicitante_dni    text references personas(dni),
  solicitante_nombre text not null,
  solicitante_correo text,
  area               text,
  empresa_id         text references empresas(id),
  tipo_id            int not null references ticket_tipos(id),
  subtipo_id         int references ticket_subtipos(id),
  comentario         text,
  estado             text not null default 'abierto'
    check (estado in ('abierto','en_proceso','resuelto','cerrado')),
  atendido_por       text,
  nota_interna       text,          -- solo la ve el equipo (no está en v_portal_tickets)
  actualizado_en     timestamptz,
  actualizado_por    text
);

create table if not exists ticket_avisos (
  correo text primary key,
  activo boolean not null default true
);

-- --------------------------- helpers ---------------------------------------

create or replace function fn_ticket_numero() returns text language sql as $$
  select 'TK-' || lpad(nextval('seq_ticket_numero')::text, 4, '0')
$$;

-- Inserta el ticket resolviendo los datos del solicitante desde el maestro.
create or replace function fn_ticket_insertar(p_dni text, p_tipo int, p_subtipo int, p_comentario text)
returns text language plpgsql as $$
declare v_num text; v_nombre text; v_correo text; v_area text; v_emp text;
begin
  if not exists (select 1 from ticket_tipos where id = p_tipo and activo) then
    raise exception 'El tipo de ticket no existe o está inactivo.';
  end if;
  if p_subtipo is not null and not exists
     (select 1 from ticket_subtipos where id = p_subtipo and tipo_id = p_tipo and activo) then
    raise exception 'El subtipo no corresponde al tipo o está inactivo.';
  end if;
  select pe.nombre, pe.correo into v_nombre, v_correo from personas pe where pe.dni = p_dni;
  if v_nombre is null then
    raise exception 'El DNI % no está en el maestro de personal.', p_dni;
  end if;
  select vi.cargo, vi.empresa_id into v_area, v_emp
  from vinculos vi where vi.persona_dni = p_dni and vi.fecha_fin is null
  order by vi.fecha_inicio desc limit 1;
  v_num := fn_ticket_numero();
  insert into tickets (numero, solicitante_dni, solicitante_nombre, solicitante_correo,
                       area, empresa_id, tipo_id, subtipo_id, comentario)
  values (v_num, p_dni, v_nombre, v_correo, v_area, v_emp, p_tipo, p_subtipo,
          nullif(trim(coalesce(p_comentario,'')), ''));
  return v_num;
end $$;

-- --------------------------- RPCs ------------------------------------------

-- Portal: el dni SIEMPRE sale del JWT. Devuelve el número asignado.
create function portal_crear_ticket(p_tipo int, p_subtipo int default null, p_comentario text default null)
returns text language plpgsql security definer as $$
declare v_dni text;
begin
  v_dni := portal_dni();
  if v_dni is null then
    raise exception 'Sesión del portal inválida.';
  end if;
  return fn_ticket_insertar(v_dni, p_tipo, p_subtipo, p_comentario);
end $$;

-- BackOffice: a nombre de un trabajador del maestro. Nivel soporte ≥ 2.
create function crear_ticket_admin(
  p_dni text, p_tipo int, p_subtipo int default null,
  p_comentario text default null, p_por text default 'Soporte'
) returns text language plpgsql security definer as $$
declare v_num text;
begin
  if fn_nivel_modulo('soporte') < 2 then
    raise exception 'Se necesita nivel de acción en Soporte.';
  end if;
  v_num := fn_ticket_insertar(p_dni, p_tipo, p_subtipo, p_comentario);
  update tickets set actualizado_en = now(), actualizado_por = p_por where numero = v_num;
  return v_num;
end $$;

create function actualizar_ticket(
  p_id bigint, p_estado text default null, p_atendido_por text default null,
  p_nota text default null, p_por text default 'Soporte'
) returns void language plpgsql security definer as $$
begin
  if fn_nivel_modulo('soporte') < 2 then
    raise exception 'Se necesita nivel de acción en Soporte.';
  end if;
  if p_estado is not null and p_estado not in ('abierto','en_proceso','resuelto','cerrado') then
    raise exception 'Estado inválido.';
  end if;
  update tickets set
    estado = coalesce(p_estado, estado),
    atendido_por = coalesce(nullif(trim(coalesce(p_atendido_por,'')),''), atendido_por),
    nota_interna = coalesce(nullif(trim(coalesce(p_nota,'')),''), nota_interna),
    actualizado_en = now(), actualizado_por = p_por
  where id = p_id;
  if not found then
    raise exception 'El ticket no existe.';
  end if;
end $$;

-- Catálogo y avisos: nivel de aprobación (3; superadmin/servicio = 99).
create function guardar_ticket_tipo(p_id int, p_nombre text) returns int
language plpgsql security definer as $$
declare v int;
begin
  if fn_nivel_modulo('soporte') < 3 then
    raise exception 'Se necesita nivel de aprobación en Soporte.';
  end if;
  if p_id is null then
    insert into ticket_tipos (nombre) values (trim(p_nombre)) returning id into v;
  else
    update ticket_tipos set nombre = trim(p_nombre) where id = p_id returning id into v;
  end if;
  return v;
end $$;

create function guardar_ticket_subtipo(p_id int, p_tipo int, p_nombre text) returns int
language plpgsql security definer as $$
declare v int;
begin
  if fn_nivel_modulo('soporte') < 3 then
    raise exception 'Se necesita nivel de aprobación en Soporte.';
  end if;
  if p_id is null then
    insert into ticket_subtipos (tipo_id, nombre) values (p_tipo, trim(p_nombre)) returning id into v;
  else
    update ticket_subtipos set nombre = trim(p_nombre) where id = p_id returning id into v;
  end if;
  return v;
end $$;

create function alternar_ticket_tipo(p_id int, p_activo boolean) returns void
language plpgsql security definer as $$
begin
  if fn_nivel_modulo('soporte') < 3 then
    raise exception 'Se necesita nivel de aprobación en Soporte.';
  end if;
  update ticket_tipos set activo = p_activo where id = p_id;
end $$;

create function alternar_ticket_subtipo(p_id int, p_activo boolean) returns void
language plpgsql security definer as $$
begin
  if fn_nivel_modulo('soporte') < 3 then
    raise exception 'Se necesita nivel de aprobación en Soporte.';
  end if;
  update ticket_subtipos set activo = p_activo where id = p_id;
end $$;

create function guardar_ticket_aviso(p_correo text, p_activo boolean default true) returns void
language plpgsql security definer as $$
begin
  if fn_nivel_modulo('soporte') < 3 then
    raise exception 'Se necesita nivel de aprobación en Soporte.';
  end if;
  insert into ticket_avisos (correo, activo) values (lower(trim(p_correo)), p_activo)
  on conflict (correo) do update set activo = excluded.activo;
end $$;

create function eliminar_ticket_aviso(p_correo text) returns void
language plpgsql security definer as $$
begin
  if fn_nivel_modulo('soporte') < 3 then
    raise exception 'Se necesita nivel de aprobación en Soporte.';
  end if;
  delete from ticket_avisos where correo = lower(trim(p_correo));
end $$;

-- --------------------------- vistas ----------------------------------------

create view v_tickets as
select t.id, t.numero, to_char(t.creado_en, 'YYYY-MM-DD HH24:MI') as creado,
       t.solicitante_dni, t.solicitante_nombre, t.solicitante_correo,
       t.area, t.empresa_id as empresa,
       tt.nombre as tipo, ts.nombre as subtipo, t.tipo_id, t.subtipo_id,
       t.comentario, t.estado, t.atendido_por, t.nota_interna,
       to_char(t.actualizado_en, 'YYYY-MM-DD HH24:MI') as actualizado, t.actualizado_por
from tickets t
join ticket_tipos tt on tt.id = t.tipo_id
left join ticket_subtipos ts on ts.id = t.subtipo_id
order by t.creado_en desc;

create view v_ticket_catalogo as
select tt.id as tipo_id, tt.nombre as tipo, ts.id as subtipo_id, ts.nombre as subtipo
from ticket_tipos tt
left join ticket_subtipos ts on ts.tipo_id = tt.id and ts.activo
where tt.activo
order by tt.nombre, ts.nombre;

create view v_ticket_config as
select tt.id as tipo_id, tt.nombre as tipo, tt.activo as tipo_activo,
       ts.id as subtipo_id, ts.nombre as subtipo, ts.activo as subtipo_activo
from ticket_tipos tt
left join ticket_subtipos ts on ts.tipo_id = tt.id
order by tt.nombre, ts.nombre;

create view v_ticket_avisos as
select correo, activo from ticket_avisos order by correo;

-- Portal: SOLO los tickets del dni de la sesión, sin nota interna.
create view v_portal_tickets as
select t.numero, to_char(t.creado_en, 'YYYY-MM-DD HH24:MI') as creado,
       tt.nombre as tipo, ts.nombre as subtipo, t.comentario, t.estado
from tickets t
join ticket_tipos tt on tt.id = t.tipo_id
left join ticket_subtipos ts on ts.id = t.subtipo_id
where t.solicitante_dni = portal_dni()
order by t.creado_en desc;

-- --------------------------- permisos --------------------------------------

revoke all on tickets, ticket_tipos, ticket_subtipos, ticket_avisos from anon, authenticated;
grant select on v_tickets, v_ticket_config, v_ticket_avisos to authenticated;
grant select on v_ticket_catalogo, v_portal_tickets to authenticated;

-- --------------------------- seed ------------------------------------------
-- Catálogo del sistema TI de PROMANT tal cual (estados de activación incluidos).
insert into ticket_tipos (nombre, activo) values
  ('Conectividad y redes', true), ('Correo', false), ('Cuenta de usuario', false),
  ('Hardware', true), ('Otro', true), ('Software', true), ('Solicitud', true)
on conflict (nombre) do nothing;

create or replace function fn_seed_subtipo(p_tipo text, p_nombre text, p_activo boolean)
returns void language sql as $$
  insert into ticket_subtipos (tipo_id, nombre, activo)
  select id, p_nombre, p_activo from ticket_tipos where nombre = p_tipo
  on conflict (tipo_id, nombre) do nothing
$$;

select fn_seed_subtipo('Conectividad y redes', 'Conexión a internet', true);
select fn_seed_subtipo('Conectividad y redes', 'No tengo internet', false);
select fn_seed_subtipo('Conectividad y redes', 'No tengo la contraseña', false);
select fn_seed_subtipo('Conectividad y redes', 'Otro', true);
select fn_seed_subtipo('Correo', 'General', true);
select fn_seed_subtipo('Correo', 'No se puede enviar correo', true);
select fn_seed_subtipo('Correo', 'Olvide mi contraseña', true);
select fn_seed_subtipo('Correo', 'Se lleno mi espacio', true);
select fn_seed_subtipo('Cuenta de usuario', 'General', true);
select fn_seed_subtipo('Cuenta de usuario', 'Olvide la contraseña del equipo', true);
select fn_seed_subtipo('Hardware', 'Equipos de cómputo y accesorios', true);
select fn_seed_subtipo('Hardware', 'Impresora / escáner', true);
select fn_seed_subtipo('Hardware', 'Otro', true);
select fn_seed_subtipo('Otro', 'Detallar en el recuadro de Comentarios', true);
select fn_seed_subtipo('Software', 'EJB', true);
select fn_seed_subtipo('Software', 'Office', true);
select fn_seed_subtipo('Software', 'Otro', true);
select fn_seed_subtipo('Software', 'SAP', true);
select fn_seed_subtipo('Software', 'Sistemas IA', true);
select fn_seed_subtipo('Solicitud', 'Carpetas y/o almacenamiento', true);
select fn_seed_subtipo('Solicitud', 'Grabación de medios', true);
select fn_seed_subtipo('Solicitud', 'Nuevo ingreso / Cambio de puesto', true);
select fn_seed_subtipo('Solicitud', 'Otro', true);
select fn_seed_subtipo('Solicitud', 'Permisos de acceso', true);
select fn_seed_subtipo('Solicitud', 'Revisión de grabaciones', true);
select fn_seed_subtipo('Solicitud', 'Telefonía móvil', true);
drop function fn_seed_subtipo(text, text, boolean);

insert into ticket_avisos (correo, activo) values ('diegosalguerotang@gmail.com', true)
on conflict (correo) do nothing;
