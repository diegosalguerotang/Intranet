-- Prueba de la lógica de bloqueo: 5 fallidos consecutivos → bloqueado; un
-- exitoso posterior la resetea (para otro correo, real).
select registrar_ingreso('atacante@ejemplo.com', 'fallido', 'Prueba automatizada');
select registrar_ingreso('atacante@ejemplo.com', 'fallido', 'Prueba automatizada');
select registrar_ingreso('atacante@ejemplo.com', 'fallido', 'Prueba automatizada');
select registrar_ingreso('atacante@ejemplo.com', 'fallido', 'Prueba automatizada');
select verificar_bloqueo('atacante@ejemplo.com') as bloqueado_con_4;
select registrar_ingreso('atacante@ejemplo.com', 'fallido', 'Prueba automatizada');
select verificar_bloqueo('atacante@ejemplo.com') as bloqueado_con_5;

-- Fallidos + exitoso de un usuario real: el exitoso resetea el conteo
select registrar_ingreso('kprado@grupoer.pe', 'fallido', 'Prueba automatizada');
select registrar_ingreso('kprado@grupoer.pe', 'exitoso', 'Prueba automatizada');

select (select verificar_bloqueo('atacante@ejemplo.com')) as atacante_bloqueado,
       (select verificar_bloqueo('kprado@grupoer.pe')) as karina_bloqueada,
       (select count(*) from v_registro_accesos where usuario = 'atacante@ejemplo.com') as filas_atacante,
       (select to_char(ultimo_ingreso, 'YYYY-MM-DD') from usuarios_admin where correo = 'kprado@grupoer.pe') as ultimo_ingreso_karina;
