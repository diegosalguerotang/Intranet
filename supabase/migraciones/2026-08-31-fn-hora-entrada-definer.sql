-- Corrección (ronda 2026-08-31): fn_hora_entrada nació SIN security definer,
-- pero horarios_entrada está revocada a los clientes → toda vista que la usa
-- (v_personal, v_asistencia_mensual) devolvía 403 al navegador («permission
-- denied for table horarios_entrada»): las funciones invoker corren con los
-- permisos del usuario de la sesión aunque la vista sea del dueño.
-- La función es de solo lectura: definer + search_path fijado.
create or replace function fn_hora_entrada(p_dni text, p_fecha date default current_date)
returns time language sql stable security definer
set search_path = public, extensions as $$
  select hora from horarios_entrada
  where persona_dni = p_dni and vigente_desde <= p_fecha
  order by vigente_desde desc limit 1
$$;
