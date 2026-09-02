# Completar correos en la creación masiva de cuentas — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el modal «Cuentas del portal» (RRH-02) permita completar los correos faltantes ahí mismo antes de la creación masiva, para que el acceso (link + usuario DNI + clave provisional) llegue por correo a cada trabajador.

**Architecture:** RPC nueva `fijar_correo_persona` que toca SOLO el correo (no se reutiliza `editar_trabajador`: reemplaza toda la fila y limpia `nombre_por_confirmar`). El modal CuentasMasa lista a los candidatos sin correo con un input por fila y un botón que los guarda en bloque. El endpoint `api/portal-cuentas.js` no cambia.

**Tech Stack:** React 19 + Vite (frontend), Supabase Postgres (RPC plpgsql), suites E2E por Management API (patrón `verificar-sedes.mjs`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-02-completar-correos-masa-design.md`.
- Funciones BD: `security definer set search_path = public, extensions` (hardening 2026-08-24).
- Gate de Personal: `fn_nivel_modulo('personal') >= 2`. OJO: sin JWT (Management API) devuelve 99 — las suites pueden llamar la RPC directo.
- Migración idempotente en `supabase/migraciones/` + canónico en `supabase/schema.sql` (función cerca de `editar_trabajador` y nombre agregado a la drop-list de LIMPIEZA, líneas 24-32).
- Aplicar SQL en prod: `. .\scripts\token-supabase.ps1; node scripts/aplicar-sql.mjs supabase/migraciones/2026-09-02-fijar-correo.sql` (si el clasificador lo bloquea, Diego lo corre vía `!` — en BASH: `export SUPABASE_ACCESS_TOKEN=...` no aplica; usar `! powershell -NoProfile -Command "..."`).
- Datos de prueba SIEMPRE con prefijo ZZPRUEBA y limpieza al final.
- Commits con mensajes en español, convención `feat:`/`fix:`/`test:`/`docs:`.

---

### Task 1: Suite de verificación (escrita primero, falla sin la migración)

**Files:**
- Create: `scripts/verificar-fijar-correo.mjs`

**Interfaces:**
- Produces: suite ejecutable `node scripts/verificar-fijar-correo.mjs` (exit 0 = verde). Task 2 la usa como criterio de éxito.

- [ ] **Step 1: Escribir la suite completa**

```js
// scripts/verificar-fijar-correo.mjs — pruebas del RPC fijar_correo_persona
// contra la BD viva (Management API). Datos ZZPRUEBAC, limpieza al final.
// Uso: & scripts/token-supabase.ps1 | Out-Null; node scripts/verificar-fijar-correo.mjs
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
const limpiar = async () => { await sql("delete from personas where dni like 'ZZPRUEBAC%'"); };

await limpiar();
await sql("insert into personas (dni, nombre) values ('ZZPRUEBAC1', 'ZZ Prueba Correo')");

await prueba("fija un correo nuevo: minúsculas, sin verificar y con auditoría", async () => {
  await sql("select fijar_correo_persona('ZZPRUEBAC1', '  Persona@Correo.COM ')");
  const [p] = await sql("select correo, correo_verificado from personas where dni = 'ZZPRUEBAC1'");
  igual(p.correo, "persona@correo.com", "correo normalizado");
  igual(p.correo_verificado, false, "verificado");
  const [au] = await sql(
    "select count(*)::int n from auditoria where accion='FIJAR_CORREO' and datos_despues->>'dni' = 'ZZPRUEBAC1'");
  igual(au.n >= 1, true, "auditoría");
});

await prueba("cambiar el correo vuelve a dejarlo sin verificar", async () => {
  await sql("update personas set correo_verificado = true where dni = 'ZZPRUEBAC1'");
  await sql("select fijar_correo_persona('ZZPRUEBAC1', 'otro@correo.com')");
  const [p] = await sql("select correo, correo_verificado from personas where dni = 'ZZPRUEBAC1'");
  igual(p.correo, "otro@correo.com", "correo");
  igual(p.correo_verificado, false, "verificado");
});

await prueba("repetir el MISMO correo conserva la verificación", async () => {
  await sql("update personas set correo_verificado = true where dni = 'ZZPRUEBAC1'");
  await sql("select fijar_correo_persona('ZZPRUEBAC1', 'OTRO@correo.com')");
  const [p] = await sql("select correo_verificado from personas where dni = 'ZZPRUEBAC1'");
  igual(p.correo_verificado, true, "verificado debía conservarse");
});

await prueba("negativa: formato inválido se rechaza sin tocar nada", async () => {
  let error = null;
  try { await sql("select fijar_correo_persona('ZZPRUEBAC1', 'no-es-correo')"); }
  catch (e) { error = e.message; }
  igual(error !== null && error.includes("formato"), true, `error (${error})`);
  const [p] = await sql("select correo from personas where dni = 'ZZPRUEBAC1'");
  igual(p.correo, "otro@correo.com", "el correo debía quedar intacto");
});

await prueba("vaciar borra el correo", async () => {
  await sql("select fijar_correo_persona('ZZPRUEBAC1', '')");
  const [p] = await sql("select correo from personas where dni = 'ZZPRUEBAC1'");
  igual(p.correo, null, "correo");
});

await prueba("negativa: persona inexistente se rechaza", async () => {
  let error = null;
  try { await sql("select fijar_correo_persona('ZZPRUEBAC9', 'x@y.pe')"); }
  catch (e) { error = e.message; }
  igual(error !== null && error.includes("no existe"), true, `error (${error})`);
});

await prueba("no toca nombre, celular ni la marca por confirmar", async () => {
  await sql(`update personas set celular = '999888777', nombre_por_confirmar = true where dni = 'ZZPRUEBAC1'`);
  await sql("select fijar_correo_persona('ZZPRUEBAC1', 'final@correo.com')");
  const [p] = await sql(
    "select nombre, celular, nombre_por_confirmar from personas where dni = 'ZZPRUEBAC1'");
  igual(p.nombre, "ZZ Prueba Correo", "nombre");
  igual(p.celular, "999888777", "celular");
  igual(p.nombre_por_confirmar, true, "por confirmar debía conservarse");
});

await limpiar();
console.log(fallos ? `\n${fallos} PRUEBAS FALLARON` : "\nTODAS LAS PRUEBAS PASARON");
process.exit(fallos ? 1 : 0);
```

- [ ] **Step 2: Correrla y verificar que FALLA (la función no existe)**

Run: `& scripts/token-supabase.ps1 | Out-Null; node scripts/verificar-fijar-correo.mjs`
Expected: las pruebas que llaman `fijar_correo_persona` fallan con «function ... does not exist».

- [ ] **Step 3: Commit**

```powershell
git add scripts/verificar-fijar-correo.mjs
git commit -m "test(personal): suite E2E del RPC fijar_correo_persona"
```

---

### Task 2: Migración `fijar_correo_persona` + canónico

**Files:**
- Create: `supabase/migraciones/2026-09-02-fijar-correo.sql`
- Modify: `supabase/schema.sql` (función tras `editar_trabajador` ~línea 1538; nombre en la drop-list de LIMPIEZA líneas 24-32)

**Interfaces:**
- Consumes: suite de Task 1.
- Produces: RPC `fijar_correo_persona(p_dni text, p_correo text) returns void` — la usan Task 3 (state) y la suite.

- [ ] **Step 1: Escribir la migración**

```sql
-- 2026-09-02 — fijar_correo_persona: fija SOLO el correo de contacto (paso
-- «completar correos» del modal masivo de cuentas del portal, RRH-02).
-- No se reutiliza editar_trabajador: ese RPC reemplaza toda la fila («lo
-- escrito manda») y limpia nombre_por_confirmar como efecto colateral.
-- Idempotente. Spec: docs/superpowers/specs/2026-09-02-completar-correos-masa-design.md

drop function if exists fijar_correo_persona(text, text);
create function fijar_correo_persona(p_dni text, p_correo text)
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare v_correo text; j_antes jsonb; j_despues jsonb;
begin
  if fn_nivel_modulo('personal') < 2 then
    raise exception 'Tu categoría no permite editar datos de Personal.';
  end if;
  if not exists (select 1 from personas where dni = p_dni) then
    raise exception 'La persona % no existe.', p_dni;
  end if;
  v_correo := nullif(lower(trim(coalesce(p_correo, ''))), '');
  if v_correo is not null and v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo no tiene un formato válido.';
  end if;
  select jsonb_build_object('dni', dni, 'correo', correo, 'correo_verificado', correo_verificado)
    into j_antes from personas where dni = p_dni;
  update personas set
    correo_verificado = case when v_correo is distinct from correo then false else correo_verificado end,
    correo = v_correo
  where dni = p_dni;
  select jsonb_build_object('dni', dni, 'correo', correo, 'correo_verificado', correo_verificado)
    into j_despues from personas where dni = p_dni;
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('FIJAR_CORREO', 'personas', j_antes, j_despues);
end $$;
```

- [ ] **Step 2: Sincronizar el canónico `schema.sql`**

Copiar la MISMA función (sin el `drop function if exists`, que en el canónico no hace falta: la drop-list de LIMPIEZA ya la cubre) inmediatamente después del cuerpo de `editar_trabajador` (~línea 1538), y agregar `fijar_correo_persona` a la drop-list: en la línea `crear_activo, eliminar_sede cascade;` dejar `crear_activo, eliminar_sede, fijar_correo_persona cascade;`.

- [ ] **Step 3: Aplicar en producción**

Run: `. .\scripts\token-supabase.ps1; node scripts/aplicar-sql.mjs supabase/migraciones/2026-09-02-fijar-correo.sql`
(Si el clasificador bloquea, pedir a Diego que lo corra vía `!` con `powershell -NoProfile -Command`.)

- [ ] **Step 4: Correr la suite y verificar que PASA (7/7)**

Run: `& scripts/token-supabase.ps1 | Out-Null; node scripts/verificar-fijar-correo.mjs`
Expected: `TODAS LAS PRUEBAS PASARON`.

- [ ] **Step 5: Commit**

```powershell
git add supabase/migraciones/2026-09-02-fijar-correo.sql supabase/schema.sql
git commit -m "feat(bd): RPC fijar_correo_persona - solo correo, sin efectos colaterales"
```

---

### Task 3: Acción `fijarCorreo` en `state.jsx`

**Files:**
- Modify: `src/state.jsx` (junto a `cuentasPortalLote`/`refrescarPersonal`, ~línea 490)

**Interfaces:**
- Consumes: RPC `fijar_correo_persona` (Task 2), `supabase`/`supabaseListo` ya en scope.
- Produces: `fijarCorreo(dni, correo) => Promise<void>` (lanza Error con el mensaje del servidor). NO recarga: el caller (modal) recarga UNA vez al final con `refrescarPersonal()`.

- [ ] **Step 1: Agregar la acción**

Insertar después de `refrescarPersonal: () => recargar("personal"),` (línea 490):

```jsx
    // Correo de contacto SOLO (paso «completar correos» del modal masivo,
    // RRH-02): no pasa por editar_trabajador para no tocar nombre/celular/
    // banco ni limpiar «por confirmar». El caller recarga al final.
    fijarCorreo: async (dni, correo) => {
      if (!supabaseListo) throw new Error("Requiere conexión a Supabase.");
      const { error } = await supabase.rpc("fijar_correo_persona", { p_dni: dni, p_correo: correo });
      if (error) throw new Error(error.message);
    },
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run build`
Expected: build OK.

- [ ] **Step 3: Commit**

```powershell
git add src/state.jsx
git commit -m "feat(personal): accion fijarCorreo en el estado global"
```

---

### Task 4: UI — completar correos en el paso 1 de CuentasMasa

**Files:**
- Modify: `src/pages/rrhh/Personal.jsx` (componente `CuentasMasa`, ~líneas 288-426, y su instancia ~línea 257)

**Interfaces:**
- Consumes: `fijarCorreo` (Task 3) vía `useApp()` en `Personal()` y prop nueva de `CuentasMasa`; `refrescarPersonal` ya llega como prop.
- Produces: UI final; nada más depende de esto.

- [ ] **Step 1: Pasar la prop**

En `Personal()`: agregar `fijarCorreo` al destructuring de `useApp()` (línea 20) y a la instancia:

```jsx
      <CuentasMasa
        open={masa} onClose={() => setMasa(false)} personal={db.personal} empresaId={empresaId}
        sedes={sedesEmpresa} cuentasPortalLote={cuentasPortalLote} refrescarPersonal={refrescarPersonal}
        fijarCorreo={fijarCorreo}
      />
```

- [ ] **Step 2: Estado y lógica en `CuentasMasa`**

Firma: `function CuentasMasa({ open, onClose, personal, empresaId, sedes, cuentasPortalLote, refrescarPersonal, fijarCorreo })`.

Estado nuevo junto a los existentes:

```jsx
  const [correos, setCorreos] = useState({});        // dni → texto tecleado
  const [erroresCorreo, setErroresCorreo] = useState({}); // dni → mensaje
  const [guardandoCorreos, setGuardandoCorreos] = useState(false);
```

Derivados, tras `conCorreoN`:

```jsx
  const sinCorreo = candidatos.filter((p) => !p.correo);
  const porGuardarN = sinCorreo.filter((p) => (correos[p.dni] ?? "").trim()).length;
```

Lógica de guardado (formato validado en cliente Y servidor; el maestro se
recarga UNA vez al final y los guardados pasan solos al grupo «con correo»):

```jsx
  const guardarCorreos = async () => {
    if (guardandoCorreos) return;
    const pendientes = sinCorreo
      .map((p) => [p.dni, (correos[p.dni] ?? "").trim().toLowerCase()])
      .filter(([, c]) => c);
    const errores = Object.fromEntries(pendientes
      .filter(([, c]) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c))
      .map(([dni]) => [dni, "Formato de correo inválido."]));
    setErroresCorreo(errores);
    const validos = pendientes.filter(([dni]) => !errores[dni]);
    if (validos.length === 0) return;
    setGuardandoCorreos(true);
    for (const [dni, c] of validos) {
      try {
        await fijarCorreo(dni, c);
        setCorreos((m) => { const n = { ...m }; delete n[dni]; return n; });
      } catch (e) { errores[dni] = e.message; }
    }
    setErroresCorreo({ ...errores });
    setGuardandoCorreos(false);
    refrescarPersonal();
  };
```

En `cerrar()`, sumar al reseteo: `setCorreos({}); setErroresCorreo({}); setGuardandoCorreos(false);`.

- [ ] **Step 3: Bloque visual en el paso 1**

Insertar entre la grilla de contadores y la casilla «Enviar el acceso por correo…»:

```jsx
            {sinCorreo.length > 0 && (
              <div className="rounded-caja border border-borde">
                <div className="border-b border-borde bg-papel/50 px-3.5 py-2.5 text-[12.5px] font-semibold text-tinta-2">
                  Completar correos — {sinCorreo.length} sin correo (opcional: sin correo, su clave sale en el CSV)
                </div>
                <div className="max-h-56 space-y-1.5 overflow-y-auto p-3">
                  {sinCorreo.map((p) => (
                    <div key={p.dni} className="flex items-center gap-2">
                      <div className="w-24 shrink-0 font-mono text-[11.5px] text-gris">{p.dni}</div>
                      <div className="min-w-0 flex-1 truncate text-[12.5px] text-tinta-2">{p.nombre}</div>
                      <div className="w-60 shrink-0">
                        <Input type="email" placeholder="persona@correo.com" value={correos[p.dni] ?? ""}
                          onChange={(e) => setCorreos((m) => ({ ...m, [p.dni]: e.target.value }))} />
                        {erroresCorreo[p.dni] && (
                          <div className="mt-0.5 text-[11px] text-alerta">{erroresCorreo[p.dni]}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t border-borde px-3 py-2.5">
                  <Button variant="secondary" size="sm" onClick={guardarCorreos}
                    disabled={guardandoCorreos || porGuardarN === 0}>
                    {guardandoCorreos ? "Guardando…" : `Guardar correos (${porGuardarN})`}
                  </Button>
                </div>
              </div>
            )}
```

- [ ] **Step 4: Verificar build y suite de UI**

Run: `npm run build; npm test`
Expected: build OK, vitest completo en verde (145+).

- [ ] **Step 5: Commit**

```powershell
git add src/pages/rrhh/Personal.jsx
git commit -m "feat(rrh-02): completar correos en el modal masivo de cuentas del portal"
```

---

### Task 5: Deploy y verificación final

**Files:** ninguno nuevo.

- [ ] **Step 1: Push (deploy automático a Vercel)**

Run: `git push`
Expected: deploy `intranet-general` en Ready (verificar con `vercel ls` o el dashboard).

- [ ] **Step 2: Re-correr las suites tocadas**

Run: `& scripts/token-supabase.ps1 | Out-Null; node scripts/verificar-fijar-correo.mjs`
Expected: 7/7 verde.

- [ ] **Step 3: Prueba real de Diego**

En producción: Planilla → «Cuentas del portal» → completar 1-2 correos reales → Guardar correos → crear cuentas → confirmar que llega el correo con link + DNI + clave y que el CSV cubre al resto.
