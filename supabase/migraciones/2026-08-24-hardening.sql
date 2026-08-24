-- supabase/migraciones/2026-08-24-hardening.sql — pase de hardening menor.
-- (1) Ids de lote: el corto de la empresa se sanea a alfanumérico antes de
--     cortar a 3 («L. AMERICANA» → LAM, ya no «L. »); los ids viejos como
--     BOL-L. -202606-001 se conservan tal cual.
-- (2) importar_planilla: nombre_por_confirmar también se gobierna en
--     RE-importaciones (hereda la marca al adoptar un nombre más largo y se
--     limpia cuando el archivo confirma exacto un nombre sin truncar); antes
--     solo se marcaba en altas nuevas.
-- (3) Bucket documentos: solo application/pdf y tope 50 MB (hoy todos los
--     objetos ya son PDF).
-- (4) search_path fijo (public, extensions) en TODAS las funciones security
--     definer de public — lint de Supabase, cierra el hijacking por
--     search_path. El bloque DO del final es re-ejecutable: correrlo de nuevo
--     después de crear funciones nuevas.
-- Idempotente. Aplicar DESPUÉS de 2026-08-24-movimientos-planilla.sql.
-- Canónico de las tres funciones: supabase/schema.sql (sincronizado).

-- (1a) publicar_lote ---------------------------------------------------------
create or replace function publicar_lote(
  p_empresa text, p_tipo text, p_periodo text, p_por text
) returns text language plpgsql security definer as $$
declare
  v_version int;
  v_id text;
  v_avisos int;
begin
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

-- (1b) publicar_lote_pdf -----------------------------------------------------
create or replace function publicar_lote_pdf(
  p_empresa text, p_tipo text, p_periodo text, p_por text, p_boletas jsonb
) returns jsonb language plpgsql security definer as $$
declare
  b jsonb; v_version int; v_id text; v_avisos int; v_vinculo bigint; v_docs int := 0;
begin
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

-- (2) importar_planilla ------------------------------------------------------
create or replace function importar_planilla(p_empresa text, p_filas jsonb, p_por text)
returns jsonb language plpgsql security definer as $$
declare
  f jsonb; v_dni text; v_nombre text; v_sede_id text; v_vinculo bigint;
  v_altas text[] := '{}'; v_act text[] := '{}'; v_sin text[] := '{}';
  v_por_confirmar int := 0; v_cambio boolean;
begin
  if (select estado from empresas where id = p_empresa) is distinct from 'activa' then
    raise exception 'La empresa % no está activa: importación rechazada completa.', p_empresa;
  end if;
  for f in select * from jsonb_array_elements(p_filas) loop
    v_dni := f->>'dni';  v_nombre := trim(f->>'nombres');
    insert into cargos (nombre) values (trim(f->>'cargo')) on conflict do nothing;
    v_sede_id := fn_sede_para_importacion(p_empresa, f->>'sede', f->>'centroCosto');

    if not exists (select 1 from personas where dni = v_dni) then
      insert into personas (dni, nombre, portal, nombre_por_confirmar)
      values (v_dni, v_nombre, 'sin_celular', (f->>'nombreTruncado')::boolean);
      if (f->>'nombreTruncado')::boolean then v_por_confirmar := v_por_confirmar + 1; end if;
      insert into vinculos (persona_dni, empresa_id, sede_id, cargo, centro_costo, fecha_inicio, fecha_fin)
      values (v_dni, p_empresa, v_sede_id, trim(f->>'cargo'), trim(f->>'centroCosto'),
              (f->>'ingreso')::date, (f->>'cese')::date);
      v_altas := v_altas || v_dni;
    else
      -- persona existente: JAMÁS pisar datos personales manuales; el nombre
      -- solo mejora (nunca un prefijo más corto). La marca nombre_por_confirmar
      -- acompaña esa mejora: si se adopta un nombre más largo hereda la marca
      -- de la fuente (truncado o no), y si el archivo trae EXACTAMENTE el
      -- nombre guardado sin señal de truncado, lo confirma y limpia la marca.
      -- Nunca se re-marca un nombre que un humano ya confirmó sin cambiarlo.
      update personas set
        nombre = case when fn_es_prefijo_truncado(v_nombre, nombre) then nombre
                      when length(v_nombre) > length(nombre) then v_nombre else nombre end,
        nombre_por_confirmar = case
          when not fn_es_prefijo_truncado(v_nombre, nombre) and length(v_nombre) > length(nombre)
            then coalesce((f->>'nombreTruncado')::boolean, false)
          when v_nombre = nombre and not coalesce((f->>'nombreTruncado')::boolean, false)
            then false
          else nombre_por_confirmar end
      where dni = v_dni;
      select id into v_vinculo from vinculos
      where persona_dni = v_dni and empresa_id = p_empresa and fecha_fin is null;
      if v_vinculo is null then
        insert into vinculos (persona_dni, empresa_id, sede_id, cargo, centro_costo, fecha_inicio, fecha_fin)
        values (v_dni, p_empresa, v_sede_id, trim(f->>'cargo'), trim(f->>'centroCosto'),
                (f->>'ingreso')::date, (f->>'cese')::date);
        v_act := v_act || v_dni;
      else
        select (sede_id is distinct from v_sede_id
             or not fn_es_prefijo_truncado(trim(f->>'cargo'), cargo) and cargo is distinct from trim(f->>'cargo')
             or centro_costo is distinct from trim(f->>'centroCosto')
             or (f->>'cese') is not null and fecha_fin is distinct from (f->>'cese')::date)
        into v_cambio from vinculos where id = v_vinculo;
        if v_cambio then
          update vinculos set
            sede_id = v_sede_id,
            cargo = case when fn_es_prefijo_truncado(trim(f->>'cargo'), cargo) then cargo else trim(f->>'cargo') end,
            centro_costo = trim(f->>'centroCosto'),
            fecha_fin = coalesce((f->>'cese')::date, fecha_fin)   -- cese SOLO si viene con fecha
          where id = v_vinculo;
          v_act := v_act || v_dni;
        else
          v_sin := v_sin || v_dni;
        end if;
      end if;
    end if;
  end loop;

  -- Traza de "quién importó" (p_por): la tabla auditoria es por-fila (una
  -- fila por INSERT/UPDATE/DELETE, ver fn_auditar) y personas/vinculos ya
  -- quedan auditadas fila-por-fila automáticamente por los triggers
  -- trg_auditar_personas / trg_auditar_vinculos. Eso registra el QUÉ pero no
  -- el p_por (columna `usuario` de auditoria guarda current_user, el rol de
  -- Postgres, no el nombre humano recibido por parámetro). Se agrega UNA fila
  -- resumen adicional por llamada, con la misma forma que usa fn_auditar
  -- (accion/tabla/datos_antes/datos_despues), guardando p_por + empresa +
  -- conteos dentro de datos_despues. Si la llamada viene de
  -- previsualizar_importacion esta fila también se revierte junto con todo lo
  -- demás (misma transacción/savepoint), así que el preview sigue sin dejar
  -- rastro.
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('IMPORTAR_PLANILLA', 'importar_planilla', null,
    jsonb_build_object('por', p_por, 'empresa', p_empresa,
      'altas', to_jsonb(v_altas), 'actualizaciones', to_jsonb(v_act),
      'sin_cambio', to_jsonb(v_sin), 'nombres_por_confirmar', v_por_confirmar));

  return jsonb_build_object('altas', to_jsonb(v_altas), 'actualizaciones', to_jsonb(v_act),
    'sin_cambio', to_jsonb(v_sin), 'nombres_por_confirmar', v_por_confirmar);
end $$;

-- (3) Límites del bucket privado de documentos -------------------------------
update storage.buckets
   set file_size_limit = 52428800,          -- 50 MB
       allowed_mime_types = array['application/pdf']
 where id = 'documentos';

-- (4) search_path fijo en toda security definer de public --------------------
-- Va AL FINAL a propósito: create or replace borra el setting previo, así que
-- las funciones re-declaradas arriba también lo reciben aquí.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as firma
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and (p.proconfig is null
           or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
  loop
    execute format('alter function %s set search_path = public, extensions', r.firma);
  end loop;
end $$;
