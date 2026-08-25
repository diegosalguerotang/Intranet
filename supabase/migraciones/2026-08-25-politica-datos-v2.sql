-- 2026-08-25 · Política de datos v2 — texto REAL conforme a la Ley 29733 y su
-- Reglamento, que además incorpora la autorización expresa de entrega
-- electrónica de boletas y documentos laborales (D.Leg. 1310, art. 3.2) — la
-- brecha de cumplimiento detectada en la consulta normativa del 2026-08-25.
-- Las declaraciones son versionadas e inmutables: la v1 queda intacta y los
-- registros de quienes la aceptaron conservan su texto original. Los primeros
-- ingresos posteriores a esta migración aceptan la v2.
-- Idempotente: on conflict do nothing.

insert into declaraciones (id, version, superficie, texto) values
('politica-datos', 2, 'portal',
'POLÍTICA DE PRIVACIDAD Y TRATAMIENTO DE DATOS PERSONALES
Ley N.º 29733 — Ley de Protección de Datos Personales — y su Reglamento
Versión 2 · Agosto de 2026

1. QUIÉN TRATA TUS DATOS
El responsable del tratamiento es la razón social del Grupo ER que figura como tu empleadora en tu boleta de pago. El Grupo ER administra esta intranet para todas sus empresas.

2. QUÉ DATOS TRATAMOS
· De identificación: nombres y apellidos, tipo y número de documento.
· De contacto: celular, correo y dirección que tú declaras.
· Laborales y de planilla: cargo, sede, fechas de ingreso y cese, remuneraciones, cuenta de haberes.
· De asistencia: tus marcaciones.
· Los que se generan al usar este portal: confirmaciones de recepción, lecturas, solicitudes, tickets de soporte y registros de acceso.

3. PARA QUÉ LOS USAMOS
Únicamente para administrar la relación laboral: pagarte y gestionar la planilla; entregarte boletas y documentos con constancia; comunicarte avisos de la empresa; gestionar tu asistencia, solicitudes y beneficios; tramitar procesos conforme al Reglamento Interno de Trabajo; darte soporte; y proteger la seguridad de la información. El tratamiento necesario para ejecutar la relación laboral y cumplir la ley no requiere tu consentimiento (art. 14 de la Ley 29733); para todo lo demás vale tu aceptación de esta política.

4. ENTREGA ELECTRÓNICA DE BOLETAS Y DOCUMENTOS
AUTORIZO expresamente que mis boletas de pago y demás documentos laborales se pongan a mi disposición a través de este portal, conforme al artículo 3.2 del Decreto Legislativo N.º 1310. Cada documento queda con constancia de emisión (fecha, hora del servidor y huella digital SHA-256 del archivo exacto) y puedo verlo y descargarlo desde mi cuenta en cualquier momento. Puedo pedir además una copia impresa en Recursos Humanos. Confirmar la recepción de un documento reemplaza la firma del cargo físico y NO significa estar de acuerdo con su contenido: conservo intacto mi derecho a reclamar.

5. CON QUIÉN SE COMPARTEN
Tus datos no se venden ni se comparten con terceros ajenos al Grupo ER. Solo acceden a ellos: (a) el personal autorizado según su nivel de acceso; (b) los proveedores tecnológicos que alojan la intranet y su base de datos, que actúan por encargo y pueden estar ubicados fuera del Perú (flujo transfronterizo con salvaguardas de seguridad); y (c) las autoridades cuando la ley lo exige (SUNAT, SUNAFIL, Poder Judicial, entre otras).

6. CUÁNTO TIEMPO LOS CONSERVAMOS
Mientras dure tu vínculo laboral y, después, por los plazos que exigen las normas laborales y tributarias (como mínimo cinco años para los documentos de planilla) y los plazos de prescripción de acciones legales.

7. TUS DERECHOS
Puedes ejercer en cualquier momento tus derechos de acceso, rectificación, cancelación y oposición (ARCO), y revocar esta autorización en lo que no sea indispensable para la relación laboral, presentando tu solicitud a Recursos Humanos de tu empresa. Te responderemos en los plazos de ley. Si no estás conforme con la respuesta, puedes acudir a la Autoridad Nacional de Protección de Datos Personales.

8. CÓMO LOS PROTEGEMOS
Los documentos se guardan en un repositorio privado al que solo se accede con identidad verificada; los datos bancarios se almacenan cifrados; tu cuenta tiene clave personal, sesión única y cierre automático por inactividad; y todos los accesos quedan registrados.

9. TU ACEPTACIÓN
Tu aceptación queda registrada con fecha, hora y la versión exacta de este texto, y puedes releer la política vigente cuando quieras desde la pestaña «Yo» del portal.')
on conflict (id, version) do nothing;
