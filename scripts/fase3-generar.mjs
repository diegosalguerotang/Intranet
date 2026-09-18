// scripts/fase3-generar.mjs — Corrección de seguridad · FASE 3a (esquema
// privado `interno`). ÚNICA fuente de la lista de tablas que se mueven y del
// cambio de search_path. Genera DOS migraciones (cada una en una transacción)
// para que el despliegue no tenga ventana sin servicio:
//   1) supabase/migraciones/2026-09-18-fase3a1-funciones-servicio.sql
//      crea las funciones de servicio para la API (supabase/api-servicio.sql).
//      Con las tablas aún en public funcionan igual → se despliega api/*.js.
//   2) supabase/migraciones/2026-09-18-fase3a2-esquema-interno.sql
//      crea el esquema, mueve las tablas, amplía search_path y re-califica cuerpos.
// Reversiones: supabase/respaldos/2026-09-18-fase3a2-reversion.sql (tablas de
// vuelta) y 2026-09-18-fase3a1-reversion.sql (quita las funciones; exige volver
// al código anterior de api/*.js). Espejo: bloque @@FASE3@@ de seguridad.sql.
// Uso: node scripts/fase3-generar.mjs
//
// Diseño (docs/seguridad/2026-09-18-fase3a-esquema-interno.md):
//  · PostgREST publica solo public y graphql_public: lo que vive en `interno`
//    no existe para el navegador ni para la llave de servicio por /rest/v1/<tabla>.
//  · Las tablas se mueven con ALTER TABLE … SET SCHEMA: conservan datos, ACL,
//    RLS y políticas (lectura_admin de la fase 2), disparadores, índices y
//    secuencias. Las vistas están ligadas por OID y siguen funcionando.
//  · Las funciones resuelven nombres por search_path en tiempo de ejecución:
//    TODAS las funciones de public pasan a `public, interno, …` (las 20 que no
//    fijaban search_path lo fijan ahora). Los cuerpos que nombran una tabla
//    con esquema explícito (es_admin_activo: public.usuarios_admin) se
//    re-crean con interno.<tabla>.
//  · authenticated conserva USAGE en `interno` porque las 9 vistas con
//    security_invoker (fase 2) leen esas tablas con sus permisos; la fila la
//    sigue decidiendo RLS (dos capas, decisión P3). anon y PUBLIC: nada.
//  · La API serverless usa las funciones de servicio (solo service_role) en
//    lugar de leer/escribir las tablas por PostgREST.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const FECHA = "2026-09-18";
export const ESQUEMA = "interno";
// Lo que pide el prompt: usuarios administrativos, categorías y sus versiones,
// auditoría, registro de accesos y parámetros de seguridad. Además
// correo_tokens (tokens de un solo uso: secretos) y las tablas satélite de las
// categorías (propuestas y reglas por cargo). Datos bancarios y claves de
// equipos van en 3b y 3c (son columnas de personas/activos, no tablas).
export const TABLAS = [
  "usuarios_admin", "perfiles", "perfil_permisos", "perfil_empresas", "perfil_propuestas", "cargo_perfiles",
  "registro_accesos", "politica_acceso", "auditoria", "correo_tokens",
];
// correo_tokens no está bajo ninguna vista: la fase 2 no le puso lectura_admin
// (RLS activa sin política = nadie salvo las funciones de servicio, definer).
export const TABLAS_CON_LECTURA_ADMIN = TABLAS.filter((t) => t !== "correo_tokens");
export const FUNCIONES_SERVICIO = [
  "api_admin_por_correo(text, boolean)", "api_admin_por_id(bigint)", "api_admin_marcar_clave(bigint, text, boolean)",
  "api_token_crear(text, text, text, text, timestamptz)", "api_token_leer(text, text[])", "api_token_usar(text)",
];
export const VISTAS_DEPENDIENTES = ["v_usuarios_admin", "v_perfiles", "v_perfil_versiones", "v_registro_accesos", "v_politica_acceso", "v_mi_acceso", "v_cargo_perfiles", "v_perfil_propuestas", "v_actividad_persona"];
const lista = (arr) => arr.map((x) => `'${x}'`).join(", ");
const API_SERVICIO = readFileSync("supabase/api-servicio.sql", "utf8");

// search_path: 'public, extensions' → 'public, interno, extensions'; 'public, auth' → 'public, interno, auth';
// sin config → 'public, interno, extensions'. Idempotente (no duplica interno).
const SQL_SEARCH_PATH = `do $$
declare r record; actual text; nuevo text;
begin
  for r in select p.oid::regprocedure as firma, p.proconfig as cfg
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'
  loop
    select substr(c, length('search_path=') + 1) into actual from unnest(coalesce(r.cfg, '{}')) c where c like 'search_path=%' limit 1;
    if actual is not null and actual like '%${ESQUEMA}%' then continue; end if;
    nuevo := case when actual is null then 'public, ${ESQUEMA}, extensions'
                  when actual ~ '^\\s*public\\s*,' then regexp_replace(actual, '^\\s*public\\s*,', 'public, ${ESQUEMA},')
                  else 'public, ${ESQUEMA}, ' || actual end;
    execute format('alter function %s set search_path = %s', r.firma, nuevo);
  end loop;
end $$;`;

// Re-crea las funciones cuyo cuerpo nombra alguna tabla movida con esquema
// explícito ('<de>.<tabla>' → '<a>.<tabla>'). pg_get_functiondef trae dueño,
// search_path y cuerpo; CREATE OR REPLACE conserva los permisos.
const SQL_RECALIFICAR = (de, a) => `do $$
declare r record;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f'
              and p.prosrc ~ '\\m${de}\\.(${TABLAS.join("|")})\\M'
  loop
    execute regexp_replace(pg_get_functiondef(r.oid), '\\m${de}\\.(${TABLAS.join("|")})\\M', '${a}.\\1', 'g');
  end loop;
end $$;`;

const PRUEBA_FUNCIONES_SERVICIO = `  select count(*) into n from unnest(array[${lista(FUNCIONES_SERVICIO)}]) f
   where has_function_privilege('authenticated', ('public.' || f)::regprocedure, 'execute')
      or has_function_privilege('anon', ('public.' || f)::regprocedure, 'execute')
      or not has_function_privilege('service_role', ('public.' || f)::regprocedure, 'execute');
  if n <> 0 then raise exception 'fase3a: % funciones de servicio con permisos incorrectos', n; end if;`;

const CUERPO = `-- 1 · Esquema privado: existe, no lo publica PostgREST (db_schema = public, graphql_public)
--     y solo authenticated (vistas security_invoker) y service_role pueden resolver nombres en él.
create schema if not exists ${ESQUEMA};
revoke all on schema ${ESQUEMA} from public, anon;
grant usage on schema ${ESQUEMA} to authenticated, service_role;

-- 2 · Mover las ${TABLAS.length} tablas (datos, ACL, RLS, políticas, disparadores, índices y secuencias viajan con ellas).
${TABLAS.map((t) => `alter table public.${t} set schema ${ESQUEMA};`).join("\n")}

-- 3 · search_path de TODAS las funciones de public: 'public, ${ESQUEMA}, …'.
${SQL_SEARCH_PATH}

-- 3b · Cuerpos que nombran las tablas con esquema explícito (public.usuarios_admin…)
--      no resuelven por search_path: se re-crean con ${ESQUEMA}.<tabla> (permisos y dueño se conservan).
${SQL_RECALIFICAR("public", ESQUEMA)}
`;

export const MIGRACION_SERVICIO = `-- supabase/migraciones/${FECHA}-fase3a1-funciones-servicio.sql
-- Corrección de seguridad · FASE 3a, paso 1 — FUNCIONES DE SERVICIO para la API.
-- GENERADA por scripts/fase3-generar.mjs a partir de supabase/api-servicio.sql.
--
-- UNA transacción. Reversión: supabase/respaldos/${FECHA}-fase3a1-reversion.sql.
-- Requiere las fases 0, 0b, 1 y 2 aplicadas.
-- ORDEN DE DESPLIEGUE sin ventana: 1) esta migración (las funciones leen las
-- tablas donde estén: search_path public, interno); 2) desplegar api/*.js, que
-- ya solo usa estas funciones; 3) la migración fase3a2 (mover las tablas).

begin;
set local search_path = public, extensions;

do $$
declare n int;
begin
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'v' and 'security_invoker=on' = any(coalesce(c.reloptions, '{}'));
  if n <> 38 then raise exception 'fase3a1: se esperaba la fase 2 aplicada (38 vistas security_invoker, hay %)', n; end if;
end $$;

${API_SERVICIO}
do $$
declare n int;
begin
${PRUEBA_FUNCIONES_SERVICIO}
end $$;
commit;
`;

export const MIGRACION_ESQUEMA = `-- supabase/migraciones/${FECHA}-fase3a2-esquema-interno.sql
-- Corrección de seguridad · FASE 3a, paso 2 — ESQUEMA PRIVADO. GENERADA por
-- scripts/fase3-generar.mjs (la lista de tablas vive ahí; no editar a mano).
--
-- UNA transacción. Reversión: supabase/respaldos/${FECHA}-fase3a2-reversion.sql
-- (ensayo: scripts/ensayar-fase3a.mjs sobre el entorno de la fase 2.5).
-- Requiere fase3a1 aplicada Y api/*.js desplegado con las funciones de servicio.
--
-- Qué hace: crea el esquema ${ESQUEMA} (no publicado por PostgREST), mueve
-- ${TABLAS.length} tablas, amplía el search_path de todas las funciones, re-califica
-- los cuerpos con esquema explícito y verifica.

begin;
set local search_path = public, extensions;

-- 0 · Precondición: fase3a1 aplicada (funciones de servicio) y esquema ${ESQUEMA} inexistente.
do $$
declare n int;
begin
  select count(*) into n from unnest(array[${lista(FUNCIONES_SERVICIO)}]) f where to_regprocedure('public.' || f) is not null;
  if n <> ${FUNCIONES_SERVICIO.length} then raise exception 'fase3a2: faltan funciones de servicio (fase3a1): %/${FUNCIONES_SERVICIO.length}', n; end if;
  if exists (select 1 from pg_namespace where nspname = '${ESQUEMA}') then raise exception 'fase3a2: el esquema ${ESQUEMA} ya existe (¿fase 3a aplicada?)'; end if;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r' and c.relname in (${lista(TABLAS)});
  if n <> ${TABLAS.length} then raise exception 'fase3a2: se esperaban ${TABLAS.length} tablas en public, hay %', n; end if;
end $$;

${CUERPO}
-- 4 · Verificación embebida (falla → rollback de toda la transacción).
do $$
declare n int; l text;
begin
  select string_agg(c.relname, ',' order by c.relname) into l from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = '${ESQUEMA}' and c.relkind = 'r';
  if l is distinct from '${[...TABLAS].sort().join(",")}' then raise exception 'fase3a2: tablas en ${ESQUEMA} distintas de las esperadas: %', l; end if;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r' and c.relname in (${lista(TABLAS)});
  if n <> 0 then raise exception 'fase3a2: % tablas siguen en public', n; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prokind = 'f'
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%' and c like '%${ESQUEMA}%');
  if n <> 0 then raise exception 'fase3a2: % funciones de public sin ${ESQUEMA} en search_path', n; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prokind = 'f' and p.prosrc ~ '\\mpublic\\.(${TABLAS.join("|")})\\M';
  if n <> 0 then raise exception 'fase3a2: % funciones siguen nombrando public.<tabla movida>', n; end if;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = '${ESQUEMA}' and c.relkind = 'r' and not c.relrowsecurity;
  if n <> 0 then raise exception 'fase3a2: % tablas de ${ESQUEMA} sin RLS', n; end if;
  select count(*) into n from pg_policies where schemaname = '${ESQUEMA}' and policyname = 'lectura_admin';
  if n <> ${TABLAS_CON_LECTURA_ADMIN.length} then raise exception 'fase3a2: % políticas lectura_admin en ${ESQUEMA}, esperadas ${TABLAS_CON_LECTURA_ADMIN.length}', n; end if;
  if has_schema_privilege('anon', '${ESQUEMA}', 'usage') then raise exception 'fase3a2: anon tiene USAGE en ${ESQUEMA}'; end if;
  if not has_schema_privilege('authenticated', '${ESQUEMA}', 'usage') or not has_schema_privilege('service_role', '${ESQUEMA}', 'usage') then
    raise exception 'fase3a2: authenticated/service_role sin USAGE en ${ESQUEMA}'; end if;
${PRUEBA_FUNCIONES_SERVICIO}
  -- Las 9 vistas que dependen de las tablas movidas siguen vivas.
${VISTAS_DEPENDIENTES.map((v) => `  perform count(*) from public.${v};`).join("\n")}
  -- Comportamiento: sin identidad, nada; el login anónimo sigue resolviendo (lee ${ESQUEMA} vía definer);
  -- la función de servicio resuelve la tabla movida.
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"nadie@ejemplo.invalido","sub":"00000000-0000-0000-0000-000000000000"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.v_usuarios_admin;
  if n <> 0 then execute 'reset role'; raise exception 'fase3a2: v_usuarios_admin devolvió % filas a una sesión sin identidad', n; end if;
  if public.es_admin() then execute 'reset role'; raise exception 'fase3a2: es_admin() verdadero sin identidad'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  perform public.verificar_bloqueo('nadie@ejemplo.invalido');
  execute 'reset role';
  perform public.api_admin_por_correo('nadie@ejemplo.invalido', true);
end $$;
commit;
`;

export const REVERSION_ESQUEMA = `-- supabase/respaldos/${FECHA}-fase3a2-reversion.sql
-- Reversión del paso 2 de la FASE 3a (GENERADA por scripts/fase3-generar.mjs):
-- tablas de vuelta a public, search_path y cuerpos como antes, sin esquema
-- ${ESQUEMA}. Las funciones de servicio siguen (las quita fase3a1-reversion.sql).
begin;
set local search_path = public, extensions;

${TABLAS.map((t) => `alter table ${ESQUEMA}.${t} set schema public;`).join("\n")}

do $$
declare r record; actual text; nuevo text;
begin
  for r in select p.oid::regprocedure as firma, p.proconfig as cfg
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'
  loop
    select substr(c, length('search_path=') + 1) into actual from unnest(coalesce(r.cfg, '{}')) c where c like 'search_path=%' limit 1;
    if actual is null or actual not like '%${ESQUEMA}%' then continue; end if;
    nuevo := regexp_replace(actual, ',\\s*${ESQUEMA}\\s*', '', 'g');
    execute format('alter function %s set search_path = %s', r.firma, nuevo);
  end loop;
end $$;
-- Las funciones que no fijaban search_path antes de la fase 3a (disparadores y
-- auxiliares) quedan con 'public, extensions': más estricto que antes, mismo
-- comportamiento; la foto del ensayo lo normaliza explícitamente.

-- Cuerpos re-calificados en la fase 3a: vuelven a nombrar public.<tabla>.
${SQL_RECALIFICAR(ESQUEMA, "public")}

drop schema ${ESQUEMA};

do $$
declare n int;
begin
  if exists (select 1 from pg_namespace where nspname = '${ESQUEMA}') then raise exception 'reversión fase3a2: el esquema sigue'; end if;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r' and c.relname in (${lista(TABLAS)});
  if n <> ${TABLAS.length} then raise exception 'reversión fase3a2: % tablas en public, esperadas ${TABLAS.length}', n; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%' and c like '%${ESQUEMA}%');
  if n <> 0 then raise exception 'reversión fase3a2: % funciones aún con ${ESQUEMA} en search_path', n; end if;
end $$;
commit;
`;

export const REVERSION_SERVICIO = `-- supabase/respaldos/${FECHA}-fase3a1-reversion.sql
-- Reversión del paso 1 de la FASE 3a: quita las funciones de servicio. Solo
-- tiene sentido con el código anterior de api/*.js desplegado (lee las tablas
-- por PostgREST) y con fase3a2 ya revertida.
begin;
${FUNCIONES_SERVICIO.map((f) => `drop function if exists public.${f};`).join("\n")}
commit;
`;

export const ESPEJO = `-- @@FASE3-INICIO@@ (generado por scripts/fase3-generar.mjs; no editar a mano)
-- 9 · Fase 3a: esquema privado ${ESQUEMA} con ${TABLAS.length} tablas; search_path de todas las
--     funciones ampliado; cuerpos con esquema explícito re-calificados. Las
--     funciones de servicio están en el canónico api-servicio.sql.
${CUERPO}-- @@FASE3-FIN@@`;

// Quita la fase 3a y todas las posteriores (3b, 4…): el ensayo parte del estado de la fase 2.
export const sinFase3 = (texto) => texto.replace(/-- @@FASE(?:3[A-Z]?|[4-9][A-Z]?)-INICIO@@[\s\S]*?-- @@FASE(?:3[A-Z]?|[4-9][A-Z]?)-FIN@@\n?/g, "");

const esPrincipal = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esPrincipal) {
  writeFileSync(`supabase/migraciones/${FECHA}-fase3a1-funciones-servicio.sql`, MIGRACION_SERVICIO);
  writeFileSync(`supabase/migraciones/${FECHA}-fase3a2-esquema-interno.sql`, MIGRACION_ESQUEMA);
  writeFileSync(`supabase/respaldos/${FECHA}-fase3a2-reversion.sql`, REVERSION_ESQUEMA);
  writeFileSync(`supabase/respaldos/${FECHA}-fase3a1-reversion.sql`, REVERSION_SERVICIO);
  const ruta = "supabase/seguridad.sql";
  // El generador solo reemplaza SU bloque; los posteriores (3b…) se conservan y
  // quedan detrás porque cada generador re-anexa el suyo al final en orden.
  const actual = readFileSync(ruta, "utf8");
  const propio = /-- @@FASE3-INICIO@@[\s\S]*?-- @@FASE3-FIN@@\n?/;
  const texto = propio.test(actual) ? actual.replace(propio, `${ESPEJO}\n`) : `${actual.replace(/\s+$/, "")}\n\n${ESPEJO}\n`;
  writeFileSync(ruta, texto);
  console.log(`Generados: fase3a1 (${FUNCIONES_SERVICIO.length} funciones de servicio), fase3a2 (${TABLAS.length} tablas → ${ESQUEMA}), 2 reversiones y bloque de seguridad.sql.`);
}
