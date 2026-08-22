# Importación de Asistencias (#8, módulo Asistencia) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Terminar #8: importar el reporte de marcaciones del reloj (.xlsx) al módulo nuevo **Asistencia** (RRHH), con vista previa, reemplazo por rango idempotente y pantalla de consulta.

**Architecture:** Mismo patrón de los importadores existentes: parser puro en el cliente (`src/lib/importar/asistencia.js`, YA ESCRITO y verde 9/9) → RPC transaccional en Postgres con vista previa PV999 (`importar_asistencia` / `previsualizar_asistencia`) → pantalla RRHH→Asistencia (RRH-22) con modal de importación donde **el usuario ELIGE la razón social antes de cargar** (el archivo del reloj no trae RS) y confirma con «Sí, subir a [RS]». La resolución de códigos contra el maestro compara **quitando ceros a la izquierda** (decisión de Diego: DNI 7→8 y CE `003308122` resuelven igual). No se clasifica tardanza/falta: solo se guardan marcaciones y la pantalla calcula lo referencial.

**Tech Stack:** React 19 + Vite (BackOffice), Supabase Postgres (RPC plpgsql, Management API para aplicar SQL), vitest, lector xlsx propio (`leerXlsx`).

## Global Constraints

- **Groundwork YA APLICADO en prod** (migración `2026-08-21-asistencia.sql`): tablas `marcaciones` (PK `empresa_id, documento, fecha`; `m1..m4` texto), `asistencia_lotes`, `asistencia_config` (`doble_marcacion_min` default 15), módulo `asistencia` en `perfil_permisos_modulo_check`. Ya está sincronizado en `supabase/schema.sql`. NO re-crear nada de eso.
- El módulo `asistencia` NO tiene nivel de aprobación (`aprobacion: false`) → NO va al check `nivel_3_solo_con_aprobacion`.
- Decisiones de Diego (2026-08-21, cerradas): módulo NUEVO «Asistencia» (Tardanzas RRH-20 queda como está); empresa ELEGIDA por el usuario; contar cuántos códigos pertenecen a esa empresa y **bloquear si 0**; reemplazo por rango (reimportar = sustituir, jamás duplicar); umbral de doble marcación 15 min configurable (`asistencia_config`).
- Días futuros jamás se importan (el parser los descarta; el RPC lo defiende de nuevo).
- SQL a producción: `& scripts/token-supabase.ps1 | Out-Null` y `node scripts/aplicar-sql.mjs <archivo>` (Management API). JAMÁS escribir env vars desde PS5.1 (BOM).
- Empalmar SQL en canónicos con split/join o pegado manual — JAMÁS `String.replace` (los `$$` se corrompen). `schema.sql` en disco viene CRLF.
- Mensajes de commit por here-string de PS5.1 **sin comillas dobles** (native arg passing las rompe).
- Códigos de pantalla estables: la pantalla nueva es **RRH-22 · Asistencia**, ruta `/rrhh/asistencia`.
- CI/CD: push a `main` → deploy automático Vercel (`intranet-general`).
- Pendiente de confirmar con Diego (NO bloquea; ya anotado en el test): el spec contó 2 dobles marcaciones (solo la entrada), la regla literal «dos consecutivas < 15 min» encuentra 6. Se implementa la literal (sobre-reportar es seguro: solo se lista, no bloquea).

---

### Task 1: Commitear el parser TDD ya escrito

El parser, la suite y el fixture ya existen sin trackear y pasan 9/9. Solo falta consolidarlos.

**Files:**
- Ya escritos: `src/lib/importar/asistencia.js`, `tests/importar/asistencia.test.js`, `tests/fixtures/Asistencia_21_8_2026.xlsx`

**Interfaces:**
- Produces: `parsearAsistencia(bytes, {umbralDobleMin, hoy}) → {rango:{desde,hasta}, codigos, registros, importables, stats}`; `analizarAsistencia(filas, opts)`; `sinCeros(cod)`. Cada registro: `{codigo, codigoCanonico, fecha, marcas:[HH:MM], nMarcas, anomalias:[], futura}`.

- [ ] **Step 1: Correr la suite y verificar 9/9**

Run: `npx vitest run tests/importar/asistencia.test.js`
Expected: `Tests  9 passed (9)`

- [ ] **Step 2: Commit**

```powershell
git add src/lib/importar/asistencia.js tests/importar/asistencia.test.js tests/fixtures/Asistencia_21_8_2026.xlsx
git commit -m @'
feat(asistencia): parser TDD del reporte de marcaciones del reloj

Mapea por posicion (encabezados ENTRADA/SALIDA repetidos), descarta
separadoras y dias futuros, detecta incompletos/dobles/invertidos/sin
refrigerio y conserva la forma sin ceros del codigo para cotejar en BD.
9/9 contra el fixture real (41 trabajadores, 943 filas).
'@
```

---

### Task 2: Migración de RPCs y vistas + aplicar + canónico

**Files:**
- Create: `supabase/migraciones/2026-08-21-asistencia-rpcs.sql`
- Modify: `supabase/schema.sql` (empalmar el mismo bloque al final de la sección de asistencia, tras las tablas ya sincronizadas)

**Interfaces:**
- Consumes: tablas `marcaciones`/`asistencia_lotes`/`asistencia_config` (groundwork), `fn_nivel_modulo(text)` de accesos.sql (sin JWT devuelve 99 → los scripts de verificación pasan), `empresas.estado`, `personas.dni`, `vinculos`.
- Produces: `importar_asistencia(p_empresa text, p_registros jsonb, p_archivo text, p_resumen jsonb, p_por text) returns jsonb` — retorna `{lote, desde, hasta, filas, reconocidos, no_reconocidos}`; `previsualizar_asistencia(p_empresa, p_registros, p_archivo, p_resumen) returns jsonb` (PV999, sin rastro); vistas `v_asistencia_lotes` y `v_marcaciones`. `p_registros` = array de `{codigo, fecha, m1, m2, m3, m4}` (solo importables, ya sin futuras).

- [ ] **Step 1: Escribir la migración**

```sql
-- 2026-08-21 · Asistencia (fase 2): RPCs de importación y vistas de lectura.
-- Las tablas (marcaciones, asistencia_lotes, asistencia_config) son del
-- groundwork 2026-08-21-asistencia.sql. Patrón importar_activos + PV999.
-- Idempotente.

-- Importación transaccional con REEMPLAZO POR RANGO: reimportar el mismo
-- periodo sustituye lo que había (jamás duplica). La resolución de códigos
-- contra el maestro compara QUITANDO CEROS a la izquierda (decisión Diego
-- 2026-08-21: DNI 7→8 y CE 003308122 resuelven igual); documento guardado =
-- dni canónico del maestro si resuelve, si no el código sin ceros.
create or replace function importar_asistencia(
  p_empresa text, p_registros jsonb, p_archivo text, p_resumen jsonb, p_por text
) returns jsonb language plpgsql security definer as $$
declare
  v_lote bigint; v_desde date; v_hasta date; v_filas int;
  v_reconocidos int; v_no_reconocidos text[];
begin
  if fn_nivel_modulo('asistencia') < 2 then
    raise exception 'Tu categoría no permite importar asistencias (requiere nivel de acción en el módulo Asistencia).';
  end if;
  if (select estado from empresas where id = p_empresa) is distinct from 'activa' then
    raise exception 'La empresa % no está activa: importación rechazada completa.', p_empresa;
  end if;
  if p_registros is null or jsonb_array_length(p_registros) = 0 then
    raise exception 'El archivo no trae filas de marcación importables.';
  end if;

  drop table if exists tmp_asist; drop table if exists tmp_doc;
  create temp table tmp_asist on commit drop as
  select trim(x->>'codigo')                as codigo,
         ltrim(trim(x->>'codigo'), '0')    as canonico,
         (x->>'fecha')::date               as fecha,
         nullif(trim(coalesce(x->>'m1','')), '') as m1,
         nullif(trim(coalesce(x->>'m2','')), '') as m2,
         nullif(trim(coalesce(x->>'m3','')), '') as m3,
         nullif(trim(coalesce(x->>'m4','')), '') as m4
  from jsonb_array_elements(p_registros) x;

  select min(fecha), max(fecha), count(*)::int into v_desde, v_hasta, v_filas from tmp_asist;
  -- Defensa del servidor: el parser ya descartó los días futuros en el cliente.
  if v_hasta > current_date then
    raise exception 'El archivo trae marcaciones de fechas futuras (%): no se importa nada.', v_hasta;
  end if;

  -- Mapa código→documento: personas con vínculo (vigente o histórico) en la
  -- empresa elegida. distinct on: si dos dni del maestro colapsan al mismo
  -- canónico (no debería pasar), gana uno y no revienta la importación.
  create temp table tmp_doc on commit drop as
  select distinct on (ltrim(p.dni, '0')) ltrim(p.dni, '0') as canonico, p.dni
  from personas p
  where exists (select 1 from vinculos v
                where v.persona_dni = p.dni and v.empresa_id = p_empresa)
  order by ltrim(p.dni, '0'), p.dni;

  select count(distinct t.canonico) into v_reconocidos
  from tmp_asist t join tmp_doc d using (canonico);
  if v_reconocidos = 0 then
    raise exception 'Ningún código del archivo corresponde a un trabajador de esta empresa: revisa que hayas elegido la razón social correcta.';
  end if;
  select coalesce(array_agg(distinct t.codigo), '{}') into v_no_reconocidos
  from tmp_asist t left join tmp_doc d using (canonico) where d.dni is null;

  insert into asistencia_lotes (empresa_id, archivo, rango_desde, rango_hasta,
                                trabajadores, filas, anomalias, creado_por)
  values (p_empresa, p_archivo, v_desde, v_hasta,
          (select count(distinct canonico) from tmp_asist), v_filas,
          coalesce(p_resumen, '{}'::jsonb), p_por)
  returning id into v_lote;

  -- Reemplazo por rango: lo que había de esa empresa en el periodo se va.
  delete from marcaciones where empresa_id = p_empresa and fecha between v_desde and v_hasta;

  -- Tras el delete solo puede chocar el caso de dos códigos del archivo que
  -- resuelven a la misma persona y fecha (p. ej. 9972665 y 09972665): la
  -- última fila manda, no revienta.
  insert into marcaciones (empresa_id, documento, fecha, m1, m2, m3, m4, lote_id)
  select p_empresa, coalesce(d.dni, t.canonico), t.fecha, t.m1, t.m2, t.m3, t.m4, v_lote
  from tmp_asist t left join tmp_doc d using (canonico)
  on conflict (empresa_id, documento, fecha) do update
    set m1 = excluded.m1, m2 = excluded.m2, m3 = excluded.m3, m4 = excluded.m4,
        lote_id = excluded.lote_id;

  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('IMPORTAR_ASISTENCIA', 'marcaciones', null,
    jsonb_build_object('por', p_por, 'empresa', p_empresa, 'archivo', p_archivo,
      'lote', v_lote, 'desde', v_desde, 'hasta', v_hasta, 'filas', v_filas,
      'reconocidos', v_reconocidos, 'no_reconocidos', to_jsonb(v_no_reconocidos)));

  return jsonb_build_object('lote', v_lote,
    'desde', to_char(v_desde, 'YYYY-MM-DD'), 'hasta', to_char(v_hasta, 'YYYY-MM-DD'),
    'filas', v_filas, 'reconocidos', v_reconocidos,
    'no_reconocidos', to_jsonb(v_no_reconocidos));
end $$;

-- Vista previa sin rastro: mismo patrón PV999 verificado de los otros importadores.
create or replace function previsualizar_asistencia(
  p_empresa text, p_registros jsonb, p_archivo text, p_resumen jsonb
) returns jsonb language plpgsql security definer as $$
declare v jsonb;
begin
  v := importar_asistencia(p_empresa, p_registros, p_archivo, p_resumen, '(vista previa)');
  raise exception using errcode = 'PV999', message = v::text; -- revertir TODO
exception when sqlstate 'PV999' then
  return sqlerrm::jsonb;
end $$;

-- Lecturas: la interfaz nunca lee tablas crudas cuando hay contrato de datos.
create or replace view v_asistencia_lotes as
select l.id, l.empresa_id as empresa, e.nombre as empresa_nombre, l.archivo,
       to_char(l.rango_desde, 'YYYY-MM-DD') as desde,
       to_char(l.rango_hasta, 'YYYY-MM-DD') as hasta,
       l.trabajadores, l.filas, l.anomalias, l.creado_por,
       to_char(l.creado_en, 'YYYY-MM-DD HH24:MI') as creado_en
from asistencia_lotes l
join empresas e on e.id = l.empresa_id
order by l.id desc;

create or replace view v_marcaciones as
select m.empresa_id as empresa, m.documento, p.nombre,
       (p.dni is not null) as reconocido,
       to_char(m.fecha, 'YYYY-MM-DD') as fecha,
       m.m1, m.m2, m.m3, m.m4, m.lote_id
from marcaciones m
left join personas p on p.dni = m.documento;
```

- [ ] **Step 2: Aplicar en producción**

```powershell
& scripts/token-supabase.ps1 | Out-Null
node scripts/aplicar-sql.mjs supabase/migraciones/2026-08-21-asistencia-rpcs.sql
```
Expected: sin error (respuesta `[]`).

- [ ] **Step 3: Smoke SQL de que las funciones existen**

```powershell
node scripts/aplicar-sql.mjs --query "select proname from pg_proc where proname in ('importar_asistencia','previsualizar_asistencia')"
```
Expected: las 2 filas.

- [ ] **Step 4: Sincronizar el canónico `schema.sql`**

Abrir `supabase/schema.sql`, localizar el bloque de asistencia (buscar `asistencia_lotes`) y pegar DESPUÉS de sus tablas/policies el contenido completo de la migración (desde `create or replace function importar_asistencia` hasta el final de `v_marcaciones`). Pegado manual con Edit (anclas de texto exactas) — jamás String.replace. Verificar con `git diff` que los `$$` quedaron intactos.

- [ ] **Step 5: Commit**

```powershell
git add supabase/migraciones/2026-08-21-asistencia-rpcs.sql supabase/schema.sql
git commit -m @'
feat(asistencia): RPCs de importacion (PV999, reemplazo por rango) y vistas

importar_asistencia resuelve codigos contra el maestro quitando ceros,
bloquea si ningun codigo pertenece a la empresa elegida, rechaza fechas
futuras y reemplaza el rango completo (idempotente). Aplicado en prod y
sincronizado en schema.sql.
'@
```

---

### Task 3: Script de verificación E2E de BD

**Files:**
- Create: `scripts/verificar-asistencia.mjs`

**Interfaces:**
- Consumes: `importar_asistencia`/`previsualizar_asistencia` (Task 2), Management API (patrón exacto de `scripts/verificar-importacion-activos.mjs`).
- Produces: suite re-ejecutable; datos sintéticos SIEMPRE con prefijo ZZ y rango 2020-01-01..2020-01-02 (jamás pisa marcaciones reales; el reemplazo por rango solo borra ese rango antiguo vacío).

- [ ] **Step 1: Escribir el script**

```js
// scripts/verificar-asistencia.mjs — pruebas E2E de BD del módulo Asistencia
// (#8): importar_asistencia / previsualizar_asistencia. Datos sintéticos con
// prefijo ZZ y rango 2020-01-01..2020-01-02 (jamás toca marcaciones reales).
// Uso: & scripts/token-supabase.ps1 | Out-Null; node scripts/verificar-asistencia.mjs
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

// Persona sintética: dni con cero inicial para probar la regla "quitando
// ceros" (el código del reloj llega sin el cero). Formato válido del check
// personas_dni_formato: ^[0-9A-Z-]{4,20}$.
const DNI = "0ZZPRUEBA9";      // documento canónico del maestro
const COD = "ZZPRUEBA9";       // código como lo trae el reloj (sin el cero)
const NADIE = "ZZNADIE99";     // código que no resuelve contra el maestro
const reg = (codigo, fecha, m = {}) => JSON.stringify({ codigo, fecha, m1: "07:55", m2: "12:01", m3: "13:00", m4: "17:05", ...m });
const importar = (empresa, registros, archivo = "zzprueba-asistencia.xlsx") =>
  sql(`select importar_asistencia('${empresa}', '[${registros.map((r) => r.replace(/'/g, "''")).join(",")}]'::jsonb, '${archivo}', '{"origen":"verificacion"}'::jsonb, 'verificacion') as r`);

const limpiar = async () => {
  await sql(`delete from marcaciones where documento in ('${DNI}','${COD}','${NADIE}')`);
  await sql(`delete from asistencia_lotes where archivo = 'zzprueba-asistencia.xlsx'`);
  await sql(`delete from vinculos where persona_dni = '${DNI}'`);
  await sql(`delete from personas where dni = '${DNI}'`);
};
await limpiar();

// Alta de la persona de prueba con vínculo en promant (sede real cualquiera).
await sql(`insert into personas (dni, nombre) values ('${DNI}', 'ZZ PRUEBA ASISTENCIA')`);
await sql(`insert into vinculos (persona_dni, empresa_id, sede_id, cargo, fecha_inicio)
           select '${DNI}', 'promant', id, 'PRUEBA', '2019-12-01' from sedes where empresa_id = 'promant' limit 1`);

await prueba("0 códigos reconocidos: bloquea y no deja rastro", async () => {
  let error = null;
  try { await importar("promant", [reg(NADIE, "2020-01-01")]); }
  catch (e) { error = e.message; }
  igual(error !== null, true, "debió fallar");
  igual(/razón social correcta/.test(error), true, `mensaje accionable (${error})`);
  const [n] = await sql(`select count(*)::int n from marcaciones where documento = '${NADIE}'`);
  igual(n.n, 0, "sin marcaciones");
  const [l] = await sql(`select count(*)::int n from asistencia_lotes where archivo = 'zzprueba-asistencia.xlsx'`);
  igual(l.n, 0, "sin lote");
});

await prueba("fecha futura: bloquea todo", async () => {
  let error = null;
  try { await importar("promant", [reg(COD, "2099-01-01")]); }
  catch (e) { error = e.message; }
  igual(error !== null && /futuras/.test(error), true, `debió fallar por futuras (${error})`);
});

await prueba("importa: documento = dni canónico del maestro; el no reconocido entra con su código", async () => {
  const [{ r }] = await importar("promant", [reg(COD, "2020-01-01"), reg(NADIE, "2020-01-01")]);
  igual(r.reconocidos, 1, "reconocidos");
  igual(r.no_reconocidos.length, 1, "no reconocidos");
  igual(r.no_reconocidos[0], NADIE, "cuál no resolvió");
  const filas = await sql(`select documento, m1 from marcaciones where fecha = '2020-01-01' and empresa_id = 'promant' and documento in ('${DNI}','${NADIE}') order by documento`);
  igual(filas.length, 2, "2 marcaciones");
  igual(filas.some((f) => f.documento === DNI), true, "resuelto al dni con cero del maestro");
});

await prueba("lote registrado con rango y conteos", async () => {
  const [l] = await sql(`select empresa_id, rango_desde::text d, rango_hasta::text h, trabajadores, filas from asistencia_lotes where archivo = 'zzprueba-asistencia.xlsx' order by id desc limit 1`);
  igual(l.empresa_id, "promant", "empresa");
  igual(l.d, "2020-01-01", "desde");
  igual(l.trabajadores, 2, "códigos distintos");
  igual(l.filas, 2, "filas");
});

await prueba("reemplazo por rango: reimportar sustituye, no duplica", async () => {
  await importar("promant", [reg(COD, "2020-01-01", { m1: "08:10" }), reg(COD, "2020-01-02")]);
  const filas = await sql(`select fecha::text f, m1 from marcaciones where documento = '${DNI}' order by fecha`);
  igual(filas.length, 2, "2 días, sin duplicados");
  igual(filas[0].m1, "08:10", "el nuevo valor manda");
  const [n] = await sql(`select count(*)::int n from marcaciones where documento = '${NADIE}'`);
  igual(n.n, 0, "el reemplazo barrió la fila vieja del rango");
});

await prueba("previsualizar: devuelve el resumen y no deja rastro (PV999)", async () => {
  const [antes] = await sql(`select count(*)::int n from marcaciones where empresa_id = 'promant' and fecha between '2020-01-01' and '2020-01-02'`);
  const [{ r }] = await sql(`select previsualizar_asistencia('promant', '[${reg(COD, "2020-01-02", { m1: "09:00" }).replace(/'/g, "''")}]'::jsonb, 'zzprueba-asistencia.xlsx', '{}'::jsonb) as r`);
  igual(r.reconocidos, 1, "resumen de la vista previa");
  const [despues] = await sql(`select count(*)::int n from marcaciones where empresa_id = 'promant' and fecha between '2020-01-01' and '2020-01-02'`);
  igual(despues.n, antes.n, "sin rastro");
  const filas = await sql(`select m1 from marcaciones where documento = '${DNI}' and fecha = '2020-01-02'`);
  igual(filas[0].m1, "07:55", "la marcación real no cambió");
});

await prueba("vistas: v_asistencia_lotes y v_marcaciones exponen el contrato", async () => {
  const [l] = await sql(`select empresa_nombre, desde, hasta from v_asistencia_lotes where archivo = 'zzprueba-asistencia.xlsx' order by id desc limit 1`);
  igual(typeof l.empresa_nombre, "string", "nombre de empresa");
  const [m] = await sql(`select nombre, reconocido from v_marcaciones where documento = '${DNI}' and fecha = '2020-01-01'`);
  igual(m.reconocido, true, "reconocido");
  igual(m.nombre, "ZZ PRUEBA ASISTENCIA", "nombre del maestro");
});

await limpiar();
console.log(fallos ? `\n${fallos} prueba(s) fallaron.` : "\nTodas las pruebas pasaron.");
process.exit(fallos ? 1 : 0);
```

- [ ] **Step 2: Correr y ver todo verde**

```powershell
& scripts/token-supabase.ps1 | Out-Null
node scripts/verificar-asistencia.mjs
```
Expected: `Todas las pruebas pasaron.` (7 ✓). Si algo falla: arreglar la migración, re-aplicarla (Task 2 Step 2) y re-correr.

- [ ] **Step 3: Commit**

```powershell
git add scripts/verificar-asistencia.mjs
git commit -m @'
test(asistencia): verificacion E2E de BD del importador (7 pruebas, prod)
'@
```

---

### Task 4: Cableado del módulo en el frontend

**Files:**
- Modify: `src/data/modulos.js` (MODULOS, GRUPOS_MODULOS, MODULOS_RRHH)
- Modify: `src/layout/Shell.jsx` (NAV_RRHH + import de ícono)
- Modify: `src/App.jsx` (import + ruta)
- Modify: `src/state.jsx` (FUENTES, LOCAL, acciones)

**Interfaces:**
- Consumes: RPCs de Task 2.
- Produces: acciones `previsualizarAsistencia(empresaId, registros, archivo, resumen)`, `importarAsistencia(empresaId, registros, archivo, resumen)`, `cargarMarcaciones(empresaId, fecha) → [{documento, nombre, reconocido, fecha, m1..m4}]`; estado `db.asistenciaLotes`, `db.asistenciaConfig`. Ruta `/rrhh/asistencia` con guard `RequiereModulo modulo="asistencia"` que renderiza `Asistencia` (Task 5 crea la página; este task deja el import listo y compilando — hacer Task 5 antes de correr el build, o crear aquí el archivo con un placeholder mínimo `export default function Asistencia(){return null}` y commitear ambos tasks juntos; PREFERIDO: ejecutar Task 4 y 5 como un solo commit).

- [ ] **Step 1: `src/data/modulos.js` — catálogo, grupo y RRHH**

En `MODULOS`, después de la entrada `tardanzas`, insertar:

```js
  { id: "asistencia", nombre: "Asistencia", aprobacion: false,
    ver: "consultar las marcaciones importadas y los lotes",
    accionar: "importar el reporte de marcaciones del reloj",
    aprobar: null },
```

En `GRUPOS_MODULOS`, fila «Recursos Humanos», agregar `"asistencia"` al final del array (queda `[..., "tardanzas", "asistencia"]`).

En `MODULOS_RRHH`, agregar `"asistencia"` al final del array.

- [ ] **Step 2: `src/layout/Shell.jsx` — ítem de menú**

Agregar `CalendarClock` al import de `lucide-react` y, en `NAV_RRHH`, después del ítem de tardanzas:

```js
  { to: "/rrhh/asistencia", icon: CalendarClock, label: "Asistencia", code: "RRH-22", modulo: "asistencia" },
```

- [ ] **Step 3: `src/App.jsx` — ruta con guard**

Import junto a los demás de rrhh: `import Asistencia from "./pages/rrhh/Asistencia";`
Ruta después de la de tardanzas:

```jsx
            <Route path="/rrhh/asistencia" element={<RequiereModulo modulo="asistencia"><Asistencia /></RequiereModulo>} />
```

- [ ] **Step 4: `src/state.jsx` — fuentes y acciones**

En `FUENTES` agregar:

```js
  asistenciaLotes: "v_asistencia_lotes",
  asistenciaConfig: "asistencia_config",
```

En `LOCAL` agregar (patrón «solo existe con conexión real»):

```js
  asistenciaLotes: [],  // asistencia: solo existe con conexión real
  asistenciaConfig: [],
```

En el objeto `acciones`, junto a los importadores de activos:

```js
    // RRH-22 — Importación de asistencias (#8). Vista previa PV999; la
    // importación reemplaza el rango completo (idempotente). La consulta de
    // marcaciones NO va por FUENTES: se pide por empresa+fecha bajo demanda
    // (la tabla crece por día y una recarga completa truncaría en 1000 filas).
    previsualizarAsistencia: async (empresaIdArg, registros, archivo, resumen) => {
      if (!supabaseListo) throw new Error("La importación de asistencia requiere conexión a Supabase.");
      const { data, error } = await supabase.rpc("previsualizar_asistencia", {
        p_empresa: empresaIdArg, p_registros: registros, p_archivo: archivo, p_resumen: resumen,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    importarAsistencia: async (empresaIdArg, registros, archivo, resumen) => {
      if (!supabaseListo) throw new Error("La importación de asistencia requiere conexión a Supabase.");
      const { data, error } = await supabase.rpc("importar_asistencia", {
        p_empresa: empresaIdArg, p_registros: registros, p_archivo: archivo,
        p_resumen: resumen, p_por: user?.nombre ?? user?.correo ?? "Administración",
      });
      if (error) throw new Error(error.message);
      await recargar("asistenciaLotes");
      return data;
    },
    cargarMarcaciones: async (empresaIdArg, fecha) => {
      if (!supabaseListo) return [];
      const { data, error } = await supabase.from("v_marcaciones").select("*")
        .eq("empresa", empresaIdArg).eq("fecha", fecha)
        .order("reconocido", { ascending: false }).order("nombre");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
```

- [ ] **Step 5: (junto con Task 5) build y commit único** — ver Task 5 Step 6.

---

### Task 5: Pantalla RRH-22 Asistencia + modal de importación

**Files:**
- Create: `src/pages/rrhh/Asistencia.jsx`
- Create: `src/pages/rrhh/ImportarAsistencia.jsx`
- Modify: `src/lib/importar/asistencia.js` (extraer `anomaliasDeMarcas` para reusar en la consulta)

**Interfaces:**
- Consumes: `parsearAsistencia` (Task 1), acciones de Task 4, `useApp()` (`db`, `user`, `empresaId`, `empresa`, `empresasActivas`), UI kit (`PageHeader, Card, Button, Note, Table, Td, Select, Modal, Badge`), `nivelDe` de `modulos.js`.
- Produces: `anomaliasDeMarcas(marcas, umbralDobleMin) → string[]` exportada del parser (la misma lógica que ya usan los tests — la suite debe seguir 9/9 tras el refactor).

- [ ] **Step 1: Refactor del parser — extraer `anomaliasDeMarcas`**

En `src/lib/importar/asistencia.js`, debajo de `sinCeros`, agregar la función y reemplazar el bloque inline de anomalías dentro de `analizarAsistencia` (las reglas incompleto/doble/invertido/sin_refrigerio salen; `hueco` se queda inline porque necesita las posiciones crudas):

```js
// Anomalías calculables desde la secuencia de marcas (se reusa en la consulta
// diaria de la pantalla; "hueco" no va aquí: necesita las posiciones crudas).
export function anomaliasDeMarcas(marcas, umbralDobleMin = 15) {
  const anomalias = [];
  if (marcas.length % 2 === 1) anomalias.push("incompleto");
  const mins = marcas.map(aMinutos);
  for (let k = 1; k < mins.length; k++) {
    if (mins[k] != null && mins[k - 1] != null && mins[k] - mins[k - 1] < umbralDobleMin && mins[k] - mins[k - 1] >= 0) {
      anomalias.push("doble"); break;
    }
  }
  for (let k = 1; k < mins.length; k++) {
    if (mins[k] != null && mins[k - 1] != null && mins[k] < mins[k - 1]) { anomalias.push("invertido"); break; }
  }
  if (marcas.length === 2 && mins[0] != null && mins[1] != null && mins[1] - mins[0] >= 12 * 60) {
    anomalias.push("sin_refrigerio");
  }
  return anomalias;
}
```

Y dentro del bucle de `analizarAsistencia`, el bloque desde `const anomalias = [];` hasta el `if (nMarcas === 2 ...)` queda:

```js
    const anomalias = hueco ? ["hueco"] : [];
    anomalias.push(...anomaliasDeMarcas(marcas, umbralDobleMin));
```

(OJO: conservar el orden de detección; `hueco` primero como hasta ahora.)

- [ ] **Step 2: Correr la suite del parser — debe seguir 9/9**

Run: `npx vitest run tests/importar/asistencia.test.js`
Expected: 9 passed. Si `dobles` cambia, el refactor alteró la regla: revisar.

- [ ] **Step 3: Modal `src/pages/rrhh/ImportarAsistencia.jsx`**

```jsx
import { useRef, useState } from "react";
import { useApp } from "../../state";
import { Modal, Note, Button, Select } from "../../components/ui";

const ETIQUETA = {
  incompletos: "marcaciones impares (falta una)",
  dobles: "dobles marcaciones bajo el umbral",
  sinRefrigerio: "jornadas sin refrigerio",
  invertidos: "horas en orden invertido",
  huecos: "huecos entre marcaciones",
  sinMarca: "días sin ninguna marcación (no son faltas)",
};

// RRH-22 — Importar reporte de marcaciones del reloj. La EMPRESA LA ELIGE EL
// USUARIO ANTES de cargar (el archivo del reloj no trae razón social); el
// sistema cuenta cuántos códigos pertenecen a esa empresa y bloquea si 0.
export default function ImportarAsistencia({ open, onClose }) {
  const { db, empresaId, empresasActivas, previsualizarAsistencia, importarAsistencia } = useApp();
  const [empresaSel, setEmpresaSel] = useState(empresaId);
  const [paso, setPaso] = useState(1); // 1 empresa+archivo · 2 vista previa · 3 resultado
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  const [rechazo, setRechazo] = useState(null);
  const [analisis, setAnalisis] = useState(null); // parser + nombre archivo
  const [previa, setPrevia] = useState(null);     // respuesta del RPC de vista previa
  const [resultado, setResultado] = useState(null);
  const sesionRef = useRef(0); // mismo mecanismo de vigencia que ADQ-08
  const umbral = db.asistenciaConfig?.[0]?.doble_marcacion_min ?? 15;
  const empresaObj = empresasActivas.find((e) => e.id === empresaSel);

  const cerrar = () => {
    sesionRef.current += 1;
    setPaso(1); setOcupado(false); setError(null); setRechazo(null);
    setAnalisis(null); setPrevia(null); setResultado(null);
    onClose();
  };

  const registrosPayload = (a) =>
    a.importables.map((r) => ({
      codigo: r.codigo, fecha: r.fecha,
      m1: r.marcas[0] ?? null, m2: r.marcas[1] ?? null,
      m3: r.marcas[2] ?? null, m4: r.marcas[3] ?? null,
    }));

  const analizar = async (archivo) => {
    const sesion = sesionRef.current;
    setError(null); setRechazo(null); setOcupado(true);
    try {
      const { parsearAsistencia } = await import("../../lib/importar/asistencia.js");
      const r = await parsearAsistencia(new Uint8Array(await archivo.arrayBuffer()), { umbralDobleMin: umbral });
      if (!r.importables.length) {
        if (sesionRef.current === sesion) setRechazo("El archivo no trae días importables (todas las fechas son futuras o no hay filas de datos).");
        return;
      }
      const a = { ...r, archivoNombre: archivo.name };
      // Vista previa contra la BD: resuelve códigos y bloquea si ninguno
      // pertenece a la empresa elegida (el error del RPC llega como rechazo).
      const p = await previsualizarAsistencia(empresaSel, registrosPayload(a), a.archivoNombre, a.stats);
      if (sesionRef.current !== sesion) return;
      setAnalisis(a); setPrevia(p); setPaso(2);
    } catch (e) {
      if (sesionRef.current === sesion) setRechazo(e.message);
    } finally {
      if (sesionRef.current === sesion) setOcupado(false);
    }
  };

  const confirmar = async () => {
    const sesion = sesionRef.current;
    setError(null); setOcupado(true);
    try {
      const r = await importarAsistencia(empresaSel, registrosPayload(analisis), analisis.archivoNombre, analisis.stats);
      if (sesionRef.current !== sesion) return;
      setResultado(r); setPaso(3);
    } catch (e) {
      if (sesionRef.current === sesion) setError(e.message);
    } finally {
      if (sesionRef.current === sesion) setOcupado(false);
    }
  };

  const anomaliasResumen = analisis
    ? Object.entries({
        incompletos: analisis.stats.incompletos, dobles: analisis.stats.dobles,
        sinRefrigerio: analisis.stats.sinRefrigerio, invertidos: analisis.stats.invertidos,
        huecos: analisis.stats.huecos, sinMarca: analisis.stats.sinMarca,
      }).filter(([, n]) => n > 0)
    : [];

  return (
    <Modal open={open} onClose={cerrar} title="RRH-22 · Importar marcaciones" wide>
      <div className="space-y-4">
        {paso === 1 && (
          <>
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-gris">Razón social a la que se sube</div>
              <Select value={empresaSel} onChange={(e) => setEmpresaSel(e.target.value)} disabled={ocupado}>
                {empresasActivas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </Select>
            </div>
            <label className={`block rounded-md border-2 border-dashed border-borde-f bg-papel/60 px-6 py-10 text-center hover:border-petroleo-cl ${ocupado ? "opacity-60" : "cursor-pointer"}`}>
              <input type="file" accept=".xlsx" className="hidden" disabled={ocupado}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) analizar(f); }} />
              <div className="text-[14px] font-semibold text-tinta-2">
                {ocupado ? "Leyendo el archivo…" : "Haz clic para elegir el reporte del reloj (.xlsx)"}
              </div>
              <div className="mt-1 text-[12px] text-gris">
                El archivo no trae razón social: se sube a la elegida arriba. Reimportar un periodo lo reemplaza completo.
              </div>
            </label>
            {rechazo && <Note tone="alerta">{rechazo}</Note>}
          </>
        )}

        {paso === 2 && analisis && previa && (
          <>
            <div className="rounded-caja border border-borde bg-papel/60 p-6 text-center">
              <div className="font-mono text-[10px] uppercase tracking-wide text-gris">Estas marcaciones serán subidas a</div>
              <div className="mt-1.5 font-display text-[22px] font-bold leading-tight text-tinta">{empresaObj?.nombre}</div>
              <div className="mt-3 text-[12.5px] text-gris">
                <b>{analisis.archivoNombre}</b> · del {previa.desde} al {previa.hasta} · {previa.filas} días-persona
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-md bg-conf-bg py-4"><div className="text-[22px] font-bold text-conf">{previa.reconocidos}</div><div className="font-mono text-[10px] uppercase text-gris">Trabajadores reconocidos</div></div>
              <div className="rounded-md bg-pend-bg py-4"><div className="text-[22px] font-bold text-pend">{previa.no_reconocidos.length}</div><div className="font-mono text-[10px] uppercase text-gris">Códigos sin resolver</div></div>
              <div className="rounded-md bg-papel py-4"><div className="text-[22px] font-bold text-tinta-2">{analisis.stats.futurasDescartadas}</div><div className="font-mono text-[10px] uppercase text-gris">Días futuros descartados</div></div>
            </div>
            {previa.no_reconocidos.length > 0 && (
              <Note tone="pend">
                Estos códigos no corresponden a ningún trabajador de {empresaObj?.corto} (se importan igual,
                marcados «no está en el maestro», por si la persona se da de alta después):{" "}
                <span className="font-mono text-[12px]">{previa.no_reconocidos.join(", ")}</span>
              </Note>
            )}
            {anomaliasResumen.length > 0 && (
              <Note tone="neutral">
                Para revisión de RRHH (nada de esto bloquea ni genera faltas):
                <ul className="mt-1 list-disc pl-4">
                  {anomaliasResumen.map(([k, n]) => <li key={k}>{n} {ETIQUETA[k]}</li>)}
                </ul>
              </Note>
            )}
            <Note tone="neutral">
              La importación reemplaza TODO el periodo {previa.desde} → {previa.hasta} de {empresaObj?.corto}:
              lo que había en ese rango se sustituye por este archivo (reimportar corrige, jamás duplica).
            </Note>
            {error && <Note tone="alerta">{error}</Note>}
            <div className="flex gap-2">
              <Button onClick={confirmar} disabled={ocupado}>
                {ocupado ? "Importando…" : `Sí, subir a ${empresaObj?.corto}`}
              </Button>
              <Button variant="secondary" onClick={cerrar} disabled={ocupado}>Cancelar</Button>
            </div>
          </>
        )}

        {paso === 3 && resultado && (
          <>
            <Note tone="conf">
              Marcaciones importadas a {empresaObj?.nombre}: {resultado.filas} días-persona del{" "}
              {resultado.desde} al {resultado.hasta}, {resultado.reconocidos} trabajadores reconocidos
              {resultado.no_reconocidos.length > 0 && ` y ${resultado.no_reconocidos.length} códigos sin resolver`}.
              El detalle se consulta abajo, día por día.
            </Note>
            <Button onClick={cerrar}>Cerrar</Button>
          </>
        )}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Página `src/pages/rrhh/Asistencia.jsx`**

```jsx
import { useEffect, useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { useApp } from "../../state";
import { PageHeader, Card, Button, Note, Table, Td, Badge, Input } from "../../components/ui";
import { nivelDe } from "../../data/modulos";
import { anomaliasDeMarcas } from "../../lib/importar/asistencia";
import ImportarAsistencia from "./ImportarAsistencia";

const OBSERVACION = {
  incompleto: ["pend", "Incompleto"],
  doble: ["pend", "Doble marcación"],
  invertido: ["alerta", "Orden invertido"],
  sin_refrigerio: ["pend", "Sin refrigerio"],
};

const aMin = (hhmm) => {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
// Horas referenciales: suma de pares completos (E→S refrigerio + retorno→salida,
// o el único par del día). La planilla sigue siendo la fuente de verdad.
const horasRef = (marcas) => {
  let total = 0;
  for (let i = 0; i + 1 < marcas.length; i += 2) {
    const a = aMin(marcas[i]), b = aMin(marcas[i + 1]);
    if (a == null || b == null || b < a) return null;
    total += b - a;
  }
  return marcas.length >= 2 && marcas.length % 2 === 0 ? total : null;
};
const fmtHoras = (min) => min == null ? "—" : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;

// RRH-22 — Asistencia: lotes importados + consulta de marcaciones por día.
// Solo lectura + importación; NO clasifica tardanzas ni faltas (sin horario
// modelado, un día sin marcación no es una falta).
export default function Asistencia() {
  const { db, user, empresaId, empresa, cargarMarcaciones } = useApp();
  const puedeImportar = nivelDe(user?.acceso, "asistencia") >= 2;
  const [abierto, setAbierto] = useState(false);
  const [fecha, setFecha] = useState("");
  const [filas, setFilas] = useState([]);
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const umbral = db.asistenciaConfig?.[0]?.doble_marcacion_min ?? 15;
  const lotes = useMemo(() => (db.asistenciaLotes ?? []).filter((l) => l.empresa === empresaId), [db.asistenciaLotes, empresaId]);

  // Fecha por defecto: el último día con datos de la empresa activa.
  useEffect(() => { setFecha(lotes[0]?.hasta ?? ""); }, [empresaId, lotes[0]?.hasta]);

  useEffect(() => {
    if (!fecha) { setFilas([]); return; }
    let vigente = true;
    setOcupado(true); setError(null);
    cargarMarcaciones(empresaId, fecha)
      .then((d) => { if (vigente) setFilas(d); })
      .catch((e) => { if (vigente) setError(e.message); })
      .finally(() => { if (vigente) setOcupado(false); });
    return () => { vigente = false; };
  }, [empresaId, fecha]);

  return (
    <>
      <PageHeader
        code="RRH-22 · Asistencia"
        title="Asistencia"
        subtitle="Marcaciones del reloj, importadas por razón social. Sin horario modelado no se clasifican tardanzas ni faltas: el cálculo es referencial y la planilla es la fuente de verdad."
        actions={puedeImportar && (
          <Button size="sm" onClick={() => setAbierto(true)}>
            <Upload size={13} /> Importar marcaciones
          </Button>
        )}
      />

      <div className="mb-4">
        <Note tone="neutral">
          Un día sin marcación <b>no</b> es una falta (relevos, descansos y permisos no están modelados).
          Reimportar un periodo lo reemplaza completo: corregir en el reloj y volver a subir.
        </Note>
      </div>

      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2.5 border-b border-borde bg-papel/50 p-3.5">
          <span className="font-mono text-[10px] uppercase tracking-wide text-gris">Marcaciones de {empresa?.corto} el día</span>
          <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={{ maxWidth: 170 }} />
        </div>
        {error && <div className="p-3.5"><Note tone="alerta">{error}</Note></div>}
        <Table head={["Documento", "Trabajador", "Entrada", "Salida refrigerio", "Retorno", "Salida", "Horas ref.", "Observación"]}>
          {filas.map((m) => {
            const marcas = [m.m1, m.m2, m.m3, m.m4].filter(Boolean);
            const anomalias = anomaliasDeMarcas(marcas, umbral);
            return (
              <tr key={m.documento} className="hover:bg-papel/60">
                <Td className="font-mono text-[12px]">{m.documento}</Td>
                <Td className="font-semibold">{m.reconocido ? m.nombre : <span className="text-gris">No está en el maestro</span>}</Td>
                <Td className="font-mono text-[12px]">{m.m1 ?? "—"}</Td>
                <Td className="font-mono text-[12px]">{m.m2 ?? "—"}</Td>
                <Td className="font-mono text-[12px]">{m.m3 ?? "—"}</Td>
                <Td className="font-mono text-[12px]">{m.m4 ?? "—"}</Td>
                <Td className="font-mono text-[12px]">{fmtHoras(horasRef(marcas))}</Td>
                <Td>
                  {marcas.length === 0
                    ? <Badge tone="neutral">Sin marcación</Badge>
                    : anomalias.length === 0
                      ? <Badge tone="conf">Completo</Badge>
                      : anomalias.map((a) => {
                          const [tone, texto] = OBSERVACION[a] ?? ["pend", a];
                          return <Badge key={a} tone={tone}>{texto}</Badge>;
                        })}
                </Td>
              </tr>
            );
          })}
          {!ocupado && filas.length === 0 && (
            <tr><Td colSpan={8} className="text-center text-gris">{fecha ? "Sin marcaciones ese día." : "Aún no hay lotes importados para esta empresa."}</Td></tr>
          )}
        </Table>
      </Card>

      <div className="mt-5">
        <Card pad={false}>
          <div className="border-b border-borde bg-papel/50 p-3.5 font-mono text-[10px] uppercase tracking-wide text-gris">
            Lotes importados de {empresa?.corto}
          </div>
          <Table head={["Archivo", "Periodo", "Trabajadores", "Días-persona", "Importado por", "Fecha"]}>
            {lotes.map((l) => (
              <tr key={l.id} className="hover:bg-papel/60">
                <Td className="font-semibold">{l.archivo}</Td>
                <Td className="font-mono text-[12px]">{l.desde} → {l.hasta}</Td>
                <Td>{l.trabajadores}</Td>
                <Td>{l.filas}</Td>
                <Td className="text-gris">{l.creado_por}</Td>
                <Td className="font-mono text-[12px] text-gris">{l.creado_en}</Td>
              </tr>
            ))}
            {lotes.length === 0 && (
              <tr><Td colSpan={6} className="text-center text-gris">Todavía no se importa ningún reporte para esta empresa.</Td></tr>
            )}
          </Table>
        </Card>
      </div>

      <ImportarAsistencia open={abierto} onClose={() => setAbierto(false)} />
    </>
  );
}
```

(OJO: verificar en `src/components/ui.jsx` que `Input` acepta `type="date"` y que `Td` acepta `colSpan` — si el kit no los pasa, usar `<input>`/`<td>` nativos con las mismas clases que usa el kit. Verificar también los tonos válidos de `Badge`/`Note`; si `neutral` no existe en Badge, usar el tono que use el resto del código para gris.)

- [ ] **Step 5: Suite completa + build**

Run: `npx vitest run` → Expected: todo verde (85+ tests, los 9 del parser incluidos).
Run: `npm run build` → Expected: build OK sin errores de imports.

- [ ] **Step 6: Commit (Tasks 4 y 5 juntos: el módulo entra completo y compilando)**

```powershell
git add src/data/modulos.js src/layout/Shell.jsx src/App.jsx src/state.jsx src/lib/importar/asistencia.js src/pages/rrhh/Asistencia.jsx src/pages/rrhh/ImportarAsistencia.jsx
git commit -m @'
feat(asistencia): modulo RRH-22 completo - pantalla, modal de importacion y cableado

Menu RRHH, ruta con guard, matriz de categorias (sin nivel de aprobacion),
modal con seleccion de razon social antes de cargar y confirmacion Si subir a X,
consulta de marcaciones por dia con horas referenciales y observaciones.
'@
```

---

### Task 6: Deploy y verificación en producción

**Files:**
- Modify: `docs/checklists/2026-08-21-flujos-e2e.md` (agregar el flujo de asistencia)

- [ ] **Step 1: Push (CI/CD deploya solo)**

```powershell
git push
```

- [ ] **Step 2: Verificar el deploy Ready**

```powershell
vercel ls intranet-general
```
Expected: el deployment más reciente `● Ready`. (Si falla, `vercel inspect --logs` del deployment.)

- [ ] **Step 3: Re-correr la verificación de BD contra prod (ya es prod, confirma que nada se rompió con el deploy)**

```powershell
& scripts/token-supabase.ps1 | Out-Null
node scripts/verificar-asistencia.mjs
```
Expected: todas ✓.

- [ ] **Step 4: Agregar al checklist e2e**

En `docs/checklists/2026-08-21-flujos-e2e.md`, sección RRHH, agregar:

```markdown
- [ ] **Asistencia (RRH-22):** entrar a RRHH→Asistencia → Importar marcaciones →
  elegir PROMANT → subir `Asistencia_21_8_2026_15_45_14.xlsx` (OneDrive/Tarea 21-08) →
  la vista previa reconoce trabajadores (>0) y lista códigos sin resolver →
  «Sí, subir a PROMANT» → consultar un día con datos: marcas, horas ref. y
  observaciones → reimportar el mismo archivo → los lotes se listan pero las
  marcaciones NO se duplican (reemplazo por rango).
```

- [ ] **Step 5: Commit y push del checklist**

```powershell
git add docs/checklists/2026-08-21-flujos-e2e.md
git commit -m @'
docs: flujo e2e de asistencia en el checklist
'@
git push
```

- [ ] **Step 6: Avisar a Diego**

Reportar: módulo Asistencia desplegado; puede probar con el archivo real de la Tarea 21-08 (elegir la RS a la que pertenecen esos 41 trabajadores). Recordarle las 2 cosas abiertas: (1) la regla de dobles marcaciones cuenta 6 en el archivo (el spec contó 2 mirando solo la entrada) — se lista, no bloquea; ¿restringir a la primera marcación?; (2) su categoría debe tener nivel ≥2 en el módulo nuevo Asistencia para ver el botón (el superadmin ya lo tiene).
