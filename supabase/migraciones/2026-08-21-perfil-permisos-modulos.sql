-- 2026-08-21 · Los módulos `soporte` (2026-08-19) y `solicitudes` (2026-08-19)
-- se agregaron al frontend (src/data/modulos.js) pero NUNCA se sumaron al
-- check `perfil_permisos_modulo_check`. Al crear una categoría nueva,
-- guardar_perfil inserta TODA la matriz (incluidos esos dos módulos) y el
-- insert reventaba con:
--   new row for relation "perfil_permisos" violates check constraint
--   "perfil_permisos_modulo_check"
-- Las categorías viejas se salvaron porque se crearon antes de que existieran
-- esos módulos. Ambos tienen aprobación → también van al check de nivel 3.
-- Idempotente: drop if exists + add.

alter table perfil_permisos drop constraint if exists perfil_permisos_modulo_check;
alter table perfil_permisos add constraint perfil_permisos_modulo_check check (modulo in
  ('personal','boletas','acuses','comunicados','memorandums','contratos',
   'tardanzas','activos','soporte','solicitudes','accesos','auditoria','configuracion'));

alter table perfil_permisos drop constraint if exists nivel_3_solo_con_aprobacion;
alter table perfil_permisos add constraint nivel_3_solo_con_aprobacion check (
  nivel < 3 or modulo in ('personal','boletas','comunicados','memorandums',
                          'contratos','activos','soporte','solicitudes','accesos','configuracion'));
