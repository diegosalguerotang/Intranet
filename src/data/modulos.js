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
  { id: "soporte", nombre: "Soporte", aprobacion: true,
    ver: "consultar los tickets y su detalle",
    accionar: "registrar tickets, atenderlos y cambiar su estado",
    aprobar: "editar el catálogo de tipos y los avisos por correo" },
  { id: "solicitudes", nombre: "Solicitudes", aprobacion: true,
    ver: "consultar solicitudes dentro de su alcance y ver el tablero",
    accionar: "registrar solicitudes a nombre de un trabajador y observarlas",
    aprobar: "dar V°B°, rechazar y anular" },
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

// ---- Enforcement en la app (Accesos v2) ------------------------------------
// Nivel efectivo del usuario en un módulo (o el mayor de una lista de
// módulos). El superadmin siempre es 3; sin acceso cargado, 0.
export function nivelDe(acceso, modulo) {
  if (!acceso) return 0;
  if (acceso.esSuperadmin) return 3;
  const mods = Array.isArray(modulo) ? modulo : [modulo];
  return Math.max(0, ...mods.map((m) => acceso.matriz?.[m] ?? 0));
}

export const MODULOS_RRHH = ["personal", "boletas", "acuses", "comunicados", "memorandums", "contratos", "tardanzas"];

// Orden canónico de aterrizaje: la primera ruta con nivel >= 1 es el inicio.
export const RUTAS_ORDENADAS = [
  { ruta: "/accesos/usuarios", modulo: "accesos" },
  { ruta: "/rrhh", modulo: MODULOS_RRHH },
  { ruta: "/admin/activos", modulo: "activos" },
  { ruta: "/soporte/tickets", modulo: "soporte" },
  { ruta: "/solicitudes", modulo: "solicitudes" },
  { ruta: "/accesos/registro", modulo: "auditoria" },
];

export function primeraRuta(acceso) {
  if (acceso?.esSuperadmin) return "/rrhh";
  return RUTAS_ORDENADAS.find((r) => nivelDe(acceso, r.modulo) >= 1)?.ruta ?? null;
}

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
