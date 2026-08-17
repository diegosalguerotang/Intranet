-- Motor de correo, fase 1 (pedido de Diego 2026-08-17): las personas pueden
-- declarar un correo (opcional) — el trabajador lo registra en el primer
-- ingreso del portal junto al celular, y el alta manual de personal también lo
-- captura. Sirve para: validación del correo, «olvidé mi clave» por enlace, y
-- envío opcional del acceso al crear la cuenta del portal. Idempotente.

alter table personas add column if not exists correo text;
alter table personas add column if not exists correo_verificado boolean not null default false;

-- Tokens de un solo uso para verificación y recuperación (los emite el
-- endpoint serverless con service key; jamás el navegador).
create table if not exists correo_tokens (
  token     text primary key,
  dni       text not null references personas(dni),
  proposito text not null check (proposito in ('verificacion','recuperacion')),
  correo    text not null,
  creado_en timestamptz not null default now(),
  expira_en timestamptz not null,
  usado_en  timestamptz
);
create index if not exists idx_correo_tokens_dni on correo_tokens (dni);
-- Solo el servidor los toca.
revoke select, insert, update, delete on correo_tokens from anon, authenticated;

-- Primer ingreso del portal: ahora también captura el correo (opcional).
-- Se elimina la firma vieja para que las llamadas no queden ambiguas.
drop function if exists portal_primer_ingreso(text, boolean, integer);
create or replace function portal_primer_ingreso(
  p_celular text, p_sin_celular boolean, p_politica_version integer,
  p_correo text default null
) returns void language plpgsql security definer as $$
declare v_dni text; v_correo text;
begin
  v_dni := portal_dni();
  if v_dni is null then raise exception 'Sesión del portal requerida.'; end if;
  if not p_sin_celular and (p_celular is null or p_celular !~ '^[0-9]{9}$') then
    raise exception 'El celular debe tener 9 dígitos, o marca «No tengo celular».';
  end if;
  v_correo := nullif(lower(trim(coalesce(p_correo, ''))), '');
  if v_correo is not null and v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo no tiene un formato válido.';
  end if;
  if not exists (select 1 from declaraciones where id = 'politica-datos' and version = p_politica_version) then
    raise exception 'Versión de la política de datos desconocida.';
  end if;
  update cuentas_portal
  set primer_ingreso_pendiente = false,
      celular_declarado = case when p_sin_celular then null else p_celular end,
      sin_celular = p_sin_celular,
      politica_version = p_politica_version::text,
      politica_aceptada_en = now()
  where dni = v_dni;
  if not found then raise exception 'La cuenta del portal no existe.'; end if;
  update personas
  set celular = coalesce(case when p_sin_celular then null else p_celular end, celular),
      portal  = case when p_sin_celular then 'sin_celular' else 'activo' end,
      -- El correo declarado por el propio trabajador manda; declarar uno
      -- nuevo lo deja pendiente de verificación.
      correo = coalesce(v_correo, correo),
      correo_verificado = case when v_correo is not null and v_correo is distinct from correo
                               then false else correo_verificado end
  where dni = v_dni;
end $$;

-- Alta manual de personal: correo opcional.
drop function if exists alta_trabajador(text, text, text, text, text, date, text, text, text);
create or replace function alta_trabajador(
  p_dni text, p_nombre text, p_cargo text, p_sede text, p_empresa text,
  p_ingreso date, p_celular text default null,
  p_banco text default null, p_cuenta text default null, p_correo text default null
) returns void language plpgsql security definer as $$
begin
  insert into personas (dni, nombre, celular, banco, cuenta, portal, correo)
  values (p_dni, p_nombre, p_celular, p_banco, p_cuenta,
          case when p_celular is null then 'sin_celular' else 'nunca_ingreso' end,
          nullif(lower(trim(coalesce(p_correo, ''))), ''))
  on conflict (dni) do update
    set celular = coalesce(excluded.celular, personas.celular),
        banco   = coalesce(excluded.banco, personas.banco),
        cuenta  = coalesce(excluded.cuenta, personas.cuenta),
        correo  = coalesce(excluded.correo, personas.correo);

  if exists (select 1 from vinculos where persona_dni = p_dni
             and empresa_id = p_empresa and fecha_fin is null) then
    raise exception 'La persona % ya tiene un vínculo vigente con esta empresa.', p_dni;
  end if;

  insert into vinculos (persona_dni, empresa_id, sede_id, cargo, fecha_inicio)
  values (p_dni, p_empresa, p_sede, p_cargo, p_ingreso);
end $$;

-- El BackOffice refleja el correo declarado (columnas nuevas AL FINAL).
create or replace view v_personal as
select p.dni, p.nombre, v.cargo, v.sede_id as sede, v.empresa_id as empresa,
       to_char(v.fecha_inicio, 'YYYY-MM-DD') as ingreso,
       p.celular, p.portal,
       case when v.fecha_fin is null then 'vigente' else 'cesado' end as estado,
       p.banco, p.cuenta,
       to_char(v.fecha_fin, 'YYYY-MM-DD') as cese,
       v.id as vinculo_id,
       p.correo, p.correo_verificado as "correoVerificado"
from vinculos v join personas p on p.dni = v.persona_dni;
