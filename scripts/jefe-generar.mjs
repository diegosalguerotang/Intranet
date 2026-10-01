// scripts/jefe-generar.mjs — Genera la migración y la reversión del V°B° del
// jefe directo (2026-10-01): el jefe inmediato se elige de la lista de usuarios
// administrativos (por su código, nunca por documento), da su visto bueno desde
// su buzón sin necesitar el módulo Solicitudes, y recibe su aviso por correo.
// Los canónicos SON supabase/solicitudes.sql y supabase/api-servicio.sql: los
// cuerpos nuevos se extraen de ahí y los VIEJOS (reversión) del commit anterior
// a la edición (COMMIT_PREVIO). El EXECUTE de las dos funciones nuevas para
// authenticated vive en la lista 2b de supabase/seguridad.sql.
// Uso: node scripts/jefe-generar.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { entre } from "./politica-generar.mjs";

export const FECHA = "2026-10-01";
export const COMMIT_PREVIO = "cf29be7";
const EXISTENTES = ["fn_solicitud_insertar", "resolver_solicitud", "reenviar_solicitud"];
const NUEVAS = ["jefes_disponibles", "solicitudes_por_mi_visto_bueno"];

// Producción fija 'public, interno, extensions' en todas las funciones (fase
// 3a); el canónico no lo declara y el bloque FASE3 lo añade. split/join, nunca
// String.replace: los $$ del reemplazo se convertirían en $.
const SP = "set search_path = public, interno, extensions";
const comoProduccion = (sql) => sql
  .split("create function ").join("create or replace function ")
  .split("security definer as $$").join(`security definer ${SP} as $$`)
  .split("returns text language plpgsql as $$").join(`returns text language plpgsql ${SP} as $$`);

const leer = (ruta) => readFileSync(ruta, "utf8").replace(/\r\n/g, "\n");
const nuevo = leer("supabase/solicitudes.sql");
const viejo = execFileSync("git", ["show", `${COMMIT_PREVIO}:supabase/solicitudes.sql`], { encoding: "utf8" }).replace(/\r\n/g, "\n");
const funcion = (texto, nombre) => comoProduccion(entre(texto, `create function ${nombre}(`, "\nend $$;"));
const API = entre(leer("supabase/api-servicio.sql"), "create or replace function api_admin_correo_por_dni(", "\n$$;");

const VERIFICACION = `
-- Verificación embebida: las cinco funciones de sesión quedan con search_path
-- fijo; las dos nuevas son definer y solo las ejecuta authenticated; la de
-- servicio solo service_role; los cuerpos llevan la regla nueva.
do $v$
declare f text; r pg_proc;
begin
  foreach f in array array['public.fn_solicitud_insertar(text, text, jsonb, text)', 'public.resolver_solicitud(bigint, text, text, text)',
                           'public.reenviar_solicitud(bigint, jsonb, text)', 'public.jefes_disponibles()', 'public.solicitudes_por_mi_visto_bueno()'] loop
    select * into r from pg_proc where oid = f::regprocedure;
    if not exists (select 1 from unnest(r.proconfig) c where c like 'search_path=%') then
      raise exception 'jefe: % sin search_path fijo', f;
    end if;
    if has_function_privilege('anon', r.oid, 'execute') or not has_function_privilege('authenticated', r.oid, 'execute') then
      raise exception 'jefe: privilegios incorrectos en %', f;
    end if;
    if f not like '%fn_solicitud_insertar%' and not r.prosecdef then
      raise exception 'jefe: % debe ser security definer', f;
    end if;
  end loop;
  if (select prosrc from pg_proc where oid = 'public.fn_solicitud_insertar(text, text, jsonb, text)'::regprocedure) !~ 'supervisor_usuario'
     or (select prosrc from pg_proc where oid = 'public.resolver_solicitud(bigint, text, text, text)'::regprocedure) !~ 'v_caller = s\\.supervisor_dni' then
    raise exception 'jefe: los cuerpos no llevan la regla del jefe designado';
  end if;
  if has_function_privilege('authenticated', 'public.api_admin_correo_por_dni(text)', 'execute')
     or has_function_privilege('anon', 'public.api_admin_correo_por_dni(text)', 'execute')
     or not has_function_privilege('service_role', 'public.api_admin_correo_por_dni(text)', 'execute') then
    raise exception 'jefe: api_admin_correo_por_dni debe ser solo de service_role';
  end if;
end $v$;
`;

export const MIGRACION = `-- supabase/migraciones/${FECHA}-jefe-directo.sql
-- Generado por scripts/jefe-generar.mjs desde supabase/solicitudes.sql y api-servicio.sql (no editar a mano).
-- Una transacción. Reversión: supabase/respaldos/${FECHA}-jefe-directo-reversion.sql.
-- Aplica DIEGO con \`!\`:  node scripts/aplicar-sql.mjs supabase/migraciones/${FECHA}-jefe-directo.sql
-- V°B° del jefe directo: (1) el jefe se elige de jefes_disponibles() por su código de
-- usuario y fn_solicitud_insertar lo resuelve a persona (el documento ya no se acepta
-- del cliente, y nadie se elige a sí mismo); (2) resolver_solicitud deja dar el paso
-- «jefe» al jefe designado en la solicitud, sin exigirle el módulo; (3) el jefe ve lo
-- que espera su visto bueno con solicitudes_por_mi_visto_bueno(); (4) el aviso por
-- correo usa el correo de su cuenta (api_admin_correo_por_dni, solo service_role).
-- No toca datos. create or replace conserva los privilegios de las funciones existentes.
begin;
set local search_path = public, interno, extensions;

${EXISTENTES.map((f) => funcion(nuevo, f)).join("\n\n")}

${NUEVAS.map((f) => funcion(nuevo, f)).join("\n\n")}
revoke execute on function jefes_disponibles(), solicitudes_por_mi_visto_bueno() from public, anon;
grant execute on function jefes_disponibles(), solicitudes_por_mi_visto_bueno() to authenticated;

${API}
revoke all on function api_admin_correo_por_dni(text) from public, anon, authenticated;
grant execute on function api_admin_correo_por_dni(text) to service_role;
${VERIFICACION}
commit;
`;

export const REVERSION = `-- supabase/respaldos/${FECHA}-jefe-directo-reversion.sql — deshace la migración del mismo nombre.
-- Restaura los cuerpos anteriores (commit ${COMMIT_PREVIO}) y quita las tres funciones nuevas.
-- Las solicitudes creadas con jefe designado conservan su supervisor_dni (dato válido también
-- antes); solo deja de poder dar el V°B° desde su buzón. El cliente desplegado tolera la
-- ausencia de las funciones nuevas (lista vacía, campo de texto libre).
begin;
set local search_path = public, interno, extensions;

${EXISTENTES.map((f) => funcion(viejo, f)).join("\n\n")}

drop function if exists public.jefes_disponibles();
drop function if exists public.solicitudes_por_mi_visto_bueno();
drop function if exists public.api_admin_correo_por_dni(text);
commit;
`;

if (process.argv[1] && /jefe-generar\.mjs$/.test(process.argv[1])) {
  writeFileSync(`supabase/migraciones/${FECHA}-jefe-directo.sql`, MIGRACION);
  writeFileSync(`supabase/respaldos/${FECHA}-jefe-directo-reversion.sql`, REVERSION);
  console.log("Generados: migración jefe-directo y reversión.");
}
