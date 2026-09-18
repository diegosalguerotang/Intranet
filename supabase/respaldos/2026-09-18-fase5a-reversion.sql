-- supabase/respaldos/2026-09-18-fase5a-reversion.sql
-- Reversión de la fase 5a: fn_auditar original desde el respaldo; se retiran
-- la lista de columnas sensibles y la función de redacción.
begin;
set local search_path = public, interno, extensions;
do $$ declare r record; begin
  for r in select definicion from interno.respaldo_fase5 where objeto like 'fn:%' loop execute r.definicion; end loop;
end $$;
drop function if exists fn_redactar_historico(jsonb);
drop table interno.columnas_sensibles;
drop table interno.respaldo_fase5;
do $$ begin
  if (select prosrc from pg_proc where oid = 'public.fn_auditar()'::regprocedure) ~ 'columnas_sensibles' then raise exception 'reversión fase5a: fn_auditar sigue redactando'; end if;
end $$;
commit;
