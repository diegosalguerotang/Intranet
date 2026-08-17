-- Comunicados: lista real de pendientes de lectura (pedido de Diego
-- 2026-08-17). La segmentación pasa a guardarse de forma estructural
-- (empresa_id/sede_id, null = todo el grupo): antes solo quedaba el texto y
-- era imposible saber a quién le faltaba leer. Idempotente.

alter table comunicados add column if not exists empresa_id text references empresas(id);
alter table comunicados add column if not exists sede_id text references sedes(id);

-- Firma nueva con segmentación estructural: se elimina la vieja ANTES (con
-- defaults, dos firmas convivirían y las llamadas serían ambiguas).
drop function if exists publicar_comunicado(text, text, date, boolean, text, integer);
create or replace function publicar_comunicado(
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

-- Pendientes de un comunicado: personas con vínculo VIGENTE dentro del
-- segmento que aún no confirmaron la lectura. Los comunicados antiguos (sin
-- empresa/sede guardada) se tratan como "todo el grupo".
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

-- La lectura se calcula VIVA desde las confirmaciones del portal (la columna
-- leidos queda como contador histórico; los comunicados demo sin lecturas
-- muestran 0, que es la verdad).
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
