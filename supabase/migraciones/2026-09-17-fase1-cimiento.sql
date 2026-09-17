-- supabase/migraciones/2026-09-17-fase1-cimiento.sql
-- Corrección de seguridad · FASE 1 — CIMIENTO. GENERADA por
-- scripts/fase1-generar.mjs a partir de supabase/fase1-plantilla.sql y de los
-- canónicos (schema.sql / accesos.sql) con la guarda ya insertada. No editar a
-- mano: cambiar la plantilla o la tabla GUARDAS y regenerar.
--
-- UNA transacción. Reversión: supabase/respaldos/2026-09-17-fase1-reversion.sql
-- (ensayo: scripts/ensayar-fase1.mjs). Requiere la fase 0 y 0b aplicadas.
--
-- Qué hace:
--  1. Guarda central (SECURITY DEFINER, STABLE, search_path fijo): correo_llamador(),
--     es_admin(), es_superadmin(), nivel_en(modulo), requiere_nivel(modulo, nivel
--     [, modulo_alternativo]), requiere_superadmin(), requiere_correo_propio(correo).
--     Los requiere_* lanzan insufficient_privilege (42501). Identidad por PETICIÓN
--     (opción B): correo del JWT → usuarios_admin activo → categoría vigente.
--  2. Re-crea las 26 funciones administrativas que no verificaban al llamador con
--     la guarda como PRIMERA instrucción del cuerpo. Las que crean accesos o
--     designan roles exigen requiere_superadmin(); marcar_clave_cambiada solo
--     sobre la propia cuenta; el resto requiere_nivel(modulo, nivel).
--  3. Re-fija search_path en toda security definer (create or replace lo borra).
--  4. Elimina la sobrecarga huérfana asignar_activo(text,text,text).
--  5. GRANT EXECUTE explícito y listado a authenticated (25 administrativas +
--     es_admin/es_superadmin/nivel_en). eliminar_usuario_admin NO se concede:
--     solo la llama api/admin-usuarios.js con la llave de servicio.
--  6. ALTER DEFAULT PRIVILEGES: una función nueva nace sin EXECUTE para authenticated.
--  7. Verificación embebida: listas exactas, 0 definers sin search_path, ninguna
--     función ejecutable por authenticated sin guarda (salvo la lista explícita).
-- Restituye lo que la fase 0 dejó inoperativo: crear/editar usuarios y
-- categorías (solo superadmin), alta/baja de trabajador, publicar boletas y
-- comunicados, EPP, activos TI, sedes y memorándums.

begin;
set local search_path = public, extensions;

-- 0 · Precondición: fase 0 + 0b aplicadas.
do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute');
  if n <> 62 then raise exception 'fase1: se esperaba la base en estado de fase 0 (62 firmas ejecutables por authenticated, hay %)', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and policyname = 'solo_admin';
  if n <> 5 then raise exception 'fase1: se esperaban 5 políticas solo_admin (fase 0b), hay %', n; end if;
end $$;

-- 1 · Guarda central ---------------------------------------------------------
create or replace function correo_llamador() returns text
language sql stable security definer set search_path = public, extensions as $$
  select nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '')
$$;
comment on function correo_llamador() is 'Correo del JWT de la petición en minúsculas; null sin sesión.';

create or replace function nivel_en(p_modulo text) returns int
language sql stable security definer set search_path = public, extensions as $$
  select fn_nivel_modulo(p_modulo)
$$;
comment on function nivel_en(text) is 'Nivel del llamador en el módulo (0..3; 99 = superadmin o rol de servicio sin JWT). Misma regla que fn_nivel_modulo.';

create or replace function es_superadmin() returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select nivel_en('accesos') >= 99
$$;

create or replace function es_admin() returns boolean
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if correo_llamador() is null then return es_superadmin(); end if;  -- postgres / service_role sin JWT
  return exists (select 1 from usuarios_admin u where lower(u.correo) = correo_llamador() and u.estado = 'activo');
end $$;

create or replace function requiere_nivel(p_modulo text, p_nivel int, p_modulo_alt text default null) returns void
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if nivel_en(p_modulo) >= p_nivel then return; end if;
  if p_modulo_alt is not null and nivel_en(p_modulo_alt) >= p_nivel then return; end if;
  raise insufficient_privilege using message = format('Permiso insuficiente: requiere nivel %s en %s%s.',
    p_nivel, p_modulo, case when p_modulo_alt is null then '' else ' o en ' || p_modulo_alt end);
end $$;

create or replace function requiere_superadmin() returns void
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not es_superadmin() then
    raise insufficient_privilege using message = 'Permiso insuficiente: solo un superadministrador puede hacerlo.';
  end if;
end $$;

create or replace function requiere_correo_propio(p_correo text) returns void
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not es_admin() or lower(coalesce(p_correo, '')) is distinct from correo_llamador() then
    raise insufficient_privilege using message = 'Permiso insuficiente: solo sobre la propia cuenta.';
  end if;
end $$;

revoke all on function correo_llamador(), nivel_en(text), es_superadmin(), es_admin(),
  requiere_nivel(text, int, text), requiere_superadmin(), requiere_correo_propio(text) from public, anon, authenticated;

-- 2 · Funciones administrativas con la guarda insertada ----------------------
-- crear_usuario_admin · supabase/accesos.sql
create or replace function crear_usuario_admin(
  p_dni text, p_perfil text, p_correo text, p_celular text, p_clave text, p_por text
) returns bigint language plpgsql security definer as $$
declare v_id bigint; v_version int;
begin
  perform requiere_superadmin();  -- fase 1: guarda central
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


-- actualizar_usuario_admin · supabase/accesos.sql
create or replace function actualizar_usuario_admin(
  p_id bigint, p_perfil text, p_correo text, p_celular text, p_estado text
) returns void language plpgsql security definer as $$
declare v_version int;
begin
  perform requiere_superadmin();  -- fase 1: guarda central
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


-- suspender_usuario_admin · supabase/accesos.sql
create or replace function suspender_usuario_admin(p_id bigint) returns void
language plpgsql security definer as $$
begin
  perform requiere_superadmin();  -- fase 1: guarda central
  update usuarios_admin set estado = 'suspendido' where id = p_id;
end $$;


-- reactivar_usuario_admin · supabase/accesos.sql
create or replace function reactivar_usuario_admin(p_id bigint) returns void
language plpgsql security definer as $$
begin
  perform requiere_superadmin();  -- fase 1: guarda central
  update usuarios_admin set estado = 'activo' where id = p_id;
end $$;


-- eliminar_usuario_admin · supabase/accesos.sql
create or replace function eliminar_usuario_admin(p_id bigint) returns void
language plpgsql security definer as $$
begin
  perform requiere_superadmin();  -- fase 1: guarda central
  if not exists (select 1 from usuarios_admin where id = p_id) then
    raise exception 'El usuario no existe.';
  end if;
  delete from usuarios_admin where id = p_id;
end $$;


-- reenviar_clave · supabase/accesos.sql
create or replace function reenviar_clave(p_id bigint, p_clave text) returns void
language plpgsql security definer as $$
begin
  perform requiere_superadmin();  -- fase 1: guarda central
  update usuarios_admin
  set clave_provisional = p_clave,
      clave_entregada = case when correo is null then 'pantalla' else 'correo' end
  where id = p_id;
end $$;


-- guardar_perfil · supabase/accesos.sql
create or replace function guardar_perfil(
  p_id text, p_nombre text, p_descripcion text, p_superadmin boolean,
  p_ver_remuneracion boolean, p_ver_documentos boolean, p_exportar boolean,
  p_matriz jsonb, p_empresas text[] default null, p_por text default 'BackOffice',
  p_ver_bancarios boolean default false
) returns integer language plpgsql security definer as $$
declare v_version int; v_mod text; v_nivel text; v_empresas text[]; e text;
begin
  perform requiere_superadmin();  -- fase 1: guarda central
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


-- eliminar_perfil · supabase/accesos.sql
create or replace function eliminar_perfil(p_id text) returns void
language plpgsql security definer as $$
declare v_nombre text;
begin
  perform requiere_superadmin();  -- fase 1: guarda central
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


-- desactivar_perfil · supabase/accesos.sql
create or replace function desactivar_perfil(p_id text) returns void
language plpgsql security definer as $$
begin
  perform requiere_superadmin();  -- fase 1: guarda central
  update perfiles set estado = 'desactivado' where id = p_id;
end $$;


-- guardar_politica · supabase/accesos.sql
create or replace function guardar_politica(
  p_backoffice_horas int, p_portal_dias int,
  p_multisesion_backoffice boolean, p_multisesion_portal boolean,
  p_intentos int, p_bloqueo_min int, p_recuperacion text,
  p_clave_min_portal int, p_clave_min_backoffice int,
  p_provisional_dias int, p_por text
) returns void language plpgsql security definer as $$
begin
  perform requiere_superadmin();  -- fase 1: guarda central
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


-- marcar_clave_cambiada · supabase/accesos.sql
create or replace function marcar_clave_cambiada(p_correo text) returns void
language plpgsql security definer as $$
begin
  perform requiere_correo_propio(p_correo);  -- fase 1: guarda central
  update usuarios_admin
  set requiere_cambio_clave = false, clave_provisional = null
  where correo = p_correo;
end $$;


-- alta_trabajador · supabase/schema.sql
create or replace function alta_trabajador(
  p_dni text, p_nombre text, p_cargo text, p_sede text, p_empresa text,
  p_ingreso date, p_celular text default null,
  p_banco text default null, p_cuenta text default null, p_correo text default null,
  p_cci text default null, p_tipo_documento text default 'DNI'
) returns void language plpgsql security definer as $$
declare v_num text; v_banco_id text; v_banco text; v_cifrada bytea; v_u4 text;
begin
  perform requiere_nivel('personal', 2);  -- fase 1: guarda central
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


-- eliminar_trabajador · supabase/schema.sql
create or replace function eliminar_trabajador(p_dni text) returns text
language plpgsql security definer as $$
declare tiene_historial boolean;
begin
  perform requiere_nivel('personal', 3);  -- fase 1: guarda central
  select exists (
    select 1 from documentos d join vinculos v on v.id = d.vinculo_id
    where v.persona_dni = p_dni
  ) into tiene_historial;

  if tiene_historial then
    update vinculos set fecha_fin = current_date
    where persona_dni = p_dni and fecha_fin is null;
    return 'cesado';  -- el historial nunca se borra
  else
    delete from asignaciones where persona_dni = p_dni;
    delete from epp_entregas where dni = p_dni;
    delete from tardanzas where dni = p_dni;
    delete from vinculos where persona_dni = p_dni;
    delete from personas where dni = p_dni;
    return 'eliminado';
  end if;
end $$;


-- publicar_lote · supabase/schema.sql
create or replace function publicar_lote(
  p_empresa text, p_tipo text, p_periodo text, p_por text
) returns text language plpgsql security definer as $$
declare
  v_version int;
  v_id text;
  v_avisos int;
begin
  perform requiere_nivel('boletas', 2);  -- fase 1: guarda central
  select coalesce(max(version), 0) + 1 into v_version
  from lotes where empresa_id = p_empresa and tipo = p_tipo and periodo = p_periodo;

  -- El corto se sanea a alfanumérico ANTES de cortar a 3: «L. AMERICANA»
  -- debe dar LAM, no «L. » (ids reales viejos como BOL-L. -202606-001 se
  -- conservan tal cual; esto solo gobierna los lotes nuevos).
  v_id := case p_tipo when 'Boleta de pago' then 'BOL' when 'Gratificación' then 'GRA'
                      when 'Liquidación de CTS' then 'CTS' else 'UTI' end
          || '-' || upper(left(regexp_replace((select corto from empresas where id = p_empresa), '[^A-Za-z0-9]', '', 'g'), 3))
          || '-' || to_char(now(), 'YYYYMM') || '-' || lpad(v_version::text, 3, '0');

  select count(*) into v_avisos
  from vinculos v join personas p on p.dni = v.persona_dni
  where v.empresa_id = p_empresa and v.fecha_fin is null and p.celular is not null;

  insert into lotes (id, empresa_id, tipo, periodo, version, publicado_por, avisos)
  values (v_id, p_empresa, p_tipo, p_periodo, v_version, p_por, v_avisos);

  insert into documentos (vinculo_id, lote_id, tipo, titulo, periodo, version, hash_sha256)
  select v.id, v_id, p_tipo, p_tipo || ' — ' || p_periodo, p_periodo, v_version,
         md5(v.persona_dni || v_id) || md5(v_id || v.persona_dni)
  from vinculos v
  where v.empresa_id = p_empresa and v.fecha_fin is null;

  -- Corrección de versión: las versiones anteriores quedan marcadas, sus
  -- acuses permanecen intactos.
  if v_version > 1 then
    update documentos set estado = 'reemplazado'
    where lote_id in (select id from lotes where empresa_id = p_empresa
                      and tipo = p_tipo and periodo = p_periodo and version < v_version);
  end if;

  return v_id;
end $$;


-- publicar_lote_pdf · supabase/schema.sql
create or replace function publicar_lote_pdf(
  p_empresa text, p_tipo text, p_periodo text, p_por text, p_boletas jsonb
) returns jsonb language plpgsql security definer as $$
declare
  b jsonb; v_version int; v_id text; v_avisos int; v_vinculo bigint; v_docs int := 0;
begin
  perform requiere_nivel('boletas', 2);  -- fase 1: guarda central
  -- Validación previa completa: entra todo o no entra nada.
  for b in select * from jsonb_array_elements(p_boletas) loop
    if coalesce(b->>'dni','') = '' or coalesce(b->>'hash','') = '' or coalesce(b->>'archivo_url','') = '' then
      raise exception 'Boleta sin trabajador identificado o sin archivo: nada se publica así.';
    end if;
    if not exists (select 1 from vinculos where persona_dni = b->>'dni'
                   and empresa_id = p_empresa and fecha_fin is null) then
      raise exception 'El DNI % no tiene vínculo vigente en la empresa: excepción sin resolver.', b->>'dni';
    end if;
  end loop;
  if (select count(distinct x->>'dni') from jsonb_array_elements(p_boletas) x)
     <> (select count(*) from jsonb_array_elements(p_boletas)) then
    raise exception 'Hay DNI repetidos en el lote: excepción sin resolver.';
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from lotes where empresa_id = p_empresa and tipo = p_tipo and periodo = p_periodo;
  -- Mismo saneo del corto que en publicar_lote: solo alfanumérico antes de
  -- cortar a 3 («L. AMERICANA» → LAM).
  v_id := case p_tipo when 'Boleta de pago' then 'BOL' when 'Gratificación' then 'GRA'
                      when 'Liquidación de CTS' then 'CTS' else 'UTI' end
          || '-' || upper(left(regexp_replace((select corto from empresas where id = p_empresa), '[^A-Za-z0-9]', '', 'g'), 3))
          || '-' || replace(p_periodo, '-', '') || '-' || lpad(v_version::text, 3, '0');

  -- avisos es "cuántos de ESTE lote" (los DNIs que vienen en p_boletas), no
  -- todos los vínculos con celular de la empresa entera.
  select count(*) into v_avisos from vinculos v join personas p on p.dni = v.persona_dni
  where v.empresa_id = p_empresa and v.fecha_fin is null and p.celular is not null
    and v.persona_dni in (select x->>'dni' from jsonb_array_elements(p_boletas) x);

  insert into lotes (id, empresa_id, tipo, periodo, version, publicado_por, avisos)
  values (v_id, p_empresa, p_tipo, p_periodo, v_version, p_por, v_avisos);

  for b in select * from jsonb_array_elements(p_boletas) loop
    select id into v_vinculo from vinculos
    where persona_dni = b->>'dni' and empresa_id = p_empresa and fecha_fin is null;
    -- El PDF puede traer datos MÁS completos que el Excel (sede completa);
    -- solo se mejora, nunca se degrada a un prefijo.
    update personas set nombre = case
        when b->>'nombre' is null then nombre
        when fn_es_prefijo_truncado(b->>'nombre', nombre) then nombre
        when length(trim(b->>'nombre')) > length(nombre) then trim(b->>'nombre') else nombre end
    where dni = b->>'dni';
    -- Misma regla anti-prefijo aplica a sedes.nombre (sede del vínculo
    -- guardada truncada por un Excel viejo, el PDF trae el nombre completo) y
    -- a vinculos.cargo (el PDF trunca el cargo a 20 caracteres; jamás se
    -- degrada el cargo completo ya guardado a esa versión truncada).
    if b->>'sede' is not null then
      update sedes set nombre = trim(b->>'sede')
      where id = (select sede_id from vinculos where id = v_vinculo)
        and fn_es_prefijo_truncado(nombre, trim(b->>'sede'));
    end if;
    if b->>'cargo' is not null then
      update vinculos set cargo = trim(b->>'cargo')
      where id = v_vinculo
        and not fn_es_prefijo_truncado(trim(b->>'cargo'), cargo)
        and cargo is distinct from trim(b->>'cargo');
    end if;
    insert into documentos (vinculo_id, lote_id, tipo, titulo, periodo, version, hash_sha256, neto)
    values (v_vinculo, v_id, p_tipo, p_tipo || ' — ' || p_periodo, p_periodo, v_version,
            b->>'hash', nullif(b->>'neto','')::numeric);
    update documentos set archivo_url = b->>'archivo_url'
    where lote_id = v_id and vinculo_id = v_vinculo;
    v_docs := v_docs + 1;
  end loop;

  -- Un lote PDF puede ser PARCIAL (solo boletas corregidas, no todo el
  -- personal del periodo) — a diferencia de publicar_lote, que siempre genera
  -- un documento por cada vínculo vigente de la empresa. Marcar 'reemplazado'
  -- TODOS los documentos de versiones previas del mismo lote le quitaría su
  -- boleta vigente a los trabajadores que NO están en la v2. Se acota a los
  -- vínculos que sí están en el lote nuevo.
  if v_version > 1 then
    update documentos set estado = 'reemplazado'
    where lote_id in (select id from lotes where empresa_id = p_empresa
                      and tipo = p_tipo and periodo = p_periodo and version < v_version)
      and vinculo_id in (select vinculo_id from documentos where lote_id = v_id);
  end if;
  return jsonb_build_object('lote_id', v_id, 'documentos', v_docs, 'version', v_version);
end $$;


-- publicar_comunicado · supabase/schema.sql
create or replace function publicar_comunicado(
  p_titulo text, p_cuerpo text, p_vence date, p_exige boolean,
  p_segmento text, p_alcance int, p_empresa text default null, p_sede text default null
) returns bigint language plpgsql security definer as $$
declare v_id bigint;
begin
  perform requiere_nivel('comunicados', 2);  -- fase 1: guarda central
  insert into comunicados (titulo, cuerpo, vence, exige_acuse, segmento, alcance, empresa_id, sede_id)
  values (p_titulo, p_cuerpo, p_vence, p_exige, p_segmento, p_alcance,
          nullif(p_empresa, ''), nullif(p_sede, ''))
  returning id into v_id;
  return v_id;
end $$;


-- registrar_epp · supabase/schema.sql
create or replace function registrar_epp(p_dni text, p_items text, p_entrega date, p_reposicion date)
returns void language plpgsql security definer as $$
begin
  perform requiere_nivel('activos', 2);  -- fase 1: guarda central
  insert into epp_entregas (dni, items, entrega, reposicion)
  values (p_dni, p_items, p_entrega, p_reposicion);
end $$;


-- previsualizar_asistencia · supabase/schema.sql
create or replace function previsualizar_asistencia(
  p_empresa text, p_registros jsonb, p_archivo text, p_resumen jsonb
) returns jsonb language plpgsql security definer as $$
declare v jsonb;
begin
  perform requiere_nivel('asistencia', 2);  -- fase 1: guarda central
  v := importar_asistencia(p_empresa, p_registros, p_archivo, p_resumen, '(vista previa)');
  raise exception using errcode = 'PV999', message = v::text; -- revertir TODO
exception when sqlstate 'PV999' then
  return sqlerrm::jsonb;
end $$;


-- importar_activos · supabase/schema.sql
create or replace function importar_activos(
  p_empresa text, p_activos jsonb, p_razon_social text, p_archivo text, p_por text
) returns jsonb language plpgsql security definer as $$
declare
  a jsonb; v_codigo text; v_otra text; c text;
  v_altas text[] := '{}'; v_sin text[] := '{}'; v_acts jsonb := '[]'::jsonb;
  v_cambios jsonb; j_antes jsonb; j_despues jsonb;
  v_campos text[] := array['marca','modelo','serie','tipo','area',
    'asignado_sin_confirmar','usuario_anterior','observaciones','por_corregir'];
begin
  perform requiere_nivel('activos', 2);  -- fase 1: guarda central
  if (select estado from empresas where id = p_empresa) is distinct from 'activa' then
    raise exception 'La empresa % no está activa: importación rechazada completa.', p_empresa;
  end if;

  -- Los repetidos del ARCHIVO ya llegan sufijados por el parser (PROLT51-R2)
  -- y marcados repetido=true; un duplicado en el payload es señal de error.
  select d.codigo into v_codigo from (
    select trim(x->>'codigo') as codigo
    from jsonb_array_elements(p_activos) x
    group by 1 having count(*) > 1 limit 1) d;
  if v_codigo is not null then
    raise exception 'El código % aparece más de una vez en el lote recibido: no se importa ningún activo.', v_codigo;
  end if;

  for a in select * from jsonb_array_elements(p_activos) loop
    v_codigo := trim(coalesce(a->>'codigo', ''));
    if v_codigo = '' then
      raise exception 'Hay una fila sin código: no se importa ningún activo.';
    end if;

    select empresa_id into v_otra from activos where codigo = v_codigo;
    if v_otra is not null and v_otra <> p_empresa then
      raise exception 'El código % ya está registrado en la empresa %. Puede ser un traslado entre empresas: es una operación distinta y no se resuelve importando.', v_codigo, v_otra;
    end if;

    if v_otra is null then
      insert into activos (codigo, categoria, empresa_id, marca, modelo, serie,
                           tipo, area, asignado_sin_confirmar, usuario_anterior, observaciones,
                           por_corregir)
      values (v_codigo, 'Cómputo', p_empresa,
              nullif(trim(coalesce(a->>'marca', '')), ''),
              nullif(trim(coalesce(a->>'modelo', '')), ''),
              nullif(trim(coalesce(a->>'serie', '')), ''),
              nullif(trim(coalesce(a->>'tipo', '')), ''),
              nullif(trim(coalesce(a->>'area', '')), ''),
              nullif(trim(coalesce(a->>'usuario', '')), ''),
              nullif(trim(coalesce(a->>'usuarioAnterior', '')), ''),
              nullif(trim(coalesce(a->>'observaciones', '')), ''),
              coalesce((a->>'repetido')::boolean, false));
      v_altas := v_altas || v_codigo;
    else
      select to_jsonb(ac) into j_antes from activos ac where codigo = v_codigo;
      update activos set
        marca = fn_valor_importado(a->>'marca', marca),
        modelo = fn_valor_importado(a->>'modelo', modelo),
        serie = fn_valor_importado(a->>'serie', serie),
        tipo = fn_valor_importado(a->>'tipo', tipo),
        area = fn_valor_importado(a->>'area', area),
        asignado_sin_confirmar = fn_valor_importado(a->>'usuario', asignado_sin_confirmar),
        usuario_anterior = fn_valor_importado(a->>'usuarioAnterior', usuario_anterior),
        observaciones = fn_valor_importado(a->>'observaciones', observaciones),
        -- Estado, no dato: true al importar una repetición y false cuando el
        -- archivo corregido ya no repite el código.
        por_corregir = coalesce((a->>'repetido')::boolean, false)
      where codigo = v_codigo;
      select to_jsonb(ac) into j_despues from activos ac where codigo = v_codigo;

      v_cambios := '{}'::jsonb;
      foreach c in array v_campos loop
        if j_antes->c is distinct from j_despues->c then
          v_cambios := v_cambios ||
            jsonb_build_object(c, jsonb_build_object('antes', j_antes->c, 'despues', j_despues->c));
        end if;
      end loop;
      if v_cambios = '{}'::jsonb then
        v_sin := v_sin || v_codigo;
      else
        v_acts := v_acts || jsonb_build_object('codigo', v_codigo, 'cambios', v_cambios);
      end if;
    end if;
  end loop;

  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('IMPORTAR_ACTIVOS', 'importar_activos', null,
    jsonb_build_object('por', p_por, 'empresa', p_empresa,
      'razon_social_confirmada', p_razon_social, 'archivo', p_archivo,
      'altas', to_jsonb(v_altas), 'actualizaciones', v_acts, 'sin_cambio', to_jsonb(v_sin)));

  return jsonb_build_object('altas', to_jsonb(v_altas),
    'actualizaciones', v_acts, 'sin_cambio', to_jsonb(v_sin));
end $$;


-- previsualizar_importacion_activos · supabase/schema.sql
create or replace function previsualizar_importacion_activos(
  p_empresa text, p_activos jsonb, p_razon_social text, p_archivo text
) returns jsonb language plpgsql security definer as $$
declare v jsonb;
begin
  perform requiere_nivel('activos', 2);  -- fase 1: guarda central
  v := importar_activos(p_empresa, p_activos, p_razon_social, p_archivo, '(vista previa)');
  raise exception using errcode = 'PV999', message = v::text; -- revertir TODO
exception when sqlstate 'PV999' then
  return sqlerrm::jsonb;
end $$;


-- crear_sede · supabase/schema.sql
create or replace function crear_sede(
  p_empresa text, p_nombre text, p_cliente text,
  p_direccion text default null, p_por text default 'RRHH', p_rit text default null
) returns jsonb language plpgsql security definer as $$
declare v_id text; v_codigo text;
begin
  perform requiere_nivel('configuracion', 2, 'personal');  -- fase 1: guarda central
  if (select estado from empresas where id = p_empresa) is distinct from 'activa' then
    raise exception 'La empresa % no está activa.', p_empresa;
  end if;
  if trim(coalesce(p_nombre, '')) = '' then
    raise exception 'La sede necesita un nombre.';
  end if;
  if exists (select 1 from sedes
             where empresa_id = p_empresa and upper(trim(nombre)) = upper(trim(p_nombre))) then
    raise exception 'Ya existe una sede «%» en esa empresa.', trim(p_nombre);
  end if;
  if p_rit is not null and not exists (select 1 from rits where id = p_rit) then
    raise exception 'El reglamento % no existe.', p_rit;
  end if;
  v_id := p_empresa || '-' || lower(regexp_replace(trim(p_nombre), '\s+', '-', 'g'));
  if exists (select 1 from sedes where id = v_id) then
    raise exception 'Ya existe una sede con ese identificador (%).', v_id;
  end if;
  v_codigo := 'S-' || lpad(nextval('seq_sede_codigo')::text, 4, '0');
  insert into sedes (id, empresa_id, nombre, cliente, direccion, codigo, rit_id)
  values (v_id, p_empresa, trim(p_nombre),
          coalesce(nullif(trim(p_cliente), ''), 'Por asignar'),
          nullif(trim(coalesce(p_direccion, '')), ''), v_codigo, p_rit);
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('CREAR_SEDE', 'sedes', null, jsonb_build_object(
    'id', v_id, 'codigo', v_codigo, 'empresa', p_empresa,
    'nombre', trim(p_nombre), 'rit', p_rit, 'por', p_por));
  return jsonb_build_object('id', v_id, 'codigo', v_codigo);
end $$;


-- asignar_activo · supabase/schema.sql
create or replace function asignar_activo(
  p_codigo text, p_dni text, p_condicion text default 'Buen estado',
  p_antivirus boolean default null, p_comentario text default null
) returns void language plpgsql security definer as $$
begin
  perform requiere_nivel('activos', 2);  -- fase 1: guarda central
  if exists (select 1 from asignaciones where activo_codigo = p_codigo and devuelto_en is null) then
    raise exception 'El activo % ya está asignado. Regístrese la devolución primero.', p_codigo;
  end if;
  if (select estado_fisico from activos where codigo = p_codigo) <> 'operativo' then
    raise exception 'El activo % no está operativo.', p_codigo;
  end if;
  insert into asignaciones (activo_codigo, persona_dni, condicion_entrega, antivirus, comentario)
  values (p_codigo, p_dni, p_condicion, p_antivirus, nullif(trim(coalesce(p_comentario,'')), ''));
end $$;


-- devolver_activo · supabase/schema.sql
create or replace function devolver_activo(p_codigo text, p_destino text, p_condicion text default 'Buen estado')
returns void language plpgsql security definer as $$
begin
  perform requiere_nivel('activos', 2);  -- fase 1: guarda central
  update asignaciones
  set devuelto_en = current_date, condicion_devolucion = p_condicion, destino = p_destino
  where activo_codigo = p_codigo and devuelto_en is null;

  update activos
  set estado_fisico = case when p_destino in ('mantenimiento','baja') then p_destino else 'operativo' end
  where codigo = p_codigo;
end $$;


-- editar_activo · supabase/schema.sql
create or replace function editar_activo(
  p_codigo text, p_nuevo_codigo text, p_tipo text, p_marca text, p_modelo text,
  p_serie text, p_area text, p_asignado_sin_confirmar text, p_observaciones text,
  p_por text default 'Gestión de TI', p_ip text default null
) returns void language plpgsql security definer as $$
declare v_nuevo text; j_antes jsonb; j_despues jsonb;
begin
  perform requiere_nivel('activos', 2);  -- fase 1: guarda central
  if not exists (select 1 from activos where codigo = p_codigo) then
    raise exception 'El activo % no existe.', p_codigo;
  end if;
  v_nuevo := trim(coalesce(p_nuevo_codigo, ''));
  if v_nuevo = '' then
    raise exception 'El activo necesita un código.';
  end if;
  if v_nuevo <> p_codigo and exists (select 1 from activos where codigo = v_nuevo) then
    raise exception 'Ya existe un activo con el código %.', v_nuevo;
  end if;

  select to_jsonb(ac) - 'clave_equipo' into j_antes from activos ac where codigo = p_codigo;
  update activos set
    codigo = v_nuevo,
    tipo = nullif(trim(coalesce(p_tipo, '')), ''),
    marca = nullif(trim(coalesce(p_marca, '')), ''),
    modelo = nullif(trim(coalesce(p_modelo, '')), ''),
    serie = nullif(trim(coalesce(p_serie, '')), ''),
    area = nullif(trim(coalesce(p_area, '')), ''),
    ip = nullif(trim(coalesce(p_ip, '')), ''),
    asignado_sin_confirmar = nullif(trim(coalesce(p_asignado_sin_confirmar, '')), ''),
    observaciones = nullif(trim(coalesce(p_observaciones, '')), ''),
    por_corregir = case when v_nuevo <> p_codigo then false else por_corregir end
  where codigo = p_codigo;
  select to_jsonb(ac) - 'clave_equipo' into j_despues from activos ac where codigo = v_nuevo;

  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('EDITAR_ACTIVO', 'activos',
    j_antes || jsonb_build_object('por', p_por), j_despues);
end $$;


-- resolver_memorandum · supabase/schema.sql
create or replace function resolver_memorandum(p_id text, p_decision text) returns void
language plpgsql security definer as $$
begin
  perform requiere_nivel('memorandums', 3);  -- fase 1: guarda central
  update memorandums
  set estado = 'resuelto', resuelto_en = current_date, resolucion = p_decision
  where id = p_id;
end $$;


-- notificar_memorandum · supabase/schema.sql
create or replace function notificar_memorandum(p_id text)
returns void language plpgsql security definer as $$
declare m memorandums%rowtype; t tipos_sancion%rowtype;
begin
  perform requiere_nivel('memorandums', 2);  -- fase 1: guarda central
  select * into m from memorandums where id = p_id;
  if m.id is null then raise exception 'El memorándum % no existe.', p_id; end if;
  if m.estado = 'registro_interno' then
    raise exception 'La amonestación verbal es un registro interno: no se notifica.';
  end if;
  if m.notificado_en is not null then
    raise exception 'El memorándum % ya fue notificado.', p_id;
  end if;
  select t2.* into t from tipos_sancion t2
  join vinculos v on v.id = m.vinculo_id
  join empresas e on e.id = v.empresa_id
  where t2.id = m.tipo_sancion_id and t2.rit_id = e.rit_id;

  update memorandums set
    notificado_en = now(),
    vence = case when coalesce(t.plazo_descargo_dias, m.plazo_dias) > 0
                 then fn_sumar_dias(current_date, coalesce(t.plazo_descargo_dias, m.plazo_dias),
                                    coalesce(t.plazo_habil, true))
                 end,
    estado = case when coalesce(t.plazo_descargo_dias, m.plazo_dias) > 0 then 'en_plazo' else 'notificado' end
  where id = p_id;
end $$;



-- 3 · search_path fijo en toda security definer (create or replace lo borra).
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as firma from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef
              and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
  loop execute format('alter function %s set search_path = public, extensions', r.firma); end loop;
end $$;

-- 4 · Sobrecarga huérfana (anterior a gestión TI del 19-08; sin uso).
drop function if exists asignar_activo(text, text, text);

-- 5 · GRANT explícito y listado.
grant execute on function
  crear_usuario_admin(p_dni text, p_perfil text, p_correo text, p_celular text, p_clave text, p_por text),
  actualizar_usuario_admin(p_id bigint, p_perfil text, p_correo text, p_celular text, p_estado text),
  suspender_usuario_admin(p_id bigint),
  reactivar_usuario_admin(p_id bigint),
  reenviar_clave(p_id bigint, p_clave text),
  guardar_perfil(p_id text, p_nombre text, p_descripcion text, p_superadmin boolean, p_ver_remuneracion boolean, p_ver_documentos boolean, p_exportar boolean, p_matriz jsonb, p_empresas text[] , p_por text , p_ver_bancarios boolean),
  eliminar_perfil(p_id text),
  desactivar_perfil(p_id text),
  guardar_politica(p_backoffice_horas int, p_portal_dias int, p_multisesion_backoffice boolean, p_multisesion_portal boolean, p_intentos int, p_bloqueo_min int, p_recuperacion text, p_clave_min_portal int, p_clave_min_backoffice int, p_provisional_dias int, p_por text),
  marcar_clave_cambiada(p_correo text),
  alta_trabajador(p_dni text, p_nombre text, p_cargo text, p_sede text, p_empresa text, p_ingreso date, p_celular text , p_banco text , p_cuenta text , p_correo text , p_cci text , p_tipo_documento text),
  eliminar_trabajador(p_dni text),
  publicar_lote(p_empresa text, p_tipo text, p_periodo text, p_por text),
  publicar_lote_pdf(p_empresa text, p_tipo text, p_periodo text, p_por text, p_boletas jsonb),
  publicar_comunicado(p_titulo text, p_cuerpo text, p_vence date, p_exige boolean, p_segmento text, p_alcance int, p_empresa text , p_sede text),
  registrar_epp(p_dni text, p_items text, p_entrega date, p_reposicion date),
  previsualizar_asistencia(p_empresa text, p_registros jsonb, p_archivo text, p_resumen jsonb),
  importar_activos(p_empresa text, p_activos jsonb, p_razon_social text, p_archivo text, p_por text),
  previsualizar_importacion_activos(p_empresa text, p_activos jsonb, p_razon_social text, p_archivo text),
  crear_sede(p_empresa text, p_nombre text, p_cliente text, p_direccion text , p_por text , p_rit text),
  asignar_activo(p_codigo text, p_dni text, p_condicion text , p_antivirus boolean , p_comentario text),
  devolver_activo(p_codigo text, p_destino text, p_condicion text),
  editar_activo(p_codigo text, p_nuevo_codigo text, p_tipo text, p_marca text, p_modelo text, p_serie text, p_area text, p_asignado_sin_confirmar text, p_observaciones text, p_por text , p_ip text),
  resolver_memorandum(p_id text, p_decision text),
  notificar_memorandum(p_id text)
to authenticated;
grant execute on function es_admin(), es_superadmin(), nivel_en(text) to authenticated;
grant execute on function correo_llamador(), requiere_nivel(text, int, text), requiere_superadmin(), requiere_correo_propio(text),
  es_admin(), es_superadmin(), nivel_en(text) to service_role;

-- 6 · Una función nueva nace sin EXECUTE para nadie salvo su dueño y service_role.
--     PostgreSQL FUSIONA el default del esquema con el global (o el incorporado,
--     que concede EXECUTE a PUBLIC): el cierre del 14-09 solo tocó el esquema y
--     por eso toda función nueva seguía naciendo ejecutable por PUBLIC. Hace
--     falta también la entrada GLOBAL.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from public, authenticated, anon;

-- 7 · Verificación embebida.
do $$
declare lista text; n int;
  esperadas constant text := 'actualizar_ticket,actualizar_usuario_admin,alta_trabajador,alternar_ticket_subtipo,alternar_ticket_tipo,asignar_activo,asignar_rit_sede,crear_activo,crear_rit,crear_sede,crear_solicitud_admin,crear_solicitud_propia,crear_ticket_admin,crear_usuario_admin,decidir_propuesta_perfil,desactivar_perfil,devolver_activo,editar_activo,editar_trabajador,eliminar_feriado,eliminar_perfil,eliminar_sede,eliminar_solicitud_aviso,eliminar_ticket_aviso,eliminar_trabajador,emitir_memorandum,es_admin,es_admin_activo,es_superadmin,fijar_correo_persona,fijar_hora_entrada,fn_hora_entrada,fn_nivel_memorandums,fn_nivel_modulo,fn_persona_llamador,fn_solicitud_insertar,fn_ver_cuenta_bancaria,guardar_cargo_perfil,guardar_clave_equipo,guardar_feriado,guardar_perfil,guardar_politica,guardar_solicitud_aviso,guardar_ticket_aviso,guardar_ticket_subtipo,guardar_ticket_tipo,importar_activos,importar_asistencia,importar_control,importar_padron,importar_planilla_unificada,marcar_clave_cambiada,mi_sesion_backoffice,nivel_en,notificar_memorandum,portal_actualizar_datos,portal_confirmar_lectura,portal_confirmar_recepcion,portal_crear_solicitud,portal_crear_ticket,portal_dni,portal_marcar_visto,portal_mi_sesion,portal_modo,portal_primer_ingreso,portal_registrar_ingreso,portal_registrar_sesion,portal_solicitar_cambio_cuenta,portal_verificar_bloqueo,previsualizar_asistencia,previsualizar_control,previsualizar_importacion_activos,previsualizar_padron,previsualizar_planilla_unificada,publicar_comunicado,publicar_lote,publicar_lote_pdf,publicar_rit,reactivar_usuario_admin,reenviar_clave,reenviar_solicitud,registrar_acuse_asistido,registrar_epp,registrar_ingreso,registrar_sesion_backoffice,resolver_memorandum,resolver_solicitud,suspender_usuario_admin,ver_clave_equipo,verificar_bloqueo';
  sin_guarda constant text[] := array['verificar_bloqueo', 'registrar_ingreso', 'portal_verificar_bloqueo', 'portal_registrar_ingreso',
                                      'fn_hora_entrada', 'portal_modo', 'es_admin', 'es_superadmin', 'nivel_en'];
begin
  select string_agg(p.proname, ',' order by p.proname) into lista
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
  if lista is distinct from 'portal_registrar_ingreso,portal_verificar_bloqueo,registrar_ingreso,verificar_bloqueo' then
    raise exception 'fase1: funciones ejecutables por anon = %', coalesce(lista, '(ninguna)');
  end if;
  select string_agg(distinct p.proname, ',' order by p.proname) into lista
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute');
  if lista is distinct from esperadas then
    raise exception 'fase1: la lista de funciones ejecutables por authenticated no es la esperada: %', coalesce(lista, '(ninguna)');
  end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute');
  if n <> 90 then raise exception 'fase1: % firmas ejecutables por authenticated, esperadas 90 (¿sobrecarga?)', n; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prosecdef
     and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'));
  if n > 0 then raise exception 'fase1: % security definer sin search_path', n; end if;
  -- Ninguna función ejecutable por authenticated sin verificación del llamador.
  select string_agg(p.proname, ',' order by p.proname) into lista
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
     and not (p.proname = any(sin_guarda))
     and p.prosrc !~ '(requiere_nivel|requiere_superadmin|requiere_correo_propio|fn_nivel_modulo|fn_nivel_memorandums|portal_dni|fn_persona_llamador|es_admin_activo|auth\.(uid|jwt)|importar_control|importar_padron|importar_planilla_unificada|fn_ver_cuenta_bancaria)';
  if lista is not null then raise exception 'fase1: funciones ejecutables por authenticated SIN guarda: %', lista; end if;
  -- Prueba de comportamiento: una función recién creada no la ejecuta nadie de la API.
  execute 'create function public.zz_fase1_nacimiento() returns int language sql as $f$ select 1 $f$';
  if has_function_privilege('authenticated', 'public.zz_fase1_nacimiento()', 'execute')
     or has_function_privilege('anon', 'public.zz_fase1_nacimiento()', 'execute') then
    execute 'drop function public.zz_fase1_nacimiento()';
    raise exception 'fase1: una función nueva sigue naciendo ejecutable por authenticated/anon (default privileges)';
  end if;
  if not has_function_privilege('service_role', 'public.zz_fase1_nacimiento()', 'execute') then
    execute 'drop function public.zz_fase1_nacimiento()';
    raise exception 'fase1: service_role perdió el EXECUTE por defecto';
  end if;
  execute 'drop function public.zz_fase1_nacimiento()';
  if exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
             where s.nspname = 'public' and p.oid::regprocedure::text = 'asignar_activo(text,text,text)') then
    raise exception 'fase1: la sobrecarga huérfana asignar_activo(text,text,text) sigue existiendo';
  end if;
end $$;

commit;
