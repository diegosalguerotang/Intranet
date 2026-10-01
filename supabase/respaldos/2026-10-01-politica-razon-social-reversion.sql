-- supabase/respaldos/2026-10-01-politica-razon-social-reversion.sql — deshace la migración del mismo nombre.
-- Restaura la vista y portal_primer_ingreso (commit 24b646b), quita la función y la versión 3.
-- Se NIEGA si ya hay consentimientos de la versión 3: esos registros son inmutables y
-- apuntan a ese texto; en ese caso lo correcto es publicar una versión 4.
begin;
set local search_path = public, interno, extensions;

do $r$
begin
  if exists (select 1 from consentimientos where declaracion_id = 'politica-datos' and version = 3) then
    raise exception 'politica: ya hay consentimientos de la versión 3; no se revierte (publica una versión 4)';
  end if;
end $r$;

create or replace function portal_primer_ingreso(
  p_celular text, p_sin_celular boolean, p_politica_version integer,
  p_correo text default null
) returns void language plpgsql security definer
set search_path = public, interno, extensions as $$
declare v_dni text; v_correo text; v_texto text;
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
  select texto into v_texto from declaraciones
  where id = 'politica-datos' and version = p_politica_version;
  if v_texto is null then
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
  -- Registro probatorio del consentimiento (D.Leg. 1310): texto íntegro,
  -- huella, hora de servidor, IP y user-agent reales.
  insert into consentimientos (dni, declaracion_id, version, superficie, texto,
                               hash_sha256, ip, agente, origen)
  values (v_dni, 'politica-datos', p_politica_version, 'portal', v_texto,
          encode(extensions.digest(v_texto, 'sha256'), 'hex'),
          fn_cabecera('x-ip-real'), fn_cabecera('x-agente'), 'primer_ingreso');
  update personas
  set celular = coalesce(case when p_sin_celular then null else p_celular end, celular),
      portal  = case when p_sin_celular then 'sin_celular' else 'activo' end,
      correo = coalesce(v_correo, correo),
      correo_verificado = case when v_correo is not null and v_correo is distinct from correo
                               then false else correo_verificado end
  where dni = v_dni;
end $$;

create or replace view public.v_declaraciones_vigentes with (security_invoker = on) as
select distinct on (id) id, version, superficie, texto
from declaraciones
order by id, version desc;

drop function if exists public.fn_politica_responsable();
delete from declaraciones where id = 'politica-datos' and version = 3;
commit;
