# Centro de Solicitudes — Plan por fases (pendiente de aprobación de Diego)

Fuente: `Tareas 19-08/Centro_de_Solicitudes_RRHH.docx`. Reconocimiento (Paso 0) hecho el 2026-08-19; hallazgos clave: supervisor existe A NIVEL DE SEDE (`sedes.supervisor_dni`), el motor de correo espera proveedor (Gmail SMTP acordado), generación de PDF es terreno nuevo (pdf-lib disponible), y la frontera con el módulo Soporte quedó acordada (tickets = incidencias TI; Centro = pedidos formales con aprobación).

## Fase 1 — Motor y tipos (BD)
Tablas: `solicitud_tipos` (nombre, codigo_formato GR-F-14/GR-F-012, version, superficies portal/backoffice, campos jsonb, cadena_aprobacion jsonb, genera_documento, exige_acuse, empresa_id) + `solicitudes` (correlativo por RS y año, solicitante, vínculo congelado, datos jsonb, estado: enviada→revision_jefe→revision_rrhh→aprobada / observada / rechazada / anulada) + `solicitud_eventos` (quién, cuándo, comentario — historial inmutable). RPCs: crear (portal autenticado + backoffice a nombre de), mover estado (nadie se aprueba a sí mismo: salto de paso; rechazar/anular exigen motivo; aprobada no se edita). Módulo `solicitudes` en Accesos (ver / accionar / aprobar). Seed: papeleta (solo BackOffice, 3 firmas → 2 pasos) y vacaciones (ambas superficies, 1 paso).

## Fase 2 — Pantallas
BackOffice: bandeja de solicitudes (filtros, detalle con historial, aprobar/observar/rechazar/anular), formulario dinámico según tipo (papeleta: salida/retorno con validaciones, motivo, adjunto del original firmado; vacaciones: rango, días propuestos calculados pero editables, sin saldo). Portal: crear vacaciones + mis solicitudes (la papeleta NO aparece). Enlace directo `/solicitudes/nueva` autenticado.

## Fase 3 — Notificaciones
Pantalla de configuración de destinatarios por tipo (valor inicial diegosalguerotang@gmail.com desde env). Al crear → destinatarios + jefe inmediato; cambio de estado → solicitante; resolución → solicitante y RRHH. Resumen + enlace, sin PDF ni datos sensibles. Asíncrono: el fallo de correo no bloquea y queda visible. Canal Motor 9 preparado y apagado.

## Fase 4 — PDF y legajo
Plantilla por razón social versionada (logo + código de formato + versión); el PDF incluye correlativo y el registro de aprobación (quién/cuándo por paso) en lugar de firmas. Se archiva en el legajo vía motor documental (bucket privado, Ley 29733); acuse en portal si el tipo lo exige (default: papeletas con motivo particular).

## Fase 5 — Tablero mensual RRHH
Pantalla en RRHH con filtros mes/RS/sede/área/tipo: totales por tipo y estado, papeletas por motivo, horas de permiso y días de vacaciones, comparativas, pendientes por aprobador con antigüedad, tiempo promedio de resolución, top solicitantes, distribución. Exportable respetando permiso de datos personales. Cuenta solicitudes, no calcula planilla.

## Decisiones que el doc deja a Diego (se implementa el default marcado)
1. Enlace autenticado (default) vs abierto con DNI.
2. Copia automática al jefe inmediato: configurable por tipo (default sí en creación).
3. Acuse obligatorio en papeletas de motivo particular (default sí).
4. Extranjeros con CE/pasaporte no pueden entrar al Portal (autentica por DNI) — afecta Motor 1, se reporta, no se resuelve aquí.
5. Códigos de formato de L. Americana y Clean — faltan; las plantillas nacen solo para NEGLIAF y PROMANT.
6. Falta subir los formatos de referencia (PAPELETA_DE_PERMISO_NEGLIAF.docx, SOLICITUD_VACACIONES_PROMANT_SERVICIOS.xlsx) si se quiere fidelidad visual del PDF.
