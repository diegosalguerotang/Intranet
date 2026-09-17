# Corrección de seguridad · Fase 0 — Informe forense

Fecha: 2026-09-17 · Proyecto Supabase `mzpbdkrmokfxrrsotfgs` · Solo lectura (`scripts/fase0-forense.mjs`).

## 1. Cuentas administrativas: ¿corresponden a personas reales del padrón?

| id | codigo | persona_dni | persona | correo | perfil_id | perfil_version | estado | superadmin | creado_por | creado_en | ultimo_ingreso | en_padron | vinculo_vigente | vinculos | en_auth | auth_creado | auth_ultimo_login |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | U-0001 | 40776655 | Diego Salguero Tang | diegosalguerotang@gmail.com | superadmin | 1 | activo | true | Sistema | 2026-08-12 19:39 | 2026-08-31 23:10 | true | false | 0 | true | 2026-08-12 20:32 | 2026-08-31 23:10 |
| 9 | U-0008 | 73189656 | ESPINOZA REYES RENATO EDEN | renato.espinoza@promant.pe | gerencia-administrativa | 1 | activo | true | Diego Salguero Tang | 2026-08-17 17:02 | 2026-08-21 23:17 | true | true | 1 | true | 2026-08-17 17:02 | 2026-08-21 23:17 |
| 10 | U-0009 | 40164196 | Sessire Tang | diego.salguero@redpontis.com | gerente-rrhh | 1 | activo | false | Diego Salguero Tang | 2026-08-18 03:45 | 2026-08-21 22:58 | true | false | 0 | true | 2026-08-18 03:45 | 2026-08-21 22:58 |
| 16 | U-0010 | 74966012 | Freznel Moises Oblitas Gamonel | asistgerencia@promant.pe | gerencia-administrativa | 1 | activo | true | Diego Salguero Tang | 2026-08-21 22:49 | 2026-08-21 22:51 | true | true | 1 | true | 2026-08-21 22:49 | 2026-08-21 22:51 |

## 2. Superadministradores

| id | codigo | persona_dni | persona | correo | estado | creado_por | creado_en |
|---|---|---|---|---|---|---|---|
| 1 | U-0001 | 40776655 | Diego Salguero Tang | diegosalguerotang@gmail.com | activo | Sistema | 2026-08-12 19:39 |
| 9 | U-0008 | 73189656 | ESPINOZA REYES RENATO EDEN | renato.espinoza@promant.pe | activo | Diego Salguero Tang | 2026-08-17 17:02 |
| 16 | U-0010 | 74966012 | Freznel Moises Oblitas Gamonel | asistgerencia@promant.pe | activo | Diego Salguero Tang | 2026-08-21 22:49 |

Esperados: dsalguero@grupoer.pe · Encontrados: asistgerencia@promant.pe, diegosalguerotang@gmail.com, renato.espinoza@promant.pe

## 3. Historial de usuarios_admin (trigger de auditoría, desde la puesta en producción)

| id | fecha | usuario | accion | usuario_id | correo | perfil_antes | perfil_despues | version_antes | version_despues | estado_antes | estado_despues | codigo | creado_por |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 15 | 2026-08-12 19:58:20 | postgres | UPDATE | 2 | kprado@grupoer.pe | rrhh-operativo | rrhh-operativo | 1 | 2 | activo | activo |  | Sistema |
| 28 | 2026-08-12 19:58:20 | postgres | UPDATE | 2 | kprado@grupoer.pe | rrhh-operativo | rrhh-operativo | 2 | 3 | activo | activo |  | Sistema |
| 30 | 2026-08-12 20:24:42 | postgres | UPDATE | 2 | kprado@grupoer.pe | rrhh-operativo | rrhh-operativo | 3 | 3 | activo | activo |  | Sistema |
| 31 | 2026-08-12 20:32:12 | postgres | UPDATE | 1 | dsalguero@grupoer.pe | superadmin | superadmin | 1 | 1 | activo | activo |  | Sistema |
| 34 | 2026-08-12 21:13:42 | postgres | UPDATE | 1 | dsalguero@grupoer.pe | superadmin | superadmin | 1 | 1 | activo | activo |  | Sistema |
| 35 | 2026-08-12 21:35:48 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo |  | Sistema |
| 36 | 2026-08-13 14:30:00 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo |  | Sistema |
| 37 | 2026-08-13 14:33:17 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo |  | Sistema |
| 38 | 2026-08-13 14:38:57 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo |  | Sistema |
| 39 | 2026-08-13 14:59:39 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo |  | Sistema |
| 40 | 2026-08-13 15:01:40 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo |  | Sistema |
| 41 | 2026-08-13 15:07:50 | postgres | UPDATE | 4 | ctorres@grupoer.pe | supervisor-sede | supervisor-sede | 1 | 1 | activo | suspendido |  | Sistema |
| 42 | 2026-08-13 15:07:51 | postgres | UPDATE | 4 | ctorres@grupoer.pe | supervisor-sede | supervisor-sede | 1 | 1 | suspendido | activo |  | Sistema |
| 43 | 2026-08-13 15:13:00 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo |  | Sistema |
| 52 | 2026-08-13 16:44:11 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 53 | 2026-08-13 16:44:11 | postgres | UPDATE | 2 | kprado@grupoer.pe | rrhh-operativo | rrhh-operativo | 3 | 3 | activo | activo | U-0002 | Sistema |
| 54 | 2026-08-13 16:44:11 | postgres | UPDATE | 3 |  | supervisor-sede | supervisor-sede | 1 | 1 | activo | activo | U-0003 | Sistema |
| 55 | 2026-08-13 16:44:11 | postgres | UPDATE | 4 | ctorres@grupoer.pe | supervisor-sede | supervisor-sede | 1 | 1 | activo | activo | U-0004 | Sistema |
| 80 | 2026-08-13 16:56:40 | postgres | INSERT | 5 | prueba-e2e@grupoer.pe |  | prueba-e2e |  | 2 |  | activo | U-0005 | verificar-categorias |
| 81 | 2026-08-13 16:56:41 | postgres | DELETE | 5 | prueba-e2e@grupoer.pe | prueba-e2e |  | 2 |  | activo |  |  |  |
| 84 | 2026-08-13 16:57:22 | postgres | INSERT | 6 | prueba-cuenta@grupoer.pe |  | gerente-administracion |  | 1 |  | activo | U-0006 | verificacion-serverless |
| 85 | 2026-08-13 16:58:50 | postgres | DELETE | 6 | prueba-cuenta@grupoer.pe | gerente-administracion |  | 1 |  | activo |  |  |  |
| 86 | 2026-08-13 17:07:38 | postgres | INSERT | 7 | prueba-cuenta@grupoer.pe |  | gerente-administracion |  | 1 |  | activo | U-0007 | verificacion-serverless-2 |
| 87 | 2026-08-13 17:08:03 | postgres | UPDATE | 7 | prueba-cuenta@grupoer.pe | gerente-administracion | gerente-administracion | 1 | 1 | activo | activo | U-0007 | verificacion-serverless-2 |
| 88 | 2026-08-13 17:08:06 | postgres | DELETE | 7 | prueba-cuenta@grupoer.pe | gerente-administracion |  | 1 |  | activo |  |  |  |
| 112 | 2026-08-13 21:00:35 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 1221 | 2026-08-17 15:23:27 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 1222 | 2026-08-17 15:24:48 | postgres | UPDATE | 4 | ctorres@grupoer.pe | supervisor-sede | supervisor-sede | 1 | 1 | activo | suspendido | U-0004 | Sistema |
| 1223 | 2026-08-17 15:25:05 | postgres | DELETE | 3 |  | supervisor-sede |  | 1 |  | activo |  |  |  |
| 1224 | 2026-08-17 15:25:14 | postgres | DELETE | 4 | ctorres@grupoer.pe | supervisor-sede |  | 1 |  | suspendido |  |  |  |
| 1225 | 2026-08-17 15:25:25 | postgres | DELETE | 2 | kprado@grupoer.pe | rrhh-operativo |  | 3 |  | activo |  |  |  |
| 1229 | 2026-08-17 15:49:19 | postgres | INSERT | 8 |  |  | zz-prueba-eliminar |  | 1 |  | activo |  | verificar-eliminar-perfil |
| 1230 | 2026-08-17 15:49:22 | postgres | DELETE | 8 |  | zz-prueba-eliminar |  | 1 |  | activo |  |  |  |
| 1339 | 2026-08-17 17:02:10 | postgres | INSERT | 9 | renato.espinoza@promant.pe |  | gerencia-administrativa |  | 1 |  | activo | U-0008 | Diego Salguero Tang |
| 1340 | 2026-08-17 17:02:13 | postgres | UPDATE | 9 | renato.espinoza@promant.pe | gerencia-administrativa | gerencia-administrativa | 1 | 1 | activo | activo | U-0008 | Diego Salguero Tang |
| 1601 | 2026-08-17 17:30:39 | postgres | UPDATE | 9 | renato.espinoza@promant.pe | gerencia-administrativa | gerencia-administrativa | 1 | 1 | activo | activo | U-0008 | Diego Salguero Tang |
| 1602 | 2026-08-17 17:32:24 | postgres | UPDATE | 9 | renato.espinoza@promant.pe | gerencia-administrativa | gerencia-administrativa | 1 | 1 | activo | activo | U-0008 | Diego Salguero Tang |
| 1603 | 2026-08-17 17:39:24 | postgres | UPDATE | 9 | renato.espinoza@promant.pe | gerencia-administrativa | gerencia-administrativa | 1 | 1 | activo | activo | U-0008 | Diego Salguero Tang |
| 1606 | 2026-08-17 17:54:42 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 1862 | 2026-08-18 03:40:30 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 1863 | 2026-08-18 03:42:48 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 1866 | 2026-08-18 03:45:21 | postgres | INSERT | 10 | diego.salguero@redpontis.com |  | gerente-rrhh |  | 1 |  | activo | U-0009 | Diego Salguero Tang |
| 1867 | 2026-08-18 03:45:23 | postgres | UPDATE | 10 | diego.salguero@redpontis.com | gerente-rrhh | gerente-rrhh | 1 | 1 | activo | activo | U-0009 | Diego Salguero Tang |
| 1868 | 2026-08-18 03:46:19 | postgres | UPDATE | 10 | diego.salguero@redpontis.com | gerente-rrhh | gerente-rrhh | 1 | 1 | activo | activo | U-0009 | Diego Salguero Tang |
| 1869 | 2026-08-18 03:46:36 | postgres | UPDATE | 10 | diego.salguero@redpontis.com | gerente-rrhh | gerente-rrhh | 1 | 1 | activo | activo | U-0009 | Diego Salguero Tang |
| 1870 | 2026-08-18 05:52:05 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 1878 | 2026-08-18 21:39:09 | postgres | UPDATE | 10 | diego.salguero@redpontis.com | gerente-rrhh | gerente-rrhh | 1 | 1 | activo | activo | U-0009 | Diego Salguero Tang |
| 1923 | 2026-08-19 19:29:41 | postgres | INSERT | 12 | zzprueba-e2e-solicitudes@grupoer.pe |  | superadmin |  | 1 |  | activo |  | e2e-pdf |
| 1926 | 2026-08-19 19:29:53 | postgres | DELETE | 12 | zzprueba-e2e-solicitudes@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |
| 1935 | 2026-08-19 19:52:31 | postgres | INSERT | 13 | zzprueba-e2e-solicitudes@grupoer.pe |  | superadmin |  | 1 |  | activo |  | e2e-pdf |
| 1940 | 2026-08-19 19:52:51 | postgres | DELETE | 13 | zzprueba-e2e-solicitudes@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |
| 1971 | 2026-08-19 21:56:41 | postgres | INSERT | 15 | zzprueba-propia@grupoer.pe |  | gerente-rrhh |  | 1 |  | activo |  | e2e-propia |
| 1972 | 2026-08-19 21:56:46 | postgres | DELETE | 15 | zzprueba-propia@grupoer.pe | gerente-rrhh |  | 1 |  | activo |  |  |  |
| 1973 | 2026-08-20 17:21:44 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 1974 | 2026-08-21 22:44:42 | postgres | UPDATE | 9 | renato.espinoza@promant.pe | gerencia-administrativa | gerencia-administrativa | 1 | 1 | activo | activo | U-0008 | Diego Salguero Tang |
| 1977 | 2026-08-21 22:49:33 | postgres | INSERT | 16 | asistgerencia@promant.pe |  | gerencia-administrativa |  | 1 |  | activo | U-0010 | Diego Salguero Tang |
| 1978 | 2026-08-21 22:49:35 | postgres | UPDATE | 16 | asistgerencia@promant.pe | gerencia-administrativa | gerencia-administrativa | 1 | 1 | activo | activo | U-0010 | Diego Salguero Tang |
| 1979 | 2026-08-21 22:51:47 | postgres | UPDATE | 16 | asistgerencia@promant.pe | gerencia-administrativa | gerencia-administrativa | 1 | 1 | activo | activo | U-0010 | Diego Salguero Tang |
| 1980 | 2026-08-21 22:52:30 | postgres | UPDATE | 16 | asistgerencia@promant.pe | gerencia-administrativa | gerencia-administrativa | 1 | 1 | activo | activo | U-0010 | Diego Salguero Tang |
| 1983 | 2026-08-21 22:56:05 | postgres | UPDATE | 9 | renato.espinoza@promant.pe | gerencia-administrativa | gerencia-administrativa | 1 | 1 | activo | activo | U-0008 | Diego Salguero Tang |
| 1984 | 2026-08-21 22:56:06 | postgres | UPDATE | 9 | renato.espinoza@promant.pe | gerencia-administrativa | gerencia-administrativa | 1 | 1 | activo | activo | U-0008 | Diego Salguero Tang |
| 1985 | 2026-08-21 22:58:06 | postgres | UPDATE | 10 | diego.salguero@redpontis.com | gerente-rrhh | gerente-rrhh | 1 | 1 | activo | activo | U-0009 | Diego Salguero Tang |
| 1991 | 2026-08-21 23:06:58 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 2005 | 2026-08-21 23:14:48 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 2009 | 2026-08-21 23:15:40 | postgres | UPDATE | 9 | renato.espinoza@promant.pe | gerencia-administrativa | gerencia-administrativa | 1 | 1 | activo | activo | U-0008 | Diego Salguero Tang |
| 2010 | 2026-08-21 23:15:41 | postgres | UPDATE | 9 | renato.espinoza@promant.pe | gerencia-administrativa | gerencia-administrativa | 1 | 1 | activo | activo | U-0008 | Diego Salguero Tang |
| 2011 | 2026-08-21 23:16:27 | postgres | UPDATE | 9 | renato.espinoza@promant.pe | gerencia-administrativa | gerencia-administrativa | 1 | 1 | activo | activo | U-0008 | Diego Salguero Tang |
| 2012 | 2026-08-21 23:17:14 | postgres | UPDATE | 9 | renato.espinoza@promant.pe | gerencia-administrativa | gerencia-administrativa | 1 | 1 | activo | activo | U-0008 | Diego Salguero Tang |
| 2013 | 2026-08-21 23:17:36 | postgres | UPDATE | 9 | renato.espinoza@promant.pe | gerencia-administrativa | gerencia-administrativa | 1 | 1 | activo | activo | U-0008 | Diego Salguero Tang |
| 2067 | 2026-08-22 00:18:39 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 2086 | 2026-08-23 00:23:42 | postgres | INSERT | 17 | zzprueba-masa@grupoer.pe |  | superadmin |  | 1 |  | activo |  | verificar-cuentas-masa |
| 2088 | 2026-08-23 00:26:32 | postgres | DELETE | 17 | zzprueba-masa@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |
| 2089 | 2026-08-23 00:27:03 | postgres | INSERT | 18 | zzprueba-masa@grupoer.pe |  | superadmin |  | 1 |  | activo |  | verificar-cuentas-masa |
| 2097 | 2026-08-23 00:27:16 | postgres | DELETE | 18 | zzprueba-masa@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |
| 2166 | 2026-08-24 13:38:31 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 2167 | 2026-08-24 13:38:32 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 2185 | 2026-08-24 14:12:40 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 2186 | 2026-08-24 14:12:40 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 2289 | 2026-08-24 14:26:56 | postgres | INSERT | 19 | zzprueba-mov@grupoer.pe |  | superadmin |  | 1 |  | activo |  | verificar-movimientos |
| 2315 | 2026-08-24 14:27:02 | postgres | DELETE | 19 | zzprueba-mov@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |
| 2343 | 2026-08-24 14:28:07 | postgres | INSERT | 20 | zzprueba-mov@grupoer.pe |  | superadmin |  | 1 |  | activo |  | verificar-movimientos |
| 2395 | 2026-08-24 14:29:26 | postgres | DELETE | 20 | zzprueba-mov@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |
| 2396 | 2026-08-24 14:29:30 | postgres | INSERT | 21 | zzprueba-mov@grupoer.pe |  | superadmin |  | 1 |  | activo |  | verificar-movimientos |
| 2410 | 2026-08-24 14:29:41 | postgres | DELETE | 21 | zzprueba-mov@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |
| 2447 | 2026-08-24 21:05:41 | postgres | INSERT | 22 | zzprueba-pdf@grupoer.pe |  | superadmin |  | 1 |  | activo |  | verificar-solicitud-pdf |
| 2454 | 2026-08-24 21:06:21 | postgres | DELETE | 22 | zzprueba-pdf@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |
| 2455 | 2026-08-24 21:08:21 | postgres | INSERT | 23 | zzprueba-pdf@grupoer.pe |  | superadmin |  | 1 |  | activo |  | verificar-solicitud-pdf |
| 2462 | 2026-08-24 21:09:03 | postgres | DELETE | 23 | zzprueba-pdf@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |
| 2627 | 2026-08-24 23:10:01 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 2628 | 2026-08-24 23:10:02 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 2677 | 2026-08-25 18:37:56 | postgres | INSERT | 24 | zzprueba-mov@grupoer.pe |  | superadmin |  | 1 |  | activo |  | verificar-movimientos |
| 2691 | 2026-08-25 18:38:10 | postgres | DELETE | 24 | zzprueba-mov@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |
| 2862 | 2026-08-25 18:43:39 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 2863 | 2026-08-25 18:43:40 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 2864 | 2026-08-25 19:31:10 | postgres | INSERT | 25 | zzprueba-const@grupoer.pe |  | superadmin |  | 1 |  | activo |  | verificar-constancia-pdf |
| 2875 | 2026-08-25 19:31:28 | postgres | DELETE | 25 | zzprueba-const@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |
| 2880 | 2026-08-25 20:01:30 | postgres | INSERT | 26 | zzprueba-bc@grupoer.pe |  | superadmin |  | 1 |  | activo |  | verificar-botones-bc |
| 2893 | 2026-08-25 20:01:46 | postgres | DELETE | 26 | zzprueba-bc@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |
| 2895 | 2026-08-25 20:02:30 | postgres | INSERT | 27 | zzprueba-bc@grupoer.pe |  | superadmin |  | 1 |  | activo |  | verificar-botones-bc |
| 2908 | 2026-08-25 20:02:47 | postgres | DELETE | 27 | zzprueba-bc@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |
| 2910 | 2026-08-26 15:56:09 | postgres | INSERT | 28 | zzprueba-cumpl@grupoer.pe |  | superadmin |  | 1 |  | activo |  | verificar-cumplimiento |
| 2926 | 2026-08-26 15:56:37 | postgres | DELETE | 28 | zzprueba-cumpl@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |
| 2928 | 2026-08-26 15:57:26 | postgres | INSERT | 29 | zzprueba-const@grupoer.pe |  | superadmin |  | 1 |  | activo |  | verificar-constancia-pdf |
| 2939 | 2026-08-26 15:57:38 | postgres | DELETE | 29 | zzprueba-const@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |
| 2944 | 2026-08-26 20:07:21 | postgres | INSERT | 30 | zzprueba-olvide@grupoer.pe |  | superadmin |  | 1 |  | activo |  | repro-olvide |
| 2945 | 2026-08-26 20:23:02 | postgres | DELETE | 30 | zzprueba-olvide@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |
| 3203 | 2026-08-27 16:27:34 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 3204 | 2026-08-27 16:27:34 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 4107 | 2026-08-31 20:52:27 | postgres | INSERT | 31 | zzdiag-login@grupoer.pe |  | gerencia-administrativa |  | 1 |  | activo |  | diagnostico |
| 4108 | 2026-08-31 20:52:36 | postgres | DELETE | 31 | zzdiag-login@grupoer.pe | gerencia-administrativa |  | 1 |  | activo |  |  |  |
| 4111 | 2026-08-31 20:53:14 | postgres | INSERT | 32 | zzdiag-login@grupoer.pe |  | gerencia-administrativa |  | 1 |  | activo |  | diagnostico |
| 4112 | 2026-08-31 20:53:17 | postgres | UPDATE | 32 | zzdiag-login@grupoer.pe | gerencia-administrativa | gerencia-administrativa | 1 | 1 | activo | activo |  | diagnostico |
| 4113 | 2026-08-31 20:53:18 | postgres | UPDATE | 32 | zzdiag-login@grupoer.pe | gerencia-administrativa | gerencia-administrativa | 1 | 1 | activo | activo |  | diagnostico |
| 4114 | 2026-08-31 20:53:25 | postgres | DELETE | 32 | zzdiag-login@grupoer.pe | gerencia-administrativa |  | 1 |  | activo |  |  |  |
| 4117 | 2026-08-31 20:54:38 | postgres | INSERT | 33 | zzdiag-login@grupoer.pe |  | gerencia-administrativa |  | 1 |  | activo |  | diagnostico |
| 4118 | 2026-08-31 20:54:42 | postgres | UPDATE | 33 | zzdiag-login@grupoer.pe | gerencia-administrativa | gerencia-administrativa | 1 | 1 | activo | activo |  | diagnostico |
| 4119 | 2026-08-31 20:54:43 | postgres | UPDATE | 33 | zzdiag-login@grupoer.pe | gerencia-administrativa | gerencia-administrativa | 1 | 1 | activo | activo |  | diagnostico |
| 4120 | 2026-08-31 20:54:50 | postgres | DELETE | 33 | zzdiag-login@grupoer.pe | gerencia-administrativa |  | 1 |  | activo |  |  |  |
| 4122 | 2026-08-31 21:19:18 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 4123 | 2026-08-31 21:19:18 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 4280 | 2026-08-31 21:36:22 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 4281 | 2026-08-31 21:36:22 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 4600 | 2026-08-31 23:10:52 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 4601 | 2026-08-31 23:10:52 | postgres | UPDATE | 1 | diegosalguerotang@gmail.com | superadmin | superadmin | 1 | 1 | activo | activo | U-0001 | Sistema |
| 4917 | 2026-09-02 19:27:10 | postgres | INSERT | 34 | zzprueba-cumpl@grupoer.pe |  | superadmin |  | 1 |  | activo |  | verificar-cumplimiento |
| 4933 | 2026-09-02 19:27:46 | postgres | DELETE | 34 | zzprueba-cumpl@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |
| 4935 | 2026-09-02 19:29:25 | postgres | INSERT | 35 | zzprueba-pdf@grupoer.pe |  | superadmin |  | 1 |  | activo |  | verificar-solicitud-pdf |
| 4942 | 2026-09-02 19:30:04 | postgres | DELETE | 35 | zzprueba-pdf@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |
| 4943 | 2026-09-02 19:30:31 | postgres | INSERT | 36 | zzprueba-masa@grupoer.pe |  | superadmin |  | 1 |  | activo |  | verificar-cuentas-masa |
| 4951 | 2026-09-02 19:30:51 | postgres | DELETE | 36 | zzprueba-masa@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |
| 5176 | 2026-09-14 17:49:38 | postgres | INSERT | 37 | zzprueba-cumpl@grupoer.pe |  | superadmin |  | 1 |  | activo |  | verificar-cumplimiento |
| 5192 | 2026-09-14 17:50:13 | postgres | DELETE | 37 | zzprueba-cumpl@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |
| 5194 | 2026-09-14 17:51:27 | postgres | INSERT | 38 | zzprueba-pdf@grupoer.pe |  | superadmin |  | 1 |  | activo |  | verificar-solicitud-pdf |
| 5201 | 2026-09-14 17:51:51 | postgres | DELETE | 38 | zzprueba-pdf@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |
| 5202 | 2026-09-14 17:52:00 | postgres | INSERT | 39 | zzprueba-masa@grupoer.pe |  | superadmin |  | 1 |  | activo |  | verificar-cuentas-masa |
| 5210 | 2026-09-14 17:52:18 | postgres | DELETE | 39 | zzprueba-masa@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |
| 5448 | 2026-09-14 21:38:43 | postgres | INSERT | 40 | zzprueba-cumpl@grupoer.pe |  | superadmin |  | 1 |  | activo |  | verificar-cumplimiento |
| 5464 | 2026-09-14 21:39:08 | postgres | DELETE | 40 | zzprueba-cumpl@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |
| 5466 | 2026-09-14 21:40:03 | postgres | INSERT | 41 | zzprueba-pdf@grupoer.pe |  | superadmin |  | 1 |  | activo |  | verificar-solicitud-pdf |
| 5467 | 2026-09-14 21:40:14 | postgres | INSERT | 42 | zzprueba-masa@grupoer.pe |  | superadmin |  | 1 |  | activo |  | verificar-cuentas-masa |
| 5468 | 2026-09-14 21:40:30 | postgres | DELETE | 42 | zzprueba-masa@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |
| 5500 | 2026-09-14 21:46:43 | postgres | DELETE | 41 | zzprueba-pdf@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |
| 5501 | 2026-09-14 21:46:46 | postgres | INSERT | 43 | zzprueba-pdf@grupoer.pe |  | superadmin |  | 1 |  | activo |  | verificar-solicitud-pdf |
| 5508 | 2026-09-14 21:47:17 | postgres | DELETE | 43 | zzprueba-pdf@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |
| 5509 | 2026-09-14 21:47:30 | postgres | INSERT | 44 | zzprueba-masa@grupoer.pe |  | superadmin |  | 1 |  | activo |  | verificar-cuentas-masa |
| 5517 | 2026-09-14 21:47:48 | postgres | DELETE | 44 | zzprueba-masa@grupoer.pe | superadmin |  | 1 |  | activo |  |  |  |

- Creaciones registradas: 38. Fuera del flujo ACC-02 (sin código U-xxxx o con usuario ≠ postgres): 32.
- Cambios de categoría (perfil o versión): 2.
- Modificaciones DIRECTAS de la tabla (usuario de auditoría ≠ postgres, es decir, sin pasar por una RPC security definer): 0.

Cambios de categoría en detalle:
| fecha | usuario | usuario_id | correo | perfil_antes | perfil_despues | version_antes | version_despues |
|---|---|---|---|---|---|---|---|
| 2026-08-12 19:58:20 | postgres | 2 | kprado@grupoer.pe | rrhh-operativo | rrhh-operativo | 1 | 2 |
| 2026-08-12 19:58:20 | postgres | 2 | kprado@grupoer.pe | rrhh-operativo | rrhh-operativo | 2 | 3 |

## 4. Historial de categorías y permisos (perfiles, perfil_permisos, perfil_empresas, politica_acceso)

| tabla | accion | usuario | n | desde | hasta |
|---|---|---|---|---|---|
| perfil_permisos | DELETE | postgres | 97 | 2026-08-17 | 2026-08-21 |
| perfil_permisos | INSERT | postgres | 138 | 2026-08-12 | 2026-08-31 |
| perfiles | DELETE | postgres | 15 | 2026-08-17 | 2026-08-23 |
| perfiles | ELIMINAR_PERFIL | postgres | 9 | 2026-08-17 | 2026-08-23 |
| perfiles | INSERT | postgres | 25 | 2026-08-12 | 2026-08-31 |
| perfiles | UPDATE | postgres | 10 | 2026-08-13 | 2026-08-17 |
| politica_acceso | UPDATE | postgres | 4 | 2026-08-12 | 2026-08-22 |

## 5. Toda la auditoría por rol de base (¿hubo escrituras directas con sesión?)

| usuario | n | desde | hasta |
|---|---|---|---|
| postgres | 3936 | 2026-08-10 | 2026-09-14 |

`postgres` = RPC security definer o Management API; `service_role` = funciones serverless; `authenticated` = escritura directa a tabla desde un navegador con sesión (BackOffice: solo `lineas` es legítima).

## 6. Ingresos registrados (registro_accesos)

| superficie | resultado | n | identidades | desde | hasta |
|---|---|---|---|---|---|
| backoffice | bloqueado | 1 | 1 | 2026-08-21 | 2026-08-21 |
| backoffice | exitoso | 37 | 7 | 2026-08-09 | 2026-08-31 |
| backoffice | fallido | 35 | 6 | 2026-08-11 | 2026-09-16 |
| portal | bloqueado | 1 | 1 | 2026-08-11 | 2026-08-11 |
| portal | exitoso | 21 | 9 | 2026-08-09 | 2026-08-27 |
| portal | fallido | 20 | 6 | 2026-08-11 | 2026-09-16 |

Trabajadores que han entrado al Portal (sesiones que PUDIERON llamar RPC administrativas antes de la fase 0):
| dni | ingresos | primero | ultimo | ips |
|---|---|---|---|---|
| 45231876 | 7 | 2026-08-12 00:02 | 2026-08-14 18:40 | 1 |
| 40164196 | 7 | 2026-08-19 17:59 | 2026-08-27 13:13 | 0 |
| 40776655 | 1 | 2026-08-18 05:56 | 2026-08-18 05:56 | 0 |
| 40881122 | 1 | 2026-08-24 23:22 | 2026-08-24 23:22 | 0 |
| 48012765 | 1 | 2026-08-09 12:58 | 2026-08-09 12:58 | 1 |
| 73189656 | 1 | 2026-08-21 23:02 | 2026-08-21 23:02 | 0 |
| 09113655 | 1 | 2026-08-17 17:13 | 2026-08-17 17:13 | 0 |
| 76926184 | 1 | 2026-08-24 23:29 | 2026-08-24 23:29 | 0 |
| 40125634 | 1 | 2026-08-24 23:17 | 2026-08-24 23:17 | 0 |

## 7. Cuentas de Supabase Auth sin correspondencia

Cuentas en Auth: 4 · administradores: 4 · portal con cuenta: 0 · sin correspondencia: 0
_(sin filas)_

## 8. Llamadas a RPC por sesión (logs del API de Supabase, ventana de retención)

_Los logs del API no devolvieron llamadas a RPC en la ventana disponible (retención agotada o sin tráfico registrado)._

## 9. Conclusión

**39 hallazgo(s) que requieren revisión:**

- Cuenta admin #1 (diegosalguerotang@gmail.com): la persona 40776655 no tiene ningún vínculo laboral registrado.
- Cuenta admin #10 (diego.salguero@redpontis.com): la persona 40164196 no tiene ningún vínculo laboral registrado.
- SUPERADMIN NO ESPERADO: asistgerencia@promant.pe.
- SUPERADMIN NO ESPERADO: diegosalguerotang@gmail.com.
- SUPERADMIN NO ESPERADO: renato.espinoza@promant.pe.
- Superadmin esperado ausente o sin categoría superadmin: dsalguero@grupoer.pe.
- Creación de usuario admin #8 (null) el 2026-08-17 15:49:19 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #12 (zzprueba-e2e-solicitudes@grupoer.pe) el 2026-08-19 19:29:41 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #13 (zzprueba-e2e-solicitudes@grupoer.pe) el 2026-08-19 19:52:31 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #15 (zzprueba-propia@grupoer.pe) el 2026-08-19 21:56:41 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #17 (zzprueba-masa@grupoer.pe) el 2026-08-23 00:23:42 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #18 (zzprueba-masa@grupoer.pe) el 2026-08-23 00:27:03 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #19 (zzprueba-mov@grupoer.pe) el 2026-08-24 14:26:56 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #20 (zzprueba-mov@grupoer.pe) el 2026-08-24 14:28:07 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #21 (zzprueba-mov@grupoer.pe) el 2026-08-24 14:29:30 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #22 (zzprueba-pdf@grupoer.pe) el 2026-08-24 21:05:41 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #23 (zzprueba-pdf@grupoer.pe) el 2026-08-24 21:08:21 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #24 (zzprueba-mov@grupoer.pe) el 2026-08-25 18:37:56 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #25 (zzprueba-const@grupoer.pe) el 2026-08-25 19:31:10 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #26 (zzprueba-bc@grupoer.pe) el 2026-08-25 20:01:30 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #27 (zzprueba-bc@grupoer.pe) el 2026-08-25 20:02:30 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #28 (zzprueba-cumpl@grupoer.pe) el 2026-08-26 15:56:09 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #29 (zzprueba-const@grupoer.pe) el 2026-08-26 15:57:26 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #30 (zzprueba-olvide@grupoer.pe) el 2026-08-26 20:07:21 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #31 (zzdiag-login@grupoer.pe) el 2026-08-31 20:52:27 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #32 (zzdiag-login@grupoer.pe) el 2026-08-31 20:53:14 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #33 (zzdiag-login@grupoer.pe) el 2026-08-31 20:54:38 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #34 (zzprueba-cumpl@grupoer.pe) el 2026-09-02 19:27:10 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #35 (zzprueba-pdf@grupoer.pe) el 2026-09-02 19:29:25 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #36 (zzprueba-masa@grupoer.pe) el 2026-09-02 19:30:31 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #37 (zzprueba-cumpl@grupoer.pe) el 2026-09-14 17:49:38 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #38 (zzprueba-pdf@grupoer.pe) el 2026-09-14 17:51:27 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #39 (zzprueba-masa@grupoer.pe) el 2026-09-14 17:52:00 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #40 (zzprueba-cumpl@grupoer.pe) el 2026-09-14 21:38:43 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #41 (zzprueba-pdf@grupoer.pe) el 2026-09-14 21:40:03 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #42 (zzprueba-masa@grupoer.pe) el 2026-09-14 21:40:14 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #43 (zzprueba-pdf@grupoer.pe) el 2026-09-14 21:46:46 SIN código: fuera del flujo ACC-02.
- Creación de usuario admin #44 (zzprueba-masa@grupoer.pe) el 2026-09-14 21:47:30 SIN código: fuera del flujo ACC-02.
- Usuario admin #1 (diegosalguerotang@gmail.com) existe SIN fila de auditoría de su creación (insertado con el trigger apagado o antes de la auditoría).

Límite de la evidencia: la base no registra quién llamó cada RPC (la auditoría guarda el rol de ejecución, que en una RPC security definer es siempre `postgres`); solo los logs del API identifican la sesión y su retención es corta. Para el periodo anterior a esa ventana la afirmación posible es: no hay rastro en la base de efectos administrativos anómalos (cuentas, categorías, superadmins).

## 10. Lectura de los hallazgos (revisión, 2026-09-17)

Los 39 hallazgos automáticos se explican sin necesidad de asumir un incidente:

- **32 «creaciones fuera de ACC-02»**: son cuentas `zzprueba-*` / `zzdiag-login` / `zz-prueba-eliminar` creadas por las suites `scripts/verificar-*.mjs` y `diagnostico-login-e2e.mjs` con la Management API (rol `postgres`, sin código porque insertan directo), y eliminadas por la misma suite segundos o minutos después. Ninguna sigue existiendo (las cuentas vivas son #1, #9, #10 y #16, todas con código U-xxxx y creadas por `crear_usuario_admin`).
- **3 superadministradores encontrados** (Diego #1, Renato #9 y Moisés #16, estos dos con la categoría `gerencia-administrativa`, que tiene `es_superadmin`): el valor «esperado» era el supuesto del script (`dsalguero@grupoer.pe`). Renato y Moisés fueron creados por Diego el 17-08 y el 21-08. **Diego debe confirmar que los tres deben serlo**; el script admite `SUPERADMINS_ESPERADOS` para fijar la lista oficial.
- **2 cuentas sin vínculo laboral** (Diego #1 y Sessire #10): son cuentas creadas a mano antes del padrón definitivo; el padrón real no las incluye como trabajadores. No es una anomalía de acceso, pero la fase 1 debe decidir si toda cuenta administrativa exige vínculo.
- **#1 sin fila de auditoría de creación**: la sembró `scripts/seed-superadmin.mjs` el 12-08 (antes de que existiera la tabla `usuarios_admin` auditada en su forma actual).
- **2 cambios de categoría**: el usuario #2 (`kprado@grupoer.pe`, cuenta de demostración ya eliminada) el 12-08 a las 19:58, por `postgres`, como parte del versionado de la categoría `rrhh-operativo` en la siembra inicial.
- **0 modificaciones directas** de `usuarios_admin` ni de ninguna otra tabla con el rol `authenticated`: las 3.936 filas de auditoría son de `postgres` (RPC security definer o Management API).
- **0 cuentas de Auth huérfanas** y ninguna cuenta de Auth de trabajador (`@portal.grupoer.pe`) tras la limpieza del 31-08.
- **Logs del API vacíos** en la ventana consultada: la retención del plan no cubre el periodo del piloto, así que **no es posible afirmar ni descartar** llamadas a RPC administrativas desde sesiones del Portal entre el 09-08 y el 17-09. Lo que sí se afirma: no dejaron efectos (ninguna cuenta, categoría, superadmin ni política cambió fuera de las acciones de Diego y de las suites).

**Conclusión revisada:** no hay evidencia de brecha explotada; la ventana sin logs es el único hueco y debe constar en la decisión 16.
