# Accesos v2: Categorías con alcance y enforcement — Diseño

Aprobado por Diego el 2026-08-13. Extiende el módulo Accesos y Roles (ACC-01→06)
construido según `Accesos_y_Roles_Intranet_V1_0_1.md`.

## Decisiones tomadas (con Diego)

1. **Eliminar definitivo**: borra el usuario y su cuenta de ingreso para siempre;
   sus filas históricas en ACC-06 se conservan con nombre/DNI congelados.
2. **Herencia tal cual**: la categoría define módulos Y razones sociales; el
   usuario los recibe en solo lectura. Sin ajustes por usuario. Para dar un
   acceso distinto se crea otra categoría.
3. **Persona del maestro**: crear usuario exige que la persona exista en
   Personal (como hoy). Sin entrada libre.
4. **Enforcement en la app en este ciclo**; RLS en base de datos queda como
   fase siguiente documentada.
5. **Nombre en la interfaz: "Categorías"** (reemplaza "Perfiles" en menú y
   pantallas; los códigos ACC-03/ACC-04 se mantienen).
6. **Por ahora** solo quedan activas las categorías **Superadministrador** y
   **Gerente de Administración**; las demás de ejemplo se archivan. Los
   supervisores/operativos NO son usuarios del BackOffice (entrarán por el
   Portal del Trabajador cuando exista).

## 1. Categorías (ACC-03 catálogo · ACC-04 constructor)

Una categoría = título + descripción + matriz de módulos (niveles 0–3, ya
existente) + casillas transversales (ya existentes) + **razones sociales**
(nuevo: checkboxes NEGLIAF/BREMCO/PROMANT/Limpieza Americana).

- El constructor (ACC-04) suma la sección "Razones sociales" con la regla:
  toda categoría no-superadmin debe tener ≥1 razón social. El resumen en
  lenguaje natural incluye la frase de alcance ("Opera sobre NEGLIAF y BREMCO").
- El versionado e historial existentes cubren el requisito "que quede
  registrado por si lo quiero editar": cada edición crea versión nueva; el
  alcance de empresas forma parte de la versión.
- Renombrar en UI: menú lateral "Perfiles" → "Categorías", títulos y textos.

### Datos

```sql
-- Alcance por razón social, versionado igual que perfil_permisos:
create table perfil_empresas (
  perfil_id text not null,
  version   int  not null,
  empresa_id text not null references empresas(id),
  primary key (perfil_id, version, empresa_id),
  foreign key (perfil_id, version) references perfiles(id, version) on delete cascade
);
-- Invariante por trigger: superadmin sin filas aquí (opera sobre todo);
-- no-superadmin con >=1 fila por versión (validado al publicar la versión).
```

- Vistas: `v_perfiles` y `v_perfil_versiones` agregan `empresas` (array de ids).
- Seed/migración: categorías de ejemplo distintas de Superadministrador y
  Gerente de Administración pasan a `estado = 'archivado'`. Si "Gerente de
  Administración" no existe, se crea (matriz: Administración nivel 3, Accesos
  nivel 2; razones sociales: todas — ajustable luego por Diego en ACC-04).

## 2. Usuarios (ACC-01 listado · ACC-02 alta/edición)

### Formulario de alta

Orden: buscar persona en Personal → **seleccionar categoría** → panel de solo
lectura "Accesos que hereda" (módulos con nivel + razones sociales de la
categoría vigente) → correo y celular de contacto → guardar. Al guardar se
muestra el modal existente de clave provisional, ampliado con **código de
usuario** y **fecha de registro**.

- **Código de usuario**: autogenerado `U-0001`, `U-0002`… (secuencia en BD),
  visible en el formulario (para alta nueva se muestra "se asignará al
  guardar"), en el modal de clave, en la tabla y en el CSV exportado.
- **Fecha de registro**: `creado_en` de la BD, visible en el formulario de
  edición, en el modal y en la tabla.
- Desaparecen los checkboxes de alcance por usuario (empresas y sedes): el
  alcance viene íntegro de la categoría. Las tablas `usuario_alcance_empresa`
  y `usuario_alcance_sede` se deprecan (se eliminan tras migrar).

### Eliminar definitivamente

- Acción nueva en la tabla ACC-01, visible solo para quien tenga nivel 3
  (aprobar) en el módulo Accesos. Confirmación fuerte: modal que exige
  escribir `ELIMINAR`.
- Efecto: borra la fila de `usuarios_admin` (y su cuenta Auth vía función
  serverless), registra el hecho en auditoría. `registro_accesos.usuario_id`
  pasa a `on delete set null`: las filas históricas quedan con `dni` y
  `correo` ya denormalizados (columnas existentes).
- Invariantes: nunca el último superadministrador activo (trigger existente
  cubre delete); nadie puede eliminarse a sí mismo.

## 3. Cuentas de ingreso reales (función serverless)

`api/admin-usuarios.js` en Vercel (Node), usa `SUPABASE_SERVICE_ROLE_KEY` de
las env vars (saneada con `limpiar()` — lección del BOM).

- **Autorización del llamador**: la función recibe el JWT de sesión (cabecera
  `x-sesion`, mismo patrón del proxy), lo valida contra GoTrue y consulta en
  BD que el llamador sea un usuario admin activo con nivel ≥2 en el módulo
  `accesos` (eliminar exige nivel 3). Sin JWT válido → 401.
- **POST crear**: `{dni}` → lee el usuario admin de la BD (correo, si no tiene
  correo → error), crea la cuenta Auth con clave provisional generada
  server-side, marca `requiere_cambio_clave = true`, devuelve la clave para el
  modal. Idempotente: si la cuenta ya existe, error claro.
- **DELETE eliminar**: `{usuario_id}` → valida invariantes en BD (RPC
  `eliminar_usuario_admin`), borra la cuenta Auth si existe, borra la fila.
- El flujo de ACC-02 llama a esta función al crear y al eliminar. La clave
  provisional deja de generarse en el navegador (`genClave` se retira).

## 4. Enforcement al ingresar (en la app)

Tras autenticar, `state.jsx` carga de la vista nueva `v_mi_acceso` (por
`auth.uid()` → correo): categoría vigente con su matriz de módulos, casillas y
razones sociales. Se guarda en el contexto como `user.acceso = { matriz,
casillas, empresas, esSuperadmin }`.

- **Menú lateral (Shell)**: cada item declara su módulo (mapa ruta→módulo:
  Tablero/Personal→`personal`, Boletas→`boletas`, Acuses→`acuses`,
  Comunicados→`comunicados`, Memorándums→`memorandums`, Contratos→`contratos`,
  Tardanzas→`tardanzas`, Inventario/Líneas/EPP/Costos→`activos`,
  Usuarios/Categorías/Política→`accesos`, Registro→`auditoria`). Se muestran
  solo los items con nivel ≥1; un grupo sin items visibles desaparece.
- **Selector de empresa**: solo las razones sociales del alcance; si es una
  sola, el selector se muestra fijo. `empresaId` inicial = la primera del
  alcance.
- **Guard de ruta**: componente `RequiereModulo` que envuelve cada pantalla;
  si el nivel es 0 redirige a la primera pantalla permitida con un aviso
  ("No tienes acceso a este módulo").
- **Ruta de aterrizaje**: al ingresar se navega a la primera pantalla
  permitida (hoy es siempre /rrhh; con categorías puede ser otra).
- Superadmin: todo visible, selector completo (comportamiento actual).
- Los datos mostrados se filtran por `empresaId` como hoy — al restringir el
  selector, quedan restringidos. **Límite conocido y aceptado**: la BD aún no
  rechaza consultas fuera de alcance (RLS = fase siguiente).

## Migración de datos existentes

Pocos usuarios (reales: solo el superadmin; resto mock). Script SQL:
1. Crear `perfil_empresas` para la versión vigente de cada categoría activa a
   partir de la unión de alcances de sus usuarios (o todas las empresas si
   ninguno tiene alcance).
2. Poblar `codigo` (secuencia por orden de `creado_en`).
3. Eliminar `usuario_alcance_empresa` y `usuario_alcance_sede`.
4. Archivar categorías que no sean Superadministrador / Gerente de Administración.

## Fuera de alcance (documentado, fase siguiente)

- RLS en base de datos con `puede()` (la función ya existe en `accesos.sql`).
- Niveles finos dentro de cada pantalla (botones accionar/aprobar por nivel).
- Envío real de la clave provisional por correo (depende del Motor 9).
- 2FA superadmin (POR DEFINIR en la spec del módulo).
- Portal del Trabajador para usuarios operarios.

## Criterios de éxito

1. Crear la categoría "Analista RRHH" con módulo RRHH nivel 2 y razones
   NEGLIAF+BREMCO; crear un usuario con ella; ese usuario inicia sesión REAL y
   ve únicamente el grupo RRHH en el menú y solo NEGLIAF/BREMCO en el selector;
   entrar por URL a /admin/activos lo redirige con aviso.
2. Editar la categoría (quitar BREMCO) genera versión nueva visible en el
   historial, y el usuario al reingresar ya no ve BREMCO.
3. Eliminar definitivamente a ese usuario: desaparece de ACC-01, su cuenta ya
   no puede ingresar (mensaje único), y sus ingresos previos siguen visibles
   en ACC-06 con su DNI.
4. El código `U-000N` y la fecha de registro aparecen en formulario, modal,
   tabla y CSV.
5. Scripts `verificar-*` nuevos pasan (positivas y negativas, estilo del módulo).
