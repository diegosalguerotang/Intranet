-- ============================================================================
-- MÓDULO DE ACCESOS Y ROLES (ACC-01…ACC-06) — complemento del esquema v2
-- · El Perfil dice QUÉ puede hacer alguien; el Alcance (en el usuario) dice
--   SOBRE QUIÉNES. El alcance solo restringe, nunca amplía.
-- · El perfil se VERSIONA: cada guardado inserta una versión nueva; la
--   auditoría referencia la versión vigente al momento de cada acción.
-- · Superadministrador es una MARCA, no un nivel: sin matriz, sin alcance.
-- · Invariantes garantizados por el esquema, no por la interfaz.
-- Si schema.sql se vuelve a aplicar (reset), este archivo debe re-aplicarse.
-- ============================================================================

drop view if exists v_perfiles, v_perfil_versiones, v_usuarios_admin,
  v_politica_acceso, v_registro_accesos cascade;
drop table if exists registro_accesos, usuario_alcance_sede,
  usuario_alcance_empresa, usuarios_admin, politica_acceso,
  perfil_permisos, perfiles cascade;
drop function if exists guardar_perfil, desactivar_perfil, crear_usuario_admin,
  actualizar_usuario_admin, suspender_usuario_admin, reactivar_usuario_admin,
  reenviar_clave, guardar_politica, puede,
  fn_perfil_nombre_unico, fn_superadmin_sin_matriz,
  fn_proteger_ultimo_superadmin cascade;

-- ---------------------------------------------------------------------------
-- PERFILES (versionados: PK id+version; cada guardado inserta, nunca modifica)
-- ---------------------------------------------------------------------------
create table perfiles (
  id          text not null,
  version     integer not null default 1 check (version >= 1),
  nombre      text not null,
  descripcion text,
  es_superadmin             boolean not null default false,
  ver_remuneracion          boolean not null default false,
  ver_documentos_terceros   boolean not null default false,
  exportar_datos_personales boolean not null default false,
  estado      text not null default 'activo' check (estado in ('activo','desactivado')),
  creado_por  text not null,
  creado_en   timestamptz not null default now(),
  primary key (id, version)
);

-- Nombre único en el sistema (entre perfiles distintos; las versiones de un
-- mismo perfil sí comparten nombre).
create function fn_perfil_nombre_unico() returns trigger language plpgsql as $$
begin
  if exists (select 1 from perfiles where lower(nombre) = lower(new.nombre) and id <> new.id) then
    raise exception 'Ya existe otro perfil con el nombre «%».', new.nombre;
  end if;
  return new;
end $$;
create trigger trg_perfil_nombre_unico before insert or update on perfiles
  for each row execute function fn_perfil_nombre_unico();

create table perfil_permisos (
  perfil_id      text not null,
  perfil_version integer not null,
  modulo         text not null check (modulo in
    ('personal','boletas','acuses','comunicados','memorandums','contratos',
     'tardanzas','activos','accesos','auditoria','configuracion')),
  nivel          integer not null check (nivel between 0 and 3),
  primary key (perfil_id, perfil_version, modulo),
  foreign key (perfil_id, perfil_version) references perfiles (id, version),
  -- El nivel 3 solo existe donde hay algo que aprobar.
  constraint nivel_3_solo_con_aprobacion check (
    nivel < 3 or modulo in ('personal','boletas','comunicados','memorandums',
                            'contratos','activos','accesos','configuracion'))
);

-- Invariante: un perfil superadmin NO lleva matriz (nadie debe leerla nunca).
create function fn_superadmin_sin_matriz() returns trigger language plpgsql as $$
begin
  if exists (select 1 from perfiles p
             where p.id = new.perfil_id and p.version = new.perfil_version
               and p.es_superadmin) then
    raise exception 'Un perfil con marca de superadministrador no lleva matriz.';
  end if;
  return new;
end $$;
create trigger trg_superadmin_sin_matriz before insert on perfil_permisos
  for each row execute function fn_superadmin_sin_matriz();

-- ---------------------------------------------------------------------------
-- USUARIOS ADMINISTRATIVOS (toda acción lleva el nombre de una Persona)
-- ---------------------------------------------------------------------------
create table usuarios_admin (
  id             bigint generated always as identity primary key,
  persona_dni    text not null unique references personas(dni),
  perfil_id      text not null,
  perfil_version integer not null,
  correo         text,
  celular        text check (celular is null or celular ~ '^[0-9]{9}$'),
  estado         text not null default 'activo' check (estado in ('activo','suspendido')),
  clave_provisional text,
  clave_entregada   text check (clave_entregada in ('correo','pantalla')),
  ultimo_ingreso timestamptz,
  creado_por     text not null,
  creado_en      timestamptz not null default now(),
  foreign key (perfil_id, perfil_version) references perfiles (id, version)
);

create table usuario_alcance_empresa (
  usuario_id bigint not null references usuarios_admin(id) on delete cascade,
  empresa_id text not null references empresas(id),
  primary key (usuario_id, empresa_id)
);

-- Sin filas aquí = todas las sedes de las empresas del alcance.
create table usuario_alcance_sede (
  usuario_id bigint not null references usuarios_admin(id) on delete cascade,
  sede_id    text not null references sedes(id),
  primary key (usuario_id, sede_id)
);

-- Invariante: siempre queda al menos un superadministrador activo.
create function fn_proteger_ultimo_superadmin() returns trigger language plpgsql as $$
declare era_super boolean; sigue_super boolean;
begin
  select p.es_superadmin into era_super from perfiles p
  where p.id = old.perfil_id and p.version = old.perfil_version;
  if not coalesce(era_super, false) or old.estado <> 'activo' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    sigue_super := false;
  else
    select p.es_superadmin and new.estado = 'activo' into sigue_super from perfiles p
    where p.id = new.perfil_id and p.version = new.perfil_version;
  end if;
  if not coalesce(sigue_super, false) and not exists (
    select 1 from usuarios_admin u
    join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
    where u.estado = 'activo' and p.es_superadmin and u.id <> old.id
  ) then
    raise exception 'Debe quedar al menos un superadministrador activo.';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_ultimo_superadmin before update or delete on usuarios_admin
  for each row execute function fn_proteger_ultimo_superadmin();

-- ---------------------------------------------------------------------------
-- POLÍTICA DE ACCESO (fila única para toda la instalación)
-- ---------------------------------------------------------------------------
create table politica_acceso (
  id int primary key default 1 check (id = 1),
  sesion_backoffice_horas int not null default 8  check (sesion_backoffice_horas > 0),
  sesion_portal_dias      int not null default 30 check (sesion_portal_dias > 0),
  multisesion_backoffice  boolean not null default false,
  multisesion_portal      boolean not null default true,
  intentos_bloqueo        int not null default 5  check (intentos_bloqueo > 0),
  bloqueo_minutos         int not null default 15 check (bloqueo_minutos > 0),
  recuperacion_defecto    text not null default 'whatsapp'
    check (recuperacion_defecto in ('whatsapp','sms','manual')),
  clave_longitud_min      int not null default 8 check (clave_longitud_min >= 6),
  clave_provisional_dias  int not null default 7 check (clave_provisional_dias > 0),
  actualizado_por text,
  actualizado_en  timestamptz
);
insert into politica_acceso (id) values (1);

-- ---------------------------------------------------------------------------
-- REGISTRO DE ACCESOS (inmutable; corte especializado de la auditoría)
-- ---------------------------------------------------------------------------
create table registro_accesos (
  id             bigint generated always as identity primary key,
  usuario_id     bigint references usuarios_admin(id),
  dni            text,                                -- ingreso por Portal (trabajador)
  perfil_id      text,
  perfil_version integer,                             -- perfil VIGENTE en ese momento
  superficie     text not null check (superficie in ('portal','backoffice')),
  resultado      text not null check (resultado in ('exitoso','fallido','bloqueado')),
  fecha          timestamptz not null default now(),  -- reloj del SERVIDOR
  ip             text,
  dispositivo    text
);
create trigger trg_registro_accesos_inmutable
  before update or delete on registro_accesos
  for each row execute function fn_bloquear_cambios();

-- ---------------------------------------------------------------------------
-- FUNCIONES RPC
-- ---------------------------------------------------------------------------

-- Cada guardado crea una versión nueva; las anteriores no se tocan. Los
-- usuarios asignados pasan a la versión nueva (el cambio surte efecto en su
-- siguiente petición, no en su siguiente ingreso).
create function guardar_perfil(
  p_id text, p_nombre text, p_descripcion text, p_superadmin boolean,
  p_ver_remuneracion boolean, p_ver_documentos boolean, p_exportar boolean,
  p_matriz jsonb, p_por text
) returns integer language plpgsql security definer as $$
declare v_version int; v_mod text; v_nivel text;
begin
  select coalesce(max(version), 0) + 1 into v_version from perfiles where id = p_id;
  insert into perfiles (id, version, nombre, descripcion, es_superadmin,
                        ver_remuneracion, ver_documentos_terceros,
                        exportar_datos_personales, creado_por)
  values (p_id, v_version, p_nombre, p_descripcion, p_superadmin,
          p_ver_remuneracion, p_ver_documentos, p_exportar, p_por);
  if not p_superadmin then
    for v_mod, v_nivel in select key, value from jsonb_each_text(coalesce(p_matriz, '{}'::jsonb))
    loop
      insert into perfil_permisos (perfil_id, perfil_version, modulo, nivel)
      values (p_id, v_version, v_mod, v_nivel::int);
    end loop;
  end if;
  update usuarios_admin set perfil_version = v_version where perfil_id = p_id;
  return v_version;
end $$;

-- Un perfil con usuarios no se elimina: se desactiva (todas sus versiones).
create function desactivar_perfil(p_id text) returns void
language plpgsql security definer as $$
begin
  update perfiles set estado = 'desactivado' where id = p_id;
end $$;

create function crear_usuario_admin(
  p_dni text, p_perfil text, p_correo text, p_celular text,
  p_empresas text[], p_sedes text[], p_clave text, p_por text
) returns bigint language plpgsql security definer as $$
declare v_id bigint; v_version int; v_super boolean; e text; s text;
begin
  if not exists (select 1 from personas where dni = p_dni) then
    raise exception 'La persona % no existe en el maestro de Personal.', p_dni;
  end if;
  select version, es_superadmin into v_version, v_super
  from perfiles where id = p_perfil and estado = 'activo'
  order by version desc limit 1;
  if v_version is null then
    raise exception 'El perfil % no existe o está desactivado.', p_perfil;
  end if;
  if not v_super and (p_empresas is null or cardinality(p_empresas) = 0) then
    raise exception 'El alcance de razones sociales es obligatorio.';
  end if;
  insert into usuarios_admin (persona_dni, perfil_id, perfil_version, correo,
                              celular, clave_provisional, clave_entregada, creado_por)
  values (p_dni, p_perfil, v_version, p_correo, p_celular, p_clave,
          case when p_correo is null then 'pantalla' else 'correo' end, p_por)
  returning id into v_id;
  if not v_super then
    foreach e in array p_empresas loop
      insert into usuario_alcance_empresa (usuario_id, empresa_id) values (v_id, e);
    end loop;
    foreach s in array coalesce(p_sedes, '{}') loop
      insert into usuario_alcance_sede (usuario_id, sede_id) values (v_id, s);
    end loop;
  end if;
  return v_id;
end $$;

create function actualizar_usuario_admin(
  p_id bigint, p_perfil text, p_correo text, p_celular text,
  p_empresas text[], p_sedes text[], p_estado text
) returns void language plpgsql security definer as $$
declare v_version int; v_super boolean; e text; s text;
begin
  select version, es_superadmin into v_version, v_super
  from perfiles where id = p_perfil and estado = 'activo'
  order by version desc limit 1;
  if v_version is null then
    raise exception 'El perfil % no existe o está desactivado.', p_perfil;
  end if;
  if not v_super and (p_empresas is null or cardinality(p_empresas) = 0) then
    raise exception 'El alcance de razones sociales es obligatorio.';
  end if;
  update usuarios_admin
  set perfil_id = p_perfil, perfil_version = v_version, correo = p_correo,
      celular = p_celular, estado = coalesce(p_estado, estado)
  where id = p_id;
  delete from usuario_alcance_empresa where usuario_id = p_id;
  delete from usuario_alcance_sede where usuario_id = p_id;
  if not v_super then
    foreach e in array p_empresas loop
      insert into usuario_alcance_empresa (usuario_id, empresa_id) values (p_id, e);
    end loop;
    foreach s in array coalesce(p_sedes, '{}') loop
      insert into usuario_alcance_sede (usuario_id, sede_id) values (p_id, s);
    end loop;
  end if;
end $$;

-- Suspender corta el acceso de inmediato; no borra ni anonimiza nada.
create function suspender_usuario_admin(p_id bigint) returns void
language plpgsql security definer as $$
begin
  update usuarios_admin set estado = 'suspendido' where id = p_id;
end $$;

create function reactivar_usuario_admin(p_id bigint) returns void
language plpgsql security definer as $$
begin
  update usuarios_admin set estado = 'activo' where id = p_id;
end $$;

create function reenviar_clave(p_id bigint, p_clave text) returns void
language plpgsql security definer as $$
begin
  update usuarios_admin
  set clave_provisional = p_clave,
      clave_entregada = case when correo is null then 'pantalla' else 'correo' end
  where id = p_id;
end $$;

create function guardar_politica(
  p_backoffice_horas int, p_portal_dias int,
  p_multisesion_backoffice boolean, p_multisesion_portal boolean,
  p_intentos int, p_bloqueo_min int, p_recuperacion text,
  p_clave_min int, p_provisional_dias int, p_por text
) returns void language plpgsql security definer as $$
begin
  update politica_acceso
  set sesion_backoffice_horas = p_backoffice_horas,
      sesion_portal_dias      = p_portal_dias,
      multisesion_backoffice  = p_multisesion_backoffice,
      multisesion_portal      = p_multisesion_portal,
      intentos_bloqueo        = p_intentos,
      bloqueo_minutos         = p_bloqueo_min,
      recuperacion_defecto    = p_recuperacion,
      clave_longitud_min      = p_clave_min,
      clave_provisional_dias  = p_provisional_dias,
      actualizado_por         = p_por,
      actualizado_en          = now()
  where id = 1;
end $$;

-- LA regla de evaluación (una sola, aplica en todas partes). Queda lista para
-- conectarse a Supabase Auth + RLS; el alcance debe aplicarse como filtro de
-- fila (resultado vacío), no como error de permiso.
create function puede(
  p_usuario bigint, p_modulo text, p_nivel int,
  p_empresa text default null, p_sede text default null
) returns boolean language plpgsql stable security definer as $$
declare v_estado text; v_pid text; v_pver int; v_super boolean; v_nivel int;
begin
  select u.estado, u.perfil_id, u.perfil_version, p.es_superadmin
  into v_estado, v_pid, v_pver, v_super
  from usuarios_admin u
  join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
  where u.id = p_usuario;
  if v_estado is null or v_estado <> 'activo' then return false; end if;
  if v_super then return true; end if;
  select nivel into v_nivel from perfil_permisos
  where perfil_id = v_pid and perfil_version = v_pver and modulo = p_modulo;
  if coalesce(v_nivel, 0) < p_nivel then return false; end if;
  if p_empresa is not null and not exists (
    select 1 from usuario_alcance_empresa a
    where a.usuario_id = p_usuario and a.empresa_id = p_empresa) then
    return false;
  end if;
  if p_sede is not null
     and exists (select 1 from usuario_alcance_sede where usuario_id = p_usuario)
     and not exists (select 1 from usuario_alcance_sede a
                     where a.usuario_id = p_usuario and a.sede_id = p_sede) then
    return false;
  end if;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- SEED — Anexo A (plantillas sugeridas) + usuarios iniciales
-- ---------------------------------------------------------------------------
select guardar_perfil('superadmin', 'Superadministrador',
  'Control total del grupo. La marca ignora la matriz y el alcance.',
  true, false, false, false, '{}'::jsonb, 'Sistema');
select guardar_perfil('rrhh-operativo', 'RRHH operativo',
  'Opera los módulos de RRHH del día a día, sin aprobaciones.',
  false, false, false, false,
  '{"personal":2,"boletas":2,"acuses":2,"comunicados":2,"memorandums":2,"contratos":2,"tardanzas":2,"activos":1,"accesos":0,"auditoria":0,"configuracion":1}'::jsonb,
  'Sistema');
select guardar_perfil('jefatura-rrhh', 'Jefatura de RRHH',
  'Opera y aprueba en los módulos de RRHH. Ve remuneración y exporta datos personales.',
  false, true, true, true,
  '{"personal":3,"boletas":3,"acuses":2,"comunicados":3,"memorandums":3,"contratos":3,"tardanzas":2,"activos":1,"accesos":0,"auditoria":0,"configuracion":1}'::jsonb,
  'Sistema');
select guardar_perfil('administracion', 'Administración',
  'Gestiona activos, equipos y EPP de todo el grupo.',
  false, false, false, false,
  '{"personal":1,"boletas":0,"acuses":0,"comunicados":0,"memorandums":0,"contratos":0,"tardanzas":0,"activos":3,"accesos":0,"auditoria":0,"configuracion":1}'::jsonb,
  'Sistema');
select guardar_perfil('supervisor-sede', 'Supervisor de sede',
  'Registra acuses asistidos y consulta su cuadrilla, sin ver el contenido de las boletas.',
  false, false, false, false,
  '{"personal":1,"boletas":0,"acuses":2,"comunicados":1,"memorandums":0,"contratos":0,"tardanzas":0,"activos":0,"accesos":0,"auditoria":0,"configuracion":0}'::jsonb,
  'Sistema');
select guardar_perfil('auditor', 'Auditor',
  'Solo lectura en los once módulos, con exportación de datos personales.',
  false, false, false, true,
  '{"personal":1,"boletas":1,"acuses":1,"comunicados":1,"memorandums":1,"contratos":1,"tardanzas":1,"activos":1,"accesos":1,"auditoria":1,"configuracion":1}'::jsonb,
  'Sistema');

-- Personas administrativas (Diego y Karina) + vínculos
insert into personas (dni, nombre, celular, banco, cuenta, portal) values
  ('40776655', 'Diego Salguero Tang', '999888777', 'BCP',       '191-55667788-0-01', 'activo'),
  ('40881122', 'Karina Prado Salas',  '988776655', 'Interbank', '898-3007788990',    'activo')
on conflict (dni) do nothing;
insert into vinculos (persona_dni, empresa_id, sede_id, cargo, fecha_inicio)
select t.dni, 'negliaf', 'sunat', t.cargo, t.inicio::date
from (values
  ('40776655', 'Jefe de RRHH',  '2020-01-15'),
  ('40881122', 'Analista RRHH', '2021-04-01')
) as t(dni, cargo, inicio)
where not exists (select 1 from vinculos v
                  where v.persona_dni = t.dni and v.empresa_id = 'negliaf' and v.fecha_fin is null);

select crear_usuario_admin('40776655', 'superadmin', 'dsalguero@grupoer.pe', '999888777', null, null, null, 'Sistema');
select crear_usuario_admin('40881122', 'rrhh-operativo', 'kprado@grupoer.pe', '988776655',
  array['negliaf','bremco','promant','lamericana'], null, null, 'Sistema');
select crear_usuario_admin('40125634', 'supervisor-sede', null, '912345678',
  array['negliaf'], array['sunat','migraciones'], 'DEMO2026A', 'Sistema');
select crear_usuario_admin('43906712', 'supervisor-sede', 'ctorres@grupoer.pe', '934567812',
  array['negliaf'], array['minedu','ins'], 'DEMO2026B', 'Sistema');

update usuarios_admin set ultimo_ingreso = '2026-08-12 08:45-05' where persona_dni = '40776655';
update usuarios_admin set ultimo_ingreso = '2026-08-11 17:20-05' where persona_dni = '40881122';
update usuarios_admin set ultimo_ingreso = '2026-08-09 17:30-05' where persona_dni = '40125634';

insert into registro_accesos (usuario_id, dni, perfil_id, perfil_version, superficie, resultado, fecha, ip, dispositivo)
select u.id, u.persona_dni, u.perfil_id, u.perfil_version, t.superficie, t.resultado, t.fecha::timestamptz, t.ip, t.disp
from (values
  ('40776655', 'backoffice', 'exitoso', '2026-08-12 08:45-05', '200.48.12.5',  'Windows · Chrome'),
  ('40881122', 'backoffice', 'exitoso', '2026-08-11 17:20-05', '200.48.12.8',  'Windows · Edge'),
  ('40881122', 'backoffice', 'fallido', '2026-08-11 12:44-05', '200.48.12.8',  'Windows · Edge'),
  ('40125634', 'backoffice', 'exitoso', '2026-08-09 17:30-05', '181.65.44.2',  'Android 12 · Chrome Mobile')
) as t(dni, superficie, resultado, fecha, ip, disp)
join usuarios_admin u on u.persona_dni = t.dni;

-- Ingresos del Portal (trabajadores, sin usuario administrativo)
insert into registro_accesos (dni, superficie, resultado, fecha, ip, dispositivo) values
  ('45231876', 'portal', 'exitoso',   '2026-08-11 19:02-05', '181.65.212.44', 'Android 12 · Chrome Mobile'),
  ('47893456', 'portal', 'fallido',   '2026-08-10 21:15-05', '190.42.77.31',  'Android 10 · Chrome Mobile'),
  ('47893456', 'portal', 'bloqueado', '2026-08-10 21:18-05', '190.42.77.31',  'Android 10 · Chrome Mobile'),
  ('48012765', 'portal', 'exitoso',   '2026-08-09 07:58-05', '201.230.14.9',  'Android 13 · Chrome Mobile');

-- Auditoría sobre las tablas del módulo
do $$
declare t text;
begin
  foreach t in array array['perfiles','perfil_permisos','usuarios_admin',
    'usuario_alcance_empresa','usuario_alcance_sede','politica_acceso']
  loop
    execute format('create trigger trg_auditar_%s after insert or update or delete on %I
                    for each row execute function fn_auditar()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- VISTAS DE LECTURA (contrato de datos con la interfaz)
-- ---------------------------------------------------------------------------
create view v_perfiles as
select p.id, p.version, p.nombre, p.descripcion,
       p.es_superadmin as "esSuperadmin",
       p.ver_remuneracion as "verRemuneracion",
       p.ver_documentos_terceros as "verDocumentosTerceros",
       p.exportar_datos_personales as "exportarDatosPersonales",
       p.estado,
       coalesce((select jsonb_object_agg(pp.modulo, pp.nivel)
                 from perfil_permisos pp
                 where pp.perfil_id = p.id and pp.perfil_version = p.version), '{}'::jsonb) as matriz,
       (select count(*)::int from usuarios_admin u where u.perfil_id = p.id) as usuarios,
       to_char(p.creado_en, 'YYYY-MM-DD HH24:MI') as modificado,
       p.creado_por as "modificadoPor"
from perfiles p
where p.version = (select max(version) from perfiles p2 where p2.id = p.id)
order by p.es_superadmin desc, p.nombre;

create view v_perfil_versiones as
select p.id as "perfilId", p.version, p.nombre,
       p.es_superadmin as "esSuperadmin",
       coalesce((select jsonb_object_agg(pp.modulo, pp.nivel)
                 from perfil_permisos pp
                 where pp.perfil_id = p.id and pp.perfil_version = p.version), '{}'::jsonb) as matriz,
       to_char(p.creado_en, 'YYYY-MM-DD HH24:MI') as creado,
       p.creado_por as por
from perfiles p
order by p.id, p.version desc;

create view v_usuarios_admin as
select u.id, u.persona_dni as dni, pe.nombre,
       u.perfil_id as perfil, pf.nombre as "perfilNombre",
       pf.es_superadmin as "esSuperadmin",
       u.correo, u.celular, u.estado,
       coalesce((select jsonb_agg(a.empresa_id) from usuario_alcance_empresa a
                 where a.usuario_id = u.id), '[]'::jsonb) as empresas,
       coalesce((select jsonb_agg(a.sede_id) from usuario_alcance_sede a
                 where a.usuario_id = u.id), '[]'::jsonb) as sedes,
       to_char(u.ultimo_ingreso, 'YYYY-MM-DD HH24:MI') as "ultimoIngreso",
       (u.ultimo_ingreso is null) as "nuncaIngreso",
       (u.estado = 'activo' and not exists
         (select 1 from vinculos v where v.persona_dni = u.persona_dni and v.fecha_fin is null)) as inconsistencia,
       vi.cargo, vi.sede_id as sede, vi.empresa_id as empresa,
       to_char(u.creado_en, 'YYYY-MM-DD') as creado
from usuarios_admin u
join personas pe on pe.dni = u.persona_dni
join perfiles pf on pf.id = u.perfil_id and pf.version = u.perfil_version
left join vinculos vi on vi.persona_dni = u.persona_dni and vi.fecha_fin is null
order by pf.es_superadmin desc, pe.nombre;

create view v_politica_acceso as
select sesion_backoffice_horas as "sesionBackofficeHoras",
       sesion_portal_dias      as "sesionPortalDias",
       multisesion_backoffice  as "multisesionBackoffice",
       multisesion_portal      as "multisesionPortal",
       intentos_bloqueo        as "intentosBloqueo",
       bloqueo_minutos         as "bloqueoMinutos",
       recuperacion_defecto    as "recuperacionDefecto",
       clave_longitud_min      as "claveLongitudMin",
       clave_provisional_dias  as "claveProvisionalDias",
       to_char(actualizado_en, 'YYYY-MM-DD HH24:MI') as actualizado,
       actualizado_por as "actualizadoPor"
from politica_acceso where id = 1;

create view v_registro_accesos as
select r.id,
       to_char(r.fecha, 'YYYY-MM-DD HH24:MI') as fecha,
       coalesce(pe.nombre, r.dni, '—') as usuario,
       coalesce(pf.nombre, 'Portal del Trabajador') as perfil,   -- versión vigente AL MOMENTO
       r.superficie, r.resultado, r.ip, r.dispositivo,
       vi.empresa_id as empresa
from registro_accesos r
left join usuarios_admin u on u.id = r.usuario_id
left join personas pe on pe.dni = coalesce(u.persona_dni, r.dni)
left join perfiles pf on pf.id = r.perfil_id and pf.version = r.perfil_version
left join vinculos vi on vi.persona_dni = pe.dni and vi.fecha_fin is null
order by r.fecha desc;
