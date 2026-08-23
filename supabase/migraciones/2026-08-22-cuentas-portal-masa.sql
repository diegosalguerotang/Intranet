-- 2026-08-22 · #13 Cuentas de portal en masa: v_personal expone si el
-- trabajador ya tiene cuenta del portal (para marcar «Sin cuenta» en Planilla
-- y crear en masa). La redefinición vive lógicamente en portal.sql porque
-- depende de cuentas_portal (mismo patrón que v_comunicados). Idempotente.
drop view if exists v_personal;
create view v_personal as
select p.dni, p.tipo_documento, p.nombre, v.cargo, v.sede_id as sede, v.empresa_id as empresa,
       to_char(v.fecha_inicio, 'YYYY-MM-DD') as ingreso,
       p.celular, p.portal,
       case when v.fecha_fin is null then 'vigente' else 'cesado' end as estado,
       p.banco, p.cuenta,
       to_char(v.fecha_fin, 'YYYY-MM-DD') as cese,
       v.id as vinculo_id,
       p.correo, p.correo_verificado as "correoVerificado",
       p.cci,
       exists (select 1 from cuentas_portal cp where cp.dni = p.dni) as "tieneCuenta"
from vinculos v join personas p on p.dni = v.persona_dni;
grant select on v_personal to authenticated;
