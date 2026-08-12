-- Prueba de versionado: guardar una v2 de rrhh-operativo, comprobar que los
-- usuarios asignados pasan a la versión nueva, y dejar una v3 con la matriz
-- completa original (el historial conserva las tres versiones).
select guardar_perfil('rrhh-operativo', 'RRHH operativo', 'Prueba de versionado', false, false, false, false,
  '{"personal":2}'::jsonb, 'Verificación') as v2;

select guardar_perfil('rrhh-operativo', 'RRHH operativo',
  'Opera los módulos de RRHH del día a día, sin aprobaciones.',
  false, false, false, false,
  '{"personal":2,"boletas":2,"acuses":2,"comunicados":2,"memorandums":2,"contratos":2,"tardanzas":2,"activos":1,"accesos":0,"auditoria":0,"configuracion":1}'::jsonb,
  'Verificación') as v3;

select (select perfil_version from usuarios_admin where persona_dni = '40881122') as version_karina,
       (select count(*) from v_perfil_versiones where "perfilId" = 'rrhh-operativo') as versiones,
       (select version from v_perfiles where id = 'rrhh-operativo') as vigente,
       (select count(*) from auditoria where tabla = 'perfiles') as eventos_auditoria;
