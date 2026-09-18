// scripts/fase5-generar.mjs — Corrección de seguridad · FASE 5 (datos
// sensibles: auditoría). Canónico: supabase/auditoria.sql. Genera:
//   supabase/migraciones/2026-09-18-fase5a-auditoria-sensible.sql (trigger sin valores sensibles;
//     respaldo del fn_auditar vigente en interno.respaldo_fase5; verificación)
//   supabase/migraciones/2026-09-18-fase5b-redaccion-historico.sql (REDACCIÓN DEL HISTÓRICO:
//     única, se presenta para aprobación y NO se ejecuta hasta tenerla; queda registrada
//     en la propia auditoría; no tiene reversión por diseño)
//   supabase/respaldos/2026-09-18-fase5a-reversion.sql
//   bloque @@FASE5-INICIO@@ … @@FASE5-FIN@@ de supabase/seguridad.sql (solo 5a)
// Uso: node scripts/fase5-generar.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const FECHA = "2026-09-18";
export const CLAVES_REDACTADAS = ["cci", "cuenta", "cuenta_cifrada", "clave_provisional", "clave_equipo", "sesion_actual"];
export const MARCA = "[redactado 2026-09-18]";
const CANONICO = readFileSync("supabase/auditoria.sql", "utf8");
const lista = (arr) => arr.map((x) => `'${x}'`).join(", ");

// Filas del histórico que llevan alguna clave de secreto con valor.
export const SQL_CON_SECRETOS = `select a.id from interno.auditoria a
   where exists (select 1 from jsonb_each(coalesce(a.datos_antes, '{}'::jsonb) || coalesce(a.datos_despues, '{}'::jsonb)) e
                 where e.key in (${lista(CLAVES_REDACTADAS)}) and e.value <> 'null'::jsonb and (e.value #>> '{}') <> '' and (e.value #>> '{}') <> '${MARCA}')`;

export const MIGRACION_A = `-- supabase/migraciones/${FECHA}-fase5a-auditoria-sensible.sql
-- Corrección de seguridad · FASE 5a — AUDITORÍA SIN VALORES SENSIBLES.
-- GENERADA por scripts/fase5-generar.mjs a partir de supabase/auditoria.sql.
-- UNA transacción. Reversión: supabase/respaldos/${FECHA}-fase5a-reversion.sql.
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

${CANONICO}
-- Verificación embebida.
do $$
declare n int;
begin
  select count(*) into n from interno.columnas_sensibles;
  if n < 7 then raise exception 'fase5a: columnas_sensibles con % filas', n; end if;
  if (select prosrc from pg_proc where oid = 'public.fn_auditar()'::regprocedure) !~ 'columnas_sensibles' then raise exception 'fase5a: fn_auditar no consulta columnas_sensibles'; end if;
  if has_table_privilege('authenticated', 'interno.columnas_sensibles', 'select') then raise exception 'fase5a: authenticated lee columnas_sensibles'; end if;
  if has_function_privilege('authenticated', 'public.fn_redactar_historico(jsonb)', 'execute') then raise exception 'fase5a: authenticated ejecuta fn_redactar_historico'; end if;
  if fn_redactar_historico('{"a":1,"cci":"00212345678901234567","sesion_actual":null}'::jsonb) <> '{"a":1,"cci":"${MARCA}","sesion_actual":null}'::jsonb then
    raise exception 'fase5a: fn_redactar_historico no redacta como se espera'; end if;
end $$;
commit;
`;

export const MIGRACION_B = `-- supabase/migraciones/${FECHA}-fase5b-redaccion-historico.sql
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
-- valor (${CLAVES_REDACTADAS.join(", ")}) pasan a «${MARCA}». El resto de la fila (quién, cuándo,
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
  select count(*) into n from (${SQL_CON_SECRETOS}) x;
  if n = 0 then raise exception 'fase5b: no hay nada que redactar (¿ya aplicada?)'; end if;
end $$;

-- 1 · Conteo por clave ANTES (queda en el rastro).
create temp table conteo_antes on commit drop as
select e.key as clave, count(*)::int as filas
  from interno.auditoria a
  cross join lateral jsonb_each(coalesce(a.datos_antes, '{}'::jsonb) || coalesce(a.datos_despues, '{}'::jsonb)) e
 where e.key in (${lista(CLAVES_REDACTADAS)}) and e.value <> 'null'::jsonb and (e.value #>> '{}') <> '' and (e.value #>> '{}') <> '${MARCA}'
 group by e.key;

-- 2 · La excepción a la inmutabilidad, acotada a esta transacción.
alter table interno.auditoria disable trigger trg_auditoria_inmutable;
update interno.auditoria a
   set datos_antes = fn_redactar_historico(a.datos_antes),
       datos_despues = fn_redactar_historico(a.datos_despues)
 where a.id in (${SQL_CON_SECRETOS});
alter table interno.auditoria enable trigger trg_auditoria_inmutable;

-- 3 · Rastro en la propia auditoría.
insert into interno.auditoria (usuario, accion, tabla, datos_antes, datos_despues)
select current_setting('fase5b.aprobado_por', true), 'REDACCION_HISTORICO', 'auditoria', null,
       jsonb_build_object('aprobado_por', current_setting('fase5b.aprobado_por', true), 'fecha', now(),
                          'marca', '${MARCA}', 'claves', (select jsonb_object_agg(clave, filas) from conteo_antes),
                          'filas', (select count(*) from interno.auditoria a where a.datos_antes::text like '%${MARCA}%' or a.datos_despues::text like '%${MARCA}%'));

-- 4 · Verificación: no queda ningún secreto; la inmutabilidad volvió; el rastro existe.
do $$
declare n int;
begin
  select count(*) into n from (${SQL_CON_SECRETOS}) x;
  if n <> 0 then raise exception 'fase5b: quedan % filas con secretos', n; end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'interno.auditoria'::regclass and tgname = 'trg_auditoria_inmutable' and tgenabled = 'O') then
    raise exception 'fase5b: el disparador de inmutabilidad no quedó activo'; end if;
  if not exists (select 1 from interno.auditoria where accion = 'REDACCION_HISTORICO') then raise exception 'fase5b: sin rastro'; end if;
end $$;
commit;
`;

export const REVERSION_A = `-- supabase/respaldos/${FECHA}-fase5a-reversion.sql
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
`;

export const ESPEJO = `-- @@FASE5-INICIO@@ (generado por scripts/fase5-generar.mjs desde supabase/auditoria.sql; no editar a mano)
-- 13 · Fase 5a: auditoría sin valores sensibles (la redacción del histórico, 5b, es una migración de datos).
${CANONICO}
-- @@FASE5-FIN@@`;

export const sinFase5 = (texto) => texto.replace(/-- @@FASE[5-9][A-Z]?-INICIO@@[\s\S]*?-- @@FASE[5-9][A-Z]?-FIN@@\n?/g, "");

const esPrincipal = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esPrincipal) {
  writeFileSync(`supabase/migraciones/${FECHA}-fase5a-auditoria-sensible.sql`, MIGRACION_A);
  writeFileSync(`supabase/migraciones/${FECHA}-fase5b-redaccion-historico.sql`, MIGRACION_B);
  writeFileSync(`supabase/respaldos/${FECHA}-fase5a-reversion.sql`, REVERSION_A);
  const ruta = "supabase/seguridad.sql";
  const actual = readFileSync(ruta, "utf8");
  const propio = /-- @@FASE5-INICIO@@[\s\S]*?-- @@FASE5-FIN@@\n?/;
  writeFileSync(ruta, propio.test(actual) ? actual.replace(propio, () => `${ESPEJO}\n`) : `${actual.replace(/\s+$/, "")}\n\n${ESPEJO}\n`);
  console.log("Generados: fase5a (trigger), fase5b (redacción, NO ejecutar sin aprobación), reversión 5a y bloque @@FASE5@@.");
}
