-- supabase/migraciones/2026-08-15-tres-ajustes.sql
-- Tres ajustes (2026-08-15): razones sociales + soporte de importaciones reales.

alter table empresas  add column if not exists estado text not null default 'activa';
do $$ begin
  alter table empresas add constraint empresas_estado_chk check (estado in ('activa','retirada'));
exception when duplicate_object then null; end $$;
alter table empresas  add column if not exists direccion text;
alter table personas  add column if not exists nombre_por_confirmar boolean not null default false;
alter table vinculos  add column if not exists centro_costo text;
alter table documentos add column if not exists neto numeric;

create table if not exists cargos (nombre text primary key);
insert into cargos (nombre) values
  ('Operario de limpieza'), ('Supervisor de sede'), ('Técnico de mantenimiento'),
  ('Auxiliar de servicios'), ('Analista RRHH'), ('Jefe de RRHH'),
  ('OPERARIO(A) DE LIMPIEZA'), ('SUPERVISOR(A) DE LIMPIEZA')
on conflict do nothing;

-- Datos REALES de Limpieza Americana (las boletas cotejan por este RUC).
update empresas set ruc = '20601705185',
  direccion = 'Av. San Borja Sur Nro. 1184, Urb. San Borja Sur'
where id = 'lamericana';

-- BREMCO sale del grupo: retirada, jamás eliminada (conservación documental).
update empresas set estado = 'retirada' where id = 'bremco';

-- Nada nuevo sobre una empresa retirada (vínculos y lotes; contratos y
-- comunicados nuevos quedan bloqueados por la UI, que filtra activas).
create or replace function fn_solo_empresa_activa() returns trigger
language plpgsql as $$
begin
  if (select estado from empresas where id = new.empresa_id) <> 'activa' then
    raise exception 'La empresa % está retirada del grupo: no admite registros nuevos.', new.empresa_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_vinculo_empresa_activa on vinculos;
create trigger trg_vinculo_empresa_activa before insert on vinculos
  for each row execute function fn_solo_empresa_activa();
drop trigger if exists trg_lote_empresa_activa on lotes;
create trigger trg_lote_empresa_activa before insert on lotes
  for each row execute function fn_solo_empresa_activa();

-- RLS de cargos: misma política permisiva que el resto de tablas (bloque
-- SEGURIDAD de schema.sql), para que no quede desprotegida cuando se aprieten
-- las políticas más adelante.
alter table cargos enable row level security;
drop policy if exists acceso_demo on cargos;
create policy acceso_demo on cargos for all to anon, authenticated using (true) with check (true);

-- El grupo suma la razón social CLEAN. Diego no ha confirmado su régimen
-- tributario: se amplía el check para admitir 'Por confirmar' explícito en
-- vez de inventar un valor real (regimen sigue not null).
alter table empresas drop constraint if exists empresas_regimen_check;
alter table empresas add constraint empresas_regimen_check
  check (regimen in ('Régimen general','Micro empresa','Pequeña empresa','Por confirmar'));

insert into empresas (id, nombre, corto, ruc, logo, regimen, direccion, estado)
values ('clean', 'Consorcio Clean', 'CLEAN', '20614759870', '/logos/clean.png',
        'Por confirmar', 'Jr. Océano Ártico Nro. 226 Dpto. 201 (Frente al Colegio Odontológico del Perú)', 'activa')
on conflict (id) do update set nombre = excluded.nombre, ruc = excluded.ruc,
  logo = excluded.logo, regimen = excluded.regimen, direccion = excluded.direccion,
  estado = excluded.estado;

-- ---------------------------------------------------------------------------
-- IMPORTACIÓN DE PLANILLAS (Task 7): RPCs transaccionales que aplican filas
-- FilaPlanilla (Task 6) sobre personas/vinculos/sedes/cargos.
-- ---------------------------------------------------------------------------

-- ¿nuevo es un prefijo truncado de actual? (jamás degradar un dato más completo)
create or replace function fn_es_prefijo_truncado(p_nuevo text, p_actual text)
returns boolean language sql immutable as $$
  select p_actual is not null and p_nuevo is not null
     and length(trim(p_nuevo)) < length(trim(p_actual))
     and upper(trim(p_actual)) like upper(trim(p_nuevo)) || '%';
$$;

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
  insert into sedes (id, empresa_id, nombre, cliente)
  values (v_id, p_empresa, trim(p_sede), coalesce(p_cliente, 'Por asignar'))
  on conflict (id) do nothing;
  return v_id;
end $$;

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
      -- solo mejora (nunca un prefijo más corto)
      update personas set
        nombre = case when fn_es_prefijo_truncado(v_nombre, nombre) then nombre
                      when length(v_nombre) > length(nombre) then v_nombre else nombre end
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
  return jsonb_build_object('altas', to_jsonb(v_altas), 'actualizaciones', to_jsonb(v_act),
    'sin_cambio', to_jsonb(v_sin), 'nombres_por_confirmar', v_por_confirmar);
end $$;

-- La vista previa clasifica sin escribir: llama a importar_planilla dentro de
-- un bloque con EXCEPTION (Postgres crea un savepoint implícito al entrar a
-- ese bloque) y luego SIEMPRE lanza una excepción para revertirlo — así la
-- clasificación es exactamente la misma lógica que aplica la importación
-- real, sin duplicarla (evita que preview e importación real diverjan con el
-- tiempo). Nota de verificación: se probó por separado que sqlerrm::jsonb
-- reconstruye el jsonb exacto sin truncar ni anteponer prefijo/contexto
-- (confirmado contra Supabase con un jsonb de prueba antes de aplicar esto),
-- así que se mantiene el diseño del brief tal cual.
create or replace function previsualizar_importacion(p_empresa text, p_filas jsonb)
returns jsonb language plpgsql security definer as $$
declare v jsonb;
begin
  v := importar_planilla(p_empresa, p_filas, '(vista previa)');
  raise exception using errcode = 'P0001', message = v::text; -- revertir TODO
exception when sqlstate 'P0001' then
  return sqlerrm::jsonb;
end $$;
