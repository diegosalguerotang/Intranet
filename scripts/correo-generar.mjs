// scripts/correo-generar.mjs — Genera desde el canónico supabase/correo.sql:
//   · supabase/migraciones/2026-09-30-correo-fallos.sql (una transacción)
//   · supabase/respaldos/2026-09-30-correo-fallos-reversion.sql
//   · bloque @@CORREO-INICIO@@ … @@CORREO-FIN@@ al final de supabase/seguridad.sql
// Mismo patrón que @@LICENCIAS@@ (fuera de CANONICOS de pg-local). Uso: node scripts/correo-generar.mjs
import { readFileSync, writeFileSync } from "node:fs";

export const FECHA = "2026-09-30";
const CANONICO = readFileSync("supabase/correo.sql", "utf8").replace(/\s+$/, "");

export const MIGRACION = `-- supabase/migraciones/${FECHA}-correo-fallos.sql — aviso de correos fallidos (superadmin).
-- Generado por scripts/correo-generar.mjs desde supabase/correo.sql (no editar a mano).
-- Una transacción. Reversión: supabase/respaldos/${FECHA}-correo-fallos-reversion.sql.
-- Aplica DIEGO con \`!\`:  node scripts/aplicar-sql.mjs supabase/migraciones/${FECHA}-correo-fallos.sql
begin;
set local search_path = public, interno, extensions;

${CANONICO}

-- Verificación embebida: la función existe, es definer, solo authenticated la ejecuta.
do $v$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'correo_fallos_recientes' and p.prosecdef) then
    raise exception 'correo: la función no quedó como security definer';
  end if;
  if has_function_privilege('anon', 'public.correo_fallos_recientes()', 'execute')
     or not has_function_privilege('authenticated', 'public.correo_fallos_recientes()', 'execute') then
    raise exception 'correo: privilegios incorrectos en correo_fallos_recientes';
  end if;
  if has_table_privilege('authenticated', 'public.correo_envios', 'select') then
    raise exception 'correo: correo_envios quedó legible por authenticated';
  end if;
end $v$;

commit;
`;

export const REVERSION = `-- supabase/respaldos/${FECHA}-correo-fallos-reversion.sql — deshace la migración del mismo nombre.
-- El cliente desplegado tolera la ausencia de la función (la franja no aparece).
begin;
drop function if exists public.correo_fallos_recientes();
commit;
`;

export const ESPEJO = `-- @@CORREO-INICIO@@ (generado por scripts/correo-generar.mjs desde supabase/correo.sql; no editar a mano)
${CANONICO}
-- @@CORREO-FIN@@`;

export const sinCorreo = (texto) => texto.replace(/-- @@CORREO-INICIO@@[\s\S]*?-- @@CORREO-FIN@@\n?/g, "");

if (process.argv[1] && /correo-generar\.mjs$/.test(process.argv[1])) {
  writeFileSync(`supabase/migraciones/${FECHA}-correo-fallos.sql`, MIGRACION);
  writeFileSync(`supabase/respaldos/${FECHA}-correo-fallos-reversion.sql`, REVERSION);
  const ruta = "supabase/seguridad.sql";
  const actual = readFileSync(ruta, "utf8");
  const propio = /-- @@CORREO-INICIO@@[\s\S]*?-- @@CORREO-FIN@@\n?/;
  writeFileSync(ruta, propio.test(actual) ? actual.replace(propio, () => `${ESPEJO}\n`) : `${actual.replace(/\s+$/, "")}\n\n${ESPEJO}\n`);
  console.log("Generados: migración correo-fallos, reversión y bloque @@CORREO@@ de seguridad.sql.");
}
