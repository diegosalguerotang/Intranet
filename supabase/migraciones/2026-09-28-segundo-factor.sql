-- supabase/migraciones/2026-09-28-segundo-factor.sql
-- SEGUNDO FACTOR POR CORREO para el Superadministrador.
-- GENERADA por scripts/factor-generar.mjs a partir de supabase/factor.sql.
-- UNA transacción. Reversión: supabase/respaldos/2026-09-28-segundo-factor-reversion.sql.
-- Requiere la fase 6b aplicada. ORDEN: aplicar ANTES del deploy del cliente
-- (con el cliente viejo un superadmin queda en nivel 0 sin pantalla para
-- verificar; con el cliente nuevo y sin migración, mi_segundo_factor no existe
-- y el cliente entra sin factor). Por eso migración → push, uno tras otro.
begin;
set local search_path = public, interno, extensions;

do $$
begin
  if to_regprocedure('public.api_login_permitido(text, text)') is null then raise exception 'factor: se esperaba la fase 6b aplicada (api_login_permitido)'; end if;
  if to_regclass('interno.respaldo_factor') is not null then raise exception 'factor: interno.respaldo_factor ya existe (¿migración aplicada?)'; end if;
end $$;
create table interno.respaldo_factor (objeto text primary key, definicion text not null);
revoke all on table interno.respaldo_factor from public, anon, authenticated;
insert into interno.respaldo_factor
  select 'fn:' || f, pg_get_functiondef(f::regprocedure) from unnest(array['public.fn_nivel_modulo(text)', 'public.guardar_politica(integer, integer, boolean, boolean, integer, integer, text, integer, integer, integer, text)']) as f;
insert into interno.respaldo_factor
  select 'acl:' || f, coalesce(p.proacl::text, '') from unnest(array['public.fn_nivel_modulo(text)', 'public.guardar_politica(integer, integer, boolean, boolean, integer, integer, text, integer, integer, integer, text)']) as f join pg_proc p on p.oid = f::regprocedure;
insert into interno.respaldo_factor
  select 'view:v_politica_acceso', pg_get_viewdef('public.v_politica_acceso'::regclass, true);
insert into interno.respaldo_factor
  select 'acl:view:v_politica_acceso', coalesce(relacl::text, '') from pg_class where oid = 'public.v_politica_acceso'::regclass;

-- supabase/factor.sql — SEGUNDO FACTOR POR CORREO para el Superadministrador
-- (2026-09-28). Canónico. Lo embebe la migración
-- migraciones/2026-09-28-segundo-factor.sql y el bloque @@FACTOR@@ de
-- seguridad.sql (después de la fase 6). Idempotente. Se aplica con
-- search_path = public, interno, extensions.
--
--  1 · politica_acceso.factor_superadmin: interruptor (contingencia técnica).
--  2 · Tablas privadas: factor_codigos, factor_sesiones, dispositivos_confiables.
--  3 · fn_factor_pendiente + fn_nivel_modulo v4: un superadmin con JWT vale 0
--      hasta que su sesión (claim session_id) tenga marca vigente.
--  4 · v_politica_acceso y guardar_politica con el interruptor.
--  5 · mi_segundo_factor (el navegador consulta su estado).
--  6 · api_factor_* (solo service_role; las llama api/segundo-factor.js).

-- 1 · Interruptor ---------------------------------------------------------------
alter table interno.politica_acceso add column if not exists factor_superadmin boolean not null default true;

-- 2 · Tablas privadas -----------------------------------------------------------
create table if not exists interno.factor_codigos (
  id          bigint generated always as identity primary key,
  usuario_id  bigint not null references interno.usuarios_admin(id) on delete cascade,
  session_id  uuid not null,
  codigo_hash text not null,                 -- sha256(codigo || session_id), hex
  creado_en   timestamptz not null default now(),
  expira_en   timestamptz not null,          -- creado_en + 10 min
  intentos    int not null default 0,
  usado_en    timestamptz,
  ip          text,
  agente      text
);
create index if not exists factor_codigos_sesion_idx on interno.factor_codigos (session_id, creado_en desc);

create table if not exists interno.factor_sesiones (
  session_id    uuid primary key,
  usuario_id    bigint not null references interno.usuarios_admin(id) on delete cascade,
  verificado_en timestamptz not null default now(),
  expira_en     timestamptz not null,        -- verificado_en + sesion_backoffice_horas
  via           text not null check (via in ('correo', 'dispositivo')),
  ip            text,
  agente        text
);

create table if not exists interno.dispositivos_confiables (
  id          bigint generated always as identity primary key,
  usuario_id  bigint not null references interno.usuarios_admin(id) on delete cascade,
  token_hash  text not null unique,          -- sha256(token), hex
  creado_en   timestamptz not null default now(),
  expira_en   timestamptz not null,          -- creado_en + 30 días
  ultimo_uso  timestamptz,
  revocado_en timestamptz,
  ip          text,
  agente      text
);

alter table interno.factor_codigos enable row level security;
alter table interno.factor_sesiones enable row level security;
alter table interno.dispositivos_confiables enable row level security;
revoke all on table interno.factor_codigos, interno.factor_sesiones, interno.dispositivos_confiables from public, anon, authenticated, service_role;
revoke all on sequence interno.factor_codigos_id_seq, interno.dispositivos_confiables_id_seq from public, anon, authenticated, service_role;

-- 3 · Guarda ----------------------------------------------------------------------
-- true cuando la política exige el factor, el JWT trae correo de un superadmin
-- activo y su sesión no tiene marca vigente. Sin claim session_id → pendiente.
create or replace function public.fn_factor_pendiente() returns boolean
language plpgsql stable security definer set search_path = public, interno, extensions as $$
declare v_correo text; v_sesion uuid; v_exige boolean; v_usuario bigint;
begin
  select factor_superadmin into v_exige from politica_acceso where id = 1;
  if not coalesce(v_exige, true) then return false; end if;
  begin
    v_correo := nullif(lower(auth.jwt() ->> 'email'), '');
  exception when others then
    v_correo := null;
  end;
  if v_correo is null then return false; end if;
  select u.id into v_usuario
  from usuarios_admin u join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
  where lower(u.correo) = v_correo and u.estado = 'activo' and p.es_superadmin;
  if v_usuario is null then return false; end if;
  begin
    v_sesion := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when others then
    v_sesion := null;
  end;
  if v_sesion is null then return true; end if;
  return not exists (select 1 from factor_sesiones s
                     where s.session_id = v_sesion and s.usuario_id = v_usuario and s.expira_en > now());
end $$;
revoke all on function public.fn_factor_pendiente() from public, anon, authenticated;

-- v4 (2026-09-28): igual a la v3 (limites.sql, fase 6b) salvo la última regla:
-- un 99 por categoría se vuelve 0 mientras el segundo factor esté pendiente.
create or replace function public.fn_nivel_modulo(p_modulo text)
returns int language plpgsql stable security definer set search_path = public, interno, extensions as $$
declare v_correo text; v_nivel int; v_rol text;
begin
  begin
    v_correo := nullif(auth.jwt() ->> 'email', '');
  exception when others then
    v_correo := null;
  end;
  if v_correo is null then
    -- Sin correo en el JWT hay dos casos legítimos con privilegio: el rol de
    -- servicio (claims de PostgREST con role=service_role) y una sesión
    -- directa de postgres/supabase_admin (Management API, migraciones).
    -- Fase 6b: se mira el rol ACTIVO (SET ROLE, GUC role) antes que el de la
    -- sesión; dentro de un SECURITY DEFINER current_user es el dueño, por eso
    -- no sirve. Una sesión con rol activo authenticated/anon sin claims vale 0.
    v_rol := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
                      nullif(current_setting('role', true), 'none'),
                      session_user::text);
    if v_rol in ('authenticated', 'anon') then return 0; end if;
    if v_rol in ('postgres', 'service_role', 'supabase_admin') then return 99; end if;
    return 0;
  end if;
  select case when p.es_superadmin then 99
              else coalesce((select pp.nivel from perfil_permisos pp
                             where pp.perfil_id = u.perfil_id
                               and pp.perfil_version = u.perfil_version
                               and pp.modulo = p_modulo), 0) end
  into v_nivel
  from usuarios_admin u
  join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
  where lower(u.correo) = lower(v_correo) and u.estado = 'activo';
  -- Segundo factor (2026-09-28): superadmin sin verificar → 0 en toda la base.
  if coalesce(v_nivel, 0) = 99 and fn_factor_pendiente() then return 0; end if;
  return coalesce(v_nivel, 0);
end $$;

-- 4 · Política ---------------------------------------------------------------------
create or replace view public.v_politica_acceso as
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
       actualizado_por as "actualizadoPor",
       factor_superadmin as "factorSuperadmin"
from interno.politica_acceso where id = 1;
alter view public.v_politica_acceso set (security_invoker = on);
revoke all on public.v_politica_acceso from anon, public;
grant select on public.v_politica_acceso to authenticated, service_role;

drop function if exists public.guardar_politica(integer, integer, boolean, boolean, integer, integer, text, integer, integer, integer, text);
create or replace function public.guardar_politica(
  p_backoffice_horas int, p_portal_dias int,
  p_multisesion_backoffice boolean, p_multisesion_portal boolean,
  p_intentos int, p_bloqueo_min int, p_recuperacion text,
  p_clave_min_portal int, p_clave_min_backoffice int,
  p_provisional_dias int, p_por text,
  p_factor_superadmin boolean default null
) returns void language plpgsql security definer set search_path = public, interno, extensions as $$
begin
  perform requiere_superadmin();  -- fase 1: guarda central
  if coalesce(p_clave_min_backoffice, 0) < 10 then raise exception 'La clave del BackOffice exige al menos 10 caracteres (P11).'; end if;
  if coalesce(p_clave_min_portal, 0) < 6 then raise exception 'La clave del Portal exige al menos 6 caracteres.'; end if;
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
      factor_superadmin             = coalesce(p_factor_superadmin, factor_superadmin),
      actualizado_por               = p_por,
      actualizado_en                = now()
  where id = 1;
end $$;
revoke all on function public.guardar_politica(integer, integer, boolean, boolean, integer, integer, text, integer, integer, integer, text, boolean) from public, anon;
grant execute on function public.guardar_politica(integer, integer, boolean, boolean, integer, integer, text, integer, integer, integer, text, boolean) to authenticated;

-- 5 · Estado propio (lo único que el navegador consulta) ----------------------------
create or replace function public.mi_segundo_factor() returns jsonb
language plpgsql stable security definer set search_path = public, interno, extensions as $$
declare v_correo text := correo_llamador(); v_sesion uuid; v_usuario bigint; v_super boolean; v_exige boolean; v_expira timestamptz;
begin
  if v_correo is null then raise insufficient_privilege using message = 'Sesión requerida.'; end if;
  select u.id, p.es_superadmin into v_usuario, v_super
  from usuarios_admin u join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
  where lower(u.correo) = v_correo and u.estado = 'activo';
  if v_usuario is null then raise insufficient_privilege using message = 'No eres un usuario administrativo activo.'; end if;
  select factor_superadmin into v_exige from politica_acceso where id = 1;
  begin
    v_sesion := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when others then
    v_sesion := null;
  end;
  select s.expira_en into v_expira from factor_sesiones s
  where s.session_id = v_sesion and s.usuario_id = v_usuario and s.expira_en > now();
  return jsonb_build_object(
    'esSuperadmin', v_super,
    'exigido', v_super and coalesce(v_exige, true),
    'verificado', v_expira is not null,
    'expiraEn', v_expira,
    'correo', regexp_replace(v_correo, '^(.)[^@]*(@.*)$', '\1•••\2'));
end $$;
revoke all on function public.mi_segundo_factor() from public, anon;
grant execute on function public.mi_segundo_factor() to authenticated;

-- 6 · Funciones de servicio (api/segundo-factor.js, llave de servicio) ----------------
-- La identidad (p_correo) la validó el endpoint contra GoTrue; p_session_id es
-- el claim de ese token ya validado. El navegador jamás ejecuta estas funciones.
create or replace function public.api_factor_emitir(p_correo text, p_session_id uuid, p_codigo_hash text, p_ip text, p_agente text) returns jsonb
language plpgsql security definer set search_path = public, interno, extensions as $$
declare v_usuario bigint; v_super boolean; v_exige boolean; v_ultimo timestamptz; v_expira timestamptz;
begin
  select u.id, p.es_superadmin into v_usuario, v_super
  from usuarios_admin u join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
  where lower(u.correo) = lower(coalesce(p_correo, '')) and u.estado = 'activo';
  if v_usuario is null or not v_super then return jsonb_build_object('ok', false, 'motivo', 'no_superadmin'); end if;
  select factor_superadmin into v_exige from politica_acceso where id = 1;
  if not coalesce(v_exige, true) then return jsonb_build_object('ok', false, 'motivo', 'apagado'); end if;
  if p_session_id is null or coalesce(p_codigo_hash, '') = '' then return jsonb_build_object('ok', false, 'motivo', 'datos'); end if;
  -- Serializa por sesión: sin esto, dos emisiones concurrentes leen ambas
  -- "sin código reciente" antes de que cualquiera inserte y se saltan la
  -- espera de 60 s (buzón inundado).
  perform pg_advisory_xact_lock(hashtext(p_session_id::text));
  delete from factor_codigos where usuario_id = v_usuario and expira_en < now();  -- limpieza perezosa
  select max(creado_en) into v_ultimo from factor_codigos where session_id = p_session_id and usuario_id = v_usuario;
  if v_ultimo is not null and v_ultimo > now() - interval '60 seconds' then
    return jsonb_build_object('ok', false, 'motivo', 'espera',
      'espera_seg', greatest(1, ceil(extract(epoch from (v_ultimo + interval '60 seconds' - now())))::int));
  end if;
  update factor_codigos set usado_en = now() where session_id = p_session_id and usuario_id = v_usuario and usado_en is null;
  v_expira := now() + interval '10 minutes';
  insert into factor_codigos (usuario_id, session_id, codigo_hash, expira_en, ip, agente)
  values (v_usuario, p_session_id, p_codigo_hash, v_expira, p_ip, p_agente);
  return jsonb_build_object('ok', true, 'expira_en', v_expira);
end $$;

create or replace function public.api_factor_verificar(p_correo text, p_session_id uuid, p_codigo_hash text, p_ip text, p_agente text) returns jsonb
language plpgsql security definer set search_path = public, interno, extensions as $$
declare v_usuario bigint; v_super boolean; c record; v_horas int; v_expira timestamptz; v_intentos int;
begin
  select u.id, p.es_superadmin into v_usuario, v_super
  from usuarios_admin u join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
  where lower(u.correo) = lower(coalesce(p_correo, '')) and u.estado = 'activo';
  if v_usuario is null or not v_super then return jsonb_build_object('ok', false, 'motivo', 'no_superadmin'); end if;
  -- Serializa por sesión: sin esto, N verificaciones concurrentes leen todas
  -- "intentos < 5" antes de que cualquiera actualice y se saltan el tope.
  perform pg_advisory_xact_lock(hashtext(p_session_id::text));
  select * into c from factor_codigos
  where session_id = p_session_id and usuario_id = v_usuario and usado_en is null
  order by creado_en desc limit 1;
  if c.id is null or c.expira_en <= now() then return jsonb_build_object('ok', false, 'motivo', 'vencido'); end if;
  if c.intentos >= 5 then return jsonb_build_object('ok', false, 'motivo', 'agotado', 'intentos_restantes', 0); end if;
  if c.codigo_hash <> coalesce(p_codigo_hash, '') then
    -- Incremento atómico con guarda en el WHERE: aunque el candado ya
    -- serializa, esto deja el tope correcto aun si algo llama sin pasar por
    -- el candado (defensa en profundidad).
    update factor_codigos set intentos = intentos + 1 where id = c.id and intentos < 5 returning intentos into v_intentos;
    if v_intentos is null or v_intentos >= 5 then return jsonb_build_object('ok', false, 'motivo', 'agotado', 'intentos_restantes', 0); end if;
    return jsonb_build_object('ok', false, 'motivo', 'incorrecto', 'intentos_restantes', 5 - v_intentos);
  end if;
  update factor_codigos set usado_en = now() where id = c.id;
  select sesion_backoffice_horas into v_horas from politica_acceso where id = 1;
  v_expira := now() + make_interval(hours => coalesce(v_horas, 8));
  delete from factor_sesiones where usuario_id = v_usuario and expira_en < now();  -- limpieza perezosa
  insert into factor_sesiones (session_id, usuario_id, expira_en, via, ip, agente)
  values (p_session_id, v_usuario, v_expira, 'correo', p_ip, p_agente)
  on conflict (session_id) do update
    set usuario_id = excluded.usuario_id, verificado_en = now(), expira_en = excluded.expira_en, via = 'correo', ip = excluded.ip, agente = excluded.agente;
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('FACTOR_VERIFICADO', 'factor_sesiones', null, jsonb_build_object('usuario_id', v_usuario, 'via', 'correo', 'ip', p_ip, 'expira_en', v_expira));
  return jsonb_build_object('ok', true, 'expira_en', v_expira);
end $$;

create or replace function public.api_factor_dispositivo_crear(p_correo text, p_session_id uuid, p_token_hash text, p_ip text, p_agente text) returns void
language plpgsql security definer set search_path = public, interno, extensions as $$
declare v_usuario bigint;
begin
  select u.id into v_usuario from usuarios_admin u join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
  where lower(u.correo) = lower(coalesce(p_correo, '')) and u.estado = 'activo' and p.es_superadmin;
  if v_usuario is null then raise exception 'No es un superadministrador activo.'; end if;
  -- Serializa por sesión antes de leer/escribir factor_sesiones o dispositivos_confiables.
  perform pg_advisory_xact_lock(hashtext(p_session_id::text));
  if coalesce(p_token_hash, '') = '' then raise exception 'Falta el token.'; end if;
  -- Equipo recordado: 30 días SIN renovación. Si se aceptara una sesión
  -- verificada vía dispositivo (via = 'dispositivo') para acuñar un token
  -- nuevo, el equipo se renovaría solo cada vez que se usa y nunca vencería;
  -- por eso solo una sesión recién verificada por correo puede crear uno.
  if not exists (select 1 from factor_sesiones s where s.session_id = p_session_id and s.usuario_id = v_usuario and s.expira_en > now() and s.via = 'correo') then
    raise exception 'La sesión no ha verificado el código.';
  end if;
  insert into dispositivos_confiables (usuario_id, token_hash, expira_en, ip, agente)
  values (v_usuario, p_token_hash, now() + interval '30 days', p_ip, p_agente);
end $$;

create or replace function public.api_factor_dispositivo_usar(p_correo text, p_session_id uuid, p_token_hash text, p_ip text, p_agente text) returns boolean
language plpgsql security definer set search_path = public, interno, extensions as $$
declare v_usuario bigint; v_id bigint; v_horas int; v_expira timestamptz;
begin
  select u.id into v_usuario from usuarios_admin u join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
  where lower(u.correo) = lower(coalesce(p_correo, '')) and u.estado = 'activo' and p.es_superadmin;
  if v_usuario is null or p_session_id is null then return false; end if;
  perform pg_advisory_xact_lock(hashtext(p_session_id::text));
  select d.id into v_id from dispositivos_confiables d
  where d.token_hash = coalesce(p_token_hash, '') and d.usuario_id = v_usuario and d.revocado_en is null and d.expira_en > now();
  if v_id is null then return false; end if;
  update dispositivos_confiables set ultimo_uso = now() where id = v_id;
  select sesion_backoffice_horas into v_horas from politica_acceso where id = 1;
  v_expira := now() + make_interval(hours => coalesce(v_horas, 8));
  insert into factor_sesiones (session_id, usuario_id, expira_en, via, ip, agente)
  values (p_session_id, v_usuario, v_expira, 'dispositivo', p_ip, p_agente)
  on conflict (session_id) do update
    set usuario_id = excluded.usuario_id, verificado_en = now(), expira_en = excluded.expira_en, via = 'dispositivo', ip = excluded.ip, agente = excluded.agente;
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('FACTOR_DISPOSITIVO', 'factor_sesiones', null, jsonb_build_object('usuario_id', v_usuario, 'dispositivo_id', v_id, 'ip', p_ip, 'expira_en', v_expira));
  return true;
end $$;

create or replace function public.api_factor_dispositivos_revocar(p_correo text) returns int
language plpgsql security definer set search_path = public, interno, extensions as $$
declare v_usuario bigint; n int;
begin
  select u.id into v_usuario from usuarios_admin u where lower(u.correo) = lower(coalesce(p_correo, '')) and u.estado = 'activo';
  if v_usuario is null then return 0; end if;
  update dispositivos_confiables set revocado_en = now()
  where usuario_id = v_usuario and revocado_en is null and expira_en > now();
  get diagnostics n = row_count;
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('FACTOR_DISPOSITIVOS_REVOCADOS', 'dispositivos_confiables', null, jsonb_build_object('usuario_id', v_usuario, 'revocados', n));
  return n;
end $$;

revoke all on function
  public.api_factor_emitir(text, uuid, text, text, text),
  public.api_factor_verificar(text, uuid, text, text, text),
  public.api_factor_dispositivo_crear(text, uuid, text, text, text),
  public.api_factor_dispositivo_usar(text, uuid, text, text, text),
  public.api_factor_dispositivos_revocar(text)
from public, anon, authenticated;
grant execute on function
  public.api_factor_emitir(text, uuid, text, text, text),
  public.api_factor_verificar(text, uuid, text, text, text),
  public.api_factor_dispositivo_crear(text, uuid, text, text, text),
  public.api_factor_dispositivo_usar(text, uuid, text, text, text),
  public.api_factor_dispositivos_revocar(text)
to service_role;

-- Verificación embebida.
do $$
declare v jsonb; v_correo text;
begin
  if not exists (select 1 from pg_attribute where attrelid = 'interno.politica_acceso'::regclass and attname = 'factor_superadmin' and not attisdropped) then raise exception 'factor: falta politica_acceso.factor_superadmin'; end if;
  if (select factor_superadmin from interno.politica_acceso where id = 1) is not true then raise exception 'factor: el interruptor no quedó encendido'; end if;
  if (select prosrc from pg_proc where oid = 'public.fn_nivel_modulo(text)'::regprocedure) !~ 'fn_factor_pendiente' then raise exception 'factor: fn_nivel_modulo no consulta fn_factor_pendiente'; end if;
  if to_regprocedure('public.guardar_politica(integer, integer, boolean, boolean, integer, integer, text, integer, integer, integer, text)') is not null then raise exception 'factor: la firma vieja de guardar_politica sigue'; end if;
  if not has_function_privilege('authenticated', 'public.guardar_politica(integer, integer, boolean, boolean, integer, integer, text, integer, integer, integer, text, boolean)', 'execute') then raise exception 'factor: authenticated no ejecuta guardar_politica nueva'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'v_politica_acceso' and column_name = 'factorSuperadmin') then raise exception 'factor: v_politica_acceso sin factorSuperadmin'; end if;
  if not has_table_privilege('authenticated', 'public.v_politica_acceso', 'select') then raise exception 'factor: authenticated perdió v_politica_acceso'; end if;
  if not has_function_privilege('authenticated', 'public.mi_segundo_factor()', 'execute') then raise exception 'factor: authenticated no ejecuta mi_segundo_factor'; end if;
  if has_function_privilege('anon', 'public.mi_segundo_factor()', 'execute') then raise exception 'factor: anon ejecuta mi_segundo_factor'; end if;
  if has_function_privilege('authenticated', 'public.fn_factor_pendiente()', 'execute') then raise exception 'factor: authenticated ejecuta fn_factor_pendiente'; end if;
  if exists (select 1 from unnest(array['public.api_factor_emitir(text, uuid, text, text, text)', 'public.api_factor_verificar(text, uuid, text, text, text)', 'public.api_factor_dispositivo_crear(text, uuid, text, text, text)', 'public.api_factor_dispositivo_usar(text, uuid, text, text, text)', 'public.api_factor_dispositivos_revocar(text)']) f
             where has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') or not has_function_privilege('service_role', f, 'execute')) then raise exception 'factor: api_factor_* mal concedida'; end if;
  if exists (select 1 from unnest(array['factor_codigos', 'factor_sesiones', 'dispositivos_confiables']) t
             where to_regclass('interno.' || t) is null or has_table_privilege('authenticated', 'interno.' || t, 'select') or has_table_privilege('anon', 'interno.' || t, 'select')
                or not (select relrowsecurity from pg_class where oid = to_regclass('interno.' || t))) then raise exception 'factor: tabla ausente o abierta a la API'; end if;
  if fn_nivel_modulo('accesos') <> 99 then raise exception 'factor: la sesión de migración (postgres, sin JWT) debería valer 99 y vale %', fn_nivel_modulo('accesos'); end if;
  -- Comportamiento: un superadmin real con JWT y sin marca vale 0 (claims simulados y limpiados aquí mismo).
  select u.correo into v_correo from interno.usuarios_admin u join interno.perfiles p on p.id = u.perfil_id and p.version = u.perfil_version where u.estado = 'activo' and p.es_superadmin order by u.id limit 1;
  if v_correo is not null then
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_correo, 'session_id', '00000000-0000-4000-8000-0000000000fa')::text, true);
    if fn_nivel_modulo('accesos') <> 0 then raise exception 'factor: el superadmin % sin marca debería valer 0', v_correo; end if;
    v := mi_segundo_factor();
    if (v ->> 'exigido')::boolean is not true or (v ->> 'verificado')::boolean is not false then raise exception 'factor: mi_segundo_factor inesperado: %', v; end if;
    perform set_config('request.jwt.claims', '', true);
  end if;
end $$;
commit;
