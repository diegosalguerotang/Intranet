// scripts/estado-produccion.mjs — Números de producción para docs/estado-del-proyecto.md.
// SOLO LECTURAS y SOLO CONTEOS: no imprime filas, nombres, documentos ni secretos.
// Lo corre Diego con `!` (token: scripts/token-supabase.ps1):
//   export SUPABASE_ACCESS_TOKEN=$(powershell -NoProfile -Command '. .\scripts\token-supabase.ps1 *>$null; $env:SUPABASE_ACCESS_TOKEN' | tail -n 1 | tr -d "\r\n") && node scripts/estado-produccion.mjs
const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }),
  });
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`); return JSON.parse(t);
};
const uno = async (q) => (await sql(q))[0];

const hoy = new Date().toISOString().slice(0, 10);
console.log(`== Estado de producción · ${hoy} (solo conteos)`);

const padron = await uno(`select
  (select count(*) from personas)::int as personas,
  (select count(*) from personas where nombre_por_confirmar)::int as nombre_por_confirmar,
  (select count(*) from personas where correo is not null)::int as con_correo,
  (select count(*) from personas where correo_verificado)::int as correo_verificado,
  (select count(*) from vinculos where fecha_fin is null)::int as vinculos_vigentes,
  (select count(*) from vinculos)::int as vinculos_total,
  (select count(*) from empresas where coalesce(estado,'activa') = 'activa')::int as empresas_activas,
  (select count(*) from sedes)::int as sedes,
  (select count(*) from movimientos)::int as movimientos`);
console.log("padrón:", JSON.stringify(padron));

const vig = await sql(`select v.empresa_id as empresa, count(*)::int as vigentes from vinculos v where v.fecha_fin is null group by 1 order by 1`);
console.log("vigentes por razón social:", JSON.stringify(vig));

const cuentas = await uno(`select
  (select count(*) from cuentas_portal)::int as cuentas_portal,
  (select count(*) from cuentas_portal where primer_ingreso_pendiente)::int as portal_primer_ingreso_pendiente,
  (select count(*) from auth.users where email like '%@portal.grupoer.pe')::int as auth_portal,
  (select count(*) from auth.users where email not like '%@portal.grupoer.pe')::int as auth_admin,
  (select count(*) from interno.usuarios_admin where estado = 'activo')::int as usuarios_admin_activos,
  (select count(*) from interno.usuarios_admin)::int as usuarios_admin_total,
  (select count(*) from interno.perfiles p where p.estado = 'activa' or p.estado = 'activo')::int as categorias_activas,
  (select count(distinct id) from interno.perfiles)::int as categorias_total`).catch(async () => uno(`select
  (select count(*) from cuentas_portal)::int as cuentas_portal,
  (select count(*) from auth.users where email like '%@portal.grupoer.pe')::int as auth_portal,
  (select count(*) from auth.users where email not like '%@portal.grupoer.pe')::int as auth_admin,
  (select count(*) from interno.usuarios_admin where estado = 'activo')::int as usuarios_admin_activos,
  (select count(*) from interno.usuarios_admin)::int as usuarios_admin_total,
  (select count(distinct id) from interno.perfiles)::int as categorias_total`));
console.log("cuentas:", JSON.stringify(cuentas));

const docs = await uno(`select
  (select count(*) from lotes)::int as lotes,
  (select count(*) from documentos)::int as documentos,
  (select count(*) from documentos where tipo = 'Reglamento interno')::int as documentos_rit,
  (select count(*) from acuses)::int as acuses,
  (select count(*) from acuses where registrado_en >= now() - interval '30 days')::int as acuses_30d,
  (select count(*) from acuses where modalidad = 'asistido')::int as acuses_asistidos,
  (select count(*) from consentimientos)::int as consentimientos,
  (select count(*) from notificaciones_documento)::int as notificaciones_documento,
  (select count(*) from comunicados)::int as comunicados,
  (select count(*) from comunicado_lecturas)::int as comunicado_lecturas,
  (select count(*) from memorandums)::int as memorandums,
  (select count(*) from solicitudes)::int as solicitudes,
  (select count(*) from tickets)::int as tickets,
  (select count(*) from activos)::int as activos,
  (select count(*) from lineas)::int as lineas,
  (select count(*) from licencias_office)::int as licencias_office,
  (select count(*) from marcaciones)::int as marcaciones,
  (select count(*) from asistencia_lotes)::int as asistencia_lotes`);
console.log("documentos y módulos:", JSON.stringify(docs));

const acusesPorEstado = await sql(`select estado, count(*)::int as n from v_acuses group by 1 order by 1`).catch(() => "no se pudo determinar (v_acuses)");
console.log("acuses por estado (v_acuses):", JSON.stringify(acusesPorEstado));

const accesos = await uno(`select
  (select count(*) from interno.registro_accesos)::int as registro_accesos,
  (select count(*) from interno.registro_accesos where resultado = 'exitoso' and superficie = 'portal')::int as ingresos_portal_ok,
  (select count(*) from interno.registro_accesos where resultado <> 'exitoso' and superficie = 'portal')::int as ingresos_portal_fallidos,
  (select count(distinct dni) from interno.registro_accesos where resultado = 'exitoso' and superficie = 'portal')::int as portal_personas_que_entraron,
  (select count(*) from interno.registro_accesos where resultado = 'exitoso' and superficie = 'backoffice')::int as ingresos_admin_ok,
  (select count(*) from interno.registro_accesos where resultado <> 'exitoso' and superficie = 'backoffice')::int as ingresos_admin_fallidos,
  (select min(fecha)::date from interno.registro_accesos where resultado = 'exitoso' and superficie = 'portal') as primer_ingreso_portal,
  (select max(fecha)::date from interno.registro_accesos where resultado = 'exitoso' and superficie = 'portal') as ultimo_ingreso_portal,
  (select min(fecha)::date from interno.registro_accesos) as primer_registro_acceso,
  (select count(*) from interno.auditoria)::int as auditoria,
  (select count(*) from correo_envios)::int as correo_envios,
  (select count(*) from correo_envios where resultado = 'error')::int as correo_errores`).catch((e) => ({ error: String(e.message).slice(0, 120) }));
console.log("accesos y rastro:", JSON.stringify(accesos));

const tam = await uno(`select pg_size_pretty(pg_database_size(current_database())) as base,
  (select pg_size_pretty(coalesce(sum((metadata->>'size')::bigint), 0)) from storage.objects where bucket_id = 'documentos') as bucket_documentos,
  (select count(*) from storage.objects where bucket_id = 'documentos')::int as objetos_documentos`);
console.log("tamaño:", JSON.stringify(tam));

const grandes = await sql(`select n.nspname || '.' || c.relname as tabla, c.reltuples::bigint as filas_aprox, pg_size_pretty(pg_total_relation_size(c.oid)) as tamano
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r' and n.nspname in ('public', 'interno') order by pg_total_relation_size(c.oid) desc limit 12`);
console.log("tablas más grandes (filas aprox. por estadísticas; tamaño real):");
for (const g of grandes) console.log(`   ${g.tabla.padEnd(34)} ${String(g.filas_aprox).padStart(8)}  ${g.tamano}`);
const exactas = await sql(`select 'interno.auditoria' as t, count(*)::int as n from interno.auditoria
  union all select 'interno.registro_accesos', count(*)::int from interno.registro_accesos
  union all select 'public.marcaciones', count(*)::int from marcaciones
  union all select 'public.acuses', count(*)::int from acuses
  union all select 'public.documentos', count(*)::int from documentos
  union all select 'public.lineas', count(*)::int from lineas
  union all select 'public.consentimientos', count(*)::int from consentimientos`);
console.log("conteos exactos:", JSON.stringify(exactas));

const catalogo = await uno(`select
  (select count(*) from pg_tables where schemaname = 'public')::int as tablas_public,
  (select count(*) from pg_tables where schemaname = 'interno')::int as tablas_interno,
  (select count(*) from pg_views where schemaname = 'public')::int as vistas_public,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public')::int as funciones_public,
  (select count(*) from pg_policies where schemaname in ('public','interno'))::int as politicas_rls,
  (select count(*) from pg_class where relkind = 'v' and relnamespace = 'public'::regnamespace and 'security_invoker=on' = any(coalesce(reloptions,'{}')))::int as vistas_invoker`);
console.log("catálogo:", JSON.stringify(catalogo));
console.log("== fin");
