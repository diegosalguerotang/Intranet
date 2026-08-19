-- RIT por sede + consulta permanente (2026-08-19, pedido de Diego): el RIT
-- vive SIEMPRE disponible para leer en el portal, y puede variar por sede o
-- contrato: la sede declara su RIT (null = el de su empresa, hoy el general)
-- y el personal de esa planilla lo «jala» automáticamente al leerlo — la
-- resolución es dinámica, no una copia por persona.
-- OJO: el catálogo de faltas del disciplinario sigue usando el RIT de la
-- EMPRESA (hoy el general): citar faltas de un RIT nuevo exige cargar su
-- articulado literal primero (como se hizo con el general).
-- Idempotente.

alter table rits add column if not exists archivo_url text;  -- ruta en bucket privado
alter table rits add column if not exists hash_sha256 text;

update rits set
  archivo_url = 'rit/rit-general-2025.pdf',
  hash_sha256 = 'e002251aebf0a5273874e87288913b68426df7c3fef0a0bf837e47f99658287b'
where id = 'general-2025' and archivo_url is null;

alter table sedes add column if not exists rit_id text references rits(id);  -- null = RIT de la empresa

-- Alta/actualización de un reglamento (el PDF lo sube la pantalla al bucket).
create or replace function crear_rit(
  p_nombre text, p_archivo text, p_hash text, p_vigente date default current_date
) returns text language plpgsql security definer as $$
declare v_id text;
begin
  if fn_nivel_modulo('personal') < 3 then
    raise exception 'Administrar reglamentos exige nivel de aprobación en Personal.';
  end if;
  if trim(coalesce(p_nombre, '')) = '' or trim(coalesce(p_archivo, '')) = '' then
    raise exception 'El reglamento necesita nombre y PDF.';
  end if;
  v_id := lower(regexp_replace(trim(p_nombre), '[^a-zA-Z0-9]+', '-', 'g'));
  insert into rits (id, nombre, vigente_desde, archivo_url, hash_sha256)
  values (v_id, trim(p_nombre), p_vigente, trim(p_archivo), p_hash)
  on conflict (id) do update
    set nombre = excluded.nombre, vigente_desde = excluded.vigente_desde,
        archivo_url = excluded.archivo_url, hash_sha256 = excluded.hash_sha256;
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('CREAR_RIT', 'rits', null, jsonb_build_object('id', v_id, 'nombre', trim(p_nombre)));
  return v_id;
end $$;

-- Asignar (o quitar con null) el RIT propio de una sede.
create or replace function asignar_rit_sede(p_sede text, p_rit text)
returns void language plpgsql security definer as $$
begin
  if fn_nivel_modulo('personal') < 3 then
    raise exception 'Asignar reglamentos exige nivel de aprobación en Personal.';
  end if;
  if p_rit is not null and not exists (select 1 from rits where id = p_rit) then
    raise exception 'El reglamento % no existe.', p_rit;
  end if;
  update sedes set rit_id = p_rit where id = p_sede;
  if not found then
    raise exception 'La sede % no existe.', p_sede;
  end if;
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('ASIGNAR_RIT_SEDE', 'sedes', null, jsonb_build_object('sede', p_sede, 'rit', p_rit));
end $$;

-- crear_sede: + p_rit (default null = RIT de la empresa). DROP de la firma vieja.
drop function if exists crear_sede(text, text, text, text, text);
create function crear_sede(
  p_empresa text, p_nombre text, p_cliente text,
  p_direccion text default null, p_por text default 'RRHH', p_rit text default null
) returns jsonb language plpgsql security definer as $$
declare v_id text; v_codigo text;
begin
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

-- v_sedes: + reglamento efectivo (el propio o el de la empresa).
drop view if exists v_sedes;
create view v_sedes as
select s.id, s.empresa_id as empresa, s.nombre, s.cliente, p.nombre as supervisor,
       s.codigo, s.direccion, s.estado,
       s.rit_id, coalesce(s.rit_id, e.rit_id) as rit_efectivo,
       r.nombre as rit_nombre
from sedes s
left join personas p on p.dni = s.supervisor_dni
left join empresas e on e.id = s.empresa_id
left join rits r on r.id = coalesce(s.rit_id, e.rit_id);

create or replace view v_rits as
select r.id, r.nombre, to_char(r.vigente_desde, 'YYYY-MM-DD') as vigente_desde,
       r.archivo_url, (r.archivo_url is not null) as tiene_pdf,
       (select count(*)::int from sedes s where s.rit_id = r.id) as sedes_propias,
       (select count(*)::int from empresas e where e.rit_id = r.id) as empresas
from rits r order by r.nombre;

-- Portal: EL reglamento del trabajador de la sesión (sede → empresa),
-- siempre disponible para leer. Usa el vínculo vigente o el último.
create or replace view v_portal_rit as
select r.nombre, to_char(r.vigente_desde, 'YYYY-MM-DD') as vigente_desde,
       (r.archivo_url is not null) as disponible
from personas pe
left join lateral (select * from vinculos v where v.persona_dni = pe.dni
                   order by (v.fecha_fin is null) desc, v.fecha_inicio desc limit 1) vi on true
left join sedes s on s.id = vi.sede_id
left join empresas e on e.id = vi.empresa_id
left join rits r on r.id = coalesce(s.rit_id, e.rit_id)
where pe.dni = portal_dni() and r.id is not null;

revoke all on rits from anon, authenticated;
grant select on v_rits, v_sedes to authenticated;
grant select on v_portal_rit to authenticated;
