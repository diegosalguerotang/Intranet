# Corrección de seguridad · Fase 2 — Vistas con `security_invoker`

Fecha: 2026-09-18 · Base: proyecto Supabase `mzpbdkrmokfxrrsotfgs` · Estado: **PREPARADA Y ENSAYADA en local (23/23); NO aplicada en producción. Requiere decisión de Diego por el desvío de la sección 2.**

Requiere las fases 0, 0b y 1 aplicadas (`2026-09-17-fase0-contencion.md`, `2026-09-17-fase1-cimiento.md`).

## 1. Entregables

| Pieza | Archivo | Estado |
|---|---|---|
| Inventario previo (dependencias y conteos por sesión en 3 estados) | `scripts/fase2-inventario.mjs` → `docs/seguridad/2026-09-18-fase2-inventario.md` + `supabase/respaldos/2026-09-18-fase2-inventario.json` | hecho |
| Generador (las listas son la decisión de diseño) | `scripts/fase2-generar.mjs` | listo |
| Migración única (generada) | `supabase/migraciones/2026-09-18-fase2-vistas.sql` | ensayada 23/23 |
| Reversión completa (generada) | `supabase/respaldos/2026-09-18-fase2-reversion.sql` | ensayada: foto de permisos idéntica a la fase 1 |
| Espejo para el Postgres local | bloque `@@FASE2-INICIO@@…@@FASE2-FIN@@` de `supabase/seguridad.sql` | listo |
| Ensayo local | `scripts/ensayar-fase2.mjs` | 23 casos verdes |
| Verificación en producción | `scripts/verificar-fase2.mjs` (catálogo + sesiones reales, solo lecturas) | listo, pendiente de correr |

## 2. Desvío respecto del prompt (decisión pendiente)

El prompt pide `ALTER VIEW … SET (security_invoker = on)` en las 46 (son 47) vistas y dice: «con las políticas todavía permisivas, cualquier pantalla que se vacíe señala una vista que dependía de saltarse los permisos». Esa premisa ya no se cumple: la **fase 0 eliminó `acceso_demo` y activó RLS en las 54 tablas** (fallan cerrado), como el propio prompt exigía. El inventario del 2026-09-18 lo mide en local con sesiones simuladas como PostgREST:

| Estado | Resultado |
|---|---|
| A · hoy (vistas como dueño) | Todas las vistas devuelven filas a **cualquier** sesión, incluida la de un trabajador: `v_personal` (con CCI), `v_usuarios_admin`, `v_registro_accesos`, `v_acuses`… 25 vistas administrativas legibles por un trabajador. |
| B · `security_invoker` en las 47 sin políticas nuevas | **Las 47 devuelven 0 filas o `permission denied` a todos**, administradores incluidos. BackOffice y Portal en blanco. |
| C · B + política de lectura para administradores en las tablas base | Las 38 vistas del BackOffice vuelven a responder igual que hoy a los administradores y en 0 al trabajador; 17 fallaban además por falta de `GRANT SELECT` en 12 tablas; las 9 `v_portal_*` siguen en 0 para el trabajador (necesitan políticas por persona). |

Por tanto la fase 2 **no puede** ser solo `alter view`: sin una política mínima deja la aplicación en blanco, y la respuesta a «qué vistas dependían de saltarse los permisos» es «todas». Lo que se propone (regla del prompt: «si una regla choca con algo ya construido, dímelo antes de cambiarlo»):

1. **38 vistas pasan a `security_invoker`** (todas las del BackOffice más los 4 catálogos), con la política mínima que las sostiene:
   - `lectura_admin` (`for select … using (es_admin_activo())`) en las 38 tablas base que hay debajo (menos `empresas` y `tardanzas`, que ya tienen `solo_admin for all` desde la fase 0b);
   - `lectura_sesion` (`for select … using (es_admin_activo() or portal_dni() is not null)`) en 4 catálogos sin datos personales: `declaraciones`, `solicitud_tipos`, `ticket_tipos`, `ticket_subtipos`;
   - `GRANT SELECT` (solo lectura; las filas las decide RLS) en 12 tablas que no tenían ningún privilegio para `authenticated`: `movimientos`, `notificaciones_documento`, `perfil_propuestas`, `rits`, `solicitud_avisos`, `solicitud_eventos`, `solicitud_tipos`, `solicitudes`, `ticket_avisos`, `ticket_subtipos`, `ticket_tipos`, `tickets`.
2. **9 vistas `v_portal_*` siguen como dueño** hasta la fase 4: `v_portal_boletas`, `v_portal_comunicados`, `v_portal_datos`, `v_portal_mes`, `v_portal_pendientes`, `v_portal_perfil`, `v_portal_rit`, `v_portal_solicitudes`, `v_portal_tickets`. Filtran por `portal_dni()` dentro de la propia vista y sus tablas (`personas`, `vinculos`, `documentos`, `acuses`, `comunicados`, `tardanzas`, `solicitudes`, `tickets`…) necesitan políticas **por trabajador**, que son exactamente el trabajo de la fase 4. **Estas 9 son la lista que el prompt pide anotar**: son las que más revisión necesitan en la fase 4.

Qué cambia para cada rol al aplicar:

| Rol | Antes | Después |
|---|---|---|
| Trabajador del Portal | Lee las 47 vistas (incluidas las administrativas, con CCI y accesos) | Lee solo sus 9 `v_portal_*` y los 4 catálogos; 0 filas en las 34 administrativas y en toda tabla base; sigue sin poder escribir nada directo |
| Administrador activo | Lee las vistas del BackOffice (como dueño) | Igual por vistas (mismas filas, comprobado vista por vista). **Nuevo e interino:** puede leer directamente (solo SELECT) las tablas base de sus vistas, con todas sus columnas. Lo cierra la fase 4 (RLS por rol y módulo) y la fase 5 (datos sensibles) |
| Sesión sin identidad / anon | anon nada; `authenticated` sin identidad leía las vistas | 0 filas en todo |

La alternativa literal (47 vistas, sin políticas) no se propone porque deja el piloto sin servicio. La alternativa «escribir ya las políticas por trabajador» adelanta la fase 4 entera y rompe la regla de una fase por vez.

## 3. Hallazgos

1. **Hoy un trabajador del Portal puede leer 25 vistas administrativas** por PostgREST con su propio JWT (`v_personal` con CCI en claro, `v_usuarios_admin`, `v_registro_accesos`, `v_acuses`, `v_memorandums`, `v_perfiles`…): las vistas corren como `postgres` y `authenticated` tiene `SELECT` en las 47. Es lo más grave que cierra esta fase, y no lo cubría ninguna fase anterior.
2. `v_ticket_config` (BackOffice) sale de las mismas dos tablas que `v_ticket_catalogo` (Portal); solo añade los tipos inactivos. Se clasifica como catálogo: un trabajador puede leerla y no expone nada que no lea ya.
3. Ninguna función SQL lee vistas: las vistas solo las consumen los dos clientes (`src/state.jsx`: 36 vistas; `portal/src`: 12; `api/*`: ninguna). Las funciones que aparecen dentro de vistas (`fn_hora_entrada`, `fn_persona_llamador`, `portal_dni`, `portal_modo`) son todas `security definer`, así que `security_invoker` no cambia lo que ven.
4. `empresas` y `tardanzas` ya tenían `solo_admin for all` (fase 0b); no se les añade `lectura_admin`. `documentos` conserva su política propia y recibe además `lectura_admin` (permisivas: se suman).
5. El Postgres local coincide con la foto de permisos de producción del paso 0 (0 diferencias de ACL en tablas, vistas y secuencias), así que el ensayo es representativo.

## 4. Verificación embebida en la migración

Además de las listas exactas (38 vistas con `security_invoker`, 9 sin; 38 + 4 políticas; 12 grants solo de `SELECT`; 0 políticas con condición `true`; RLS activa en todas las tablas con política), la migración **prueba el comportamiento** antes de confirmar: cambia a `role authenticated` con un JWT sin identidad y exige 0 filas en `v_personal`, `v_usuarios_admin`, `personas` y `v_solicitud_tipos`. Si algo falla, la transacción entera se revierte.

## 5. Procedimiento (Diego, vía `!`, fuera de horario)

```
cd /c/Users/DiegoSalguero/Intranet && . ./scripts/token-supabase.ps1  # o cargar SUPABASE_ACCESS_TOKEN
node scripts/aplicar-sql.mjs supabase/migraciones/2026-09-18-fase2-vistas.sql
node scripts/verificar-fase2.mjs          # catálogo; con ADMIN_EMAIL/ADMIN_PASSWORD y PORTAL_DNI/PORTAL_CLAVE también sesiones
```

Revertir si hace falta: `node scripts/aplicar-sql.mjs supabase/respaldos/2026-09-18-fase2-reversion.sql`.

Después de aplicar: abrir el BackOffice con sesión de administrador y recorrer Personal, Sedes, Accesos, Boletas, Comunicados, Memorándums, Activos, Asistencia, Soporte y Solicitudes (todas leen vistas ahora `invoker`); abrir el Portal con un trabajador (Inicio, Mis datos, Boletas, Comunicados, Solicitudes, Soporte: sin cambio esperado). Cualquier pantalla vacía = vista o política a revisar; anotarla aquí.

Sin cambios en el código del cliente: ni el BackOffice ni el Portal tocan nada distinto.

## 6. Pendiente para fases siguientes

- Fase 4: políticas por trabajador y por módulo/nivel; pasar las 9 `v_portal_*` a `security_invoker`; sustituir `lectura_admin` (lectura total para cualquier administrador activo) por políticas por módulo; revisar `storage.objects`.
- Fase 5: `personas.cci`/`cuenta` en claro y auditoría con secretos (la lectura directa interina de tablas por administradores hace más visible ese pendiente).
- Fase 2.5 (entorno de pruebas con datos anonimizados): `scripts/pg-local.mjs` ya es la base; falta la copia anonimizada de datos y el procedimiento de regeneración.
- Sigue pendiente de la fase 1: prueba con sesiones reales (`verificar-fase1.mjs` con claves) y rotación de la contraseña de aplicación de Gmail (`SMTP_PASS`).
