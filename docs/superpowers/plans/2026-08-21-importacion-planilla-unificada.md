# Importación de Planilla Unificada — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Los subagentes NO corren git: los commits los hace el controlador (PowerShell + here-strings sin comillas dobles).

**Goal:** Cargar el padrón unificado de planilla (un `.xlsx` limpio con 3 razones sociales y cuentas bancarias) al módulo Planilla (ex-Personal), creando/actualizando personas y vínculos de forma transaccional, con la cuenta bancaria cifrada en reposo.

**Architecture:** Parser propio sin dependencias (patrón `planilla.js`/`activos.js`) → RPCs transaccionales con patrón de previsualización `PV999` (patrón `importar_activos`) → pantalla de confirmación multi-empresa. La cuenta bancaria se cifra con pgcrypto (llave en Supabase Vault) y solo se revela con una casilla de permiso nueva, con auditoría. Convive con la importación PLATRA1 existente: se distinguen por encabezados.

**Tech Stack:** React 19 + Vite (frontend), lector `.xlsx` propio (`src/lib/importar/xlsx.js`), Postgres/Supabase (RPCs `security definer`), pgcrypto + Supabase Vault (cifrado), vitest (fixtures reales).

**Fuente:** spec `OneDrive/.../Tarea 21-08/Planilla/Importacion_Planilla_Unificada.docx`; fixture `OFICINA_JUL_2026_UNIFICADO.xlsx` (copiar a `tests/fixtures/`).

## Global Constraints

Verificados contra el archivo de muestra, con números exactos (criterios de aceptación):

- El archivo tiene **1 hoja** (`OFICINA JUL 2026`), rango **A1:L80** = 12 columnas + encabezado + **79 filas** de datos. Sin celdas combinadas, sin separadores, sin totales.
- **3 razones sociales por RUC**: `20605159398` NEGLIAF (39 filas), `20545837880` PROMANT (29 filas), `20601705185` Limpieza Americana (11 filas).
- La resolución de empresa es **por RUC**, nunca por el texto de la denominación (el texto solo se muestra).
- Si **una** razón social del archivo no está en el catálogo **o** queda fuera del alcance del usuario → **no se importa ninguna fila** (todo o nada, a nivel archivo).
- **Documento**: 76 DNI de 8 dígitos + 3 CE de 9 dígitos (`003308122`, `002771952`, `004193432`), todos con **ceros iniciales conservados** (texto).
- La resolución de documento contra el maestro se hace **quitando ceros a la izquierda en ambos lados**; la forma canónica es la del maestro. 1 coincidencia → se usa; >1 → excepción a mano; 0 → excepción "no encontrado". **Nunca rellenar a longitud fija.**
- **Cuenta bancaria SIEMPRE texto**, nunca número (las cuentas del Banco Continental empiezan en `00110…`). Cifrada en reposo, enmascarada por defecto (últimos 4), revelable solo con permiso "ver datos bancarios" y con auditoría.
- **Banco por catálogo** (no texto libre): mapear "Banco Scotianbank" (mal escrito) → Scotiabank.
- Cuentas del Banco de Crédito con **20 dígitos** (2 filas) → **advertencia**, se importan igual (posible CCI).
- **Centro de costo** truncado a 18 chars: primer token = código (llave), resto = descripción (cortada). En PROMANT el código viene repetido (`1501 1501 G. ADM-C`) → dedup del código.
- **SEDE y FECHA DE INGRESO vienen vacías**: no obligatorias y **no sobrescriben** valores ya registrados.
- **Nombre**: hasta 46 chars, mejor fuente del proyecto. Al actualizar, reemplazar un nombre guardado más corto que sea prefijo del nuevo; **nunca** acortar uno más largo.
- **CÓDIGO y NRO DE DOCUMENTO** coinciden en las 79 filas pero son campos distintos: guardar separados, reportar excepción si difieren.
- Archivo **parcial** (contrato OFICINA de julio 2026): **no cesa ni desactiva a nadie por ausencia**.
- **Período** desde el nombre de la hoja (`OFICINA JUL 2026`); si no se puede interpretar, pedirlo en pantalla. No deducir del nombre del archivo.
- Detección por encabezados: si no trae las **12 columnas** esperadas, no interpretarlo como este formato — decirlo y detenerse.
- Reimportar el mismo archivo **no duplica** personas ni vínculos y no genera cambios si nada cambió.
- Persona repetida con **empresas distintas** = dos vínculos (válido); con **misma empresa** = duplicado (excepción bloqueante).

**Decisiones de Diego (2026-08-21):** cifrado real con pgcrypto + Supabase Vault; renombre "Personal"→"Planilla" solo visible (ya hecho, commit 55a431a); empezar por Fase 0.

---

## Fase 0 — Renombrar Personal → Planilla (COMPLETADA)

Hecho en commit `55a431a`: etiqueta del menú (`Shell.jsx`) y título de pantalla (`Personal.jsx`) → "Planilla". Id de módulo `personal`, rutas `/rrhh/personal` y códigos RRH-* intactos. No requiere más trabajo.

---

## Fase 1 — Catálogo de bancos

**Files:**
- Create: `supabase/migraciones/2026-08-2X-catalogo-bancos.sql`
- Modify: `supabase/schema.sql` (tabla `bancos` + FK opcional desde `personas.banco_id`)
- Create/Modify: `src/lib/importar/bancos.js` (mapa de alias → código de banco)
- Test: `tests/importar/bancos.test.js`

**Interfaces:**
- Produces: tabla `bancos(codigo text pk, nombre text, alias text[])`; función `fn_resolver_banco(p_texto text) returns text` (código de banco o null); helper JS `resolverBanco(texto) -> {codigo, nombre} | null`.

- [ ] **Step 1 — Test del resolvedor de banco (JS).** En `bancos.test.js`: `resolverBanco('Banco Scotianbank')` → `{codigo:'scotiabank', nombre:'Scotiabank'}`; `resolverBanco('Banco Continental')` → BBVA; `resolverBanco('Banco Credito')` → BCP; `resolverBanco('Inexistente')` → `null`. Debe casar quitando acentos/mayúsculas/prefijo "Banco".
- [ ] **Step 2 — Correr y ver fallar** (`npx vitest run tests/importar/bancos.test.js`).
- [ ] **Step 3 — Implementar `bancos.js`** con el catálogo canónico (scotiabank/Scotiabank, bbva/BBVA (ex Continental), bcp/Banco de Crédito, interbank, nacion, etc.) y `alias` que incluya los errores conocidos ("Scotianbank", "Continental", "Credito").
- [ ] **Step 4 — Correr y ver pasar.**
- [ ] **Step 5 — Migración SQL**: `create table if not exists bancos (codigo text primary key, nombre text not null, alias text[] not null default '{}')` + seed idempotente (`on conflict do nothing`) + `fn_resolver_banco(p_texto)` que normaliza y busca en `nombre`/`alias`. Sincronizar en `schema.sql` canónico.
- [ ] **Step 6 — Aplicar migración** vía `node scripts/aplicar-sql.mjs supabase/migraciones/2026-08-2X-catalogo-bancos.sql` y verificar `select count(*) from bancos`.
- [ ] **Step 7 — Commit.**

---

## Fase 2 — Cuenta bancaria cifrada + permiso "ver datos bancarios"

**Files:**
- Create: `supabase/migraciones/2026-08-2X-cuenta-cifrada.sql`
- Modify: `supabase/schema.sql` (`personas`: `cuenta_cifrada bytea`, `cuenta_ultimos4 text`; migrar `cuenta` texto→cifrado; `v_personal` enmascara), `alta_trabajador`/`editar_trabajador` (cifran al escribir)
- Modify: `supabase/accesos.sql` (columna `perfiles.ver_datos_bancarios` + `v_mi_acceso` + `guardar_perfil` param)
- Modify: `src/data/modulos.js` (casilla `verDatosBancarios` en `CASILLAS`)
- Modify: `src/pages/accesos/PerfilEditor.jsx` (estado casilla) y `src/state.jsx` (`guardarPerfil` pasa `p_ver_datos_bancarios`)
- Test: `tests/accesos/ver-datos-bancarios.test.js` + verificación SQL

**Interfaces:**
- Consumes: Supabase Vault con secreto `clave_cuentas` (llave simétrica). **DECISIÓN OPERATIVA:** crear el secreto en Vault antes de esta fase.
- Produces: `fn_cifrar_cuenta(p_texto)`/`fn_ver_cuenta_bancaria(p_dni)` (`security definer`, la 2.ª exige `ver_datos_bancarios` o superadmin y registra en auditoría); `v_personal.cuentaEnmascarada` = `'···· '||cuenta_ultimos4`; casilla `verDatosBancarios`.

- [ ] **Step 1 — Vault**: crear secreto `clave_cuentas` (Management API o dashboard). Documentar en el plan que sin él las funciones fallan claro.
- [ ] **Step 2 — Test SQL de ida y vuelta**: `fn_cifrar_cuenta('00110123456789012345')` guarda bytea; descifrar con la llave devuelve el mismo texto con el `00110` intacto. Verificar que `cuenta_cifrada` NO es legible como texto.
- [ ] **Step 3 — Migración**: agregar `cuenta_cifrada bytea`, `cuenta_ultimos4 text`; `create extension if not exists pgcrypto`; `fn_cifrar_cuenta`/`fn_descifrar_cuenta` con `pgp_sym_encrypt/decrypt` y la llave de Vault (`vault.decrypted_secrets`); backfill: cifrar los `cuenta` existentes y poblar `cuenta_ultimos4`; **NO** dropear `personas.cuenta` todavía (dejar deprecado hasta verificar), o dropear en migración posterior. Ajustar `alta_trabajador`/`editar_trabajador` para cifrar (`p_cuenta` sigue texto en la firma).
- [ ] **Step 4 — `v_personal` enmascara**: reemplazar `p.cuenta` por `'···· '||p.cuenta_ultimos4`. La cuenta completa solo por `fn_ver_cuenta_bancaria`.
- [ ] **Step 5 — Auditoría**: `fn_ver_cuenta_bancaria(p_dni)` valida permiso (`fn_nivel_modulo` no aplica; usar `perfiles.ver_datos_bancarios` vía `v_mi_acceso` del llamador), registra en `registro_accesos`/auditoría SIEMPRE (tenga permiso o no), y solo devuelve la cuenta si tiene permiso.
- [ ] **Step 6 — Casilla en Accesos**: `perfiles.ver_datos_bancarios boolean default false`; `guardar_perfil` +param; `v_mi_acceso` +campo; `v_perfiles` +campo; `CASILLAS` en `modulos.js` (`{id:'verDatosBancarios', nombre:'Ver datos bancarios', detalle:'La cuenta de haberes completa del trabajador (Ley 29733; se registra en auditoría)'}`); `PerfilEditor` estado inicial + persistir. **OJO:** `verDatosBancarios` es columna de `perfiles`, NO módulo de `perfil_permisos` — no toca el check corregido el 2026-08-21.
- [ ] **Step 7 — Aplicar migración + verificar**: crear categoría con `verDatosBancarios` = true y confirmar que `v_mi_acceso` lo trae; `fn_ver_cuenta_bancaria` devuelve completa con permiso y null sin permiso, y ambas dejan rastro de auditoría.
- [ ] **Step 8 — Commit.**

---

## Fase 3 — Parser de la planilla unificada

**Files:**
- Create: `src/lib/importar/planilla-unificada.js`
- Modify: `src/lib/importar/xlsx.js` (si hace falta exponer el nombre de la hoja; hoy `leerXlsx({hoja})` ya acepta nombre — reutilizar para el período)
- Test: `tests/importar/planilla-unificada.test.js`
- Test fixture: `tests/fixtures/OFICINA_JUL_2026_UNIFICADO.xlsx` (copiar el real)

**Interfaces:**
- Consumes: `resolverBanco` (Fase 1), `leerXlsx`.
- Produces: `parsearPlanillaUnificada(buffer) -> { periodo, empresas:[{ruc, denominacion, filas:n}], filas:[{ruc, denominacion, contrato, codigo, nombre, tipoDoc, documento, centroCostoCodigo, centroCostoDesc, bancoCodigo, cuenta, cuentaLongitud, advertencias:[], errores:[] }], errores:[] }`.

- [ ] **Step 1 — Test de detección + conteo**: contra el fixture, `parsear` devuelve 79 filas y 3 empresas con RUC y conteos 39/29/11. Un buffer sin las 12 columnas → error "no es el formato de planilla unificada".
- [ ] **Step 2 — Correr y ver fallar.**
- [ ] **Step 3 — Implementar detección**: leer hoja (nombre → período `JUL 2026`), validar los 12 encabezados exactos (EMPRESA, RUC, CONTRATO, CÓDIGO, NOMBRE COMPLETO, TIPO DE DOCUMENTO, NRO DE DOCUMENTO, CENTRO DE COSTO, SEDE, FECHA DE INGRESO, BANCO, NRO DE CUENTA), `trim` a todo.
- [ ] **Step 4 — Tests de reglas** (una aserción por criterio): CE `003308122` conserva ceros; DNI conservan ceros; cuenta Continental conserva `00110`; `1501 1501 G. ADM-C` → código `1501` sin repetición; centro de costo parte código/descripción; banco "Scotianbank" → scotiabank; 2 cuentas BCP de 20 dígitos → advertencia; fila con CÓDIGO≠NRO → error de fila; SEDE/FECHA vacías no generan valor.
- [ ] **Step 5 — Implementar reglas** en `planilla-unificada.js` (documento como texto, banco vía catálogo, centro de costo con dedup de token repetido, advertencia de longitud, período de la hoja).
- [ ] **Step 6 — Correr toda la suite y ver pasar.**
- [ ] **Step 7 — Commit.**

---

## Fase 4 — RPCs de previsualización e importación

**Files:**
- Create: `supabase/migraciones/2026-08-2X-importar-planilla-unificada.sql`
- Modify: `supabase/schema.sql` (canónico) y `src/state.jsx` (wrappers)
- Test: verificación SQL + `scripts/verificar-planilla-unificada.mjs`

**Interfaces:**
- Consumes: `fn_resolver_banco`, `fn_cifrar_cuenta`, `vinculos`, `personas`, `empresas.ruc`.
- Produces: `previsualizar_planilla_unificada(p_filas jsonb) -> jsonb` (empresas detectadas, nuevos, cambios, problemas) y `importar_planilla_unificada(p_filas jsonb, p_periodo text, p_por text) -> jsonb`. Ambas resuelven empresa **por RUC** (`select id from empresas where ruc = ...`).

- [ ] **Step 1 — Test**: previsualizar con las 79 filas del fixture (cargadas como jsonb) devuelve 3 empresas por RUC; si se altera un RUC a uno inexistente → error "razón social no reconocida" y CERO importado.
- [ ] **Step 2 — Correr y ver fallar.**
- [ ] **Step 3 — Implementar** patrón `PV999`: resolver cada RUC contra `empresas` (existencia + alcance vía `acceso` del llamador); comparar documento con **strip de ceros** contra `personas.dni` canónico; crear persona+vínculo o actualizar (nombre solo mejora-prefijo, centro de costo, contrato, banco vía catálogo, cuenta cifrada); SEDE/FECHA vacías no pisan; duplicado misma empresa = excepción; cambio de cuenta = marcado explícito (banco + últimos 4 de cada una); no cesar por ausencia; auditoría con `p_por`.
- [ ] **Step 4 — Correr y ver pasar.**
- [ ] **Step 5 — Aplicar migración** y `scripts/verificar-planilla-unificada.mjs --proxy` contra datos acotados (ZZPRUEBA-) en producción.
- [ ] **Step 6 — Commit.**

---

## Fase 5 — Pantalla de confirmación multi-empresa

**Files:**
- Modify: `src/pages/rrhh/Personal.jsx` (nuevo modal "Importar planilla unificada" o distinguir formato dentro del modal actual)
- Modify: `src/state.jsx` (wrappers `previsualizarPlanillaUnificada`/`importarPlanillaUnificada`)
- Test: revisión manual + criterios de aceptación

**Interfaces:**
- Consumes: RPCs de Fase 4, parser de Fase 3.

- [ ] **Step 1 — Detección de formato en el modal**: al soltar el `.xlsx`, intentar `parsearPlanillaUnificada`; si valida los 12 encabezados, ir por el flujo unificado; si no, caer al PLATRA1 actual.
- [ ] **Step 2 — Vista de confirmación multi-empresa**: agrupar por razón social, mostrar las 3 con RUC y conteo; mensaje en plural "Esta información será subida a NEGLIAF, PROMANT y Limpieza Americana"; botón "Sí, subir a las 3 razones sociales". Si una empresa no está en catálogo o fuera de alcance → bloquear todo con el motivo.
- [ ] **Step 3 — Vista previa**: personas nuevas, vínculos nuevos, campos que cambian, **cambios de cuenta explícitos** (banco + últimos 4 de la anterior y la nueva), advertencias (20 dígitos), filas con problemas. Confirmar = todo o nada.
- [ ] **Step 4 — Verificación manual** contra el fixture en un entorno de prueba; commit.

---

## Fase 6 — Corrección a la spec de asistencia (#8)

Coordinar con la importación de asistencias: la regla "rellenar a 8 dígitos" es incorrecta (rompe el CE `003308122`). Reemplazar por **comparación quitando ceros a la izquierda contra el maestro** (misma `fn` que Fase 3/4). Se implementa cuando se aborde #8; aquí queda anotado como dependencia cruzada.

---

## Fase 7 — Fixture + verificación de aceptación

**Files:**
- Create: `tests/fixtures/OFICINA_JUL_2026_UNIFICADO.xlsx`
- Create: `scripts/verificar-planilla-unificada.mjs`

- [ ] Suite vitest que recorre TODOS los criterios de aceptación con números exactos (79 filas; 39/29/11; 3 CE íntegros; `003308122` resuelve sin rellenar; 76 DNI con ceros; Continental `00110`; ninguna cuenta en claro ni completa sin permiso; 2 cuentas BCP 20 dígitos = advertencia importada; `1501` sin repetición; SEDE/FECHA vacías no borran; nombre corto se reemplaza por completo y viceversa no; reimportar no duplica; ausentes no cesados).
- [ ] `scripts/verificar-planilla-unificada.mjs` E2E en producción con datos acotados.
- [ ] Commit final + actualizar memoria del proyecto.

---

## Self-review — cobertura del spec

- Un archivo/3 RS por RUC → Fases 3 (parser), 4 (RPC resuelve por RUC), 5 (confirmación de 3). ✓
- Documento con/sin ceros y CE → Fase 3 (conserva) + Fase 4 (strip para casar). ✓
- Datos bancarios cifrados + permiso + auditoría + catálogo + siempre texto → Fases 1 y 2. ✓
- Centro de costo truncado + dedup → Fase 3. ✓
- SEDE/FECHA vacías, nombre prefijo, CÓDIGO≠NRO, parcial/no-cese, reimport idempotente → Fases 3 y 4. ✓
- Período desde la hoja → Fase 3. ✓
- Detección por encabezados y convivencia con PLATRA1 → Fases 3 y 5. ✓
- Corrección de la spec de asistencia → Fase 6 (dependencia con #8). ✓

## Puntos de "detente y pregunta" ya resueltos con Diego

- Modelo no permite cuenta cifrada → **cifrar con pgcrypto + Vault** (Fase 2).
- No existe catálogo de bancos → **crearlo** (Fase 1).
- Resolver empresa por RUC → el catálogo ya tiene `empresas.ruc` único; se agrega la resolución (Fase 4).

## Pendientes que aún requieren decisión de Diego durante la ejecución

- Doc repetido con la MISMA razón social en un archivo real (en la muestra no ocurre): confirmar mensaje/manejo.
- Comparación sin ceros con >1 coincidencia (DNI y CE que colapsan): confirmar UX de la excepción a mano.
- Si se dropea `personas.cuenta` (texto plano) tras verificar el backfill cifrado.
