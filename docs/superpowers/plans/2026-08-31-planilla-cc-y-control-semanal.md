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

- [ ] A1 Parser `src/lib/importar/padron.js` (TDD contra fixture): detección por los
      12 encabezados, trim global, empresa por RUC, CÓDIGO debe coincidir con N DOC,
      documentos sin rellenar (CE 004193432/002771952/003308122 íntegros), regla de
      siglo 00-50, nombre truncado a 30, situación VIGENTE.
- [ ] A2 BD: `personas.sexo`, catálogo `centros_costo` (8 valores), área heredada
      inerte, RPCs `previsualizar/importar_padron` patrón PV999 multi-RS todo-o-nada,
      sin tocar banco/cuenta/sede/contrato, prefijo no acorta nombres, reimporte
      idempotente, nadie cesa por ausencia.
- [ ] A3 Hora de entrada versionada (vigencia) + edición en Legajo + «pendiente de
      configurar».
- [ ] A4 RRH-05: solo el formato nuevo; vista previa con cargos que cambiaron y
      resumen de perfiles propuestos; «Sí, subir a las 3 razones sociales».
- [ ] A5 Perfiles: 13 categorías de la matriz (seed), correspondencia cargo→perfil
      administrable, bandeja de propuestas aprobada por superadmin en ACC-02, aviso
      por cambio de cargo; jamás otorga acceso por importación.
- [ ] A6 Suite `verificar-padron.mjs` + criterios de aceptación del spec.

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
