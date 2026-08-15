# Prompt para Claude Code — Tres ajustes al desarrollo

**Intranet Corporativa Grupo NEGLIAF**

> Conversión fiel a texto del documento `Prompt_Claude_Code_Tres_Ajustes.docx`
> (OneDrive - RedPontis\Documentos\Intranet\Tareas 15-08\, 2026-08-15), sin resumir.

Hay tres ajustes al desarrollo de la intranet del Grupo NEGLIAF. Léelos completos antes de tocar nada.

La especificación funcional está en la carpeta documentos - intranet: Arquitectura Funcional, Especificación de Flujos y Pantallas, Casos de Referencia, el Módulo de Accesos y Roles y el documento de Cierre de Acceso. Si no puedes abrir los .docx directamente, conviértelos a texto y trabaja sobre esa conversión, sin resumirla.

Hay dos archivos de muestra reales: LISTA_PAIS.xlsx y BOLETAS.pdf. Guárdalos como fixtures de prueba en el repositorio, porque los criterios de aceptación se verifican contra ellos.

## Paso 0 — Reconocimiento (no escribas código todavía)

Explora el repositorio y respóndeme:

1. Framework, versión y estructura de carpetas.
2. Motor de base de datos, capa de acceso a datos y manejo de migraciones.
3. Cómo está implementada hoy la pantalla de importación de personal en Recursos Humanos → Personal, y qué formato de archivo asume.
4. Cómo está implementada hoy la carga de boletas, si existe, y con qué librería lee PDF.
5. Qué hay construido de las entidades persona, vinculo_laboral, empresa, sede y cargo.
6. Dónde está el catálogo de razones sociales y qué registros tiene.

Termina con un plan por fases y espera mi aprobación. No empieces hasta que te la confirme.

## Reglas que valen para los tres cambios

- Todo identificador se trata como texto. Los DNI empiezan en cero: 09113655 leído como número pierde el cero inicial y deja de coincidir con la persona.
- Ningún proceso masivo cesa, desactiva ni borra por ausencia. Un registro que no aparece en un archivo no significa nada sobre ese registro.
- Las cargas son transaccionales y con vista previa. Se muestra qué va a pasar, se confirma, y entonces entra todo o no entra nada.
- Reprocesar el mismo archivo dos veces no duplica nada.
- Nada se publica sin trabajador identificado. Es el requisito no negociable de la Arquitectura Funcional y sigue vigente.

## CAMBIO 1 — Importación de personal desde Excel

Ubicación: Recursos Humanos → módulo de Personal → Importar planilla.

El archivo no es una hoja de cálculo limpia: es un reporte de impresión del sistema de planilla exportado a Excel. Si el parser actual asume encabezados en la fila 1 y celdas limpias, no va a funcionar. Muestra: LISTA_PAIS.xlsx.

### Estructura

Filas 1 a 5 — cabecera del reporte. Todo en la columna A, con relleno de espacios. Sin celdas combinadas.

| Fila | Contenido | Qué extraer |
|---|---|---|
| 1 | Razón social + PAG. n | Razón social y número de página |
| 2 | PLATRA1 + Registro de Trabajadores + fecha | Fecha de emisión |
| 3 | Centro de Costo : MIDIS - PAIS | Centro de costo o cliente |
| 4 | Situación : VIGENTE | Filtro aplicado al exportar |
| 5 | Vacía | — |

Fila 6 — encabezados. Diez columnas; cada etiqueta con relleno de espacios y terminada en `|`, salvo la última.

Fila 7 en adelante — datos.

### Mapeo de columnas

| Col | Etiqueta | Campo destino | Notas |
|---|---|---|---|
| A | Código | Código de planilla | Coincide con el DNI en la muestra. No asumas que siempre coincide |
| B | Nombres | Nombre completo | Apellidos primero. Truncado a 30 caracteres |
| C | DNI | Documento de identidad | Texto, 8 dígitos |
| D | Sexo | Sexo | F / M |
| E | Unidad Servicio | Sede | Truncado a 16 caracteres |
| F | Cargo | Cargo | Contra el catálogo de cargos |
| G | C.Costo | Centro de costo | Código numérico. Distinto del de la fila 3 |
| H | F.Ingres | Inicio del vínculo | dd/mm/aa |
| I | F.Cese | Fin del vínculo | dd/mm/aa, o `/  /` cuando está vacía |
| J | Situacio | Situación | VIGENTE y otros valores |

### Reglas del parser

- Todas las celdas son texto con relleno de espacios. Aplica trim antes de cualquier comparación.
- `/  /` en F.Cese significa nulo, no fecha inválida. No generes error.
- Años de dos dígitos. Regla de siglo: 00–50 son 2000-2050; 51–99 son 1951-1999. Rechaza fechas de ingreso posteriores a hoy.
- La razón social sale de la fila 1, no de una columna. Cotéjala contra el catálogo y, si no coincide con ninguna, detén la importación completa. No importes a una empresa por defecto.
- El reporte puede tener varias páginas. La muestra tiene una, pero un archivo real repetirá el bloque de cabecera y los encabezados cada cierto número de filas. Descarta cualquier fila cuya primera celda empiece por la razón social o por PLATRA1, y las idénticas a la fila de encabezados.
- Localiza los encabezados por contenido, no por posición. Busca la fila cuyas celdas recortadas y sin `|` coincidan con las diez etiquetas conocidas. Si no la encuentras, detente con un mensaje claro en vez de adivinar.
- Descarta filas vacías o de puro relleno.

### La regla más importante de este cambio

El archivo es parcial. Está filtrado por centro de costo (MIDIS - PAIS) y por situación (VIGENTE): contiene una parte del personal de la empresa, no todo.

Por lo tanto, la importación nunca cesa a nadie por ausencia. Un cese solo se registra si viene con fecha en F.Cese o si se hace manualmente desde la pantalla de personal. Si el parser actual sincroniza dando de baja lo ausente, quítalo: es el error que cesaría a toda la planilla con una sola importación.

### Qué crea y qué actualiza

- Persona nueva (DNI no existe): se crea con los datos del archivo.
- Persona existente: se actualiza el vínculo laboral, no los datos personales cargados manualmente.
- Vínculo existente para esa persona y empresa: se actualizan sede, cargo, centro de costo y fecha de cese si viene.
- El archivo no trae fecha de nacimiento, celular, correo, cuenta bancaria ni remuneración. Esos campos no se tocan ni se sobrescriben con nulos.

## CAMBIO 2 — Carga de boletas desde PDF

Ubicación: Recursos Humanos → Boletas y documentos → carga masiva.

Muestra: BOLETAS.pdf, nueve boletas de LIMPIEZA AMERICANA, periodo junio 2026.

### Confirmado: el PDF tiene capa de texto

Se puede extraer el texto directamente. No hace falta OCR y no debe implementarse. Esto resuelve el supuesto técnico que estaba pendiente en la revisión del set documental.

### Estructura

Una boleta por página. Cada página se identifica por sí sola y contiene anclas de texto estables:

| Ancla | Ejemplo | Uso |
|---|---|---|
| BOLETA DE PAGO \<MES\>-\<AAAA\> | BOLETA DE PAGO JUNIO-2026 | Marca el inicio de una boleta y da el periodo |
| No \<n\> | No 1 | Correlativo dentro del lote |
| RUC: \<11 dígitos\> | RUC: 20601705185 | Identifica la razón social |
| CODIGO: \<n\> | CODIGO: 08693165 | Código de planilla |
| PERIODO DE PAGO: \<MES\>-\<AAAA\> | PERIODO DE PAGO: JUNIO-2026 | Confirma el periodo |
| Documento : DNI \<8 dígitos\> | Documento : DNI 08693165 | Identificador autoritativo del trabajador |
| Apellidos y Nombres \<texto\> | hasta C.Costo: | Nombre completo |
| C.Costo:\<código\> \<cliente\> | C.Costo:1600 MIDIS - PAIS | Centro de costo |
| Unid.Servicios: \<texto\> | SEDE PUEBLO LIBRE | Sede |
| Cargo : \<texto\> | OPERARIO(A) DE LIMPI | Cargo, truncado |
| Fec. Ing. : dd/mm/aa | 01/08/24 | Inicio del vínculo |
| Neto a pagar: S/ \<monto\> | 1,080.66 | Monto neto |

### Reglas de separación

- Una página nueva con el ancla BOLETA DE PAGO inicia una boleta nueva. Una página sin esa ancla pertenece a la boleta anterior. En la muestra todas las boletas son de una página, pero no lo asumas: un trabajador con muchos conceptos puede desbordar.
- El trabajador se identifica por el DNI de "Documento : DNI", no por el CODIGO de la cabecera. En la muestra coinciden, pero son campos distintos del sistema de planilla y el primero es el que declara ser documento de identidad.
- Coteja ambos. Si CODIGO y el DNI difieren en alguna página, no elijas: márcala como excepción a resolver manualmente.
- Verifica el correlativo "No n". Debe ir de 1 a N sin saltos. Un salto significa que se perdió una página y es una excepción del lote, no de una boleta.
- Todas las páginas del lote deben compartir el mismo RUC y el mismo periodo. Si alguna difiere, es excepción.
- El lote se identifica por empresa + tipo de documento + periodo, extraídos de la cabecera. JUNIO-2026 se normaliza a 2026-06.
- Normaliza acentos y la Ñ al comparar nombres. ASTUPIÑAN debe coincidir consigo mismo venga de donde venga.

### Excepciones a resolver manualmente

Ninguna se descarta sola. Se listan y se resuelven antes de publicar:

- Página sin DNI legible.
- DNI que no corresponde a ninguna persona con vínculo vigente en esa empresa y periodo.
- DNI repetido en el lote sin que las páginas sean continuación una de otra.
- Discrepancia entre CODIGO y Documento : DNI.
- Salto en el correlativo.
- Página con RUC o periodo distinto al del resto del lote.

### Qué extraer y qué no

Extrae solo lo necesario para identificar e indexar: DNI, periodo, razón social, correlativo, nombre, cargo, sede, centro de costo, fecha de ingreso y neto a pagar. El PDF de la página es el documento; el desglose de ingresos, descuentos y aportes no se almacena como datos estructurados y no se recalcula nunca. La planilla es la fuente de verdad, como ya establece la especificación.

No extraigas ni almacenes los números de cuenta bancaria ni el CUSPP. Están impresos en la boleta y ahí se quedan. Sacarlos a la base de datos crea un repositorio de datos financieros que el sistema no necesita y que multiplica la exposición bajo la Ley 29733.

### Advertencia sobre nombres y cargos truncados

Ninguna de las dos fuentes trae el dato completo, y truncan campos distintos:

| Campo | Excel | PDF |
|---|---|---|
| Nombre | 30 caracteres — LLERENA GONZALES ANTUANE ARACE | Más largo — LLERENA GONZALES ANTUANE ARACELLI |
| Sede | 16 caracteres — SEDE PUEBLO LIB | Completo — SEDE PUEBLO LIBRE |
| Cargo | Completo — OPERARIO(A) DE LIMPIEZA | 20 caracteres — OPERARIO(A) DE LIMPI |

Regla: nunca sobrescribas un valor almacenado con uno más corto que sea prefijo del que ya tienes. Y como el nombre legal completo puede no estar en ninguna de las dos fuentes, marca esos registros como "nombre por confirmar" y repórtame cuántos son. Ese nombre es el que después aparece en contratos, memorándums y constancias de entrega presentables ante SUNAFIL, así que no lo completes por inferencia.

## CAMBIO 3 — Razones sociales del grupo

El grupo pasa a tener cuatro:

- LIMPIEZA AMERICANA — RUC 20601705185, Av. San Borja Sur Nro. 1184, Urb. San Borja Sur
- NEGLIAF
- PROMANT
- CLEAN — nueva, hay que darla de alta

BREMCO sale del grupo.

### Cómo se retira BREMCO

No la elimines. Si tiene trabajadores, boletas o acuses registrados, borrarla destruiría evidencia que el sistema existe para conservar: una constancia de entrega sin empresa emisora deja de ser presentable ante SUNAFIL, y la obligación de conservación documental sigue corriendo aunque la empresa ya no opere.

Desactívala:

- Deja de aparecer en selectores, filtros y formularios de alta.
- Sus registros históricos siguen siendo consultables y exportables.
- Nadie puede crear vínculos, lotes, contratos ni comunicados nuevos sobre ella.

Si no tiene ningún registro asociado, entonces sí puede eliminarse. Verifícalo y dime qué encontraste antes de decidir.

### Alta de CLEAN

Con la misma estructura que las demás: razón social completa, nombre corto para menús, RUC, dirección fiscal y logo. Los valores de CLEAN te los paso yo; no los inventes.

### Dónde hay que tocar

- Catálogo de razones sociales y seeds
- Selectores de empresa en todas las pantallas
- Alcance por razón social del módulo de Accesos y Roles
- Perfiles y usuarios que tengan a BREMCO en su alcance
- Cualquier texto que diga "cinco razones sociales" o "las cinco empresas del grupo": ahora son cuatro
- Datos de prueba que referencien BREMCO

## CRITERIOS DE ACEPTACIÓN

Escribe pruebas automatizadas contra los dos archivos de muestra.

### Importación de personal

- LISTA_PAIS.xlsx importa sus nueve trabajadores sin intervención manual.
- Un DNI que empieza en cero se conserva íntegro.
- Una fila con `/  /` en F.Cese produce un vínculo vigente, sin fecha de cese y sin error.
- Un archivo de varias páginas con cabeceras repetidas importa solo filas de datos.
- Un archivo cuya razón social no está en el catálogo se rechaza entero.
- Importar un archivo filtrado por centro de costo no cesa ni desactiva a ningún ausente.
- Reimportar el mismo archivo no duplica personas ni vínculos.

### Carga de boletas

- BOLETAS.pdf produce nueve boletas, nueve DNI distintos, correlativo 1 a 9, cero excepciones.
- Cada boleta queda asignada a la persona correcta por su DNI.
- El periodo se normaliza a 2026-06 en las nueve.
- Un PDF al que se le quita una página intermedia reporta el salto de correlativo como excepción del lote.
- Ninguna boleta se publica con excepciones sin resolver.
- No hay números de cuenta bancaria ni CUSPP en ninguna tabla.

### Prueba integrada

- Importar LISTA_PAIS.xlsx y después cargar BOLETAS.pdf sobre la misma empresa: las nueve boletas se asignan sin una sola excepción.

### Razones sociales

- El sistema muestra cuatro razones sociales activas.
- BREMCO no aparece en ningún selector y sus registros históricos siguen siendo consultables.

## CUÁNDO DETENERTE Y PREGUNTARME

- Si el parser actual sincroniza cesando a los ausentes: dime cómo está implementado antes de cambiarlo.
- Si BREMCO tiene registros asociados: dime cuántos y de qué tipo.
- Si hay perfiles o usuarios con alcance sobre BREMCO.
- Si necesitas los datos fiscales de CLEAN.
- Si en algún archivo real CODIGO y Documento : DNI no coinciden.
- Si una regla de estos tres cambios contradice algo ya construido.
