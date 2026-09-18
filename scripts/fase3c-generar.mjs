// scripts/fase3c-generar.mjs — Corrección de seguridad · FASE 3c (claves de
// equipos → puntero al gestor de contraseñas, decisión P5). Canónico:
// supabase/claves-equipos.sql. Genera:
//   supabase/migraciones/2026-09-18-fase3c-claves-equipos.sql (una transacción:
//     precondición, respaldo de definiciones vigentes en interno.respaldo_fase3c,
//     canónico, verificación con comportamiento)
//   supabase/respaldos/2026-09-18-fase3c-reversion.sql
//   bloque @@FASE3C-INICIO@@ … @@FASE3C-FIN@@ de supabase/seguridad.sql
// Uso: node scripts/fase3c-generar.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const FECHA = "2026-09-18";
export const FUNCIONES = ["guardar_clave_equipo(text, text, text)", "ver_clave_equipo(text, text)"];
const CANONICO = readFileSync("supabase/claves-equipos.sql", "utf8");

export const MIGRACION = `-- supabase/migraciones/${FECHA}-fase3c-claves-equipos.sql
-- Corrección de seguridad · FASE 3c — CLAVES DE EQUIPOS (decisión P5: puntero
-- al gestor de contraseñas, no la clave). GENERADA por scripts/fase3c-generar.mjs
-- a partir de supabase/claves-equipos.sql (no editar a mano).
--
-- UNA transacción. Reversión: supabase/respaldos/${FECHA}-fase3c-reversion.sql
-- (ensayo: scripts/ensayar-fase3c.mjs). Requiere la fase 3b aplicada.
-- Sin ventana: el cliente sigue leyendo v_activos (misma vista, una columna más).

begin;
set local search_path = public, interno, extensions;

-- 0 · Precondición: fase 3b aplicada, columna secreta presente y vacía, columna nueva ausente.
do $$
declare n int;
begin
  if to_regclass('interno.datos_bancarios') is null then raise exception 'fase3c: se esperaba la fase 3b aplicada'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'activos' and column_name = 'clave_equipo') then
    raise exception 'fase3c: activos.clave_equipo no existe (¿fase 3c aplicada?)'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'activos' and column_name = 'clave_gestor') then
    raise exception 'fase3c: activos.clave_gestor ya existe'; end if;
  if to_regclass('interno.respaldo_fase3c') is not null then raise exception 'fase3c: interno.respaldo_fase3c ya existe'; end if;
  select count(*) into n from public.activos where clave_equipo is not null;
  if n > 0 then raise exception 'fase3c: % activos con clave guardada: pásalas al gestor de contraseñas y déjalas en null antes', n; end if;
end $$;

-- 1 · Respaldo de lo que cambia (para la reversión exacta).
create table interno.respaldo_fase3c (objeto text primary key, definicion text not null);
revoke all on table interno.respaldo_fase3c from public, anon, authenticated;
insert into interno.respaldo_fase3c
select 'fn:' || p.oid::regprocedure::text, pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('guardar_clave_equipo', 'ver_clave_equipo');
insert into interno.respaldo_fase3c values
  ('view:v_activos', 'create or replace view public.v_activos as ' || pg_get_viewdef('public.v_activos'::regclass, true));

-- 2 · Canónico de la fase (supabase/claves-equipos.sql).
${CANONICO}
-- 3 · Verificación embebida (falla → rollback de toda la transacción).
do $$
declare n int; r text;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'activos' and column_name = 'clave_equipo') then
    raise exception 'fase3c: activos.clave_equipo sigue'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'activos' and column_name = 'clave_gestor') then
    raise exception 'fase3c: falta activos.clave_gestor'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'v_activos' and column_name = 'clave_gestor') then
    raise exception 'fase3c: v_activos no expone clave_gestor'; end if;
  if not ('security_invoker=on' = any(coalesce((select reloptions from pg_class where oid = 'public.v_activos'::regclass), '{}'))) then raise exception 'fase3c: v_activos perdió security_invoker'; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('guardar_clave_equipo', 'ver_clave_equipo') and p.prosrc ~ 'clave_equipo\\M';
  if n <> 0 then raise exception 'fase3c: % funciones siguen nombrando clave_equipo', n; end if;
  select count(*) into n from unnest(array[${FUNCIONES.map((f) => `'${f}'`).join(", ")}]) f
   where not has_function_privilege('authenticated', ('public.' || f)::regprocedure, 'execute');
  if n <> 0 then raise exception 'fase3c: % funciones perdieron el EXECUTE de authenticated', n; end if;
  -- Comportamiento: sin identidad, guardar se niega por la guarda y v_activos devuelve 0 filas.
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"nadie@ejemplo.invalido","sub":"00000000-0000-0000-0000-000000000000"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.v_activos;
  if n <> 0 then execute 'reset role'; raise exception 'fase3c: v_activos devolvió % filas sin identidad', n; end if;
  begin
    perform public.guardar_clave_equipo('ZZ-NADA', 'x', 'verificación');
    execute 'reset role'; raise exception 'fase3c: guardar_clave_equipo no exigió nivel';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
end $$;
commit;
`;

export const REVERSION = `-- supabase/respaldos/${FECHA}-fase3c-reversion.sql
-- Reversión completa de la FASE 3c (GENERADA por scripts/fase3c-generar.mjs):
-- vuelve activos.clave_equipo (vacía: nunca hubo claves), definiciones
-- originales de las funciones y de v_activos desde el respaldo, y se retira
-- clave_gestor (la referencia se pierde; anotar antes si hace falta).
begin;
set local search_path = public, interno, extensions;

alter table activos add column if not exists clave_equipo text;
-- La vista original tiene una columna menos: «create or replace» no puede quitar
-- columnas, así que se recrea (y se devuelven sus permisos: todo a authenticated
-- y service_role, como el resto de vistas de public).
drop view public.v_activos;
do $$
declare r record;
begin
  for r in select definicion from interno.respaldo_fase3c where objeto like 'view:%' loop execute r.definicion; end loop;
  for r in select definicion from interno.respaldo_fase3c where objeto like 'fn:%' order by objeto loop execute r.definicion; end loop;
end $$;
alter view v_activos set (security_invoker = on);
grant all on public.v_activos to authenticated, service_role;
alter table activos drop column if exists clave_gestor;
drop table interno.respaldo_fase3c;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'activos' and column_name = 'clave_equipo') then
    raise exception 'reversión fase3c: falta clave_equipo'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'v_activos' and column_name = 'clave_gestor') then
    raise exception 'reversión fase3c: v_activos sigue exponiendo clave_gestor'; end if;
end $$;
commit;
`;

export const ESPEJO = `-- @@FASE3C-INICIO@@ (generado por scripts/fase3c-generar.mjs desde supabase/claves-equipos.sql; no editar a mano)
-- 11 · Fase 3c: claves de equipos → referencia al gestor de contraseñas (P5); sin columna secreta.
${CANONICO}
-- @@FASE3C-FIN@@`;

// Quita la fase 3c y todas las posteriores (4…): el ensayo parte del estado de la 3b.
export const sinFase3c = (texto) => texto.replace(/-- @@FASE(?:3[C-Z]|[4-9][A-Z]?)-INICIO@@[\s\S]*?-- @@FASE(?:3[C-Z]|[4-9][A-Z]?)-FIN@@\n?/g, "");

const esPrincipal = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esPrincipal) {
  writeFileSync(`supabase/migraciones/${FECHA}-fase3c-claves-equipos.sql`, MIGRACION);
  writeFileSync(`supabase/respaldos/${FECHA}-fase3c-reversion.sql`, REVERSION);
  const ruta = "supabase/seguridad.sql";
  // El generador solo reemplaza SU bloque; los posteriores se conservan.
  const actual = readFileSync(ruta, "utf8");
  const propio = /-- @@FASE3C-INICIO@@[\s\S]*?-- @@FASE3C-FIN@@\n?/;
  writeFileSync(ruta, propio.test(actual) ? actual.replace(propio, () => `${ESPEJO}\n`) : `${actual.replace(/\s+$/, "")}\n\n${ESPEJO}\n`);
  console.log("Generados: migración fase3c, reversión y bloque @@FASE3C@@ de seguridad.sql.");
}
