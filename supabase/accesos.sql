-- ============================================================================
-- MÓDULO DE ACCESOS Y ROLES (ACC-01…ACC-06) — complemento del esquema v2
-- (Accesos v2 "Categorías", 2026-08-13 — spec docs/superpowers/specs/)
-- · La Categoría (perfil versionado) dice QUÉ puede hacer alguien y SOBRE QUÉ
--   razones sociales. El usuario hereda tal cual; no hay alcance por usuario.
-- · La categoría se VERSIONA: cada guardado inserta una versión nueva; la
--   auditoría referencia la versión vigente al momento de cada acción.
-- · Superadministrador es una MARCA, no un nivel: sin matriz, sin alcance.
-- · Invariantes garantizados por el esquema, no por la interfaz.
-- Si schema.sql se vuelve a aplicar (reset), este archivo debe re-aplicarse.
-- ============================================================================

drop view if exists v_perfiles, v_perfil_versiones, v_usuarios_admin,
  v_politica_acceso, v_registro_accesos, v_mi_acceso cascade;
drop table if exists registro_accesos, usuarios_admin, politica_acceso,
  perfil_empresas, perfil_permisos, perfiles cascade;
drop sequence if exists seq_usuario_codigo;
drop function if exists guardar_perfil, desactivar_perfil, eliminar_perfil, fn_nivel_memorandums, fn_nivel_modulo, crear_usuario_admin,
  actualizar_usuario_admin, suspender_usuario_admin, reactivar_usuario_admin,
  eliminar_usuario_admin, reenviar_clave, guardar_politica, puede,
  verificar_bloqueo, registrar_ingreso, marcar_clave_cambiada,
  registrar_sesion_backoffice, mi_sesion_backoffice,
  fn_perfil_nombre_unico, fn_superadmin_sin_matriz,
  fn_proteger_ultimo_superadmin, fn_registro_solo_desvincular cascade;
-- es_admin_activo() NO se dropea aquí: las políticas de storage.objects
-- (Task 12, en la migración) dependen de ella, y este archivo no es dueño de
-- esas políticas — un `drop ... cascade` aquí las borraría como efecto
-- secundario sorpresa. Se recrea más abajo con `create or replace`.

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
  ver_datos_bancarios       boolean not null default false, -- #10: cuenta de haberes completa
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
     'tardanzas','asistencia','activos','soporte','solicitudes','accesos','auditoria','configuracion')),
  nivel          integer not null check (nivel between 0 and 3),
  primary key (perfil_id, perfil_version, modulo),
  foreign key (perfil_id, perfil_version) references perfiles (id, version),
  -- El nivel 3 solo existe donde hay algo que aprobar.
  constraint nivel_3_solo_con_aprobacion check (
    nivel < 3 or modulo in ('personal','boletas','comunicados','memorandums',
                            'contratos','activos','soporte','solicitudes','accesos','configuracion'))
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

-- Alcance por razón social de la categoría, versionado igual que la matriz.
create table perfil_empresas (
  perfil_id  text not null,
  version    integer not null,
  empresa_id text not null references empresas(id),
  primary key (perfil_id, version, empresa_id),
  foreign key (perfil_id, version) references perfiles(id, version) on delete cascade
);

-- ---------------------------------------------------------------------------
-- USUARIOS ADMINISTRATIVOS (toda acción lleva el nombre de una Persona)
-- ---------------------------------------------------------------------------
create sequence seq_usuario_codigo;
create table usuarios_admin (
  id             bigint generated always as identity primary key,
  codigo         text unique, -- U-0001, U-0002… (lo asigna crear_usuario_admin)
  persona_dni    text not null unique references personas(dni),
  perfil_id      text not null,
  perfil_version integer not null,
  correo         text,
  celular        text,  -- LIBRE: puede venir con +51 o espacios
  estado         text not null default 'activo' check (estado in ('activo','suspendido')),
  clave_provisional text,
  clave_entregada   text check (clave_entregada in ('correo','pantalla')),
  requiere_cambio_clave boolean not null default false,
  ultimo_ingreso timestamptz,
  sesion_actual  text,  -- marcador de sesión única (gana el login nuevo)
  creado_por     text not null,
  creado_en      timestamptz not null default now(),
  foreign key (perfil_id, perfil_version) references perfiles (id, version)
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
  -- Longitud mínima DIFERENCIADA (Cierre de Acceso v1.0): el operario tipea
  -- en celulares de gama baja; el usuario administrativo no tiene esa excusa.
  clave_longitud_min_portal     int not null default 6  check (clave_longitud_min_portal >= 6),
  clave_longitud_min_backoffice int not null default 6
    constraint chk_clave_min_backoffice check (clave_longitud_min_backoffice >= 6),
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
  -- set null: al eliminar definitivamente un usuario, su rastro queda (dni y
  -- correo ya están denormalizados en cada fila).
  usuario_id     bigint references usuarios_admin(id) on delete set null,
  dni            text,                                -- ingreso por Portal (trabajador)
  correo         text,                                -- intento por BackOffice (aun inexistente)
  perfil_id      text,
  perfil_version integer,                             -- perfil VIGENTE en ese momento
  superficie     text not null check (superficie in ('portal','backoffice')),
  resultado      text not null check (resultado in ('exitoso','fallido','bloqueado')),
  fecha          timestamptz not null default now(),  -- reloj del SERVIDOR
  ip             text,
  dispositivo    text
);
-- Inmutable, con UNA excepción: la desvinculación (usuario_id → null) que
-- dispara la eliminación definitiva del usuario. Nada más puede cambiar.
create function fn_registro_solo_desvincular() returns trigger
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
    return new;
  end if;
  raise exception 'El registro de accesos es inmutable.';
end $$;
create trigger trg_registro_accesos_inmutable
  before update or delete on registro_accesos
  for each row execute function fn_registro_solo_desvincular();

-- ---------------------------------------------------------------------------
-- FUNCIONES RPC
-- ---------------------------------------------------------------------------

-- Cada guardado crea una versión nueva; las anteriores no se tocan. Los
-- usuarios asignados pasan a la versión nueva (el cambio surte efecto en su
-- siguiente petición, no en su siguiente ingreso).
create function guardar_perfil(
  p_id text, p_nombre text, p_descripcion text, p_superadmin boolean,
  p_ver_remuneracion boolean, p_ver_documentos boolean, p_exportar boolean,
  p_matriz jsonb, p_empresas text[] default null, p_por text default 'BackOffice',
  p_ver_bancarios boolean default false
) returns integer language plpgsql security definer as $$
declare v_version int; v_mod text; v_nivel text; v_empresas text[]; e text;
begin
  select coalesce(max(version), 0) + 1 into v_version from perfiles where id = p_id;
  insert into perfiles (id, version, nombre, descripcion, es_superadmin,
                        ver_remuneracion, ver_documentos_terceros,
                        exportar_datos_personales, ver_datos_bancarios, creado_por)
  values (p_id, v_version, p_nombre, p_descripcion, p_superadmin,
          p_ver_remuneracion, p_ver_documentos, p_exportar, p_ver_bancarios, p_por);
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

-- Un perfil con usuarios no se elimina: se desactiva (todas sus versiones).
create function desactivar_perfil(p_id text) returns void
language plpgsql security definer as $$
begin
  update perfiles set estado = 'desactivado' where id = p_id;
end $$;

-- Eliminación definitiva (2026-08-17): jamás superadmin, jamás con usuarios
-- asignados. Borra todas las versiones (matriz incluida; alcance cae por
-- cascade). ACC-06 conserva el rastro (perfil_id/version son texto propio,
-- sin FK) y queda una fila de auditoría con lo eliminado.
create function eliminar_perfil(p_id text) returns void
language plpgsql security definer as $$
declare v_nombre text;
begin
  select nombre into v_nombre from perfiles where id = p_id order by version desc limit 1;
  if v_nombre is null then
    raise exception 'La categoría no existe.';
  end if;
  if exists (select 1 from perfiles where id = p_id and es_superadmin) then
    raise exception 'La categoría de superadministrador no se elimina.';
  end if;
  if exists (select 1 from usuarios_admin where perfil_id = p_id) then
    raise exception 'La categoría «%» tiene usuarios asignados: reasígnalos o elimínalos primero.', v_nombre;
  end if;
  delete from perfil_permisos where perfil_id = p_id;
  delete from perfiles where id = p_id; -- perfil_empresas cae en cascada
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('ELIMINAR_PERFIL', 'perfiles', jsonb_build_object('id', p_id, 'nombre', v_nombre), null);
end $$;

-- Único camino de lectura de la cuenta bancaria completa (#10, 2026-08-22).
-- Registra en auditoría SIEMPRE (tenga permiso o no); devuelve null sin
-- permiso (no excepción: la excepción desharía el registro). Ley 29733.
create or replace function fn_ver_cuenta_bancaria(p_dni text) returns jsonb
language plpgsql security definer as $$
declare v_correo text; v_ok boolean; v_cuenta text; v_banco text; v_cci text;
begin
  begin
    v_correo := nullif(auth.jwt() ->> 'email', '');
  exception when others then
    v_correo := null;
  end;
  select (p.es_superadmin or p.ver_datos_bancarios) into v_ok
  from usuarios_admin u
  join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
  where lower(u.correo) = lower(coalesce(v_correo, '')) and u.estado = 'activo';
  v_ok := coalesce(v_ok, false);
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('VER_CUENTA_BANCARIA', 'personas', null,
          jsonb_build_object('dni', p_dni, 'por', v_correo, 'autorizado', v_ok));
  if not v_ok then return null; end if;
  select fn_descifrar_cuenta(p.cuenta_cifrada), p.banco, p.cci
    into v_cuenta, v_banco, v_cci from personas p where p.dni = p_dni;
  return jsonb_build_object('cuenta', v_cuenta, 'banco', v_banco, 'cci', v_cci);
end $$;

-- Nivel del llamador en el módulo memorandums (disciplinario 2026-08-17):
-- valida server-side quién puede imponer qué sanción. Vive aquí y no en
-- schema.sql porque depende de usuarios_admin/perfiles. Sin JWT (llamadas de
-- servicio) devuelve 99.
-- Nivel del llamador en CUALQUIER módulo (edición de Personal, etc.).
create function fn_nivel_modulo(p_modulo text)
returns int language plpgsql stable security definer as $$
declare v_correo text; v_nivel int;
begin
  begin
    v_correo := nullif(auth.jwt() ->> 'email', '');
  exception when others then
    v_correo := null;
  end;
  if v_correo is null then return 99; end if;
  select case when p.es_superadmin then 99
              else coalesce((select pp.nivel from perfil_permisos pp
                             where pp.perfil_id = u.perfil_id
                               and pp.perfil_version = u.perfil_version
                               and pp.modulo = p_modulo), 0) end
  into v_nivel
  from usuarios_admin u
  join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
  where lower(u.correo) = lower(v_correo) and u.estado = 'activo';
  return coalesce(v_nivel, 0);
end $$;

create function fn_nivel_memorandums()
returns int language plpgsql stable security definer as $$
declare v_correo text; v_nivel int;
begin
  begin
    v_correo := nullif(auth.jwt() ->> 'email', '');
  exception when others then
    v_correo := null;
  end;
  if v_correo is null then return 99; end if;
  select case when p.es_superadmin then 99
              else coalesce((select pp.nivel from perfil_permisos pp
                             where pp.perfil_id = u.perfil_id
                               and pp.perfil_version = u.perfil_version
                               and pp.modulo = 'memorandums'), 0) end
  into v_nivel
  from usuarios_admin u
  join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
  where lower(u.correo) = lower(v_correo) and u.estado = 'activo';
  return coalesce(v_nivel, 0);
end $$;

create function crear_usuario_admin(
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

create function actualizar_usuario_admin(
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

-- Eliminación definitiva: el trigger del último superadmin protege; el
-- registro de accesos conserva el rastro (FK set null + dni/correo propios).
create function eliminar_usuario_admin(p_id bigint) returns void
language plpgsql security definer as $$
begin
  if not exists (select 1 from usuarios_admin where id = p_id) then
    raise exception 'El usuario no existe.';
  end if;
  delete from usuarios_admin where id = p_id;
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
  p_clave_min_portal int, p_clave_min_backoffice int,
  p_provisional_dias int, p_por text
) returns void language plpgsql security definer as $$
begin
  update politica_acceso
  set sesion_backoffice_horas       = p_backoffice_horas,
      sesion_portal_dias            = p_portal_dias,
      multisesion_backoffice        = p_multisesion_backoffice,
      multisesion_portal            = p_multisesion_portal,
      intentos_bloqueo              = p_intentos,
      bloqueo_minutos               = p_bloqueo_min,
      recuperacion_defecto          = p_recuperacion,
      clave_longitud_min_portal     = p_clave_min_portal,
      clave_longitud_min_backoffice = p_clave_min_backoffice,
      clave_provisional_dias        = p_provisional_dias,
      actualizado_por               = p_por,
      actualizado_en                = now()
  where id = 1;
end $$;

-- Bloqueo por intentos fallidos (ACC-05): fallidos consecutivos posteriores
-- al último ingreso exitoso, dentro de la ventana de bloqueo.
create function verificar_bloqueo(p_correo text) returns boolean
language plpgsql stable security definer as $$
declare pol politica_acceso%rowtype; ultimo_ok timestamptz; fallidos int;
begin
  select * into pol from politica_acceso where id = 1;
  select max(fecha) into ultimo_ok from registro_accesos
  where correo = p_correo and resultado = 'exitoso';
  select count(*) into fallidos from registro_accesos
  where correo = p_correo and resultado = 'fallido'
    and fecha > now() - make_interval(mins => pol.bloqueo_minutos)
    and (ultimo_ok is null or fecha > ultimo_ok);
  return fallidos >= pol.intentos_bloqueo;
end $$;

-- Bitácora de login del BackOffice: registra TODO intento (incluidos correos
-- inexistentes, con usuario_id nulo) y actualiza ultimo_ingreso si fue exitoso.
create function registrar_ingreso(p_correo text, p_resultado text, p_dispositivo text)
returns void language plpgsql security definer as $$
declare u usuarios_admin%rowtype;
begin
  select * into u from usuarios_admin where correo = p_correo;
  insert into registro_accesos (usuario_id, dni, correo, perfil_id, perfil_version,
                                superficie, resultado, ip, dispositivo)
  values (u.id, u.persona_dni, p_correo, u.perfil_id, u.perfil_version,
          'backoffice', p_resultado, null, p_dispositivo);
  if p_resultado = 'exitoso' and u.id is not null then
    update usuarios_admin set ultimo_ingreso = now() where id = u.id;
  end if;
end $$;

create function marcar_clave_cambiada(p_correo text) returns void
language plpgsql security definer as $$
begin
  update usuarios_admin
  set requiere_cambio_clave = false, clave_provisional = null
  where correo = p_correo;
end $$;

-- Sesión única (gana el login nuevo): el login registra un marcador; la app se
-- autoexpulsa si el del servidor cambió. El usuario se resuelve por el email
-- del JWT (usuarios_admin.id es bigint, no el uuid de Auth).
create function registrar_sesion_backoffice(p_marker text)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  update usuarios_admin u
  set sesion_actual = p_marker
  from auth.users au
  where au.id = auth.uid() and au.email = u.correo;
end $$;

create function mi_sesion_backoffice()
returns text language sql security definer set search_path = public, auth as $$
  select u.sesion_actual from usuarios_admin u
  join auth.users au on au.email = u.correo
  where au.id = auth.uid()
$$;
grant execute on function registrar_sesion_backoffice(text), mi_sesion_backoffice() to authenticated, anon;

-- Task 12: helper para políticas RLS que necesitan saber si el JWT actual
-- pertenece a un usuario del BackOffice activo (p. ej. storage.objects del
-- bucket `documentos`, subida de boletas). usuarios_admin.id es bigint, NO el
-- uuid de Supabase Auth, así que el cruce va por correo contra auth.users vía
-- auth.uid(). SECURITY DEFINER evita depender de permisos de `authenticated`
-- sobre el esquema `auth` (que normalmente no puede leer).
--
-- Por qué NO auth.jwt()->>'email' directo en la política: verificado en
-- producción que auth.jwt() no resuelve de forma fiable en el contexto de
-- evaluación de storage-api (a diferencia de auth.uid(), que storage sí usa,
-- hasta para la columna owner) — daba 403 con un JWT de superadmin válido y
-- correcto, tanto vía proxy como directo contra Supabase.
create or replace function es_admin_activo() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.usuarios_admin u
    join auth.users au on au.email = u.correo
    where au.id = auth.uid() and u.estado = 'activo'
  )
$$;
revoke all on function es_admin_activo() from public;
grant execute on function es_admin_activo() to authenticated;

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
    select 1 from perfil_empresas a
    where a.perfil_id = v_pid and a.version = v_pver and a.empresa_id = p_empresa) then
    return false;
  end if;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- SEED — Anexo A (plantillas sugeridas) + usuarios iniciales
-- ---------------------------------------------------------------------------
select guardar_perfil('superadmin', 'Superadministrador',
  'Control total del grupo. La marca ignora la matriz y el alcance.',
  true, false, false, false, '{}'::jsonb, null, 'Sistema');
select guardar_perfil('rrhh-operativo', 'RRHH operativo',
  'Opera los módulos de RRHH del día a día, sin aprobaciones.',
  false, false, false, false,
  '{"personal":2,"boletas":2,"acuses":2,"comunicados":2,"memorandums":2,"contratos":2,"tardanzas":2,"activos":1,"accesos":0,"auditoria":0,"configuracion":1}'::jsonb,
  null, 'Sistema');
select guardar_perfil('jefatura-rrhh', 'Jefatura de RRHH',
  'Opera y aprueba en los módulos de RRHH. Ve remuneración y exporta datos personales.',
  false, true, true, true,
  '{"personal":3,"boletas":3,"acuses":2,"comunicados":3,"memorandums":3,"contratos":3,"tardanzas":2,"activos":1,"accesos":0,"auditoria":0,"configuracion":1}'::jsonb,
  null, 'Sistema');
select guardar_perfil('administracion', 'Administración',
  'Gestiona activos, equipos y EPP de todo el grupo.',
  false, false, false, false,
  '{"personal":1,"boletas":0,"acuses":0,"comunicados":0,"memorandums":0,"contratos":0,"tardanzas":0,"activos":3,"accesos":0,"auditoria":0,"configuracion":1}'::jsonb,
  null, 'Sistema');
select guardar_perfil('supervisor-sede', 'Supervisor de sede',
  'Registra acuses asistidos y consulta su cuadrilla, sin ver el contenido de las boletas.',
  false, false, false, false,
  '{"personal":1,"boletas":0,"acuses":2,"comunicados":1,"memorandums":0,"contratos":0,"tardanzas":0,"activos":0,"accesos":0,"auditoria":0,"configuracion":0}'::jsonb,
  null, 'Sistema');
select guardar_perfil('auditor', 'Auditor',
  'Solo lectura en los once módulos, con exportación de datos personales.',
  false, false, false, true,
  '{"personal":1,"boletas":1,"acuses":1,"comunicados":1,"memorandums":1,"contratos":1,"tardanzas":1,"activos":1,"accesos":1,"auditoria":1,"configuracion":1}'::jsonb,
  null, 'Sistema');

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

-- Accesos v2: la categoría Gerente de Administración y el archivado de las
-- plantillas de ejemplo (por ahora solo dos categorías activas).
select guardar_perfil('gerente-administracion', 'Gerente de Administración',
  'Gestiona la administración del grupo y los usuarios del BackOffice.',
  false, false, false, false,
  '{"personal":1,"boletas":0,"acuses":0,"comunicados":0,"memorandums":0,"contratos":0,"tardanzas":0,"activos":3,"accesos":2,"auditoria":1,"configuracion":1}'::jsonb,
  null, 'Sistema');
update perfiles set estado = 'desactivado'
where id not in ('superadmin', 'gerente-administracion');

select crear_usuario_admin('40776655', 'superadmin', 'dsalguero@grupoer.pe', '999888777', null, 'Sistema');
select crear_usuario_admin('40881122', 'gerente-administracion', 'kprado@grupoer.pe', '988776655', null, 'Sistema');

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
  foreach t in array array['perfiles','perfil_permisos','perfil_empresas',
    'usuarios_admin','politica_acceso']
  loop
    execute format('create trigger trg_auditar_%s after insert or update or delete on %I
                    for each row execute function fn_auditar()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS (misma política demo permisiva de schema.sql; se endurecerá con
-- Supabase Auth) y defensa extra sobre el registro inmutable
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['perfiles','perfil_permisos','perfil_empresas',
    'usuarios_admin','politica_acceso','registro_accesos']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy acceso_demo on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;
revoke update, delete on registro_accesos from anon, authenticated;

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
       coalesce((select jsonb_agg(pe.empresa_id order by pe.empresa_id)
                 from perfil_empresas pe
                 where pe.perfil_id = p.id and pe.version = p.version), '[]'::jsonb) as empresas,
       (select count(*)::int from usuarios_admin u where u.perfil_id = p.id) as usuarios,
       to_char(p.creado_en, 'YYYY-MM-DD HH24:MI') as modificado,
       p.creado_por as "modificadoPor",
       p.ver_datos_bancarios as "verDatosBancarios"
from perfiles p
where p.version = (select max(version) from perfiles p2 where p2.id = p.id)
order by p.es_superadmin desc, p.nombre;

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

create view v_usuarios_admin as
select u.id, u.codigo, u.persona_dni as dni, pe.nombre,
       u.perfil_id as perfil, pf.nombre as "perfilNombre",
       pf.es_superadmin as "esSuperadmin",
       u.correo, u.celular, u.estado,
       u.requiere_cambio_clave as "requiereCambio",
       coalesce((select jsonb_agg(a.empresa_id order by a.empresa_id)
                 from perfil_empresas a
                 where a.perfil_id = u.perfil_id and a.version = u.perfil_version), '[]'::jsonb) as empresas,
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

-- Lo que el usuario autenticado ES: su categoría vigente, resuelta. La app la
-- carga al iniciar sesión y de ahí salen menú, selector de empresa y guards.
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
                 where a.perfil_id = pf.id and a.version = pf.version), '[]'::jsonb) as empresas,
       pf.ver_datos_bancarios as "verDatosBancarios"
from usuarios_admin u
join perfiles pf on pf.id = u.perfil_id and pf.version = u.perfil_version
where u.estado = 'activo';

create view v_politica_acceso as
select sesion_backoffice_horas as "sesionBackofficeHoras",
       sesion_portal_dias      as "sesionPortalDias",
       multisesion_backoffice  as "multisesionBackoffice",
       multisesion_portal      as "multisesionPortal",
       intentos_bloqueo        as "intentosBloqueo",
       bloqueo_minutos         as "bloqueoMinutos",
       recuperacion_defecto    as "recuperacionDefecto",
       clave_longitud_min_portal     as "claveLongitudMinPortal",
       clave_longitud_min_backoffice as "claveLongitudMinBackoffice",
       clave_provisional_dias  as "claveProvisionalDias",
       to_char(actualizado_en, 'YYYY-MM-DD HH24:MI') as actualizado,
       actualizado_por as "actualizadoPor"
from politica_acceso where id = 1;

create view v_registro_accesos as
select r.id,
       to_char(r.fecha, 'YYYY-MM-DD HH24:MI') as fecha,
       coalesce(pe.nombre, r.dni, r.correo, '—') as usuario,
       coalesce(pf.nombre, case when r.superficie = 'portal'
                then 'Portal del Trabajador' else '—' end) as perfil,   -- versión vigente AL MOMENTO
       r.superficie, r.resultado, r.ip, r.dispositivo,
       vi.empresa_id as empresa
from registro_accesos r
left join usuarios_admin u on u.id = r.usuario_id
left join personas pe on pe.dni = coalesce(u.persona_dni, r.dni)
left join perfiles pf on pf.id = r.perfil_id and pf.version = r.perfil_version
left join vinculos vi on vi.persona_dni = pe.dni and vi.fecha_fin is null
order by r.fecha desc;
