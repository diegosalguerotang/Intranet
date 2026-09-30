-- supabase/migraciones/2026-09-30-correo-fallos.sql — aviso de correos fallidos (superadmin).
-- Generado por scripts/correo-generar.mjs desde supabase/correo.sql (no editar a mano).
-- Una transacción. Reversión: supabase/respaldos/2026-09-30-correo-fallos-reversion.sql.
-- Aplica DIEGO con `!`:  node scripts/aplicar-sql.mjs supabase/migraciones/2026-09-30-correo-fallos.sql
begin;
set local search_path = public, interno, extensions;

-- ============================================================================
-- CORREO — aviso de envíos fallidos para superadministradores (2026-09-30)
-- correo_envios sigue cerrada a la API (sin política, sin privilegios para
-- authenticated/anon): esta función definer es el ÚNICO camino de lectura y
-- solo la ejecuta un superadministrador con el segundo factor verificado
-- (requiere_superadmin → es_superadmin → nivel_en → fn_nivel_modulo v4).
-- Vive como bloque @@CORREO@@ al final de seguridad.sql (scripts/correo-generar.mjs),
-- NO en CANONICOS de pg-local (los ensayos de fases previas lo recortan).
-- Spec: docs/superpowers/specs/2026-09-30-motor-correo-resend-design.md
-- ============================================================================
create or replace function correo_fallos_recientes()
returns table (id bigint, creado_en timestamptz, accion text, destinatario text, detalle text)
language plpgsql stable security definer set search_path = public, interno, extensions as $$
begin
  perform requiere_superadmin();
  return query
    select e.id, e.creado_en, e.accion, e.destinatario, e.detalle
    from correo_envios e
    where e.resultado = 'error' and e.creado_en >= now() - interval '24 hours'
    order by e.creado_en desc
    limit 100;
end $$;
comment on function correo_fallos_recientes() is 'Envíos de correo con error en las últimas 24 h; solo superadministradores (aviso del BackOffice).';
revoke all on function correo_fallos_recientes() from public, anon;
grant execute on function correo_fallos_recientes() to authenticated;

-- Verificación embebida: la función existe, es definer, solo authenticated la ejecuta.
do $v$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'correo_fallos_recientes' and p.prosecdef) then
    raise exception 'correo: la función no quedó como security definer';
  end if;
  if has_function_privilege('anon', 'public.correo_fallos_recientes()', 'execute')
     or not has_function_privilege('authenticated', 'public.correo_fallos_recientes()', 'execute') then
    raise exception 'correo: privilegios incorrectos en correo_fallos_recientes';
  end if;
  if has_table_privilege('authenticated', 'public.correo_envios', 'select') then
    raise exception 'correo: correo_envios quedó legible por authenticated';
  end if;
end $v$;

commit;
