-- 2026-08-22 · #10 Fase 2: cuenta bancaria cifrada en reposo (pgcrypto +
-- Supabase Vault, decisión de Diego 2026-08-21) + permiso transversal
-- «Ver datos bancarios» (casilla de perfiles) + consulta auditada.
-- El texto plano personas.cuenta se cifra y se RETIRA (queda null; la columna
-- se conserva deprecada hasta decidir su drop). Reversible: la llave vive en
-- Vault (secreto clave_cuentas, generado DENTRO de la BD — jamás en logs).
-- Idempotente.

create extension if not exists pgcrypto;

-- Llave simétrica en Vault (solo si no existe).
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'clave_cuentas') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'clave_cuentas');
  end if;
end $$;

-- Acceso a la llave y cifrado/descifrado: funciones INTERNAS (revocadas a los
-- clientes; las llaman otras security definer). search_path fijo (hardening).
create or replace function fn_clave_cuentas() returns text
language sql stable security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'clave_cuentas'
$$;
revoke execute on function fn_clave_cuentas() from public, anon, authenticated;

create or replace function fn_cifrar_cuenta(p_texto text) returns bytea
language sql security definer set search_path = public, extensions as $$
  select case when nullif(trim(coalesce(p_texto, '')), '') is null then null
              else extensions.pgp_sym_encrypt(trim(p_texto), fn_clave_cuentas()) end
$$;
revoke execute on function fn_cifrar_cuenta(text) from public, anon, authenticated;

create or replace function fn_descifrar_cuenta(p_cifrado bytea) returns text
language sql stable security definer set search_path = public, extensions as $$
  select case when p_cifrado is null then null
              else extensions.pgp_sym_decrypt(p_cifrado, fn_clave_cuentas()) end
$$;
revoke execute on function fn_descifrar_cuenta(bytea) from public, anon, authenticated;

-- Columnas nuevas + backfill (cifra lo existente y retira el texto plano).
alter table personas add column if not exists cuenta_cifrada bytea;
alter table personas add column if not exists cuenta_ultimos4 text;
update personas set
  cuenta_cifrada  = fn_cifrar_cuenta(cuenta),
  cuenta_ultimos4 = right(regexp_replace(cuenta, '[^0-9A-Za-z]', '', 'g'), 4),
  cuenta = null
where nullif(trim(coalesce(cuenta, '')), '') is not null;

-- v_personal: la cuenta sale SIEMPRE enmascarada (mismo nombre de columna
-- para no tocar consumidores). Conserva "tieneCuenta" (migración anterior).
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
       exists (select 1 from cuentas_portal cp where cp.dni = p.dni) as "tieneCuenta"
from vinculos v join personas p on p.dni = v.persona_dni;
grant select on v_personal to authenticated;

-- Casilla transversal en perfiles (columna de perfiles, NO módulo de
-- perfil_permisos: no toca los checks corregidos el 2026-08-21).
alter table perfiles add column if not exists ver_datos_bancarios boolean not null default false;

drop function if exists guardar_perfil(text,text,text,boolean,boolean,boolean,boolean,jsonb,text[],text);
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

-- Vistas: la casilla viaja al frontend (columna NUEVA al final: create or
-- replace la admite sin drop).
create or replace view v_perfiles as
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

create or replace view v_mi_acceso as
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

-- Único camino de lectura de la cuenta completa. Registra en auditoría
-- SIEMPRE (tenga permiso o no); devuelve null sin permiso (no excepción: la
-- excepción desharía el registro). Ley 29733.
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

-- alta_trabajador cifra la cuenta y canoniza el banco (misma firma).
create or replace function alta_trabajador(
  p_dni text, p_nombre text, p_cargo text, p_sede text, p_empresa text,
  p_ingreso date, p_celular text default null,
  p_banco text default null, p_cuenta text default null, p_correo text default null,
  p_cci text default null, p_tipo_documento text default 'DNI'
) returns void language plpgsql security definer as $$
declare v_num text; v_banco_id text; v_banco text; v_cifrada bytea; v_u4 text;
begin
  v_num := fn_validar_documento(p_tipo_documento, p_dni);
  v_banco_id := fn_resolver_banco(p_banco);
  v_banco := coalesce((select nombre from bancos where codigo = v_banco_id),
                      nullif(trim(coalesce(p_banco, '')), ''));
  v_cifrada := fn_cifrar_cuenta(p_cuenta);
  v_u4 := case when v_cifrada is null then null
               else right(regexp_replace(trim(p_cuenta), '[^0-9A-Za-z]', '', 'g'), 4) end;
  insert into personas (dni, tipo_documento, nombre, celular, banco, banco_id,
                        cuenta_cifrada, cuenta_ultimos4, cci, portal, correo)
  values (v_num, p_tipo_documento, p_nombre, p_celular, v_banco, v_banco_id,
          v_cifrada, v_u4, nullif(trim(coalesce(p_cci, '')), ''),
          case when p_celular is null then 'sin_celular' else 'nunca_ingreso' end,
          nullif(lower(trim(coalesce(p_correo, ''))), ''))
  on conflict (dni) do update
    set tipo_documento = excluded.tipo_documento,
        celular = coalesce(excluded.celular, personas.celular),
        banco   = coalesce(excluded.banco, personas.banco),
        banco_id = coalesce(excluded.banco_id, personas.banco_id),
        cuenta_cifrada  = coalesce(excluded.cuenta_cifrada, personas.cuenta_cifrada),
        cuenta_ultimos4 = coalesce(excluded.cuenta_ultimos4, personas.cuenta_ultimos4),
        cci     = coalesce(excluded.cci, personas.cci),
        correo  = coalesce(excluded.correo, personas.correo);

  if exists (select 1 from vinculos where persona_dni = v_num
             and empresa_id = p_empresa and fecha_fin is null) then
    raise exception 'La persona % ya tiene un vínculo vigente con esta empresa.', v_num;
  end if;

  insert into vinculos (persona_dni, empresa_id, sede_id, cargo, fecha_inicio)
  values (v_num, p_empresa, p_sede, p_cargo, p_ingreso);
end $$;

-- editar_trabajador cifra. OJO cambio de semántica SOLO en cuenta (por el
-- enmascarado, la UI ya no puede reenviar el valor actual): vacío/null =
-- CONSERVAR la cuenta guardada; el literal '-' = borrar; otro texto =
-- reemplazar (cifrado). El resto de campos sigue «lo escrito manda».
create or replace function editar_trabajador(
  p_dni text, p_nombre text, p_celular text, p_correo text, p_banco text, p_cuenta text,
  p_cci text default null, p_tipo_documento text default null
) returns void language plpgsql security definer as $$
declare j_antes jsonb; j_despues jsonb; v_correo text; v_cuenta text; v_banco text; v_banco_id text;
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
  v_cuenta := nullif(trim(coalesce(p_cuenta, '')), '');
  v_banco := nullif(trim(coalesce(p_banco, '')), '');
  v_banco_id := fn_resolver_banco(v_banco);
  v_banco := coalesce((select nombre from bancos where codigo = v_banco_id), v_banco);

  select to_jsonb(p) - 'cuenta' - 'cci' - 'cuenta_cifrada' into j_antes from personas p where dni = p_dni;
  update personas set
    nombre = trim(p_nombre),
    nombre_por_confirmar = false,
    tipo_documento = coalesce(p_tipo_documento, tipo_documento),
    celular = nullif(trim(coalesce(p_celular, '')), ''),
    banco = v_banco,
    banco_id = v_banco_id,
    cuenta_cifrada = case when v_cuenta is null then cuenta_cifrada
                          when v_cuenta = '-' then null
                          else fn_cifrar_cuenta(v_cuenta) end,
    cuenta_ultimos4 = case when v_cuenta is null then cuenta_ultimos4
                           when v_cuenta = '-' then null
                           else right(regexp_replace(v_cuenta, '[^0-9A-Za-z]', '', 'g'), 4) end,
    cci = nullif(trim(coalesce(p_cci, '')), ''),
    correo_verificado = case when v_correo is distinct from correo then false else correo_verificado end,
    correo = v_correo
  where dni = p_dni;

  select to_jsonb(p) - 'cuenta' - 'cci' - 'cuenta_cifrada' into j_despues from personas p where dni = p_dni;

  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('EDITAR_TRABAJADOR', 'personas', j_antes, j_despues);
end $$;
