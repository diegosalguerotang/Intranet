-- Centro de Solicitudes, fase PDF (2026-08-19): el documento generado al
-- aprobar se archiva en el legajo, pero SOLO exige acuse cuando el tipo lo
-- pide (papeleta con motivo Particular). Hasta hoy todo documento sin acuse
-- aparecía como pendiente en el portal; exige_acuse lo hace explícito
-- (default true: las boletas siguen exigiendo confirmación como siempre).
-- Idempotente.

alter table documentos add column if not exists exige_acuse boolean not null default true;

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

grant select on v_portal_pendientes to authenticated;
