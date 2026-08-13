# Portal del Trabajador V1 (núcleo probatorio) — Diseño

Aprobado por Diego el 2026-08-13. Fuente: `Flujos_y_Pantallas_Intranet_V1_0.docx`
(TRB-01…TRB-12) y `Arquitectura_Funcional_Intranet_V1_0.docx`. Restricciones no
negociables del spec: móvil de gama baja primero, sin dependencia de correo,
peso mínimo de página, lenguaje sin jerga ("confirmar recepción").

## Decisiones tomadas (con Diego)

1. **Proyecto separado**: app Vite propia en `portal/` (mismo repo), proyecto
   Vercel `intranet-portal` unido al grupo de microfrontends `intranet-grupoer`,
   servido en `intranet-general.vercel.app/portal`. Presupuesto: **< 60KB de JS
   inicial** (gzip).
2. **Alcance V1 = núcleo probatorio**: TRB-01, 03, 04, 05, 06, 07, 08 y 12.
   V1.1: TRB-09/10 (memorándums + descargo con fotos), TRB-11 (Mis documentos,
   catálogo POR DEFINIR), TRB-02 (recuperación por código, exige Motor 9).
3. **Auth**: Supabase Auth (GoTrue) con cuenta técnica `{dni}@portal.grupoer.pe`
   que el trabajador nunca ve. Mínimo global de clave baja a 6; el BackOffice
   sigue exigiendo 12 en sus pantallas (claves generadas de 14).
4. **TRB-02 diferido**: «Olvidé mi clave» en V1 → indica acudir al supervisor o
   RRHH; RRHH restablece desde el BackOffice.

## 1. Arquitectura

- `portal/` = app Vite independiente (React 19, Tailwind 4, tokens del design
  system GrupoER v2 copiados a `portal/src/index.css`, radios/píldoras/Poppins).
  Sin dependencias pesadas: react, react-dom, react-router-dom, supabase-js.
  lucide-react solo con imports por icono (tree-shake). Verificar el peso en
  cada build.
- Proyecto Vercel `intranet-portal` (rootDirectory `portal`), agregado con
  `vercel mf add-to-group` al grupo existente; `microfrontends.json` del app
  default enruta `/portal/*` al hijo. Vite `base: "/portal/"`.
- Mismo Supabase: al vivir bajo el dominio principal, el Portal usa el proxy
  existente `/api/supa` (cero credenciales en el navegador; el JWT viaja en
  x-sesion). `portal/src/lib/supabase.js` replica el patrón del BackOffice
  (camuflaje + saneo BOM) apuntando a `location.origin + "/api/supa"`.

## 2. Datos y backend (supabase/portal.sql + migración)

- **Config GoTrue**: `password_min_length` 12 → 6 (Management API). El
  BackOffice mantiene 12 por política de la BD aplicada en sus pantallas.
- **Tabla `cuentas_portal`**: dni PK/FK personas, `primer_ingreso_pendiente`
  bool, `celular_declarado` text null, `sin_celular` bool, `politica_version`
  text, `politica_aceptada_en` timestamptz, `creado_por`, `creado_en`.
  El estado de la CLAVE vive en GoTrue; esta tabla guarda lo que TRB-03 exige
  registrar (Ley 29733: versión del texto aceptado, con fecha y hora).
- **Tabla `declaraciones`**: (id, version, superficie, texto) — seed con la
  declaración de recepción v1 y la política de datos v1. El texto EXACTO
  mostrado se copia dentro de cada acuse/aceptación (la plantilla puede
  cambiar después). Editor llegará con ADM-04.
- **RPCs** (security definer; el dni SIEMPRE se deriva del JWT:
  `split_part(auth.jwt()->>'email','@',1)`, nunca de un parámetro):
  - `portal_verificar_bloqueo(p_dni)` y `portal_registrar_ingreso(p_dni,
    p_resultado, p_dispositivo)` — superficie 'portal' en registro_accesos
    (política 5 intentos / 15 min ya en BD). Se llaman antes de autenticar
    (sin sesión), igual que el patrón del BackOffice.
  - `portal_primer_ingreso(p_celular, p_sin_celular, p_politica_version)` —
    marca TRB-03 completado; la clave se cambia con auth.updateUser.
  - `portal_confirmar_recepcion(p_acuse_id, p_texto_declaracion,
    p_dispositivo)` — valida que el acuse pertenece al dni de la sesión y está
    pendiente; registra fecha/hora servidor, dispositivo, texto completo de la
    declaración y número de constancia. Inmutable después (triggers ya
    existentes de acuses).
  - `portal_confirmar_lectura(p_comunicado_id)` — TRB-08; comunicados sin
    exigencia de acuse se marcan vistos automáticamente (auditoría, sin
    constancia).
  - `portal_actualizar_datos(p_celular, p_direccion)` y
    `portal_solicitar_cambio_cuenta(p_motivo)` — TRB-12 (la cuenta de haberes
    JAMÁS se edita directa: genera solicitud para RRHH, ya existe el flujo de
    aprobación en Personal).
- **Vistas `v_portal_*`** (TODAS filtran por el dni del JWT — primer RLS real
  del proyecto, acotado al portal):
  - `v_portal_perfil`: nombre, cargo, sede, empresa, estado del vínculo y
    `modo` ('vigente' | 'solo-lectura' | 'expirado') — cesado hace ≤12 meses
    entra en solo lectura; >12 meses no entra.
  - `v_portal_pendientes`: documentos pendientes ordenados por urgencia
    (memorándum > boleta > comunicado; en V1 sin memorándums igual se ordena).
  - `v_portal_boletas`: histórico completo agrupable por año, todas las
    empresas del grupo, versiones reemplazadas visibles con su acuse original.
  - `v_portal_comunicados`: vigentes + histórico, con exigencia de acuse.
  - `v_portal_mes`: días trabajados, tardanzas, vacaciones del periodo; sin
    filas si no hay marcaciones importadas (el bloque no se muestra).
  - `v_portal_datos`: identificación solo lectura + celular/dirección + cuenta
    de haberes enmascarada.
- **Cuentas de trabajadores**: función serverless `api/portal-cuentas.js`
  (service key, patrón admin-usuarios): acciones `crear` (una o lote por sede/
  empresa) y `restablecer`; autorización: JWT de BackOffice con nivel ≥2 en
  módulo `personal`. Genera clave provisional NUMÉRICA de 8 dígitos (el
  operario la tipea en celular), `primer_ingreso_pendiente = true`.
- **BackOffice (RRH-02 Personal)**: botones «Crear cuenta del portal» /
  «Restablecer clave del portal» por persona (y acción masiva por filtro) que
  llaman a la serverless y muestran la clave para entrega presencial.

## 3. Pantallas V1 (portal/src/pages/)

Barra inferior fija: **Inicio · Boletas · Yo** (Documentos llega en V1.1).
Estética GrupoER v2 en versión ligera; tipografía del sistema con Poppins solo
para titulares (peso). Todos los textos sin jerga.

- **TRB-01 `Ingreso`**: DNI (8 dígitos, inputmode numeric) + clave con ojito.
  Mensaje único de error (no revela si el DNI existe). Bloqueado → "Demasiados
  intentos…". Suspendido/expirado → "Contacta a Recursos Humanos". «Olvidé mi
  clave» → pantalla estática: acude a tu supervisor o RRHH.
- **TRB-03 `PrimerIngreso`**: obligatoria y no salteable (guard sobre
  `primer_ingreso_pendiente`); clave nueva ×2 (mín. 6), celular de 9 dígitos o
  botón «No tengo celular» (queda marcado para acuse asistido), casilla de la
  política con el texto completo visible; al guardar: updateUser + RPC.
- **TRB-04 `Inicio`**: saludo (nombre de pila, cargo, sede); «Te falta
  revisar» con etiqueta de estado, título y fecha por ítem (vacío explícito:
  «Estás al día ✓»); «Tu mes» solo con datos importados; cesado en solo
  lectura ve un aviso permanente y ningún botón de acción.
- **TRB-05 `Boletas`**: años colapsables, cada boleta con periodo, tipo
  (boleta/gratificación/CTS/utilidades), empresa emisora, estado
  (pendiente/conforme + fecha/hora del acuse).
- **TRB-06 `Documento`**: visor del PDF (iframe/objeto con fallback a
  descarga); si pendiente y el visor cargó → aviso de qué significa confirmar
  y botón «Confirmar recepción» (deshabilitado si el archivo no cargó); si
  confirmado → constancia (número, fecha/hora, dispositivo, huella SHA-256) y
  descarga; si reemplazado → aviso y enlace a la versión vigente.
- **TRB-07 `Declaracion`** (hoja modal sobre TRB-06): texto completo de la
  declaración (scroll obligatorio hasta el final o botón deshabilitado),
  «Sí, confirmo la recepción» / «Todavía no». Confirmar ≠ estar de acuerdo:
  el texto lo dice explícitamente.
- **TRB-08 `Comunicado`**: origen, fecha, título, cuerpo, adjuntos; botón
  «Confirmar que lo leí» solo si exige acuse (mismo flujo TRB-07); sin
  exigencia → visto automático silencioso.
- **TRB-12 `MisDatos`**: identificación solo lectura; celular y dirección
  editables (guardado directo + auditoría); cuenta de haberes enmascarada con
  «Solicitar cambio» (motivo + aviso de verificación por RRHH); «Cerrar
  sesión». Cambiar celular invalida códigos pendientes (aplica desde V1.1).

## 4. Reglas transversales

- Modo solo lectura (cesados ≤12 meses): pueden ver y descargar boletas y
  constancias; NO confirmar recepciones ni editar datos.
- Toda pantalla maneja: sin conexión (mensaje + reintentar), carga (esqueleto
  ligero), vacío explícito.
- La sesión de 30 días la da GoTrue (refresh token); si expira → TRB-01.
- Peso: sin imágenes decorativas; logos SVG; fuentes con `display=swap` y
  subsets; verificar bundle < 60KB gzip en cada tarea del plan.

## Fuera de alcance V1 (documentado)

TRB-02 (código WhatsApp/SMS), TRB-09/10 (memorándums + descargo con adjuntos,
requiere Supabase Storage), TRB-11 (Mis documentos), avisos push/WhatsApp,
edición de declaraciones (ADM-04), RLS del BackOffice.

## Criterios de éxito

1. Un trabajador seed entra con DNI + clave provisional desde un celular,
   completa TRB-03 (queda registrada la versión de la política aceptada), ve
   SOLO sus boletas, abre una pendiente, lee la declaración completa, confirma
   y recibe constancia con número y huella; el acuse aparece al instante en el
   BackOffice (RRH-11 Acuses).
2. Manipular las peticiones con otro DNI no devuelve datos ajenos (scoping por
   JWT verificado por script).
3. Un cesado de hace 3 meses entra en solo lectura; uno de hace 13 meses no
   entra.
4. Bundle inicial del portal < 60KB gzip; carga usable en 3G simulado.
5. Script `verificar-portal.mjs` con las pruebas positivas y negativas pasa
   completo.
