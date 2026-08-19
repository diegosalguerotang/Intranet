-- Tipo de documento (2026-08-19, pedido de Diego): trabajadores con carné de
-- extranjería o pasaporte además de DNI. `personas.dni` SIGUE siendo la clave
-- (el «número de documento»); se agrega el tipo y se relaja el formato:
-- DNI = 8 dígitos; CE = 9-12 alfanumérico; Pasaporte = 6-15 alfanumérico.
-- Los números se guardan en MAYÚSCULAS. El portal autentica con
-- lower(numero)@portal.grupoer.pe y portal_dni() pasa a resolver la persona
-- CANÓNICA por lower(dni), así todo el scoping existente sigue igual.
-- También: el tipo de goce de vacaciones corrige sus dos opciones al formato
-- real GR-F-012 («Efectivas / Gozadas» y «Pagadas / Trabajadas»).
-- Idempotente.

alter table personas add column if not exists tipo_documento text not null default 'DNI'
  check (tipo_documento in ('DNI','CE','Pasaporte'));

-- El check inline de 8 dígitos nació sin nombre: personas_dni_check.
alter table personas drop constraint if exists personas_dni_check;
alter table personas drop constraint if exists personas_dni_formato;
alter table personas add constraint personas_dni_formato check (dni ~ '^[0-9A-Z-]{4,20}$');

-- Validación central por tipo (alta y edición la usan; la importación de
-- planilla sigue trayendo solo DNIs y no pasa por aquí).
create or replace function fn_validar_documento(p_tipo text, p_numero text)
returns text language plpgsql as $$
declare v text;
begin
  v := upper(trim(coalesce(p_numero, '')));
  if p_tipo = 'DNI' then
    if v !~ '^[0-9]{8}$' then raise exception 'El DNI tiene 8 dígitos.'; end if;
  elsif p_tipo = 'CE' then
    if v !~ '^[0-9A-Z]{9,12}$' then raise exception 'El carné de extranjería tiene de 9 a 12 caracteres (letras o números).'; end if;
  elsif p_tipo = 'Pasaporte' then
    if v !~ '^[0-9A-Z]{6,15}$' then raise exception 'El pasaporte tiene de 6 a 15 caracteres (letras o números).'; end if;
  else
    raise exception 'Tipo de documento inválido: DNI, CE o Pasaporte.';
  end if;
  return v;
end $$;

-- alta_trabajador: + p_tipo_documento (default DNI: compatible con llamadas viejas).
drop function if exists alta_trabajador(text,text,text,text,text,date,text,text,text,text,text);
create function alta_trabajador(
  p_dni text, p_nombre text, p_cargo text, p_sede text, p_empresa text,
  p_ingreso date, p_celular text default null,
  p_banco text default null, p_cuenta text default null, p_correo text default null,
  p_cci text default null, p_tipo_documento text default 'DNI'
) returns void language plpgsql security definer as $$
declare v_num text;
begin
  v_num := fn_validar_documento(p_tipo_documento, p_dni);
  insert into personas (dni, tipo_documento, nombre, celular, banco, cuenta, cci, portal, correo)
  values (v_num, p_tipo_documento, p_nombre, p_celular, p_banco, p_cuenta, nullif(trim(coalesce(p_cci, '')), ''),
          case when p_celular is null then 'sin_celular' else 'nunca_ingreso' end,
          nullif(lower(trim(coalesce(p_correo, ''))), ''))
  on conflict (dni) do update
    set tipo_documento = excluded.tipo_documento,
        celular = coalesce(excluded.celular, personas.celular),
        banco   = coalesce(excluded.banco, personas.banco),
        cuenta  = coalesce(excluded.cuenta, personas.cuenta),
        cci     = coalesce(excluded.cci, personas.cci),
        correo  = coalesce(excluded.correo, personas.correo);

  if exists (select 1 from vinculos where persona_dni = v_num
             and empresa_id = p_empresa and fecha_fin is null) then
    raise exception 'La persona % ya tiene un vínculo vigente con esta empresa.', v_num;
  end if;

  insert into vinculos (persona_dni, empresa_id, sede_id, cargo, fecha_inicio)
  values (v_num, p_empresa, p_sede, p_cargo, p_ingreso);
end $$;

-- editar_trabajador: + p_tipo_documento (null = no cambiar; el NÚMERO no se
-- edita aquí: es la identidad, como el código de un activo).
drop function if exists editar_trabajador(text,text,text,text,text,text,text);
create function editar_trabajador(
  p_dni text, p_nombre text, p_celular text, p_correo text, p_banco text, p_cuenta text,
  p_cci text default null, p_tipo_documento text default null
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
  if p_tipo_documento is not null then
    -- El número existente debe ser válido para el tipo nuevo.
    perform fn_validar_documento(p_tipo_documento, p_dni);
  end if;
  v_correo := nullif(lower(trim(coalesce(p_correo, ''))), '');
  if v_correo is not null and v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo no tiene un formato válido.';
  end if;

  select to_jsonb(p) - 'cuenta' - 'cci' into j_antes from personas p where dni = p_dni;
  update personas set
    nombre = trim(p_nombre),
    nombre_por_confirmar = false,
    tipo_documento = coalesce(p_tipo_documento, tipo_documento),
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

-- v_personal expone el tipo de documento.
drop view if exists v_personal;
create view v_personal as
select p.dni, p.tipo_documento, p.nombre, v.cargo, v.sede_id as sede, v.empresa_id as empresa,
       to_char(v.fecha_inicio, 'YYYY-MM-DD') as ingreso,
       p.celular, p.portal,
       case when v.fecha_fin is null then 'vigente' else 'cesado' end as estado,
       p.banco, p.cuenta,
       to_char(v.fecha_fin, 'YYYY-MM-DD') as cese,
       v.id as vinculo_id,
       p.correo, p.correo_verificado as "correoVerificado",
       p.cci
from vinculos v join personas p on p.dni = v.persona_dni;
grant select on v_personal to authenticated;

-- portal_dni() canónico: resuelve la persona por lower(dni), así los números
-- alfanuméricos (CE/pasaporte) funcionan aunque el correo técnico sea
-- minúsculas. Devuelve el dni TAL COMO está en personas.
create or replace function portal_dni() returns text language sql stable as $$
  select p.dni from personas p
  where coalesce(auth.jwt()->>'email','') like '%@portal.grupoer.pe'
    and lower(p.dni) = split_part(auth.jwt()->>'email','@',1)
  limit 1
$$;

-- Tipo de goce de vacaciones: las DOS opciones del formato GR-F-012 real.
create or replace function fn_solicitud_validar(p_tipo text, p_datos jsonb) returns void
language plpgsql as $$
begin
  if p_tipo = 'papeleta-permiso' then
    if coalesce(p_datos->>'salida','') = '' or coalesce(p_datos->>'retorno','') = '' then
      raise exception 'La papeleta necesita fecha y hora de salida y de retorno.';
    end if;
    if (p_datos->>'retorno')::timestamptz <= (p_datos->>'salida')::timestamptz then
      raise exception 'El retorno no puede ser anterior (ni igual) a la salida.';
    end if;
    if coalesce(p_datos->>'motivo','') not in ('Salud','Particular','Comisión','Otros') then
      raise exception 'Motivo inválido: Salud, Particular, Comisión u Otros.';
    end if;
    if p_datos->>'motivo' = 'Otros' and coalesce(trim(p_datos->>'especificacion'),'') = '' then
      raise exception 'Con motivo «Otros» la especificación es obligatoria.';
    end if;
    if coalesce(trim(p_datos->>'fundamentacion'),'') = '' then
      raise exception 'La fundamentación es obligatoria.';
    end if;
  elsif p_tipo = 'vacaciones' then
    if coalesce(p_datos->>'desde','') = '' or coalesce(p_datos->>'hasta','') = '' then
      raise exception 'La solicitud necesita las fechas desde y hasta.';
    end if;
    if (p_datos->>'hasta')::date < (p_datos->>'desde')::date then
      raise exception 'La fecha «hasta» no puede ser anterior a «desde».';
    end if;
    if coalesce((p_datos->>'dias_gozados')::numeric, 0) <= 0 then
      raise exception 'Los días gozados deben ser mayores a cero.';
    end if;
    if coalesce(p_datos->>'tipo_goce','') not in ('Efectivas / Gozadas','Pagadas / Trabajadas') then
      raise exception 'Tipo inválido: «Efectivas / Gozadas» o «Pagadas / Trabajadas».';
    end if;
  end if;
end $$;

-- v_solicitudes: + tipo de documento del solicitante (para el PDF y la bandeja).
drop view if exists v_solicitudes;
create view v_solicitudes as
select s.id, s.numero, s.tipo_id, t.nombre as tipo, t.codigo_formato,
       s.solicitante_dni, pe.tipo_documento as solicitante_tipo_documento,
       s.solicitante_nombre, s.cargo,
       s.sede_id, s.sede_nombre, s.empresa_id as empresa,
       to_char(s.fecha_ingreso, 'YYYY-MM-DD') as fecha_ingreso,
       s.supervisor_dni, s.supervisor_nombre,
       s.datos, s.cadena, s.paso_actual, s.estado,
       case when s.estado = 'enviada' then s.cadena -> (s.paso_actual - 1) ->> 'titulo' end as paso_titulo,
       s.documento_id,
       to_char(s.creado_en, 'YYYY-MM-DD HH24:MI') as creado, s.creado_en, s.creado_por,
       to_char(s.resuelto_en, 'YYYY-MM-DD HH24:MI') as resuelto, s.resuelto_en,
       (s.tipo_id = 'papeleta-permiso' and exists (
          select 1 from solicitudes o
          where o.id <> s.id and o.tipo_id = 'papeleta-permiso'
            and o.solicitante_dni = s.solicitante_dni and o.estado = 'aprobada'
            and (o.datos->>'salida')::date = (s.datos->>'salida')::date))
        or (s.tipo_id = 'vacaciones' and exists (
          select 1 from solicitudes o
          where o.id <> s.id and o.tipo_id = 'vacaciones'
            and o.solicitante_dni = s.solicitante_dni and o.estado = 'aprobada'
            and (o.datos->>'desde')::date <= (s.datos->>'hasta')::date
            and (o.datos->>'hasta')::date >= (s.datos->>'desde')::date))
       as se_superpone
from solicitudes s
join solicitud_tipos t on t.id = s.tipo_id
join personas pe on pe.dni = s.solicitante_dni
order by s.creado_en desc;
grant select on v_solicitudes to authenticated;
