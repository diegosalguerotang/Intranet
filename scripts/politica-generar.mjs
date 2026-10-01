// scripts/politica-generar.mjs — Genera la migración y la reversión de la
// política de datos v3 (2026-10-01): el punto 1 nombra a la razón social de la
// planilla del trabajador (marca {{RESPONSABLE}}, resuelta por sesión).
// El canónico ES supabase/portal.sql: el texto v3, fn_politica_responsable, la
// vista y portal_primer_ingreso se extraen de ahí; los cuerpos VIEJOS (para la
// reversión) salen del commit anterior a la edición (COMMIT_PREVIO).
// El EXECUTE de la función nueva vive en la lista 2b de supabase/seguridad.sql.
// Uso: node scripts/politica-generar.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

export const FECHA = "2026-10-01";
export const COMMIT_PREVIO = "24b646b";
export const MARCA = "{{RESPONSABLE}}";

// Trozo de `texto` desde `inicio` hasta el primer `fin` posterior (incluido).
export function entre(texto, inicio, fin) {
  const a = texto.indexOf(inicio);
  if (a < 0) throw new Error(`no se encontró «${inicio}»`);
  const b = texto.indexOf(fin, a);
  if (b < 0) throw new Error(`no se encontró el cierre «${fin}» de «${inicio}»`);
  return texto.slice(a, b + fin.length);
}

// Producción lleva 'public, interno, extensions' (fase 3a); el canónico de
// portal.sql fija 'public, extensions' y el bloque FASE3 lo amplía. split/join,
// nunca String.replace: los $$ del reemplazo se convertirían en $.
const conInterno = (sql) => sql
  .split("set search_path = public, extensions as $$")
  .join("set search_path = public, interno, extensions as $$");
// create or replace view SIN «with» borraría security_invoker: se declara.
const vistaReemplazable = (sql) => sql
  .split("create view v_declaraciones_vigentes as")
  .join("create or replace view public.v_declaraciones_vigentes with (security_invoker = on) as");

const leer = (ruta) => readFileSync(ruta, "utf8").replace(/\r\n/g, "\n");
const nuevo = leer("supabase/portal.sql");
const viejo = execFileSync("git", ["show", `${COMMIT_PREVIO}:supabase/portal.sql`], { encoding: "utf8" }).replace(/\r\n/g, "\n");

const TEXTO_V3 = entre(nuevo, "insert into declaraciones (id, version, superficie, texto) values\n('politica-datos', 3, 'portal',", "on conflict (id, version) do nothing;");
const FN_RESPONSABLE = (t) => entre(t, "create or replace function fn_politica_responsable()", "\n$$;");
const VISTA = (t) => entre(t, "create view v_declaraciones_vigentes as", "order by id, version desc;");
const PRIMER_INGRESO = (t) => entre(t, "create or replace function portal_primer_ingreso(", "\nend $$;");

const VERIFICACION = `
-- Verificación embebida: el texto v3 lleva la marca una sola vez; la función
-- nueva NO es definer y solo la ejecuta authenticated; la vista sigue como
-- security_invoker y legible; portal_primer_ingreso sigue definer con
-- search_path fijo, ejecutable por authenticated, y resuelve la marca.
do $v$
declare t text; f pg_proc; p pg_proc;
begin
  select texto into t from declaraciones where id = 'politica-datos' and version = 3;
  if t is null or array_length(string_to_array(t, '${MARCA}'), 1) <> 2 then
    raise exception 'politica: falta la versión 3 o no lleva la marca exactamente una vez';
  end if;
  select * into f from pg_proc where oid = 'public.fn_politica_responsable()'::regprocedure;
  if f.prosecdef then raise exception 'politica: fn_politica_responsable no debe ser security definer'; end if;
  if has_function_privilege('anon', f.oid, 'execute') or not has_function_privilege('authenticated', f.oid, 'execute') then
    raise exception 'politica: privilegios incorrectos en fn_politica_responsable';
  end if;
  if not exists (select 1 from pg_class c, unnest(coalesce(c.reloptions, '{}')) o
                 where c.oid = 'public.v_declaraciones_vigentes'::regclass and o in ('security_invoker=on', 'security_invoker=true'))
     or not has_table_privilege('authenticated', 'public.v_declaraciones_vigentes', 'select')
     or has_table_privilege('anon', 'public.v_declaraciones_vigentes', 'select') then
    raise exception 'politica: v_declaraciones_vigentes perdió security_invoker o sus privilegios';
  end if;
  select * into p from pg_proc where oid = 'public.portal_primer_ingreso(text, boolean, integer, text)'::regprocedure;
  if not p.prosecdef or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
     or p.prosrc !~ 'fn_politica_responsable' or not has_function_privilege('authenticated', p.oid, 'execute')
     or has_function_privilege('anon', p.oid, 'execute') then
    raise exception 'politica: portal_primer_ingreso no quedó como se esperaba';
  end if;
end $v$;
`;

export const MIGRACION = `-- supabase/migraciones/${FECHA}-politica-razon-social.sql
-- Generado por scripts/politica-generar.mjs desde supabase/portal.sql (no editar a mano).
-- Una transacción. Reversión: supabase/respaldos/${FECHA}-politica-razon-social-reversion.sql.
-- Aplica DIEGO con \`!\`:  node scripts/aplicar-sql.mjs supabase/migraciones/${FECHA}-politica-razon-social.sql
-- Política de datos v3: el punto 1 nombra a la razón social de la planilla del
-- trabajador («RAZÓN SOCIAL (RUC n)»). La v2 y sus consentimientos no se tocan;
-- los primeros ingresos posteriores aceptan la v3 con su razón social dentro del
-- texto guardado. Idempotente (on conflict do nothing / create or replace).
begin;
set local search_path = public, interno, extensions;

-- 1 · Texto v3 (plantilla con la marca ${MARCA}).
${TEXTO_V3}

-- 2 · Quién es el responsable para la sesión del portal (no es definer: RLS).
${conInterno(FN_RESPONSABLE(nuevo))}
revoke execute on function fn_politica_responsable() from public, anon;
grant execute on function fn_politica_responsable() to authenticated;

-- 3 · La vista entrega el texto ya resuelto (mismas columnas; privilegios intactos).
${vistaReemplazable(VISTA(nuevo))}

-- 4 · El primer ingreso guarda en consentimientos el texto resuelto, no la plantilla.
${conInterno(PRIMER_INGRESO(nuevo))}
${VERIFICACION}
commit;
`;

export const REVERSION = `-- supabase/respaldos/${FECHA}-politica-razon-social-reversion.sql — deshace la migración del mismo nombre.
-- Restaura la vista y portal_primer_ingreso (commit ${COMMIT_PREVIO}), quita la función y la versión 3.
-- Se NIEGA si ya hay consentimientos de la versión 3: esos registros son inmutables y
-- apuntan a ese texto; en ese caso lo correcto es publicar una versión 4.
begin;
set local search_path = public, interno, extensions;

do $r$
begin
  if exists (select 1 from consentimientos where declaracion_id = 'politica-datos' and version = 3) then
    raise exception 'politica: ya hay consentimientos de la versión 3; no se revierte (publica una versión 4)';
  end if;
end $r$;

${conInterno(PRIMER_INGRESO(viejo))}

${vistaReemplazable(VISTA(viejo))}

drop function if exists public.fn_politica_responsable();
delete from declaraciones where id = 'politica-datos' and version = 3;
commit;
`;

if (process.argv[1] && /politica-generar\.mjs$/.test(process.argv[1])) {
  writeFileSync(`supabase/migraciones/${FECHA}-politica-razon-social.sql`, MIGRACION);
  writeFileSync(`supabase/respaldos/${FECHA}-politica-razon-social-reversion.sql`, REVERSION);
  console.log("Generados: migración politica-razon-social y reversión.");
}
