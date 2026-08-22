-- 2026-08-21 · Decisión de Diego: la clave del BackOffice de 12 es demasiado.
-- Baja a mínimo 6 (más un número y una letra, validado en la UI). El check de
-- la columna (en la BD viva se llama chk_clave_min_backoffice) exigía >= 12;
-- se relaja a >= 6, baja el default y el valor guardado. La complejidad
-- (número + letra) se aplica en el frontend. Idempotente.
alter table politica_acceso drop constraint if exists chk_clave_min_backoffice;
alter table politica_acceso drop constraint if exists politica_acceso_clave_longitud_min_backoffice_check;
alter table politica_acceso alter column clave_longitud_min_backoffice set default 6;
alter table politica_acceso add constraint chk_clave_min_backoffice
  check (clave_longitud_min_backoffice >= 6);
update politica_acceso set clave_longitud_min_backoffice = 6 where clave_longitud_min_backoffice > 6;
