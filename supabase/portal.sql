-- ============================================================================
-- PORTAL DEL TRABAJADOR V1 (TRB-01/03/04/05/06/07/08/12) — complemento
-- Spec: docs/superpowers/specs/2026-08-13-portal-trabajador-v1-design.md
-- Idempotente: sirve de migración sobre la BD viva y de canónico en resets
-- (aplicar SIEMPRE después de schema.sql y accesos.sql).
-- Principio central: el DNI SIEMPRE se deriva del JWT de la sesión en el
-- servidor (cuenta técnica {dni}@portal.grupoer.pe). Ningún RPC ni vista del
-- portal acepta un dni por parámetro, salvo los dos pre-login.
-- ============================================================================

-- 1 · Columnas nuevas en tablas existentes -----------------------------------
-- guarda la RUTA del bucket (lotes/...), no una URL — ver migración de privacidad
alter table documentos add column if not exists archivo_url text;
-- Un documento archivado puede NO exigir acuse (solicitudes aprobadas cuyo
-- tipo no lo pide): default true para que boletas y cargos sigan igual.
alter table documentos add column if not exists exige_acuse boolean not null default true;

-- 2 · Tablas -----------------------------------------------------------------
create table if not exists cuentas_portal (
  dni text primary key references personas(dni),
  primer_ingreso_pendiente boolean not null default true,
  celular_declarado text check (celular_declarado is null or celular_declarado ~ '^[0-9]{9}$'),
  sin_celular boolean not null default false,
  politica_version text,
  politica_aceptada_en timestamptz,
  sesion_actual text,  -- marcador de sesión única (gana el login nuevo)
  creado_por text not null,
  creado_en timestamptz not null default now()
);

-- Textos probatorios versionados: el texto EXACTO mostrado se copia dentro de
-- cada acuse/aceptación (la plantilla puede cambiar después; la copia no).
create table if not exists declaraciones (
  id        text not null,
  version   integer not null check (version >= 1),
  superficie text not null check (superficie in ('portal','backoffice')),
  texto     text not null,
  creado_en timestamptz not null default now(),
  primary key (id, version)
);

create table if not exists comunicado_lecturas (
  dni           text not null references personas(dni),
  comunicado_id bigint not null references comunicados(id),
  leido_en      timestamptz not null default now(),
  confirmado    boolean not null default false,
  confirmado_en timestamptz,
  dispositivo   text,
  declaracion   text,   -- texto exacto aceptado cuando confirmó
  primary key (dni, comunicado_id)
);

-- La cuenta de haberes JAMÁS se edita desde el portal: solicitud para RRHH.
create table if not exists solicitudes_cambio_cuenta (
  id        bigint generated always as identity primary key,
  dni       text not null references personas(dni),
  motivo    text not null,
  estado    text not null default 'pendiente'
    check (estado in ('pendiente','aprobada','rechazada')),
  creado_en timestamptz not null default now()
);

-- 3 · Seed de declaraciones v1 ------------------------------------------------
insert into declaraciones (id, version, superficie, texto) values
('recepcion-documento', 1, 'portal',
'DECLARACIÓN DE RECEPCIÓN

Al presionar «Sí, confirmo la recepción» dejo constancia de que HE RECIBIDO el documento indicado, en la fecha y hora que registre el servidor.

Entiendo que:
· Esta confirmación reemplaza la firma del cargo físico en papel.
· Confirmar la recepción NO significa estar de acuerdo con el contenido del documento; solo deja constancia de que lo recibí. Conservo intacto mi derecho a reclamar.
· Si algo del documento no cuadra, puedo avisar a Recursos Humanos antes o después de confirmar.
· Quedarán registrados la fecha, la hora, el dispositivo desde el que confirmo y la huella digital del archivo exacto que se me mostró.'),
('lectura-comunicado', 1, 'portal',
'Al presionar «Sí, confirmo la lectura» dejo constancia de que he leído este comunicado completo. Quedarán registrados la fecha, la hora y el dispositivo desde el que confirmo.'),
('politica-datos', 1, 'portal',
'POLÍTICA DE TRATAMIENTO DE DATOS PERSONALES (Ley N.º 29733)

Autorizo al Grupo ER a tratar mis datos personales (identificación, contacto, información laboral y de planilla) con la única finalidad de administrar la relación laboral: entrega de boletas y documentos, comunicaciones internas, gestión de asistencia y beneficios.

Mis datos no serán compartidos con terceros ajenos al grupo, salvo obligación legal. Puedo ejercer en cualquier momento mis derechos de acceso, rectificación, cancelación y oposición acercándome a Recursos Humanos.

Mi aceptación queda registrada con fecha, hora y la versión de este texto.')
on conflict (id, version) do nothing;

-- Política de datos v2 (2026-08-25): texto real Ley 29733 + autorización de
-- entrega electrónica (D.Leg. 1310 art. 3.2). Canónico de la migración
-- 2026-08-25-politica-datos-v2.sql — mantener ambos idénticos.
insert into declaraciones (id, version, superficie, texto) values
('politica-datos', 2, 'portal',
'POLÍTICA DE PRIVACIDAD Y TRATAMIENTO DE DATOS PERSONALES
Ley N.º 29733 — Ley de Protección de Datos Personales — y su Reglamento
Versión 2 · Agosto de 2026

1. QUIÉN TRATA TUS DATOS
El responsable del tratamiento es la razón social del Grupo ER que figura como tu empleadora en tu boleta de pago. El Grupo ER administra esta intranet para todas sus empresas.

2. QUÉ DATOS TRATAMOS
· De identificación: nombres y apellidos, tipo y número de documento.
· De contacto: celular, correo y dirección que tú declaras.
· Laborales y de planilla: cargo, sede, fechas de ingreso y cese, remuneraciones, cuenta de haberes.
· De asistencia: tus marcaciones.
· Los que se generan al usar este portal: confirmaciones de recepción, lecturas, solicitudes, tickets de soporte y registros de acceso.

3. PARA QUÉ LOS USAMOS
Únicamente para administrar la relación laboral: pagarte y gestionar la planilla; entregarte boletas y documentos con constancia; comunicarte avisos de la empresa; gestionar tu asistencia, solicitudes y beneficios; tramitar procesos conforme al Reglamento Interno de Trabajo; darte soporte; y proteger la seguridad de la información. El tratamiento necesario para ejecutar la relación laboral y cumplir la ley no requiere tu consentimiento (art. 14 de la Ley 29733); para todo lo demás vale tu aceptación de esta política.

4. ENTREGA ELECTRÓNICA DE BOLETAS Y DOCUMENTOS
AUTORIZO expresamente que mis boletas de pago y demás documentos laborales se pongan a mi disposición a través de este portal, conforme al artículo 3.2 del Decreto Legislativo N.º 1310. Cada documento queda con constancia de emisión (fecha, hora del servidor y huella digital SHA-256 del archivo exacto) y puedo verlo y descargarlo desde mi cuenta en cualquier momento. Puedo pedir además una copia impresa en Recursos Humanos. Confirmar la recepción de un documento reemplaza la firma del cargo físico y NO significa estar de acuerdo con su contenido: conservo intacto mi derecho a reclamar.

5. CON QUIÉN SE COMPARTEN
Tus datos no se venden ni se comparten con terceros ajenos al Grupo ER. Solo acceden a ellos: (a) el personal autorizado según su nivel de acceso; (b) los proveedores tecnológicos que alojan la intranet y su base de datos, que actúan por encargo y pueden estar ubicados fuera del Perú (flujo transfronterizo con salvaguardas de seguridad); y (c) las autoridades cuando la ley lo exige (SUNAT, SUNAFIL, Poder Judicial, entre otras).

6. CUÁNTO TIEMPO LOS CONSERVAMOS
Mientras dure tu vínculo laboral y, después, por los plazos que exigen las normas laborales y tributarias (como mínimo cinco años para los documentos de planilla) y los plazos de prescripción de acciones legales.

7. TUS DERECHOS
Puedes ejercer en cualquier momento tus derechos de acceso, rectificación, cancelación y oposición (ARCO), y revocar esta autorización en lo que no sea indispensable para la relación laboral, presentando tu solicitud a Recursos Humanos de tu empresa. Te responderemos en los plazos de ley. Si no estás conforme con la respuesta, puedes acudir a la Autoridad Nacional de Protección de Datos Personales.

8. CÓMO LOS PROTEGEMOS
Los documentos se guardan en un repositorio privado al que solo se accede con identidad verificada; los datos bancarios se almacenan cifrados; tu cuenta tiene clave personal, sesión única y cierre automático por inactividad; y todos los accesos quedan registrados.

9. TU ACEPTACIÓN
Tu aceptación queda registrada con fecha, hora y la versión exacta de este texto, y puedes releer la política vigente cuando quieras desde la pestaña «Yo» del portal.')
on conflict (id, version) do nothing;

-- 4 · Identidad de la sesión del portal ---------------------------------------
-- NULL si la sesión no es del portal (las vistas devuelven vacío); los RPC
-- validan y revientan con mensaje claro.
-- Canónico desde 2026-08-19: resuelve la persona por lower(dni), así los
-- números alfanuméricos (CE/pasaporte) funcionan aunque el correo técnico
-- vaya en minúsculas. Devuelve el dni TAL COMO está en personas.
create or replace function portal_dni() returns text language sql stable as $$
  select p.dni from personas p
  where coalesce(auth.jwt()->>'email','') like '%@portal.grupoer.pe'
    and lower(p.dni) = split_part(auth.jwt()->>'email','@',1)
  limit 1
$$;

-- Sesión única del portal (gana el login nuevo): el login registra un marcador;
-- la app se autoexpulsa si el del servidor cambió.
create or replace function portal_registrar_sesion(p_marker text)
returns void language plpgsql security definer as $$
begin
  update cuentas_portal set sesion_actual = p_marker where dni = portal_dni();
end $$;

create or replace function portal_mi_sesion()
returns text language sql security definer as $$
  select sesion_actual from cuentas_portal where dni = portal_dni()
$$;
grant execute on function portal_registrar_sesion(text), portal_mi_sesion() to authenticated, anon;

-- Modo del trabajador: vigente | solo-lectura (cesado ≤ 12 meses) | expirado.
create or replace function portal_modo(p_dni text) returns text language sql stable as $$
  select case
    when exists (select 1 from vinculos v where v.persona_dni = p_dni and v.fecha_fin is null)
      then 'vigente'
    when (select max(v.fecha_fin) from vinculos v where v.persona_dni = p_dni)
         >= current_date - interval '12 months'
      then 'solo-lectura'
    else 'expirado'
  end
$$;

-- 5 · RPCs pre-login (por dni: aún no hay sesión) ------------------------------
create or replace function portal_verificar_bloqueo(p_dni text) returns boolean
language plpgsql stable security definer as $$
declare pol politica_acceso%rowtype; ultimo_ok timestamptz; fallidos int;
begin
  select * into pol from politica_acceso where id = 1;
  select max(fecha) into ultimo_ok from registro_accesos
  where dni = p_dni and superficie = 'portal' and resultado = 'exitoso';
  select count(*) into fallidos from registro_accesos
  where dni = p_dni and superficie = 'portal' and resultado = 'fallido'
    and fecha > now() - make_interval(mins => pol.bloqueo_minutos)
    and (ultimo_ok is null or fecha > ultimo_ok);
  return fallidos >= pol.intentos_bloqueo;
end $$;

create or replace function portal_registrar_ingreso(p_dni text, p_resultado text, p_dispositivo text)
returns void language plpgsql security definer as $$
begin
  insert into registro_accesos (dni, superficie, resultado, dispositivo)
  values (p_dni, 'portal', p_resultado, p_dispositivo);
  if p_resultado = 'exitoso' then
    update personas
    set portal = case when coalesce((select sin_celular from cuentas_portal c where c.dni = p_dni), false)
                      then 'sin_celular' else 'activo' end
    where dni = p_dni and portal <> 'suspendido';
  end if;
end $$;

-- 6 · RPCs con sesión (el dni sale del JWT, jamás de un parámetro) -------------
-- Desde 2026-08-17 también captura el correo (opcional): con correo
-- verificado el trabajador puede recuperar su clave por enlace.
drop function if exists portal_primer_ingreso(text, boolean, integer);
create or replace function portal_primer_ingreso(
  p_celular text, p_sin_celular boolean, p_politica_version integer,
  p_correo text default null
) returns void language plpgsql security definer as $$
declare v_dni text; v_correo text;
begin
  v_dni := portal_dni();
  if v_dni is null then raise exception 'Sesión del portal requerida.'; end if;
  if not p_sin_celular and (p_celular is null or p_celular !~ '^[0-9]{9}$') then
    raise exception 'El celular debe tener 9 dígitos, o marca «No tengo celular».';
  end if;
  v_correo := nullif(lower(trim(coalesce(p_correo, ''))), '');
  if v_correo is not null and v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo no tiene un formato válido.';
  end if;
  if not exists (select 1 from declaraciones where id = 'politica-datos' and version = p_politica_version) then
    raise exception 'Versión de la política de datos desconocida.';
  end if;
  update cuentas_portal
  set primer_ingreso_pendiente = false,
      celular_declarado = case when p_sin_celular then null else p_celular end,
      sin_celular = p_sin_celular,
      politica_version = p_politica_version::text,
      politica_aceptada_en = now()
  where dni = v_dni;
  if not found then raise exception 'La cuenta del portal no existe.'; end if;
  update personas
  set celular = coalesce(case when p_sin_celular then null else p_celular end, celular),
      portal  = case when p_sin_celular then 'sin_celular' else 'activo' end,
      correo = coalesce(v_correo, correo),
      correo_verificado = case when v_correo is not null and v_correo is distinct from correo
                               then false else correo_verificado end
  where dni = v_dni;
end $$;

-- El corazón probatorio (TRB-06/07): un acuse inmutable con el texto íntegro.
create or replace function portal_confirmar_recepcion(p_documento_id bigint, p_dispositivo text)
returns bigint language plpgsql security definer as $$
declare v_dni text; v_doc record; v_texto text; v_id bigint;
begin
  v_dni := portal_dni();
  if v_dni is null then raise exception 'Sesión del portal requerida.'; end if;
  if portal_modo(v_dni) <> 'vigente' then
    raise exception 'Tu acceso es de solo lectura: no puedes confirmar recepciones.';
  end if;
  select d.id, d.estado, d.hash_sha256, d.archivo_url, v.persona_dni
  into v_doc
  from documentos d join vinculos v on v.id = d.vinculo_id
  where d.id = p_documento_id;
  if v_doc.id is null or v_doc.persona_dni <> v_dni then
    raise exception 'El documento no existe o no te corresponde.';
  end if;
  if v_doc.estado <> 'vigente' then
    raise exception 'Este documento fue reemplazado por una versión más reciente.';
  end if;
  if exists (select 1 from acuses a where a.documento_id = p_documento_id) then
    raise exception 'Este documento ya tiene la recepción confirmada.';
  end if;
  select texto into v_texto from declaraciones
  where id = 'recepcion-documento' and superficie = 'portal'
  order by version desc limit 1;
  insert into acuses (dni_check, documento_id, modalidad, dispositivo, hash_sha256, declaracion)
  values (v_dni, p_documento_id, 'personal', left(p_dispositivo, 150), v_doc.hash_sha256, v_texto)
  returning id into v_id;
  return v_id;
end $$;

create or replace function portal_marcar_visto(p_comunicado_id bigint)
returns void language plpgsql security definer as $$
declare v_dni text;
begin
  v_dni := portal_dni();
  if v_dni is null then raise exception 'Sesión del portal requerida.'; end if;
  insert into comunicado_lecturas (dni, comunicado_id)
  values (v_dni, p_comunicado_id)
  on conflict (dni, comunicado_id) do nothing;
end $$;

create or replace function portal_confirmar_lectura(p_comunicado_id bigint, p_dispositivo text)
returns void language plpgsql security definer as $$
declare v_dni text; v_texto text; v_previo boolean;
begin
  v_dni := portal_dni();
  if v_dni is null then raise exception 'Sesión del portal requerida.'; end if;
  if portal_modo(v_dni) <> 'vigente' then
    raise exception 'Tu acceso es de solo lectura: no puedes confirmar lecturas.';
  end if;
  if not exists (select 1 from comunicados c where c.id = p_comunicado_id and c.exige_acuse) then
    raise exception 'El comunicado no existe o no exige confirmación.';
  end if;
  select texto into v_texto from declaraciones
  where id = 'lectura-comunicado' and superficie = 'portal'
  order by version desc limit 1;
  select coalesce((select confirmado from comunicado_lecturas
                   where dni = v_dni and comunicado_id = p_comunicado_id), false)
  into v_previo;
  insert into comunicado_lecturas (dni, comunicado_id, confirmado, confirmado_en, dispositivo, declaracion)
  values (v_dni, p_comunicado_id, true, now(), left(p_dispositivo, 150), v_texto)
  on conflict (dni, comunicado_id) do update
    set confirmado = true, confirmado_en = now(),
        dispositivo = excluded.dispositivo, declaracion = excluded.declaracion
    where not comunicado_lecturas.confirmado;
  if not v_previo then
    update comunicados set leidos = leidos + 1 where id = p_comunicado_id;
  end if;
end $$;

create or replace function portal_actualizar_datos(p_celular text, p_direccion text)
returns void language plpgsql security definer as $$
declare v_dni text;
begin
  v_dni := portal_dni();
  if v_dni is null then raise exception 'Sesión del portal requerida.'; end if;
  if portal_modo(v_dni) <> 'vigente' then
    raise exception 'Tu acceso es de solo lectura: no puedes editar tus datos.';
  end if;
  if p_celular is not null and p_celular !~ '^[0-9]{9}$' then
    raise exception 'El celular debe tener 9 dígitos.';
  end if;
  update personas
  set celular = coalesce(p_celular, celular),
      direccion = coalesce(nullif(trim(p_direccion), ''), direccion)
  where dni = v_dni;
end $$;

create or replace function portal_solicitar_cambio_cuenta(p_motivo text)
returns void language plpgsql security definer as $$
declare v_dni text;
begin
  v_dni := portal_dni();
  if v_dni is null then raise exception 'Sesión del portal requerida.'; end if;
  if portal_modo(v_dni) <> 'vigente' then
    raise exception 'Tu acceso es de solo lectura.';
  end if;
  if exists (select 1 from solicitudes_cambio_cuenta
             where dni = v_dni and estado = 'pendiente') then
    raise exception 'Ya tienes una solicitud pendiente: Recursos Humanos la revisará.';
  end if;
  insert into solicitudes_cambio_cuenta (dni, motivo) values (v_dni, trim(p_motivo));
end $$;

-- 7 · Vistas (todas devuelven vacío sin sesión del portal) --------------------
drop view if exists v_portal_perfil;
create view v_portal_perfil as
select pe.dni, pe.nombre,
       split_part(pe.nombre, ' ', 1) as "nombrePila",
       coalesce(vig.cargo, ult.cargo) as cargo,
       s.nombre as sede,
       em.corto as empresa,
       portal_modo(pe.dni) as modo,
       coalesce(cp.primer_ingreso_pendiente, true) as "primerIngresoPendiente"
from personas pe
left join cuentas_portal cp on cp.dni = pe.dni
left join lateral (select * from vinculos v where v.persona_dni = pe.dni and v.fecha_fin is null
                   order by v.fecha_inicio desc limit 1) vig on true
left join lateral (select * from vinculos v where v.persona_dni = pe.dni
                   order by coalesce(v.fecha_fin, current_date) desc, v.fecha_inicio desc limit 1) ult on true
left join sedes s on s.id = coalesce(vig.sede_id, ult.sede_id)
left join empresas em on em.id = coalesce(vig.empresa_id, ult.empresa_id)
where pe.dni = portal_dni();

-- El reglamento del trabajador, SIEMPRE consultable (2026-08-19): resuelto por
-- su planilla (sede → empresa). El PDF se lee vía api/rit.js (URL firmada).
drop view if exists v_portal_rit;
create view v_portal_rit as
select r.nombre, to_char(r.vigente_desde, 'YYYY-MM-DD') as vigente_desde,
       (r.archivo_url is not null) as disponible
from personas pe
left join lateral (select * from vinculos v where v.persona_dni = pe.dni
                   order by (v.fecha_fin is null) desc, v.fecha_inicio desc limit 1) vi on true
left join sedes s on s.id = vi.sede_id
left join empresas e on e.id = vi.empresa_id
left join rits r on r.id = coalesce(s.rit_id, e.rit_id)
where pe.dni = portal_dni() and r.id is not null;
grant select on v_portal_rit to authenticated;

drop view if exists v_portal_boletas;
create view v_portal_boletas as
select d.id, d.tipo, d.titulo, d.periodo,
       coalesce(substring(d.periodo from '^\d{4}'), to_char(d.publicado_en, 'YYYY')) as anio,
       em.corto as empresa, d.version, d.estado, d.archivo_url,
       d.hash_sha256 as huella,
       to_char(d.publicado_en, 'YYYY-MM-DD') as publicado,
       a.id as "constanciaId",
       to_char(a.registrado_en, 'YYYY-MM-DD HH24:MI') as "confirmadoEn",
       a.modalidad
from documentos d
join vinculos v on v.id = d.vinculo_id
join empresas em on em.id = v.empresa_id
left join acuses a on a.documento_id = d.id
where v.persona_dni = portal_dni()
order by d.publicado_en desc;

drop view if exists v_portal_pendientes;
create view v_portal_pendientes as
select 'documento' as clase, d.id::text as ref, d.titulo, d.tipo as etiqueta,
       to_char(d.publicado_en, 'YYYY-MM-DD') as fecha, 2 as urgencia
from documentos d
join vinculos v on v.id = d.vinculo_id
where v.persona_dni = portal_dni() and d.estado = 'vigente' and d.exige_acuse
  and not exists (select 1 from acuses a where a.documento_id = d.id)
union all
select 'comunicado', c.id::text, c.titulo, 'Comunicado',
       to_char(c.publicado, 'YYYY-MM-DD'), 3
from comunicados c
where portal_dni() is not null and c.exige_acuse and c.vence >= current_date
  and not exists (select 1 from comunicado_lecturas l
                  where l.comunicado_id = c.id and l.dni = portal_dni() and l.confirmado)
order by urgencia, fecha desc;

drop view if exists v_portal_comunicados;
create view v_portal_comunicados as
select c.id, c.titulo, c.cuerpo,
       to_char(c.publicado, 'YYYY-MM-DD') as publicado,
       to_char(c.vence, 'YYYY-MM-DD') as vence,
       (c.vence >= current_date) as vigente,
       c.exige_acuse as "exigeAcuse",
       coalesce(l.confirmado, false) as confirmado,
       to_char(l.confirmado_en, 'YYYY-MM-DD HH24:MI') as "confirmadoEn",
       (l.dni is not null) as visto
from comunicados c
left join comunicado_lecturas l on l.comunicado_id = c.id and l.dni = portal_dni()
where portal_dni() is not null
order by c.publicado desc;

drop view if exists v_portal_mes;
create view v_portal_mes as
select t.periodo, t.tardanzas
from tardanzas t
where t.dni = portal_dni() and t.periodo = to_char(current_date, 'YYYY-MM');

drop view if exists v_portal_datos;
create view v_portal_datos as
select pe.dni, pe.nombre, pe.celular, pe.direccion, pe.banco,
       case when pe.cuenta is null then null
            else '···· ' || right(pe.cuenta, 4) end as "cuentaEnmascarada",
       coalesce(vig.cargo, '—') as cargo,
       em.corto as empresa, s.nombre as sede,
       exists (select 1 from solicitudes_cambio_cuenta sc
               where sc.dni = pe.dni and sc.estado = 'pendiente') as "solicitudPendiente"
from personas pe
left join lateral (select * from vinculos v where v.persona_dni = pe.dni and v.fecha_fin is null
                   order by v.fecha_inicio desc limit 1) vig on true
left join sedes s on s.id = vig.sede_id
left join empresas em on em.id = vig.empresa_id
where pe.dni = portal_dni();

-- Declaración vigente por id (el portal la muestra antes de confirmar).
drop view if exists v_declaraciones_vigentes;
create view v_declaraciones_vigentes as
select distinct on (id) id, version, superficie, texto
from declaraciones
order by id, version desc;

-- 8 · RLS y auditoría de las tablas nuevas ------------------------------------
do $$
declare t text;
begin
  foreach t in array array['cuentas_portal','declaraciones','comunicado_lecturas','solicitudes_cambio_cuenta']
  loop
    execute format('alter table %I enable row level security', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'acceso_demo') then
      execute format('create policy acceso_demo on %I for all to anon, authenticated using (true) with check (true)', t);
    end if;
    if not exists (select 1 from pg_trigger where tgname = 'trg_auditar_' || t) then
      execute format('create trigger trg_auditar_%s after insert or update or delete on %I
                      for each row execute function fn_auditar()', t, t);
    end if;
  end loop;
end $$;
-- Las lecturas confirmadas no se degradan ni se borran desde la API pública.
revoke update, delete on comunicado_lecturas from anon, authenticated;

-- ---------------------------------------------------------------------------
-- SEGUIMIENTO DE COMUNICADOS EN EL BACKOFFICE (2026-08-17). Viven aquí (no en
-- schema.sql) porque dependen de comunicado_lecturas, que nace en este
-- archivo: portal.sql se aplica SIEMPRE después de schema.sql.
-- ---------------------------------------------------------------------------

-- Pendientes de un comunicado: personas con vínculo VIGENTE dentro del
-- segmento que aún no confirmaron la lectura. Los comunicados sin
-- empresa/sede guardada cuentan como "todo el grupo".
create or replace view v_comunicado_pendientes as
select distinct c.id as comunicado_id, p.dni, p.nombre,
       s.nombre as sede, p.celular, v.empresa_id as empresa
from comunicados c
join vinculos v on v.fecha_fin is null
  and (c.empresa_id is null or v.empresa_id = c.empresa_id)
  and (c.sede_id is null or v.sede_id = c.sede_id)
join personas p on p.dni = v.persona_dni
left join sedes s on s.id = v.sede_id
where not exists (
  select 1 from comunicado_lecturas l
  where l.comunicado_id = c.id and l.dni = p.dni and l.confirmado
);

-- v_comunicados con la lectura VIVA desde las confirmaciones del portal
-- (reemplaza a la de schema.sql; la columna leidos queda como histórico).
create or replace view v_comunicados as
select id, titulo, cuerpo,
       to_char(publicado, 'YYYY-MM-DD') as publicado,
       to_char(vence, 'YYYY-MM-DD') as vence,
       alcance,
       (select count(*)::int from comunicado_lecturas l
        where l.comunicado_id = comunicados.id and l.confirmado) as leidos,
       exige_acuse as "exigeAcuse", segmento,
       case when vence < current_date then 'vencido' else 'vigente' end as estado
from comunicados
order by publicado desc;

-- v_personal con estado de cuenta del portal (#13, 2026-08-22): reemplaza a
-- la de schema.sql agregando "tieneCuenta" (depende de cuentas_portal, por
-- eso vive aqui — mismo patron que v_comunicados).
drop view if exists v_personal;
create view v_personal as
select p.dni, p.tipo_documento, p.nombre, v.cargo, v.sede_id as sede, v.empresa_id as empresa,
       to_char(v.fecha_inicio, 'YYYY-MM-DD') as ingreso,
       p.celular, p.portal,
       case when v.fecha_fin is null then 'vigente' else 'cesado' end as estado,
       p.banco,
       case when p.cuenta_ultimos4 is not null then '···· ' || p.cuenta_ultimos4 end as cuenta,
       to_char(v.fecha_fin, 'YYYY-MM-DD') as cese,
       v.id as vinculo_id,
       p.correo, p.correo_verificado as "correoVerificado",
       p.cci,
       exists (select 1 from cuentas_portal cp where cp.dni = p.dni) as "tieneCuenta"
from vinculos v join personas p on p.dni = v.persona_dni;
grant select on v_personal to authenticated;
