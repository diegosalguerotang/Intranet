# Portal del Trabajador V1 — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar la spec `docs/superpowers/specs/2026-08-13-portal-trabajador-v1-design.md`: portal móvil por DNI (TRB-01/03/04/05/06/07/08/12) como app Vite separada en `portal/`, con acuses probatorios y scoping por sesión.

**Architecture:** App Vite independiente servida como microfrontend bajo `/portal` del dominio principal; reutiliza el proxy `/api/supa` y el patrón de supabase.js del BackOffice. La lógica probatoria vive en Postgres (RPCs `portal_*`, vistas `v_portal_*` que derivan el DNI del JWT — nunca de parámetros). Las cuentas GoTrue técnicas `{dni}@portal.grupoer.pe` las administra RRHH desde Personal vía serverless con service key.

**Tech Stack:** Vite + React 19 + Tailwind 4 (tokens GrupoER v2), supabase-js, Vercel Functions, Supabase (Postgres + GoTrue + Storage para PDFs).

## Global Constraints

- Móvil de gama baja primero; bundle inicial del portal **< 60KB gzip** (verificar en cada tarea de UI con `npm run build`).
- Lenguaje sin jerga: "confirmar recepción", nunca "acusar recibo".
- El DNI del trabajador SIEMPRE se deriva del JWT en el servidor (`split_part(auth.jwt()->>'email','@',1)` validando dominio `@portal.grupoer.pe`); ningún RPC/vista del portal acepta dni por parámetro (excepto los pre-login de bloqueo/registro).
- Clave portal mínimo 6; claves provisionales numéricas de 8 dígitos; BackOffice sigue en 12.
- Cesados ≤12 meses: modo solo-lectura (ver/descargar; sin confirmar ni editar). >12 meses: no entran.
- Sanear env con `limpiar()` en serverless (lección BOM); commit+push por tarea (deploy automático).
- El texto de las declaraciones se copia ÍNTEGRO en cada acuse/aceptación (tabla `declaraciones` versionada).

---

### Task 1: SQL del portal — cuentas, declaraciones, lecturas, RPCs y vistas con scoping JWT

**Files:**
- Create: `supabase/portal.sql` (canónico; aplicar después de accesos.sql en resets)
- Create: `supabase/migraciones/2026-08-13-portal.sql` (idempotente, aplicar a la BD viva vía `scripts/aplicar-sql.mjs` — el clasificador puede exigir que Diego lo corra con `!`)

**Interfaces (Produces):**
- `alter table personas add column direccion text` · `alter table documentos add column archivo_url text`.
- Tablas: `cuentas_portal(dni pk/fk personas, primer_ingreso_pendiente bool default true, celular_declarado text, sin_celular bool default false, politica_version text, politica_aceptada_en timestamptz, creado_por, creado_en)`; `declaraciones(id text, version int, superficie text, texto text, pk(id,version))` con seed `('recepcion-documento',1,'portal',…)` y `('politica-datos',1,'portal',…)`; `comunicado_lecturas(dni fk, comunicado_id fk, leido_en timestamptz, confirmado bool, declaracion text, pk(dni,comunicado_id))`; `solicitudes_cambio_cuenta(id identity, dni fk, motivo text, estado 'pendiente'|'aprobada'|'rechazada', creado_en)`.
- Función `portal_dni_sesion() returns text` — deriva y valida el dominio del correo del JWT; excepción si no es sesión del portal.
- RPCs pre-login (por dni, sin sesión): `portal_verificar_bloqueo(p_dni)` (fallidos superficie portal, política 5/15), `portal_registrar_ingreso(p_dni, p_resultado, p_dispositivo)` (fila en registro_accesos superficie 'portal', actualiza cuentas si exitoso).
- RPCs con sesión: `portal_primer_ingreso(p_celular, p_sin_celular, p_politica_version)`; `portal_confirmar_recepcion(p_documento_id, p_dispositivo) returns bigint` (valida pertenencia por vínculo→persona, documento vigente sin acuse, modo vigente; inserta en `acuses` modalidad 'personal' copiando el texto de la declaración vigente y el hash del documento; devuelve el id del acuse/constancia); `portal_confirmar_lectura(p_comunicado_id, p_dispositivo)` (upsert confirmado=true con texto de declaración; incrementa `comunicados.leidos`); `portal_marcar_visto(p_comunicado_id)`; `portal_actualizar_datos(p_celular, p_direccion)`; `portal_solicitar_cambio_cuenta(p_motivo)`.
- Vistas (todas filtran por `portal_dni_sesion()`): `v_portal_perfil` (nombre, nombre_pila, dni, cargo, sede, empresa, `modo` vigente|solo-lectura|expirado — cesado ≤12m por `max(vinculos.fecha_fin)`, `primerIngresoPendiente`); `v_portal_boletas` (documento id, tipo, titulo, periodo, año, empresa corto, version, estado doc, archivo_url, hash, acuse: registrado_en/constancia id); `v_portal_pendientes` (docs vigentes sin acuse + comunicados vigentes con exige_acuse sin confirmar, con `urgencia` int para orden); `v_portal_comunicados` (con `confirmado`/`visto`); `v_portal_mes` (tardanzas del periodo actual; sin fila = no mostrar bloque); `v_portal_datos` (identificación + celular + direccion + cuenta enmascarada `***`+últimos 4 + banco).
- `v_acuses` del BackOffice sigue funcionando sin cambios (el acuse del portal es un insert normal en `acuses`).

- [ ] Escribir migración + canónico (mismo contenido final); pedir a Diego aplicarla con `!` si el clasificador bloquea
- [ ] Verificar con consultas: seed de declaraciones presente, `select portal_dni_sesion()` falla sin sesión, vistas devuelven vacío sin JWT
- [ ] Commit + push

### Task 2: Config GoTrue (clave mínima 6) + serverless de cuentas del portal

**Files:**
- Create: `api/portal-cuentas.js`
- Create: `scripts/configurar-gotrue-portal.mjs` (PATCH Management API `/v1/projects/mzpbdkrmokfxrrsotfgs/config/auth` `{password_min_length: 6}`; Diego lo corre con `!` si se bloquea)

**Interfaces:**
- Consumes: `v_mi_acceso` (nivel del llamador en módulo `personal`), `cuentas_portal`, patrón de `api/admin-usuarios.js` (JWT en `x-sesion`, `limpiar()`, `SUPA_SERVICE_KEY`).
- Produces: POST `{accion:'crear', dni}` → `{clave}` (cuenta GoTrue `dni@portal.grupoer.pe` con clave numérica de 8 dígitos generada con crypto, email_confirm, fila en cuentas_portal con primer_ingreso_pendiente=true; error claro si ya existe); `{accion:'restablecer', dni}` → `{clave}` (nueva clave numérica + primer_ingreso_pendiente=true); `{accion:'crear-lote', dnis:[...]}` → `{resultados:[{dni, clave|error}]}` (máx 50 por llamada). Autorización: nivel ≥2 en `personal`.

- [ ] Implementar serverless con clave `const claveNumerica = () => String(crypto.getRandomValues(new Uint32Array(1))[0]).padStart(8,"0").slice(-8)` evitando ceros iniciales confusos (usar rango 10000000-99999999)
- [ ] Ejecutar configurar-gotrue-portal.mjs (o pedirlo a Diego con `!`); probar por curl que una clave de 6 ya es aceptada y una de 5 no
- [ ] Probar E2E por curl: crear cuenta de un dni seed → login → restablecer → login con la nueva; commit + push

### Task 3: BackOffice — cuentas del portal desde Personal (RRH-02)

**Files:**
- Modify: `src/pages/rrhh/Personal.jsx` (leer el archivo antes: agregar acción por fila «Cuenta del portal» con modal crear/restablecer que llama a `/api/portal-cuentas` y muestra la clave numérica para entrega presencial, reutilizando el patrón del modal de clave de Usuarios.jsx)
- Modify: `src/state.jsx` (helper `cuentaPortal(accion, dni)` calcado de `cuentaAdmin`)

- [ ] Implementar; build; probar en producción creando la cuenta del trabajador seed 45231876; commit + push

### Task 4: Scaffold del portal + microfrontend en Vercel

**Files:**
- Create: `portal/package.json`, `portal/vite.config.js` (base `/portal/`, plugin react), `portal/index.html` (viewport, Poppins solo titulares con display=swap), `portal/src/index.css` (tokens GrupoER v2 copiados), `portal/src/main.jsx`, `portal/src/App.jsx` (router), `portal/src/lib/supabase.js` (patrón del BackOffice: `location.origin + "/api/supa"` en hosts vercel.app, camuflaje x-sesion, saneo BOM), `portal/src/state.jsx` (sesión + perfil de v_portal_perfil), `portal/src/components/ui.jsx` (Boton, Tarjeta, Nota, Esqueleto — mínimos), `portal/src/layout/Marco.jsx` (cabecera GrupoER + barra inferior Inicio·Boletas·Yo con lucide)
- Modify: `microfrontends.json` (agregar hijo `intranet-portal` con ruta `/portal`)

**Pasos con posible intervención de Diego (`!`):** `vercel projects add intranet-portal` + link rootDirectory `portal/` + `vercel mf add-to-group` (el CLI puede pedir confirmaciones interactivas; si es el caso, dárselas a Diego como comandos `!`).

- [ ] Scaffold compilando con página placeholder; `npm run build` reporta peso (< 30KB en este punto)
- [ ] Crear proyecto Vercel + grupo mf; verificar que `https://intranet-general.vercel.app/portal` sirve el placeholder
- [ ] Commit + push

### Task 5: TRB-01 Ingreso + TRB-03 Primer ingreso

**Files:**
- Create: `portal/src/pages/Ingreso.jsx`, `portal/src/pages/OlvideClave.jsx`, `portal/src/pages/PrimerIngreso.jsx`

Flujo Ingreso: dni (inputmode="numeric", maxLength 8) + clave con ojito → `portal_verificar_bloqueo` → `signInWithPassword({email: dni+"@portal.grupoer.pe"})` → `portal_registrar_ingreso` → si `v_portal_perfil.modo==='expirado'` → signOut + mensaje RRHH; si `primerIngresoPendiente` → PrimerIngreso (guard no salteable en el router); si no → Inicio. Mensaje ÚNICO de error de credenciales; bloqueado y suspendido con sus textos del spec. OlvideClave: pantalla estática (supervisor/RRHH).
PrimerIngreso: clave ×2 (mín 6) → `auth.updateUser` → celular 9 dígitos o «No tengo celular» → casilla con el TEXTO COMPLETO de `declaraciones('politica-datos')` visible → `portal_primer_ingreso`.

- [ ] Implementar; probar en producción con la cuenta del seed (crear → primer ingreso → aterrizar en Inicio); commit + push

### Task 6: TRB-04 Inicio + TRB-05 Boletas

**Files:**
- Create: `portal/src/pages/Inicio.jsx` (saludo nombre de pila/cargo/sede; «Te falta revisar» desde v_portal_pendientes con etiqueta+título+fecha, vacío explícito «Estás al día ✓»; «Tu mes» solo si v_portal_mes tiene fila; aviso permanente si modo solo-lectura)
- Create: `portal/src/pages/Boletas.jsx` (años colapsables, tipo/periodo/empresa/estado con fecha-hora del acuse; versiones reemplazadas visibles)

- [ ] Implementar; build < 60KB; commit + push

### Task 7: TRB-06 Documento + TRB-07 Declaración (el corazón probatorio)

**Files:**
- Create: `portal/src/pages/Documento.jsx`, `portal/src/components/HojaDeclaracion.jsx`
- Create: `scripts/adjuntar-pdfs-demo.mjs` (bucket Storage `documentos` público-lectura + subir 2-3 PDFs de muestra y setear `archivo_url` en documentos seed)

Reglas duras: botón «Confirmar recepción» deshabilitado hasta que el `<object>`/descarga del PDF cargue OK (onload) — si `archivo_url` es null: mensaje «El archivo aún no está disponible; avisa a RRHH» y NUNCA se ofrece confirmar. HojaDeclaracion: texto completo de `declaraciones('recepcion-documento')` con detección de scroll-al-final para habilitar «Sí, confirmo la recepción»; «Todavía no» solo cierra. Confirmar → `portal_confirmar_recepcion` → recarga y muestra constancia (número = id del acuse, fecha/hora del servidor, dispositivo, huella) + descarga de constancia (texto/HTML generado en el cliente con los datos de la vista). Documento reemplazado → aviso + enlace a la versión vigente. Modo solo-lectura: sin botón de confirmar.

- [ ] Implementar; adjuntar PDFs demo; E2E manual: confirmar una boleta desde el móvil y verla llegar a RRH-11; commit + push

### Task 8: TRB-08 Comunicado + TRB-12 Mis datos

**Files:**
- Create: `portal/src/pages/Comunicado.jsx` (visto automático al abrir vía `portal_marcar_visto`; botón «Confirmar que lo leí» solo si `exige_acuse`, mismo flujo HojaDeclaracion), `portal/src/pages/MisDatos.jsx` (identificación solo lectura; celular/dirección editables → `portal_actualizar_datos`; cuenta enmascarada + modal «Solicitar cambio» → `portal_solicitar_cambio_cuenta`; Cerrar sesión)

- [ ] Implementar; build < 60KB; commit + push

### Task 9: Verificación E2E y cierre

**Files:**
- Create: `scripts/verificar-portal.mjs`

Pruebas: (1) crear cuenta por serverless con JWT de Diego; (2) login del trabajador → token; (3) v_portal_boletas con su token devuelve SOLO sus documentos; (4) con token de OTRO trabajador no se ven los del primero (scoping); (5) `portal_confirmar_recepcion` de un documento propio → acuse con declaración copiada; repetir → error; de un documento ajeno → error; (6) cesado simulado (update vinculos.fecha_fin -3 meses) → modo solo-lectura y confirmar falla; fecha_fin -13 meses → v_portal_perfil vacía; revertir; (7) medir peso del bundle (< 60KB gzip).

- [ ] Script completo pasa; prueba real de Diego desde su celular; actualizar memoria del proyecto; commit + push final

## Self-Review

- Cobertura de la spec: arquitectura/microfrontend (T4), auth+min6+cuentas (T2/T3), SQL scoping (T1), TRB-01/03 (T5), 04/05 (T6), 06/07+Storage (T7), 08/12 (T8), criterios (T9). Los vacíos detectados (lecturas de comunicados, archivo_url/Storage, dirección en personas) están en T1/T7. ✓
- Consistencia de nombres: `portal_dni_sesion`, RPCs `portal_*`, vistas `v_portal_*`, serverless `/api/portal-cuentas`, tabla `cuentas_portal` usados igual en todas las tareas. ✓
- Sin placeholders: cada tarea define objetos y reglas concretas; los archivos existentes que se modifican (Personal.jsx) exigen lectura previa explícita. ✓
