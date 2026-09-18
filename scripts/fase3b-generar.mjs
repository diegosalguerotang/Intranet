// scripts/fase3b-generar.mjs — Corrección de seguridad · FASE 3b (datos
// bancarios en interno.datos_bancarios). El canónico es supabase/bancario.sql;
// aquí se genera:
//   supabase/migraciones/2026-09-18-fase3b-datos-bancarios.sql (una transacción:
//     precondición, RESPALDO de las definiciones vigentes en interno.respaldo_fase3b,
//     bancario.sql, verificación con comportamiento)
//   supabase/respaldos/2026-09-18-fase3b-reversion.sql (una transacción: columnas
//     de vuelta en personas con los valores descifrados, definiciones originales
//     restauradas desde el respaldo, tabla y ayudantes eliminados)
//   bloque @@FASE3B-INICIO@@ … @@FASE3B-FIN@@ de supabase/seguridad.sql (espejo)
// Uso: node scripts/fase3b-generar.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const FECHA = "2026-09-18";
export const COLUMNAS_PERSONAS = ["cuenta", "cci", "cuenta_cifrada", "cuenta_ultimos4", "banco", "banco_id"];
export const FUNCIONES_REESCRITAS = ["fn_ver_cuenta_bancaria(text)", "alta_trabajador(text, text, text, text, text, date, text, text, text, text, text, text)",
  "editar_trabajador(text, text, text, text, text, text, text, text)", "importar_planilla_unificada(jsonb, text, text, jsonb)"];
export const FUNCIONES_NUEVAS = ["fn_ultimos4(text)", "fn_guardar_datos_bancarios(text, text, text, text, text, boolean, text)", "fn_auditar_datos_bancarios()"];
export const VISTAS = ["v_personal", "v_portal_datos"];
const BANCARIO = readFileSync("supabase/bancario.sql", "utf8");
const lista = (arr) => arr.map((x) => `'${x}'`).join(", ");

const RESPALDO = `-- 1 · Respaldo de lo que cambia (para la reversión exacta, sin depender del repo).
create table interno.respaldo_fase3b (objeto text primary key, definicion text not null);
revoke all on table interno.respaldo_fase3b from public, anon, authenticated;
insert into interno.respaldo_fase3b
select 'fn:' || p.oid::regprocedure::text, pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('fn_ver_cuenta_bancaria', 'alta_trabajador', 'editar_trabajador', 'importar_planilla_unificada');
insert into interno.respaldo_fase3b values
  ('view:v_personal', 'create or replace view public.v_personal as ' || pg_get_viewdef('public.v_personal'::regclass, true)),
  ('view:v_portal_datos', 'create or replace view public.v_portal_datos as ' || pg_get_viewdef('public.v_portal_datos'::regclass, true)),
  ('conteo:personas_con_datos', (select count(*) from public.personas
      where cuenta_cifrada is not null or cuenta is not null or cci is not null or banco is not null or banco_id is not null)::text),
  ('conteo:cci', (select count(*) from public.personas where cci is not null)::text);
`;

export const MIGRACION = `-- supabase/migraciones/${FECHA}-fase3b-datos-bancarios.sql
-- Corrección de seguridad · FASE 3b — DATOS BANCARIOS. GENERADA por
-- scripts/fase3b-generar.mjs a partir de supabase/bancario.sql (no editar a mano).
--
-- UNA transacción. Reversión: supabase/respaldos/${FECHA}-fase3b-reversion.sql
-- (ensayo: scripts/ensayar-fase3b.mjs sobre el entorno de la fase 2.5).
-- Requiere la fase 3a aplicada. Desplegar junto con el commit del BackOffice
-- (Legajo: el CCI sale enmascarado y se ve completo con «Ver cuenta y CCI»).
-- No hay ventana: el cliente sigue leyendo v_personal con las mismas columnas.

begin;
set local search_path = public, interno, extensions;

-- 0 · Precondición: fase 3a aplicada, columnas bancarias aún en personas, tabla nueva inexistente.
do $$
declare n int;
begin
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'interno' and c.relkind = 'r';
  if n < 10 then raise exception 'fase3b: se esperaba la fase 3a aplicada (10 tablas en interno, hay %)', n; end if;
  select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'personas' and column_name in (${lista(COLUMNAS_PERSONAS)});
  if n <> ${COLUMNAS_PERSONAS.length} then raise exception 'fase3b: personas tiene % de las ${COLUMNAS_PERSONAS.length} columnas bancarias (¿fase 3b aplicada?)', n; end if;
  if to_regclass('interno.datos_bancarios') is not null then raise exception 'fase3b: interno.datos_bancarios ya existe'; end if;
  if to_regclass('interno.respaldo_fase3b') is not null then raise exception 'fase3b: interno.respaldo_fase3b ya existe'; end if;
  if to_regprocedure('public.importar_planilla_unificada(jsonb, text, text, jsonb)') is null then raise exception 'fase3b: falta importar_planilla_unificada(jsonb, text, text, jsonb)'; end if;
end $$;

${RESPALDO}
-- 2 · Canónico de la fase (supabase/bancario.sql).
${BANCARIO}
-- 3 · Verificación embebida (falla → rollback de toda la transacción).
do $$
declare n int; esperado int; r jsonb;
begin
  select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'personas' and column_name in (${lista(COLUMNAS_PERSONAS)});
  if n <> 0 then raise exception 'fase3b: personas conserva % columnas bancarias', n; end if;
  select count(*) into n from interno.datos_bancarios;
  select definicion::int into esperado from interno.respaldo_fase3b where objeto = 'conteo:personas_con_datos';
  if n <> esperado then raise exception 'fase3b: datos_bancarios tiene % filas, esperadas %', n, esperado; end if;
  select count(*) into n from interno.datos_bancarios where cci_cifrado is not null;
  select definicion::int into esperado from interno.respaldo_fase3b where objeto = 'conteo:cci';
  if n <> esperado then raise exception 'fase3b: % CCI cifrados, esperados %', n, esperado; end if;
  if not (select relrowsecurity from pg_class where oid = 'interno.datos_bancarios'::regclass) then raise exception 'fase3b: datos_bancarios sin RLS'; end if;
  select count(*) into n from pg_policies where schemaname = 'interno' and tablename = 'datos_bancarios' and policyname = 'lectura_admin' and cmd = 'SELECT';
  if n <> 1 then raise exception 'fase3b: falta lectura_admin en datos_bancarios'; end if;
  if has_table_privilege('anon', 'interno.datos_bancarios', 'select') then raise exception 'fase3b: anon lee datos_bancarios'; end if;
  if has_table_privilege('authenticated', 'interno.datos_bancarios', 'insert') or has_table_privilege('authenticated', 'interno.datos_bancarios', 'update') then
    raise exception 'fase3b: authenticated escribe datos_bancarios'; end if;
  select count(*) into n from unnest(array[${lista(FUNCIONES_NUEVAS)}]) f
   where has_function_privilege('authenticated', ('public.' || f)::regprocedure, 'execute') or has_function_privilege('anon', ('public.' || f)::regprocedure, 'execute');
  if n <> 0 then raise exception 'fase3b: % ayudantes ejecutables por la API', n; end if;
  if not ('security_invoker=on' = any(coalesce((select reloptions from pg_class where oid = 'public.v_personal'::regclass), '{}'))) then raise exception 'fase3b: v_personal perdió security_invoker'; end if;
  if 'security_invoker=on' = any(coalesce((select reloptions from pg_class where oid = 'public.v_portal_datos'::regclass), '{}')) then raise exception 'fase3b: v_portal_datos no debe ser invoker (fase 4)'; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'importar_planilla_unificada' and p.prosrc ~ 'from datos_bancarios where dni = v_canon' and p.prosrc !~ 'cuenta_cifrada = case when v_cuenta_cambio';
  if n <> 1 then raise exception 'fase3b: importar_planilla_unificada no quedó transformada'; end if;
  -- Ninguna vista ni función de public nombra ya las columnas retiradas de personas.
  select count(*) into n from pg_views v where v.schemaname = 'public' and v.definition ~ '\\mp(e)?\\.(cci|cuenta_cifrada|cuenta_ultimos4|banco_id)\\M';
  if n <> 0 then raise exception 'fase3b: % vistas siguen leyendo columnas bancarias de personas', n; end if;
  -- Comportamiento: v_personal responde (máscaras) y una sesión sin identidad ve 0 filas.
  perform count(*) from public.v_personal; perform count(*) from public.v_portal_datos;
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"nadie@ejemplo.invalido","sub":"00000000-0000-0000-0000-000000000000"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.v_personal;
  if n <> 0 then execute 'reset role'; raise exception 'fase3b: v_personal devolvió % filas sin identidad', n; end if;
  r := public.fn_ver_cuenta_bancaria('00000000');
  if r is not null then execute 'reset role'; raise exception 'fase3b: fn_ver_cuenta_bancaria devolvió datos sin permiso'; end if;
  execute 'reset role';
end $$;
commit;
`;

export const REVERSION = `-- supabase/respaldos/${FECHA}-fase3b-reversion.sql
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
  select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'personas' and column_name in (${lista(COLUMNAS_PERSONAS)});
  if n <> ${COLUMNAS_PERSONAS.length} then raise exception 'reversión fase3b: personas tiene % columnas bancarias', n; end if;
  if to_regclass('interno.datos_bancarios') is not null then raise exception 'reversión fase3b: la tabla sigue'; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'importar_planilla_unificada' and p.prosrc ~ 'from datos_bancarios';
  if n <> 0 then raise exception 'reversión fase3b: importar_planilla_unificada sigue transformada'; end if;
end $$;
commit;
`;

export const ESPEJO = `-- @@FASE3B-INICIO@@ (generado por scripts/fase3b-generar.mjs desde supabase/bancario.sql; no editar a mano)
-- 10 · Fase 3b: datos bancarios en interno.datos_bancarios; personas sin columnas bancarias.
${BANCARIO}
-- @@FASE3B-FIN@@`;

// Quita la fase 3b y todas las posteriores (3c, 4…): el ensayo parte del estado de la 3a.
export const sinFase3b = (texto) => texto.replace(/-- @@FASE(?:3[B-Z]|[4-9][A-Z]?)-INICIO@@[\s\S]*?-- @@FASE(?:3[B-Z]|[4-9][A-Z]?)-FIN@@\n?/g, "");

const esPrincipal = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esPrincipal) {
  writeFileSync(`supabase/migraciones/${FECHA}-fase3b-datos-bancarios.sql`, MIGRACION);
  writeFileSync(`supabase/respaldos/${FECHA}-fase3b-reversion.sql`, REVERSION);
  const ruta = "supabase/seguridad.sql";
  // El generador solo reemplaza SU bloque; los posteriores se conservan.
  const actual = readFileSync(ruta, "utf8");
  const propio = /-- @@FASE3B-INICIO@@[\s\S]*?-- @@FASE3B-FIN@@\n?/;
  writeFileSync(ruta, propio.test(actual) ? actual.replace(propio, () => `${ESPEJO}\n`) : `${actual.replace(/\s+$/, "")}\n\n${ESPEJO}\n`);
  console.log("Generados: migración fase3b, reversión y bloque @@FASE3B@@ de seguridad.sql.");
}
