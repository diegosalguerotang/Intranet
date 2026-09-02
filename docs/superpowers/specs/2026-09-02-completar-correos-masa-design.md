# Completar correos en la creación masiva de cuentas del portal

**Fecha:** 2026-09-02 · **Aprobado por:** Diego (diseño conversado en sesión)

## Contexto

Diego importó el padrón definitivo (79 trabajadores) y quiere desplegar el
Portal del Trabajador: crear las cuentas (usuario = documento) y enviar a cada
uno su acceso —link, usuario y clave provisional— por correo.

La creación masiva YA existe (#13, modal «Cuentas del portal» de RRH-02 +
`api/portal-cuentas.js` acción `crear-lote`): clave aleatoria de 6 dígitos,
correo de acceso a quienes tienen correo registrado y CSV con claves para el
resto. **El hueco:** el padrón de 12 columnas no trae correo, así que los 79
importados no tienen correo y el flujo solo daría CSV. Hoy la única vía para
registrar un correo es editar el Legajo persona por persona.

## Decisiones tomadas con Diego

1. **Completar correos EN el propio modal masivo** (no importación por Excel,
   no pantalla aparte).
2. **Sin correo no bloquea:** la cuenta se crea igual y su clave sale en el
   CSV (comportamiento actual). El correo puede completarse después y el
   acceso reenviarse con «Restablecer clave».

## Diseño

### 1. BD — RPC `fijar_correo_persona(p_dni text, p_correo text)`

Nueva función pequeña; NO se reutiliza `editar_trabajador` porque ese RPC
reemplaza todos los datos («lo escrito manda») y limpia `nombre_por_confirmar`
como efecto colateral.

- `security definer set search_path = public, extensions` (convención del
  hardening 2026-08-24).
- Gate: `fn_nivel_modulo('personal') >= 2` (mismo del resto de Personal).
- Valida existencia de la persona y formato del correo (regex de
  `editar_trabajador`); guarda en minúsculas y recortado.
- Si el correo cambia → `correo_verificado = false`. Vaciar (`''`/null) borra.
- Auditoría: acción `FIJAR_CORREO` sobre `personas` con antes/después
  (solo dni, correo, correo_verificado — no la fila completa).
- Migración idempotente `supabase/migraciones/2026-09-02-fijar-correo.sql` +
  canónico en `schema.sql` (incluye la drop-list de la limpieza).

### 2. UI — paso 1 del modal «Cuentas del portal» (CuentasMasa, Personal.jsx)

Debajo de los contadores (Sin cuenta / Con correo / Solo CSV):

- Lista scrollable de los **candidatos sin correo** (respeta el filtro de
  sede): DNI, nombre y un input de correo por fila.
- Botón **«Guardar correos (N)»** (N = inputs con texto): valida formato en
  cliente, llama `fijar_correo_persona` por cada uno, muestra error por fila
  si el servidor rechaza, y refresca el maestro (los guardados pasan al grupo
  «con correo» y los contadores se actualizan).
- El resto del paso 1 no cambia: casilla «enviar por correo», aviso de tope
  Gmail, botón «Crear N cuentas».

### 3. Estado — `state.jsx`

Acción `fijarCorreo(dni, correo)` → RPC + refresco local del maestro
(patrón de las acciones existentes).

### 4. Sin cambios

`api/portal-cuentas.js`, plantilla del correo de acceso, CSV de claves,
modal individual y Legajo quedan como están.

## Verificación

- Suite nueva `scripts/verificar-fijar-correo.mjs` (patrón Management API):
  fijar correo nuevo, actualizar (verifica `correo_verificado=false`),
  formato inválido rechaza, vaciar borra, persona inexistente rechaza,
  auditoría escrita. Limpieza con datos ZZPRUEBA.
- Prueba manual de Diego en producción con los 79 reales.
