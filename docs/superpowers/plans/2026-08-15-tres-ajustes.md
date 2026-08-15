# Tres Ajustes (Excel, Boletas PDF, Razones Sociales) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer reales la importación de personal desde el Excel de planilla (RRH-05), la carga masiva de boletas desde PDF consolidado (RRH-06→10), y la reestructura de razones sociales (L. AMERICANA real, BREMCO retirada, CLEAN nueva).

**Architecture:** Parsers como funciones puras en `src/lib/` (testeables con vitest en Node, usables en el navegador), aplicación transaccional vía RPCs de Supabase, subida de PDFs por página a Storage con nombre por hash SHA-256, y las pantallas existentes RRH-05/RRH-06 conectadas al flujo real. Migración SQL idempotente + sincronización del `schema.sql` canónico.

**Tech Stack:** React 19 + Vite 7, Supabase (PostgREST/RPC/Storage vía canal `/api/supa`), vitest (dev), pdfjs-dist (extracción de texto), pdf-lib (partición por páginas). El lector .xlsx es propio (~60 líneas, sin dependencia).

**Spec:** `docs/superpowers/specs/2026-08-15-tres-ajustes-design.md` · **Requerimiento fuente:** `docs/requerimientos/2026-08-15-tres-ajustes.md`

## Global Constraints

- Todo identificador es TEXTO. Un DNI como `09113655` conserva su cero inicial en cada capa (parser, JSON, SQL, UI).
- Ningún proceso masivo cesa/desactiva/borra por ausencia. Un cese solo entra con fecha en F.Cese o manual.
- Cargas transaccionales y con vista previa: se muestra qué va a pasar, se confirma, entra todo o no entra nada.
- Reprocesar el mismo archivo no duplica nada (idempotencia).
- Nada se publica sin trabajador identificado.
- Sin OCR (el PDF tiene capa de texto). No extraer ni almacenar números de cuenta bancaria ni CUSPP.
- Nunca sobrescribir un valor almacenado con uno más corto que sea su prefijo (datos truncados).
- Los valores fiscales de CLEAN los da Diego; no se inventan (checkpoint).
- UI y mensajes en español, estilo del proyecto (código con nombres en español donde el codebase ya lo hace).
- Cada tarea termina con tests en verde y commit. Push a `main` = deploy Vercel (hacer push al cerrar cada fase, no por commit).
- Comandos git: ejecutarlos con PowerShell (el clasificador bloquea git en Bash); mensajes con here-string `@'…'@`.
- Los scripts `scripts/verificar-*.mjs` usan `SUPABASE_ACCESS_TOKEN` (cargar con `scripts/token-supabase.ps1`).

---

## Fase 0 — Fixtures e infraestructura de pruebas

### Task 1: Fixtures y vitest

**Files:**
- Create: `tests/fixtures/LISTA_PAIS.xlsx` (copia de `C:\Users\DiegoSalguero\Downloads\LISTA PAIS.xlsx`)
- Create: `tests/fixtures/BOLETAS.pdf` (copia de `C:\Users\DiegoSalguero\OneDrive - RedPontis\Documentos\BOLETAS.pdf`)
- Create: `tests/humo.test.js`
- Modify: `package.json` (devDependency vitest + script test)

**Interfaces:**
- Produces: fixtures binarios accesibles por ruta relativa `tests/fixtures/…`; comando `npm test`.

- [ ] **Step 1: Copiar fixtures e instalar vitest**

```powershell
Set-Location C:\Users\DiegoSalguero\Intranet
New-Item -ItemType Directory -Force tests\fixtures | Out-Null
Copy-Item "C:\Users\DiegoSalguero\Downloads\LISTA PAIS.xlsx" tests\fixtures\LISTA_PAIS.xlsx
Copy-Item "C:\Users\DiegoSalguero\OneDrive - RedPontis\Documentos\BOLETAS.pdf" tests\fixtures\BOLETAS.pdf
npm install -D vitest
```

En `package.json`, agregar a `scripts`: `"test": "vitest run"`.

- [ ] **Step 2: Test humo que lee ambos fixtures**

```js
// tests/humo.test.js
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("fixtures", () => {
  it("LISTA_PAIS.xlsx existe y es un ZIP (xlsx)", () => {
    const buf = readFileSync("tests/fixtures/LISTA_PAIS.xlsx");
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
  });
  it("BOLETAS.pdf existe y es un PDF", () => {
    const buf = readFileSync("tests/fixtures/BOLETAS.pdf");
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
```

- [ ] **Step 3: Correr y verificar que pasa**

Run: `npm test` → Expected: 2 passed.

- [ ] **Step 4: Commit**

```powershell
git add tests package.json package-lock.json
git commit -m @'
test: fixtures reales (LISTA_PAIS.xlsx, BOLETAS.pdf) e infraestructura vitest
'@
```

---

## Fase 1 — Cambio 3: razones sociales

### Task 2: Migración SQL de razones sociales y columnas nuevas

**Files:**
- Create: `supabase/migraciones/2026-08-15-tres-ajustes.sql`
- Modify: `supabase/schema.sql` (mismos cambios en el canónico: columnas en `create table`, seeds actualizados)
- Create: `scripts/verificar-tres-ajustes.mjs` (verificación E2E de BD; se amplía en tareas posteriores)

**Interfaces:**
- Produces: columnas `empresas.estado` ('activa'|'retirada'), `personas.nombre_por_confirmar` bool, `vinculos.centro_costo` text, `documentos.neto` numeric, tabla `cargos(nombre text pk)`; trigger `fn_solo_empresa_activa` sobre `vinculos` y `lotes`; datos reales de L. AMERICANA; BREMCO retirada.

- [ ] **Step 1: Escribir la migración idempotente**

```sql
-- supabase/migraciones/2026-08-15-tres-ajustes.sql
-- Tres ajustes (2026-08-15): razones sociales + soporte de importaciones reales.

alter table empresas  add column if not exists estado text not null default 'activa';
do $$ begin
  alter table empresas add constraint empresas_estado_chk check (estado in ('activa','retirada'));
exception when duplicate_object then null; end $$;
alter table empresas  add column if not exists direccion text;
alter table personas  add column if not exists nombre_por_confirmar boolean not null default false;
alter table vinculos  add column if not exists centro_costo text;
alter table documentos add column if not exists neto numeric;

create table if not exists cargos (nombre text primary key);
insert into cargos (nombre) values
  ('Operario de limpieza'), ('Supervisor de sede'), ('Técnico de mantenimiento'),
  ('Auxiliar de servicios'), ('Analista RRHH'), ('Jefe de RRHH'),
  ('OPERARIO(A) DE LIMPIEZA'), ('SUPERVISOR(A) DE LIMPIEZA')
on conflict do nothing;

-- Datos REALES de Limpieza Americana (las boletas cotejan por este RUC).
update empresas set ruc = '20601705185',
  direccion = 'Av. San Borja Sur Nro. 1184, Urb. San Borja Sur'
where id = 'lamericana';

-- BREMCO sale del grupo: retirada, jamás eliminada (conservación documental).
update empresas set estado = 'retirada' where id = 'bremco';

-- Nada nuevo sobre una empresa retirada (vínculos y lotes; contratos y
-- comunicados nuevos quedan bloqueados por la UI, que filtra activas).
create or replace function fn_solo_empresa_activa() returns trigger
language plpgsql as $$
begin
  if (select estado from empresas where id = new.empresa_id) <> 'activa' then
    raise exception 'La empresa % está retirada del grupo: no admite registros nuevos.', new.empresa_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_vinculo_empresa_activa on vinculos;
create trigger trg_vinculo_empresa_activa before insert on vinculos
  for each row execute function fn_solo_empresa_activa();
drop trigger if exists trg_lote_empresa_activa on lotes;
create trigger trg_lote_empresa_activa before insert on lotes
  for each row execute function fn_solo_empresa_activa();
```

Sincronizar `supabase/schema.sql`: agregar las mismas columnas dentro de los `create table` (`estado`, `direccion`, `nombre_por_confirmar`, `centro_costo`, `neto`), la tabla `cargos`, el trigger, y actualizar el seed de `lamericana` con RUC/dirección reales y el de `bremco` con `estado='retirada'`.

- [ ] **Step 2: Aplicar contra producción**

```powershell
& scripts\token-supabase.ps1 | Out-Null
node scripts/aplicar-sql.mjs supabase/migraciones/2026-08-15-tres-ajustes.sql
```

- [ ] **Step 3: Script de verificación (es el "test" de BD)**

```js
// scripts/verificar-tres-ajustes.mjs — pruebas E2E de BD de los tres ajustes.
// Uso: & scripts/token-supabase.ps1 | Out-Null; node scripts/verificar-tres-ajustes.mjs
const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
let fallos = 0;
async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
async function prueba(nombre, fn) {
  try { await fn(); console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); }
}
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

await prueba("L. Americana tiene el RUC real", async () => {
  const [e] = await sql("select ruc from empresas where id='lamericana'");
  igual(e.ruc, "20601705185", "ruc");
});
await prueba("BREMCO está retirada", async () => {
  const [e] = await sql("select estado from empresas where id='bremco'");
  igual(e.estado, "retirada", "estado");
});
await prueba("no se puede crear un vínculo en BREMCO", async () => {
  let fallo = false;
  try {
    await sql("insert into vinculos (persona_dni, empresa_id, sede_id, cargo, fecha_inicio) values ('45231876','bremco','essalud','Operario de limpieza','2026-01-01')");
  } catch { fallo = true; }
  igual(fallo, true, "el insert debió fallar");
});
await prueba("los históricos de BREMCO siguen consultables", async () => {
  const [r] = await sql("select count(*)::int n from vinculos where empresa_id='bremco'");
  igual(r.n >= 2, true, "vínculos históricos");
});
await prueba("catálogo de cargos existe", async () => {
  const [r] = await sql("select count(*)::int n from cargos");
  igual(r.n >= 8, true, "cargos seed");
});
console.log(fallos ? `\n${fallos} PRUEBAS FALLARON` : "\nTODAS LAS PRUEBAS PASARON");
process.exit(fallos ? 1 : 0);
```

Run: `node scripts/verificar-tres-ajustes.mjs` → Expected: TODAS LAS PRUEBAS PASARON.

- [ ] **Step 4: Commit**

```powershell
git add supabase scripts/verificar-tres-ajustes.mjs
git commit -m @'
feat(empresas): estado activa/retirada, datos reales L.Americana, BREMCO retirada, catalogo de cargos
'@
```

### Task 3: Frontend — solo empresas activas en selectores; textos

**Files:**
- Modify: `src/data/mock.js` (empresas: `estado` en cada una; `lamericana` RUC real; `bremco` estado retirada)
- Modify: `src/state.jsx` (exponer `empresasActivas` además de `db.empresas`)
- Modify: pantallas con selector de empresa para ALTA/carga (mínimo: `src/pages/rrhh/Boletas.jsx`, `src/pages/rrhh/Personal.jsx`, `src/components/*Shell*` selector global, `src/pages/accesos/PerfilEditor.jsx` para alcances nuevos) → iterar solo `empresasActivas`
- Modify: cualquier texto "cinco razones sociales"/"las cinco empresas" → cuatro

**Interfaces:**
- Consumes: `empresas.estado` de Task 2 (la vista/tabla ya lo expone; verificar que `v_*` o la lectura de empresas incluya la columna — si la lista de empresas se lee de una vista, agregar `estado` a esa vista en la migración de Task 2).
- Produces: `useApp().empresasActivas` — array con el mismo shape que `db.empresas`, filtrado `estado === 'activa'`.

- [ ] **Step 1: Localizar todos los consumidores**

```powershell
Set-Location C:\Users\DiegoSalguero\Intranet
Select-String -Path src\**\*.jsx,src\**\*.js -Pattern "db\.empresas|cinco (razones|empresas)" | Select-Object Path, LineNumber, Line
```

- [ ] **Step 2: Implementar filtro**

En `state.jsx`, junto a las demás derivaciones del provider:

```jsx
const empresasActivas = useMemo(
  () => db.empresas.filter((e) => (e.estado ?? "activa") === "activa"),
  [db.empresas]
);
// añadir empresasActivas al value del contexto
```

Sustituir `db.empresas.map(…)` por `empresasActivas.map(…)` SOLO en selectores de alta/carga/filtros de trabajo nuevo. Las vistas históricas (p. ej. filtros de consulta de acuses/lotes ya publicados) siguen mostrando todas.

- [ ] **Step 3: Verificar build y manualmente en dev**

Run: `npm run build` → Expected: build OK. En `npm run dev`: BREMCO no aparece en el selector del Shell ni en Boletas/Personal; los datos históricos de BREMCO siguen visibles en listados.

- [ ] **Step 4: Commit**

```powershell
git add src
git commit -m @'
feat(empresas): selectores solo con empresas activas; BREMCO fuera de altas y filtros de trabajo
'@
```

### Task 4: Alta de CLEAN — CHECKPOINT con Diego

**Files:**
- Modify: `supabase/migraciones/2026-08-15-tres-ajustes.sql` (insert de CLEAN al final)
- Modify: `supabase/schema.sql`, `src/data/mock.js` (seed espejo)
- Create: `public/logos/clean.*` (logo que entregue Diego)

**Interfaces:**
- Consumes: datos fiscales reales de CLEAN **que entrega Diego** (razón social completa, nombre corto, RUC, dirección, logo). BLOQUEADO hasta tenerlos — no inventar valores; si al llegar a esta tarea no están, saltarla y continuar (no bloquea nada posterior) y retomarla al final.

- [ ] **Step 1: Pedir a Diego los datos si aún no los dio** (checkpoint del requerimiento)
- [ ] **Step 2: Insert idempotente con los valores reales**

```sql
insert into empresas (id, nombre, corto, ruc, logo, regimen, direccion, estado)
values ('clean', '<RAZON SOCIAL REAL>', 'CLEAN', '<RUC REAL>', '/logos/clean.jpeg',
        '<REGIMEN REAL>', '<DIRECCION REAL>', 'activa')
on conflict (id) do update set nombre = excluded.nombre, ruc = excluded.ruc,
  logo = excluded.logo, regimen = excluded.regimen, direccion = excluded.direccion;
```

Aplicar con `node scripts/aplicar-sql.mjs`, replicar en `schema.sql` y `mock.js`.

- [ ] **Step 3: Verificar** — agregar a `verificar-tres-ajustes.mjs`: "el sistema muestra cuatro razones sociales activas" (`select count(*)::int n from empresas where estado='activa'` → 4) y correr.
- [ ] **Step 4: Commit** — `feat(empresas): alta de CLEAN con datos fiscales reales`

---

## Fase 2 — Cambio 1: importación de personal desde Excel

### Task 5: Lector mínimo de .xlsx

**Files:**
- Create: `src/lib/importar/xlsx.js`
- Test: `tests/importar/xlsx.test.js`

**Interfaces:**
- Produces: `async function leerXlsx(bytes: Uint8Array): Promise<string[][]>` — filas de la primera hoja como matrices de strings (celdas resueltas contra sharedStrings; celda ausente = `""`). Usa `DecompressionStream("deflate-raw")` (existe en navegador y Node ≥18) — sin dependencias.

- [ ] **Step 1: Test que falla (contra el fixture real)**

```js
// tests/importar/xlsx.test.js
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { leerXlsx } from "../../src/lib/importar/xlsx.js";

const bytes = new Uint8Array(readFileSync("tests/fixtures/LISTA_PAIS.xlsx"));

describe("leerXlsx", () => {
  it("lee las 15 filas del reporte", async () => {
    const filas = await leerXlsx(bytes);
    expect(filas.length).toBe(15);
  });
  it("fila 1 trae la razón social con relleno", async () => {
    const filas = await leerXlsx(bytes);
    expect(filas[0][0]).toContain("LIMPIEZA AMERICANA S.A.C.");
    expect(filas[0][0]).toContain("PAG.");
  });
  it("los DNI llegan como texto con cero inicial", async () => {
    const filas = await leerXlsx(bytes);
    expect(filas[6][2].trim()).toBe("09113655");
  });
});
```

Run: `npx vitest run tests/importar/xlsx.test.js` → Expected: FAIL (módulo no existe).

- [ ] **Step 2: Implementación**

```js
// src/lib/importar/xlsx.js — lector mínimo de .xlsx (ZIP + XML), sin dependencias.
// El archivo real es un reporte de texto plano de 10 columnas: no se necesita
// una librería de hoja de cálculo completa.

async function inflar(datos, metodo) {
  if (metodo === 0) return datos; // almacenado sin comprimir
  const ds = new DecompressionStream("deflate-raw");
  const salida = new Response(new Blob([datos]).stream().pipeThrough(ds));
  return new Uint8Array(await salida.arrayBuffer());
}

function leerEntradasZip(bytes) {
  // Fin del directorio central (EOCD): firma 0x06054b50, buscada desde el final.
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("El archivo no es un .xlsx válido (sin directorio ZIP).");
  const total = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entradas = new Map();
  for (let n = 0; n < total; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Directorio ZIP corrupto.");
    const metodo = dv.getUint16(p + 10, true);
    const tamComp = dv.getUint32(p + 20, true);
    const largoNombre = dv.getUint16(p + 28, true);
    const largoExtra = dv.getUint16(p + 30, true);
    const largoComent = dv.getUint16(p + 32, true);
    const offsetLocal = dv.getUint32(p + 42, true);
    const nombre = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + largoNombre));
    entradas.set(nombre, { metodo, tamComp, offsetLocal });
    p += 46 + largoNombre + largoExtra + largoComent;
  }
  return { dv, entradas };
}

async function extraer(bytes, dv, entrada) {
  const p = entrada.offsetLocal;
  const largoNombre = dv.getUint16(p + 26, true);
  const largoExtra = dv.getUint16(p + 28, true);
  const inicio = p + 30 + largoNombre + largoExtra;
  return inflar(bytes.subarray(inicio, inicio + entrada.tamComp), entrada.metodo);
}

const decodificarXml = (s) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
   .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
   .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
   .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

const colAIndice = (ref) => {
  let n = 0;
  for (const ch of ref) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

export async function leerXlsx(bytes) {
  const { dv, entradas } = leerEntradasZip(bytes);
  const texto = async (nombre) =>
    entradas.has(nombre) ? new TextDecoder().decode(await extraer(bytes, dv, entradas.get(nombre))) : "";

  const compartidas = [...(await texto("xl/sharedStrings.xml")).matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => decodificarXml(m[1].replace(/<[^>]+>/g, "")));

  const hoja = await texto("xl/worksheets/sheet1.xml");
  if (!hoja) throw new Error("El .xlsx no contiene la hoja esperada (xl/worksheets/sheet1.xml).");

  const filas = [];
  for (const [, cuerpo] of hoja.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const fila = [];
    for (const c of cuerpo.matchAll(/<c ([^>]*?)\/?>(?:<v>([^<]*)<\/v>)?(?:<\/c>)?/g)) {
      const attrs = c[1];
      const ref = (attrs.match(/r="([A-Z]+)\d+"/) || [])[1];
      let valor = c[2] ?? "";
      if (/t="s"/.test(attrs)) valor = compartidas[Number(valor)] ?? "";
      else valor = decodificarXml(valor);
      if (ref) fila[colAIndice(ref)] = String(valor);
    }
    filas.push(Array.from(fila, (v) => v ?? ""));
  }
  return filas;
}
```

- [ ] **Step 3: Correr los tests** — `npx vitest run tests/importar/xlsx.test.js` → PASS.
- [ ] **Step 4: Commit** — `feat(importar): lector minimo de .xlsx sin dependencias`

### Task 6: Parser del reporte PLATRA1

**Files:**
- Create: `src/lib/importar/planilla.js`
- Test: `tests/importar/planilla.test.js`

**Interfaces:**
- Consumes: `leerXlsx` (Task 5) — el parser recibe `string[][]`, no bytes (separación de responsabilidades).
- Produces:
  - `function parsearPlanilla(filas: string[][], hoy?: Date): { empresa: string, emitido: string|null, centroCosto: string|null, situacionFiltro: string|null, filas: FilaPlanilla[], errores: string[] }`
  - `FilaPlanilla = { codigo, nombres, dni, sexo, sede, cargo, centroCosto, ingreso: 'YYYY-MM-DD', cese: 'YYYY-MM-DD'|null, situacion, nombreTruncado: boolean }`
  - `function normalizar(s: string): string` — trim, mayúsculas, sin acentos (NFD sin marcas; Ñ→N en AMBOS lados de toda comparación), espacios colapsados. Exportada: la reutilizan boletas y el cotejo de empresa.
  - Si los encabezados no se encuentran o la fecha de ingreso es futura o el DNI no son 8 dígitos, la FILA va a `errores` (con número de fila y motivo); si no hay encabezados válidos en todo el archivo, lanza `Error("No encuentro la fila de encabezados …")`.

- [ ] **Step 1: Tests que fallan**

```js
// tests/importar/planilla.test.js
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { leerXlsx } from "../../src/lib/importar/xlsx.js";
import { parsearPlanilla, normalizar } from "../../src/lib/importar/planilla.js";

const HOY = new Date("2026-08-15");
let filas;
beforeAll(async () => {
  filas = await leerXlsx(new Uint8Array(readFileSync("tests/fixtures/LISTA_PAIS.xlsx")));
});

describe("parsearPlanilla con LISTA_PAIS.xlsx", () => {
  it("extrae los nueve trabajadores sin errores", () => {
    const r = parsearPlanilla(filas, HOY);
    expect(r.errores).toEqual([]);
    expect(r.filas.length).toBe(9);
  });
  it("conserva el cero inicial del DNI", () => {
    const r = parsearPlanilla(filas, HOY);
    expect(r.filas.map((f) => f.dni)).toContain("09113655");
  });
  it("'/  /' en F.Cese es null, sin error", () => {
    const r = parsearPlanilla(filas, HOY);
    expect(r.filas.every((f) => f.cese === null)).toBe(true);
  });
  it("regla de siglo: 21/05/26 → 2026-05-21, 01/08/24 → 2024-08-01", () => {
    const r = parsearPlanilla(filas, HOY);
    const lucila = r.filas.find((f) => f.dni === "09113655");
    expect(lucila.ingreso).toBe("2026-05-21");
  });
  it("la razón social sale de la fila 1", () => {
    const r = parsearPlanilla(filas, HOY);
    expect(r.empresa).toBe("LIMPIEZA AMERICANA S.A.C.");
  });
  it("marca nombres truncados a 30 caracteres", () => {
    const r = parsearPlanilla(filas, HOY);
    const llerena = r.filas.find((f) => f.dni === "76926184");
    expect(llerena.nombreTruncado).toBe(true);
  });
});

describe("archivo multipágina sintético", () => {
  it("descarta cabeceras repetidas y filas de relleno", () => {
    const pagina2 = [
      ["LIMPIEZA AMERICANA S.A.C.                 PAG.    2"],
      ["PLATRA1        Registro de Trabajadores       14/08/2026"],
      ["   Centro de Costo : MIDIS - PAIS   "], ["   Situación : VIGENTE   "], [""],
      filas[5], // encabezados repetidos
      ["11111111", "PRUEBA UNO                     ", "11111111", "M", "SEDE CENTRAL", "OPERARIO(A) DE LIMPIEZA", "1600", "01/02/25", "/  /", "VIGENTE"],
    ];
    const r = parsearPlanilla([...filas, ...pagina2], HOY);
    expect(r.errores).toEqual([]);
    expect(r.filas.length).toBe(10);
  });
});

describe("validaciones", () => {
  it("fecha de ingreso futura es error de fila", () => {
    const malas = [...filas.slice(0, 6),
      ["22222222", "FUTURO                        ", "22222222", "M", "SEDE X", "CARGO", "1", "01/01/49", "/  /", "VIGENTE"]];
    const r = parsearPlanilla(malas, HOY);
    expect(r.errores.length).toBe(1);
    expect(r.errores[0]).toMatch(/futura/i);
  });
  it("sin encabezados reconocibles, se detiene con mensaje claro", () => {
    expect(() => parsearPlanilla([["nada"], ["de"], ["esto"]], HOY)).toThrow(/encabezados/i);
  });
  it("normalizar iguala acentos y Ñ", () => {
    expect(normalizar("ASTUPIÑAN")).toBe(normalizar("ASTUPIÑAN".normalize("NFD")));
  });
});
```

Run → Expected: FAIL (módulo no existe).

- [ ] **Step 2: Implementación**

```js
// src/lib/importar/planilla.js — parser del reporte PLATRA1 exportado a Excel.
// Reporte de impresión, no hoja limpia: cabecera en filas 1-5 (todo en col A),
// encabezados con "|" en la fila 6, datos después; en archivos multipágina el
// bloque cabecera+encabezados se repite. Todo es texto con relleno de espacios.

export const normalizar = (s) =>
  String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toUpperCase()
    .replace(/\s+/g, " ").trim();

const ETIQUETAS = ["CODIGO", "NOMBRES", "DNI", "SEXO", "UNIDAD SERVICIO",
  "CARGO", "C.COSTO", "F.INGRES", "F.CESE", "SITUACIO"];

const esFilaEncabezados = (fila) =>
  ETIQUETAS.every((e, i) => normalizar(String(fila[i] ?? "").replace(/\|/g, "")) === e);

// dd/mm/aa → ISO. Regla de siglo: 00–50 = 20xx; 51–99 = 19xx. "/  /" → null.
function parsearFecha(celda) {
  const limpio = String(celda ?? "").trim();
  if (!limpio || /^\/\s*\/$/.test(limpio)) return { fecha: null };
  const m = limpio.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (!m) return { error: `fecha ilegible «${limpio}»` };
  const [, d, mes, aa] = m;
  const anio = Number(aa) <= 50 ? 2000 + Number(aa) : 1900 + Number(aa);
  const fecha = `${anio}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (isNaN(Date.parse(fecha))) return { error: `fecha inválida «${limpio}»` };
  return { fecha };
}

export function parsearPlanilla(filas, hoy = new Date()) {
  // Cabecera del reporte (primer bloque).
  const fila1 = String(filas[0]?.[0] ?? "");
  const empresa = fila1.replace(/PAG\..*$/i, "").trim();
  if (!empresa) throw new Error("No encuentro la razón social en la fila 1 del reporte.");
  const emitido = (String(filas[1]?.[0] ?? "").match(/\d{2}\/\d{2}\/\d{4}/) || [null])[0];
  const centroCosto = (String(filas[2]?.[0] ?? "").match(/Centro de Costo\s*:\s*(.+)/i) || [, null])[1]?.trim() ?? null;
  const situacionFiltro = (String(filas[3]?.[0] ?? "").match(/Situación\s*:\s*(.+)/i) || [, null])[1]?.trim() ?? null;

  // Encabezados por CONTENIDO, no por posición.
  const iEnc = filas.findIndex(esFilaEncabezados);
  if (iEnc < 0) throw new Error(
    "No encuentro la fila de encabezados (Código | Nombres | DNI | …). ¿Es el reporte PLATRA1 exportado a Excel?");

  const empresaNorm = normalizar(empresa);
  const datos = [];
  const errores = [];
  const hoyIso = hoy.toISOString().slice(0, 10);

  filas.forEach((fila, i) => {
    if (i <= iEnc) return;
    const a = String(fila[0] ?? "").trim();
    // Bloques repetidos de cabecera en archivos multipágina + relleno.
    if (!fila.some((c) => String(c ?? "").trim())) return;               // vacía
    if (normalizar(a).startsWith(empresaNorm) || a.startsWith("PLATRA1")) return;
    if (/^(Centro de Costo|Situación)\s*:/i.test(String(fila[0] ?? "").trim())) return;
    if (esFilaEncabezados(fila)) return;

    const [codigo, nombres, dni, sexo, sede, cargo, cc, fIng, fCese, situacion] =
      fila.map((c) => String(c ?? "").trim());
    const num = i + 1;
    if (!/^\d{8}$/.test(dni)) { errores.push(`Fila ${num}: DNI «${dni}» no tiene 8 dígitos.`); return; }
    const ingreso = parsearFecha(fIng);
    if (ingreso.error) { errores.push(`Fila ${num}: F.Ingres ${ingreso.error}.`); return; }
    if (!ingreso.fecha) { errores.push(`Fila ${num}: falta la fecha de ingreso.`); return; }
    if (ingreso.fecha > hoyIso) { errores.push(`Fila ${num}: fecha de ingreso futura (${ingreso.fecha}).`); return; }
    const cese = parsearFecha(fCese);
    if (cese.error) { errores.push(`Fila ${num}: F.Cese ${cese.error}.`); return; }

    datos.push({
      codigo, nombres, dni, sexo, sede, cargo, centroCosto: cc,
      ingreso: ingreso.fecha, cese: cese.fecha, situacion,
      nombreTruncado: nombres.length >= 30,
    });
  });

  return { empresa, emitido, centroCosto, situacionFiltro, filas: datos, errores };
}
```

- [ ] **Step 3: Correr** — `npx vitest run tests/importar` → PASS (todos).
- [ ] **Step 4: Commit** — `feat(importar): parser del reporte PLATRA1 (encabezados por contenido, regla de siglo, multipagina)`

### Task 7: RPCs `previsualizar_importacion` e `importar_planilla`

**Files:**
- Modify: `supabase/migraciones/2026-08-15-tres-ajustes.sql` (agregar las funciones al final)
- Modify: `supabase/schema.sql` (sincronizar)
- Modify: `scripts/verificar-tres-ajustes.mjs` (pruebas E2E de importación)

**Interfaces:**
- Consumes: forma `FilaPlanilla` de Task 6 (claves JSON: `codigo,nombres,dni,sexo,sede,cargo,centroCosto,ingreso,cese,situacion,nombreTruncado`).
- Produces (ambas `security definer`, expuestas por PostgREST):
  - `previsualizar_importacion(p_empresa text, p_filas jsonb) returns jsonb` → `{altas:[dni], actualizaciones:[dni], sin_cambio:[dni], nombres_por_confirmar:int}` (solo LEE).
  - `importar_planilla(p_empresa text, p_filas jsonb, p_por text) returns jsonb` → mismo resumen tras APLICAR en una transacción (la función ES la transacción: cualquier excepción revierte todo).
- Reglas dentro de las funciones: nunca tocar campos manuales (`celular, banco, cuenta, portal, nacimiento` si existiera); jamás escribir null encima de un valor; jamás sobrescribir con un prefijo más corto (nombres/sede/cargo); NUNCA cesar por ausencia (solo se escriben las filas recibidas); sede: buscar por prefijo normalizado dentro de la empresa, si no existe crearla (`id` = slug, `cliente` = centro de costo del reporte); cargo: `insert … on conflict do nothing` al catálogo `cargos`; reimportar = `sin_cambio` (idempotencia).

- [ ] **Step 1: SQL de las funciones**

```sql
-- ¿nuevo es un prefijo truncado de actual? (jamás degradar un dato más completo)
create or replace function fn_es_prefijo_truncado(p_nuevo text, p_actual text)
returns boolean language sql immutable as $$
  select p_actual is not null and p_nuevo is not null
     and length(trim(p_nuevo)) < length(trim(p_actual))
     and upper(trim(p_actual)) like upper(trim(p_nuevo)) || '%';
$$;

create or replace function fn_sede_para_importacion(p_empresa text, p_sede text, p_cliente text)
returns text language plpgsql as $$
declare v_id text;
begin
  -- 1º igual o el nombre guardado empieza por el truncado (16 chars) o viceversa
  select id into v_id from sedes
  where empresa_id = p_empresa
    and (upper(nombre) like upper(trim(p_sede)) || '%' or upper(trim(p_sede)) like upper(nombre) || '%')
  order by length(nombre) desc limit 1;
  if v_id is not null then return v_id; end if;
  v_id := p_empresa || '-' || lower(regexp_replace(trim(p_sede), '\s+', '-', 'g'));
  insert into sedes (id, empresa_id, nombre, cliente)
  values (v_id, p_empresa, trim(p_sede), coalesce(p_cliente, 'Por asignar'))
  on conflict (id) do nothing;
  return v_id;
end $$;

create or replace function importar_planilla(p_empresa text, p_filas jsonb, p_por text)
returns jsonb language plpgsql security definer as $$
declare
  f jsonb; v_dni text; v_nombre text; v_sede_id text; v_vinculo bigint;
  v_altas text[] := '{}'; v_act text[] := '{}'; v_sin text[] := '{}';
  v_por_confirmar int := 0; v_cambio boolean;
begin
  if (select estado from empresas where id = p_empresa) is distinct from 'activa' then
    raise exception 'La empresa % no está activa: importación rechazada completa.', p_empresa;
  end if;
  for f in select * from jsonb_array_elements(p_filas) loop
    v_dni := f->>'dni';  v_nombre := trim(f->>'nombres');
    insert into cargos (nombre) values (trim(f->>'cargo')) on conflict do nothing;
    v_sede_id := fn_sede_para_importacion(p_empresa, f->>'sede', f->>'centroCosto');

    if not exists (select 1 from personas where dni = v_dni) then
      insert into personas (dni, nombre, portal, nombre_por_confirmar)
      values (v_dni, v_nombre, 'sin_celular', (f->>'nombreTruncado')::boolean);
      if (f->>'nombreTruncado')::boolean then v_por_confirmar := v_por_confirmar + 1; end if;
      insert into vinculos (persona_dni, empresa_id, sede_id, cargo, centro_costo, fecha_inicio, fecha_fin)
      values (v_dni, p_empresa, v_sede_id, trim(f->>'cargo'), trim(f->>'centroCosto'),
              (f->>'ingreso')::date, (f->>'cese')::date);
      v_altas := v_altas || v_dni;
    else
      -- persona existente: JAMÁS pisar datos personales manuales; el nombre
      -- solo mejora (nunca un prefijo más corto)
      update personas set
        nombre = case when fn_es_prefijo_truncado(v_nombre, nombre) then nombre
                      when length(v_nombre) > length(nombre) then v_nombre else nombre end
      where dni = v_dni;
      select id into v_vinculo from vinculos
      where persona_dni = v_dni and empresa_id = p_empresa and fecha_fin is null;
      if v_vinculo is null then
        insert into vinculos (persona_dni, empresa_id, sede_id, cargo, centro_costo, fecha_inicio, fecha_fin)
        values (v_dni, p_empresa, v_sede_id, trim(f->>'cargo'), trim(f->>'centroCosto'),
                (f->>'ingreso')::date, (f->>'cese')::date);
        v_act := v_act || v_dni;
      else
        select (sede_id is distinct from v_sede_id
             or not fn_es_prefijo_truncado(trim(f->>'cargo'), cargo) and cargo is distinct from trim(f->>'cargo')
             or centro_costo is distinct from trim(f->>'centroCosto')
             or (f->>'cese') is not null and fecha_fin is distinct from (f->>'cese')::date)
        into v_cambio from vinculos where id = v_vinculo;
        if v_cambio then
          update vinculos set
            sede_id = v_sede_id,
            cargo = case when fn_es_prefijo_truncado(trim(f->>'cargo'), cargo) then cargo else trim(f->>'cargo') end,
            centro_costo = trim(f->>'centroCosto'),
            fecha_fin = coalesce((f->>'cese')::date, fecha_fin)   -- cese SOLO si viene con fecha
          where id = v_vinculo;
          v_act := v_act || v_dni;
        else
          v_sin := v_sin || v_dni;
        end if;
      end if;
    end if;
  end loop;
  return jsonb_build_object('altas', to_jsonb(v_altas), 'actualizaciones', to_jsonb(v_act),
    'sin_cambio', to_jsonb(v_sin), 'nombres_por_confirmar', v_por_confirmar);
end $$;

-- La vista previa clasifica sin escribir: misma decisión, dentro de una
-- transacción que SIEMPRE se revierte.
create or replace function previsualizar_importacion(p_empresa text, p_filas jsonb)
returns jsonb language plpgsql security definer as $$
declare v jsonb;
begin
  v := importar_planilla(p_empresa, p_filas, '(vista previa)');
  raise exception using errcode = 'P0001', message = v::text; -- revertir TODO
exception when sqlstate 'P0001' then
  return sqlerrm::jsonb;
end $$;
```

- [ ] **Step 2: Aplicar y probar E2E** — agregar a `verificar-tres-ajustes.mjs` pruebas que llaman a las RPC vía SQL (`select importar_planilla('lamericana', '<json de 2 filas de prueba>'::jsonb, 'test')`): (a) alta con DNI `09999999` conserva el cero, (b) segunda corrida devuelve `sin_cambio`, (c) `previsualizar_importacion` no deja rastro (contar personas antes/después), (d) fila sin cese no cesa a nadie (contar vínculos vigentes antes/después), (e) limpieza final de los datos de prueba. Correr → TODAS PASARON.
- [ ] **Step 3: Sincronizar `schema.sql`** con las tres funciones.
- [ ] **Step 4: Commit** — `feat(importar): RPCs transaccionales previsualizar/importar_planilla (idempotentes, sin cesar por ausencia)`

### Task 8: UI RRH-05 — importación real

**Files:**
- Modify: `src/pages/rrhh/Personal.jsx` (función `ImportarPlanilla`, líneas ~297-344)
- Modify: `src/state.jsx` (acciones `previsualizarImportacion` / `importarPlanilla` con el patrón `rpc(...)` existente y refresco de `"personal"`)

**Interfaces:**
- Consumes: `leerXlsx`, `parsearPlanilla`, RPCs de Task 7, `useApp().empresasActivas`.
- Produces: flujo completo — elegir archivo → parsear en el navegador → cotejar razón social (fila 1) contra `db.empresas` con `normalizar` (si no coincide: rechazo total con mensaje, sin botón de continuar) → vista previa (conteos reales de altas/actualizaciones/sin cambio + lista de errores de fila + aviso de nombres por confirmar) → confirmar → RPC transaccional → resumen final con `nombres_por_confirmar` reportado.

- [ ] **Step 1: Reescribir `ImportarPlanilla`**

```jsx
function ImportarPlanilla({ open, onClose }) {
  const { db, previsualizarImportacion, importarPlanilla } = useApp();
  const [paso, setPaso] = useState(1);
  const [error, setError] = useState(null);
  const [analisis, setAnalisis] = useState(null); // {empresaId, nombreArchivo, filas, errores, previa}
  const [resultado, setResultado] = useState(null);
  const cerrar = () => { setPaso(1); setError(null); setAnalisis(null); setResultado(null); onClose(); };

  const analizar = async (archivo) => {
    setError(null);
    try {
      const { leerXlsx } = await import("../../lib/importar/xlsx.js");
      const { parsearPlanilla, normalizar } = await import("../../lib/importar/planilla.js");
      const filas = await leerXlsx(new Uint8Array(await archivo.arrayBuffer()));
      const r = parsearPlanilla(filas);
      const emp = db.empresas.find((e) =>
        normalizar(e.nombre) === normalizar(r.empresa) || normalizar(r.empresa).startsWith(normalizar(e.nombre)));
      if (!emp) throw new Error(
        `La razón social del reporte («${r.empresa}») no está en el catálogo. Importación rechazada completa: ninguna fila se aplica.`);
      if (emp.estado === "retirada") throw new Error(`${emp.nombre} está retirada del grupo: no admite importaciones.`);
      const previa = await previsualizarImportacion(emp.id, r.filas);
      setAnalisis({ empresaId: emp.id, empresaNombre: emp.nombre, nombreArchivo: archivo.name, ...r, previa });
      setPaso(2);
    } catch (e) { setError(e.message); }
  };

  const confirmar = async () => {
    setError(null);
    try {
      setResultado(await importarPlanilla(analisis.empresaId, analisis.filas));
      setPaso(3);
    } catch (e) { setError(e.message); }
  };
  // paso 1: <input type="file" accept=".xlsx"> con la misma zona de arrastre actual → analizar(file)
  // paso 2: conteos previa.altas.length / previa.actualizaciones.length / previa.sin_cambio.length,
  //         lista analisis.errores en <Note tone="pend"> (las filas con error NO se importan),
  //         aviso «N nombres quedarán "por confirmar" (truncados a 30)», botones Confirmar/Cancelar
  // paso 3: <Note tone="conf"> con resultado real + nombres_por_confirmar reportado
  // error: <Note tone="alerta">{error}</Note> visible en cualquier paso
}
```

(Escribir el JSX completo siguiendo el estilo del modal actual: `Modal`, `Note`, `Button`, tarjetas de conteo con las mismas clases.)

En `state.jsx` (dentro del provider, junto a las demás acciones):

```jsx
previsualizarImportacion: async (empresaId, filas) => {
  if (!supabaseListo) return { altas: [], actualizaciones: [], sin_cambio: [], nombres_por_confirmar: 0 };
  const { data, error } = await supabase.rpc("previsualizar_importacion", { p_empresa: empresaId, p_filas: filas });
  if (error) throw new Error(error.message);
  return data;
},
importarPlanilla: async (empresaId, filas) => {
  const { data, error } = await supabase.rpc("importar_planilla", {
    p_empresa: empresaId, p_filas: filas, p_por: user?.nombre ?? "RRHH" });
  if (error) throw new Error(error.message);
  await refrescarVistas("personal");
  return data;
},
```

(Usar el mecanismo real de refresco que exista en `state.jsx` — el helper `rpc(nombre, args, ...refrescar)` ya refresca vistas; si su firma no devuelve `data`, llamar `supabase.rpc` directo como arriba.)

- [ ] **Step 2: Probar en dev con el fixture real** — `npm run dev`, RRHH → Personal → Importar planilla → elegir `tests/fixtures/LISTA_PAIS.xlsx`. Esperado: vista previa 9 altas (primera vez), confirmación, los 9 aparecen en el maestro con DNI intactos; reimportar el mismo archivo → 9 sin cambio, 0 duplicados.
- [ ] **Step 3: `npm run build`** → OK.
- [ ] **Step 4: Commit + push (cierra Fase 2)** — `feat(rrhh): RRH-05 importacion real de planilla desde Excel con vista previa transaccional`

---

## Fase 3 — Cambio 2: carga de boletas desde PDF

### Task 9: Extracción de texto por página (pdfjs-dist)

**Files:**
- Create: `src/lib/boletas/pdf.js`
- Test: `tests/boletas/pdf.test.js`
- Modify: `package.json` (dependencias `pdfjs-dist@^4`, `pdf-lib@^1.17`)

**Interfaces:**
- Produces: `async function extraerPaginas(bytes: Uint8Array): Promise<string[]>` — texto plano por página (items de pdfjs unidos con espacios y saltos por línea aproximada). En Node (tests) usa `pdfjs-dist/legacy/build/pdf.mjs`; en navegador la build normal con worker (`GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()`).

- [ ] **Step 1: Instalar y test que falla**

```powershell
npm install pdfjs-dist@^4 pdf-lib@^1.17
```

```js
// tests/boletas/pdf.test.js
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { extraerPaginas } from "../../src/lib/boletas/pdf.js";

describe("extraerPaginas con BOLETAS.pdf", () => {
  it("devuelve nueve páginas con capa de texto", async () => {
    const paginas = await extraerPaginas(new Uint8Array(readFileSync("tests/fixtures/BOLETAS.pdf")));
    expect(paginas.length).toBe(9);
    expect(paginas[0]).toMatch(/BOLETA DE PAGO/);
    expect(paginas[0]).toMatch(/RUC:\s*20601705185/);
  });
});
```

(Si el PDF real tuviera un número distinto de páginas, ajustar la aserción al valor real y anotar el hallazgo — el requerimiento dice nueve boletas.)

- [ ] **Step 2: Implementación**

```js
// src/lib/boletas/pdf.js — extracción de texto por página. Sin OCR: la
// planilla genera PDFs con capa de texto (confirmado con la muestra real).
const esNavegador = typeof window !== "undefined";

async function cargarPdfjs() {
  if (esNavegador) {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc =
      new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    return pdfjs;
  }
  return import("pdfjs-dist/legacy/build/pdf.mjs"); // Node (tests), sin worker
}

export async function extraerPaginas(bytes) {
  const pdfjs = await cargarPdfjs();
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
  const paginas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pagina = await doc.getPage(n);
    const contenido = await pagina.getTextContent();
    // Reagrupar por coordenada Y para conservar las líneas del reporte.
    const lineas = new Map();
    for (const item of contenido.items) {
      const y = Math.round(item.transform[5]);
      if (!lineas.has(y)) lineas.set(y, []);
      lineas.get(y).push({ x: item.transform[4], s: item.str });
    }
    const texto = [...lineas.entries()].sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.x - b.x).map((i) => i.s).join(" "))
      .join("\n");
    paginas.push(texto);
  }
  await doc.destroy();
  return paginas;
}
```

- [ ] **Step 3: Correr** — `npx vitest run tests/boletas/pdf.test.js` → PASS. (Si pdfjs falla en Node por el worker, fijar `disableWorker: true` en getDocument del lado Node.)
- [ ] **Step 4: Commit** — `feat(boletas): extraccion de texto por pagina con pdfjs-dist`

### Task 10: Parser de anclas y validador del lote

**Files:**
- Create: `src/lib/boletas/lote.js`
- Test: `tests/boletas/lote.test.js`

**Interfaces:**
- Consumes: `string[]` de `extraerPaginas` (Task 9); `normalizar` de `src/lib/importar/planilla.js`.
- Produces:
  - `function analizarLote(paginas: string[]): { lote: {ruc, periodo, mesTexto}, boletas: Boleta[], excepciones: Excepcion[] }`
  - `Boleta = { correlativo, dni, codigo, nombre, cargo, sede, centroCosto, ingreso: 'YYYY-MM-DD'|null, neto: number|null, paginas: number[] }` (índices 0-based de las páginas que la componen)
  - `Excepcion = { tipo: 'sin_dni'|'codigo_distinto'|'salto_correlativo'|'ruc_distinto'|'periodo_distinto'|'dni_repetido', pagina: number|null, detalle: string }`
  - `function normalizarPeriodo(mesAaaa: string): string` — `"JUNIO-2026"` → `"2026-06"` (los 12 meses en español, insensible a acentos).
  - La verificación «DNI sin vínculo vigente en la empresa» NO se hace aquí (necesita BD): la hace la UI con los datos cargados y la re-verifica la RPC.

- [ ] **Step 1: Tests que fallan**

```js
// tests/boletas/lote.test.js
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { extraerPaginas } from "../../src/lib/boletas/pdf.js";
import { analizarLote, normalizarPeriodo } from "../../src/lib/boletas/lote.js";

let paginas;
beforeAll(async () => {
  paginas = await extraerPaginas(new Uint8Array(readFileSync("tests/fixtures/BOLETAS.pdf")));
});

describe("analizarLote con BOLETAS.pdf", () => {
  it("nueve boletas, nueve DNI distintos, correlativo 1..9, cero excepciones", () => {
    const r = analizarLote(paginas);
    expect(r.excepciones).toEqual([]);
    expect(r.boletas.length).toBe(9);
    expect(new Set(r.boletas.map((b) => b.dni)).size).toBe(9);
    expect(r.boletas.map((b) => b.correlativo)).toEqual([1,2,3,4,5,6,7,8,9]);
  });
  it("el periodo se normaliza a 2026-06 y el RUC es el real", () => {
    const r = analizarLote(paginas);
    expect(r.lote.periodo).toBe("2026-06");
    expect(r.lote.ruc).toBe("20601705185");
  });
  it("quitar una página intermedia reporta salto de correlativo (excepción del lote)", () => {
    const sin5 = paginas.filter((_, i) => i !== 4);
    const r = analizarLote(sin5);
    expect(r.excepciones.some((e) => e.tipo === "salto_correlativo")).toBe(true);
  });
  it("una página con RUC distinto es excepción", () => {
    const alteradas = [...paginas];
    alteradas[2] = alteradas[2].replace(/RUC:\s*\d{11}/, "RUC: 20999999999");
    const r = analizarLote(alteradas);
    expect(r.excepciones.some((e) => e.tipo === "ruc_distinto" && e.pagina === 3)).toBe(true);
  });
  it("CODIGO ≠ DNI es excepción, sin elegir por su cuenta", () => {
    const alteradas = [...paginas];
    alteradas[0] = alteradas[0].replace(/CODIGO:\s*\d+/, "CODIGO: 00000001");
    const r = analizarLote(alteradas);
    expect(r.excepciones.some((e) => e.tipo === "codigo_distinto" && e.pagina === 1)).toBe(true);
  });
  it("una página sin ancla BOLETA DE PAGO pertenece a la boleta anterior", () => {
    const conContinuacion = [...paginas.slice(0, 3), "conceptos adicionales sin ancla", ...paginas.slice(3)];
    const r = analizarLote(conContinuacion);
    expect(r.excepciones).toEqual([]);
    expect(r.boletas.length).toBe(9);
    expect(r.boletas[2].paginas).toEqual([2, 3]);
  });
});

describe("normalizarPeriodo", () => {
  it("convierte los meses en español", () => {
    expect(normalizarPeriodo("JUNIO-2026")).toBe("2026-06");
    expect(normalizarPeriodo("SETIEMBRE-2025")).toBe("2025-09");
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implementación**

```js
// src/lib/boletas/lote.js — separación e identificación de boletas dentro del
// PDF consolidado. El DNI de «Documento : DNI» es el identificador
// AUTORITATIVO; el CODIGO solo se coteja. Nada se descarta solo: toda
// anomalía es una excepción que se resuelve a mano antes de publicar.
import { normalizar } from "../importar/planilla.js";

const MESES = { ENERO: "01", FEBRERO: "02", MARZO: "03", ABRIL: "04", MAYO: "05",
  JUNIO: "06", JULIO: "07", AGOSTO: "08", SETIEMBRE: "09", SEPTIEMBRE: "09",
  OCTUBRE: "10", NOVIEMBRE: "11", DICIEMBRE: "12" };

export function normalizarPeriodo(mesAaaa) {
  const m = normalizar(mesAaaa).match(/^([A-Z]+)\s*-\s*(\d{4})$/);
  if (!m || !MESES[m[1]]) return null;
  return `${m[2]}-${MESES[m[1]]}`;
}

const buscar = (texto, re) => (texto.match(re) || [, null])[1];

function parsearPagina(texto) {
  const cabecera = buscar(texto, /BOLETA DE PAGO\s+([A-ZÁÉÍÓÚÑ]+\s*-\s*\d{4})/i);
  if (!cabecera) return null; // página de continuación
  const ing = buscar(texto, /Fec\.?\s*Ing\.?\s*:?\s*(\d{2}\/\d{2}\/\d{2})/i);
  let ingreso = null;
  if (ing) {
    const [d, m, aa] = ing.split("/");
    ingreso = `${Number(aa) <= 50 ? 2000 + Number(aa) : 1900 + Number(aa)}-${m}-${d}`;
  }
  const neto = buscar(texto, /Neto a pagar\s*:?\s*S\/\.?\s*([\d,]+\.\d{2})/i);
  return {
    periodoCabecera: normalizarPeriodo(cabecera),
    correlativo: Number(buscar(texto, /\bNo\.?\s+(\d+)\b/)),
    ruc: buscar(texto, /RUC\s*:?\s*(\d{11})/i),
    codigo: (buscar(texto, /CODIGO\s*:?\s*(\d+)/i) || "").trim() || null,
    periodoPago: normalizarPeriodo(buscar(texto, /PERIODO DE PAGO\s*:?\s*([A-ZÁÉÍÓÚÑ]+\s*-\s*\d{4})/i) || ""),
    dni: buscar(texto, /Documento\s*:?\s*DNI\s*(\d{8})/i),
    nombre: (buscar(texto, /Apellidos y Nombres\s*:?\s*(.+?)(?=\s*C\.?\s*Costo|$)/is) || "").replace(/\s+/g, " ").trim() || null,
    centroCosto: (buscar(texto, /C\.?\s*Costo\s*:?\s*(\d+\s+[^\n]*)/i) || "").trim() || null,
    sede: (buscar(texto, /Unid\.?\s*Servicios?\s*:?\s*([^\n]+)/i) || "").trim() || null,
    cargo: (buscar(texto, /Cargo\s*:?\s*([^\n]+)/i) || "").trim() || null,
    neto: neto ? Number(neto.replace(/,/g, "")) : null,
  };
}

export function analizarLote(paginas) {
  const boletas = [];
  const excepciones = [];
  paginas.forEach((texto, i) => {
    const datos = parsearPagina(texto);
    if (!datos) {
      // Página sin ancla: continuación de la boleta anterior.
      if (boletas.length) boletas[boletas.length - 1].paginas.push(i);
      else excepciones.push({ tipo: "sin_dni", pagina: i + 1, detalle: "La primera página no tiene el ancla BOLETA DE PAGO." });
      return;
    }
    boletas.push({ ...datos, paginas: [i] });
  });

  // RUC y periodo del lote: el valor mayoritario; las páginas que difieren son excepción.
  const moda = (valores) => {
    const conteo = new Map();
    valores.filter(Boolean).forEach((v) => conteo.set(v, (conteo.get(v) ?? 0) + 1));
    return [...conteo.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const ruc = moda(boletas.map((b) => b.ruc));
  const periodo = moda(boletas.map((b) => b.periodoPago ?? b.periodoCabecera));

  boletas.forEach((b) => {
    const pag = b.paginas[0] + 1;
    if (!b.dni) excepciones.push({ tipo: "sin_dni", pagina: pag, detalle: "Página sin DNI legible." });
    else if (b.codigo && b.codigo.padStart(8, "0") !== b.dni)
      excepciones.push({ tipo: "codigo_distinto", pagina: pag,
        detalle: `CODIGO ${b.codigo} ≠ Documento DNI ${b.dni}: resolver manualmente, no se elige solo.` });
    if (b.ruc && b.ruc !== ruc)
      excepciones.push({ tipo: "ruc_distinto", pagina: pag, detalle: `RUC ${b.ruc} distinto al del lote (${ruc}).` });
    const p = b.periodoPago ?? b.periodoCabecera;
    if (p && p !== periodo)
      excepciones.push({ tipo: "periodo_distinto", pagina: pag, detalle: `Periodo ${p} distinto al del lote (${periodo}).` });
  });

  // Correlativo 1..N sin saltos = ninguna página perdida (excepción del LOTE).
  const correlativos = boletas.map((b) => b.correlativo).filter((n) => Number.isFinite(n));
  const max = Math.max(0, ...correlativos);
  for (let n = 1; n <= max; n++) {
    if (!correlativos.includes(n))
      excepciones.push({ tipo: "salto_correlativo", pagina: null,
        detalle: `Falta el correlativo No ${n}: se perdió una página del lote.` });
  }

  // DNI repetido sin ser continuación (las continuaciones ya se fusionaron arriba).
  const vistos = new Map();
  boletas.forEach((b) => {
    if (!b.dni) return;
    if (vistos.has(b.dni))
      excepciones.push({ tipo: "dni_repetido", pagina: b.paginas[0] + 1,
        detalle: `El DNI ${b.dni} ya apareció en el correlativo No ${vistos.get(b.dni)}.` });
    else vistos.set(b.dni, b.correlativo);
  });

  return { lote: { ruc, periodo, mesTexto: null }, boletas, excepciones };
}
```

- [ ] **Step 3: Correr** — `npx vitest run tests/boletas` → PASS. Ajustar las regex si el texto real difiere (correr primero un `console.log(paginas[0])` en un test temporal para ver el layout literal; NO adivinar).
- [ ] **Step 4: Commit** — `feat(boletas): parser de anclas y validador de lote (DNI autoritativo, correlativo, RUC/periodo unicos)`

### Task 11: Partición por páginas y hash SHA-256

**Files:**
- Create: `src/lib/boletas/dividir.js`
- Test: `tests/boletas/dividir.test.js`

**Interfaces:**
- Consumes: `pdf-lib` (`PDFDocument.load / create / copyPages / save`); `Boleta.paginas` de Task 10.
- Produces:
  - `async function dividirPdf(bytes: Uint8Array, grupos: number[][]): Promise<Uint8Array[]>` — un PDF nuevo por grupo de páginas.
  - `async function sha256Hex(bytes: Uint8Array): Promise<string>` — WebCrypto `crypto.subtle.digest` (global en navegador y Node ≥20).

- [ ] **Step 1: Test que falla**

```js
// tests/boletas/dividir.test.js
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dividirPdf, sha256Hex } from "../../src/lib/boletas/dividir.js";
import { extraerPaginas } from "../../src/lib/boletas/pdf.js";

const bytes = new Uint8Array(readFileSync("tests/fixtures/BOLETAS.pdf"));

describe("dividirPdf", () => {
  it("produce un PDF válido de una página por boleta", async () => {
    const partes = await dividirPdf(bytes, [[0], [1], [2]]);
    expect(partes.length).toBe(3);
    for (const p of partes) expect(new TextDecoder().decode(p.subarray(0, 5))).toBe("%PDF-");
    const texto = await extraerPaginas(partes[1]);
    expect(texto.length).toBe(1);
    expect(texto[0]).toMatch(/BOLETA DE PAGO/);
  });
  it("el hash es estable y hex de 64", async () => {
    const [p] = await dividirPdf(bytes, [[0]]);
    const h = await sha256Hex(p);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex(p)).toBe(h);
  });
});
```

- [ ] **Step 2: Implementación**

```js
// src/lib/boletas/dividir.js — cada boleta se entrega como SU PDF: las
// páginas exactas del consolidado, sin recomprimir. El hash identifica el
// archivo exacto entregado (huella del acuse).
import { PDFDocument } from "pdf-lib";

export async function dividirPdf(bytes, grupos) {
  const origen = await PDFDocument.load(bytes);
  const partes = [];
  for (const paginas of grupos) {
    const destino = await PDFDocument.create();
    const copiadas = await destino.copyPages(origen, paginas);
    copiadas.forEach((p) => destino.addPage(p));
    partes.push(await destino.save());
  }
  return partes;
}

export async function sha256Hex(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

- [ ] **Step 3: Correr** → PASS.  **Step 4: Commit** — `feat(boletas): particion del PDF consolidado y hash SHA-256 por documento`

### Task 12: Canal binario a Storage (proxy) y política de subida

**Files:**
- Modify: `api/supa.js` (cuerpos y respuestas binarios)
- Modify: `supabase/migraciones/2026-08-15-tres-ajustes.sql` (políticas de Storage)
- Create: `scripts/verificar-storage.mjs`

**Interfaces:**
- Consumes: bucket `documentos` existente (público de lectura).
- Produces: subida desde el navegador autenticado vía `supabase.storage.from("documentos").upload("lotes/<empresa>/<periodo>/<hash>.pdf", bytes, { contentType: "application/pdf", upsert: true })` — funciona en dev (directo) y en prod (proxy `/api/supa/storage/v1/…`). Ruta por HASH: idempotente entre versiones y reintentos.

- [ ] **Step 1: Política RLS de Storage (migración)**

```sql
-- Subida de documentos desde el BackOffice autenticado (lectura ya es pública).
drop policy if exists documentos_subir on storage.objects;
create policy documentos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos');
drop policy if exists documentos_actualizar on storage.objects;
create policy documentos_actualizar on storage.objects for update to authenticated
  using (bucket_id = 'documentos') with check (bucket_id = 'documentos');
```

- [ ] **Step 2: Proxy binario**

En `api/supa.js`: desactivar el bodyParser y pasar los bytes tal cual, y devolver la respuesta como buffer (hoy `res.send(texto)` corrompería un binario):

```js
export const config = { api: { bodyParser: false } };

async function leerCuerpo(req) {
  const trozos = [];
  for await (const t of req) trozos.push(t);
  return trozos.length ? Buffer.concat(trozos) : undefined;
}
// en handler: const cuerpo = (req.method !== "GET" && req.method !== "HEAD") ? await leerCuerpo(req) : undefined;
// y al responder: const buf = Buffer.from(await respuesta.arrayBuffer()); … res.send(buf);
```

OJO: este archivo es la ruta crítica del login — cambiarlo con pulso. El passthrough crudo sirve igual para JSON (PostgREST recibe los mismos bytes). Conservar `ENTRAN`/`SALEN` y agregar `content-length` fuera (Node lo calcula solo).

- [ ] **Step 3: Verificación E2E (script)** — `scripts/verificar-storage.mjs`: con la service key (patrón de `adjuntar-pdfs-demo.mjs`), subir un PDF pequeño directo a Supabase, leerlo por su URL pública y comparar hash. Luego de DEPLOYAR: repetir la subida a través de `https://intranet-general.vercel.app/api/supa/storage/v1/object/documentos/pruebas/eco.pdf` con un JWT real (login del superadmin vía RPC como en `verificar-e2e-login.mjs`) y verificar byte a byte. **Y correr `node scripts/verificar-e2e-login.mjs`**: el login NO puede romperse por el cambio del proxy.
- [ ] **Step 4: Commit + push (el paso 3 necesita el deploy)** — `feat(api): canal binario en el proxy /api/supa y politica de subida a Storage`

### Task 13: RPC `publicar_lote_pdf`

**Files:**
- Modify: `supabase/migraciones/2026-08-15-tres-ajustes.sql` (función al final) y `supabase/schema.sql`
- Modify: `scripts/verificar-tres-ajustes.mjs` (pruebas del lote)

**Interfaces:**
- Consumes: forma `Boleta` (Task 10) enriquecida por la UI con `{hash, archivo_url}`.
- Produces: `publicar_lote_pdf(p_empresa text, p_tipo text, p_periodo text, p_por text, p_boletas jsonb) returns jsonb` → `{lote_id, documentos, version}`. Reglas: rechaza si ALGUNA boleta no tiene `dni`/`hash`/`archivo_url` (nada sin trabajador identificado); rechaza DNI sin vínculo vigente en la empresa; rechaza DNI duplicado en el lote; versionado idéntico a `publicar_lote` (v+1, marca `reemplazado` a los anteriores, jamás toca acuses); actualiza nombre/cargo/sede del vínculo solo si mejora (regla anti-prefijo con `fn_es_prefijo_truncado`); `documentos.neto` se guarda; ni cuentas ni CUSPP viajan (el JSON no los trae — y no se agrega columna alguna para ellos).

- [ ] **Step 1: SQL**

```sql
create or replace function publicar_lote_pdf(
  p_empresa text, p_tipo text, p_periodo text, p_por text, p_boletas jsonb
) returns jsonb language plpgsql security definer as $$
declare
  b jsonb; v_version int; v_id text; v_avisos int; v_vinculo bigint; v_docs int := 0;
begin
  -- Validación previa completa: entra todo o no entra nada.
  for b in select * from jsonb_array_elements(p_boletas) loop
    if coalesce(b->>'dni','') = '' or coalesce(b->>'hash','') = '' or coalesce(b->>'archivo_url','') = '' then
      raise exception 'Boleta sin trabajador identificado o sin archivo: nada se publica así.';
    end if;
    if not exists (select 1 from vinculos where persona_dni = b->>'dni'
                   and empresa_id = p_empresa and fecha_fin is null) then
      raise exception 'El DNI % no tiene vínculo vigente en la empresa: excepción sin resolver.', b->>'dni';
    end if;
  end loop;
  if (select count(distinct x->>'dni') from jsonb_array_elements(p_boletas) x)
     <> (select count(*) from jsonb_array_elements(p_boletas)) then
    raise exception 'Hay DNI repetidos en el lote: excepción sin resolver.';
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from lotes where empresa_id = p_empresa and tipo = p_tipo and periodo = p_periodo;
  v_id := case p_tipo when 'Boleta de pago' then 'BOL' when 'Gratificación' then 'GRA'
                      when 'Liquidación de CTS' then 'CTS' else 'UTI' end
          || '-' || upper(left((select corto from empresas where id = p_empresa), 3))
          || '-' || replace(p_periodo, '-', '') || '-' || lpad(v_version::text, 3, '0');

  select count(*) into v_avisos from vinculos v join personas p on p.dni = v.persona_dni
  where v.empresa_id = p_empresa and v.fecha_fin is null and p.celular is not null;

  insert into lotes (id, empresa_id, tipo, periodo, version, publicado_por, avisos)
  values (v_id, p_empresa, p_tipo, p_periodo, v_version, p_por, v_avisos);

  for b in select * from jsonb_array_elements(p_boletas) loop
    select id into v_vinculo from vinculos
    where persona_dni = b->>'dni' and empresa_id = p_empresa and fecha_fin is null;
    -- El PDF puede traer datos MÁS completos que el Excel (sede completa);
    -- solo se mejora, nunca se degrada a un prefijo.
    update personas set nombre = case
        when b->>'nombre' is null then nombre
        when fn_es_prefijo_truncado(b->>'nombre', nombre) then nombre
        when length(trim(b->>'nombre')) > length(nombre) then trim(b->>'nombre') else nombre end
    where dni = b->>'dni';
    insert into documentos (vinculo_id, lote_id, tipo, titulo, periodo, version, hash_sha256, neto)
    values (v_vinculo, v_id, p_tipo, p_tipo || ' — ' || p_periodo, p_periodo, v_version,
            b->>'hash', nullif(b->>'neto','')::numeric);
    update documentos set archivo_url = b->>'archivo_url'
    where lote_id = v_id and vinculo_id = v_vinculo;
    v_docs := v_docs + 1;
  end loop;

  if v_version > 1 then
    update documentos set estado = 'reemplazado'
    where lote_id in (select id from lotes where empresa_id = p_empresa
                      and tipo = p_tipo and periodo = p_periodo and version < v_version);
  end if;
  return jsonb_build_object('lote_id', v_id, 'documentos', v_docs, 'version', v_version);
end $$;
```

- [ ] **Step 2: Verificación E2E** — en `verificar-tres-ajustes.mjs`: (a) publicar un lote de prueba con 2 boletas de DNIs con vínculo vigente → 2 documentos con hash y url; (b) DNI sin vínculo → excepción y CERO filas creadas (transaccional); (c) republicar mismo periodo → versión 2, la 1 queda `reemplazado`, acuses intactos; (d) `select count(*) from information_schema.columns where column_name ~* 'cuenta|cuspp' and table_name in ('documentos','lotes')` → 0 (criterio: ni cuentas ni CUSPP en tablas del motor documental); (e) limpieza. Correr → TODAS PASARON.
- [ ] **Step 3: Sincronizar `schema.sql`.**
- [ ] **Step 4: Commit** — `feat(boletas): RPC transaccional publicar_lote_pdf con hash real y archivo por boleta`

### Task 14: UI RRH-06→10 — asistente real

**Files:**
- Modify: `src/pages/rrhh/Boletas.jsx` (reemplazar la simulación completa)
- Modify: `src/state.jsx` (acción `publicarLotePdf`; `addLote` demo deja de usarse desde esta pantalla)

**Interfaces:**
- Consumes: `extraerPaginas`, `analizarLote`, `dividirPdf`, `sha256Hex` (imports dinámicos: pdfjs/pdf-lib NO entran al bundle inicial), `supabase.storage`, RPC `publicar_lote_pdf`, `empresasActivas`, `db.personal` (para la excepción «DNI sin vínculo vigente» en el análisis local).
- Produces: flujo — Paso 1 igual (empresa activa + tipo + periodo con `<input type="month">` → `2026-06`); Paso 2 `<input type="file" accept=".pdf">` → extraer+analizar (progreso), cotejo del RUC del lote contra `empresas.ruc` de la empresa elegida (si difiere: bloquea con mensaje) y del periodo elegido contra el del PDF; excepciones locales adicionales: DNI sin persona vigente en la empresa (cotejo contra `db.personal`); Paso 3 lista de excepciones REALES con acciones (reintentar tras corregir / descartar página con motivo — descartar una boleta exige texto de motivo y la excluye del lote, quedando en el resumen); Paso 4 revisión (tabla: correlativo, DNI, nombre, neto) con el aviso legal existente; Publicar = dividir → hash → subir cada página (`lotes/<empresa>/<periodo>/<hash>.pdf`, barra de progreso, reintento por archivo) → RPC. Paso 5: resultado real (`lote_id`, documentos). Ninguna publicación con excepciones sin resolver (botón deshabilitado + razón).

- [ ] **Step 1: Reescribir `Boletas.jsx`** siguiendo la estructura de pasos existente (mantener `PASOS`, la cabecera RRH-06→10, estilos y el aviso de corrección de versión que ya funciona con `db.lotes`). Sustituir `EXCEPCIONES_DEMO`/`procesar`/`publicar` por el flujo real de arriba. La función `publicar` llama:

```jsx
publicarLotePdf: async ({ empresaId, tipo, periodo, boletas }) => {
  const { data, error } = await supabase.rpc("publicar_lote_pdf", {
    p_empresa: empresaId, p_tipo: tipo, p_periodo: periodo,
    p_por: user?.nombre ?? "RRHH", p_boletas: boletas });
  if (error) throw new Error(error.message);
  await refrescarVistas("lotes", "acuses");
  return data;
},
```

- [ ] **Step 2: Probar en dev con el fixture** — cargar `tests/fixtures/BOLETAS.pdf` sobre L. Americana, periodo 2026-06 (los 9 trabajadores existen si Fase 2 ya corrió con LISTA_PAIS): análisis 9/9 sin excepciones, publicar, verificar en Supabase 9 documentos con `archivo_url` y hash de 64 hex; abrir una URL y ver la boleta correcta.
- [ ] **Step 3: `npm run build`** → OK (verificar que pdfjs/pdf-lib quedaron en chunks lazy).
- [ ] **Step 4: Commit + push (cierra Fase 3)** — `feat(rrhh): RRH-06→10 carga real de boletas desde PDF consolidado`

---

## Fase 4 — Criterios de aceptación completos

### Task 15: Prueba integrada y cierre

**Files:**
- Create: `tests/integrada.test.js`
- Modify: `scripts/verificar-tres-ajustes.mjs` (criterios restantes)
- Modify: `docs/superpowers/specs/2026-08-15-tres-ajustes-design.md` (marcar estado final)

**Interfaces:**
- Consumes: todo lo anterior.

- [ ] **Step 1: Test integrado local (parsers punta a punta, sin BD)**

```js
// tests/integrada.test.js — criterio: importar LISTA_PAIS.xlsx y cargar
// BOLETAS.pdf sobre la misma empresa asigna las nueve boletas sin excepciones.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { leerXlsx } from "../src/lib/importar/xlsx.js";
import { parsearPlanilla } from "../src/lib/importar/planilla.js";
import { extraerPaginas } from "../src/lib/boletas/pdf.js";
import { analizarLote } from "../src/lib/boletas/lote.js";

describe("prueba integrada Excel → PDF", () => {
  it("los nueve DNI del PDF existen en la importación del Excel", async () => {
    const excel = parsearPlanilla(await leerXlsx(new Uint8Array(readFileSync("tests/fixtures/LISTA_PAIS.xlsx"))));
    const lote = analizarLote(await extraerPaginas(new Uint8Array(readFileSync("tests/fixtures/BOLETAS.pdf"))));
    expect(lote.excepciones).toEqual([]);
    const dnisExcel = new Set(excel.filas.map((f) => f.dni));
    for (const b of lote.boletas) expect(dnisExcel.has(b.dni)).toBe(true);
  });
});
```

- [ ] **Step 2: Correr TODO** — `npm test` (suite completa) y `node scripts/verificar-tres-ajustes.mjs` → todo verde. Repasar los criterios de aceptación del requerimiento uno a uno contra un test o verificación concreta; el que falte, agregarlo aquí.
- [ ] **Step 3: E2E real en producción** — deploy (push), luego en el navegador: importar `LISTA_PAIS.xlsx` real, cargar `BOLETAS.pdf` real, 9/9 sin excepciones, abrir una boleta desde el Portal del Trabajador (login DNI de prueba) y dar acuse. Reportar a Diego el conteo de «nombre por confirmar».
- [ ] **Step 4: Commit final + push** — `test: criterios de aceptacion de los tres ajustes completos` — y actualizar la memoria del proyecto.

---

## Self-review (hecho al escribir el plan)

- Cobertura: los 3 cambios, las reglas generales, los criterios de aceptación y los checkpoints del requerimiento tienen tarea asignada (CLEAN = Task 4, bloqueada solo por los datos de Diego).
- El texto real de las páginas del PDF puede diferir del supuesto: Task 10 Step 3 manda inspeccionar el texto extraído literal antes de ajustar regex.
- Firmas consistentes: `leerXlsx→string[][]` (T5→T6,T8,T15), `normalizar` (T6→T10), `FilaPlanilla` (T6→T7,T8), `Boleta/Excepcion` (T10→T13,T14), `dividirPdf/sha256Hex` (T11→T14), `fn_es_prefijo_truncado` (T7→T13).
