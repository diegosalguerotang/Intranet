// Datos de ejemplo basados en los Casos de Referencia v1.0 del Grupo NEGLIAF.
// Todo es ficticio: sirve para construir y validar la interfaz mientras no existe backend.

export const EMPRESAS = [
  { id: "negliaf", nombre: "NEGLIAF S.R.L.", corto: "NEGLIAF", ruc: "20501234567", logo: "/logos/negliaf.jpeg", regimen: "Régimen general" },
  { id: "bremco", nombre: "BREMCO S.C.R.L.", corto: "BREMCO", ruc: "20512345678", logo: null, regimen: "Régimen general" },
  { id: "promant", nombre: "PROMANT SERVICIOS", corto: "PROMANT", ruc: "20523456789", logo: "/logos/promant.jpeg", regimen: "Pequeña empresa" },
  { id: "lamericana", nombre: "LIMPIEZA AMERICANA S.A.C.", corto: "L. AMERICANA", ruc: "20534567890", logo: "/logos/limpieza-americana.jpeg", regimen: "Régimen general" },
];

export const SEDES = [
  { id: "sunat", empresa: "negliaf", nombre: "SUNAT Lima — Sede Central", cliente: "SUNAT", supervisor: "Julio Mamani" },
  { id: "migraciones", empresa: "negliaf", nombre: "MIGRACIONES — Breña", cliente: "MIGRACIONES", supervisor: "Julio Mamani" },
  { id: "minedu", empresa: "negliaf", nombre: "MINEDU — San Borja", cliente: "MINEDU", supervisor: "Carmen Torres" },
  { id: "ins", empresa: "negliaf", nombre: "INS — Chorrillos", cliente: "INS", supervisor: "Carmen Torres" },
  { id: "essalud", empresa: "bremco", nombre: "ESSALUD — Jesús María", cliente: "ESSALUD", supervisor: "Pedro Rojas" },
  { id: "ucv", empresa: "promant", nombre: "UCV — Lima Norte", cliente: "UCV", supervisor: "Ana Silva" },
];

export const CARGOS = ["Operario de limpieza", "Supervisor de sede", "Técnico de mantenimiento", "Auxiliar de servicios", "Analista RRHH"];

export const PERSONAL = [
  { dni: "45231876", nombre: "Rosa Quispe Huamán", cargo: "Operario de limpieza", sede: "sunat", empresa: "negliaf", ingreso: "2023-03-01", celular: "987654321", portal: "activo", estado: "vigente", banco: "BCP", cuenta: "191-23456789-0-11" },
  { dni: "41887203", nombre: "Luis Zapata Condori", cargo: "Operario de limpieza", sede: "migraciones", empresa: "negliaf", ingreso: "2022-01-15", celular: null, portal: "sin_celular", estado: "vigente", banco: "BBVA", cuenta: "0011-0234-05678901" },
  { dni: "40125634", nombre: "Julio Mamani Apaza", cargo: "Supervisor de sede", sede: "migraciones", empresa: "negliaf", ingreso: "2021-06-01", celular: "912345678", portal: "activo", estado: "vigente", banco: "BCP", cuenta: "191-98765432-0-52" },
  { dni: "43906712", nombre: "Carmen Torres Vega", cargo: "Supervisor de sede", sede: "minedu", empresa: "negliaf", ingreso: "2022-09-01", celular: "934567812", portal: "activo", estado: "vigente", banco: "Interbank", cuenta: "898-3001234567" },
  { dni: "46782301", nombre: "María Fernández Ríos", cargo: "Operario de limpieza", sede: "sunat", empresa: "negliaf", ingreso: "2024-02-01", celular: "956781234", portal: "activo", estado: "vigente", banco: "BCP", cuenta: "191-45678912-0-33" },
  { dni: "42345987", nombre: "Jorge Huamán Ccopa", cargo: "Operario de limpieza", sede: "minedu", empresa: "negliaf", ingreso: "2023-07-15", celular: "978123456", portal: "nunca_ingreso", estado: "vigente", banco: "BBVA", cuenta: "0011-0456-07891234" },
  { dni: "44567120", nombre: "Elena Ccahua Mendoza", cargo: "Auxiliar de servicios", sede: "ins", empresa: "negliaf", ingreso: "2024-05-01", celular: "945612378", portal: "activo", estado: "vigente", banco: "BCP", cuenta: "191-78912345-0-44" },
  { dni: "47893456", nombre: "Miguel Paredes Luna", cargo: "Operario de limpieza", sede: "migraciones", empresa: "negliaf", ingreso: "2023-11-01", celular: "923456781", portal: "nunca_ingreso", estado: "vigente", banco: "Interbank", cuenta: "898-3009876543" },
  { dni: "41234509", nombre: "Sofía Chávez Ramos", cargo: "Operario de limpieza", sede: "sunat", empresa: "negliaf", ingreso: "2022-04-01", celular: "967812345", portal: "activo", estado: "vigente", banco: "BCP", cuenta: "191-32165498-0-21" },
  { dni: "40987654", nombre: "Raúl Gutiérrez Poma", cargo: "Técnico de mantenimiento", sede: "ins", empresa: "negliaf", ingreso: "2021-10-01", celular: "989123457", portal: "activo", estado: "vigente", banco: "BBVA", cuenta: "0011-0789-01234567" },
  { dni: "43678921", nombre: "Teresa Núñez Salas", cargo: "Operario de limpieza", sede: "minedu", empresa: "negliaf", ingreso: "2024-01-15", celular: null, portal: "sin_celular", estado: "vigente", banco: "BCP", cuenta: "191-65432187-0-19" },
  { dni: "45098234", nombre: "Pedro Rojas Medina", cargo: "Supervisor de sede", sede: "essalud", empresa: "bremco", ingreso: "2022-03-01", celular: "911223344", portal: "activo", estado: "vigente", banco: "BCP", cuenta: "191-11223344-0-55" },
  { dni: "46654387", nombre: "Ana Silva Cárdenas", cargo: "Supervisor de sede", sede: "ucv", empresa: "promant", ingreso: "2023-05-01", celular: "922334455", portal: "activo", estado: "vigente", banco: "Interbank", cuenta: "898-3005544332" },
  { dni: "48012765", nombre: "Víctor Salas Quiroz", cargo: "Operario de limpieza", sede: "essalud", empresa: "bremco", ingreso: "2024-06-01", celular: "933445566", portal: "activo", estado: "vigente", banco: "BBVA", cuenta: "0011-0987-06543210" },
  { dni: "39876120", nombre: "Gladys Ponce Aroni", cargo: "Operario de limpieza", sede: "sunat", empresa: "negliaf", ingreso: "2020-08-01", celular: "944556677", portal: "activo", estado: "cesado", cese: "2026-06-30", banco: "BCP", cuenta: "191-99887766-0-88" },
];

// Lote de boletas de julio 2026 (Caso 1)
export const LOTES = [
  {
    id: "BOL-NEG-202607-001", empresa: "negliaf", tipo: "Boleta de pago", periodo: "Julio 2026",
    publicado: "2026-08-01 09:14", por: "D. Salguero", total: 310, confirmados: 273, asistidos: 8, pendientes: 29, avisos: 299, version: 1,
  },
  {
    id: "BOL-NEG-202606-001", empresa: "negliaf", tipo: "Boleta de pago", periodo: "Junio 2026",
    publicado: "2026-07-02 10:02", por: "D. Salguero", total: 308, confirmados: 300, asistidos: 8, pendientes: 0, avisos: 296, version: 1,
  },
  {
    id: "GRA-NEG-202607-001", empresa: "negliaf", tipo: "Gratificación", periodo: "Julio 2026",
    publicado: "2026-07-14 16:40", por: "K. Prado", total: 305, confirmados: 298, asistidos: 7, pendientes: 0, avisos: 295, version: 1,
  },
];

export const ACUSES = [
  { dni: "45231876", doc: "Boleta de pago — Julio 2026", lote: "BOL-NEG-202607-001", estado: "confirmado", fecha: "2026-08-01 19:32", ip: "181.65.212.44", dispositivo: "Android 12 · Chrome Mobile", hash: "3f1a9c7e2b8d4a6f0c5e1b7a9d3f8c2e6a4b0d9f1c7e3a5b8d2f6c0e4a9b1d7f", modalidad: "personal", version: 1 },
  { dni: "46782301", doc: "Boleta de pago — Julio 2026", lote: "BOL-NEG-202607-001", estado: "confirmado", fecha: "2026-08-01 20:05", ip: "190.42.118.20", dispositivo: "Android 13 · Chrome Mobile", hash: "8c2e6a4b0d9f1c7e3a5b8d2f6c0e4a9b1d7f3f1a9c7e2b8d4a6f0c5e1b7a9d3f", modalidad: "personal", version: 1 },
  { dni: "41887203", doc: "Boleta de pago — Julio 2026", lote: "BOL-NEG-202607-001", estado: "asistido", fecha: "2026-08-04 12:15", ip: "—", dispositivo: "Registrado por J. Mamani (supervisor)", hash: "1d7f3f1a9c7e2b8d4a6f0c5e1b7a9d3f8c2e6a4b0d9f1c7e3a5b8d2f6c0e4a9b", modalidad: "asistido", supervisor: "Julio Mamani", motivo: "Sin celular", fechaEntrega: "2026-08-04 09:00", version: 1 },
  { dni: "41234509", doc: "Boleta de pago — Julio 2026", lote: "BOL-NEG-202607-001", estado: "confirmado", fecha: "2026-08-02 08:11", ip: "181.65.99.102", dispositivo: "Android 11 · Chrome Mobile", hash: "6c0e4a9b1d7f3f1a9c7e2b8d4a6f0c5e1b7a9d3f8c2e6a4b0d9f1c7e3a5b8d2f", modalidad: "personal", version: 1 },
  { dni: "42345987", doc: "Boleta de pago — Julio 2026", lote: "BOL-NEG-202607-001", estado: "nunca_ingreso", fecha: null, modalidad: null, version: 1 },
  { dni: "47893456", doc: "Boleta de pago — Julio 2026", lote: "BOL-NEG-202607-001", estado: "nunca_ingreso", fecha: null, modalidad: null, version: 1 },
  { dni: "43678921", doc: "Boleta de pago — Julio 2026", lote: "BOL-NEG-202607-001", estado: "pendiente", fecha: null, modalidad: null, version: 1 },
  { dni: "44567120", doc: "Boleta de pago — Julio 2026", lote: "BOL-NEG-202607-001", estado: "pendiente", fecha: null, modalidad: null, version: 1 },
  { dni: "40987654", doc: "Boleta de pago — Julio 2026", lote: "BOL-NEG-202607-001", estado: "confirmado", fecha: "2026-08-01 21:47", ip: "200.121.45.78", dispositivo: "iPhone · Safari", hash: "4a6f0c5e1b7a9d3f8c2e6a4b0d9f1c7e3a5b8d2f6c0e4a9b1d7f3f1a9c7e2b8d", modalidad: "personal", version: 1 },
  { dni: "43906712", doc: "Boleta de pago — Julio 2026", lote: "BOL-NEG-202607-001", estado: "confirmado", fecha: "2026-08-01 18:20", ip: "181.66.30.12", dispositivo: "Android 14 · Chrome Mobile", hash: "9d3f8c2e6a4b0d9f1c7e3a5b8d2f6c0e4a9b1d7f3f1a9c7e2b8d4a6f0c5e1b7a", modalidad: "personal", version: 1 },
  { dni: "40125634", doc: "Boleta de pago — Julio 2026", lote: "BOL-NEG-202607-001", estado: "confirmado", fecha: "2026-08-01 19:01", ip: "181.65.212.44", dispositivo: "Android 12 · Chrome Mobile", hash: "0d9f1c7e3a5b8d2f6c0e4a9b1d7f3f1a9c7e2b8d4a6f0c5e1b7a9d3f8c2e6a4b", modalidad: "personal", version: 1 },
];

export const COMUNICADOS = [
  { id: 1, titulo: "Simulacro nacional de sismo — 31 de julio", cuerpo: "El jueves 31 de julio a las 10:00 se realizará el simulacro nacional. Todo el personal debe participar siguiendo las rutas de evacuación de su sede.", publicado: "2026-07-25", vence: "2026-07-31", alcance: 312, leidos: 289, exigeAcuse: true, segmento: "Todo el grupo", estado: "vencido" },
  { id: 2, titulo: "Cambio de horario de ingreso — Sede SUNAT", cuerpo: "Desde el lunes 11 de agosto el ingreso en la sede SUNAT Lima será a las 6:30 a.m. por disposición del cliente. La tolerancia se mantiene en 10 minutos.", publicado: "2026-08-06", vence: "2026-08-20", alcance: 84, leidos: 61, exigeAcuse: true, segmento: "NEGLIAF · Sede SUNAT Lima", estado: "vigente" },
  { id: 3, titulo: "Entrega de uniformes de invierno", cuerpo: "La segunda entrega anual de uniformes se realizará del 18 al 22 de agosto en cada sede, coordinada por su supervisor.", publicado: "2026-08-08", vence: "2026-08-25", alcance: 312, leidos: 45, exigeAcuse: false, segmento: "Todo el grupo", estado: "vigente" },
];

export const MEMORANDUMS = [
  { id: "0142-2026", dni: "45231876", tipo: "Llamada de atención", motivo: "Tardanzas reiteradas — 2 tardanzas, 18 minutos en julio 2026", articulo: "Art. 12 RIT", emitido: "2026-08-05", notificado: "2026-08-05 18:40", plazoDias: 5, vence: "2026-08-12", estado: "descargo_presentado", descargo: { fecha: "2026-08-06 09:12", texto: "El día 14 de julio tuve una emergencia médica con mi hija menor, adjunto constancia del centro de salud. El día 22 el tren se detuvo por más de 20 minutos.", adjuntos: 1 }, resolucion: null },
  { id: "0141-2026", dni: "47893456", tipo: "Amonestación escrita", motivo: "Abandono de puesto el 28 de julio sin autorización del supervisor", articulo: "Art. 15 RIT", emitido: "2026-08-01", notificado: null, plazoDias: 5, vence: null, estado: "emitido_sin_notificar", descargo: null, resolucion: null },
  { id: "0140-2026", dni: "42345987", tipo: "Llamada de atención", motivo: "Tardanzas reiteradas — 3 tardanzas, 35 minutos en junio 2026", articulo: "Art. 12 RIT", emitido: "2026-07-10", notificado: "2026-07-11 08:30", plazoDias: 5, vence: "2026-07-18", estado: "resuelto", descargo: null, resolucion: { fecha: "2026-07-21", decision: "Se mantiene la sanción. El trabajador no presentó descargo dentro del plazo." } },
];

export const TARDANZAS = [
  { dni: "45231876", periodo: "Julio 2026", tardanzas: 2, minutos: 18, descuento: 12.5 },
  { dni: "42345987", periodo: "Julio 2026", tardanzas: 1, minutos: 8, descuento: 5.6 },
  { dni: "47893456", periodo: "Julio 2026", tardanzas: 4, minutos: 52, descuento: 36.1 },
  { dni: "46782301", periodo: "Julio 2026", tardanzas: 0, minutos: 0, descuento: 0 },
  { dni: "44567120", periodo: "Julio 2026", tardanzas: 1, minutos: 5, descuento: 3.5 },
  { dni: "43678921", periodo: "Julio 2026", tardanzas: 3, minutos: 41, descuento: 28.4 },
];

export const PLANTILLAS = [
  { id: 1, nombre: "Contrato a plazo fijo — Servicio específico", empresa: "negliaf", tipo: "Contrato", version: 3, actualizada: "2026-06-12" },
  { id: 2, nombre: "Adenda de traslado de sede", empresa: "negliaf", tipo: "Adenda", version: 1, actualizada: "2026-03-20" },
  { id: 3, nombre: "Memorándum — Llamada de atención", empresa: "negliaf", tipo: "Memorándum", version: 2, actualizada: "2026-05-02" },
  { id: 4, nombre: "Certificado de trabajo", empresa: "negliaf", tipo: "Certificado", version: 1, actualizada: "2026-01-15" },
  { id: 5, nombre: "Contrato a plazo fijo — Servicio específico", empresa: "bremco", tipo: "Contrato", version: 1, actualizada: "2026-04-10" },
];

export const CONTRATOS = [
  { dni: "46782301", tipo: "Plazo fijo", inicio: "2026-02-01", fin: "2026-08-31", estado: "vigente", firma: "firmado" },
  { dni: "44567120", tipo: "Plazo fijo", inicio: "2026-05-01", fin: "2026-10-31", estado: "vigente", firma: "firmado" },
  { dni: "48012765", tipo: "Plazo fijo", inicio: "2026-06-01", fin: "2026-08-31", estado: "por_vencer", firma: "firmado" },
  { dni: "43678921", tipo: "Plazo fijo", inicio: "2026-01-15", fin: "2026-08-15", estado: "por_vencer", firma: "pendiente" },
];

export const ACTIVOS = [
  { codigo: "TEL-0012", categoria: "Telefonía", marca: "Samsung", modelo: "Galaxy A15", serie: "SM-A155M-8871", imei: "358240051111110", estado: "asignado", asignado: "40125634", sede: "migraciones", empresa: "negliaf", valor: 620, compra: "2026-01-15" },
  { codigo: "TEL-0013", categoria: "Telefonía", marca: "Samsung", modelo: "Galaxy A15", serie: "SM-A155M-8872", imei: "358240051111128", estado: "disponible", asignado: null, sede: null, empresa: "negliaf", valor: 620, compra: "2026-01-15" },
  { codigo: "COM-0004", categoria: "Cómputo", marca: "Lenovo", modelo: "ThinkPad E14", serie: "PF-4RTZ88", imei: null, estado: "asignado", asignado: "43906712", sede: "minedu", empresa: "negliaf", valor: 2850, compra: "2025-11-20" },
  { codigo: "MAQ-0021", categoria: "Maquinaria", marca: "Kärcher", modelo: "Hidrolavadora HD 5/15", serie: "KAR-99120", imei: null, estado: "asignado", asignado: "40987654", sede: "ins", empresa: "negliaf", valor: 3200, compra: "2025-08-10" },
  { codigo: "MAQ-0022", categoria: "Maquinaria", marca: "Kärcher", modelo: "Aspiradora NT 30/1", serie: "KAR-99245", imei: null, estado: "mantenimiento", asignado: null, sede: "sunat", empresa: "negliaf", valor: 1450, compra: "2025-08-10" },
  { codigo: "MAQ-0023", categoria: "Maquinaria", marca: "Tennant", modelo: "Lustradora T300", serie: "TEN-45012", imei: null, estado: "disponible", asignado: null, sede: null, empresa: "bremco", valor: 5400, compra: "2026-03-01" },
  { codigo: "RAD-0002", categoria: "Comunicaciones", marca: "Motorola", modelo: "Radio EP450", serie: "MOT-71230", imei: null, estado: "asignado", asignado: "45098234", sede: "essalud", empresa: "bremco", valor: 480, compra: "2025-06-15" },
];

export const LINEAS = [
  { numero: "912345678", operador: "Claro", plan: "Plan Negocios 39.90", costo: 39.9, equipo: "TEL-0012", paga: "negliaf", alta: "2026-01-20", estado: "activa" },
  { numero: "998877665", operador: "Entel", plan: "Plan Empresa 29.90", costo: 29.9, equipo: null, paga: "negliaf", alta: "2025-10-01", estado: "activa" },
  { numero: "955443322", operador: "Movistar", plan: "Plan Negocios 45.00", costo: 45.0, equipo: null, paga: "bremco", alta: "2025-05-15", estado: "suspendida" },
];

export const EPP_ENTREGAS = [
  { id: 1, dni: "45231876", items: "Guantes de nitrilo (2), Mascarilla (5), Uniforme talla M (1)", entrega: "2026-07-01", reposicion: "2026-10-01", estado: "vigente" },
  { id: 2, dni: "41887203", items: "Guantes de nitrilo (2), Botas talla 41 (1)", entrega: "2026-07-01", reposicion: "2026-10-01", estado: "vigente" },
  { id: 3, dni: "46782301", items: "Uniforme talla S (2), Mascarilla (5)", entrega: "2026-05-15", reposicion: "2026-08-15", estado: "por_reponer" },
];

export const AUDITORIA = [
  { fecha: "2026-08-10 09:12", usuario: "D. Salguero", rol: "Jefe RRHH", accion: "Publicación de lote", entidad: "BOL-NEG-202607-001", ip: "200.48.12.5" },
  { fecha: "2026-08-10 08:55", usuario: "K. Prado", rol: "Analista RRHH", accion: "Consulta de legajo", entidad: "DNI 45231876", ip: "200.48.12.8" },
  { fecha: "2026-08-09 17:30", usuario: "J. Mamani", rol: "Supervisor", accion: "Acuse asistido", entidad: "DNI 41887203 · Boleta jul-26", ip: "181.65.44.2" },
];

export const persona = (dni) => PERSONAL.find((p) => p.dni === dni);
export const sede = (id) => SEDES.find((s) => s.id === id);
export const empresa = (id) => EMPRESAS.find((e) => e.id === id);
