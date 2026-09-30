# Selección de trabajadores para crear cuentas del portal — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Marcar personas en la tabla de Planilla y crear sus cuentas del portal de una vez, reutilizando el modal de creación en masa.

**Architecture:** Un helper puro decide quién es seleccionable y cómo cambia la selección; `Personal.jsx` guarda la selección (`Set` de DNI), pinta casillas y una barra de acción, y abre `CuentasMasa` con la prop `seleccion`. El modal calcula sus candidatos a partir de esa lista cuando existe.

**Tech Stack:** React 19, Tailwind 4, vitest 4. Sin cambios de servidor ni de base.

**Spec:** `docs/superpowers/specs/2026-09-30-seleccion-cuentas-portal-design.md`

## Global Constraints

- Sin cambios en `api/` ni en SQL.
- Textos en español, estilo del código vecino.
- Commits con `git commit -F <archivo>` desde Bash; mensajes sin comillas dobles.

---

### Task 1: Helper de selección con pruebas

**Files:**
- Create: `src/lib/seleccionPortal.js`
- Create: `tests/seleccionPortal.test.js`

**Interfaces:**
- Produces: `esSeleccionable(p, empresaId) → boolean` (vigente, sin cuenta, de la empresa); `alternarVisibles(seleccion: Set, filas, empresaId, marcar: boolean) → Set` (nuevo Set: añade o quita los DNI seleccionables de `filas`); `depurar(seleccion: Set, personal, empresaId) → string[]` (DNI marcados que siguen seleccionables, en el orden de `personal`).

- [ ] **Step 1: Pruebas (fallan)**

```js
// tests/seleccionPortal.test.js — Selección de trabajadores para cuentas del portal.
import { describe, it, expect } from "vitest";
import { esSeleccionable, alternarVisibles, depurar } from "../src/lib/seleccionPortal.js";

const P = [
  { dni: "1", empresa: "negliaf", estado: "vigente", tieneCuenta: false },
  { dni: "2", empresa: "negliaf", estado: "vigente", tieneCuenta: true },
  { dni: "3", empresa: "negliaf", estado: "cesado", tieneCuenta: false },
  { dni: "4", empresa: "promant", estado: "vigente", tieneCuenta: false },
  { dni: "5", empresa: "negliaf", estado: "vigente", tieneCuenta: false },
];

describe("esSeleccionable", () => {
  it("solo vigente, sin cuenta y de la empresa activa", () => {
    expect(P.map((p) => esSeleccionable(p, "negliaf"))).toEqual([true, false, false, false, true]);
  });
});
describe("alternarVisibles", () => {
  it("marcar añade solo los seleccionables de las filas visibles y no muta el Set original", () => {
    const antes = new Set(["9"]);
    const despues = alternarVisibles(antes, P, "negliaf", true);
    expect([...despues].sort()).toEqual(["1", "5", "9"]);
    expect([...antes]).toEqual(["9"]);
  });
  it("desmarcar quita solo los de las filas visibles", () => {
    const despues = alternarVisibles(new Set(["1", "5", "9"]), [P[0]], "negliaf", false);
    expect([...despues].sort()).toEqual(["5", "9"]);
  });
});
describe("depurar", () => {
  it("devuelve los marcados que siguen seleccionables, en el orden del maestro", () => {
    expect(depurar(new Set(["5", "2", "1", "3", "4", "zz"]), P, "negliaf")).toEqual(["1", "5"]);
  });
});
```

- [ ] **Step 2: Correr** — `npx vitest run tests/seleccionPortal.test.js` → falla por import.

- [ ] **Step 3: Implementar**

```js
// src/lib/seleccionPortal.js — Selección de trabajadores en Planilla para crear
// cuentas del portal en bloque (2026-09-30). Seleccionable = vigente, sin
// cuenta y de la razón social activa; lo demás no lleva casilla.
export const esSeleccionable = (p, empresaId) =>
  p.empresa === empresaId && p.estado === "vigente" && !p.tieneCuenta;

// Nuevo Set: añade (marcar=true) o quita los seleccionables de las filas visibles.
export const alternarVisibles = (seleccion, filas, empresaId, marcar) => {
  const nuevo = new Set(seleccion);
  for (const p of filas) {
    if (!esSeleccionable(p, empresaId)) continue;
    if (marcar) nuevo.add(p.dni); else nuevo.delete(p.dni);
  }
  return nuevo;
};

// DNI marcados que siguen siendo seleccionables, en el orden del maestro.
export const depurar = (seleccion, personal, empresaId) =>
  personal.filter((p) => seleccion.has(p.dni) && esSeleccionable(p, empresaId)).map((p) => p.dni);
```

- [ ] **Step 4: Correr** → 4 verdes. **Step 5: Commit** `backoffice(planilla): helper de seleccion para cuentas del portal`.

---

### Task 2: Casillas, barra de acción y modal con selección

**Files:**
- Modify: `src/pages/rrhh/Personal.jsx` (componente `Personal` y `CuentasMasa`)

**Interfaces:**
- Consumes: helper de Task 1; `CuentasMasa` recibe prop opcional `seleccion: string[] | null`.

- [ ] **Step 1: Estado y derivados en `Personal`** (junto a `const [masa, setMasa]`):

```jsx
  // Selección para crear cuentas del portal en bloque (2026-09-30): Set de DNI;
  // se limpia al cambiar de razón social y al cerrar el modal tras crear.
  const [seleccion, setSeleccion] = useState(() => new Set());
  const [masaSeleccion, setMasaSeleccion] = useState(null); // string[] | null → modal con lista fija
  useEffect(() => { setSeleccion(new Set()); }, [empresaId]);
  const seleccionados = useMemo(() => depurar(seleccion, db.personal, empresaId), [seleccion, db.personal, empresaId]);
  const visiblesSeleccionables = filas.filter((p) => esSeleccionable(p, empresaId));
  const visiblesMarcados = visiblesSeleccionables.filter((p) => seleccion.has(p.dni)).length;
  const alternar = (dni) => setSeleccion((s) => { const n = new Set(s); if (n.has(dni)) n.delete(dni); else n.add(dni); return n; });
```

Importar `useEffect` de react y `{ esSeleccionable, alternarVisibles, depurar }` de `../../lib/seleccionPortal`.

- [ ] **Step 2: Barra de acción** justo antes de `{filas.length === 0 ? (` dentro del `Card`:

```jsx
        {seleccionados.length > 0 && (
          <div className="flex items-center gap-3 border-b border-borde bg-[#eef4fa] px-3.5 py-2 text-[13px] text-tinta">
            <span className="font-semibold">{seleccionados.length} {seleccionados.length === 1 ? "seleccionado" : "seleccionados"}</span>
            <Button size="sm" onClick={() => setMasaSeleccion(seleccionados)}>
              <Smartphone size={13} /> Crear cuentas del portal
            </Button>
            <button type="button" onClick={() => setSeleccion(new Set())} className="text-[12.5px] font-semibold text-petroleo hover:underline">
              Limpiar selección
            </button>
          </div>
        )}
```

- [ ] **Step 3: Casillas en la tabla.** Cabecera: `head={[<CasillaTodos />, "Documento", …]}` donde el primer elemento es un `<input type="checkbox">` con `checked={visiblesSeleccionables.length > 0 && visiblesMarcados === visiblesSeleccionables.length}`, `ref` que fija `indeterminate = visiblesMarcados > 0 && visiblesMarcados < visiblesSeleccionables.length`, `disabled={visiblesSeleccionables.length === 0}`, `title="Seleccionar visibles sin cuenta"`, `onChange={(e) => setSeleccion((s) => alternarVisibles(s, filas, empresaId, e.target.checked))}`. (`Table` acepta nodos en `head`; comprobarlo en `ui.jsx:113`: usa `head.map`, así que un elemento JSX funciona.) Fila: primera celda `<Td className="w-8">{esSeleccionable(p, empresaId) && <input type="checkbox" checked={seleccion.has(p.dni)} onChange={() => alternar(p.dni)} aria-label={`Seleccionar a ${p.nombre}`} />}</Td>`.

- [ ] **Step 4: `CuentasMasa` con selección.** Nueva prop `seleccion = null`. `candidatos`:

```jsx
  const candidatos = useMemo(
    () => seleccion
      ? personal.filter((p) => seleccion.includes(p.dni) && p.empresa === empresaId && p.estado === "vigente" && !p.tieneCuenta)
      : personal.filter((p) => p.empresa === empresaId && p.estado === "vigente" && !p.tieneCuenta && (!fSede || p.sede === fSede)),
    [personal, empresaId, fSede, seleccion]
  );
```

Título: `title={seleccion ? \`Cuentas del portal — ${seleccion.length} ${seleccion.length === 1 ? "seleccionado" : "seleccionados"}\` : "Cuentas del portal en masa"}`. El párrafo introductorio y el `Select` de sede se muestran solo si `!seleccion`; con selección, párrafo: «Crea las cuentas del portal de las personas marcadas. Usuario: su número de documento. Clave inicial: aleatoria de 6 dígitos — se envía al correo registrado y queda en un CSV descargable para entrega en mano.» El `Note` de «Todos los vigentes ya tienen cuenta» pasa a «Las personas marcadas ya tienen cuenta o ya no están vigentes.» cuando hay selección.

Segunda instancia del modal en `Personal`: `<CuentasMasa open={!!masaSeleccion} seleccion={masaSeleccion} onClose={(creo) => { setMasaSeleccion(null); if (creo) setSeleccion(new Set()); }} … />`. En `CuentasMasa`, `cerrar` llama `onClose(paso === 3)` para que la selección se limpie solo tras crear.

- [ ] **Step 5: Build y pruebas** — `npx vite build`, `npm test` (248). **Step 6: Commit** `backoffice(planilla): casillas y creacion de cuentas del portal para los seleccionados`.

---

### Task 3: Cierre

- [ ] Push; CI verde; deploy Ready. Prueba manual de Diego (marcar 2, crear, CSV/correo; filas con cuenta sin casilla). Memoria.
