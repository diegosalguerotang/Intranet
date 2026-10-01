// scripts/arreglos-generar.mjs — Genera la migración y la reversión de los dos
// arreglos del 2026-09-30 (spec docs/superpowers/specs/2026-09-30-arreglos-asistencia-boletas-limpieza-design.md):
//   · importar_asistencia: el reloj ya no borra el control semanal.
//   · publicar_lote_pdf: un lote idéntico ya publicado se devuelve (lotes.huella).
// El canónico ES supabase/schema.sql: las funciones NUEVAS se extraen de ahí y
// las VIEJAS (para la reversión) del commit anterior a la edición (COMMIT_PREVIO).
// No hay bloque en seguridad.sql: ningún bloque posterior redefine estas funciones.
// Uso: node scripts/arreglos-generar.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

export const FECHA = "2026-09-30";
export const COMMIT_PREVIO = "e672fe7";
const FUNCIONES = ["importar_asistencia", "publicar_lote_pdf"];

// Extrae `create function <nombre>(` … `end $$;` de un texto SQL.
export function extraer(texto, nombre) {
  const inicio = texto.indexOf(`create function ${nombre}(`);
  if (inicio < 0) throw new Error(`no se encontró create function ${nombre}(`);
  const fin = texto.indexOf("\nend $$;", inicio);
  if (fin < 0) throw new Error(`no se encontró el cierre de ${nombre}`);
  return texto.slice(inicio, fin + "\nend $$;".length).replace("create function", "create or replace function");
}

// Los cuerpos viejos no fijaban search_path (lo ponía el bloque de hardening);
// la reversión lo fija para no dejar una definer sin él. split/join, nunca
// String.replace: los $$ del reemplazo se convertirían en $.
const conSearchPath = (fn) => fn
  .split(") returns jsonb language plpgsql security definer as $$")
  .join(") returns jsonb language plpgsql security definer set search_path = public, interno, extensions as $$");

const nuevo = readFileSync("supabase/schema.sql", "utf8");
const viejo = execFileSync("git", ["show", `${COMMIT_PREVIO}:supabase/schema.sql`], { encoding: "utf8" });

const VERIFICACION = `
-- Verificación embebida: la columna existe; las funciones son definer con
-- search_path fijo y contienen las marcas del arreglo.
do $v$
declare a text; p text;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'lotes' and column_name = 'huella') then
    raise exception 'arreglos: falta lotes.huella';
  end if;
  select prosrc into a from pg_proc where oid = 'public.importar_asistencia(text, jsonb, text, jsonb, text)'::regprocedure;
  select prosrc into p from pg_proc where oid = 'public.publicar_lote_pdf(text, text, text, text, jsonb)'::regprocedure;
  if a !~ 'origen = ''reloj''' or a !~ 'on conflict \\(empresa_id, documento, fecha\\) do nothing' then
    raise exception 'arreglos: importar_asistencia no lleva el filtro por origen';
  end if;
  if p !~ 'huella' or p !~ 'repetido' then
    raise exception 'arreglos: publicar_lote_pdf no lleva la huella';
  end if;
  if exists (select 1 from pg_proc where oid in ('public.importar_asistencia(text, jsonb, text, jsonb, text)'::regprocedure, 'public.publicar_lote_pdf(text, text, text, text, jsonb)'::regprocedure)
             and (not prosecdef or not exists (select 1 from unnest(proconfig) c where c like 'search_path=%'))) then
    raise exception 'arreglos: definer o search_path perdidos';
  end if;
end $v$;
`;

export const MIGRACION = `-- supabase/migraciones/${FECHA}-arreglos-asistencia-boletas.sql
-- Generado por scripts/arreglos-generar.mjs desde supabase/schema.sql (no editar a mano).
-- Una transacción. Reversión: supabase/respaldos/${FECHA}-arreglos-asistencia-boletas-reversion.sql.
-- Aplica DIEGO con \`!\`:  node scripts/aplicar-sql.mjs supabase/migraciones/${FECHA}-arreglos-asistencia-boletas.sql
-- (A) importar_asistencia: el DELETE por rango solo toca origen = 'reloj' y el
--     INSERT no pisa filas del control semanal. (B) lotes.huella + publicar_lote_pdf
--     devuelve el lote idéntico ya publicado en vez de crear otra versión.
-- No toca datos ni privilegios (create or replace conserva los grants).
begin;
set local search_path = public, interno, extensions;

alter table lotes add column if not exists huella text;
comment on column lotes.huella is 'SHA-256 de los pares dni:hash ordenados del lote; nulo en lotes anteriores al 2026-09-30.';

${FUNCIONES.map((f) => extraer(nuevo, f)).join("\n\n")}
${VERIFICACION}
commit;
`;

export const REVERSION = `-- supabase/respaldos/${FECHA}-arreglos-asistencia-boletas-reversion.sql — deshace la migración del mismo nombre.
-- Restaura los cuerpos anteriores (commit ${COMMIT_PREVIO}) y quita lotes.huella.
begin;
set local search_path = public, interno, extensions;

${FUNCIONES.map((f) => conSearchPath(extraer(viejo, f))).join("\n\n")}

alter table lotes drop column if exists huella;
commit;
`;

if (process.argv[1] && /arreglos-generar\.mjs$/.test(process.argv[1])) {
  writeFileSync(`supabase/migraciones/${FECHA}-arreglos-asistencia-boletas.sql`, MIGRACION);
  writeFileSync(`supabase/respaldos/${FECHA}-arreglos-asistencia-boletas-reversion.sql`, REVERSION);
  console.log("Generados: migración arreglos-asistencia-boletas y reversión.");
}
