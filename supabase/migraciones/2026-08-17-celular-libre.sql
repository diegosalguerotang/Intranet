-- Celular LIBRE (decisión de Diego 2026-08-17): el número puede llegar con
-- +51, espacios u otro formato — tanto tecleado como desde los Excels de
-- planilla. Se guarda tal cual; se sueltan los checks de 9 dígitos exactos en
-- personas y usuarios_admin. (lineas.numero NO cambia: el número de una línea
-- móvil sí es de 9 dígitos exactos y es su clave primaria.) Idempotente.
alter table personas drop constraint if exists personas_celular_check;
alter table usuarios_admin drop constraint if exists usuarios_admin_celular_check;
