# Diseño — Tres ajustes: importación Excel, boletas PDF, razones sociales

Fecha: 2026-08-15 · Aprobado por Diego el 2026-08-15 (plan por fases del Paso 0)

**Requerimiento fuente:** `docs/requerimientos/2026-08-15-tres-ajustes.md` (conversión fiel del
Word de Diego). Este diseño NO lo repite: registra las decisiones técnicas tomadas sobre él
tras el reconocimiento del repo. Ante cualquier duda, manda el requerimiento fuente.

## Hallazgos del reconocimiento que condicionan el diseño

- RRH-05 (importar planilla) y RRH-06→10 (carga de boletas) son hoy **100% simulados**: no hay
  parser que corregir ni lógica de "cesar ausentes" que quitar. Se construye desde cero.
- No hay framework de tests → se agrega **vitest** (dev-only, no afecta el bundle).
- No hay librería Excel ni PDF instalada.
- `cargo` es texto libre en `vinculos`; el catálogo solo existe como array `CARGOS` en
  `src/data/mock.js` → se crea tabla `cargos` en BD.
- `empresas` no tiene columna de estado → se agrega `estado` (`activa`/`retirada`).
- El RUC de LIMPIEZA AMERICANA en BD es demo (20534567890); las boletas reales traen
  **20601705185** → se corrige a los datos reales del requerimiento (obligatorio para que el
  cotejo de lote por RUC funcione).
- BREMCO tiene solo datos demo del seed: 2 vínculos, 1 sede, 1 contrato, 7 alcances de
  categoría (1 activa: Gerente de Administración v1), usuarios U-0002 y U-0004 afectados.
  0 lotes/documentos/acuses. **Decisión: se desactiva** (mecanismo queda construido); no se
  eliminan sus registros históricos.
- Datos fiscales de **CLEAN: pendientes de Diego**. Se construye todo y CLEAN se inserta con
  sus valores reales cuando lleguen (checkpoint; no se inventan).

## Decisiones de arquitectura

### Parsers como funciones puras (testeables en Node y usables en el navegador)

- `src/lib/importar/xlsx.js` — lector mínimo de .xlsx propio (unzip + XML): el archivo real es
  un reporte plano de texto; no se necesita SheetJS (~1 MB) para diez columnas de texto.
  Descomprime con `DecompressionStream` (navegador) / `node:zlib` (tests).
- `src/lib/importar/planilla.js` — parser del reporte PLATRA1: localiza encabezados por
  contenido, trim, regla de siglo 00–50→20xx / 51–99→19xx, `/  /` → null, descarta cabeceras
  repetidas y filas de relleno, razón social desde fila 1. Devuelve
  `{empresa, emitido, centroCosto, filas[], errores[]}` sin tocar la BD.
- `src/lib/boletas/pdf.js` — extracción de texto por página con **pdfjs-dist** (la única pieza
  con librería: parsear PDF a mano es frágil). Partición del PDF en documentos por página con
  **pdf-lib** (cada boleta = su(s) página(s) como PDF individual, subido a Storage).
- `src/lib/boletas/lote.js` — parser de anclas y validador de lote: DNI autoritativo, cotejo
  CODIGO vs DNI, correlativo 1..N sin saltos, RUC/periodo únicos, `JUNIO-2026` → `2026-06`,
  normalización de acentos/Ñ (NFD). Devuelve `{lote, boletas[], excepciones[]}`.
- Regla transversal anti-truncado: `esPrefijoTruncado(nuevo, actual)` — nunca sobrescribir un
  valor almacenado con uno más corto que sea su prefijo; nombres sin fuente completa se marcan
  `nombre_por_confirmar` y se reporta el conteo.

### Aplicación transaccional en BD (RPCs)

- `importar_planilla(jsonb)` — recibe el resultado parseado + confirmación; upsert idempotente
  de personas/vínculos/sedes en una transacción. Nunca cesa por ausencia; nunca escribe null
  sobre datos manuales (nacimiento, celular, correo, banco, cuenta); vista previa calculada
  por `previsualizar_importacion(jsonb)` (misma lógica, sin escribir).
- `publicar_lote_pdf(jsonb)` — crea lote + documentos (hash SHA-256 por archivo, calculado con
  WebCrypto antes de subir) y bloquea si hay excepciones sin resolver. Reprocesar el mismo
  archivo no duplica (clave natural empresa+tipo+periodo+DNI+hash).
- Migración `supabase/migraciones/2026-08-15-tres-ajustes.sql` idempotente + sincronizar
  `schema.sql` canónico: tabla `cargos`, columna `empresas.estado`, columna
  `personas.nombre_por_confirmar`, columna `vinculos.centro_costo`, datos reales de
  L. AMERICANA, desactivación de BREMCO, alta de CLEAN (cuando haya datos).

### UI

- RRH-05: el modal simulado se vuelve real — parsear en el navegador, vista previa (altas /
  actualizaciones / sin cambio / errores), confirmar = RPC transaccional, todo o nada.
- RRH-06→10: el asistente existente se conecta al flujo real — carga del PDF, análisis con
  excepciones reales, resolución manual, publicación con hash + subida a Storage + RPC.
- Selectores de empresa: solo empresas `estado='activa'` en formularios de alta y filtros;
  las retiradas siguen consultables en históricos.
- Textos "cinco razones sociales" → cuatro.

### Fixtures y pruebas

- `tests/fixtures/LISTA_PAIS.xlsx` y `tests/fixtures/BOLETAS.pdf` (copiados de los originales).
- Vitest en `tests/`: unitarias de parsers contra los fixtures + variantes sintéticas
  (multipágina con cabeceras repetidas, página quitada → salto de correlativo, razón social
  desconocida → rechazo total). Criterios de aceptación del requerimiento = casos de test.
- Verificación E2E contra Supabase con scripts `scripts/verificar-*.mjs` (patrón existente),
  incluida la prueba integrada Excel → PDF → 9 boletas asignadas sin excepciones.

## Fases aprobadas

0. Fixtures + vitest + humo.
1. Cambio 3 — razones sociales (primero: las importaciones cotejan contra el catálogo).
2. Cambio 1 — importación de personal desde Excel.
3. Cambio 2 — carga de boletas desde PDF.
4. Criterios de aceptación completos + prueba integrada + deploy.

Cada fase cierra con tests en verde y commit → push → deploy (CI/CD Vercel).

## Checkpoints con Diego (del requerimiento "cuándo detenerte")

- Datos fiscales de CLEAN antes de insertarla (única pieza bloqueada).
- Si en algún archivo real CODIGO ≠ Documento:DNI (en la muestra coinciden en las 9).
- Cualquier contradicción nueva con lo ya construido.
