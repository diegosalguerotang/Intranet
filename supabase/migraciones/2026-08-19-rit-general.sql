-- RIT GENERAL (2026-08-19, decisión de Diego): el reglamento no puede
-- llamarse «RIT Clean» — es UN reglamento general para todos los operarios
-- del grupo (con la puerta abierta a un RIT por razón social a futuro, que la
-- estructura rits/empresas.rit_id ya soporta). Se renombra el registro de
-- raíz: id y nombre. Nada en la UI mostraba el nombre viejo, pero el dato
-- queda correcto.
-- También: RPC idempotente para publicar el PDF del RIT al legajo de TODOS
-- los trabajadores vigentes con acuse obligatorio (constancia probatoria de
-- conocimiento, mismo motor de acuses de las boletas). Re-ejecutable tras
-- nuevas altas: solo alcanza a quien aún no lo tiene.
-- Idempotente.

-- 1 · Renombrar clean-2025 → general-2025 (FKs sin on update: alta + repunte + baja).
insert into rits (id, nombre, vigente_desde)
select 'general-2025', 'Reglamento Interno de Trabajo — General (2025)', vigente_desde
from rits where id = 'clean-2025'
on conflict (id) do nothing;

update rit_faltas set rit_id = 'general-2025' where rit_id = 'clean-2025';
update tipos_sancion set rit_id = 'general-2025' where rit_id = 'clean-2025';
alter table empresas alter column rit_id set default 'general-2025';
update empresas set rit_id = 'general-2025' where rit_id = 'clean-2025';
delete from rits where id = 'clean-2025';

-- 2 · Publicación del RIT con acuse: un documento por vínculo VIGENTE que aún
-- no lo tenga. El PDF vive una sola vez en el bucket privado; cada documento
-- lo referencia con el mismo hash. Gate: nivel de acción en Personal
-- (servicio = 99 pasa, como en todo el proyecto).
create or replace function publicar_rit(
  p_archivo_url text, p_hash text,
  p_titulo text default 'Reglamento Interno de Trabajo (2025)'
) returns int language plpgsql security definer as $$
declare v_n int;
begin
  if fn_nivel_modulo('personal') < 2 then
    raise exception 'Se necesita nivel de acción en Personal.';
  end if;
  if coalesce(trim(p_archivo_url), '') = '' or coalesce(trim(p_hash), '') = '' then
    raise exception 'La publicación necesita la ruta del PDF y su huella.';
  end if;
  insert into documentos (vinculo_id, tipo, titulo, hash_sha256, archivo_url, exige_acuse)
  select v.id, 'Reglamento interno', p_titulo, p_hash, p_archivo_url, true
  from vinculos v
  where v.fecha_fin is null
    and not exists (
      select 1 from documentos d
      where d.vinculo_id = v.id and d.tipo = 'Reglamento interno' and d.estado = 'vigente'
    );
  get diagnostics v_n = row_count;
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('PUBLICAR_RIT', 'documentos',
    jsonb_build_object('archivo', p_archivo_url, 'asignados', v_n), null);
  return v_n;
end $$;
