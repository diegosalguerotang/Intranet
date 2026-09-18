-- supabase/respaldos/2026-09-18-fase3a1-reversion.sql
-- Reversión del paso 1 de la FASE 3a: quita las funciones de servicio. Solo
-- tiene sentido con el código anterior de api/*.js desplegado (lee las tablas
-- por PostgREST) y con fase3a2 ya revertida.
begin;
drop function if exists public.api_admin_por_correo(text, boolean);
drop function if exists public.api_admin_por_id(bigint);
drop function if exists public.api_admin_marcar_clave(bigint, text, boolean);
drop function if exists public.api_token_crear(text, text, text, text, timestamptz);
drop function if exists public.api_token_leer(text, text[]);
drop function if exists public.api_token_usar(text);
commit;
