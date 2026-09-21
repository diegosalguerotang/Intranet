-- supabase/respaldos/2026-09-21-fase6-reversion.sql
-- Reversión de la fase 6b: restaura las 6 funciones (y sus permisos) desde
-- interno.respaldo_fase6, retira las dos funciones de servicio y devuelve la
-- política al piso anterior (constraint, default y valor). La columna
-- registro_accesos.fuente y su índice se conservan (inofensivos; el registro
-- es inmutable y no se borra nada).
begin;
set local search_path = public, interno, extensions;
do $$ declare r record; begin
  for r in select objeto, definicion from interno.respaldo_fase6 where objeto like 'fn:%' loop execute r.definicion; end loop;
end $$;
drop function if exists api_login_permitido(text, text);
drop function if exists api_login_registrar(text, text, text, text);
alter table interno.politica_acceso drop constraint if exists chk_clave_min_backoffice;
do $$ declare r record; begin
  select definicion into r from interno.respaldo_fase6 where objeto = 'chk:chk_clave_min_backoffice';
  if found then execute 'alter table interno.politica_acceso add constraint chk_clave_min_backoffice ' || r.definicion; end if;
  select definicion into r from interno.respaldo_fase6 where objeto = 'def:clave_longitud_min_backoffice';
  if found and r.definicion <> '' then execute 'alter table interno.politica_acceso alter column clave_longitud_min_backoffice set default ' || r.definicion; end if;
  select definicion into r from interno.respaldo_fase6 where objeto = 'val:clave_longitud_min_backoffice';
  if found then execute 'update interno.politica_acceso set clave_longitud_min_backoffice = ' || r.definicion || ' where id = 1'; end if;
end $$;
drop table interno.respaldo_fase6;
do $$ begin
  if (select prosrc from pg_proc where oid = 'public.verificar_bloqueo(text)'::regprocedure) ~ 'fuente' then raise exception 'reversión fase6: verificar_bloqueo sigue filtrando por fuente'; end if;
  if to_regprocedure('public.api_login_permitido(text, text)') is not null then raise exception 'reversión fase6: api_login_permitido sigue existiendo'; end if;
end $$;
commit;
