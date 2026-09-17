// scripts/fase0-forense.mjs — AUDITORÍA FORENSE de la fase 0 (solo lectura).
// Responde, con lo que la base y los logs conservan, a las cuatro preguntas
// del prompt de corrección de seguridad (2026-09-17):
//   1. llamadas a funciones administrativas desde sesiones del Portal
//   2. usuarios administrativos creados fuera del flujo de ACC-02
//   3. cambios de categoría (perfil) de usuarios administrativos
//   4. modificaciones directas de la tabla usuarios_admin (sin pasar por RPC)
// y verifica que la lista de superadministradores es la esperada y que cada
// cuenta administrativa corresponde a una persona real del padrón.
// Escribe docs/seguridad/<fecha>-fase0-forense.md. No modifica nada.
//
// Uso (PowerShell):  . .\scripts\token-supabase.ps1; node scripts/fase0-forense.mjs
//   opcional: SUPERADMINS_ESPERADOS="dsalguero@grupoer.pe,otro@grupoer.pe"
//
// LÍMITES HONESTOS: Postgres no registra qué sesión ejecutó una función; la
// auditoría (trigger fn_auditar) guarda current_user, que dentro de una RPC
// security definer es siempre `postgres`. La única fuente que identifica al
// llamador de una RPC son los logs del API de Supabase (edge_logs), cuya
// retención en el plan actual es corta (1 día en Free, 7 en Pro): se consulta
// lo que exista y se declara la ventana cubierta.
import { writeFileSync, mkdirSync } from "node:fs";

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN (. .\\scripts\\token-supabase.ps1)."); process.exit(1); }
const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const ESPERADOS = (process.env.SUPERADMINS_ESPERADOS ?? "diegosalguerotang@gmail.com,renato.espinoza@promant.pe,asistgerencia@promant.pe").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
const DOMINIO_PORTAL = "portal.grupoer.pe";

const api = async (ruta, opciones = {}) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}${ruta}`, {
    ...opciones, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opciones.headers ?? {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${ruta}: ${t.slice(0, 400)}`);
  return t ? JSON.parse(t) : null;
};
const sql = (query) => api("/database/query", { method: "POST", body: JSON.stringify({ query }) });
const fecha = new Date().toISOString().slice(0, 10);
const md = [];
const h = (t) => md.push(`\n## ${t}\n`);
const p = (t) => md.push(t);
const tabla = (filas, cols) => {
  if (!filas.length) { md.push("_(sin filas)_"); return; }
  cols ??= Object.keys(filas[0]);
  md.push(`| ${cols.join(" | ")} |`); md.push(`|${cols.map(() => "---").join("|")}|`);
  for (const f of filas) md.push(`| ${cols.map((c) => String(f[c] ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`);
};
const hallazgos = [];

md.push(`# Corrección de seguridad · Fase 0 — Informe forense\n\nFecha: ${fecha} · Proyecto Supabase \`${PROYECTO}\` · Solo lectura (\`scripts/fase0-forense.mjs\`).`);

// 1 · Cuentas administrativas ------------------------------------------------
h("1. Cuentas administrativas: ¿corresponden a personas reales del padrón?");
const admins = await sql(`
  select u.id, u.codigo, u.persona_dni, pe.nombre as persona, u.correo, u.perfil_id, u.perfil_version, u.estado,
         coalesce(pf.es_superadmin, false) as superadmin, u.creado_por, to_char(u.creado_en, 'YYYY-MM-DD HH24:MI') as creado_en,
         to_char(u.ultimo_ingreso, 'YYYY-MM-DD HH24:MI') as ultimo_ingreso,
         (pe.dni is not null) as en_padron,
         exists (select 1 from vinculos v where v.persona_dni = u.persona_dni and v.fecha_fin is null) as vinculo_vigente,
         (select count(*) from vinculos v where v.persona_dni = u.persona_dni) as vinculos,
         (au.id is not null) as en_auth, to_char(au.created_at, 'YYYY-MM-DD HH24:MI') as auth_creado,
         to_char(au.last_sign_in_at, 'YYYY-MM-DD HH24:MI') as auth_ultimo_login
  from usuarios_admin u
  left join personas pe on pe.dni = u.persona_dni
  left join perfiles pf on pf.id = u.perfil_id and pf.version = u.perfil_version
  left join auth.users au on lower(au.email) = lower(u.correo)
  order by u.id`);
tabla(admins);
for (const a of admins) {
  if (!a.en_padron) hallazgos.push(`Cuenta admin #${a.id} (${a.correo}) NO corresponde a una persona del padrón (dni ${a.persona_dni}).`);
  if (a.en_padron && Number(a.vinculos) === 0) hallazgos.push(`Cuenta admin #${a.id} (${a.correo}): la persona ${a.persona_dni} no tiene ningún vínculo laboral registrado.`);
  if (!a.codigo) hallazgos.push(`Cuenta admin #${a.id} (${a.correo}) sin código U-xxxx: no la creó crear_usuario_admin (flujo ACC-02).`);
  if (!a.en_auth) p(`- Nota: #${a.id} (${a.correo}) no tiene cuenta en Supabase Auth (aún no puede entrar).`);
}

h("2. Superadministradores");
const supers = admins.filter((a) => a.superadmin);
tabla(supers, ["id", "codigo", "persona_dni", "persona", "correo", "estado", "creado_por", "creado_en"]);
const correosSupers = supers.map((a) => String(a.correo).toLowerCase()).sort();
p(`\nEsperados: ${ESPERADOS.join(", ")} · Encontrados: ${correosSupers.join(", ") || "(ninguno)"}`);
for (const c of correosSupers) if (!ESPERADOS.includes(c)) hallazgos.push(`SUPERADMIN NO ESPERADO: ${c}.`);
for (const c of ESPERADOS) if (!correosSupers.includes(c)) hallazgos.push(`Superadmin esperado ausente o sin categoría superadmin: ${c}.`);

// 3 · Auditoría de usuarios_admin --------------------------------------------
h("3. Historial de usuarios_admin (trigger de auditoría, desde la puesta en producción)");
const audUsr = await sql(`
  select id, to_char(fecha, 'YYYY-MM-DD HH24:MI:SS') as fecha, usuario, accion,
         coalesce(datos_despues->>'id', datos_antes->>'id') as usuario_id,
         coalesce(datos_despues->>'correo', datos_antes->>'correo') as correo,
         datos_antes->>'perfil_id' as perfil_antes, datos_despues->>'perfil_id' as perfil_despues,
         datos_antes->>'perfil_version' as version_antes, datos_despues->>'perfil_version' as version_despues,
         datos_antes->>'estado' as estado_antes, datos_despues->>'estado' as estado_despues,
         datos_despues->>'codigo' as codigo, datos_despues->>'creado_por' as creado_por
  from auditoria where tabla = 'usuarios_admin' order by fecha, id`);
tabla(audUsr);
const creaciones = audUsr.filter((r) => r.accion === "INSERT");
const cambiosCategoria = audUsr.filter((r) => r.accion === "UPDATE" && (r.perfil_antes !== r.perfil_despues || r.version_antes !== r.version_despues));
const directas = audUsr.filter((r) => !["postgres", "supabase_admin"].includes(String(r.usuario)));
p(`\n- Creaciones registradas: ${creaciones.length}. Fuera del flujo ACC-02 (sin código U-xxxx o con usuario ≠ postgres): ${creaciones.filter((r) => !r.codigo || !["postgres", "supabase_admin"].includes(String(r.usuario))).length}.`);
p(`- Cambios de categoría (perfil o versión): ${cambiosCategoria.length}.`);
p(`- Modificaciones DIRECTAS de la tabla (usuario de auditoría ≠ postgres, es decir, sin pasar por una RPC security definer): ${directas.length}.`);
for (const r of creaciones.filter((r) => !r.codigo)) hallazgos.push(`Creación de usuario admin #${r.usuario_id} (${r.correo}) el ${r.fecha} SIN código: fuera del flujo ACC-02.`);
for (const r of directas) hallazgos.push(`Modificación DIRECTA de usuarios_admin (${r.accion} por rol "${r.usuario}") el ${r.fecha} sobre #${r.usuario_id} (${r.correo}).`);
if (cambiosCategoria.length) {
  p("\nCambios de categoría en detalle:");
  tabla(cambiosCategoria, ["fecha", "usuario", "usuario_id", "correo", "perfil_antes", "perfil_despues", "version_antes", "version_despues"]);
}
const usuariosAdminSinAuditoria = await sql(`
  select u.id, u.correo from usuarios_admin u
  where not exists (select 1 from auditoria a where a.tabla = 'usuarios_admin' and a.accion = 'INSERT' and (a.datos_despues->>'id')::bigint = u.id)`);
if (usuariosAdminSinAuditoria.length) {
  for (const u of usuariosAdminSinAuditoria) hallazgos.push(`Usuario admin #${u.id} (${u.correo}) existe SIN fila de auditoría de su creación (insertado con el trigger apagado o antes de la auditoría).`);
}

h("4. Historial de categorías y permisos (perfiles, perfil_permisos, perfil_empresas, politica_acceso)");
const audCat = await sql(`
  select tabla, accion, usuario, count(*)::int as n, to_char(min(fecha), 'YYYY-MM-DD') as desde, to_char(max(fecha), 'YYYY-MM-DD') as hasta
  from auditoria where tabla in ('perfiles', 'perfil_permisos', 'perfil_empresas', 'politica_acceso')
  group by 1, 2, 3 order by 1, 2, 3`);
tabla(audCat);
for (const r of audCat) if (!["postgres", "supabase_admin"].includes(String(r.usuario))) hallazgos.push(`${r.n} ${r.accion} directos en ${r.tabla} por el rol "${r.usuario}" (${r.desde}→${r.hasta}).`);

h("5. Toda la auditoría por rol de base (¿hubo escrituras directas con sesión?)");
const porRol = await sql(`select usuario, count(*)::int as n, to_char(min(fecha), 'YYYY-MM-DD') as desde, to_char(max(fecha), 'YYYY-MM-DD') as hasta from auditoria group by 1 order by 2 desc`);
tabla(porRol);
p("\n`postgres` = RPC security definer o Management API; `service_role` = funciones serverless; `authenticated` = escritura directa a tabla desde un navegador con sesión (BackOffice: solo `lineas` es legítima).");
const directasOtras = await sql(`
  select tabla, accion, count(*)::int as n, to_char(min(fecha), 'YYYY-MM-DD') as desde, to_char(max(fecha), 'YYYY-MM-DD') as hasta
  from auditoria where usuario = 'authenticated' group by 1, 2 order by 1, 2`);
if (directasOtras.length) { p("\nEscrituras directas con rol `authenticated` por tabla:"); tabla(directasOtras); }
for (const r of directasOtras) if (r.tabla !== "lineas") hallazgos.push(`${r.n} ${r.accion} directos con sesión (rol authenticated) en ${r.tabla} (${r.desde}→${r.hasta}): revisar.`);

// 6 · Ingresos -----------------------------------------------------------------
h("6. Ingresos registrados (registro_accesos)");
const ingresos = await sql(`
  select superficie, resultado, count(*)::int as n, count(distinct coalesce(dni, correo))::int as identidades,
         to_char(min(fecha), 'YYYY-MM-DD') as desde, to_char(max(fecha), 'YYYY-MM-DD') as hasta
  from registro_accesos group by 1, 2 order by 1, 2`);
tabla(ingresos);
const portalOk = await sql(`
  select dni, count(*)::int as ingresos, to_char(min(fecha), 'YYYY-MM-DD HH24:MI') as primero, to_char(max(fecha), 'YYYY-MM-DD HH24:MI') as ultimo,
         count(distinct ip)::int as ips
  from registro_accesos where superficie = 'portal' and resultado = 'exitoso' group by dni order by ingresos desc`);
p("\nTrabajadores que han entrado al Portal (sesiones que PUDIERON llamar RPC administrativas antes de la fase 0):");
tabla(portalOk);

// 7 · Cuentas de Auth huérfanas ------------------------------------------------
h("7. Cuentas de Supabase Auth sin correspondencia");
const auth = await sql(`
  select au.id, au.email, to_char(au.created_at, 'YYYY-MM-DD HH24:MI') as creada, to_char(au.last_sign_in_at, 'YYYY-MM-DD HH24:MI') as ultimo_login,
         (exists (select 1 from usuarios_admin u where lower(u.correo) = lower(au.email))) as es_admin,
         (au.email like '%@${DOMINIO_PORTAL}') as es_portal,
         (exists (select 1 from cuentas_portal c where lower(c.dni) = split_part(au.email, '@', 1))) as tiene_cuenta_portal
  from auth.users au order by au.created_at`);
const huerfanas = auth.filter((a) => !a.es_admin && !(a.es_portal && a.tiene_cuenta_portal));
p(`Cuentas en Auth: ${auth.length} · administradores: ${auth.filter((a) => a.es_admin).length} · portal con cuenta: ${auth.filter((a) => a.es_portal && a.tiene_cuenta_portal).length} · sin correspondencia: ${huerfanas.length}`);
tabla(huerfanas, ["email", "creada", "ultimo_login", "es_portal"]);
for (const a of huerfanas) hallazgos.push(`Cuenta de Auth sin correspondencia en la intranet: ${a.email} (creada ${a.creada}, último login ${a.ultimo_login ?? "nunca"}).`);

// 8 · Logs del API: quién llamó qué RPC (ventana de retención) -----------------
h("8. Llamadas a RPC por sesión (logs del API de Supabase, ventana de retención)");
const RPC_PORTAL = new Set(["portal_actualizar_datos", "portal_confirmar_lectura", "portal_confirmar_recepcion", "portal_crear_solicitud", "portal_crear_ticket",
  "portal_marcar_visto", "portal_mi_sesion", "portal_primer_ingreso", "portal_registrar_ingreso", "portal_registrar_sesion", "portal_solicitar_cambio_cuenta",
  "portal_verificar_bloqueo", "reenviar_solicitud", "crear_solicitud_propia"]);
try {
  const consulta = `
    select id, timestamp, r.method as method, r.path as path, resp.status_code as status, sb.auth_user as auth_user
    from edge_logs
    cross join unnest(metadata) as m
    cross join unnest(m.request) as r
    cross join unnest(m.response) as resp
    left join unnest(r.sb) as sb
    where r.path like '/rest/v1/rpc/%'
    order by timestamp desc
    limit 2000`;
  const desde = new Date(Date.now() - 30 * 86400_000).toISOString();
  const res = await api(`/analytics/endpoints/logs.all?sql=${encodeURIComponent(consulta)}&iso_timestamp_start=${encodeURIComponent(desde)}`);
  const filas = res?.result ?? [];
  if (!filas.length) {
    p("_Los logs del API no devolvieron llamadas a RPC en la ventana disponible (retención agotada o sin tráfico registrado)._");
  } else {
    const usuarios = [...new Set(filas.map((f) => f.auth_user).filter(Boolean))];
    const correos = usuarios.length
      ? Object.fromEntries((await sql(`select id::text as id, email from auth.users where id in (${usuarios.map((u) => `'${u}'`).join(",")})`)).map((r) => [r.id, r.email]))
      : {};
    const tsMin = Math.min(...filas.map((f) => Number(f.timestamp))), tsMax = Math.max(...filas.map((f) => Number(f.timestamp)));
    const aFecha = (us) => new Date(us / 1000).toISOString().replace("T", " ").slice(0, 19);
    p(`Ventana cubierta por los logs: ${aFecha(tsMin)} → ${aFecha(tsMax)} UTC (${filas.length} llamadas a RPC).`);
    const agrupado = {};
    for (const f of filas) {
      const fn = String(f.path).split("/rpc/")[1]?.split("?")[0] ?? "?";
      const quien = correos[f.auth_user] ?? (f.auth_user ? `uuid ${f.auth_user}` : "(sin sesión)");
      const k = `${quien}|${fn}`;
      agrupado[k] ??= { quien, funcion: fn, llamadas: 0, ok: 0, denegadas: 0 };
      agrupado[k].llamadas++; if (Number(f.status) < 400) agrupado[k].ok++; if ([401, 403].includes(Number(f.status))) agrupado[k].denegadas++;
    }
    const lista = Object.values(agrupado).sort((a, b) => a.quien.localeCompare(b.quien) || a.funcion.localeCompare(b.funcion));
    tabla(lista, ["quien", "funcion", "llamadas", "ok", "denegadas"]);
    const sospechosas = lista.filter((x) => x.quien.endsWith(`@${DOMINIO_PORTAL}`) && !RPC_PORTAL.has(x.funcion) && x.ok > 0);
    for (const s of sospechosas) hallazgos.push(`SESIÓN DEL PORTAL ${s.quien} ejecutó con éxito la RPC administrativa ${s.funcion} (${s.ok} veces) en la ventana de logs.`);
    if (!sospechosas.length) p("\nNinguna sesión del Portal ejecutó con éxito una RPC fuera de su conjunto en la ventana de logs.");
  }
} catch (e) {
  p(`_No se pudieron consultar los logs del API: ${e.message}_`);
}

// 9 · Conclusión ----------------------------------------------------------------
h("9. Conclusión");
if (hallazgos.length) {
  p(`**${hallazgos.length} hallazgo(s) que requieren revisión:**\n`);
  for (const x of hallazgos) p(`- ${x}`);
} else {
  p("**No se encontró evidencia** de llamadas administrativas desde el Portal (en la ventana de logs disponible), de usuarios administrativos creados fuera de ACC-02, de cambios de categoría no registrados ni de modificaciones directas de usuarios_admin. La lista de superadministradores coincide con la esperada y cada cuenta administrativa corresponde a una persona del padrón.");
}
p(`\nLímite de la evidencia: la base no registra quién llamó cada RPC (la auditoría guarda el rol de ejecución, que en una RPC security definer es siempre \`postgres\`); solo los logs del API identifican la sesión y su retención es corta. Para el periodo anterior a esa ventana la afirmación posible es: no hay rastro en la base de efectos administrativos anómalos (cuentas, categorías, superadmins).`);

mkdirSync("docs/seguridad", { recursive: true });
const salida = `docs/seguridad/${fecha}-fase0-forense.md`;
writeFileSync(salida, md.join("\n") + "\n");
console.log(md.join("\n"));
console.log(`\nInforme escrito en ${salida}`);
