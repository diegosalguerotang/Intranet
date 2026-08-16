-- supabase/migraciones/2026-08-16-privacidad-documentos.sql
-- Privacidad de documentos (Ley 29733): bucket privado, rutas internas y RLS
-- real sobre public.documentos. Spec: docs/superpowers/specs/2026-08-16-privacidad-documentos.md

-- 1 · Bucket privado: ninguna URL /object/public/... vuelve a servir archivos.
update storage.buckets set public = false where id = 'documentos';

-- 2 · archivo_url guarda la RUTA interna, nunca una URL completa.
update documentos
set archivo_url = regexp_replace(archivo_url, '^https?://[^/]+/storage/v1/object/public/documentos/', '')
where archivo_url ~ '^https?://';

-- 3 · RLS real: la tabla base solo es legible/escribible por admins activos.
--    El Portal lee por vistas/RPCs security definer (portal.sql) y el
--    BackOffice por vistas v_* y RPCs security definer: nada de eso pasa por
--    estas políticas. Se cierra la enumeración rest/v1/documentos por anon.
--    documentos sale del foreach de RLS de schema.sql (ver bloque SEGURIDAD):
--    se habilita aquí explícitamente para que un reset desde cero también
--    quede protegido (idempotente, igual que el resto de ENABLE ROW LEVEL
--    SECURITY del proyecto).
alter table documentos enable row level security;
drop policy if exists acceso_demo on documentos;
drop policy if exists documentos_admin on documentos;
create policy documentos_admin on documentos
  for all to authenticated
  using (public.es_admin_activo())
  with check (public.es_admin_activo());
