-- 2026-08-25 · Botones B+C: acuse asistido REAL, alta de activo real y
-- actividad real del legajo. Ver docs/superpowers/plans/2026-08-25-botones-b-c.md
-- Idempotente. Canónicos: v_acuses y registrar_acuse_asistido sincronizados en
-- schema.sql; crear_activo y v_actividad_persona también.

-- 1 · Bucket documentos: el hardening del 24-08 lo dejó solo application/pdf,
-- lo que rompía la foto del cargo firmado (acuse asistido) y los adjuntos con
-- foto de las papeletas. Se admiten imágenes; el tope de 50 MB se mantiene.
update storage.buckets
set allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/webp']
where id = 'documentos';

-- 2 · Declaración versionada del REGISTRADOR del acuse asistido: se copia
-- íntegra en cada acuse (mismo patrón probatorio que recepcion-documento).
insert into declaraciones (id, version, superficie, texto) values
('acuse-asistido', 1, 'backoffice',
'DECLARACIÓN DEL REGISTRADOR — ACUSE ASISTIDO

Declaro que entregué físicamente el documento al trabajador en la fecha indicada y que el cargo firmado adjunto corresponde a su firma. Registro este acuse en modalidad asistida, identificándome como responsable del registro. Quedan registrados mi identidad, la fecha y hora del servidor, el dispositivo, la huella digital del archivo entregado y la foto del cargo firmado.')
on conflict (id, version) do nothing;

-- 3 · v_acuses expone la ruta del cargo adjunto (columna nueva AL FINAL para
-- poder usar create or replace).
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
       a.adjunto_url as adjunto
from documentos d
join vinculos vi on vi.id = d.vinculo_id
join personas p on p.dni = vi.persona_dni
left join acuses a on a.documento_id = d.id
left join personas sup on sup.dni = a.supervisor_dni;

-- 4 · registrar_acuse_asistido v2: adjunto OBLIGATORIO y verificado contra
-- Storage (nada de rutas fantasma), supervisor real derivado del JWT,
-- dispositivo del cliente y declaración copiada íntegra. DROP de la v1 que
-- inventaba la ruta del cargo.
drop function if exists registrar_acuse_asistido(text, text, text, timestamptz, text);
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

  v_sup := fn_persona_llamador();          -- persona del admin que registra (null sin JWT)
  select nombre into v_nombre from personas where dni = v_sup;
  select texto into v_texto from declaraciones
  where id = 'acuse-asistido' order by version desc limit 1;

  insert into acuses (documento_id, modalidad, dispositivo, hash_sha256, declaracion,
                      registrado_por, supervisor_dni, motivo_asistido, entrega_fisica_en,
                      adjunto_url, dni_check)
  values (v_doc.id, 'asistido',
          coalesce(nullif(trim(coalesce(p_dispositivo, '')), ''), 'Registrado desde BackOffice'),
          v_doc.hash_sha256,
          coalesce(v_texto, 'Se registra entrega física con cargo firmado adjunto.'),
          coalesce(v_nombre, 'Recursos Humanos'), v_sup, p_motivo, p_entrega,
          p_adjunto, p_dni);
end $$;

-- 5 · Alta manual de activo (ADQ-02 deja de ser demostración).
create or replace function crear_activo(
  p_codigo text, p_categoria text, p_empresa text,
  p_tipo text default null, p_marca text default null, p_modelo text default null,
  p_serie text default null, p_imei text default null,
  p_valor numeric default 0, p_compra date default null,
  p_observaciones text default null
) returns void language plpgsql security definer
set search_path = public, extensions as $$
begin
  if fn_nivel_modulo('activos') < 2 then
    raise exception 'Necesitas nivel de acción en Gestión de TI para dar de alta activos.';
  end if;
  if nullif(trim(coalesce(p_codigo, '')), '') is null then
    raise exception 'El código del activo es obligatorio.';
  end if;
  if exists (select 1 from activos where codigo = trim(p_codigo)) then
    raise exception 'El código % ya existe en el inventario.', trim(p_codigo);
  end if;
  insert into activos (codigo, categoria, empresa_id, tipo, marca, modelo, serie, imei,
                       valor, compra, observaciones)
  values (trim(p_codigo), p_categoria, p_empresa,
          nullif(trim(coalesce(p_tipo, '')), ''), nullif(trim(coalesce(p_marca, '')), ''),
          nullif(trim(coalesce(p_modelo, '')), ''), nullif(trim(coalesce(p_serie, '')), ''),
          nullif(trim(coalesce(p_imei, '')), ''), coalesce(p_valor, 0), p_compra,
          nullif(trim(coalesce(p_observaciones, '')), ''));
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('RPC crear_activo', 'activos', null,
          jsonb_build_object('codigo', trim(p_codigo), 'categoria', p_categoria,
                             'empresa', p_empresa, 'por', fn_persona_llamador()));
end $$;

-- 6 · Actividad real del legajo: lo que la auditoría sabe de una persona
-- (triggers fn_auditar + resúmenes de los RPCs). El jsonb completo NO se
-- expone: puede contener datos sensibles (cuenta cifrada, claves de equipo).
create or replace view v_actividad_persona as
select a.id,
       to_char(a.fecha, 'YYYY-MM-DD HH24:MI') as fecha,
       a.usuario, a.accion, a.tabla,
       coalesce(nullif(x.d ->> 'persona_dni', ''), nullif(x.d ->> 'dni', ''),
                nullif(x.d ->> 'p_dni', ''), nullif(x.d ->> 'dni_check', '')) as dni
from auditoria a
cross join lateral (select coalesce(a.datos_despues, a.datos_antes) as d) x
where coalesce(nullif(x.d ->> 'persona_dni', ''), nullif(x.d ->> 'dni', ''),
               nullif(x.d ->> 'p_dni', ''), nullif(x.d ->> 'dni_check', '')) is not null;
