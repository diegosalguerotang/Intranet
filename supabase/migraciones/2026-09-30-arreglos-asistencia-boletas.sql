-- supabase/migraciones/2026-09-30-arreglos-asistencia-boletas.sql
-- Generado por scripts/arreglos-generar.mjs desde supabase/schema.sql (no editar a mano).
-- Una transacción. Reversión: supabase/respaldos/2026-09-30-arreglos-asistencia-boletas-reversion.sql.
-- Aplica DIEGO con `!`:  node scripts/aplicar-sql.mjs supabase/migraciones/2026-09-30-arreglos-asistencia-boletas.sql
-- (A) importar_asistencia: el DELETE por rango solo toca origen = 'reloj' y el
--     INSERT no pisa filas del control semanal. (B) lotes.huella + publicar_lote_pdf
--     devuelve el lote idéntico ya publicado en vez de crear otra versión.
-- No toca datos ni privilegios (create or replace conserva los grants).
begin;
set local search_path = public, interno, extensions;

alter table lotes add column if not exists huella text;
comment on column lotes.huella is 'SHA-256 de los pares dni:hash ordenados del lote; nulo en lotes anteriores al 2026-09-30.';

create or replace function importar_asistencia(
  p_empresa text, p_registros jsonb, p_archivo text, p_resumen jsonb, p_por text
) returns jsonb language plpgsql security definer set search_path = public, interno, extensions as $$
declare
  v_lote bigint; v_desde date; v_hasta date; v_filas int;
  v_reconocidos int; v_no_reconocidos text[]; v_insertadas int; v_candidatas int;
begin
  if fn_nivel_modulo('asistencia') < 2 then
    raise exception 'Tu categoría no permite importar asistencias (requiere nivel de acción en el módulo Asistencia).';
  end if;
  if (select estado from empresas where id = p_empresa) is distinct from 'activa' then
    raise exception 'La empresa % no está activa: importación rechazada completa.', p_empresa;
  end if;
  if p_registros is null or jsonb_array_length(p_registros) = 0 then
    raise exception 'El archivo no trae filas de marcación importables.';
  end if;

  drop table if exists tmp_asist; drop table if exists tmp_doc; drop table if exists tmp_dedup;
  -- with ordinality: conserva el orden del archivo (ord) para poder decidir
  -- después, ante una colisión de mismo canónico+fecha, cuál fila es "la
  -- última" sin depender de ON CONFLICT (ver INSERT más abajo).
  create temp table tmp_asist on commit drop as
  select trim(x->>'codigo')                as codigo,
         ltrim(trim(x->>'codigo'), '0')    as canonico,
         (x->>'fecha')::date               as fecha,
         nullif(trim(coalesce(x->>'m1','')), '') as m1,
         nullif(trim(coalesce(x->>'m2','')), '') as m2,
         nullif(trim(coalesce(x->>'m3','')), '') as m3,
         nullif(trim(coalesce(x->>'m4','')), '') as m4,
         ord
  from jsonb_array_elements(p_registros) with ordinality as t(x, ord);

  select min(fecha), max(fecha), count(*)::int into v_desde, v_hasta, v_filas from tmp_asist;
  -- Defensa del servidor: el parser ya descartó los días futuros en el cliente.
  if v_hasta > current_date then
    raise exception 'El archivo trae marcaciones de fechas futuras (%): no se importa nada.', v_hasta;
  end if;

  -- Mapa código→documento: personas con vínculo (vigente o histórico) en la
  -- empresa elegida. distinct on: si dos dni del maestro colapsan al mismo
  -- canónico (no debería pasar), gana uno y no revienta la importación.
  create temp table tmp_doc on commit drop as
  select distinct on (ltrim(p.dni, '0')) ltrim(p.dni, '0') as canonico, p.dni
  from personas p
  where exists (select 1 from vinculos v
                where v.persona_dni = p.dni and v.empresa_id = p_empresa)
  order by ltrim(p.dni, '0'), p.dni;

  select count(distinct t.canonico) into v_reconocidos
  from tmp_asist t join tmp_doc d using (canonico);
  if v_reconocidos = 0 then
    raise exception 'Ningún código del archivo corresponde a un trabajador de esta empresa: revisa que hayas elegido la razón social correcta.';
  end if;
  select coalesce(array_agg(distinct t.codigo), '{}') into v_no_reconocidos
  from tmp_asist t left join tmp_doc d using (canonico) where d.dni is null;

  insert into asistencia_lotes (empresa_id, archivo, rango_desde, rango_hasta,
                                trabajadores, filas, anomalias, creado_por)
  values (p_empresa, p_archivo, v_desde, v_hasta,
          (select count(distinct canonico) from tmp_asist), v_filas,
          coalesce(p_resumen, '{}'::jsonb), p_por)
  returning id into v_lote;

  -- Reemplazo por rango SOLO de lo que vino del reloj (2026-09-30): las filas
  -- del control semanal (origen = 'control') son el dato declarado y
  -- prevalecen; antes este DELETE las barría también.
  delete from marcaciones where empresa_id = p_empresa and origen = 'reloj'
    and fecha between v_desde and v_hasta;

  -- Si dos códigos del archivo resuelven a la misma persona y fecha (p. ej.
  -- 9972665 y 09972665), no se puede usar ON CONFLICT DO UPDATE: dentro de
  -- un mismo INSERT, Postgres no permite que la cláusula afecte la misma
  -- fila dos veces ("ON CONFLICT DO UPDATE command cannot affect row a
  -- second time"). Se resuelve antes del INSERT: nos quedamos con la fila de
  -- mayor `ord` (la última del archivo) por (documento, fecha) — "la última
  -- fila manda". El único conflicto posible entonces es con una fila del
  -- control semanal de ese día: se conserva la del control (do nothing).
  create temp table tmp_dedup on commit drop as
  select distinct on (coalesce(d.dni, t.canonico), t.fecha)
         coalesce(d.dni, t.canonico) as documento, t.fecha, t.m1, t.m2, t.m3, t.m4
  from tmp_asist t left join tmp_doc d using (canonico)
  order by coalesce(d.dni, t.canonico), t.fecha, t.ord desc;
  select count(*)::int into v_candidatas from tmp_dedup;
  insert into marcaciones (empresa_id, documento, fecha, m1, m2, m3, m4, lote_id)
  select p_empresa, documento, fecha, m1, m2, m3, m4, v_lote from tmp_dedup
  on conflict (empresa_id, documento, fecha) do nothing;
  get diagnostics v_insertadas = row_count;

  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('IMPORTAR_ASISTENCIA', 'marcaciones', null,
    jsonb_build_object('por', p_por, 'empresa', p_empresa, 'archivo', p_archivo,
      'lote', v_lote, 'desde', v_desde, 'hasta', v_hasta, 'filas', v_filas,
      'reconocidos', v_reconocidos, 'no_reconocidos', to_jsonb(v_no_reconocidos),
      'conservadas_control', v_candidatas - v_insertadas));

  return jsonb_build_object('lote', v_lote,
    'desde', to_char(v_desde, 'YYYY-MM-DD'), 'hasta', to_char(v_hasta, 'YYYY-MM-DD'),
    'filas', v_filas, 'reconocidos', v_reconocidos,
    'no_reconocidos', to_jsonb(v_no_reconocidos),
    'conservadas_control', v_candidatas - v_insertadas);
end $$;

create or replace function publicar_lote_pdf(
  p_empresa text, p_tipo text, p_periodo text, p_por text, p_boletas jsonb
) returns jsonb language plpgsql security definer set search_path = public, interno, extensions as $$
declare
  b jsonb; v_version int; v_id text; v_avisos int; v_vinculo bigint; v_docs int := 0;
  v_huella text; v_previo record;
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

  -- Idempotencia (2026-09-30): la huella del lote es el SHA-256 de sus pares
  -- dni:hash ordenados. Si ya existe un lote idéntico (misma empresa, tipo y
  -- periodo), se devuelve ese: un «Reintentar» tras una respuesta perdida no
  -- crea la versión N+1 ni marca reemplazadas las boletas de esa gente. Un
  -- PDF distinto cambia la huella y sigue creando versión nueva.
  select encode(extensions.digest(string_agg(x->>'dni' || ':' || (x->>'hash'), '|' order by x->>'dni'), 'sha256'), 'hex')
    into v_huella from jsonb_array_elements(p_boletas) x;
  select l.id, l.version, (select count(*) from documentos d where d.lote_id = l.id) as documentos
    into v_previo
  from lotes l where l.empresa_id = p_empresa and l.tipo = p_tipo and l.periodo = p_periodo and l.huella = v_huella
  order by l.version desc limit 1;
  if v_previo.id is not null then
    return jsonb_build_object('lote_id', v_previo.id, 'documentos', v_previo.documentos,
                              'version', v_previo.version, 'repetido', true);
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

  insert into lotes (id, empresa_id, tipo, periodo, version, publicado_por, avisos, huella)
  values (v_id, p_empresa, p_tipo, p_periodo, v_version, p_por, v_avisos, v_huella);

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

-- Verificación embebida: la columna existe; las funciones son definer con
-- search_path fijo y contienen las marcas del arreglo.
do $v$
declare a text; p text;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'lotes' and column_name = 'huella') then
    raise exception 'arreglos: falta lotes.huella';
  end if;
  select prosrc into a from pg_proc where oid = 'public.importar_asistencia(text, jsonb, text, jsonb, text)'::regprocedure;
  select prosrc into p from pg_proc where oid = 'public.publicar_lote_pdf(text, text, text, text, jsonb)'::regprocedure;
  if a !~ 'origen = ''reloj''' or a !~ 'on conflict \(empresa_id, documento, fecha\) do nothing' then
    raise exception 'arreglos: importar_asistencia no lleva el filtro por origen';
  end if;
  if p !~ 'huella' or p !~ 'repetido' then
    raise exception 'arreglos: publicar_lote_pdf no lleva la huella';
  end if;
  if exists (select 1 from pg_proc where oid in ('public.importar_asistencia(text, jsonb, text, jsonb, text)'::regprocedure, 'public.publicar_lote_pdf(text, text, text, text, jsonb)'::regprocedure)
             and (not prosecdef or not exists (select 1 from unnest(proconfig) c where c like 'search_path=%'))) then
    raise exception 'arreglos: definer o search_path perdidos';
  end if;
end $v$;

commit;
