-- Fusión de categorías (decisión de Diego 2026-08-17): Telefonía y
-- Comunicaciones son lo mismo — Telefonía desaparece y sus activos pasan a
-- Comunicaciones (el IMEI ahora acompaña a esa categoría). Idempotente.
-- ORDEN: los checks viejos se sueltan ANTES del update (mover un equipo con
-- IMEI fuera de Telefonía violaría imei_solo_telefonia).
alter table activos drop constraint if exists activos_categoria_check;
alter table activos drop constraint if exists imei_solo_telefonia;
alter table activos drop constraint if exists imei_solo_comunicaciones;

update activos set categoria = 'Comunicaciones' where categoria = 'Telefonía';

alter table activos add constraint activos_categoria_check
  check (categoria in ('Cómputo','Comunicaciones','Maquinaria'));
alter table activos add constraint imei_solo_comunicaciones
  check (imei is null or categoria = 'Comunicaciones');
