// Limpieza de producción para la ronda "desde cero" de Diego (2026-08-27):
// borra TODA la data de prueba que él puede volver a subir (trabajadores,
// vínculos, boletas, acuses, comunicados, memorándums, solicitudes, tickets,
// cuentas de portal, consentimientos, asistencia) y conserva:
//   - los 4 usuarios administrativos y sus personas (Diego, Renato, Sessire, Moisés)
//   - activos y líneas móviles (pedido explícito), sedes, empresas, categorías,
//     catálogos, políticas, RIT (tabla + PDF), auditoría y registro de accesos.
//
// Re-ejecutable e idempotente. Requiere SUPABASE_ACCESS_TOKEN:
//   . .\scripts\token-supabase.ps1; node scripts/limpiar-produccion.mjs

const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!SUPABASE_ACCESS_TOKEN) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }

const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const SUPA = `https://${PROYECTO}.supabase.co`;
const ADMINS = "'40776655','73189656','40164196','74966012'";

const json = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  const cuerpo = await json(r);
  if (!r.ok) { console.error("SQL falló:", JSON.stringify(cuerpo)); process.exit(1); }
  return cuerpo;
};

console.log("1 · Borrado en BD (una sola transacción; triggers de inmutabilidad apagados y re-encendidos dentro)");
await sql(`
  alter table acuses disable trigger trg_acuses_inmutables;
  alter table consentimientos disable trigger trg_consentimientos_inmutables;
  alter table movimientos disable trigger tg_movimientos_inmutables;
  alter table notificaciones_documento disable trigger trg_notificaciones_inmutables;
  alter table solicitud_eventos disable trigger tg_solicitud_eventos_inmutables;
  alter table descargos disable trigger trg_descargos_inmutables;

  delete from notificaciones_documento;
  delete from acuses;
  delete from solicitud_eventos;
  delete from solicitudes;
  delete from solicitud_correlativos;
  delete from documentos;
  delete from lotes;
  delete from comunicado_lecturas;
  delete from comunicados;
  delete from descargos;
  delete from memorandums;
  delete from tickets;
  delete from epp_entregas;
  delete from tardanzas;
  delete from contratos;
  delete from marcaciones;
  delete from asistencia_lotes;
  delete from movimientos;
  delete from consentimientos;
  delete from correo_tokens;
  delete from solicitudes_cambio_cuenta;
  delete from cuentas_portal;
  delete from asignaciones where persona_dni not in (${ADMINS});
  update sedes set supervisor_dni = null
    where supervisor_dni is not null and supervisor_dni not in (${ADMINS});
  delete from vinculos;
  delete from personas where dni not in (${ADMINS});
  alter sequence seq_ticket_numero restart with 1;

  alter table acuses enable trigger trg_acuses_inmutables;
  alter table consentimientos enable trigger trg_consentimientos_inmutables;
  alter table movimientos enable trigger tg_movimientos_inmutables;
  alter table notificaciones_documento enable trigger trg_notificaciones_inmutables;
  alter table solicitud_eventos enable trigger tg_solicitud_eventos_inmutables;
  alter table descargos enable trigger trg_descargos_inmutables;
`);
console.log("   BD limpia.");

console.log("2 · Cuentas Auth del portal (@portal.grupoer.pe)");
const claves = await json(await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` },
}));
const service = (Array.isArray(claves) ? claves : []).find((k) => k.type === "secret" || k.name === "service_role")?.api_key;
if (!service) { console.error("La Management API no devolvió la service key."); process.exit(1); }
const cabService = { apikey: service, authorization: `Bearer ${service}`, "Content-Type": "application/json" };

const lista = await json(await fetch(`${SUPA}/auth/v1/admin/users?per_page=1000`, { headers: cabService }));
const portalUsers = (lista.users ?? []).filter((u) => (u.email ?? "").toLowerCase().endsWith("@portal.grupoer.pe"));
for (const u of portalUsers) {
  const r = await fetch(`${SUPA}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: cabService });
  console.log(`   ${r.ok ? "borrada" : `ERROR ${r.status}`}: ${u.email}`);
}
if (!portalUsers.length) console.log("   (no había cuentas de portal)");

console.log("3 · Storage: demo/, lotes/, pruebas/, solicitudes/, cargos/ (rit/ se conserva)");
const objetos = await sql(`select name from storage.objects where bucket_id = 'documentos'
  and (name like 'demo/%' or name like 'lotes/%' or name like 'pruebas/%'
       or name like 'solicitudes/%' or name like 'cargos/%')`);
const nombres = objetos.map((o) => o.name);
for (let i = 0; i < nombres.length; i += 100) {
  const tramo = nombres.slice(i, i + 100);
  const r = await fetch(`${SUPA}/storage/v1/object/documentos`, {
    method: "DELETE", headers: cabService, body: JSON.stringify({ prefixes: tramo }),
  });
  if (!r.ok) { console.error(`   ERROR ${r.status} borrando tramo:`, await r.text()); process.exit(1); }
}
console.log(`   ${nombres.length} archivos borrados.`);

console.log("4 · Verificación");
const [v] = await sql(`select
  (select count(*) from personas) personas,
  (select count(*) from vinculos) vinculos,
  (select count(*) from usuarios_admin where estado = 'activo') admins,
  (select count(*) from documentos) documentos,
  (select count(*) from lotes) lotes,
  (select count(*) from acuses) acuses,
  (select count(*) from cuentas_portal) cuentas_portal,
  (select count(*) from comunicados) comunicados,
  (select count(*) from memorandums) memorandums,
  (select count(*) from solicitudes) solicitudes,
  (select count(*) from tickets) tickets,
  (select count(*) from consentimientos) consentimientos,
  (select count(*) from activos) activos,
  (select count(*) from lineas) lineas,
  (select count(*) from sedes) sedes,
  (select count(*) from storage.objects where bucket_id = 'documentos') archivos_bucket,
  (select count(*) from auth.users) cuentas_auth`);
console.log(JSON.stringify(v, null, 2));

const esperado = v.personas === 4 && v.vinculos === 0 && v.admins === 4 && v.documentos === 0
  && v.lotes === 0 && v.acuses === 0 && v.cuentas_portal === 0 && v.activos === 79
  && v.lineas === 207 && v.cuentas_auth === 4;
console.log(esperado ? "TODO EN ORDEN: producción lista para la ronda desde cero."
  : "OJO: algún conteo no es el esperado — revisar arriba.");
process.exit(esperado ? 0 : 1);
