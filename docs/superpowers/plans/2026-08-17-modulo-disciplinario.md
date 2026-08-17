# Módulo disciplinario parametrizado por RIT — Plan propuesto (2026-08-17)

**PENDIENTE DE APROBACIÓN DE DIEGO.**

**Spec:** `Tareas 17-08/parametrizacion_disciplinario_1.md` (documento de trabajo de
Diego) + `REGLAMENTO INTERNO CLEAN.pdf` (RIT CONSORCIO CLEAN 2025, 24 páginas —
verificado legible con el lector pdfjs del proyecto: el catálogo de faltas se siembra
desde el texto LITERAL de los art. 20 y 56).

**Qué cambia de fondo:** el módulo actual (RRH-18/19) usa tipos inventados ("Llamada de
atención"), plazo fijo de 5 días sin respaldo, y un campo de artículo en texto libre que
los expedientes reales usan mal (invocan art. 12/15, que no tipifican nada). Pasa a
parametrizarse POR EMPRESA desde su RIT.

## Fases propuestas

- [ ] **Fase 1 — BD: catálogo por empresa.** Tablas `rit` (empresa, versión, vigente
  desde) y `rit_faltas` (artículo, inciso/numeral, texto LITERAL — sembrado del RIT de
  CLEAN: art. 20 a–r y art. 56 numerales 1–31, concordancia 56.1→20). Tabla
  `tipos_sancion` por empresa: Amonestación verbal (registro interno con reporte a RR.HH.
  ≤24 h, NO genera memorándum notificable), Amonestación escrita, Suspensión sin goce
  (tope duro 3 días laborables validado), Despido. El preaviso sale del selector de
  sanciones y se modela como ETAPA del procedimiento (imputación, art. 31 LPCL).
- [ ] **Fase 2 — BD: expediente y plazos.** `memorandums` gana: falta invocada (FK al
  catálogo, imprime el texto literal en el documento), naturaleza, antecedentes del
  trabajador congelados al emitir (motivación del art. 54), reincidencia derivada del
  historial (art. 58), rol del emisor validado contra la categoría (quién puede imponer
  qué). Motor de plazos: sanciones en días HÁBILES (definición de día hábil: parámetro,
  hoy asumimos sábado sí / domingos y feriados no — A CONFIRMAR), preavisos en días
  NATURALES (≥6 conducta, 30 capacidad — imperativos de ley, no configurables); el plazo
  corre desde la notificación válida (ya es así); vencimiento automático del preaviso
  sin acuse → alerta para notificación notarial.
- [ ] **Fase 3 — Pantallas.** RRH-18 emisión: selector de naturaleza según RIT de la
  empresa + selector de falta en dos niveles (art. 20 inciso / art. 56 numeral) con
  texto literal visible + antecedentes del trabajador en pantalla al emitir + campo
  suspensión con tope 3 días. RRH-19 bandeja: estados por etapa (incluye preaviso),
  filtros ya mejorados (persona/fecha). Registro de amonestación verbal (pantalla
  simple: hecho + acuse del supervisor, sin carta al trabajador).
- [ ] **Fase 4 — Verificación** (suite BD + E2E del flujo completo con el RIT real) y
  actualización de expedientes demo mal tipificados (0141-2026 → art. 20 c) conc. 56.1).

## Decisiones que necesita tomar Diego ANTES de ejecutar

1. **Plazos de descargo** para amonestación escrita y suspensión: el RIT NO los fija
   (hallazgo principal del doc). Sugeridos: 3 y 5 días hábiles. ¿Se ejecuta con esos
   valores como parámetro editable mientras se modifica el RIT ante la AAT?
2. **Definición de día hábil**: ¿el sábado cuenta? (El formulario actual lo asume.)
3. **Quién impone la suspensión** (vacío del RIT): ¿Gerencia General mientras tanto?
4. **NEGLIAF y las demás empresas**: ¿tienen RIT propio para cargar, o mientras tanto el
   módulo solo opera para CLEAN? (Los números de artículo NO son transferibles.)
