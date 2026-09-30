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
