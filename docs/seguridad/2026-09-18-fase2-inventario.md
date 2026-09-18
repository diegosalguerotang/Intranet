# Fase 2 · Inventario de vistas (Postgres local, estado fases 0+0b+1)

Fecha: 2026-09-18. Conteos = filas devueltas a cada sesión (admin sin marca / superadmin / trabajador del Portal). Estados: **A** = hoy (vistas como dueño); **B** = security_invoker=on sin políticas nuevas; **C** = B + política lectura_admin (es_admin_activo()) en las 44 tablas base de public. Relaciones en cursiva = vistas anidadas. Funciones marcadas (invoker) corren con los permisos del consultante.

| Vista | filas | A adm/sup/trab | B adm/sup/trab | C adm/sup/trab | Relaciones debajo | Funciones debajo |
|---|---|---|---|---|---|---|
| v_actividad_persona | 5 | 5/5/5 | 0/0/0 | 5/5/0 | auditoria |  |
| v_activos | 7 | 7/7/7 | 0/0/0 | 7/7/0 | activos, asignaciones, vinculos |  |
| v_acuses | 11 | 11/11/11 | 0/0/0 | 11/11/0 | acuses, documentos, notificaciones_documento, personas, vinculos |  |
| v_asistencia_lotes | 0 | 0/0/0 | 0/0/0 | 0/0/0 | asistencia_lotes, empresas |  |
| v_asistencia_mensual | 0 | 0/0/0 | 0/0/0 | 0/0/0 | marcaciones, personas, vinculos | fn_hora_entrada |
| v_cargo_perfiles | 34 | 34/34/34 | 0/0/0 | 34/34/0 | cargo_perfiles, perfiles, vinculos |  |
| v_comunicado_pendientes | 48 | 48/48/48 | 0/0/0 | 48/48/0 | comunicado_lecturas, comunicados, personas, sedes, vinculos |  |
| v_comunicados | 3 | 3/3/3 | 0/0/0 | 3/3/0 | comunicado_lecturas, comunicados |  |
| v_contratos | 4 | 4/4/4 | 0/0/0 | 4/4/0 | contratos, vinculos |  |
| v_declaraciones_vigentes | 3 | 3/3/3 | 0/0/0 | 3/3/0 | declaraciones |  |
| v_epp_entregas | 3 | 3/3/3 | 0/0/0 | 3/3/0 | epp_entregas |  |
| v_feriados | 16 | 16/16/16 | 0/0/0 | 16/16/0 | feriados |  |
| v_lotes | 1 | 1/1/1 | 0/0/0 | 1/1/0 | acuses, documentos, lotes |  |
| v_marcaciones | 0 | 0/0/0 | 0/0/0 | 0/0/0 | marcaciones, personas |  |
| v_memorandums | 3 | 3/3/3 | 0/0/0 | 3/3/0 | descargos, memorandums, tipos_sancion, vinculos |  |
| v_mi_acceso | 3 | 3/3/3 | 0/0/0 | 3/3/0 | perfil_empresas, perfil_permisos, perfiles, usuarios_admin |  |
| v_mis_solicitudes | 0 | 0/0/0 | ERR 42501/ERR 42501/ERR 42501 | ERR 42501/ERR 42501/ERR 42501 | solicitud_eventos, solicitud_tipos, solicitudes | fn_persona_llamador |
| v_movimientos_persona | 0 | 0/0/0 | ERR 42501/ERR 42501/ERR 42501 | ERR 42501/ERR 42501/ERR 42501 | empresas, movimientos |  |
| v_perfil_propuestas | 0 | 0/0/0 | ERR 42501/ERR 42501/ERR 42501 | ERR 42501/ERR 42501/ERR 42501 | empresas, perfil_propuestas, perfiles, personas, usuarios_admin |  |
| v_perfil_versiones | 18 | 18/18/18 | 0/0/0 | 18/18/0 | perfil_empresas, perfil_permisos, perfiles |  |
| v_perfiles | 18 | 18/18/18 | 0/0/0 | 18/18/0 | perfil_empresas, perfil_permisos, perfiles, usuarios_admin |  |
| v_personal | 17 | 17/17/17 | 0/0/0 | 17/17/0 | cuentas_portal, personas, vinculos | fn_hora_entrada |
| v_politica_acceso | 1 | 1/1/1 | 0/0/0 | 1/1/0 | politica_acceso |  |
| v_portal_boletas | 0 | 0/0/1 | 0/0/0 | 0/0/0 | acuses, documentos, empresas, vinculos | portal_dni |
| v_portal_comunicados | 0 | 0/0/3 | 0/0/0 | 0/0/0 | comunicado_lecturas, comunicados | portal_dni |
| v_portal_datos | 0 | 0/0/1 | 0/0/0 | 0/0/0 | empresas, personas, sedes, solicitudes_cambio_cuenta, vinculos | portal_dni |
| v_portal_mes | 0 | 0/0/0 | 0/0/0 | 0/0/0 | tardanzas | portal_dni |
| v_portal_pendientes | 0 | 0/0/0 | 0/0/0 | 0/0/0 | acuses, comunicado_lecturas, comunicados, documentos, vinculos | portal_dni |
| v_portal_perfil | 0 | 0/0/1 | 0/0/0 | 0/0/0 | cuentas_portal, empresas, personas, sedes, vinculos | portal_dni, portal_modo |
| v_portal_rit | 0 | 0/0/1 | ERR 42501/ERR 42501/ERR 42501 | ERR 42501/ERR 42501/ERR 42501 | empresas, personas, rits, sedes, vinculos | portal_dni |
| v_portal_solicitudes | 0 | 0/0/0 | ERR 42501/ERR 42501/ERR 42501 | ERR 42501/ERR 42501/ERR 42501 | solicitud_eventos, solicitud_tipos, solicitudes | portal_dni |
| v_portal_tickets | 0 | 0/0/0 | ERR 42501/ERR 42501/ERR 42501 | ERR 42501/ERR 42501/ERR 42501 | ticket_subtipos, ticket_tipos, tickets | portal_dni |
| v_registro_accesos | 7 | 7/7/7 | 0/0/0 | 7/7/0 | perfiles, personas, registro_accesos, usuarios_admin, vinculos |  |
| v_rit_faltas | 50 | 50/50/50 | 0/0/0 | 50/50/0 | rit_faltas |  |
| v_rits | 1 | 1/1/1 | ERR 42501/ERR 42501/ERR 42501 | ERR 42501/ERR 42501/ERR 42501 | empresas, rits, sedes |  |
| v_sedes | 6 | 6/6/6 | ERR 42501/ERR 42501/ERR 42501 | ERR 42501/ERR 42501/ERR 42501 | empresas, personas, rits, sedes |  |
| v_solicitud_avisos | 1 | 1/1/1 | ERR 42501/ERR 42501/ERR 42501 | ERR 42501/ERR 42501/ERR 42501 | solicitud_avisos, solicitud_tipos |  |
| v_solicitud_eventos | 0 | 0/0/0 | ERR 42501/ERR 42501/ERR 42501 | ERR 42501/ERR 42501/ERR 42501 | solicitud_eventos |  |
| v_solicitud_tipos | 2 | 2/2/2 | ERR 42501/ERR 42501/ERR 42501 | ERR 42501/ERR 42501/ERR 42501 | solicitud_tipos |  |
| v_solicitudes | 0 | 0/0/0 | ERR 42501/ERR 42501/ERR 42501 | ERR 42501/ERR 42501/ERR 42501 | personas, solicitud_tipos, solicitudes |  |
| v_ticket_avisos | 1 | 1/1/1 | ERR 42501/ERR 42501/ERR 42501 | ERR 42501/ERR 42501/ERR 42501 | ticket_avisos |  |
| v_ticket_catalogo | 18 | 18/18/18 | ERR 42501/ERR 42501/ERR 42501 | ERR 42501/ERR 42501/ERR 42501 | ticket_subtipos, ticket_tipos |  |
| v_ticket_config | 26 | 26/26/26 | ERR 42501/ERR 42501/ERR 42501 | ERR 42501/ERR 42501/ERR 42501 | ticket_subtipos, ticket_tipos |  |
| v_tickets | 0 | 0/0/0 | ERR 42501/ERR 42501/ERR 42501 | ERR 42501/ERR 42501/ERR 42501 | ticket_subtipos, ticket_tipos, tickets |  |
| v_tipos_sancion | 6 | 6/6/6 | 0/0/0 | 6/6/0 | tipos_sancion |  |
| v_usuarios_admin | 3 | 3/3/3 | 0/0/0 | 3/3/0 | perfil_empresas, perfiles, personas, usuarios_admin, vinculos |  |
| v_vinculos_persona | 17 | 17/17/17 | 0/0/0 | 17/17/0 | empresas, sedes, vinculos |  |

Tablas base bajo las vistas (44): activos, acuses, asignaciones, asistencia_lotes, auditoria, cargo_perfiles, comunicado_lecturas, comunicados, contratos, cuentas_portal, declaraciones, descargos, documentos, empresas, epp_entregas, feriados, lotes, marcaciones, memorandums, movimientos, notificaciones_documento, perfil_empresas, perfil_permisos, perfil_propuestas, perfiles, personas, politica_acceso, registro_accesos, rit_faltas, rits, sedes, solicitud_avisos, solicitud_eventos, solicitud_tipos, solicitudes, solicitudes_cambio_cuenta, tardanzas, ticket_avisos, ticket_subtipos, ticket_tipos, tickets, tipos_sancion, usuarios_admin, vinculos.
