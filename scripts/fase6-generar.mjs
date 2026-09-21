// scripts/fase6-generar.mjs — Corrección de seguridad · FASE 6b (límites e
// identidad). Canónico: supabase/limites.sql. Genera:
//   supabase/migraciones/2026-09-21-fase6-limites.sql (respalda las definiciones
//     vigentes en interno.respaldo_fase6; verificación embebida)
//   supabase/respaldos/2026-09-21-fase6-reversion.sql
//   bloque @@FASE6-INICIO@@ … @@FASE6-FIN@@ de supabase/seguridad.sql
// Uso: node scripts/fase6-generar.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const FECHA = "2026-09-21";
export const LIMITE_IP_FALLIDOS = 30;
export const LIMITE_IP_MINUTOS = 15;
export const CLAVE_MIN_BACKOFFICE = 10;
// Funciones que la fase reescribe (se respaldan y la reversión las restaura).
export const FUNCIONES = [
  "public.fn_nivel_modulo(text)",
  "public.registrar_ingreso(text, text, text)",
  "public.portal_registrar_ingreso(text, text, text)",
  "public.verificar_bloqueo(text)",
  "public.portal_verificar_bloqueo(text)",
  "public.guardar_politica(integer, integer, boolean, boolean, integer, integer, text, integer, integer, integer, text)",
];
export const FUNCIONES_NUEVAS = ["public.api_login_permitido(text, text)", "public.api_login_registrar(text, text, text, text)"];
const CANONICO = readFileSync("supabase/limites.sql", "utf8");
const lista = (arr) => arr.map((x) => `'${x}'`).join(", ");

export const MIGRACION = `-- supabase/migraciones/${FECHA}-fase6-limites.sql
-- Corrección de seguridad · FASE 6b — LÍMITES E IDENTIDAD.
-- GENERADA por scripts/fase6-generar.mjs a partir de supabase/limites.sql.
-- UNA transacción. Reversión: supabase/respaldos/${FECHA}-fase6-reversion.sql.
-- Requiere la fase 5a aplicada. El proxy (api/supa.js, fase 6d) usa
-- api_login_permitido/api_login_registrar cuando existen y, mientras no, solo
-- verificar_bloqueo: se puede desplegar el cliente antes o después de esto.
begin;
set local search_path = public, interno, extensions;

do $$
begin
  if to_regclass('interno.columnas_sensibles') is null then raise exception 'fase6: se esperaba la fase 5a aplicada (interno.columnas_sensibles)'; end if;
  if to_regclass('interno.respaldo_fase6') is not null then raise exception 'fase6: interno.respaldo_fase6 ya existe (¿fase 6 aplicada?)'; end if;
end $$;
create table interno.respaldo_fase6 (objeto text primary key, definicion text not null);
revoke all on table interno.respaldo_fase6 from public, anon, authenticated;
insert into interno.respaldo_fase6
  select 'fn:' || f, pg_get_functiondef(f::regprocedure) from unnest(array[${lista(FUNCIONES)}]) as f;
insert into interno.respaldo_fase6
  select 'acl:' || f, coalesce(p.proacl::text, '') from unnest(array[${lista(FUNCIONES)}]) as f join pg_proc p on p.oid = f::regprocedure;
insert into interno.respaldo_fase6
  select 'chk:chk_clave_min_backoffice', pg_get_constraintdef(oid) from pg_constraint where conname = 'chk_clave_min_backoffice' and conrelid = 'interno.politica_acceso'::regclass;
insert into interno.respaldo_fase6
  select 'val:clave_longitud_min_backoffice', clave_longitud_min_backoffice::text from interno.politica_acceso where id = 1;
insert into interno.respaldo_fase6
  select 'def:clave_longitud_min_backoffice', coalesce(pg_get_expr(d.adbin, d.adrelid), '') from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'interno.politica_acceso'::regclass and a.attname = 'clave_longitud_min_backoffice';

${CANONICO}
-- Verificación embebida.
do $$
declare n int; v jsonb;
begin
  if not exists (select 1 from pg_attribute where attrelid = 'interno.registro_accesos'::regclass and attname = 'fuente' and not attisdropped) then raise exception 'fase6: registro_accesos.fuente no existe'; end if;
  if (select prosrc from pg_proc where oid = 'public.fn_nivel_modulo(text)'::regprocedure) !~ 'current_setting\\(''role''' then raise exception 'fase6: fn_nivel_modulo no mira el rol activo'; end if;
  if (select prosrc from pg_proc where oid = 'public.verificar_bloqueo(text)'::regprocedure) !~ 'fuente = ''proxy''' then raise exception 'fase6: verificar_bloqueo no filtra por fuente'; end if;
  if (select prosrc from pg_proc where oid = 'public.registrar_ingreso(text, text, text)'::regprocedure) !~ 'correo_llamador' then raise exception 'fase6: registrar_ingreso no exige la propia sesión'; end if;
  if (select clave_longitud_min_backoffice from interno.politica_acceso where id = 1) < ${CLAVE_MIN_BACKOFFICE} then raise exception 'fase6: la política sigue por debajo de ${CLAVE_MIN_BACKOFFICE}'; end if;
  if has_function_privilege('authenticated', 'public.api_login_permitido(text, text)', 'execute') then raise exception 'fase6: authenticated ejecuta api_login_permitido'; end if;
  if has_function_privilege('anon', 'public.api_login_registrar(text, text, text, text)', 'execute') then raise exception 'fase6: anon ejecuta api_login_registrar'; end if;
  if not has_function_privilege('service_role', 'public.api_login_permitido(text, text)', 'execute') then raise exception 'fase6: service_role no ejecuta api_login_permitido'; end if;
  if not has_function_privilege('anon', 'public.registrar_ingreso(text, text, text)', 'execute') then raise exception 'fase6: anon perdió registrar_ingreso (pre-login)'; end if;
  if not has_function_privilege('anon', 'public.portal_verificar_bloqueo(text)', 'execute') then raise exception 'fase6: anon perdió portal_verificar_bloqueo (pre-login)'; end if;
  v := api_login_permitido('0.0.0.0', 'nadie@ejemplo.invalido');
  if coalesce((v ->> 'permitido')::boolean, false) is not true then raise exception 'fase6: api_login_permitido niega una cuenta sin historial: %', v; end if;
  if fn_nivel_modulo('accesos') <> 99 then raise exception 'fase6: la sesión de migración (postgres, sin JWT) debería valer 99 y vale %', fn_nivel_modulo('accesos'); end if;
end $$;
commit;
`;

export const REVERSION = `-- supabase/respaldos/${FECHA}-fase6-reversion.sql
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
`;

export const ESPEJO = `-- @@FASE6-INICIO@@ (generado por scripts/fase6-generar.mjs desde supabase/limites.sql; no editar a mano)
-- 14 · Fase 6b: identidad con fallo cerrado, bitácora de login con IP real y fuente, compuerta de login para el proxy, piso de clave del BackOffice.
${CANONICO}
-- @@FASE6-FIN@@`;

export const sinFase6 = (texto) => texto.replace(/-- @@FASE[6-9][A-Z]?-INICIO@@[\s\S]*?-- @@FASE[6-9][A-Z]?-FIN@@\n?/g, "");

const esPrincipal = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esPrincipal) {
  writeFileSync(`supabase/migraciones/${FECHA}-fase6-limites.sql`, MIGRACION);
  writeFileSync(`supabase/respaldos/${FECHA}-fase6-reversion.sql`, REVERSION);
  const ruta = "supabase/seguridad.sql";
  const actual = readFileSync(ruta, "utf8");
  const propio = /-- @@FASE6-INICIO@@[\s\S]*?-- @@FASE6-FIN@@\n?/;
  writeFileSync(ruta, propio.test(actual) ? actual.replace(propio, () => `${ESPEJO}\n`) : `${actual.replace(/\s+$/, "")}\n\n${ESPEJO}\n`);
  console.log("Generados: migración fase6, reversión y bloque @@FASE6@@ de seguridad.sql.");
}
