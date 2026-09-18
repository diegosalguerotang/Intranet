# Criterio de notificación de brecha de datos personales (decisión P16)

Fecha: 2026-09-18 · Alcance: Intranet Grupo NEGLIAF (BackOffice y Portal del Trabajador), base Supabase `mzpbdkrmokfxrrsotfgs`.

## 1. Estado a hoy

El forense de la fase 0 (`2026-09-17-fase0-forense.md`) revisó desde la puesta en producción: llamadas a funciones administrativas desde sesiones del Portal, usuarios administrativos creados fuera de ACC-02, cambios de categoría y modificaciones directas de la tabla de usuarios. **Resultado: exposición potencial, sin evidencia de acceso indebido.** Además, en producción no ha existido ninguna cuenta del Portal hasta la fecha (auth.users solo tiene las cuentas administrativas), así que la superficie «trabajador que ejecuta funciones administrativas» no tuvo sesiones reales que la usaran.

Por tanto, a hoy **no se notifica**. Esta decisión queda registrada aquí para que no haya que tomarla bajo presión.

## 2. Qué hallazgo obliga a notificar

Se notifica cuando haya **evidencia** (no solo posibilidad) de que una persona no autorizada accedió a datos personales, o de que datos personales salieron del control del grupo. Concretamente, cualquiera de estos:

1. En `interno.registro_accesos` o `interno.auditoria`: una sesión del Portal (correo `@portal.grupoer.pe`) que ejecutó una función administrativa o leyó registros de otra persona, antes de la fase 1.
2. Un usuario administrativo creado, reactivado o con categoría cambiada **fuera** del flujo ACC-02 (sin fila de auditoría `crear_usuario_admin` / `guardar_perfil` a nombre de un superadministrador).
3. Descarga o consulta de datos bancarios (`VER_CUENTA_BANCARIA` con `autorizado = true`) por una cuenta que no debía tener la casilla, o consultas masivas sin justificación.
4. Un envío de correo desde el endpoint (`correo_envios`) a un destinatario fuera del padrón, o un pico de envíos no explicado, entre la puesta en producción y la fase 0.
5. Pérdida o exposición de un respaldo, del volcado anonimizado si contuviera datos reales, o de la llave de servicio.
6. Cualquier aviso de Supabase o Vercel sobre acceso no autorizado al proyecto.

No obliga a notificar por sí solo: una política mal escrita que se corrigió sin evidencia de uso, una función abierta que nadie llamó, o un hallazgo de esta corrección sin rastro de explotación.

## 3. Quién decide y cómo

- **Quién decide:** Diego Salguero Tang (responsable del sistema) junto con la gerencia del grupo (Renato Espinoza). Legal participa antes de comunicar a terceros.
- **Con qué evidencia:** el registro de accesos y la auditoría (ambos inmutables: ahora sin secretos pero con quién, cuándo y qué), `correo_envios`, y los informes de esta corrección (`docs/seguridad/`).
- **Plazo:** la evaluación se hace el mismo día en que aparece el indicio; la decisión de notificar, dentro de las 72 horas desde que se confirma la evidencia (referencia: Ley 29733 y su reglamento, y las obligaciones contractuales con las empresas del grupo).
- **A quién:** a la Autoridad Nacional de Protección de Datos Personales cuando la evaluación lo exija, y a las personas afectadas cuando el dato expuesto pueda causarles perjuicio (datos bancarios, documentos, claves).
- **Registro:** cada evaluación, se notifique o no, se anota como fila de `interno.auditoria` con acción `EVALUACION_BRECHA` (quién evaluó, indicio, decisión).

## 4. Qué se revisa periódicamente para detectar los indicios

`scripts/fase0-forense.mjs` (adaptado a `interno`) sobre el registro de accesos y la auditoría, y `correo_envios`. La fase 7 lo engancha a una comprobación en cada despliegue; mientras tanto se corre a mano tras cada fase.
