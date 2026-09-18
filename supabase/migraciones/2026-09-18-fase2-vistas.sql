-- supabase/migraciones/2026-09-18-fase2-vistas.sql
-- Corrección de seguridad · FASE 2 — VISTAS. GENERADA por scripts/fase2-generar.mjs
-- (las listas viven ahí; no editar a mano: cambiar el generador y regenerar).
--
-- UNA transacción. Reversión: supabase/respaldos/2026-09-18-fase2-reversion.sql
-- (ensayo: scripts/ensayar-fase2.mjs). Requiere las fases 0, 0b y 1 aplicadas.
--
-- Por qué NO son las 47 vistas (desvío respecto del prompt, documentado en
-- docs/seguridad/2026-09-18-fase2-vistas.md): el prompt daba por hecho que en
-- esta fase las políticas seguían permisivas. La fase 0 eliminó acceso_demo y
-- activó RLS en todas las tablas (fallan cerrado). Con security_invoker y sin
-- políticas TODAS las vistas devuelven vacío o «permission denied» a todos
-- (inventario 2026-09-18, estado B). Por eso esta fase trae la política mínima
-- que necesita cada grupo:
--  · 38 vistas del BackOffice (+3 catálogos) → security_invoker = on, con
--    lectura_admin (es_admin_activo()) en sus 38 tablas base y lectura_sesion
--    en 4 catálogos. Un trabajador del Portal deja de poder leer v_personal,
--    v_usuarios_admin, etc. (hoy puede: las vistas corren como dueño).
--  · 9 vistas v_portal_* siguen como dueño: filtran por portal_dni() dentro
--    y necesitan políticas por trabajador (fase 4). Quedan anotadas.
-- Lo que un trabajador puede leer NO cambia salvo para restringirse; lo que un
-- administrador puede leer por vistas no cambia; un administrador pasa a poder
-- leer directamente (solo SELECT) las tablas base de sus vistas.

begin;
set local search_path = public, extensions;

-- 0 · Precondición: fases 0, 0b y 1 aplicadas; ninguna vista con security_invoker.
do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('es_admin', 'es_superadmin', 'nivel_en', 'requiere_nivel', 'requiere_superadmin');
  if n < 5 then raise exception 'fase2: falta la fase 1 (guarda central: % de 5 ayudantes)', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and policyname = 'solo_admin';
  if n <> 5 then raise exception 'fase2: se esperaban 5 políticas solo_admin (fase 0b), hay %', n; end if;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'v';
  if n <> 47 then raise exception 'fase2: se esperaban 47 vistas, hay %', n; end if;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'v' and 'security_invoker=on' = any(coalesce(c.reloptions, '{}'));
  if n <> 0 then raise exception 'fase2: ya hay % vistas con security_invoker (¿fase 2 aplicada?)', n; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('es_admin_activo', 'portal_dni') and p.prosecdef and p.provolatile = 's'
     and has_function_privilege('authenticated', p.oid, 'execute');
  if n <> 2 then raise exception 'fase2: es_admin_activo() y portal_dni() deben ser definer, stable y ejecutables por authenticated (%/2)', n; end if;
end $$;

-- 1 · GRANT SELECT en las 12 tablas bajo vistas que no tenían privilegio alguno
--     para authenticated. Las filas las decide RLS (política), no el grant.
grant select on table movimientos, notificaciones_documento, perfil_propuestas, rits, solicitud_avisos, solicitud_eventos, solicitud_tipos, solicitudes, ticket_avisos, ticket_subtipos, ticket_tipos, tickets to authenticated;

-- 2 · Políticas de lectura: lectura_admin (administrador activo) en 38 tablas;
--     lectura_sesion (administrador activo o trabajador identificado) en 4 catálogos.
do $$
declare t text;
begin
  foreach t in array array['activos', 'acuses', 'asignaciones', 'asistencia_lotes', 'auditoria', 'cargo_perfiles', 'comunicado_lecturas', 'comunicados', 'contratos', 'cuentas_portal', 'descargos', 'documentos', 'epp_entregas', 'feriados', 'lotes', 'marcaciones', 'memorandums', 'movimientos', 'notificaciones_documento', 'perfil_empresas', 'perfil_permisos', 'perfil_propuestas', 'perfiles', 'personas', 'politica_acceso', 'registro_accesos', 'rit_faltas', 'rits', 'sedes', 'solicitud_avisos', 'solicitud_eventos', 'solicitudes', 'solicitudes_cambio_cuenta', 'ticket_avisos', 'tickets', 'tipos_sancion', 'usuarios_admin', 'vinculos'] loop
    execute format('drop policy if exists lectura_admin on public.%I', t);
    execute format('create policy lectura_admin on public.%I for select to authenticated using (public.es_admin_activo())', t);
  end loop;
  foreach t in array array['declaraciones', 'solicitud_tipos', 'ticket_subtipos', 'ticket_tipos'] loop
    execute format('drop policy if exists lectura_sesion on public.%I', t);
    execute format('create policy lectura_sesion on public.%I for select to authenticated using (public.es_admin_activo() or public.portal_dni() is not null)', t);
  end loop;
end $$;

-- 3 · security_invoker en las 38 vistas del BackOffice y catálogos.
alter view public.v_actividad_persona set (security_invoker = on);
alter view public.v_activos set (security_invoker = on);
alter view public.v_acuses set (security_invoker = on);
alter view public.v_asistencia_lotes set (security_invoker = on);
alter view public.v_asistencia_mensual set (security_invoker = on);
alter view public.v_cargo_perfiles set (security_invoker = on);
alter view public.v_comunicado_pendientes set (security_invoker = on);
alter view public.v_comunicados set (security_invoker = on);
alter view public.v_contratos set (security_invoker = on);
alter view public.v_declaraciones_vigentes set (security_invoker = on);
alter view public.v_epp_entregas set (security_invoker = on);
alter view public.v_feriados set (security_invoker = on);
alter view public.v_lotes set (security_invoker = on);
alter view public.v_marcaciones set (security_invoker = on);
alter view public.v_memorandums set (security_invoker = on);
alter view public.v_mi_acceso set (security_invoker = on);
alter view public.v_mis_solicitudes set (security_invoker = on);
alter view public.v_movimientos_persona set (security_invoker = on);
alter view public.v_perfil_propuestas set (security_invoker = on);
alter view public.v_perfil_versiones set (security_invoker = on);
alter view public.v_perfiles set (security_invoker = on);
alter view public.v_personal set (security_invoker = on);
alter view public.v_politica_acceso set (security_invoker = on);
alter view public.v_registro_accesos set (security_invoker = on);
alter view public.v_rit_faltas set (security_invoker = on);
alter view public.v_rits set (security_invoker = on);
alter view public.v_sedes set (security_invoker = on);
alter view public.v_solicitud_avisos set (security_invoker = on);
alter view public.v_solicitud_eventos set (security_invoker = on);
alter view public.v_solicitud_tipos set (security_invoker = on);
alter view public.v_solicitudes set (security_invoker = on);
alter view public.v_ticket_avisos set (security_invoker = on);
alter view public.v_ticket_catalogo set (security_invoker = on);
alter view public.v_ticket_config set (security_invoker = on);
alter view public.v_tickets set (security_invoker = on);
alter view public.v_tipos_sancion set (security_invoker = on);
alter view public.v_usuarios_admin set (security_invoker = on);
alter view public.v_vinculos_persona set (security_invoker = on);

-- 4 · Verificación embebida (falla → rollback de toda la transacción).
do $$
declare n int; l text;
begin
  select string_agg(c.relname, ',' order by c.relname) into l
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'v' and 'security_invoker=on' = any(c.reloptions);
  if l is distinct from 'v_actividad_persona,v_activos,v_acuses,v_asistencia_lotes,v_asistencia_mensual,v_cargo_perfiles,v_comunicado_pendientes,v_comunicados,v_contratos,v_declaraciones_vigentes,v_epp_entregas,v_feriados,v_lotes,v_marcaciones,v_memorandums,v_mi_acceso,v_mis_solicitudes,v_movimientos_persona,v_perfil_propuestas,v_perfil_versiones,v_perfiles,v_personal,v_politica_acceso,v_registro_accesos,v_rit_faltas,v_rits,v_sedes,v_solicitud_avisos,v_solicitud_eventos,v_solicitud_tipos,v_solicitudes,v_ticket_avisos,v_ticket_catalogo,v_ticket_config,v_tickets,v_tipos_sancion,v_usuarios_admin,v_vinculos_persona' then
    raise exception 'fase2: vistas con security_invoker distintas de las esperadas: %', l; end if;
  select string_agg(c.relname, ',' order by c.relname) into l
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'v' and not ('security_invoker=on' = any(coalesce(c.reloptions, '{}')));
  if l is distinct from 'v_portal_boletas,v_portal_comunicados,v_portal_datos,v_portal_mes,v_portal_pendientes,v_portal_perfil,v_portal_rit,v_portal_solicitudes,v_portal_tickets' then
    raise exception 'fase2: vistas que siguen como dueño distintas de las 9 del Portal: %', l; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and policyname = 'lectura_admin';
  if n <> 38 then raise exception 'fase2: % políticas lectura_admin, esperadas 38', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and policyname = 'lectura_sesion';
  if n <> 4 then raise exception 'fase2: % políticas lectura_sesion, esperadas 4', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and (qual = 'true' or with_check = 'true');
  if n > 0 then raise exception 'fase2: % políticas con condición true', n; end if;
  select count(*) into n from unnest(array['movimientos', 'notificaciones_documento', 'perfil_propuestas', 'rits', 'solicitud_avisos', 'solicitud_eventos', 'solicitud_tipos', 'solicitudes', 'ticket_avisos', 'ticket_subtipos', 'ticket_tipos', 'tickets']) t
   where not has_table_privilege('authenticated', 'public.' || t, 'select')
      or has_table_privilege('authenticated', 'public.' || t, 'insert')
      or has_table_privilege('authenticated', 'public.' || t, 'update')
      or has_table_privilege('authenticated', 'public.' || t, 'delete');
  if n > 0 then raise exception 'fase2: % tablas del grant sin SELECT o con escritura para authenticated', n; end if;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r'
     and c.relname in (select unnest(array['activos', 'acuses', 'asignaciones', 'asistencia_lotes', 'auditoria', 'cargo_perfiles', 'comunicado_lecturas', 'comunicados', 'contratos', 'cuentas_portal', 'descargos', 'documentos', 'epp_entregas', 'feriados', 'lotes', 'marcaciones', 'memorandums', 'movimientos', 'notificaciones_documento', 'perfil_empresas', 'perfil_permisos', 'perfil_propuestas', 'perfiles', 'personas', 'politica_acceso', 'registro_accesos', 'rit_faltas', 'rits', 'sedes', 'solicitud_avisos', 'solicitud_eventos', 'solicitudes', 'solicitudes_cambio_cuenta', 'ticket_avisos', 'tickets', 'tipos_sancion', 'usuarios_admin', 'vinculos', 'declaraciones', 'solicitud_tipos', 'ticket_subtipos', 'ticket_tipos'])) and not c.relrowsecurity;
  if n > 0 then raise exception 'fase2: % tablas con política pero sin RLS activa', n; end if;
  -- Comportamiento: una sesión authenticated sin identidad conocida no ve nada
  -- ni por las vistas del BackOffice ni por las tablas.
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"nadie@ejemplo.invalido","sub":"00000000-0000-0000-0000-000000000000"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.v_personal;
  if n <> 0 then execute 'reset role'; raise exception 'fase2: v_personal devolvió % filas a una sesión sin identidad', n; end if;
  select count(*) into n from public.v_usuarios_admin;
  if n <> 0 then execute 'reset role'; raise exception 'fase2: v_usuarios_admin devolvió % filas a una sesión sin identidad', n; end if;
  select count(*) into n from public.personas;
  if n <> 0 then execute 'reset role'; raise exception 'fase2: personas devolvió % filas a una sesión sin identidad', n; end if;
  select count(*) into n from public.v_solicitud_tipos;
  if n <> 0 then execute 'reset role'; raise exception 'fase2: v_solicitud_tipos devolvió % filas a una sesión sin identidad', n; end if;
  execute 'reset role';
end $$;

commit;
