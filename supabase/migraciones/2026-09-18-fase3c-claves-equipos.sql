-- supabase/migraciones/2026-09-18-fase3c-claves-equipos.sql
-- Corrección de seguridad · FASE 3c — CLAVES DE EQUIPOS (decisión P5: puntero
-- al gestor de contraseñas, no la clave). GENERADA por scripts/fase3c-generar.mjs
-- a partir de supabase/claves-equipos.sql (no editar a mano).
--
-- UNA transacción. Reversión: supabase/respaldos/2026-09-18-fase3c-reversion.sql
-- (ensayo: scripts/ensayar-fase3c.mjs). Requiere la fase 3b aplicada.
-- Sin ventana: el cliente sigue leyendo v_activos (misma vista, una columna más).

begin;
set local search_path = public, interno, extensions;

-- 0 · Precondición: fase 3b aplicada, columna secreta presente y vacía, columna nueva ausente.
do $$
declare n int;
begin
  if to_regclass('interno.datos_bancarios') is null then raise exception 'fase3c: se esperaba la fase 3b aplicada'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'activos' and column_name = 'clave_equipo') then
    raise exception 'fase3c: activos.clave_equipo no existe (¿fase 3c aplicada?)'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'activos' and column_name = 'clave_gestor') then
    raise exception 'fase3c: activos.clave_gestor ya existe'; end if;
  if to_regclass('interno.respaldo_fase3c') is not null then raise exception 'fase3c: interno.respaldo_fase3c ya existe'; end if;
  select count(*) into n from public.activos where clave_equipo is not null;
  if n > 0 then raise exception 'fase3c: % activos con clave guardada: pásalas al gestor de contraseñas y déjalas en null antes', n; end if;
end $$;

-- 1 · Respaldo de lo que cambia (para la reversión exacta).
create table interno.respaldo_fase3c (objeto text primary key, definicion text not null);
revoke all on table interno.respaldo_fase3c from public, anon, authenticated;
insert into interno.respaldo_fase3c
select 'fn:' || p.oid::regprocedure::text, pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('guardar_clave_equipo', 'ver_clave_equipo');
insert into interno.respaldo_fase3c values
  ('view:v_activos', 'create or replace view public.v_activos as ' || pg_get_viewdef('public.v_activos'::regclass, true));

-- 2 · Canónico de la fase (supabase/claves-equipos.sql).
-- supabase/claves-equipos.sql — Corrección de seguridad · FASE 3c (2026-09-18):
-- CLAVES DE EQUIPOS. Decisión P5 (Decisiones_Seguridad_QA): la intranet NO
-- guarda claves de equipos; guarda un PUNTERO al gestor de contraseñas (el
-- nombre de la entrada), que no es un secreto. Con eso no queda nada que mover
-- al esquema privado: la columna secreta desaparece.
--
-- Canónico de la fase 3c. Lo embebe la migración
-- migraciones/2026-09-18-fase3c-claves-equipos.sql y el bloque @@FASE3C@@ de
-- seguridad.sql. Idempotente. En producción no había ninguna clave guardada
-- (0 de 79 activos, 2026-09-18); si la hubiera, la migración se detiene:
-- primero se pasa al gestor y se deja en null.
--
--  · activos.clave_equipo (texto plano) se ELIMINA; nace activos.clave_gestor
--    (referencia en el gestor de contraseñas).
--  · v_activos: tiene_clave pasa a significar «tiene referencia» y expone la
--    referencia (columna nueva al final; misma vista security_invoker).
--  · guardar_clave_equipo / ver_clave_equipo (misma firma, el cliente no
--    cambia): guardan y devuelven la referencia. Guardar exige nivel de acción
--    en Activos (antes solo superadmin: ya no es un secreto) y queda en
--    auditoría con la referencia; ver exige solo ver Activos y no se audita.

-- 1 · Columna nueva y vista (antes de retirar la columna vieja: la vista depende de ella).
alter table activos add column if not exists clave_gestor text;
comment on column activos.clave_gestor is 'Referencia (nombre de la entrada) en el gestor de contraseñas. Nunca la clave (decisión P5, 2026-09-18).';

create or replace view v_activos as
select ac.codigo, ac.categoria, ac.marca, ac.modelo, ac.serie, ac.imei,
       case when ac.estado_fisico = 'baja' then 'baja'
            when ac.estado_fisico = 'mantenimiento' then 'mantenimiento'
            when asg.id is not null then 'asignado'
            else 'disponible' end as estado,
       asg.persona_dni as asignado,
       asg.antivirus, asg.comentario as comentario_asignacion,
       coalesce(vi.sede_id, ac.sede_id) as sede,
       ac.empresa_id as empresa, ac.valor,
       to_char(ac.compra, 'YYYY-MM-DD') as compra,
       ac.tipo, ac.area, ac.asignado_sin_confirmar, ac.usuario_anterior, ac.observaciones,
       ac.por_corregir, ac.ip,
       (ac.clave_gestor is not null) as tiene_clave,
       ac.clave_gestor
from activos ac
left join asignaciones asg on asg.activo_codigo = ac.codigo and asg.devuelto_en is null
left join vinculos vi on vi.persona_dni = asg.persona_dni and vi.fecha_fin is null;
alter view v_activos set (security_invoker = on);

-- 2 · Retiro de la columna secreta (una sola vez; se niega si hay claves guardadas).
do $$
declare n int;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'activos' and column_name = 'clave_equipo') then
    select count(*) into n from activos where clave_equipo is not null;
    if n > 0 then
      raise exception 'fase3c: % activos tienen clave guardada en la intranet: pásalas al gestor de contraseñas y déjalas en null antes (decisión P5)', n;
    end if;
    alter table activos drop column clave_equipo;
  end if;
end $$;

-- 3 · Funciones (misma firma que antes).
create or replace function guardar_clave_equipo(p_codigo text, p_clave text, p_por text default 'Gestión de TI')
returns void language plpgsql security definer set search_path = public, interno, extensions as $$
declare v text := nullif(trim(coalesce(p_clave, '')), '');
begin
  perform requiere_nivel('activos', 2);  -- guarda central (fase 1)
  if not exists (select 1 from activos where codigo = p_codigo) then
    raise exception 'El activo % no existe.', p_codigo;
  end if;
  if v is not null and length(v) > 120 then
    raise exception 'La referencia al gestor de contraseñas es demasiado larga (máximo 120 caracteres).';
  end if;
  update activos set clave_gestor = v where codigo = p_codigo;
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('REFERENCIA_CLAVE_GUARDADA', 'activos',
    jsonb_build_object('codigo', p_codigo, 'por', p_por), jsonb_build_object('referencia', v));
end $$;

create or replace function ver_clave_equipo(p_codigo text, p_por text default 'Gestión de TI')
returns text language plpgsql stable security definer set search_path = public, interno, extensions as $$
declare v text;
begin
  if fn_nivel_modulo('activos') < 1 then
    raise exception 'Tu categoría no permite ver Activos.';
  end if;
  select clave_gestor into v from activos where codigo = p_codigo;
  return v;
end $$;

-- 3 · Verificación embebida (falla → rollback de toda la transacción).
do $$
declare n int; r text;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'activos' and column_name = 'clave_equipo') then
    raise exception 'fase3c: activos.clave_equipo sigue'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'activos' and column_name = 'clave_gestor') then
    raise exception 'fase3c: falta activos.clave_gestor'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'v_activos' and column_name = 'clave_gestor') then
    raise exception 'fase3c: v_activos no expone clave_gestor'; end if;
  if not ('security_invoker=on' = any(coalesce((select reloptions from pg_class where oid = 'public.v_activos'::regclass), '{}'))) then raise exception 'fase3c: v_activos perdió security_invoker'; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('guardar_clave_equipo', 'ver_clave_equipo') and p.prosrc ~ 'clave_equipo\M';
  if n <> 0 then raise exception 'fase3c: % funciones siguen nombrando clave_equipo', n; end if;
  select count(*) into n from unnest(array['guardar_clave_equipo(text, text, text)', 'ver_clave_equipo(text, text)']) f
   where not has_function_privilege('authenticated', ('public.' || f)::regprocedure, 'execute');
  if n <> 0 then raise exception 'fase3c: % funciones perdieron el EXECUTE de authenticated', n; end if;
  -- Comportamiento: sin identidad, guardar se niega por la guarda y v_activos devuelve 0 filas.
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"nadie@ejemplo.invalido","sub":"00000000-0000-0000-0000-000000000000"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.v_activos;
  if n <> 0 then execute 'reset role'; raise exception 'fase3c: v_activos devolvió % filas sin identidad', n; end if;
  begin
    perform public.guardar_clave_equipo('ZZ-NADA', 'x', 'verificación');
    execute 'reset role'; raise exception 'fase3c: guardar_clave_equipo no exigió nivel';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
end $$;
commit;
