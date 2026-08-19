-- Gestión de TI (2026-08-19): campos estilo sistema PROMANT (promant.pe/correo).
-- · activos.ip y activos.clave_equipo (la clave SOLO la lee el superadmin, vía RPC auditada)
-- · asignaciones.antivirus y asignaciones.comentario
-- · v_activos con ip + datos de la asignación abierta (jamás la clave)
-- · data real del TI de PROMANT: IP de 19 equipos, modelo si faltaba
-- Idempotente. Aplicar con: node scripts/aplicar-sql.mjs supabase/migraciones/2026-08-19-gestion-ti.sql

alter table activos add column if not exists ip text;
alter table activos add column if not exists clave_equipo text; -- SOLO superadmin la lee (RPC auditada)
alter table asignaciones add column if not exists antivirus boolean;
alter table asignaciones add column if not exists comentario text;

-- v_activos: + ip + datos de la asignación abierta. NUNCA clave_equipo.
drop view if exists v_activos;
create view v_activos as
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
       (ac.clave_equipo is not null) as tiene_clave
from activos ac
left join asignaciones asg on asg.activo_codigo = ac.codigo and asg.devuelto_en is null
left join vinculos vi on vi.persona_dni = asg.persona_dni and vi.fecha_fin is null;

-- asignar_activo: + antivirus/comentario (defaults null: compatible con llamadas viejas).
create or replace function asignar_activo(
  p_codigo text, p_dni text, p_condicion text default 'Buen estado',
  p_antivirus boolean default null, p_comentario text default null
) returns void language plpgsql security definer as $$
begin
  if exists (select 1 from asignaciones where activo_codigo = p_codigo and devuelto_en is null) then
    raise exception 'El activo % ya está asignado. Regístrese la devolución primero.', p_codigo;
  end if;
  if (select estado_fisico from activos where codigo = p_codigo) <> 'operativo' then
    raise exception 'El activo % no está operativo.', p_codigo;
  end if;
  insert into asignaciones (activo_codigo, persona_dni, condicion_entrega, antivirus, comentario)
  values (p_codigo, p_dni, p_condicion, p_antivirus, nullif(trim(coalesce(p_comentario,'')), ''));
end $$;

-- editar_activo: + p_ip. Se DROPea la firma vieja (10 args) para no dejar sobrecarga ambigua.
drop function if exists editar_activo(text,text,text,text,text,text,text,text,text,text);
create function editar_activo(
  p_codigo text, p_nuevo_codigo text, p_tipo text, p_marca text, p_modelo text,
  p_serie text, p_area text, p_asignado_sin_confirmar text, p_observaciones text,
  p_por text default 'Gestión de TI', p_ip text default null
) returns void language plpgsql security definer as $$
declare v_nuevo text; j_antes jsonb; j_despues jsonb;
begin
  if not exists (select 1 from activos where codigo = p_codigo) then
    raise exception 'El activo % no existe.', p_codigo;
  end if;
  v_nuevo := trim(coalesce(p_nuevo_codigo, ''));
  if v_nuevo = '' then
    raise exception 'El activo necesita un código.';
  end if;
  if v_nuevo <> p_codigo and exists (select 1 from activos where codigo = v_nuevo) then
    raise exception 'Ya existe un activo con el código %.', v_nuevo;
  end if;

  select to_jsonb(ac) - 'clave_equipo' into j_antes from activos ac where codigo = p_codigo;
  update activos set
    codigo = v_nuevo,
    tipo = nullif(trim(coalesce(p_tipo, '')), ''),
    marca = nullif(trim(coalesce(p_marca, '')), ''),
    modelo = nullif(trim(coalesce(p_modelo, '')), ''),
    serie = nullif(trim(coalesce(p_serie, '')), ''),
    area = nullif(trim(coalesce(p_area, '')), ''),
    ip = nullif(trim(coalesce(p_ip, '')), ''),
    asignado_sin_confirmar = nullif(trim(coalesce(p_asignado_sin_confirmar, '')), ''),
    observaciones = nullif(trim(coalesce(p_observaciones, '')), ''),
    por_corregir = case when v_nuevo <> p_codigo then false else por_corregir end
  where codigo = p_codigo;
  select to_jsonb(ac) - 'clave_equipo' into j_despues from activos ac where codigo = v_nuevo;

  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('EDITAR_ACTIVO', 'activos',
    j_antes || jsonb_build_object('por', p_por), j_despues);
end $$;

-- Clave del equipo: escribir y leer SOLO superadmin (fn_nivel_modulo devuelve 99
-- para superadmin y para llamadas de servicio sin JWT). Todo acceso queda auditado.
create or replace function guardar_clave_equipo(p_codigo text, p_clave text, p_por text default 'Gestión de TI')
returns void language plpgsql security definer as $$
begin
  if fn_nivel_modulo('activos') < 99 then
    raise exception 'Solo el superadministrador administra claves de equipos.';
  end if;
  if not exists (select 1 from activos where codigo = p_codigo) then
    raise exception 'El activo % no existe.', p_codigo;
  end if;
  update activos set clave_equipo = nullif(trim(coalesce(p_clave,'')), '') where codigo = p_codigo;
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('CLAVE_EQUIPO_GUARDADA', 'activos',
    jsonb_build_object('codigo', p_codigo, 'por', p_por), null);
end $$;

create or replace function ver_clave_equipo(p_codigo text, p_por text default 'Gestión de TI')
returns text language plpgsql security definer as $$
declare v text;
begin
  if fn_nivel_modulo('activos') < 99 then
    raise exception 'Solo el superadministrador puede ver claves de equipos.';
  end if;
  select clave_equipo into v from activos where codigo = p_codigo;
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('CLAVE_EQUIPO_VISTA', 'activos',
    jsonb_build_object('codigo', p_codigo, 'por', p_por), null);
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Data del sistema TI de PROMANT (promant.pe/correo, extraída 2026-08-19):
-- IP siempre; modelo SOLO si el nuestro está vacío (el suyo describe el
-- monitor en las PC). 'Antigua' no es IP: va a observaciones.
-- ---------------------------------------------------------------------------
create or replace function fn_ti_promant(p_codigo text, p_ip text, p_modelo text)
returns void language plpgsql as $$
begin
  update activos set
    ip = coalesce(nullif(trim(coalesce(p_ip,'')),''), ip),
    modelo = coalesce(modelo, nullif(trim(coalesce(p_modelo,'')),''))
  where codigo = p_codigo and empresa_id = 'promant';
end $$;

select fn_ti_promant('PROLT01', null,            'LENOVO');
select fn_ti_promant('PROLT04', '192.168.1.185', 'LENOVO');
select fn_ti_promant('PROLT05', '192.168.1.172', 'LENOVO');
select fn_ti_promant('PROLT06', null,            'HP');
select fn_ti_promant('PROLT07', null,            'LENOVO');
select fn_ti_promant('PROLT13', null,            'HP');
select fn_ti_promant('PROLT16', null,            'LENOVO');
select fn_ti_promant('PROLT17', null,            'DELL');
select fn_ti_promant('PROLT19', '192.168.1.145', 'HP');
select fn_ti_promant('PROLT20', '192.168.1.171', 'INSPIRON 3421');
select fn_ti_promant('PROLT23', '192.168.1.147', 'LENOVO');
select fn_ti_promant('PROLT24', '192.168.1.113', 'LENOVO');
select fn_ti_promant('PROLT25', null,            'ASUS');
select fn_ti_promant('PROLT26', '192.168.1.213', 'ASUSTEK');
select fn_ti_promant('PROLT47', '192.168.1.207', 'LENOVO');
select fn_ti_promant('PROLT51', '192.168.1.202', 'LENOVO');
select fn_ti_promant('PROLT54', '192.168.1.25',  'ACER');
select fn_ti_promant('PROLT09', '192.168.1.100', 'GIGABYTE TECHNOLOGY CO.');
select fn_ti_promant('PROPC02', '192.168.1.102', 'MONITOR AOC');
select fn_ti_promant('PROPC03', '192.168.1.246', 'MONITOR AOC');
select fn_ti_promant('PROPC08', '192.168.1.232', 'MONITOR AOC');
select fn_ti_promant('PROPC10', null,            'MONITOR LG');
select fn_ti_promant('PROPC14', null,            'MONITOR BENQ');
select fn_ti_promant('PROPC15', null,            'MONITOR SAMSUNG');
select fn_ti_promant('PROPC18', null,            'MONITOR AOC');
select fn_ti_promant('PROPC21', '192.168.1.173', 'MONITOR SAMSUNG');
select fn_ti_promant('PROPC22', '192.168.1.141', 'MONITOR SAMSUNG');
select fn_ti_promant('PROPC31', '192.168.1.154', 'MONITOR: LG');
select fn_ti_promant('PROPC46', '192.168.1.109', 'MONITOR AOC');
select fn_ti_promant('PROPC49', null,            'MONITOR A320M -S2H');

-- PROPC10: en su sistema el campo IP dice 'Antigua' (dato sucio) — a observaciones.
update activos set observaciones = trim(both '; ' from coalesce(observaciones,'') || '; equipo antiguo (TI PROMANT)')
where codigo = 'PROPC10' and empresa_id = 'promant'
  and coalesce(observaciones,'') not like '%equipo antiguo (TI PROMANT)%';

drop function fn_ti_promant(text, text, text);

grant select on v_activos to authenticated;
