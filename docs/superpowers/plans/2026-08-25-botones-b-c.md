# Botones B + C — que todo botón diga la verdad (2026-08-25)

Cierre de la auditoría de botones (349 controles). Bloque A ya deployado
(a3015bf). Diego aprobó B y C con la consigna: **hacer verdad cada registro
con la infraestructura existente** (Storage privado, RPCs auditadas,
declaraciones versionadas, registro inmutable).

## B — muertos que se implementan

1. **Acuses RRH-11 · selector de sedes real**: opciones desde `db.sedes` de la
   empresa activa (estaban hardcodeadas sunat/migraciones/minedu/ins).
2. **Acuses RRH-11 · «Exportar constancias del lote»**: un solo PDF con una
   constancia por página (los acuses confirmados/asistidos filtrados), reusando
   `generarConstanciaPdf` + merge con pdf-lib (import dinámico).
3. **Planilla RRH-02 · «Exportar»**: CSV del maestro filtrado por empresa
   activa, gated por `esSuperadmin || exportarDatosPersonales` (patrón SOL-04);
   sin columnas bancarias.
4. **Legajo RRH-03 · «Constancias»**: navega a RRH-12 (`/rrhh/acuses/:dni`) —
   la pantalla real de constancias del trabajador.
5. **Legajo RRH-03 · «Descargar legajo»**: PDF resumen de UNA página
   (datos no bancarios + vínculo vigente + conteos + últimos movimientos),
   generador compartido con la constancia (`titulo` parametrizado).
6. **Memorándums RRH-18 · «Exportar expediente completo»**: PDF del expediente
   desde el registro congelado (falta literal, antecedentes, descargo,
   resolución), mismo generador.
7. «Recordar por WhatsApp» (RRH-11) deja de fingir: deshabilitado con
   «Próximamente (Motor 9)» como el de comunicados.

## C — demos que se vuelven verdad

**C1 · Acuse asistido RRH-13 real.** El RPC ya copiaba el hash REAL del
documento; lo falso era el espejo local y el adjunto fantasma.
- Migración `2026-08-25-botones-b-c.sql`:
  - bucket `documentos`: mimes pdf+jpeg+png+webp (el hardening de ayer lo dejó
    solo-PDF y rompía la foto del cargo Y los adjuntos de papeleta);
  - declaración versionada `acuse-asistido` v1 (el texto que el registrador
    declara con la casilla);
  - `registrar_acuse_asistido` v2: gate `fn_nivel_modulo('acuses')>=2`, exige
    que `p_adjunto` EXISTA en storage.objects, supervisor real por JWT
    (`fn_persona_llamador` → supervisor_dni + nombre), dispositivo del cliente,
    declaración copiada íntegra; DROP de la firma vieja;
  - `v_acuses` + `adjunto_url` (columna al final).
- Cliente: input file real → sube a `cargos/<lote>/<dni>-<ts>.<ext>` → RPC con
  la ruta; fecha default hoy; se elimina el hash inventado del update local.
- RRH-12: botón «Ver cargo firmado» (URL firmada client-side, RLS admin).

**C2 · Activos ADQ-02/03/04 reales.** `asignar_activo`/`devolver_activo` ya
aceptan condición — la UI no la enviaba.
- RPC nuevo `crear_activo` (nivel activos>=2, código PK global, IMEI único).
- AltaActivo: formulario controlado que llama `crear_activo`.
- Asignar/Devolver: selects de condición conectados; se eliminan los input de
  fotos y la casilla de cargo (teatro sin motor detrás — se quitan, no se
  fingen); fecha = registro real del servidor.

**C3 · Legajo pestaña Actividad real.** Vista `v_actividad_persona` sobre la
tabla `auditoria` (triggers fn_auditar + resúmenes de RPCs): fecha, usuario,
acción, tabla, extrayendo el dni del jsonb (`persona_dni`/`dni`/`p_dni`/
`dni_check`). SIN exponer el detalle jsonb (puede contener datos sensibles).
Se consulta al abrir el legajo (patrón pendientesComunicado).

## Verificación
Suite nueva `scripts/verificar-botones-bc.mjs` (Management API + proxy):
acuse asistido con adjunto real subido / rechazo sin adjunto / supervisor real;
crear_activo + duplicado; v_actividad_persona devuelve filas del dni; bucket
acepta jpeg. Builds + vitest. Deploy y smoke.

## Deuda anotada (no de este ciclo)
`fn_nivel_modulo` devuelve 99 sin JWT (patrón existente en todos los gates);
se endurece cuando llegue RLS fina con `puede()`. Adjunto del descargo del
memorándum sigue demo (TRB-09/10, Motor de adjuntos).
