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

- [ ] B1 Parser `control-semanal.js` (TDD): solo Detalle Diario; banner = fila sin
      documento en B; 9 tipos (FERIADO con nombre extraído); h:mm vs decimal
      cotejados; EDITADO/MOTIVO opcionales; H.E. = hora de entrada.
- [ ] B2 BD: modelo ampliado (tipo de día, H.E., minutos trabajados/exceso/déficit/
      tardanzas, observación, editado+motivo, estado Revisar), importación
      multi-empresa por padrón quitando ceros, excepciones (42242854), reemplazo
      idempotente por rango.
- [ ] B3 Recálculo propio + contraste con Resumen Mensual (reporta trabajador y
      columna); tolerancia 3 tardanzas × 30 min en configuración; primera importación
      puebla H.E., las siguientes contrastan.
- [ ] B4 Pantalla RRH-22 «Importar control» (convive con el reporte del reloj);
      tablero por centro de costo con alcance por RS.
- [ ] B5 Recálculo reactivo (solicitud aprobada / feriado nuevo → reclasifica el día,
      marca «recalculado») + mini-UI de feriados en Configuración.
- [ ] B6 Suite E2E + los 15 criterios de aceptación.
