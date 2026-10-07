# Estado real del proyecto — IntraTech

**Fecha:** 2026-09-30. **Para quién:** un asistente externo que conoce la documentación funcional original (Arquitectura Funcional, Casos de Referencia, Flujos y Pantallas v1.0, Accesos y Roles v1.0.1) y el repositorio por encima, y necesita saber qué está construido de verdad, qué se abandonó, qué está a medias y qué duele.

**Cómo se hizo:** recorrido completo del repositorio (canon SQL, migraciones, endpoints, BackOffice, Portal, pruebas, CI, `docs/`) el 2026-09-30, más una lectura de solo conteos de la base de producción hecha el mismo día (`scripts/estado-produccion.mjs`). Lo que está en el código manda sobre lo que dicen los documentos; cuando divergen se dice. Lo que no se pudo verificar está marcado como tal y resumido en la sección 15. No hay datos personales, secretos ni la referencia del proyecto de Supabase.

---

## 1 · Qué es esto y para quién

Un grupo de empresas de limpieza (cuatro razones sociales activas; una quinta retirada con su histórico intacto) entrega boletas de pago y otros documentos laborales a unos 80 trabajadores repartidos en sedes de clientes, y necesita prueba de que cada trabajador recibió cada documento (D.Leg. 1310: puesta a disposición por medios electrónicos con constancia). El sistema tiene dos caras: un **BackOffice** donde Recursos Humanos y Administración cargan la planilla, publican boletas, gestionan comunicados, memorándums disciplinarios, solicitudes, activos de TI y accesos; y un **Portal del Trabajador** donde cada trabajador entra con su número de documento, ve sus boletas y confirma la recepción, lo que queda registrado de forma inmutable con hora del servidor, IP y huella del archivo.

Quién lo usa hoy: **once cuentas administrativas activas** (RRHH, TI, gerencia) creadas entre agosto y el 22 de septiembre de 2026, de las cuales **solo cuatro tienen cuenta de ingreso** (las otras siete esperan que se les envíe la invitación). Del lado de los trabajadores, **una sola cuenta del Portal existe hoy** en producción. El sistema está desplegado y operativo desde el 2026-08-10; el uso real por trabajadores no ha empezado (sección 11).

---

## 2 · Estado en una página

**Funciona en producción y se ha usado con datos reales**
- Padrón de personal por importación (formato de 12 columnas, 2026-08-31) con altas, traslados entre razones sociales, retornos y ceses confirmados a mano; historial de movimientos. Importado en producción el 2026-09-02 (82 personas, 81 vínculos vigentes).
- Accesos y Roles: categorías versionadas, cuentas administrativas, política de acceso, registro de accesos, segundo factor por correo para superadministradores (2026-09-28).
- Corrección de seguridad completa (fases 0–8, 2026-09-17 → 2026-09-21): identidad por petición, RLS por rol en toda tabla de datos, esquema privado `interno`, datos bancarios cifrados, auditoría con redacción de secretos, límites de tasa, canal único por proxy, comprobaciones en CI.
- Gestión de TI: inventario de activos con importación del formato 7.1 (79 activos reales), líneas móviles (207, cargadas del recibo real), licencias Office (20 grupos, 2026-09-29).
- Motor de correo en Resend con dominio propio (2026-09-30), rastro de cada envío y aviso de fallos a superadministradores.

**Construido y verificado, pero sin uso real todavía**
- Publicación de boletas desde un PDF consolidado, acuse en el Portal, constancia PDF, reporte de fiscalización, recordatorios por correo, acuse asistido con cargo firmado. Verificado de punta a punta con datos reales en agosto; **hoy hay 0 lotes, 0 documentos y 0 acuses en producción** porque la base se vació el 2026-08-27 y el 2026-08-31 para arrancar limpio.
- Portal del Trabajador V1 (ingreso, primer ingreso con clave propia y consentimiento, boletas, documento, declaración, comunicados, mis datos, RIT, solicitudes de vacaciones).
- Asistencia: marcaciones de reloj y control semanal con recálculo de tolerancias (0 marcaciones en producción).
- Comunicados, memorándums disciplinarios parametrizados por RIT (0 filas en producción).
- Centro de Solicitudes (papeleta y vacaciones, cadena de aprobación, PDF con membrete; 1 solicitud en producción, de prueba).
- Soporte TI (3 tickets, de prueba).
- Cuentas del Portal en masa con CSV de claves y correos.

**A medias**
- TRB-02 Recuperar clave: por correo, no por código SMS/WhatsApp como pedía el original.
- Motor 9 (mensajería WhatsApp/SMS): no existe. Todo lo que dependía de él se resolvió por correo o quedó diferido.
- Correo de invitación de las siete cuentas administrativas sin cuenta de ingreso: pendiente de que se dispare desde ACC-04.

**Descartado o retirado**
- ADQ-07 Costo de activos por sede (retirado 2026-08-17; el archivo sigue huérfano).
- Soporte TI en el Portal (retirado 2026-09-22; los tickets se abren desde el BackOffice en «Mi solicitud»).
- Importadores PLATRA1 y planilla unificada con banco (sustituidos por el padrón de 12 columnas; el código sigue, sin pantalla).
- Clave fija `111111` del Portal (2026-08-17 → aleatoria el 2026-08-22).
- Gmail como motor de correo (retirado 2026-09-30 tras dos revocaciones de la contraseña de aplicación).
- Selección de trabajadores con casillas en Planilla para crear cuentas (construido y revertido el mismo día, 2026-09-30).
- «Próximamente» en gris sin ruta: Contratos RRH-14/15, Tardanzas RRH-20, EPP ADQ-06 (archivos demo sin conectar).

---

## 3 · Arquitectura real

**Stack.** BackOffice: React 19, Vite 7, Tailwind 4, react-router 7, supabase-js 2, pdf-lib y pdfjs-dist. Portal: Preact 10 con un mini-router propio y un cliente HTTP artesanal (sin supabase-js), con presupuesto de 60 KB comprimidos (el último build pesa ~23 KB). Base: PostgreSQL 17 en Supabase (Auth, REST vía PostgREST, Storage). Funciones serverless en Node 22 sobre Vercel. Pruebas con vitest 4 y un Postgres embebido (`embedded-postgres`) para ensayar migraciones.

**Superficies y despliegue.**

| Superficie | Dónde | Cómo llega a producción |
|---|---|---|
| BackOffice (`src/`) + funciones (`api/*.js`) | Vercel, proyecto `intranet-general` | Push a `main` → build y deploy automático |
| Portal (`portal/`) | Vercel, proyecto `intranet-portal`, enrutado por rewrite en `/portal` desde el dominio principal | Push a `main` |
| Base, Auth, Storage | Supabase, plan Pro (desde 2026-10-01) | Las migraciones SQL las aplica a mano el responsable del proyecto (Management API) **antes** del push del código que las necesita |
| Dominios | `servicios-intranet.net` (oficial desde 2026-10-01, DNS en Vercel: enlaces de correos y PDFs, `site_url` de Auth) e `intranet-general.vercel.app` (sigue vivo: enlaces antiguos y scripts de verificación) | — |
| Correo | Resend, dominio de envío `avisos.servicios-intranet.net` | Variables de entorno en Vercel; Supabase Auth usa el mismo SMTP |

Vercel está en plan Hobby: tope de **12 funciones** (ya se usan las 12; hubo que retirar un endpoint de diagnóstico) y términos de uso no comercial.

**Cómo llega el navegador a la base y por qué.** El navegador habla **solo con su propio dominio**: `/api/supa` (`api/supa.js`) reenvía a Supabase solo `auth/v1`, `rest/v1` y `storage/v1` (nunca `auth/v1/admin`), inyecta la clave publishable del lado del servidor, convierte la cabecera `x-sesion` en `Authorization`, descarta cualquier credencial que venga del cliente y añade `x-ip-real` y `x-agente` generadas en el servidor (la base las usa como evidencia en acuses y logins). La decisión es por configuración con fallo cerrado (`src/lib/canal.js`, `portal/src/lib/api.js`): todo paquete de producción usa el proxy; el canal directo existe solo en desarrollo. Motivos, en orden histórico: una red de oficina bloqueaba las peticiones a `*.supabase.co` (2026-08-12); luego la corrección de seguridad (decisión P10, 2026-09-21) exigió que el paquete publicado no contuviera ni URL ni clave de Supabase (`scripts/comprobar-paquete.mjs` lo comprueba en CI). El proxy además aplica una compuerta de login por IP y por cuenta antes de hablar con Auth, exige el piso de clave del BackOffice y corta los correos de Auth dirigidos a cuentas técnicas del Portal.

**Autenticación.**
- *BackOffice:* Supabase Auth con correo y clave (mínimo 10 caracteres con letras y números); la identidad válida es «correo del JWT → fila activa en `interno.usuarios_admin` → categoría vigente». Cambio de clave obligatorio al primer ingreso. Sesión única por cuenta (el login nuevo expulsa al anterior) e inactividad de 1 hora. Los superadministradores pasan además un **segundo factor**: código de 6 dígitos por correo, con equipo recordado 30 días; hasta verificar, su sesión vale nivel 0 en toda la base.
- *Portal:* cuenta técnica `numero-de-documento@portal.servicios-intranet.net` (desde 2026-10-07; antes `portal.grupoer.pe`) en Supabase Auth (ese dominio no recibe correo). Clave inicial aleatoria de 6 dígitos que solo conoce el endpoint que la crea; primer ingreso obligatorio con clave propia, celular, correo y aceptación de la política de datos (consentimiento inmutable). Bloqueo por intentos, sesión única, inactividad de 1 hora. Un trabajador cesado conserva acceso de solo lectura 12 meses.
- *Funciones serverless:* reciben el JWT del usuario en `x-sesion`, lo validan contra Auth y comprueban nivel y segundo factor en la base; para escribir usan la llave de servicio, que solo vive en Vercel. Las funciones SQL `api_*` solo las ejecuta el rol de servicio.

---

## 4 · Modelo de datos

47 tablas en `public`, 15 en `interno` (más 6 tablas de respaldo que crean las migraciones de seguridad para poder revertirlas), 49 vistas (48 con `security_invoker`), 165 funciones, 78 políticas RLS. Referencia: `supabase/MODELO.md` y `docs/funciones-y-permisos.md` (generado desde producción).

**Las entidades núcleo y por qué están separadas así.**
- **persona** (clave: número de documento; DNI, CE o pasaporte) existe una sola vez y para siempre. **vínculo** es persona × razón social × periodo, con cargo, sede, contrato; una persona puede tener varios (recontratación, rotación entre empresas) y solo uno vigente por empresa. Los **documentos** cuelgan del vínculo, nunca de la persona: una boleta es de una relación laboral concreta con una empresa concreta.
- **lote** agrupa los documentos de una publicación (empresa, tipo, periodo, versión). Corregir una boleta no edita nada: se publica una versión nueva y la anterior queda `reemplazado` solo para los vínculos incluidos en la nueva.
- **acuse** es un hecho, no un estado: una fila por versión de documento, con hora del servidor, IP, agente, hash del archivo y el texto exacto de la declaración aceptada (copiado, no referenciado). Trigger de inmutabilidad y sin UPDATE/DELETE para la API. Modalidad `personal` (el trabajador en el Portal) o `asistido` (RRHH con foto del cargo firmado). **notificaciones_documento** (cada recordatorio enviado) y **consentimientos** (aceptación de la política de datos, sin FK a propósito para sobrevivir al maestro) también son solo-inserción.
- **declaraciones** versiona los textos probatorios; cada acuse o consentimiento lleva el texto íntegro. Desde la política de datos v3 (2026-10-01) el punto 1 nombra a la razón social de la planilla del trabajador: la plantilla lleva la marca `{{RESPONSABLE}}`, `v_declaraciones_vigentes` la entrega resuelta por sesión (`fn_politica_responsable()`: razón social y RUC del vínculo vigente o del último) y `portal_primer_ingreso` guarda en `consentimientos` ese mismo texto ya resuelto. El formato en papel aplica la misma regla (`api/_politica.js`).
- **movimientos** (alta, traslado, cese, retorno) es el historial inmutable que dejan las importaciones del padrón.
- **comunicados** con segmentación por empresa/sede y **comunicado_lecturas** (visto → confirmado). **memorandums** (correlativo por empresa y año, falta citada literalmente del RIT, plazos hábiles parametrizados) con **descargos** inmutables; **rits**, **rit_faltas**, **tipos_sancion**, **feriados** son sus catálogos.
- **solicitudes** con **solicitud_tipos** (cadena de aprobación en JSON, membrete, política de acuse), correlativo por razón social y año, datos del solicitante congelados, **solicitud_eventos** inmutables.
- **tickets** con tipos y subtipos activables; la nota interna nunca sale al Portal.
- **activos** (código como clave global), **asignaciones** (historial, una abierta por activo), **lineas** móviles (razón social que paga y que usa), **licencias_office** y sus personas.
- **marcaciones** (clave: empresa, documento, fecha; el documento no tiene FK porque una marcación puede no resolver a nadie), **asistencia_lotes**, **asistencia_config**, **horarios_entrada** versionada.
- **cuentas_portal**, **sedes** (con código propio y RIT por sede), **empresas** (estado activa/retirada; un trigger impide vínculos y lotes nuevos sobre retiradas), **cargos**, **centros_costo** (catálogo cerrado de 8), **bancos**.

**Esquema `interno`** (PostgREST no lo publica; la API solo llega por funciones): `usuarios_admin`, `perfiles` versionados (cada guardado es una versión nueva) con `perfil_permisos` y `perfil_empresas`, `perfil_propuestas` (sugerencias de categoría desde el cargo del padrón), `cargo_perfiles`, `registro_accesos` (cada intento de login, portal y BackOffice), `politica_acceso` (fila única), `auditoria` (inmutable; nunca guarda el valor de las columnas listadas en `columnas_sensibles`), `correo_tokens`, `datos_bancarios` (cuenta y CCI cifrados con pgcrypto y llave en Vault; solo máscaras hacia fuera), y las tablas del segundo factor.

**Tablas que existen pero no se usan desde ninguna pantalla** (comprobado con búsqueda en el cliente y la API):
- `solicitudes_cambio_cuenta` y su RPC: la UI del Portal se ocultó el 2026-08-21 por decisión del responsable.
- `v_portal_tickets` y `portal_crear_ticket` (cerrada: siempre rechaza) desde que Soporte salió del Portal.
- `tardanzas`, `contratos`, `plantillas`: nada las escribe salvo el seed; sus pantallas están en gris. Desde el 2026-09-30 el BackOffice ya no las descarga (limpieza). `v_portal_mes` muestra al trabajador un conteo de tardanzas que sale de esa tabla, hoy vacía.
- `epp_entregas`: se lee en el legajo; la pantalla que escribía se retiró el 2026-09-30 (la RPC `registrar_epp` sigue en la base).
- Las funciones `importar_planilla` / `importar_planilla_unificada` y sus vistas previas siguen en la base con guarda, sin pantalla que las llame.

**Divergencias documento/código.** `supabase/MODELO.md` todavía describe `usuario_alcance_empresa/sede`, eliminadas el 2026-08-13; habla de «53 tablas con RLS» cuando el conteo es 47 + 15; y lista como pendiente el catálogo de solicitudes, que en la práctica es `solicitud_tipos`. Además, `schema.sql` sigue declarando columnas bancarias de `personas` marcadas «deprecadas» que la fase 3b ya eliminó de producción: el canon histórico y el estado real difieren, y el estado real solo se reconstruye aplicando `seguridad.sql` al final.

---

## 5 · Módulos y pantallas

El inventario original (`Flujos_y_Pantallas_Intranet_V1_0.docx`, fuera del repositorio) tiene **47 pantallas**: ADM-01..06, TRB-01..12, RRH-01..20, SUP-01..02, ADQ-01..07. `Accesos_y_Roles_Intranet_V1_0_1.md` añade ACC-01..06 y absorbe ADM-03 (inventario a 52). No hay copia del inventario dentro del repo; sí existe un mapa de pantallas generado desde el código el 2026-09-28 en OneDrive.

**De las 47 originales: 28 construidas y funcionando, 1 parcial, 2 cubiertas en parte, 1 absorbida, 4 en gris, 1 retirada, 10 no construidas.**

| Área | Construido | No construido / a medias |
|---|---|---|
| RRHH (20) | RRH-01 Tablero · 02 Planilla · 03 Legajo · 04 Alta · 05 Importar · 06→10 asistente de boletas (5 pasos) · 11 Acuses · 12 Constancia · 13 Acuse asistido · 16/17 Comunicados · 18/19 Memorándums | RRH-14/15 Plantillas y contratos en lote (gris, demo) · RRH-20 Tardanzas (gris; la asistencia real vive en RRH-22) |
| Portal (12) | TRB-01 Ingreso · 03 Primer ingreso · 04 Inicio · 05 Boletas · 06 Documento · 07 Declaración · 08 Comunicado · 12 Mis datos | TRB-02 solo por correo · TRB-09/10 Memorándum recibido y descargo (diferidos a V1.1) · TRB-11 Mis documentos (catálogo POR DEFINIR) |
| Admin del sistema (6) | — | ADM-01 Alta de empresa · 02 Sedes (cubierta en parte por RRH-21) · 03 (absorbida por ACC) · 04 Parámetros del motor de acuses · 05 Canales de notificación · 06 Auditoría (cubierta en parte por ACC-06) |
| Supervisor (2) | — | SUP-01/02: no aparecen en ninguna parte del repo |
| Adquisiciones / TI (7) | ADQ-01 Inventario · 02/03/04 modales · 05 Líneas | ADQ-06 EPP (gris, demo) · ADQ-07 Costos (retirado) |

**Añadidas después, fuera del inventario original:** ACC-01..06 (accesos, política, registro), RRH-21 Sedes y detalle de sede, RRH-22 Asistencia, ADQ-08 Importar inventario, ADQ-09 Licencias Office, SOL-01..04 Centro de Solicitudes, «Mi solicitud» (botón global sin guard de módulo; también crea tickets propios), SOP-01/02 Soporte, Solicitudes del Portal (vacaciones), Segundo factor, Cambio de clave obligatorio, Olvidé mi clave y Restablecer en ambas superficies, RIT consultable en el Portal, importación de activos, cuentas del Portal en masa, franja de correos fallidos. Casi todas nacieron de pedidos del responsable durante rondas de prueba (specs y planes en `docs/superpowers/`).

Módulos de permisos (`src/data/modulos.js`): personal, boletas, acuses, comunicados, memorandums, contratos, tardanzas, asistencia, activos, soporte, solicitudes, accesos, auditoria, configuracion; más cuatro casillas especiales (sección 8).

---

## 6 · Flujos críticos de punta a punta

### 6.1 Publicar un lote de boletas hasta el acuse
1. RRHH elige razón social, tipo (boleta o CTS) y periodo y carga **un solo PDF** consolidado. En el navegador, `src/lib/boletas/pdf.js` extrae el texto (pdfjs, sin OCR: el PDF debe traer capa de texto) y `lote.js` parte el PDF por la ancla «BOLETA DE PAGO <MES> - <AAAA>». El **DNI manda**; el código de planilla solo se coteja. Excepciones posibles: sin DNI, correlativo saltado o duplicado, código distinto, RUC o periodo distinto, DNI repetido, DNI sin vínculo vigente. Si el RUC o el periodo del PDF no coinciden con lo elegido, se bloquea el archivo entero. **Nada se publica con excepciones pendientes**: se corrige el PDF o se excluye la boleta con motivo obligatorio.
2. Cada boleta se recorta como PDF propio sin recomprimir, se le calcula SHA-256 y se sube al bucket privado `documentos` en `lotes/<empresa>/<periodo>/<hash>.pdf` con upsert (la política de Storage exige nivel 2 en Boletas y alcance sobre la empresa). Si una subida falla se detiene; el reintento salta las ya subidas.
3. La RPC `publicar_lote_pdf` valida todo antes de escribir (todo o nada), calcula la versión, crea el lote y los documentos (la ruta interna, nunca una URL) y marca `reemplazado` las versiones anteriores solo de los vínculos incluidos. Auditoría en lotes, documentos y acuses.
4. El trabajador ve el documento en `v_portal_pendientes` (vigente, exige acuse, sin acuse); el Portal pide una URL firmada de 600 s a `/api/descargar-documento` (un trabajador solo lo suyo; un admin todo). Al confirmar, `portal_confirmar_recepcion` inserta el acuse con hash, texto de la declaración, IP y agente reales; segundo acuse sobre la misma versión → rechazado.
5. `/api/constancia-portal` regenera a demanda la constancia PDF desde el acuse (no se archiva). RRHH puede mandar «Recordar por correo» (`recordatorio-acuse`), que deja fila en `notificaciones_documento`; el reporte de fiscalización (RRH-11) sale en CSV y PDF.

**Dónde puede fallar y qué pasa.** PDF sin capa de texto → «No se pudo leer el archivo». Subida a Storage sin nivel o sin alcance → error de política, nada publicado. RPC: si la respuesta se pierde en la red tras confirmar en la base, «Reintentar» crearía una **versión 2** y marcaría reemplazada la 1 para esos vínculos (la RPC es transaccional pero no idempotente); los PDFs subidos sin llegar a publicar quedan huérfanos en Storage. En el Portal, cada rechazo tiene mensaje propio (sesión, solo lectura, documento ajeno, reemplazado, ya confirmado).

### 6.2 Importar el padrón
1. En Planilla → «Importar planilla», el lector propio de `.xlsx` lee la **primera hoja física** y `padron.js` exige los 12 encabezados exactos en A..L (si no, rechaza el archivo). Errores de fila (código ≠ documento, situación distinta de VIGENTE, sexo inválido, fecha inexistente, documento repetido dentro de la misma razón social) dejan la fila fuera; si ninguna fila es válida, se rechaza el archivo.
2. `previsualizar_padron` ejecuta `importar_padron` dentro de una transacción y la deshace con un error propio `PV999` que lleva el resultado: la vista previa no escribe nada. Muestra altas, actualizaciones, traslados, retornos, problemas (documento con más de una coincidencia) y **posibles ceses** (personas vigentes ausentes del archivo; nadie se marca solo).
3. Al confirmar, `importar_padron` (nivel 2 en Personal) rechaza el archivo completo si hay una razón social desconocida, retirada o fuera del alcance del usuario, o un centro de costo fuera del catálogo. Por fila: alta o actualización de persona (comparando documentos sin ceros a la izquierda, nunca rellenando), vínculo nuevo o actualizado, traslado que cierra el vínculo anterior el día previo al ingreso, retorno, y una fila inmutable en `movimientos` por cada cosa. Sugiere una categoría de acceso por cargo (`perfil_propuestas`; los cargos vienen truncados a 29 caracteres y se emparejan por prefijo) que solo un superadministrador decide. Aplica únicamente los ceses que el usuario marcó. Un vacío no borra: banco, sede o contrato ausentes se conservan.
4. Reimportar el mismo archivo deja todo en «sin cambio» y no genera movimientos.

**Dónde puede fallar.** El punto débil es la hoja: si la primera hoja física no es la del padrón, falla la verificación de encabezados sin decir por qué. Un centro de costo nuevo detiene todo el archivo (decisión: catálogo cerrado). La decisión de perfiles quedó, por regla del responsable (2026-09-21), fuera de uso: las categorías y cuentas se crearon a partir de una foto de Excel y las 43 propuestas del padrón se descartaron.

### 6.3 Una solicitud desde que se crea hasta que se aprueba
1. Tres entradas: el trabajador desde el Portal (solo vacaciones, `portal_crear_solicitud`), cualquier usuario administrativo para sí mismo desde el botón flotante «Mi solicitud» (`crear_solicitud_propia`, sin necesidad de módulo), o un responsable a nombre de un operario desde la Bandeja (`crear_solicitud_admin`, nivel 2 en Solicitudes). Las tres pasan por `fn_solicitud_insertar`: valida el tipo, la persona y el vínculo vigente, congela la cadena de aprobación del tipo (saltando el paso «jefe» si el solicitante es el supervisor de su propia sede), fija al jefe inmediato — elegido de la lista de usuarios del BackOffice por su código (`jefes_disponibles`; el documento nunca llega del cliente y nadie se elige a sí mismo), escrito a mano (solo el nombre) o, en su defecto, el supervisor de la sede —, asigna el correlativo por razón social y año (p. ej. `VAC-XXX-2026-0001`), inserta la solicitud con los datos del solicitante congelados y el evento `creada`. Se avisa por correo a los destinatarios configurados en SOL-03 (sin bloquear si el correo falla); si el primer paso es el del jefe y este tiene cuenta, recibe su propio correo con enlace a su buzón.
2. En la Bandeja (SOL-01), `resolver_solicitud`: aprobar, observar, rechazar o anular. Observar, rechazar y anular exigen motivo; **nadie resuelve su propia solicitud** (ni el superadministrador); el paso «jefe» lo puede dar el jefe designado en la solicitud desde su buzón «Mi solicitud» (`solicitudes_por_mi_visto_bueno`, sin exigirle el módulo; desde 2026-10-01), el supervisor de la sede con nivel 2, o cualquiera con nivel 3; el resto exige nivel 3; anular solo sobre aprobadas y con nivel 3; una papeleta no se aprueba en su último paso sin el adjunto firmado. Cada decisión es un evento inmutable. Una solicitud observada la corrige el propio solicitante con `reenviar_solicitud`, que guarda copia de los datos anteriores.
3. Al aprobar el último paso: un trigger recalcula la asistencia de los meses tocados (una ausencia justificada deja de ser falta), y el cliente pide a `/api/solicitud-pdf` el PDF con el membrete del tipo (los formatos de papeleta y vacaciones se calcaron de los formularios en papel de dos de las empresas y se reutilizan para todas), lo sube a `solicitudes/<empresa>/<numero>.pdf`, lo inserta en `documentos` con `exige_acuse` según la política del tipo y enlaza la solicitud. Si exige acuse, el trabajador lo confirma en el Portal igual que una boleta.

**Dónde puede fallar.** Si el PDF falla, la solicitud queda aprobada y la Bandeja ofrece reintentar (el endpoint es idempotente si el documento ya está enlazado). Riesgo detectado en el código: el endpoint no comprueba el resultado del PATCH que enlaza el documento a la solicitud; si ese paso falla, un reintento crearía un segundo documento.

### 6.4 Carga de asistencia
Un solo botón «Importar control» en RRH-22 decide por la existencia de la hoja «Detalle Diario»:
- **Control semanal** (hoja «Detalle Diario» + opcional «Resumen Mensual», 22 encabezados exactos): fila de datos = la que trae documento en la columna B (los títulos de área y subtotales no); 9 tipos de día; horas en h:mm cotejadas con su copia decimal; H.E. es la hora de entrada declarada y se contrasta con la ficha (`horarios_entrada`: la primera importación la puebla, las siguientes solo reportan diferencias); las filas «post-reporte» se descartan; el resumen mensual del archivo no se importa: se recalcula desde el detalle y se compara columna a columna. Un tipo desconocido o dos H.E. distintas para la misma persona **detienen el archivo en el cliente**. En la base, `importar_control` (nivel 2 en Asistencia) resuelve documentos quitando ceros; los que no están en el padrón, coinciden con más de uno o no tienen vínculo vigente van a excepciones y no entran (jamás se da de alta a nadie); una razón social fuera del alcance rechaza el archivo. Reemplaza por rango solo las filas de origen `control`, recalcula tolerancias (3 tardanzas de gracia por mes con 30 minutos, cronológicas, configurable), feriados y justificaciones por solicitud aprobada, y reporta diferencias sin elegir cuál vale.
- **Reloj** (hoja «Worksheet», columnas por posición porque ENTRADA/SALIDA se repiten): el código numérico pierde el cero inicial y se compara sin ceros; filas separadoras con guiones; sin marcación no es falta; días futuros descartados; mismo trabajador y fecha con dos códigos → gana la última fila. El usuario elige la razón social y se rechaza si ningún código le pertenece.

**Riesgo detectado en el SQL.** `importar_asistencia` (reloj) borra el rango de la empresa **sin filtrar por origen**: importar un archivo del reloj sobre un rango ya cargado con el control semanal borraría esas filas. En producción no ha ocurrido (0 marcaciones), pero está ahí.

---

## 7 · Importaciones

Todos los importadores comparten un lector de `.xlsx` propio, sin dependencias (`src/lib/importar/xlsx.js`), que abre el ZIP y lee el XML a mano. Sus rarezas condicionan todo lo demás:
- Sin nombre de hoja lee la **primera hoja física**, que no siempre es la primera visible (el libro de activos tiene 12 hojas y la primera está oculta; por eso se lee por nombre).
- Devuelve **todo como texto**; no convierte fechas ni números. Los ceros a la izquierda se conservan solo si la celda ya era texto.
- Las celdas `inlineStr` (y, por el mismo patrón, las de fórmula con el valor después) **se leen como vacías sin aviso**. Consecuencia práctica documentada: las plantillas de subida hay que guardarlas con Excel, no generarlas con openpyxl.
- Las filas vacías se ubican por su número real de fila, no desplazan a las siguientes.

Formatos aceptados hoy:

| Formato | Pantalla | Detección | Rarezas y reglas |
|---|---|---|---|
| **Padrón de 12 columnas** (EMPRESA, RUC, CÓDIGO, NOMBRES, TIPO DE DOCUMENTO, N DOC, SEXO, CENTRO DE COSTO, AREA, CARGO, F. INGRESO, SITUACION) | RRH-05 | Encabezados exactos en A..L | Documentos comparados sin ceros (nunca rellenados: rompería el carné de extranjería de 9 dígitos); siglo dd/mm/aa: 00-50 → 20xx; cargos truncados a 29 caracteres; AREA solo se hereda; el archivo debe venir filtrado a VIGENTE; centro de costo fuera del catálogo cerrado de 8 → rechazo total |
| **Formato 7.1 SUNAT** de activos (hoja «AF EQUIPO DE COMPUTO») | ADQ-08 | Marca «FORMATO 7.1» en las 3 primeras filas; razón social a la derecha de «DENOMINACIÓN O RAZÓN SOCIAL»; encabezados apilados en 4 filas con celdas combinadas; columna de correlativo = la que tiene más números | Filas separadoras de área (texto en USUARIO sin código) definen el área de las siguientes; corte en la primera fila «TOTAL»; filas agregadas («9 laptops» en un renglón) van a revisar; serie «real» = ≥8 caracteres con ≥2 dígitos y sin espacios (descarta procesadores escritos en la columna de serie); **impresoras se recodifican por su serie**; **códigos repetidos no bloquean**: reciben sufijo `-R2…` y quedan marcados «falta corregir»; razón social comparada sin forma societaria; misma respuesta si no existe o está fuera de alcance |
| **Reloj de marcaciones** (hoja «Worksheet») | RRH-22 | Ausencia de «Detalle Diario»; A = código, C = fecha, ≥8 columnas | Columnas por posición (ENTRADA/SALIDA repetidas en D/F y E/G); código numérico sin cero inicial; separadoras con guiones; umbral de doble marcación configurable (15 min); periodo = mínimo y máximo de las fechas; futuros descartados |
| **Control semanal** (hojas «Detalle Diario» y «Resumen Mensual») | RRH-22 | 22 encabezados exactos, W/X opcionales | Ver 6.4 |
| **PDF consolidado de boletas** | RRH-06 | Ancla «BOLETA DE PAGO MES - AAAA» | Mes partido por el espaciado del PDF («J UNIO»); RUC y periodo del lote por mayoría; cargo truncado; una página con texto sin ancla es continuación; página vacía se descarta |
| **PDF del RIT** | RRH-21 | Ninguna (se sube tal cual) | El articulado de faltas se cargó a mano desde el PDF una vez; un RIT nuevo no trae faltas |

Formatos que existen en el código pero **ya no tienen pantalla**: PLATRA1 (reporte de impresión multipágina con cabeceras repetidas y fechas «/  /») y la planilla unificada con banco (periodo tomado del **nombre de la hoja**, centro de costo truncado a 18 con código repetido, catálogo de bancos que corrige «Scotianbank»). Sus pruebas siguen corriendo con fixtures reales que no se versionan.

---

## 8 · Permisos

La base decide por petición, nunca la interfaz. El correo del JWT identifica a un **administrador** si tiene fila activa en `interno.usuarios_admin`; su categoría vigente (`perfiles` + `perfil_permisos` + `perfil_empresas`) da un **nivel por módulo** (0 sin acceso, 1 ver, 2 ver y accionar, 3 aprobar; solo módulos con aprobación admiten 3) y un **alcance** (lista de razones sociales). El superadministrador vale 3 en todo y sin alcance… salvo mientras tenga el segundo factor pendiente: entonces vale 0 en toda la base. Un **trabajador** se identifica por su correo técnico (`portal_dni()`); ninguna RPC de autoservicio recibe la identidad como parámetro.

Toda función administrativa empieza por una guarda (`requiere_nivel(modulo, nivel)`, `requiere_superadmin()`, o una propia sobre `fn_nivel_modulo`); las de servicio solo las ejecuta el rol de servicio; `anon` ejecuta exactamente cuatro (verificar bloqueo y registrar ingreso, portal y BackOffice). Toda tabla de datos tiene RLS: `adm_lectura` (administrador con nivel ≥1 en el módulo y alcance sobre la empresa), `propio` (trabajador: solo sus filas), `sesion` (catálogos sin datos personales), `adm_escritura` solo en las cinco tablas que el BackOffice escribe directo. El alcance **filtra filas, no da error**: un admin de TI que no tiene BREMCO en su categoría ve 77 de 79 activos y no se entera. Pedir una acción sin nivel → `42501` «Permiso insuficiente» con el mensaje de la guarda; el cliente, ante un 42501 a un superadministrador, asume que venció su marca del segundo factor y vuelve a pedir el código.

Casillas especiales de la categoría, fuera de la matriz: **ver remuneración**, **abrir documentos de terceros**, **exportar datos personales** (habilita los CSV de planilla y acuses), **ver datos bancarios** (única vía de descifrado de cuenta y CCI, siempre con rastro de auditoría).

Invariantes por trigger: siempre queda un superadministrador activo; el superadministrador no tiene matriz; nombre de categoría único; el registro de accesos solo admite desvincular un usuario eliminado. Regla confirmada: nadie aprueba su propia solicitud.

---

## 9 · Dependencias externas

| Dependencia | Para qué | Si se cae |
|---|---|---|
| **Supabase** (Postgres, Auth, Storage) — plan Pro desde 2026-10-01 | Todo el dato, todas las sesiones, todos los PDFs | Nada funciona: el BackOffice muestra «No se pudieron cargar los datos» y el Portal no entra. Con el plan Pro el proyecto ya no se pausa por inactividad (en el plan gratis ocurrió el 2026-09-14: el proxy devolvía 500 hasta que se reactivó a mano) y hay **respaldos diarios automáticos** de la base (comprobado el 2026-10-01 por la Management API: 8 respaldos, el último de ese día; sin recuperación a un punto en el tiempo). Los respaldos no cubren el bucket de documentos. Sus límites por IP se comparten entre todos los usuarios porque solo ve la IP de Vercel |
| **Vercel** (Hobby) | BackOffice, Portal, 12 funciones serverless, DNS del dominio nuevo | Nada se sirve. Tope de 12 funciones ya alcanzado. Incidente del 2026-08-17: «Resource provisioning failed» en todo deploy durante 6 horas; se resolvió recreando el proyecto. Los logs de funciones tienen retención corta (no cubren investigaciones posteriores) |
| **Resend** (gratis: 100 correos/día, 3,000/mes) | Código del segundo factor, accesos al Portal y al BackOffice, avisos de tickets y solicitudes, recordatorios, recuperaciones; y el SMTP de Supabase Auth (invitaciones, recuperación del BackOffice) | Los superadministradores **no pueden entrar** (el código no llega). Contingencia: apagar `politica_acceso.factor_superadmin` por Management API. Los demás flujos siguen; cada fallo queda como `error` en `correo_envios` y en la franja del BackOffice |
| **Dominio `servicios-intranet.net`** (comprado en Vercel, DNS en Vercel) | Envío de correo (DKIM/SPF/DMARC) y dirección oficial de la intranet | Sin renovación (vence 2027-09-30) el correo deja de salir y los enlaces de correos y PDFs dejan de abrir (`intranet-general.vercel.app` seguiría sirviendo) |
| **Cuenta Google del responsable** | Ya no: Gmail se retiró el 2026-09-30 | — |
| **GitHub** | Repositorio y CI (`seguridad.yml`) | Sin CI no hay deploy verificado; Vercel despliega igual |
| **Management API de Supabase** (token del responsable) | Aplicar migraciones, verificadores, configuración de Auth | Sin token no se puede migrar ni verificar; el token caduca y hay que renovarlo desde el panel |

No hay proveedor de SMS/WhatsApp (Motor 9), ni OCR, ni firma digital.

---

## 10 · Números de producción (2026-09-30, solo conteos)

| Qué | Valor |
|---|---|
| Personas en el padrón | 82 (21 con nombre «por confirmar» por venir truncado en algún archivo; 4 con correo, 0 verificados) |
| Vínculos vigentes / total | 81 / 81 (39 NEGLIAF, 30 PROMANT, 11 L. Americana, 1 Clean) |
| Razones sociales activas / sedes | 4 / 13 |
| Movimientos (historial de importaciones) | 77 |
| Cuentas administrativas activas | 11 (22 categorías en total, contando versiones y archivadas; no se pudo separar activas de archivadas con la lectura hecha) |
| Cuentas de ingreso en Auth | 4 administrativas + 1 del Portal |
| Cuentas del Portal | 1 (sin primer ingreso pendiente) |
| Lotes / documentos / acuses | **0 / 0 / 0** |
| Consentimientos | 1 |
| Comunicados / memorándums / marcaciones | 0 / 0 / 0 |
| Solicitudes / tickets | 1 / 3 (de prueba) |
| Activos / líneas móviles / licencias Office | 79 / 207 / 20 |
| Registro de accesos | 212 intentos: Portal 25 exitosos y 25 fallidos (9 documentos distintos entraron alguna vez, entre el 2026-08-09 y el 2026-09-29); BackOffice 54 exitosos y 108 fallidos |
| Auditoría | 4,152 filas (la tabla más grande: 2.8 MB) |
| Rastro de correo | 17 envíos, 4 con error |
| Tamaño de la base | 21 MB |
| Bucket `documentos` | 1 objeto, 394 kB (el PDF del RIT) |
| Catálogo | 47 tablas en `public`, 21 en `interno` (15 + 6 de respaldo), 49 vistas (48 invoker), 165 funciones, 78 políticas RLS |

Ningún límite está cerca: la base usaba el 4 % de los 500 MB del plan gratis (medido el 2026-09-30, antes de pasar al plan Pro) y el bucket es despreciable. La única tabla que crece sola es la auditoría (~4 mil filas en 50 días, con la mayoría generada por importaciones y pruebas).

---

## 11 · El piloto

**No ha arrancado con trabajadores.** Hubo dos etapas de prueba con datos reales, hechas por el responsable del proyecto y un par de colaboradores:

- **Agosto (09-08 → 27-08):** se importó la planilla real de julio (79 personas de tres razones sociales), se publicó un lote real de boletas de una razón social (9 boletas) y se hicieron acuses de prueba; 9 documentos distintos entraron al Portal en algún momento. El 2026-08-27 la producción se **vació** por decisión del responsable para probar todo desde cero (quedaron 4 cuentas administrativas, activos, líneas, sedes, categorías y catálogos). El 2026-08-31 se volvió a borrar una subida de planilla para que el padrón nuevo mostrara todas las altas.
- **Septiembre:** el 2026-09-02 se importó el padrón definitivo (82 personas). Desde entonces no se ha publicado ningún lote, no se ha creado ninguna cuenta del Portal en masa (existe una) y no hay acuses. Entre el 17 y el 21 de septiembre el sistema estuvo bajo la corrección de seguridad; el 28 se añadió el segundo factor; el 29 y 30, licencias Office y el motor de correo.

Qué falta para arrancar, en el orden natural del propio sistema: (1) que las siete cuentas administrativas restantes reciban su invitación; (2) que RRHH complete correos en el padrón (hoy 4 de 82) o acepte entregar claves en mano; (3) crear las cuentas del Portal en masa (el modal existe; con 100 correos/día caben todas en un día); (4) publicar el primer lote real de boletas del mes; (5) volver a ejecutar la publicación del RIT con acuse obligatorio (hoy 0 documentos de tipo reglamento, porque la limpieza los borró). La «planilla de la fase piloto» que el responsable anunció el 2026-09-21 no ha llegado. No hay métricas de acuses ni de tiempos porque no hay acuses.

---

## 12 · Lo pendiente

**Marcado POR DEFINIR que sigue sin definir**
- Firma de contratos (digital acreditada o física escaneada): `contratos.firma` es un campo manual y la pantalla está en gris.
- Acuse con OTP por SMS y su nivel de evidencia (depende del inexistente Motor 9). El acuse de hoy se apoya en clave + IP + agente + hash.
- Criterio de depreciación de activos.
- TRB-11 «Mis documentos»: catálogo de documentos del trabajador.
- Códigos de formato de papeleta y vacaciones de dos de las razones sociales (se reutilizan los de las otras dos por decisión del 2026-08-19) y formatos de referencia en papel no subidos.
- TRB-02 por código de mensajería, TRB-09/10 (memorándum y descargo en el Portal), SUP-01/02, ADM-01/04/05.
- Formalmente, el spec del Centro de Solicitudes sigue encabezado «pendiente de aprobación» aunque está construido y en producción.

**Deuda técnica conocida y su consecuencia práctica**
- *(corregido 2026-09-30)* `importar_asistencia` borraba el rango sin filtrar por origen; ahora solo toca `origen = 'reloj'` y no pisa el control semanal.
- *(corregido 2026-09-30)* `publicar_lote_pdf` no era idempotente; ahora `lotes.huella` identifica un lote idéntico y lo devuelve sin crear versión. OJO: las reversiones históricas de la fase 1 y del hardening del 24-08 contienen los cuerpos viejos de estas dos funciones.
- `/api/solicitud-pdf` no comprueba el enlace del documento a la solicitud: un fallo ahí más un reintento crea un documento duplicado.
- Enlaces en correos y PDFs (`APP` en seis archivos de `api/`) y `site_url` de Auth apuntan al dominio de Vercel, no al propio.
- El canon histórico (`schema.sql`) no refleja el estado real; solo `seguridad.sql` al final lo corrige. Quien lea `schema.sql` verá columnas que ya no existen. `MODELO.md` tiene tres afirmaciones desactualizadas (sección 4).
- Formulario de alta manual (RRH-04) toma los cargos de un mock de seis valores, no del catálogo `cargos`.
- El Portal muestra tardanzas leídas de una tabla que nada escribe.
- *(limpiado 2026-09-30)* Las fuentes sin uso, las cuatro páginas huérfanas y los parsers de PLATRA1-unificada se retiraron del cliente; las funciones SQL legadas (`importar_planilla`, `importar_planilla_unificada` y sus vistas previas) siguen en la base con guarda porque están entrelazadas con las fases de seguridad.
- Los ensayos históricos `ensayar-fase0` y `ensayar-fase1` ya no reproducen (replican la migración del 17-09 con precondiciones fijas; dejaron de pasar con los cambios del 22-09). El CI solo corre `ensayar-canon`, que sí cubre los invariantes.
- La base tiene respaldos diarios desde el plan Pro (2026-10-01), pero nunca se ha ensayado una restauración, y los PDFs del bucket no entran en esos respaldos. Los registros probatorios (acuses, consentimientos) no tienen copia fuera de Supabase.
- Vercel Hobby: tope de 12 funciones alcanzado; cualquier endpoint nuevo exige fusionar rutas.
- El job `produccion` del CI (verificadores contra la base) no corre porque falta el secreto en GitHub; por eso dos huecos de la fase 5 se descubrieron tarde.
- Auditoría con 6 filas de `sesion_actual` sin redactar (2026-09-22) que hacen fallar `verificar-fase5`; corregirlas exige aprobación explícita porque la tabla es inmutable.
- Retención corta de logs de Vercel: la forense de la fase 0 no pudo cubrir el periodo en que el esquema estaba abierto.
- El aviso de tope diario de correo mira solo el lote actual, no lo ya enviado en el día.
- DMARC en `p=none`.

**Lo que se sigue haciendo a mano**
- Aplicar cada migración en producción (el responsable, con el token, antes de cada push).
- Correr los verificadores contra producción tras cada ciclo (40 scripts; el CI solo corre uno).
- Crear categorías y cuentas administrativas a partir de una foto de Excel; enviar las invitaciones una por una desde ACC-04.
- Completar correos de los trabajadores (el padrón no los trae).
- Entregar claves del Portal en mano o por CSV a quien no tiene correo.
- Volver a ejecutar la publicación del RIT tras cada alta para que el nuevo tenga el acuse pendiente.
- Afiliar licencias Office de personas que no están en el padrón.
- Rotar el token de la Management API cuando caduca; cargar llaves por portapapeles.
- Recodificar a mano el único código de activo repetido que el importador marcó.
- Cargar el articulado de faltas de un RIT nuevo (hoy solo existe el general).

---

## 13 · Lo que costó más de lo previsto

- **Un carácter invisible.** Un BOM (U+FEFF) al inicio de una variable de entorno en Vercel, escrito por PowerShell 5.1, explicó una sesión entera de «el login no funciona»: errores «non ISO-8859-1», cabeceras que no llegaban, 401 por URL. Se sospechó de antivirus e interceptores de red antes de encontrarlo (2026-08-13). Dejó una regla: todo valor de entorno se sanea al leerlo, y las variables se cargan desde Bash.
- **El esquema estuvo abierto durante las pruebas con datos reales.** Hasta el 2026-09-14 el modelo llevaba una política RLS permisiva y privilegios por defecto que permitían leer personas, cuentas administrativas (con clave provisional) y auditoría con solo la clave publishable. La corrección tomó ocho fases en cinco días (17 → 21 de septiembre), con un Postgres embebido para ensayar cada migración con reversión y un entorno de pruebas anonimizado. Es la razón de que existan `interno`, `seguridad.sql`, los generadores por fase y los 13 ensayos.
- **La importación de planilla se escribió tres veces.** PLATRA1 (reporte de impresión, 2026-08-15), planilla unificada con cuentas bancarias cifradas (2026-08-22, con Vault y pgcrypto) y el padrón de 12 columnas sin banco (2026-08-31). Las dos primeras siguen en el código sin pantalla. El cifrado de cuentas que nació para la segunda acabó siendo la base de la fase 3b.
- **La producción se vació dos veces** (27 y 31 de agosto) para volver a probar desde cero, lo que borró el lote real publicado y los acuses de prueba. Eso explica los ceros de la sección 10.
- **Vercel envenenado.** Seis horas de «Resource provisioning failed»; la solución fue crear un proyecto nuevo, mover variables, borrar el viejo y renombrar, con la sorpresa de que el rename no arrastra el dominio.
- **El correo.** Nativo de Supabase (2-4 por hora, en inglés) → Gmail con contraseña de aplicación (revocada por Google dos veces, la segunda dejando sin entrar a los superadministradores el día siguiente de estrenar el segundo factor) → Resend con dominio propio. En medio, un plan para OTP por WhatsApp (Motor 9) que nunca tuvo proveedor.
- **Decisiones tomadas dos veces.** Clave del Portal fija `111111` y luego aleatoria; mínimo de clave del BackOffice 12 → 6 → 10; inactividad 10 minutos → 1 hora; Soporte en el Portal y luego en el BackOffice; RIT «Clean» renombrado a «general» tras cargarlo; segundo factor «por definir hasta tener WhatsApp» y luego por correo; la selección con casillas en Planilla, construida y revertida el mismo día porque el modal masivo ya existía y el responsable no lo había visto.
- **Los importadores de Excel.** Cada formato real trajo una trampa distinta (hoja oculta, celdas `inlineStr`, códigos numéricos sin cero, encabezados apilados, cargos truncados). Un lector propio sin dependencias evitó peso en el bundle a cambio de descubrir cada caso a golpes.
- **El clasificador de permisos del asistente.** Bloquea aplicar migraciones, leer producción y a veces commits; cada ciclo termina con un paso «lo aplicas tú», que es la mayor fuente de trabajo manual de la sección 12.

---

## 14 · Glosario

- **Acuse:** registro inmutable de que un trabajador recibió un documento (hora del servidor, IP, agente, hash del PDF, texto de la declaración). Personal (desde el Portal) o asistido (RRHH con cargo firmado).
- **Constancia de entrega / de recepción:** PDF que se regenera desde el acuse, con la huella del archivo, la última notificación y la base legal; sirve como prueba ante una fiscalización.
- **Cargo (documento):** copia firmada en papel que prueba la entrega física; en el sistema, la foto adjunta de un acuse asistido. **Cargo (puesto):** el puesto del trabajador en su vínculo.
- **Vínculo:** relación laboral concreta de una persona con una razón social en un periodo; de él cuelgan los documentos.
- **Lote:** publicación de un conjunto de documentos del mismo tipo y periodo para una razón social; tiene versión.
- **Boleta:** boleta de pago mensual. **CTS:** liquidación semestral de compensación por tiempo de servicios.
- **Papeleta:** autorización de salida (permiso) con hora de salida y retorno, motivo y visto bueno; formato GR-F-14.
- **Tareo / control semanal:** reporte semanal de asistencia por trabajador con horas, tardanzas y tolerancia; en el sistema, el importador «Control semanal».
- **Marcación:** registro del reloj biométrico (entrada/salida).
- **RIT:** Reglamento Interno de Trabajo; de él se citan literalmente las faltas en los memorándums.
- **Memorándum / descargo:** sanción disciplinaria notificada y la respuesta del trabajador dentro del plazo.
- **PLAME:** planilla electrónica mensual que se declara a SUNAT; no se genera desde el sistema.
- **SUNAFIL:** autoridad de inspección laboral; el reporte de fiscalización de RRH-11 está pensado para ella.
- **SUNAT:** administración tributaria; el formato 7.1 de activos fijos es suyo.
- **CCI:** código de cuenta interbancario (20 dígitos), para transferencias entre bancos; se guarda cifrado.
- **Centro de costo:** unidad a la que se imputa el costo del trabajador (catálogo cerrado de 8).
- **Razón social:** cada empresa del grupo; el sistema las llama «empresas».
- **Sede:** lugar de trabajo, normalmente un cliente; tiene código propio y puede tener su RIT.
- **Categoría:** perfil de acceso (niveles por módulo + razones sociales + casillas especiales).
- **Nivel:** 0 sin acceso, 1 ver, 2 accionar, 3 aprobar.
- **Superadministrador:** categoría sin matriz que vale 3 en todo; pasa por el segundo factor.
- **Motor 9:** el proveedor de mensajería (WhatsApp/SMS) previsto en la arquitectura original y nunca contratado.
- **Patrón PV999:** vista previa de una importación ejecutando la importación real dentro de una transacción y revirtiéndola con un error propio que transporta el resultado.

---

## 15 · Lo que este documento no puede afirmar

- **Estado de las tablas de respaldo y de las funciones legadas en producción.** Se sabe que existen 21 tablas en `interno` (15 del canon + 6 de respaldo) y 165 funciones con guarda, pero no se comprobó una por una que las funciones de PLATRA1 y planilla unificada sigan ejecutables ni con qué privilegios exactos.
- **Categorías activas frente a archivadas.** La lectura contó 22 identificadores de categoría; no distinguió cuántas están activas ni cuántas versiones tiene cada una.
- **Cifras «aproximadas» de filas.** Las de la tabla de tamaños salen de estadísticas del planificador y estaban desactualizadas (acuses aparece con −1); los conteos exactos solo se hicieron para siete tablas.
- **Logs de Vercel y de Supabase.** No se consultaron; la retención de Vercel es corta y la forense de la fase 0 ya documentó que no cubría el periodo relevante. Los 108 intentos fallidos de login del BackOffice no se investigaron (probablemente pruebas y claves olvidadas del propio responsable, pero no se verificó).
- **Entrega real del correo.** Se verificó que Resend acepta y que dos correos llegaron a la bandeja del responsable; no se verificó la entrega a otros proveedores ni si caen en spam. Los rebotes no llegan al sistema.
- **El Portal en teléfonos reales.** Toda la verificación del Portal fue por scripts y navegador de escritorio; no consta una prueba desde un celular.
- **Configuración de respaldos y plan de Supabase.** El plan Pro lo informó el responsable el 2026-10-01 y los respaldos diarios se comprobaron por la Management API; no se leyó la facturación ni la retención exacta.
- **El secreto del CI.** Se afirma que el job `produccion` no corre por falta del secreto según la memoria del proyecto y los mensajes del workflow; no se consultó la configuración del repositorio en GitHub.
- **Fidelidad del documento funcional original.** Solo se leyó su resumen de pantallas (47) desde OneDrive; no se contrastó su texto completo contra el código. Los documentos de Casos de Referencia y Arquitectura Funcional no se releyeron para este informe.
- **Comportamiento con formatos que no sean los de las pruebas.** Las rarezas de la sección 7 vienen de los archivos reales que se tuvieron a mano (planillas, formato 7.1, reloj, control, PDF de una razón social). Un PDF de boletas de otra razón social o de otro software de planilla puede tener otras anclas.
- **Las celdas `inlineStr`.** Su pérdida silenciosa se deduce del código del lector; no hay prueba que lo demuestre.
- **Fecha exacta de cada decisión.** Las fechas provienen de nombres de archivos, commits y la memoria de trabajo del asistente; donde el commit y el documento difieren en un día, se tomó la del commit.
