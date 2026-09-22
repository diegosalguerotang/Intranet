-- 2026-09-22 · Soporte TI sale del Portal del Trabajador y pasa al BackOffice
-- (decisión de Diego). Los tickets los abren los usuarios administrativos a su
-- propio nombre desde el botón «Mi solicitud», o el equipo de Soporte a nombre
-- de un trabajador (crear_ticket_admin, sin cambios).
-- Canónico: supabase/soporte.sql. Idempotente (create or replace + grants).
-- Reversión: volver a aplicar la versión anterior de portal_crear_ticket
-- (respaldos/2026-09-17-paso0-funciones.json) y `drop function
-- crear_ticket_propio(int,int,text); drop view v_mis_tickets;`.
begin;
set local search_path = public, interno, extensions;

-- 1 · La RPC del portal queda CERRADA. Se conserva la firma (inventarios de
--     seguridad de las fases 0-4) y sus grants; siempre rechaza.
create or replace function portal_crear_ticket(p_tipo int, p_subtipo int default null, p_comentario text default null)
returns text language plpgsql security definer set search_path = public, interno, extensions as $$
begin
  raise exception 'Soporte TI ya no se atiende desde el portal: pídelo a tu supervisor o a un usuario administrativo.';
end $$;

-- 2 · Ticket propio del usuario administrativo (identidad por JWT, sin módulo).
create or replace function crear_ticket_propio(p_tipo int, p_subtipo int default null, p_comentario text default null)
returns text language plpgsql security definer set search_path = public, interno, extensions as $$
declare v_dni text;
begin
  v_dni := fn_persona_llamador();
  if v_dni is null then
    raise exception 'Tu usuario no está vinculado a una persona del padrón: pide a RR. HH. que lo vincule.';
  end if;
  return fn_ticket_insertar(v_dni, p_tipo, p_subtipo, p_comentario);
end $$;
revoke all on function crear_ticket_propio(int, int, text) from public, anon;
grant execute on function crear_ticket_propio(int, int, text) to authenticated, service_role;

-- 3 · Buzón de tickets propios (sin nota interna; cada quien ve lo suyo).
create or replace view v_mis_tickets as
select t.numero, to_char(t.creado_en, 'YYYY-MM-DD HH24:MI') as creado,
       tt.nombre as tipo, ts.nombre as subtipo, t.comentario, t.estado, t.atendido_por
from tickets t
join ticket_tipos tt on tt.id = t.tipo_id
left join ticket_subtipos ts on ts.id = t.subtipo_id
where t.solicitante_dni = fn_persona_llamador()
order by t.creado_en desc;
revoke all on v_mis_tickets from public, anon;
grant select on v_mis_tickets to authenticated, service_role;

-- 4 · Comprobación en la misma transacción.
do $$
declare v_msj text;
begin
  begin
    perform portal_crear_ticket(1, null, 'x');
    raise exception 'portal_crear_ticket debería rechazar siempre';
  exception when others then
    v_msj := sqlerrm;
    if v_msj not like 'Soporte TI ya no se atiende%' then raise; end if;
  end;
  if not has_function_privilege('authenticated', 'crear_ticket_propio(int,int,text)', 'execute') then
    raise exception 'crear_ticket_propio sin EXECUTE para authenticated';
  end if;
  if not has_table_privilege('authenticated', 'v_mis_tickets', 'select') then
    raise exception 'v_mis_tickets sin SELECT para authenticated';
  end if;
end $$;
commit;
