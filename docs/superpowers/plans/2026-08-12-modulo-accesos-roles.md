# Módulo de Accesos y Roles (ACC-01…ACC-06) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar el módulo de Accesos y Roles según `Accesos_y_Roles_Intranet_V1_0_1.md`: seis pantallas (ACC-01 a ACC-06) en el BackOffice, con perfiles versionados, usuarios administrativos con alcance, política de acceso y registro de accesos, respaldado por Supabase (tablas + vistas + RPCs + invariantes) y con fallback a datos mock.

**Architecture:** Mismo patrón que el resto de la intranet: la interfaz lee **vistas** (`v_*`) de Supabase y escribe mediante **funciones RPC** con actualización optimista local y fallback a mock (`src/state.jsx`). La lógica de negocio (versionado de perfiles, invariante del último superadministrador, inmutabilidad del registro) vive en Postgres como triggers y funciones. La **evaluación de permisos en runtime** (`puede()`) se implementa en SQL lista para conectarse cuando llegue Supabase Auth — el login sigue siendo demo, así que en esta etapa el módulo administra los datos pero aún no restringe la navegación.

**Tech Stack:** React 19 + Vite 7 + Tailwind 4, react-router, lucide-react, Supabase (Postgres, proyecto `mzpbdkrmokfxrrsotfgs`).

## Global Constraints

- Toda la UI en español formal peruano; códigos de pantalla visibles (`ACC-01`…`ACC-06`) vía `PageHeader code=`.
- Usar SOLO los componentes de `src/components/ui.jsx` (PageHeader, Card, Stat, Badge, Button, Field, Input, Select, Textarea, Table, Td, EmptyState, Modal, Note, Progress, inputCls) y tokens de color existentes (`petroleo`, `acero`, `pend`, `conf`, `alerta`, `papel`, `borde`, `gris`, `tinta`).
- Vistas de lectura con alias camelCase cuando el frontend usa camelCase (patrón `"exigeAcuse"` de `v_comunicados`).
- El mock y las vistas deben devolver **exactamente la misma forma de datos**.
- ADM-03 queda liberado y no se reutiliza (no existe en el código; nada que borrar).
- Los 11 módulos del enum: `personal, boletas, acuses, comunicados, memorandums, contratos, tardanzas, activos, accesos, auditoria, configuracion`. Solo 8 tienen nivel 3 (aprobar); `acuses`, `tardanzas` y `auditoria` NO.
- No hay framework de tests en el repo: la verificación de cada tarea es `npm run build` (debe pasar sin errores) + verificación funcional; para SQL, consultas de verificación e intentos de violar invariantes (deben fallar).
- SQL directo a Supabase SIEMPRE vía Management API `POST /v1/projects/mzpbdkrmokfxrrsotfgs/database/query` desde **Node** (ConvertTo-Json de PS 5.1 rompe el body).
- Commits frecuentes, mensajes en español, push a `main` = deploy automático en Vercel (`intranet-general`).

---

### Task 1: Catálogo de módulos y niveles

**Files:**
- Create: `src/data/modulos.js`

**Interfaces:**
- Produces: `MODULOS` (array de 11 objetos `{ id, nombre, aprobacion: bool, ver, accionar, aprobar }`), `NIVELES` (array de 4 strings), `CASILLAS` (array de 3 objetos `{ id, nombre, detalle }`). Los textos `ver/accionar/aprobar` alimentan el panel de resumen en lenguaje natural de ACC-04 y la definición operativa del permiso.

- [ ] **Step 1: Escribir `src/data/modulos.js`**

```js
// Catálogo de módulos y niveles de permiso — definición operativa según
// "Módulo de Accesos y Roles v1.0". Los textos ver/accionar/aprobar se usan
// en el resumen en lenguaje natural del constructor de perfiles (ACC-04).

export const NIVELES = ["Sin acceso", "Solo ver", "Ver y accionar", "Ver, accionar y aprobar"];

export const MODULOS = [
  { id: "personal", nombre: "Personal", aprobacion: true,
    ver: "consultar el maestro, el legajo y exportar el listado",
    accionar: "dar de alta y editar, importar planillas, abrir vínculos y reenviar claves",
    aprobar: "aprobar cambios de cuenta de haberes y cerrar vínculos por cese" },
  { id: "boletas", nombre: "Boletas y documentos", aprobacion: true,
    ver: "consultar los lotes publicados y su detalle",
    accionar: "cargar, resolver excepciones y publicar el lote",
    aprobar: "publicar correcciones de versión y excluir boletas del lote" },
  { id: "acuses", nombre: "Acuses y constancias", aprobacion: false,
    ver: "consultar el seguimiento, las constancias y la evidencia",
    accionar: "enviar recordatorios masivos, registrar acuses asistidos y exportar constancias",
    aprobar: null },
  { id: "comunicados", nombre: "Comunicados", aprobacion: true,
    ver: "consultar el listado y el avance de lectura",
    accionar: "redactar y publicar dentro de su alcance",
    aprobar: "publicar a todo el grupo" },
  { id: "memorandums", nombre: "Memorándums", aprobacion: true,
    ver: "consultar la bandeja y los expedientes",
    accionar: "emitir y notificar",
    aprobar: "resolver el proceso disciplinario" },
  { id: "contratos", nombre: "Contratos", aprobacion: true,
    ver: "consultar vigentes y vencimientos",
    accionar: "generar en lote y emitir adendas",
    aprobar: "editar plantillas y publicar versiones de plantilla" },
  { id: "tardanzas", nombre: "Tardanzas", aprobacion: false,
    ver: "consultar el consolidado del periodo",
    accionar: "importar marcaciones",
    aprobar: null },
  { id: "activos", nombre: "Activos y equipos", aprobacion: true,
    ver: "consultar el inventario y el costeo",
    accionar: "dar de alta, asignar, registrar devoluciones y entregas de EPP",
    aprobar: "dar de baja activos y registrar pérdidas o robos con responsable" },
  { id: "accesos", nombre: "Accesos y roles", aprobacion: true,
    ver: "consultar usuarios y perfiles en lectura",
    accionar: "crear usuarios y asignarles perfiles existentes",
    aprobar: "crear y editar perfiles y editar la política de acceso" },
  { id: "auditoria", nombre: "Auditoría", aprobacion: false,
    ver: "consultar el registro",
    accionar: "exportar el registro",
    aprobar: null },
  { id: "configuracion", nombre: "Configuración del sistema", aprobacion: true,
    ver: "leer la configuración vigente",
    accionar: "editar catálogos: cargos, sedes, feriados y tipos de documento",
    aprobar: "editar los parámetros del motor de acuses y la política de retención" },
];

// Permisos transversales que no encajan en la matriz. Ninguno se concede
// por defecto; toda consulta de remuneración y toda exportación de datos
// personales se registra en auditoría, tenga el usuario el permiso o no.
export const CASILLAS = [
  { id: "verRemuneracion", nombre: "Ver remuneración",
    detalle: "El campo de remuneración en el legajo y en la generación de contratos" },
  { id: "verDocumentosTerceros", nombre: "Abrir documentos de terceros",
    detalle: "La vista previa y la descarga del PDF de la boleta de otro trabajador" },
  { id: "exportarDatosPersonales", nombre: "Exportar datos personales",
    detalle: "Descargas masivas de listados, legajos y paquetes de constancias (Ley 29733)" },
];
```

- [ ] **Step 2: Verificar build** — Run: `npm run build` en `C:\Users\DiegoSalguero\Intranet`. Expected: éxito.

- [ ] **Step 3: Commit**

```bash
git add src/data/modulos.js
git commit -m "feat(accesos): catálogo de módulos, niveles y casillas especiales"
```

---

### Task 2: Datos mock del módulo

**Files:**
- Modify: `src/data/mock.js` (agregar al final, antes de los helpers `persona/sede/empresa`; además agregar 2 personas administrativas a `PERSONAL` y el cargo "Jefe de RRHH" a `CARGOS`)

**Interfaces:**
- Produces: `PERFILES`, `PERFIL_VERSIONES`, `USUARIOS_ADMIN`, `POLITICA_ACCESO`, `REGISTRO_ACCESOS` con la MISMA forma que devolverán las vistas `v_perfiles`, `v_perfil_versiones`, `v_usuarios_admin`, `v_politica_acceso`, `v_registro_accesos` (Task 10).

- [ ] **Step 1: Agregar "Jefe de RRHH" a `CARGOS`** (los administradores también son Personas con vínculo):

```js
export const CARGOS = ["Operario de limpieza", "Supervisor de sede", "Técnico de mantenimiento", "Auxiliar de servicios", "Analista RRHH", "Jefe de RRHH"];
```

- [ ] **Step 2: Agregar a `PERSONAL` (al final del array) las dos personas administrativas:**

```js
  { dni: "40776655", nombre: "Diego Salguero Tang", cargo: "Jefe de RRHH", sede: "sunat", empresa: "negliaf", ingreso: "2020-01-15", celular: "999888777", portal: "activo", estado: "vigente", banco: "BCP", cuenta: "191-55667788-0-01" },
  { dni: "40881122", nombre: "Karina Prado Salas", cargo: "Analista RRHH", sede: "sunat", empresa: "negliaf", ingreso: "2021-04-01", celular: "988776655", portal: "activo", estado: "vigente", banco: "Interbank", cuenta: "898-3007788990" },
```

- [ ] **Step 3: Agregar los datos del módulo (Anexo A como seed):**

```js
// ---- Accesos y Roles (ACC-01…ACC-06) ----
// Perfiles sugeridos del Anexo A. La matriz es {modulo: nivel 0..3};
// un perfil con esSuperadmin=true no lleva matriz (se ignora completa).

export const PERFILES = [
  { id: "superadmin", version: 1, nombre: "Superadministrador",
    descripcion: "Control total del grupo. La marca ignora la matriz y el alcance.",
    esSuperadmin: true, verRemuneracion: false, verDocumentosTerceros: false, exportarDatosPersonales: false,
    estado: "activo", matriz: {}, usuarios: 1, modificado: "2026-08-12 09:00", modificadoPor: "Sistema" },
  { id: "rrhh-operativo", version: 1, nombre: "RRHH operativo",
    descripcion: "Opera los módulos de RRHH del día a día, sin aprobaciones.",
    esSuperadmin: false, verRemuneracion: false, verDocumentosTerceros: false, exportarDatosPersonales: false,
    estado: "activo",
    matriz: { personal: 2, boletas: 2, acuses: 2, comunicados: 2, memorandums: 2, contratos: 2, tardanzas: 2, activos: 1, accesos: 0, auditoria: 0, configuracion: 1 },
    usuarios: 1, modificado: "2026-08-12 09:00", modificadoPor: "Sistema" },
  { id: "jefatura-rrhh", version: 1, nombre: "Jefatura de RRHH",
    descripcion: "Opera y aprueba en los módulos de RRHH. Ve remuneración y exporta datos personales.",
    esSuperadmin: false, verRemuneracion: true, verDocumentosTerceros: true, exportarDatosPersonales: true,
    estado: "activo",
    matriz: { personal: 3, boletas: 3, acuses: 2, comunicados: 3, memorandums: 3, contratos: 3, tardanzas: 2, activos: 1, accesos: 0, auditoria: 0, configuracion: 1 },
    usuarios: 0, modificado: "2026-08-12 09:00", modificadoPor: "Sistema" },
  { id: "administracion", version: 1, nombre: "Administración",
    descripcion: "Gestiona activos, equipos y EPP de todo el grupo.",
    esSuperadmin: false, verRemuneracion: false, verDocumentosTerceros: false, exportarDatosPersonales: false,
    estado: "activo",
    matriz: { personal: 1, boletas: 0, acuses: 0, comunicados: 0, memorandums: 0, contratos: 0, tardanzas: 0, activos: 3, accesos: 0, auditoria: 0, configuracion: 1 },
    usuarios: 0, modificado: "2026-08-12 09:00", modificadoPor: "Sistema" },
  { id: "supervisor-sede", version: 1, nombre: "Supervisor de sede",
    descripcion: "Registra acuses asistidos y consulta su cuadrilla, sin ver el contenido de las boletas.",
    esSuperadmin: false, verRemuneracion: false, verDocumentosTerceros: false, exportarDatosPersonales: false,
    estado: "activo",
    matriz: { personal: 1, boletas: 0, acuses: 2, comunicados: 1, memorandums: 0, contratos: 0, tardanzas: 0, activos: 0, accesos: 0, auditoria: 0, configuracion: 0 },
    usuarios: 2, modificado: "2026-08-12 09:00", modificadoPor: "Sistema" },
  { id: "auditor", version: 1, nombre: "Auditor",
    descripcion: "Solo lectura en los once módulos, con exportación de datos personales.",
    esSuperadmin: false, verRemuneracion: false, verDocumentosTerceros: false, exportarDatosPersonales: true,
    estado: "activo",
    matriz: { personal: 1, boletas: 1, acuses: 1, comunicados: 1, memorandums: 1, contratos: 1, tardanzas: 1, activos: 1, accesos: 1, auditoria: 1, configuracion: 1 },
    usuarios: 0, modificado: "2026-08-12 09:00", modificadoPor: "Sistema" },
];

export const PERFIL_VERSIONES = PERFILES.map((p) => ({
  perfilId: p.id, version: 1, nombre: p.nombre, esSuperadmin: p.esSuperadmin,
  matriz: p.matriz, creado: "2026-08-12 09:00", por: "Sistema",
}));

export const USUARIOS_ADMIN = [
  { id: 1, dni: "40776655", nombre: "Diego Salguero Tang", perfil: "superadmin", perfilNombre: "Superadministrador",
    esSuperadmin: true, correo: "dsalguero@grupoer.pe", celular: "999888777", estado: "activo",
    empresas: [], sedes: [], ultimoIngreso: "2026-08-12 08:45", nuncaIngreso: false, inconsistencia: false,
    cargo: "Jefe de RRHH", sede: "sunat", empresa: "negliaf", creado: "2026-08-01" },
  { id: 2, dni: "40881122", nombre: "Karina Prado Salas", perfil: "rrhh-operativo", perfilNombre: "RRHH operativo",
    esSuperadmin: false, correo: "kprado@grupoer.pe", celular: "988776655", estado: "activo",
    empresas: ["negliaf", "bremco", "promant", "lamericana"], sedes: [], ultimoIngreso: "2026-08-11 17:20",
    nuncaIngreso: false, inconsistencia: false, cargo: "Analista RRHH", sede: "sunat", empresa: "negliaf", creado: "2026-08-01" },
  { id: 3, dni: "40125634", nombre: "Julio Mamani Apaza", perfil: "supervisor-sede", perfilNombre: "Supervisor de sede",
    esSuperadmin: false, correo: null, celular: "912345678", estado: "activo",
    empresas: ["negliaf"], sedes: ["sunat", "migraciones"], ultimoIngreso: "2026-08-09 17:30",
    nuncaIngreso: false, inconsistencia: false, cargo: "Supervisor de sede", sede: "migraciones", empresa: "negliaf", creado: "2026-08-02" },
  { id: 4, dni: "43906712", nombre: "Carmen Torres Vega", perfil: "supervisor-sede", perfilNombre: "Supervisor de sede",
    esSuperadmin: false, correo: "ctorres@grupoer.pe", celular: "934567812", estado: "activo",
    empresas: ["negliaf"], sedes: ["minedu", "ins"], ultimoIngreso: null,
    nuncaIngreso: true, inconsistencia: false, cargo: "Supervisor de sede", sede: "minedu", empresa: "negliaf", creado: "2026-08-10" },
];

// Fila única: la política rige para toda la instalación.
export const POLITICA_ACCESO = [{
  sesionBackofficeHoras: 8, sesionPortalDias: 30,
  multisesionBackoffice: false, multisesionPortal: true,
  intentosBloqueo: 5, bloqueoMinutos: 15,
  recuperacionDefecto: "whatsapp", claveLongitudMin: 8, claveProvisionalDias: 7,
  actualizado: null, actualizadoPor: null,
}];

export const REGISTRO_ACCESOS = [
  { id: 8, fecha: "2026-08-12 08:45", usuario: "Diego Salguero Tang", perfil: "Superadministrador", superficie: "backoffice", resultado: "exitoso", ip: "200.48.12.5", dispositivo: "Windows · Chrome", empresa: "negliaf" },
  { id: 7, fecha: "2026-08-11 19:02", usuario: "Rosa Quispe Huamán", perfil: "Portal del Trabajador", superficie: "portal", resultado: "exitoso", ip: "181.65.212.44", dispositivo: "Android 12 · Chrome Mobile", empresa: "negliaf" },
  { id: 6, fecha: "2026-08-11 17:20", usuario: "Karina Prado Salas", perfil: "RRHH operativo", superficie: "backoffice", resultado: "exitoso", ip: "200.48.12.8", dispositivo: "Windows · Edge", empresa: "negliaf" },
  { id: 5, fecha: "2026-08-11 12:44", usuario: "Karina Prado Salas", perfil: "RRHH operativo", superficie: "backoffice", resultado: "fallido", ip: "200.48.12.8", dispositivo: "Windows · Edge", empresa: "negliaf" },
  { id: 4, fecha: "2026-08-10 21:15", usuario: "Miguel Paredes Luna", perfil: "Portal del Trabajador", superficie: "portal", resultado: "fallido", ip: "190.42.77.31", dispositivo: "Android 10 · Chrome Mobile", empresa: "negliaf" },
  { id: 3, fecha: "2026-08-10 21:18", usuario: "Miguel Paredes Luna", perfil: "Portal del Trabajador", superficie: "portal", resultado: "bloqueado", ip: "190.42.77.31", dispositivo: "Android 10 · Chrome Mobile", empresa: "negliaf" },
  { id: 2, fecha: "2026-08-09 17:30", usuario: "Julio Mamani Apaza", perfil: "Supervisor de sede", superficie: "backoffice", resultado: "exitoso", ip: "181.65.44.2", dispositivo: "Android 12 · Chrome Mobile", empresa: "negliaf" },
  { id: 1, fecha: "2026-08-09 07:58", usuario: "Víctor Salas Quiroz", perfil: "Portal del Trabajador", superficie: "portal", resultado: "exitoso", ip: "201.230.14.9", dispositivo: "Android 13 · Chrome Mobile", empresa: "bremco" },
];
```

- [ ] **Step 4: Verificar build** — Run: `npm run build`. Expected: éxito.

- [ ] **Step 5: Commit**

```bash
git add src/data/mock.js
git commit -m "feat(accesos): datos mock de perfiles, usuarios admin, política y registro"
```

---

### Task 3: Estado global — fuentes y acciones

**Files:**
- Modify: `src/state.jsx`

**Interfaces:**
- Consumes: mocks de Task 2.
- Produces: claves de estado `db.perfiles`, `db.perfilVersiones`, `db.usuariosAdmin`, `db.politica`, `db.registroAccesos`; acciones `guardarPerfil(perfil)`, `desactivarPerfil(id)`, `crearUsuarioAdmin(u)`, `actualizarUsuarioAdmin(id, cambios)`, `suspenderUsuarioAdmin(id)`, `reactivarUsuarioAdmin(id)`, `reenviarClave(id, clave)`, `guardarPolitica(p)`. Las páginas de Tasks 5–9 consumen exactamente estas firmas.

- [ ] **Step 1: Agregar a `FUENTES`:**

```js
  perfiles: "v_perfiles",
  perfilVersiones: "v_perfil_versiones",
  usuariosAdmin: "v_usuarios_admin",
  politica: "v_politica_acceso",
  registroAccesos: "v_registro_accesos",
```

- [ ] **Step 2: Agregar a `LOCAL`:**

```js
  perfiles: MOCK.PERFILES,
  perfilVersiones: MOCK.PERFIL_VERSIONES,
  usuariosAdmin: MOCK.USUARIOS_ADMIN,
  politica: MOCK.POLITICA_ACCESO,
  registroAccesos: MOCK.REGISTRO_ACCESOS,
```

- [ ] **Step 3: Agregar las acciones al objeto `acciones`** (mismo patrón optimista + RPC del archivo):

```js
    // ---- Accesos y Roles ----
    guardarPerfil: (perfil) => {
      const previa = db.perfiles.find((p) => p.id === perfil.id);
      const version = (previa?.version ?? 0) + 1;
      const ahora = new Date().toISOString().slice(0, 16).replace("T", " ");
      const fila = { ...perfil, version, estado: "activo", usuarios: previa?.usuarios ?? 0, modificado: ahora, modificadoPor: user?.nombre ?? "BackOffice" };
      local("perfiles", (xs) => [fila, ...xs.filter((p) => p.id !== perfil.id)]);
      local("perfilVersiones", (xs) => [{ perfilId: perfil.id, version, nombre: perfil.nombre, esSuperadmin: perfil.esSuperadmin, matriz: perfil.matriz, creado: ahora, por: user?.nombre ?? "BackOffice" }, ...xs]);
      rpc("guardar_perfil", {
        p_id: perfil.id, p_nombre: perfil.nombre, p_descripcion: perfil.descripcion,
        p_superadmin: perfil.esSuperadmin, p_ver_remuneracion: perfil.verRemuneracion,
        p_ver_documentos: perfil.verDocumentosTerceros, p_exportar: perfil.exportarDatosPersonales,
        p_matriz: perfil.matriz, p_por: user?.nombre ?? "BackOffice",
      }, "perfiles", "perfilVersiones", "usuariosAdmin");
    },
    desactivarPerfil: (id) => {
      local("perfiles", (xs) => xs.map((p) => (p.id === id ? { ...p, estado: "desactivado" } : p)));
      rpc("desactivar_perfil", { p_id: id }, "perfiles");
    },
    crearUsuarioAdmin: (u) => {
      local("usuariosAdmin", (xs) => [{ ...u, id: Math.max(0, ...xs.map((x) => x.id)) + 1, estado: "activo", ultimoIngreso: null, nuncaIngreso: true, inconsistencia: false, creado: new Date().toISOString().slice(0, 10) }, ...xs]);
      local("perfiles", (xs) => xs.map((p) => (p.id === u.perfil ? { ...p, usuarios: p.usuarios + 1 } : p)));
      rpc("crear_usuario_admin", {
        p_dni: u.dni, p_perfil: u.perfil, p_correo: u.correo, p_celular: u.celular,
        p_empresas: u.empresas, p_sedes: u.sedes, p_clave: u.clave, p_por: user?.nombre ?? "BackOffice",
      }, "usuariosAdmin", "perfiles");
    },
    actualizarUsuarioAdmin: (id, cambios) => {
      local("usuariosAdmin", (xs) => xs.map((x) => (x.id === id ? { ...x, ...cambios } : x)));
      rpc("actualizar_usuario_admin", {
        p_id: id, p_perfil: cambios.perfil, p_correo: cambios.correo, p_celular: cambios.celular,
        p_empresas: cambios.empresas, p_sedes: cambios.sedes, p_estado: cambios.estado,
      }, "usuariosAdmin", "perfiles");
    },
    suspenderUsuarioAdmin: (id) => {
      local("usuariosAdmin", (xs) => xs.map((x) => (x.id === id ? { ...x, estado: "suspendido" } : x)));
      rpc("suspender_usuario_admin", { p_id: id }, "usuariosAdmin");
    },
    reactivarUsuarioAdmin: (id) => {
      local("usuariosAdmin", (xs) => xs.map((x) => (x.id === id ? { ...x, estado: "activo" } : x)));
      rpc("reactivar_usuario_admin", { p_id: id }, "usuariosAdmin");
    },
    reenviarClave: (id, clave) => {
      rpc("reenviar_clave", { p_id: id, p_clave: clave }, "usuariosAdmin");
    },
    guardarPolitica: (p) => {
      const ahora = new Date().toISOString().slice(0, 16).replace("T", " ");
      local("politica", () => [{ ...p, actualizado: ahora, actualizadoPor: user?.nombre ?? "BackOffice" }]);
      rpc("guardar_politica", {
        p_backoffice_horas: p.sesionBackofficeHoras, p_portal_dias: p.sesionPortalDias,
        p_multisesion_backoffice: p.multisesionBackoffice, p_multisesion_portal: p.multisesionPortal,
        p_intentos: p.intentosBloqueo, p_bloqueo_min: p.bloqueoMinutos,
        p_recuperacion: p.recuperacionDefecto, p_clave_min: p.claveLongitudMin,
        p_provisional_dias: p.claveProvisionalDias, p_por: user?.nombre ?? "BackOffice",
      }, "politica");
    },
```

- [ ] **Step 4: Verificar build** — Run: `npm run build`. Expected: éxito.

- [ ] **Step 5: Commit**

```bash
git add src/state.jsx
git commit -m "feat(accesos): fuentes y acciones de estado del módulo de accesos"
```

---

### Task 4: Navegación, rutas y páginas esqueleto

**Files:**
- Create: `src/pages/accesos/Usuarios.jsx`, `src/pages/accesos/Perfiles.jsx`, `src/pages/accesos/PerfilEditor.jsx`, `src/pages/accesos/Politica.jsx`, `src/pages/accesos/RegistroAccesos.jsx` (esqueletos)
- Modify: `src/layout/Shell.jsx`, `src/App.jsx`

**Interfaces:**
- Produces: rutas `/accesos/usuarios`, `/accesos/perfiles`, `/accesos/perfiles/:id` (donde `:id` puede ser `nuevo`), `/accesos/politica`, `/accesos/registro`; grupo de navegación "Accesos y Roles". Tasks 5–9 reemplazan el cuerpo de cada esqueleto.

- [ ] **Step 1: Crear los 5 esqueletos** (mismo contenido, cambiando código/título; ejemplo `Usuarios.jsx`):

```jsx
import { PageHeader, EmptyState } from "../../components/ui";

export default function Usuarios() {
  return (
    <>
      <PageHeader code="ACC-01" title="Usuarios administrativos" />
      <EmptyState title="En construcción" body="Esta pantalla se implementa en la siguiente tarea del plan." />
    </>
  );
}
```

Códigos/títulos: `ACC-01 Usuarios administrativos`, `ACC-03 Catálogo de perfiles`, `ACC-04 Constructor de perfil`, `ACC-05 Política de acceso`, `ACC-06 Registro de accesos`.

- [ ] **Step 2: `Shell.jsx`** — agregar imports de íconos `UserCog, ShieldCheck, KeyRound, ScrollText` a la línea de lucide-react, el array y el grupo:

```jsx
const NAV_ACCESOS = [
  { to: "/accesos/usuarios", icon: UserCog, label: "Usuarios administrativos", code: "ACC-01" },
  { to: "/accesos/perfiles", icon: ShieldCheck, label: "Perfiles", code: "ACC-03" },
  { to: "/accesos/politica", icon: KeyRound, label: "Política de acceso", code: "ACC-05" },
  { to: "/accesos/registro", icon: ScrollText, label: "Registro de accesos", code: "ACC-06" },
];
```

y debajo de `<NavGroup title="Administración" …/>`:

```jsx
<NavGroup title="Accesos y Roles" items={NAV_ACCESOS} />
```

- [ ] **Step 3: `App.jsx`** — imports y rutas dentro del `<Route element={<Shell />}>`:

```jsx
import Usuarios from "./pages/accesos/Usuarios";
import Perfiles from "./pages/accesos/Perfiles";
import PerfilEditor from "./pages/accesos/PerfilEditor";
import Politica from "./pages/accesos/Politica";
import RegistroAccesos from "./pages/accesos/RegistroAccesos";
```

```jsx
<Route path="/accesos/usuarios" element={<Usuarios />} />
<Route path="/accesos/perfiles" element={<Perfiles />} />
<Route path="/accesos/perfiles/:id" element={<PerfilEditor />} />
<Route path="/accesos/politica" element={<Politica />} />
<Route path="/accesos/registro" element={<RegistroAccesos />} />
```

- [ ] **Step 4: Verificar build** — Run: `npm run build`. Expected: éxito. Verificación manual opcional: `npm run dev` y navegar a las 4 entradas del menú.

- [ ] **Step 5: Commit**

```bash
git add src/pages/accesos src/layout/Shell.jsx src/App.jsx
git commit -m "feat(accesos): navegación, rutas y páginas esqueleto ACC-01/03/04/05/06"
```

---

### Task 5: ACC-03 · Catálogo de perfiles

**Files:**
- Modify: `src/pages/accesos/Perfiles.jsx` (reemplazo completo del esqueleto)

**Interfaces:**
- Consumes: `db.perfiles`, `desactivarPerfil(id)` (Task 3); `MODULOS`, `NIVELES` (Task 1).
- Produces: navegación a `/accesos/perfiles/:id` (editar), `/accesos/perfiles/nuevo?desde=<id>` (duplicar), `/accesos/usuarios?perfil=<id>` (usuarios asignados).

- [ ] **Step 1: Implementar la pantalla.** Requisitos de la spec que el código debe cumplir:
  - Tabla: nombre, descripción, usuarios asignados, marca superadmin (Badge `tinta` con `ShieldCheck`), estado, última modificación y autor (`v{version} · {modificadoPor}`).
  - Resumen visual de matriz: componente `ResumenMatriz` — cuenta módulos por nivel y los muestra como puntos de color + número (`bg-borde` nivel 0, `bg-acero` 1, `bg-petroleo` 2, `bg-pend` 3). Para superadmin: texto "Sin matriz — acceso total".
  - Botones: Nuevo perfil (header), y por fila Editar / Duplicar / Desactivar (Desactivar solo si `estado==="activo"` y no superadmin).
  - Desactivar abre `Modal` de confirmación: si `usuarios > 0`, `Note tone="alerta"` explicando que desactivar no altera a los asignados y que para retirarlo hay que reasignar antes, con botón "Ver usuarios asignados" → `navigate('/accesos/usuarios?perfil='+id)`. Confirmar llama `desactivarPerfil(id)`.
  - Duplicar navega a `/accesos/perfiles/nuevo?desde=<id>` (vía recomendada para variantes).
  - Los perfiles NO se filtran por razón social (son del Grupo) — sin filtro de empresa.

```jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Copy, Ban, ShieldCheck, Users as UsersIcon, Pencil } from "lucide-react";
import { useApp } from "../../state";
import { PageHeader, Card, Table, Td, Badge, Button, Modal, Note } from "../../components/ui";
import { MODULOS, NIVELES } from "../../data/modulos";

function ResumenMatriz({ matriz }) {
  const conteo = [0, 0, 0, 0];
  MODULOS.forEach((m) => { conteo[matriz?.[m.id] ?? 0]++; });
  const tonos = ["bg-borde", "bg-acero", "bg-petroleo", "bg-pend"];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {conteo.map((n, i) =>
        n > 0 ? (
          <span key={i} className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-gris">
            <span className={`h-2.5 w-2.5 rounded-[2px] ${tonos[i]}`} />
            {n} · {NIVELES[i].toLowerCase()}
          </span>
        ) : null
      )}
    </div>
  );
}

export default function Perfiles() {
  const { db, desactivarPerfil } = useApp();
  const navigate = useNavigate();
  const [confirmar, setConfirmar] = useState(null);

  return (
    <>
      <PageHeader
        code="ACC-03"
        title="Catálogo de perfiles"
        subtitle="Qué concede cada perfil y cuántas personas lo usan. Los perfiles son del Grupo: el alcance por razón social se define al asignarlos, no aquí."
        actions={<Button onClick={() => navigate("/accesos/perfiles/nuevo")}><Plus size={14} /> Nuevo perfil</Button>}
      />
      <Card pad={false}>
        <Table head={["Perfil", "Matriz", "Usuarios", "Estado", "Última modificación", "Acciones"]}>
          {db.perfiles.map((p) => (
            <tr key={p.id} className="hover:bg-papel/60">
              <Td className="max-w-[260px]">
                <div className="flex items-center gap-2 font-semibold text-tinta">
                  {p.nombre}
                  {p.esSuperadmin && <Badge tone="tinta"><ShieldCheck size={11} /> Superadmin</Badge>}
                </div>
                <div className="mt-0.5 text-[11.5px] leading-snug text-gris-cl">{p.descripcion}</div>
              </Td>
              <Td>{p.esSuperadmin ? <span className="text-[11.5px] italic text-gris-cl">Sin matriz — acceso total</span> : <ResumenMatriz matriz={p.matriz} />}</Td>
              <Td>
                <button className="inline-flex items-center gap-1 text-petroleo hover:underline" onClick={() => navigate(`/accesos/usuarios?perfil=${p.id}`)}>
                  <UsersIcon size={12} /> {p.usuarios}
                </button>
              </Td>
              <Td>{p.estado === "activo" ? <Badge tone="conf">Activo</Badge> : <Badge tone="neutral">Desactivado</Badge>}</Td>
              <Td>
                <div className="text-[12px]">{p.modificado}</div>
                <div className="font-mono text-[10.5px] text-gris-cl">v{p.version} · {p.modificadoPor}</div>
              </Td>
              <Td className="whitespace-nowrap">
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/accesos/perfiles/${p.id}`)}><Pencil size={12} /> Editar</Button>
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/accesos/perfiles/nuevo?desde=${p.id}`)}><Copy size={12} /> Duplicar</Button>
                  {p.estado === "activo" && !p.esSuperadmin && (
                    <Button size="sm" variant="ghost" onClick={() => setConfirmar(p)}><Ban size={12} /> Desactivar</Button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Modal open={!!confirmar} onClose={() => setConfirmar(null)} title={`Desactivar «${confirmar?.nombre}»`}>
        {confirmar && (
          <div className="space-y-4">
            {confirmar.usuarios > 0 ? (
              <Note tone="alerta">
                <b>{confirmar.usuarios}</b> usuario(s) tienen asignado este perfil. Desactivarlo impide asignarlo a
                usuarios nuevos y <b>no altera</b> a los que ya lo tienen. Para retirarlo por completo, primero
                reasigna a sus usuarios.
              </Note>
            ) : (
              <Note tone="neutral">El perfil no tiene usuarios asignados. Podrá reactivarse más adelante duplicándolo o guardando una versión nueva.</Note>
            )}
            <div className="flex justify-end gap-2">
              {confirmar.usuarios > 0 && (
                <Button variant="secondary" onClick={() => { navigate(`/accesos/usuarios?perfil=${confirmar.id}`); }}>
                  Ver usuarios asignados
                </Button>
              )}
              <Button variant="secondary" onClick={() => setConfirmar(null)}>Cancelar</Button>
              <Button variant="danger" onClick={() => { desactivarPerfil(confirmar.id); setConfirmar(null); }}>Desactivar</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
```

- [ ] **Step 2: Verificar build** — Run: `npm run build`. Expected: éxito.
- [ ] **Step 3: Commit**

```bash
git add src/pages/accesos/Perfiles.jsx
git commit -m "feat(accesos): ACC-03 catálogo de perfiles"
```

---

### Task 6: ACC-04 · Constructor de perfil

**Files:**
- Modify: `src/pages/accesos/PerfilEditor.jsx` (reemplazo completo)

**Interfaces:**
- Consumes: `db.perfiles`, `db.perfilVersiones`, `guardarPerfil(perfil)` (Task 3); `MODULOS`, `NIVELES`, `CASILLAS` (Task 1). Ruta `:id` = id de perfil o `nuevo` (con `?desde=<id>` para duplicar).
- Produces: objeto `{ id, nombre, descripcion, esSuperadmin, verRemuneracion, verDocumentosTerceros, exportarDatosPersonales, matriz }` pasado a `guardarPerfil`.

- [ ] **Step 1: Implementar.** Reglas de la spec que el código debe cumplir (verificar una a una antes del commit):
  1. Nombre único: bloquear guardado si `db.perfiles.some(p => mismo nombre trim/lowercase && p.id !== idActual)` → `Note tone="alerta"` y botón deshabilitado.
  2. Toggle superadmin **colapsa la matriz** (no se renderiza; se guarda `matriz: {}`) y muestra nota explicativa. Al guardar con marca activada exige `window.confirm` NO — usar un `Modal` de confirmación explícita propia ("segunda pantalla") antes de persistir.
  3. Desplegable por módulo: 4 opciones si `m.aprobacion`, 3 si no (`NIVELES.slice(0, m.aprobacion ? 4 : 3)`).
  4. Acción rápida "Aplicar a todos": un `Select` que setea el mismo nivel en los 11 módulos (respetando el tope 2 en módulos sin aprobación cuando se aplica nivel 3).
  5. Panel lateral `ResumenNatural` (requisito, no adorno): frases generadas de `MODULOS` + `CASILLAS`; para superadmin, la frase fija de la spec.
  6. Matriz con todos en "Sin acceso": se permite guardar CON advertencia (`Note tone="pend"`: "sirve como base para duplicar").
  7. Guardar un perfil en uso (`usuarios > 0` y hay diffs): `Modal` previo que lista cuántos usuarios se ven afectados y qué permisos ganan o pierden (diff módulo a módulo: `anterior → nuevo`, y casillas ±) antes de confirmar.
  8. Advertencia (no bloqueo) si la edición deja un módulo sin ningún OTRO perfil activo con nivel 3 (cálculo sobre `db.perfiles`). Excepción: el módulo `accesos` — el invariante del superadministrador lo garantiza el servidor.
  9. Historial de versiones: `Modal` que lista `db.perfilVersiones.filter(v => v.perfilId === id)` con versión, autor, fecha y resumen de matriz.
  10. `id` (slug) para perfiles nuevos: derivar del nombre (`normalize("NFD")`, quitar diacríticos, `[^a-z0-9]+ → "-"`).
  11. Duplicar (`?desde=`): precargar matriz/casillas/descripcion del perfil base con nombre `"<base> (copia)"`.
  12. Botones: Guardar versión · Duplicar · Ver historial · Cancelar (→ `/accesos/perfiles`).

Estructura del componente (layout `grid grid-cols-[1fr_340px] gap-5`, panel derecho `Card` con resumen + historial):

```jsx
import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Save, Copy, History, ShieldCheck, X } from "lucide-react";
import { useApp } from "../../state";
import { PageHeader, Card, Button, Field, Input, Textarea, Select, Badge, Modal, Note, Table, Td } from "../../components/ui";
import { MODULOS, NIVELES, CASILLAS } from "../../data/modulos";

const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function ResumenNatural({ superadmin, matriz, casillas }) {
  if (superadmin) {
    return (
      <Note tone="pend">
        Quien tenga este perfil opera sobre <b>todo el grupo, en todos los módulos</b>, ignora la matriz y el
        alcance, y es el único que puede crear otros superadministradores.
      </Note>
    );
  }
  const frases = [];
  MODULOS.forEach((m) => {
    const n = matriz[m.id] ?? 0;
    if (n === 1) frases.push(`En ${m.nombre} solo puede ${m.ver}.`);
    if (n >= 2) frases.push(`En ${m.nombre} puede ${m.ver}, y también ${m.accionar}${n === 3 ? `; además puede ${m.aprobar}` : ""}.`);
  });
  CASILLAS.forEach((c) => { if (casillas[c.id]) frases.push(`${c.nombre}: ${c.detalle.toLowerCase()}.`); });
  if (!frases.length) return <Note tone="neutral">Este perfil no concede ningún acceso. Solo sirve como base para duplicar.</Note>;
  return (
    <ul className="space-y-2 text-[12.5px] leading-relaxed text-gris">
      {frases.map((f, i) => (<li key={i} className="border-l-2 border-borde pl-2.5">{f}</li>))}
    </ul>
  );
}
```

Cuerpo principal: estado local `nombre, descripcion, superadmin, matriz, casillas`; derivados `nombreRepetido`, `todoSinAcceso`, `cambios` (diff vs versión vigente), `modulosSinAprobador`; flujo de guardado `guardar() → (superadmin nuevo? confirmarSuperadmin) → (afectados>0? confirmarCambios) → persistir()` donde `persistir()` llama `guardarPerfil({...})` y `navigate("/accesos/perfiles")`. La matriz se edita en una `Table` con una fila por módulo: nombre + descripción corta (`m.ver`), y un `Select` con `NIVELES.slice(0, m.aprobacion ? 4 : 3)`.

- [ ] **Step 2: Verificar build** — Run: `npm run build`. Expected: éxito. Verificación manual: crear un perfil de prueba, duplicar Jefatura, editar RRHH operativo y comprobar el modal de afectados.
- [ ] **Step 3: Commit**

```bash
git add src/pages/accesos/PerfilEditor.jsx
git commit -m "feat(accesos): ACC-04 constructor de perfil con versionado y resumen natural"
```

---

### Task 7: ACC-01 + ACC-02 · Usuarios administrativos

**Files:**
- Modify: `src/pages/accesos/Usuarios.jsx` (reemplazo completo; ACC-02 es un `Modal wide` dentro del mismo archivo, patrón de `Personal.jsx`)

**Interfaces:**
- Consumes: `db.usuariosAdmin`, `db.perfiles`, `db.personal`, `db.empresas`, `db.sedes`, acciones `crearUsuarioAdmin`, `actualizarUsuarioAdmin`, `suspenderUsuarioAdmin`, `reactivarUsuarioAdmin`, `reenviarClave` (Task 3). Query param `?perfil=<id>` preselecciona el filtro de perfil (enlace desde ACC-03).
- Produces: —

- [ ] **Step 1: Implementar ACC-01 (listado).** Reglas de la spec:
  - Indicadores `Stat`: usuarios activos, suspendidos, **superadministradores** (tono `pend` — permanentemente visible), nunca ingresaron.
  - Filtros: perfil (`db.perfiles`), razón social, estado (Activos por defecto / Suspendidos / Todos — los suspendidos no desaparecen nunca), y buscador por DNI, nombre o correo.
  - Tabla: DNI, nombre (+ Badge superadmin con `ShieldCheck`), perfil, alcance en la propia fila (cortos de empresas o "Todo el grupo" si superadmin; sedes: nombres o "Todas las sedes"), último ingreso, estado.
  - Usuario que nunca ingresó: Badge `pend` "Nunca ingresó" + acción "Reenviar clave".
  - Inconsistencia (vínculo cesado + usuario activo): Badge `alerta` "Vínculo cesado" — se marca, no se suspende sola.
  - Acciones por fila: Editar · Suspender/Reactivar · Reenviar clave. **Suspender se bloquea** (botón disabled + title explicativo) si el usuario es el último superadministrador activo: `esSuperadmin && estado==="activo" && count(activos superadmin)===1`.
  - Reenviar clave: genera `clave = Math.random().toString(36).slice(2, 10).toUpperCase()`, llama `reenviarClave(id, clave)` y muestra Modal con la clave (si el usuario no tiene correo, indicar entrega presencial registrada).
  - Exportar: CSV cliente de las filas filtradas (BOM + `;` como separador, descarga vía Blob).

- [ ] **Step 2: Implementar ACC-02 (Modal wide `FormUsuario`).** Reglas:
  - Alta: buscador de persona sobre `db.personal` por DNI o nombre (lista de máx. 6 coincidencias, click selecciona). NO se crean personas desde aquí (nota al pie).
  - Persona seleccionada → datos derivados solo lectura: nombre, cargo, sede, empresa, estado del vínculo; si `estado==="cesado"` → `Note tone="alerta"`.
  - Si la persona ya tiene usuario (`db.usuariosAdmin.some(u => u.dni === dni)`) → `Note` que lo indica con botón "Editar ese usuario" (cambia el modal a modo edición).
  - Correo y celular editables.
  - Perfil: `Select` de `db.perfiles.filter(p => p.estado === "activo")`; al elegirlo se muestra su matriz resuelta en solo lectura (reutilizar el resumen: lista compacta módulo→nivel con `Badge`) — asignar sin ver qué concede es la vía al error.
  - Alcance: checkboxes de empresas (obligatorio salvo perfil superadmin) y checkboxes de sedes filtradas por las empresas marcadas; vacío = "todas las sedes de esas razones sociales" (hint del Field). Si el perfil elegido `esSuperadmin`: alcance deshabilitado con texto "Todo el grupo".
  - Guardar alta: genera clave provisional (`Math.random().toString(36).slice(2, 10).toUpperCase()`), llama `crearUsuarioAdmin({ dni, nombre, perfil, perfilNombre, esSuperadmin, correo, celular, empresas, sedes, clave, cargo, sede, empresa })`; si NO hay correo → Modal posterior mostrando la clave en pantalla para entrega presencial (queda registrado que se entregó así). Botones: Guardar · Guardar y crear otro (resetea el form sin cerrar) · Cancelar.
  - Asignar perfil superadmin exige confirmación explícita en un segundo Modal antes de guardar.
  - Editar: mismos campos con estado (Activo/Suspendido); quitar el perfil superadmin a un usuario también pasa por confirmación. (La regla "no quitarse a uno mismo la marca" se garantiza en el servidor — el login demo aún no vincula sesión con usuario administrativo; dejar comentario.)
  - Validaciones de guardado: persona elegida, perfil elegido, empresas ≥ 1 salvo superadmin.

- [ ] **Step 3: Verificar build** — Run: `npm run build`. Expected: éxito. Manual: alta de un usuario con y sin correo, filtro `?perfil=supervisor-sede` desde ACC-03, intento de suspender al único superadmin (bloqueado).
- [ ] **Step 4: Commit**

```bash
git add src/pages/accesos/Usuarios.jsx
git commit -m "feat(accesos): ACC-01/ACC-02 usuarios administrativos con alta, alcance y claves"
```

---

### Task 8: ACC-05 · Política de acceso

**Files:**
- Modify: `src/pages/accesos/Politica.jsx` (reemplazo completo)

**Interfaces:**
- Consumes: `db.politica[0]`, `guardarPolitica(p)` (Task 3).
- Produces: —

- [ ] **Step 1: Implementar.** Formulario en `Card` con grid de 2 columnas y los 9 campos de la spec, copiado a estado local al montar (`useState(() => ({ ...db.politica[0] }))`):
  - Sesión BackOffice (horas, `Input type="number" min=1`), Sesión Portal (días), toggles independientes de multisesión por superficie (checkbox), intentos fallidos antes de bloqueo, duración del bloqueo (minutos), método de recuperación por defecto (`Select`: WhatsApp / SMS / Restablecimiento manual por RRHH — los tres coexisten, aquí se define cuál se ofrece primero: hint), longitud mínima de clave, vigencia de clave provisional (días).
  - `RECOMENDADOS = { sesionBackofficeHoras: 8, sesionPortalDias: 30, multisesionBackoffice: false, multisesionPortal: true, intentosBloqueo: 5, bloqueoMinutos: 15, recuperacionDefecto: "whatsapp", claveLongitudMin: 8, claveProvisionalDias: 7 }` — botón "Restaurar valores recomendados" (variant secondary).
  - `Note tone="neutral"` con las tres reglas de negocio: políticas de sesión independientes por superficie (y por qué), todo cambio queda en auditoría con valor anterior y nuevo, y reducir la duración no cierra sesiones abiertas (el corte inmediato es una suspensión de usuario, no un cambio de política).
  - Pie: "Última actualización: {actualizado} · {actualizadoPor}" si existe. Guardar → `guardarPolitica(estado)`.

- [ ] **Step 2: Verificar build** — Run: `npm run build`. Expected: éxito.
- [ ] **Step 3: Commit**

```bash
git add src/pages/accesos/Politica.jsx
git commit -m "feat(accesos): ACC-05 política de acceso"
```

---

### Task 9: ACC-06 · Registro de accesos

**Files:**
- Modify: `src/pages/accesos/RegistroAccesos.jsx` (reemplazo completo)

**Interfaces:**
- Consumes: `db.registroAccesos`, `db.usuariosAdmin`, `db.empresas` (Task 3).
- Produces: —

- [ ] **Step 1: Implementar.** Reglas de la spec:
  - Filtros: rango de fechas (2 `Input type="date"` sobre `fecha.slice(0,10)`), texto de usuario, resultado (exitoso/fallido/bloqueado), superficie (portal/backoffice), razón social.
  - Indicadores `Stat`: ingresos del periodo (exitosos filtrados), intentos fallidos, cuentas bloqueadas, usuarios que nunca ingresaron (`db.usuariosAdmin.filter(u => u.nuncaIngreso).length`).
  - Tabla: fecha y hora del servidor, usuario, **perfil vigente en ese momento** (no el actual — la columna ya viene resuelta del mock/vista), superficie (Badge neutral portal / tinta backoffice), resultado (Badge conf/pend/alerta), IP, dispositivo.
  - Solo lectura sin excepción: sin botones de edición; `Note tone="neutral"`: "Registro de solo lectura para todos los roles, incluido el superadministrador. Es un corte especializado del registro general de auditoría; ambos leen la misma fuente." 
  - Exportar CSV de filas filtradas (mismo helper del Task 7 — duplicarlo localmente, son 8 líneas).

- [ ] **Step 2: Verificar build** — Run: `npm run build`. Expected: éxito.
- [ ] **Step 3: Commit**

```bash
git add src/pages/accesos/RegistroAccesos.jsx
git commit -m "feat(accesos): ACC-06 registro de accesos"
```

---

### Task 10: Supabase — esquema, invariantes, vistas, RPCs y seed

**Files:**
- Create: `supabase/accesos.sql` (idempotente, mismo estilo de `schema.sql`)
- Create: `scripts/aplicar-sql.mjs` (si no existe un runner previo en el repo)

**Interfaces:**
- Consumes: tablas existentes `personas`, `empresas`, `sedes`, `vinculos`, funciones `fn_bloquear_cambios`, `fn_auditar` (de `schema.sql`).
- Produces: tablas `perfiles`, `perfil_permisos`, `usuarios_admin`, `usuario_alcance_empresa`, `usuario_alcance_sede`, `politica_acceso`, `registro_accesos`; vistas `v_perfiles`, `v_perfil_versiones`, `v_usuarios_admin`, `v_politica_acceso`, `v_registro_accesos`; RPCs `guardar_perfil`, `desactivar_perfil`, `crear_usuario_admin`, `actualizar_usuario_admin`, `suspender_usuario_admin`, `reactivar_usuario_admin`, `reenviar_clave`, `guardar_politica`, `puede` — firmas EXACTAS a los `rpc(...)` de Task 3.

- [ ] **Step 1: Escribir `supabase/accesos.sql`** con este contenido (completo):

```sql
-- ============================================================================
-- MÓDULO DE ACCESOS Y ROLES (ACC-01…ACC-06) — complemento del esquema v2
-- · El Perfil dice QUÉ puede hacer alguien; el Alcance (en el usuario) dice
--   SOBRE QUIÉNES. El alcance solo restringe, nunca amplía.
-- · El perfil se VERSIONA: cada guardado inserta una versión nueva; la
--   auditoría referencia la versión vigente al momento de cada acción.
-- · Superadministrador es una MARCA, no un nivel: sin matriz, sin alcance.
-- · Invariantes garantizados por el esquema, no por la interfaz.
-- Si schema.sql se vuelve a aplicar (reset), este archivo debe re-aplicarse.
-- ============================================================================

drop view if exists v_perfiles, v_perfil_versiones, v_usuarios_admin,
  v_politica_acceso, v_registro_accesos cascade;
drop table if exists registro_accesos, usuario_alcance_sede,
  usuario_alcance_empresa, usuarios_admin, politica_acceso,
  perfil_permisos, perfiles cascade;
drop function if exists guardar_perfil, desactivar_perfil, crear_usuario_admin,
  actualizar_usuario_admin, suspender_usuario_admin, reactivar_usuario_admin,
  reenviar_clave, guardar_politica, puede,
  fn_perfil_nombre_unico, fn_superadmin_sin_matriz,
  fn_proteger_ultimo_superadmin cascade;

-- ---------------------------------------------------------------------------
-- PERFILES (versionados: PK id+version; cada guardado inserta, nunca modifica)
-- ---------------------------------------------------------------------------
create table perfiles (
  id          text not null,
  version     integer not null default 1 check (version >= 1),
  nombre      text not null,
  descripcion text,
  es_superadmin             boolean not null default false,
  ver_remuneracion          boolean not null default false,
  ver_documentos_terceros   boolean not null default false,
  exportar_datos_personales boolean not null default false,
  estado      text not null default 'activo' check (estado in ('activo','desactivado')),
  creado_por  text not null,
  creado_en   timestamptz not null default now(),
  primary key (id, version)
);

-- Nombre único en el sistema (entre perfiles distintos; las versiones de un
-- mismo perfil sí comparten nombre).
create function fn_perfil_nombre_unico() returns trigger language plpgsql as $$
begin
  if exists (select 1 from perfiles where lower(nombre) = lower(new.nombre) and id <> new.id) then
    raise exception 'Ya existe otro perfil con el nombre «%».', new.nombre;
  end if;
  return new;
end $$;
create trigger trg_perfil_nombre_unico before insert or update on perfiles
  for each row execute function fn_perfil_nombre_unico();

create table perfil_permisos (
  perfil_id      text not null,
  perfil_version integer not null,
  modulo         text not null check (modulo in
    ('personal','boletas','acuses','comunicados','memorandums','contratos',
     'tardanzas','activos','accesos','auditoria','configuracion')),
  nivel          integer not null check (nivel between 0 and 3),
  primary key (perfil_id, perfil_version, modulo),
  foreign key (perfil_id, perfil_version) references perfiles (id, version),
  -- El nivel 3 solo existe donde hay algo que aprobar.
  constraint nivel_3_solo_con_aprobacion check (
    nivel < 3 or modulo in ('personal','boletas','comunicados','memorandums',
                            'contratos','activos','accesos','configuracion'))
);

-- Invariante: un perfil superadmin NO lleva matriz (nadie debe leerla nunca).
create function fn_superadmin_sin_matriz() returns trigger language plpgsql as $$
begin
  if exists (select 1 from perfiles p
             where p.id = new.perfil_id and p.version = new.perfil_version
               and p.es_superadmin) then
    raise exception 'Un perfil con marca de superadministrador no lleva matriz.';
  end if;
  return new;
end $$;
create trigger trg_superadmin_sin_matriz before insert on perfil_permisos
  for each row execute function fn_superadmin_sin_matriz();

-- ---------------------------------------------------------------------------
-- USUARIOS ADMINISTRATIVOS (toda acción lleva el nombre de una Persona)
-- ---------------------------------------------------------------------------
create table usuarios_admin (
  id             bigint generated always as identity primary key,
  persona_dni    text not null unique references personas(dni),
  perfil_id      text not null,
  perfil_version integer not null,
  correo         text,
  celular        text check (celular is null or celular ~ '^[0-9]{9}$'),
  estado         text not null default 'activo' check (estado in ('activo','suspendido')),
  clave_provisional text,
  clave_entregada   text check (clave_entregada in ('correo','pantalla')),
  ultimo_ingreso timestamptz,
  creado_por     text not null,
  creado_en      timestamptz not null default now(),
  foreign key (perfil_id, perfil_version) references perfiles (id, version)
);

create table usuario_alcance_empresa (
  usuario_id bigint not null references usuarios_admin(id) on delete cascade,
  empresa_id text not null references empresas(id),
  primary key (usuario_id, empresa_id)
);

-- Sin filas aquí = todas las sedes de las empresas del alcance.
create table usuario_alcance_sede (
  usuario_id bigint not null references usuarios_admin(id) on delete cascade,
  sede_id    text not null references sedes(id),
  primary key (usuario_id, sede_id)
);

-- Invariante: siempre queda al menos un superadministrador activo.
create function fn_proteger_ultimo_superadmin() returns trigger language plpgsql as $$
declare era_super boolean; sigue_super boolean;
begin
  select p.es_superadmin into era_super from perfiles p
  where p.id = old.perfil_id and p.version = old.perfil_version;
  if not coalesce(era_super, false) or old.estado <> 'activo' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    sigue_super := false;
  else
    select p.es_superadmin and new.estado = 'activo' into sigue_super from perfiles p
    where p.id = new.perfil_id and p.version = new.perfil_version;
  end if;
  if not coalesce(sigue_super, false) and not exists (
    select 1 from usuarios_admin u
    join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
    where u.estado = 'activo' and p.es_superadmin and u.id <> old.id
  ) then
    raise exception 'Debe quedar al menos un superadministrador activo.';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_ultimo_superadmin before update or delete on usuarios_admin
  for each row execute function fn_proteger_ultimo_superadmin();

-- ---------------------------------------------------------------------------
-- POLÍTICA DE ACCESO (fila única para toda la instalación)
-- ---------------------------------------------------------------------------
create table politica_acceso (
  id int primary key default 1 check (id = 1),
  sesion_backoffice_horas int not null default 8  check (sesion_backoffice_horas > 0),
  sesion_portal_dias      int not null default 30 check (sesion_portal_dias > 0),
  multisesion_backoffice  boolean not null default false,
  multisesion_portal      boolean not null default true,
  intentos_bloqueo        int not null default 5  check (intentos_bloqueo > 0),
  bloqueo_minutos         int not null default 15 check (bloqueo_minutos > 0),
  recuperacion_defecto    text not null default 'whatsapp'
    check (recuperacion_defecto in ('whatsapp','sms','manual')),
  clave_longitud_min      int not null default 8 check (clave_longitud_min >= 6),
  clave_provisional_dias  int not null default 7 check (clave_provisional_dias > 0),
  actualizado_por text,
  actualizado_en  timestamptz
);
insert into politica_acceso (id) values (1);

-- ---------------------------------------------------------------------------
-- REGISTRO DE ACCESOS (inmutable; corte especializado de la auditoría)
-- ---------------------------------------------------------------------------
create table registro_accesos (
  id             bigint generated always as identity primary key,
  usuario_id     bigint references usuarios_admin(id),
  dni            text,                                -- ingreso por Portal (trabajador)
  perfil_id      text,
  perfil_version integer,                             -- perfil VIGENTE en ese momento
  superficie     text not null check (superficie in ('portal','backoffice')),
  resultado      text not null check (resultado in ('exitoso','fallido','bloqueado')),
  fecha          timestamptz not null default now(),  -- reloj del SERVIDOR
  ip             text,
  dispositivo    text
);
create trigger trg_registro_accesos_inmutable
  before update or delete on registro_accesos
  for each row execute function fn_bloquear_cambios();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Cada guardado crea una versión nueva; las anteriores no se tocan. Los
-- usuarios asignados pasan a la versión nueva (el cambio surte efecto en su
-- siguiente petición, no en su siguiente ingreso).
create function guardar_perfil(
  p_id text, p_nombre text, p_descripcion text, p_superadmin boolean,
  p_ver_remuneracion boolean, p_ver_documentos boolean, p_exportar boolean,
  p_matriz jsonb, p_por text
) returns integer language plpgsql security definer as $$
declare v_version int; v_mod text; v_nivel text;
begin
  select coalesce(max(version), 0) + 1 into v_version from perfiles where id = p_id;
  insert into perfiles (id, version, nombre, descripcion, es_superadmin,
                        ver_remuneracion, ver_documentos_terceros,
                        exportar_datos_personales, creado_por)
  values (p_id, v_version, p_nombre, p_descripcion, p_superadmin,
          p_ver_remuneracion, p_ver_documentos, p_exportar, p_por);
  if not p_superadmin then
    for v_mod, v_nivel in select key, value from jsonb_each_text(coalesce(p_matriz, '{}'::jsonb))
    loop
      insert into perfil_permisos (perfil_id, perfil_version, modulo, nivel)
      values (p_id, v_version, v_mod, v_nivel::int);
    end loop;
  end if;
  update usuarios_admin set perfil_version = v_version where perfil_id = p_id;
  return v_version;
end $$;

-- Un perfil con usuarios no se elimina: se desactiva (todas sus versiones).
create function desactivar_perfil(p_id text) returns void
language plpgsql security definer as $$
begin
  update perfiles set estado = 'desactivado' where id = p_id;
end $$;

create function crear_usuario_admin(
  p_dni text, p_perfil text, p_correo text, p_celular text,
  p_empresas text[], p_sedes text[], p_clave text, p_por text
) returns bigint language plpgsql security definer as $$
declare v_id bigint; v_version int; v_super boolean; e text; s text;
begin
  if not exists (select 1 from personas where dni = p_dni) then
    raise exception 'La persona % no existe en el maestro de Personal.', p_dni;
  end if;
  select version, es_superadmin into v_version, v_super
  from perfiles where id = p_perfil and estado = 'activo'
  order by version desc limit 1;
  if v_version is null then
    raise exception 'El perfil % no existe o está desactivado.', p_perfil;
  end if;
  if not v_super and (p_empresas is null or cardinality(p_empresas) = 0) then
    raise exception 'El alcance de razones sociales es obligatorio.';
  end if;
  insert into usuarios_admin (persona_dni, perfil_id, perfil_version, correo,
                              celular, clave_provisional, clave_entregada, creado_por)
  values (p_dni, p_perfil, v_version, p_correo, p_celular, p_clave,
          case when p_correo is null then 'pantalla' else 'correo' end, p_por)
  returning id into v_id;
  if not v_super then
    foreach e in array p_empresas loop
      insert into usuario_alcance_empresa (usuario_id, empresa_id) values (v_id, e);
    end loop;
    foreach s in array coalesce(p_sedes, '{}') loop
      insert into usuario_alcance_sede (usuario_id, sede_id) values (v_id, s);
    end loop;
  end if;
  return v_id;
end $$;

create function actualizar_usuario_admin(
  p_id bigint, p_perfil text, p_correo text, p_celular text,
  p_empresas text[], p_sedes text[], p_estado text
) returns void language plpgsql security definer as $$
declare v_version int; v_super boolean; e text; s text;
begin
  select version, es_superadmin into v_version, v_super
  from perfiles where id = p_perfil and estado = 'activo'
  order by version desc limit 1;
  if v_version is null then
    raise exception 'El perfil % no existe o está desactivado.', p_perfil;
  end if;
  if not v_super and (p_empresas is null or cardinality(p_empresas) = 0) then
    raise exception 'El alcance de razones sociales es obligatorio.';
  end if;
  update usuarios_admin
  set perfil_id = p_perfil, perfil_version = v_version, correo = p_correo,
      celular = p_celular, estado = coalesce(p_estado, estado)
  where id = p_id;
  delete from usuario_alcance_empresa where usuario_id = p_id;
  delete from usuario_alcance_sede where usuario_id = p_id;
  if not v_super then
    foreach e in array p_empresas loop
      insert into usuario_alcance_empresa (usuario_id, empresa_id) values (p_id, e);
    end loop;
    foreach s in array coalesce(p_sedes, '{}') loop
      insert into usuario_alcance_sede (usuario_id, sede_id) values (p_id, s);
    end loop;
  end if;
end $$;

-- Suspender corta el acceso de inmediato; no borra ni anonimiza nada.
create function suspender_usuario_admin(p_id bigint) returns void
language plpgsql security definer as $$
begin
  update usuarios_admin set estado = 'suspendido' where id = p_id;
end $$;

create function reactivar_usuario_admin(p_id bigint) returns void
language plpgsql security definer as $$
begin
  update usuarios_admin set estado = 'activo' where id = p_id;
end $$;

create function reenviar_clave(p_id bigint, p_clave text) returns void
language plpgsql security definer as $$
begin
  update usuarios_admin
  set clave_provisional = p_clave,
      clave_entregada = case when correo is null then 'pantalla' else 'correo' end
  where id = p_id;
end $$;

create function guardar_politica(
  p_backoffice_horas int, p_portal_dias int,
  p_multisesion_backoffice boolean, p_multisesion_portal boolean,
  p_intentos int, p_bloqueo_min int, p_recuperacion text,
  p_clave_min int, p_provisional_dias int, p_por text
) returns void language plpgsql security definer as $$
begin
  update politica_acceso
  set sesion_backoffice_horas = p_backoffice_horas,
      sesion_portal_dias      = p_portal_dias,
      multisesion_backoffice  = p_multisesion_backoffice,
      multisesion_portal      = p_multisesion_portal,
      intentos_bloqueo        = p_intentos,
      bloqueo_minutos         = p_bloqueo_min,
      recuperacion_defecto    = p_recuperacion,
      clave_longitud_min      = p_clave_min,
      clave_provisional_dias  = p_provisional_dias,
      actualizado_por         = p_por,
      actualizado_en          = now()
  where id = 1;
end $$;

-- LA regla de evaluación (una sola, aplica en todas partes). Se deja lista
-- para conectarse a Supabase Auth + RLS; el alcance debe aplicarse como
-- filtro de fila (resultado vacío), no como error de permiso.
create function puede(
  p_usuario bigint, p_modulo text, p_nivel int,
  p_empresa text default null, p_sede text default null
) returns boolean language plpgsql stable security definer as $$
declare v_estado text; v_pid text; v_pver int; v_super boolean; v_nivel int;
begin
  select u.estado, u.perfil_id, u.perfil_version, p.es_superadmin
  into v_estado, v_pid, v_pver, v_super
  from usuarios_admin u
  join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
  where u.id = p_usuario;
  if v_estado is null or v_estado <> 'activo' then return false; end if;
  if v_super then return true; end if;
  select nivel into v_nivel from perfil_permisos
  where perfil_id = v_pid and perfil_version = v_pver and modulo = p_modulo;
  if coalesce(v_nivel, 0) < p_nivel then return false; end if;
  if p_empresa is not null and not exists (
    select 1 from usuario_alcance_empresa a
    where a.usuario_id = p_usuario and a.empresa_id = p_empresa) then
    return false;
  end if;
  if p_sede is not null
     and exists (select 1 from usuario_alcance_sede where usuario_id = p_usuario)
     and not exists (select 1 from usuario_alcance_sede a
                     where a.usuario_id = p_usuario and a.sede_id = p_sede) then
    return false;
  end if;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- SEED — Anexo A (plantillas sugeridas) + usuarios iniciales
-- ---------------------------------------------------------------------------
select guardar_perfil('superadmin', 'Superadministrador',
  'Control total del grupo. La marca ignora la matriz y el alcance.',
  true, false, false, false, '{}'::jsonb, 'Sistema');
select guardar_perfil('rrhh-operativo', 'RRHH operativo',
  'Opera los módulos de RRHH del día a día, sin aprobaciones.',
  false, false, false, false,
  '{"personal":2,"boletas":2,"acuses":2,"comunicados":2,"memorandums":2,"contratos":2,"tardanzas":2,"activos":1,"accesos":0,"auditoria":0,"configuracion":1}'::jsonb,
  'Sistema');
select guardar_perfil('jefatura-rrhh', 'Jefatura de RRHH',
  'Opera y aprueba en los módulos de RRHH. Ve remuneración y exporta datos personales.',
  false, true, true, true,
  '{"personal":3,"boletas":3,"acuses":2,"comunicados":3,"memorandums":3,"contratos":3,"tardanzas":2,"activos":1,"accesos":0,"auditoria":0,"configuracion":1}'::jsonb,
  'Sistema');
select guardar_perfil('administracion', 'Administración',
  'Gestiona activos, equipos y EPP de todo el grupo.',
  false, false, false, false,
  '{"personal":1,"boletas":0,"acuses":0,"comunicados":0,"memorandums":0,"contratos":0,"tardanzas":0,"activos":3,"accesos":0,"auditoria":0,"configuracion":1}'::jsonb,
  'Sistema');
select guardar_perfil('supervisor-sede', 'Supervisor de sede',
  'Registra acuses asistidos y consulta su cuadrilla, sin ver el contenido de las boletas.',
  false, false, false, false,
  '{"personal":1,"boletas":0,"acuses":2,"comunicados":1,"memorandums":0,"contratos":0,"tardanzas":0,"activos":0,"accesos":0,"auditoria":0,"configuracion":0}'::jsonb,
  'Sistema');
select guardar_perfil('auditor', 'Auditor',
  'Solo lectura en los once módulos, con exportación de datos personales.',
  false, false, false, true,
  '{"personal":1,"boletas":1,"acuses":1,"comunicados":1,"memorandums":1,"contratos":1,"tardanzas":1,"activos":1,"accesos":1,"auditoria":1,"configuracion":1}'::jsonb,
  'Sistema');

-- Personas administrativas (Diego y Karina) + vínculos
insert into personas (dni, nombre, celular, banco, cuenta, portal) values
  ('40776655', 'Diego Salguero Tang', '999888777', 'BCP',       '191-55667788-0-01', 'activo'),
  ('40881122', 'Karina Prado Salas',  '988776655', 'Interbank', '898-3007788990',    'activo')
on conflict (dni) do nothing;
insert into vinculos (persona_dni, empresa_id, sede_id, cargo, fecha_inicio) values
  ('40776655', 'negliaf', 'sunat', 'Jefe de RRHH',   '2020-01-15'),
  ('40881122', 'negliaf', 'sunat', 'Analista RRHH',  '2021-04-01');

select crear_usuario_admin('40776655', 'superadmin', 'dsalguero@grupoer.pe', '999888777', null, null, null, 'Sistema');
select crear_usuario_admin('40881122', 'rrhh-operativo', 'kprado@grupoer.pe', '988776655',
  array['negliaf','bremco','promant','lamericana'], null, null, 'Sistema');
select crear_usuario_admin('40125634', 'supervisor-sede', null, '912345678',
  array['negliaf'], array['sunat','migraciones'], 'DEMO2026A', 'Sistema');
select crear_usuario_admin('43906712', 'supervisor-sede', 'ctorres@grupoer.pe', '934567812',
  array['negliaf'], array['minedu','ins'], 'DEMO2026B', 'Sistema');

update usuarios_admin set ultimo_ingreso = '2026-08-12 08:45-05' where persona_dni = '40776655';
update usuarios_admin set ultimo_ingreso = '2026-08-11 17:20-05' where persona_dni = '40881122';
update usuarios_admin set ultimo_ingreso = '2026-08-09 17:30-05' where persona_dni = '40125634';

insert into registro_accesos (usuario_id, dni, perfil_id, perfil_version, superficie, resultado, fecha, ip, dispositivo)
select u.id, u.persona_dni, u.perfil_id, u.perfil_version, t.superficie, t.resultado, t.fecha::timestamptz, t.ip, t.disp
from (values
  ('40776655', 'backoffice', 'exitoso', '2026-08-12 08:45-05', '200.48.12.5',  'Windows · Chrome'),
  ('40881122', 'backoffice', 'exitoso', '2026-08-11 17:20-05', '200.48.12.8',  'Windows · Edge'),
  ('40881122', 'backoffice', 'fallido', '2026-08-11 12:44-05', '200.48.12.8',  'Windows · Edge'),
  ('40125634', 'backoffice', 'exitoso', '2026-08-09 17:30-05', '181.65.44.2',  'Android 12 · Chrome Mobile')
) as t(dni, superficie, resultado, fecha, ip, disp)
join usuarios_admin u on u.persona_dni = t.dni;

-- Ingresos del Portal (trabajadores, sin usuario administrativo)
insert into registro_accesos (dni, superficie, resultado, fecha, ip, dispositivo) values
  ('45231876', 'portal', 'exitoso',   '2026-08-11 19:02-05', '181.65.212.44', 'Android 12 · Chrome Mobile'),
  ('47893456', 'portal', 'fallido',   '2026-08-10 21:15-05', '190.42.77.31',  'Android 10 · Chrome Mobile'),
  ('47893456', 'portal', 'bloqueado', '2026-08-10 21:18-05', '190.42.77.31',  'Android 10 · Chrome Mobile'),
  ('48012765', 'portal', 'exitoso',   '2026-08-09 07:58-05', '201.230.14.9',  'Android 13 · Chrome Mobile');

-- Auditoría sobre las tablas del módulo
do $$
declare t text;
begin
  foreach t in array array['perfiles','perfil_permisos','usuarios_admin',
    'usuario_alcance_empresa','usuario_alcance_sede','politica_acceso']
  loop
    execute format('create trigger trg_auditar_%s after insert or update or delete on %I
                    for each row execute function fn_auditar()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- VISTAS DE LECTURA
-- ---------------------------------------------------------------------------
create view v_perfiles as
select p.id, p.version, p.nombre, p.descripcion,
       p.es_superadmin as "esSuperadmin",
       p.ver_remuneracion as "verRemuneracion",
       p.ver_documentos_terceros as "verDocumentosTerceros",
       p.exportar_datos_personales as "exportarDatosPersonales",
       p.estado,
       coalesce((select jsonb_object_agg(pp.modulo, pp.nivel)
                 from perfil_permisos pp
                 where pp.perfil_id = p.id and pp.perfil_version = p.version), '{}'::jsonb) as matriz,
       (select count(*)::int from usuarios_admin u where u.perfil_id = p.id) as usuarios,
       to_char(p.creado_en, 'YYYY-MM-DD HH24:MI') as modificado,
       p.creado_por as "modificadoPor"
from perfiles p
where p.version = (select max(version) from perfiles p2 where p2.id = p.id)
order by p.es_superadmin desc, p.nombre;

create view v_perfil_versiones as
select p.id as "perfilId", p.version, p.nombre,
       p.es_superadmin as "esSuperadmin",
       coalesce((select jsonb_object_agg(pp.modulo, pp.nivel)
                 from perfil_permisos pp
                 where pp.perfil_id = p.id and pp.perfil_version = p.version), '{}'::jsonb) as matriz,
       to_char(p.creado_en, 'YYYY-MM-DD HH24:MI') as creado,
       p.creado_por as por
from perfiles p
order by p.id, p.version desc;

create view v_usuarios_admin as
select u.id, u.persona_dni as dni, pe.nombre,
       u.perfil_id as perfil, pf.nombre as "perfilNombre",
       pf.es_superadmin as "esSuperadmin",
       u.correo, u.celular, u.estado,
       coalesce((select jsonb_agg(a.empresa_id) from usuario_alcance_empresa a
                 where a.usuario_id = u.id), '[]'::jsonb) as empresas,
       coalesce((select jsonb_agg(a.sede_id) from usuario_alcance_sede a
                 where a.usuario_id = u.id), '[]'::jsonb) as sedes,
       to_char(u.ultimo_ingreso, 'YYYY-MM-DD HH24:MI') as "ultimoIngreso",
       (u.ultimo_ingreso is null) as "nuncaIngreso",
       (u.estado = 'activo' and not exists
         (select 1 from vinculos v where v.persona_dni = u.persona_dni and v.fecha_fin is null)) as inconsistencia,
       vi.cargo, vi.sede_id as sede, vi.empresa_id as empresa,
       to_char(u.creado_en, 'YYYY-MM-DD') as creado
from usuarios_admin u
join personas pe on pe.dni = u.persona_dni
join perfiles pf on pf.id = u.perfil_id and pf.version = u.perfil_version
left join vinculos vi on vi.persona_dni = u.persona_dni and vi.fecha_fin is null
order by pf.es_superadmin desc, pe.nombre;

create view v_politica_acceso as
select sesion_backoffice_horas as "sesionBackofficeHoras",
       sesion_portal_dias      as "sesionPortalDias",
       multisesion_backoffice  as "multisesionBackoffice",
       multisesion_portal      as "multisesionPortal",
       intentos_bloqueo        as "intentosBloqueo",
       bloqueo_minutos         as "bloqueoMinutos",
       recuperacion_defecto    as "recuperacionDefecto",
       clave_longitud_min      as "claveLongitudMin",
       clave_provisional_dias  as "claveProvisionalDias",
       to_char(actualizado_en, 'YYYY-MM-DD HH24:MI') as actualizado,
       actualizado_por as "actualizadoPor"
from politica_acceso where id = 1;

create view v_registro_accesos as
select r.id,
       to_char(r.fecha, 'YYYY-MM-DD HH24:MI') as fecha,
       coalesce(pe.nombre, r.dni, '—') as usuario,
       coalesce(pf.nombre, 'Portal del Trabajador') as perfil,   -- versión vigente AL MOMENTO
       r.superficie, r.resultado, r.ip, r.dispositivo,
       vi.empresa_id as empresa
from registro_accesos r
left join usuarios_admin u on u.id = r.usuario_id
left join personas pe on pe.dni = coalesce(u.persona_dni, r.dni)
left join perfiles pf on pf.id = r.perfil_id and pf.version = r.perfil_version
left join vinculos vi on vi.persona_dni = pe.dni and vi.fecha_fin is null
order by r.fecha desc;
```

- [ ] **Step 2: Aplicar contra el proyecto `mzpbdkrmokfxrrsotfgs`** vía Management API desde Node (patrón de la sesión anterior; el token de la CLI de Supabase está en la máquina — `supabase` CLI autenticada). Crear `scripts/aplicar-sql.mjs` que lea el archivo, lo envíe a `POST https://api.supabase.com/v1/projects/mzpbdkrmokfxrrsotfgs/database/query` con `Authorization: Bearer <token>` y muestre el resultado. Ejecutar: `node scripts/aplicar-sql.mjs supabase/accesos.sql`.

- [ ] **Step 3: Verificar (consultas vía el mismo runner):**
  - `select count(*) from v_perfiles;` → 6.
  - `select count(*) from v_usuarios_admin;` → 4; `select count(*) from v_usuarios_admin where "esSuperadmin";` → 1.
  - `select count(*) from v_registro_accesos;` → 8.
  - `select puede(2,'personal',2,'negliaf',null);` → true (Karina, RRHH operativo nivel 2). `select puede(3,'boletas',1,null,null);` → false (Supervisor sin boletas). `select puede(1,'configuracion',3,null,null);` → true (superadmin).
  - **Invariantes (deben FALLAR):** `update registro_accesos set ip='0.0.0.0' where id=1;` → error del trigger inmutable. `select suspender_usuario_admin(1);` → error "al menos un superadministrador activo". `insert into perfil_permisos values ('superadmin',1,'personal',2);` → error "no lleva matriz". `select guardar_perfil('otro','Superadministrador',null,false,false,false,false,'{}'::jsonb,'x');` → error nombre repetido.
  - `select guardar_perfil('rrhh-operativo','RRHH operativo','test versión',false,false,false,false,'{"personal":2}'::jsonb,'Verificación');` → devuelve 2; `select perfil_version from usuarios_admin where persona_dni='40881122';` → 2; luego revertir con otra llamada igual a la versión 1 original (queda v3 con la matriz completa — el historial conserva las tres).

- [ ] **Step 4: Commit**

```bash
git add supabase/accesos.sql scripts/aplicar-sql.mjs
git commit -m "feat(accesos): esquema Supabase con perfiles versionados, invariantes, RPCs y vistas"
```

---

### Task 11: Verificación E2E, documentación y deploy

**Files:**
- Modify: `supabase/MODELO.md` (sección nueva del módulo), memoria del proyecto
- Verify: producción

- [ ] **Step 1: E2E local contra Supabase** — `npm run dev`, abrir la app: header debe decir "Conectado a Supabase"; ACC-01 muestra los 4 usuarios del seed; ACC-03 los 6 perfiles; crear un perfil de prueba desde ACC-04 y verificar (runner SQL) que aparece en `perfiles` con `version=1` y en auditoría; desactivarlo; crear un usuario para una persona sin correo y verificar la clave en pantalla; editar la política y comprobar `actualizado_en` en la tabla y el registro en `auditoria`.
- [ ] **Step 2: Documentar en `supabase/MODELO.md`:** sección "Accesos y Roles" — perfiles versionados (id+version), alcance en el usuario (solo restringe), invariantes (último superadmin, superadmin sin matriz, registro inmutable, nombre único), la función `puede()` y la nota de que `schema.sql` + `accesos.sql` se aplican en ese orden en un reset.
- [ ] **Step 3: Push y deploy** — `git push` → Vercel despliega `intranet-general`. Verificar en `https://intranet-general.vercel.app` que el grupo "Accesos y Roles" aparece y ACC-01/03/05/06 cargan datos de Supabase.
- [ ] **Step 4: Actualizar memoria** — actualizar `proyecto-intranet-negliaf.md`: módulo Accesos y Roles (ACC-01…06) construido, ADM-03 liberado, pendiente conectar `puede()` cuando llegue Supabase Auth + RLS.

---

## Self-Review (ejecutada al escribir el plan)

- **Cobertura de la spec:** ACC-01→Task 7 · ACC-02→Task 7 · ACC-03→Task 5 · ACC-04→Task 6 · ACC-05→Task 8 · ACC-06→Task 9 · Modelo de datos→Task 10 · Evaluación del permiso→Task 10 (`puede()`, lista para Auth) · Anexo A→Tasks 2 y 10 · Niveles por módulo→Task 1. **Fuera de alcance declarado:** 2FA del superadmin (⚠ POR DEFINIR en la spec, depende del proveedor de mensajería del Motor 9); enforcement de permisos en la navegación del BackOffice (requiere Supabase Auth, paso futuro ya registrado); envío real de correo con la clave provisional (no hay proveedor de mensajería; la clave queda registrada y se muestra en pantalla).
- **Consistencia de tipos:** firmas de `rpc()` en Task 3 = firmas SQL en Task 10 (verificado parámetro a parámetro); formas de mock en Task 2 = alias de las vistas en Task 10 (camelCase con comillas dobles).
- **Placeholders:** los Tasks 6–9 describen componentes con reglas numeradas y fragmentos clave en lugar de JSX completo; cada regla referencia datos y acciones ya definidos con firma exacta en Tasks 1–3, y el patrón visual es el de `Personal.jsx`/`ui.jsx`. Ninguna regla queda como "TBD".
