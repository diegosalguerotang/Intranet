# Importación de Inventario de Activos — Plan aprobado (2026-08-17)

**Fuente:** `Importacion_Activos.docx` (Tareas 15-08, prompt completo de Diego — es la
especificación funcional; este plan solo ordena la ejecución). Fixture:
`tests/fixtures/EQUIPOS_DE_COMPUTO_ACTIVOS_FIJOS.xlsx` (Formato 7.1 SUNAT usado como
inventario; hoja única a importar: "AF EQUIPO DE COMPUTO"). Pantalla nueva **ADQ-08**
(Administración → Activos y equipos → Importar inventario).

**Reconocimiento (Paso 0, verificado):** ADQ-01..07 ocupados. `activos.codigo` es PK
global (identidad = código, alineado con el doc; "código en otra empresa" se detecta por
`empresa_id` distinto → bloqueante/traslado). `leerXlsx` solo lee `sheet1.xml` y el libro
trae 12 hojas (la 1.ª oculta) → extender lector con hoja por nombre. Choques del modelo
con el archivo real (exigen migración): `serie`/`marca`/`modelo` NOT NULL, `unique
(categoria, serie)`, `categoria` check cerrado, faltan `tipo`/`area`/
`asignado_sin_confirmar`/`usuario_anterior`/`observaciones`. Los 5 duplicados del doc
coinciden exactos en el fixture (PROLT51×2, EPSON2018×3, EPSON2024×3, EPSON 2025×2,
EPSON2019×2). Catálogo: tabla `empresas` (PROMANT = 'PROMANT SERVICIOS', forma corta) →
normalización denominación completa ↔ corta.

**Decisiones:** (1) Impresoras: NO se recodifican — los duplicados bloquean, tal cual el
doc; la recodificación por serie queda para cuando Diego defina la regla. (2) LAPTOP/PC/
IMPRESORA/FOTOCOPIADORA entran como `categoria='Cómputo'` con el detalle del archivo en
el campo nuevo `tipo` (propuesto y aprobado con el plan).

## Fases

- [x] **Fase 1 — Parser con TDD contra el fixture.** `leerXlsx` con hoja por nombre
  (workbook.xml + rels; error claro si la hoja no existe). `src/lib/importar/activos.js`:
  validación Formato 7.1, razón social de cabecera (fila DENOMINACIÓN, por contenido),
  encabezados por contenido en 4 filas apiladas, trim universal, separadoras de área como
  contexto de las filas siguientes, totales descartados, filas agregadas a revisión,
  modelo numérico como entero (nunca fecha/decimal), duplicados 4 tipos con mensajes
  completos (código, filas, usuario de cada una), serie "real" solo si ≥8 caracteres con
  dígitos, validación cruzada prefijo PROLT/PROPC vs detalle. Pruebas = los 14 criterios
  de aceptación del doc, contra el fixture real.
- [x] **Fase 2 — BD.** Migración `activos`: columnas nuevas (`tipo`, `area`,
  `asignado_sin_confirmar`, `usuario_anterior`, `observaciones`), `serie`/`marca`/
  `modelo` opcionales, unique(categoria,serie) revisado. RPCs transaccionales
  `previsualizar_importacion_activos` / `importar_activos` (idempotentes, nunca baja por
  ausencia, nunca sobrescribir con vacío ni con prefijo más corto, auditoría con razón
  social confirmada + archivo + total + quién). Canónico `schema.sql` sincronizado.
- [x] **Fase 3 — Pantalla ADQ-08.** Flujo: archivo → confirmación bloqueante (razón
  social en grande, botón "Sí, subir a PROMANT") → vista previa (altas / actualizaciones
  campo a campo / duplicados / a revisar) → importación transaccional. La razón social
  del archivo manda (no es selector); fuera del catálogo → rechazo total; fuera del
  alcance del usuario → denegación estándar sin revelar existencia.
- [x] **Fase 4 — Verificación y cierre.** `npm test` completo, script
  `verificar-importacion-activos.mjs` contra producción, suites previas verdes, commit →
  push → deploy, estado final documentado.

## Estado final (2026-08-17)

CICLO EJECUTADO COMPLETO. Verificación: vitest 66/66 (18 del parser + 6 de
`resolverEmpresaArchivo` contra el fixture real: 72 activos, 65 códigos, los 5
duplicados exactos, 3 contradicciones prefijo/tipo, serie repetida solo
LNVNB161216); `verificar-importacion-activos.mjs --proxy` 16/16 en producción
(migración, RPCs con datos ZZPRUEBA- acotados, y el canal real /api/supa);
`verificar-tres-ajustes.mjs` sigue verde. La regla de serie con forma real
quedó como ≥8 caracteres + ≥2 dígitos + sin espacios (la literal del doc, ≥8 y
con dígitos, dejaba pasar INTEL CORE I3 y 12TH GEN INTEL — sus propios
contraejemplos).

DECISIÓN DE DIEGO (2026-08-17): **las impresoras se recodifican por número de
serie.** Implementado como comportamiento por defecto del parser
(`recodificarImpresoras: true`): impresora + serie con forma real → código =
serie; el código del archivo queda en observaciones y en `codigoArchivo`, y la
vista previa lista cada recodificación. En el archivo real: 11 de 14
impresoras recodificadas, los 4 choques EPSON+año resueltos.

SEGUNDA DECISIÓN DE DIEGO (2026-08-17): **un código repetido dentro del
archivo ya NO bloquea la importación — entra marcado «repetido, falta
corregir».** Implementado: el parser marca `repetido` en todas las ocurrencias
y sufija las repeticiones con un código provisional determinista (-R2, -R3…);
la BD guarda el estado en `activos.por_corregir` (el RPC lo escribe SIEMPRE:
true al importar una repetición, false cuando el archivo corregido ya no
repite el código — reimportar corrige el estado solo); ADQ-01 muestra el badge
«Falta corregir» junto al código; la vista previa lista código, filas,
usuarios, quién lo tiene en el sistema y el provisional asignado. Con esto el
archivo real de PROMANT importa COMPLETO: PROLT51 (filas 20/67) entra como
PROLT51 + PROLT51-R2, ambos marcados. Migración
`2026-08-17-activos-repetidos.sql` aplicada; verificación 18/18 en producción
(incluye limpieza del estado al reimportar corregido); vitest 76/76.
