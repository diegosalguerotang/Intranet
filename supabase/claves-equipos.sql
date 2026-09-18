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
