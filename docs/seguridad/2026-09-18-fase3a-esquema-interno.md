# Corrección de seguridad · Fase 3a — Esquema privado `interno`

Fecha: 2026-09-18 · Base: proyecto Supabase `mzpbdkrmokfxrrsotfgs` · Estado: **PREPARADA Y ENSAYADA en el entorno de la fase 2.5 (18/18); NO aplicada en producción. Commit local sin push: el código de la API debe desplegarse entre las dos migraciones (ver sección 5).**

Requiere las fases 0, 0b, 1 y 2 aplicadas y el entorno de pruebas de la fase 2.5.

## 1. Alcance de la fase 3 y por qué se parte en 3a / 3b / 3c

El prompt pide crear un esquema interno no publicado por la API y mover allí: usuarios administrativos, categorías y sus versiones, auditoría, registro de accesos, datos bancarios, claves de equipos y parámetros de seguridad; publicar en `public` solo funciones y vistas con guarda; ajustar las consultas del BackOffice que leen tabla directa; ensayar en el entorno de la fase 2.5.

- **3a (esta entrega): las tablas.** 10 tablas pasan al esquema `interno`: `usuarios_admin`, `perfiles`, `perfil_permisos`, `perfil_empresas`, `perfil_propuestas`, `cargo_perfiles`, `registro_accesos`, `politica_acceso`, `auditoria` y `correo_tokens` (esta última no está en la lista del prompt: guarda tokens de un solo uso, son secretos y su único consumidor es la API).
- **3b: datos bancarios.** Hoy son columnas de `personas` (`cuenta`, `cci`, `cuenta_cifrada`, `cuenta_ultimos4`, `banco`, `banco_id`): pasan a una tabla `interno.datos_bancarios` y se ajustan funciones, vistas y las pantallas Personal y Legajo (que hoy muestran `cci` desde `v_personal`).
- **3c: claves de equipos.** `activos.clave_equipo` pasa a `interno.activos_claves`; se ajustan `ver_clave_equipo` y `guardar_clave_equipo`.

Se parte así porque 3b y 3c cambian columnas (no solo esquema) y tocan interfaz; 3a es puro movimiento de tablas con la API adaptada.

## 2. Diseño

| Decisión | Cómo |
|---|---|
| Esquema no publicado | PostgREST publica `public, graphql_public` (comprobado en la configuración del proyecto). Lo que vive en `interno` no responde por `/rest/v1/<tabla>` a ningún rol, ni siquiera a la llave de servicio. |
| Mover sin perder nada | `ALTER TABLE … SET SCHEMA interno`: conserva datos, ACL, RLS y políticas (`lectura_admin` de la fase 2), disparadores, índices, claves foráneas y secuencias. Las 9 vistas que dependen de esas tablas están ligadas por OID y siguen funcionando. |
| Funciones | Resuelven nombres por `search_path` en tiempo de ejecución: **todas** las funciones de `public` pasan a `public, interno, …` (102 con `public, extensions`, 3 con `public, auth`, 1 con `public, vault`, y las 20 que no lo fijaban quedan fijadas). Los cuerpos que nombran una tabla con esquema explícito (`es_admin_activo`: `public.usuarios_admin`) se re-crean con `interno.<tabla>` desde `pg_get_functiondef` (dueño, permisos y search_path se conservan). |
| Dos capas (decisión P3) | `authenticated` conserva USAGE en `interno` porque las 9 vistas con `security_invoker` leen esas tablas con sus permisos; la fila la decide RLS (`lectura_admin`). `anon` y PUBLIC: nada. |
| La API serverless | 17 accesos directos por PostgREST en 8 archivos (`usuarios_admin` ×12, `correo_tokens` ×5) pasan a 6 **funciones de servicio** (`supabase/api-servicio.sql`, `SECURITY DEFINER`, `EXECUTE` solo para `service_role`): `api_admin_por_correo`, `api_admin_por_id`, `api_admin_marcar_clave`, `api_token_crear`, `api_token_leer`, `api_token_usar`. Cada una hace exactamente lo que hacía la consulta directa. El navegador nunca las ve (permiso denegado). |
| El navegador | No toca ninguna de las 10 tablas: solo vistas y RPC. Sin cambios en `src/` ni `portal/`. |

## 3. Entregables

| Pieza | Archivo | Estado |
|---|---|---|
| Generador (lista de tablas = decisión) | `scripts/fase3-generar.mjs` | listo |
| Migración paso 1: funciones de servicio | `supabase/migraciones/2026-09-18-fase3a1-funciones-servicio.sql` | ensayada |
| Migración paso 2: esquema y movimiento | `supabase/migraciones/2026-09-18-fase3a2-esquema-interno.sql` | ensayada 18/18 |
| Reversiones | `supabase/respaldos/2026-09-18-fase3a2-reversion.sql` (tablas de vuelta), `…-fase3a1-reversion.sql` (quita funciones) | ensayadas: foto de permisos idéntica a la fase 2 |
| Canónico nuevo | `supabase/api-servicio.sql` (cargado tras `soporte.sql`; orden en `MODELO.md`) | listo |
| Espejo local | bloque `@@FASE3@@` de `supabase/seguridad.sql` | listo |
| API adaptada | `api/enviar-correo.js`, `restablecer-clave.js`, `correo-accion.js`, `admin-usuarios.js`, `rit.js`, `descargar-documento.js`, `constancia-portal.js`, `consentimiento-pdf.js` | listo; vitest 174/174 |
| Ensayo local | `scripts/ensayar-fase3a.mjs` (entorno 2.5 con datos anonimizados) | 18 verdes |
| Verificación en producción | `scripts/verificar-fase3a.mjs` (sirve tras el paso 1 y tras el paso 2) | listo |

## 4. Qué comprueba el ensayo (18/18)

Catálogo: 10 tablas en `interno` con RLS y `lectura_admin` (9; `correo_tokens` sin política = solo funciones de servicio), ninguna en `public`, 4 secuencias movidas, todas las funciones con `interno` en `search_path`, `anon` sin USAGE. Comportamiento con sesiones simuladas sobre los datos anonimizados: superadministrador y administrador leen las 9 vistas con las mismas filas que antes, `es_admin`/`nivel_en`/`crear_usuario_admin` funcionan; el trabajador ve 0 filas en las vistas y en `interno.*` directo; `anon` sigue haciendo login (`verificar_bloqueo`, `portal_verificar_bloqueo`) y no puede tocar `interno`; los disparadores de auditoría escriben en `interno.auditoria`; las funciones de servicio responden a `service_role` (con las tablas en `public` y en `interno`) y se niegan a `authenticated` y `anon`; la migración no se re-aplica; las reversiones dejan la foto de permisos idéntica y todo se re-aplica.

La migración del paso 2 además **prueba comportamiento antes de confirmar**: sesión sin identidad ve 0 filas en `v_usuarios_admin` y `es_admin()` es falso; `anon` ejecuta `verificar_bloqueo`; `api_admin_por_correo` resuelve la tabla movida.

## 5. Procedimiento de despliegue SIN ventana (Diego, vía `!`, fuera de horario)

El código nuevo de la API llama a las funciones de servicio, que leen las tablas donde estén (search_path `public, interno`). Por eso el orden es:

```
cd /c/Users/DiegoSalguero/Intranet
# 1) funciones de servicio (las tablas siguen en public: nada cambia para nadie)
powershell -NoProfile -Command ". .\scripts\token-supabase.ps1 | Out-Null; node scripts/aplicar-sql.mjs supabase/migraciones/2026-09-18-fase3a1-funciones-servicio.sql"
# 2) desplegar la API (push del commit de la fase 3a → Vercel)
git push origin main
# 3) verificar tras el deploy (usa las funciones con las tablas aún en public)
powershell -NoProfile -Command ". .\scripts\token-supabase.ps1 | Out-Null; \$env:CORREO_PRUEBA='diegosalguerotang@gmail.com'; node scripts/verificar-fase3a.mjs"
# 4) mover las tablas
powershell -NoProfile -Command ". .\scripts\token-supabase.ps1 | Out-Null; node scripts/aplicar-sql.mjs supabase/migraciones/2026-09-18-fase3a2-esquema-interno.sql"
# 5) verificar de nuevo (catálogo completo + API + BackOffice)
powershell -NoProfile -Command ". .\scripts\token-supabase.ps1 | Out-Null; \$env:CORREO_PRUEBA='diegosalguerotang@gmail.com'; node scripts/verificar-fase3a.mjs"
```

Después del paso 5: BackOffice en el navegador (Accesos → Usuarios, Categorías, Política, Registro; Tablero; Personal), «Olvidé mi clave», y «Reenviar acceso» a un usuario. Revertir si hace falta: primero `…fase3a2-reversion.sql`, luego volver al commit anterior de `api/*.js` (push) y `…fase3a1-reversion.sql`.

## 6. Hallazgos

1. **`es_admin_activo()` nombra `public.usuarios_admin` con esquema explícito**: el `search_path` no lo salva. El ensayo lo detectó al primer intento («relation public.usuarios_admin does not exist» dentro de `v_usuarios_admin`). La migración re-califica dinámicamente cualquier cuerpo así (hoy es el único) y lo verifica (0 cuerpos con `public.<tabla movida>`).
2. Las funciones `language sql` con cuerpo `$$` se validan al crearlas con el `search_path` de la sesión, no con el suyo: las funciones de servicio se crean ANTES de mover las tablas (paso 1) y funcionan después porque su `search_path` fijo incluye `interno`.
3. `correo_envios` nace en `seguridad.sql` (fase 0), no en los canónicos: en el entorno de pruebas el estado de seguridad se carga antes que el volcado anonimizado.
4. `pg_get_functiondef` + `CREATE OR REPLACE` conservan ACL, dueño y `search_path`: re-crear funciones no reabre permisos (comprobado en la foto de reversión).
5. `String.replace` con `$$`/`\s` en reemplazos de texto y `sed` con `\s` en Git Bash rompen SQL y expresiones regulares: editar generadores con el editor, no con sustituciones ciegas (tercera vez que aparece; lección anotada).

## 7. Pendiente

- **3b** datos bancarios y **3c** claves de equipos (sección 1).
- Fase 4: sustituir `lectura_admin` por políticas por módulo y nivel; políticas por trabajador para las 9 `v_portal_*`; `storage.objects`.
- Fase 8: reescribir la sección 16 del documento funcional y `docs/funciones-y-permisos.md` (las funciones de servicio y el esquema privado).
