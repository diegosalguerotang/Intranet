// scripts/licencias-generar.mjs — Genera desde el canónico supabase/licencias.sql:
//   · supabase/migraciones/2026-09-29-licencias-office.sql (una transacción)
//   · supabase/respaldos/2026-09-29-licencias-office-reversion.sql
//   · bloque @@LICENCIAS-INICIO@@ … @@LICENCIAS-FIN@@ al final de supabase/seguridad.sql
// El canónico NO entra en CANONICOS de pg-local.mjs: los ensayos de las fases
// anteriores re-aplican migraciones históricas con precondiciones fijas (la
// fase 4 exige exactamente 47 vistas invoker) y las recortan por bloque, igual
// que @@FACTOR@@. Uso: node scripts/licencias-generar.mjs
import { readFileSync, writeFileSync } from "node:fs";

export const FECHA = "2026-09-29";
const CANONICO = readFileSync("supabase/licencias.sql", "utf8").replace(/\s+$/, "");

export const MIGRACION = `-- supabase/migraciones/${FECHA}-licencias-office.sql — Licencias Office (ADQ-09).
-- Generado por scripts/licencias-generar.mjs desde supabase/licencias.sql (no editar a mano).
-- Una transacción. Reversión: supabase/respaldos/${FECHA}-licencias-office-reversion.sql.
-- Aplica DIEGO con \`!\`:  node scripts/aplicar-sql.mjs supabase/migraciones/${FECHA}-licencias-office.sql
-- Después, la carga inicial: node scripts/aplicar-sql.mjs scripts/licencias-${FECHA}.sql
begin;
set local search_path = public, interno, extensions;

${CANONICO}

commit;
`;

export const REVERSION = `-- supabase/respaldos/${FECHA}-licencias-office-reversion.sql — deshace la migración del mismo nombre.
-- Borra las licencias y sus afiliaciones (no toca el padrón). El cliente desplegado
-- tolera la ausencia de la fuente v_licencias_office (la lista queda vacía).
begin;
set local search_path = public, interno, extensions;
drop view if exists v_licencias_office;
drop function if exists guardar_licencia_office(bigint, text, text, text);
drop function if exists afiliar_licencia_office(bigint, text, text, bigint);
drop function if exists desafiliar_licencia_office(bigint);
drop table if exists licencias_office_personas;
drop table if exists licencias_office;
commit;
`;

export const ESPEJO = `-- @@LICENCIAS-INICIO@@ (generado por scripts/licencias-generar.mjs desde supabase/licencias.sql; no editar a mano)
${CANONICO}
-- @@LICENCIAS-FIN@@`;

export const sinLicencias = (texto) => texto.replace(/-- @@LICENCIAS-INICIO@@[\s\S]*?-- @@LICENCIAS-FIN@@\n?/g, "");

if (process.argv[1] && /licencias-generar\.mjs$/.test(process.argv[1])) {
  writeFileSync(`supabase/migraciones/${FECHA}-licencias-office.sql`, MIGRACION);
  writeFileSync(`supabase/respaldos/${FECHA}-licencias-office-reversion.sql`, REVERSION);
  const ruta = "supabase/seguridad.sql";
  const actual = readFileSync(ruta, "utf8");
  const propio = /-- @@LICENCIAS-INICIO@@[\s\S]*?-- @@LICENCIAS-FIN@@\n?/;
  writeFileSync(ruta, propio.test(actual) ? actual.replace(propio, () => `${ESPEJO}\n`) : `${actual.replace(/\s+$/, "")}\n\n${ESPEJO}\n`);
  console.log("Generados: migración licencias-office, reversión y bloque @@LICENCIAS@@ de seguridad.sql.");
}
