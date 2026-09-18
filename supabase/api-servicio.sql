-- supabase/api-servicio.sql — Funciones de SERVICIO para las funciones serverless
-- (api/*.js), que llaman con la llave de servicio. Corrección de seguridad,
-- fase 3 (2026-09-18): las tablas sensibles viven en el esquema `interno`, que
-- PostgREST no publica, así que la API ya no puede leerlas ni escribirlas por
-- /rest/v1/<tabla>. Este es el único frente publicado para ese trabajo.
--
-- Reglas: SECURITY DEFINER, search_path fijo, EXECUTE solo para service_role
-- (ni anon ni authenticated: un navegador nunca las ve). Cada función hace
-- exactamente lo que hacía la consulta directa que reemplaza, nada más.
-- Se carga después de soporte.sql (orden en MODELO.md). El esquema `interno`
-- lo crea la fase 3a (bloque @@FASE3@@ de seguridad.sql / migración): un
-- search_path que nombra un esquema aún inexistente es válido en PostgreSQL.

-- Usuario administrativo por correo (sin distinguir mayúsculas). Reemplaza
-- /rest/v1/usuarios_admin?correo=eq|ilike.<correo>[&estado=eq.activo].
create or replace function api_admin_por_correo(p_correo text, p_solo_activo boolean default true)
returns table (id bigint, persona_dni text, correo text, estado text)
language sql stable security definer set search_path = public, interno, extensions as $$
  select u.id, u.persona_dni, u.correo, u.estado
  from usuarios_admin u
  where lower(u.correo) = lower(coalesce(p_correo, ''))
    and (not p_solo_activo or u.estado = 'activo')
  limit 1
$$;

-- Usuario administrativo por id. Reemplaza /rest/v1/usuarios_admin?id=eq.<id>.
create or replace function api_admin_por_id(p_id bigint)
returns table (id bigint, correo text, persona_dni text)
language sql stable security definer set search_path = public, interno, extensions as $$
  select u.id, u.correo, u.persona_dni from usuarios_admin u where u.id = p_id limit 1
$$;

-- Marca el estado del cambio obligatorio de clave (por id o por correo) y
-- descarta cualquier clave provisional guardada. Reemplaza los PATCH de
-- usuarios_admin {requiere_cambio_clave, clave_provisional: null}.
create or replace function api_admin_marcar_clave(p_id bigint, p_correo text, p_requiere_cambio boolean)
returns int
language plpgsql security definer set search_path = public, interno, extensions as $$
declare n int;
begin
  if p_id is null and coalesce(p_correo, '') = '' then return 0; end if;
  update usuarios_admin
     set requiere_cambio_clave = coalesce(p_requiere_cambio, requiere_cambio_clave), clave_provisional = null
   where (p_id is not null and id = p_id) or (p_id is null and lower(correo) = lower(p_correo));
  get diagnostics n = row_count;
  return n;
end $$;

-- Tokens de correo (verificación, recuperación). Reemplazan POST/GET/PATCH de
-- /rest/v1/correo_tokens.
create or replace function api_token_crear(p_token text, p_dni text, p_proposito text, p_correo text, p_expira_en timestamptz)
returns void
language sql security definer set search_path = public, interno, extensions as $$
  insert into correo_tokens (token, dni, proposito, correo, expira_en) values (p_token, p_dni, p_proposito, p_correo, p_expira_en)
$$;

create or replace function api_token_leer(p_token text, p_propositos text[] default null)
returns table (dni text, correo text, proposito text, expira_en timestamptz, usado_en timestamptz)
language sql stable security definer set search_path = public, interno, extensions as $$
  select t.dni, t.correo, t.proposito, t.expira_en, t.usado_en
  from correo_tokens t
  where t.token = p_token and (p_propositos is null or t.proposito = any (p_propositos))
  limit 1
$$;

create or replace function api_token_usar(p_token text)
returns int
language plpgsql security definer set search_path = public, interno, extensions as $$
declare n int;
begin
  update correo_tokens set usado_en = now() where token = p_token and usado_en is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Solo la llave de servicio. Ni anon ni authenticated (ni PUBLIC).
revoke all on function
  api_admin_por_correo(text, boolean), api_admin_por_id(bigint), api_admin_marcar_clave(bigint, text, boolean),
  api_token_crear(text, text, text, text, timestamptz), api_token_leer(text, text[]), api_token_usar(text)
from public, anon, authenticated;
grant execute on function
  api_admin_por_correo(text, boolean), api_admin_por_id(bigint), api_admin_marcar_clave(bigint, text, boolean),
  api_token_crear(text, text, text, text, timestamptz), api_token_leer(text, text[]), api_token_usar(text)
to service_role;
