# Dos arreglos y una limpieza — diseño

**Fecha:** 2026-09-30 · **Estado:** aprobado por Diego («arranca con los arreglos del punto 2 y 3» del informe `docs/estado-del-proyecto.md`, §13 «lo que me sorprendió»).

## 1. Arreglo A · el reloj no debe borrar el control semanal

**Hoy.** `importar_asistencia` (reloj) hace `delete from marcaciones where empresa_id = … and fecha between …` sin mirar `origen`; borra también las filas `origen = 'control'` del mismo rango (`supabase/schema.sql:792`). El control semanal, en cambio, solo borra las suyas y al insertar pisa por clave primaria las del reloj (decisión del 2026-08-31: el control es el dato declarado y prevalece).

**Cambio.**
- El DELETE del reloj se limita a `origen = 'reloj'`.
- El INSERT del reloj lleva `on conflict (empresa_id, documento, fecha) do nothing`: si ese día ya tiene una fila del control, la del reloj no la pisa. Es coherente con la regla «el control prevalece». El INSERT ya deduplica dentro del archivo, así que el conflicto solo puede venir del control.
- La respuesta suma `conservadas_control` (cuántas filas del archivo no entraron por existir control ese día) y la vista previa las muestra como aviso, no como error.
- `search_path` fijo (`public, interno, extensions`) en la definición, porque `create or replace` lo perdería.

## 2. Arreglo B · publicar el mismo lote dos veces no crea una versión

**Hoy.** `publicar_lote_pdf` es transaccional pero no idempotente: si la base confirma y la respuesta se pierde, «Reintentar» crea la versión N+1 y marca `reemplazado` las boletas de esos vínculos en la N.

**Cambio.**
- Columna nueva `lotes.huella text` = SHA-256 (hex) de la lista ordenada de pares `dni:hash` del lote. Se calcula en la función con `extensions.digest`.
- Tras validar y antes de insertar: si ya existe un lote de la misma empresa, tipo y periodo con la misma huella, la función **devuelve ese lote** (`lote_id`, `version`, `documentos` = cuenta real, `repetido: true`) sin escribir nada.
- La pantalla (`Boletas.jsx`) muestra «Este lote ya estaba publicado (versión N): no se creó otra versión» cuando `repetido` viene en la respuesta. La corrección legítima (PDF distinto) sigue creando versión nueva porque la huella cambia.
- Lotes existentes quedan con `huella` nula (en producción hay 0 lotes; en el seed local no importa).

## 3. Limpieza del cliente (punto 2 del informe)

Sin cambios en la base. Se retira lo que ninguna pantalla usa:
- `src/state.jsx`: fuentes `tardanzas`, `plantillas`, `contratos` (dejan de descargarse en cada arranque) y la acción `addEpp`; sus claves del mock.
- Páginas huérfanas: `src/pages/rrhh/Contratos.jsx`, `src/pages/rrhh/Tardanzas.jsx`, `src/pages/admin/EPP.jsx`, `src/pages/admin/Costos.jsx`. Los ítems «Próximamente» del menú siguen igual.
- Parsers sin pantalla: `src/lib/importar/planilla-unificada.js`, `src/lib/importar/bancos.js` y sus pruebas. `planilla.js` (PLATRA1) se conserva porque `lote.js` usa su `normalizar` y la prueba integrada boletas+Excel depende de él; su cabecera dirá que es legado.
- Las tablas y vistas (`tardanzas`, `contratos`, `plantillas`, `v_contratos`, `epp_entregas`) y las funciones SQL legadas **no se tocan**: `v_portal_mes` lee `tardanzas`, el legajo lee `v_epp_entregas`, y las funciones están entrelazadas con las fases de seguridad. Quedan documentadas como legado en `docs/estado-del-proyecto.md`.

## 4. Pruebas

- Ensayo local `scripts/ensayar-arreglos.mjs` (pg-local con seguridad): (A) cargar control en un rango, importar reloj del mismo rango → las filas de control siguen, las del reloj entran solo en días sin control, `conservadas_control` correcto; reimportar reloj reemplaza solo reloj. (B) publicar un lote, volver a publicar el mismo → mismo `lote_id`, `repetido`, sin versión 2 ni documentos nuevos; publicar con un hash distinto → versión 2. Migración re-aplicable; reversión deja el estado previo (la huella se conserva como columna nula si se revierte solo la función; la reversión completa la elimina).
- Invariante en `ensayar-canon`: `importar_asistencia` no borra `origen = 'control'` (texto de la función) y `publicar_lote_pdf` consulta `huella`.
- `verificar-arreglos.mjs` en producción: catálogo (columna, textos de función, search_path, grants intactos).
- vitest: sin cambios de comportamiento en el cliente salvo el aviso de lote repetido; build verde.

## 5. Despliegue

Migración `2026-09-30-arreglos-asistencia-boletas.sql` (Diego con `!`) → push → CI → `verificar-arreglos` → `funciones-y-permisos` (sigue en 165) → informe y memoria.
