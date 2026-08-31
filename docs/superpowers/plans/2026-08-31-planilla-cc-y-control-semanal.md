# Plan 2026-08-31 — Planilla con centro de costo + Lectura del Control Semanal

Specs de Diego en `OneDrive/Documentos/Intranet/Tareas 31-08/`:
`Planilla_Centro_de_Costo_y_Perfiles.docx` y `Lectura_Control_Semanal_Formato_Actual.docx`.
Fixtures commiteados: `tests/fixtures/PLANILLA_UNIFICADA_ULTIMO.xlsx` (79 filas, 3 RS
por RUC, sin datos bancarios) y `tests/fixtures/Control_Semanal_01-28_Agosto_2026.xlsx`
(hojas Resumen Mensual A1:AA65 y Detalle Diario A1:V1361, 41 trabajadores).

Decisiones (aprobadas por Diego 2026-08-31, con las propuestas del reconocimiento):

- El formato de 12 columnas con CENTRO DE COSTO reemplaza a PLATRA1 y al unificado
  con banco: es el ÚNICO que RRH-05 reconoce de aquí en adelante. Banco y cuenta ya
  no llegan por archivo (solo edición en ficha, cifrados).
- El nivel «Tardanzas» de la matriz de perfiles se aplica al módulo `asistencia`
  (RRH-22); RRH-20 sigue Próximamente.
- La hora de entrada se puebla desde la columna H.E. del control en la primera
  importación (no hay hoja HORARIOS); después se contrasta y se edita en ficha.

## Bloque A — Planilla con centro de costo y perfiles

- [x] A1 Parser `src/lib/importar/padron.js` (TDD 13/13 contra fixture): detección
      por los 12 encabezados, trim global, empresa por RUC, CÓDIGO debe coincidir con
      N DOC, documentos sin rellenar (CE íntegros), regla de siglo, VIGENTE.
- [x] A2 BD (migración `2026-08-31-padron-cc.sql`, aplicada): `personas.sexo`,
      catálogo `centros_costo`, área heredada inerte, RPCs PV999 multi-RS; no toca
      banco/cuenta/sede/contrato. Preflight `scripts/previa-padron.mjs`.
- [x] A3 Hora de entrada versionada (migración `2026-08-31-hora-entrada.sql`,
      aplicada): `horarios_entrada` + `fn_hora_entrada` + `fijar_hora_entrada`;
      v_personal +sexo/centroCosto/horaEntrada; edición en el Legajo.
- [x] A4 RRH-05 importa SOLO el formato nuevo (parsers viejos inertes, quedan para
      las suites E2E); vista previa con cargos que cambiaron y ceses confirmables.
- [x] A5 Perfiles (migración `2026-08-31-perfiles-cargos.sql`, aplicada; canónico de
      importar_padron v2): 13 categorías, `cargo_perfiles` administrable (ACC-03),
      bandeja `perfil_propuestas` en ACC-01 (crear la cuenta ES aprobar), resumen en
      la vista previa. E2E real: 40 propuestas / 34 solo Portal / 5 sin sugerencia.
- [x] A6 Suite `scripts/verificar-padron.mjs`: 21/21 en producción.

## Bloque B — Lectura del Control Semanal (módulo Asistencia)

- [x] B1 Parser `control-semanal.js` (TDD 15/15 contra el archivo real): solo
      Detalle Diario; fila de datos = documento en B; 9 tipos (FERIADO con nombre
      extraído); h:mm en minutos cotejado contra el decimal; EDITADO/MOTIVO
      opcionales; H.E. verificada contra ENT1−tardanza; el Resumen Mensual se
      RECALCULA desde el detalle y se contrasta (41/41 en cero diferencias; el
      total de horas del archivo incluye el fin de semana trabajado).
- [x] B2 BD (migración `2026-08-31-control-semanal.sql`, aplicada): marcaciones
      ampliada (declarado + calc conviven), tolerancia/jornada en configuración,
      `importar_control` multi-empresa por documento sin ceros (sin vínculo =
      excepción; primera importación puebla H.E., después contrasta), reemplazo
      por rango. Preflight `previa-control.mjs`: 39 resueltos, 0 diferencias.
- [x] B3 Absorbida en B1 (contraste de resumen en el parser) y B2
      (`fn_recalcular_control` con tolerancia mensual en SQL).
- [x] B4 RRH-22: «Importar control» detecta el formato junto al reporte del reloj
      (vista previa completa); tablero mensual por centro de costo
      (v_asistencia_mensual) con pendientes de configurar; lotes Reloj/Control.
- [x] B5 (migración `2026-08-31-recalculo-reactivo.sql`, aplicada; canónico de
      fn_recalcular_control v2): trigger de solicitud aprobada + feriados
      administrables (`guardar/eliminar_feriado` recalculan el mes y marcan los
      días con el motivo); tarjeta Calendario de feriados en RRH-22.
- [x] B6 Suite `scripts/verificar-control-semanal.mjs`: 20/20 en producción,
      incluida la tolerancia exacta (40→10, 20→0, 10→0, 15→15) y el ciclo
      feriado agregado/retirado con trabajador sintético en 2027-02.
