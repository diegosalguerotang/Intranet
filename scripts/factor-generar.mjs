// scripts/factor-generar.mjs — Segundo factor por correo (2026-09-28).
// Canónico: supabase/factor.sql. Genera:
//   supabase/migraciones/2026-09-28-segundo-factor.sql (una transacción; respalda
//     fn_nivel_modulo, guardar_politica y v_politica_acceso en interno.respaldo_factor;
//     verificación embebida)
//   supabase/respaldos/2026-09-28-segundo-factor-reversion.sql
//   bloque @@FACTOR-INICIO@@ … @@FACTOR-FIN@@ de supabase/seguridad.sql
// Uso: node scripts/factor-generar.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const FECHA = "2026-09-28";
export const GUARDAR_POLITICA_VIEJA = "public.guardar_politica(integer, integer, boolean, boolean, integer, integer, text, integer, integer, integer, text)";
export const GUARDAR_POLITICA_NUEVA = "public.guardar_politica(integer, integer, boolean, boolean, integer, integer, text, integer, integer, integer, text, boolean)";
// Funciones que la fase reescribe (se respaldan y la reversión las restaura).
export const FUNCIONES = ["public.fn_nivel_modulo(text)", GUARDAR_POLITICA_VIEJA];
export const FUNCIONES_NUEVAS = [
  "public.fn_factor_pendiente()", "public.mi_segundo_factor()",
  "public.api_factor_emitir(text, uuid, text, text, text)", "public.api_factor_verificar(text, uuid, text, text, text)",
  "public.api_factor_dispositivo_crear(text, uuid, text, text, text)", "public.api_factor_dispositivo_usar(text, uuid, text, text, text)",
  "public.api_factor_dispositivos_revocar(text)",
];
export const TABLAS = ["factor_codigos", "factor_sesiones", "dispositivos_confiables"];
const CANONICO = readFileSync("supabase/factor.sql", "utf8");
const lista = (arr) => arr.map((x) => `'${x}'`).join(", ");

export const MIGRACION = `-- supabase/migraciones/${FECHA}-segundo-factor.sql
-- SEGUNDO FACTOR POR CORREO para el Superadministrador.
-- GENERADA por scripts/factor-generar.mjs a partir de supabase/factor.sql.
-- UNA transacción. Reversión: supabase/respaldos/${FECHA}-segundo-factor-reversion.sql.
-- Requiere la fase 6b aplicada. ORDEN: aplicar ANTES del deploy del cliente
-- (con el cliente viejo un superadmin queda en nivel 0 sin pantalla para
-- verificar; con el cliente nuevo y sin migración, mi_segundo_factor no existe
-- y el cliente entra sin factor). Por eso migración → push, uno tras otro.
begin;
set local search_path = public, interno, extensions;

do $$
begin
  if to_regprocedure('public.api_login_permitido(text, text)') is null then raise exception 'factor: se esperaba la fase 6b aplicada (api_login_permitido)'; end if;
  if to_regclass('interno.respaldo_factor') is not null then raise exception 'factor: interno.respaldo_factor ya existe (¿migración aplicada?)'; end if;
end $$;
create table interno.respaldo_factor (objeto text primary key, definicion text not null);
revoke all on table interno.respaldo_factor from public, anon, authenticated;
insert into interno.respaldo_factor
  select 'fn:' || f, pg_get_functiondef(f::regprocedure) from unnest(array[${lista(FUNCIONES)}]) as f;
insert into interno.respaldo_factor
  select 'acl:' || f, coalesce(p.proacl::text, '') from unnest(array[${lista(FUNCIONES)}]) as f join pg_proc p on p.oid = f::regprocedure;
insert into interno.respaldo_factor
  select 'view:v_politica_acceso', pg_get_viewdef('public.v_politica_acceso'::regclass, true);
insert into interno.respaldo_factor
  select 'acl:view:v_politica_acceso', coalesce(relacl::text, '') from pg_class where oid = 'public.v_politica_acceso'::regclass;

${CANONICO}
-- Verificación embebida.
do $$
declare v jsonb; v_correo text;
begin
  if not exists (select 1 from pg_attribute where attrelid = 'interno.politica_acceso'::regclass and attname = 'factor_superadmin' and not attisdropped) then raise exception 'factor: falta politica_acceso.factor_superadmin'; end if;
  if (select factor_superadmin from interno.politica_acceso where id = 1) is not true then raise exception 'factor: el interruptor no quedó encendido'; end if;
  if (select prosrc from pg_proc where oid = 'public.fn_nivel_modulo(text)'::regprocedure) !~ 'fn_factor_pendiente' then raise exception 'factor: fn_nivel_modulo no consulta fn_factor_pendiente'; end if;
  if to_regprocedure('${GUARDAR_POLITICA_VIEJA}') is not null then raise exception 'factor: la firma vieja de guardar_politica sigue'; end if;
  if not has_function_privilege('authenticated', '${GUARDAR_POLITICA_NUEVA}', 'execute') then raise exception 'factor: authenticated no ejecuta guardar_politica nueva'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'v_politica_acceso' and column_name = 'factorSuperadmin') then raise exception 'factor: v_politica_acceso sin factorSuperadmin'; end if;
  if not has_table_privilege('authenticated', 'public.v_politica_acceso', 'select') then raise exception 'factor: authenticated perdió v_politica_acceso'; end if;
  if not has_function_privilege('authenticated', 'public.mi_segundo_factor()', 'execute') then raise exception 'factor: authenticated no ejecuta mi_segundo_factor'; end if;
  if has_function_privilege('anon', 'public.mi_segundo_factor()', 'execute') then raise exception 'factor: anon ejecuta mi_segundo_factor'; end if;
  if has_function_privilege('authenticated', 'public.fn_factor_pendiente()', 'execute') then raise exception 'factor: authenticated ejecuta fn_factor_pendiente'; end if;
  if exists (select 1 from unnest(array[${lista(FUNCIONES_NUEVAS.filter((f) => f.startsWith("public.api_")))}]) f
             where has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') or not has_function_privilege('service_role', f, 'execute')) then raise exception 'factor: api_factor_* mal concedida'; end if;
  if exists (select 1 from unnest(array[${lista(TABLAS)}]) t
             where to_regclass('interno.' || t) is null or has_table_privilege('authenticated', 'interno.' || t, 'select') or has_table_privilege('anon', 'interno.' || t, 'select')
                or not (select relrowsecurity from pg_class where oid = to_regclass('interno.' || t))) then raise exception 'factor: tabla ausente o abierta a la API'; end if;
  if fn_nivel_modulo('accesos') <> 99 then raise exception 'factor: la sesión de migración (postgres, sin JWT) debería valer 99 y vale %', fn_nivel_modulo('accesos'); end if;
  -- Comportamiento: un superadmin real con JWT y sin marca vale 0 (claims simulados y limpiados aquí mismo).
  select u.correo into v_correo from interno.usuarios_admin u join interno.perfiles p on p.id = u.perfil_id and p.version = u.perfil_version where u.estado = 'activo' and p.es_superadmin order by u.id limit 1;
  if v_correo is not null then
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_correo, 'session_id', '00000000-0000-4000-8000-0000000000fa')::text, true);
    if fn_nivel_modulo('accesos') <> 0 then raise exception 'factor: el superadmin % sin marca debería valer 0', v_correo; end if;
    v := mi_segundo_factor();
    if (v ->> 'exigido')::boolean is not true or (v ->> 'verificado')::boolean is not false then raise exception 'factor: mi_segundo_factor inesperado: %', v; end if;
    perform set_config('request.jwt.claims', '', true);
  end if;
end $$;
commit;
`;

export const REVERSION = `-- supabase/respaldos/${FECHA}-segundo-factor-reversion.sql
-- Reversión del segundo factor: retira funciones y tablas nuevas, restaura
-- fn_nivel_modulo (v3) y guardar_politica (firma vieja) desde
-- interno.respaldo_factor —cuerpo Y el EXECUTE que cada una tenía, leído del
-- ACL respaldado ('acl:…'), no asumido— devuelve v_politica_acceso a su
-- definición anterior y quita la columna del interruptor.
begin;
set local search_path = public, interno, extensions;
${FUNCIONES_NUEVAS.map((f) => `drop function if exists ${f};`).join("\n")}
drop function if exists ${GUARDAR_POLITICA_NUEVA};
do $$ declare r record; v_fn text; v_acl text; begin
  for r in select objeto, definicion from interno.respaldo_factor where objeto like 'fn:%' loop
    execute r.definicion;
    v_fn := substring(r.objeto from 4);
    select definicion into v_acl from interno.respaldo_factor where objeto = 'acl:' || v_fn;
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
    if v_acl ~ 'anon=' then execute format('grant execute on function %s to anon', v_fn); end if;
    if v_acl ~ 'authenticated=' then execute format('grant execute on function %s to authenticated', v_fn); end if;
    if v_acl ~ 'service_role=' then execute format('grant execute on function %s to service_role', v_fn); end if;
  end loop;
end $$;
drop view if exists public.v_politica_acceso;
alter table interno.politica_acceso drop column if exists factor_superadmin;
do $$ declare r record; begin
  select definicion into r from interno.respaldo_factor where objeto = 'view:v_politica_acceso';
  execute 'create view public.v_politica_acceso with (security_invoker = on) as ' || r.definicion;
end $$;
revoke all on public.v_politica_acceso from anon, public;
grant select on public.v_politica_acceso to authenticated, service_role;
drop table if exists ${TABLAS.map((t) => `interno.${t}`).join(", ")};
drop table interno.respaldo_factor;
do $$ begin
  if to_regclass('interno.factor_sesiones') is not null then raise exception 'reversión factor: factor_sesiones sigue existiendo'; end if;
  if (select prosrc from pg_proc where oid = 'public.fn_nivel_modulo(text)'::regprocedure) ~ 'fn_factor_pendiente' then raise exception 'reversión factor: fn_nivel_modulo sigue en v4'; end if;
  if to_regprocedure('${GUARDAR_POLITICA_VIEJA}') is null then raise exception 'reversión factor: guardar_politica vieja no volvió'; end if;
  if to_regprocedure('public.mi_segundo_factor()') is not null then raise exception 'reversión factor: mi_segundo_factor sigue existiendo'; end if;
end $$;
commit;
`;

export const ESPEJO = `-- @@FACTOR-INICIO@@ (generado por scripts/factor-generar.mjs desde supabase/factor.sql; no editar a mano)
-- 15 · Segundo factor por correo para el Superadministrador: nivel 0 hasta verificar la sesión; códigos, marcas y equipos recordados en interno; funciones de servicio para api/segundo-factor.js.
${CANONICO}
-- @@FACTOR-FIN@@`;

export const sinFactor = (texto) => texto.replace(/-- @@FACTOR-INICIO@@[\s\S]*?-- @@FACTOR-FIN@@\n?/g, "");

const esPrincipal = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esPrincipal) {
  writeFileSync(`supabase/migraciones/${FECHA}-segundo-factor.sql`, MIGRACION);
  writeFileSync(`supabase/respaldos/${FECHA}-segundo-factor-reversion.sql`, REVERSION);
  const ruta = "supabase/seguridad.sql";
  const actual = readFileSync(ruta, "utf8");
  const propio = /-- @@FACTOR-INICIO@@[\s\S]*?-- @@FACTOR-FIN@@\n?/;
  writeFileSync(ruta, propio.test(actual) ? actual.replace(propio, () => `${ESPEJO}\n`) : `${actual.replace(/\s+$/, "")}\n\n${ESPEJO}\n`);
  console.log("Generados: migración segundo-factor, reversión y bloque @@FACTOR@@ de seguridad.sql.");
}
