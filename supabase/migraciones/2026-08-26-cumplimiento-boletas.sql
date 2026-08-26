-- =============================================================================
-- CUMPLIMIENTO PROBATORIO DE BOLETAS ELECTRÓNICAS (2026-08-26) — idempotente.
-- Plan: docs/superpowers/plans/2026-08-26-cumplimiento-boletas.md
-- F1: IP y user-agent reales en los acuses (el proxy /api/supa inyecta
--     x-ip-real / x-agente server-side; los RPCs los leen de request.headers).
-- F2: consentimientos INSERT-only con estándar probatorio + backfill.
-- F3: log de notificaciones por documento.
-- Los acuses ya registrados son inmutables: quedan sin IP a propósito.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- F1 · Columnas nuevas
-- ---------------------------------------------------------------------------
alter table acuses add column if not exists agente text;
alter table comunicado_lecturas add column if not exists ip text;
alter table comunicado_lecturas add column if not exists agente text;

-- Lector de cabeceras que PostgREST expone como GUC. El proxy garantiza que
-- x-ip-real / x-agente solo pueden venir de él (descarta las del cliente).
create or replace function fn_cabecera(p_nombre text) returns text
language sql stable
set search_path = public, extensions as $$
  select nullif(trim(
    (coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> p_nombre)
  ), '')
$$;
revoke all on function fn_cabecera(text) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- F3 · Log de notificaciones (antes que v_acuses, que lo referencia)
-- ---------------------------------------------------------------------------
create table if not exists notificaciones_documento (
  id            bigint generated always as identity primary key,
  documento_id  bigint not null references documentos(id),
  canal         text not null default 'correo' check (canal in ('correo','portal')),
  destinatario  text not null,
  enviado_en    timestamptz not null default now(),   -- reloj del SERVIDOR
  enviado_por   text
);
create index if not exists ix_notif_doc on notificaciones_documento (documento_id);
drop trigger if exists trg_notificaciones_inmutables on notificaciones_documento;
create trigger trg_notificaciones_inmutables
  before update or delete on notificaciones_documento
  for each row execute function fn_bloquear_cambios();
revoke all on notificaciones_documento from anon, authenticated;

-- ---------------------------------------------------------------------------
-- F2 · Consentimientos con estándar probatorio (texto íntegro + hash + IP).
-- dni SIN FK a propósito (patrón dni_check de acuses): el registro probatorio
-- sobrevive a cualquier limpieza del maestro.
-- ---------------------------------------------------------------------------
create table if not exists consentimientos (
  id              bigint generated always as identity primary key,
  dni             text not null,
  declaracion_id  text not null,
  version         integer not null,
  superficie      text not null default 'portal',
  texto           text not null,                     -- copia ÍNTEGRA, no referencia
  hash_sha256     text not null,                     -- huella SHA-256 del texto
  aceptado_en     timestamptz not null default now(),
  ip              text,
  agente          text,
  origen          text not null default 'primer_ingreso'
    check (origen in ('primer_ingreso','migrado','papel'))
);
create index if not exists ix_consentimientos_dni on consentimientos (dni);
drop trigger if exists trg_consentimientos_inmutables on consentimientos;
create trigger trg_consentimientos_inmutables
  before update or delete on consentimientos
  for each row execute function fn_bloquear_cambios();
revoke all on consentimientos from anon, authenticated;

-- Backfill: las aceptaciones ya dadas (cuentas_portal) entran como 'migrado'
-- con su fecha original; sin IP porque nunca se capturó (honesto).
insert into consentimientos (dni, declaracion_id, version, superficie, texto,
                             hash_sha256, aceptado_en, origen)
select c.dni, 'politica-datos', c.politica_version::int, 'portal', d.texto,
       encode(extensions.digest(d.texto, 'sha256'), 'hex'),
       c.politica_aceptada_en, 'migrado'
from cuentas_portal c
join declaraciones d on d.id = 'politica-datos' and d.version = c.politica_version::int
where c.politica_aceptada_en is not null
  and c.politica_version ~ '^[0-9]+$'
  and not exists (select 1 from consentimientos x
                  where x.dni = c.dni and x.declaracion_id = 'politica-datos'
                    and x.version = c.politica_version::int);

-- ---------------------------------------------------------------------------
-- F1/F2 · RPCs (mismas firmas: create or replace, sin cambios de cliente)
-- ---------------------------------------------------------------------------
create or replace function portal_primer_ingreso(
  p_celular text, p_sin_celular boolean, p_politica_version integer,
  p_correo text default null
) returns void language plpgsql security definer
set search_path = public, extensions as $$
declare v_dni text; v_correo text; v_texto text;
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
  select texto into v_texto from declaraciones
  where id = 'politica-datos' and version = p_politica_version;
  if v_texto is null then
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
  -- Registro probatorio del consentimiento (D.Leg. 1310): texto íntegro,
  -- huella, hora de servidor, IP y user-agent reales.
  insert into consentimientos (dni, declaracion_id, version, superficie, texto,
                               hash_sha256, ip, agente, origen)
  values (v_dni, 'politica-datos', p_politica_version, 'portal', v_texto,
          encode(extensions.digest(v_texto, 'sha256'), 'hex'),
          fn_cabecera('x-ip-real'), fn_cabecera('x-agente'), 'primer_ingreso');
  update personas
  set celular = coalesce(case when p_sin_celular then null else p_celular end, celular),
      portal  = case when p_sin_celular then 'sin_celular' else 'activo' end,
      correo = coalesce(v_correo, correo),
      correo_verificado = case when v_correo is not null and v_correo is distinct from correo
                               then false else correo_verificado end
  where dni = v_dni;
end $$;

create or replace function portal_confirmar_recepcion(p_documento_id bigint, p_dispositivo text)
returns bigint language plpgsql security definer
set search_path = public, extensions as $$
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
  insert into acuses (dni_check, documento_id, modalidad, dispositivo, hash_sha256,
                      declaracion, ip, agente)
  values (v_dni, p_documento_id, 'personal', left(p_dispositivo, 150), v_doc.hash_sha256,
          v_texto, fn_cabecera('x-ip-real'), fn_cabecera('x-agente'))
  returning id into v_id;
  return v_id;
end $$;

create or replace function portal_confirmar_lectura(p_comunicado_id bigint, p_dispositivo text)
returns void language plpgsql security definer
set search_path = public, extensions as $$
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
  insert into comunicado_lecturas (dni, comunicado_id, confirmado, confirmado_en,
                                   dispositivo, declaracion, ip, agente)
  values (v_dni, p_comunicado_id, true, now(), left(p_dispositivo, 150), v_texto,
          fn_cabecera('x-ip-real'), fn_cabecera('x-agente'))
  on conflict (dni, comunicado_id) do update
    set confirmado = true, confirmado_en = now(),
        dispositivo = excluded.dispositivo, declaracion = excluded.declaracion,
        ip = excluded.ip, agente = excluded.agente
    where not comunicado_lecturas.confirmado;
  if not v_previo then
    update comunicados set leidos = leidos + 1 where id = p_comunicado_id;
  end if;
end $$;

create or replace function registrar_acuse_asistido(
  p_dni text, p_lote text, p_motivo text, p_entrega timestamptz,
  p_adjunto text, p_dispositivo text default null
) returns void language plpgsql security definer
set search_path = public, extensions as $$
declare v_doc documentos%rowtype; v_sup text; v_nombre text; v_texto text;
begin
  if fn_nivel_modulo('acuses') < 2 then
    raise exception 'Necesitas nivel de acción en Acuses para registrar un acuse asistido.';
  end if;

  select d.* into v_doc
  from documentos d join vinculos v on v.id = d.vinculo_id
  where v.persona_dni = p_dni and d.lote_id = p_lote and d.estado = 'vigente';
  if v_doc.id is null then
    raise exception 'No existe documento vigente del lote % para el DNI %.', p_lote, p_dni;
  end if;

  if p_adjunto is null or trim(p_adjunto) = ''
     or not exists (select 1 from storage.objects
                    where bucket_id = 'documentos' and name = p_adjunto) then
    raise exception 'El cargo firmado no está subido: adjunta la foto antes de registrar el acuse.';
  end if;

  v_sup := fn_persona_llamador();
  select nombre into v_nombre from personas where dni = v_sup;
  select texto into v_texto from declaraciones
  where id = 'acuse-asistido' order by version desc limit 1;

  insert into acuses (documento_id, modalidad, dispositivo, hash_sha256, declaracion,
                      registrado_por, supervisor_dni, motivo_asistido, entrega_fisica_en,
                      adjunto_url, dni_check, ip, agente)
  values (v_doc.id, 'asistido',
          coalesce(nullif(trim(coalesce(p_dispositivo, '')), ''), 'Registrado desde BackOffice'),
          v_doc.hash_sha256,
          coalesce(v_texto, 'Se registra entrega física con cargo firmado adjunto.'),
          coalesce(v_nombre, 'Recursos Humanos'), v_sup, p_motivo, p_entrega,
          p_adjunto, p_dni,
          fn_cabecera('x-ip-real'), fn_cabecera('x-agente'));
end $$;

-- ---------------------------------------------------------------------------
-- F1/F3/F5 · v_acuses ampliada (columnas NUEVAS al final: replace seguro)
-- ---------------------------------------------------------------------------
create or replace view v_acuses as
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
       d.version,
       a.adjunto_url as adjunto,
       a.agente,
       d.periodo, d.tipo,
       vi.empresa_id as empresa,
       p.nombre,
       to_char(d.publicado_en, 'YYYY-MM-DD HH24:MI') as publicado,
       (select count(*)::int from notificaciones_documento n
         where n.documento_id = d.id) as notificaciones,
       (select to_char(max(n.enviado_en), 'YYYY-MM-DD HH24:MI')
          from notificaciones_documento n
         where n.documento_id = d.id) as "ultimaNotificacion"
from documentos d
join vinculos vi on vi.id = d.vinculo_id
join personas p on p.dni = vi.persona_dni
left join acuses a on a.documento_id = d.id
left join personas sup on sup.dni = a.supervisor_dni;
