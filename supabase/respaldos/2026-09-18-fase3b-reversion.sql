-- supabase/respaldos/2026-09-18-fase3b-reversion.sql
-- Reversión completa de la FASE 3b (GENERADA por scripts/fase3b-generar.mjs):
-- columnas bancarias de vuelta en personas con sus valores (CCI descifrado),
-- definiciones originales de funciones y vistas desde interno.respaldo_fase3b,
-- tabla y ayudantes eliminados.
begin;
set local search_path = public, interno, extensions;

alter table personas
  add column if not exists cci text,
  add column if not exists banco text,
  add column if not exists banco_id text references bancos(codigo),
  add column if not exists cuenta text,
  add column if not exists cuenta_cifrada bytea,
  add column if not exists cuenta_ultimos4 text;

update personas p set
  banco = db.banco, banco_id = db.banco_id,
  cuenta_cifrada = db.cuenta_cifrada, cuenta_ultimos4 = db.cuenta_ultimos4,
  cci = fn_descifrar_cuenta(db.cci_cifrado)
from interno.datos_bancarios db where db.dni = p.dni;

-- Definiciones originales (vistas primero: vuelven a leer personas.*).
do $$
declare r record;
begin
  for r in select definicion from interno.respaldo_fase3b where objeto like 'view:%' order by objeto loop execute r.definicion; end loop;
  for r in select definicion from interno.respaldo_fase3b where objeto like 'fn:%' order by objeto loop execute r.definicion; end loop;
end $$;
alter view v_personal set (security_invoker = on);

drop trigger if exists trg_auditar_datos_bancarios on interno.datos_bancarios;
drop function if exists fn_auditar_datos_bancarios();
drop function if exists fn_guardar_datos_bancarios(text, text, text, text, text, boolean, text);
drop function if exists fn_ultimos4(text);
drop table interno.datos_bancarios;
drop table interno.respaldo_fase3b;

do $$
declare n int;
begin
  select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'personas' and column_name in ('cuenta', 'cci', 'cuenta_cifrada', 'cuenta_ultimos4', 'banco', 'banco_id');
  if n <> 6 then raise exception 'reversión fase3b: personas tiene % columnas bancarias', n; end if;
  if to_regclass('interno.datos_bancarios') is not null then raise exception 'reversión fase3b: la tabla sigue'; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'importar_planilla_unificada' and p.prosrc ~ 'from datos_bancarios';
  if n <> 0 then raise exception 'reversión fase3b: importar_planilla_unificada sigue transformada'; end if;
end $$;
commit;
