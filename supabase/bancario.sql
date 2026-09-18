-- supabase/bancario.sql — Corrección de seguridad · FASE 3b (2026-09-18):
-- DATOS BANCARIOS en el esquema privado `interno`.
--
-- Canónico de la fase 3b. Lo embebe la migración
-- migraciones/2026-09-18-fase3b-datos-bancarios.sql y el bloque @@FASE3B@@ de
-- seguridad.sql (espejo local). Idempotente: se puede aplicar dos veces.
--
-- Qué hace (decisiones P2, P4 y P7 de Decisiones_Seguridad_QA):
--  · tabla interno.datos_bancarios (banco, cuenta cifrada + últimos 4, CCI
--    CIFRADO + últimos 4): PostgREST no la publica; RLS + lectura_admin como el
--    resto de interno (las vistas security_invoker la leen con permisos del
--    administrador; la fila la decide la política).
--  · personas pierde cuenta (texto plano: se ELIMINA, P7), cci (pasa cifrado,
--    P4), cuenta_cifrada, cuenta_ultimos4, banco y banco_id.
--  · v_personal y v_portal_datos muestran solo máscaras («···· 1234»).
--  · fn_ver_cuenta_bancaria sigue siendo el ÚNICO camino al valor completo
--    (casilla «Ver datos bancarios» o superadmin; cada consulta en auditoría)
--    y ahora devuelve también el CCI descifrado.
--  · auditoría de la tabla nueva SIN valores (dni, banco, últimos 4).
--  · alta_trabajador, editar_trabajador e importar_planilla_unificada escriben
--    por fn_guardar_datos_bancarios (interna). Semántica en edición e
--    importación: vacío = conservar, '-' = borrar, otro texto = reemplazar
--    (cifrado), igual que ya hacía la cuenta; ahora también para el CCI.

-- 1 · Tabla -------------------------------------------------------------------
create table if not exists interno.datos_bancarios (
  dni             text primary key references personas(dni) on delete cascade,
  banco           text,
  banco_id        text references bancos(codigo),
  cuenta_cifrada  bytea,
  cuenta_ultimos4 text,
  cci_cifrado     bytea,
  cci_ultimos4    text,
  actualizado_en  timestamptz not null default now(),
  actualizado_por text
);
alter table interno.datos_bancarios enable row level security;
revoke all on table interno.datos_bancarios from public, anon;
grant select on table interno.datos_bancarios to authenticated;
grant all on table interno.datos_bancarios to service_role;
drop policy if exists lectura_admin on interno.datos_bancarios;
create policy lectura_admin on interno.datos_bancarios for select to authenticated using (public.es_admin_activo());

-- 2 · Ayudantes internos (nadie de la API los ejecuta) --------------------------
create or replace function fn_ultimos4(p_texto text) returns text
language sql immutable as $$
  select case when nullif(trim(coalesce(p_texto, '')), '') is null then null
              else right(regexp_replace(trim(p_texto), '[^0-9A-Za-z]', '', 'g'), 4) end
$$;
revoke all on function fn_ultimos4(text) from public, anon, authenticated;

-- Única escritura de datos bancarios. p_cuenta / p_cci: null o vacío =
-- conservar; '-' = borrar; otro texto = reemplazar cifrado. Banco: con
-- p_pisar_banco lo escrito manda (incluido null); sin él, null conserva.
create or replace function fn_guardar_datos_bancarios(
  p_dni text, p_banco text, p_banco_id text, p_cuenta text, p_cci text,
  p_pisar_banco boolean, p_por text default null
) returns void
language plpgsql security definer set search_path = public, interno, extensions as $$
declare v_cuenta text := nullif(trim(coalesce(p_cuenta, '')), '');
        v_cci    text := nullif(trim(coalesce(p_cci, '')), '');
begin
  if not exists (select 1 from datos_bancarios where dni = p_dni) then
    if v_cuenta = '-' then v_cuenta := null; end if;
    if v_cci = '-' then v_cci := null; end if;
    if v_cuenta is null and v_cci is null and p_banco is null and p_banco_id is null then return; end if;
    insert into datos_bancarios (dni, banco, banco_id, cuenta_cifrada, cuenta_ultimos4, cci_cifrado, cci_ultimos4, actualizado_por)
    values (p_dni, p_banco, p_banco_id, fn_cifrar_cuenta(v_cuenta), fn_ultimos4(v_cuenta), fn_cifrar_cuenta(v_cci), fn_ultimos4(v_cci), p_por);
    return;
  end if;
  update datos_bancarios set
    banco           = case when p_pisar_banco then p_banco    else coalesce(p_banco, banco) end,
    banco_id        = case when p_pisar_banco then p_banco_id else coalesce(p_banco_id, banco_id) end,
    cuenta_cifrada  = case when v_cuenta is null then cuenta_cifrada  when v_cuenta = '-' then null else fn_cifrar_cuenta(v_cuenta) end,
    cuenta_ultimos4 = case when v_cuenta is null then cuenta_ultimos4 when v_cuenta = '-' then null else fn_ultimos4(v_cuenta) end,
    cci_cifrado     = case when v_cci is null then cci_cifrado  when v_cci = '-' then null else fn_cifrar_cuenta(v_cci) end,
    cci_ultimos4    = case when v_cci is null then cci_ultimos4 when v_cci = '-' then null else fn_ultimos4(v_cci) end,
    actualizado_en  = now(),
    actualizado_por = coalesce(p_por, actualizado_por)
  where dni = p_dni;
end $$;
revoke all on function fn_guardar_datos_bancarios(text, text, text, text, text, boolean, text) from public, anon, authenticated;

-- 3 · Auditoría sin secretos ---------------------------------------------------
create or replace function fn_auditar_datos_bancarios() returns trigger
language plpgsql security definer set search_path = public, interno, extensions as $$
declare v_por text;
begin
  begin v_por := nullif(auth.jwt() ->> 'email', ''); exception when others then v_por := null; end;
  insert into auditoria (usuario, accion, tabla, datos_antes, datos_despues)
  values (coalesce(v_por, current_user::text), 'CAMBIO_DATOS_BANCARIOS', 'datos_bancarios',
    case when tg_op in ('UPDATE', 'DELETE') then jsonb_build_object('dni', old.dni, 'banco', old.banco, 'ultimos4', old.cuenta_ultimos4, 'cciUltimos4', old.cci_ultimos4) end,
    case when tg_op in ('INSERT', 'UPDATE') then jsonb_build_object('dni', new.dni, 'banco', new.banco, 'ultimos4', new.cuenta_ultimos4, 'cciUltimos4', new.cci_ultimos4) end);
  return coalesce(new, old);
end $$;
drop trigger if exists trg_auditar_datos_bancarios on interno.datos_bancarios;
create trigger trg_auditar_datos_bancarios
  after insert or update or delete on interno.datos_bancarios
  for each row execute function fn_auditar_datos_bancarios();

-- 4 · Vistas: solo máscaras (mismas columnas y orden que antes) ----------------
create or replace view v_personal as
select p.dni, p.tipo_documento, p.nombre, v.cargo, v.sede_id as sede, v.empresa_id as empresa,
       to_char(v.fecha_inicio, 'YYYY-MM-DD') as ingreso,
       p.celular, p.portal,
       case when v.fecha_fin is null then 'vigente' else 'cesado' end as estado,
       db.banco,
       case when db.cuenta_ultimos4 is not null then '···· ' || db.cuenta_ultimos4 end as cuenta,
       to_char(v.fecha_fin, 'YYYY-MM-DD') as cese,
       v.id as vinculo_id,
       p.correo, p.correo_verificado as "correoVerificado",
       case when db.cci_ultimos4 is not null then '···· ' || db.cci_ultimos4 end as cci,
       exists (select 1 from cuentas_portal cp where cp.dni = p.dni) as "tieneCuenta",
       p.sexo,
       v.centro_costo as "centroCosto",
       to_char(fn_hora_entrada(p.dni), 'HH24:MI') as "horaEntrada"
from vinculos v
join personas p on p.dni = v.persona_dni
left join interno.datos_bancarios db on db.dni = p.dni;
alter view v_personal set (security_invoker = on);

create or replace view v_portal_datos as
select pe.dni, pe.nombre, pe.celular, pe.direccion, db.banco,
       case when db.cuenta_ultimos4 is null then null
            else '···· ' || db.cuenta_ultimos4 end as "cuentaEnmascarada",
       coalesce(vig.cargo, '—') as cargo,
       em.corto as empresa, s.nombre as sede,
       exists (select 1 from solicitudes_cambio_cuenta sc
               where sc.dni = pe.dni and sc.estado = 'pendiente') as "solicitudPendiente"
from personas pe
left join interno.datos_bancarios db on db.dni = pe.dni
left join lateral (select * from vinculos v where v.persona_dni = pe.dni and v.fecha_fin is null
                   order by v.fecha_inicio desc limit 1) vig on true
left join sedes s on s.id = vig.sede_id
left join empresas em on em.id = vig.empresa_id
where pe.dni = portal_dni();

-- 5 · Copia de lo existente y retiro de las columnas de personas (una sola vez)
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'personas' and column_name = 'cuenta_cifrada') then
    alter table interno.datos_bancarios disable trigger trg_auditar_datos_bancarios;
    insert into interno.datos_bancarios (dni, banco, banco_id, cuenta_cifrada, cuenta_ultimos4, cci_cifrado, cci_ultimos4, actualizado_por)
    select dni, banco, banco_id,
           coalesce(cuenta_cifrada, fn_cifrar_cuenta(cuenta)),
           coalesce(cuenta_ultimos4, fn_ultimos4(cuenta)),
           fn_cifrar_cuenta(cci), fn_ultimos4(cci), 'fase 3b'
    from personas
    where cuenta_cifrada is not null or cuenta is not null or cci is not null or banco is not null or banco_id is not null
    on conflict (dni) do nothing;
    alter table interno.datos_bancarios enable trigger trg_auditar_datos_bancarios;
    alter table personas
      drop column cuenta, drop column cci, drop column cuenta_cifrada,
      drop column cuenta_ultimos4, drop column banco, drop column banco_id;
  end if;
end $$;

-- 6 · Funciones que leen o escriben datos bancarios ------------------------------
-- Único camino de lectura de cuenta y CCI completos. Registra en auditoría
-- SIEMPRE (tenga permiso o no); devuelve null sin permiso. Ley 29733.
create or replace function fn_ver_cuenta_bancaria(p_dni text) returns jsonb
language plpgsql security definer set search_path = public, interno, extensions as $$
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
  values ('VER_CUENTA_BANCARIA', 'datos_bancarios', null,
          jsonb_build_object('dni', p_dni, 'por', v_correo, 'autorizado', v_ok));
  if not v_ok then return null; end if;
  select fn_descifrar_cuenta(db.cuenta_cifrada), db.banco, fn_descifrar_cuenta(db.cci_cifrado)
    into v_cuenta, v_banco, v_cci from datos_bancarios db where db.dni = p_dni;
  return jsonb_build_object('cuenta', v_cuenta, 'banco', v_banco, 'cci', v_cci);
end $$;

-- Alta (misma firma): personas sin columnas bancarias; lo bancario por el ayudante.
create or replace function alta_trabajador(
  p_dni text, p_nombre text, p_cargo text, p_sede text, p_empresa text,
  p_ingreso date, p_celular text default null,
  p_banco text default null, p_cuenta text default null, p_correo text default null,
  p_cci text default null, p_tipo_documento text default 'DNI'
) returns void language plpgsql security definer set search_path = public, interno, extensions as $$
declare v_num text; v_banco_id text; v_banco text;
begin
  perform requiere_nivel('personal', 2);  -- fase 1: guarda central
  v_num := fn_validar_documento(p_tipo_documento, p_dni);
  v_banco_id := fn_resolver_banco(p_banco);
  v_banco := coalesce((select nombre from bancos where codigo = v_banco_id),
                      nullif(trim(coalesce(p_banco, '')), ''));
  insert into personas (dni, tipo_documento, nombre, celular, portal, correo)
  values (v_num, p_tipo_documento, p_nombre, p_celular,
          case when p_celular is null then 'sin_celular' else 'nunca_ingreso' end,
          nullif(lower(trim(coalesce(p_correo, ''))), ''))
  on conflict (dni) do update
    set tipo_documento = excluded.tipo_documento,
        celular = coalesce(excluded.celular, personas.celular),
        correo  = coalesce(excluded.correo, personas.correo);
  -- Igual que antes: lo que viene vacío conserva lo registrado.
  perform fn_guardar_datos_bancarios(v_num, v_banco, v_banco_id, p_cuenta, p_cci, false, 'alta_trabajador');

  if exists (select 1 from vinculos where persona_dni = v_num
             and empresa_id = p_empresa and fecha_fin is null) then
    raise exception 'La persona % ya tiene un vínculo vigente con esta empresa.', v_num;
  end if;

  insert into vinculos (persona_dni, empresa_id, sede_id, cargo, fecha_inicio)
  values (v_num, p_empresa, p_sede, p_cargo, p_ingreso);
end $$;

-- Edición (misma firma). Cuenta y CCI: vacío conserva, '-' borra, otro texto
-- reemplaza cifrado. Banco: lo escrito manda. La auditoría de personas no
-- lleva datos bancarios (ya no están en la fila).
create or replace function editar_trabajador(
  p_dni text, p_nombre text, p_celular text, p_correo text, p_banco text, p_cuenta text,
  p_cci text default null, p_tipo_documento text default null
) returns void language plpgsql security definer set search_path = public, interno, extensions as $$
declare j_antes jsonb; j_despues jsonb; v_correo text; v_banco text; v_banco_id text;
begin
  if fn_nivel_modulo('personal') < 2 then
    raise exception 'Tu categoría no permite editar datos de Personal.';
  end if;
  if not exists (select 1 from personas where dni = p_dni) then
    raise exception 'La persona % no existe.', p_dni;
  end if;
  if nullif(trim(coalesce(p_nombre, '')), '') is null then
    raise exception 'El nombre no puede quedar vacío.';
  end if;
  if p_tipo_documento is not null then
    perform fn_validar_documento(p_tipo_documento, p_dni);
  end if;
  v_correo := nullif(lower(trim(coalesce(p_correo, ''))), '');
  if v_correo is not null and v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo no tiene un formato válido.';
  end if;
  v_banco := nullif(trim(coalesce(p_banco, '')), '');
  v_banco_id := fn_resolver_banco(v_banco);
  v_banco := coalesce((select nombre from bancos where codigo = v_banco_id), v_banco);

  select to_jsonb(p) into j_antes from personas p where dni = p_dni;
  update personas set
    nombre = trim(p_nombre),
    nombre_por_confirmar = false,
    tipo_documento = coalesce(p_tipo_documento, tipo_documento),
    celular = nullif(trim(coalesce(p_celular, '')), ''),
    correo_verificado = case when v_correo is distinct from correo then false else correo_verificado end,
    correo = v_correo
  where dni = p_dni;
  select to_jsonb(p) into j_despues from personas p where dni = p_dni;
  perform fn_guardar_datos_bancarios(p_dni, v_banco, v_banco_id, p_cuenta, p_cci, true, 'editar_trabajador');

  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('EDITAR_TRABAJADOR', 'personas', j_antes, j_despues);
end $$;

-- importar_planilla_unificada: se re-crea a partir de su cuerpo VIGENTE con
-- cuatro sustituciones exactas (cada patrón debe aparecer una sola vez; si
-- no, falla y nada cambia). Así no se pisa ningún ajuste posterior del cuerpo.
do $$
declare d text; n int; pat text; rep text; i int;
  pats text[] := array[
    $p$insert into personas \(dni, tipo_documento, nombre, portal, banco, banco_id,\s*cuenta_cifrada, cuenta_ultimos4\)\s*values \(v_doc, coalesce\(f->>'tipoDoc', 'DNI'\), v_nombre, 'sin_celular',\s*v_banco_nombre, f->>'bancoCodigo', fn_cifrar_cuenta\(v_cuenta\), v_u4\);$p$,
    $p$select fn_descifrar_cuenta\(cuenta_cifrada\) into v_cuenta_actual from personas where dni = v_canon;$p$,
    $p$\(select jsonb_build_object\('banco', banco, 'ultimos4', cuenta_ultimos4\)\s*from personas where dni = v_canon\)$p$,
    $p$,\s*banco = v_banco_nombre,\s*banco_id = f->>'bancoCodigo',\s*cuenta_cifrada = case when v_cuenta_cambio then fn_cifrar_cuenta\(v_cuenta\) else cuenta_cifrada end,\s*cuenta_ultimos4 = v_u4\s*where dni = v_canon;$p$];
  reps text[] := array[
    $r$insert into personas (dni, tipo_documento, nombre, portal)
      values (v_doc, coalesce(f->>'tipoDoc', 'DNI'), v_nombre, 'sin_celular');
      perform fn_guardar_datos_bancarios(v_doc, v_banco_nombre, f->>'bancoCodigo', v_cuenta, null, true, p_por);$r$,
    $r$select fn_descifrar_cuenta(cuenta_cifrada) into v_cuenta_actual from datos_bancarios where dni = v_canon;$r$,
    $r$(select jsonb_build_object('banco', banco, 'ultimos4', cuenta_ultimos4) from datos_bancarios where dni = v_canon)$r$,
    $r$
      where dni = v_canon;
      perform fn_guardar_datos_bancarios(v_canon, v_banco_nombre, f->>'bancoCodigo',
        case when v_cuenta_cambio then coalesce(v_cuenta, '-') else null end, null, true, p_por);$r$];
begin
  d := pg_get_functiondef('public.importar_planilla_unificada(jsonb, text, text, jsonb)'::regprocedure);
  if d ~ 'from datos_bancarios where dni = v_canon' then return; end if;  -- ya transformada (idempotente)
  for i in 1..4 loop
    select count(*) into n from regexp_matches(d, pats[i], 'g');
    if n <> 1 then raise exception 'fase3b: el patrón % de importar_planilla_unificada aparece % veces (esperada 1)', i, n; end if;
    d := regexp_replace(d, pats[i], reps[i]);
  end loop;
  execute d;
end $$;
