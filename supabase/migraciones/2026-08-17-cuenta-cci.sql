-- Cuenta bancaria y CCI como campos SEPARADOS (pedido de Diego 2026-08-17):
-- el número de cuenta del banco y el código interbancario son datos
-- distintos y ambos se capturan en el alta y en la edición. Idempotente.

alter table personas add column if not exists cci text;

drop function if exists alta_trabajador(text, text, text, text, text, date, text, text, text, text);
create or replace function alta_trabajador(
  p_dni text, p_nombre text, p_cargo text, p_sede text, p_empresa text,
  p_ingreso date, p_celular text default null,
  p_banco text default null, p_cuenta text default null, p_correo text default null,
  p_cci text default null
) returns void language plpgsql security definer as $$
begin
  insert into personas (dni, nombre, celular, banco, cuenta, cci, portal, correo)
  values (p_dni, p_nombre, p_celular, p_banco, p_cuenta, nullif(trim(coalesce(p_cci, '')), ''),
          case when p_celular is null then 'sin_celular' else 'nunca_ingreso' end,
          nullif(lower(trim(coalesce(p_correo, ''))), ''))
  on conflict (dni) do update
    set celular = coalesce(excluded.celular, personas.celular),
        banco   = coalesce(excluded.banco, personas.banco),
        cuenta  = coalesce(excluded.cuenta, personas.cuenta),
        cci     = coalesce(excluded.cci, personas.cci),
        correo  = coalesce(excluded.correo, personas.correo);

  if exists (select 1 from vinculos where persona_dni = p_dni
             and empresa_id = p_empresa and fecha_fin is null) then
    raise exception 'La persona % ya tiene un vínculo vigente con esta empresa.', p_dni;
  end if;

  insert into vinculos (persona_dni, empresa_id, sede_id, cargo, fecha_inicio)
  values (p_dni, p_empresa, p_sede, p_cargo, p_ingreso);
end $$;

drop function if exists editar_trabajador(text, text, text, text, text, text);
create or replace function editar_trabajador(
  p_dni text, p_nombre text, p_celular text, p_correo text, p_banco text, p_cuenta text,
  p_cci text default null
) returns void language plpgsql security definer as $$
declare j_antes jsonb; j_despues jsonb; v_correo text;
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
  v_correo := nullif(lower(trim(coalesce(p_correo, ''))), '');
  if v_correo is not null and v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo no tiene un formato válido.';
  end if;

  select to_jsonb(p) - 'cuenta' - 'cci' into j_antes from personas p where dni = p_dni;
  update personas set
    nombre = trim(p_nombre),
    nombre_por_confirmar = false,
    celular = nullif(trim(coalesce(p_celular, '')), ''),
    banco = nullif(trim(coalesce(p_banco, '')), ''),
    cuenta = nullif(trim(coalesce(p_cuenta, '')), ''),
    cci = nullif(trim(coalesce(p_cci, '')), ''),
    correo_verificado = case when v_correo is distinct from correo then false else correo_verificado end,
    correo = v_correo
  where dni = p_dni;
  select to_jsonb(p) - 'cuenta' - 'cci' into j_despues from personas p where dni = p_dni;

  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('EDITAR_TRABAJADOR', 'personas', j_antes, j_despues);
end $$;

create or replace view v_personal as
select p.dni, p.nombre, v.cargo, v.sede_id as sede, v.empresa_id as empresa,
       to_char(v.fecha_inicio, 'YYYY-MM-DD') as ingreso,
       p.celular, p.portal,
       case when v.fecha_fin is null then 'vigente' else 'cesado' end as estado,
       p.banco, p.cuenta,
       to_char(v.fecha_fin, 'YYYY-MM-DD') as cese,
       v.id as vinculo_id,
       p.correo, p.correo_verificado as "correoVerificado",
       p.cci
from vinculos v join personas p on p.dni = v.persona_dni;
