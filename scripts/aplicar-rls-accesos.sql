-- Aplica solo el bloque de RLS de accesos.sql (el esquema ya está aplicado;
-- re-correr el archivo completo borraría las verificaciones de versionado).
do $$
declare t text;
begin
  foreach t in array array['perfiles','perfil_permisos','usuarios_admin',
    'usuario_alcance_empresa','usuario_alcance_sede','politica_acceso','registro_accesos']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy acceso_demo on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;
revoke update, delete on registro_accesos from anon, authenticated;
select count(*) as politicas from pg_policies where policyname = 'acceso_demo'
  and tablename in ('perfiles','perfil_permisos','usuarios_admin',
    'usuario_alcance_empresa','usuario_alcance_sede','politica_acceso','registro_accesos');
