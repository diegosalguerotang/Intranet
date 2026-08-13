-- Diagnóstico: qué intentos llegaron y si la cuenta está bloqueada.
select r.id, to_char(r.fecha, 'YYYY-MM-DD HH24:MI:SS') as fecha, r.correo, r.resultado, r.dispositivo
from registro_accesos r
where r.superficie = 'backoffice'
order by r.fecha desc
limit 15;
