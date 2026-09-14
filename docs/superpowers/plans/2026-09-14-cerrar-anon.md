# Hardening de acceso · Fase 1: cerrar el rol anónimo — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que sin JWT no se pueda leer ni ejecutar nada en Supabase (salvo las 4 RPCs de login), que los objetos nuevos nazcan cerrados, y que el BackOffice cargue datos solo con usuario y nunca muestre datos demo en producción.

**Architecture:** Una migración idempotente revoca todo a `anon` (tablas, vistas, secuencias, funciones), corrige los privilegios por defecto, recrea `acceso_demo` solo para `authenticated` y hace que `fn_nivel_modulo` devuelva 0 sin JWT salvo para `postgres`/`service_role`. En el frontend, la carga inicial pasa de «al montar» a «tras resolver un usuario activo», con un estado `origen = "error"` y banner de reintento en vez del fallback a mock. Una suite nueva prueba directo contra supabase.co con la publishable key.

**Tech Stack:** Supabase Postgres (plpgsql, PostgREST), React 19 + Vite (BackOffice), vitest (unit), suites E2E Node por Management API (patrón `scripts/verificar-sedes.mjs`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-14-cerrar-anon-design.md`.
- Proyecto Supabase `mzpbdkrmokfxrrsotfgs`; publishable key `sb_publishable_qgPwZ8-4neRlKQXpCe9tnw_Dix4Ddwg` (pública, va en el bundle); app en `https://intranet-general.vercel.app`.
- Funciones BD: `security definer set search_path = public, extensions` (hardening 2026-08-24).
- RPCs que DEBEN seguir ejecutables por `anon`: `verificar_bloqueo`, `registrar_ingreso`, `portal_verificar_bloqueo`, `portal_registrar_ingreso`. Ninguna otra.
- Migración idempotente en `supabase/migraciones/` + canónicos (`schema.sql`, `accesos.sql`, `portal.sql`) actualizados en el mismo commit.
- Aplicar SQL en prod: `. .\scripts\token-supabase.ps1; node scripts/aplicar-sql.mjs supabase/migraciones/2026-09-14-cerrar-anon.sql`. El clasificador bloquea al agente: **Diego lo corre vía `! powershell -NoProfile -Command "..."`** (el `!` corre en bash, por eso se envuelve en powershell).
- **Orden de despliegue obligatorio:** primero frontend (push a `main` → Vercel Ready), después la migración.
- Suites E2E existentes que deben seguir verdes tras la migración: padrón 21, control semanal 20, tres ajustes 23, cumplimiento boletas 23, solicitudes 15, solicitud-pdf 16, cuentas masa 17, fijar correo 7, sedes 8, asistencia 8. `vitest run` 145/145 (más los nuevos).
- Commits en español, convención `feat:`/`fix:`/`test:`/`docs:`. Los commits los hace el controlador con PowerShell (`git commit -m @'...'@`); los subagentes NO corren git.
- Credenciales para la suite: `SUPERADMIN_EMAIL` y `SUPERADMIN_PASSWORD_INICIAL` por env (opcionales; sin ellas se saltan los casos con sesión). Nunca escribirlas en archivos.

---

### Task 1: Suite `verificar-cierre-anon.mjs` (escrita primero; falla antes de la migración)

**Files:**
- Create: `scripts/verificar-cierre-anon.mjs`

**Interfaces:**
- Produces: `node scripts/verificar-cierre-anon.mjs` → exit 0 solo cuando la BD está cerrada a anon. Task 5 la usa como criterio de éxito. Env: `SUPABASE_ACCESS_TOKEN` (obligatorio), `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD_INICIAL` (opcionales).

- [ ] **Step 1: Escribir la suite**

```js
// scripts/verificar-cierre-anon.mjs — Hardening fase 1 (2026-09-14). Prueba
// que SIN sesión, con solo la publishable key, no se lee ni se ejecuta nada
// (salvo las 4 RPCs de login), tanto directo a supabase.co como vía /api/supa.
// Solo lectura: no crea ni borra datos.
//   env: SUPABASE_ACCESS_TOKEN (Management API); opcionales SUPERADMIN_EMAIL,
//        SUPERADMIN_PASSWORD_INICIAL para los casos con sesión.
//   Uso: . .\scripts\token-supabase.ps1; node scripts/verificar-cierre-anon.mjs
const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const SUPA = `https://${PROYECTO}.supabase.co`;
const APP = "https://intranet-general.vercel.app";
const KEY = "sb_publishable_qgPwZ8-4neRlKQXpCe9tnw_Dix4Ddwg";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
const { SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD_INICIAL } = process.env;

let fallos = 0;
async function prueba(nombre, fn) {
  try { await fn(); console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); }
}
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
const enLista = (v, lista, msj) => { if (!lista.includes(v)) throw new Error(`${msj}: ${JSON.stringify(v)} no está en ${JSON.stringify(lista)}`); };

async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}
// Petición anónima: solo apikey, sin Authorization de sesión.
const anonDirecto = (ruta, init = {}) => fetch(`${SUPA}/${ruta}`, {
  ...init, headers: { apikey: KEY, "Content-Type": "application/json", ...(init.headers ?? {}) },
});
// Mismo camino que el navegador sin sesión: el proxy inyecta la apikey.
const anonProxy = (ruta, init = {}) => fetch(`${APP}/api/supa/${ruta}`, {
  ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
});
const filas = async (r) => { const t = await r.text(); try { const j = JSON.parse(t); return Array.isArray(j) ? j.length : -1; } catch { return -1; } };

const TABLAS_SENSIBLES = ["personas", "usuarios_admin", "cuentas_portal", "registro_accesos", "auditoria",
  "vinculos", "v_personal", "v_usuarios_admin", "v_registro_accesos", "v_activos", "v_sedes", "v_portal_datos"];
// Con los argumentos reales: sin ellos PostgREST responde 404 (no encuentra la
// sobrecarga) antes de evaluar permisos, y la prueba no mediría nada.
const RPCS_NEGOCIO = [
  ["importar_padron", { p_filas: [], p_por: "verificar-cierre-anon" }],
  ["eliminar_trabajador", { p_dni: "00000000" }],
  ["fn_ver_cuenta_bancaria", { p_dni: "00000000" }],
  ["fn_nivel_modulo", { p_modulo: "personal" }],
];
const RPCS_LOGIN = [
  ["verificar_bloqueo", { p_correo: "nadie@ejemplo.com" }],
  ["registrar_ingreso", { p_correo: "nadie@ejemplo.com", p_resultado: "fallido", p_dispositivo: "verificar-cierre-anon" }],
  ["portal_verificar_bloqueo", { p_dni: "00000000" }],
  ["portal_registrar_ingreso", { p_dni: "00000000", p_resultado: "fallido", p_dispositivo: "verificar-cierre-anon" }],
];

// 1 · Tablas y vistas sensibles: sin sesión no devuelven filas (401/403).
for (const t of TABLAS_SENSIBLES) {
  await prueba(`anon directo: ${t} no se lee`, async () => {
    const r = await anonDirecto(`rest/v1/${t}?select=*&limit=1`);
    enLista(r.status, [401, 403], `status (filas=${await filas(r)})`);
  });
}
await prueba("anon vía proxy: personas no se lee", async () => {
  const r = await anonProxy("rest/v1/personas?select=*&limit=1");
  enLista(r.status, [401, 403], `status (filas=${await filas(r)})`);
});
await prueba("anon vía proxy: v_personal no se lee", async () => {
  const r = await anonProxy("rest/v1/v_personal?select=*&limit=1");
  enLista(r.status, [401, 403], `status (filas=${await filas(r)})`);
});

// 2 · RPCs de negocio: sin sesión falla por PERMISO (no por validación).
for (const [fn, args] of RPCS_NEGOCIO) {
  await prueba(`anon directo: rpc ${fn} denegada por permiso`, async () => {
    const r = await anonDirecto(`rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
    const cuerpo = await r.text();
    enLista(r.status, [401, 403], `status (${cuerpo.slice(0, 120)})`);
    igual(/permission denied|42501|Unauthorized|JWT/i.test(cuerpo), true, `motivo (${cuerpo.slice(0, 120)})`);
  });
}

// 3 · Las 4 RPCs de login siguen respondiendo sin sesión.
for (const [fn, args] of RPCS_LOGIN) {
  await prueba(`anon directo: rpc ${fn} sigue abierta`, async () => {
    const r = await anonDirecto(`rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
    // Las de registro son `returns void` → PostgREST responde 204.
    enLista(r.status, [200, 204], `status (${(await r.text()).slice(0, 120)})`);
  });
}

// 4 · Con sesión de superadmin, el BackOffice lee sus vistas por el proxy.
if (!SUPERADMIN_EMAIL || !SUPERADMIN_PASSWORD_INICIAL) {
  console.log("(sin SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD_INICIAL — se saltan los casos con sesión)");
} else {
  let jwt = null;
  await prueba("login BackOffice por el proxy", async () => {
    const r = await anonProxy("auth/v1/token?grant_type=password", {
      method: "POST", body: JSON.stringify({ email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD_INICIAL }),
    });
    const j = await r.json();
    igual(typeof j.access_token, "string", `access_token (${JSON.stringify(j).slice(0, 120)})`);
    jwt = j.access_token;
  });
  for (const v of ["v_usuarios_admin", "v_mi_acceso", "v_personal", "v_sedes"]) {
    await prueba(`con sesión: ${v} se lee`, async () => {
      const r = await anonProxy(`rest/v1/${v}?select=*&limit=1`, { headers: { "x-sesion": jwt } });
      igual(r.status, 200, `status (${(await r.text()).slice(0, 120)})`);
    });
  }
}

// 5 · fn_nivel_modulo: 99 por Management API (session_user postgres), 0 con claims de anon.
await prueba("fn_nivel_modulo sin JWT por Management API → 99", async () => {
  const [{ n }] = await sql("select fn_nivel_modulo('personal') as n");
  igual(n, 99, "nivel");
});
await prueba("fn_nivel_modulo con claims de rol anon → 0", async () => {
  const [{ n }] = await sql(
    `select set_config('request.jwt.claims', '{"role":"anon"}', true); select fn_nivel_modulo('personal') as n`);
  igual(n, 0, "nivel");
});
await prueba("fn_nivel_modulo con claims de rol authenticated sin email → 0", async () => {
  const [{ n }] = await sql(
    `select set_config('request.jwt.claims', '{"role":"authenticated"}', true); select fn_nivel_modulo('personal') as n`);
  igual(n, 0, "nivel");
});

// 6 · Radiografía: 0 grants a anon en tablas/vistas; solo 4 funciones ejecutables por anon.
await prueba("catálogo: anon sin SELECT en ninguna tabla ni vista de public", async () => {
  const [{ n }] = await sql(`select count(*)::int as n from pg_class c join pg_namespace s on s.oid=c.relnamespace
    where s.nspname='public' and c.relkind in ('r','v') and has_table_privilege('anon', c.oid, 'select')`);
  igual(n, 0, "objetos legibles por anon");
});
await prueba("catálogo: anon ejecuta exactamente las 4 RPCs de login", async () => {
  const lista = await sql(`select p.proname from pg_proc p join pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and has_function_privilege('anon', p.oid, 'execute') order by 1`);
  igual(lista.map((r) => r.proname).join(","),
    "portal_registrar_ingreso,portal_verificar_bloqueo,registrar_ingreso,verificar_bloqueo", "funciones");
});
await prueba("catálogo: privilegios por defecto de postgres ya no incluyen a anon", async () => {
  const [{ n }] = await sql(`select count(*)::int as n from pg_default_acl
    where defaclnamespace='public'::regnamespace and defaclrole='postgres'::regrole and defaclacl::text like '%anon=%'`);
  igual(n, 0, "entradas con anon");
});
await prueba("catálogo: ninguna política acceso_demo aplica a anon", async () => {
  const [{ n }] = await sql(`select count(*)::int as n from pg_policies
    where schemaname='public' and policyname='acceso_demo' and 'anon' = any(roles)`);
  igual(n, 0, "políticas con anon");
});

console.log(fallos ? `\n${fallos} fallo(s).` : "\nTodo verde.");
process.exit(fallos ? 1 : 0);
```

- [ ] **Step 2: Correrla y confirmar que falla (BD aún abierta)**

Run (PowerShell): `. .\scripts\token-supabase.ps1; node scripts/verificar-cierre-anon.mjs`
Expected: exit 1. Deben fallar al menos las 12 de tablas (status 200), las 4 de RPC de negocio, la de «rol anon → 0» y las 4 de catálogo. Deben pasar las 4 de login y «Management API → 99».

**Efecto acotado aceptado por Diego (2026-09-14):** mientras la BD siga abierta, cada corrida en rojo deja 2 filas en `auditoria` (IMPORTAR_PADRON con 0 filas y VER_CUENTA_BANCARIA del DNI 00000000, firmadas «verificar-cierre-anon») e intenta borrar al DNI 00000000, que no existe. Es la evidencia de la brecha; tras la migración la suite no escribe nada.

- [ ] **Step 3: Commit (lo hace el controlador)**

```powershell
git add scripts/verificar-cierre-anon.mjs
git commit -m "test(seguridad): suite E2E del cierre del rol anonimo (roja hasta la migracion)"
```

---

### Task 2: Helper puro de carga (`src/lib/carga.js`) con tests

**Files:**
- Create: `src/lib/carga.js`
- Test: `tests/carga.test.js`

**Interfaces:**
- Produces: `dbVacia(fuentes) → {clave: []}`, `dbInicial(conSupabase, fuentes, local) → objeto db`, `origenDesde(conSupabase, resultados) → "local" | "supabase" | "error"`. Task 3 los importa desde `./lib/carga`.

- [ ] **Step 1: Escribir el test que falla**

```js
// tests/carga.test.js
import { describe, it, expect } from "vitest";
import { dbVacia, dbInicial, origenDesde } from "../src/lib/carga.js";

const FUENTES = { empresas: "empresas", personal: "v_personal" };
const LOCAL = { empresas: [{ id: "demo" }], personal: [{ dni: "00000000" }] };

describe("carga del estado", () => {
  it("dbVacia: una lista vacía por cada clave de FUENTES", () => {
    expect(dbVacia(FUENTES)).toEqual({ empresas: [], personal: [] });
  });
  it("dbInicial: con Supabase arranca vacío, nunca con mock", () => {
    expect(dbInicial(true, FUENTES, LOCAL)).toEqual({ empresas: [], personal: [] });
  });
  it("dbInicial: sin Supabase (desarrollo local) usa el mock", () => {
    expect(dbInicial(false, FUENTES, LOCAL)).toBe(LOCAL);
  });
  it("origenDesde: sin Supabase → local", () => {
    expect(origenDesde(false, [])).toBe("local");
  });
  it("origenDesde: todas las lecturas sin error → supabase", () => {
    expect(origenDesde(true, [{ data: [] }, { data: [] }])).toBe("supabase");
  });
  it("origenDesde: cualquier lectura con error → error (jamás mock)", () => {
    expect(origenDesde(true, [{ data: [] }, { error: { message: "permission denied" } }])).toBe("error");
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run tests/carga.test.js`
Expected: FAIL — "Failed to resolve import ../src/lib/carga.js".

- [ ] **Step 3: Implementar**

```js
// src/lib/carga.js — Reglas puras de la carga inicial del BackOffice
// (hardening fase 1, 2026-09-14): con Supabase configurado la app arranca
// VACÍA y solo carga tras resolver un usuario activo; el mock existe
// únicamente para desarrollo local sin Supabase. Un fallo de lectura es un
// error visible, nunca datos de demostración.
export const dbVacia = (fuentes) => Object.fromEntries(Object.keys(fuentes).map((k) => [k, []]));

export const dbInicial = (conSupabase, fuentes, local) => (conSupabase ? dbVacia(fuentes) : local);

export const origenDesde = (conSupabase, resultados) => {
  if (!conSupabase) return "local";
  return resultados.every((r) => !r.error) ? "supabase" : "error";
};
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npx vitest run tests/carga.test.js`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/carga.js tests/carga.test.js
git commit -m "feat(estado): reglas puras de carga inicial sin mock en produccion"
```

---

### Task 3: BackOffice carga tras sesión + banner de error (`state.jsx`, `Shell.jsx`)

**Files:**
- Modify: `src/state.jsx` (import, líneas ~125-146 estado/`recargar`/`useEffect` de montaje, ~150-176 `resolver`, ~186-194 `salir`, ~938 `value` del provider)
- Modify: `src/layout/Shell.jsx:137` (destructuring) y `:222-226` (rótulo del header)

**Interfaces:**
- Consumes: `dbInicial`, `dbVacia`, `origenDesde` de Task 2.
- Produces en el contexto (`useApp()`): `origen: "supabase" | "local" | "error"`, `reintentarCarga(): Promise<boolean>`. `recargar(...claves)` no cambia de firma.

- [ ] **Step 1: Import y estado inicial en `src/state.jsx`**

Añadir tras la línea 3 (`import * as MOCK ...`):

```js
import { dbInicial, dbVacia, origenDesde } from "./lib/carga";
```

Reemplazar (líneas ~125-126):

```js
  const [db, setDb] = useState(LOCAL);
  const [origen, setOrigen] = useState("local"); // "supabase" | "local"
```

por:

```js
  // Con Supabase la app arranca VACÍA y carga tras resolver el usuario
  // (hardening fase 1: anon ya no puede leer nada). El mock solo existe sin
  // Supabase configurado o en MODO_DEMO.
  const conSupabase = supabaseListo && !MODO_DEMO;
  const [db, setDb] = useState(() => dbInicial(conSupabase, FUENTES, LOCAL));
  const [origen, setOrigen] = useState(conSupabase ? "supabase" : "local"); // "supabase" | "local" | "error"
```

- [ ] **Step 2: `recargar` fija `origen`; eliminar la carga al montar**

Reemplazar el cuerpo de `recargar` (líneas ~128-141) por:

```js
  const recargar = async (...claves) => {
    if (!conSupabase) return true;
    const lista = claves.length ? claves : Object.keys(FUENTES);
    const resultados = await Promise.all(lista.map((k) => supabase.from(FUENTES[k]).select("*")));
    setDb((d) => {
      const nuevo = { ...d };
      lista.forEach((k, i) => {
        if (!resultados[i].error) nuevo[k] = resultados[i].data;
        else console.error(`Supabase [${FUENTES[k]}]:`, resultados[i].error.message);
      });
      return nuevo;
    });
    const ok = resultados.every((r) => !r.error);
    // Solo la carga completa decide el origen; una recarga parcial que falla
    // no debe ocultar un estado sano ni al revés.
    if (!claves.length) setOrigen(origenDesde(conSupabase, resultados));
    return ok;
  };
  const reintentarCarga = () => recargar();
```

Eliminar por completo el `useEffect` de montaje (líneas ~143-146):

```js
  useEffect(() => {
    if (!supabaseListo) return;
    recargar().then((ok) => setOrigen(ok ? "supabase" : "local"));
  }, []);
```

- [ ] **Step 3: Cargar dentro de `resolver`, antes de publicar el usuario**

En `resolver` (líneas ~153-176), reemplazar el bloque desde `if (error || !data || data.estado !== "activo") {` hasta el `setUser({ ... });` completo por:

```js
      if (error || !data || data.estado !== "activo") {
        await supabase.auth.signOut();
        setDb(dbVacia(FUENTES));
        setUser(null);
        return;
      }
      // La carga completa va ANTES de publicar el usuario: la interfaz nunca
      // se pinta autenticada con colecciones vacías. Si algo falla, origen
      // queda en "error" y el Shell ofrece reintentar.
      await recargar();
      if (!activo) return;
      setUser({
        id: data.id, codigo: data.codigo, nombre: data.nombre, rol: data.perfilNombre,
        correo: data.correo, esSuperadmin: data.esSuperadmin, requiereCambio: data.requiereCambio,
        // La categoría vigente manda: de aquí salen menú, selector y guards.
        acceso: {
          esSuperadmin: acc?.esSuperadmin ?? data.esSuperadmin,
          matriz: acc?.matriz ?? {},
          empresas: acc?.empresas ?? [],
        },
      });
```

(El `setUser({...})` conserva exactamente los campos que ya tenía; solo se antepone `await recargar()`.)

- [ ] **Step 4: `salir` vacía el estado**

En `salir` (líneas ~186-194), añadir antes de `setUser(null);`:

```js
    if (conSupabase) setDb(dbVacia(FUENTES));
```

- [ ] **Step 5: Exponer `reintentarCarga` en el provider**

En el `value={{ ... }}` (línea ~938) añadir `reintentarCarga` junto a `recargar`:

```js
      value={{ user, salir, claveCambiada, empresaId, setEmpresaId, empresa, empresasActivas, origen, persona, sede, empresaPor, recargar, reintentarCarga, ...acciones }}
```

- [ ] **Step 6: Banner en `src/layout/Shell.jsx`**

Línea 137, añadir `reintentarCarga`:

```js
  const { user, salir, empresaId, setEmpresaId, empresasActivas, origen, db, reintentarCarga } = useApp();
```

Reemplazar el rótulo (líneas ~222-226):

```jsx
          <span className="ml-auto font-mono text-[10.5px] text-gris-cl">
            {origen === "supabase" ? "Conectado a Supabase" : "Datos locales de demostración"}
          </span>
```

por:

```jsx
          <span className="ml-auto font-mono text-[10.5px] text-gris-cl">
            {origen === "supabase" ? "Conectado a Supabase" : origen === "local" ? "Datos locales de demostración" : "Error de carga"}
          </span>
```

Y justo después de `</header>` (antes de `<main ...>`) insertar:

```jsx
        {origen === "error" && (
          <div role="alert" className="flex items-center gap-3 border-b border-borde-f bg-[#fff4f2] px-5 py-2 text-[13px] text-tinta">
            <span>No se pudieron cargar los datos. Revisa tu conexión o vuelve a intentarlo.</span>
            <button
              type="button"
              onClick={() => reintentarCarga()}
              className="rounded-caja border border-borde-f bg-white px-2.5 py-1 font-semibold text-petroleo hover:bg-[#f3f7fb]"
            >
              Reintentar
            </button>
          </div>
        )}
```

- [ ] **Step 7: Verificar build y tests**

Run: `npx vitest run` → Expected: 151 passed (145 + 6).
Run: `npm run build` → Expected: build OK sin errores de import.
Revisión manual de lógica: buscar que no quede ningún uso de `origen === "local"` como sinónimo de «falló» → `grep -n "origen" src -r` debe listar solo `state.jsx` y `Shell.jsx`.

- [ ] **Step 8: Commit**

```powershell
git add src/state.jsx src/layout/Shell.jsx
git commit -m "feat(backoffice): cargar datos solo con sesion y mostrar error en vez de datos demo"
```

---

### Task 4: Migración `2026-09-14-cerrar-anon.sql` + canónicos

**Files:**
- Create: `supabase/migraciones/2026-09-14-cerrar-anon.sql`
- Modify: `supabase/schema.sql` (~259, ~382, ~895 grants a anon; bloque «SEGURIDAD (nivel demostración)» ~2458-2478)
- Modify: `supabase/accesos.sql` (~320-340 `fn_nivel_modulo`; ~668-676 `acceso_demo`)
- Modify: `supabase/portal.sql` (~503-505 `acceso_demo`)

**Interfaces:**
- Produces: BD cerrada a anon; `fn_nivel_modulo(text)` v3 (misma firma, nuevo comportamiento sin JWT). Task 5 la aplica.

- [ ] **Step 1: Escribir la migración**

```sql
-- supabase/migraciones/2026-09-14-cerrar-anon.sql
-- Hardening de acceso · Fase 1: cerrar el rol anónimo (spec
-- docs/superpowers/specs/2026-09-14-cerrar-anon-design.md). Idempotente.
-- Desplegar DESPUÉS del frontend que carga datos tras la sesión.
--
-- Rollback (solo si hace falta volver al estado de demostración):
--   grant select on all tables in schema public to anon;
--   grant execute on all functions in schema public to anon;
--   y recrear acceso_demo con "to anon, authenticated".

begin;

-- 1 · Revocar a anon todo lo existente (tablas y vistas, secuencias, funciones).
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- 1b · Funciones que anon aún ejecuta por herencia de PUBLIC: se cierra PUBLIC
--      y se conserva explícitamente lo que ya tenían authenticated/service_role.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('revoke all on function %s from public', f.fn);
    execute format('grant execute on function %s to authenticated, service_role', f.fn);
  end loop;
end $$;

-- 2 · Privilegios por defecto: lo nuevo nace cerrado para anon.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;
do $$
begin
  -- supabase_admin también tiene default ACL; postgres no siempre puede tocarla.
  alter default privileges for role supabase_admin in schema public revoke all on tables from anon;
  alter default privileges for role supabase_admin in schema public revoke all on sequences from anon;
  alter default privileges for role supabase_admin in schema public revoke all on functions from anon;
exception when insufficient_privilege then
  raise notice 'default privileges de supabase_admin no modificables desde este rol (sin efecto: los objetos los crea postgres)';
end $$;

-- 3 · acceso_demo queda solo para authenticated (fase 2 la sustituye por RLS real).
do $$
declare t text;
begin
  for t in select tablename from pg_policies where schemaname = 'public' and policyname = 'acceso_demo' loop
    execute format('drop policy acceso_demo on %I', t);
    execute format('create policy acceso_demo on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- 4 · fn_nivel_modulo v3: sin JWT, solo postgres/service_role son 99; anon es 0.
create or replace function fn_nivel_modulo(p_modulo text)
returns int language plpgsql stable security definer set search_path = public, extensions as $$
declare v_correo text; v_nivel int; v_rol text;
begin
  begin
    v_correo := nullif(auth.jwt() ->> 'email', '');
  exception when others then
    v_correo := null;
  end;
  if v_correo is null then
    -- Dentro de un security definer current_user es el dueño; el rol real
    -- viene en los claims de PostgREST o, sin ellos (Management API), en
    -- session_user.
    v_rol := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', session_user::text);
    if v_rol in ('postgres', 'service_role', 'supabase_admin') then return 99; end if;
    return 0;
  end if;
  select case when p.es_superadmin then 99
              else coalesce((select pp.nivel from perfil_permisos pp
                             where pp.perfil_id = u.perfil_id
                               and pp.perfil_version = u.perfil_version
                               and pp.modulo = p_modulo), 0) end
  into v_nivel
  from usuarios_admin u
  join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
  where lower(u.correo) = lower(v_correo) and u.estado = 'activo';
  return coalesce(v_nivel, 0);
end $$;

-- 5 · Solo las 4 RPCs de login siguen abiertas a anon.
grant execute on function verificar_bloqueo(text) to anon;
grant execute on function registrar_ingreso(text, text, text) to anon;
grant execute on function portal_verificar_bloqueo(text) to anon;
grant execute on function portal_registrar_ingreso(text, text, text) to anon;

-- 6 · Verificación embebida: si algo quedó abierto, la migración no se aplica.
do $$
declare n int; lista text;
begin
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind in ('r', 'v') and has_table_privilege('anon', c.oid, 'select');
  if n > 0 then raise exception 'cerrar-anon: % tablas/vistas siguen legibles por anon', n; end if;
  select string_agg(p.proname, ',' order by p.proname) into lista
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
  if lista is distinct from 'portal_registrar_ingreso,portal_verificar_bloqueo,registrar_ingreso,verificar_bloqueo' then
    raise exception 'cerrar-anon: funciones ejecutables por anon = %', coalesce(lista, '(ninguna)');
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and policyname = 'acceso_demo' and 'anon' = any(roles);
  if n > 0 then raise exception 'cerrar-anon: % políticas acceso_demo siguen incluyendo a anon', n; end if;
end $$;

commit;
```

**Firmas confirmadas (2026-09-14):** `verificar_bloqueo(p_correo text)` en `accesos.sql:464`, `registrar_ingreso(p_correo text, p_resultado text, p_dispositivo text)` en `accesos.sql:480`, `portal_verificar_bloqueo(p_dni text)` en `portal.sql:194`, `portal_registrar_ingreso(p_dni text, p_resultado text, p_dispositivo text)` en `portal.sql:208`. Los `grant execute` del bloque 5 usan exactamente esos tipos.

- [ ] **Step 2: Canónico `supabase/schema.sql`**

a) Línea ~259: `grant select on v_vinculos_persona, v_movimientos_persona to anon, authenticated;` → `grant select on v_vinculos_persona, v_movimientos_persona to authenticated;`
b) Línea ~382: `grant select on centros_costo to anon, authenticated;` → `grant select on centros_costo to authenticated;`
c) Línea ~895: `grant select on v_asistencia_mensual to anon, authenticated;` → `grant select on v_asistencia_mensual to authenticated;`
d) Reemplazar el bloque completo desde `-- SEGURIDAD (nivel demostración)` hasta el `end $$;` de ese `do` (líneas ~2458-2476) por:

```sql
-- ---------------------------------------------------------------------------
-- SEGURIDAD · anon cerrado (hardening fase 1, 2026-09-14)
-- Sin JWT no se lee ni se ejecuta nada, salvo las 4 RPCs de login (ver
-- accesos.sql / portal.sql). RLS habilitado con política permisiva SOLO para
-- authenticated (acceso_demo); la fase 2 la sustituye por políticas por rol.
-- Los registros probatorios están protegidos por triggers y revocación.
-- Migración de referencia: migraciones/2026-09-14-cerrar-anon.sql.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;

do $$
declare t text;
begin
  -- documentos: política admin-solo en migraciones/2026-08-16-privacidad-documentos.sql
  foreach t in array array['empresas','personas','sedes','vinculos','lotes',
    'acuses','comunicados','memorandums','descargos','tardanzas',
    'plantillas','contratos','activos','asignaciones','lineas','epp_entregas','auditoria','cargos',
    'asistencia_config','asistencia_lotes','marcaciones','bancos']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy acceso_demo on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
```

(La línea siguiente `revoke update, delete on acuses, descargos, auditoria from anon, authenticated;` se conserva.)

- [ ] **Step 3: Canónico `supabase/accesos.sql`**

a) Reemplazar `fn_nivel_modulo` (líneas ~320-340) por la v3 del bloque 4 de la migración (texto idéntico, con `create function` en vez de `create or replace function` si el archivo usa esa convención en las demás funciones; mantener la convención del archivo).
b) Línea ~675: `create policy acceso_demo on %I for all to anon, authenticated using (true) with check (true)` → `... for all to authenticated using (true) with check (true)`.
c) Al final del archivo (o junto a `verificar_bloqueo`/`registrar_ingreso`), añadir:

```sql
-- Únicas RPCs ejecutables sin sesión (login del BackOffice).
grant execute on function verificar_bloqueo(text) to anon;
grant execute on function registrar_ingreso(text, text, text) to anon;
```

- [ ] **Step 4: Canónico `supabase/portal.sql`**

a) Línea ~504: `create policy acceso_demo on %I for all to anon, authenticated using (true) with check (true)` → `... for all to authenticated using (true) with check (true)`.
b) Junto a `portal_verificar_bloqueo`/`portal_registrar_ingreso`, añadir:

```sql
-- Únicas RPCs ejecutables sin sesión (login del portal).
grant execute on function portal_verificar_bloqueo(text) to anon;
grant execute on function portal_registrar_ingreso(text, text, text) to anon;
```

- [ ] **Step 5: Comprobación estática**

Run: `grep -n -E "to anon|to public" supabase/schema.sql supabase/accesos.sql supabase/portal.sql supabase/solicitudes.sql supabase/soporte.sql`
Expected: solo los 4 `grant execute ... to anon` de las RPCs de login. Cualquier otro `to anon` se reduce a `authenticated`.

- [ ] **Step 6: Commit**

```powershell
git add supabase/migraciones/2026-09-14-cerrar-anon.sql supabase/schema.sql supabase/accesos.sql supabase/portal.sql
git commit -m "feat(bd): cerrar el rol anonimo - revocaciones, default privileges, acceso_demo solo authenticated, fn_nivel_modulo v3"
```

---

### Task 5: Despliegue en orden + verificación completa

**Files:** ninguno nuevo (ejecución).

**Interfaces:**
- Consumes: Tasks 1-4 commiteadas en `main`.

- [ ] **Step 1: Push del frontend y esperar deploy**

```powershell
git push origin main
vercel ls intranet-general
```
Expected: el deploy más reciente en `● Ready` (Production). Confirmar que `https://intranet-general.vercel.app/` responde 200.

- [ ] **Step 2: Prueba manual previa (BD aún abierta)**

Diego entra al BackOffice: el login debe funcionar igual y el padrón real debe verse. Si la carga tras sesión rompió algo, se ve aquí ANTES de cerrar la BD.

- [ ] **Step 3: Aplicar la migración (Diego, vía `!`)**

```
! powershell -NoProfile -Command ". .\scripts\token-supabase.ps1; node scripts/aplicar-sql.mjs supabase/migraciones/2026-09-14-cerrar-anon.sql"
```
Expected: sin `raise exception`; si la verificación embebida falla, la transacción no se aplica y el mensaje dice qué quedó abierto.

- [ ] **Step 4: Suite nueva**

Run: `. .\scripts\token-supabase.ps1; node scripts/verificar-cierre-anon.mjs`
Expected: `Todo verde.` (con `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD_INICIAL` en env para incluir los casos con sesión).

- [ ] **Step 5: Suites existentes**

Run (PowerShell, una tras otra): `verificar-padron`, `verificar-control-semanal`, `verificar-tres-ajustes`, `verificar-cumplimiento-boletas`, `verificar-solicitudes`, `verificar-solicitud-pdf`, `verificar-cuentas-masa`, `verificar-fijar-correo`, `verificar-sedes`, `verificar-asistencia`.
Expected: todas exit 0 con los mismos conteos de la línea base (21/20/23/23/15/16/17/7/8/8).
Si alguna falla con `permission denied`/401 en una llamada `rest/v1/rpc/...` sin sesión: esa suite dependía del gate abierto → ajustarla para crear sesión con el patrón admin temporal (2026-08-19) y volver a correr. No reabrir nada en la BD.

- [ ] **Step 6: Radiografía y prueba manual final**

Run: `. .\scripts\token-supabase.ps1; node scripts/diagnostico-permisos.mjs`
Expected: 0 grants a anon en tablas y vistas; «Funciones ejecutables por anon» lista exactamente 4.
Diego: login BackOffice ve el padrón; login portal con una cuenta de trabajador ve sus datos, boletas y comunicados; cerrar sesión y volver a entrar funciona.

- [ ] **Step 7: Commit de ajustes (si los hubo)**

```powershell
git add scripts/diagnostico-permisos.mjs scripts/verificar-*.mjs
git commit -m "test(seguridad): radiografia de permisos y ajustes de suites al cierre de anon"
git push origin main
```

---

### Task 6: Documentación y memoria

**Files:**
- Modify: `supabase/MODELO.md:74-88` (sección «Seguridad — estado actual y siguiente paso»)
- Modify: memoria del proyecto (`proyecto-intranet-negliaf.md`)

- [ ] **Step 1: Actualizar `supabase/MODELO.md`**

Reemplazar la sección desde `## Seguridad — estado actual y siguiente paso` hasta la línea en blanco antes de `## Accesos y Roles` por:

```markdown
## Seguridad — estado actual y siguiente paso

**Fase 1 (2026-09-14, aplicada): el rol `anon` está cerrado.** Sin JWT no se
lee ninguna tabla ni vista de `public`, no se ejecuta ninguna función salvo
las 4 RPCs de login (`verificar_bloqueo`, `registrar_ingreso`,
`portal_verificar_bloqueo`, `portal_registrar_ingreso`), y los privilegios por
defecto del esquema ya no incluyen a `anon`, así que lo nuevo nace cerrado.
`fn_nivel_modulo` devuelve 0 sin JWT, salvo cuando el rol de sesión es
`postgres` o `service_role` (Management API, funciones serverless), donde
sigue siendo 99. El BackOffice carga datos solo tras resolver el usuario y en
producción nunca muestra datos de demostración. Suite:
`scripts/verificar-cierre-anon.mjs`; radiografía: `scripts/diagnostico-permisos.mjs`.

RLS está habilitado en las tablas con la política permisiva `acceso_demo`,
ahora **solo para `authenticated`**. Siguiente paso (fase 2):

1. Reemplazar `acceso_demo` por políticas por rol (Trabajador: solo sus filas
   vía `persona_dni = auth.jwt() ->> 'dni'`; Analista: empresas asignadas;
   Auditor: solo lectura) y vistas `security_invoker`.
2. El alcance se evalúa **en cada consulta**, no en la interfaz — tal como
   exige el documento de arquitectura ("ocultar un botón no es un control de
   acceso").

Los registros probatorios (`acuses`, `descargos`, `auditoria`) ya están
protegidos hoy: triggers de inmutabilidad + REVOKE de UPDATE/DELETE.
```

- [ ] **Step 2: Commit y push**

```powershell
git add supabase/MODELO.md
git commit -m "docs(modelo): seguridad fase 1 - rol anonimo cerrado"
git push origin main
```

- [ ] **Step 3: Memoria del proyecto**

En `C:\Users\DiegoSalguero\.claude\projects\C--Users-DiegoSalguero\memory\proyecto-intranet-negliaf.md`, sustituir el párrafo «HALLAZGO DE SEGURIDAD CRÍTICO (2026-09-14, sin arreglar…» por una entrada «HARDENING FASE 1 HECHO (2026-09-14, commits …)» con: qué se cerró, las 4 RPCs abiertas, la regla de `fn_nivel_modulo` v3, que el BackOffice carga tras sesión sin mock, la suite nueva, y que la fase 2 (authenticated/RLS por rol/proxy) queda pendiente con spec aparte.
