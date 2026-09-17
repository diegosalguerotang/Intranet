-- supabase/migraciones/2026-09-17-fase0b-tablas-backoffice.sql
-- Corrección de seguridad · FASE 0b — corrige un efecto de la fase 0 detectado
-- en producción (2026-09-17, tras aplicar 2026-09-17-fase0-contencion.sql):
-- el BackOffice quedaba EN BLANCO ("Cannot read properties of undefined
-- (reading 'corto')").
--
-- Causa: además de `lineas`, el BackOffice lee CUATRO tablas base directamente
-- por el mapa FUENTES de src/state.jsx (supabase.from(FUENTES[k])): empresas,
-- tardanzas, asistencia_config y plantillas. El paso 0 no las vio porque
-- buscaba el patrón `.from("tabla")`. Con RLS activa y sin política devuelven
-- vacío: `empresas` = [] y la interfaz revienta.
--
-- Arreglo (mismo modelo que lineas y documentos): política solo_admin con
-- es_admin_activo() en esas cuatro tablas. Un trabajador del Portal sigue sin
-- ver filas; un administrador activo las lee. UNA transacción, idempotente.
-- Reversión: supabase/respaldos/2026-09-17-fase0-reversion.sql (ya las borra).
begin;
set local search_path = public, extensions;

do $$
declare t text;
begin
  foreach t in array array['empresas', 'tardanzas', 'asistencia_config', 'plantillas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists solo_admin on public.%I', t);
    execute format('create policy solo_admin on public.%I for all to authenticated using (public.es_admin_activo()) with check (public.es_admin_activo())', t);
  end loop;
end $$;

-- Verificación embebida.
do $$
declare n int;
begin
  select count(*) into n from pg_policies
   where schemaname = 'public' and policyname = 'solo_admin'
     and tablename in ('lineas', 'empresas', 'tardanzas', 'asistencia_config', 'plantillas');
  if n <> 5 then raise exception 'fase0b: % políticas solo_admin, esperadas 5', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and (qual = 'true' or with_check = 'true');
  if n > 0 then raise exception 'fase0b: % políticas con condición true', n; end if;
end $$;

commit;
