-- scripts/accesos-2026-09-22.sql — Cierre de los dos pendientes de la foto
-- «Acceso intranet» del 2026-09-18 (Diego entregó los DNI el 2026-09-22).
-- UNA transacción. Cuentas SIN invitación: el correo lo dispara Diego desde
-- Accesos → Usuarios → «Crear cuenta».
-- Padrón ya resuelto (alta_trabajador, 2026-09-22): Luz Allccaco 76097062 en
-- NEGLIAF (Asistente de RR HH) y Jean Camacho 70122408 en PROMANT (TI-GESTOR,
-- sede Por asignar, ingreso 2026-09-22).
-- Uso: . .\scripts\token-supabase.ps1; node scripts/aplicar-sql.mjs scripts/accesos-2026-09-22.sql
begin;
set local search_path = public, interno, extensions;

-- 1 · Luz del Carmen Allccaco García → RRHH bienestar.
select crear_usuario_admin('76097062', 'rrhh-bienestar', 'rrhh4@promant.pe', '', null, 'Diego Salguero Tang');

-- 2 · Jean Paul Camacho Gómez → TI gestión.
select crear_usuario_admin('70122408', 'ti-gestion', 'consultoria@promant.pe', '', null, 'Diego Salguero Tang');

-- 3 · Verificación: las dos cuentas activas con su categoría.
do $$
declare n int;
begin
  select count(*) into n from usuarios_admin
  where (persona_dni, perfil_id) in (('76097062', 'rrhh-bienestar'), ('70122408', 'ti-gestion')) and estado = 'activo';
  if n <> 2 then raise exception 'accesos: % cuentas activas, esperadas 2', n; end if;
end $$;

select u.codigo, u.correo, u.persona_dni, u.perfil_id, u.estado, u.requiere_cambio_clave
from usuarios_admin u where u.persona_dni in ('76097062', '70122408') order by u.id;
commit;
