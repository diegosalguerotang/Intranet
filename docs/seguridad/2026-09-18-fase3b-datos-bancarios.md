# Corrección de seguridad · Fase 3b — Datos bancarios en `interno.datos_bancarios`

Fecha: 2026-09-18 · Base: proyecto Supabase `mzpbdkrmokfxrrsotfgs` · Estado: **APLICADA en producción el 2026-09-18 (Diego: «go»). `verificar-fase3b` todo verde: personas sin columnas bancarias, filas copiadas = conteo respaldado, todos los CCI cifrados, v_personal enmascarada para la sesión real del superadministrador, sesión sin identidad en 0 y auditoría sin valores.**

Requiere la fase 3a aplicada.

## 1. Qué hace

Cumple la parte de «datos bancarios» de la fase 3 del prompt y, de paso, tres decisiones cerradas que tocaban las mismas columnas:

| Decisión | Cómo queda |
|---|---|
| P2 · datos bancarios fuera de `public` | Tabla nueva `interno.datos_bancarios` (dni, banco, banco_id, cuenta cifrada + últimos 4, **CCI cifrado** + últimos 4, actualizado_en/por). PostgREST no la publica. RLS activa con `lectura_admin` (solo SELECT para administradores activos, como el resto de `interno`); `anon` nada; `authenticated` solo SELECT (lo necesitan las vistas `security_invoker`); ningún cliente puede escribirla. |
| P4 · el CCI se cifra | Mismo mecanismo que la cuenta (`pgcrypto` + llave del Vault `clave_cuentas`); enmascarado por defecto; solo `fn_ver_cuenta_bancaria` lo descifra, con la casilla «Ver datos bancarios» o superadmin, y cada consulta queda en auditoría. |
| P7 · se elimina `personas.cuenta` en texto plano | La migración cifra al vuelo cualquier valor que quedara (hoy 0) y **elimina la columna**. También salen de `personas`: `cci`, `cuenta_cifrada`, `cuenta_ultimos4`, `banco`, `banco_id`. |
| Auditoría (P6, espíritu) | Disparador propio en la tabla nueva: registra quién cambió qué (dni, banco, últimos 4) **sin valores**. `fn_auditar` genérico no se le enlaza. |

Piezas que cambian de cuerpo (misma firma, sin cambios para el cliente):

- `v_personal` (sigue `security_invoker`): `banco`, `cuenta` y ahora también `cci` salen enmascarados («···· 1234»). Mismas columnas y orden.
- `v_portal_datos` (Portal, como dueño hasta la fase 4): banco y cuenta enmascarada desde la tabla nueva. Antes leía `personas.cuenta` en claro, que estaba vacía: el trabajador no veía su cuenta; ahora ve la máscara real.
- `fn_ver_cuenta_bancaria`: devuelve cuenta, banco **y CCI** descifrados.
- `alta_trabajador`, `editar_trabajador`: escriben por `fn_guardar_datos_bancarios` (interna, sin EXECUTE para la API). Semántica: cuenta y CCI vacíos = conservar, `-` = borrar, otro texto = reemplazar cifrado; el banco se escribe tal cual en edición y se conserva si viene vacío en el alta (igual que antes).
- `importar_planilla_unificada`: **se re-crea a partir de su cuerpo vigente en producción** con cuatro sustituciones exactas (cada patrón debe aparecer una vez; si no, la migración falla y nada cambia). Así no se pisa ningún ajuste que el cuerpo tenga en producción.

BackOffice: `src/pages/rrhh/Legajo.jsx` muestra el CCI enmascarado, el botón pasa a «Ver cuenta y CCI completos» y el formulario de edición trata el CCI como la cuenta (vacío conserva, «-» borra, con el actual enmascarado como pista). Personal (alta) no cambia.

## 2. Entregables

| Pieza | Archivo | Estado |
|---|---|---|
| Canónico de la fase | `supabase/bancario.sql` (lo embeben la migración y el espejo) | listo |
| Generador | `scripts/fase3b-generar.mjs` | listo |
| Migración única | `supabase/migraciones/2026-09-18-fase3b-datos-bancarios.sql` | ensayada 16/16 |
| Reversión completa | `supabase/respaldos/2026-09-18-fase3b-reversion.sql` (usa `interno.respaldo_fase3b`, que la propia migración llena con las definiciones vigentes) | ensayada: foto idéntica, valores restaurados |
| Espejo local | bloque `@@FASE3B@@` de `supabase/seguridad.sql` | listo |
| Ensayo | `scripts/ensayar-fase3b.mjs` (siembra cuentas y CCI ficticios porque el volcado los trae anulados) | 16 verdes |
| Verificación en producción | `scripts/verificar-fase3b.mjs` | listo |
| Extractor 2.5 | regla para `datos_bancarios` (cifrados → null, últimos 4 → hash) ya en `REGLAS` | listo |

## 3. Qué comprueba el ensayo (16/16)

Antes: `v_personal` expone el CCI en claro (lo que esta fase cierra). Después: `personas` sin columnas bancarias; tabla nueva con RLS, política y ayudantes cerrados; los datos sembrados se copian (cuenta cifrada intacta, CCI cifrado, una cuenta en texto plano cifrada al vuelo); el superadministrador ve las mismas filas en `v_personal` con cuenta y CCI enmascarados y obtiene los valores completos solo por `fn_ver_cuenta_bancaria` (con auditoría); un administrador sin la casilla recibe `null`; el trabajador ve 0 filas en `v_personal` y en la tabla, y su `v_portal_datos` trae banco y cuenta enmascarada; `editar_trabajador` conserva/borra/reemplaza cuenta y CCI y la auditoría no lleva valores; `alta_trabajador` guarda por el ayudante; `importar_planilla_unificada` transformada y ejecutable; la migración no se re-aplica; la reversión deja la foto idéntica y los valores de vuelta en `personas` (CCI en claro otra vez); todo se re-aplica.

La migración además **prueba comportamiento antes de confirmar**: conteos copiados = conteos respaldados, ninguna vista lee ya columnas bancarias de `personas`, sesión sin identidad ve 0 filas y `fn_ver_cuenta_bancaria` le devuelve `null`.

## 4. Procedimiento (Diego, vía `!`)

```
cd /c/Users/DiegoSalguero/Intranet
powershell -NoProfile -Command ". .\scripts\token-supabase.ps1 | Out-Null; node scripts/aplicar-sql.mjs supabase/migraciones/2026-09-18-fase3b-datos-bancarios.sql"
powershell -NoProfile -Command ". .\scripts\token-supabase.ps1 | Out-Null; node scripts/verificar-fase3b.mjs"
```

Luego push del commit (Legajo) y, en el navegador: Personal → un legajo → «Ver cuenta y CCI completos», editar datos (dejar cuenta y CCI vacíos conserva), y en el Portal «Mis datos» (cuenta enmascarada).

Revertir: `node scripts/aplicar-sql.mjs supabase/respaldos/2026-09-18-fase3b-reversion.sql` (y volver al Legajo anterior si se quiere; el nuevo también funciona con el esquema viejo).

## 5. Hallazgos

1. La auditoría histórica sigue conteniendo 57 filas con CCI/cuenta en claro (hallazgo del paso 0): esta fase no las toca; es la decisión P6 de la fase 5.
2. `v_portal_datos` leía `personas.cuenta` (texto plano, vacío desde el 22-08): el Portal nunca mostró la cuenta enmascarada real. Corregido de paso.
3. Sembrar datos en el ensayo obliga a leer descifrado con `reset role` dentro de la misma transacción: `fn_descifrar_cuenta` no es ejecutable por `authenticated` (correcto).

## 6. Pendiente

- **3c** claves de equipos (`activos.clave_equipo` → `interno.activos_claves`; decisión P5: puntero a gestor de contraseñas o cifrado con permiso propio).
- Fase 5: auditoría histórica con secretos (P6).
