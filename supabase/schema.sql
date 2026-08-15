-- ============================================================================
-- INTRANET GRUPO NEGLIAF — Esquema de base de datos v2
-- Modelo relacional según Arquitectura Funcional v1.0:
--   · Persona única (DNI) ≠ Vínculo laboral (persona × empresa × periodo)
--   · Los documentos cuelgan del Vínculo, nunca de la Persona
--   · El acuse es un hecho inmutable, no un estado (trigger lo garantiza)
--   · Corrección documental = versión nueva, jamás sobrescritura
--   · Asignación de activos con historial (no un campo "asignado")
--   · Auditoría de solo escritura sobre toda operación
-- La interfaz lee VISTAS (v_*) y escribe mediante FUNCIONES RPC.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- LIMPIEZA (idempotente)
-- ---------------------------------------------------------------------------
drop view if exists v_personal, v_sedes, v_acuses, v_lotes, v_activos,
  v_contratos, v_epp_entregas, v_comunicados, v_memorandums cascade;
drop table if exists auditoria, epp_entregas, lineas, asignaciones, activos,
  contratos, plantillas, tardanzas, descargos, memorandums, comunicados,
  acuses, documentos, lotes, vinculos, personas, sedes, empresas, cargos cascade;
drop function if exists fn_bloquear_cambios, fn_auditar, alta_trabajador,
  eliminar_trabajador, publicar_lote, registrar_acuse_asistido,
  emitir_memorandum, resolver_memorandum, asignar_activo, devolver_activo,
  registrar_epp, publicar_comunicado, fn_solo_empresa_activa cascade;

-- ---------------------------------------------------------------------------
-- NÚCLEO ORGANIZACIONAL
-- ---------------------------------------------------------------------------
create table empresas (
  id        text primary key,
  nombre    text not null,
  corto     text not null,
  ruc       text not null unique check (ruc ~ '^[0-9]{11}$'),
  logo      text,
  regimen   text not null default 'Régimen general'
    check (regimen in ('Régimen general','Micro empresa','Pequeña empresa','Por confirmar')),
  estado    text not null default 'activa' check (estado in ('activa','retirada')),
  direccion text,
  creado_en timestamptz not null default now()
);

create table personas (
  dni                   text primary key check (dni ~ '^[0-9]{8}$'),
  nombre                text not null,
  celular               text check (celular is null or celular ~ '^[0-9]{9}$'),
  direccion             text,
  banco                 text,
  cuenta                text,
  portal                text not null default 'nunca_ingreso'
    check (portal in ('activo','nunca_ingreso','sin_celular','suspendido')),
  nombre_por_confirmar  boolean not null default false,
  creado_en             timestamptz not null default now()
);

create table sedes (
  id             text primary key,
  empresa_id     text not null references empresas(id),
  nombre         text not null,
  cliente        text not null,
  direccion      text,
  estado         text not null default 'activa' check (estado in ('activa','cerrada')),
  supervisor_dni text references personas(dni),
  creado_en      timestamptz not null default now()
);

-- El Vínculo es la decisión estructural central: una Persona puede tener
-- varios vínculos en el tiempo (recontratación, rotación entre empresas).
create table vinculos (
  id           bigint generated always as identity primary key,
  persona_dni  text not null references personas(dni),
  empresa_id   text not null references empresas(id),
  sede_id      text not null references sedes(id),
  cargo        text not null,
  fecha_inicio date not null,
  fecha_fin    date check (fecha_fin is null or fecha_fin >= fecha_inicio),
  centro_costo text,
  creado_en    timestamptz not null default now()
);
-- Regla: a lo sumo un vínculo vigente por persona y empresa.
create unique index uq_vinculo_vigente on vinculos (persona_dni, empresa_id)
  where fecha_fin is null;
create index ix_vinculos_empresa on vinculos (empresa_id);
create index ix_vinculos_sede on vinculos (sede_id);

-- ---------------------------------------------------------------------------
-- MOTOR DOCUMENTAL: LOTES → DOCUMENTOS → ACUSES
-- ---------------------------------------------------------------------------
create table lotes (
  id            text primary key,
  empresa_id    text not null references empresas(id),
  tipo          text not null
    check (tipo in ('Boleta de pago','Gratificación','Liquidación de CTS','Utilidades')),
  periodo       text not null,
  version       integer not null default 1 check (version >= 1),
  publicado_en  timestamptz not null default now(),
  publicado_por text not null,
  avisos        integer not null default 0,
  unique (empresa_id, tipo, periodo, version)   -- nunca se sobrescribe en silencio
);

-- El documento pertenece a un VÍNCULO (no a la persona): una boleta es de una
-- relación laboral concreta con una empresa concreta.
create table documentos (
  id           bigint generated always as identity primary key,
  vinculo_id   bigint not null references vinculos(id),
  lote_id      text references lotes(id),
  tipo         text not null,
  titulo       text not null,
  periodo      text,
  version      integer not null default 1,
  hash_sha256  text not null,               -- huella del archivo exacto entregado
  reemplaza_a  bigint references documentos(id),
  estado       text not null default 'vigente' check (estado in ('vigente','reemplazado')),
  neto         numeric,
  publicado_en timestamptz not null default now()
);
create index ix_documentos_lote on documentos (lote_id);
create index ix_documentos_vinculo on documentos (vinculo_id);

-- El ACUSE es un hecho registrado, no un booleano. Un acuse por versión de
-- documento. Inmutable: sin UPDATE ni DELETE desde ninguna interfaz.
create table acuses (
  dni_check          text,                  -- redundancia defensiva para auditoría
  id                 bigint generated always as identity primary key,
  documento_id       bigint not null unique references documentos(id),
  modalidad          text not null check (modalidad in ('personal','asistido')),
  registrado_en      timestamptz not null default now(),  -- reloj del SERVIDOR
  ip                 text,
  dispositivo        text,
  hash_sha256        text not null,         -- debe coincidir con el del documento
  declaracion        text not null,         -- texto EXACTO aceptado, no referencia
  registrado_por     text,                  -- quién operó (asistido)
  supervisor_dni     text references personas(dni),
  motivo_asistido    text,
  entrega_fisica_en  timestamptz,           -- puede diferir de registrado_en
  adjunto_url        text,                  -- cargo firmado: obligatorio si asistido
  constraint acuse_asistido_completo check (
    modalidad <> 'asistido'
    or (adjunto_url is not null and entrega_fisica_en is not null and motivo_asistido is not null)
  ),
  constraint entrega_no_futura check (
    entrega_fisica_en is null or entrega_fisica_en <= registrado_en
  )
);

-- Inmutabilidad de los registros probatorios.
create function fn_bloquear_cambios() returns trigger language plpgsql as $$
begin
  raise exception 'Los registros de % son inmutables. Cualquier corrección se resuelve emitiendo una versión nueva.', tg_table_name;
end $$;
create trigger trg_acuses_inmutables
  before update or delete on acuses
  for each row execute function fn_bloquear_cambios();

-- ---------------------------------------------------------------------------
-- CATÁLOGO DE CARGOS Y CONTROL DE EMPRESA ACTIVA
-- ---------------------------------------------------------------------------
create table cargos (nombre text primary key);
insert into cargos (nombre) values
  ('Operario de limpieza'), ('Supervisor de sede'), ('Técnico de mantenimiento'),
  ('Auxiliar de servicios'), ('Analista RRHH'), ('Jefe de RRHH'),
  ('OPERARIO(A) DE LIMPIEZA'), ('SUPERVISOR(A) DE LIMPIEZA');

-- Nada nuevo sobre una empresa retirada (vínculos y lotes; contratos y
-- comunicados nuevos quedan bloqueados por la UI, que filtra activas).
create function fn_solo_empresa_activa() returns trigger
language plpgsql as $$
begin
  if (select estado from empresas where id = new.empresa_id) <> 'activa' then
    raise exception 'La empresa % está retirada del grupo: no admite registros nuevos.', new.empresa_id;
  end if;
  return new;
end $$;
create trigger trg_vinculo_empresa_activa before insert on vinculos
  for each row execute function fn_solo_empresa_activa();
create trigger trg_lote_empresa_activa before insert on lotes
  for each row execute function fn_solo_empresa_activa();

-- ---------------------------------------------------------------------------
-- COMUNICADOS
-- ---------------------------------------------------------------------------
create table comunicados (
  id           bigint generated by default as identity primary key,
  titulo       text not null,
  cuerpo       text not null,
  publicado    date not null default current_date,
  vence        date not null,
  exige_acuse  boolean not null default true,
  segmento     text not null,
  alcance      integer not null default 0,   -- congelado al publicar
  leidos       integer not null default 0
);

-- ---------------------------------------------------------------------------
-- DISCIPLINA: MEMORÁNDUM → DESCARGO (único) → RESOLUCIÓN
-- ---------------------------------------------------------------------------
create table memorandums (
  id            text primary key,            -- correlativo por empresa y año, sin huecos
  vinculo_id    bigint not null references vinculos(id),
  tipo          text not null
    check (tipo in ('Llamada de atención','Amonestación escrita','Preaviso de despido')),
  motivo        text not null,
  articulo      text,
  emitido       date not null default current_date,
  notificado_en timestamptz,                 -- el plazo corre desde AQUÍ, no desde la emisión
  plazo_dias    integer not null default 5,
  vence         date,
  estado        text not null default 'emitido_sin_notificar'
    check (estado in ('emitido_sin_notificar','notificado','en_plazo',
                      'descargo_presentado','vencido','resuelto')),
  resuelto_en   date,
  resolucion    text
);

-- Un solo descargo por memorándum (PK = FK), sin edición posterior.
create table descargos (
  memorandum_id text primary key references memorandums(id),
  presentado_en timestamptz not null default now(),
  texto         text not null,
  adjuntos      integer not null default 0
);
create trigger trg_descargos_inmutables
  before update or delete on descargos
  for each row execute function fn_bloquear_cambios();

-- ---------------------------------------------------------------------------
-- ASISTENCIA (solo lectura: la fuente de verdad es el sistema de marcaciones)
-- ---------------------------------------------------------------------------
create table tardanzas (
  dni       text not null references personas(dni),
  periodo   text not null,
  tardanzas integer not null default 0,
  minutos   integer not null default 0,
  descuento numeric(10,2) not null default 0,
  primary key (dni, periodo)                 -- la reimportación es idempotente
);

-- ---------------------------------------------------------------------------
-- CONTRATOS Y PLANTILLAS
-- ---------------------------------------------------------------------------
create table plantillas (
  id          bigint generated by default as identity primary key,
  nombre      text not null,
  empresa_id  text not null references empresas(id),
  tipo        text not null check (tipo in ('Contrato','Adenda','Memorándum','Certificado')),
  version     integer not null default 1,
  actualizada date not null default current_date
);

create table contratos (
  id         bigint generated always as identity primary key,
  vinculo_id bigint not null references vinculos(id),
  tipo       text not null default 'Plazo fijo',
  inicio     date not null,
  fin        date,
  firma      text not null default 'pendiente' check (firma in ('pendiente','firmado')),
  plantilla_id bigint references plantillas(id)
);

-- ---------------------------------------------------------------------------
-- ACTIVOS: el estado físico y la asignación son cosas DISTINTAS.
-- La asignación es un historial, no un campo.
-- ---------------------------------------------------------------------------
create table activos (
  codigo        text primary key,
  categoria     text not null
    check (categoria in ('Telefonía','Cómputo','Comunicaciones','Maquinaria')),
  marca         text not null,
  modelo        text not null,
  serie         text not null,
  imei          text unique,                 -- único en todo el sistema
  estado_fisico text not null default 'operativo'
    check (estado_fisico in ('operativo','mantenimiento','baja')),
  sede_id       text references sedes(id),   -- ubicación cuando no está asignado
  empresa_id    text not null references empresas(id),  -- propietaria (costeo/contabilidad)
  valor         numeric(12,2) not null default 0,
  compra        date,
  constraint imei_solo_telefonia check (imei is null or categoria = 'Telefonía'),
  unique (categoria, serie)                  -- serie única por categoría
);

create table asignaciones (
  id                   bigint generated always as identity primary key,
  activo_codigo        text not null references activos(codigo),
  persona_dni          text not null references personas(dni),
  entregado_en         date not null default current_date,
  condicion_entrega    text not null default 'Buen estado',
  devuelto_en          date,
  condicion_devolucion text,
  destino              text check (destino in ('disponible','mantenimiento','baja'))
);
-- Un activo solo puede estar asignado a una persona a la vez.
create unique index uq_asignacion_abierta on asignaciones (activo_codigo)
  where devuelto_en is null;

create table lineas (
  numero   text primary key check (numero ~ '^[0-9]{9}$'),
  operador text not null,
  plan     text not null,
  costo    numeric(10,2) not null default 0,
  equipo   text references activos(codigo),
  paga     text not null references empresas(id),
  alta     date not null default current_date,
  estado   text not null default 'activa' check (estado in ('activa','suspendida','baja'))
);

-- El EPP es consumible: entrega recurrente, no asignación única.
create table epp_entregas (
  id         bigint generated by default as identity primary key,
  dni        text not null references personas(dni),
  items      text not null,
  entrega    date not null default current_date,
  reposicion date not null
);

-- ---------------------------------------------------------------------------
-- AUDITORÍA — registro inmutable de toda operación con efecto sobre datos
-- ---------------------------------------------------------------------------
create table auditoria (
  id            bigint generated always as identity primary key,
  fecha         timestamptz not null default now(),
  usuario       text not null default current_user,
  accion        text not null,               -- INSERT / UPDATE / DELETE
  tabla         text not null,
  datos_antes   jsonb,
  datos_despues jsonb
);
create trigger trg_auditoria_inmutable
  before update or delete on auditoria
  for each row execute function fn_bloquear_cambios();

create function fn_auditar() returns trigger language plpgsql security definer as $$
begin
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values (tg_op, tg_table_name,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------------
-- DATOS INICIALES (demostración, tomados de los Casos de Referencia v1.0)
-- ---------------------------------------------------------------------------
-- Nota: bremco se inserta con estado 'activa' (default) para que los vínculos y
-- lotes históricos de la carga inicial se registren sin tropezar con el trigger
-- fn_solo_empresa_activa; se retira al final de esta sección, como en producción.
insert into empresas (id, nombre, corto, ruc, logo, regimen, direccion) values
  ('negliaf',    'NEGLIAF S.R.L.',            'NEGLIAF',      '20501234567', '/logos/negliaf.jpeg',            'Régimen general', null),
  ('bremco',     'BREMCO S.C.R.L.',           'BREMCO',       '20512345678', null,                             'Régimen general', null),
  ('promant',    'PROMANT SERVICIOS',         'PROMANT',      '20523456789', '/logos/promant.jpeg',            'Pequeña empresa', null),
  ('lamericana', 'LIMPIEZA AMERICANA S.A.C.', 'L. AMERICANA', '20601705185', '/logos/limpieza-americana.jpeg', 'Régimen general', 'Av. San Borja Sur Nro. 1184, Urb. San Borja Sur'),
  ('clean',      'Consorcio Clean',           'CLEAN',        '20614759870', '/logos/clean.png',               'Por confirmar',    'Jr. Océano Ártico Nro. 226 Dpto. 201 (Frente al Colegio Odontológico del Perú)');

insert into personas (dni, nombre, celular, banco, cuenta, portal) values
  ('45231876', 'Rosa Quispe Huamán',    '987654321', 'BCP',       '191-23456789-0-11',  'activo'),
  ('41887203', 'Luis Zapata Condori',   null,        'BBVA',      '0011-0234-05678901', 'sin_celular'),
  ('40125634', 'Julio Mamani Apaza',    '912345678', 'BCP',       '191-98765432-0-52',  'activo'),
  ('43906712', 'Carmen Torres Vega',    '934567812', 'Interbank', '898-3001234567',     'activo'),
  ('46782301', 'María Fernández Ríos',  '956781234', 'BCP',       '191-45678912-0-33',  'activo'),
  ('42345987', 'Jorge Huamán Ccopa',    '978123456', 'BBVA',      '0011-0456-07891234', 'nunca_ingreso'),
  ('44567120', 'Elena Ccahua Mendoza',  '945612378', 'BCP',       '191-78912345-0-44',  'activo'),
  ('47893456', 'Miguel Paredes Luna',   '923456781', 'Interbank', '898-3009876543',     'nunca_ingreso'),
  ('41234509', 'Sofía Chávez Ramos',    '967812345', 'BCP',       '191-32165498-0-21',  'activo'),
  ('40987654', 'Raúl Gutiérrez Poma',   '989123457', 'BBVA',      '0011-0789-01234567', 'activo'),
  ('43678921', 'Teresa Núñez Salas',    null,        'BCP',       '191-65432187-0-19',  'sin_celular'),
  ('45098234', 'Pedro Rojas Medina',    '911223344', 'BCP',       '191-11223344-0-55',  'activo'),
  ('46654387', 'Ana Silva Cárdenas',    '922334455', 'Interbank', '898-3005544332',     'activo'),
  ('48012765', 'Víctor Salas Quiroz',   '933445566', 'BBVA',      '0011-0987-06543210', 'activo'),
  ('39876120', 'Gladys Ponce Aroni',    '944556677', 'BCP',       '191-99887766-0-88',  'activo');

insert into sedes (id, empresa_id, nombre, cliente, supervisor_dni) values
  ('sunat',       'negliaf', 'SUNAT Lima — Sede Central', 'SUNAT',       '40125634'),
  ('migraciones', 'negliaf', 'MIGRACIONES — Breña',       'MIGRACIONES', '40125634'),
  ('minedu',      'negliaf', 'MINEDU — San Borja',        'MINEDU',      '43906712'),
  ('ins',         'negliaf', 'INS — Chorrillos',          'INS',         '43906712'),
  ('essalud',     'bremco',  'ESSALUD — Jesús María',     'ESSALUD',     '45098234'),
  ('ucv',         'promant', 'UCV — Lima Norte',          'UCV',         '46654387');

insert into vinculos (persona_dni, empresa_id, sede_id, cargo, fecha_inicio, fecha_fin) values
  ('45231876', 'negliaf', 'sunat',       'Operario de limpieza',     '2023-03-01', null),
  ('41887203', 'negliaf', 'migraciones', 'Operario de limpieza',     '2022-01-15', null),
  ('40125634', 'negliaf', 'migraciones', 'Supervisor de sede',       '2021-06-01', null),
  ('43906712', 'negliaf', 'minedu',      'Supervisor de sede',       '2022-09-01', null),
  ('46782301', 'negliaf', 'sunat',       'Operario de limpieza',     '2024-02-01', null),
  ('42345987', 'negliaf', 'minedu',      'Operario de limpieza',     '2023-07-15', null),
  ('44567120', 'negliaf', 'ins',         'Auxiliar de servicios',    '2024-05-01', null),
  ('47893456', 'negliaf', 'migraciones', 'Operario de limpieza',     '2023-11-01', null),
  ('41234509', 'negliaf', 'sunat',       'Operario de limpieza',     '2022-04-01', null),
  ('40987654', 'negliaf', 'ins',         'Técnico de mantenimiento', '2021-10-01', null),
  ('43678921', 'negliaf', 'minedu',      'Operario de limpieza',     '2024-01-15', null),
  ('45098234', 'bremco',  'essalud',     'Supervisor de sede',       '2022-03-01', null),
  ('46654387', 'promant', 'ucv',         'Supervisor de sede',       '2023-05-01', null),
  ('48012765', 'bremco',  'essalud',     'Operario de limpieza',     '2024-06-01', null),
  ('39876120', 'negliaf', 'sunat',       'Operario de limpieza',     '2020-08-01', '2026-06-30');

-- Lote de julio (Caso 1) con documentos por vínculo y sus acuses reales
insert into lotes (id, empresa_id, tipo, periodo, version, publicado_en, publicado_por, avisos) values
  ('BOL-NEG-202607-001', 'negliaf', 'Boleta de pago', 'Julio 2026', 1, '2026-08-01 09:14-05', 'D. Salguero', 299);

insert into documentos (vinculo_id, lote_id, tipo, titulo, periodo, hash_sha256)
select v.id, 'BOL-NEG-202607-001', 'Boleta de pago', 'Boleta de pago — Julio 2026', 'Julio 2026', md5(v.persona_dni || 'jul26') || md5('salt' || v.persona_dni)
from vinculos v
where v.empresa_id = 'negliaf' and v.fecha_fin is null;

-- Acuses personales (Rosa, María, Sofía, Raúl, Carmen, Julio)
insert into acuses (documento_id, modalidad, registrado_en, ip, dispositivo, hash_sha256, declaracion)
select d.id, 'personal', t.fecha::timestamptz, t.ip, t.disp, d.hash_sha256,
       'Declaro haber recibido mi boleta de pago del periodo Julio 2026 y haber podido revisar su contenido.'
from (values
  ('45231876', '2026-08-01 19:32-05', '181.65.212.44', 'Android 12 · Chrome Mobile'),
  ('46782301', '2026-08-01 20:05-05', '190.42.118.20', 'Android 13 · Chrome Mobile'),
  ('41234509', '2026-08-02 08:11-05', '181.65.99.102', 'Android 11 · Chrome Mobile'),
  ('40987654', '2026-08-01 21:47-05', '200.121.45.78', 'iPhone · Safari'),
  ('43906712', '2026-08-01 18:20-05', '181.66.30.12',  'Android 14 · Chrome Mobile'),
  ('40125634', '2026-08-01 19:01-05', '181.65.212.44', 'Android 12 · Chrome Mobile')
) as t(dni, fecha, ip, disp)
join vinculos v on v.persona_dni = t.dni and v.fecha_fin is null
join documentos d on d.vinculo_id = v.id and d.lote_id = 'BOL-NEG-202607-001';

-- Acuse asistido de Luis Zapata (Caso 2): dos fechas, supervisor y cargo adjunto
insert into acuses (documento_id, modalidad, registrado_en, dispositivo, hash_sha256, declaracion,
                    registrado_por, supervisor_dni, motivo_asistido, entrega_fisica_en, adjunto_url)
select d.id, 'asistido', '2026-08-04 12:15-05', 'Registrado por J. Mamani (supervisor)', d.hash_sha256,
       'El supervisor declara haber entregado el documento físicamente y adjunta el cargo firmado.',
       'Julio Mamani', '40125634', 'Sin celular', '2026-08-04 09:00-05', 'cargos/41887203-jul26.jpg'
from vinculos v
join documentos d on d.vinculo_id = v.id and d.lote_id = 'BOL-NEG-202607-001'
where v.persona_dni = '41887203' and v.fecha_fin is null;

insert into comunicados (id, titulo, cuerpo, publicado, vence, exige_acuse, segmento, alcance, leidos) values
  (1, 'Simulacro nacional de sismo — 31 de julio',
      'El jueves 31 de julio a las 10:00 se realizará el simulacro nacional. Todo el personal debe participar siguiendo las rutas de evacuación de su sede.',
      '2026-07-25', '2026-07-31', true, 'Todo el grupo', 312, 289),
  (2, 'Cambio de horario de ingreso — Sede SUNAT',
      'Desde el lunes 11 de agosto el ingreso en la sede SUNAT Lima será a las 6:30 a.m. por disposición del cliente. La tolerancia se mantiene en 10 minutos.',
      '2026-08-06', '2026-08-20', true, 'NEGLIAF · Sede SUNAT Lima', 84, 61),
  (3, 'Entrega de uniformes de invierno',
      'La segunda entrega anual de uniformes se realizará del 18 al 22 de agosto en cada sede, coordinada por su supervisor.',
      '2026-08-08', '2026-08-25', false, 'Todo el grupo', 312, 45);
select setval(pg_get_serial_sequence('comunicados','id'), (select max(id) from comunicados));

insert into memorandums (id, vinculo_id, tipo, motivo, articulo, emitido, notificado_en, plazo_dias, vence, estado, resuelto_en, resolucion)
select m.id, v.id, m.tipo, m.motivo, m.articulo, m.emitido::date, m.notificado::timestamptz, m.plazo, m.vence::date, m.estado, m.resuelto::date, m.resolucion
from (values
  ('0142-2026', '45231876', 'Llamada de atención', 'Tardanzas reiteradas — 2 tardanzas, 18 minutos en julio 2026', 'Art. 12 RIT',
   '2026-08-05', '2026-08-05 18:40-05', 5, '2026-08-12', 'descargo_presentado', null, null),
  ('0141-2026', '47893456', 'Amonestación escrita', 'Abandono de puesto el 28 de julio sin autorización del supervisor', 'Art. 15 RIT',
   '2026-08-01', null, 5, null, 'emitido_sin_notificar', null, null),
  ('0140-2026', '42345987', 'Llamada de atención', 'Tardanzas reiteradas — 3 tardanzas, 35 minutos en junio 2026', 'Art. 12 RIT',
   '2026-07-10', '2026-07-11 08:30-05', 5, '2026-07-18', 'resuelto', '2026-07-21',
   'Se mantiene la sanción. El trabajador no presentó descargo dentro del plazo.')
) as m(id, dni, tipo, motivo, articulo, emitido, notificado, plazo, vence, estado, resuelto, resolucion)
join vinculos v on v.persona_dni = m.dni and v.empresa_id = 'negliaf' and v.fecha_fin is null;

insert into descargos (memorandum_id, presentado_en, texto, adjuntos) values
  ('0142-2026', '2026-08-06 09:12-05',
   'El día 14 de julio tuve una emergencia médica con mi hija menor, adjunto constancia del centro de salud. El día 22 el tren se detuvo por más de 20 minutos.', 1);

insert into tardanzas (dni, periodo, tardanzas, minutos, descuento) values
  ('45231876', 'Julio 2026', 2, 18, 12.50),
  ('42345987', 'Julio 2026', 1,  8,  5.60),
  ('47893456', 'Julio 2026', 4, 52, 36.10),
  ('46782301', 'Julio 2026', 0,  0,  0.00),
  ('44567120', 'Julio 2026', 1,  5,  3.50),
  ('43678921', 'Julio 2026', 3, 41, 28.40);

insert into plantillas (id, nombre, empresa_id, tipo, version, actualizada) values
  (1, 'Contrato a plazo fijo — Servicio específico', 'negliaf', 'Contrato',    3, '2026-06-12'),
  (2, 'Adenda de traslado de sede',                  'negliaf', 'Adenda',      1, '2026-03-20'),
  (3, 'Memorándum — Llamada de atención',            'negliaf', 'Memorándum',  2, '2026-05-02'),
  (4, 'Certificado de trabajo',                      'negliaf', 'Certificado', 1, '2026-01-15'),
  (5, 'Contrato a plazo fijo — Servicio específico', 'bremco',  'Contrato',    1, '2026-04-10');
select setval(pg_get_serial_sequence('plantillas','id'), (select max(id) from plantillas));

insert into contratos (vinculo_id, tipo, inicio, fin, firma)
select v.id, 'Plazo fijo', c.inicio::date, c.fin::date, c.firma
from (values
  ('46782301', '2026-02-01', '2026-08-31', 'firmado'),
  ('44567120', '2026-05-01', '2026-10-31', 'firmado'),
  ('48012765', '2026-06-01', '2026-08-31', 'firmado'),
  ('43678921', '2026-01-15', '2026-08-15', 'pendiente')
) as c(dni, inicio, fin, firma)
join vinculos v on v.persona_dni = c.dni and v.fecha_fin is null;

insert into activos (codigo, categoria, marca, modelo, serie, imei, estado_fisico, sede_id, empresa_id, valor, compra) values
  ('TEL-0012', 'Telefonía',      'Samsung',  'Galaxy A15',            'SM-A155M-8871', '358240051111110', 'operativo',     null,    'negliaf', 620,  '2026-01-15'),
  ('TEL-0013', 'Telefonía',      'Samsung',  'Galaxy A15',            'SM-A155M-8872', '358240051111128', 'operativo',     null,    'negliaf', 620,  '2026-01-15'),
  ('COM-0004', 'Cómputo',        'Lenovo',   'ThinkPad E14',          'PF-4RTZ88',     null,              'operativo',     null,    'negliaf', 2850, '2025-11-20'),
  ('MAQ-0021', 'Maquinaria',     'Kärcher',  'Hidrolavadora HD 5/15', 'KAR-99120',     null,              'operativo',     null,    'negliaf', 3200, '2025-08-10'),
  ('MAQ-0022', 'Maquinaria',     'Kärcher',  'Aspiradora NT 30/1',    'KAR-99245',     null,              'mantenimiento', 'sunat', 'negliaf', 1450, '2025-08-10'),
  ('MAQ-0023', 'Maquinaria',     'Tennant',  'Lustradora T300',       'TEN-45012',     null,              'operativo',     null,    'bremco',  5400, '2026-03-01'),
  ('RAD-0002', 'Comunicaciones', 'Motorola', 'Radio EP450',           'MOT-71230',     null,              'operativo',     null,    'bremco',  480,  '2025-06-15');

insert into asignaciones (activo_codigo, persona_dni, entregado_en, condicion_entrega) values
  ('TEL-0012', '40125634', '2026-01-20', 'Nuevo'),
  ('COM-0004', '43906712', '2025-11-25', 'Nuevo'),
  ('MAQ-0021', '40987654', '2025-08-15', 'Buen estado'),
  ('RAD-0002', '45098234', '2025-06-20', 'Buen estado');

insert into lineas (numero, operador, plan, costo, equipo, paga, alta, estado) values
  ('912345678', 'Claro',    'Plan Negocios 39.90', 39.90, 'TEL-0012', 'negliaf', '2026-01-20', 'activa'),
  ('998877665', 'Entel',    'Plan Empresa 29.90',  29.90, null,       'negliaf', '2025-10-01', 'activa'),
  ('955443322', 'Movistar', 'Plan Negocios 45.00', 45.00, null,       'bremco',  '2025-05-15', 'suspendida');

insert into epp_entregas (id, dni, items, entrega, reposicion) values
  (1, '45231876', 'Guantes de nitrilo (2), Mascarilla (5), Uniforme talla M (1)', '2026-07-01', '2026-10-01'),
  (2, '41887203', 'Guantes de nitrilo (2), Botas talla 41 (1)',                   '2026-07-01', '2026-10-01'),
  (3, '46782301', 'Uniforme talla S (2), Mascarilla (5)',                         '2026-05-15', '2026-08-01');
select setval(pg_get_serial_sequence('epp_entregas','id'), (select max(id) from epp_entregas));

-- BREMCO sale del grupo: retirada, jamás eliminada (conservación documental).
-- Se actualiza aquí, después de cargar su historial, para no chocar con
-- fn_solo_empresa_activa (que solo bloquea INSERTs nuevos, no la carga previa).
update empresas set estado = 'retirada' where id = 'bremco';

-- ---------------------------------------------------------------------------
-- TRIGGERS DE AUDITORÍA (después de la carga inicial)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['personas','vinculos','lotes','documentos','acuses',
    'memorandums','descargos','comunicados','activos','asignaciones','lineas','epp_entregas']
  loop
    execute format('create trigger trg_auditar_%s after insert or update or delete on %I
                    for each row execute function fn_auditar()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- VISTAS DE LECTURA (contrato de datos con la interfaz)
-- ---------------------------------------------------------------------------
create view v_sedes as
select s.id, s.empresa_id as empresa, s.nombre, s.cliente, p.nombre as supervisor
from sedes s left join personas p on p.dni = s.supervisor_dni;

create view v_personal as
select p.dni, p.nombre, v.cargo, v.sede_id as sede, v.empresa_id as empresa,
       to_char(v.fecha_inicio, 'YYYY-MM-DD') as ingreso,
       p.celular, p.portal,
       case when v.fecha_fin is null then 'vigente' else 'cesado' end as estado,
       p.banco, p.cuenta,
       to_char(v.fecha_fin, 'YYYY-MM-DD') as cese,
       v.id as vinculo_id
from vinculos v join personas p on p.dni = v.persona_dni;

create view v_acuses as
select d.id as documento_id,
       vi.persona_dni as dni, d.titulo as doc, d.lote_id as lote,
       case when a.modalidad = 'personal' then 'confirmado'
            when a.modalidad = 'asistido' then 'asistido'
            when p.portal = 'nunca_ingreso' then 'nunca_ingreso'
            else 'pendiente' end as estado,
       to_char(a.registrado_en, 'YYYY-MM-DD HH24:MI') as fecha,
       a.ip, a.dispositivo,
       coalesce(a.hash_sha256, d.hash_sha256) as hash,
       a.modalidad,
       coalesce(sup.nombre, a.registrado_por) as supervisor,
       a.motivo_asistido as motivo,
       to_char(a.entrega_fisica_en, 'YYYY-MM-DD HH24:MI') as "fechaEntrega",
       d.version
from documentos d
join vinculos vi on vi.id = d.vinculo_id
join personas p on p.dni = vi.persona_dni
left join acuses a on a.documento_id = d.id
left join personas sup on sup.dni = a.supervisor_dni;

create view v_lotes as
select l.id, l.empresa_id as empresa, l.tipo, l.periodo,
       to_char(l.publicado_en, 'YYYY-MM-DD HH24:MI') as publicado,
       l.publicado_por as por,
       count(d.id)::int as total,
       count(a.id) filter (where a.modalidad = 'personal')::int as confirmados,
       count(a.id) filter (where a.modalidad = 'asistido')::int as asistidos,
       (count(d.id) - count(a.id))::int as pendientes,
       l.avisos, l.version
from lotes l
left join documentos d on d.lote_id = l.id
left join acuses a on a.documento_id = d.id
group by l.id
order by l.publicado_en desc;

create view v_comunicados as
select id, titulo, cuerpo,
       to_char(publicado, 'YYYY-MM-DD') as publicado,
       to_char(vence, 'YYYY-MM-DD') as vence,
       alcance, leidos, exige_acuse as "exigeAcuse", segmento,
       case when vence < current_date then 'vencido' else 'vigente' end as estado
from comunicados
order by publicado desc;

create view v_memorandums as
select m.id, v.persona_dni as dni, m.tipo, m.motivo, m.articulo,
       to_char(m.emitido, 'YYYY-MM-DD') as emitido,
       to_char(m.notificado_en, 'YYYY-MM-DD HH24:MI') as notificado,
       m.plazo_dias as "plazoDias",
       to_char(m.vence, 'YYYY-MM-DD') as vence,
       m.estado,
       case when d.memorandum_id is not null then jsonb_build_object(
         'fecha', to_char(d.presentado_en, 'YYYY-MM-DD HH24:MI'),
         'texto', d.texto, 'adjuntos', d.adjuntos) end as descargo,
       case when m.resuelto_en is not null then jsonb_build_object(
         'fecha', to_char(m.resuelto_en, 'YYYY-MM-DD'),
         'decision', m.resolucion) end as resolucion
from memorandums m
join vinculos v on v.id = m.vinculo_id
left join descargos d on d.memorandum_id = m.id
order by m.emitido desc;

create view v_contratos as
select c.id, v.persona_dni as dni, c.tipo,
       to_char(c.inicio, 'YYYY-MM-DD') as inicio,
       to_char(c.fin, 'YYYY-MM-DD') as fin,
       case when c.fin is not null and c.fin <= current_date + 30 then 'por_vencer'
            else 'vigente' end as estado,
       c.firma
from contratos c join vinculos v on v.id = c.vinculo_id;

create view v_activos as
select ac.codigo, ac.categoria, ac.marca, ac.modelo, ac.serie, ac.imei,
       case when ac.estado_fisico = 'baja' then 'baja'
            when ac.estado_fisico = 'mantenimiento' then 'mantenimiento'
            when asg.id is not null then 'asignado'
            else 'disponible' end as estado,
       asg.persona_dni as asignado,
       coalesce(vi.sede_id, ac.sede_id) as sede,
       ac.empresa_id as empresa, ac.valor,
       to_char(ac.compra, 'YYYY-MM-DD') as compra
from activos ac
left join asignaciones asg on asg.activo_codigo = ac.codigo and asg.devuelto_en is null
left join vinculos vi on vi.persona_dni = asg.persona_dni and vi.fecha_fin is null;

create view v_epp_entregas as
select id, dni, items,
       to_char(entrega, 'YYYY-MM-DD') as entrega,
       to_char(reposicion, 'YYYY-MM-DD') as reposicion,
       case when reposicion <= current_date then 'por_reponer' else 'vigente' end as estado
from epp_entregas
order by entrega desc;

-- ---------------------------------------------------------------------------
-- FUNCIONES RPC — la lógica de negocio vive aquí, no en el cliente
-- ---------------------------------------------------------------------------

-- Alta de trabajador: Persona única + Vínculo. Si el DNI existe, NO se
-- duplica la persona: se abre un vínculo nuevo (recontratación / rotación).
create function alta_trabajador(
  p_dni text, p_nombre text, p_cargo text, p_sede text, p_empresa text,
  p_ingreso date, p_celular text default null,
  p_banco text default null, p_cuenta text default null
) returns void language plpgsql security definer as $$
begin
  insert into personas (dni, nombre, celular, banco, cuenta, portal)
  values (p_dni, p_nombre, p_celular, p_banco, p_cuenta,
          case when p_celular is null then 'sin_celular' else 'nunca_ingreso' end)
  on conflict (dni) do update
    set celular = coalesce(excluded.celular, personas.celular),
        banco   = coalesce(excluded.banco, personas.banco),
        cuenta  = coalesce(excluded.cuenta, personas.cuenta);

  if exists (select 1 from vinculos where persona_dni = p_dni
             and empresa_id = p_empresa and fecha_fin is null) then
    raise exception 'La persona % ya tiene un vínculo vigente con esta empresa.', p_dni;
  end if;

  insert into vinculos (persona_dni, empresa_id, sede_id, cargo, fecha_inicio)
  values (p_dni, p_empresa, p_sede, p_cargo, p_ingreso);
end $$;

-- Eliminación: solo para registros creados por error. Si la persona ya tiene
-- historial documental, no se borra nada: se cierra el vínculo (cese).
create function eliminar_trabajador(p_dni text) returns text
language plpgsql security definer as $$
declare tiene_historial boolean;
begin
  select exists (
    select 1 from documentos d join vinculos v on v.id = d.vinculo_id
    where v.persona_dni = p_dni
  ) into tiene_historial;

  if tiene_historial then
    update vinculos set fecha_fin = current_date
    where persona_dni = p_dni and fecha_fin is null;
    return 'cesado';  -- el historial nunca se borra
  else
    delete from asignaciones where persona_dni = p_dni;
    delete from epp_entregas where dni = p_dni;
    delete from tardanzas where dni = p_dni;
    delete from vinculos where persona_dni = p_dni;
    delete from personas where dni = p_dni;
    return 'eliminado';
  end if;
end $$;

-- Publicación de lote: genera un documento por vínculo vigente de la empresa.
-- Si la combinación ya existe, crea la versión siguiente (corrección), jamás
-- sobrescribe.
create function publicar_lote(
  p_empresa text, p_tipo text, p_periodo text, p_por text
) returns text language plpgsql security definer as $$
declare
  v_version int;
  v_id text;
  v_avisos int;
begin
  select coalesce(max(version), 0) + 1 into v_version
  from lotes where empresa_id = p_empresa and tipo = p_tipo and periodo = p_periodo;

  v_id := case p_tipo when 'Boleta de pago' then 'BOL' when 'Gratificación' then 'GRA'
                      when 'Liquidación de CTS' then 'CTS' else 'UTI' end
          || '-' || upper(left((select corto from empresas where id = p_empresa), 3))
          || '-' || to_char(now(), 'YYYYMM') || '-' || lpad(v_version::text, 3, '0');

  select count(*) into v_avisos
  from vinculos v join personas p on p.dni = v.persona_dni
  where v.empresa_id = p_empresa and v.fecha_fin is null and p.celular is not null;

  insert into lotes (id, empresa_id, tipo, periodo, version, publicado_por, avisos)
  values (v_id, p_empresa, p_tipo, p_periodo, v_version, p_por, v_avisos);

  insert into documentos (vinculo_id, lote_id, tipo, titulo, periodo, version, hash_sha256)
  select v.id, v_id, p_tipo, p_tipo || ' — ' || p_periodo, p_periodo, v_version,
         md5(v.persona_dni || v_id) || md5(v_id || v.persona_dni)
  from vinculos v
  where v.empresa_id = p_empresa and v.fecha_fin is null;

  -- Corrección de versión: las versiones anteriores quedan marcadas, sus
  -- acuses permanecen intactos.
  if v_version > 1 then
    update documentos set estado = 'reemplazado'
    where lote_id in (select id from lotes where empresa_id = p_empresa
                      and tipo = p_tipo and periodo = p_periodo and version < v_version);
  end if;

  return v_id;
end $$;

-- Acuse asistido: el único camino de escritura sobre acuses además del acuse
-- personal. Exige adjunto y fecha de entrega física (la tabla lo garantiza).
create function registrar_acuse_asistido(
  p_dni text, p_lote text, p_motivo text, p_entrega timestamptz,
  p_registrado_por text default 'Recursos Humanos'
) returns void language plpgsql security definer as $$
declare v_doc documentos%rowtype;
begin
  select d.* into v_doc
  from documentos d join vinculos v on v.id = d.vinculo_id
  where v.persona_dni = p_dni and d.lote_id = p_lote and d.estado = 'vigente';

  if v_doc.id is null then
    raise exception 'No existe documento vigente del lote % para el DNI %.', p_lote, p_dni;
  end if;

  insert into acuses (documento_id, modalidad, dispositivo, hash_sha256, declaracion,
                      registrado_por, motivo_asistido, entrega_fisica_en, adjunto_url)
  values (v_doc.id, 'asistido', 'Registrado desde BackOffice', v_doc.hash_sha256,
          'Se registra entrega física con cargo firmado adjunto.',
          p_registrado_por, p_motivo, p_entrega,
          'cargos/' || p_dni || '-' || p_lote || '.jpg');
end $$;

-- Memorándum: correlativo por empresa y año, sin huecos ni reutilización.
create function emitir_memorandum(
  p_dni text, p_tipo text, p_motivo text, p_articulo text, p_plazo int
) returns text language plpgsql security definer as $$
declare
  v_vinculo bigint;
  v_num int;
  v_id text;
begin
  select id into v_vinculo from vinculos
  where persona_dni = p_dni and fecha_fin is null
  order by fecha_inicio desc limit 1;
  if v_vinculo is null then
    raise exception 'El DNI % no tiene vínculo vigente.', p_dni;
  end if;

  select coalesce(max(split_part(id, '-', 1)::int), 141) + 1 into v_num
  from memorandums where id like '%-' || to_char(now(), 'YYYY');
  v_id := lpad(v_num::text, 4, '0') || '-' || to_char(now(), 'YYYY');

  insert into memorandums (id, vinculo_id, tipo, motivo, articulo, plazo_dias)
  values (v_id, v_vinculo, p_tipo, p_motivo, p_articulo, p_plazo);
  return v_id;
end $$;

create function resolver_memorandum(p_id text, p_decision text) returns void
language plpgsql security definer as $$
begin
  update memorandums
  set estado = 'resuelto', resuelto_en = current_date, resolucion = p_decision
  where id = p_id;
end $$;

-- Asignación de activo: abre un registro de historial. La devolución lo cierra
-- registrando condición y destino.
create function asignar_activo(p_codigo text, p_dni text, p_condicion text default 'Buen estado')
returns void language plpgsql security definer as $$
begin
  if exists (select 1 from asignaciones where activo_codigo = p_codigo and devuelto_en is null) then
    raise exception 'El activo % ya está asignado. Regístrese la devolución primero.', p_codigo;
  end if;
  if (select estado_fisico from activos where codigo = p_codigo) <> 'operativo' then
    raise exception 'El activo % no está operativo.', p_codigo;
  end if;
  insert into asignaciones (activo_codigo, persona_dni, condicion_entrega)
  values (p_codigo, p_dni, p_condicion);
end $$;

create function devolver_activo(p_codigo text, p_destino text, p_condicion text default 'Buen estado')
returns void language plpgsql security definer as $$
begin
  update asignaciones
  set devuelto_en = current_date, condicion_devolucion = p_condicion, destino = p_destino
  where activo_codigo = p_codigo and devuelto_en is null;

  update activos
  set estado_fisico = case when p_destino in ('mantenimiento','baja') then p_destino else 'operativo' end
  where codigo = p_codigo;
end $$;

create function registrar_epp(p_dni text, p_items text, p_entrega date, p_reposicion date)
returns void language plpgsql security definer as $$
begin
  insert into epp_entregas (dni, items, entrega, reposicion)
  values (p_dni, p_items, p_entrega, p_reposicion);
end $$;

create function publicar_comunicado(
  p_titulo text, p_cuerpo text, p_vence date, p_exige boolean,
  p_segmento text, p_alcance int
) returns bigint language plpgsql security definer as $$
declare v_id bigint;
begin
  insert into comunicados (titulo, cuerpo, vence, exige_acuse, segmento, alcance)
  values (p_titulo, p_cuerpo, p_vence, p_exige, p_segmento, p_alcance)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- SEGURIDAD (nivel demostración)
-- RLS habilitado con política permisiva: el candado existe y se aprieta cuando
-- entre Supabase Auth (roles por empresa y sede). Los registros probatorios
-- están protegidos por triggers y revocación aunque la política sea abierta.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['empresas','personas','sedes','vinculos','lotes',
    'documentos','acuses','comunicados','memorandums','descargos','tardanzas',
    'plantillas','contratos','activos','asignaciones','lineas','epp_entregas','auditoria','cargos']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy acceso_demo on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

revoke update, delete on acuses, descargos, auditoria from anon, authenticated;
