# Corrección de seguridad · Fase 3c — Claves de equipos → referencia al gestor de contraseñas

Fecha: 2026-09-18 · Base: proyecto Supabase `mzpbdkrmokfxrrsotfgs` · Estado: **APLICADA en producción el 2026-09-18 y verificada (`verificar-fase3c` todo verde). Ensayo local 10/10.** Cierra la fase 3 del prompt (3a tablas, 3b datos bancarios, 3c claves de equipos).

## 1. Decisión y qué hace

El prompt pedía mover las «claves de equipos» al esquema privado. La decisión cerrada P5 va más lejos: **la intranet no guarda claves de equipos; guarda un puntero al gestor de contraseñas**. Por eso no hay nada que mover: la columna secreta desaparece.

- `activos.clave_equipo` (texto plano, vacía en producción: 0 de 79) se **elimina**. La migración se niega si encuentra alguna clave guardada: primero se pasa al gestor y se deja en null.
- Nace `activos.clave_gestor`: referencia (nombre de la entrada) en el gestor de contraseñas. No es un secreto.
- `v_activos` (sigue `security_invoker`): `tiene_clave` pasa a significar «tiene referencia» y se añade la columna `clave_gestor` al final.
- `guardar_clave_equipo` y `ver_clave_equipo` conservan la firma (el cliente no cambia de llamadas): guardan y devuelven la referencia. Guardar exige nivel de acción en Activos por la guarda central (antes solo superadmin) y deja auditoría con la referencia; ver exige ver Activos y ya no se audita.
- BackOffice (`src/pages/admin/Inventario.jsx`): el bloque «Clave del equipo» (campo tipo contraseña, «Ver clave actual», solo superadmin) se reemplaza por un campo de texto «Referencia en el gestor de contraseñas» visible para quien pueda editar el activo.

## 2. Entregables

| Pieza | Archivo |
|---|---|
| Canónico | `supabase/claves-equipos.sql` |
| Generador | `scripts/fase3c-generar.mjs` |
| Migración | `supabase/migraciones/2026-09-18-fase3c-claves-equipos.sql` (respaldo de definiciones en `interno.respaldo_fase3c`, verificación con comportamiento) |
| Reversión | `supabase/respaldos/2026-09-18-fase3c-reversion.sql` (recrea `v_activos` con sus permisos; la referencia se pierde) |
| Espejo | bloque `@@FASE3C@@` de `supabase/seguridad.sql` |
| Ensayo | `scripts/ensayar-fase3c.mjs` (10 casos, incluida la negativa con una clave guardada) |
| Verificación | `scripts/verificar-fase3c.mjs` |

## 3. Hallazgos

1. `create or replace view` no puede quitar columnas: la reversión recrea la vista (`drop` + definición respaldada) y le devuelve los permisos (`grant all … to authenticated, service_role`, como el resto de vistas de `public`).
2. El volcado anonimizado debe regenerarse tras cada fase que cambie el esquema (aquí, tras la 3b): el extractor ahora ignora reglas de columnas ya retiradas y excluye las tablas `respaldo_*` (andamiaje de migraciones, no datos).
3. La auditoría histórica guarda 2 filas con `clave_equipo` en claro (19-08): decisión P6, fase 5.
