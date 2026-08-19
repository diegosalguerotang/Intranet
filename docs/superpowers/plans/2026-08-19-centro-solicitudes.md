# Centro de Solicitudes — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Motor de solicitudes con tipos configurables; primeros tipos: papeleta de permiso (GR-F-14 NEGLIAF, solo BackOffice, 2 pasos de V°B°) y solicitud de vacaciones (GR-F-012 PROMANT, Portal+BackOffice, 1 paso). Estados, historial inmutable, notificaciones configurables, PDF al legajo al aprobar y tablero mensual en RRHH.

**Architecture:** Igual que Soporte: lógica en RPCs security definer + vistas v_*, canónico `supabase/solicitudes.sql` (aplicar tras accesos+portal) espejado en migración. El "tipo" es DATA (superficies, cadena de aprobación, membrete, prefijo de correlativo, exigencia de acuse); los formularios de los 2 tipos son componentes propios que guardan en `datos` jsonb (motor genérico, formularios concretos: YAGNI sobre un form-engine). PDF server-side con pdf-lib (`api/solicitud-pdf.js`), archivado en el bucket privado `documentos` + fila en `documentos` (legajo). Portal = web responsive existente (Preact), la papeleta NO aparece ahí.

**Tech Stack:** Supabase (RPC/vistas), React (BackOffice), Preact (portal), pdf-lib (serverless), motor de correo existente.

**Fuente:** `Tareas 19-08/Centro_de_Solicitudes_RRHH.docx` + `docs/superpowers/specs/2026-08-19-centro-solicitudes-fases.md` (fases aprobadas por Diego 2026-08-19).

## Global Constraints

- Defaults acordados: enlace AUTENTICADO; destinatario inicial diegosalguerotang@gmail.com; copia al jefe inmediato al crear; acuse en papeletas de motivo Particular; sin saldo de vacaciones (se declara y RRHH valida); correlativo por RS+año (`PAP-NEG-2026-0001`, `VAC-PRO-2026-0001`).
- Jefe inmediato = `sedes.supervisor_dni` de la sede del vínculo vigente (editable en el formulario si la sede no lo tiene).
- Nadie se aprueba a sí mismo: si el solicitante es el aprobador del paso, el paso se salta al armar la cadena; y la RPC rechaza resolver la solicitud propia.
- Rechazar, observar y anular EXIGEN comentario; aprobar no. Aprobada no se edita: se anula (solo nivel aprobar) y se crea otra.
- Módulo nuevo `solicitudes` en Accesos: ver=consultar+tablero; accionar=registrar a nombre de+observar; aprobar=V°B°/rechazar/anular.
- El correo lleva resumen + enlace, sin PDF ni datos sensibles; el fallo de correo NUNCA bloquea el registro.
- El tablero cuenta solicitudes; jamás muestra montos ni descuentos.
- Retorno < salida se rechaza en validación (BD); cruce de medianoche y superposiciones son ADVERTENCIA, no bloqueo.

---

### Task 1: BD — motor de solicitudes (`supabase/solicitudes.sql` + migración)

Tablas: `solicitud_tipos` (id slug, nombre, prefijo, codigo_formato, version, empresa_id membrete, portal/backoffice bool, cadena jsonb, genera_documento, acuse text 'nunca'|'siempre'|'motivo_particular', activo), `solicitud_correlativos` (tipo, empresa, anio → ultimo), `solicitudes` (numero único, tipo_id, solicitante congelado: dni/nombre/cargo/sede/empresa/supervisor_dni/supervisor_nombre, datos jsonb, estado enviada|observada|aprobada|rechazada|anulada + paso_actual, cadena congelada, documento_id fk null, creado_en/por), `solicitud_eventos` (historial inmutable con snapshot al reenviar; trigger que prohíbe update/delete), `solicitud_avisos` (tipo_id null=todos, correo, copia bool, activo).
Helpers: `fn_persona_llamador()` (correo JWT → usuarios_admin.persona_dni), `fn_solicitud_numero(tipo, empresa)`, `fn_solicitud_insertar` (deriva vínculo+supervisor, congela cadena saltando pasos donde el aprobador sería el propio solicitante, valida papeleta: retorno>salida, motivo válido, especificación si Otros, fundamentación; vacaciones: rango válido).
RPCs: `portal_crear_solicitud(p_tipo,p_datos)` (dni del JWT; SOLO tipos con portal=true), `crear_solicitud_admin(p_dni,p_tipo,p_datos,p_por)` (nivel≥2), `resolver_solicitud(p_id,p_decision aprobar|observar|rechazar|anular,p_comentario,p_por)` (nivel≥3, o supervisor de la sede con nivel≥2 en el paso jefe; anular solo aprobadas; comentario obligatorio salvo aprobar; papeleta no se aprueba en el último paso sin adjunto), `reenviar_solicitud(p_id,p_datos)` (solo observada, solo el solicitante desde portal o nivel≥2; snapshot del dato anterior a eventos), `guardar_solicitud_aviso`/`eliminar_solicitud_aviso` (nivel≥3).
Vistas: `v_solicitudes` (todo + paso_titulo + advertencia de superposición), `v_solicitud_tipos`, `v_portal_solicitudes` (por portal_dni, sin nota alguna interna), `v_solicitud_avisos`, `v_solicitudes_tablero` (agregados por mes/tipo/estado/motivo).
Seed: 2 tipos + aviso diegosalguerotang@gmail.com. Módulo `solicitudes` en `src/data/modulos.js` + ruta ordenada.
Verificar y commitear.

### Task 2: BackOffice — bandeja + formularios (SOL-01/SOL-02)

`src/pages/solicitudes/Bandeja.jsx` (SOL-01): filtros (estado, tipo, búsqueda), stats, tabla, detalle en modal con historial de eventos y acciones según nivel/paso (aprobar/observar/rechazar/anular con comentario, advertencias de superposición y de adjunto faltante). `src/pages/solicitudes/Nueva.jsx` (SOL-02, ruta directa `/solicitudes/nueva`): selector de tipo (ambos en BackOffice) + formulario del tipo — papeleta: buscador de trabajador, derivados solo-lectura, supervisor editable, salida/retorno fecha+hora, motivo (Salud/Particular/Comisión/Otros), especificación condicional, fundamentación, adjunto (Storage vía proxy); vacaciones: derivados, tipo Efectivas/Gozadas, desde/hasta, días gozados propuestos y editables (mostrar diferencia), días trabajados, periodo, horario manual. Menú: grupo "Solicitudes" (SOL-01 Bandeja, SOL-02 Nueva, SOL-03 Avisos, SOL-04 Tablero) + rutas + state.jsx. Commit.

### Task 3: Portal — vacaciones (web responsive)

`portal/src/pages/Solicitudes.jsx`: crear SOLO los tipos con portal=true (vacaciones): derivados del perfil, formulario compacto móvil, y "Mis solicitudes" con estado y comentarios de observación + reenviar corregida. Pestaña/entrada desde Inicio. La papeleta no existe en el portal (criterio de aceptación). Commit.

### Task 4: Notificaciones (`aviso-solicitud` en api/enviar-correo.js + SOL-03)

Acción `aviso-solicitud` {numero, evento}: creado → avisos del tipo (+ copia al jefe si tiene correo en personas); estado → correo del solicitante (personas.correo si existe); resuelto → solicitante + avisos. Resumen + enlace `/solicitudes` (o portal), sin datos sensibles. Fire-and-forget desde las pantallas. `src/pages/solicitudes/Avisos.jsx` (SOL-03): destinatarios/copias por tipo, editable sin deploy. Commit.

### Task 5: PDF al legajo (api/solicitud-pdf.js)

Al aprobar, la pantalla llama `POST /api/solicitud-pdf {numero}` (x-sesion admin): genera con pdf-lib el formato de la RS del tipo (logo desde `public/`, código de formato+versión, campos, tabla de aprobaciones con quién/cuándo del servidor), sube al bucket privado `documentos` en `solicitudes/<empresa>/<numero>.pdf` (service key), inserta en `documentos` (vinculo vigente, tipo 'solicitud', hash sha256, archivo_url=ruta) y si el tipo exige acuse (papeleta+Particular) queda pendiente en el portal como cualquier documento. Guarda documento_id en la solicitud. Idempotente por numero. Commit.

### Task 6: Tablero mensual (SOL-04)

`src/pages/solicitudes/Tablero.jsx` sobre `v_solicitudes_tablero` + consultas: filtro mes/RS/sede/tipo; tarjetas: por tipo y estado, papeletas por motivo, horas de permiso y días de vacaciones aprobados, comparativa mes anterior / mismo mes año anterior, pendientes por aprobador con antigüedad, tiempo promedio de resolución, top solicitantes, distribución por sede/área. Export CSV. Mes cerrado = números estables (solo cuenta por fecha de creación/resolución). Commit.

### Task 7: Verificación E2E + deploy + checklist a Diego

`scripts/verificar-solicitudes.mjs`: crear papeleta admin (correlativo PAP-NEG-año-NNNN), retorno<salida rechazada, observar→reenviar (historial con 2 versiones), cadena de 2 pasos, autoaprobación bloqueada, rechazar sin motivo imposible, aprobada inmutable + anular con motivo, vacaciones desde portal_crear denegada sin sesión, v_portal_solicitudes scoping, avisos CRUD, aprobar papeleta sin adjunto bloqueado. npm test + push + deploy + prueba de humo en producción. Actualizar memoria. Reporte con qué verificar a mano.
