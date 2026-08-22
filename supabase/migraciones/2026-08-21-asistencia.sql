-- 2026-08-21 · Módulo de Asistencia: importación del reporte de marcaciones del
-- reloj. Guarda marcaciones (no clasifica ausencias); el cálculo es referencial
-- y la planilla es la fuente de verdad. Idempotente.

-- Módulo nuevo 'asistencia' en el catálogo de permisos: hay que sumarlo al check
-- de perfil_permisos (misma lección que soporte/solicitudes el 2026-08-21).
-- No tiene nivel de aprobación (solo ver / importar) → NO va al check de nivel 3.
alter table perfil_permisos drop constraint if exists perfil_permisos_modulo_check;
alter table perfil_permisos add constraint perfil_permisos_modulo_check check (modulo in
  ('personal','boletas','acuses','comunicados','memorandums','contratos',
   'tardanzas','asistencia','activos','soporte','solicitudes','accesos','auditoria','configuracion'));

-- Parámetro configurable del umbral de "doble marcación" (spec §6). Fila única.
create table if not exists asistencia_config (
  id                  int primary key default 1 check (id = 1),
  doble_marcacion_min int not null default 15 check (doble_marcacion_min > 0)
);
insert into asistencia_config (id) values (1) on conflict (id) do nothing;

-- Lote de importación: procedencia (spec §5).
create table if not exists asistencia_lotes (
  id           bigint generated always as identity primary key,
  empresa_id   text not null references empresas(id),
  archivo      text,
  rango_desde  date,
  rango_hasta  date,
  trabajadores int not null default 0,
  filas        int not null default 0,
  anomalias    jsonb not null default '[]'::jsonb,
  creado_por   text not null,
  creado_en    timestamptz not null default now()
);

-- Marcaciones diarias. Llave natural: empresa + documento + fecha (spec §5).
-- documento = DNI canónico del maestro cuando resuelve; si no, el código
-- normalizado (la anomalía "documento no encontrado" lo reporta aparte).
-- m1..m4 en orden: entrada, salida a refrigerio, retorno, salida final (texto HH:MM).
create table if not exists marcaciones (
  empresa_id text not null references empresas(id),
  documento  text not null,
  fecha      date not null,
  m1 text, m2 text, m3 text, m4 text,
  lote_id    bigint references asistencia_lotes(id),
  primary key (empresa_id, documento, fecha)
);
create index if not exists ix_marcaciones_doc on marcaciones (documento);

alter table asistencia_config enable row level security;
alter table asistencia_lotes  enable row level security;
alter table marcaciones       enable row level security;
do $$ declare t text; begin
  foreach t in array array['asistencia_config','asistencia_lotes','marcaciones'] loop
    execute format('drop policy if exists acceso_demo on %I', t);
    execute format('create policy acceso_demo on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;
