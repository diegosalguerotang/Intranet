# Movimientos de Planilla — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la importación mensual de la planilla unificada registre los movimientos de trabajadores — traslado de razón social (cerrando el vínculo anterior), cese confirmado por humano y retorno — y que todo quede como historial visible en el perfil (Legajo) del trabajador.

**Architecture:** Se extiende `importar_planilla_unificada` (todo dentro de la misma transacción, patrón PV999 para la vista previa): detecta traslados (cierra el vínculo vigente en la otra RS y abre el nuevo), detecta retornos (persona con todos sus vínculos cerrados que reaparece), calcula "posibles ceses" (vigentes de las RS del archivo que no vienen en él) y aplica SOLO los ceses que el usuario marcó en la vista previa. Cada evento se escribe en una tabla nueva `movimientos` (insert-only, patrón registro_accesos). El Legajo gana el historial real: todos los vínculos + los movimientos.

**Tech Stack:** Supabase (plpgsql, Management API para aplicar SQL), React 19 + Vite (BackOffice), suite Node `scripts/verificar-movimientos.mjs`.

## Global Constraints

- Decisiones de Diego (2026-08-24): el traslado de RS **SIEMPRE cierra el vínculo anterior**; el cese **JAMÁS es automático** (la ausencia solo propone, un humano confirma marcando en la vista previa); **todo movimiento queda como historial en el perfil**.
- Regla vigente que NO cambia: "jamás cesar por ausencia" sin confirmación humana.
- Fechas por defecto: vínculo nuevo = 1° del período (ya existe); cierre por traslado o cese = **último día del mes anterior al período**, con guard `greatest(fecha_inicio, …)` para no violar `fecha_fin >= fecha_inicio`.
- Alcance: SOLO el importador unificado. PLATRA1 mantiene su comportamiento (cese solo si el archivo trae fecha en su columna CESE).
- SQL: aplicar migraciones con `scripts/aplicar-sql.mjs` (token vía `scripts/token-supabase.ps1` — lo corre Diego si el clasificador bloquea). Para empalmar en canónicos usar Edit (jamás String.replace de Node por los `$$`). `schema.sql` en disco viene CRLF.
- Firmas de RPC que cambian se DROPean explícitamente (patrón del proyecto).
- Commits: el controlador (no subagentes), con here-strings PS5.1 SIN comillas dobles dentro del mensaje.
- La suite de BD usa datos `ZZPRUEBA` y limpia TODO al final (patrón verificar-solicitudes).

---

### Task 1: BD — tabla `movimientos`, trigger de inmutabilidad y vistas

**Files:**
- Create: `supabase/migraciones/2026-08-24-movimientos-planilla.sql` (parte 1: tabla+vistas)
- Modify: `supabase/schema.sql` (empalmar tabla y vistas al final de la sección de vínculos)
- Test: `scripts/verificar-movimientos.mjs` (pruebas 1–3)

**Interfaces:**
- Produces: tabla `movimientos(id, persona_dni, tipo, empresa_origen, empresa_destino, vinculo_cerrado, vinculo_abierto, fecha_efecto, periodo, detalle, creado_por, creado_en)` con `tipo in ('alta','traslado','cese','retorno')`; vistas `v_movimientos_persona` y `v_vinculos_persona` que la Task 5 lee por REST.

- [ ] **Step 1: Escribir la migración (tabla + trigger + vistas)**

```sql
-- Movimientos de planilla (2026-08-24): historial de altas, traslados,
-- ceses y retornos en el perfil del trabajador. Insert-only.
create table if not exists movimientos (
  id              bigint generated always as identity primary key,
  persona_dni     text not null references personas(dni),
  tipo            text not null check (tipo in ('alta','traslado','cese','retorno')),
  empresa_origen  text references empresas(id),   -- traslado/cese
  empresa_destino text references empresas(id),   -- alta/traslado/retorno
  vinculo_cerrado bigint references vinculos(id),
  vinculo_abierto bigint references vinculos(id),
  fecha_efecto    date not null,
  periodo         text,                            -- 'YYYY-MM' de la planilla origen
  detalle         text,
  creado_por      text not null,
  creado_en       timestamptz not null default now()
);
create index if not exists ix_movimientos_persona on movimientos (persona_dni, creado_en desc);

create or replace function fn_movimientos_solo_insertar() returns trigger
language plpgsql as $$
begin
  raise exception 'El historial de movimientos no se edita ni se borra.';
end $$;
drop trigger if exists tg_movimientos_inmutables on movimientos;
create trigger tg_movimientos_inmutables
  before update or delete on movimientos
  for each row execute function fn_movimientos_solo_insertar();

-- Historial completo de vínculos de una persona, con nombres.
create or replace view v_vinculos_persona as
select v.id, v.persona_dni as dni, v.empresa_id as empresa,
       e.nombre as "empresaNombre", s.nombre as "sedeNombre",
       v.cargo, v.centro_costo as "centroCosto", v.contrato,
       to_char(v.fecha_inicio, 'YYYY-MM-DD') as inicio,
       to_char(v.fecha_fin, 'YYYY-MM-DD') as fin,
       (v.fecha_fin is null) as vigente
from vinculos v
join empresas e on e.id = v.empresa_id
join sedes s on s.id = v.sede_id
order by v.fecha_inicio desc, v.id desc;

create or replace view v_movimientos_persona as
select m.id, m.persona_dni as dni, m.tipo,
       eo.nombre as "deEmpresa", ed.nombre as "aEmpresa",
       to_char(m.fecha_efecto, 'YYYY-MM-DD') as fecha,
       m.periodo, m.detalle, m.creado_por as por,
       to_char(m.creado_en, 'YYYY-MM-DD HH24:MI') as registrado
from movimientos m
left join empresas eo on eo.id = m.empresa_origen
left join empresas ed on ed.id = m.empresa_destino
order by m.creado_en desc;

grant select on v_vinculos_persona, v_movimientos_persona to anon, authenticated;
revoke all on movimientos from anon, authenticated;
```

- [ ] **Step 2: Aplicar la migración en producción** — `node scripts/aplicar-sql.mjs supabase/migraciones/2026-08-24-movimientos-planilla.sql` (si el clasificador bloquea el token, pedirle a Diego que lo corra con `!`).
- [ ] **Step 3: Empalmar tabla y vistas en `supabase/schema.sql`** (con Edit, después del bloque de `vinculos`; conservar CRLF).
- [ ] **Step 4: Crear `scripts/verificar-movimientos.mjs`** con el andamiaje (patrón verificar-solicitudes: `sql()` por Management API, contador de fallos) y las pruebas 1–3:

```js
// 1. la tabla existe y el trigger es inmutable
await prueba("movimientos es insert-only", async () => {
  await sql(`insert into movimientos (persona_dni, tipo, empresa_destino, fecha_efecto, creado_por)
    select dni, 'alta', 'negliaf', current_date, 'verificar-movimientos' from personas limit 1`);
  await esperaError("update movimientos set detalle='x' where creado_por='verificar-movimientos'",
    "no se edita", "update permitido");
  await esperaError("delete from movimientos where creado_por='verificar-movimientos'",
    "no se edita", "delete permitido");
});
// 2. v_vinculos_persona lista TODOS los vínculos (abrir uno cerrado de prueba y verlo)
// 3. v_movimientos_persona resuelve nombres de empresas
```

- [ ] **Step 5: Correr la suite (pruebas 1–3 en verde)** — la limpieza del final borra las filas ZZPRUEBA deshabilitando el trigger un instante (mismo patrón que solicitud_eventos).
- [ ] **Step 6: Commit** — `feat(bd): historial de movimientos de planilla (tabla insert-only + vistas de perfil)`.

---

### Task 2: BD — `importar_planilla_unificada` v2 con traslados, retornos y ceses confirmados

**Files:**
- Modify: `supabase/migraciones/2026-08-24-movimientos-planilla.sql` (parte 2: RPCs)
- Modify: `supabase/schema.sql` (reemplazar ambas funciones)
- Test: `scripts/verificar-movimientos.mjs` (pruebas 4–9)

**Interfaces:**
- Consumes: tabla `movimientos` de Task 1.
- Produces: `importar_planilla_unificada(p_filas jsonb, p_periodo text, p_por text, p_ceses jsonb default '[]')` — el resumen por empresa gana `traslados` (`[{documento,nombre,desde}]`), `retornos` (`[documento]`) y `cesados` (`[documento]`); la raíz gana `posiblesCeses` (`[{documento,nombre,empresa,empresaNombre}]`). `previsualizar_planilla_unificada(p_filas, p_periodo, p_ceses default '[]')` con passthrough. La UI (Task 3/4) depende de ESTOS nombres.

- [ ] **Step 1: Escribir las pruebas 4–9 en la suite (primero, TDD contra BD):**

```js
// Datos: personas ZZPRUEBA con vínculo vigente en L.AMERICANA; archivo del
// período '2026-08' que las trae bajo el RUC de NEGLIAF (traslado), no las
// trae (posible cese) o las trae tras estar cesadas (retorno).
// 4. TRASLADO: fila en otra RS → cierra el vínculo viejo (fecha_fin =
//    último día del mes anterior, nunca < fecha_inicio), abre el nuevo y
//    escribe movimiento tipo 'traslado' con origen/destino/ambos vínculos.
// 5. el resumen reporta traslados[] con desde=RS anterior (ya NO va en vinculosNuevos).
// 6. AUSENCIA sin confirmar: vigente que no viene en el archivo → aparece en
//    posiblesCeses[] y su vínculo SIGUE vigente (jamás cesa solo).
// 7. CESE CONFIRMADO: mismo archivo con p_ceses=['<doc>'] → fecha_fin puesta,
//    movimiento 'cese' con periodo y creado_por.
// 8. RETORNO: persona 100% cesada que reaparece → vínculo nuevo + movimiento
//    'retorno' (y el resumen lo lista en retornos[], no en altas).
// 9. ALTA nueva del maestro → movimiento 'alta'. La vista previa (PV999) no
//    deja NI movimientos NI ceses aplicados.
```

- [ ] **Step 2: Correr la suite → 4–9 fallan** (las columnas del resumen no existen aún).
- [ ] **Step 3: Escribir la v2 de las funciones en la migración.** Núcleo de los cambios dentro del loop existente (después de resolver `v_canon` y ANTES del insert de vínculo):

```sql
drop function if exists importar_planilla_unificada(jsonb, text, text);
drop function if exists previsualizar_planilla_unificada(jsonb, text);
-- (recrear con las firmas nuevas; cuerpo = el actual + estos bloques)

-- v_cierre: fecha de corte por defecto del período.
v_cierre := (p_periodo || '-01')::date - 1;

-- TRASLADO / RETORNO (solo personas ya existentes en el maestro):
if v_matches is not null then
  select id, empresa_id into v_vinculo_otro, v_emp_origen from vinculos
  where persona_dni = v_canon and fecha_fin is null and empresa_id <> v_emp
  limit 1;
  select not exists (select 1 from vinculos where persona_dni = v_canon and fecha_fin is null)
     and exists (select 1 from vinculos where persona_dni = v_canon)
    into v_es_retorno;
end if;

-- …en la rama "v_vinculo is null" (vínculo nuevo en v_emp), tras el insert
-- (usar "returning id into v_vinculo_nuevo"):
if v_vinculo_otro is not null then
  update vinculos set fecha_fin = greatest(fecha_inicio, v_cierre) where id = v_vinculo_otro;
  insert into movimientos (persona_dni, tipo, empresa_origen, empresa_destino,
    vinculo_cerrado, vinculo_abierto, fecha_efecto, periodo, detalle, creado_por)
  values (v_canon, 'traslado', v_emp_origen, v_emp, v_vinculo_otro, v_vinculo_nuevo,
    greatest((select fecha_inicio from vinculos where id = v_vinculo_otro), v_cierre),
    p_periodo, 'Importación de planilla', p_por);
  v_res := jsonb_set(v_res, array[v_emp, 'traslados'], (v_res #> array[v_emp, 'traslados'])
    || jsonb_build_object('documento', v_canon, 'nombre', v_nombre,
         'desde', (select nombre from empresas where id = v_emp_origen)));
elsif v_es_retorno then
  insert into movimientos (persona_dni, tipo, empresa_destino, vinculo_abierto,
    fecha_efecto, periodo, detalle, creado_por)
  values (v_canon, 'retorno', v_emp, v_vinculo_nuevo, v_fecha, p_periodo,
    'Importación de planilla', p_por);
  v_res := jsonb_set(v_res, array[v_emp, 'retornos'],
    (v_res #> array[v_emp, 'retornos']) || to_jsonb(v_canon));
elsif v_matches is null then  -- alta nueva del maestro
  insert into movimientos (persona_dni, tipo, empresa_destino, vinculo_abierto,
    fecha_efecto, periodo, detalle, creado_por)
  values (v_canon, 'alta', v_emp, v_vinculo_nuevo, v_fecha, p_periodo,
    'Importación de planilla', p_por);
end if;

-- DESPUÉS del loop de filas: posibles ceses y ceses confirmados.
-- Posibles: vigentes de las empresas del archivo cuyo documento (sin ceros)
-- no aparece en NINGUNA fila (si apareció en otra RS ya fue traslado).
select coalesce(jsonb_agg(jsonb_build_object('documento', x.dni, 'nombre', x.nombre,
         'empresa', x.empresa_id, 'empresaNombre', x.emp_nombre)), '[]'::jsonb)
  into v_posibles
from (
  select p.dni, p.nombre, v.empresa_id, e.nombre as emp_nombre
  from vinculos v join personas p on p.dni = v.persona_dni
  join empresas e on e.id = v.empresa_id
  where v.fecha_fin is null
    and v.empresa_id in (select value #>> '{}' from jsonb_each_text(v_map) as t(k, value))
    and regexp_replace(upper(p.dni), '^0+(?=.)', '') not in (
      select regexp_replace(upper(trim(f2->>'documento')), '^0+(?=.)', '')
      from jsonb_array_elements(p_filas) f2)
) x;

-- Confirmados (p_ceses = lista de documentos que el usuario marcó):
for v_doc in select value #>> '{}' from jsonb_array_elements(p_ceses) loop
  select v.id, v.persona_dni, v.empresa_id into v_vinculo, v_canon, v_emp_origen
  from vinculos v join personas p on p.dni = v.persona_dni
  where v.fecha_fin is null
    and regexp_replace(upper(p.dni), '^0+(?=.)', '') = regexp_replace(upper(trim(v_doc)), '^0+(?=.)', '');
  if v_vinculo is null then
    v_problemas := v_problemas || jsonb_build_object('documento', v_doc,
      'motivo', 'Cese confirmado pero sin vínculo vigente: revísalo.');
    continue;
  end if;
  update vinculos set fecha_fin = greatest(fecha_inicio, v_cierre) where id = v_vinculo;
  insert into movimientos (persona_dni, tipo, empresa_origen, vinculo_cerrado,
    fecha_efecto, periodo, detalle, creado_por)
  values (v_canon, 'cese', v_emp_origen, v_vinculo,
    greatest((select fecha_inicio from vinculos where id = v_vinculo), v_cierre),
    p_periodo, 'Cese confirmado en importación de planilla', p_por);
  v_res := jsonb_set(v_res, array[v_emp_origen, 'cesados'],
    coalesce(v_res #> array[v_emp_origen, 'cesados'], '[]'::jsonb) || to_jsonb(v_canon));
end loop;

-- return: agregar 'posiblesCeses', v_posibles al jsonb_build_object final;
-- inicializar 'traslados','retornos','cesados' como '[]' en v_res por empresa.
```

- [ ] **Step 4: Aplicar la migración completa en producción y correr la suite → 1–9 en verde.**
- [ ] **Step 5: Empalmar las funciones nuevas en `supabase/schema.sql`** (reemplazo completo de ambas, con Edit).
- [ ] **Step 6: Commit** — `feat(bd): traslados, retornos y ceses confirmados en la planilla unificada con historial de movimientos`.

---

### Task 3: Frontend — estado y llamadas RPC

**Files:**
- Modify: `src/state.jsx` (funciones `previsualizarPlanillaUnificada`, `importarPlanillaUnificada` ~líneas 530–550; agregar 2 lectores)

**Interfaces:**
- Consumes: firmas nuevas de Task 2.
- Produces: `previsualizarPlanillaUnificada(filas, periodo)` (sin cambios de firma; el resultado ahora trae `posiblesCeses` y por empresa `traslados/retornos/cesados`); `importarPlanillaUnificada(filas, periodo, ceses = [])`; `historialVinculos(dni)` y `historialMovimientos(dni)` que leen `v_vinculos_persona` / `v_movimientos_persona` por REST (patrón de los selects existentes, con fallback `[]` en modo mock).

- [ ] **Step 1: Pasar `p_ceses` en la llamada de importación:**

```js
const importarPlanillaUnificada = async (filas, periodo, ceses = []) => {
  const { data, error } = await supabase.rpc("importar_planilla_unificada", {
    p_filas: filas, p_periodo: periodo, p_por: user?.email ?? "backoffice", p_ceses: ceses,
  });
  if (error) throw new Error(error.message);
  return data;
};
```

- [ ] **Step 2: Agregar los lectores del historial (mismo helper REST/rpc del archivo):**

```js
const historialVinculos = async (dni) =>
  (await supabase.from("v_vinculos_persona").select("*").eq("dni", dni)).data ?? [];
const historialMovimientos = async (dni) =>
  (await supabase.from("v_movimientos_persona").select("*").eq("dni", dni)).data ?? [];
```

- [ ] **Step 3: Exportarlos en el value del provider** (junto a `editarTrabajador`). `npm run build` para confirmar que compila.
- [ ] **Step 4: Commit** — `feat(estado): ceses confirmados y lectores de historial de vinculos/movimientos`.

---

### Task 4: Frontend — vista previa con movimientos y checklist de ceses (RRH-05, paso 5/6)

**Files:**
- Modify: `src/pages/rrhh/Personal.jsx` (modal de importación: estado `cesesMarcados`, render paso 5 tras el bloque de `cambiosCuenta` ~línea 763, resultado paso 6 ~línea 795, y `confirmarUnificada` ~línea 637)

**Interfaces:**
- Consumes: `uni.previa.posiblesCeses`, `e.traslados/retornos/cesados`, `importarPlanillaUnificada(filas, periodo, ceses)`.

- [ ] **Step 1: Estado nuevo + pasar los marcados al confirmar:**

```js
const [cesesMarcados, setCesesMarcados] = useState([]); // documentos confirmados
// en cerrar(): setCesesMarcados([]);
// en confirmarUnificada(): importarPlanillaUnificada(uni.filas, uni.periodo, cesesMarcados)
```

- [ ] **Step 2: Paso 5 — lista de traslados (tras cambiosCuenta):**

```jsx
{empresasDe(uni.previa).flatMap((e) => e.traslados.map((t) => ({ ...t, a: e.nombre }))).length > 0 && (
  <Note tone="pend">
    Traslados de razón social (el vínculo anterior SE CIERRA al confirmar):
    <ul className="mt-1 list-disc pl-4">
      {empresasDe(uni.previa).flatMap((e) => e.traslados.map((t) => ({ ...t, a: e.nombre }))).map((t, i) => (
        <li key={i}>{t.nombre} ({t.documento}): {t.desde} → {t.a}</li>
      ))}
    </ul>
  </Note>
)}
```

- [ ] **Step 3: Paso 5 — checklist de posibles ceses (nadie marcado por defecto):**

```jsx
{(uni.previa.posiblesCeses ?? []).length > 0 && (
  <Note tone="pend">
    {uni.previa.posiblesCeses.length} vigentes no vienen en esta planilla. Marca SOLO a quienes ya
    no trabajan (su vínculo se cierra con fecha fin de {/* mes anterior al período */ uni.periodo}
    y queda en su historial); los demás siguen igual:
    <ul className="mt-1 space-y-0.5">
      {uni.previa.posiblesCeses.map((c) => (
        <li key={c.documento}>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={cesesMarcados.includes(c.documento)}
              onChange={(ev) => setCesesMarcados((m) => ev.target.checked
                ? [...m, c.documento] : m.filter((d) => d !== c.documento))} />
            <span>{c.nombre} ({c.documento}) — {c.empresaNombre}</span>
          </label>
        </li>
      ))}
    </ul>
  </Note>
)}
```

- [ ] **Step 4: Paso 5 — retornos como Note informativo** (`e.retornos`: "vuelven al grupo, se les abre vínculo nuevo") y el botón de confirmar menciona los ceses: `` `Sí, subir${cesesMarcados.length ? ` y cesar a ${cesesMarcados.length}` : ""}` ``.
- [ ] **Step 5: Paso 6 — resultado con movimientos:** al texto por empresa agregar `traslados.length` traslados, `retornos.length` retornos, `(e.cesados ?? []).length` ceses aplicados.
- [ ] **Step 6: `npm run build` + prueba manual con el fixture local** (vista previa es inocua en prod; verificar que sin marcar nadie no cesa nadie).
- [ ] **Step 7: Commit** — `feat(rrhh): vista previa de la planilla con traslados, retornos y checklist de ceses confirmados`.

---

### Task 5: Frontend — historial real en el Legajo (RRH-03, pestaña Vínculos)

**Files:**
- Modify: `src/pages/rrhh/Legajo.jsx` (pestaña `tab === 1`, líneas 130–148; imports y efecto de carga)

**Interfaces:**
- Consumes: `historialVinculos(dni)`, `historialMovimientos(dni)` de Task 3.

- [ ] **Step 1: Cargar el historial al entrar a la pestaña:**

```jsx
const { historialVinculos, historialMovimientos } = useApp(); // sumar al destructuring
const [historial, setHistorial] = useState(null); // {vinculos, movimientos}
useEffect(() => {
  if (tab !== 1 || historial) return;
  Promise.all([historialVinculos(dni), historialMovimientos(dni)])
    .then(([vinculos, movimientos]) => setHistorial({ vinculos, movimientos }))
    .catch(() => setHistorial({ vinculos: [], movimientos: [] }));
}, [tab, dni, historial]);
```

- [ ] **Step 2: Reemplazar la fila única por TODOS los vínculos** (mismas columnas; con fallback a la fila actual si el historial llega vacío en modo mock):

```jsx
{(historial?.vinculos?.length ? historial.vinculos : [{ id: 0, empresaNombre: e?.nombre,
  sedeNombre: s?.nombre, cargo: p.cargo, inicio: p.ingreso, fin: p.cese, vigente: p.estado === "vigente" }])
  .map((v) => (
  <tr key={v.id}>
    <Td className="font-semibold">{v.empresaNombre}</Td>
    <Td>{v.sedeNombre}</Td>
    <Td>{v.cargo}</Td>
    <Td className="font-mono text-[12px]">{v.inicio}</Td>
    <Td className="font-mono text-[12px]">{v.fin ?? "—"}</Td>
    <Td><Badge tone={v.vigente ? "conf" : "neutral"}>{v.vigente ? "Vigente" : "Cerrado"}</Badge></Td>
  </tr>
))}
```

- [ ] **Step 3: Debajo, la tarjeta "Historial de movimientos"** (tabla Fecha | Movimiento | Detalle | Registrado por; `tipo` con Badge: alta=conf, traslado=pend, cese=neutral, retorno=tinta; detalle = `deEmpresa → aEmpresa` para traslado, la empresa sola para el resto; vacío = EmptyState "Sin movimientos registrados — los generan las importaciones de planilla").
- [ ] **Step 4: `npm run build` + revisar en el navegador con un trabajador real.**
- [ ] **Step 5: Commit** — `feat(rrhh): historial completo de vinculos y movimientos en el legajo`.

---

### Task 6: Verificación E2E, checklist y cierre

**Files:**
- Modify: `scripts/verificar-movimientos.mjs` (prueba 10: E2E por el proxy de producción)
- Modify: `docs/checklists/2026-08-21-flujos-e2e.md` (flujo C1d nuevo)

- [ ] **Step 1: Prueba 10 — E2E real:** con admin temporal (patrón verificar-cuentas-masa) llamar `previsualizar_planilla_unificada` e `importar_planilla_unificada` VÍA `/api/supa` con un juego ZZPRUEBA de 2 filas (un traslado y una ausencia con cese confirmado) y verificar por SQL: vínculo viejo cerrado, movimientos escritos, v_vinculos_persona/v_movimientos_persona correctas. Limpieza total (movimientos con trigger off un instante, vínculos, personas, admin).
- [ ] **Step 2: Correr la suite completa (10/10) + `npm test` (113) + `npm run build`.**
- [ ] **Step 3: Checklist — sección C1d "Movimientos de planilla":** traslado cierra el viejo y sale en el Legajo; ausencia sin marcar NO cesa; cese marcado cesa con fecha fin de mes anterior; retorno abre vínculo nuevo; historial visible en la pestaña Vínculos.
- [ ] **Step 4: Actualizar el Word del plan de pruebas** (regenerar con el generador del scratchpad sumando C1d a la sección 3.5).
- [ ] **Step 5: Commit final + push** (deploy automático a Vercel) — `test(planilla): E2E de movimientos y checklist C1d`.
