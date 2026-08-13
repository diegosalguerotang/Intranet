# Accesos v2 — Categorías con alcance y enforcement · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar la spec `docs/superpowers/specs/2026-08-13-accesos-categorias-design.md`: categorías con razones sociales versionadas, usuarios con código y eliminación definitiva, cuentas Auth reales y enforcement de menú/selector/rutas al ingresar.

**Architecture:** La lógica de negocio vive en Postgres (RPCs + vistas v_*, patrón existente); el cliente hace actualización optimista + RPC + recarga (`state.jsx`). Las operaciones que requieren la service key (crear/borrar cuentas Auth) van en una función serverless de Vercel gated por el JWT del llamador. El enforcement se deriva de la vista nueva `v_mi_acceso` cargada al autenticar.

**Tech Stack:** Supabase (Postgres + GoTrue), Vercel Functions (Node), React 19 + react-router.

## Global Constraints

- La spec manda; decisiones ya tomadas: herencia tal cual, persona del maestro, eliminar conserva rastro ACC-06, enforcement solo en app, nombre UI "Categorías".
- Migración por `scripts/aplicar-sql.mjs` (Management API; token con `scripts/token-supabase.ps1`). `supabase/accesos.sql` se mantiene como esquema canónico para resets (aplicar SIEMPRE después de schema.sql).
- Sanear con `limpiar()` todo valor de env en funciones serverless (lección del BOM 2026-08-13).
- Cada tarea termina con `npm run build` OK + commit + push (deploy automático).
- Los nombres de campo que la UI ya consume (camelCase de las vistas: `perfilNombre`, `esSuperadmin`, `requiereCambio`…) no cambian; los nuevos siguen el mismo estilo (`codigo`, `creado`, `empresas`).

---

### Task 1: SQL — esquema, RPCs y vistas v2 + migración aplicada

**Files:**
- Modify: `supabase/accesos.sql` (esquema canónico)
- Create: `supabase/migraciones/2026-08-13-categorias.sql` (idempotente, para la BD viva)

**Interfaces (Produces):**
- Tabla `perfil_empresas(perfil_id, version, empresa_id)`.
- `usuarios_admin.codigo` (`U-0001`, secuencia `seq_usuario_codigo`, único).
- `guardar_perfil(..., p_empresas text[])` — versión nueva incluye alcance; error si no-superadmin sin empresas.
- RPC `eliminar_usuario_admin(p_id bigint, p_por text)` — borra fila (trigger del último superadmin protege), auditada.
- `registro_accesos.usuario_id` con `on delete set null`.
- Vistas: `v_perfiles`/`v_perfil_versiones` + `empresas text[]`; `v_usuarios_admin` + `codigo`, `creado` (YYYY-MM-DD), `empresas` (de la categoría vigente); nueva `v_mi_acceso(correo, es_superadmin, matriz jsonb, ver_remuneracion, ver_documentos_terceros, exportar_datos_personales, empresas text[])`.
- RPCs `crear_usuario_admin`/`actualizar_usuario_admin` SIN `p_empresas/p_sedes`; tablas `usuario_alcance_*` eliminadas.

**Migración (orden interno):** crear tabla+secuencia+columna → poblar `perfil_empresas` de versiones vigentes activas (todas las empresas) → poblar `codigo` por orden de `creado_en` → alter FK registro_accesos → recrear RPCs y vistas → drop `usuario_alcance_empresa/sede` → desactivar perfiles que no sean `superadministrador` ni `gerente-administracion` → crear "Gerente de Administración" si falta (Administración nivel 3, Accesos nivel 2, todas las empresas).

- [ ] Escribir migración y actualizar accesos.sql (mismo contenido final)
- [ ] Aplicar migración: `.\scripts\token-supabase.ps1; node scripts/aplicar-sql.mjs supabase/migraciones/2026-08-13-categorias.sql`
- [ ] Verificar por consulta: `select codigo from v_usuarios_admin`, `select empresas from v_perfiles`, `select * from v_mi_acceso where correo='diegosalguerotang@gmail.com'`
- [ ] Commit + push

### Task 2: Función serverless de cuentas — `api/admin-usuarios.js`

**Interfaces (Produces):** POST `{accion:'crear', usuario_id}` → `{clave}` (crea cuenta GoTrue con clave provisional generada server-side, marca `requiere_cambio_clave`); POST `{accion:'eliminar', usuario_id}` → borra cuenta GoTrue + RPC `eliminar_usuario_admin`. Autorización: cabecera `x-sesion` (JWT) validada con GoTrue; el llamador debe ser usuario admin activo con nivel ≥2 en `accesos` (crear) / ≥3 o superadmin (eliminar); nadie se elimina a sí mismo.

**Consumes:** `eliminar_usuario_admin` (Task 1), `SUPABASE_SERVICE_ROLE_KEY` + `limpiar()`.

- [ ] Implementar con el patrón de `api/supa.js` (service key para `/auth/v1/admin/*` y consultas)
- [ ] Probar por curl: sin JWT → 401; con JWT de Diego → crear cuenta de un usuario de prueba y eliminarla
- [ ] Commit + push

### Task 3: Estado — `src/state.jsx`

**Produces:** `user.acceso = { matriz, casillas, empresas, esSuperadmin }` (de `v_mi_acceso` en `resolver()`; superadmin → todo); acciones: `guardarPerfil` envía `p_empresas`; `crearUsuarioAdmin(u)` sin empresas/sedes y llama a `/api/admin-usuarios` (accion crear) devolviendo `{codigo, clave, creado}` al caller; nueva `eliminarUsuarioAdmin(id)` (optimista + serverless); `USUARIO_DEMO` gana `acceso` superadmin.

- [ ] Implementar; build; commit + push

### Task 4: UI Categorías — `Perfiles.jsx`, `PerfilEditor.jsx`, `Shell.jsx`

- Renombrar textos "Perfil(es)" → "Categoría(s)" (menú: "Categorías"; títulos ACC-03/ACC-04; botones "Nueva categoría").
- PerfilEditor: sección "Razones sociales" (checkboxes de `db.empresas`, oculta si superadmin; requerida ≥1), incluida en el diff de cambios y en el resumen natural ("Opera sobre NEGLIAF y BREMCO."); `guardarPerfil` envía `empresas`.
- Historial de versiones muestra el alcance de cada versión.

- [ ] Implementar; build; commit + push

### Task 5: UI Usuarios — `Usuarios.jsx`

- FormUsuario: quitar checkboxes de alcance; el panel del perfil pasa a "Accesos que hereda de la categoría" (matriz + razones sociales de `perfilObj.empresas`); en edición mostrar `codigo` y `creado` (solo lectura). Quitar `genClave` (la clave viene del serverless vía `crearUsuarioAdmin`).
- Modal de clave provisional: agregar código de usuario y fecha de registro.
- Tabla: columna "Código" (font-mono); acción "Eliminar" (icono Trash2, tone danger) visible si `user.acceso` nivel 3 en accesos o superadmin; modal de confirmación que exige escribir `ELIMINAR` y bloquea al propio usuario y al último superadmin (mensajes claros).
- CSV: columnas código y fecha de registro.

- [ ] Implementar; build; commit + push

### Task 6: Enforcement — `Shell.jsx`, `App.jsx`

- Mapa ruta→módulo (en `src/data/modulos.js`: `export const MODULO_POR_RUTA`): `/rrhh`→personal (tablero visible si algún módulo RRHH ≥1), `/rrhh/personal`→personal, `/rrhh/boletas`→boletas, `/rrhh/acuses`→acuses, `/rrhh/comunicados`→comunicados, `/rrhh/memorandums`→memorandums, `/rrhh/contratos`→contratos, `/rrhh/tardanzas`→tardanzas, `/admin/*`→activos, `/accesos/usuarios|categorias|politica`→accesos, `/accesos/registro`→auditoria.
- `nivel(user, modulo)`: superadmin→3; si no `user.acceso.matriz[modulo] ?? 0`.
- Shell: items de menú filtrados por nivel ≥1; grupos vacíos no se muestran; selector de empresa limitado a `user.acceso.empresas` (todas si superadmin); `empresaId` inicial = primera permitida; si solo una, texto fijo en vez de select.
- `RequiereModulo({modulo, children})` en `App.jsx` envolviendo cada ruta: nivel 0 → `Navigate` a la primera ruta permitida + aviso (Note en la pantalla destino vía query `?sin-acceso=modulo`).
- Ruta raíz `/` → primera ruta permitida (no siempre /rrhh).

- [ ] Implementar; build; commit + push

### Task 7: Verificación E2E y cierre

- [ ] Script `scripts/verificar-categorias.mjs`: (1) guardar_perfil con empresas y sin empresas (debe fallar), (2) crear usuario → codigo U-000N, (3) v_mi_acceso coherente, (4) eliminar_usuario_admin conserva filas de registro_accesos, (5) negativa: eliminar último superadmin falla.
- [ ] Criterio de éxito manual con Diego: categoría "Analista RRHH" (RRHH nivel 2, NEGLIAF+BREMCO) + usuario real que inicia sesión y ve solo eso.
- [ ] Actualizar memoria del proyecto; commit + push final.

## Self-Review

- Cobertura de la spec: categorías+alcance (T1/T4), usuarios+código+eliminar (T1/T2/T5), cuentas reales (T2/T3), enforcement (T6), migración (T1), criterios (T7). ✓
- Consistencia: `empresas` como text[] en vistas y como array en UI; `codigo`/`creado` en v_usuarios_admin y UI; `x-sesion` reutiliza el patrón del proxy. ✓
- Sin placeholders bloqueantes: el SQL exacto se escribe en T1 sobre las definiciones ya leídas de accesos.sql (líneas 27-183 en contexto). ✓
