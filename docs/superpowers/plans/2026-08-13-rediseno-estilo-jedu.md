# Rediseño del design system estilo jedu (Login100) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Llevar toda la intranet GrupoER al estilo del template jedu/Colorlib Login100 (Poppins/Montserrat, radios 10px, grises suaves, transiciones y foco animado) conservando la paleta corporativa azul `#3569a0` / naranja `#dc6e00`.

**Architecture:** El design system vive en dos puntos únicos — tokens en `src/index.css` (@theme de Tailwind 4) y componentes en `src/components/ui.jsx` — y las páginas consumen tokens por nombre (`text-tinta`, `bg-petroleo`…). Se cambian VALORES de tokens y estilos de componentes sin renombrar tokens, así las ~25 páginas se actualizan solas. El login y CambioClave tienen estilos propios y se rediseñan aparte con el patrón de input subrayado animado del template.

**Tech Stack:** React 19 + Vite 7 + Tailwind 4 (`@theme`), Google Fonts (Poppins, Montserrat), lucide-react.

## Global Constraints

- Paleta corporativa intocable: azul `#3569a0` (petroleo), marino `#1d3f72` (tinta), acero `#5481ab`, naranja `#dc6e00` (pend). Verde `#47775f` y rojo `#c43f49` se mantienen.
- Los NOMBRES de los tokens no cambian (las páginas los referencian); solo valores y componentes.
- No tocar lógica: el rediseño es 100 % visual. AdminLogin conserva intacto todo el flujo de auth, diagnóstico `?probar=1` y el ojito.
- Cada tarea termina con `npm run build` exitoso + commit + push (deploy automático a Vercel, así Diego ve el avance en producción).
- Radio maestro del template: 10px (`rounded-caja`). Botones y badges: píldora (`rounded-full`). Transiciones: 0.2–0.4 s.
- No hay framework de tests de UI: la verificación de cada tarea es build limpio + revisión visual en producción.

---

### Task 1: Fundamentos — fuentes, tokens y radio maestro

**Files:**
- Modify: `index.html:9-12` (link de Google Fonts)
- Modify: `src/index.css` (todo el archivo)
- Modify (sed global): todo `src/**` que contenga `rounded-[4px]` (18 ocurrencias en 5 archivos) y `rounded-[6px]`/`rounded-t-[6px]` (Modal en `ui.jsx`)

**Interfaces:**
- Produces: token `--radius-caja: 10px` → clase `rounded-caja` disponible en todo el proyecto; `--font-display` (Montserrat) → clase `font-display`; valores nuevos de grises (`papel #f2f3f5`, `gris #555`, `gris-cl #999`, `borde #e6e8eb`). Las tareas 2–4 usan `rounded-caja` y `font-display`.

- [ ] **Step 1: Fuentes en index.html** — reemplazar el link de Google Fonts para sumar Poppins y Montserrat:

```html
<link
  href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Montserrat:wght@600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
  rel="stylesheet"
/>
```

- [ ] **Step 2: Tokens en src/index.css** — reemplazar el contenido completo por:

```css
@import "tailwindcss";

/*
  Design system GrupoER v2 (2026-08-13) — estilo adaptado del template
  Colorlib "Login 100" (referencia: intranet jedu.pe) con la paleta
  corporativa propia: azul #3569a0 y naranja #dc6e00 sobre grises suaves,
  tipografía Poppins (texto) y Montserrat (titulares), radios de 10px y
  transiciones de 0.2–0.4s. Los nombres de token se conservan.
*/
@theme {
  --font-sans: "Poppins", "Segoe UI", Helvetica, Arial, sans-serif;
  --font-display: "Montserrat", "Poppins", "Segoe UI", sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;

  --radius-caja: 10px;         /* radio maestro del template */

  --color-tinta: #1d3f72;      /* azul marino — titulares y marca */
  --color-tinta-2: #28507a;    /* azul marino claro */
  --color-tinta-3: #16345c;    /* marino profundo */
  --color-petroleo: #3569a0;   /* azul primario — botones, enlaces, iconos */
  --color-petroleo-cl: #3b76b3;/* hover del primario */
  --color-acero: #5481ab;      /* cabeceras de tablas y modales */
  --color-papel: #f2f3f5;      /* fondo de la aplicación (gris más suave) */
  --color-borde: #e6e8eb;
  --color-borde-f: #d4d8dd;
  --color-gris: #555555;       /* texto base (gris del template) */
  --color-gris-cl: #999999;    /* texto atenuado / placeholders */
  --color-pend: #dc6e00;       /* acento naranja — pendientes, activo */
  --color-pend-bg: #fdf0e0;
  --color-conf: #47775f;       /* confirmado */
  --color-conf-bg: #eaf1ed;
  --color-alerta: #c43f49;     /* peligro */
  --color-alerta-bg: #fae9ea;
}

body {
  font-family: var(--font-sans);
  background: var(--color-papel);
  color: var(--color-gris);
  -webkit-font-smoothing: antialiased;
  font-size: 14px;
}

/* Transición base del template: todo control responde suave al interactuar. */
@layer base {
  button, a, input, select, textarea, [role="button"] {
    transition: color 0.2s, background-color 0.2s, border-color 0.2s, box-shadow 0.2s, transform 0.2s, opacity 0.2s;
  }
}

/* Aparición de modales y notas (animate.css del template, versión mínima). */
@keyframes aparecer {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.animar-aparicion { animation: aparecer 0.25s ease-out both; }

:focus-visible {
  outline: 2px solid var(--color-petroleo);
  outline-offset: 2px;
}
```

- [ ] **Step 3: Radio maestro global** — reemplazo mecánico en `src/` (PowerShell o Node): `rounded-[4px]` → `rounded-caja`, `rounded-[6px]` → `rounded-caja`, `rounded-t-[6px]` → `rounded-t-caja`. Archivos afectados: `src/components/ui.jsx`, `src/layout/Shell.jsx`, `src/pages/AdminLogin.jsx`, `src/pages/accesos/PerfilEditor.jsx`, `src/pages/accesos/Usuarios.jsx`.

- [ ] **Step 4: Build** — `npm run build` → `✓ built` sin errores.

- [ ] **Step 5: Commit + push** — `git add index.html src/ && git commit -m "feat(diseno): fundamentos v2 - Poppins/Montserrat, grises suaves, radio maestro 10px" && git push`

### Task 2: Componentes del design system (ui.jsx)

**Files:**
- Modify: `src/components/ui.jsx` (todo el archivo)

**Interfaces:**
- Consumes: `rounded-caja`, `font-display`, `.animar-aparicion` (Task 1).
- Produces: mismas APIs públicas (PageHeader, Card, Stat, Badge, Button, Field, inputCls, Input, Select, Textarea, Table, Td, EmptyState, Progress, Modal, Note) — cero cambios de props.

- [ ] **Step 1: Actualizar estilos de componentes** — cambios exactos (solo className, ninguna prop):

```jsx
// PageHeader: titular con Montserrat
<h1 className="mt-0.5 inline-block border-b-2 border-pend pb-1 font-display text-xl font-bold tracking-tight text-tinta">

// Card: sombra suave difusa del template en vez del borde duro
<div className={`rounded-caja border border-borde bg-white shadow-[0_2px_12px_rgba(29,63,114,0.07)] ${pad ? "p-5" : ""} ${className}`}>

// Badge: píldora
<span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${BADGE_TONES[tone]}`}>

// Button: píldora con micro-elevación al hover
<button
  className={`inline-flex items-center justify-center gap-1.5 rounded-full font-semibold shadow-sm hover:-translate-y-px hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 ${variants[variant]} ${sizes[size]} ${className}`}
  {...props}
/>
// sizes con algo más de aire lateral (píldora):
const sizes = { md: "px-5 py-2 text-[13px]", sm: "px-3.5 py-1.5 text-[12px]" };

// inputCls: foco con anillo suave del template
export const inputCls =
  "w-full rounded-caja border border-borde-f bg-white px-3.5 py-2 text-[13px] text-gris placeholder:text-gris-cl focus:border-petroleo focus:shadow-[0_0_0_3px_rgba(53,105,160,0.14)] focus:outline-none";

// Table: contenedor redondeado que recorta la cabecera acero
<div className="overflow-x-auto rounded-caja border border-borde">
  <table className="w-full border-collapse text-[13px]">…</table>
</div>

// EmptyState
<div className="rounded-caja border border-dashed border-borde-f bg-papel/60 px-6 py-10 text-center">

// Modal: aparición animada + fondo con blur
<div className="fixed inset-0 z-50 flex items-center justify-center bg-tinta-3/50 p-4 backdrop-blur-[2px]" onClick={onClose}>
  <div className={`animar-aparicion max-h-[90vh] w-full ${wide ? "max-w-3xl" : "max-w-lg"} overflow-y-auto rounded-caja bg-white shadow-2xl`} …>
    <div className="flex items-center justify-between gap-4 rounded-t-caja bg-acero px-5 py-3">…

// Note: aparición animada
<div className={`animar-aparicion rounded-caja border px-3.5 py-2.5 text-[12.5px] leading-relaxed ${tones[tone]}`}>
```

- [ ] **Step 2: Build** — `npm run build` → `✓ built`.
- [ ] **Step 3: Commit + push** — `git add src/components/ui.jsx && git commit -m "feat(diseno): componentes v2 - pildoras, sombras suaves, foco con anillo y modales animados" && git push`
- [ ] **Step 4: Verificación visual** — abrir producción: tarjetas con sombra difusa, botones píldora, tablas con esquinas recortadas, modal aparece con animación.

### Task 3: Shell — menú lateral y cabecera

**Files:**
- Modify: `src/layout/Shell.jsx` (bloques del aside, NavGroup y header)

**Interfaces:**
- Consumes: `rounded-caja`, `font-display` (Task 1).
- Produces: nada nuevo para otras tareas (hoja del árbol).

- [ ] **Step 1: NavLink como píldora activa** — reemplazar el className del NavLink en `NavGroup`:

```jsx
className={({ isActive }) =>
  `mb-1 flex items-center gap-2.5 rounded-caja px-3 py-2 text-[13px] font-medium ${
    isActive
      ? "bg-petroleo font-semibold text-white shadow-[0_2px_8px_rgba(53,105,160,0.35)]"
      : "text-gris hover:translate-x-0.5 hover:bg-papel hover:text-tinta"
  }`
}
// y en el icono interior:
<Icon size={15} className={`shrink-0 ${isActive ? "text-white" : "text-petroleo"}`} />
// el código de pantalla dentro del item activo debe leerse sobre azul:
<span className={`font-mono text-[9px] ${isActive ? "text-white/70" : "text-gris-cl"}`}>{code}</span>
```

(Nota: el render-prop del NavLink ya expone `isActive` para los hijos; el `<span>` del código hoy usa `text-gris-cl` fijo — cambiarlo a la expresión de arriba.)

- [ ] **Step 2: Marca y select** — en el aside, el bloque de marca usa `font-display`:

```jsx
<div className="font-display text-[16px] font-bold tracking-tight text-tinta">
  Grupo<span className="text-petroleo">ER</span>
</div>
```

y el `<select>` de empresa en el header pasa a `rounded-caja` (quedó con `rounded-caja` desde el sed de Task 1 — verificar) con foco de anillo: agregar `focus:shadow-[0_0_0_3px_rgba(53,105,160,0.14)]`.

- [ ] **Step 3: Build** — `npm run build` → `✓ built`.
- [ ] **Step 4: Commit + push** — `git add src/layout/Shell.jsx && git commit -m "feat(diseno): menu lateral con pildora activa y micro-desplazamiento al hover" && git push`

### Task 4: Login y CambioClave estilo Login100

**Files:**
- Modify: `src/pages/AdminLogin.jsx` (solo el JSX del return; la lógica de `entrar`, diagnóstico y ojito quedan intactos)
- Modify: `src/pages/CambioClave.jsx` (alinear inputs y botón al mismo estilo; leer el archivo antes de tocar)

**Interfaces:**
- Consumes: `rounded-caja`, `font-display`, tokens (Task 1).
- Produces: patrón de input subrayado animado (documentado aquí; si CambioClave lo repite, copiar el bloque, no abstraer todavía — regla de tres).

- [ ] **Step 1: Tarjeta central del login** — el `<section>` del formulario pasa a tarjeta blanca estilo `wrap-login100`:

```jsx
<section className="w-full">
  <div className="mx-auto w-full max-w-md px-6">
    <form onSubmit={entrar} className="animar-aparicion rounded-caja bg-white px-8 py-10 shadow-[0_5px_30px_rgba(29,63,114,0.12)]">
      …campos…
    </form>
  </div>
</section>
```

El encabezado de marca (GrupoER / INTRANET · BACKOFFICE) se mueve DENTRO de la tarjeta, centrado, con `font-display`; el fondo degradado de la página se conserva.

- [ ] **Step 2: Inputs con subrayado animado** (patrón `focus-input100`: línea inferior que crece al enfocar). Campo de correo:

```jsx
<div className="group relative mb-7">
  <div className="flex items-center gap-3 border-b-2 border-borde-f pb-2">
    <Mail size={18} className="shrink-0 text-gris-cl transition-colors group-focus-within:text-petroleo" />
    <input
      type="email"
      placeholder="Correo electrónico"
      autoFocus
      autoComplete="username"
      value={correo}
      onChange={(e) => setCorreo(e.target.value)}
      className="w-full bg-transparent text-[15px] text-gris placeholder:text-gris-cl focus:outline-none"
    />
  </div>
  <span className="absolute bottom-0 left-0 h-0.5 w-full origin-left scale-x-0 bg-petroleo transition-transform duration-300 group-focus-within:scale-x-100" />
</div>
```

Campo de clave: mismo patrón con `KeyRound`, `type={verClave ? "text" : "password"}` y el ojito como botón sin borde a la derecha dentro del flex:

```jsx
<button
  type="button"
  onClick={() => setVerClave((v) => !v)}
  aria-label={verClave ? "Ocultar clave" : "Mostrar clave"}
  className="shrink-0 text-gris-cl hover:text-petroleo"
>
  {verClave ? <EyeOff size={18} /> : <Eye size={18} />}
</button>
```

- [ ] **Step 3: Botón de ingreso** — píldora ancha con hover naranja (efecto "dinámico" del template):

```jsx
<button
  type="submit"
  disabled={cargando || !correo.trim() || !clave}
  className="w-full rounded-full bg-petroleo py-3 text-[16px] font-semibold tracking-wide text-white shadow-md transition-all hover:-translate-y-px hover:bg-pend hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:bg-petroleo"
>
  {cargando ? "Verificando…" : "Ingresar"}
</button>
```

- [ ] **Step 4: CambioClave.jsx** — leer el archivo; aplicar la misma tarjeta (`rounded-caja bg-white shadow…`), mismos inputs subrayados y mismo botón píldora. No tocar la lógica de validación ni las RPC.

- [ ] **Step 5: Build** — `npm run build` → `✓ built`.
- [ ] **Step 6: Commit + push** — `git add src/pages/AdminLogin.jsx src/pages/CambioClave.jsx && git commit -m "feat(diseno): login y cambio de clave estilo Login100 con subrayado animado" && git push`
- [ ] **Step 7: Verificación funcional** — en producción `/admin/login`: probar foco (línea azul crece), ojito, e ingresar con credenciales reales → el BackOffice carga. El diagnóstico `?probar=1` sigue operativo.

### Task 5: Barrido de coherencia y cierre

**Files:**
- Modify: lo que el barrido encuentre (esperado: restos de `border-2 border-petroleo` del login viejo, algún `rounded` suelto, estilos ad-hoc en `src/pages/accesos/*` y `src/pages/rrhh/*`)

**Interfaces:**
- Consumes: todo lo anterior.

- [ ] **Step 1: Barrido mecánico** — `grep -rn "rounded-\[" src/` y `grep -rn "border-2 border-petroleo" src/` → cero resultados esperados; si aparecen, migrarlos a `rounded-caja`/estilo nuevo.
- [ ] **Step 2: Revisión de páginas** — abrir en producción: Tablero RRHH, Personal (tabla+modal), Boletas (wizard), Perfiles/PerfilEditor (matriz), Usuarios, Registro de accesos, Inventario. Verificar: tablas recortadas, botones píldora, sin desbordes por el cambio de fuente (Poppins es ~5 % más ancha que Helvetica; vigilar celdas y el select de empresa).
- [ ] **Step 3: Build + commit final** — `npm run build` → `git add -A && git commit -m "feat(diseno): barrido de coherencia del rediseno v2" && git push`
- [ ] **Step 4: Cierre** — confirmación visual de Diego en producción; actualizar memoria del proyecto (rediseño hecho, tokens v2).

## Self-Review

- **Cobertura:** fuentes+tokens (T1), componentes (T2), navegación (T3), login/clave (T4), páginas y cierre (T5) — cubre "toda la intranet" con paleta GrupoER. ✓
- **Sin placeholders:** cada paso lleva el código o el comando exacto; el único "leer antes de tocar" es CambioClave.jsx (contenido no está en contexto — el paso lo exige explícitamente). ✓
- **Consistencia de nombres:** `rounded-caja`, `font-display`, `.animar-aparicion` definidos en T1 y consumidos en T2–T4 con esos mismos nombres. ✓
