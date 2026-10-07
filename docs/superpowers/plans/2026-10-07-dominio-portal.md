# Dominio técnico de las cuentas del Portal — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Las cuentas técnicas del Portal pasan de `dni@portal.grupoer.pe` a `dni@portal.servicios-intranet.net` en la base, en Supabase Auth, en el código y en los scripts, con corte limpio y sin tocar la historia (migraciones y bloques generados de fases anteriores).

**Architecture:** Cuatro funciones SQL deciden la identidad del Portal por el dominio (`portal_dni`, `portal_registrar_ingreso`, `api_login_permitido`, `api_login_registrar`). Se editan sus canónicos (`supabase/portal.sql`, `supabase/limites.sql`); un generador nuevo produce la migración, su reversión y un bloque `@@DOMINIO@@` al final de `seguridad.sql` que pisa las versiones viejas del bloque histórico `@@FASE6@@`. Un script con la Management API renombra las 2 cuentas de Auth. En el código, `api/_clave.js` es el único dueño de la constante y los demás endpoints la importan.

**Tech Stack:** PostgreSQL 17 (Supabase; esquemas `public`/`interno`/`auth`), Postgres embebido local (`scripts/pg-local.mjs`), Node 22 ESM (`scripts/*.mjs`, `api/*.js`), vitest 4, Preact (cliente del Portal), Vercel CLI (DNS), Management API de Supabase (`SUPABASE_ACCESS_TOKEN` por `scripts/token-supabase.ps1`).

**Spec:** `docs/superpowers/specs/2026-10-07-dominio-portal-design.md`

## Global Constraints

- Dominio viejo: `portal.grupoer.pe`. Dominio nuevo: `portal.servicios-intranet.net`. La parte local (DNI en minúsculas) no cambia.
- **No se tocan** `supabase/migraciones/2026-09-21-fase6-limites.sql`, el bloque `@@FASE6@@` de `seguridad.sql` ni ninguna migración o respaldo histórico. **No se ejecuta** `scripts/fase6-generar.mjs` (reescribiría la migración histórica).
- En producción las 4 funciones son `security definer` con `set search_path = public, interno, extensions`. Privilegios: `portal_dni` → `authenticated`, `service_role`; `portal_registrar_ingreso` → `anon`, `authenticated`, `service_role`; `api_login_permitido` y `api_login_registrar` → solo `service_role`. `create or replace` conserva privilegios pero no atributos: cada definición de la migración vuelve a declararlos.
- No se añaden archivos a `api/` sin guion bajo (Vercel Hobby: 12 funciones, ya hay 12).
- Migraciones y cambios en Auth los aplica Diego con `!` en Git Bash, envueltos así: `powershell -NoProfile -Command ". ./scripts/token-supabase.ps1; node scripts/<script>.mjs"`. Siempre ANTES del push del código que los necesita.
- Al editar SQL en canónicos: herramienta Edit o `split/join`; jamás `String.replace` con un reemplazo que contenga `$$`.
- Commits con `git commit -F <archivo>` desde Bash; mensajes sin comillas dobles; textos y comentarios en español, estilo del código vecino.
- Ningún secreto ni dato personal en el chat ni en la salida de scripts: los scripts contra producción imprimen conteos o la parte local enmascarada (`40***`).
- Ensayos que reproducen fases históricas usan el dominio que exige el estado que reproducen: `ensayar-fase6` conserva el viejo (sus `api_login_*` y `portal_registrar_ingreso` vienen de la migración histórica); `ensayar-fase2/3a/3b/3c/4/jefe/politica/canon` evalúan `portal_dni()` del canon nuevo y pasan al nuevo. `ensayar-fase0` y `ensayar-fase1` no reproducen desde el 2026-09-22 y no se tocan.

---

### Task 1: Canónicos, generador, migración, reversión y bloque `@@DOMINIO@@`

**Files:**
- Modify: `supabase/portal.sql:207` (función `portal_dni`)
- Modify: `supabase/limites.sql:94,150,166` (`portal_registrar_ingreso`, `api_login_permitido`, `api_login_registrar`)
- Create: `scripts/dominio-portal-generar.mjs`
- Create (generados): `supabase/migraciones/2026-10-07-dominio-portal.sql`, `supabase/respaldos/2026-10-07-dominio-portal-reversion.sql`, bloque `@@DOMINIO@@` al final de `supabase/seguridad.sql`
- Modify: `scripts/fase2-generar.mjs:233`, `scripts/fase3-generar.mjs:274`, `scripts/fase3b-generar.mjs:167`, `scripts/fase3c-generar.mjs:128`, `scripts/fase4-generar.mjs:379`, `scripts/fase5-generar.mjs:147`, `scripts/fase6-generar.mjs:116` (los recortes `sinFaseN` quitan también `DOMINIO`)

**Interfaces:**
- Produces: `scripts/dominio-portal-generar.mjs` exporta `FECHA = "2026-10-07"`, `COMMIT_PREVIO = "44097c5"`, `DOMINIO_VIEJO`, `DOMINIO_NUEVO`, `MIGRACION`, `REVERSION`, `ESPEJO`, `sinDominio(texto)`. La migración y la reversión las leen Task 2 (ensayo) y Diego (aplicación).

- [ ] **Step 1: Editar los cuatro canónicos**

En `supabase/portal.sql` (línea 207), dentro de `portal_dni()`:

```sql
  where coalesce(auth.jwt()->>'email','') like '%@portal.servicios-intranet.net'
```

En `supabase/limites.sql`, tres líneas:

```sql
-- línea 94 (portal_registrar_ingreso)
  if p_resultado = 'exitoso' and correo_llamador() is distinct from lower(v_dni) || '@portal.servicios-intranet.net' then
-- línea 150 (api_login_permitido)
  if v_correo like '%@portal.servicios-intranet.net' then
-- línea 166 (api_login_registrar)
  if v_correo like '%@portal.servicios-intranet.net' then
```

Y el comentario de cabecera de `supabase/portal.sql:7`: `(cuenta técnica {dni}@portal.servicios-intranet.net)`.

Comprobar: `grep -n "portal.grupoer.pe" supabase/portal.sql supabase/limites.sql` → sin resultados.

- [ ] **Step 2: Escribir el generador**

```js
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
```

Nota: `politica-generar.mjs` ejecuta su propia generación solo cuando es el script principal (`process.argv[1]` termina en `politica-generar.mjs`), así que importar `entre` de ahí no escribe nada.

- [ ] **Step 3: Generar y revisar la salida**

```bash
node scripts/dominio-portal-generar.mjs
grep -c "portal.servicios-intranet.net" supabase/migraciones/2026-10-07-dominio-portal.sql   # esperado: 4 cuerpos + verificación (>= 5)
grep -c "portal.grupoer.pe" supabase/migraciones/2026-10-07-dominio-portal.sql               # esperado: solo comentarios/verificación (la cabecera y el regex), ningún cuerpo
grep -n "@@DOMINIO" supabase/seguridad.sql                                                   # esperado: INICIO y FIN al final del archivo
grep -n "security definer set search_path = public, interno, extensions" supabase/migraciones/2026-10-07-dominio-portal.sql | wc -l   # esperado: 4
```

Abrir la migración y comprobar a ojo que `portal_dni()` lleva `language sql stable security definer set search_path = public, interno, extensions as $$` y que las tres de limites conservan su cabecera original.

- [ ] **Step 4: Los recortes `sinFaseN` quitan también el bloque DOMINIO**

En los siete generadores, el grupo alternativo del regex gana `|DOMINIO`. Ejemplo exacto para `scripts/fase6-generar.mjs:116`:

```js
export const sinFase6 = (texto) => texto.replace(/-- @@(FASE[6-9][A-Z]?|FACTOR|LICENCIAS|DOMINIO)-INICIO@@[\s\S]*?-- @@\1-FIN@@\n?/g, "");
```

Mismo cambio (`LICENCIAS)` → `LICENCIAS|DOMINIO)`) en `sinFase2` (fase2-generar:233), `sinFase3` (fase3-generar:274), `sinFase3b` (fase3b-generar:167), `sinFase3c` (fase3c-generar:128), `sinFase4` (fase4-generar:379) y `sinFase5` (fase5-generar:147). Actualizar el comentario de fase6-generar (línea 114) añadiendo «y el bloque @@DOMINIO@@ del dominio del Portal, 2026-10-07».

Comprobar: `grep -c "LICENCIAS|DOMINIO" scripts/fase*-generar.mjs` → 7 archivos con 1.

- [ ] **Step 5: El canon completo sigue cargando**

Run: `node scripts/ensayar-canon.mjs`
Expected: todas verdes (hoy 26 invariantes; la 27 se añade en Task 2). Si falla la carga de `seguridad.sql`, el error dice la posición: revisar el bloque DOMINIO.

- [ ] **Step 6: Commit**

```bash
git add supabase/portal.sql supabase/limites.sql supabase/seguridad.sql supabase/migraciones/2026-10-07-dominio-portal.sql supabase/respaldos/2026-10-07-dominio-portal-reversion.sql scripts/dominio-portal-generar.mjs scripts/fase2-generar.mjs scripts/fase3-generar.mjs scripts/fase3b-generar.mjs scripts/fase3c-generar.mjs scripts/fase4-generar.mjs scripts/fase5-generar.mjs scripts/fase6-generar.mjs
git commit -F - <<'EOF'
sql(dominio-portal): las cuatro funciones de identidad del Portal pasan a portal.servicios-intranet.net

Canonicos portal.sql y limites.sql; generador dominio-portal-generar.mjs
(migracion, reversion que se niega con cuentas nuevas en auth.users, bloque
@@DOMINIO@@ al final de seguridad.sql). FASE6 historica intacta; los
recortes sinFaseN quitan tambien DOMINIO.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 2: Ensayo local del cambio e invariante 27 del canon

**Files:**
- Create: `scripts/ensayar-dominio-portal.mjs`
- Modify: `scripts/ensayar-canon.mjs` (nueva prueba tras la del V°B° del jefe, ~línea 226; cabecera de comentarios)
- Modify: `scripts/ensayar-fase2.mjs:37`, `scripts/ensayar-fase3a.mjs:90`, `scripts/ensayar-fase3b.mjs:59`, `scripts/ensayar-fase3c.mjs:45`, `scripts/ensayar-fase4.mjs:49`, `scripts/ensayar-jefe.mjs:103`, `scripts/ensayar-politica.mjs:33` (dominio nuevo en los claims)

**Interfaces:**
- Consumes: `FECHA`, `DOMINIO_VIEJO`, `DOMINIO_NUEVO` de `scripts/dominio-portal-generar.mjs`; `arrancarPgLocal({ seguridad: true, datos: false })` de `scripts/pg-local.mjs` (devuelve `{ sql, cliente, parar }`).

- [ ] **Step 1: Escribir el ensayo**

```js
// scripts/ensayar-dominio-portal.mjs — Ensayo LOCAL del cambio de dominio
// técnico de las cuentas del Portal (2026-10-07). Postgres embebido, canónicos
// + seguridad.sql (ya con el bloque @@DOMINIO@@), seeds de schema.sql. Primero
// la REVERSIÓN (estado anterior: solo el dominio viejo identifica), luego la
// MIGRACIÓN (solo el nuevo), la negativa de la reversión con cuentas nuevas en
// auth.users, y reversión + reaplicación. Uso: node scripts/ensayar-dominio-portal.mjs
import { readFileSync } from "node:fs";
import { arrancarPgLocal } from "./pg-local.mjs";
import { FECHA, DOMINIO_VIEJO, DOMINIO_NUEVO } from "./dominio-portal-generar.mjs";

const MIGRACION = readFileSync(`supabase/migraciones/${FECHA}-dominio-portal.sql`, "utf8");
const REVERSION = readFileSync(`supabase/respaldos/${FECHA}-dominio-portal-reversion.sql`, "utf8");

let fallos = 0, ok = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); await cliente.query("rollback").catch(() => {}); }
};
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const bd = await arrancarPgLocal({ seguridad: true, datos: false });
const { sql, cliente } = bd;
await sql("set search_path = public, interno, extensions");

// Pasos como un rol de la API con claims, en una transacción que se revierte
// salvo que se pida conservar. Devuelve filas o { codigo, mensaje }.
const como = async (rol, claims, pasos, conservar = false) => {
  await cliente.query("begin");
  try {
    await cliente.query(`set local role ${rol}`);
    await cliente.query(`select set_config('request.jwt.claims', $1, true)`, [claims ? JSON.stringify(claims) : ""]);
    let r; for (const [texto, params] of pasos) r = await cliente.query(texto, params);
    await cliente.query(conservar ? "commit" : "rollback");
    return { filas: r.rows };
  } catch (e) { await cliente.query("rollback"); return { codigo: e.code, mensaje: e.message }; }
};
const correo = (dni, dominio) => `${dni.toLowerCase()}@${dominio}`;
const claims = (dni, dominio) => ({ role: "authenticated", email: correo(dni, dominio), sub: "11111111-1111-1111-1111-111111111111" });
const servicio = (pasos, conservar = true) => como("service_role", { role: "service_role" }, pasos, conservar);
const dniResuelto = async (dni, dominio) => (await como("authenticated", claims(dni, dominio), [["select portal_dni() as d"]])).filas?.[0]?.d ?? null;

// Una persona con vínculo vigente de los seeds; cuenta del portal para ella.
const [P] = await sql(`select v.persona_dni as dni from vinculos v where v.fecha_fin is null order by v.persona_dni limit 1`);
await sql(`insert into cuentas_portal (dni, creado_por) values ($1, 'ensayo') on conflict do nothing`, [P.dni]);
const [POL] = await sql("select intentos_bloqueo as intentos from politica_acceso where id = 1");
console.log(`Trabajador ${P.dni} · política ${POL.intentos} intentos`);

const catalogo = async () => (await sql(`select bool_and(p.prosecdef) as definer,
  bool_and(exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) as sp,
  bool_and(p.prosrc ~ '${DOMINIO_NUEVO.replace(/\./g, "\\.")}') as nuevo, bool_or(p.prosrc ~ '${DOMINIO_VIEJO.replace(/\./g, "\\.")}') as viejo,
  has_function_privilege('anon', 'public.portal_registrar_ingreso(text, text, text)', 'execute') as anon_pri,
  has_function_privilege('authenticated', 'public.portal_dni()', 'execute') as auth_dni,
  has_function_privilege('authenticated', 'public.api_login_registrar(text, text, text, text)', 'execute') as auth_api
  from pg_proc p where p.oid in ('public.portal_dni()'::regprocedure, 'public.portal_registrar_ingreso(text, text, text)'::regprocedure,
    'public.api_login_permitido(text, text)'::regprocedure, 'public.api_login_registrar(text, text, text, text)'::regprocedure)`))[0];

try {
  console.log("== 0 · estado anterior (reversión aplicada sobre el canon nuevo)");
  await prueba("la reversión aplica: solo el dominio viejo identifica al trabajador", async () => {
    await sql(REVERSION);
    const c = await catalogo(); igual(`${c.nuevo}/${c.viejo}`, "false/true", "cuerpos");
    igual(await dniResuelto(P.dni, DOMINIO_VIEJO), P.dni, "viejo resuelve");
    igual(await dniResuelto(P.dni, DOMINIO_NUEVO), null, "nuevo no resuelve");
  });

  console.log("\n== 1 · migración");
  await prueba("aplica en una transacción (verificación embebida incluida)", async () => { await sql(MIGRACION); });
  await prueba("catálogo: definer + search_path; solo el dominio nuevo; privilegios intactos", async () => {
    const c = await catalogo();
    igual(`${c.definer}/${c.sp}/${c.nuevo}/${c.viejo}/${c.anon_pri}/${c.auth_dni}/${c.auth_api}`, "true/true/true/false/true/true/false", "catálogo");
  });

  console.log("\n== 2 · identidad");
  await prueba("portal_dni: el dominio nuevo resuelve al trabajador; el viejo ya no", async () => {
    igual(await dniResuelto(P.dni, DOMINIO_NUEVO), P.dni, "nuevo");
    igual(await dniResuelto(P.dni, DOMINIO_VIEJO), null, "viejo");
  });
  await prueba("portal_registrar_ingreso: el «exitoso» solo lo registra la propia sesión con el dominio nuevo", async () => {
    let r = await como("authenticated", claims(P.dni, DOMINIO_VIEJO), [["select portal_registrar_ingreso($1, 'exitoso', 'ensayo')", [P.dni]]]);
    igual(r.codigo, "42501", "viejo rechazado");
    r = await como("authenticated", claims(P.dni, DOMINIO_NUEVO), [["select portal_registrar_ingreso($1, 'exitoso', 'ensayo')", [P.dni]]], true);
    if (r.codigo) throw new Error(`nuevo: ${r.codigo} ${r.mensaje}`);
  });
  await prueba("api_login_registrar/permitido: el correo nuevo cuenta como Portal (superficie portal, bloqueo por documento)", async () => {
    for (let i = 0; i < POL.intentos; i++) await servicio([["select api_login_registrar($1, 'fallido', '203.0.113.9', 'Ensayo')", [correo(P.dni, DOMINIO_NUEVO)]]]);
    const [fila] = await sql("select dni, superficie, fuente from registro_accesos where fuente = 'proxy' order by id desc limit 1");
    igual(`${fila.dni}/${fila.superficie}`, `${P.dni.toUpperCase()}/portal`, "fila del proxy");
    const r = await servicio([["select api_login_permitido('203.0.113.9', $1) as v", [correo(P.dni, DOMINIO_NUEVO)]]], false);
    igual(`${r.filas[0].v.permitido}/${r.filas[0].v.motivo}`, "false/cuenta", "compuerta");
    const v = await servicio([["select api_login_registrar($1, 'fallido', '203.0.113.9', 'Ensayo')", [correo(P.dni, DOMINIO_VIEJO)]]]);
    if (v.codigo) throw new Error(`viejo: ${v.codigo} ${v.mensaje}`);
    const [otra] = await sql("select superficie from registro_accesos where fuente = 'proxy' order by id desc limit 1");
    igual(otra.superficie, "backoffice", "el dominio viejo ya no es Portal");
  });

  console.log("\n== 3 · reversión");
  await prueba("se niega mientras auth.users tenga una cuenta con el dominio nuevo", async () => {
    await sql(`insert into auth.users (email) values ($1)`, [correo(P.dni, DOMINIO_NUEVO)]);
    let fallo = null; try { await sql(REVERSION); } catch (e) { fallo = e.message; }
    await cliente.query("rollback").catch(() => {});   // la reversión abre begin; y revienta dentro: cerrar la transacción abortada
    igual(/migrar-dominio-portal\.mjs --revertir/.test(fallo ?? ""), true, "mensaje de la negativa");
    const c = await catalogo(); igual(c.nuevo, true, "sigue el nuevo");
    await sql(`delete from auth.users where email = $1`, [correo(P.dni, DOMINIO_NUEVO)]);
  });
  await prueba("sin cuentas nuevas la reversión restaura el dominio viejo; la migración vuelve a aplicarse", async () => {
    await sql(REVERSION);
    igual(await dniResuelto(P.dni, DOMINIO_VIEJO), P.dni, "viejo de vuelta");
    await sql(MIGRACION);
    igual(await dniResuelto(P.dni, DOMINIO_NUEVO), P.dni, "nuevo de vuelta");
  });
} finally {
  await bd.parar();
}
console.log(`\n${ok} verdes, ${fallos} fallo(s).`);
process.exit(fallos ? 1 : 0);
```

- [ ] **Step 2: Correr el ensayo**

Run: `node scripts/ensayar-dominio-portal.mjs`
Expected: `8 verdes, 0 fallo(s).` Si la prueba 0 falla porque la reversión no aplica, el problema está en los cuerpos viejos del generador (Task 1 Step 2, `deGit`).

- [ ] **Step 3: Invariante 27 en `ensayar-canon.mjs`**

Insertar después de la prueba «V°B° del jefe directo (2026-10-01)» (termina en `igual(/v_caller = s\.supervisor_dni/...` + `});`, ~línea 226) y antes de `console.log("\n== Segundo factor (2026-09-28)…`:

```js
  await prueba("dominio del Portal (2026-10-07): ninguna función de public/interno nombra portal.grupoer.pe; portal_dni resuelve con portal.servicios-intranet.net", async () => {
    vacio(await sql(`select p.oid::regprocedure::text as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'interno') and p.prosrc ~ 'portal\\.grupoer\\.pe'`), "dominio viejo");
    const [g] = await sql(`select bool_and(p.prosrc ~ 'portal\\.servicios-intranet\\.net') as nuevo, count(*)::int as n from pg_proc p
      where p.oid in ('public.portal_dni()'::regprocedure, 'public.portal_registrar_ingreso(text, text, text)'::regprocedure,
        'public.api_login_permitido(text, text)'::regprocedure, 'public.api_login_registrar(text, text, text, text)'::regprocedure)`);
    igual(`${g.nuevo}/${g.n}`, "true/4", "cuatro funciones");
    const [P] = await sql("select persona_dni as dni from vinculos where fecha_fin is null order by persona_dni limit 1");
    await sql("begin");
    try {
      await sql("set local role authenticated");
      await sql(`select set_config('request.jwt.claims', '${JSON.stringify({ role: "authenticated", email: `${P.dni.toLowerCase()}@portal.servicios-intranet.net` })}', true)`);
      const [r] = await sql("select portal_dni() as d"); igual(r.d, P.dni, "resuelve");
    } finally { await sql("rollback"); }
  });
```

Y en la cabecera de comentarios del archivo, tras la línea del segundo factor, añadir:

```js
//   · 2026-10-07: dominio técnico del Portal portal.servicios-intranet.net
//     (ninguna función conserva portal.grupoer.pe).
```

- [ ] **Step 4: Los ensayos que evalúan `portal_dni()` del canon pasan al dominio nuevo**

Reemplazo literal `portal.grupoer.pe` → `portal.servicios-intranet.net` en estas líneas exactas:
- `scripts/ensayar-fase2.mjs:37`, `scripts/ensayar-fase3a.mjs:90`, `scripts/ensayar-fase3b.mjs:59`, `scripts/ensayar-fase3c.mjs:45`, `scripts/ensayar-fase4.mjs:49` (constante `TRABAJADOR`)
- `scripts/ensayar-jefe.mjs:103`, `scripts/ensayar-politica.mjs:33`

`scripts/ensayar-fase6.mjs` NO cambia (líneas 51, 153, 156 conservan el dominio viejo: reproduce la fase 6 histórica). Añadir en su cabecera de comentarios: `// Conserva dni@portal.grupoer.pe a propósito: reproduce la migración histórica de la fase 6 (el dominio cambió el 2026-10-07, bloque @@DOMINIO@@ que sinFase6 recorta).`

- [ ] **Step 5: Correr todos los ensayos**

```bash
node scripts/ensayar-canon.mjs          # 27 verdes
node scripts/ensayar-fase6.mjs          # verde, con el dominio viejo
node scripts/ensayar-fase4.mjs
node scripts/ensayar-fase3c.mjs
node scripts/ensayar-fase3b.mjs
node scripts/ensayar-fase3a.mjs
node scripts/ensayar-fase2.mjs
node scripts/ensayar-jefe.mjs           # 15 verdes
node scripts/ensayar-politica.mjs       # 11 verdes
node scripts/ensayar-factor.mjs && node scripts/ensayar-licencias.mjs && node scripts/ensayar-correo.mjs && node scripts/ensayar-arreglos.mjs
```

Expected: todos `0 fallo(s)`. Los de fase 3a/3b/3c/4/6 necesitan `supabase/pruebas/datos-anonimizados.sql` (existe localmente, 2026-09-18). Si uno de fase 2–4 falla en una vista del Portal con 0 filas, es que su `TRABAJADOR` sigue con el dominio viejo.

- [ ] **Step 6: Commit**

```bash
git add scripts/ensayar-dominio-portal.mjs scripts/ensayar-canon.mjs scripts/ensayar-fase2.mjs scripts/ensayar-fase3a.mjs scripts/ensayar-fase3b.mjs scripts/ensayar-fase3c.mjs scripts/ensayar-fase4.mjs scripts/ensayar-fase6.mjs scripts/ensayar-jefe.mjs scripts/ensayar-politica.mjs
git commit -F - <<'EOF'
ensayos(dominio-portal): ensayo local del cambio de dominio e invariante 27 del canon

Los ensayos que evaluan portal_dni() del canon usan el dominio nuevo;
ensayar-fase6 conserva el viejo porque reproduce la migracion historica.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 3: Script que renombra las cuentas en Supabase Auth

**Files:**
- Create: `scripts/migrar-dominio-portal.mjs`
- Create: `tests/migrar-dominio-portal.test.js`

**Interfaces:**
- Produces: `correoNuevo(correo, de, a) → string | null` (null si el correo no termina en `@de`); `enmascarar(correo) → string` (`40***@dominio`). CLI: sin argumentos lista; `--aplicar` renombra viejo→nuevo; `--revertir` renombra nuevo→viejo; `--verificar` comprueba el estado final.
- Consumes: `DOMINIO_VIEJO`, `DOMINIO_NUEVO` de `scripts/dominio-portal-generar.mjs`.

- [ ] **Step 1: Escribir la prueba que falla**

```js
// tests/migrar-dominio-portal.test.js — Reglas puras del renombre de cuentas
// técnicas del Portal (el script contra producción no se ejecuta al importarlo).
import { describe, it, expect } from "vitest";
import { correoNuevo, enmascarar } from "../scripts/migrar-dominio-portal.mjs";

describe("correoNuevo", () => {
  it("cambia solo el dominio y conserva la parte local en minúsculas", () => {
    expect(correoNuevo("45231876@portal.grupoer.pe", "portal.grupoer.pe", "portal.servicios-intranet.net")).toBe("45231876@portal.servicios-intranet.net");
    expect(correoNuevo("CE001234@PORTAL.grupoer.pe", "portal.grupoer.pe", "portal.servicios-intranet.net")).toBe("ce001234@portal.servicios-intranet.net");
  });
  it("devuelve null para correos de otro dominio o vacíos", () => {
    expect(correoNuevo("karen@grupoer.pe", "portal.grupoer.pe", "portal.servicios-intranet.net")).toBeNull();
    expect(correoNuevo("", "portal.grupoer.pe", "portal.servicios-intranet.net")).toBeNull();
    expect(correoNuevo(undefined, "portal.grupoer.pe", "portal.servicios-intranet.net")).toBeNull();
  });
  it("el camino inverso funciona igual", () => {
    expect(correoNuevo("45231876@portal.servicios-intranet.net", "portal.servicios-intranet.net", "portal.grupoer.pe")).toBe("45231876@portal.grupoer.pe");
  });
});

describe("enmascarar", () => {
  it("deja dos caracteres de la parte local y el dominio completo", () => {
    expect(enmascarar("45231876@portal.grupoer.pe")).toBe("45***@portal.grupoer.pe");
    expect(enmascarar("a@b.c")).toBe("a***@b.c");
  });
});
```

- [ ] **Step 2: Correr la prueba y ver que falla**

Run: `npx vitest run tests/migrar-dominio-portal.test.js`
Expected: FAIL (el módulo no existe).

- [ ] **Step 3: Escribir el script**

```js
// scripts/migrar-dominio-portal.mjs — Renombra en Supabase Auth las cuentas
// técnicas del Portal: dni@portal.grupoer.pe → dni@portal.servicios-intranet.net
// (2026-10-07). La parte local (DNI en minúsculas) no cambia. GoTrue no envía
// correo (email_confirm) y el dominio nuevo tampoco recibe.
//   sin argumentos → lista cuántas cuentas cambiarían (no escribe)
//   --aplicar      → renombra viejo → nuevo y comprueba que no quede ninguna vieja
//   --revertir     → renombra nuevo → viejo (reversión; antes del SQL de reversión)
//   --verificar    → 0 cuentas viejas y cada cuenta nueva con fila en cuentas_portal
// Lo corre Diego con `!`:
//   powershell -NoProfile -Command ". ./scripts/token-supabase.ps1; node scripts/migrar-dominio-portal.mjs --aplicar"
// Requiere SUPABASE_ACCESS_TOKEN (Management API; de ahí sale la llave de servicio).
import { fileURLToPath } from "node:url";
import { DOMINIO_VIEJO, DOMINIO_NUEVO } from "./dominio-portal-generar.mjs";

const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const SUPA = `https://${PROYECTO}.supabase.co`;

export const correoNuevo = (correo, de, a) => {
  const c = String(correo ?? "").trim().toLowerCase();
  return c && c.endsWith(`@${de}`) ? `${c.slice(0, -(de.length + 1))}@${a}` : null;
};
export const enmascarar = (correo) => {
  const [local, dominio] = String(correo ?? "").split("@");
  return `${local.slice(0, 2)}***@${dominio ?? ""}`;
};

const json = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { crudo: t, status: r.status }; } };

async function principal() {
  const token = (process.env.SUPABASE_ACCESS_TOKEN || "").trim();
  if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
  const modo = process.argv.includes("--aplicar") ? "aplicar" : process.argv.includes("--revertir") ? "revertir" : process.argv.includes("--verificar") ? "verificar" : "listar";
  const [DE, A] = modo === "revertir" ? [DOMINIO_NUEVO, DOMINIO_VIEJO] : [DOMINIO_VIEJO, DOMINIO_NUEVO];

  const claves = await json(await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${token}` } }));
  const service = (Array.isArray(claves) ? claves : []).find((k) => k.type === "secret" || k.name === "service_role")?.api_key;
  if (!service) { console.error("La Management API no devolvió la llave de servicio."); process.exit(1); }
  const cab = { apikey: service, authorization: `Bearer ${service}`, "Content-Type": "application/json" };
  const gotrue = async (ruta, opciones = {}) => { const r = await fetch(`${SUPA}${ruta}`, { ...opciones, headers: { ...cab, ...opciones.headers } }); return { ok: r.ok, status: r.status, json: await json(r) }; };
  const sql = async (q) => json(await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) }));

  const usuarios = async () => {
    const r = await gotrue("/auth/v1/admin/users?per_page=1000");
    if (!r.ok) { console.error(`GoTrue HTTP ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`); process.exit(1); }
    return r.json.users ?? [];
  };
  const conDominio = (lista, d) => lista.filter((u) => correoNuevo(u.email, d, d) !== null);

  if (modo === "verificar") {
    const todos = await usuarios();
    const viejas = conDominio(todos, DOMINIO_VIEJO).length, nuevas = conDominio(todos, DOMINIO_NUEVO).length;
    const [h] = await sql(`select count(*)::int as huerfanas from auth.users u where u.email like '%@${DOMINIO_NUEVO}'
      and not exists (select 1 from cuentas_portal c where lower(c.dni) = split_part(u.email, '@', 1))`);
    const [p] = await sql("select count(*)::int as cuentas from cuentas_portal");
    console.log(`viejas: ${viejas} · nuevas: ${nuevas} · cuentas_portal: ${p?.cuentas} · nuevas sin fila en cuentas_portal: ${h?.huerfanas}`);
    const bien = viejas === 0 && h?.huerfanas === 0 && nuevas === p?.cuentas;
    console.log(bien ? "VERIFICADO: todas las cuentas del Portal están en el dominio nuevo." : "NO VERIFICADO.");
    process.exit(bien ? 0 : 1);
  }

  const pendientes = conDominio(await usuarios(), DE);
  console.log(`${pendientes.length} cuenta(s) con @${DE} → @${A}`);
  for (const u of pendientes) console.log(`  ${enmascarar(u.email)} → ${enmascarar(correoNuevo(u.email, DE, A))}`);
  if (modo === "listar") { console.log("(sin cambios; usa --aplicar)"); return; }

  let errores = 0;
  for (const u of pendientes) {
    const r = await gotrue(`/auth/v1/admin/users/${u.id}`, { method: "PUT", body: JSON.stringify({ email: correoNuevo(u.email, DE, A), email_confirm: true }) });
    if (!r.ok) { errores++; console.error(`  ✘ ${enmascarar(u.email)}: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`); }
    else console.log(`  ✔ ${enmascarar(r.json.email ?? "")}`);
  }
  const quedan = conDominio(await usuarios(), DE).length;
  console.log(`quedan con @${DE}: ${quedan} · errores: ${errores}`);
  process.exit(quedan === 0 && errores === 0 ? 0 : 1);
}

const esPrincipal = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esPrincipal) await principal();
```

- [ ] **Step 4: Correr la prueba y ver que pasa**

Run: `npx vitest run tests/migrar-dominio-portal.test.js`
Expected: 4 pruebas PASS. Importar el módulo no debe hacer peticiones: la prueba corre sin token y termina en menos de un segundo.

- [ ] **Step 5: Lectura en seco contra producción (sin escribir)**

Run (PowerShell): `powershell -NoProfile -Command ". ./scripts/token-supabase.ps1 *>$null; node scripts/migrar-dominio-portal.mjs"`
Expected: `2 cuenta(s) con @portal.grupoer.pe → @portal.servicios-intranet.net`, dos líneas enmascaradas y `(sin cambios; usa --aplicar)`.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrar-dominio-portal.mjs tests/migrar-dominio-portal.test.js
git commit -F - <<'EOF'
scripts(dominio-portal): renombre de las cuentas tecnicas del Portal en Auth (listar/aplicar/revertir/verificar)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 4: Código: una sola constante en `api/_clave.js`, cliente del Portal y pruebas vitest

**Files:**
- Modify: `api/_clave.js:11`
- Modify: `api/consentimiento-pdf.js:19`, `api/constancia-portal.js:12`, `api/descargar-documento.js:7`, `api/enviar-correo.js:34`, `api/rit.js:10` (quitar la constante local, importar)
- Modify: `api/portal-cuentas.js:3,17,68,91,122` (constante `DOMINIO` → `DOMINIO_PORTAL` importada)
- Modify: `api/solicitud-pdf.js:41` (usar `esCorreoPortal`)
- Modify: `api/supa.js:145` (comentario)
- Modify: `portal/src/lib/api.js:21`
- Modify: `tests/api/clave.test.js:28`, `tests/api/enviar-correo.test.js:20`, `tests/api/segundo-factor.test.js:26,31`, `tests/api/supa.test.js:148,153,171,203,216-219,231`

**Interfaces:**
- Produces: `api/_clave.js` exporta `DOMINIO_PORTAL = "portal.servicios-intranet.net"` y `esCorreoPortal(correo)` (sin cambio de firma). Los endpoints ya no declaran su propia constante.

- [ ] **Step 1: Pruebas que fallan (vitest)**

`tests/api/clave.test.js:27-31` queda:

```js
  it("distingue cuentas del Portal (dominio técnico 2026-10-07); el dominio viejo ya no lo es", () => {
    expect(esCorreoPortal("45231876@portal.servicios-intranet.net")).toBe(true);
    expect(esCorreoPortal("45231876@PORTAL.servicios-intranet.NET")).toBe(true);
    expect(esCorreoPortal("45231876@portal.grupoer.pe")).toBe(false);
    expect(esCorreoPortal("Karen@GRUPOER.pe")).toBe(false);
    expect(esCorreoPortal("")).toBe(false);
  });
```

Reemplazo literal `portal.grupoer.pe` → `portal.servicios-intranet.net` (respetando mayúsculas donde las hay, p. ej. `45231876@PORTAL.servicios-intranet.net` en supa.test.js:231) en:
- `tests/api/enviar-correo.test.js:20` (dos correos)
- `tests/api/segundo-factor.test.js:26` y `:31`
- `tests/api/supa.test.js:148, 153, 171, 203, 216, 217 (comentario), 218, 219, 231`

Run: `npx vitest run tests/api`
Expected: fallan `clave.test.js` (dominio nuevo → `false`), `supa.test.js` (recover al dominio nuevo se reenvía en vez de responder `{}`), `enviar-correo.test.js` y `segundo-factor.test.js` (la sesión del Portal ya no se reconoce).

- [ ] **Step 2: `api/_clave.js`**

```js
export const DOMINIO_PORTAL = "portal.servicios-intranet.net";
```

Y el comentario de cabecera (línea 8) gana: `// El dominio técnico del Portal vive SOLO aquí (2026-10-07): los endpoints lo importan.`

- [ ] **Step 3: Los endpoints importan la constante**

En `api/consentimiento-pdf.js`, `api/constancia-portal.js`, `api/descargar-documento.js`, `api/enviar-correo.js` y `api/rit.js`: borrar la línea `const DOMINIO_PORTAL = "portal.grupoer.pe";` y añadir junto a los demás imports:

```js
import { DOMINIO_PORTAL } from "./_clave.js";
```

En `api/portal-cuentas.js`: borrar `const DOMINIO = "portal.grupoer.pe";` (línea 17), añadir `import { DOMINIO_PORTAL } from "./_clave.js";`, y en las líneas 68, 91 y 122 cambiar `DOMINIO` por `DOMINIO_PORTAL`:

```js
  const correo = `${dni.toLowerCase()}@${DOMINIO_PORTAL}`;        // líneas 68 y 91
  if (correoLlamador.toLowerCase().endsWith(`@${DOMINIO_PORTAL}`)) {   // línea 122
```

Comentario de la línea 3: `// en el módulo personal. La cuenta técnica es {dni}@portal.servicios-intranet.net y el`.

En `api/solicitud-pdf.js`: añadir `import { esCorreoPortal } from "./_clave.js";` y la línea 41 queda:

```js
  if (!quien.ok || !correo || esCorreoPortal(correo)) {
```

En `api/supa.js:145` el comentario: `// dni@portal.servicios-intranet.net no recibe correo (sin MX) y con el SMTP de Resend el`.

Comprobar: `grep -rn "portal.grupoer.pe" api/` → sin resultados. `grep -c "DOMINIO_PORTAL" api/portal-cuentas.js` → 4.

- [ ] **Step 4: Cliente del Portal**

`portal/src/lib/api.js:21`:

```js
export const DOMINIO_PORTAL = "portal.servicios-intranet.net";
```

- [ ] **Step 5: Pruebas en verde y builds**

```bash
npx vitest run                 # todas verdes (hoy 244 + 4 nuevas de Task 3)
npm run build                  # BackOffice → dist/
(cd portal && npm run build)   # Portal → portal/dist/ (presupuesto 60 KB comprimidos; el dominio es 12 caracteres más)
node scripts/comprobar-paquete.mjs   # ningún archivo publicado lleva la URL de Supabase ni claves
```

Expected: vitest sin fallos; ambos builds terminan sin error; comprobar-paquete en verde.

- [ ] **Step 6: Commit**

```bash
git add api/_clave.js api/consentimiento-pdf.js api/constancia-portal.js api/descargar-documento.js api/enviar-correo.js api/portal-cuentas.js api/rit.js api/solicitud-pdf.js api/supa.js portal/src/lib/api.js tests/api/clave.test.js tests/api/enviar-correo.test.js tests/api/segundo-factor.test.js tests/api/supa.test.js
git commit -F - <<'EOF'
api+portal(dominio-portal): la constante del dominio tecnico vive solo en api/_clave.js; cliente del Portal al dominio nuevo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 5: Scripts de verificación y operación contra producción

**Files:**
- Modify: `scripts/verificar-portal.mjs:52,53,80`
- Modify: `scripts/verificar-constancia-pdf.mjs:90,92,96,97,144,145`
- Modify: `scripts/verificar-cumplimiento-boletas.mjs:91,93,96,183`
- Modify: `scripts/verificar-privacidad.mjs:56`
- Modify: `scripts/verificar-tipo-documento.mjs:75`
- Modify: `scripts/verificar-fase0.mjs:133`, `scripts/verificar-fase1.mjs:137`, `scripts/verificar-fase2.mjs:95`
- Modify: `scripts/fase0-forense.mjs:27`, `scripts/fase2-inventario.mjs:25`
- Modify: `scripts/estado-produccion.mjs:37,38,44,45`
- Modify: `scripts/limpiar-produccion.mjs:78,87`
- Modify: `scripts/entorno-pruebas.mjs:23,24,35,232,302`

- [ ] **Step 1: Reemplazo literal en todas las líneas listadas**

`portal.grupoer.pe` → `portal.servicios-intranet.net`. En `scripts/entorno-pruebas.mjs` hay dos expresiones regulares con el punto escapado: línea 232 `/^9\d{7}@portal\.grupoer\.pe$/` → `/^9\d{7}@portal\.servicios-intranet\.net$/` y línea 302 `^9[0-9]{7}@portal\\.grupoer\\.pe)$` → `^9[0-9]{7}@portal\\.servicios-intranet\\.net)$`.

Comprobar con el criterio de cierre de la spec:

```bash
grep -rln "portal.grupoer.pe" scripts/ | sort
```

Expected exactamente: `scripts/dominio-portal-generar.mjs`, `scripts/ensayar-fase0.mjs`, `scripts/ensayar-fase1.mjs`, `scripts/ensayar-fase6.mjs`, `scripts/migrar-dominio-portal.mjs` (importa la constante; aparece solo si la nombra en comentarios). Nada más.

- [ ] **Step 2: Los scripts siguen cargando (sintaxis)**

```bash
for f in verificar-portal verificar-constancia-pdf verificar-cumplimiento-boletas verificar-privacidad verificar-tipo-documento verificar-fase0 verificar-fase1 verificar-fase2 fase0-forense fase2-inventario estado-produccion limpiar-produccion entorno-pruebas; do node --check scripts/$f.mjs || echo "FALLA $f"; done
```

Expected: ninguna línea `FALLA`.

- [ ] **Step 3: Commit**

```bash
git add scripts/verificar-portal.mjs scripts/verificar-constancia-pdf.mjs scripts/verificar-cumplimiento-boletas.mjs scripts/verificar-privacidad.mjs scripts/verificar-tipo-documento.mjs scripts/verificar-fase0.mjs scripts/verificar-fase1.mjs scripts/verificar-fase2.mjs scripts/fase0-forense.mjs scripts/fase2-inventario.mjs scripts/estado-produccion.mjs scripts/limpiar-produccion.mjs scripts/entorno-pruebas.mjs
git commit -F - <<'EOF'
scripts(dominio-portal): verificadores y operacion contra produccion al dominio nuevo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 6: Documentación, informe y «Documentos Intranet»

**Files:**
- Modify: `docs/estado-del-proyecto.md:71`
- Modify: `docs/seguridad/README.md:19` (y una viñeta nueva al final de la lista de cambios, tras la del motor de correo de la línea 48)
- Modify: `supabase/MODELO.md` (tras la línea 104)
- Create: `docs/seguridad/2026-10-07-dominio-portal.md`
- Modify (fuera de git): `C:\Users\DiegoSalguero\OneDrive - RedPontis\Documentos\Documentos Intranet\Léeme.txt` y `…\Accesos\Accesos BackOffice y Portal.xlsx` (hoja «Cuentas del Portal», columna C «Correo técnico interno», fila 4; y la celda A1 con la dirección del Portal)

- [ ] **Step 1: Docs del repo**

`docs/estado-del-proyecto.md:71`: `numero-de-documento@portal.grupoer.pe` → `numero-de-documento@portal.servicios-intranet.net (desde 2026-10-07; antes portal.grupoer.pe)`.

`docs/seguridad/README.md:19`: `dni@portal.grupoer.pe` → `dni@portal.servicios-intranet.net`. Nueva viñeta tras la del motor de correo:

```markdown
- **Dominio técnico del Portal (2026-10-07):** las cuentas `dni@portal.grupoer.pe` pasaron a `dni@portal.servicios-intranet.net` (subdominio propio, sin MX, con SPF `-all`). Canónicos `portal.sql`/`limites.sql`, bloque `@@DOMINIO@@` de `seguridad.sql`, constante única en `api/_clave.js`. Informe: `2026-10-07-dominio-portal.md`.
```

`supabase/MODELO.md`, tras la línea «El trabajador del Portal se identifica por `portal_dni()` / `fn_persona_llamador()`.»:

```markdown
   El correo técnico es `dni@portal.servicios-intranet.net` (minúsculas; desde el
   2026-10-07, antes `portal.grupoer.pe`): el dominio solo aparece en `portal_dni()`,
   `portal_registrar_ingreso`, `api_login_permitido` y `api_login_registrar`
   (bloque `@@DOMINIO@@` de `seguridad.sql`, generado por `scripts/dominio-portal-generar.mjs`).
```

- [ ] **Step 2: Informe**

```markdown
# Dominio técnico de las cuentas del Portal — 2026-10-07

Spec: `docs/superpowers/specs/2026-10-07-dominio-portal-design.md` · Plan: `docs/superpowers/plans/2026-10-07-dominio-portal.md`

## 1. Motivo

Cada cuenta del Portal necesita un correo único en Supabase Auth; el sistema lo fabrica como `dni@dominio`. Ese dominio era `portal.grupoer.pe`: una marca que ya no es la del proyecto y un dominio que el proyecto no controla. Desde el 2026-10-01 la intranet vive en `servicios-intranet.net`; con 2 cuentas del Portal y sin trabajadores reales, migrar costaba minutos.

## 2. Qué cambió

- **Base:** `portal_dni()`, `portal_registrar_ingreso`, `api_login_permitido` y `api_login_registrar` comparan con `@portal.servicios-intranet.net`. Migración `supabase/migraciones/2026-10-07-dominio-portal.sql` (reversión en `respaldos/`, que se niega si `auth.users` tiene cuentas con el dominio nuevo). Canónicos `portal.sql` y `limites.sql`; bloque `@@DOMINIO@@` al final de `seguridad.sql` (el `@@FASE6@@` histórico no se tocó).
- **Auth:** `scripts/migrar-dominio-portal.mjs --aplicar` renombró las cuentas (`PUT /auth/v1/admin/users/{id}`, `email_confirm`).
- **Código:** `api/_clave.js` es el único dueño de `DOMINIO_PORTAL`; ocho endpoints lo importan; `portal/src/lib/api.js` fabrica el correo con el dominio nuevo.
- **DNS (Vercel):** `portal MX 0 .` (MX nulo) y `portal TXT "v=spf1 -all"`.

## 3. Operación

Orden: migración SQL (Diego) → `--aplicar` (Diego) → push → DNS → verificadores. Entre la migración y el deploy el Portal no deja entrar (minutos).

Reversión: `git revert` → `migrar-dominio-portal.mjs --revertir` → `respaldos/2026-10-07-dominio-portal-reversion.sql`.

## 4. Verificación

(Se completa en Task 7 con la salida real: ensayar-dominio-portal, ensayar-canon, vitest, verificar-despliegue, verificar-fase4, verificar-fase6, verificar-portal, verificar-cuentas-masa, migrar-dominio-portal --verificar, funciones-y-permisos.)

## 5. Estado

(Se completa en Task 7.)
```

- [ ] **Step 3: «Documentos Intranet» (OneDrive)**

`Léeme.txt`: las dos direcciones pasan a `https://servicios-intranet.net/admin/login` y `https://servicios-intranet.net/portal`; en el bloque «3) Accesos» añadir una línea: `   El correo técnico interno de cada cuenta del Portal es su DNI seguido de @portal.servicios-intranet.net (desde el 2026-10-07); no recibe correo y el trabajador nunca lo escribe.`

`Accesos BackOffice y Portal.xlsx`, hoja «Cuentas del Portal»: en A1 reemplazar `https://intranet-general.vercel.app/portal` por `https://servicios-intranet.net/portal`; en cada fila de datos (desde la 4) la columna C cambia `@portal.grupoer.pe` por `@portal.servicios-intranet.net`. Con Python/openpyxl (conserva estilos; es un libro de datos, no una plantilla de subida):

```python
import openpyxl
ruta = r"C:\Users\DiegoSalguero\OneDrive - RedPontis\Documentos\Documentos Intranet\Accesos\Accesos BackOffice y Portal.xlsx"
wb = openpyxl.load_workbook(ruta); ws = wb["Cuentas del Portal"]
ws["A1"].value = ws["A1"].value.replace("https://intranet-general.vercel.app/portal", "https://servicios-intranet.net/portal")
n = 0
for fila in ws.iter_rows(min_row=4):
    c = fila[2]
    if isinstance(c.value, str) and c.value.endswith("@portal.grupoer.pe"):
        c.value = c.value.replace("@portal.grupoer.pe", "@portal.servicios-intranet.net"); n += 1
wb.save(ruta); print("filas cambiadas:", n)
```

Expected: `filas cambiadas: 1` (hoy la hoja tiene una cuenta). Hacer lo mismo en la hoja «Usuarios BackOffice» si su A1 lleva la dirección del BackOffice (`/admin/login`).

- [ ] **Step 4: Commit (solo el repo)**

```bash
git add docs/estado-del-proyecto.md docs/seguridad/README.md docs/seguridad/2026-10-07-dominio-portal.md supabase/MODELO.md
git commit -F - <<'EOF'
docs(dominio-portal): informe, estado del proyecto, README de seguridad y MODELO.md

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 7: Despliegue y cierre

**Files:**
- Modify: `docs/seguridad/2026-10-07-dominio-portal.md` (§4 y §5 con la salida real)
- Modify (generado): `docs/funciones-y-permisos.md`

- [ ] **Step 1: Revisión final de la rama antes de pedir nada a Diego**

```bash
git log --oneline origin/main..HEAD        # 9 commits (spec, plan, sql, ensayos, script Auth, api+portal, scripts + título de la invariante, docs)
npx vitest run && node scripts/ensayar-canon.mjs && node scripts/ensayar-dominio-portal.mjs && npm run build && (cd portal && npm run build) && node scripts/comprobar-paquete.mjs
grep -rIn "portal.grupoer.pe" api/ portal/src/ tests/ supabase/*.sql
```

Expected: verde todo. En `api/`, `portal/src/` y `supabase/*.sql` el grep devuelve exactamente tres líneas, todas de `supabase/seguridad.sql` entre `@@FASE6-INICIO@@` y `@@FASE6-FIN@@` (hoy 1340, 1396 y 1412); cualquier otra línea ahí es un olvido. En `tests/` el dominio viejo puede aparecer solo en `tests/api/clave.test.js` (aserción negativa) y `tests/migrar-dominio-portal.test.js` (fixtures del renombrado viejo→nuevo); esas líneas NO se «corrigen».

- [ ] **Step 2: Diego aplica la migración SQL (`!`, Git Bash)**

```bash
powershell -NoProfile -Command ". ./scripts/token-supabase.ps1; node scripts/aplicar-sql.mjs supabase/migraciones/2026-10-07-dominio-portal.sql"
```

Expected: HTTP 201/200 sin error (la verificación embebida pasa). Desde este momento el Portal con el cliente viejo no entra.

- [ ] **Step 3: Diego renombra las cuentas en Auth (`!`, Git Bash)**

```bash
powershell -NoProfile -Command ". ./scripts/token-supabase.ps1; node scripts/migrar-dominio-portal.mjs --aplicar"
```

Expected: `2 cuenta(s) …`, dos `✔`, `quedan con @portal.grupoer.pe: 0 · errores: 0`.

- [ ] **Step 4: Push y deploy**

```bash
git push origin main
gh run list --limit 3          # seguridad.yml verde (si gh run watch está vedado, lo mira Diego)
vercel ls intranet-general | head -4   # Production Ready
vercel ls intranet-portal | head -4    # Production Ready
```

- [ ] **Step 5: DNS**

```bash
vercel dns add servicios-intranet.net portal MX "." 0
vercel dns add servicios-intranet.net portal TXT "v=spf1 -all"
vercel dns ls servicios-intranet.net | grep -E "^\s*rec_.*\sportal\s"
```

Expected: dos registros nuevos con nombre `portal`. Si Vercel rechaza el MX nulo (`.`), dejar solo el TXT y anotarlo en el informe §2.

- [ ] **Step 6: Verificadores contra producción**

```bash
node scripts/verificar-despliegue.mjs
powershell -NoProfile -Command ". ./scripts/token-supabase.ps1; node scripts/migrar-dominio-portal.mjs --verificar; node scripts/verificar-fase4.mjs; node scripts/verificar-fase6.mjs; node scripts/verificar-portal.mjs; node scripts/verificar-cuentas-masa.mjs; node scripts/funciones-y-permisos.mjs"
```

Expected: `VERIFICADO: todas las cuentas del Portal están en el dominio nuevo.`; fase4 y fase6 verdes; verificar-portal y verificar-cuentas-masa verdes (crean y borran cuentas de prueba con el dominio nuevo); `funciones-y-permisos.md` regenerado con 169 funciones y 0 sin guarda. Si `verificar-cuentas-masa` lo bloquea el clasificador (crea cuentas), lo corre Diego con `!`.

- [ ] **Step 7: Prueba real de Diego**

Entrar a `https://servicios-intranet.net/portal` con el documento y la clave de una de las dos cuentas. Debe entrar, ver sus datos y, si cierra sesión y vuelve, entrar de nuevo. Comprobación posterior (solo conteo):

```bash
powershell -NoProfile -Command ". ./scripts/token-supabase.ps1; node scripts/aplicar-sql.mjs --query \"select count(*) from registro_accesos where superficie = 'portal' and resultado = 'exitoso' and fecha > now() - interval '1 hour'\""
```

Expected: al menos 1.

- [ ] **Step 8: Cerrar informe, commit final y push**

Completar §4 (salida resumida de cada verificador, sin datos personales) y §5 (`Cerrado el 2026-10-07: … cuentas migradas, CI verde, deploy Ready, DNS cargado, prueba real de Diego OK`) en `docs/seguridad/2026-10-07-dominio-portal.md`.

```bash
git add docs/seguridad/2026-10-07-dominio-portal.md docs/funciones-y-permisos.md
git commit -F - <<'EOF'
docs(dominio-portal): cierre del ciclo (verificadores, DNS, funciones-y-permisos 169)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
git push origin main
```

Después, actualizar la memoria del proyecto (fuera del repo): dominio técnico nuevo, fecha, y que la reversión exige `--revertir` antes del SQL.
