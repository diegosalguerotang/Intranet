# Cumplimiento probatorio de boletas electrónicas (2026-08-26)

Requerimiento de Diego (26-08, aprobado): reforzar la evidencia legal de la entrega
electrónica de boletas según D.Leg. 1310 art. 3.2 — 4 puntos: consentimiento con
estándar probatorio, puesta a disposición ≠ confirmación (con notificación
registrada), constancia ampliada y reporte de fiscalización.

## Diagnóstico

- `acuses.ip` existe pero NADIE la llena: el proxy /api/supa no reenvía la IP y los
  RPCs no la leen. No hay user-agent verificado en servidor.
- El consentimiento del primer ingreso es un UPDATE mutable en `cuentas_portal`
  (versión + fecha), sin texto copiado, hash, IP ni dispositivo.
- Los recordatorios por correo no dejan rastro en BD (sin evidencia de notificación).
- La constancia PDF no trae IP, user-agent, nombre de archivo, algoritmo explícito
  ni la mención de zona horaria/NTP.
- No existe reporte consolidado por período/empresa.

## Fases (en orden)

1. **F1 · IP y user-agent server-side.** `api/supa.js` inyecta `x-ip-real` (primera
   IP de x-forwarded-for) y `x-agente` (user-agent), descartando las que vengan del
   cliente. Migración: `acuses.agente`, helper `fn_cabecera(text)` sobre
   `request.headers`, `portal_confirmar_recepcion` / `registrar_acuse_asistido` /
   `portal_confirmar_lectura` llenan ip+agente; `comunicado_lecturas` +ip+agente.
   v_acuses expone agente. Acuses previos quedan sin IP (inmutables — se rotula
   honesto en la constancia).
2. **F2 · Consentimiento probatorio.** Tabla `consentimientos` INSERT-only (dni sin
   FK — patrón dni_check; texto ÍNTEGRO, hash sha256 del texto vía pgcrypto, fecha
   servidor, ip, agente, origen primer_ingreso/migrado/papel).
   `portal_primer_ingreso` inserta ahí (firma intacta). Backfill de aceptaciones
   existentes como origen='migrado'. Endpoint `api/consentimiento-pdf.js`
   (individual ?dni= / masivo ?empresa=, gate admin) para firma física del personal
   ya contratado; botones en Legajo y Planilla.
3. **F3 · Log de notificaciones.** Tabla `notificaciones_documento` INSERT-only;
   `recordatorio-acuse` en api/enviar-correo inserta una fila por documento
   notificado tras envío exitoso. v_acuses expone notificaciones y última fecha.
4. **F4 · Constancia ampliada.** api/constancia-portal.js: nombre del archivo,
   «Algoritmo: SHA-256», IP y navegador (o «No registrada — acuse anterior al
   26/08/2026»), fecha de puesta a disposición con hora, última notificación, pie
   «UTC-5 (América/Lima), reloj de servidor sincronizado por NTP».
5. **F5 · Reporte de fiscalización.** v_acuses +periodo/empresa/publicado. En la
   pantalla de Acuses: filtro período+empresa y exportes CSV (Excel, BOM+;) y PDF
   consolidado (pdf-lib cliente): trabajador, DNI, documento, publicación,
   notificación, confirmación, modalidad, hash.
6. **F6 · Verificación.** `scripts/verificar-cumplimiento-boletas.mjs` (patrón admin
   temporal + cuenta portal; OJO: la limpieza debe apagar
   `trg_consentimientos_inmutables` además de los triggers ya conocidos). Checklist
   y Word actualizados.

Migración única: `supabase/migraciones/2026-08-26-cumplimiento-boletas.sql`
(idempotente). Canónicos sincronizados: schema.sql (acuses/v_acuses/asistido) y
portal.sql (RPCs portal + comunicado_lecturas + consentimientos).
