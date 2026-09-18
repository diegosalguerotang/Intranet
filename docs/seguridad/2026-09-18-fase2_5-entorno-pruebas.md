# Corrección de seguridad · Fase 2.5 — Entorno de pruebas con datos anonimizados

Fecha: 2026-09-18 · Origen: proyecto Supabase `mzpbdkrmokfxrrsotfgs` · Estado: **OPERATIVO** (volcado generado y probado: conteos iguales a producción, 47 vistas consultables, sesión de superadministrador anonimizado funcionando con las vistas `security_invoker` de la fase 2).

Requiere: Node y el paquete `embedded-postgres` (ya en `devDependencies`), y para regenerar, el token de la Management API (`scripts/token-supabase.ps1`).

## 1. Qué es

Un Postgres 17 local embebido (`scripts/pg-local.mjs`, sin Docker ni instalación) que carga **el mismo esquema que producción** (canónicos + migraciones complementarias + `supabase/seguridad.sql`, es decir, el estado de las fases 0, 0b, 1 y 2) y, en lugar de los seeds de ejemplo, **una copia de los datos de producción con las personas anonimizadas**. Es el entorno donde se ensayan las migraciones de la fase 3 en adelante antes de tocar producción.

| Pieza | Archivo | Versionado |
|---|---|---|
| Extractor + diccionario de anonimización + verificador + prueba | `scripts/entorno-pruebas.mjs` (`extraer` · `verificar` · `probar`) | sí |
| Cargador (reemplaza seeds por el volcado) | `scripts/pg-local.mjs` → `cargarDatosAnonimizados`, opción `datos` / `PG_LOCAL_DATOS=1` | sí |
| Volcado anonimizado | `supabase/pruebas/datos-anonimizados.sql` (~1 MB, 56 tablas, 5 082 filas) | **no** (`.gitignore`); se regenera |
| Resumen de la extracción | `supabase/pruebas/resumen.json` (fecha, conteos por tabla, columnas anonimizadas, pruebas en origen) | sí |

## 2. Cómo se anonimiza (y por qué así)

La sustitución ocurre **dentro de la consulta que corre en producción**: cada `SELECT` ya devuelve el valor ficticio. Ningún dato real de personas llega al disco de la máquina que extrae ni al repositorio. Las sustituciones son **deterministas** (hash `md5` del valor real), así que el mismo DNI, correo o celular produce el mismo valor ficticio en todas las tablas y se conservan vínculos, cuentas del Portal, acuses, auditoría y accesos.

| Dato | Regla | Resultado |
|---|---|---|
| DNI (toda columna `*dni*`, `marcaciones.documento`, claves dentro de `auditoria.datos_*`) | `dni` | `9` + 7 dígitos del hash (`90222911`) |
| Nombre de persona (`personas.nombre`, solicitantes, supervisores, `lineas.usa`, `activos.usuario_anterior`…) | `nombre` | `Persona 4EF89` |
| Celular (`personas`, `usuarios_admin`, `cuentas_portal`, `lineas.numero`) | `celular` | `9` + 8 dígitos del hash |
| Correo (personas, usuarios_admin, accesos, avisos, tokens, `auth.users`) | `correo` | del Portal → `9xxxxxxx@portal.grupoer.pe` (para que `portal_dni()` siga funcionando); cualquier otro → `u123456@pruebas.invalido` |
| Campos «por» (creado_por, publicado_por, decidido_por, `auditoria.usuario`…) | `actor` | marcas del sistema se conservan (`Sistema`, `BackOffice`…); correos → regla `correo`; nombres → `Admin 1A2B3` |
| Dirección de la persona | `direccion` | `Dirección de prueba 123` |
| Cuenta bancaria, CCI, cuenta cifrada | `nulo` | `null` (`cuenta_ultimos4` → 4 dígitos del hash) |
| Secretos (`clave_provisional`, `sesion_actual`, `activos.clave_equipo`) | `nulo` | `null`; `correo_tokens.token` → `md5` del token |
| IP / agente / dispositivo | `ip` / `agente` | `10.0.0.1` / `Prueba` |
| Textos libres que pueden citar personas (memorándums, descargos, tickets, comentarios, motivos, observaciones) | `texto` | `Texto de prueba`; `solicitudes.datos`, `solicitud_eventos.datos_previos` → `{}`; `memorandums.antecedentes` → `[]` |
| `auditoria.datos_antes/datos_despues` | `auditoria` | solo la identidad ficticia (`persona_dni`/`dni`/`p_dni`/`dni_check`) + `"anonimizado": true`; es lo que necesita `v_actividad_persona` |
| `auth.users` | — | mismo `id` (uuid), correo ficticio, fechas; **sin** contraseña real (el cargador fija una marca local) |

Lo que **no** se copia: archivos de Storage (boletas, reglamentos, adjuntos: solo viajan las rutas), secretos de Vault, contraseñas de Auth. Se copian tal cual: empresas, sedes, clientes, cargos, catálogos, perfiles y permisos, RIT y faltas, feriados, políticas (datos de la organización, no de personas).

Controles que impiden que se cuele un dato real:

1. **Columna nueva con nombre sensible sin regla → la extracción se detiene** (`dni|nombre|celular|correo|email|telefono|direccion|cuenta|clave|token|ip|agente|dispositivo`). Las revisadas a mano que no son personales están listadas en `REVISADAS_SIN_DATO_PERSONAL`.
2. **Prueba en origen por columna** (90 en esta extracción): `count(*) where valor_transformado = valor_original` debe ser 0, sin exportar originales.
3. **Revisión del texto generado** antes de escribirlo: dominios reales, correos fuera de patrón, DNIs fuera de patrón en columnas de identidad, columnas anuladas que traigan valor. Si falla, no se escribe el archivo.
4. **`probar`** carga el volcado y comprueba que ningún DNI, nombre, correo, cuenta ni clave tiene forma real.

## 3. Cómo se regenera (para que no quede una copia vieja)

```
cd /c/Users/DiegoSalguero/Intranet
powershell -NoProfile -Command ". .\scripts\token-supabase.ps1 | Out-Null; node scripts/entorno-pruebas.mjs extraer"
node scripts/entorno-pruebas.mjs verificar
node scripts/entorno-pruebas.mjs probar
```

Regenerar **antes de ensayar cada fase** (3, 4, 5…) y cada vez que producción cambie de esquema. `resumen.json` guarda la fecha y los conteos: si difieren de producción, el volcado está viejo. Si aparece una columna nueva con nombre sensible, la extracción se detiene hasta asignarle regla en `REGLAS` (o declararla revisada).

Uso desde cualquier ensayo:

```js
import { arrancarPgLocal } from "./pg-local.mjs";
const bd = await arrancarPgLocal({ seguridad: true, datos: true });   // esquema + fases 0–2 + datos anonimizados
```

o `PG_LOCAL_SEGURIDAD=1 PG_LOCAL_DATOS=1 node scripts/pg-local.mjs`.

## 4. Hallazgos

1. **Importación circular con `await` de nivel superior**: `entorno-pruebas.mjs` importa `pg-local.mjs`; si `pg-local` importaba a su vez el cargador desde `entorno-pruebas`, el proceso se quedaba esperándose a sí mismo (idle en `ClientRead` tras cargar `seguridad.sql`). El cargador vive en `pg-local.mjs`.
2. `String.replace` con `$$` en el texto de reemplazo lo convierte en `$` (misma lección que la fase 1): romper los `do $$` de los bloques SQL. Al editar SQL con Node, usar `split/join` o un replacer de función.
3. `v_personal` muestra 79 filas y `personas` tiene 81: dos personas sin vínculo. Igual en producción; no es pérdida del volcado.
4. `n_live_tup` de `pg_stat_user_tables` en producción está desactualizado (muchas tablas en 0): para conteos reales hay que usar `count(*)`.

## 5. Límites conocidos

- Sin PostgREST ni GoTrue locales: las sesiones se simulan con `set local role authenticated` + `request.jwt.claims`, como hacen los ensayos. Lo que dependa del proxy o de Auth se prueba en producción con `verificar-*`.
- La anonimización de textos libres es total (`Texto de prueba`): pantallas que muestren esos textos se ven uniformes, pero los flujos (estados, plazos, cadenas) se conservan.
- Los hashes de documentos (`hash_sha256`) se copian tal cual: no identifican personas y sirven para probar integridad.
