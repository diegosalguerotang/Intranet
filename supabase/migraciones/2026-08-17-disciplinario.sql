-- Módulo disciplinario parametrizado por RIT (plan 2026-08-17, aprobado por
-- Diego con 4 decisiones: plazos 3/5 días hábiles como parámetro, SÁBADO
-- hábil, suspensión la imponen GG/RRHH/Administración (nivel 3 del módulo),
-- RIT de CLEAN para TODAS las razones sociales por ahora). Idempotente.
-- Fuente literal: REGLAMENTO INTERNO CLEAN.pdf (RIT 2025), art. 20 y 53–58.

-- 1 · RIT por empresa (hoy todas apuntan al de CLEAN; el modelo ya soporta uno
--     propio por razón social: los números de artículo NO son transferibles).
create table if not exists rits (
  id            text primary key,
  nombre        text not null,
  vigente_desde date
);
insert into rits (id, nombre, vigente_desde)
values ('clean-2025', 'Reglamento Interno de Trabajo — CONSORCIO CLEAN 2025', '2025-01-01')
on conflict (id) do nothing;

alter table empresas add column if not exists rit_id text references rits(id);
update empresas set rit_id = 'clean-2025' where rit_id is null;

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

-- 6 · Nivel del emisor en el módulo memorandums (validación server-side de
--     quién puede imponer qué; las llamadas de servicio sin JWT pasan).
create or replace function fn_nivel_memorandums()
returns int language plpgsql stable security definer as $$
declare v_correo text; v_nivel int;
begin
  begin
    v_correo := nullif(auth.jwt() ->> 'email', '');
  exception when others then
    v_correo := null;
  end;
  if v_correo is null then return 99; end if;
  select case when p.es_superadmin then 99
              else coalesce((select pp.nivel from perfil_permisos pp
                             where pp.perfil_id = u.perfil_id
                               and pp.perfil_version = u.perfil_version
                               and pp.modulo = 'memorandums'), 0) end
  into v_nivel
  from usuarios_admin u
  join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
  where lower(u.correo) = lower(v_correo) and u.estado = 'activo';
  return coalesce(v_nivel, 0);
end $$;

-- 7 · Expediente: falta invocada con texto congelado, antecedentes congelados
--     al emitir (art. 54), reincidencia derivada (art. 58), días de
--     suspensión con tope, y el estado nuevo de registro interno.
alter table memorandums add column if not exists tipo_sancion_id text;
alter table memorandums add column if not exists falta_id bigint references rit_faltas(id);
alter table memorandums add column if not exists falta_texto text;
alter table memorandums add column if not exists antecedentes jsonb;
alter table memorandums add column if not exists reincidencia boolean not null default false;
alter table memorandums add column if not exists suspension_dias integer
  check (suspension_dias is null or suspension_dias between 1 and 3);

alter table memorandums drop constraint if exists memorandums_tipo_check;
alter table memorandums drop constraint if exists memorandums_estado_check;
alter table memorandums add constraint memorandums_estado_check
  check (estado in ('emitido_sin_notificar','notificado','en_plazo',
                    'descargo_presentado','vencido','resuelto','registro_interno'));

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

-- 8 · Emisión v2: valida tipo/falta contra el RIT de la empresa del vínculo,
--     nivel del emisor, tope de suspensión; congela antecedentes y texto.
drop function if exists emitir_memorandum(text, text, text, text, integer);
create or replace function emitir_memorandum(
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
create or replace function notificar_memorandum(p_id text)
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

-- 10 · Vistas: catálogos + expediente enriquecido con vencimiento derivado.
create or replace view v_rit_faltas as
select f.id, f.rit_id, f.articulo, f.item, f.texto
from rit_faltas f
order by f.articulo, case when f.item ~ '^\d+$' then lpad(f.item, 3, '0') else f.item end;

create or replace view v_tipos_sancion as
select id, rit_id, nombre, naturaleza, notificable,
       plazo_descargo_dias as "plazoDias", plazo_habil as "plazoHabil",
       tope_suspension_dias as "topeSuspension", nivel_minimo as "nivelMinimo",
       fuente_plazo as "fuentePlazo", via_notificacion as "viaNotificacion"
from tipos_sancion;

create or replace view v_memorandums as
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
