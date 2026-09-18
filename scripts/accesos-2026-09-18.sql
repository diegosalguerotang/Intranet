-- scripts/accesos-2026-09-18.sql — Accesos del BackOffice según la foto
-- «Acceso intranet» (Diego, 2026-09-18). UNA transacción. Deja las cuentas
-- administrativas creadas SIN invitación: el correo lo dispara Diego desde
-- Accesos → Usuarios → «Crear cuenta». Renato y Moisés ya existen (no se tocan).
-- Jean Camacho y Luz Alccaco NO están en el padrón: pendientes de DNI.
-- Niveles: 1 solo ver · 2 ver y accionar · 3 ver, accionar y aprobar.
begin;
set local search_path = public, interno, extensions;

-- 1 · Categorías nuevas (todas las empresas del grupo, como las de la especificación).
select guardar_perfil('rrhh-coordinacion', 'RRHH coordinación',
  'Alta de personal con datos de planilla y correo.', false, false, false, false,
  '{"personal": 3}'::jsonb, array['lamericana', 'clean', 'negliaf', 'promant'], 'Diego Salguero Tang', false);
select guardar_perfil('rrhh-analista-boletas', 'RRHH analista · boletas',
  'Boletas, acuses y contratos.', false, false, false, false,
  '{"boletas": 2, "acuses": 2, "contratos": 2}'::jsonb, array['lamericana', 'clean', 'negliaf', 'promant'], 'Diego Salguero Tang', false);
select guardar_perfil('rrhh-analista-disciplina', 'RRHH analista · disciplina',
  'Acuses, memorándums, tardanzas y solicitudes.', false, false, false, false,
  '{"acuses": 2, "memorandums": 2, "tardanzas": 2, "solicitudes": 2}'::jsonb, array['lamericana', 'clean', 'negliaf', 'promant'], 'Diego Salguero Tang', false);
select guardar_perfil('rrhh-bienestar', 'RRHH bienestar',
  'Comunicados.', false, false, false, false,
  '{"comunicados": 2}'::jsonb, array['lamericana', 'clean', 'negliaf', 'promant'], 'Diego Salguero Tang', false);
select guardar_perfil('ti-gestion', 'TI gestión',
  'Toda la gestión de TI: activos, telefonía y soporte.', false, false, false, false,
  '{"activos": 3, "soporte": 3}'::jsonb, array['lamericana', 'clean', 'negliaf', 'promant'], 'Diego Salguero Tang', false);
select guardar_perfil('ti-inventario', 'TI inventario',
  'Inventario de activos y líneas móviles.', false, false, false, false,
  '{"activos": 2}'::jsonb, array['lamericana', 'clean', 'negliaf', 'promant'], 'Diego Salguero Tang', false);

-- 2 · Cuentas administrativas (sin clave provisional ni invitación todavía).
select crear_usuario_admin('73189654', 'jefatura-rrhh',            'maithe.espinoza@promant.pe', '', null, 'Diego Salguero Tang');
select crear_usuario_admin('73386191', 'rrhh-coordinacion',        'asistente.rrhh2@promant.pe', '', null, 'Diego Salguero Tang');
select crear_usuario_admin('74220092', 'rrhh-analista-boletas',    'asistenterrhh06@promant.pe', '', null, 'Diego Salguero Tang');
select crear_usuario_admin('72505627', 'rrhh-analista-disciplina', 'asist.rrhh3@promant.pe',     '', null, 'Diego Salguero Tang');
select crear_usuario_admin('45619796', 'ti-inventario',            'karen.gusman@promant.pe',    '', null, 'Diego Salguero Tang');

-- 3 · Propuestas generadas por la importación del padrón: descartadas (con auditoría).
do $$
declare r record;
begin
  for r in select id from perfil_propuestas where estado = 'pendiente' loop
    perform decidir_propuesta_perfil(r.id, 'descartada', 'Diego Salguero Tang');
  end loop;
end $$;

-- 4 · Verificación: 9 usuarios, 0 propuestas pendientes, 6 categorías nuevas activas.
do $$
declare n int;
begin
  select count(*) into n from usuarios_admin where estado = 'activo';
  if n <> 9 then raise exception 'accesos: % usuarios activos, esperados 9', n; end if;
  select count(*) into n from perfil_propuestas where estado = 'pendiente';
  if n <> 0 then raise exception 'accesos: quedan % propuestas pendientes', n; end if;
  select count(*) into n from perfiles where id in ('rrhh-coordinacion', 'rrhh-analista-boletas', 'rrhh-analista-disciplina', 'rrhh-bienestar', 'ti-gestion', 'ti-inventario') and estado = 'activo';
  if n <> 6 then raise exception 'accesos: % categorías nuevas, esperadas 6', n; end if;
end $$;

select u.id, u.correo, u.persona_dni, u.perfil_id, u.estado, u.requiere_cambio_clave
from usuarios_admin u order by u.id;
commit;
