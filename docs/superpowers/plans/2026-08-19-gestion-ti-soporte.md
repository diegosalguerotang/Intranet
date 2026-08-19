# Gestión de TI + Módulo Soporte — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renombrar Administración → Gestión de TI, adoptar la tabla de activos estilo PROMANT (IP, clave de equipo, antivirus), crear el módulo Soporte (tickets de incidencias TI copiado del sistema promant.pe/correo) y actualizar la data con sus 30 activos.

**Architecture:** Mismos patrones del proyecto: lógica en RPCs security definer, lectura por vistas v_*, canónicos en supabase/ + migración idempotente aplicada con `node scripts/aplicar-sql.mjs`, UI React con componentes de `src/components/ui.jsx`, Portal en Preact con `portal/src/lib/api.js`. Frontera acordada con Diego: **Soporte = incidencias TI** (sin cadena de aprobación ni PDF); las solicitudes formales van al Centro de Solicitudes (plan aparte).

**Tech Stack:** React 19 + Vite 7 + Tailwind 4, Supabase (RPC/vistas), Preact (portal), serverless Vercel (`api/`).

**Fuente:** `docs/requerimientos/2026-08-19-gestion-ti-soporte.md` (levantamiento del sistema PHP de PROMANT, incluye los 30 activos con IP y el catálogo completo de tipos/subtipos).

## Global Constraints

- Decisiones de Diego (2026-08-19): tickets desde **Portal + BackOffice**; clave de equipo **solo superadmin**; el renombre aplica a **todo** el módulo Administración.
- Los códigos internos ADQ-* NO cambian (son estables); solo cambian textos visibles.
- Numeración de tickets **secuencial legible** `TK-0001` (patrón U-000N/S-0001), NO aleatoria tipo PROMANT.
- Módulo de accesos nuevo: id `soporte` (aditivo: matriz sin la clave = nivel 0; superadmin = 3).
- SQL canónico nuevo `supabase/soporte.sql` se aplica SIEMPRE después de `portal.sql` (usa `portal_dni()`).
- Para empalmar SQL en canónicos usar split/join o edición directa, JAMÁS String.replace (los `$$` se corrompen).
- Migraciones idempotentes (drop if exists / on conflict), aplicadas con `node scripts/aplicar-sql.mjs supabase/migraciones/<archivo>.sql`.
- Commits los hace el controlador (los subagentes no corren git). Mensajes en español, estilo del repo.
- Verificación antes de afirmar éxito: `npm test` + script verificar-*.mjs contra producción.

---

### Task 1: Renombrar Administración → Gestión de TI

**Files:**
- Modify: `src/layout/Shell.jsx:132` (título del NavGroup)
- Modify: `src/pages/admin/Inventario.jsx` (subtítulo sin cambios de código ADQ)

**Interfaces:**
- Produces: menú lateral con grupo "Gestión de TI"; nada más cambia.

- [ ] **Step 1: Cambiar el título del grupo en Shell.jsx**

En `src/layout/Shell.jsx` reemplazar:
```jsx
<NavGroup title="Administración" items={NAV_ADMIN} acceso={acceso} />
```
por:
```jsx
<NavGroup title="Gestión de TI" items={NAV_ADMIN} acceso={acceso} />
```

- [ ] **Step 2: Verificar que no queden otros "Administración" visibles del módulo**

Run: `grep -rn "Administración" src --include=*.jsx`
Esperado: solo usos genéricos (p_por fallback "Administración" en state.jsx se queda: es texto de auditoría, no del menú).

- [ ] **Step 3: Commit**

```bash
git add src/layout/Shell.jsx
git commit -m "feat(ti): el módulo Administración pasa a llamarse Gestión de TI"
```

---

### Task 2: BD — IP y clave de equipo en activos, antivirus en asignaciones, data PROMANT

**Files:**
- Create: `supabase/migraciones/2026-08-19-gestion-ti.sql`
- Modify: `supabase/schema.sql` (sincronizar canónico: columnas + v_activos + RPCs)

**Interfaces:**
- Produces: columnas `activos.ip`, `activos.clave_equipo`; `asignaciones.antivirus boolean`, `asignaciones.comentario text`. Vista `v_activos` con `ip`, `antivirus`, `comentario_asignacion`. RPCs: `editar_activo(p_codigo, p_nuevo_codigo, p_tipo, p_marca, p_modelo, p_serie, p_area, p_asignado_sin_confirmar, p_observaciones, p_por, p_ip)` (firma vieja DROPeada), `asignar_activo(p_codigo, p_dni, p_condicion, p_antivirus, p_comentario)` (default null/null — compatible), `guardar_clave_equipo(p_codigo, p_clave)` y `ver_clave_equipo(p_codigo) returns text` — ambas exigen `fn_nivel_modulo('activos') >= 99` (solo superadmin; llamadas de servicio también pasan) y auditan.
- La clave_equipo JAMÁS aparece en v_activos ni en exportaciones.

- [ ] **Step 1: Escribir la migración**

`supabase/migraciones/2026-08-19-gestion-ti.sql`:

```sql
-- Gestión de TI (2026-08-19): campos estilo sistema PROMANT.
-- Idempotente. Aplicar con: node scripts/aplicar-sql.mjs supabase/migraciones/2026-08-19-gestion-ti.sql

alter table activos add column if not exists ip text;
alter table activos add column if not exists clave_equipo text; -- SOLO superadmin la lee (RPC auditada)
alter table asignaciones add column if not exists antivirus boolean;
alter table asignaciones add column if not exists comentario text;

-- v_activos: + ip + datos de la asignación abierta. NUNCA clave_equipo.
drop view if exists v_activos;
create view v_activos as
select ac.codigo, ac.categoria, ac.marca, ac.modelo, ac.serie, ac.imei,
       case when ac.estado_fisico = 'baja' then 'baja'
            when ac.estado_fisico = 'mantenimiento' then 'mantenimiento'
            when asg.id is not null then 'asignado'
            else 'disponible' end as estado,
       asg.persona_dni as asignado,
       asg.antivirus, asg.comentario as comentario_asignacion,
       coalesce(vi.sede_id, ac.sede_id) as sede,
       ac.empresa_id as empresa, ac.valor,
       to_char(ac.compra, 'YYYY-MM-DD') as compra,
       ac.tipo, ac.area, ac.asignado_sin_confirmar, ac.usuario_anterior, ac.observaciones,
       ac.por_corregir, ac.ip,
       (ac.clave_equipo is not null) as tiene_clave
from activos ac
left join asignaciones asg on asg.activo_codigo = ac.codigo and asg.devuelto_en is null
left join vinculos vi on vi.persona_dni = asg.persona_dni and vi.fecha_fin is null;

-- asignar_activo: + antivirus/comentario (defaults null: compatible con llamadas viejas).
create or replace function asignar_activo(
  p_codigo text, p_dni text, p_condicion text default 'Buen estado',
  p_antivirus boolean default null, p_comentario text default null
) returns void language plpgsql security definer as $$
begin
  if exists (select 1 from asignaciones where activo_codigo = p_codigo and devuelto_en is null) then
    raise exception 'El activo % ya está asignado. Regístrese la devolución primero.', p_codigo;
  end if;
  if (select estado_fisico from activos where codigo = p_codigo) <> 'operativo' then
    raise exception 'El activo % no está operativo.', p_codigo;
  end if;
  insert into asignaciones (activo_codigo, persona_dni, condicion_entrega, antivirus, comentario)
  values (p_codigo, p_dni, p_condicion, p_antivirus, nullif(trim(coalesce(p_comentario,'')), ''));
end $$;

-- editar_activo: + p_ip. Se DROPea la firma vieja (10 args) para no dejar sobrecarga ambigua.
drop function if exists editar_activo(text,text,text,text,text,text,text,text,text,text);
create function editar_activo(
  p_codigo text, p_nuevo_codigo text, p_tipo text, p_marca text, p_modelo text,
  p_serie text, p_area text, p_asignado_sin_confirmar text, p_observaciones text,
  p_por text default 'Gestión de TI', p_ip text default null
) returns void language plpgsql security definer as $$
declare v_nuevo text; j_antes jsonb; j_despues jsonb;
begin
  if not exists (select 1 from activos where codigo = p_codigo) then
    raise exception 'El activo % no existe.', p_codigo;
  end if;
  v_nuevo := trim(coalesce(p_nuevo_codigo, ''));
  if v_nuevo = '' then
    raise exception 'El activo necesita un código.';
  end if;
  if v_nuevo <> p_codigo and exists (select 1 from activos where codigo = v_nuevo) then
    raise exception 'Ya existe un activo con el código %.', v_nuevo;
  end if;

  select to_jsonb(ac) - 'clave_equipo' into j_antes from activos ac where codigo = p_codigo;
  update activos set
    codigo = v_nuevo,
    tipo = nullif(trim(coalesce(p_tipo, '')), ''),
    marca = nullif(trim(coalesce(p_marca, '')), ''),
    modelo = nullif(trim(coalesce(p_modelo, '')), ''),
    serie = nullif(trim(coalesce(p_serie, '')), ''),
    area = nullif(trim(coalesce(p_area, '')), ''),
    ip = nullif(trim(coalesce(p_ip, '')), ''),
    asignado_sin_confirmar = nullif(trim(coalesce(p_asignado_sin_confirmar, '')), ''),
    observaciones = nullif(trim(coalesce(p_observaciones, '')), ''),
    por_corregir = case when v_nuevo <> p_codigo then false else por_corregir end
  where codigo = p_codigo;
  select to_jsonb(ac) - 'clave_equipo' into j_despues from activos ac where codigo = v_nuevo;

  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('EDITAR_ACTIVO', 'activos',
    j_antes || jsonb_build_object('por', p_por), j_despues);
end $$;

-- Clave del equipo: escribir y leer SOLO superadmin (fn_nivel_modulo devuelve 99
-- para superadmin y para llamadas de servicio sin JWT). Todo acceso queda auditado.
create or replace function guardar_clave_equipo(p_codigo text, p_clave text, p_por text default 'Gestión de TI')
returns void language plpgsql security definer as $$
begin
  if fn_nivel_modulo('activos') < 99 then
    raise exception 'Solo el superadministrador administra claves de equipos.';
  end if;
  if not exists (select 1 from activos where codigo = p_codigo) then
    raise exception 'El activo % no existe.', p_codigo;
  end if;
  update activos set clave_equipo = nullif(trim(coalesce(p_clave,'')), '') where codigo = p_codigo;
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('CLAVE_EQUIPO_GUARDADA', 'activos',
    jsonb_build_object('codigo', p_codigo, 'por', p_por), null);
end $$;

create or replace function ver_clave_equipo(p_codigo text, p_por text default 'Gestión de TI')
returns text language plpgsql security definer as $$
declare v text;
begin
  if fn_nivel_modulo('activos') < 99 then
    raise exception 'Solo el superadministrador puede ver claves de equipos.';
  end if;
  select clave_equipo into v from activos where codigo = p_codigo;
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('CLAVE_EQUIPO_VISTA', 'activos',
    jsonb_build_object('codigo', p_codigo, 'por', p_por), null);
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Data del sistema TI de PROMANT (promant.pe/correo, extraída 2026-08-19):
-- IP siempre; modelo SOLO si el nuestro está vacío (el suyo describe el
-- monitor en las PC). 'Antigua' no es IP: va a observaciones.
-- ---------------------------------------------------------------------------
create or replace function fn_ti_promant(p_codigo text, p_ip text, p_modelo text)
returns void language plpgsql as $$
begin
  update activos set
    ip = coalesce(nullif(trim(coalesce(p_ip,'')),''), ip),
    modelo = coalesce(modelo, nullif(trim(coalesce(p_modelo,'')),''))
  where codigo = p_codigo and empresa_id = 'promant';
end $$;

select fn_ti_promant('PROLT01', null,            'LENOVO');
select fn_ti_promant('PROLT04', '192.168.1.185', 'LENOVO');
select fn_ti_promant('PROLT05', '192.168.1.172', 'LENOVO');
select fn_ti_promant('PROLT06', null,            'HP');
select fn_ti_promant('PROLT07', null,            'LENOVO');
select fn_ti_promant('PROLT13', null,            'HP');
select fn_ti_promant('PROLT16', null,            'LENOVO');
select fn_ti_promant('PROLT17', null,            'DELL');
select fn_ti_promant('PROLT19', '192.168.1.145', 'HP');
select fn_ti_promant('PROLT20', '192.168.1.171', 'INSPIRON 3421');
select fn_ti_promant('PROLT23', '192.168.1.147', 'LENOVO');
select fn_ti_promant('PROLT24', '192.168.1.113', 'LENOVO');
select fn_ti_promant('PROLT25', null,            'ASUS');
select fn_ti_promant('PROLT26', '192.168.1.213', 'ASUSTEK');
select fn_ti_promant('PROLT47', '192.168.1.207', 'LENOVO');
select fn_ti_promant('PROLT51', '192.168.1.202', 'LENOVO');
select fn_ti_promant('PROLT54', '192.168.1.25',  'ACER');
select fn_ti_promant('PROLT09', '192.168.1.100', 'GIGABYTE TECHNOLOGY CO.');
select fn_ti_promant('PROPC02', '192.168.1.102', 'MONITOR AOC');
select fn_ti_promant('PROPC03', '192.168.1.246', 'MONITOR AOC');
select fn_ti_promant('PROPC08', '192.168.1.232', 'MONITOR AOC');
select fn_ti_promant('PROPC10', null,            'MONITOR LG');
select fn_ti_promant('PROPC14', null,            'MONITOR BENQ');
select fn_ti_promant('PROPC15', null,            'MONITOR SAMSUNG');
select fn_ti_promant('PROPC18', null,            'MONITOR AOC');
select fn_ti_promant('PROPC21', '192.168.1.173', 'MONITOR SAMSUNG');
select fn_ti_promant('PROPC22', '192.168.1.141', 'MONITOR SAMSUNG');
select fn_ti_promant('PROPC31', '192.168.1.154', 'MONITOR: LG');
select fn_ti_promant('PROPC46', '192.168.1.109', 'MONITOR AOC');
select fn_ti_promant('PROPC49', null,            'MONITOR A320M -S2H');

-- PROPC10: en su sistema el campo IP dice 'Antigua' (dato sucio) — a observaciones.
update activos set observaciones = trim(both '; ' from coalesce(observaciones,'') || '; equipo antiguo (TI PROMANT)')
where codigo = 'PROPC10' and empresa_id = 'promant'
  and coalesce(observaciones,'') not like '%equipo antiguo (TI PROMANT)%';

drop function fn_ti_promant(text, text, text);

grant select on v_activos to authenticated;
```

- [ ] **Step 2: Aplicar la migración**

Run: `node scripts/aplicar-sql.mjs supabase/migraciones/2026-08-19-gestion-ti.sql`
Esperado: sin errores.

- [ ] **Step 3: Verificación puntual de la data**

Run (Management API vía Node, patrón del proyecto — NO ConvertTo-Json de PS5.1):
```
select codigo, ip, modelo from v_activos where empresa = 'promant' and ip is not null order by codigo limit 5;
```
Esperado: PROLT04→192.168.1.185, PROLT05→192.168.1.172, etc. y `select count(*) from activos where ip is not null` ≈ 19.

- [ ] **Step 4: Sincronizar el canónico schema.sql**

Editar `supabase/schema.sql` (edición directa, no String.replace):
- En `create table activos (...)`: agregar `ip text,` y `clave_equipo text,` después de `observaciones text,`.
- En `create table asignaciones (...)`: agregar `antivirus boolean,` y `comentario text,` antes de `destino`.
- Reemplazar `create view v_activos ...` por la versión nueva (idéntica a la migración).
- Reemplazar `asignar_activo` y `editar_activo` por las versiones nuevas; añadir `guardar_clave_equipo` y `ver_clave_equipo` a continuación de `editar_activo`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migraciones/2026-08-19-gestion-ti.sql supabase/schema.sql
git commit -m "feat(ti): ip y clave de equipo en activos, antivirus en asignaciones + data del TI de PROMANT"
```

---

### Task 3: UI — tabla de activos estilo PROMANT

**Files:**
- Modify: `src/pages/admin/Inventario.jsx`
- Modify: `src/state.jsx` (asignarActivo con antivirus/comentario; editarActivo con ip; nuevas acciones guardarClaveEquipo/verClaveEquipo)

**Interfaces:**
- Consumes: `v_activos` con `ip`, `antivirus`, `comentario_asignacion`, `tiene_clave`; RPCs de Task 2.
- Produces: `asignarActivo(codigo, dni, sedeId, antivirus, comentario)`, `editarActivo(codigo, cambios)` donde cambios incluye `ip`; `guardarClaveEquipo(codigo, clave)`, `verClaveEquipo(codigo) → string`.

- [ ] **Step 1: state.jsx — extender acciones**

En `src/state.jsx`, reemplazar la acción `asignarActivo` y extender `editarActivo`; añadir las de clave (junto a editarActivo):
```js
asignarActivo: (codigo, dni, sedeId, antivirus = null, comentario = null) => {
  // (mantener lo existente y añadir los args nuevos)
  rpc("asignar_activo", { p_codigo: codigo, p_dni: dni, p_antivirus: antivirus, p_comentario: comentario }, "activos");
},
```
En `editarActivo`, añadir `p_ip: cambios.ip` al objeto de args del RPC `editar_activo`.
Nuevas acciones:
```js
guardarClaveEquipo: async (codigo, clave) => {
  const { error } = await supabase.rpc("guardar_clave_equipo", { p_codigo: codigo, p_clave: clave, p_por: user?.nombre ?? "Gestión de TI" });
  if (error) throw new Error(error.message);
  await recargar("activos");
},
verClaveEquipo: async (codigo) => {
  const { data, error } = await supabase.rpc("ver_clave_equipo", { p_codigo: codigo, p_por: user?.nombre ?? "Gestión de TI" });
  if (error) throw new Error(error.message);
  return data;
},
```
(Seguir el patrón exacto de las acciones vecinas para nombres `rpc`/`recargar` del archivo.)

- [ ] **Step 2: Inventario.jsx — columnas y filtros estilo PROMANT**

Cambiar el `Table head` y las celdas a:
`["Tipo", "Código interno", "Marca y modelo", "Serie / IMEI", "IP", "Asignado a", "Estado", ""]`
- Celda Tipo: `{a.tipo ?? a.categoria}` en `text-gris`.
- Celda IP: `<Td className="font-mono text-[11.5px]">{a.ip ?? "—"}</Td>`.
- La búsqueda incluye además `a.modelo`, `a.marca` y `a.ip`.
- Nuevo filtro `Select` por tipo (opciones únicas de `activos.map(a => a.tipo)` no nulos, ordenadas), junto al de categoría.
- Botón `Exportar` (variant secondary) junto a los de cabecera: genera CSV client-side de las filas filtradas con columnas Tipo;Código;Marca;Modelo;Serie;IMEI;IP;Asignado;Estado (SIN clave_equipo, SIN valor) y lo descarga como `activos-<empresaId>.csv`:
```js
const exportar = () => {
  const enc = ["Tipo","Código","Marca","Modelo","Serie","IMEI","IP","Asignado","Estado"];
  const csv = [enc, ...filas.map(a => [a.tipo ?? a.categoria, a.codigo, a.marca ?? "", a.modelo ?? "",
    a.serie ?? "", a.imei ?? "", a.ip ?? "", persona(a.asignado)?.nombre ?? a.asignado_sin_confirmar ?? "", a.estado])]
    .map(f => f.map(c => `"${String(c).replaceAll('"','""')}"`).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const el = Object.assign(document.createElement("a"), { href: url, download: `activos-${empresaId}.csv` });
  el.click(); URL.revokeObjectURL(url);
};
```

- [ ] **Step 3: Modal Editar — IP y clave de equipo**

En `EditarActivo`: campo `IP` (Input normal, junto a Serie). Debajo, SOLO si `nivelDe(user.acceso, "activos") >= 3 || user.esSuperadmin` (importar `nivelDe` de `../../data/modulos` y tomar `user` de `useApp()`): bloque "Clave del equipo" con Input tipo password + ojito (patrón de CambioClave), botón "Ver clave actual" que llama `verClaveEquipo(codigo)` y la muestra, y al guardar, si el campo fue tocado, llama `guardarClaveEquipo`. Nota: `El acceso a la clave queda registrado en auditoría.`
*(La restricción real la impone la RPC: la UI solo esconde.)*

- [ ] **Step 4: Modal Asignar — antivirus y comentario**

En `AsignarActivo`: checkbox `¿Tiene antivirus instalado?` (estado local `antivirus`, default false → se envía boolean) y `Field label="Comentario"` con Input (ej. "PC que perteneció a…"). `onAsignar(activo.codigo, dni, antivirus, comentario)` y en `ejecutarAsignacion` pasar los args nuevos a `asignarActivo`.
En la tabla, la celda "Asignado a" muestra debajo, si existe, `comentario_asignacion` en `text-[11px] text-gris` y un Badge `AV` tone conf si `antivirus === true`.

- [ ] **Step 5: Probar build y visual**

Run: `npm run build` — esperado: sin errores. Levantar `npm run dev` y revisar ADQ-01: columnas nuevas, filtros, exportar.

- [ ] **Step 6: Commit**

```bash
git add src/pages/admin/Inventario.jsx src/state.jsx
git commit -m "feat(ti): tabla de activos estilo PROMANT (tipo, ip, export) + antivirus y clave de equipo"
```

---

### Task 4: BD — módulo Soporte (tickets)

**Files:**
- Create: `supabase/soporte.sql` (canónico; aplicar después de portal.sql)
- Create: `supabase/migraciones/2026-08-19-soporte.sql` (mismo contenido)

**Interfaces:**
- Produces (tablas): `ticket_tipos(id, nombre unique, activo)`, `ticket_subtipos(id, tipo_id fk, nombre, activo, unique(tipo_id,nombre))`, `tickets(id, numero 'TK-0001' unique, creado_en, solicitante_dni fk personas null, solicitante_nombre, solicitante_correo, area, empresa_id fk null, tipo_id fk, subtipo_id fk null, comentario, estado in (abierto|en_proceso|resuelto|cerrado), atendido_por text, nota_interna text, actualizado_en, actualizado_por)`, `ticket_avisos(correo pk, activo)`.
- Produces (RPCs): `portal_crear_ticket(p_tipo int, p_subtipo int, p_comentario text) returns text` (dni del JWT vía `portal_dni()`, deriva nombre/área/empresa del vínculo vigente, devuelve el numero); `crear_ticket_admin(p_dni text, p_tipo int, p_subtipo int, p_comentario text, p_por text) returns text` (nivel soporte ≥ 2); `actualizar_ticket(p_id bigint, p_estado text, p_atendido_por text, p_nota text, p_por text)` (nivel soporte ≥ 2); `guardar_ticket_tipo(p_id int, p_nombre text) returns int` y `guardar_ticket_subtipo(p_id int, p_tipo int, p_nombre text) returns int` (upsert; nivel ≥ 3); `alternar_ticket_tipo(p_id int, p_activo boolean)` / `alternar_ticket_subtipo(p_id int, p_activo boolean)` (nivel ≥ 3); `guardar_ticket_aviso(p_correo text, p_activo boolean)` y `eliminar_ticket_aviso(p_correo text)` (nivel ≥ 3).
- Produces (vistas): `v_tickets` (todo, para admin), `v_ticket_catalogo` (tipos y subtipos ACTIVOS, para formularios), `v_ticket_config` (todos, para la pantalla de configuración), `v_ticket_avisos`, `v_portal_tickets` (SOLO los del dni de sesión).
- Seed: catálogo completo de PROMANT (7 tipos con sus subtipos y estados exactos del levantamiento) + aviso inicial `diegosalguerotang@gmail.com`.

- [ ] **Step 1: Escribir `supabase/soporte.sql`**

```sql
-- ============================================================================
-- MÓDULO SOPORTE — tickets de incidencias TI (2026-08-19)
-- Copiado funcionalmente del sistema PHP de PROMANT (promant.pe/correo) con
-- las mejoras del proyecto: solicitante real del maestro, numeración legible,
-- catálogo versionable por activación, auditoría.
-- Frontera acordada: incidencias TI aquí; solicitudes formales con aprobación
-- van al Centro de Solicitudes (motor aparte).
-- APLICAR SIEMPRE DESPUÉS DE portal.sql (usa portal_dni()).
-- Idempotente.
-- ============================================================================

drop view if exists v_tickets, v_ticket_catalogo, v_ticket_config, v_ticket_avisos, v_portal_tickets;
drop function if exists portal_crear_ticket(int, int, text);
drop function if exists crear_ticket_admin(text, int, int, text, text);
drop function if exists actualizar_ticket(bigint, text, text, text, text);
drop function if exists guardar_ticket_tipo(int, text);
drop function if exists guardar_ticket_subtipo(int, int, text);
drop function if exists alternar_ticket_tipo(int, boolean);
drop function if exists alternar_ticket_subtipo(int, boolean);
drop function if exists guardar_ticket_aviso(text, boolean);
drop function if exists eliminar_ticket_aviso(text);

create table if not exists ticket_tipos (
  id     int generated always as identity primary key,
  nombre text not null unique,
  activo boolean not null default true
);

create table if not exists ticket_subtipos (
  id      int generated always as identity primary key,
  tipo_id int not null references ticket_tipos(id) on delete cascade,
  nombre  text not null,
  activo  boolean not null default true,
  unique (tipo_id, nombre)
);

create sequence if not exists seq_ticket_numero;

create table if not exists tickets (
  id                 bigint generated always as identity primary key,
  numero             text not null unique,
  creado_en          timestamptz not null default now(),
  solicitante_dni    text references personas(dni),
  solicitante_nombre text not null,
  solicitante_correo text,
  area               text,
  empresa_id         text references empresas(id),
  tipo_id            int not null references ticket_tipos(id),
  subtipo_id         int references ticket_subtipos(id),
  comentario         text,
  estado             text not null default 'abierto'
    check (estado in ('abierto','en_proceso','resuelto','cerrado')),
  atendido_por       text,
  nota_interna       text,          -- solo la ve el equipo (no está en v_portal_tickets)
  actualizado_en     timestamptz,
  actualizado_por    text
);

create table if not exists ticket_avisos (
  correo text primary key,
  activo boolean not null default true
);

-- --------------------------- helpers ---------------------------------------

create or replace function fn_ticket_numero() returns text language sql as $$
  select 'TK-' || lpad(nextval('seq_ticket_numero')::text, 4, '0')
$$;

-- Inserta el ticket resolviendo los datos del solicitante desde el maestro.
create or replace function fn_ticket_insertar(p_dni text, p_tipo int, p_subtipo int, p_comentario text)
returns text language plpgsql as $$
declare v_num text; v_nombre text; v_correo text; v_area text; v_emp text;
begin
  if not exists (select 1 from ticket_tipos where id = p_tipo and activo) then
    raise exception 'El tipo de ticket no existe o está inactivo.';
  end if;
  if p_subtipo is not null and not exists
     (select 1 from ticket_subtipos where id = p_subtipo and tipo_id = p_tipo and activo) then
    raise exception 'El subtipo no corresponde al tipo o está inactivo.';
  end if;
  select pe.nombre, pe.correo into v_nombre, v_correo from personas pe where pe.dni = p_dni;
  if v_nombre is null then
    raise exception 'El DNI % no está en el maestro de personal.', p_dni;
  end if;
  select vi.cargo, vi.empresa_id into v_area, v_emp
  from vinculos vi where vi.persona_dni = p_dni and vi.fecha_fin is null
  order by vi.fecha_inicio desc limit 1;
  v_num := fn_ticket_numero();
  insert into tickets (numero, solicitante_dni, solicitante_nombre, solicitante_correo,
                       area, empresa_id, tipo_id, subtipo_id, comentario)
  values (v_num, p_dni, v_nombre, v_correo, v_area, v_emp, p_tipo, p_subtipo,
          nullif(trim(coalesce(p_comentario,'')), ''));
  return v_num;
end $$;

-- --------------------------- RPCs ------------------------------------------

-- Portal: el dni SIEMPRE sale del JWT. Devuelve el número asignado.
create function portal_crear_ticket(p_tipo int, p_subtipo int default null, p_comentario text default null)
returns text language plpgsql security definer as $$
declare v_dni text;
begin
  v_dni := portal_dni();
  if v_dni is null then
    raise exception 'Sesión del portal inválida.';
  end if;
  return fn_ticket_insertar(v_dni, p_tipo, p_subtipo, p_comentario);
end $$;

-- BackOffice: a nombre de un trabajador del maestro. Nivel soporte ≥ 2.
create function crear_ticket_admin(
  p_dni text, p_tipo int, p_subtipo int default null,
  p_comentario text default null, p_por text default 'Soporte'
) returns text language plpgsql security definer as $$
declare v_num text;
begin
  if fn_nivel_modulo('soporte') < 2 then
    raise exception 'Se necesita nivel de acción en Soporte.';
  end if;
  v_num := fn_ticket_insertar(p_dni, p_tipo, p_subtipo, p_comentario);
  update tickets set actualizado_en = now(), actualizado_por = p_por where numero = v_num;
  return v_num;
end $$;

create function actualizar_ticket(
  p_id bigint, p_estado text default null, p_atendido_por text default null,
  p_nota text default null, p_por text default 'Soporte'
) returns void language plpgsql security definer as $$
begin
  if fn_nivel_modulo('soporte') < 2 then
    raise exception 'Se necesita nivel de acción en Soporte.';
  end if;
  if p_estado is not null and p_estado not in ('abierto','en_proceso','resuelto','cerrado') then
    raise exception 'Estado inválido.';
  end if;
  update tickets set
    estado = coalesce(p_estado, estado),
    atendido_por = coalesce(nullif(trim(coalesce(p_atendido_por,'')),''), atendido_por),
    nota_interna = coalesce(nullif(trim(coalesce(p_nota,'')),''), nota_interna),
    actualizado_en = now(), actualizado_por = p_por
  where id = p_id;
  if not found then
    raise exception 'El ticket no existe.';
  end if;
end $$;

-- Catálogo (nivel aprobar = 3; superadmin/servicio = 99)
create function guardar_ticket_tipo(p_id int, p_nombre text) returns int
language plpgsql security definer as $$
declare v int;
begin
  if fn_nivel_modulo('soporte') < 3 then
    raise exception 'Se necesita nivel de aprobación en Soporte.';
  end if;
  if p_id is null then
    insert into ticket_tipos (nombre) values (trim(p_nombre)) returning id into v;
  else
    update ticket_tipos set nombre = trim(p_nombre) where id = p_id returning id into v;
  end if;
  return v;
end $$;

create function guardar_ticket_subtipo(p_id int, p_tipo int, p_nombre text) returns int
language plpgsql security definer as $$
declare v int;
begin
  if fn_nivel_modulo('soporte') < 3 then
    raise exception 'Se necesita nivel de aprobación en Soporte.';
  end if;
  if p_id is null then
    insert into ticket_subtipos (tipo_id, nombre) values (p_tipo, trim(p_nombre)) returning id into v;
  else
    update ticket_subtipos set nombre = trim(p_nombre) where id = p_id returning id into v;
  end if;
  return v;
end $$;

create function alternar_ticket_tipo(p_id int, p_activo boolean) returns void
language plpgsql security definer as $$
begin
  if fn_nivel_modulo('soporte') < 3 then
    raise exception 'Se necesita nivel de aprobación en Soporte.';
  end if;
  update ticket_tipos set activo = p_activo where id = p_id;
end $$;

create function alternar_ticket_subtipo(p_id int, p_activo boolean) returns void
language plpgsql security definer as $$
begin
  if fn_nivel_modulo('soporte') < 3 then
    raise exception 'Se necesita nivel de aprobación en Soporte.';
  end if;
  update ticket_subtipos set activo = p_activo where id = p_id;
end $$;

create function guardar_ticket_aviso(p_correo text, p_activo boolean default true) returns void
language plpgsql security definer as $$
begin
  if fn_nivel_modulo('soporte') < 3 then
    raise exception 'Se necesita nivel de aprobación en Soporte.';
  end if;
  insert into ticket_avisos (correo, activo) values (lower(trim(p_correo)), p_activo)
  on conflict (correo) do update set activo = excluded.activo;
end $$;

create function eliminar_ticket_aviso(p_correo text) returns void
language plpgsql security definer as $$
begin
  if fn_nivel_modulo('soporte') < 3 then
    raise exception 'Se necesita nivel de aprobación en Soporte.';
  end if;
  delete from ticket_avisos where correo = lower(trim(p_correo));
end $$;

-- --------------------------- vistas ----------------------------------------

create view v_tickets as
select t.id, t.numero, to_char(t.creado_en, 'YYYY-MM-DD HH24:MI') as creado,
       t.solicitante_dni, t.solicitante_nombre, t.solicitante_correo,
       t.area, t.empresa_id as empresa,
       tt.nombre as tipo, ts.nombre as subtipo, t.tipo_id, t.subtipo_id,
       t.comentario, t.estado, t.atendido_por, t.nota_interna,
       to_char(t.actualizado_en, 'YYYY-MM-DD HH24:MI') as actualizado, t.actualizado_por
from tickets t
join ticket_tipos tt on tt.id = t.tipo_id
left join ticket_subtipos ts on ts.id = t.subtipo_id
order by t.creado_en desc;

create view v_ticket_catalogo as
select tt.id as tipo_id, tt.nombre as tipo, ts.id as subtipo_id, ts.nombre as subtipo
from ticket_tipos tt
left join ticket_subtipos ts on ts.tipo_id = tt.id and ts.activo
where tt.activo
order by tt.nombre, ts.nombre;

create view v_ticket_config as
select tt.id as tipo_id, tt.nombre as tipo, tt.activo as tipo_activo,
       ts.id as subtipo_id, ts.nombre as subtipo, ts.activo as subtipo_activo
from ticket_tipos tt
left join ticket_subtipos ts on ts.tipo_id = tt.id
order by tt.nombre, ts.nombre;

create view v_ticket_avisos as
select correo, activo from ticket_avisos order by correo;

-- Portal: SOLO los tickets del dni de la sesión, sin nota interna.
create view v_portal_tickets with (security_invoker = false) as
select t.numero, to_char(t.creado_en, 'YYYY-MM-DD HH24:MI') as creado,
       tt.nombre as tipo, ts.nombre as subtipo, t.comentario, t.estado
from tickets t
join ticket_tipos tt on tt.id = t.tipo_id
left join ticket_subtipos ts on ts.id = t.subtipo_id
where t.solicitante_dni = portal_dni()
order by t.creado_en desc;

-- --------------------------- permisos --------------------------------------

revoke all on tickets, ticket_tipos, ticket_subtipos, ticket_avisos from anon, authenticated;
grant select on v_tickets, v_ticket_config, v_ticket_avisos to authenticated;
grant select on v_ticket_catalogo, v_portal_tickets to authenticated;

-- --------------------------- seed ------------------------------------------
-- Catálogo del sistema TI de PROMANT tal cual (estados incluidos).
insert into ticket_tipos (nombre, activo) values
  ('Conectividad y redes', true), ('Correo', false), ('Cuenta de usuario', false),
  ('Hardware', true), ('Otro', true), ('Software', true), ('Solicitud', true)
on conflict (nombre) do nothing;

create or replace function fn_seed_subtipo(p_tipo text, p_nombre text, p_activo boolean)
returns void language sql as $$
  insert into ticket_subtipos (tipo_id, nombre, activo)
  select id, p_nombre, p_activo from ticket_tipos where nombre = p_tipo
  on conflict (tipo_id, nombre) do nothing
$$;

select fn_seed_subtipo('Conectividad y redes', 'Conexión a internet', true);
select fn_seed_subtipo('Conectividad y redes', 'No tengo internet', false);
select fn_seed_subtipo('Conectividad y redes', 'No tengo la contraseña', false);
select fn_seed_subtipo('Conectividad y redes', 'Otro', true);
select fn_seed_subtipo('Correo', 'General', true);
select fn_seed_subtipo('Correo', 'No se puede enviar correo', true);
select fn_seed_subtipo('Correo', 'Olvide mi contraseña', true);
select fn_seed_subtipo('Correo', 'Se lleno mi espacio', true);
select fn_seed_subtipo('Cuenta de usuario', 'General', true);
select fn_seed_subtipo('Cuenta de usuario', 'Olvide la contraseña del equipo', true);
select fn_seed_subtipo('Hardware', 'Equipos de cómputo y accesorios', true);
select fn_seed_subtipo('Hardware', 'Impresora / escáner', true);
select fn_seed_subtipo('Hardware', 'Otro', true);
select fn_seed_subtipo('Otro', 'Detallar en el recuadro de Comentarios', true);
select fn_seed_subtipo('Software', 'EJB', true);
select fn_seed_subtipo('Software', 'Office', true);
select fn_seed_subtipo('Software', 'Otro', true);
select fn_seed_subtipo('Software', 'SAP', true);
select fn_seed_subtipo('Software', 'Sistemas IA', true);
select fn_seed_subtipo('Solicitud', 'Carpetas y/o almacenamiento', true);
select fn_seed_subtipo('Solicitud', 'Grabación de medios', true);
select fn_seed_subtipo('Solicitud', 'Nuevo ingreso / Cambio de puesto', true);
select fn_seed_subtipo('Solicitud', 'Otro', true);
select fn_seed_subtipo('Solicitud', 'Permisos de acceso', true);
select fn_seed_subtipo('Solicitud', 'Revisión de grabaciones', true);
select fn_seed_subtipo('Solicitud', 'Telefonía móvil', true);
drop function fn_seed_subtipo(text, text, boolean);

insert into ticket_avisos (correo, activo) values ('diegosalguerotang@gmail.com', true)
on conflict (correo) do nothing;
```

- [ ] **Step 2: Copiar como migración y aplicar**

```bash
cp supabase/soporte.sql supabase/migraciones/2026-08-19-soporte.sql
node scripts/aplicar-sql.mjs supabase/migraciones/2026-08-19-soporte.sql
```
Esperado: sin errores.

- [ ] **Step 3: Smoke test BD (Management API)**

`select count(*) from ticket_tipos` → 7; `select count(*) from ticket_subtipos` → 26; `select * from v_ticket_catalogo limit 3` responde; el tipo 'Correo' NO aparece en v_ticket_catalogo (está inactivo).

- [ ] **Step 4: Commit**

```bash
git add supabase/soporte.sql supabase/migraciones/2026-08-19-soporte.sql
git commit -m "feat(soporte): esquema de tickets con catálogo PROMANT, RPCs y vistas"
```

---

### Task 5: BackOffice — pantallas de Soporte

**Files:**
- Modify: `src/data/modulos.js` (módulo `soporte` + ruta ordenada)
- Modify: `src/layout/Shell.jsx` (NavGroup Soporte)
- Modify: `src/App.jsx` (rutas /soporte/*)
- Modify: `src/state.jsx` (vistas + acciones de tickets)
- Create: `src/pages/soporte/Tickets.jsx` (SOP-01)
- Create: `src/pages/soporte/ConfigTickets.jsx` (SOP-02)

**Interfaces:**
- Consumes: vistas y RPCs de Task 4 vía state.jsx.
- Produces en state: `db.tickets` (v_tickets), `db.ticketConfig` (v_ticket_config), `db.ticketAvisos` (v_ticket_avisos); acciones `crearTicketAdmin(dni, tipoId, subtipoId, comentario) → numero`, `actualizarTicket(id, {estado, atendidoPor, nota})`, `guardarTicketTipo(id|null, nombre)`, `guardarTicketSubtipo(id|null, tipoId, nombre)`, `alternarTicketTipo(id, activo)`, `alternarTicketSubtipo(id, activo)`, `guardarTicketAviso(correo, activo)`, `eliminarTicketAviso(correo)`.

- [ ] **Step 1: modulos.js — módulo soporte**

Añadir a `MODULOS` (después de `activos`):
```js
{ id: "soporte", nombre: "Soporte", aprobacion: true,
  ver: "consultar los tickets y su detalle",
  accionar: "registrar tickets, atenderlos y cambiar su estado",
  aprobar: "editar el catálogo de tipos y los avisos por correo" },
```
Añadir a `RUTAS_ORDENADAS` (después de la de activos):
```js
{ ruta: "/soporte/tickets", modulo: "soporte" },
```

- [ ] **Step 2: Shell.jsx — grupo Soporte**

Importar `LifeBuoy, Settings2` de lucide-react. Después de `NAV_ADMIN`:
```js
const NAV_SOPORTE = [
  { to: "/soporte/tickets", icon: LifeBuoy, label: "Tickets", code: "SOP-01", modulo: "soporte" },
  { to: "/soporte/config", icon: Settings2, label: "Config. de tickets", code: "SOP-02", modulo: "soporte" },
];
```
Y renderizar `<NavGroup title="Soporte" items={NAV_SOPORTE} acceso={acceso} />` después del grupo Gestión de TI.

- [ ] **Step 3: App.jsx — rutas**

```jsx
import Tickets from "./pages/soporte/Tickets";
import ConfigTickets from "./pages/soporte/ConfigTickets";
// dentro del bloque autenticado, junto a las rutas /admin/*:
<Route path="/soporte/tickets" element={<RequiereModulo modulo="soporte"><Tickets /></RequiereModulo>} />
<Route path="/soporte/config" element={<RequiereModulo modulo="soporte"><ConfigTickets /></RequiereModulo>} />
```

- [ ] **Step 4: state.jsx — vistas y acciones**

En el mapa de vistas (junto a `activos: "v_activos"`):
```js
tickets: "v_tickets", ticketConfig: "v_ticket_config", ticketAvisos: "v_ticket_avisos",
```
Acciones (patrón `rpc(nombre, args, ...vistas)` del archivo):
```js
crearTicketAdmin: async (dni, tipoId, subtipoId, comentario) => {
  const { data, error } = await supabase.rpc("crear_ticket_admin", {
    p_dni: dni, p_tipo: tipoId, p_subtipo: subtipoId, p_comentario: comentario,
    p_por: user?.nombre ?? "Soporte",
  });
  if (error) throw new Error(error.message);
  await recargar("tickets");
  return data; // TK-000N
},
actualizarTicket: (id, { estado, atendidoPor, nota }) =>
  rpc("actualizar_ticket", { p_id: id, p_estado: estado ?? null,
    p_atendido_por: atendidoPor ?? null, p_nota: nota ?? null,
    p_por: user?.nombre ?? "Soporte" }, "tickets"),
guardarTicketTipo: (id, nombre) => rpc("guardar_ticket_tipo", { p_id: id, p_nombre: nombre }, "ticketConfig"),
guardarTicketSubtipo: (id, tipoId, nombre) => rpc("guardar_ticket_subtipo", { p_id: id, p_tipo: tipoId, p_nombre: nombre }, "ticketConfig"),
alternarTicketTipo: (id, activo) => rpc("alternar_ticket_tipo", { p_id: id, p_activo: activo }, "ticketConfig"),
alternarTicketSubtipo: (id, activo) => rpc("alternar_ticket_subtipo", { p_id: id, p_activo: activo }, "ticketConfig"),
guardarTicketAviso: (correo, activo) => rpc("guardar_ticket_aviso", { p_correo: correo, p_activo: activo }, "ticketAvisos"),
eliminarTicketAviso: (correo) => rpc("eliminar_ticket_aviso", { p_correo: correo }, "ticketAvisos"),
```
(Ajustar a los nombres reales de helpers del archivo al implementar.)

- [ ] **Step 5: Tickets.jsx (SOP-01)**

Página con: 4 Stats (Abiertos, En proceso, Resueltos hoy no — usar: Abiertos, En proceso, Resueltos, Cerrados sobre filas filtradas), filtros (búsqueda por número/nombre/DNI, Select estado, Select tipo), tabla `["N°", "Fecha", "Solicitante", "Área", "Tipo / Subtipo", "Estado", "Atendido por", ""]` con acción **Ver** que abre modal de detalle. El modal muestra todos los datos + comentario del usuario y el panel de gestión: Select estado (los 4), Input "Atendido por", Textarea/Input "Nota interna (solo la ve el equipo)", botón Guardar → `actualizarTicket`. Badges de estado: abierto=pend, en_proceso=tinta, resuelto=conf, cerrado=neutral. Botón cabecera "Nuevo ticket" (gated `nivelDe(acceso,"soporte")>=2`) abre modal: Select persona del maestro (patrón AsignarActivo), Select tipo (de `db.ticketConfig` filtrando activos), Select subtipo dependiente, comentario; al crear → aviso con el número + POST a `/api/enviar-correo` `{accion:"aviso-ticket", numero}` (fire-and-forget con catch silencioso). Empresa: filtrar filas por `empresaId` global SOLO si el ticket tiene empresa (`!t.empresa || t.empresa === empresaId`) para no esconder tickets sin vínculo.

- [ ] **Step 6: ConfigTickets.jsx (SOP-02)**

Dos Cards: (1) **Tipos y subtipos**: lista de tipos con badge Activo/Inactivo, botón alternar, botón renombrar (Input inline o modal), "+ Nuevo tipo"; al expandir un tipo, sus subtipos con lo mismo ("+ Nuevo subtipo"). Todo gated `nivelDe >= 3`. (2) **Avisos por correo**: explicación ("Cada correo recibe un aviso automático cuando alguien crea un ticket"), lista con activar/desactivar/eliminar y alta de correo nuevo. Nota si el motor de correo aún no tiene proveedor: "Los avisos saldrán cuando el motor de correo tenga proveedor configurado."

- [ ] **Step 7: Build y prueba visual**

Run: `npm run build` y revisar en dev: menú Soporte visible para superadmin, crear ticket a nombre de un trabajador, cambiar estado, catálogo editable.

- [ ] **Step 8: Commit**

```bash
git add src/data/modulos.js src/layout/Shell.jsx src/App.jsx src/state.jsx src/pages/soporte
git commit -m "feat(soporte): pantallas SOP-01 tickets y SOP-02 configuración en el BackOffice"
```

---

### Task 6: Portal — crear ticket + aviso por correo

**Files:**
- Create: `portal/src/pages/Soporte.jsx`
- Modify: `portal/src/App.jsx` (ruta /soporte)
- Modify: `portal/src/pages/Inicio.jsx` (tarjeta de acceso)
- Modify: `api/enviar-correo.js` (acción `aviso-ticket`)

**Interfaces:**
- Consumes: `vista("v_ticket_catalogo")`, `vista("v_portal_tickets")`, `rpc("portal_crear_ticket", { p_tipo, p_subtipo, p_comentario })` → numero (portal/src/lib/api.js ya expone `vista` y `rpc`).
- Produces: acción `aviso-ticket` en el webhook: `POST /api/enviar-correo {accion:"aviso-ticket", numero:"TK-0001"}` — el server (service key) lee el ticket + `ticket_avisos` activos y envía el resumen con enlace a `/soporte/tickets` del BackOffice. Responde 200 `{enviados:n}` o 503 si no hay proveedor. Sin proveedor NO es error del flujo: el ticket ya quedó creado.

- [ ] **Step 1: api/enviar-correo.js — acción aviso-ticket**

Siguiendo el patrón de las acciones existentes (usa el helper compartido `api/_correo.js` y el canal service key ya presente en el archivo):
```js
if (accion === "aviso-ticket") {
  const { numero } = cuerpo;
  if (!numero) return res.status(400).json({ error: "Falta el número de ticket." });
  const t = await supaService(`/rest/v1/v_tickets?numero=eq.${encodeURIComponent(numero)}&select=*`);
  if (!t?.[0]) return res.status(404).json({ error: "El ticket no existe." });
  const avisos = await supaService(`/rest/v1/ticket_avisos?activo=eq.true&select=correo`);
  const destinos = (avisos ?? []).map((a) => a.correo);
  if (!destinos.length) return res.status(200).json({ enviados: 0 });
  const tk = t[0];
  const html = `<p>Nuevo ticket <b>${tk.numero}</b> (${tk.tipo}${tk.subtipo ? " · " + tk.subtipo : ""})</p>
    <p>Solicitante: ${tk.solicitante_nombre}${tk.area ? " — " + tk.area : ""}</p>
    <p>${tk.comentario ?? ""}</p>
    <p><a href="${APP}/soporte/tickets">Ver en la intranet</a></p>`;
  const r = await enviarCorreo({ para: destinos, asunto: `Ticket ${tk.numero}: ${tk.tipo}`, html });
  return res.status(r.ok ? 200 : 503).json(r.ok ? { enviados: destinos.length } : { error: r.error });
}
```
(Adaptar `supaService`/`enviarCorreo` a los helpers reales del archivo; si no existe un fetch service-key genérico, hacerlo con `fetch(SUPA_URL + ruta, { headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE } })`.)

- [ ] **Step 2: Portal — página Soporte**

`portal/src/pages/Soporte.jsx` (Preact, componentes de `portal/src/components/ui`): formulario Tipo (Select de v_ticket_catalogo agrupado), Subtipo (dependiente; oculto si el tipo no tiene), Comentario (textarea, obligatorio si subtipo es "Otro" o "Detallar…"), botón Enviar → `rpc("portal_crear_ticket", ...)` → mensaje de éxito con el número → `fetch("/api/enviar-correo", {method:"POST", body: JSON.stringify({accion:"aviso-ticket", numero})}).catch(() => {})`. Debajo, "Mis tickets": lista de `v_portal_tickets` con número, fecha, tipo/subtipo y badge de estado.

- [ ] **Step 3: Ruta y tarjeta**

En `portal/src/App.jsx`: `else if (ruta === "/soporte") pantalla = <Soporte />;` (+ import). En `Inicio.jsx`: tarjeta "Soporte TI — reporta un problema o pide ayuda" apuntando a `/soporte` (mismo patrón de las tarjetas existentes).

- [ ] **Step 4: Build del portal**

Run: `cd portal && npm run build` — esperado: sin errores y bundle < 60KB gzip (presupuesto del portal; el mini-router y ui propios ya existen).

- [ ] **Step 5: Commit**

```bash
git add portal/src api/enviar-correo.js
git commit -m "feat(soporte): tickets desde el Portal del Trabajador + aviso por correo"
```

---

### Task 7: Verificación E2E + deploy

**Files:**
- Create: `scripts/verificar-soporte.mjs`

**Interfaces:**
- Consumes: todo lo anterior. Patrón de `scripts/verificar-sedes.mjs` / `verificar-categorias.mjs` (Management API + endpoints producción; credenciales por env SUPERADMIN_EMAIL/PASSWORD_INICIAL y ADMIN_EMAIL/ADMIN_CLAVE según el script que se imite).

- [ ] **Step 1: Escribir `scripts/verificar-soporte.mjs`**

Pruebas (cada una imprime ✓/✗ y el script sale 1 si alguna falla):
1. `v_ticket_catalogo` tiene 5 tipos activos (Correo y Cuenta de usuario NO están).
2. `crear_ticket_admin` con DNI real crea y devuelve TK-000N; el ticket aparece en `v_tickets` con nombre/área derivados.
3. `crear_ticket_admin` con tipo inactivo (Correo) falla.
4. `actualizar_ticket` cambia estado a en_proceso con atendido_por y nota; v_tickets lo refleja.
5. `portal_crear_ticket` sin sesión (anon) falla.
6. Login portal real (cuenta de prueba existente) → `portal_crear_ticket` crea; `v_portal_tickets` lo lista SIN nota_interna y no lista tickets de otros.
7. `alternar_ticket_tipo` apaga un tipo → desaparece de v_ticket_catalogo → se reenciende.
8. `guardar_ticket_aviso` alta/baja de un correo de prueba.
9. Activos: `v_activos` de promant devuelve ip para PROLT04 y `tiene_clave=false`; `ver_clave_equipo` como superadmin devuelve null sin error y deja rastro en auditoría.
10. Datos de prueba limpiados (tickets TK creados por el script se quedan — son inofensivos — pero el aviso de prueba se elimina).

- [ ] **Step 2: Correr suites**

```bash
npm test                      # vitest completo (84+)
node scripts/verificar-soporte.mjs
```
Esperado: todo verde.

- [ ] **Step 3: Push y deploy**

```bash
git push               # CI de Vercel deploya intranet-general
cd portal && vercel deploy --prod   # si el portal no se autodeploya por el push
```
Verificar deploy Ready y producción: /soporte/tickets carga, portal /portal/soporte carga.

- [ ] **Step 4: Aviso a Diego**

Resumen: qué probar a mano (crear ticket desde su celular en el portal, verlo en el BackOffice, cambiar estado) y recordatorio del SMTP pendiente.

---

## Self-review

- Cobertura contra el requerimiento: renombre (T1), tablas/columnas estilo PROMANT + importación intacta (T2/T3), módulo soporte completo con catálogo, avisos y ambas superficies (T4-T6), data de sus 30 activos (T2). ✔
- La clave_equipo nunca sale por vistas ni export; solo RPC auditada. ✔
- `fn_nivel_modulo` devuelve 99 sin JWT (llamadas de servicio) — los scripts de verificación pasan los gates. ✔
- v_portal_tickets filtra por `portal_dni()` (mismo patrón de v_portal_boletas). ✔
- El tipo «Solicitud» del catálogo se mantiene según la frontera acordada. ✔
