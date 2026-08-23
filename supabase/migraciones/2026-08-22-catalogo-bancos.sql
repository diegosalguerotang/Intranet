-- 2026-08-22 · #10 Fase 1: catálogo de bancos. El archivo unificado trae el
-- banco como texto libre y hasta mal escrito («Banco Scotianbank»); a partir
-- de aquí el banco se canoniza contra este catálogo y personas gana banco_id
-- (el texto personas.banco se conserva como nombre visible). Idempotente.
-- Espejo del catálogo JS src/lib/importar/bancos.js: mantener sincronizados.

create table if not exists bancos (
  codigo text primary key,
  nombre text not null,
  alias  text[] not null default '{}'
);

insert into bancos (codigo, nombre, alias) values
  ('bcp',        'BCP',                array['banco de credito','banco de credito del peru','credito','banco credito']),
  ('bbva',       'BBVA',               array['continental','banco continental','bbva continental']),
  ('scotiabank', 'Scotiabank',         array['scotianbank','banco scotianbank','banco scotiabank']),
  ('interbank',  'Interbank',          array['banco interbank','banco internacional del peru']),
  ('nacion',     'Banco de la Nación', array['banco de la nacion','nacion']),
  ('banbif',     'BanBif',             array['banco interamericano de finanzas']),
  ('pichincha',  'Banco Pichincha',    array['banco financiero'])
on conflict (codigo) do nothing;

-- Resuelve texto libre → código del catálogo (o null). Mismas reglas que el
-- helper JS: minúsculas, sin tildes, sin el prefijo «banco (de|del|de la)».
create or replace function fn_resolver_banco(p_texto text) returns text
language sql stable as $$
  with q as (
    select trim(regexp_replace(translate(lower(coalesce(p_texto, '')),
      'áéíóúü', 'aeiouu'), '\s+', ' ', 'g')) as t
  ), sp as (
    select t, regexp_replace(t, '^banco (de |del |de la )?', '') as s from q
  )
  select b.codigo from bancos b, sp
  where sp.t <> '' and (
    translate(lower(b.nombre), 'áéíóúü', 'aeiouu') in (sp.t, sp.s)
    or b.codigo in (sp.t, sp.s)
    or sp.t = any(b.alias) or sp.s = any(b.alias))
  limit 1;
$$;

-- FK opcional en personas: el texto banco queda como nombre visible.
alter table personas add column if not exists banco_id text references bancos(codigo);
update personas set banco_id = fn_resolver_banco(banco)
  where banco is not null and banco_id is null;

alter table bancos enable row level security;
drop policy if exists acceso_demo on bancos;
create policy acceso_demo on bancos for all to anon, authenticated using (true) with check (true);
