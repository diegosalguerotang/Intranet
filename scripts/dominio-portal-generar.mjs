// scripts/dominio-portal-generar.mjs — Genera la migración, la reversión y el
// bloque @@DOMINIO@@ del cambio de dominio técnico de las cuentas del Portal
// (2026-10-07): dni@portal.grupoer.pe → dni@portal.servicios-intranet.net.
// Los canónicos SON supabase/portal.sql (portal_dni) y supabase/limites.sql
// (portal_registrar_ingreso, api_login_permitido, api_login_registrar); los
// cuerpos VIEJOS (reversión) salen del commit anterior a la edición. El bloque
// @@FASE6@@ de seguridad.sql y su migración histórica NO se tocan: el bloque
// @@DOMINIO@@, al final, pisa esas cuatro definiciones con el dominio nuevo.
// Uso: node scripts/dominio-portal-generar.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { entre } from "./politica-generar.mjs";

export const FECHA = "2026-10-07";
export const COMMIT_PREVIO = "44097c5";
export const DOMINIO_VIEJO = "portal.grupoer.pe";
export const DOMINIO_NUEVO = "portal.servicios-intranet.net";

const leer = (ruta) => readFileSync(ruta, "utf8").replace(/\r\n/g, "\n");
const deGit = (ruta) => execFileSync("git", ["show", `${COMMIT_PREVIO}:${ruta}`], { encoding: "utf8" }).replace(/\r\n/g, "\n");

// portal_dni en el canon es `language sql stable as $$`; producción la tiene
// definer con search_path fijo (fase 0 + fase 3a). create or replace pierde
// los atributos: se declaran. split/join, nunca String.replace (los $$).
const SP = "security definer set search_path = public, interno, extensions";
const portalDni = (texto) => entre(texto, "create or replace function portal_dni()", "\n$$;")
  .split("returns text language sql stable as $$").join(`returns text language sql stable ${SP} as $$`);
const deLimites = (texto, nombre) => entre(texto, `create or replace function public.${nombre}(`, "\nend $$;");
const LIMITES = ["portal_registrar_ingreso", "api_login_permitido", "api_login_registrar"];

const cuerpos = (portal, limites) => [portalDni(portal), ...LIMITES.map((n) => deLimites(limites, n))].join("\n\n");
const NUEVO = cuerpos(leer("supabase/portal.sql"), leer("supabase/limites.sql"));
const VIEJO = cuerpos(deGit("supabase/portal.sql"), deGit("supabase/limites.sql"));
if (NUEVO.includes(DOMINIO_VIEJO)) throw new Error("el canon nuevo aún nombra el dominio viejo");
if (!VIEJO.includes(DOMINIO_VIEJO) || VIEJO.includes(DOMINIO_NUEVO)) throw new Error(`el commit ${COMMIT_PREVIO} no tiene los cuerpos viejos esperados`);

const FIRMAS = [
  "public.portal_dni()",
  "public.portal_registrar_ingreso(text, text, text)",
  "public.api_login_permitido(text, text)",
  "public.api_login_registrar(text, text, text, text)",
];

const verificacion = (dominio, otro) => `
-- Verificación embebida: las cuatro funciones nombran solo el dominio ${dominio},
-- siguen definer con search_path fijo y conservan sus privilegios.
do $v$
declare f text; p pg_proc;
begin
  foreach f in array array[${FIRMAS.map((x) => `'${x}'`).join(", ")}] loop
    select * into p from pg_proc where oid = f::regprocedure;
    if p.prosrc !~ '${dominio.replace(/\./g, "\\.")}' or p.prosrc ~ '${otro.replace(/\./g, "\\.")}' then
      raise exception 'dominio-portal: % no quedó con el dominio ${dominio}', f;
    end if;
    if not p.prosecdef or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%') then
      raise exception 'dominio-portal: % perdió definer o search_path', f;
    end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.portal_dni()', 'execute') or has_function_privilege('anon', 'public.portal_dni()', 'execute')
     or not has_function_privilege('anon', 'public.portal_registrar_ingreso(text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.api_login_permitido(text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.api_login_registrar(text, text, text, text)', 'execute')
     or not has_function_privilege('service_role', 'public.api_login_registrar(text, text, text, text)', 'execute') then
    raise exception 'dominio-portal: los privilegios no quedaron como se esperaba';
  end if;
end $v$;
`;

export const MIGRACION = `-- supabase/migraciones/${FECHA}-dominio-portal.sql
-- Generado por scripts/dominio-portal-generar.mjs desde supabase/portal.sql y
-- supabase/limites.sql (no editar a mano). Una transacción.
-- Reversión: supabase/respaldos/${FECHA}-dominio-portal-reversion.sql.
-- Aplica DIEGO con \`!\`:  node scripts/aplicar-sql.mjs supabase/migraciones/${FECHA}-dominio-portal.sql
-- Dominio técnico de las cuentas del Portal: dni@${DOMINIO_VIEJO} → dni@${DOMINIO_NUEVO}.
-- Las cuentas de auth.users las renombra scripts/migrar-dominio-portal.mjs
-- (--aplicar) inmediatamente después. Idempotente (create or replace).
begin;
set local search_path = public, interno, extensions;

${NUEVO}
${verificacion(DOMINIO_NUEVO, DOMINIO_VIEJO)}
commit;
`;

export const REVERSION = `-- supabase/respaldos/${FECHA}-dominio-portal-reversion.sql — deshace la migración del mismo nombre.
-- Restaura las cuatro funciones del commit ${COMMIT_PREVIO} (dominio ${DOMINIO_VIEJO}).
-- Se NIEGA si auth.users ya tiene cuentas con el dominio nuevo: primero hay que
-- devolverlas con scripts/migrar-dominio-portal.mjs --revertir.
begin;
set local search_path = public, interno, extensions;

do $r$
begin
  if exists (select 1 from auth.users where email like '%@${DOMINIO_NUEVO}') then
    raise exception 'dominio-portal: hay cuentas con @${DOMINIO_NUEVO} en auth.users; corre migrar-dominio-portal.mjs --revertir antes';
  end if;
end $r$;

${VIEJO}
${verificacion(DOMINIO_VIEJO, DOMINIO_NUEVO)}
commit;
`;

export const ESPEJO = `-- @@DOMINIO-INICIO@@ (generado por scripts/dominio-portal-generar.mjs desde supabase/portal.sql y supabase/limites.sql; no editar a mano)
-- ============================================================================
-- DOMINIO — cuentas técnicas del Portal en @${DOMINIO_NUEVO} (${FECHA})
-- Pisa las cuatro definiciones del bloque @@FASE6@@ (dominio ${DOMINIO_VIEJO},
-- historia intocable). Espejo de migraciones/${FECHA}-dominio-portal.sql.
-- ============================================================================
${NUEVO}
-- @@DOMINIO-FIN@@`;

export const sinDominio = (texto) => texto.replace(/-- @@DOMINIO-INICIO@@[\s\S]*?-- @@DOMINIO-FIN@@\n?/g, "");

const esPrincipal = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esPrincipal) {
  writeFileSync(`supabase/migraciones/${FECHA}-dominio-portal.sql`, MIGRACION);
  writeFileSync(`supabase/respaldos/${FECHA}-dominio-portal-reversion.sql`, REVERSION);
  const ruta = "supabase/seguridad.sql";
  const actual = readFileSync(ruta, "utf8");
  const propio = /-- @@DOMINIO-INICIO@@[\s\S]*?-- @@DOMINIO-FIN@@\n?/;
  writeFileSync(ruta, propio.test(actual) ? actual.replace(propio, () => `${ESPEJO}\n`) : `${actual.replace(/\s+$/, "")}\n\n${ESPEJO}\n`);
  console.log("Generados: migración dominio-portal, reversión y bloque @@DOMINIO@@ de seguridad.sql.");
}
