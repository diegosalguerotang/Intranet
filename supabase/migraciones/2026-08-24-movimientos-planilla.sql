-- Movimientos de planilla (2026-08-24): historial de altas, traslados,
-- ceses y retornos en el perfil del trabajador. Decisiones de Diego:
-- el traslado de RS SIEMPRE cierra el vínculo anterior; el cese JAMÁS es
-- automático (la ausencia solo propone, un humano confirma en la vista
-- previa); todo movimiento queda como historial inmutable en el legajo.
-- Parte 1: tabla insert-only + vistas. (Parte 2, las RPC v2, más abajo.)

create table if not exists movimientos (
  id              bigint generated always as identity primary key,
  persona_dni     text not null references personas(dni),
  tipo            text not null check (tipo in ('alta','traslado','cese','retorno')),
  empresa_origen  text references empresas(id),   -- traslado/cese
  empresa_destino text references empresas(id),   -- alta/traslado/retorno
  vinculo_cerrado bigint references vinculos(id),
  vinculo_abierto bigint references vinculos(id),
  fecha_efecto    date not null,
  periodo         text,                            -- 'YYYY-MM' de la planilla origen
  detalle         text,
  creado_por      text not null,
  creado_en       timestamptz not null default now()
);
create index if not exists ix_movimientos_persona on movimientos (persona_dni, creado_en desc);

create or replace function fn_movimientos_solo_insertar() returns trigger
language plpgsql as $$
begin
  raise exception 'El historial de movimientos no se edita ni se borra.';
end $$;
drop trigger if exists tg_movimientos_inmutables on movimientos;
create trigger tg_movimientos_inmutables
  before update or delete on movimientos
  for each row execute function fn_movimientos_solo_insertar();

-- Historial completo de vínculos de una persona, con nombres.
create or replace view v_vinculos_persona as
select v.id, v.persona_dni as dni, v.empresa_id as empresa,
       e.nombre as "empresaNombre", s.nombre as "sedeNombre",
       v.cargo, v.centro_costo as "centroCosto", v.contrato,
       to_char(v.fecha_inicio, 'YYYY-MM-DD') as inicio,
       to_char(v.fecha_fin, 'YYYY-MM-DD') as fin,
       (v.fecha_fin is null) as vigente
from vinculos v
join empresas e on e.id = v.empresa_id
join sedes s on s.id = v.sede_id
order by v.fecha_inicio desc, v.id desc;

create or replace view v_movimientos_persona as
select m.id, m.persona_dni as dni, m.tipo,
       eo.nombre as "deEmpresa", ed.nombre as "aEmpresa",
       to_char(m.fecha_efecto, 'YYYY-MM-DD') as fecha,
       m.periodo, m.detalle, m.creado_por as por,
       to_char(m.creado_en, 'YYYY-MM-DD HH24:MI') as registrado
from movimientos m
left join empresas eo on eo.id = m.empresa_origen
left join empresas ed on ed.id = m.empresa_destino
order by m.creado_en desc;

grant select on v_vinculos_persona, v_movimientos_persona to anon, authenticated;
revoke all on movimientos from anon, authenticated;
