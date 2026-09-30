# Dos arreglos y una limpieza — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el reloj no borre el control semanal, que republicar un lote idéntico no cree otra versión, y retirar del cliente lo que ninguna pantalla usa.

**Architecture:** Dos funciones SQL se redefinen en su canónico (`supabase/schema.sql`) y viajan en una migración generada por `scripts/arreglos-generar.mjs` (bloque `@@ARREGLOS@@` de `seguridad.sql`, patrón de `@@CORREO@@`). El cliente solo cambia en `Boletas.jsx` (aviso) y en la limpieza. Ensayo local, invariante en el canon y verificador de producción.

**Tech Stack:** PostgreSQL 17, pg-local, vitest 4, React 19.

**Spec:** `docs/superpowers/specs/2026-09-30-arreglos-asistencia-boletas-limpieza-design.md`

## Global Constraints
- Funciones recreadas con `security definer set search_path = public, interno, extensions` y la MISMA guarda que hoy.
- La migración no toca datos; `lotes.huella` nace nula.
- Commits con `git commit -F`, sin comillas dobles en el mensaje.

---

### Task 1: SQL — canónico, generador, migración, reversión, ensayo, invariante
**Files:** Modify `supabase/schema.sql` (importar_asistencia, publicar_lote_pdf, tabla lotes) · Create `supabase/arreglos.sql`, `scripts/arreglos-generar.mjs`, `scripts/ensayar-arreglos.mjs`, `scripts/verificar-arreglos.mjs` · Generate migración/reversión/bloque · Modify `scripts/ensayar-canon.mjs`, `supabase/MODELO.md`.
- [ ] Editar `schema.sql`: `lotes.huella text` en la tabla; `importar_asistencia` con DELETE filtrado por `origen = 'reloj'`, INSERT con `on conflict do nothing` y `conservadas_control`; `publicar_lote_pdf` con cálculo de huella, búsqueda de lote idéntico y retorno `repetido`.
- [ ] `supabase/arreglos.sql` = `alter table lotes add column if not exists huella text;` + las dos funciones (copiadas del canon) + comentario. Generador y bloque como `correo-generar.mjs`.
- [ ] Ensayo `ensayar-arreglos.mjs` (seguridad + datos anonimizados; siembra ZZ; A y B; reversión y reaplicación). Esperado: todo verde.
- [ ] Invariante en `ensayar-canon.mjs`. Correr canon, licencias, correo, factor, fase4.
- [ ] Commit `sql(arreglos): el reloj conserva el control semanal; publicar un lote identico no crea version`.

### Task 2: Cliente — aviso de lote repetido
**Files:** Modify `src/pages/rrhh/Boletas.jsx` (finalizarPublicacion / paso de resultado).
- [ ] Si la respuesta trae `repetido`, mostrar Note tono pend «Este lote ya estaba publicado (versión N): no se creó otra versión.» y no la de éxito nuevo. Build. Commit.

### Task 3: Limpieza del cliente
**Files:** Modify `src/state.jsx`, `src/data/mock.js` · Delete `src/pages/rrhh/Contratos.jsx`, `src/pages/rrhh/Tardanzas.jsx`, `src/pages/admin/EPP.jsx`, `src/pages/admin/Costos.jsx`, `src/lib/importar/planilla-unificada.js`, `src/lib/importar/bancos.js`, `tests/importar/planilla-unificada.test.js`, `tests/importar/bancos.test.js` · Modify `src/lib/importar/planilla.js` (cabecera legado), `.gitignore` (quitar la línea del fixture OFICINA).
- [ ] Quitar fuentes y claves; quitar `addEpp`; borrar archivos; `npm test` y build verdes; `grep` de que nada importa lo borrado. Commit.

### Task 4: Despliegue y cierre
- [ ] Diego aplica la migración con `!`; push; CI; `verificar-arreglos.mjs` (Diego); `funciones-y-permisos.mjs` (165); actualizar `docs/estado-del-proyecto.md` §4/§12/§13 y memoria; commit y push.
