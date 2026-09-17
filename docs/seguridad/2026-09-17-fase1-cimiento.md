# Corrección de seguridad · Fase 1 — Cimiento

Fecha: 2026-09-17 · Base: proyecto Supabase `mzpbdkrmokfxrrsotfgs` · Estado: **preparada y ensayada en local (31/31); pendiente de aplicar en producción**.

Requiere la fase 0 y 0b aplicadas (`2026-09-17-fase0-contencion.md`).

## 1. Entregables

| Pieza | Archivo | Estado |
|---|---|---|
| Migración única (generada) | `supabase/migraciones/2026-09-17-fase1-cimiento.sql` | ensayada 31/31 |
| Plantilla + generador | `supabase/fase1-plantilla.sql`, `scripts/fase1-generar.mjs` (tabla `GUARDAS` = decisión de diseño) | listo |
| Reversión completa (cuerpos originales de producción) | `supabase/respaldos/2026-09-17-fase1-reversion.sql` | ensayada: foto de permisos idéntica a la fase 0 |
| Ensayo local | `scripts/ensayar-fase1.mjs` | 31 casos verdes |
| Clasificación de las 120 funciones | `docs/funciones-y-permisos.md` (generado) | listo |
| Verificación en producción | `scripts/verificar-fase1.mjs` | tras aplicar |
| Canónicos | guardas insertadas en `schema.sql` / `accesos.sql`; ayudantes en `accesos.sql`; región fase 1 en `seguridad.sql` | listo |

## 2. Qué hace la migración

1. **Guarda central** (SECURITY DEFINER, STABLE, `search_path` fijo), identidad por petición (opción B): `correo_llamador()`, `es_admin()`, `es_superadmin()`, `nivel_en(modulo)`, `requiere_nivel(modulo, nivel[, modulo_alternativo])`, `requiere_superadmin()`, `requiere_correo_propio(correo)`. Los `requiere_*` lanzan `insufficient_privilege` (42501) con mensaje «Permiso insuficiente…». `nivel_en` es la misma regla que `fn_nivel_modulo` (correo del JWT → `usuarios_admin` activo → categoría vigente; 99 para superadmin y para `postgres`/`service_role` sin JWT).
2. **26 funciones administrativas re-creadas con la guarda como primera instrucción** (tabla en §3). Se re-fija `search_path` en toda security definer porque `create or replace` lo borra.
3. Elimina la sobrecarga huérfana `asignar_activo(text,text,text)`.
4. **GRANT explícito y listado**: 25 administrativas + `es_admin`, `es_superadmin`, `nivel_en` a `authenticated`. `eliminar_usuario_admin` **no** se concede al cliente: solo la llama `api/admin-usuarios.js` con la llave de servicio (lleva la guarda igual).
5. **ALTER DEFAULT PRIVILEGES global y de esquema**: una función nueva nace sin EXECUTE para `PUBLIC`, `authenticated` ni `anon` (solo dueño y `service_role`).
6. Verificación embebida: listas exactas (anon = 4; authenticated = 90 nombres), 0 definers sin `search_path`, ninguna función ejecutable por `authenticated` sin guarda (salvo lista explícita), prueba de nacimiento de función, huérfana eliminada.

## 3. Decisiones de guarda (tabla `GUARDAS`)

| Función | Exige |
|---|---|
| crear_usuario_admin, actualizar_usuario_admin, suspender_usuario_admin, reactivar_usuario_admin, eliminar_usuario_admin, reenviar_clave, guardar_perfil, eliminar_perfil, desactivar_perfil, guardar_politica | `requiere_superadmin()` (decisión 1: solo superadministradores crean accesos y designan roles; un administrativo con nivel máximo tampoco puede) |
| marcar_clave_cambiada(p_correo) | `requiere_correo_propio(p_correo)`: solo sobre la propia cuenta |
| alta_trabajador | Personal ≥ 2 |
| eliminar_trabajador | Personal ≥ 3 |
| publicar_lote, publicar_lote_pdf | Boletas ≥ 2 |
| publicar_comunicado | Comunicados ≥ 2 |
| registrar_epp, importar_activos, previsualizar_importacion_activos, asignar_activo, devolver_activo, editar_activo | Activos ≥ 2 |
| previsualizar_asistencia | Asistencia ≥ 2 |
| crear_sede | Configuración ≥ 2 **o** Personal ≥ 2 (mismo criterio que cargos y feriados) |
| notificar_memorandum | Memorándums ≥ 2 |
| resolver_memorandum | Memorándums ≥ 3 |

Las 42 funciones que ya verificaban al llamador conservan su guarda propia (`if fn_nivel_modulo(...) < n then raise`): es la misma regla central; homogeneizarlas a `requiere_nivel` queda para la fase 7 junto con las comprobaciones de catálogo.

## 4. Hallazgos

1. **Los privilegios por defecto del 14-09 estaban incompletos.** PostgreSQL fusiona el default del esquema con el global (o con el incorporado, que concede EXECUTE a PUBLIC). Solo se había revocado a nivel de esquema, así que toda función nueva seguía naciendo ejecutable por PUBLIC. El ensayo lo detectó (una función de prueba nacía ejecutable por `authenticated`); la fase 1 añade la entrada global y la verificación pasa a ser de comportamiento.
2. La plantilla no puede rellenarse con `String.replace(cadena)`: los `$$` de los cuerpos se interpretan como patrón. El generador usa replacers de función.
3. Regla del ensayo: la fase 0 se aplica en local sin su precondición (los canónicos ya traen los ayudantes), y los ayudantes se ignoran al comparar fotos porque en producción nacen con la fase 1.

## 5. Qué queda restituido tras aplicar

Todo lo que la fase 0 dejó inoperativo, ahora con guarda: crear/editar/suspender/reactivar usuarios administrativos, reenviar clave, categorías y política (solo superadmin); alta y baja de trabajador; publicar boletas y comunicados; EPP; activos TI (importar, asignar, devolver, editar); sedes; notificar y resolver memorándums.

## 6. Procedimiento

1. Aplicar: `node scripts/aplicar-sql.mjs supabase/migraciones/2026-09-17-fase1-cimiento.sql` (con el token cargado).
2. Verificar: `node scripts/verificar-fase1.mjs` con `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD_INICIAL`; opcionalmente `ADMIN_EMAIL`/`ADMIN_PASSWORD` (un administrador sin marca) y `PORTAL_DNI`/`PORTAL_CLAVE`.
3. Revertir si hace falta: `node scripts/aplicar-sql.mjs supabase/respaldos/2026-09-17-fase1-reversion.sql`.
4. Push del repo (canónicos, docs, `state.jsx`: un 401 de una función serverless ahora cierra la sesión en la app).

Nota: `scripts/verificar-fase0.mjs` espera el estado de la fase 0 (62 firmas) y dejará de pasar tras la fase 1; es intencional.

## 7. Pendiente para fases siguientes

Fase 2 (vistas `security_invoker`), 2.5 (entorno de pruebas con datos anonimizados: `pg-local.mjs` ya es la base), 3 (esquema privado), 4 (RLS por rol), 5 (datos sensibles), 6 (límites/canal/claves), 7 (comprobaciones en cada despliegue + prueba de comportamiento como regresión), 8 (documentación).
