# Modelo de datos — Intranet Grupo NEGLIAF

Basado en la **Arquitectura Funcional v1.0**. Este documento explica las decisiones
estructurales del esquema (`schema.sql`) para el equipo de desarrollo.

## Principios (no negociables)

1. **Persona ≠ Vínculo.** La `persona` es única por DNI y persiste para siempre.
   El `vinculo` es la relación persona × empresa × periodo, con cargo y sede.
   **Los documentos cuelgan del vínculo, nunca de la persona** — una boleta
   pertenece a una relación laboral concreta con una empresa concreta.
2. **El acuse es un hecho, no un estado.** `acuses` es una tabla de solo
   inserción: un trigger (`fn_bloquear_cambios`) rechaza cualquier UPDATE o
   DELETE, y además se revocan esos permisos a los roles de API. Corregir un
   documento = publicar versión nueva (`documentos.reemplaza_a`), jamás tocar
   el acuse existente.
3. **La asignación de activos es historial, no un campo.** `asignaciones`
   registra entrega y devolución con condición en ambos momentos. Un índice
   único parcial garantiza una sola asignación abierta por activo.
4. **El EPP es consumible**: entregas recurrentes (`epp_entregas`), no
   asignaciones. Su estado (vigente / por reponer) se deriva de la fecha.
5. **Auditoría de solo escritura** (`auditoria` + trigger genérico
   `fn_auditar` sobre todas las tablas operativas).

## Diagrama (entidades principales)

```
empresas ──< sedes                    lotes ──< documentos >── vinculos
    │                                              │               │
    └──────< vinculos >── personas                 └── acuses (1:1 por versión,
                 │            │                         INMUTABLE)
                 ├──< memorandums ──< descargos (1:1, inmutable)
                 ├──< contratos >── plantillas
                 └──< documentos
personas ──< asignaciones >── activos ──< lineas
personas ──< epp_entregas
personas ──< tardanzas (importación idempotente por dni+periodo)
```

## Capas de acceso

- **Lectura**: la interfaz consume **vistas** (`v_personal`, `v_acuses`,
  `v_lotes`, `v_activos`, `v_contratos`, `v_memorandums`, `v_comunicados`,
  `v_epp_entregas`, `v_sedes`). Las vistas resuelven joins, derivan estados
  (pendiente / nunca_ingreso, por_vencer, por_reponer, vencido) y calculan los
  contadores de recepción de cada lote **desde los acuses reales**, no desde
  columnas cacheadas.
- **Escritura**: solo mediante **funciones RPC** (`security definer`). La
  lógica de negocio vive en Postgres, no en el cliente:

  | RPC | Regla que garantiza |
  |---|---|
  | `alta_trabajador` | Persona única: si el DNI existe abre vínculo nuevo, nunca duplica. Rechaza doble vínculo vigente en la misma empresa. |
  | `eliminar_trabajador` | Si hay historial documental **no borra**: cierra el vínculo (cese). Solo elimina registros creados por error. |
  | `publicar_lote` | Genera 1 documento por vínculo vigente. Combinación repetida ⇒ versión siguiente; las anteriores quedan `reemplazado` con sus acuses intactos. |
  | `registrar_acuse_asistido` | Exige adjunto del cargo + fecha de entrega física (además lo exige un CHECK de la tabla). |
  | `emitir_memorandum` | Correlativo por año sin huecos ni reutilización. |
  | `asignar_activo` / `devolver_activo` | Un activo, una persona a la vez; la devolución cierra el historial y fija el destino. |

## Estados derivados (nunca se almacenan)

- `v_acuses.estado`: `confirmado` / `asistido` (hay acuse) · `nunca_ingreso`
  (sin acuse y el portal jamás se usó) · `pendiente`.
- `v_contratos.estado`: `por_vencer` si `fin ≤ hoy + 30 días`.
- `v_comunicados.estado`: `vencido` si pasó la vigencia.
- `v_activos.estado`: `baja` / `mantenimiento` (físico) → si no, `asignado`
  cuando existe asignación abierta → si no, `disponible`.

## Seguridad — estado actual y siguiente paso

RLS está **habilitado en todas las tablas** con una política permisiva de
demostración (`acceso_demo`). Cuando entre Supabase Auth:

1. Reemplazar `acceso_demo` por políticas por rol (Trabajador: solo sus filas
   vía `persona_dni = auth.jwt() ->> 'dni'`; Analista: empresas asignadas;
   Auditor: solo lectura).
2. El alcance se evalúa **en cada consulta**, no en la interfaz — tal como
   exige el documento de arquitectura ("ocultar un botón no es un control de
   acceso").

Los registros probatorios (`acuses`, `descargos`, `auditoria`) ya están
protegidos hoy: triggers de inmutabilidad + REVOKE de UPDATE/DELETE.

## Pendientes de modelado (marcados POR DEFINIR en los documentos)

- Firma de contratos (digital acreditada vs. física escaneada) — el campo
  `contratos.firma` es un dato manual hasta la definición legal.
- Acuse con OTP por SMS — la columna de nivel de evidencia se agregará cuando
  se cierre esa decisión.
- Catálogo de solicitudes del trabajador y criterio de depreciación de activos.
