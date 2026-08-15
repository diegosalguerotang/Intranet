-- supabase/migraciones/2026-08-15-tres-ajustes.sql
-- Tres ajustes (2026-08-15): razones sociales + soporte de importaciones reales.

alter table empresas  add column if not exists estado text not null default 'activa';
do $$ begin
  alter table empresas add constraint empresas_estado_chk check (estado in ('activa','retirada'));
exception when duplicate_object then null; end $$;
alter table empresas  add column if not exists direccion text;
alter table personas  add column if not exists nombre_por_confirmar boolean not null default false;
alter table vinculos  add column if not exists centro_costo text;
alter table documentos add column if not exists neto numeric;

create table if not exists cargos (nombre text primary key);
insert into cargos (nombre) values
  ('Operario de limpieza'), ('Supervisor de sede'), ('Técnico de mantenimiento'),
  ('Auxiliar de servicios'), ('Analista RRHH'), ('Jefe de RRHH'),
  ('OPERARIO(A) DE LIMPIEZA'), ('SUPERVISOR(A) DE LIMPIEZA')
on conflict do nothing;

-- Datos REALES de Limpieza Americana (las boletas cotejan por este RUC).
update empresas set ruc = '20601705185',
  direccion = 'Av. San Borja Sur Nro. 1184, Urb. San Borja Sur'
where id = 'lamericana';

-- BREMCO sale del grupo: retirada, jamás eliminada (conservación documental).
update empresas set estado = 'retirada' where id = 'bremco';

-- Nada nuevo sobre una empresa retirada (vínculos y lotes; contratos y
-- comunicados nuevos quedan bloqueados por la UI, que filtra activas).
create or replace function fn_solo_empresa_activa() returns trigger
language plpgsql as $$
begin
  if (select estado from empresas where id = new.empresa_id) <> 'activa' then
    raise exception 'La empresa % está retirada del grupo: no admite registros nuevos.', new.empresa_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_vinculo_empresa_activa on vinculos;
create trigger trg_vinculo_empresa_activa before insert on vinculos
  for each row execute function fn_solo_empresa_activa();
drop trigger if exists trg_lote_empresa_activa on lotes;
create trigger trg_lote_empresa_activa before insert on lotes
  for each row execute function fn_solo_empresa_activa();
