-- Eliminación definitiva de categorías (pedida por Diego 2026-08-17).
-- Reglas: la categoría de superadministrador JAMÁS se elimina; una categoría
-- con usuarios asignados (activos o suspendidos, cualquier versión) tampoco —
-- primero se reasignan o eliminan. Se borran TODAS las versiones (matriz y
-- alcance incluidos; perfil_empresas cae por cascade). El registro de accesos
-- (ACC-06) conserva el rastro: guarda perfil_id/version como texto propio, sin
-- FK. Queda una fila de auditoría con lo eliminado. Idempotente.
create or replace function eliminar_perfil(p_id text) returns void
language plpgsql security definer as $$
declare v_nombre text;
begin
  select nombre into v_nombre from perfiles where id = p_id order by version desc limit 1;
  if v_nombre is null then
    raise exception 'La categoría no existe.';
  end if;
  if exists (select 1 from perfiles where id = p_id and es_superadmin) then
    raise exception 'La categoría de superadministrador no se elimina.';
  end if;
  if exists (select 1 from usuarios_admin where perfil_id = p_id) then
    raise exception 'La categoría «%» tiene usuarios asignados: reasígnalos o elimínalos primero.', v_nombre;
  end if;
  delete from perfil_permisos where perfil_id = p_id;
  delete from perfiles where id = p_id; -- perfil_empresas cae en cascada
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('ELIMINAR_PERFIL', 'perfiles', jsonb_build_object('id', p_id, 'nombre', v_nombre), null);
end $$;
