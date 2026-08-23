# Cuentas de Portal en Masa (#13) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Botón general en Planilla (RRH-02) que detecta a los trabajadores vigentes sin cuenta de portal, crea sus cuentas en masa (usuario = documento, clave provisional aleatoria de 6 dígitos), envía el acceso por correo a quienes tienen correo registrado y entrega un CSV de claves para el resto.

**Architecture:** Se extiende el endpoint existente `api/portal-cuentas.js` (service key, ya valida nivel ≥2 en Personal y ya tiene una acción `crear-lote` sin uso): la clave fija `111111` pasa a ser **aleatoria de 6 dígitos en TODOS los caminos** (crear, restablecer, lote) y el propio endpoint envía el correo de acceso reutilizando `api/_correo.js` (así la clave jamás sale del servidor salvo en la respuesta al admin). `v_personal` gana la columna `tieneCuenta` (exists sobre `cuentas_portal`) para poder marcar en la UI quién no tiene cuenta. La pantalla Planilla suma un modal masivo con vista previa → progreso por lotes de 10 → resultado con descarga CSV.

**Tech Stack:** Vercel serverless (Node, `node:crypto`), Supabase (GoTrue admin + PostgREST), React (Personal.jsx), motor de correo ya activo (Gmail SMTP vía `api/_correo.js`).

## Global Constraints

- Decisiones de Diego (2026-08-21): usuario = DNI/documento, clave provisional **aleatoria de 6 dígitos** (sustituye a la fija `111111` del 2026-08-17), correo con el link del portal; para la planilla de ~1800.
- Tope Gmail ~500 correos/día: el modal masivo avisa cuando los envíos superan 400 y sugiere correr por partes.
- El documento puede ser DNI/CE/Pasaporte: el correo técnico va `lower(numero)@portal.grupoer.pe`; la verdad es el maestro (`personas`), no un regex.
- Migraciones: aplicar con `node scripts/aplicar-sql.mjs` (Management API); token con `scripts/token-supabase.ps1`. Sincronizar SIEMPRE el canónico (`supabase/portal.sql`).
- `v_personal` referencia `cuentas_portal` (vive en portal.sql) → la redefinición vive AL FINAL de `portal.sql` (mismo patrón que `v_comunicados`); `schema.sql` conserva la versión base con un comentario.
- Commits desde PowerShell 5.1 con here-strings **sin comillas dobles** en el mensaje.
- Env vars jamás desde PS5.1 (BOM); no se necesitan nuevas para este ciclo.
- Códigos de pantalla RRH-* intactos; textos de UI en español.
- Verificación E2E contra producción con `ADMIN_EMAIL`/`ADMIN_CLAVE` (patrón `verificar-portal.mjs`); datos de prueba con prefijo ZZ y limpieza al final.

---

### Task 1: Clave aleatoria + correo integrado en `api/portal-cuentas.js`

**Files:**
- Modify: `api/portal-cuentas.js`
- Modify: `vercel.json` (maxDuration para los envíos del lote)

**Interfaces:**
- Produces: acciones HTTP POST `{accion:"crear"|"restablecer", dni, enviarCorreo?}` → `{dni, nombre, clave, enviado?}|{dni, error}`; `{accion:"crear-lote", dnis:[…≤10], enviarCorreo?}` → `{resultados:[…]}`. `enviado` = correo destino cuando se envió; si el envío falla la cuenta IGUAL queda creada y viaja `errorCorreo`.

- [ ] **Step 1: Clave aleatoria y datos de la persona**

En `api/portal-cuentas.js`: importar y reemplazar la constante fija.

```js
import { randomInt } from "node:crypto";
import { enviar, plantilla } from "./_correo.js";

const APP = "https://intranet-general.vercel.app";
// Clave provisional aleatoria de 6 dígitos (decisión de Diego 2026-08-21, #13:
// ya hay canales para repartirla — correo o CSV en mano — así que la fija
// 111111 del 2026-08-17 se retira en TODOS los caminos).
const claveAleatoria = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
```

Eliminar `const CLAVE_INICIAL = "111111";` y actualizar el comentario de cabecera del archivo (ya no hay clave fija). En `crearCuenta`, pedir también nombre y correo: `select=dni,nombre,correo`.

- [ ] **Step 2: `crearCuenta(dni, creadoPor, conCorreo)` y `restablecerCuenta(dni, conCorreo)`**

Ambas usan `const clave = claveAleatoria();` y, tras el alta/cambio exitoso, si `conCorreo && persona.correo`:

```js
async function correoAcceso(persona, dni, clave) {
  const r = await enviar(persona.correo, "Tu acceso al Portal del Trabajador — GrupoER", plantilla(
    "Tu acceso al Portal del Trabajador",
    `<p>Hola ${persona.nombre.split(" ")[0]}: ya puedes entrar al portal.</p>
     <p><b>Dirección:</b> <a href="${APP}/portal">${APP}/portal</a><br/>
        <b>Usuario:</b> tu número de documento (${dni})<br/>
        <b>Clave inicial:</b> ${clave}</p>
     <p>En tu primer ingreso el portal te pedirá crear tu clave personal.</p>`));
  return r.error ? { errorCorreo: r.error } : { enviado: persona.correo };
}
```

Retorno de éxito: `{ dni, nombre: persona.nombre, clave, ...resultadoCorreo }` (la clave SIEMPRE vuelve al admin: es lo que va al CSV). `restablecerCuenta` necesita la persona (`select=dni,nombre,correo`) para el correo; si la persona no tiene correo y pidieron `enviarCorreo`, no es error: simplemente no viaja `enviado`.

- [ ] **Step 3: `crear-lote` con correo y tope 10**

```js
if (accion === "crear-lote") {
  if (!Array.isArray(dnis) || dnis.length === 0) return res.status(400).json({ error: "Falta la lista de dnis." });
  if (dnis.length > 10) return res.status(400).json({ error: "Máximo 10 por lote (el cliente envía por partes)." });
  const resultados = [];
  for (const d of dnis) resultados.push(await crearCuenta(String(d), autor, Boolean(cuerpo.enviarCorreo)));
  return res.status(200).json({ resultados });
}
```

Las acciones `crear`/`restablecer` pasan `Boolean(cuerpo.enviarCorreo)` como `conCorreo`.

- [ ] **Step 4: maxDuration en vercel.json**

10 envíos SMTP secuenciales pueden pasar de 10 s. Agregar al `vercel.json` (junto a `framework`):

```json
"functions": { "api/portal-cuentas.js": { "maxDuration": 60 } }
```

- [ ] **Step 5: Verificar sintaxis y commit**

Run: `node --check api/portal-cuentas.js`
Expected: sin salida (OK).

```powershell
git add api/portal-cuentas.js vercel.json
git commit -m @'
feat(portal): clave provisional aleatoria de 6 digitos y correo de acceso integrado en portal-cuentas
'@
```

---

### Task 2: Retirar la acción `credenciales` de `api/enviar-correo.js`

Con claves aleatorias, un correo de "acceso" sin cambiar la clave ya no puede decir la clave (la acción vieja decía `111111` en el cuerpo). El único camino pasa a ser `portal-cuentas` con `enviarCorreo` (que crea/restablece Y envía).

**Files:**
- Modify: `api/enviar-correo.js` (borrar el bloque `if (accion === "credenciales") {…}` completo y la constante `CLAVE_INICIAL` si queda sin uso)
- Modify: `src/state.jsx` (quitar `enviarAccesoPortal`; extender `cuentaPortal`)

**Interfaces:**
- Produces: `cuentaPortal(accion, dni, extras = {})` en el contexto de la app — los llamadores existentes (`accionCuenta` en Personal.jsx) siguen funcionando sin cambios.

- [ ] **Step 1: Borrar la acción `credenciales`** en `api/enviar-correo.js` (líneas del bloque completo) y su mención en el comentario de cabecera. Las acciones `verificacion`, `recuperacion`, `recuperacion-admin`, `aviso-ticket`, `aviso-solicitud` quedan intactas.

- [ ] **Step 2: `src/state.jsx`** — reemplazar:

```js
cuentaPortal: async (accion, dni, extras = {}) => {
  const r = await llamarServerless("/api/portal-cuentas", { accion, dni, ...extras });
  if (!r.error) await recargar("personal");
  return r;
},
// Lote masivo (RRH-02): el caller recarga al terminar todos los tramos.
cuentasPortalLote: async (dnis, enviarCorreo) =>
  llamarServerless("/api/portal-cuentas", { accion: "crear-lote", dnis, enviarCorreo }),
```

y eliminar `enviarAccesoPortal` (su único uso está en Personal.jsx, se rehace en Task 4).

- [ ] **Step 3: Verificar y commit**

Run: `node --check api/enviar-correo.js; npm run build`
Expected: build OK (el uso de `enviarAccesoPortal` en Personal.jsx se corrige en Task 4 — si el build falla solo por ese import, hacer el commit conjunto con Task 4).

```powershell
git add api/enviar-correo.js src/state.jsx
git commit -m @'
refactor(correo): la accion credenciales sale del motor; el acceso lo envia portal-cuentas
'@
```

---

### Task 3: `v_personal.tieneCuenta` (BD)

**Files:**
- Create: `supabase/migraciones/2026-08-22-cuentas-portal-masa.sql`
- Modify: `supabase/portal.sql` (v_personal redefinida al final, con comentario del porqué)
- Modify: `supabase/schema.sql` (solo un comentario sobre la redefinición en portal.sql)

**Interfaces:**
- Produces: columna booleana `"tieneCuenta"` en `v_personal` (camelCase citado, como `"correoVerificado"`), que la UI lee como `p.tieneCuenta`.

- [ ] **Step 1: Escribir la migración**

```sql
-- 2026-08-22 · #13 Cuentas de portal en masa: v_personal expone si el
-- trabajador ya tiene cuenta del portal (para marcar y crear en masa).
-- Vive lógicamente en portal.sql (depende de cuentas_portal).
drop view if exists v_personal;
create view v_personal as
select p.dni, p.tipo_documento, p.nombre, v.cargo, v.sede_id as sede, v.empresa_id as empresa,
       to_char(v.fecha_inicio, 'YYYY-MM-DD') as ingreso,
       p.celular, p.portal,
       case when v.fecha_fin is null then 'vigente' else 'cesado' end as estado,
       p.banco, p.cuenta,
       to_char(v.fecha_fin, 'YYYY-MM-DD') as cese,
       v.id as vinculo_id,
       p.correo, p.correo_verificado as "correoVerificado",
       p.cci,
       exists (select 1 from cuentas_portal cp where cp.dni = p.dni) as "tieneCuenta"
from vinculos v join personas p on p.dni = v.persona_dni;
grant select on v_personal to authenticated;
```

- [ ] **Step 2: Sincronizar canónicos** — pegar el MISMO bloque al final de `supabase/portal.sql` (sección nueva "v_personal con estado de cuenta") y en `schema.sql` dejar sobre la vista base el comentario `-- OJO: portal.sql la redefine agregando "tieneCuenta" (depende de cuentas_portal).` Usar split/join para empalmar, JAMÁS String.replace.

- [ ] **Step 3: Aplicar en producción**

Run: `node scripts/aplicar-sql.mjs supabase/migraciones/2026-08-22-cuentas-portal-masa.sql`
Expected: OK; luego probar `select "tieneCuenta" from v_personal limit 1` vía el mismo canal.

- [ ] **Step 4: Commit**

```powershell
git add supabase/migraciones/2026-08-22-cuentas-portal-masa.sql supabase/portal.sql supabase/schema.sql
git commit -m @'
feat(bd): v_personal expone tieneCuenta para la creacion masiva de cuentas del portal
'@
```

---

### Task 4: Planilla — badge «Sin cuenta» y modal individual con envío por correo

**Files:**
- Modify: `src/pages/rrhh/Personal.jsx`

**Interfaces:**
- Consumes: `p.tieneCuenta` (Task 3), `cuentaPortal(accion, dni, {enviarCorreo})` (Task 2).

- [ ] **Step 1: Badge y filtro.** En la fila: si `!p.tieneCuenta` el badge del portal muestra `Sin cuenta` (tone `alerta`), por encima del estado `p.portal`; el `Select` de estado del portal gana la opción `sin_cuenta` y el filtro se evalúa `fPortal === "sin_cuenta" ? !p.tieneCuenta : p.portal === fPortal`.

- [ ] **Step 2: Modal individual.** Actualizar el texto (ya no existe la clave fija): «La clave inicial es aleatoria de 6 dígitos: se muestra aquí al crearla o restablecerla, para entrega en mano.» Agregar un checkbox `enviarCorreo` (marcado por defecto y visible solo si `cuenta.correo`): «Enviar el acceso a su correo (x@y)». Los botones **Crear cuenta** y **Restablecer clave** llaman `cuentaPortal(accion, cuenta.dni, { enviarCorreo })`; quitar el botón viejo «Enviar acceso por correo» y el import de `enviarAccesoPortal`. Mostrar `cuentaResultado.enviado` («Acceso enviado a …») y `cuentaResultado.errorCorreo` («La cuenta quedó creada pero el correo falló: …») además de la clave.

- [ ] **Step 3: Verificar y commit**

Run: `npm run build`
Expected: OK.

```powershell
git add src/pages/rrhh/Personal.jsx
git commit -m @'
feat(rrhh): Planilla marca quien no tiene cuenta del portal y el modal envia el acceso por correo
'@
```

---

### Task 5: Modal masivo «Crear cuentas del portal»

**Files:**
- Modify: `src/pages/rrhh/Personal.jsx` (componente nuevo `CuentasMasa` en el mismo archivo, botón en el header)

**Interfaces:**
- Consumes: `cuentasPortalLote(dnis, enviarCorreo)` (Task 2); filas de `db.personal` con `tieneCuenta`.

- [ ] **Step 1: Botón en el header** de RRH-02 (junto a Importar planilla): `Cuentas del portal` (icono `Smartphone`), abre el modal masivo.

- [ ] **Step 2: Paso 1 — vista previa.** Candidatos: `db.personal.filter(p => p.empresa === empresaId && p.estado === "vigente" && !p.tieneCuenta)`, con select opcional de sede. Mostrar 3 contadores: sin cuenta (total), con correo (se les enviará el acceso), sin correo (clave solo en el CSV). Checkbox «Enviar el acceso por correo a quienes lo tienen» (marcado por defecto). Si los envíos > 400: `Note` tone pend con el tope de Gmail (~500/día) sugiriendo correr por sede o por partes. Botón: `Crear N cuentas`.

- [ ] **Step 3: Paso 2 — progreso.** Trocear los DNIs en grupos de 10 y llamar `cuentasPortalLote` secuencialmente, acumulando `resultados`; mostrar «Creando… X de N». Usar el patrón `sesionRef` del modal de importación (cerrar no cancela, pero el resultado tardío se descarta). Al terminar todos los tramos: `await recargar` vía un `cuentaPortal` noop NO — simplemente llamar el `recargar("personal")` que ya dispara `cuentaPortal`... (usar el retorno del contexto: exponer la recarga llamando `cuentasPortalLote` y al final `refrescarPersonal()` — agregar en state.jsx `refrescarPersonal: () => recargar("personal")`).

- [ ] **Step 4: Paso 3 — resultado + CSV.** Contadores: creadas, correos enviados, errores (listar los `{dni, error}` y `errorCorreo`). Botón `Descargar claves (CSV)` con el patrón BOM+`;` existente (RegistroAccesos.jsx:31-34): columnas `Documento;Trabajador;Clave inicial;Correo;Acceso enviado`, nombre `claves-portal-${empresaId}.csv`. `Note` tone pend fija: «Descarga el CSV antes de cerrar: las claves no se pueden volver a consultar (solo restablecer).»

- [ ] **Step 5: Verificar y commit**

Run: `npm run build; npm test`
Expected: build OK, vitest verde (sin suites nuevas, no debe romper ninguna).

```powershell
git add src/pages/rrhh/Personal.jsx src/state.jsx
git commit -m @'
feat(rrhh): creacion masiva de cuentas del portal con correo y CSV de claves (#13)
'@
```

---

### Task 6: Verificación E2E en producción

**Files:**
- Create: `scripts/verificar-cuentas-masa.mjs`

**Interfaces:**
- Consumes: env `ADMIN_EMAIL`/`ADMIN_CLAVE` (patrón `verificar-portal.mjs`), endpoints de producción.

- [ ] **Step 1: Escribir el script.** Pasos (todo con `assert` y contador de pruebas, patrón de las suites existentes):
1. Login admin (GoTrue password grant) → JWT.
2. Alta de persona de prueba `ZZ<timestamp corto>` (DNI numérico de 8 libre, vía RPC `alta_trabajador` con el JWT por el proxy `/api/supa`).
3. `crear-lote` con `[dni]` sin `enviarCorreo` → `clave` de 6 dígitos, `enviado` ausente.
4. Login del portal `dni@portal.grupoer.pe` con esa clave → 200.
5. `v_personal` del DNI → `tieneCuenta === true`.
6. Reintento `crear` → error «ya existe».
7. `restablecer` → clave nueva ≠ anterior; login con la vieja → 400; con la nueva → 200.
8. `crear-lote` con 11 DNIs → 400 «Máximo 10».
9. Limpieza: borrar cuenta GoTrue (admin API), fila `cuentas_portal`, vínculo y persona ZZ. El envío REAL de correo no se prueba por defecto (no spamear); flag `--correo` opcional usando una persona con el Gmail de Diego.

- [ ] **Step 2: Deploy y correr.**

Run: `git push` (deploy automático) → esperar Ready → `node scripts/verificar-cuentas-masa.mjs`
Expected: todas las pruebas en verde contra producción.

- [ ] **Step 3: Checklist y commit final.** Marcar #13 implementada en `docs/checklists/2026-08-21-flujos-e2e.md` (agregar sección C1c con el flujo manual: badge Sin cuenta → modal masivo → CSV → login de un trabajador real).

```powershell
git add scripts/verificar-cuentas-masa.mjs docs/checklists/2026-08-21-flujos-e2e.md
git commit -m @'
test(portal): verificacion E2E de cuentas en masa y checklist C1c (#13)
'@
git push
```

---

## Self-review

- Cobertura: detección (Task 3+4), creación masiva usuario=DNI clave random 6 (Task 1+5), correo con link (Task 1), entrega a los sin-correo (CSV, Task 5), tope Gmail avisado (Task 5), verificación (Task 6). ✓
- La retirada de `credenciales` (Task 2) depende de que el modal se rehaga en Task 4 — el build puede quedar roto ENTRE ambos commits; si molesta, fusionar los commits 2 y 4.
- `restablecer` también pasa a clave aleatoria: consecuencia directa de retirar la fija; la clave siempre se muestra en pantalla, así que el flujo de entrega en mano no cambia.
