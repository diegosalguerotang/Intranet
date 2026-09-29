# Licencias Office (ADQ-09) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Módulo «Licencias Office» en Gestión de TI (ADQ-09): 20 buzones de grupo de Microsoft 365 con sus trabajadores afiliados por DNI al padrón, cargados desde el PDF de PROMANT sin trabajo manual.

**Architecture:** Dos tablas en `public` (grupo y afiliación por persona) con RLS de lectura por nivel del módulo `activos`, vista `security_invoker` para el BackOffice y tres RPC definer con guarda `fn_nivel_modulo('activos') >= 2`. Cliente React igual que Líneas móviles (`db.licenciasOffice` desde la vista; acciones por `rpc()` de `state.jsx`). Carga inicial por script SQL con los DNI resueltos en el ensayo del 2026-09-29.

**Tech Stack:** PostgreSQL 17 (Supabase, esquemas `public`/`interno`), Postgres embebido para ensayos (`scripts/pg-local.mjs`), React 19 + react-router + Tailwind 4 + lucide-react, vitest 4.

Spec: `docs/superpowers/specs/2026-09-29-licencias-office-design.md`.

## Global Constraints

- Solo lo que trae el PDF: grupo, correo, trabajadores, cantidad, estado. **Sin costo ni plan.**
- Módulo de permisos `activos`: lectura nivel ≥ 1, escritura nivel ≥ 2 (solo por RPC, sin `adm_escritura`).
- `grupo` en mayúsculas y `correo` en minúsculas, ambos únicos. Estados: `activa | suspendida | baja`. Paga fija `promant`.
- Afiliación abierta = `hasta is null`; nunca se borra una afiliación, se cierra. Una persona una sola vez abierta por grupo.
- Toda función nueva nace sin EXECUTE (default privileges); grant explícito a `authenticated, service_role`; `security definer` con `search_path = public, interno, extensions`. Los grants viven en el propio bloque (no en la lista 2b de `seguridad.sql`, donde aún no existen).
- Catálogos de los verificadores: `MATRIZ` (fase 4) + 2 tablas; `VISTAS_INVOKER` (fase 2) + 1 vista; conteo de vistas invoker 47 → **48** solo en `verificar-fase4.mjs` (producción); el canónico se embebe como bloque `@@LICENCIAS@@` al final de `seguridad.sql` con `scripts/licencias-generar.mjs` y NO entra en `CANONICOS` (los ensayos históricos lo recortan).
- Regla de despliegue: la migración y la carga en producción las aplica **Diego con `!`** antes del push. Tope de 12 funciones en `api/`: este módulo **no añade funciones serverless**.
- Textos de la interfaz en español, literales y accionables. Commits en español con prefijo de área (`licencias(sql): …`, `backoffice(ADQ-09): …`, `docs(licencias): …`) terminados con `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/lib/licencias.js` (nuevo) | Normalizaciones y sugerencia de persona por nombre (puro, testeable). |
| `tests/licencias.test.js` (nuevo) | Pruebas del anterior. |
| `supabase/licencias.sql` (nuevo) | Canónico: tablas, índice, disparadores de auditoría, vista, 3 RPC, grants, RLS. |
| `scripts/pg-local.mjs`, `scripts/fase4-generar.mjs`, `scripts/fase2-generar.mjs`, `scripts/verificar-fase4.mjs`, `scripts/ensayar-fase4.mjs`, `supabase/seguridad.sql` | Registro del canónico en catálogos y grants. |
| `scripts/ensayar-licencias.mjs` (nuevo) | Ensayo local del canónico (guardas, reglas, vista). |
| `supabase/migraciones/2026-09-29-licencias-office.sql`, `supabase/respaldos/2026-09-29-licencias-office-reversion.sql` (nuevos) | Migración en una transacción y su reversión. |
| `scripts/licencias-2026-09-29.sql` (nuevo) | Carga inicial: 20 grupos, 43 personas (39 con DNI, 4 por afiliar) con verificación final. |
| `src/state.jsx`, `src/data/mock.js`, `src/App.jsx`, `src/layout/Shell.jsx` | Fuente `licenciasOffice`, acciones, ruta y menú. |
| `src/pages/admin/LicenciasOffice.jsx` (nuevo) | Pantalla ADQ-09. |
| `scripts/verificar-licencias.mjs` (nuevo) | Verificación en producción (catálogo + carga). |
| `supabase/MODELO.md`, `docs/funciones-y-permisos.md` | Documentación. |

---

### Task 1: `src/lib/licencias.js` (normalizaciones y sugerencia por nombre)

**Files:** Create `src/lib/licencias.js`, `tests/licencias.test.js`.

**Produces:** `normalizarGrupo(texto) → string` (mayúsculas, sin espacios extremos, espacios internos → `_`); `normalizarCorreoLicencia(texto) → string` (minúsculas, sin espacios); `correoValido(correo) → boolean`; `tokensNombre(texto) → string[]` (sin tildes, mayúsculas, solo letras/dígitos); `sugerirPersona(nombreFuente, padron, excluirDnis = []) → {dni,…} | null` (única coincidencia cuyo `nombre` contiene todos los tokens; null si 0 o >1).

- [ ] **Step 1: Prueba que falla** (`tests/licencias.test.js`)

```js
import { describe, it, expect } from "vitest";
import { normalizarGrupo, normalizarCorreoLicencia, correoValido, tokensNombre, sugerirPersona } from "../src/lib/licencias.js";

const PADRON = [
  { dni: "72386204", nombre: "MAYTA QUEVEDO ARTURO ANIBAL" },
  { dni: "07819030", nombre: "MAYTA QUISPE ANIBAL" },
  { dni: "47296190", nombre: "ALBAÑIL MUÑOZ DIANA CAROLINA" },
  { dni: "70122408", nombre: "Jean Paul Camacho Gómez" },
];

describe("normalizaciones", () => {
  it("grupo en mayúsculas, sin espacios extremos y con guion bajo interno", () => {
    expect(normalizarGrupo("  rrhh gerencia ")).toBe("RRHH_GERENCIA");
  });
  it("correo en minúsculas y sin espacios", () => {
    expect(normalizarCorreoLicencia(" G_RRHH@PROMANTSERV.onmicrosoft.com ")).toBe("g_rrhh@promantserv.onmicrosoft.com");
  });
  it("correoValido acepta un buzón y rechaza texto suelto", () => {
    expect(correoValido("rrhh@promantserv.onmicrosoft.com")).toBe(true);
    expect(correoValido("rrhh@")).toBe(false);
  });
  it("tokensNombre quita tildes y mayúsculas", () => {
    expect(tokensNombre("Diana Albañil")).toEqual(["DIANA", "ALBAÑIL"]);
    expect(tokensNombre("Gómez, Jean-Paul")).toEqual(["GOMEZ", "JEAN", "PAUL"]);
  });
});

describe("sugerirPersona", () => {
  it("coincidencia única por tokens, sin importar orden ni tildes", () => {
    expect(sugerirPersona("jean paul camacho", PADRON)?.dni).toBe("70122408");
    expect(sugerirPersona("DIANA ALBAÑIL", PADRON)?.dni).toBe("47296190");
  });
  it("ambigua → null; con exclusión se resuelve por descarte", () => {
    expect(sugerirPersona("ANIBAL MAYTA", PADRON)).toBeNull();
    expect(sugerirPersona("ANIBAL MAYTA", PADRON, ["72386204"])?.dni).toBe("07819030");
  });
  it("sin coincidencia → null", () => {
    expect(sugerirPersona("ESPERANZA QUEVEDO", PADRON)).toBeNull();
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/licencias.test.js` → falla (módulo inexistente).
- [ ] **Step 3: Implementación** (`src/lib/licencias.js`)

```js
// Licencias Office (ADQ-09): normalizaciones compartidas con la base y la
// sugerencia de persona por nombre (mismo criterio que la carga inicial:
// todos los tokens del nombre de la fuente aparecen en el nombre del padrón).
export const normalizarGrupo = (t) => String(t ?? "").trim().toUpperCase().replace(/\s+/g, "_");
export const normalizarCorreoLicencia = (t) => String(t ?? "").replace(/\s+/g, "").toLowerCase();
export const correoValido = (c) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c ?? "");
export const tokensNombre = (t) =>
  String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/[^A-Z0-9Ñ]+/g, " ").trim().split(/\s+/).filter(Boolean);
export function sugerirPersona(nombreFuente, padron, excluirDnis = []) {
  const toks = tokensNombre(nombreFuente);
  if (!toks.length) return null;
  const fuera = new Set(excluirDnis);
  const cand = padron.filter((p) => !fuera.has(p.dni) && (() => { const s = new Set(tokensNombre(p.nombre)); return toks.every((k) => s.has(k)); })());
  return cand.length === 1 ? cand[0] : null;
}
```

Nota: `normalize("NFD")` separa la tilde de la Ñ también (Ñ → N + ~); por eso el replace de diacríticos **debe conservar la virgulilla**: usar `replace(/[̀-̂̈]/g, "")` (agudo, grave, circunflejo, diéresis) en vez de todo el rango. Ajustar hasta que pase la prueba de «ALBAÑIL».

- [ ] **Step 4:** `npx vitest run tests/licencias.test.js` → 7 pasan.
- [ ] **Step 5: Commit** `licencias(lib): normalizaciones y sugerencia de persona por nombre`.

---

### Task 2: Canónico `supabase/licencias.sql` + catálogos + ensayo local

**Files:** Create `supabase/licencias.sql`, `scripts/ensayar-licencias.mjs`. Modify `scripts/pg-local.mjs:36` (CANONICOS), `scripts/fase4-generar.mjs:65` (MATRIZ), `scripts/fase2-generar.mjs:25` (VISTAS_INVOKER), `scripts/verificar-fase4.mjs:48-56` (47 → 48; `ensayar-fase4` queda en 47), `scripts/fase2..6-generar.mjs` (regex `sinFaseN` + `LICENCIAS`), `scripts/licencias-generar.mjs` (nuevo: embebe el bloque y genera migración/reversión), `supabase/seguridad.sql:84-88` (lista 2b).

**Produces:** tablas `licencias_office`, `licencias_office_personas`; vista `v_licencias_office(id, grupo, correo, estado, paga, alta, personas jsonb, cantidad int, "porAfiliar" int)`; RPC `guardar_licencia_office(p_id bigint, p_grupo text, p_correo text, p_estado text) returns bigint`, `afiliar_licencia_office(p_licencia bigint, p_dni text, p_nombre text default null, p_fila bigint default null) returns bigint`, `desafiliar_licencia_office(p_fila bigint) returns void`.

- [ ] **Step 1: Canónico** (`supabase/licencias.sql`)

```sql
-- ============================================================================
-- LICENCIAS OFFICE (ADQ-09) — buzones de grupo de Microsoft 365 (2026-09-29)
-- Fuente: pantalla «Licencias Office» del sistema PHP de PROMANT. Cada persona
-- dentro de un grupo es una licencia; paga PROMANT, usan las tres razones
-- sociales. Permisos: módulo `activos` (lectura nivel ≥ 1 por RLS y vista
-- invoker; escritura nivel ≥ 2 SOLO por RPC). APLICAR DESPUÉS DE soporte.sql
-- (usa fn_nivel_modulo, fn_auditar, personas, vinculos, empresas). Idempotente.
-- Spec: docs/superpowers/specs/2026-09-29-licencias-office-design.md
-- ============================================================================

create table if not exists licencias_office (
  id        bigint generated by default as identity primary key,
  grupo     text not null unique check (grupo = upper(btrim(grupo)) and length(grupo) between 2 and 40),
  correo    text not null unique check (correo = lower(btrim(correo)) and correo ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  paga      text not null default 'promant' references empresas(id),
  estado    text not null default 'activa' check (estado in ('activa', 'suspendida', 'baja')),
  alta      date not null default current_date,
  creado_en timestamptz not null default now()
);
create table if not exists licencias_office_personas (
  id          bigint generated by default as identity primary key,
  licencia_id bigint not null references licencias_office(id) on delete cascade,
  dni         text references personas(dni),   -- null = por afiliar
  nombre      text not null,                   -- instantánea: fuente, o padrón al afiliar
  desde       date not null default current_date,
  hasta       date
);
create unique index if not exists uq_licencia_persona_abierta
  on licencias_office_personas (licencia_id, dni) where hasta is null and dni is not null;

-- Auditoría (fn_auditar es genérica: tabla + fila antes/después).
drop trigger if exists trg_auditar_licencias_office on licencias_office;
create trigger trg_auditar_licencias_office after insert or update or delete on licencias_office
  for each row execute function fn_auditar();
drop trigger if exists trg_auditar_licencias_office_personas on licencias_office_personas;
create trigger trg_auditar_licencias_office_personas after insert or update or delete on licencias_office_personas
  for each row execute function fn_auditar();

-- Vista del BackOffice: un grupo por fila con sus personas abiertas.
drop view if exists v_licencias_office;
create view v_licencias_office with (security_invoker = on) as
select l.id, l.grupo, l.correo, l.estado, l.paga, to_char(l.alta, 'YYYY-MM-DD') as alta,
       coalesce(jsonb_agg(jsonb_build_object('id', lp.id, 'dni', lp.dni, 'nombre', coalesce(p.nombre, lp.nombre),
                                             'empresa', ve.empresa_id, 'afiliado', lp.dni is not null)
                          order by coalesce(p.nombre, lp.nombre)) filter (where lp.id is not null), '[]'::jsonb) as personas,
       count(lp.id)::int as cantidad,
       (count(lp.id) filter (where lp.dni is null))::int as "porAfiliar"
from licencias_office l
left join licencias_office_personas lp on lp.licencia_id = l.id and lp.hasta is null
left join personas p on p.dni = lp.dni
left join lateral (select v.empresa_id from vinculos v where v.persona_dni = lp.dni and v.fecha_fin is null
                   order by v.fecha_inicio desc limit 1) ve on true
group by l.id
order by l.grupo;

-- RPC (definer, guarda propia sobre fn_nivel_modulo('activos') >= 2).
create or replace function guardar_licencia_office(p_id bigint, p_grupo text, p_correo text, p_estado text)
returns bigint language plpgsql security definer set search_path = public, interno, extensions as $$
declare v_id bigint;
        v_grupo text := upper(btrim(coalesce(p_grupo, '')));
        v_correo text := lower(btrim(coalesce(p_correo, '')));
        v_estado text := coalesce(nullif(btrim(p_estado), ''), 'activa');
begin
  if fn_nivel_modulo('activos') < 2 then raise exception 'Se necesita nivel de acción en Gestión de TI.' using errcode = '42501'; end if;
  if length(v_grupo) < 2 or length(v_grupo) > 40 then raise exception 'El grupo necesita entre 2 y 40 caracteres.'; end if;
  if v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Correo del buzón inválido.'; end if;
  if v_estado not in ('activa', 'suspendida', 'baja') then raise exception 'Estado inválido.'; end if;
  if exists (select 1 from licencias_office where (grupo = v_grupo or correo = v_correo) and id is distinct from p_id) then
    raise exception 'Ya existe un grupo con ese nombre o ese correo.';
  end if;
  if p_id is null then
    insert into licencias_office (grupo, correo, estado) values (v_grupo, v_correo, v_estado) returning id into v_id;
  else
    update licencias_office set grupo = v_grupo, correo = v_correo, estado = v_estado where id = p_id returning id into v_id;
    if v_id is null then raise exception 'El grupo no existe.'; end if;
  end if;
  return v_id;
end $$;

create or replace function afiliar_licencia_office(p_licencia bigint, p_dni text, p_nombre text default null, p_fila bigint default null)
returns bigint language plpgsql security definer set search_path = public, interno, extensions as $$
declare v_dni text := nullif(btrim(coalesce(p_dni, '')), ''); v_nombre text; v_id bigint;
begin
  if fn_nivel_modulo('activos') < 2 then raise exception 'Se necesita nivel de acción en Gestión de TI.' using errcode = '42501'; end if;
  if not exists (select 1 from licencias_office where id = p_licencia) then raise exception 'El grupo no existe.'; end if;
  if v_dni is not null then
    select nombre into v_nombre from personas where dni = v_dni;
    if v_nombre is null then raise exception 'El DNI % no está en el padrón.', v_dni; end if;
    if exists (select 1 from licencias_office_personas
               where licencia_id = p_licencia and dni = v_dni and hasta is null and id is distinct from p_fila) then
      raise exception 'Esa persona ya está afiliada a este grupo.';
    end if;
  else
    v_nombre := nullif(btrim(coalesce(p_nombre, '')), '');
    if v_nombre is null then raise exception 'Indica el DNI del padrón o el nombre de la persona.'; end if;
  end if;
  if p_fila is not null then
    update licencias_office_personas set dni = v_dni, nombre = v_nombre
     where id = p_fila and licencia_id = p_licencia and hasta is null returning id into v_id;
    if v_id is null then raise exception 'La fila por afiliar no existe o ya está cerrada.'; end if;
  else
    insert into licencias_office_personas (licencia_id, dni, nombre) values (p_licencia, v_dni, v_nombre) returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function desafiliar_licencia_office(p_fila bigint)
returns void language plpgsql security definer set search_path = public, interno, extensions as $$
begin
  if fn_nivel_modulo('activos') < 2 then raise exception 'Se necesita nivel de acción en Gestión de TI.' using errcode = '42501'; end if;
  update licencias_office_personas set hasta = current_date where id = p_fila and hasta is null;
  if not found then raise exception 'La afiliación no existe o ya está cerrada.'; end if;
end $$;

-- Permisos: tablas solo SELECT (la vista invoker las atraviesa por RLS); escritura solo por RPC.
revoke all on licencias_office, licencias_office_personas from public, anon, authenticated;
grant select on licencias_office, licencias_office_personas to authenticated;
grant select on v_licencias_office to authenticated;
revoke all on function guardar_licencia_office(bigint, text, text, text), afiliar_licencia_office(bigint, text, text, bigint),
  desafiliar_licencia_office(bigint) from public, anon;
grant execute on function guardar_licencia_office(bigint, text, text, text), afiliar_licencia_office(bigint, text, text, bigint),
  desafiliar_licencia_office(bigint) to authenticated, service_role;
alter table licencias_office enable row level security;
alter table licencias_office_personas enable row level security;
drop policy if exists adm_lectura on licencias_office;
create policy adm_lectura on licencias_office for select to authenticated using ((select public.nivel_en('activos')) >= 1);
drop policy if exists adm_lectura on licencias_office_personas;
create policy adm_lectura on licencias_office_personas for select to authenticated using ((select public.nivel_en('activos')) >= 1);
```

- [ ] **Step 2: Catálogos.** `pg-local.mjs` CANONICOS: `"soporte.sql", "licencias.sql", "api-servicio.sql"`. `fase4-generar.mjs` tras `public.lineas`: `"public.licencias_office": { adm: nivel("activos") },` y `"public.licencias_office_personas": { adm: nivel("activos") },`. `fase2-generar.mjs` VISTAS_INVOKER: `"v_licencias_office"` entre `"v_feriados"` y `"v_lotes"` (orden alfabético). `verificar-fase4.mjs` y `ensayar-fase4.mjs`: `47` → `48` (título y valor). `seguridad.sql` lista 2b: añadir `afiliar_licencia_office(p_licencia bigint, p_dni text, p_nombre text, p_fila bigint), desafiliar_licencia_office(p_fila bigint), guardar_licencia_office(p_id bigint, p_grupo text, p_correo text, p_estado text),` en orden alfabético.
- [ ] **Step 3: Ensayo local** (`scripts/ensayar-licencias.mjs`)

```js
// scripts/ensayar-licencias.mjs — Ensayo LOCAL del canónico supabase/licencias.sql
// (Postgres embebido, canónicos + seguridad.sql, sin datos). Uso: node scripts/ensayar-licencias.mjs
import { arrancarPgLocal } from "./pg-local.mjs";
let fallos = 0, ok = 0;
const prueba = async (n, fn) => { try { await fn(); ok++; console.log(`✓ ${n}`); } catch (e) { fallos++; console.error(`✗ ${n}: ${e.message}`); await cliente.query("rollback").catch(() => {}); } };
const igual = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
const bd = await arrancarPgLocal({ seguridad: true, datos: false });
const { sql, cliente } = bd;
await sql("set search_path = public, interno, extensions");
const como = async (rol, claims, texto, params) => {
  await cliente.query("begin");
  try {
    await cliente.query(`set local role ${rol}`);
    await cliente.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims ?? { role: rol })]);
    const r = await cliente.query(texto, params); return { filas: r.rows };
  } catch (e) { return { codigo: e.code, mensaje: e.message }; } finally { await cliente.query("rollback"); }
};
try {
  await prueba("catálogo: 2 tablas con RLS y adm_lectura; vista invoker; 3 RPC para authenticated y service_role, no anon; disparadores", async () => {
    const [r] = await sql(`select (select count(*) from pg_policies where tablename in ('licencias_office','licencias_office_personas') and policyname = 'adm_lectura')::int as pol,
      (select bool_and(relrowsecurity) from pg_class where relname in ('licencias_office','licencias_office_personas')) as rls,
      ('security_invoker=on' = any((select reloptions from pg_class where relname = 'v_licencias_office'))) as inv,
      (select bool_and(has_function_privilege('authenticated', f, 'execute') and has_function_privilege('service_role', f, 'execute') and not has_function_privilege('anon', f, 'execute'))
         from unnest(array['guardar_licencia_office(bigint,text,text,text)','afiliar_licencia_office(bigint,text,text,bigint)','desafiliar_licencia_office(bigint)']) f) as fn,
      (select count(*) from pg_trigger where tgname like 'trg_auditar_licencias_office%')::int as trg`);
    igual(`${r.pol}/${r.rls}/${r.inv}/${r.fn}/${r.trg}`, "2/true/true/true/2", "catálogo");
  });
  await prueba("sin identidad (authenticated sin claims): guardar → 42501; la vista devuelve 0 filas", async () => {
    const r = await como("authenticated", null, "select guardar_licencia_office(null, 'ZZ_PRUEBA', 'zz@ejemplo.invalido', 'activa')");
    igual(r.codigo, "42501", "guardar sin nivel");
    const v = await como("authenticated", null, "select count(*)::int as n from v_licencias_office");
    igual(v.filas[0].n, 0, "vista sin nivel");
  });
  await prueba("servicio (99): guarda normalizando, rechaza duplicado, afilia por DNI y por nombre, cuenta en la vista, desafilia y rechaza doble cierre", async () => {
    await sql("begin");
    try {
      await sql("insert into personas (dni, nombre) values ('ZZLIC0001', 'ZZ PRUEBA UNO'), ('ZZLIC0002', 'ZZ PRUEBA DOS')");
      await sql("set local role service_role");
      const [{ id }] = await sql("select guardar_licencia_office(null, ' zz grupo ', ' ZZ_Grupo@Ejemplo.INVALIDO ', null) as id");
      const [g] = await sql("select grupo, correo, estado from licencias_office where id = $1", [id]);
      igual(`${g.grupo}|${g.correo}|${g.estado}`, "ZZ GRUPO|zz_grupo@ejemplo.invalido|activa", "normalizado");
      let e = null; try { await sql("select guardar_licencia_office(null, 'ZZ GRUPO', 'otro@ejemplo.invalido', 'activa')"); } catch (x) { e = x.message; }
      igual(/Ya existe/.test(e ?? ""), true, "duplicado");
      const [{ f1 }] = await sql("select afiliar_licencia_office($1, 'ZZLIC0001') as f1", [id]);
      const [{ f2 }] = await sql("select afiliar_licencia_office($1, null, 'ZZ POR AFILIAR') as f2", [id]);
      e = null; try { await sql("select afiliar_licencia_office($1, 'ZZLIC0001')", [id]); } catch (x) { e = x.message; }
      igual(/ya está afiliada/.test(e ?? ""), true, "doble afiliación");
      e = null; try { await sql("select afiliar_licencia_office($1, 'NOEXISTE')", [id]); } catch (x) { e = x.message; }
      igual(/no está en el padrón/.test(e ?? ""), true, "DNI inexistente");
      let [v] = await sql("select cantidad, \"porAfiliar\" as pa, personas from v_licencias_office where id = $1", [id]);
      igual(`${v.cantidad}/${v.pa}`, "2/1", "vista antes de resolver");
      await sql("select afiliar_licencia_office($1, 'ZZLIC0002', null, $2)", [id, f2]);
      [v] = await sql("select cantidad, \"porAfiliar\" as pa from v_licencias_office where id = $1", [id]);
      igual(`${v.cantidad}/${v.pa}`, "2/0", "vista tras resolver");
      await sql("select desafiliar_licencia_office($1)", [f1]);
      e = null; try { await sql("select desafiliar_licencia_office($1)", [f1]); } catch (x) { e = x.message; }
      igual(/ya está cerrada/.test(e ?? ""), true, "doble cierre");
      [v] = await sql("select cantidad from v_licencias_office where id = $1", [id]);
      igual(v.cantidad, 1, "vista tras desafiliar");
      const [a] = await sql("select count(*)::int as n from auditoria where tabla like 'licencias_office%'");
      igual(a.n >= 6, true, `auditoría (${a.n})`);
    } finally { await sql("rollback"); }
  });
} finally { await bd.parar(); }
console.log(`\n${ok} ok · ${fallos} fallo(s)`); process.exit(fallos ? 1 : 0);
```

- [ ] **Step 4:** `node scripts/ensayar-licencias.mjs` → 3/3; `node scripts/ensayar-canon.mjs` → todo verde; `node scripts/ensayar-fase4.mjs` → verde con 48.
- [ ] **Step 5: Commit** `licencias(sql): canónico de Licencias Office (tablas, vista invoker, 3 RPC con guarda) y ensayo local`.

---

### Task 3: Migración, reversión y carga inicial

**Files:** Create `supabase/migraciones/2026-09-29-licencias-office.sql`, `supabase/respaldos/2026-09-29-licencias-office-reversion.sql`, `scripts/licencias-2026-09-29.sql`.

- [ ] **Step 1: Migración** = cabecera + `begin; set local search_path = public, interno, extensions;` + contenido íntegro de `supabase/licencias.sql` + `commit;`. Cabecera:

```sql
-- supabase/migraciones/2026-09-29-licencias-office.sql — Licencias Office (ADQ-09).
-- Canónico: supabase/licencias.sql (copiado aquí íntegro). Una transacción.
-- Reversión: supabase/respaldos/2026-09-29-licencias-office-reversion.sql.
-- Aplica DIEGO con `!`: node scripts/aplicar-sql.mjs supabase/migraciones/2026-09-29-licencias-office.sql
-- Después la carga: node scripts/aplicar-sql.mjs scripts/licencias-2026-09-29.sql
```

- [ ] **Step 2: Reversión**

```sql
-- supabase/respaldos/2026-09-29-licencias-office-reversion.sql — deshace la migración del mismo nombre.
-- Borra datos de licencias (no del padrón). El cliente desplegado tolera la ausencia de la fuente.
begin;
set local search_path = public, interno, extensions;
drop view if exists v_licencias_office;
drop function if exists guardar_licencia_office(bigint, text, text, text);
drop function if exists afiliar_licencia_office(bigint, text, text, bigint);
drop function if exists desafiliar_licencia_office(bigint);
drop table if exists licencias_office_personas;
drop table if exists licencias_office;
commit;
```

- [ ] **Step 3: Carga inicial** (`scripts/licencias-2026-09-29.sql`), generada desde el ensayo de afiliación del 2026-09-29 (43 nombres: 39 DNI, 4 por afiliar). Estructura:

```sql
-- scripts/licencias-2026-09-29.sql — Carga inicial de Licencias Office desde
-- «Licencias Office - PROMANT.pdf» (20 grupos, 43 trabajadores). DNI resueltos
-- contra v_personal el 2026-09-29 (38 únicos + Aníbal Mayta por descarte);
-- 4 sin coincidencia quedan «por afiliar» con el nombre de la fuente.
-- UNA transacción. Uso: . .\scripts\token-supabase.ps1; node scripts/aplicar-sql.mjs scripts/licencias-2026-09-29.sql
begin;
set local search_path = public, interno, extensions;
insert into licencias_office (grupo, correo) values
  ('RRHH_GERENCIA', 'g_rrhh@promantserv.onmicrosoft.com'),
  … (20 filas)
on conflict (grupo) do nothing;
insert into licencias_office_personas (licencia_id, dni, nombre)
select l.id, x.dni, x.nombre from (values
  ('RRHH_GERENCIA', '73189654', 'ESPINOZA REYES MAITHE JULIA'),
  ('ADMINISTRACION', null, 'ESPERANZA QUEVEDO'),
  … (43 filas)
) as x(grupo, dni, nombre) join licencias_office l on l.grupo = x.grupo
where not exists (select 1 from licencias_office_personas p where p.licencia_id = l.id and p.hasta is null
                  and (p.dni = x.dni or (x.dni is null and p.nombre = x.nombre)));
do $$
declare g int; t int; c int; s int;
begin
  select count(*) into g from licencias_office;
  select count(*), count(dni), count(*) - count(dni) into t, c, s from licencias_office_personas where hasta is null;
  if g <> 20 or t <> 43 or c <> 39 or s <> 4 then raise exception 'licencias: %/%/%/% esperado 20/43/39/4', g, t, c, s; end if;
end $$;
commit;
```

- [ ] **Step 4: Ensayo de migración y reversión en local:** script temporal en el scratchpad que arranca `arrancarPgLocal({ seguridad: true })` sin `licencias.sql` (quitar de CANONICOS por env o cargar los canónicos a mano), aplica la migración, comprueba `to_regclass('v_licencias_office') is not null`, aplica la reversión y comprueba `is null`. (Alternativa aceptable: aplicar la migración sobre una BD local ya cargada, que debe ser idempotente y no fallar.)
- [ ] **Step 5: Commit** `licencias(sql): migración, reversión y carga inicial (20 grupos, 43 personas)`.

---

### Task 4: Cliente — fuente, acciones, ruta, menú y pantalla ADQ-09

**Files:** Modify `src/state.jsx` (FUENTES línea 25, LOCAL línea 59, `acciones`), `src/data/mock.js` (tras `LINEAS`), `src/App.jsx` (import + ruta), `src/layout/Shell.jsx` (import `MailCheck`, NAV_ADMIN). Create `src/pages/admin/LicenciasOffice.jsx`.

**Consumes:** `db.licenciasOffice` (filas de `v_licencias_office`), `db.personal`, `empresaPor(id)`, y de Task 1 `normalizarGrupo`, `normalizarCorreoLicencia`, `correoValido`, `sugerirPersona`.

**Produces (acciones en `useApp()`):** `guardarLicenciaOffice({id, grupo, correo, estado}) → {error}`, `afiliarLicenciaOffice(licenciaId, {dni, nombre, fila}) → {error}`, `desafiliarLicenciaOffice(filaId) → {error}` — todas vía `rpc(nombre, args, "licenciasOffice")`.

- [ ] **Step 1: state.jsx.** FUENTES: `licenciasOffice: "v_licencias_office",` después de `lineas`. LOCAL: `licenciasOffice: MOCK.LICENCIAS_OFFICE,`. Acciones (junto a `asignarUsoLinea`):

```js
    // ADQ-09 · Licencias Office (2026-09-29): escritura solo por RPC con nivel 2 de activos.
    guardarLicenciaOffice: ({ id = null, grupo, correo, estado = "activa" }) =>
      rpc("guardar_licencia_office", { p_id: id, p_grupo: grupo, p_correo: correo, p_estado: estado }, "licenciasOffice"),
    afiliarLicenciaOffice: (licenciaId, { dni = null, nombre = null, fila = null }) =>
      rpc("afiliar_licencia_office", { p_licencia: licenciaId, p_dni: dni, p_nombre: nombre, p_fila: fila }, "licenciasOffice"),
    desafiliarLicenciaOffice: (filaId) => rpc("desafiliar_licencia_office", { p_fila: filaId }, "licenciasOffice"),
```

- [ ] **Step 2: mock.js**

```js
export const LICENCIAS_OFFICE = [
  { id: 1, grupo: "RRHH_03", correo: "rrhh@promantserv.onmicrosoft.com", estado: "activa", paga: "promant", alta: "2026-09-29", cantidad: 2, porAfiliar: 1,
    personas: [{ id: 1, dni: "45231876", nombre: "Rosa Quispe Huamán", empresa: "negliaf", afiliado: true }, { id: 2, dni: null, nombre: "ESPERANZA QUEVEDO", empresa: null, afiliado: false }] },
  { id: 2, grupo: "SISTEMAS", correo: "sistemas@promantserv.onmicrosoft.com", estado: "suspendida", paga: "promant", alta: "2026-09-29", cantidad: 1, porAfiliar: 0,
    personas: [{ id: 3, dni: "40125634", nombre: "Julio Mamani Apaza", empresa: "negliaf", afiliado: true }] },
];
```

- [ ] **Step 3: App.jsx** `import LicenciasOffice from "./pages/admin/LicenciasOffice";` y ruta `<Route path="/admin/licencias" element={<RequiereModulo modulo="activos"><LicenciasOffice /></RequiereModulo>} />` tras la de líneas. **Shell.jsx:** `MailCheck` en el import de lucide; NAV_ADMIN: `{ to: "/admin/licencias", icon: MailCheck, label: "Licencias Office", code: "ADQ-09", modulo: "activos" },` tras líneas.
- [ ] **Step 4: Pantalla** (`src/pages/admin/LicenciasOffice.jsx`): ver código en el archivo (cabecera, 3 `Stat`, tabla con etiquetas por persona, selector para «por afiliar» con sugerencia, «+ Afiliar», select de estado por fila, modal «Nuevo grupo» con selección múltiple del padrón vigente, `Note` de error). Reglas: padrón = `db.personal.filter(p => p.estado === "vigente")`; excluir de los selectores los DNI ya abiertos en ese grupo; `sugerirPersona(nombre, padron, dnisDelGrupo)` preselecciona; `Badge` de estado con tonos `conf/pend/neutral` como líneas.
- [ ] **Step 5:** `npx vite build` sin errores; `npm test` verde; prueba en `MODO_DEMO` no requerida (build basta).
- [ ] **Step 6: Commit** `backoffice(ADQ-09): pantalla Licencias Office con afiliación desde el padrón`.

---

### Task 5: Verificador de producción y documentación

**Files:** Create `scripts/verificar-licencias.mjs`. Modify `supabase/MODELO.md` (orden de canónicos + sección breve), `docs/superpowers/plans/…` (este plan: marcar tareas).

- [ ] **Step 1: verificar-licencias.mjs** (Management API, patrón `verificar-soporte.mjs`): (a) catálogo igual que el ensayo (2 políticas, RLS, invoker, 3 RPC con grants correctos, 2 disparadores); (b) carga: 20 grupos, 43 abiertas, 39 con DNI, 4 sin DNI, y que `v_licencias_office` sume `cantidad` = 43; (c) los 4 por afiliar son exactamente ESPERANZA QUEVEDO, ANA SANABRIA, EMILIO JUAREZ, MARIANO VILLANUEVA.
- [ ] **Step 2: MODELO.md**: añadir `licencias.sql` al orden («soporte.sql → licencias.sql → api-servicio.sql») y un párrafo con las dos tablas, la vista y las tres RPC.
- [ ] **Step 3: Commit** `docs(licencias): verificador de producción y MODELO.md`.

---

### Task 6: Despliegue (Diego con `!`) y cierre

- [ ] **Step 1 (Diego):** `! cd /c/Users/DiegoSalguero/Intranet && export SUPABASE_ACCESS_TOKEN=$(powershell -NoProfile -Command ". .\scripts\token-supabase.ps1 | Out-Null; \$env:SUPABASE_ACCESS_TOKEN" | tr -d "\r\n") && node scripts/aplicar-sql.mjs supabase/migraciones/2026-09-29-licencias-office.sql && node scripts/aplicar-sql.mjs scripts/licencias-2026-09-29.sql`
- [ ] **Step 2:** `node scripts/verificar-licencias.mjs` y `node scripts/verificar-fase4.mjs` verdes.
- [ ] **Step 3:** `git push origin main` → CI (`ensayar-canon`) verde → deploy Ready → `node scripts/verificar-despliegue.mjs`.
- [ ] **Step 4:** `node scripts/funciones-y-permisos.mjs` (esperado 164, 0 sin guarda) y commit de `docs/funciones-y-permisos.md`.
- [ ] **Step 5:** Prueba manual de Diego en ADQ-09; actualizar memoria del proyecto.
