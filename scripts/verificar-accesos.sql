-- Verificación del módulo de Accesos y Roles (Task 10 del plan)
select (select count(*) from v_perfiles)                              as perfiles,
       (select count(*) from v_usuarios_admin)                        as usuarios,
       (select count(*) from v_usuarios_admin where "esSuperadmin")   as superadmins,
       (select count(*) from v_registro_accesos)                      as registros,
       (select count(*) from v_politica_acceso)                       as politica,
       (select puede(2, 'personal', 2, 'negliaf', null))              as karina_personal_2,
       (select puede(3, 'boletas', 1, null, null))                    as supervisor_boletas_1,
       (select puede(1, 'configuracion', 3, null, null))              as superadmin_config_3,
       (select puede(3, 'acuses', 2, 'negliaf', 'sunat'))             as supervisor_acuse_sunat,
       (select puede(3, 'acuses', 2, 'negliaf', 'minedu'))            as supervisor_acuse_minedu,
       (select puede(3, 'acuses', 2, 'bremco', null))                 as supervisor_bremco;
