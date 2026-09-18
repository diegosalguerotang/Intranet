# Corrección de seguridad · Fase 5 — Datos sensibles

Fecha: 2026-09-18 · Base: proyecto Supabase `mzpbdkrmokfxrrsotfgs` · Estado: **FASE 5 COMPLETA. 5a aplicada y verificada; 5b (redacción del histórico) APROBADA por Diego («aprobado», 2026-09-18) y EJECUTADA el 2026-09-18 21:55 UTC: 377 filas redactadas (cci 5, cuenta 40, cuenta_cifrada 282, clave_provisional 7, clave_equipo 1, sesion_actual 47), rastro `REDACCION_HISTORICO` con aprobador y conteos, inmutabilidad activa, 0 secretos restantes (`verificar-fase5` todo verde). Criterio de notificación (P16) en `criterio-notificacion-brecha.md`.**

## 1. Qué pedía el prompt y dónde quedó cada punto

| Punto | Estado |
|---|---|
| Cifrar el CCI con pgcrypto y la llave del Vault, igual que la cuenta | Hecho en la **fase 3b** (`interno.datos_bancarios.cci_cifrado`). |
| Descifrar solo con la casilla de datos bancarios; enmascarado por defecto (últimos 4) | Hecho en la **fase 3b** (`fn_ver_cuenta_bancaria`, `v_personal` enmascarada; el Portal ve solo la máscara de la cuenta). |
| Eliminar la columna de cuenta bancaria en texto plano | Hecho en la **fase 3b** (`personas.cuenta` eliminada). |
| Sacar las claves de equipos: identificador en el gestor de contraseñas | Hecho en la **fase 3c** (`activos.clave_gestor`). |
| Disparador de auditoría: en una lista definida de columnas sensibles, registrar que hubo cambio, no el valor | **5a, aplicada.** |
| Migración de redacción del histórico: única, escrita, aprobada antes de ejecutarse, registrada en la propia auditoría | **5b, escrita y ensayada; espera aprobación.** |

## 2. Fase 5a · Auditoría sin valores sensibles (aplicada)

- `interno.columnas_sensibles`: la lista definida (tabla, columna, motivo). Hoy: `usuarios_admin.clave_provisional`, `usuarios_admin.sesion_actual`, `cuentas_portal.sesion_actual`, y cuatro reglas defensivas para columnas ya retiradas (`personas.cuenta`, `personas.cci`, `personas.cuenta_cifrada`, `activos.clave_equipo`). Editarla es una migración. Cerrada a la API.
- `fn_auditar` (el disparador genérico de 20 tablas): para esas columnas guarda `[sensible]` en el antes y `[sensible: cambiado]` o `[sensible]` en el después; `null` sigue siendo `null`; el resto de la fila se conserva. `interno.datos_bancarios` tiene su propio disparador sin valores desde la 3b.
- Verificado en producción: catálogo y una prueba de comportamiento en transacción revertida (un cambio de marcador de sesión queda como `[sensible: cambiado]`, nunca el valor).
- Reversión: `supabase/respaldos/2026-09-18-fase5a-reversion.sql` (restaura el `fn_auditar` original desde `interno.respaldo_fase5`).

## 3. Fase 5b · Redacción del histórico (aprobada y ejecutada el 2026-09-18)

Migración `supabase/migraciones/2026-09-18-fase5b-redaccion-historico.sql`, una transacción. Es la **única excepción legítima a la inmutabilidad** de la auditoría (P6): desactiva el disparador de inmutabilidad solo dentro de la transacción, redacta y lo reactiva; deja rastro `REDACCION_HISTORICO` con aprobador, fecha y conteo por clave. **No tiene reversión por diseño**: los valores no se guardan en ningún sitio. Ensayada en local (9/9): niega sin aprobación, redacta con ella, no se re-aplica, la inmutabilidad vuelve.

**Qué redactaría en producción hoy** (inventario del 2026-09-18, `verificar-fase5`): **377 filas** de `interno.auditoria` entre el 2026-08-12 y el 2026-09-18.

| Clave | Valores con contenido | Qué es |
|---|---|---|
| `cuenta_cifrada` | 282 | cuenta bancaria cifrada (blob); sin la llave del Vault no se lee, se redacta por principio |
| `sesion_actual` | 47 | marcadores de sesión única (BackOffice y Portal) |
| `cuenta` | 40 | cuenta bancaria **en texto plano** (13-08 → 31-08) |
| `clave_provisional` | 7 | claves provisionales de administradores en texto plano |
| `cci` | 5 | CCI en texto plano |
| `clave_equipo` | 1 | clave de equipo en texto plano |

Por tabla y acción: personas DELETE 120, UPDATE 112, INSERT 90; usuarios_admin UPDATE 37, DELETE 4; cuentas_portal UPDATE 9, DELETE 4; activos UPDATE 1.

Cada valor pasa a `[redactado 2026-09-18]`. **Se conservan** en cada fila: quién, cuándo, acción, tabla, `cuenta_ultimos4` (máscara pública), celular, correo y todo campo no secreto. Así la actividad sigue siendo auditable; solo desaparece el secreto.

Procedimiento (Diego, con la aprobación explícita en la propia sesión; sin ella la migración se niega):

```
cd /c/Users/DiegoSalguero/Intranet
powershell -NoProfile -Command ". .\scripts\token-supabase.ps1 | Out-Null; node scripts/aplicar-sql.mjs --query \"set fase5b.aprobado_por = 'Diego Salguero Tang'; $(Get-Content supabase/migraciones/2026-09-18-fase5b-redaccion-historico.sql -Raw)\""
powershell -NoProfile -Command ". .\scripts\token-supabase.ps1 | Out-Null; node scripts/verificar-fase5.mjs"
```

(Alternativa más simple: decir «aprobado» aquí y lo ejecuto yo con tu nombre como aprobador; queda registrado en la auditoría.)

## 4. Criterio de notificación (P16)

Está en `docs/seguridad/criterio-notificacion-brecha.md`: qué hallazgo obliga a notificar, quién decide, con qué evidencia y en qué plazo, y el estado actual (exposición potencial sin evidencia de acceso indebido, según el forense de la fase 0).

## 5. Entregables

| Pieza | Archivo |
|---|---|
| Canónico 5a | `supabase/auditoria.sql` |
| Generador | `scripts/fase5-generar.mjs` |
| Migraciones | `supabase/migraciones/2026-09-18-fase5a-auditoria-sensible.sql` · `…-fase5b-redaccion-historico.sql` |
| Reversión 5a | `supabase/respaldos/2026-09-18-fase5a-reversion.sql` |
| Espejo | bloque `@@FASE5@@` de `supabase/seguridad.sql` |
| Ensayo | `scripts/ensayar-fase5.mjs` (9 casos) |
| Verificación | `scripts/verificar-fase5.mjs` (sirve antes y después de 5b) |
