# Motor de correo en Resend — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar Resend como único proveedor de correo (motor propio y Supabase Auth), con rastro completo en `correo_envios` y un aviso de fallos para superadministradores en el BackOffice.

**Architecture:** `api/_correo.js` pierde el camino SMTP y reintenta una vez ante 429. Los correos de acceso (`api/portal-cuentas.js`, `api/admin-usuarios.js`) registran su intento con `registrar()` de `api/enviar-correo.js`. Una función SQL `correo_fallos_recientes()` (definer, guarda `requiere_superadmin()`) es el único camino de lectura de `correo_envios`; el cliente la carga tras el segundo factor y el Shell muestra una franja con modal. Supabase Auth pasa al SMTP de Resend por un script que corre Diego.

**Tech Stack:** Node 22 serverless en Vercel (fetch nativo), React 19 + react-router + Tailwind 4, vitest 4, PostgreSQL 17 (Supabase; esquemas `public`/`interno`), Postgres embebido (`scripts/pg-local.mjs`) para ensayos, Management API de Supabase para configurar Auth y verificar producción.

**Spec:** `docs/superpowers/specs/2026-09-30-motor-correo-resend-design.md`

## Global Constraints

- No se agregan archivos a `api/` sin guion bajo: el plan Hobby de Vercel admite 12 funciones y ya hay 12.
- `correo_envios` sigue sin política RLS y sin privilegios para `authenticated`/`anon` (`SIN_POLITICA` de `scripts/fase4-generar.mjs` no cambia).
- Toda función SQL nueva: `security definer`, `set search_path = public, interno, extensions`, guarda en la primera línea, `revoke all … from public, anon` + `grant execute … to authenticated`.
- Ningún secreto en el código, en el chat ni en la salida de scripts: la llave de Resend viaja por stdin/portapapeles.
- Migraciones en producción las aplica Diego con `!` ANTES del push del código que las necesita.
- Commits con `git commit -F <archivo>` desde Bash (la herramienta PowerShell rompe los here-strings); mensajes sin comillas dobles.
- Textos de interfaz y comentarios en español, estilo del código vecino.
- Al editar SQL en canónicos usar la herramienta Edit o `split/join`; jamás `String.replace` con un reemplazo que contenga `$$`.

---

### Task 1: `_correo.js` solo con Resend

**Files:**
- Modify: `api/_correo.js`
- Create: `tests/api/_correo.test.js`
- Modify: `package.json` (quitar `nodemailer`), `package-lock.json` (vía `npm uninstall`)
- Delete: `scripts/verificar-smtp.mjs`
- Modify: `scripts/comprobar-paquete.mjs:14`
- Modify: `src/pages/rrhh/Personal.jsx:431-436`

**Interfaces:**
- Produces: `enviar(destino, asunto, html) → Promise<{} | { error: string }>`, `motorConfigurado() → boolean`, `REMITENTE`, `plantilla`, `botonCorreo` (sin cambios de firma), `PAUSA_429_MS = 1000`.

- [ ] **Step 1: Escribir las pruebas que fallan**

```js
// tests/api/_correo.test.js — Motor de correo: Resend es el único proveedor.
// fetch se simula; el módulo lee la env al importarse, por eso cada prueba lo
// vuelve a importar con vi.resetModules().
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const respuesta = (status, cuerpo) => new Response(cuerpo, { status });
let llamadas;
const cargar = async (env) => {
  vi.resetModules();
  for (const k of ["RESEND_API_KEY", "CORREO_REMITENTE", "SMTP_USER", "SMTP_PASS"]) delete process.env[k];
  Object.assign(process.env, env);
  return import("../../api/_correo.js");
};
beforeEach(() => { llamadas = []; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("enviar por Resend", () => {
  it("POST a api.resend.com con Bearer, remitente de la env y el destino; 200 → {}", async () => {
    globalThis.fetch = vi.fn(async (url, init) => { llamadas.push({ url: String(url), init }); return respuesta(200, "{}"); });
    const { enviar, motorConfigurado, REMITENTE } = await cargar({ RESEND_API_KEY: "re_prueba", CORREO_REMITENTE: "GrupoER <no-responder@avisos.ejemplo>" });
    expect(motorConfigurado()).toBe(true);
    expect(REMITENTE).toBe("GrupoER <no-responder@avisos.ejemplo>");
    expect(await enviar("a@ejemplo.pe", "Asunto", "<p>Hola</p>")).toEqual({});
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].url).toBe("https://api.resend.com/emails");
    expect(llamadas[0].init.headers.Authorization).toBe("Bearer re_prueba");
    expect(JSON.parse(llamadas[0].init.body)).toEqual({ from: "GrupoER <no-responder@avisos.ejemplo>", to: ["a@ejemplo.pe"], subject: "Asunto", html: "<p>Hola</p>" });
  });
  it("un error del proveedor devuelve el estado y los primeros 200 caracteres del cuerpo", async () => {
    globalThis.fetch = vi.fn(async () => respuesta(400, JSON.stringify({ message: "API key is invalid" })));
    const { enviar } = await cargar({ RESEND_API_KEY: "re_prueba" });
    const r = await enviar("a@ejemplo.pe", "x", "y");
    expect(r.error).toMatch(/^El proveedor de correo respondió 400: .*API key is invalid/);
  });
  it("429 → espera PAUSA_429_MS y reintenta UNA vez; si la segunda va bien devuelve {}", async () => {
    let n = 0;
    globalThis.fetch = vi.fn(async () => (++n === 1 ? respuesta(429, "rate limit") : respuesta(200, "{}")));
    const { enviar, PAUSA_429_MS } = await cargar({ RESEND_API_KEY: "re_prueba" });
    const p = enviar("a@ejemplo.pe", "x", "y");
    await vi.advanceTimersByTimeAsync(PAUSA_429_MS);
    expect(await p).toEqual({});
    expect(n).toBe(2);
  });
  it("429 dos veces → error 429, sin tercer intento", async () => {
    let n = 0;
    globalThis.fetch = vi.fn(async () => { n++; return respuesta(429, "rate limit"); });
    const { enviar, PAUSA_429_MS } = await cargar({ RESEND_API_KEY: "re_prueba" });
    const p = enviar("a@ejemplo.pe", "x", "y");
    await vi.advanceTimersByTimeAsync(PAUSA_429_MS * 2);
    expect((await p).error).toMatch(/respondió 429/);
    expect(n).toBe(2);
  });
  it("sin RESEND_API_KEY: motor sin configurar, error claro y ningún fetch; SMTP_USER/SMTP_PASS ya no cuentan", async () => {
    globalThis.fetch = vi.fn();
    const { enviar, motorConfigurado, REMITENTE } = await cargar({ SMTP_USER: "x@gmail.com", SMTP_PASS: "clave" });
    expect(motorConfigurado()).toBe(false);
    expect(REMITENTE).toBe("GrupoER <onboarding@resend.dev>");
    expect((await enviar("a@ejemplo.pe", "x", "y")).error).toBe("El motor de correo aún no está configurado (falta RESEND_API_KEY).");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("la llave y el remitente se sanean de BOM y espacios", async () => {
    globalThis.fetch = vi.fn(async (url, init) => { llamadas.push({ init }); return respuesta(200, "{}"); });
    const { enviar, REMITENTE } = await cargar({ RESEND_API_KEY: "﻿ re_prueba \n", CORREO_REMITENTE: " GrupoER <a@b.c> " });
    await enviar("a@ejemplo.pe", "x", "y");
    expect(llamadas[0].init.headers.Authorization).toBe("Bearer re_prueba");
    expect(REMITENTE).toBe("GrupoER <a@b.c>");
  });
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run tests/api/_correo.test.js`
Expected: fallan «sin RESEND_API_KEY» (hoy SMTP cuenta y el mensaje menciona SMTP), «429 → reintenta» (hoy no reintenta) y «PAUSA_429_MS» no existe.

- [ ] **Step 3: Reescribir `api/_correo.js`**

```js
// Núcleo compartido del motor de correo (el guion bajo evita que Vercel lo
// exponga como endpoint). Único proveedor: Resend (env RESEND_API_KEY, llave de
// solo envío limitada al dominio avisos.servicios-intranet.net; remitente en
// CORREO_REMITENTE). Gmail/SMTP se retiró el 2026-09-30: Google revocaba la
// contraseña de aplicación y dejaba sin segundo factor a los superadmins.
// Sin llave, devuelve el error claro y quien llama decide si es bloqueante.
const limpiar = (v) => (typeof v === "string" ? v.replace(/^[﻿​\s]+|[﻿​\s]+$/g, "") : v);
const RESEND = limpiar(process.env.RESEND_API_KEY) || "";
export const REMITENTE = limpiar(process.env.CORREO_REMITENTE) || "GrupoER <onboarding@resend.dev>";
// Resend limita las peticiones por segundo: ante 429 se espera y se reintenta
// UNA vez (cubre los envíos en lote de cuentas del portal).
export const PAUSA_429_MS = 1000;
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

export const motorConfigurado = () => Boolean(RESEND);

export async function enviar(destino, asunto, html) {
  if (!RESEND) return { error: "El motor de correo aún no está configurado (falta RESEND_API_KEY)." };
  const pedir = () => fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND}`, "content-type": "application/json" },
    body: JSON.stringify({ from: REMITENTE, to: [destino], subject: asunto, html }),
  });
  let r = await pedir();
  if (r.status === 429) { await pausa(PAUSA_429_MS); r = await pedir(); }
  if (!r.ok) return { error: `El proveedor de correo respondió ${r.status}: ${(await r.text()).slice(0, 200)}` };
  return {};
}

export const plantilla = (titulo, cuerpo) => `
  <div style="font-family:Poppins,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#333">
    <h2 style="color:#3569a0;margin-bottom:4px">GrupoER</h2>
    <h3 style="margin-top:0">${titulo}</h3>
    ${cuerpo}
    <p style="font-size:12px;color:#999;margin-top:28px">Si no esperabas este correo, ignóralo: nada cambia sin tu acción.</p>
  </div>`;

export const botonCorreo = (href, texto) =>
  `<p><a href="${href}" style="background:#3569a0;color:#fff;padding:10px 22px;border-radius:10px;text-decoration:none">${texto}</a></p>`;
```

(Los caracteres invisibles del regex de `limpiar` son U+FEFF y U+200B: copiar la línea del archivo actual, no reescribirla.)

- [ ] **Step 4: Retirar nodemailer, el verificador SMTP y ajustar avisos**

Run: `npm uninstall nodemailer` y `git rm scripts/verificar-smtp.mjs`.

En `scripts/comprobar-paquete.mjs` línea 14: `[/SUPA_SERVICE_KEY|SMTP_PASS|RESEND_API_KEY|CORREO_SECRETO/, "nombre de secreto del servidor"],` (se conserva `SMTP_PASS`: si reapareciera en un bundle sería igual de grave).

En `api/enviar-correo.js` líneas 25-27 reemplazar el comentario de proveedores por:
```js
// Proveedor: Resend (env RESEND_API_KEY, remitente CORREO_REMITENTE; plan gratis
// 100 correos/día). La llave vive SOLO en las variables de entorno del servidor.
```

En `src/pages/rrhh/Personal.jsx` líneas 431-436:
```jsx
            {envios >= 80 && (
              <Note tone="pend">
                Se enviarían {envios} correos y el tope diario del proveedor es 100: corre la creación por sede
                o en varios días para no perder envíos.
              </Note>
            )}
```

- [ ] **Step 5: Correr toda la suite y compilar**

Run: `npm test` y `npx vite build`
Expected: todo verde (las pruebas existentes simulan `_correo.js`, no dependen de nodemailer); build sin avisos de importación.

- [ ] **Step 6: Commit**

```bash
printf 'correo(api): Resend como unico proveedor, reintento ante 429 y retiro de Gmail/nodemailer\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>\n' > "$TEMP/msg.txt"
git add api/_correo.js api/enviar-correo.js tests/api/_correo.test.js package.json package-lock.json scripts/comprobar-paquete.mjs src/pages/rrhh/Personal.jsx
git commit -F "$TEMP/msg.txt"
```

---

### Task 2: Rastro de los correos de acceso

**Files:**
- Modify: `api/portal-cuentas.js:28-38`
- Modify: `api/admin-usuarios.js:14-25`
- Create: `tests/api/portal-cuentas.test.js`
- Modify: `tests/api/admin-usuarios.test.js`

**Interfaces:**
- Consumes: `registrar(fila)` de `api/enviar-correo.js` (POST a `/rest/v1/correo_envios`, mejor esfuerzo).
- Produces: filas `{ accion: "acceso-portal" | "acceso-admin", ip: null, sujeto: null, destinatario, resultado: "enviado" | "error", detalle }`.

- [ ] **Step 1: Prueba nueva de portal-cuentas (falla)**

```js
// tests/api/portal-cuentas.test.js — Cuentas del portal: cada correo de acceso
// deja rastro en correo_envios (sin ip ni sujeto: es informativo, no limita).
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

process.env.SUPA_SERVICE_KEY = "clave-servicio-de-prueba";
process.env.VITE_SUPABASE_ANON_KEY = "sb_publishable_prueba";
const motor = { falla: false };
vi.mock("../../api/_correo.js", () => ({
  enviar: vi.fn(async () => (motor.falla ? { error: "El proveedor de correo respondió 429: rate limit" } : {})),
  plantilla: (t, c) => `${t}${c}`, botonCorreo: () => "",
}));

let handler;
beforeAll(async () => { ({ default: handler } = await import("../../api/portal-cuentas.js")); });
const rastro = [];
const json = (cuerpo, status = 200) => new Response(cuerpo === null ? null : JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = vi.fn(async (url, init = {}) => {
  const u = String(url);
  if (u.includes("/auth/v1/user")) return json({ email: "diego@ejemplo.pe" });
  if (u.includes("/rest/v1/rpc/mi_segundo_factor")) return json({ exigido: false, verificado: true });
  if (u.includes("/rest/v1/v_mi_acceso")) return json([{ esSuperadmin: true, matriz: {} }]);
  if (u.includes("/rest/v1/personas")) return json([{ dni: "12345678", nombre: "ANA PRUEBA", correo: "ana@ejemplo.pe" }]);
  if (u.includes("/auth/v1/admin/users") && (init.method ?? "GET") === "POST") return json({ id: "u1" });
  if (u.includes("/rest/v1/cuentas_portal")) return json(null, 201);
  if (u.includes("/rest/v1/correo_envios")) { rastro.push(JSON.parse(init.body)); return json(null, 201); }
  throw new Error(`ruta no simulada: ${u}`);
});
beforeEach(() => { rastro.length = 0; motor.falla = false; });
const llamar = async (cuerpo) => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
  await handler({ method: "POST", body: cuerpo, headers: { "x-sesion": "jwt", "x-forwarded-for": "190.1.2.3" }, socket: {} }, res);
  return { status: res.status.mock.calls[0][0], json: res.json.mock.calls[0][0] };
};

describe("rastro del correo de acceso", () => {
  it("crear con correo → 200, enviado y una fila acceso-portal «enviado» sin ip ni sujeto", async () => {
    const r = await llamar({ accion: "crear", dni: "12345678", enviarCorreo: true });
    expect(r.status).toBe(200);
    expect(r.json.enviado).toBe("ana@ejemplo.pe");
    expect(rastro).toEqual([{ accion: "acceso-portal", ip: null, sujeto: null, destinatario: "ana@ejemplo.pe", resultado: "enviado", detalle: null }]);
  });
  it("si el proveedor falla: la cuenta igual se crea, viaja errorCorreo y la fila dice «error» con el detalle", async () => {
    motor.falla = true;
    const r = await llamar({ accion: "crear", dni: "12345678", enviarCorreo: true });
    expect(r.status).toBe(200);
    expect(r.json.clave).toMatch(/^\d{6}$/);
    expect(r.json.errorCorreo).toMatch(/429/);
    expect(rastro[0]).toMatchObject({ accion: "acceso-portal", resultado: "error", detalle: expect.stringMatching(/429/) });
  });
  it("sin enviarCorreo no hay envío ni rastro", async () => {
    await llamar({ accion: "crear", dni: "12345678" });
    expect(rastro).toEqual([]);
  });
});
```

- [ ] **Step 2: Prueba de admin-usuarios (falla)**

Añadir a `tests/api/admin-usuarios.test.js`: en el `fetch` simulado, antes del `throw`, las rutas `if (u.includes("/rest/v1/correo_envios")) { rastro.push(JSON.parse(init.body)); return json(null, 201); }`, `if (u.includes("/rest/v1/rpc/api_admin_marcar_clave")) return json(null);` y, para el camino de clave provisional, `/auth/v1/invite` → `json({ msg: "smtp" }, 500)` y `POST /auth/v1/admin/users` → `json({ id: "u9" })`. Declarar `const rastro = [];` junto a `llamadas` y vaciarlo en `beforeEach`. Nueva prueba:

```js
describe("rastro del correo de acceso", () => {
  it("crear con invitación caída → clave provisional por correo y fila acceso-admin «enviado» sin ip ni sujeto", async () => {
    const r = await llamar({ accion: "crear", usuario_id: 7 });
    expect(r.status).toBe(200);
    expect(r.json.enviadoCorreo).toBe("x@ejemplo.pe");
    expect(rastro).toEqual([{ accion: "acceso-admin", ip: null, sujeto: null, destinatario: "x@ejemplo.pe", resultado: "enviado", detalle: null }]);
  });
});
```

(Si la simulación de `api_admin_por_id` no basta para llegar al alta, ajustar las rutas simuladas leyendo `api/admin-usuarios.js:60-118`; la expectativa no cambia.)

- [ ] **Step 3: Correr y ver que fallan**

Run: `npx vitest run tests/api/portal-cuentas.test.js tests/api/admin-usuarios.test.js`
Expected: fallan por `rastro` vacío.

- [ ] **Step 4: Implementar el rastro**

`api/portal-cuentas.js`: añadir `import { registrar } from "./enviar-correo.js";` y reescribir `correoAcceso`:

```js
// Correo de acceso: solo lo manda este endpoint (nadie más conoce la clave).
// Deja rastro en correo_envios SIN ip ni sujeto (2026-09-30): el límite de
// tasa cuenta por ip/sujeto sin distinguir acción y una creación masiva desde
// la oficina bloquearía una hora las demás acciones. Solo informa.
async function correoAcceso(persona, dni, clave) {
  const r = await enviar(persona.correo, "Tu acceso al Portal del Trabajador — GrupoER", plantilla(
    "Tu acceso al Portal del Trabajador",
    `<p>Hola ${persona.nombre.split(" ")[0]}: ya puedes entrar al portal.</p>
     <p><b>Dirección:</b> <a href="${APP}/portal">${APP}/portal</a><br/>
        <b>Usuario:</b> tu número de documento (${dni})<br/>
        <b>Clave inicial:</b> ${clave}</p>
     <p>En tu primer ingreso el portal te pedirá crear tu clave personal.</p>`));
  await registrar({ accion: "acceso-portal", ip: null, sujeto: null, destinatario: persona.correo, resultado: r.error ? "error" : "enviado", detalle: r.error ?? null });
  return r.error ? { errorCorreo: r.error } : { enviado: persona.correo };
}
```

`api/admin-usuarios.js`: `import { registrar } from "./enviar-correo.js";` y en `enviarAccesoAdmin`, antes del `return`:
```js
  await registrar({ accion: "acceso-admin", ip: null, sujeto: null, destinatario: correo, resultado: r.error ? "error" : "enviado", detalle: r.error ?? null });
```

Comprobar que `api/enviar-correo.js` no importa nada de `admin-usuarios.js` ni `portal-cuentas.js` (no hay ciclo; `segundo-factor.js` ya importa de la misma forma).

- [ ] **Step 5: Correr toda la suite**

Run: `npm test`
Expected: verde.

- [ ] **Step 6: Commit**

```bash
printf 'correo(api): los correos de acceso al portal y al BackOffice dejan rastro en correo_envios\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>\n' > "$TEMP/msg.txt"
git add api/portal-cuentas.js api/admin-usuarios.js tests/api/portal-cuentas.test.js tests/api/admin-usuarios.test.js
git commit -F "$TEMP/msg.txt"
```

---

### Task 3: Helper del cliente para el aviso

**Files:**
- Create: `src/lib/correoFallos.js`
- Create: `tests/correoFallos.test.js`

**Interfaces:**
- Produces: `etiquetaAccion(accion) → string`, `resumenFallos(filas) → string | null`, `formatearHora(iso) → "dd/mm hh:mm"`.

- [ ] **Step 1: Pruebas (fallan)**

```js
// tests/correoFallos.test.js — Aviso de correos fallidos (superadmin).
import { describe, it, expect } from "vitest";
import { etiquetaAccion, resumenFallos, formatearHora } from "../src/lib/correoFallos.js";

describe("etiquetaAccion", () => {
  it("traduce las acciones conocidas y deja la desconocida tal cual", () => {
    expect(etiquetaAccion("segundo-factor")).toBe("Código de ingreso");
    expect(etiquetaAccion("acceso-portal")).toBe("Acceso al portal");
    expect(etiquetaAccion("acceso-admin")).toBe("Acceso al BackOffice");
    expect(etiquetaAccion("recuperacion-admin")).toBe("Recuperación de clave (BackOffice)");
    expect(etiquetaAccion("rara")).toBe("rara");
  });
});
describe("resumenFallos", () => {
  it("null sin filas; singular y plural", () => {
    expect(resumenFallos([])).toBeNull();
    expect(resumenFallos([{}])).toBe("1 correo no se pudo enviar en las últimas 24 horas");
    expect(resumenFallos([{}, {}, {}])).toBe("3 correos no se pudieron enviar en las últimas 24 horas");
  });
});
describe("formatearHora", () => {
  it("día/mes y hora local con dos dígitos", () => {
    const iso = new Date(2026, 8, 30, 14, 7).toISOString();
    expect(formatearHora(iso)).toBe("30/09 14:07");
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run tests/correoFallos.test.js` — Expected: «Failed to resolve import».

- [ ] **Step 3: Implementar**

```js
// src/lib/correoFallos.js — Textos del aviso de correos fallidos que ven los
// superadministradores (2026-09-30). Las acciones son las de correo_envios.
const ETIQUETAS = {
  "segundo-factor": "Código de ingreso",
  "acceso-portal": "Acceso al portal",
  "acceso-admin": "Acceso al BackOffice",
  verificacion: "Verificación de correo",
  recuperacion: "Recuperación de clave (portal)",
  "recuperacion-admin": "Recuperación de clave (BackOffice)",
  "aviso-ticket": "Aviso de ticket",
  "aviso-solicitud": "Aviso de solicitud",
  "recordatorio-acuse": "Recordatorio de acuse",
};
export const etiquetaAccion = (accion) => ETIQUETAS[accion] ?? accion;

export const resumenFallos = (filas) => {
  const n = filas?.length ?? 0;
  if (!n) return null;
  return n === 1 ? "1 correo no se pudo enviar en las últimas 24 horas" : `${n} correos no se pudieron enviar en las últimas 24 horas`;
};

const dd = (x) => String(x).padStart(2, "0");
export const formatearHora = (iso) => {
  const f = new Date(iso);
  return `${dd(f.getDate())}/${dd(f.getMonth() + 1)} ${dd(f.getHours())}:${dd(f.getMinutes())}`;
};
```

- [ ] **Step 4: Correr** — `npx vitest run tests/correoFallos.test.js` → verde.

- [ ] **Step 5: Commit**

```bash
printf 'backoffice(correo): helper de textos del aviso de correos fallidos\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>\n' > "$TEMP/msg.txt"
git add src/lib/correoFallos.js tests/correoFallos.test.js && git commit -F "$TEMP/msg.txt"
```

---

### Task 4: Función SQL `correo_fallos_recientes()` con generador, ensayo e invariante

**Files:**
- Create: `supabase/correo.sql`
- Create: `scripts/correo-generar.mjs`
- Generate: `supabase/migraciones/2026-09-30-correo-fallos.sql`, `supabase/respaldos/2026-09-30-correo-fallos-reversion.sql`, bloque `@@CORREO@@` en `supabase/seguridad.sql`
- Create: `scripts/ensayar-correo.mjs`
- Modify: `scripts/ensayar-canon.mjs` (invariante nueva tras la de `corregir_fecha_ingreso`)
- Modify: `supabase/MODELO.md` (sección Seguridad: párrafo del bloque)

**Interfaces:**
- Produces: `public.correo_fallos_recientes() returns table (id bigint, creado_en timestamptz, accion text, destinatario text, detalle text)`; `sinCorreo(texto)` exportada por `scripts/correo-generar.mjs`.

- [ ] **Step 1: Canónico**

```sql
-- ============================================================================
-- CORREO — aviso de envíos fallidos para superadministradores (2026-09-30)
-- correo_envios sigue cerrada a la API (sin política, sin privilegios para
-- authenticated/anon): esta función definer es el ÚNICO camino de lectura y
-- solo la ejecuta un superadministrador con el segundo factor verificado
-- (requiere_superadmin → es_superadmin → nivel_en → fn_nivel_modulo v4).
-- Vive como bloque @@CORREO@@ al final de seguridad.sql (scripts/correo-generar.mjs),
-- NO en CANONICOS de pg-local (los ensayos de fases previas lo recortan).
-- Spec: docs/superpowers/specs/2026-09-30-motor-correo-resend-design.md
-- ============================================================================
create or replace function correo_fallos_recientes()
returns table (id bigint, creado_en timestamptz, accion text, destinatario text, detalle text)
language plpgsql stable security definer set search_path = public, interno, extensions as $$
begin
  perform requiere_superadmin();
  return query
    select e.id, e.creado_en, e.accion, e.destinatario, e.detalle
    from correo_envios e
    where e.resultado = 'error' and e.creado_en >= now() - interval '24 hours'
    order by e.creado_en desc
    limit 100;
end $$;
comment on function correo_fallos_recientes() is 'Envíos de correo con error en las últimas 24 h; solo superadministradores (aviso del BackOffice).';
revoke all on function correo_fallos_recientes() from public, anon;
grant execute on function correo_fallos_recientes() to authenticated;
```

- [ ] **Step 2: Generador (copia de `scripts/licencias-generar.mjs` con nombres nuevos)**

```js
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
```

Run: `node scripts/correo-generar.mjs`. Comprobar con `git diff supabase/seguridad.sql` que solo se añadió el bloque al final.

- [ ] **Step 3: Ensayo local (receta de `ensayar-factor.mjs`: seguridad sin el bloque + datos anonimizados → migración → reglas → reversión → reaplicar)**

```js
// scripts/ensayar-correo.mjs — Ensayo LOCAL de correo_fallos_recientes() sobre el
// entorno 2.5 (seguridad hasta LICENCIAS + datos anonimizados). Uso: node scripts/ensayar-correo.mjs
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { arrancarPgLocal, cargarDatosAnonimizados } from "./pg-local.mjs";
import { FECHA, sinCorreo } from "./correo-generar.mjs";

const MIGRACION = readFileSync(`supabase/migraciones/${FECHA}-correo-fallos.sql`, "utf8");
const REVERSION = readFileSync(`supabase/respaldos/${FECHA}-correo-fallos-reversion.sql`, "utf8");
const SEGURIDAD_PREVIA = sinCorreo(readFileSync("supabase/seguridad.sql", "utf8"));

let fallos = 0, ok = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); await cliente.query("rollback").catch(() => {}); }
};
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const bd = await arrancarPgLocal({ seguridad: false, datos: false });
const { sql, cliente } = bd;
await sql(SEGURIDAD_PREVIA);
// Volcado anterior a la fase 6: mismo ajuste del piso de clave que ensayar-factor.
await sql("alter table interno.politica_acceso drop constraint if exists chk_clave_min_backoffice");
await cargarDatosAnonimizados(sql);
await sql("update interno.politica_acceso set clave_longitud_min_backoffice = 10 where id = 1 and clave_longitud_min_backoffice < 10");
await sql("alter table interno.politica_acceso add constraint chk_clave_min_backoffice check (clave_longitud_min_backoffice >= 10)");
await sql("set search_path = public, interno, extensions");

const como = async (rol, claims, texto) => {
  await cliente.query("begin");
  try {
    await cliente.query(`set local role ${rol}`);
    await cliente.query(`select set_config('request.jwt.claims', $1, true)`, [claims === null ? "" : JSON.stringify(claims)]);
    const r = await cliente.query(texto);
    return { filas: r.rows };
  } catch (e) { return { codigo: e.code, mensaje: e.message }; }
  finally { await cliente.query("rollback"); }
};
const [SUPER] = await sql(`select ua.correo, au.id as sub from usuarios_admin ua join auth.users au on lower(au.email) = lower(ua.correo)
  join perfiles p on p.id = ua.perfil_id and p.version = ua.perfil_version where ua.estado = 'activo' and p.es_superadmin order by ua.id limit 1`);
const [NO_SUPER] = await sql(`select ua.correo, au.id as sub from usuarios_admin ua join auth.users au on lower(au.email) = lower(ua.correo)
  join perfiles p on p.id = ua.perfil_id and p.version = ua.perfil_version where ua.estado = 'activo' and not p.es_superadmin order by ua.id limit 1`);
const claims = (u, session_id) => ({ role: "authenticated", email: u.correo, sub: u.sub, ...(session_id ? { session_id } : {}) });
const catalogo = async () => (await sql(`select to_regprocedure('public.correo_fallos_recientes()') is not null as existe,
  has_function_privilege('authenticated', 'public.correo_fallos_recientes()', 'execute') as auth,
  has_function_privilege('anon', 'public.correo_fallos_recientes()', 'execute') as anon,
  has_table_privilege('authenticated', 'public.correo_envios', 'select') as tabla`))[0];

try {
  console.log("== 0 · antes de la migración");
  await prueba("la función no existe; correo_envios cerrada a authenticated", async () => {
    const c = await catalogo(); igual(`${c.existe}/${c.tabla}`, "false/false", "estado previo");
  });

  console.log("\n== 1 · migración");
  await prueba("aplica en una transacción (verificación embebida incluida)", async () => { await sql(MIGRACION); });
  await prueba("catálogo: definer, EXECUTE solo authenticated (no anon), tabla sigue cerrada", async () => {
    const c = await catalogo(); igual(`${c.existe}/${c.auth}/${c.anon}/${c.tabla}`, "true/true/false/false", "catálogo");
  });

  console.log("\n== 2 · reglas");
  await sql(`insert into correo_envios (creado_en, accion, ip, sujeto, destinatario, resultado, detalle) values
    (now() - interval '1 hour', 'segundo-factor', '203.0.113.1', 'zz@ejemplo.invalido', 'zz@ejemplo.invalido', 'error', 'El proveedor de correo respondió 400: API key is invalid'),
    (now() - interval '2 hours', 'acceso-portal', null, null, 'zz2@ejemplo.invalido', 'error', 'El proveedor de correo respondió 429: rate limit'),
    (now() - interval '25 hours', 'acceso-admin', null, null, 'viejo@ejemplo.invalido', 'error', 'antiguo'),
    (now() - interval '10 minutes', 'segundo-factor', '203.0.113.1', 'zz@ejemplo.invalido', 'zz@ejemplo.invalido', 'enviado', null),
    (now() - interval '10 minutes', 'recuperacion', '203.0.113.1', '12345678', null, 'limitado', 'ip=30')`);
  await sql("update interno.politica_acceso set factor_superadmin = false where id = 1");
  await prueba("superadmin (factor apagado): ve los 2 errores de 24 h, el más reciente primero; no ve el antiguo ni enviado/limitado", async () => {
    const r = await como("authenticated", claims(SUPER), "select accion, destinatario, detalle from correo_fallos_recientes()");
    if (r.codigo) throw new Error(`${r.codigo} ${r.mensaje}`);
    igual(r.filas.map((f) => `${f.accion}:${f.destinatario}`).join("|"), "segundo-factor:zz@ejemplo.invalido|acceso-portal:zz2@ejemplo.invalido", "filas");
    igual(/API key is invalid/.test(r.filas[0].detalle), true, "detalle");
  });
  await sql("update interno.politica_acceso set factor_superadmin = true where id = 1");
  await prueba("superadmin con el segundo factor pendiente (session_id sin marca) → 42501", async () => {
    const r = await como("authenticated", claims(SUPER, randomUUID()), "select * from correo_fallos_recientes()");
    igual(r.codigo, "42501", "pendiente");
  });
  await prueba("administrador no superadmin → 42501; authenticated sin claims → 42501; anon → 42501 (sin EXECUTE)", async () => {
    if (NO_SUPER) igual((await como("authenticated", claims(NO_SUPER), "select * from correo_fallos_recientes()")).codigo, "42501", "no superadmin");
    igual((await como("authenticated", null, "select * from correo_fallos_recientes()")).codigo, "42501", "sin claims");
    igual((await como("anon", { role: "anon" }, "select * from correo_fallos_recientes()")).codigo, "42501", "anon");
  });
  await prueba("nadie de la API lee correo_envios directo", async () => {
    igual((await como("authenticated", claims(SUPER), "select count(*) from correo_envios")).codigo, "42501", "tabla");
  });

  console.log("\n== 3 · reversión y reaplicación");
  await prueba("la reversión quita la función y deja la tabla cerrada; la migración se reaplica", async () => {
    await sql(REVERSION);
    let c = await catalogo(); igual(`${c.existe}/${c.tabla}`, "false/false", "tras reversión");
    await sql(MIGRACION);
    c = await catalogo(); igual(`${c.existe}/${c.auth}/${c.anon}`, "true/true/false", "reaplicada");
  });
} finally {
  await bd.parar();
}
console.log(`\n${ok} ok · ${fallos} fallo(s)`);
process.exit(fallos ? 1 : 0);
```

Run: `node scripts/ensayar-correo.mjs` — Expected: 8 ok · 0 fallos. Si `cargarDatosAnonimizados` reclama que falta `supabase/pruebas/datos-anonimizados.sql`, regenerarlo primero: `node scripts/entorno-pruebas.mjs extraer` (lo corre Diego con `!` si el clasificador lo bloquea).

- [ ] **Step 4: Invariante en `scripts/ensayar-canon.mjs`** (después de la prueba de `corregir_fecha_ingreso`):

```js
  await prueba("correo_fallos_recientes (2026-09-30): definer, EXECUTE solo authenticated, guarda requiere_superadmin; correo_envios sigue cerrada", async () => {
    const [g] = await sql(`select p.prosecdef as def,
      has_function_privilege('authenticated', 'public.correo_fallos_recientes()', 'execute') as auth,
      has_function_privilege('anon', 'public.correo_fallos_recientes()', 'execute') as anon,
      (p.prosrc ~ 'perform requiere_superadmin\\(\\)') as guarda,
      has_table_privilege('authenticated', 'public.correo_envios', 'select') as tabla
      from pg_proc p where p.oid = 'public.correo_fallos_recientes()'::regprocedure`);
    igual(`${g.def}/${g.auth}/${g.anon}/${g.guarda}/${g.tabla}`, "true/true/false/true/false", "correo");
  });
```

Run: `node scripts/ensayar-canon.mjs` → todas verdes (ahora 23). También `node scripts/ensayar-licencias.mjs` y `node scripts/ensayar-factor.mjs` deben seguir verdes (el bloque nuevo va al final y no cambia precondiciones; si `ensayar-fase4` recorta bloques con `sinLicencias`, añadir `sinCorreo` en la misma cadena y correrlo).

- [ ] **Step 5: MODELO.md** — en la sección Seguridad, tras el párrafo de Licencias Office, añadir:

> **Correo (2026-09-30).** `correo_envios` es el rastro del motor de correo (solo `service_role`). `correo_fallos_recientes()` (bloque `@@CORREO@@`, canónico `supabase/correo.sql`) devuelve los envíos con error de las últimas 24 h y es el único camino de lectura para la API: definer con `requiere_superadmin()`. Alimenta la franja de aviso del BackOffice.

- [ ] **Step 6: Commit**

```bash
printf 'correo(sql): correo_fallos_recientes con guarda superadmin, bloque @@CORREO@@, migracion, reversion y ensayo\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>\n' > "$TEMP/msg.txt"
git add supabase/correo.sql supabase/seguridad.sql supabase/migraciones/2026-09-30-correo-fallos.sql supabase/respaldos/2026-09-30-correo-fallos-reversion.sql scripts/correo-generar.mjs scripts/ensayar-correo.mjs scripts/ensayar-canon.mjs supabase/MODELO.md
git commit -F "$TEMP/msg.txt"
```

---

### Task 5: Franja y modal en el BackOffice

**Files:**
- Modify: `src/state.jsx` (estado `correoFallos`, carga tras el factor, acción `recargarCorreoFallos`, contexto)
- Create: `src/layout/AvisoCorreo.jsx`
- Modify: `src/layout/Shell.jsx:139` y `:231-242`

**Interfaces:**
- Consumes: `supabase.rpc("correo_fallos_recientes")` → filas `{ id, creado_en, accion, destinatario, detalle }`; helpers de Task 3.
- Produces en `useApp()`: `correoFallos: Array`, `recargarCorreoFallos: () => Promise<void>`.

- [ ] **Step 1: Estado y carga en `src/state.jsx`**

Junto a `const [origen, setOrigen]` (línea ~161):
```jsx
  // Aviso de correos fallidos (2026-09-30): solo superadministradores, cargado
  // DESPUÉS del segundo factor (pendiente daría 42501). Un error deja la lista
  // vacía: la franja jamás bloquea la carga.
  const [correoFallos, setCorreoFallos] = useState([]);
  const cargarCorreoFallos = async (esSuperadmin) => {
    if (!conSupabase || !esSuperadmin) { setCorreoFallos([]); return; }
    const { data, error } = await supabase.rpc("correo_fallos_recientes");
    setCorreoFallos(error || !Array.isArray(data) ? [] : data);
  };
```

En `resolver`, después de `await recargar();` y su guarda `if (!activo || mia !== generacion) return;` (líneas ~265-266) y antes de `setUser(base)`:
```jsx
      await cargarCorreoFallos(base.acceso.esSuperadmin);
      if (!activo || mia !== generacion) return;
```

En `salir`, junto a `setDb(dbVacia(FUENTES))`: `setCorreoFallos([]);`.

En el `value` del contexto (línea ~1089) añadir `correoFallos, recargarCorreoFallos: () => cargarCorreoFallos(Boolean(user?.acceso?.esSuperadmin)),`.

- [ ] **Step 2: Componente `src/layout/AvisoCorreo.jsx`**

```jsx
import { useState } from "react";
import { MailWarning } from "lucide-react";
import { useApp } from "../state";
import { Modal, Table, Td, Button } from "../components/ui";
import { etiquetaAccion, resumenFallos, formatearHora } from "../lib/correoFallos";

// Franja para superadministradores (2026-09-30): envíos de correo con error en
// las últimas 24 h (correo_fallos_recientes). Desaparece sola cuando no hay
// fallos recientes; no hay «marcar como visto».
export default function AvisoCorreo() {
  const { correoFallos, recargarCorreoFallos } = useApp();
  const [abierto, setAbierto] = useState(false);
  const [actualizando, setActualizando] = useState(false);
  const resumen = resumenFallos(correoFallos);
  if (!resumen) return null;
  const actualizar = async () => { setActualizando(true); await recargarCorreoFallos(); setActualizando(false); };
  return (
    <>
      <div role="alert" className="flex items-center gap-3 border-b border-borde-f bg-[#fff8ee] px-5 py-2 text-[13px] text-tinta">
        <MailWarning size={15} className="text-pend" />
        <span>{resumen}.</span>
        <button type="button" onClick={() => setAbierto(true)} className="rounded-caja border border-borde-f bg-white px-2.5 py-1 font-semibold text-petroleo hover:bg-[#f3f7fb]">
          Ver detalle
        </button>
      </div>
      <Modal open={abierto} onClose={() => setAbierto(false)} title="Correos que no se pudieron enviar" wide>
        <p className="mb-3 text-[13px] text-gris">
          Últimas 24 horas. El error es la respuesta literal del proveedor (Resend); revisa la llave y el dominio en resend.com si se repite.
        </p>
        <Table head={["Hora", "Tipo de correo", "Destinatario", "Error"]}>
          {correoFallos.map((f) => (
            <tr key={f.id}>
              <Td className="font-mono text-[12px]">{formatearHora(f.creado_en)}</Td>
              <Td>{etiquetaAccion(f.accion)}</Td>
              <Td>{f.destinatario ?? "—"}</Td>
              <Td className="text-[12px] text-gris">{f.detalle ?? "—"}</Td>
            </tr>
          ))}
        </Table>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={actualizar} disabled={actualizando}>{actualizando ? "Actualizando…" : "Actualizar"}</Button>
          <Button onClick={() => setAbierto(false)}>Cerrar</Button>
        </div>
      </Modal>
    </>
  );
}
```

(Confirmar en `src/components/ui.jsx:60` el nombre de la variante secundaria del `Button` y en `:107` la firma de `Table`; ajustar si difieren.)

- [ ] **Step 3: Shell** — `import AvisoCorreo from "./AvisoCorreo";` y, justo después del bloque `{origen === "error" && (…)}` (línea 242), `<AvisoCorreo />`.

- [ ] **Step 4: Compilar y probar a mano en dev**

Run: `npx vite build` → sin errores. Luego `npm run dev` con `VITE_CANAL_DIRECTO=0` no aplica (dev habla directo): entrar como superadmin; sin la migración aplicada en prod la RPC no existe → la franja no aparece y la consola no muestra error no controlado (la acción devuelve `error` y se ignora). Comprobar que `npm test` sigue verde.

- [ ] **Step 5: Commit**

```bash
printf 'backoffice(correo): franja y detalle de correos fallidos para superadministradores\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>\n' > "$TEMP/msg.txt"
git add src/state.jsx src/layout/AvisoCorreo.jsx src/layout/Shell.jsx && git commit -F "$TEMP/msg.txt"
```

---

### Task 6: Supabase Auth por el SMTP de Resend

**Files:**
- Create: `supabase/plantillas-correo/invitacion.html`, `supabase/plantillas-correo/recuperacion.html`
- Create: `scripts/configurar-correo-auth.mjs`

**Interfaces:**
- Consumes: Management API `GET/PATCH /v1/projects/mzpbdkrmokfxrrsotfgs/config/auth` (token en `SUPABASE_ACCESS_TOKEN`), llave de Resend por stdin.

- [ ] **Step 1: Plantillas (Go templates de GoTrue; solo `{{ .ConfirmationURL }}`)**

`supabase/plantillas-correo/invitacion.html`:
```html
<div style="font-family:Poppins,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#333">
  <h2 style="color:#3569a0;margin-bottom:4px">GrupoER</h2>
  <h3 style="margin-top:0">Tu acceso al BackOffice</h3>
  <p>Te crearon una cuenta en el BackOffice de GrupoER. Entra con el botón y elige tu clave personal (mínimo 10 caracteres, con letras y números).</p>
  <p><a href="{{ .ConfirmationURL }}" style="background:#3569a0;color:#fff;padding:10px 22px;border-radius:10px;text-decoration:none">Crear mi clave</a></p>
  <p style="font-size:12px;color:#999;margin-top:28px">Si no esperabas este correo, ignóralo: nada cambia sin tu acción.</p>
</div>
```

`supabase/plantillas-correo/recuperacion.html`: mismo marco con título «Crea una clave nueva», texto «Pediste restablecer tu clave del BackOffice. El enlace sirve una sola vez y vence en una hora.» y botón «Crear clave nueva».

- [ ] **Step 2: Script**

```js
// scripts/configurar-correo-auth.mjs — Supabase Auth envía por el SMTP de Resend
// (2026-09-30): invitaciones y recuperaciones del BackOffice salen en español,
// desde el mismo remitente del motor propio y sin el tope nativo de 2-4/hora.
// La llave («supabase-auth», Sending access, dominio avisos.servicios-intranet.net)
// entra por STDIN y jamás se imprime. Lo corre DIEGO con `!`:
//   export SUPABASE_ACCESS_TOKEN=$(powershell -NoProfile -Command '. .\scripts\token-supabase.ps1 *>$null; $env:SUPABASE_ACCESS_TOKEN' | tail -n 1 | tr -d "\r\n")
//   powershell -NoProfile -Command Get-Clipboard | tr -d '\r\n' | node scripts/configurar-correo-auth.mjs
import { readFileSync } from "node:fs";

const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const REMITENTE = "no-responder@avisos.servicios-intranet.net";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
const llave = readFileSync(0, "utf8").replace(/^[﻿\s]+|[\s]+$/g, "");
if (!/^re_[A-Za-z0-9_]{20,}$/.test(llave)) { console.error("La entrada no parece una llave de Resend (re_…)."); process.exit(1); }

const base = `https://api.supabase.com/v1/projects/${PROYECTO}/config/auth`;
const cab = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const deseado = {
  smtp_host: "smtp.resend.com", smtp_port: "465", smtp_user: "resend", smtp_pass: llave,
  smtp_admin_email: REMITENTE, smtp_sender_name: "GrupoER", smtp_max_frequency: 60,
  rate_limit_email_sent: 30,
  mailer_subjects_invite: "Tu acceso al BackOffice — GrupoER",
  mailer_templates_invite_content: readFileSync("supabase/plantillas-correo/invitacion.html", "utf8"),
  mailer_subjects_recovery: "Crea una clave nueva — BackOffice GrupoER",
  mailer_templates_recovery_content: readFileSync("supabase/plantillas-correo/recuperacion.html", "utf8"),
};
const patch = await fetch(base, { method: "PATCH", headers: cab, body: JSON.stringify(deseado) });
if (!patch.ok) { console.error(`PATCH HTTP ${patch.status}: ${(await patch.text()).replace(llave, "[llave]").slice(0, 300)}`); process.exit(1); }

const cfg = await (await fetch(base, { headers: cab })).json();
const esperado = { smtp_host: "smtp.resend.com", smtp_port: "465", smtp_user: "resend", smtp_admin_email: REMITENTE, smtp_sender_name: "GrupoER",
  mailer_subjects_invite: deseado.mailer_subjects_invite, mailer_subjects_recovery: deseado.mailer_subjects_recovery };
const malas = Object.entries(esperado).filter(([k, v]) => String(cfg[k]) !== String(v)).map(([k]) => k);
console.log(`smtp_host: ${cfg.smtp_host} · smtp_user: ${cfg.smtp_user} · remitente: ${cfg.smtp_sender_name} <${cfg.smtp_admin_email}> · rate_limit_email_sent: ${cfg.rate_limit_email_sent}`);
console.log(`plantillas: invitación ${cfg.mailer_templates_invite_content?.includes("Crear mi clave") ? "ok" : "NO"} · recuperación ${cfg.mailer_templates_recovery_content?.includes("Crear clave nueva") ? "ok" : "NO"}`);
if (malas.length) { console.error(`No quedó como se esperaba: ${malas.join(", ")}`); process.exit(1); }
console.log("Config de correo de Auth verificada.");
```

- [ ] **Step 3: Prueba en seco de sintaxis** — `node --check scripts/configurar-correo-auth.mjs`; y sin token: `node scripts/configurar-correo-auth.mjs < /dev/null` → «Falta SUPABASE_ACCESS_TOKEN.» con código 1.

- [ ] **Step 4: Commit**

```bash
printf 'auth(correo): script de SMTP de Resend para Supabase Auth con plantillas en espanol\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>\n' > "$TEMP/msg.txt"
git add supabase/plantillas-correo scripts/configurar-correo-auth.mjs && git commit -F "$TEMP/msg.txt"
```

---

### Task 7: Verificador de producción y documentación

**Files:**
- Create: `scripts/verificar-correo.mjs`
- Create: `docs/seguridad/2026-09-30-motor-correo-resend.md`
- Modify: `docs/seguridad/README.md` (índice: entrada nueva), `docs/checklists/2026-08-21-flujos-e2e.md` (menciones a Gmail → Resend)

- [ ] **Step 1: Verificador**

```js
// scripts/verificar-correo.mjs — Verificación en PRODUCCIÓN del motor de correo en
// Resend (2026-09-30): catálogo de correo_fallos_recientes, rastro reciente de
// correo_envios, configuración SMTP de Auth y variables de Vercel (solo nombres).
// Solo lecturas. Lo corre Diego con `!` (token: scripts/token-supabase.ps1).
import { spawnSync } from "node:child_process";
const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
let fallos = 0;
const prueba = async (n, fn) => { try { await fn(); console.log(`✓ ${n}`); } catch (e) { fallos++; console.error(`✗ ${n}: ${e.message}`); } };
const igual = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
const api = async (ruta, init) => { const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}${ruta}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }); const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`); return JSON.parse(t); };
const sql = (q) => api("/database/query", { method: "POST", body: JSON.stringify({ query: q }) });

console.log("== Base");
await prueba("correo_fallos_recientes: definer con search_path, EXECUTE solo authenticated, guarda requiere_superadmin; correo_envios cerrada", async () => {
  const [g] = await sql(`select p.prosecdef as def, exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%') as sp,
    has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('anon', p.oid, 'execute') as anon,
    (p.prosrc ~ 'perform requiere_superadmin\\(\\)') as guarda, has_table_privilege('authenticated', 'public.correo_envios', 'select') as tabla
    from pg_proc p where p.oid = 'public.correo_fallos_recientes()'::regprocedure`);
  igual(`${g.def}/${g.sp}/${g.auth}/${g.anon}/${g.guarda}/${g.tabla}`, "true/true/true/false/true/false", "catálogo");
});
await prueba("rastro: últimos 10 envíos (informativo) y ningún error de Gmail (535) en las últimas 24 h", async () => {
  const filas = await sql(`select to_char(creado_en at time zone 'America/Lima', 'DD/MM HH24:MI') as hora, accion, resultado, left(detalle, 80) as detalle from correo_envios order by id desc limit 10`);
  for (const f of filas) console.log(`   ${f.hora}  ${f.accion.padEnd(18)} ${f.resultado.padEnd(9)} ${f.detalle ?? ""}`);
  const [{ n }] = await sql(`select count(*)::int as n from correo_envios where resultado = 'error' and detalle ~ '535|BadCredentials|SMTP' and creado_en >= now() - interval '24 hours'`);
  igual(n, 0, "errores de Gmail recientes");
});

console.log("\n== Supabase Auth");
await prueba("SMTP de Resend con el remitente del dominio y asuntos en español", async () => {
  const c = await api("/config/auth");
  igual(`${c.smtp_host}/${c.smtp_user}/${c.smtp_admin_email}/${c.smtp_sender_name}`, "smtp.resend.com/resend/no-responder@avisos.servicios-intranet.net/GrupoER", "smtp");
  igual(c.mailer_subjects_invite, "Tu acceso al BackOffice — GrupoER", "asunto invitación");
  igual(c.mailer_subjects_recovery, "Crea una clave nueva — BackOffice GrupoER", "asunto recuperación");
});

console.log("\n== Vercel (solo nombres de variables)");
await prueba("RESEND_API_KEY y CORREO_REMITENTE en Production y Preview; SMTP_USER/SMTP_PASS retiradas", async () => {
  const r = spawnSync("vercel", ["env", "ls"], { shell: true, encoding: "utf8" });
  const salida = `${r.stdout}\n${r.stderr}`;
  const tiene = (nombre, entorno) => new RegExp(`${nombre}\\s+\\S+\\s+\\S+\\s+[^\\n]*${entorno}`).test(salida);
  igual(`${tiene("RESEND_API_KEY", "Production")}/${tiene("RESEND_API_KEY", "Preview")}/${tiene("CORREO_REMITENTE", "Production")}`, "true/true/true", "resend");
  igual(/SMTP_USER|SMTP_PASS/.test(salida), false, "gmail sigue en Vercel");
});
console.log(fallos ? `\n${fallos} fallo(s).` : "\nTodo verde.");
process.exit(fallos ? 1 : 0);
```

(La prueba de Vercel fallará a propósito hasta el paso 6 del despliegue: es el recordatorio de retirar Gmail.)

- [ ] **Step 2: Informe `docs/seguridad/2026-09-30-motor-correo-resend.md`** con secciones: 1 Motivo (dos revocaciones de Gmail, incidente del 29-09), 2 Qué cambió (dominio y DNS, variables, `_correo.js`, rastro, función y franja, Auth por SMTP), 3 Operación (cómo cargar/rotar la llave por portapapeles, tope 100/día, plan Pro, contingencia `factor_superadmin=false`, cómo leer la franja), 4 Verificación (comandos: `ensayar-correo`, `ensayar-canon`, `verificar-correo`, `funciones-y-permisos` esperado 165), 5 Estado (se completa al cerrar el despliegue). Añadir la entrada al índice de `docs/seguridad/README.md` y reemplazar en `docs/checklists/2026-08-21-flujos-e2e.md` las menciones a Gmail/500 por «Resend, tope 100/día».

- [ ] **Step 3: Commit**

```bash
printf 'docs(correo): verificador de produccion e informe del motor de correo en Resend\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>\n' > "$TEMP/msg.txt"
git add scripts/verificar-correo.mjs docs/seguridad/2026-09-30-motor-correo-resend.md docs/seguridad/README.md docs/checklists/2026-08-21-flujos-e2e.md
git commit -F "$TEMP/msg.txt"
```

---

### Task 8: Despliegue (con Diego, en este orden)

**Files:** `docs/seguridad/2026-09-30-motor-correo-resend.md` §5, `docs/funciones-y-permisos.md`, memoria.

- [ ] **Step 1: Revisión final de la rama** — `npm test` (esperado ≥ 240 verdes), `npx vite build`, `node scripts/ensayar-canon.mjs`, `node scripts/ensayar-correo.mjs`, `git log --oneline origin/main..HEAD` (8 commits: spec + Tasks 1-7).

- [ ] **Step 2: Diego aplica la migración con `!`**

```
! export SUPABASE_ACCESS_TOKEN=$(powershell -NoProfile -Command '. .\scripts\token-supabase.ps1 *>$null; $env:SUPABASE_ACCESS_TOKEN' | tail -n 1 | tr -d "\r\n") && node scripts/aplicar-sql.mjs supabase/migraciones/2026-09-30-correo-fallos.sql
```
Expected: 201 (la verificación embebida no lanza).

- [ ] **Step 3: Push y CI** — `git push origin main`; Diego confirma `seguridad.yml` verde (jobs pruebas y despliegue) y deploy Ready.

- [ ] **Step 4: Verificar** — Diego corre `! … node scripts/verificar-correo.mjs` (todo verde salvo la prueba de Vercel, pendiente del paso 6) y entra al BackOffice: la franja aparece solo si hubo errores en 24 h (las filas 15-16 del 30-09 ya habrán vencido; para ver el detalle, desde Accesos → Usuarios crear una cuenta de prueba con un correo inválido tipo `zz@dominio-que-no-existe.invalido` → Resend responde error → franja; luego eliminar la cuenta).

- [ ] **Step 5: Auth por Resend** — Diego crea en Resend la llave «supabase-auth» (Sending access, dominio `avisos.servicios-intranet.net`), la copia y corre:
```
! export SUPABASE_ACCESS_TOKEN=$(powershell -NoProfile -Command '. .\scripts\token-supabase.ps1 *>$null; $env:SUPABASE_ACCESS_TOKEN' | tail -n 1 | tr -d "\r\n") && powershell -NoProfile -Command Get-Clipboard | tr -d '\r\n' | node scripts/configurar-correo-auth.mjs
```
Luego prueba «¿Olvidaste tu clave?» en `/admin/login` con su correo: llega en español desde `no-responder@avisos.servicios-intranet.net` y el enlace abre `/admin/restablecer`.

- [ ] **Step 6: Retirar Gmail** — Diego: `! vercel env rm SMTP_USER production -y && vercel env rm SMTP_PASS production -y && vercel redeploy https://intranet-general.vercel.app` (y `preview` si existieran; hoy solo Production). Revoca la contraseña de aplicación en myaccount.google.com/apppasswords. Re-correr `verificar-correo.mjs` → todo verde.

- [ ] **Step 7: Cierre** — `node scripts/funciones-y-permisos.mjs` (esperado 165 funciones, 0 sin guarda); completar §5 Estado del informe; commit `docs(correo): motor en Resend verificado en produccion; funciones-y-permisos regenerado (165)`; push; actualizar memoria (`proyecto-intranet-negliaf.md`): Resend cerrado, Gmail retirado, llaves, pendientes (plan Pro si hace falta, DMARC a quarantine, dominio de la intranet).

---

## Self-review

- **Cobertura de la spec:** 3.1 → Task 1; 3.2 → Task 2; 3.3 → Task 6 + despliegue paso 5; 3.4 → Tasks 3, 4, 5; 4 pruebas → Tasks 1-4, 7; 5 orden → Task 8; 6 riesgos → informe (Task 7). Sin huecos.
- **Consistencia de nombres:** `correo_fallos_recientes()` (SQL, state.jsx, ensayos, verificador, canon); acciones `acceso-portal`/`acceso-admin` (Task 2, etiquetas de Task 3, ensayo de Task 4); `registrar()` de `api/enviar-correo.js`; `sinCorreo` en `correo-generar.mjs`; `PAUSA_429_MS` exportada y usada en la prueba.
- **Sin placeholders:** cada paso trae el código o el comando; las dos comprobaciones abiertas (`Button variant`, rutas simuladas de admin-usuarios) indican dónde mirar y qué no cambia.
