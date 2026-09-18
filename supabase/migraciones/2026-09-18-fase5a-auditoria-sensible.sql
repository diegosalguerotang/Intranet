-- supabase/migraciones/2026-09-18-fase5a-auditoria-sensible.sql
-- Corrección de seguridad · FASE 5a — AUDITORÍA SIN VALORES SENSIBLES.
-- GENERADA por scripts/fase5-generar.mjs a partir de supabase/auditoria.sql.
-- UNA transacción. Reversión: supabase/respaldos/2026-09-18-fase5a-reversion.sql.
-- Requiere la fase 4 aplicada. Sin cambios en el cliente.
begin;
set local search_path = public, interno, extensions;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'adm_lectura') then raise exception 'fase5a: se esperaba la fase 4 aplicada (políticas adm_lectura)'; end if;
  if to_regclass('interno.respaldo_fase5') is not null then raise exception 'fase5a: interno.respaldo_fase5 ya existe (¿fase 5a aplicada?)'; end if;
end $$;
create table interno.respaldo_fase5 (objeto text primary key, definicion text not null);
revoke all on table interno.respaldo_fase5 from public, anon, authenticated;
insert into interno.respaldo_fase5 select 'fn:fn_auditar()', pg_get_functiondef('public.fn_auditar()'::regprocedure);

-- supabase/auditoria.sql — Corrección de seguridad · FASE 5 (2026-09-18):
-- AUDITORÍA SIN VALORES SENSIBLES.
--
-- Canónico de la fase 5a. Lo embebe la migración
-- migraciones/2026-09-18-fase5a-auditoria-sensible.sql y el bloque @@FASE5@@
-- de seguridad.sql. Idempotente.
--
--  · interno.columnas_sensibles: la LISTA DEFINIDA (tabla, columna) cuyos
--    valores nunca deben quedar en la auditoría. Editarla es una migración.
--  · fn_auditar: para esas columnas registra que hubo cambio, no el valor
--    («[sensible]» / «[sensible: cambiado]»; null se conserva como null).
--  · fn_redactar_historico: la regla que aplica la migración de redacción del
--    histórico (fase 5b), única, aprobada y registrada en la propia auditoría.

create table if not exists interno.columnas_sensibles (
  tabla   text not null,
  columna text not null,
  motivo  text not null,
  primary key (tabla, columna)
);
revoke all on table interno.columnas_sensibles from public, anon, authenticated;
insert into interno.columnas_sensibles (tabla, columna, motivo) values
  ('usuarios_admin', 'clave_provisional', 'clave de acceso (hoy siempre null; la API no la guarda)'),
  ('usuarios_admin', 'sesion_actual',     'marcador de sesión única del BackOffice'),
  ('cuentas_portal', 'sesion_actual',     'marcador de sesión única del Portal'),
  ('personas',       'cuenta',            'cuenta bancaria en claro (columna retirada en la fase 3b; regla defensiva)'),
  ('personas',       'cci',               'CCI en claro (columna retirada en la fase 3b; regla defensiva)'),
  ('personas',       'cuenta_cifrada',    'cuenta cifrada (columna retirada en la fase 3b; regla defensiva)'),
  ('activos',        'clave_equipo',      'clave de equipo (columna retirada en la fase 3c; regla defensiva)')
on conflict (tabla, columna) do update set motivo = excluded.motivo;

create or replace function fn_auditar() returns trigger
language plpgsql security definer set search_path = public, interno, extensions as $$
declare j_antes jsonb; j_despues jsonb; c record; v_cambio boolean;
begin
  j_antes := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  j_despues := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  for c in select columna from interno.columnas_sensibles where tabla = tg_table_name loop
    v_cambio := (j_antes -> c.columna) is distinct from (j_despues -> c.columna);
    if j_antes ? c.columna and (j_antes -> c.columna) <> 'null'::jsonb then
      j_antes := jsonb_set(j_antes, array[c.columna], '"[sensible]"'::jsonb);
    end if;
    if j_despues ? c.columna and (j_despues -> c.columna) <> 'null'::jsonb then
      j_despues := jsonb_set(j_despues, array[c.columna], case when v_cambio then '"[sensible: cambiado]"'::jsonb else '"[sensible]"'::jsonb end);
    end if;
  end loop;
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values (tg_op, tg_table_name, j_antes, j_despues);
  return coalesce(new, old);
end $$;

-- Regla de redacción del histórico: las claves de secretos con valor pasan a
-- «[redactado 2026-09-18]»; el resto de la fila queda intacto.
create or replace function fn_redactar_historico(p_datos jsonb) returns jsonb
language sql immutable as $$
  select case when p_datos is null then null else (
    select coalesce(jsonb_object_agg(e.key,
      case when e.key in ('cci', 'cuenta', 'cuenta_cifrada', 'clave_provisional', 'clave_equipo', 'sesion_actual')
                and e.value <> 'null'::jsonb and (e.value #>> '{}') <> ''
           then '"[redactado 2026-09-18]"'::jsonb else e.value end), '{}'::jsonb)
    from jsonb_each(p_datos) e) end
$$;
revoke all on function fn_redactar_historico(jsonb) from public, anon, authenticated;

-- Verificación embebida.
do $$
declare n int;
begin
  select count(*) into n from interno.columnas_sensibles;
  if n < 7 then raise exception 'fase5a: columnas_sensibles con % filas', n; end if;
  if (select prosrc from pg_proc where oid = 'public.fn_auditar()'::regprocedure) !~ 'columnas_sensibles' then raise exception 'fase5a: fn_auditar no consulta columnas_sensibles'; end if;
  if has_table_privilege('authenticated', 'interno.columnas_sensibles', 'select') then raise exception 'fase5a: authenticated lee columnas_sensibles'; end if;
  if has_function_privilege('authenticated', 'public.fn_redactar_historico(jsonb)', 'execute') then raise exception 'fase5a: authenticated ejecuta fn_redactar_historico'; end if;
  if fn_redactar_historico('{"a":1,"cci":"00212345678901234567","sesion_actual":null}'::jsonb) <> '{"a":1,"cci":"[redactado 2026-09-18]","sesion_actual":null}'::jsonb then
    raise exception 'fase5a: fn_redactar_historico no redacta como se espera'; end if;
end $$;
commit;
