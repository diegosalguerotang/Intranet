-- Del cargo al perfil (spec Tareas 31-08 §5): la importación SUGIERE, jamás
-- otorga. Este archivo es el canónico de importar_padron (v2: reemplaza al de
-- 2026-08-31-padron-cc.sql) y de la correspondencia cargo→categoría.
--
--  · 13 categorías nuevas según la matriz del spec ([]=Sin acceso). El nivel
--    «Tardanzas» de la matriz se aplica al módulo asistencia (RRH-22), decisión
--    2026-08-31; RRH-20 sigue Próximamente.
--  · cargo_perfiles: correspondencia ADMINISTRADA (aparecerán cargos nuevos),
--    emparejada normalizando y por prefijo (los cargos vienen truncados a 29).
--  · perfil_propuestas: bandeja de revisión. Un superadministrador decide
--    trabajador por trabajador; crear la cuenta sigue siendo ACC-04 (exige
--    correo). Los 79 quedan habilitados en el Portal por estar en el padrón.
--  · La marca de superadministrador jamás se sugiere; un cargo no mapeado
--    queda «sin sugerencia»; un cambio de cargo solo reabre la propuesta.

-- 1 · Las 13 categorías de la matriz (idempotente: solo si el id no existe;
-- alcance = las razones sociales ACTIVAS del grupo).
do $$
declare v_activas text[]; c jsonb;
begin
  select array_agg(id) into v_activas from empresas where estado = 'activa';
  for c in select * from jsonb_array_elements($j$[
    {"id":"supervisor-sede","nombre":"Supervisor de sede",
     "desc":"Registra acuses y solicitudes de su cuadrilla; ve quién no confirmó sin abrir boletas ajenas.",
     "rem":false,"docs":false,"exp":false,"ban":false,
     "matriz":{"acuses":2,"solicitudes":2,"personal":1,"comunicados":1,"asistencia":1}},
    {"id":"rrhh-operativo","nombre":"RRHH operativo",
     "desc":"Operación diaria de Recursos Humanos.",
     "rem":false,"docs":false,"exp":false,"ban":false,
     "matriz":{"personal":2,"boletas":2,"acuses":2,"comunicados":2,"memorandums":2,"contratos":2,"asistencia":2,"solicitudes":2,"activos":1}},
    {"id":"jefatura-rrhh","nombre":"Jefatura de RRHH",
     "desc":"Aprueba en los módulos de RRHH; abre documentos de terceros y exporta datos personales.",
     "rem":true,"docs":true,"exp":true,"ban":false,
     "matriz":{"personal":3,"boletas":3,"comunicados":3,"memorandums":3,"contratos":3,"solicitudes":3,"acuses":2,"asistencia":2,"activos":1,"auditoria":1}},
    {"id":"planilla","nombre":"Planilla",
     "desc":"Carga boletas y tramita cambios de cuenta de haberes: único perfil operativo con remuneración y datos bancarios.",
     "rem":true,"docs":false,"exp":false,"ban":true,
     "matriz":{"boletas":3,"personal":2,"contratos":2,"asistencia":2,"acuses":2}},
    {"id":"administracion-activos","nombre":"Administración y activos",
     "desc":"Gestión operativa de activos y equipos.",
     "rem":false,"docs":false,"exp":false,"ban":false,
     "matriz":{"activos":2,"personal":1,"solicitudes":1,"configuracion":1}},
    {"id":"jefatura-administracion","nombre":"Jefatura de Administración",
     "desc":"Aprueba en activos; decide solicitudes de su ámbito.",
     "rem":false,"docs":false,"exp":false,"ban":false,
     "matriz":{"activos":3,"solicitudes":2,"personal":1,"configuracion":1,"auditoria":1}},
    {"id":"sst-sig","nombre":"SST y SIG",
     "desc":"Seguridad y salud en el trabajo y sistema integrado de gestión.",
     "rem":false,"docs":false,"exp":false,"ban":false,
     "matriz":{"activos":2,"comunicados":2,"personal":1,"acuses":1,"boletas":1}},
    {"id":"sst-sig-jefatura","nombre":"SST y SIG — jefatura",
     "desc":"Jefatura de SST/SIG: aprueba en activos y comunicados.",
     "rem":false,"docs":false,"exp":false,"ban":false,
     "matriz":{"activos":3,"comunicados":3,"personal":1,"acuses":1,"boletas":1}},
    {"id":"legal","nombre":"Legal",
     "desc":"Contratos y memorándums; abre documentos de terceros.",
     "rem":false,"docs":true,"exp":false,"ban":false,
     "matriz":{"contratos":2,"memorandums":2,"personal":1,"boletas":1,"acuses":1}},
    {"id":"operaciones","nombre":"Operaciones",
     "desc":"Coordinación operativa: acuses, comunicados y solicitudes.",
     "rem":false,"docs":false,"exp":false,"ban":false,
     "matriz":{"acuses":2,"comunicados":2,"solicitudes":2,"personal":1,"asistencia":1}},
    {"id":"contabilidad-finanzas","nombre":"Contabilidad y finanzas",
     "desc":"Lectura contable con remuneración y datos bancarios.",
     "rem":true,"docs":false,"exp":false,"ban":true,
     "matriz":{"personal":1,"boletas":1,"asistencia":1,"activos":1}},
    {"id":"sistemas","nombre":"Sistemas",
     "desc":"Configuración del sistema; ve quién tiene qué acceso, no lo cambia. Sin marca de superadministrador.",
     "rem":false,"docs":false,"exp":false,"ban":false,
     "matriz":{"configuracion":2,"accesos":1,"auditoria":1}},
    {"id":"direccion","nombre":"Dirección",
     "desc":"Lectura de todos los módulos operativos con remuneración; lee pero no exporta.",
     "rem":true,"docs":false,"exp":false,"ban":false,
     "matriz":{"personal":1,"boletas":1,"acuses":1,"comunicados":1,"memorandums":1,"contratos":1,"asistencia":1,"tardanzas":1,"activos":1,"soporte":1,"solicitudes":1}}
  ]$j$::jsonb) loop
    if not exists (select 1 from perfiles where id = c->>'id') then
      perform guardar_perfil(c->>'id', c->>'nombre', c->>'desc', false,
        (c->>'rem')::boolean, (c->>'docs')::boolean, (c->>'exp')::boolean,
        c->'matriz', v_activas, 'spec 2026-08-31', (c->>'ban')::boolean);
    end if;
  end loop;
end $$;

-- 2 · Correspondencia cargo → categoría (dato ADMINISTRADO, editable desde
-- configuración). destino: 'perfil' sugiere la categoría, 'portal' = solo
-- Portal (sin BackOffice), 'sin_sugerencia' = queda para decidir a mano.
create table if not exists cargo_perfiles (
  cargo   text primary key,   -- en MAYÚSCULAS y sin relleno (forma del padrón)
  destino text not null default 'perfil' check (destino in ('perfil','portal','sin_sugerencia')),
  perfil_id text,
  actualizado_por text not null default 'spec 2026-08-31',
  actualizado_en  timestamptz not null default now(),
  check (destino <> 'perfil' or perfil_id is not null)
);
grant select on cargo_perfiles to authenticated;

insert into cargo_perfiles (cargo, destino, perfil_id) values
  ('OPERARIO(A) DE LIMPIEZA',       'portal', null),
  ('OPERARIO DE ALMACEN',           'portal', null),
  ('CONSERJE',                      'portal', null),
  ('TECNICO DE MANTENIMIENTO',      'portal', null),
  ('CHOFER',                        'portal', null),
  ('AUXILIAR DE OFICINA',           'portal', null),
  ('TECNICO QUIMICO',               'portal', null),
  ('GERENTE COMERCIAL',             'portal', null),
  ('JEFE DE VENTAS',                'portal', null),
  ('ASISTENTE COMERCIAL',           'portal', null),
  ('SUPERVISOR(A) DE LIMPIEZA',     'perfil', 'supervisor-sede'),
  ('ADMINISTRADOR DE SERVICIOS',    'perfil', 'supervisor-sede'),
  ('ASISTENTE DE RR HH',            'perfil', 'rrhh-operativo'),
  ('ANALISTA DE RR HH',             'perfil', 'rrhh-operativo'),
  ('GERENTE DE RR.HH',              'perfil', 'jefatura-rrhh'),
  ('COORDINADOR DE RRHH/ADMINISTR', 'perfil', 'jefatura-rrhh'),
  ('PLANILLERO',                    'perfil', 'planilla'),
  ('ASISTENTE DE ALMACEN',          'perfil', 'administracion-activos'),
  ('ASISTENTE DE LOGISTICA',        'perfil', 'administracion-activos'),
  ('JEFE DE ALMACEN',               'perfil', 'jefatura-administracion'),
  ('GERENTE DE LOGISTICA',          'perfil', 'jefatura-administracion'),
  ('GERENTE DE ADMINISTRACION',     'perfil', 'jefatura-administracion'),
  ('ASISTENTE DE SST',              'perfil', 'sst-sig'),
  ('JEFE DE SST',                   'perfil', 'sst-sig-jefatura'),
  ('JEFE SIG',                      'perfil', 'sst-sig-jefatura'),
  ('ASISTENTE LEGAL',               'perfil', 'legal'),
  ('ASESORIA LEGAL',                'perfil', 'legal'),
  ('ASISTENTE DE OPERACIONES',      'perfil', 'operaciones'),
  ('ASISTENTE DE CONTROL Y PROGRA', 'perfil', 'operaciones'),
  ('ASIST. DE FINANZAS',            'perfil', 'contabilidad-finanzas'),
  ('JEFE DE CONTABILIDAD',          'perfil', 'contabilidad-finanzas'),
  ('ASIST. DE SISTEMAS',            'perfil', 'sistemas'),
  ('GERENTE GENERAL',               'perfil', 'direccion'),
  ('ASISTENTE',                     'sin_sugerencia', null)  -- cargo genérico: lo decide un humano
on conflict (cargo) do nothing;

-- Emparejado normalizando y por prefijo (spec §5): exacto primero; después
-- el cargo del archivo puede ser la forma LARGA de uno guardado truncado; el
-- prefijo inverso solo aplica si el del archivo viene cortado al borde (29+),
-- para que «ASISTENTE» a secas jamás herede el perfil de sus derivados.
create or replace function fn_perfil_para_cargo(p_cargo text)
returns cargo_perfiles language sql stable
set search_path = public, extensions as $$
  select cp.* from cargo_perfiles cp
  where cp.cargo = upper(trim(p_cargo))
     or upper(trim(p_cargo)) like cp.cargo || '%'
     or (length(trim(p_cargo)) >= 29 and cp.cargo like upper(trim(p_cargo)) || '%')
  order by (cp.cargo = upper(trim(p_cargo))) desc, length(cp.cargo) desc
  limit 1
$$;

-- Administración de la correspondencia (Configuración; nivel de acción).
create or replace function guardar_cargo_perfil(p_cargo text, p_destino text, p_perfil text, p_por text)
returns void language plpgsql security definer
set search_path = public, extensions as $$
begin
  if fn_nivel_modulo('configuracion') < 2 and fn_nivel_modulo('accesos') < 2 then
    raise exception 'Tu categoría no permite editar la correspondencia de cargos.';
  end if;
  if p_destino = 'perfil' and not exists (
    select 1 from perfiles where id = p_perfil and not es_superadmin) then
    raise exception 'La categoría «%» no existe (la de superadministrador jamás se sugiere).', p_perfil;
  end if;
  insert into cargo_perfiles (cargo, destino, perfil_id, actualizado_por, actualizado_en)
  values (upper(trim(p_cargo)), p_destino,
          case when p_destino = 'perfil' then p_perfil end, p_por, now())
  on conflict (cargo) do update
    set destino = excluded.destino, perfil_id = excluded.perfil_id,
        actualizado_por = excluded.actualizado_por, actualizado_en = now();
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('GUARDAR_CARGO_PERFIL', 'cargo_perfiles', null,
    jsonb_build_object('cargo', upper(trim(p_cargo)), 'destino', p_destino,
                       'perfil', p_perfil, 'por', p_por));
end $$;

create or replace view v_cargo_perfiles as
select cp.cargo, cp.destino, cp.perfil_id as "perfilId",
       (select nombre from perfiles pf where pf.id = cp.perfil_id
        order by version desc limit 1) as "perfilNombre",
       (select count(*) from vinculos v
        where v.fecha_fin is null and upper(trim(v.cargo)) = cp.cargo)::int as vigentes,
       cp.actualizado_por as "actualizadoPor",
       to_char(cp.actualizado_en, 'YYYY-MM-DD') as actualizado
from cargo_perfiles cp
order by cp.cargo;
grant select on v_cargo_perfiles to authenticated;

-- 3 · Bandeja de propuestas: una por persona y razón social; reimportar no
-- duplica (se actualiza; un cambio de cargo la REABRE, jamás cambia un
-- acceso ya dado). perfil_id null = sin sugerencia.
create table if not exists perfil_propuestas (
  id          bigint generated always as identity primary key,
  persona_dni text not null references personas(dni),
  empresa_id  text not null references empresas(id),
  cargo       text not null,
  perfil_id   text,
  estado      text not null default 'pendiente'
    check (estado in ('pendiente','aprobada','descartada')),
  decidido_por text,
  decidido_en  timestamptz,
  creado_en    timestamptz not null default now(),
  unique (persona_dni, empresa_id)
);
revoke all on perfil_propuestas from anon, authenticated;

create or replace view v_perfil_propuestas as
select pp.id, pp.persona_dni as documento, pe.nombre,
       pp.empresa_id as empresa, em.nombre as "empresaNombre",
       pp.cargo, pp.perfil_id as "perfilId",
       (select nombre from perfiles pf where pf.id = pp.perfil_id
        order by version desc limit 1) as "perfilNombre",
       pp.estado, pe.correo,
       exists (select 1 from usuarios_admin u where u.persona_dni = pp.persona_dni) as "tieneUsuario",
       pp.decidido_por as "decididoPor",
       to_char(pp.creado_en, 'YYYY-MM-DD') as creado
from perfil_propuestas pp
join personas pe on pe.dni = pp.persona_dni
join empresas em on em.id = pp.empresa_id
order by (pp.estado = 'pendiente') desc, pe.nombre;
grant select on v_perfil_propuestas to authenticated;

-- Decisión de la bandeja: SOLO superadministrador (aprobar no crea la
-- cuenta: eso sigue siendo ACC-04, que exige correo).
create or replace function decidir_propuesta_perfil(p_id bigint, p_decision text, p_por text)
returns void language plpgsql security definer
set search_path = public, extensions as $$
begin
  if fn_nivel_modulo('accesos') < 99 then
    raise exception 'Solo un superadministrador decide las propuestas de perfil.';
  end if;
  if p_decision not in ('aprobada','descartada','pendiente') then
    raise exception 'Decisión no reconocida.';
  end if;
  update perfil_propuestas
     set estado = p_decision,
         decidido_por = case when p_decision = 'pendiente' then null else p_por end,
         decidido_en  = case when p_decision = 'pendiente' then null else now() end
   where id = p_id;
  if not found then raise exception 'La propuesta no existe.'; end if;
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('DECIDIR_PROPUESTA_PERFIL', 'perfil_propuestas', null,
    jsonb_build_object('id', p_id, 'decision', p_decision, 'por', p_por));
end $$;

-- 4 · importar_padron v2: además de personas/vínculos/movimientos, siembra
-- las propuestas de perfil y las resume por empresa. CANÓNICO desde aquí.
drop function if exists importar_padron(jsonb, text, jsonb);
create function importar_padron(p_filas jsonb, p_por text, p_ceses jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_correo text; v_super boolean; v_alcance jsonb;
  f jsonb; r record;
  v_emp text;
  v_map jsonb := '{}'::jsonb;    -- ruc → empresa_id
  v_res jsonb := '{}'::jsonb;    -- empresa_id → resumen
  v_problemas jsonb := '[]'::jsonb;
  v_desconocidos text[];
  v_doc text; v_clave text; v_canon text; v_matches text[];
  v_nombre text; v_vinculo bigint; v_sede text; v_fecha date;
  v_cambio boolean; v_cargo_antes text;
  agregar_a text;
  v_vinculo_otro bigint; v_emp_origen text; v_vinculo_nuevo bigint;
  v_es_retorno boolean; v_posibles jsonb := '[]'::jsonb;
  v_cese_doc text;
  v_cp cargo_perfiles;
begin
  if fn_nivel_modulo('personal') < 2 then
    raise exception 'Tu categoría no permite importar el padrón (requiere nivel de acción en Personal).';
  end if;

  -- Alcance del llamador (sin JWT = llamada de servicio: todo permitido).
  begin
    v_correo := nullif(auth.jwt() ->> 'email', '');
  exception when others then
    v_correo := null;
  end;
  if v_correo is not null then
    select "esSuperadmin", empresas into v_super, v_alcance
    from v_mi_acceso where lower(correo) = lower(v_correo);
    if not found then raise exception 'Tu sesión no tiene acceso al BackOffice.'; end if;
  else
    v_super := true;
  end if;

  -- Todo o nada a nivel ARCHIVO: cada RUC debe existir, estar activo y estar
  -- dentro del alcance ANTES de tocar una sola fila.
  for r in select distinct f2->>'ruc' as ruc, f2->>'razonSocial' as den
           from jsonb_array_elements(p_filas) f2 loop
    select id into v_emp from empresas where ruc = r.ruc;
    if v_emp is null then
      raise exception 'La razón social «%» (RUC %) no está en el catálogo: importación rechazada completa, ninguna fila se aplica.', r.den, r.ruc;
    end if;
    if (select estado from empresas where id = v_emp) <> 'activa' then
      raise exception 'La razón social «%» está retirada del grupo: importación rechazada completa.', r.den;
    end if;
    if not coalesce(v_super, false) and not (coalesce(v_alcance, '[]'::jsonb) ? v_emp) then
      raise exception 'La razón social «%» está fuera de tu alcance: importación rechazada completa.', r.den;
    end if;
    v_map := v_map || jsonb_build_object(r.ruc, v_emp);
    v_res := v_res || jsonb_build_object(v_emp, jsonb_build_object(
      'ruc', r.ruc, 'nombre', (select nombre from empresas where id = v_emp),
      'altas', '[]'::jsonb, 'vinculosNuevos', '[]'::jsonb, 'actualizaciones', '[]'::jsonb,
      'sinCambio', '[]'::jsonb, 'cargosCambiaron', '[]'::jsonb,
      'traslados', '[]'::jsonb, 'retornos', '[]'::jsonb, 'cesados', '[]'::jsonb,
      'propuestas', '[]'::jsonb, 'soloPortal', '[]'::jsonb, 'sinSugerencia', '[]'::jsonb));
  end loop;

  -- Centro de costo contra el catálogo CERRADO: uno desconocido = archivo
  -- rechazado completo (un valor nuevo se decide en configuración).
  select array_agg(distinct f2->>'centroCosto') into v_desconocidos
  from jsonb_array_elements(p_filas) f2
  where not exists (select 1 from centros_costo c
                    where c.codigo = f2->>'centroCosto' and c.activo);
  if v_desconocidos is not null then
    raise exception 'Centro de costo fuera del catálogo: %. Agrégalo en configuración antes de importar.', array_to_string(v_desconocidos, ', ');
  end if;

  for f in select * from jsonb_array_elements(p_filas) loop
    v_emp := v_map ->> (f->>'ruc');
    v_doc := upper(trim(f->>'documento'));
    v_clave := regexp_replace(v_doc, '^0+(?=.)', '');
    v_nombre := trim(f->>'nombre');
    v_fecha := (f->>'fechaIngreso')::date;
    v_vinculo_otro := null; v_emp_origen := null; v_vinculo_nuevo := null; v_es_retorno := false;

    -- Resolución contra el maestro quitando ceros en ambos lados.
    select array_agg(dni) into v_matches from personas
    where regexp_replace(upper(dni), '^0+(?=.)', '') = v_clave;

    if coalesce(cardinality(v_matches), 0) > 1 then
      v_problemas := v_problemas || jsonb_build_object('documento', v_doc, 'nombre', v_nombre,
        'motivo', 'Coincide con más de una persona del maestro (' || array_to_string(v_matches, ', ') || '): resuélvelo a mano.');
      continue;
    end if;

    if v_matches is null then
      -- Alta: la forma del archivo pasa a ser la canónica. El nombre viene
      -- truncado a 30: si llega justo en el borde, queda por confirmar.
      insert into personas (dni, tipo_documento, nombre, sexo, portal, nombre_por_confirmar)
      values (v_doc, coalesce(nullif(f->>'tipoDocumento', ''), 'DNI'), v_nombre,
              nullif(f->>'sexo', ''), 'sin_celular', length(v_nombre) >= 30);
      v_canon := v_doc;
      v_res := jsonb_set(v_res, array[v_emp, 'altas'],
        (v_res #> array[v_emp, 'altas']) || to_jsonb(v_doc));
    else
      v_canon := v_matches[1];
      -- Nunca acortar un nombre con su prefijo; adoptar el más largo. Como el
      -- archivo trunca a 30, adoptar un nombre de 30 no confirma nada.
      update personas set
        nombre = case when fn_es_prefijo_truncado(v_nombre, nombre) then nombre
                      when length(v_nombre) > length(nombre) then v_nombre else nombre end,
        nombre_por_confirmar = case
          when length(v_nombre) > length(nombre) and length(v_nombre) < 30 then false
          else nombre_por_confirmar end,
        sexo = coalesce(nullif(f->>'sexo', ''), sexo)
      where dni = v_canon;

      -- ¿Traslado? Vínculo vigente en OTRA empresa cuyo documento no viene
      -- también bajo esa empresa en el archivo (doble RS legítima se respeta).
      select v.id, v.empresa_id into v_vinculo_otro, v_emp_origen from vinculos v
      where v.persona_dni = v_canon and v.fecha_fin is null and v.empresa_id <> v_emp
        and not exists (
          select 1 from jsonb_array_elements(p_filas) f3
          where regexp_replace(upper(trim(f3->>'documento')), '^0+(?=.)', '') = regexp_replace(upper(v_canon), '^0+(?=.)', '')
            and (v_map ->> (f3->>'ruc')) = v.empresa_id)
      limit 1;
      -- ¿Retorno? Tiene historia pero ningún vínculo vigente.
      select (not exists (select 1 from vinculos where persona_dni = v_canon and fecha_fin is null))
         and exists (select 1 from vinculos where persona_dni = v_canon)
        into v_es_retorno;
    end if;

    insert into cargos (nombre) values (nullif(trim(f->>'cargo'), ''))
    on conflict do nothing;

    select id into v_vinculo from vinculos
    where persona_dni = v_canon and empresa_id = v_emp and fecha_fin is null;
    if v_vinculo is null then
      -- El archivo no trae sede: los vínculos nuevos nacen en «Por asignar».
      v_sede := fn_sede_para_importacion(v_emp, 'Por asignar', null);
      insert into vinculos (persona_dni, empresa_id, sede_id, cargo, centro_costo,
                            area_heredada, fecha_inicio)
      values (v_canon, v_emp, v_sede, trim(f->>'cargo'), f->>'centroCosto',
              nullif(trim(f->>'areaHeredada'), ''), v_fecha)
      returning id into v_vinculo_nuevo;
      if v_vinculo_otro is not null then
        -- TRASLADO: cerrar el vínculo anterior (decisión de Diego 2026-08-24).
        update vinculos set fecha_fin = greatest(fecha_inicio, v_fecha - 1) where id = v_vinculo_otro;
        insert into movimientos (persona_dni, tipo, empresa_origen, empresa_destino,
          vinculo_cerrado, vinculo_abierto, fecha_efecto, detalle, creado_por)
        values (v_canon, 'traslado', v_emp_origen, v_emp, v_vinculo_otro, v_vinculo_nuevo,
          greatest((select fecha_inicio from vinculos where id = v_vinculo_otro), v_fecha - 1),
          'Importación de padrón', p_por);
        v_res := jsonb_set(v_res, array[v_emp, 'traslados'], (v_res #> array[v_emp, 'traslados'])
          || jsonb_build_object('documento', v_canon, 'nombre', v_nombre,
               'desde', (select nombre from empresas where id = v_emp_origen)));
      elsif v_es_retorno then
        insert into movimientos (persona_dni, tipo, empresa_destino, vinculo_abierto,
          fecha_efecto, detalle, creado_por)
        values (v_canon, 'retorno', v_emp, v_vinculo_nuevo, v_fecha,
          'Importación de padrón', p_por);
        v_res := jsonb_set(v_res, array[v_emp, 'retornos'],
          (v_res #> array[v_emp, 'retornos']) || to_jsonb(v_canon));
      elsif v_matches is not null then
        v_res := jsonb_set(v_res, array[v_emp, 'vinculosNuevos'],
          (v_res #> array[v_emp, 'vinculosNuevos']) || to_jsonb(v_canon));
      else
        insert into movimientos (persona_dni, tipo, empresa_destino, vinculo_abierto,
          fecha_efecto, detalle, creado_por)
        values (v_canon, 'alta', v_emp, v_vinculo_nuevo, v_fecha,
          'Importación de padrón', p_por);
      end if;
    else
      -- Vínculo existente: cargo, centro de costo, área y fecha de ingreso
      -- se alinean al padrón; sede y todo lo que el archivo NO trae, intacto.
      select cargo into v_cargo_antes from vinculos where id = v_vinculo;
      select (centro_costo is distinct from f->>'centroCosto'
           or cargo is distinct from trim(f->>'cargo')
           or area_heredada is distinct from nullif(trim(f->>'areaHeredada'), '')
           or fecha_inicio is distinct from v_fecha)
        into v_cambio from vinculos where id = v_vinculo;
      if v_cambio then
        update vinculos set centro_costo = f->>'centroCosto', cargo = trim(f->>'cargo'),
          area_heredada = nullif(trim(f->>'areaHeredada'), ''), fecha_inicio = v_fecha
        where id = v_vinculo;
        if v_cargo_antes is distinct from trim(f->>'cargo') then
          -- Un cambio de cargo no cambia el perfil: genera aviso (spec §5).
          v_res := jsonb_set(v_res, array[v_emp, 'cargosCambiaron'],
            (v_res #> array[v_emp, 'cargosCambiaron']) || jsonb_build_object(
              'documento', v_canon, 'nombre', v_nombre,
              'antes', v_cargo_antes, 'ahora', trim(f->>'cargo')));
        end if;
      end if;
      agregar_a := case when v_cambio then 'actualizaciones' else 'sinCambio' end;
      v_res := jsonb_set(v_res, array[v_emp, agregar_a],
        (v_res #> array[v_emp, agregar_a]) || to_jsonb(v_canon));
    end if;

    -- Propuesta de perfil por cargo (spec §5): la importación SUGIERE; el
    -- acceso lo otorga un superadministrador desde la bandeja + ACC-04.
    v_cp := fn_perfil_para_cargo(f->>'cargo');
    if v_cp.destino = 'portal' then
      v_res := jsonb_set(v_res, array[v_emp, 'soloPortal'],
        (v_res #> array[v_emp, 'soloPortal']) || to_jsonb(v_canon));
    else
      insert into perfil_propuestas (persona_dni, empresa_id, cargo, perfil_id)
      values (v_canon, v_emp, trim(f->>'cargo'),
              case when v_cp.destino = 'perfil' then v_cp.perfil_id end)
      on conflict (persona_dni, empresa_id) do update
        set perfil_id = excluded.perfil_id,
            -- Un cambio de cargo REABRE la propuesta (aviso); si no cambió,
            -- la decisión tomada se respeta.
            estado = case when perfil_propuestas.cargo is distinct from excluded.cargo
                          then 'pendiente' else perfil_propuestas.estado end,
            cargo = excluded.cargo;
      if v_cp.destino = 'perfil' then
        v_res := jsonb_set(v_res, array[v_emp, 'propuestas'],
          (v_res #> array[v_emp, 'propuestas']) || jsonb_build_object(
            'documento', v_canon, 'nombre', v_nombre, 'perfil', v_cp.perfil_id));
      else
        v_res := jsonb_set(v_res, array[v_emp, 'sinSugerencia'],
          (v_res #> array[v_emp, 'sinSugerencia']) || jsonb_build_object(
            'documento', v_canon, 'nombre', v_nombre, 'cargo', trim(f->>'cargo')));
      end if;
    end if;
  end loop;

  -- POSIBLES CESES: vigentes de las empresas del archivo cuyo documento no
  -- aparece en NINGUNA fila. Solo se proponen; jamás cesar por ausencia.
  select coalesce(jsonb_agg(jsonb_build_object('documento', x.dni, 'nombre', x.nombre,
           'empresa', x.empresa_id, 'empresaNombre', x.emp_nombre) order by x.emp_nombre, x.nombre), '[]'::jsonb)
    into v_posibles
  from (
    select p.dni, p.nombre, v.empresa_id, e.nombre as emp_nombre
    from vinculos v
    join personas p on p.dni = v.persona_dni
    join empresas e on e.id = v.empresa_id
    where v.fecha_fin is null
      and v.empresa_id in (select value from jsonb_each_text(v_map))
      and regexp_replace(upper(p.dni), '^0+(?=.)', '') not in (
        select regexp_replace(upper(trim(f2->>'documento')), '^0+(?=.)', '')
        from jsonb_array_elements(p_filas) f2)
  ) x;

  -- CESES CONFIRMADOS por el usuario en la vista previa.
  for v_cese_doc in select jsonb_array_elements_text(p_ceses) loop
    v_vinculo := null;
    select v.id, v.persona_dni, v.empresa_id into v_vinculo, v_canon, v_emp_origen
    from vinculos v join personas p on p.dni = v.persona_dni
    where v.fecha_fin is null
      and regexp_replace(upper(p.dni), '^0+(?=.)', '') = regexp_replace(upper(trim(v_cese_doc)), '^0+(?=.)', '')
    limit 1;
    if v_vinculo is null then
      v_problemas := v_problemas || jsonb_build_object('documento', v_cese_doc, 'nombre', '',
        'motivo', 'Cese confirmado pero sin vínculo vigente: revísalo.');
      continue;
    end if;
    update vinculos set fecha_fin = greatest(fecha_inicio, current_date) where id = v_vinculo;
    insert into movimientos (persona_dni, tipo, empresa_origen, vinculo_cerrado,
      fecha_efecto, detalle, creado_por)
    values (v_canon, 'cese', v_emp_origen, v_vinculo,
      greatest((select fecha_inicio from vinculos where id = v_vinculo), current_date),
      'Cese confirmado en importación de padrón', p_por);
    if v_res ? v_emp_origen then
      v_res := jsonb_set(v_res, array[v_emp_origen, 'cesados'],
        coalesce(v_res #> array[v_emp_origen, 'cesados'], '[]'::jsonb) || to_jsonb(v_canon));
    end if;
  end loop;

  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('IMPORTAR_PADRON', 'importar_padron', null,
    jsonb_build_object('por', p_por, 'empresas', v_res,
      'problemas', v_problemas, 'ceses', p_ceses));

  return jsonb_build_object('empresas', v_res,
    'problemas', v_problemas, 'posiblesCeses', v_posibles);
end $$;
