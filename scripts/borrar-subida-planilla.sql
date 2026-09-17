-- Borrado de la subida de planilla de julio (pedido de Diego 2026-08-31):
-- quedan SOLO las 4 personas creadas a mano con sus usuarios admin
-- (40776655 Diego, 73189656 Renato, 40164196 Sessire, 74966012 Moisés).
-- Verificado antes de escribirlo: 0 documentos/acuses/cuentas portal/
-- consentimientos/solicitudes/marcaciones; la única asignación de activo es
-- de Sessire (a mano, devuelta) y se conserva. La auditoría y el registro
-- de accesos quedan intactos (insert-only).
alter table movimientos disable trigger tg_movimientos_inmutables;
delete from movimientos;
alter table movimientos enable trigger tg_movimientos_inmutables;

delete from vinculos;  -- todos nacieron de la importación (el reset del 27-08 los dejó en cero)

delete from personas
where dni not in ('40776655','73189656','40164196','74966012');

select
  (select count(*) from personas) as personas,
  (select string_agg(dni, ', ' order by dni) from personas) as quedan,
  (select count(*) from vinculos) as vinculos,
  (select count(*) from movimientos) as movimientos,
  (select count(*) from usuarios_admin where estado = 'activo') as admins_activos,
  (select count(*) from asignaciones) as asignaciones;
