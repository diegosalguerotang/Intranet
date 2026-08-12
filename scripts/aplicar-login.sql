-- ============================================================================
-- Delta: Cierre de Acceso y Bootstrap v1.0 (sobre el esquema de accesos ya
-- aplicado). El archivo canónico supabase/accesos.sql queda actualizado con
-- estos mismos cambios para un reset desde cero.
-- ============================================================================

-- Las vistas dependientes se recrean al final.
drop view if exists v_politica_acceso, v_usuarios_admin, v_registro_accesos cascade;

-- Cambio de clave obligatorio (bootstrap y claves provisionales)
alter table usuarios_admin add column if not exists requiere_cambio_clave boolean not null default false;

-- Intentos de login de correos inexistentes también se registran (ACC-06)
alter table registro_accesos add column if not exists correo text;

-- Longitud mínima de clave DIFERENCIADA por superficie (el operario tipea en
-- celulares de gama baja; el usuario administrativo no tiene esa excusa).
alter table politica_acceso add column if not exists clave_longitud_min_portal int not null default 6;
alter table politica_acceso add column if not exists clave_longitud_min_backoffice int not null default 12;
alter table politica_acceso drop column if exists clave_longitud_min;
do $$ begin
  alter table politica_acceso add constraint chk_clave_min_portal check (clave_longitud_min_portal >= 6);
  alter table politica_acceso add constraint chk_clave_min_backoffice check (clave_longitud_min_backoffice >= 12);
exception when duplicate_object then null; end $$;

-- guardar_politica cambia de firma: se elimina la anterior.
drop function if exists guardar_politica cascade;
create function guardar_politica(
  p_backoffice_horas int, p_portal_dias int,
  p_multisesion_backoffice boolean, p_multisesion_portal boolean,
  p_intentos int, p_bloqueo_min int, p_recuperacion text,
  p_clave_min_portal int, p_clave_min_backoffice int,
  p_provisional_dias int, p_por text
) returns void language plpgsql security definer as $$
begin
  update politica_acceso
  set sesion_backoffice_horas       = p_backoffice_horas,
      sesion_portal_dias            = p_portal_dias,
      multisesion_backoffice        = p_multisesion_backoffice,
      multisesion_portal            = p_multisesion_portal,
      intentos_bloqueo              = p_intentos,
      bloqueo_minutos               = p_bloqueo_min,
      recuperacion_defecto          = p_recuperacion,
      clave_longitud_min_portal     = p_clave_min_portal,
      clave_longitud_min_backoffice = p_clave_min_backoffice,
      clave_provisional_dias        = p_provisional_dias,
      actualizado_por               = p_por,
      actualizado_en                = now()
  where id = 1;
end $$;

-- Bloqueo por intentos fallidos (ACC-05): fallidos consecutivos posteriores
-- al último ingreso exitoso, dentro de la ventana de bloqueo.
create or replace function verificar_bloqueo(p_correo text) returns boolean
language plpgsql stable security definer as $$
declare pol politica_acceso%rowtype; ultimo_ok timestamptz; fallidos int;
begin
  select * into pol from politica_acceso where id = 1;
  select max(fecha) into ultimo_ok from registro_accesos
  where correo = p_correo and resultado = 'exitoso';
  select count(*) into fallidos from registro_accesos
  where correo = p_correo and resultado = 'fallido'
    and fecha > now() - make_interval(mins => pol.bloqueo_minutos)
    and (ultimo_ok is null or fecha > ultimo_ok);
  return fallidos >= pol.intentos_bloqueo;
end $$;

-- Bitácora de login del BackOffice: registra TODO intento (incluidos correos
-- inexistentes, con usuario_id nulo) y actualiza ultimo_ingreso si fue exitoso.
create or replace function registrar_ingreso(p_correo text, p_resultado text, p_dispositivo text)
returns void language plpgsql security definer as $$
declare u usuarios_admin%rowtype;
begin
  select * into u from usuarios_admin where correo = p_correo;
  insert into registro_accesos (usuario_id, dni, correo, perfil_id, perfil_version,
                                superficie, resultado, ip, dispositivo)
  values (u.id, u.persona_dni, p_correo, u.perfil_id, u.perfil_version,
          'backoffice', p_resultado, null, p_dispositivo);
  if p_resultado = 'exitoso' and u.id is not null then
    update usuarios_admin set ultimo_ingreso = now() where id = u.id;
  end if;
end $$;

create or replace function marcar_clave_cambiada(p_correo text) returns void
language plpgsql security definer as $$
begin
  update usuarios_admin
  set requiere_cambio_clave = false, clave_provisional = null
  where correo = p_correo;
end $$;

-- Vistas recreadas con los campos nuevos
create view v_usuarios_admin as
select u.id, u.persona_dni as dni, pe.nombre,
       u.perfil_id as perfil, pf.nombre as "perfilNombre",
       pf.es_superadmin as "esSuperadmin",
       u.correo, u.celular, u.estado,
       u.requiere_cambio_clave as "requiereCambio",
       coalesce((select jsonb_agg(a.empresa_id) from usuario_alcance_empresa a
                 where a.usuario_id = u.id), '[]'::jsonb) as empresas,
       coalesce((select jsonb_agg(a.sede_id) from usuario_alcance_sede a
                 where a.usuario_id = u.id), '[]'::jsonb) as sedes,
       to_char(u.ultimo_ingreso, 'YYYY-MM-DD HH24:MI') as "ultimoIngreso",
       (u.ultimo_ingreso is null) as "nuncaIngreso",
       (u.estado = 'activo' and not exists
         (select 1 from vinculos v where v.persona_dni = u.persona_dni and v.fecha_fin is null)) as inconsistencia,
       vi.cargo, vi.sede_id as sede, vi.empresa_id as empresa,
       to_char(u.creado_en, 'YYYY-MM-DD') as creado
from usuarios_admin u
join personas pe on pe.dni = u.persona_dni
join perfiles pf on pf.id = u.perfil_id and pf.version = u.perfil_version
left join vinculos vi on vi.persona_dni = u.persona_dni and vi.fecha_fin is null
order by pf.es_superadmin desc, pe.nombre;

create view v_politica_acceso as
select sesion_backoffice_horas as "sesionBackofficeHoras",
       sesion_portal_dias      as "sesionPortalDias",
       multisesion_backoffice  as "multisesionBackoffice",
       multisesion_portal      as "multisesionPortal",
       intentos_bloqueo        as "intentosBloqueo",
       bloqueo_minutos         as "bloqueoMinutos",
       recuperacion_defecto    as "recuperacionDefecto",
       clave_longitud_min_portal     as "claveLongitudMinPortal",
       clave_longitud_min_backoffice as "claveLongitudMinBackoffice",
       clave_provisional_dias  as "claveProvisionalDias",
       to_char(actualizado_en, 'YYYY-MM-DD HH24:MI') as actualizado,
       actualizado_por as "actualizadoPor"
from politica_acceso where id = 1;

create view v_registro_accesos as
select r.id,
       to_char(r.fecha, 'YYYY-MM-DD HH24:MI') as fecha,
       coalesce(pe.nombre, r.dni, r.correo, '—') as usuario,
       coalesce(pf.nombre, case when r.superficie = 'portal' then 'Portal del Trabajador' else '—' end) as perfil,
       r.superficie, r.resultado, r.ip, r.dispositivo,
       vi.empresa_id as empresa
from registro_accesos r
left join usuarios_admin u on u.id = r.usuario_id
left join personas pe on pe.dni = coalesce(u.persona_dni, r.dni)
left join perfiles pf on pf.id = r.perfil_id and pf.version = r.perfil_version
left join vinculos vi on vi.persona_dni = pe.dni and vi.fecha_fin is null
order by r.fecha desc;

-- Verificación
select (select count(*) from v_politica_acceso) as politica,
       (select "claveLongitudMinBackoffice" from v_politica_acceso) as min_backoffice,
       (select "claveLongitudMinPortal" from v_politica_acceso) as min_portal,
       (select count(*) from v_usuarios_admin where "requiereCambio") as requieren_cambio,
       (select verificar_bloqueo('nadie@grupoer.pe')) as bloqueo_inexistente;
