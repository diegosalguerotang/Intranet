# Tipo de documento (DNI/CE/Pasaporte) + PDF fiel a los formatos — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) Trabajadores con documento distinto de DNI: selector de tipo (DNI / Carné de extranjería / Pasaporte) al dar de alta, editar e ingresar al portal; el número puede ser alfanumérico. (B) El PDF de solicitudes calca los formatos de papel reales que subió Diego (PAPELETA DE PERMISO NEGLIAF.docx: cajas salida/retorno, casillas de motivo, 3 firmas; SOLICITUD VACACIONES PROMANT.xlsx: «DNI / Pasaporte / C.E.», tipo «Efectivas/Gozadas» vs «Pagadas/Trabajadas», V°B° Gerente RR.HH.). (C) Corregir el tipo de goce de vacaciones a las dos opciones reales del formato.

**Architecture:** `personas.dni` SIGUE siendo la clave primaria (el «número de documento»); se agrega `personas.tipo_documento`. La validación del formato del número se hace por tipo en una función central (`fn_validar_documento`) usada por alta/edición. El portal autentica con `lower(numero)@portal.grupoer.pe`; `portal_dni()` se vuelve resolutor canónico (busca la persona por lower(dni)) para que TODO el scoping existente siga funcionando con números alfanuméricos.

## Global Constraints

- Tipos: 'DNI' (8 dígitos), 'CE' (9–12 alfanumérico), 'Pasaporte' (6–15 alfanumérico). Los números se guardan en MAYÚSCULAS.
- La importación PLATRA1 (Excel de planilla) queda como está: solo trae DNIs; CE/pasaporte entran por alta manual (RRH-04).
- Vacaciones tipo de goce: «Efectivas / Gozadas» o «Pagadas / Trabajadas» (formato real GR-F-012).
- La clave inicial del portal sigue 111111; el mensaje único del login no revela existencia.

### Task 1: BD — tipo_documento + portal_dni canónico + tipo de goce
Migración `2026-08-19-tipo-documento.sql` (+ sincronizar canónicos schema/portal/solicitudes):
`personas.tipo_documento` default DNI; soltar el check `dni ~ '^[0-9]{8}$'` → `'^[0-9A-Z-]{4,20}$'`; `fn_validar_documento(tipo, numero)`; `alta_trabajador` y `editar_trabajador` + `p_tipo_documento` (validan y normalizan a mayúsculas; DROP firmas viejas); `v_personal` + tipo_documento; `portal_dni()` resuelve contra personas por lower(dni); `fn_solicitud_validar` acepta los dos tipos de goce reales; `v_solicitudes` expone tipo_documento del solicitante. Verificar con SQL y commitear.

### Task 2: Serverless — portal-cuentas y recuperación con alfanuméricos
`api/portal-cuentas.js`: valida contra el maestro (existencia + tipo) en vez del regex fijo; correo = `lower(dni)@portal`. `api/enviar-correo.js` acción recuperacion: regex `[0-9A-Za-z-]{4,20}`. `api/solicitud-pdf.js`: trae tipo_documento y etiqueta el campo según formato.

### Task 3: UI BackOffice — alta y edición con selector
RRH-04 (Personal.jsx AltaTrabajador): Select tipo + Input número (numérico 8 para DNI; alfanumérico mayúsculas para CE/Pasaporte). Legajo (editar_trabajador modal): mismo par. Columna/labels: donde diga «DNI» genérico y aplique, mostrar el número tal cual (el tipo visible en el legajo).

### Task 4: UI Portal — ingreso con selector de documento
Ingreso.jsx: selector de tipo de documento sobre el campo; validación por tipo; `correoDe` → lower(). Textos: «Tu documento» con placeholder según tipo. PrimerIngreso/recuperación sin cambios de fondo (usan la cuenta ya creada).

### Task 5: PDF fiel a los formatos de papel
`api/solicitud-pdf.js`: papeleta con cajas SALIDA/RETORNO (día-mes-año-hora), casillas de motivo marcadas, FUNDAMENTACIÓN, «Supervisor - Sede», bloque de 3 V°B° con el registro digital; vacaciones con «DATOS DEL TRABAJADOR», «DNI / Pasaporte / C.E.», casillas del tipo de goce, DESDE/HASTA, DÍAS, PERIODO, «V°B° Gerente RR.HH.». Formularios (BackOffice y portal) con las dos opciones reales de goce.

### Task 6: Verificación + deploy
Extender `verificar-solicitudes.mjs` (goce nuevo) + suite nueva `verificar-tipo-documento.mjs` (alta CE, formato inválido rechazado, portal_dni canónico con cuenta alfanumérica real, v_personal expone tipo). npm test, push, E2E PDF en producción de nuevo (patrón admin temporal), reporte a Diego.
