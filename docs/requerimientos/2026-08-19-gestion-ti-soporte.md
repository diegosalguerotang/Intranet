# Levantamiento del sistema PHP de PROMANT (promant.pe/correo) — 2026-08-19

Revisado en vivo con la cuenta admin que pasó Diego. Sirve de base para tres cambios en la intranet GrupoER:
1. Renombrar la parte de inventario de **Administración** → módulo **Gestión de TI**.
2. Adoptar sus tablas/columnas de inventario (manteniendo lo nuestro: importación ADQ-08, edición, recodificación de impresoras).
3. Crear un módulo nuevo de **Soporte** (tickets), que hoy no tenemos.
4. Actualizar nuestra data de activos con lo que ellos ya subieron (IPs, modelos, estado).

## Estructura de su menú

- **Gestión**: Usuarios (cuentas del sistema, roles Administrador/Usuario/Super Usuario, última conexión), Trabajadores.
- **Correos**: Enviar, Historial, Cuentas, Firmas (fuera de alcance — nuestro motor de correo ya existe).
- **Inventario**: Activos, Asignaciones.
- **Soporte**: Tickets, Config. Tickets (tipos/subtipos), Avisos de Ticket (correos notificados).

## Inventario → Activos (activos.php)

Tabla: **Tipo | Código interno | Modelo | IP | Estado | Ver**. Filtros: buscar (código/modelo/IP), tipo, estado. Botón Exportar.
Detalle (activo_ver.php): Tipo, Código, Modelo, IP, **Contraseña** (oculta — solo Super Usuario la ve).
30 activos (17 LAPTOP, 13 PC), códigos con la misma convención nuestra (PROLT/PROPC):

```
LAPTOP;PROLT01;LENOVO;
LAPTOP;PROLT04;LENOVO;192.168.1.185
LAPTOP;PROLT05;LENOVO;192.168.1.172
LAPTOP;PROLT06;HP;
LAPTOP;PROLT07;LENOVO;
LAPTOP;PROLT13;HP;
LAPTOP;PROLT16;LENOVO;
LAPTOP;PROLT17;DELL;
LAPTOP;PROLT19;HP;192.168.1.145
LAPTOP;PROLT20;INSPIRON 3421;192.168.1.171
LAPTOP;PROLT23;LENOVO;192.168.1.147
LAPTOP;PROLT24;LENOVO;192.168.1.113
LAPTOP;PROLT25;ASUS;
LAPTOP;PROLT26;ASUSTEK;192.168.1.213
LAPTOP;PROLT47;LENOVO;192.168.1.207
LAPTOP;PROLT51;LENOVO;192.168.1.202
LAPTOP;PROLT54;ACER;192.168.1.25
PC;PROLT09;GIGABYTE TECHNOLOGY CO.;192.168.1.100
PC;PROPC02;MONITOR AOC;192.168.1.102
PC;PROPC03;MONITOR AOC;192.168.1.246
PC;PROPC08;MONITOR AOC;192.168.1.232
PC;PROPC10;MONITOR LG;Antigua
PC;PROPC14;MONITOR BENQ;
PC;PROPC15;MONITOR SAMSUNG;
PC;PROPC18;MONITOR AOC;
PC;PROPC21;MONITOR SAMSUNG;192.168.1.173
PC;PROPC22;MONITOR SAMSUNG;192.168.1.141
PC;PROPC31;MONITOR: LG;192.168.1.154
PC;PROPC46;MONITOR AOC;192.168.1.109
PC;PROPC49;MONITOR A320M -S2H;
```

Todos en estado "Activo". Nota: PROLT09 está clasificado como PC en su sistema; PROPC10 tiene "Antigua" en el campo IP (dato sucio).

## Inventario → Asignaciones (asignaciones.php)

Tabla: **Trabajador | Activo | Antivirus (Sí/No) | Fecha | Comentarios**. Filtros: buscar, antivirus. Exportar.
1 asignación: Karen Gusman ← PROPC31, antivirus No, "PC QUE LE PERTENECIO A ARTURO AVALOS".
(Nosotros ya tenemos asignaciones por FK; lo nuevo es el flag **antivirus** y **comentarios** con fecha.)

## Soporte → Tickets (tickets.php, ticket_ver.php)

102 tickets. Tabla: **N° Ticket (TCK-nnnnnn) | Fecha | Nombre | Correo | Área | Tipo/Subtipo | Estado | Ver**.
Filtros: buscar (nombre/correo/n°), estado, tipo. Exportar.

Estados: **Abierto, En proceso, Resuelto, Cerrado**.

Detalle del ticket: nombre, correo, área (texto libre — llega muy sucio: "RRHH", "RR", "sst", "planillas"...), tipo, subtipo, comentario del usuario, y panel de gestión:
- **Cambiar estado** (4 estados)
- **Atendido por** (responsable: Fabian, Karen Gusman — el equipo de TI)
- **Nota interna** (solo la ve el equipo de TI)
- Última actualización: por quién y cuándo.

## Soporte → Config. Tickets (ticket_tipos.php + ticket_subtipos.php)

Catálogo mantenible: tipos con subtipos, cada uno activable/inactivable, CRUD completo.

| Tipo | Estado | Subtipos |
|---|---|---|
| Conectividad y redes | Activo | Conexión a internet (A), No tengo internet (I), No tengo la contraseña (I), Otro (A) |
| Correo | Inactivo | General, No se puede enviar correo, Olvide mi contraseña, Se lleno mi espacio |
| Cuenta de usuario | Inactivo | General, Olvide la contraseña del equipo |
| Hardware | Activo | Equipos de cómputo y accesorios, Impresora / escáner, Otro |
| Otro | Activo | Detallar en el recuadro de Comentarios |
| Software | Activo | EJB, Office, Otro, SAP, Sistemas IA |
| Solicitud | Activo | Carpetas y/o almacenamiento, Grabación de medios, Nuevo ingreso / Cambio de puesto, Otro, Permisos de acceso, Revisión de grabaciones, Telefonía móvil |

(Tickets viejos con tipo "Red/Internet" — catálogo renombrado sin migrar los históricos.)

## Soporte → Avisos de Ticket (ticket_notificaciones.php)

Lista de correos que reciben aviso automático al crearse cada ticket, activables/eliminables:
karen.gusman@promant.pe, consultoria@promant.pe, fabiancortez987@gmail.com.

## Gestión → Trabajadores / Usuarios

- Trabajadores: Nombre, Área, Puesto, Teléfono (etiquetado Personal/Corporativo), **Razón Social** (NEGLIAF, AMERICANA, PROMANT SERVICIOS SRL — multiempresa como nosotros), Estado. Solo 4 registros.
- Usuarios: Nombre, Usuario (código corto: GOP, GLOG, RRHH, GG...), Rol (Administrador/Usuario/Super Usuario), Estado, Última conexión, Creado.

## Qué tienen ellos que nos falta (lo aprovechable)

1. **Módulo de tickets completo** (el faltante grande): tipos/subtipos parametrizables, estados, responsable, nota interna, avisos por correo, exportar.
2. **Campos de activo**: IP y contraseña del equipo (con visibilidad restringida por rol).
3. **Asignación con flag antivirus + comentarios**.
4. **Data real**: 30 activos con modelo/IP curados por su equipo de TI.

## Qué NO copiar (lo nuestro es mejor)

- Área/nombre/correo como texto libre en tickets → en nuestra intranet el solicitante es una persona/cuenta real (portal o backoffice), con área y empresa estructuradas.
- N° de ticket aleatorio TCK-nnnnnn → mejor secuencia legible tipo TK-0001 (como U-000N, S-0001).
- Su inventario no tiene: importación desde Excel (ADQ-08), recodificación de impresoras por serie, por_corregir, auditoría, multiempresa con alcance, edición con arrastre de FKs.
- Catálogo renombrado sin migrar históricos (nuestros textos van congelados o por FK).
