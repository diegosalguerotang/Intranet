-- supabase/migraciones/2026-09-18-fase5b-redaccion-historico.sql
-- Corrección de seguridad · FASE 5b — REDACCIÓN DEL HISTÓRICO DE AUDITORÍA.
-- GENERADA por scripts/fase5-generar.mjs. UNA transacción.
--
-- ES LA ÚNICA EXCEPCIÓN LEGÍTIMA A LA INMUTABILIDAD DE LA AUDITORÍA (decisión
-- P6): se PRESENTA para aprobación y NO se ejecuta hasta tenerla. No tiene
-- reversión: los valores redactados no se conservan en ningún sitio (guardarlos
-- desharía el propósito). Deja rastro en la propia auditoría: acción
-- REDACCION_HISTORICO con el conteo por clave, el aprobador y la fecha.
--
-- Qué redacta: en cada fila de interno.auditoria, las claves de secretos con
-- valor (cci, cuenta, cuenta_cifrada, clave_provisional, clave_equipo, sesion_actual) pasan a «[redactado 2026-09-18]». El resto de la fila (quién, cuándo,
-- qué tabla, qué otros campos) queda intacto. NO se tocan cuenta_ultimos4
-- (máscara pública) ni datos personales no secretos (celular, correo).
--
-- Requiere: fase 5a aplicada (desde entonces el disparador ya no guarda
-- secretos) y la aprobación de Diego (variable APROBADO_POR en la sesión).
begin;
set local search_path = public, interno, extensions;

do $$
declare n int; aprobado text := current_setting('fase5b.aprobado_por', true);
begin
  if to_regclass('interno.respaldo_fase5') is null then raise exception 'fase5b: se esperaba la fase 5a aplicada'; end if;
  if (select prosrc from pg_proc where oid = 'public.fn_auditar()'::regprocedure) !~ 'columnas_sensibles' then raise exception 'fase5b: fn_auditar aún guarda secretos: aplicar 5a antes'; end if;
  if coalesce(aprobado, '') = '' then raise exception 'fase5b: falta la aprobación: ejecutar con set fase5b.aprobado_por = ''<nombre>'' delante'; end if;
  select count(*) into n from (select a.id from interno.auditoria a
   where exists (select 1 from jsonb_each(coalesce(a.datos_antes, '{}'::jsonb) || coalesce(a.datos_despues, '{}'::jsonb)) e
                 where e.key in ('cci', 'cuenta', 'cuenta_cifrada', 'clave_provisional', 'clave_equipo', 'sesion_actual') and e.value <> 'null'::jsonb and (e.value #>> '{}') <> '' and (e.value #>> '{}') <> '[redactado 2026-09-18]')) x;
  if n = 0 then raise exception 'fase5b: no hay nada que redactar (¿ya aplicada?)'; end if;
end $$;

-- 1 · Conteo por clave ANTES (queda en el rastro).
create temp table conteo_antes on commit drop as
select e.key as clave, count(*)::int as filas
  from interno.auditoria a
  cross join lateral jsonb_each(coalesce(a.datos_antes, '{}'::jsonb) || coalesce(a.datos_despues, '{}'::jsonb)) e
 where e.key in ('cci', 'cuenta', 'cuenta_cifrada', 'clave_provisional', 'clave_equipo', 'sesion_actual') and e.value <> 'null'::jsonb and (e.value #>> '{}') <> '' and (e.value #>> '{}') <> '[redactado 2026-09-18]'
 group by e.key;

-- 2 · La excepción a la inmutabilidad, acotada a esta transacción.
alter table interno.auditoria disable trigger trg_auditoria_inmutable;
update interno.auditoria a
   set datos_antes = fn_redactar_historico(a.datos_antes),
       datos_despues = fn_redactar_historico(a.datos_despues)
 where a.id in (select a.id from interno.auditoria a
   where exists (select 1 from jsonb_each(coalesce(a.datos_antes, '{}'::jsonb) || coalesce(a.datos_despues, '{}'::jsonb)) e
                 where e.key in ('cci', 'cuenta', 'cuenta_cifrada', 'clave_provisional', 'clave_equipo', 'sesion_actual') and e.value <> 'null'::jsonb and (e.value #>> '{}') <> '' and (e.value #>> '{}') <> '[redactado 2026-09-18]'));
alter table interno.auditoria enable trigger trg_auditoria_inmutable;

-- 3 · Rastro en la propia auditoría.
insert into interno.auditoria (usuario, accion, tabla, datos_antes, datos_despues)
select current_setting('fase5b.aprobado_por', true), 'REDACCION_HISTORICO', 'auditoria', null,
       jsonb_build_object('aprobado_por', current_setting('fase5b.aprobado_por', true), 'fecha', now(),
                          'marca', '[redactado 2026-09-18]', 'claves', (select jsonb_object_agg(clave, filas) from conteo_antes),
                          'filas', (select count(*) from interno.auditoria a where a.datos_antes::text like '%[redactado 2026-09-18]%' or a.datos_despues::text like '%[redactado 2026-09-18]%'));

-- 4 · Verificación: no queda ningún secreto; la inmutabilidad volvió; el rastro existe.
do $$
declare n int;
begin
  select count(*) into n from (select a.id from interno.auditoria a
   where exists (select 1 from jsonb_each(coalesce(a.datos_antes, '{}'::jsonb) || coalesce(a.datos_despues, '{}'::jsonb)) e
                 where e.key in ('cci', 'cuenta', 'cuenta_cifrada', 'clave_provisional', 'clave_equipo', 'sesion_actual') and e.value <> 'null'::jsonb and (e.value #>> '{}') <> '' and (e.value #>> '{}') <> '[redactado 2026-09-18]')) x;
  if n <> 0 then raise exception 'fase5b: quedan % filas con secretos', n; end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'interno.auditoria'::regclass and tgname = 'trg_auditoria_inmutable' and tgenabled = 'O') then
    raise exception 'fase5b: el disparador de inmutabilidad no quedó activo'; end if;
  if not exists (select 1 from interno.auditoria where accion = 'REDACCION_HISTORICO') then raise exception 'fase5b: sin rastro'; end if;
end $$;
commit;
