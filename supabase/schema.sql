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
  v_contratos, v_epp_entregas, v_comunicados, v_memorandums,
  v_rit_faltas, v_tipos_sancion cascade;
drop table if exists auditoria, epp_entregas, lineas, asignaciones, activos,
  contratos, plantillas, tardanzas, descargos, memorandums, comunicados,
  acuses, documentos, lotes, vinculos, personas, sedes, empresas, cargos,
  rit_faltas, tipos_sancion, feriados, rits cascade;
drop function if exists fn_bloquear_cambios, fn_auditar, alta_trabajador,
  eliminar_trabajador, publicar_lote, registrar_acuse_asistido,
  emitir_memorandum, resolver_memorandum, asignar_activo, devolver_activo,
  registrar_epp, publicar_comunicado, fn_solo_empresa_activa,
  fn_es_prefijo_truncado, fn_sede_para_importacion, importar_planilla,
  previsualizar_importacion, publicar_lote_pdf, fn_valor_importado,
  importar_activos, previsualizar_importacion_activos, crear_sede,
  editar_activo, fn_sumar_dias, notificar_memorandum cascade;

-- ---------------------------------------------------------------------------
-- NÚCLEO ORGANIZACIONAL
-- ---------------------------------------------------------------------------
-- RIT por empresa (2026-08-17): hoy todas usan el de CLEAN (decisión de
-- Diego); los números de artículo NO son transferibles entre reglamentos.
create table rits (
  id            text primary key,
  nombre        text not null,
  vigente_desde date
);
insert into rits (id, nombre, vigente_desde)
values ('clean-2025', 'Reglamento Interno de Trabajo — CONSORCIO CLEAN 2025', '2025-01-01');

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
  rit_id    text not null default 'clean-2025' references rits(id),
  creado_en timestamptz not null default now()
);

create table personas (
  dni                   text primary key check (dni ~ '^[0-9]{8}$'),
  nombre                text not null,
  celular               text,  -- LIBRE: puede venir con +51 o espacios (Excels de planilla)
  direccion             text,
  banco                 text,
  cuenta                text,
  portal                text not null default 'nunca_ingreso'
    check (portal in ('activo','nunca_ingreso','sin_celular','suspendido')),
  nombre_por_confirmar  boolean not null default false,
  creado_en             timestamptz not null default now()
);

create sequence if not exists seq_sede_codigo;
create table sedes (
  id             text primary key,
  codigo         text unique,               -- S-0001, S-0002… (crear_sede / importación)
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
  leidos       integer not null default 0,
  -- Segmentación ESTRUCTURAL (2026-08-17): null = todo el grupo. El texto
  -- `segmento` queda solo para mostrar.
  empresa_id   text references empresas(id),
  sede_id      text references sedes(id)
);

-- ---------------------------------------------------------------------------
-- DISCIPLINA: MEMORÁNDUM → DESCARGO (único) → RESOLUCIÓN
-- ---------------------------------------------------------------------------
-- 2 · Catálogo de faltas: texto LITERAL del RIT (art. 20 prohibiciones a–r,
--     art. 56 causales 1–31). El documento generado imprime la obligación
--     textual, no solo el número.
create table if not exists rit_faltas (
  id       bigint generated always as identity primary key,
  rit_id   text not null references rits(id),
  articulo integer not null,
  item     text not null,
  texto    text not null,
  unique (rit_id, articulo, item)
);

insert into rit_faltas (rit_id, articulo, item, texto) values
  ('clean-2025', 20, 'a', 'Disminuya intencionalmente el ritmo de trabajo o lo suspenda unilateralmente en forma intempestiva.'),
  ('clean-2025', 20, 'b', 'Marque la tarjeta de control de asistencia diaria de otro trabajador, deje de marcar la suya, se haga reemplazar y/o borre o altere cualquiera de ellas.'),
  ('clean-2025', 20, 'c', 'Deje su puesto sin la debida autorización de su jefe inmediato.'),
  ('clean-2025', 20, 'd', 'Maneje u opere equipos, máquinas, vehículos, etc., de la empresa, sin la debida autorización.'),
  ('clean-2025', 20, 'e', 'Introduzca al centro de trabajo o distribuya dentro de él, material impreso ajeno al desempeño de su labor.'),
  ('clean-2025', 20, 'f', 'Comunique o difunda, por cualquier medio, expresiones atentatorias contra la moral, la armonía laboral, el buen nombre de la empresa, la dignidad y el prestigio de sus trabajadores.'),
  ('clean-2025', 20, 'g', 'Ingrese o egrese del centro de trabajo con teléfonos, radio, grabadora, máquina fotográfica, paquetes, bolsos, maletines, etc., sin la debida autorización previa del jefe inmediato.'),
  ('clean-2025', 20, 'h', 'Duerma durante la jornada de trabajo, en el puesto asignado.'),
  ('clean-2025', 20, 'i', 'Efectúe colectas, rifas, polladas, suscripciones, o ventas de cualquier índole o clase de artículos en el centro de trabajo.'),
  ('clean-2025', 20, 'j', 'Coloque carteles o efectúe inscripciones impertinentes en los locales y/o bienes de la empresa.'),
  ('clean-2025', 20, 'k', 'Leer periódicos, revistas, libros, etc., dentro de su jornada de trabajo, salvo los que estén autorizados y guarden relación con la función que desempeñe.'),
  ('clean-2025', 20, 'l', 'Utilice el teléfono, fax, etc., para asuntos particulares y sin la debida autorización de su jefe inmediato.'),
  ('clean-2025', 20, 'm', 'Fume en las instalaciones del centro de trabajo.'),
  ('clean-2025', 20, 'n', 'Ingrese a las zonas de labor fuera de las horas correspondientes a su turno de trabajo, o quedarse en las instalaciones después de haber concluido su jornada de trabajo.'),
  ('clean-2025', 20, 'ñ', 'Ingrese a otras dependencias de la empresa usuaria que no sean sus respectivas áreas de trabajo, excepto cuando sea por asuntos propios de sus obligaciones laborales y tengan la debida autorización.'),
  ('clean-2025', 20, 'o', 'Viole o fracture un escritorio, gavetero o casillero asignado a otro trabajador.'),
  ('clean-2025', 20, 'p', 'Se niegue a usar durante la jornada laboral el uniforme de trabajo que le proporciona la empresa.'),
  ('clean-2025', 20, 'q', 'Falte a las normas y estándares de calidad y productividad vigentes en la empresa.'),
  ('clean-2025', 20, 'r', 'Hacer valer su condición de servidor de la empresa para obtener ventajas de cualquier índole ante terceros.'),
  ('clean-2025', 56, '1', 'Incurrir en las prohibiciones señaladas en el artículo 20.'),
  ('clean-2025', 56, '2', 'Faltar injustificadamente al trabajo.'),
  ('clean-2025', 56, '3', 'Llegar con frecuencia fuera de la hora de ingreso al trabajo, o retirarse antes del horario de salida.'),
  ('clean-2025', 56, '4', 'Cometer dentro de las horas de trabajo o fuera de ellas, actos contrarios a la moral y las buenas costumbres.'),
  ('clean-2025', 56, '5', 'Incurrir en faltamiento de palabra o agresión física al superior o compañeros de trabajo durante la jornada de trabajo o durante el refrigerio.'),
  ('clean-2025', 56, '6', 'Evidenciar negligencia e ineficacia en la realización del trabajo o al cargo encomendado.'),
  ('clean-2025', 56, '7', 'Emitir o difundir públicamente informaciones sobre asuntos relacionados con la empresa sin autorización previa.'),
  ('clean-2025', 56, '8', 'Simular enfermedad.'),
  ('clean-2025', 56, '9', 'Colocar ilustraciones, afiches, grabados, cuadros, leyendas y almanaques inapropiados, en oficinas, talleres o cualquier otro ambiente de la empresa.'),
  ('clean-2025', 56, '10', 'Aceptar recompensa o dádiva de cualquier persona, por realizar u omitir actos vinculados con su función.'),
  ('clean-2025', 56, '11', 'Valerse de su condición de trabajador de la empresa para obtener beneficios personales.'),
  ('clean-2025', 56, '12', 'Aprovechar los poderes y atribuciones que le confiere el cargo o puesto de trabajo para beneficio propio o de terceros.'),
  ('clean-2025', 56, '13', 'Utilizar indebidamente el fotocheck o la tarjeta de identificación u otros dispositivos de control interno y vigilancia de la empresa.'),
  ('clean-2025', 56, '14', 'Impedir o dificultar la labor de control a cargo del personal de vigilancia y de protección de planta.'),
  ('clean-2025', 56, '15', 'Adulterar o falsificar documentos de la empresa.'),
  ('clean-2025', 56, '16', 'Cambiarse de ropa, asearse fuera de los lugares establecidos o indicados por la empresa durante la jornada de trabajo.'),
  ('clean-2025', 56, '17', 'Proferir palabras injuriosas en contra de sus superiores y/o compañeros de trabajo, dentro o fuera de la empresa.'),
  ('clean-2025', 56, '18', 'Efectuar celebraciones y festejos en oficinas y talleres, o en cualquier otro ambiente de la empresa no asignado ni autorizado para tal efecto.'),
  ('clean-2025', 56, '19', 'Distraer a sus compañeros en horas de labor, proporcionando periódicos, revistas, libros, folletos, etc., o formando aglomeraciones o tertulias que alteren la disciplina y el normal desenvolvimiento del trabajo.'),
  ('clean-2025', 56, '20', 'Realizar negocios, actividades particulares de lucro (polladas), juegos de azar, envite, erogaciones, rifas y/o desatender sus labores para atender a vendedores o cobradores particulares, o cualquier otra actividad ajena al cumplimiento de sus obligaciones.'),
  ('clean-2025', 56, '21', 'Concurrir al trabajo con síntomas de ebriedad o embriagarse en horas de labor, alterar el orden y la disciplina.'),
  ('clean-2025', 56, '22', 'Portar armas en el centro de trabajo.'),
  ('clean-2025', 56, '23', 'Cometer robos o hurtos, sustracción de bienes en agravio de la empresa o sus compañeros de trabajo.'),
  ('clean-2025', 56, '24', 'Fumar en los ambientes de la empresa o hacer fuego en lugares prohibidos.'),
  ('clean-2025', 56, '25', 'Hacer uso de términos impropios que lesionen a cualquiera de las partes a través de comunicados, avisos o publicaciones que se hagan en pizarrines, vitrinas o en cualquier otro medio de comunicación.'),
  ('clean-2025', 56, '26', 'Permitir a otros trabajadores o personas ajenas a la empresa la conducción de vehículos, la operación de máquinas, equipos, instrumentos y aparatos confiados a su cuidado y responsabilidad.'),
  ('clean-2025', 56, '27', 'Negarse injustificadamente a participar y asistir a los cursos de entrenamiento o capacitación que programe y organice la empresa.'),
  ('clean-2025', 56, '28', 'Intimidar a los compañeros de trabajo para encubrir actos de negligencia en perjuicio de la empresa, de otros trabajadores o que pongan en riesgo la seguridad.'),
  ('clean-2025', 56, '29', 'Usar temerariamente los bienes e instalaciones de la empresa o de nuestros clientes, causando intencionalmente o por descuido inexcusable, daños, averías o cualquier otro perjuicio a la empresa, servicios sanitarios, muebles, materiales, útiles, maquinarias, herramientas, equipos o aparatos.'),
  ('clean-2025', 56, '30', 'Extraviar por descuido o negligencia los materiales, útiles, herramientas, equipos o aparatos que proporciona la empresa para el desempeño de su función.'),
  ('clean-2025', 56, '31', 'Discriminar y/o estigmatizar a algún trabajador en razón de su fe religiosa, por portar enfermedad incurable u otras razones; constituye infracción grave.')
on conflict (rit_id, articulo, item) do nothing;

-- 3 · Tipos de proceso disciplinario (art. 53 + preavisos del art. 31 LPCL).
--     Los plazos de sanción son PARÁMETRO (el RIT no los fija; sugeridos del
--     documento de parametrización, editables cuando se modifique el RIT).
--     Los de preaviso son imperativos de ley y no se tocan.
create table if not exists tipos_sancion (
  id                   text not null,
  rit_id               text not null references rits(id),
  nombre               text not null,
  naturaleza           text not null check (naturaleza in ('sancion','imputacion','decision')),
  notificable          boolean not null default true,  -- verbal = registro interno, sin carta
  plazo_descargo_dias  integer,                        -- null = sin plazo de descargo
  plazo_habil          boolean not null default true,  -- sanciones hábiles; preavisos naturales
  tope_suspension_dias integer,
  nivel_minimo         integer not null default 2,     -- nivel requerido en el módulo memorandums
  fuente_plazo         text,
  via_notificacion     text,
  primary key (id, rit_id)
);

insert into tipos_sancion (id, rit_id, nombre, naturaleza, notificable, plazo_descargo_dias,
                           plazo_habil, tope_suspension_dias, nivel_minimo, fuente_plazo, via_notificacion) values
  ('amonestacion-verbal',  'clean-2025', 'Amonestación verbal',            'sancion',    false, null, true,  null, 2, null, 'Registro interno; reporte a RR.HH. dentro de 24 horas (art. 53 a)'),
  ('amonestacion-escrita', 'clean-2025', 'Amonestación escrita',           'sancion',    true,  3,    true,  null, 2, 'Parámetro (RIT por modificar)', 'Electrónica con acuse; física con cargo si no acusa'),
  ('suspension',           'clean-2025', 'Suspensión sin goce de haber',   'sancion',    true,  5,    true,  3,    3, 'Parámetro (RIT por modificar)', 'Electrónica con acuse; física con cargo si no acusa'),
  ('preaviso-conducta',    'clean-2025', 'Preaviso de despido — conducta', 'imputacion', true,  6,    false, null, 3, 'Art. 31 LPCL (imperativo)', 'Notarial obligatoria'),
  ('preaviso-capacidad',   'clean-2025', 'Preaviso de despido — capacidad','imputacion', true,  30,   false, null, 3, 'Art. 31 LPCL (imperativo)', 'Notarial obligatoria'),
  ('despido',              'clean-2025', 'Carta de despido',               'decision',   true,  null, true,  null, 3, null, 'Notarial / juez de paz / policía (art. 32 LPCL)')
on conflict (id, rit_id) do nothing;

-- 4 · Feriados (para el cómputo de días hábiles: SÁBADO cuenta, domingos y
--     feriados no — decisión de Diego). Cargar cada año; seed Perú 2026.
create table if not exists feriados (
  fecha  date primary key,
  nombre text not null
);
insert into feriados (fecha, nombre) values
  ('2026-01-01', 'Año Nuevo'),
  ('2026-04-02', 'Jueves Santo'),
  ('2026-04-03', 'Viernes Santo'),
  ('2026-05-01', 'Día del Trabajo'),
  ('2026-06-07', 'Batalla de Arica y Día de la Bandera'),
  ('2026-06-29', 'San Pedro y San Pablo'),
  ('2026-07-23', 'Día de la Fuerza Aérea'),
  ('2026-07-28', 'Fiestas Patrias'),
  ('2026-07-29', 'Fiestas Patrias'),
  ('2026-08-06', 'Batalla de Junín'),
  ('2026-08-30', 'Santa Rosa de Lima'),
  ('2026-10-08', 'Combate de Angamos'),
  ('2026-11-01', 'Todos los Santos'),
  ('2026-12-08', 'Inmaculada Concepción'),
  ('2026-12-09', 'Batalla de Ayacucho'),
  ('2026-12-25', 'Navidad')
on conflict (fecha) do nothing;

-- 5 · Motor de plazos: hábiles (sábado sí, domingo y feriado no) o naturales.
create or replace function fn_sumar_dias(p_desde date, p_dias int, p_habiles boolean)
returns date language plpgsql stable as $$
declare v date := p_desde; n int := 0;
begin
  if p_dias is null or p_dias <= 0 then return p_desde; end if;
  if not p_habiles then return p_desde + p_dias; end if;
  while n < p_dias loop
    v := v + 1;
    if extract(dow from v) <> 0 and not exists (select 1 from feriados where fecha = v) then
      n := n + 1;
    end if;
  end loop;
  return v;
end $$;

create table memorandums (
  id            text primary key,            -- correlativo por empresa y año, sin huecos
  vinculo_id    bigint not null references vinculos(id),
  tipo          text not null,               -- nombre del tipo (denormalizado del catálogo)
  motivo        text not null,
  articulo      text,
  emitido       date not null default current_date,
  notificado_en timestamptz,                 -- el plazo corre desde AQUÍ, no desde la emisión
  plazo_dias    integer not null default 5,
  vence         date,
  estado        text not null default 'emitido_sin_notificar'
    check (estado in ('emitido_sin_notificar','notificado','en_plazo',
                      'descargo_presentado','vencido','resuelto','registro_interno')),
  resuelto_en   date,
  resolucion    text,
  -- Disciplinario parametrizado por RIT (2026-08-17):
  tipo_sancion_id text,                      -- id en tipos_sancion
  falta_id      bigint references rit_faltas(id),
  falta_texto   text,                        -- LITERAL congelado al emitir
  antecedentes  jsonb,                       -- historial congelado (art. 54)
  reincidencia  boolean not null default false,  -- derivada (art. 58)
  suspension_dias integer
    check (suspension_dias is null or suspension_dias between 1 and 3)
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
  codigo        text primary key,            -- identidad del activo (global)
  categoria     text not null
    -- Telefonía se fusionó en Comunicaciones (2026-08-17): eran lo mismo.
    check (categoria in ('Cómputo','Comunicaciones','Maquinaria')),
  -- marca/modelo/serie opcionales desde la importación de inventario (el
  -- Formato 7.1 real trae vacíos y procesadores en la columna de serie); la
  -- serie repetida se vigila como advertencia del parser, no por unicidad.
  marca         text,
  modelo        text,
  serie         text,
  imei          text unique,                 -- único en todo el sistema
  estado_fisico text not null default 'operativo'
    check (estado_fisico in ('operativo','mantenimiento','baja')),
  sede_id       text references sedes(id),   -- ubicación cuando no está asignado
  empresa_id    text not null references empresas(id),  -- propietaria (costeo/contabilidad)
  valor         numeric(12,2) not null default 0,
  compra        date,
  tipo          text,                        -- LAPTOP/PC/IMPRESORA/… (detalle del archivo)
  area          text,                        -- separadora de área del inventario
  asignado_sin_confirmar text,               -- texto USUARIO del archivo: NO vincula al maestro
  usuario_anterior text,                     -- historial textual del archivo
  observaciones text,
  por_corregir  boolean not null default false, -- código repetido en el archivo: falta corregir
  constraint imei_solo_comunicaciones check (imei is null or categoria = 'Comunicaciones')
);

create table asignaciones (
  id                   bigint generated always as identity primary key,
  -- on update cascade: corregir el código de un activo arrastra su historial.
  activo_codigo        text not null references activos(codigo) on update cascade,
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
  equipo   text references activos(codigo) on update cascade,
  paga     text not null references empresas(id),  -- RS que PAGA (hoy todas: PROMANT)
  usa      text references empresas(id),           -- RS que la USA (null = por asignar)
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

-- Código de sede para el seed (mismo backfill idempotente de la migración).
do $$
declare s record;
begin
  for s in select id from sedes where codigo is null order by creado_en, id loop
    update sedes set codigo = 'S-' || lpad(nextval('seq_sede_codigo')::text, 4, '0')
    where id = s.id;
  end loop;
end $$;

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
  ('0142-2026', '45231876', 'Amonestación verbal', 'Tardanzas reiteradas — 2 tardanzas, 18 minutos en julio 2026', 'Art. 12 RIT',
   '2026-08-05', '2026-08-05 18:40-05', 5, '2026-08-12', 'descargo_presentado', null, null),
  ('0141-2026', '47893456', 'Amonestación escrita', 'Abandono de puesto el 28 de julio sin autorización del supervisor', 'Art. 15 RIT',
   '2026-08-01', null, 5, null, 'emitido_sin_notificar', null, null),
  ('0140-2026', '42345987', 'Amonestación verbal', 'Tardanzas reiteradas — 3 tardanzas, 35 minutos en junio 2026', 'Art. 12 RIT',
   '2026-07-10', '2026-07-11 08:30-05', 5, '2026-07-18', 'resuelto', '2026-07-21',
   'Se mantiene la sanción. El trabajador no presentó descargo dentro del plazo.')
) as m(id, dni, tipo, motivo, articulo, emitido, notificado, plazo, vence, estado, resuelto, resolucion)
join vinculos v on v.persona_dni = m.dni and v.empresa_id = 'negliaf' and v.fecha_fin is null;

-- Migración de los tipos viejos a los nombres del RIT.
update memorandums set tipo = 'Amonestación verbal', tipo_sancion_id = 'amonestacion-verbal'
where tipo = 'Llamada de atención';
update memorandums set tipo_sancion_id = 'amonestacion-escrita'
where tipo = 'Amonestación escrita' and tipo_sancion_id is null;
update memorandums set tipo = 'Preaviso de despido — conducta', tipo_sancion_id = 'preaviso-conducta'
where tipo = 'Preaviso de despido';

-- Corrección del expediente demo mal tipificado (doc de parametrización):
-- 0141-2026 «abandono de puesto» → art. 20 c) concordado con art. 56.1.
update memorandums m
set falta_id = f.id,
    articulo = 'Art. 20 c) conc. 56.1 RIT',
    falta_texto = 'Art. 20 inciso c): «' || f.texto || '» — concordado con el Art. 56 numeral 1'
from rit_faltas f
where m.id = '0141-2026' and f.rit_id = 'clean-2025' and f.articulo = 20 and f.item = 'c'
  and m.falta_id is null;

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
  ('TEL-0012', 'Comunicaciones', 'Samsung',  'Galaxy A15',            'SM-A155M-8871', '358240051111110', 'operativo',     null,    'negliaf', 620,  '2026-01-15'),
  ('TEL-0013', 'Comunicaciones', 'Samsung',  'Galaxy A15',            'SM-A155M-8872', '358240051111128', 'operativo',     null,    'negliaf', 620,  '2026-01-15'),
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
select s.id, s.empresa_id as empresa, s.nombre, s.cliente, p.nombre as supervisor,
       s.codigo, s.direccion, s.estado
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

create view v_rit_faltas as
select f.id, f.rit_id, f.articulo, f.item, f.texto
from rit_faltas f
order by f.articulo, case when f.item ~ '^\d+$' then lpad(f.item, 3, '0') else f.item end;

create view v_tipos_sancion as
select id, rit_id, nombre, naturaleza, notificable,
       plazo_descargo_dias as "plazoDias", plazo_habil as "plazoHabil",
       tope_suspension_dias as "topeSuspension", nivel_minimo as "nivelMinimo",
       fuente_plazo as "fuentePlazo", via_notificacion as "viaNotificacion"
from tipos_sancion;

create view v_memorandums as
select m.id, v.persona_dni as dni, m.tipo, m.motivo, m.articulo,
       to_char(m.emitido, 'YYYY-MM-DD') as emitido,
       to_char(m.notificado_en, 'YYYY-MM-DD HH24:MI') as notificado,
       m.plazo_dias as "plazoDias",
       to_char(m.vence, 'YYYY-MM-DD') as vence,
       -- El vencimiento se deriva al vuelo: nadie tiene que "marcar" vencidos.
       case when m.estado in ('notificado','en_plazo') and m.vence < current_date
            then 'vencido' else m.estado end as estado,
       case when d.memorandum_id is not null then jsonb_build_object(
         'fecha', to_char(d.presentado_en, 'YYYY-MM-DD HH24:MI'),
         'texto', d.texto, 'adjuntos', d.adjuntos) end as descargo,
       case when m.resuelto_en is not null then jsonb_build_object(
         'fecha', to_char(m.resuelto_en, 'YYYY-MM-DD'),
         'decision', m.resolucion) end as resolucion,
       m.tipo_sancion_id as "tipoSancionId",
       t.naturaleza,
       m.falta_texto as "faltaTexto",
       m.reincidencia,
       m.antecedentes,
       m.suspension_dias as "suspensionDias",
       -- Preaviso vencido sin acuse: alerta de notificación notarial (la vía
       -- subsidiaria con fecha computable; sin esto se rompe la inmediatez).
       (t.naturaleza = 'imputacion' and m.estado in ('notificado','en_plazo')
        and m.vence < current_date and d.memorandum_id is null) as "preavisoVencido"
from memorandums m
join vinculos v on v.id = m.vinculo_id
left join descargos d on d.memorandum_id = m.id
left join tipos_sancion t on t.id = m.tipo_sancion_id
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
       to_char(ac.compra, 'YYYY-MM-DD') as compra,
       ac.tipo, ac.area, ac.asignado_sin_confirmar, ac.usuario_anterior, ac.observaciones,
       ac.por_corregir
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

-- Task 13: publicar_lote_pdf — publicación transaccional de un lote de
-- boletas ya partidas (Task 11) y subidas a Storage con nombre por hash
-- (Task 12). A diferencia de publicar_lote (que genera un documento por cada
-- vínculo vigente con un hash sintético), aquí el lote y el hash vienen del
-- PDF real: nada se publica sin trabajador identificado (dni+hash+
-- archivo_url obligatorios), un DNI sin vínculo vigente o repetido dentro del
-- lote rechaza TODO (validación previa, antes de escribir una sola fila), y
-- el versionado es idéntico a publicar_lote (v+1, las versiones previas
-- quedan 'reemplazado', los acuses jamás se tocan). p_boletas trae más claves
-- de las que usa esta función (ruc, periodoCabecera, periodoPago del parser
-- de Task 10): se ignoran sin error, solo se leen dni/hash/archivo_url/
-- nombre/neto por ->>'clave'.
-- NOTA de orden: documentos.archivo_url se crea en supabase/portal.sql, no
-- aquí; plpgsql no valida columnas al CREATE (solo al ejecutar), así que este
-- reset ordinario (schema.sql → portal.sql → migraciones/*) sigue siendo
-- válido, pero la función queda inejecutable hasta que portal.sql corra.
create function publicar_lote_pdf(
  p_empresa text, p_tipo text, p_periodo text, p_por text, p_boletas jsonb
) returns jsonb language plpgsql security definer as $$
declare
  b jsonb; v_version int; v_id text; v_avisos int; v_vinculo bigint; v_docs int := 0;
begin
  -- Validación previa completa: entra todo o no entra nada.
  for b in select * from jsonb_array_elements(p_boletas) loop
    if coalesce(b->>'dni','') = '' or coalesce(b->>'hash','') = '' or coalesce(b->>'archivo_url','') = '' then
      raise exception 'Boleta sin trabajador identificado o sin archivo: nada se publica así.';
    end if;
    if not exists (select 1 from vinculos where persona_dni = b->>'dni'
                   and empresa_id = p_empresa and fecha_fin is null) then
      raise exception 'El DNI % no tiene vínculo vigente en la empresa: excepción sin resolver.', b->>'dni';
    end if;
  end loop;
  if (select count(distinct x->>'dni') from jsonb_array_elements(p_boletas) x)
     <> (select count(*) from jsonb_array_elements(p_boletas)) then
    raise exception 'Hay DNI repetidos en el lote: excepción sin resolver.';
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from lotes where empresa_id = p_empresa and tipo = p_tipo and periodo = p_periodo;
  v_id := case p_tipo when 'Boleta de pago' then 'BOL' when 'Gratificación' then 'GRA'
                      when 'Liquidación de CTS' then 'CTS' else 'UTI' end
          || '-' || upper(left((select corto from empresas where id = p_empresa), 3))
          || '-' || replace(p_periodo, '-', '') || '-' || lpad(v_version::text, 3, '0');

  -- avisos es "cuántos de ESTE lote" (los DNIs que vienen en p_boletas), no
  -- todos los vínculos con celular de la empresa entera.
  select count(*) into v_avisos from vinculos v join personas p on p.dni = v.persona_dni
  where v.empresa_id = p_empresa and v.fecha_fin is null and p.celular is not null
    and v.persona_dni in (select x->>'dni' from jsonb_array_elements(p_boletas) x);

  insert into lotes (id, empresa_id, tipo, periodo, version, publicado_por, avisos)
  values (v_id, p_empresa, p_tipo, p_periodo, v_version, p_por, v_avisos);

  for b in select * from jsonb_array_elements(p_boletas) loop
    select id into v_vinculo from vinculos
    where persona_dni = b->>'dni' and empresa_id = p_empresa and fecha_fin is null;
    -- El PDF puede traer datos MÁS completos que el Excel (sede completa);
    -- solo se mejora, nunca se degrada a un prefijo.
    update personas set nombre = case
        when b->>'nombre' is null then nombre
        when fn_es_prefijo_truncado(b->>'nombre', nombre) then nombre
        when length(trim(b->>'nombre')) > length(nombre) then trim(b->>'nombre') else nombre end
    where dni = b->>'dni';
    -- Misma regla anti-prefijo aplica a sedes.nombre (sede del vínculo
    -- guardada truncada por un Excel viejo, el PDF trae el nombre completo) y
    -- a vinculos.cargo (el PDF trunca el cargo a 20 caracteres; jamás se
    -- degrada el cargo completo ya guardado a esa versión truncada).
    if b->>'sede' is not null then
      update sedes set nombre = trim(b->>'sede')
      where id = (select sede_id from vinculos where id = v_vinculo)
        and fn_es_prefijo_truncado(nombre, trim(b->>'sede'));
    end if;
    if b->>'cargo' is not null then
      update vinculos set cargo = trim(b->>'cargo')
      where id = v_vinculo
        and not fn_es_prefijo_truncado(trim(b->>'cargo'), cargo)
        and cargo is distinct from trim(b->>'cargo');
    end if;
    insert into documentos (vinculo_id, lote_id, tipo, titulo, periodo, version, hash_sha256, neto)
    values (v_vinculo, v_id, p_tipo, p_tipo || ' — ' || p_periodo, p_periodo, v_version,
            b->>'hash', nullif(b->>'neto','')::numeric);
    update documentos set archivo_url = b->>'archivo_url'
    where lote_id = v_id and vinculo_id = v_vinculo;
    v_docs := v_docs + 1;
  end loop;

  -- Un lote PDF puede ser PARCIAL (solo boletas corregidas, no todo el
  -- personal del periodo) — a diferencia de publicar_lote, que siempre genera
  -- un documento por cada vínculo vigente de la empresa. Marcar 'reemplazado'
  -- TODOS los documentos de versiones previas del mismo lote le quitaría su
  -- boleta vigente a los trabajadores que NO están en la v2. Se acota a los
  -- vínculos que sí están en el lote nuevo.
  if v_version > 1 then
    update documentos set estado = 'reemplazado'
    where lote_id in (select id from lotes where empresa_id = p_empresa
                      and tipo = p_tipo and periodo = p_periodo and version < v_version)
      and vinculo_id in (select vinculo_id from documentos where lote_id = v_id);
  end if;
  return jsonb_build_object('lote_id', v_id, 'documentos', v_docs, 'version', v_version);
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
-- 8 · Emisión v2: valida tipo/falta contra el RIT de la empresa del vínculo,
--     nivel del emisor, tope de suspensión; congela antecedentes y texto.
create function emitir_memorandum(
  p_dni text, p_tipo_sancion text, p_falta_id bigint, p_motivo text,
  p_suspension_dias int default null, p_por text default 'RRHH'
) returns text language plpgsql security definer as $$
declare
  v_vinculo bigint; v_empresa text; v_rit text;
  t tipos_sancion%rowtype; f rit_faltas%rowtype;
  v_num int; v_id text; v_ant jsonb; v_falta_texto text;
begin
  select id, empresa_id into v_vinculo, v_empresa from vinculos
  where persona_dni = p_dni and fecha_fin is null
  order by fecha_inicio desc limit 1;
  if v_vinculo is null then
    raise exception 'El DNI % no tiene vínculo vigente.', p_dni;
  end if;
  select rit_id into v_rit from empresas where id = v_empresa;

  select * into t from tipos_sancion where id = p_tipo_sancion and rit_id = v_rit;
  if t.id is null then
    raise exception 'El tipo «%» no existe en el RIT vigente de la empresa.', p_tipo_sancion;
  end if;
  if fn_nivel_memorandums() < t.nivel_minimo then
    raise exception 'Tu categoría no está habilitada para imponer «%».', t.nombre;
  end if;
  if t.tope_suspension_dias is not null and
     (p_suspension_dias is null or p_suspension_dias < 1 or p_suspension_dias > t.tope_suspension_dias) then
    raise exception 'La suspensión va de 1 a % días laborables (art. 53 c del RIT).', t.tope_suspension_dias;
  end if;

  if p_falta_id is not null then
    select * into f from rit_faltas where id = p_falta_id and rit_id = v_rit;
    if f.id is null then
      raise exception 'La falta invocada no pertenece al RIT vigente de la empresa.';
    end if;
    v_falta_texto := 'Art. ' || f.articulo ||
      case when f.articulo = 20 then ' inciso ' else ' numeral ' end || f.item || '): «' || f.texto || '»' ||
      case when f.articulo = 20 then ' — concordado con el Art. 56 numeral 1' else '' end;
  elsif t.notificable then
    raise exception 'Una medida notificable exige invocar la falta del RIT (art. 20 o art. 56).';
  end if;

  -- Antecedentes congelados al emitir (art. 54); reincidencia = cualquier
  -- falta previa (art. 58).
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'tipo', m.tipo, 'emitido', to_char(m.emitido, 'YYYY-MM-DD'),
    'estado', m.estado, 'falta', coalesce(m.falta_texto, m.articulo)) order by m.emitido), '[]'::jsonb)
  into v_ant
  from memorandums m join vinculos v2 on v2.id = m.vinculo_id
  where v2.persona_dni = p_dni;

  select coalesce(max(split_part(id, '-', 1)::int), 141) + 1 into v_num
  from memorandums where id like '%-' || to_char(now(), 'YYYY');
  v_id := lpad(v_num::text, 4, '0') || '-' || to_char(now(), 'YYYY');

  insert into memorandums (id, vinculo_id, tipo, tipo_sancion_id, falta_id, falta_texto,
                           motivo, articulo, plazo_dias, suspension_dias,
                           antecedentes, reincidencia, estado)
  values (v_id, v_vinculo, t.nombre, t.id, p_falta_id, v_falta_texto,
          p_motivo,
          case when f.id is not null then 'Art. ' || f.articulo || ' ' || f.item || ') RIT' end,
          coalesce(t.plazo_descargo_dias, 0), p_suspension_dias,
          v_ant, v_ant <> '[]'::jsonb,
          case when t.notificable then 'emitido_sin_notificar' else 'registro_interno' end);

  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('EMITIR_MEMORANDUM', 'memorandums', null, jsonb_build_object(
    'id', v_id, 'dni', p_dni, 'tipo', t.nombre, 'falta', v_falta_texto, 'por', p_por));
  return v_id;
end $$;

-- 9 · Notificación: aquí (y solo aquí) empieza a correr el plazo. Hábiles para
--     sanciones, naturales para preavisos (no son intercambiables).
create function notificar_memorandum(p_id text)
returns void language plpgsql security definer as $$
declare m memorandums%rowtype; t tipos_sancion%rowtype;
begin
  select * into m from memorandums where id = p_id;
  if m.id is null then raise exception 'El memorándum % no existe.', p_id; end if;
  if m.estado = 'registro_interno' then
    raise exception 'La amonestación verbal es un registro interno: no se notifica.';
  end if;
  if m.notificado_en is not null then
    raise exception 'El memorándum % ya fue notificado.', p_id;
  end if;
  select t2.* into t from tipos_sancion t2
  join vinculos v on v.id = m.vinculo_id
  join empresas e on e.id = v.empresa_id
  where t2.id = m.tipo_sancion_id and t2.rit_id = e.rit_id;

  update memorandums set
    notificado_en = now(),
    vence = case when coalesce(t.plazo_descargo_dias, m.plazo_dias) > 0
                 then fn_sumar_dias(current_date, coalesce(t.plazo_descargo_dias, m.plazo_dias),
                                    coalesce(t.plazo_habil, true))
                 end,
    estado = case when coalesce(t.plazo_descargo_dias, m.plazo_dias) > 0 then 'en_plazo' else 'notificado' end
  where id = p_id;
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
  p_segmento text, p_alcance int, p_empresa text default null, p_sede text default null
) returns bigint language plpgsql security definer as $$
declare v_id bigint;
begin
  insert into comunicados (titulo, cuerpo, vence, exige_acuse, segmento, alcance, empresa_id, sede_id)
  values (p_titulo, p_cuerpo, p_vence, p_exige, p_segmento, p_alcance,
          nullif(p_empresa, ''), nullif(p_sede, ''))
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- IMPORTACIÓN DE PLANILLAS: RPCs transaccionales que aplican filas
-- FilaPlanilla (parser del reporte PLATRA1) sobre personas/vinculos/sedes/
-- cargos. Reglas: DNI TEXTO; jamás cesar por ausencia (solo se escriben las
-- filas recibidas); jamás null sobre datos manuales (celular/banco/cuenta/
-- portal); jamás sobrescribir con un prefijo truncado (nombres/sede/cargo);
-- reimportar = sin_cambio (idempotente); todo-o-nada.
-- ---------------------------------------------------------------------------

-- ¿nuevo es un prefijo truncado de actual? (jamás degradar un dato más completo)
create function fn_es_prefijo_truncado(p_nuevo text, p_actual text)
returns boolean language sql immutable as $$
  select p_actual is not null and p_nuevo is not null
     and length(trim(p_nuevo)) < length(trim(p_actual))
     and upper(trim(p_actual)) like upper(trim(p_nuevo)) || '%';
$$;

create function fn_sede_para_importacion(p_empresa text, p_sede text, p_cliente text)
returns text language plpgsql as $$
declare v_id text;
begin
  -- 1º igual o el nombre guardado empieza por el truncado (16 chars) o viceversa
  select id into v_id from sedes
  where empresa_id = p_empresa
    and (upper(nombre) like upper(trim(p_sede)) || '%' or upper(trim(p_sede)) like upper(nombre) || '%')
  order by length(nombre) desc limit 1;
  if v_id is not null then return v_id; end if;
  v_id := p_empresa || '-' || lower(regexp_replace(trim(p_sede), '\s+', '-', 'g'));
  insert into sedes (id, empresa_id, nombre, cliente, codigo)
  values (v_id, p_empresa, trim(p_sede), coalesce(p_cliente, 'Por asignar'),
          'S-' || lpad(nextval('seq_sede_codigo')::text, 4, '0'))
  on conflict (id) do nothing;
  return v_id;
end $$;

-- Alta manual de sede (RRH-21): id slug estable + código de secuencia.
create function crear_sede(
  p_empresa text, p_nombre text, p_cliente text,
  p_direccion text default null, p_por text default 'RRHH'
) returns jsonb language plpgsql security definer as $$
declare v_id text; v_codigo text;
begin
  if (select estado from empresas where id = p_empresa) is distinct from 'activa' then
    raise exception 'La empresa % no está activa.', p_empresa;
  end if;
  if trim(coalesce(p_nombre, '')) = '' then
    raise exception 'La sede necesita un nombre.';
  end if;
  if exists (select 1 from sedes
             where empresa_id = p_empresa and upper(trim(nombre)) = upper(trim(p_nombre))) then
    raise exception 'Ya existe una sede «%» en esa empresa.', trim(p_nombre);
  end if;
  v_id := p_empresa || '-' || lower(regexp_replace(trim(p_nombre), '\s+', '-', 'g'));
  if exists (select 1 from sedes where id = v_id) then
    raise exception 'Ya existe una sede con ese identificador (%).', v_id;
  end if;
  v_codigo := 'S-' || lpad(nextval('seq_sede_codigo')::text, 4, '0');
  insert into sedes (id, empresa_id, nombre, cliente, direccion, codigo)
  values (v_id, p_empresa, trim(p_nombre),
          coalesce(nullif(trim(p_cliente), ''), 'Por asignar'),
          nullif(trim(coalesce(p_direccion, '')), ''), v_codigo);
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('CREAR_SEDE', 'sedes', null, jsonb_build_object(
    'id', v_id, 'codigo', v_codigo, 'empresa', p_empresa,
    'nombre', trim(p_nombre), 'por', p_por));
  return jsonb_build_object('id', v_id, 'codigo', v_codigo);
end $$;

create function importar_planilla(p_empresa text, p_filas jsonb, p_por text)
returns jsonb language plpgsql security definer as $$
declare
  f jsonb; v_dni text; v_nombre text; v_sede_id text; v_vinculo bigint;
  v_altas text[] := '{}'; v_act text[] := '{}'; v_sin text[] := '{}';
  v_por_confirmar int := 0; v_cambio boolean;
begin
  if (select estado from empresas where id = p_empresa) is distinct from 'activa' then
    raise exception 'La empresa % no está activa: importación rechazada completa.', p_empresa;
  end if;
  for f in select * from jsonb_array_elements(p_filas) loop
    v_dni := f->>'dni';  v_nombre := trim(f->>'nombres');
    insert into cargos (nombre) values (trim(f->>'cargo')) on conflict do nothing;
    v_sede_id := fn_sede_para_importacion(p_empresa, f->>'sede', f->>'centroCosto');

    if not exists (select 1 from personas where dni = v_dni) then
      insert into personas (dni, nombre, portal, nombre_por_confirmar)
      values (v_dni, v_nombre, 'sin_celular', (f->>'nombreTruncado')::boolean);
      if (f->>'nombreTruncado')::boolean then v_por_confirmar := v_por_confirmar + 1; end if;
      insert into vinculos (persona_dni, empresa_id, sede_id, cargo, centro_costo, fecha_inicio, fecha_fin)
      values (v_dni, p_empresa, v_sede_id, trim(f->>'cargo'), trim(f->>'centroCosto'),
              (f->>'ingreso')::date, (f->>'cese')::date);
      v_altas := v_altas || v_dni;
    else
      -- persona existente: JAMÁS pisar datos personales manuales; el nombre
      -- solo mejora (nunca un prefijo más corto)
      update personas set
        nombre = case when fn_es_prefijo_truncado(v_nombre, nombre) then nombre
                      when length(v_nombre) > length(nombre) then v_nombre else nombre end
      where dni = v_dni;
      select id into v_vinculo from vinculos
      where persona_dni = v_dni and empresa_id = p_empresa and fecha_fin is null;
      if v_vinculo is null then
        insert into vinculos (persona_dni, empresa_id, sede_id, cargo, centro_costo, fecha_inicio, fecha_fin)
        values (v_dni, p_empresa, v_sede_id, trim(f->>'cargo'), trim(f->>'centroCosto'),
                (f->>'ingreso')::date, (f->>'cese')::date);
        v_act := v_act || v_dni;
      else
        select (sede_id is distinct from v_sede_id
             or not fn_es_prefijo_truncado(trim(f->>'cargo'), cargo) and cargo is distinct from trim(f->>'cargo')
             or centro_costo is distinct from trim(f->>'centroCosto')
             or (f->>'cese') is not null and fecha_fin is distinct from (f->>'cese')::date)
        into v_cambio from vinculos where id = v_vinculo;
        if v_cambio then
          update vinculos set
            sede_id = v_sede_id,
            cargo = case when fn_es_prefijo_truncado(trim(f->>'cargo'), cargo) then cargo else trim(f->>'cargo') end,
            centro_costo = trim(f->>'centroCosto'),
            fecha_fin = coalesce((f->>'cese')::date, fecha_fin)   -- cese SOLO si viene con fecha
          where id = v_vinculo;
          v_act := v_act || v_dni;
        else
          v_sin := v_sin || v_dni;
        end if;
      end if;
    end if;
  end loop;

  -- Traza de "quién importó" (p_por): la tabla auditoria es por-fila (una
  -- fila por INSERT/UPDATE/DELETE, ver fn_auditar) y personas/vinculos ya
  -- quedan auditadas fila-por-fila automáticamente por los triggers
  -- trg_auditar_personas / trg_auditar_vinculos. Eso registra el QUÉ pero no
  -- el p_por (columna `usuario` de auditoria guarda current_user, el rol de
  -- Postgres, no el nombre humano recibido por parámetro). Se agrega UNA fila
  -- resumen adicional por llamada, con la misma forma que usa fn_auditar
  -- (accion/tabla/datos_antes/datos_despues), guardando p_por + empresa +
  -- conteos dentro de datos_despues. Si la llamada viene de
  -- previsualizar_importacion esta fila también se revierte junto con todo lo
  -- demás (misma transacción/savepoint), así que el preview sigue sin dejar
  -- rastro.
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('IMPORTAR_PLANILLA', 'importar_planilla', null,
    jsonb_build_object('por', p_por, 'empresa', p_empresa,
      'altas', to_jsonb(v_altas), 'actualizaciones', to_jsonb(v_act),
      'sin_cambio', to_jsonb(v_sin), 'nombres_por_confirmar', v_por_confirmar));

  return jsonb_build_object('altas', to_jsonb(v_altas), 'actualizaciones', to_jsonb(v_act),
    'sin_cambio', to_jsonb(v_sin), 'nombres_por_confirmar', v_por_confirmar);
end $$;

-- La vista previa clasifica sin escribir: llama a importar_planilla dentro de
-- un bloque con EXCEPTION (Postgres crea un savepoint implícito al entrar a
-- ese bloque) y luego SIEMPRE lanza una excepción para revertirlo — así la
-- clasificación es exactamente la misma lógica que aplica la importación
-- real, sin duplicarla. Verificado contra producción que sqlerrm::jsonb
-- reconstruye el jsonb exacto sin truncar ni anteponer prefijo/contexto.
--
-- CORRECCIÓN post-revisión: la señal de reversión usa un errcode CUSTOM
-- exclusivo ('PV999', no usado por Postgres ni por ninguna excepción de
-- negocio del proyecto) en vez del P0001 por defecto — P0001 es también el
-- código por defecto de cualquier RAISE EXCEPTION sin USING ERRCODE (p. ej.
-- el rechazo de importar_planilla cuando la empresa no está activa), así que
-- el `exception when sqlstate 'P0001'` original atrapaba también los
-- rechazos de negocio y el `sqlerrm::jsonb` fallaba sobre un mensaje que no
-- era jsonb válido (reproducible con previsualizar_importacion('bremco',
-- '[]'::jsonb), bremco retirada). Con 'PV999' solo se atrapa la señal
-- deliberada; cualquier otra excepción se propaga tal cual.
create function previsualizar_importacion(p_empresa text, p_filas jsonb)
returns jsonb language plpgsql security definer as $$
declare v jsonb;
begin
  v := importar_planilla(p_empresa, p_filas, '(vista previa)');
  raise exception using errcode = 'PV999', message = v::text; -- revertir TODO
exception when sqlstate 'PV999' then
  return sqlerrm::jsonb;
end $$;

-- ---------------------------------------------------------------------------
-- IMPORTACIÓN DE INVENTARIO DE ACTIVOS (ADQ-08): Formato 7.1 SUNAT como
-- inventario. Identidad = código (PK global); código en OTRA empresa =
-- bloqueo (traslado, operación aparte). Vacío no borra; prefijo no degrada;
-- jamás baja por ausencia; reimportar = sin_cambio; todo-o-nada.
-- ---------------------------------------------------------------------------

create function fn_valor_importado(p_nuevo text, p_actual text)
returns text language sql immutable as $$
  select case
    when p_nuevo is null or trim(p_nuevo) = '' then p_actual
    when fn_es_prefijo_truncado(p_nuevo, p_actual) then p_actual
    else trim(p_nuevo) end;
$$;

create function importar_activos(
  p_empresa text, p_activos jsonb, p_razon_social text, p_archivo text, p_por text
) returns jsonb language plpgsql security definer as $$
declare
  a jsonb; v_codigo text; v_otra text; c text;
  v_altas text[] := '{}'; v_sin text[] := '{}'; v_acts jsonb := '[]'::jsonb;
  v_cambios jsonb; j_antes jsonb; j_despues jsonb;
  v_campos text[] := array['marca','modelo','serie','tipo','area',
    'asignado_sin_confirmar','usuario_anterior','observaciones','por_corregir'];
begin
  if (select estado from empresas where id = p_empresa) is distinct from 'activa' then
    raise exception 'La empresa % no está activa: importación rechazada completa.', p_empresa;
  end if;

  -- Los repetidos del ARCHIVO ya llegan sufijados por el parser (PROLT51-R2)
  -- y marcados repetido=true; un duplicado en el payload es señal de error.
  select d.codigo into v_codigo from (
    select trim(x->>'codigo') as codigo
    from jsonb_array_elements(p_activos) x
    group by 1 having count(*) > 1 limit 1) d;
  if v_codigo is not null then
    raise exception 'El código % aparece más de una vez en el lote recibido: no se importa ningún activo.', v_codigo;
  end if;

  for a in select * from jsonb_array_elements(p_activos) loop
    v_codigo := trim(coalesce(a->>'codigo', ''));
    if v_codigo = '' then
      raise exception 'Hay una fila sin código: no se importa ningún activo.';
    end if;

    select empresa_id into v_otra from activos where codigo = v_codigo;
    if v_otra is not null and v_otra <> p_empresa then
      raise exception 'El código % ya está registrado en la empresa %. Puede ser un traslado entre empresas: es una operación distinta y no se resuelve importando.', v_codigo, v_otra;
    end if;

    if v_otra is null then
      insert into activos (codigo, categoria, empresa_id, marca, modelo, serie,
                           tipo, area, asignado_sin_confirmar, usuario_anterior, observaciones,
                           por_corregir)
      values (v_codigo, 'Cómputo', p_empresa,
              nullif(trim(coalesce(a->>'marca', '')), ''),
              nullif(trim(coalesce(a->>'modelo', '')), ''),
              nullif(trim(coalesce(a->>'serie', '')), ''),
              nullif(trim(coalesce(a->>'tipo', '')), ''),
              nullif(trim(coalesce(a->>'area', '')), ''),
              nullif(trim(coalesce(a->>'usuario', '')), ''),
              nullif(trim(coalesce(a->>'usuarioAnterior', '')), ''),
              nullif(trim(coalesce(a->>'observaciones', '')), ''),
              coalesce((a->>'repetido')::boolean, false));
      v_altas := v_altas || v_codigo;
    else
      select to_jsonb(ac) into j_antes from activos ac where codigo = v_codigo;
      update activos set
        marca = fn_valor_importado(a->>'marca', marca),
        modelo = fn_valor_importado(a->>'modelo', modelo),
        serie = fn_valor_importado(a->>'serie', serie),
        tipo = fn_valor_importado(a->>'tipo', tipo),
        area = fn_valor_importado(a->>'area', area),
        asignado_sin_confirmar = fn_valor_importado(a->>'usuario', asignado_sin_confirmar),
        usuario_anterior = fn_valor_importado(a->>'usuarioAnterior', usuario_anterior),
        observaciones = fn_valor_importado(a->>'observaciones', observaciones),
        -- Estado, no dato: true al importar una repetición y false cuando el
        -- archivo corregido ya no repite el código.
        por_corregir = coalesce((a->>'repetido')::boolean, false)
      where codigo = v_codigo;
      select to_jsonb(ac) into j_despues from activos ac where codigo = v_codigo;

      v_cambios := '{}'::jsonb;
      foreach c in array v_campos loop
        if j_antes->c is distinct from j_despues->c then
          v_cambios := v_cambios ||
            jsonb_build_object(c, jsonb_build_object('antes', j_antes->c, 'despues', j_despues->c));
        end if;
      end loop;
      if v_cambios = '{}'::jsonb then
        v_sin := v_sin || v_codigo;
      else
        v_acts := v_acts || jsonb_build_object('codigo', v_codigo, 'cambios', v_cambios);
      end if;
    end if;
  end loop;

  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('IMPORTAR_ACTIVOS', 'importar_activos', null,
    jsonb_build_object('por', p_por, 'empresa', p_empresa,
      'razon_social_confirmada', p_razon_social, 'archivo', p_archivo,
      'altas', to_jsonb(v_altas), 'actualizaciones', v_acts, 'sin_cambio', to_jsonb(v_sin)));

  return jsonb_build_object('altas', to_jsonb(v_altas),
    'actualizaciones', v_acts, 'sin_cambio', to_jsonb(v_sin));
end $$;

-- Edición manual de un activo (ADQ): lo escrito MANDA (vaciar sí borra, regla
-- distinta de la importación). Renombrar el código arrastra asignaciones y
-- líneas (FK on update cascade) y limpia por_corregir.
create function editar_activo(
  p_codigo text, p_nuevo_codigo text, p_tipo text, p_marca text, p_modelo text,
  p_serie text, p_area text, p_asignado_sin_confirmar text, p_observaciones text,
  p_por text default 'Administración'
) returns void language plpgsql security definer as $$
declare v_nuevo text; j_antes jsonb; j_despues jsonb;
begin
  if not exists (select 1 from activos where codigo = p_codigo) then
    raise exception 'El activo % no existe.', p_codigo;
  end if;
  v_nuevo := trim(coalesce(p_nuevo_codigo, ''));
  if v_nuevo = '' then
    raise exception 'El activo necesita un código.';
  end if;
  if v_nuevo <> p_codigo and exists (select 1 from activos where codigo = v_nuevo) then
    raise exception 'Ya existe un activo con el código %.', v_nuevo;
  end if;

  select to_jsonb(ac) into j_antes from activos ac where codigo = p_codigo;
  update activos set
    codigo = v_nuevo,
    tipo = nullif(trim(coalesce(p_tipo, '')), ''),
    marca = nullif(trim(coalesce(p_marca, '')), ''),
    modelo = nullif(trim(coalesce(p_modelo, '')), ''),
    serie = nullif(trim(coalesce(p_serie, '')), ''),
    area = nullif(trim(coalesce(p_area, '')), ''),
    asignado_sin_confirmar = nullif(trim(coalesce(p_asignado_sin_confirmar, '')), ''),
    observaciones = nullif(trim(coalesce(p_observaciones, '')), ''),
    por_corregir = case when v_nuevo <> p_codigo then false else por_corregir end
  where codigo = p_codigo;
  select to_jsonb(ac) into j_despues from activos ac where codigo = v_nuevo;

  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('EDITAR_ACTIVO', 'activos',
    j_antes || jsonb_build_object('por', p_por), j_despues);
end $$;

-- Vista previa sin rastro: mismo patrón PV999 que previsualizar_importacion.
create function previsualizar_importacion_activos(
  p_empresa text, p_activos jsonb, p_razon_social text, p_archivo text
) returns jsonb language plpgsql security definer as $$
declare v jsonb;
begin
  v := importar_activos(p_empresa, p_activos, p_razon_social, p_archivo, '(vista previa)');
  raise exception using errcode = 'PV999', message = v::text; -- revertir TODO
exception when sqlstate 'PV999' then
  return sqlerrm::jsonb;
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
  -- documentos: política admin-solo en migraciones/2026-08-16-privacidad-documentos.sql
  foreach t in array array['empresas','personas','sedes','vinculos','lotes',
    'acuses','comunicados','memorandums','descargos','tardanzas',
    'plantillas','contratos','activos','asignaciones','lineas','epp_entregas','auditoria','cargos']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy acceso_demo on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

revoke update, delete on acuses, descargos, auditoria from anon, authenticated;
