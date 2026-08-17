# Módulo disciplinario parametrizado por RIT — Plan (2026-08-17)

**APROBADO POR DIEGO (2026-08-17) con estas decisiones:**
1. Plazos de descargo: seguir la línea del documento — 3 días hábiles (amonestación
   escrita) y 5 (suspensión), como PARÁMETRO editable mientras se modifica el RIT.
2. **El sábado ES día hábil**; se excluyen domingos y feriados.
3. La suspensión la imponen **Gerencia General / Recursos Humanos / Administración**
   (en el sistema: categorías con nivel de aprobación en el módulo memorandums).
4. **El RIT de CLEAN rige para TODAS las razones sociales por ahora** (el modelo queda
   preparado para un RIT por empresa: `empresas.rit_id`).

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

## Estado final (2026-08-17)

CICLO EJECUTADO COMPLETO (fases 1–4 en una sesión). Migración
`2026-08-17-disciplinario.sql` aplicada; catálogo literal sembrado (19+31
faltas); 6 tipos de proceso; feriados Perú 2026; motor `fn_sumar_dias`
(sábado hábil); `emitir_memorandum` v2 (congela texto/antecedentes,
reincidencia, tope suspensión, nivel del emisor vía `fn_nivel_memorandums` en
accesos.sql) + `notificar_memorandum`; v_memorandums con vencimiento derivado
y alerta de preaviso; pantalla RRH-18/19 parametrizada; expediente 0141-2026
corregido a art. 20 c) conc. 56.1. Verificación:
`verificar-disciplinario.mjs` 10/10 en producción; vitest 84/84. Canónicos
schema.sql y accesos.sql sincronizados. PENDIENTE FUTURO: TRB-09/10 (descargo
del trabajador desde el portal con fotos), generación del documento PDF desde
plantilla, y carga de RIT propio por empresa cuando existan.

## Decisiones que Diego tomó antes de ejecutar (registradas arriba)

1. **Plazos de descargo** para amonestación escrita y suspensión: el RIT NO los fija
   (hallazgo principal del doc). Sugeridos: 3 y 5 días hábiles. ¿Se ejecuta con esos
   valores como parámetro editable mientras se modifica el RIT ante la AAT?
2. **Definición de día hábil**: ¿el sábado cuenta? (El formulario actual lo asume.)
3. **Quién impone la suspensión** (vacío del RIT): ¿Gerencia General mientras tanto?
4. **NEGLIAF y las demás empresas**: ¿tienen RIT propio para cargar, o mientras tanto el
   módulo solo opera para CLEAN? (Los números de artículo NO son transferibles.)
