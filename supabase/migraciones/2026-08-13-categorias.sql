-- ===========================================================================
-- MIGRACIÓN: Accesos v2 — Categorías con alcance por razón social
-- Spec: docs/superpowers/specs/2026-08-13-accesos-categorias-design.md
-- Idempotente: se puede re-aplicar sin daño.
-- ===========================================================================

-- 1 · Alcance por razón social, versionado igual que perfil_permisos --------
create table if not exists perfil_empresas (
  perfil_id  text not null,
  version    integer not null,
  empresa_id text not null references empresas(id),
  primary key (perfil_id, version, empresa_id),
  foreign key (perfil_id, version) references perfiles(id, version) on delete cascade
);

-- 2 · Código de usuario (U-0001) --------------------------------------------
create sequence if not exists seq_usuario_codigo;
alter table usuarios_admin add column if not exists codigo text unique;

-- 3 · Poblar alcance de las versiones vigentes activas (todas las empresas;
--     Diego lo ajustará por categoría desde ACC-04) --------------------------
insert into perfil_empresas (perfil_id, version, empresa_id)
select p.id, p.version, e.id
from perfiles p cross join empresas e
where p.estado = 'activo' and not p.es_superadmin
  and p.version = (select max(version) from perfiles p2 where p2.id = p.id)
on conflict do nothing;

-- 4 · Poblar códigos por orden de registro y sincronizar la secuencia -------
with ordenados as (
  select id, row_number() over (order by creado_en, id) as n
  from usuarios_admin where codigo is null
)
update usuarios_admin u
set codigo = 'U-' || lpad((o.n + coalesce((select max(substring(codigo from 3)::int)
                                           from usuarios_admin
                                           where codigo ~ '^U-[0-9]+$'), 0))::text, 4, '0')
from ordenados o where u.id = o.id;
select setval('seq_usuario_codigo',
  coalesce((select max(substring(codigo from 3)::int) from usuarios_admin
            where codigo ~ '^U-[0-9]+$'), 0) + 1, false);

-- 5 · ACC-06 conserva el rastro al eliminar: la FK desvincula (set null) y el
--     trigger de inmutabilidad permite EXCLUSIVAMENTE esa desvinculación -----
alter table registro_accesos drop constraint if exists registro_accesos_usuario_id_fkey;
alter table registro_accesos add constraint registro_accesos_usuario_id_fkey
  foreign key (usuario_id) references usuarios_admin(id) on delete set null;

create or replace function fn_registro_solo_desvincular() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE'
     and old.usuario_id is not null and new.usuario_id is null
     and new.dni            is not distinct from old.dni
     and new.correo         is not distinct from old.correo
     and new.perfil_id      is not distinct from old.perfil_id
     and new.perfil_version is not distinct from old.perfil_version
     and new.superficie     is not distinct from old.superficie
     and new.resultado      is not distinct from old.resultado
     and new.fecha          is not distinct from old.fecha
     and new.ip             is not distinct from old.ip
     and new.dispositivo    is not distinct from old.dispositivo then
    return new; -- desvinculación por eliminación definitiva del usuario
  end if;
  raise exception 'El registro de accesos es inmutable.';
end $$;
drop trigger if exists trg_registro_accesos_inmutable on registro_accesos;
create trigger trg_registro_accesos_inmutable
  before update or delete on registro_accesos
  for each row execute function fn_registro_solo_desvincular();

-- 6 · guardar_perfil con alcance (p_empresas null = conservar el anterior,
--     o todas si es la primera versión) --------------------------------------
drop function if exists guardar_perfil(text,text,text,boolean,boolean,boolean,boolean,jsonb,text);
create or replace function guardar_perfil(
  p_id text, p_nombre text, p_descripcion text, p_superadmin boolean,
  p_ver_remuneracion boolean, p_ver_documentos boolean, p_exportar boolean,
  p_matriz jsonb, p_empresas text[] default null, p_por text default 'BackOffice'
) returns integer language plpgsql security definer as $$
declare v_version int; v_mod text; v_nivel text; v_empresas text[]; e text;
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
    -- Alcance: explícito > heredado de la versión previa > todas las empresas.
    v_empresas := p_empresas;
    if v_empresas is null then
      select array_agg(empresa_id) into v_empresas
      from perfil_empresas where perfil_id = p_id and version = v_version - 1;
    end if;
    if v_empresas is null or cardinality(v_empresas) = 0 then
      select array_agg(id) into v_empresas from empresas;
    end if;
    foreach e in array v_empresas loop
      insert into perfil_empresas (perfil_id, version, empresa_id) values (p_id, v_version, e);
    end loop;
  end if;
  update usuarios_admin set perfil_version = v_version where perfil_id = p_id;
  return v_version;
end $$;

-- 7 · Usuarios sin alcance propio: la categoría manda ------------------------
drop function if exists crear_usuario_admin(text,text,text,text,text[],text[],text,text);
create or replace function crear_usuario_admin(
  p_dni text, p_perfil text, p_correo text, p_celular text, p_clave text, p_por text
) returns bigint language plpgsql security definer as $$
declare v_id bigint; v_version int;
begin
  if not exists (select 1 from personas where dni = p_dni) then
    raise exception 'La persona % no existe en el maestro de Personal.', p_dni;
  end if;
  select version into v_version
  from perfiles where id = p_perfil and estado = 'activo'
  order by version desc limit 1;
  if v_version is null then
    raise exception 'La categoría % no existe o está archivada.', p_perfil;
  end if;
  insert into usuarios_admin (persona_dni, perfil_id, perfil_version, correo,
                              celular, clave_provisional, clave_entregada,
                              requiere_cambio_clave, codigo, creado_por)
  values (p_dni, p_perfil, v_version, p_correo, p_celular, p_clave,
          case when p_correo is null then 'pantalla' else 'correo' end,
          true, 'U-' || lpad(nextval('seq_usuario_codigo')::text, 4, '0'), p_por)
  returning id into v_id;
  return v_id;
end $$;

drop function if exists actualizar_usuario_admin(bigint,text,text,text,text[],text[],text);
create or replace function actualizar_usuario_admin(
  p_id bigint, p_perfil text, p_correo text, p_celular text, p_estado text
) returns void language plpgsql security definer as $$
declare v_version int;
begin
  select version into v_version
  from perfiles where id = p_perfil and estado = 'activo'
  order by version desc limit 1;
  if v_version is null then
    raise exception 'La categoría % no existe o está archivada.', p_perfil;
  end if;
  update usuarios_admin
  set perfil_id = p_perfil, perfil_version = v_version, correo = p_correo,
      celular = p_celular, estado = coalesce(p_estado, estado)
  where id = p_id;
end $$;

-- 8 · Eliminación definitiva (el trigger del último superadmin protege) ------
create or replace function eliminar_usuario_admin(p_id bigint) returns void
language plpgsql security definer as $$
begin
  if not exists (select 1 from usuarios_admin where id = p_id) then
    raise exception 'El usuario no existe.';
  end if;
  delete from usuarios_admin where id = p_id;
end $$;

-- 9 · puede() evalúa el alcance desde la categoría ---------------------------
create or replace function puede(
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
    select 1 from perfil_empresas a
    where a.perfil_id = v_pid and a.version = v_pver and a.empresa_id = p_empresa) then
    return false;
  end if;
  return true;
end $$;

-- 10 · Vistas v2 (antes de retirar las tablas viejas: la vista vigente de
--      usuarios aún depende de usuario_alcance_empresa) ----------------------
drop view if exists v_perfiles;
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
       coalesce((select jsonb_agg(pe.empresa_id order by pe.empresa_id)
                 from perfil_empresas pe
                 where pe.perfil_id = p.id and pe.version = p.version), '[]'::jsonb) as empresas,
       (select count(*)::int from usuarios_admin u where u.perfil_id = p.id) as usuarios,
       to_char(p.creado_en, 'YYYY-MM-DD HH24:MI') as modificado,
       p.creado_por as "modificadoPor"
from perfiles p
where p.version = (select max(version) from perfiles p2 where p2.id = p.id)
order by p.es_superadmin desc, p.nombre;

drop view if exists v_perfil_versiones;
create view v_perfil_versiones as
select p.id as "perfilId", p.version, p.nombre,
       p.es_superadmin as "esSuperadmin",
       coalesce((select jsonb_object_agg(pp.modulo, pp.nivel)
                 from perfil_permisos pp
                 where pp.perfil_id = p.id and pp.perfil_version = p.version), '{}'::jsonb) as matriz,
       coalesce((select jsonb_agg(pe.empresa_id order by pe.empresa_id)
                 from perfil_empresas pe
                 where pe.perfil_id = p.id and pe.version = p.version), '[]'::jsonb) as empresas,
       to_char(p.creado_en, 'YYYY-MM-DD HH24:MI') as creado,
       p.creado_por as por
from perfiles p
order by p.id, p.version desc;

drop view if exists v_usuarios_admin;
create view v_usuarios_admin as
select u.id, u.codigo, u.persona_dni as dni, pe.nombre,
       u.perfil_id as perfil, pf.nombre as "perfilNombre",
       pf.es_superadmin as "esSuperadmin",
       u.correo, u.celular, u.estado,
       u.requiere_cambio_clave as "requiereCambio",
       coalesce((select jsonb_agg(a.empresa_id order by a.empresa_id)
                 from perfil_empresas a
                 where a.perfil_id = u.perfil_id and a.version = u.perfil_version), '[]'::jsonb) as empresas,
       '[]'::jsonb as sedes, -- transición: la UI vieja aún lo lee; se retira con la UI v2
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

drop view if exists v_mi_acceso;
create view v_mi_acceso as
select u.correo,
       u.id as "usuarioId",
       pf.es_superadmin as "esSuperadmin",
       coalesce((select jsonb_object_agg(pp.modulo, pp.nivel)
                 from perfil_permisos pp
                 where pp.perfil_id = pf.id and pp.perfil_version = pf.version), '{}'::jsonb) as matriz,
       pf.ver_remuneracion as "verRemuneracion",
       pf.ver_documentos_terceros as "verDocumentosTerceros",
       pf.exportar_datos_personales as "exportarDatosPersonales",
       coalesce((select jsonb_agg(a.empresa_id order by a.empresa_id)
                 from perfil_empresas a
                 where a.perfil_id = pf.id and a.version = pf.version), '[]'::jsonb) as empresas
from usuarios_admin u
join perfiles pf on pf.id = u.perfil_id and pf.version = u.perfil_version
where u.estado = 'activo';

-- 11 · Fuera el alcance por usuario (ya nada depende de estas tablas) --------
drop table if exists usuario_alcance_empresa;
drop table if exists usuario_alcance_sede;

-- 12 · Por ahora: solo Superadministrador y Gerente de Administración --------
do $$
begin
  if not exists (select 1 from perfiles where id = 'gerente-administracion') then
    perform guardar_perfil('gerente-administracion', 'Gerente de Administración',
      'Gestiona la administración del grupo y los usuarios del BackOffice.',
      false, false, false, false,
      '{"personal":1,"boletas":0,"acuses":0,"comunicados":0,"memorandums":0,"contratos":0,"tardanzas":0,"activos":3,"accesos":2,"auditoria":1,"configuracion":1}'::jsonb,
      null, 'Sistema');
  end if;
end $$;
update perfiles set estado = 'desactivado'
where id not in ('superadmin', 'gerente-administracion');
