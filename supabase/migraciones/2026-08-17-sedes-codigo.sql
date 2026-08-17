-- Sedes con código propio y alta manual (pedido por Diego 2026-08-17):
-- cada sede lleva un código de secuencia S-0001, S-0002… (mismo estilo que
-- U-0001 en usuarios). La pantalla nueva RRH-21 permite crearlas a mano; la
-- importación de personal, que ya creaba sedes implícitamente, también asigna
-- código a las nuevas. Idempotente.

create sequence if not exists seq_sede_codigo;
alter table sedes add column if not exists codigo text unique;

-- Backfill de las sedes existentes, en orden de creación (solo las que aún no
-- tienen código: re-ejecutar no cambia nada).
do $$
declare s record;
begin
  for s in select id from sedes where codigo is null order by creado_en, id loop
    update sedes set codigo = 'S-' || lpad(nextval('seq_sede_codigo')::text, 4, '0')
    where id = s.id;
  end loop;
end $$;

-- Alta manual de sede: id slug estable (empresa-nombre, igual que la
-- importación) + código de secuencia. El nombre es único por empresa.
create or replace function crear_sede(
  p_empresa text, p_nombre text, p_cliente text,
  p_direccion text default null, p_por text default 'RRHH'
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
  v_id := p_empresa || '-' || lower(regexp_replace(trim(p_nombre), '\s+', '-', 'g'));
  if exists (select 1 from sedes where id = v_id) then
    raise exception 'Ya existe una sede con ese identificador (%).', v_id;
  end if;
  v_codigo := 'S-' || lpad(nextval('seq_sede_codigo')::text, 4, '0');
  insert into sedes (id, empresa_id, nombre, cliente, direccion, codigo)
  values (v_id, p_empresa, trim(p_nombre),
          coalesce(nullif(trim(p_cliente), ''), 'Por asignar'),
          nullif(trim(coalesce(p_direccion, '')), ''), v_codigo);
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('CREAR_SEDE', 'sedes', null, jsonb_build_object(
    'id', v_id, 'codigo', v_codigo, 'empresa', p_empresa,
    'nombre', trim(p_nombre), 'por', p_por));
  return jsonb_build_object('id', v_id, 'codigo', v_codigo);
end $$;

-- La importación de personal también asigna código a las sedes que crea.
create or replace function fn_sede_para_importacion(p_empresa text, p_sede text, p_cliente text)
returns text language plpgsql as $$
declare v_id text;
begin
  -- 1º igual o el nombre guardado empieza por el truncado (16 chars) o viceversa
  select id into v_id from sedes
  where empresa_id = p_empresa
    and (upper(nombre) like upper(trim(p_sede)) || '%' or upper(trim(p_sede)) like upper(nombre) || '%')
  order by length(nombre) desc limit 1;
  if v_id is not null then return v_id; end if;
  v_id := p_empresa || '-' || lower(regexp_replace(trim(p_sede), '\s+', '-', 'g'));
  insert into sedes (id, empresa_id, nombre, cliente, codigo)
  values (v_id, p_empresa, trim(p_sede), coalesce(p_cliente, 'Por asignar'),
          'S-' || lpad(nextval('seq_sede_codigo')::text, 4, '0'))
  on conflict (id) do nothing;
  return v_id;
end $$;

-- v_sedes expone código, dirección y estado (columnas nuevas AL FINAL).
create or replace view v_sedes as
select s.id, s.empresa_id as empresa, s.nombre, s.cliente, p.nombre as supervisor,
       s.codigo, s.direccion, s.estado
from sedes s left join personas p on p.dni = s.supervisor_dni;
