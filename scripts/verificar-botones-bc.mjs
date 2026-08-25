// Verificación E2E del ciclo Botones B+C (2026-08-25) en PRODUCCIÓN:
// registrar_acuse_asistido v2 (adjunto real verificado, supervisor del JWT),
// crear_activo, v_actividad_persona y el bucket aceptando imágenes.
// Patrón admin temporal (2026-08-19); limpieza total al final.
//   Uso: . .\scripts\token-supabase.ps1; node scripts/verificar-botones-bc.mjs
const APP = "https://intranet-general.vercel.app";
const SUPA = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const APIKEY = "sb_publishable_qgPwZ8-4neRlKQXpCe9tnw_Dix4Ddwg";
const { SUPABASE_ACCESS_TOKEN } = process.env;
if (!SUPABASE_ACCESS_TOKEN) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }

let fallos = 0;
const ok = (n) => console.log(`  ✔ ${n}`);
const mal = (n, d) => { fallos++; console.error(`  ✘ ${n} — ${String(d).slice(0, 250)}`); };
const json = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { crudo: t, status: r.status }; } };
const sql = async (q) => json(await fetch(`https://api.supabase.com/v1/projects/mzpbdkrmokfxrrsotfgs/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: q }),
}));
const login = async (email, clave) => json(await fetch(`${APP}/api/supa/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: clave }),
}));

console.log("0 · Service key, admin temporal y datos de prueba");
const claves = await json(await fetch("https://api.supabase.com/v1/projects/mzpbdkrmokfxrrsotfgs/api-keys?reveal=true", {
  headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` },
}));
const service = (Array.isArray(claves) ? claves : []).find((k) => k.type === "secret" || k.name === "service_role")?.api_key;
if (!service) { mal("service key", "no la devolvió"); process.exit(1); }
const cabService = { apikey: service, authorization: `Bearer ${service}`, "Content-Type": "application/json" };
const gotrue = async (ruta, opciones = {}) => {
  const r = await fetch(`${SUPA}${ruta}`, { ...opciones, headers: { ...cabService, ...opciones.headers } });
  return { ok: r.ok, status: r.status, json: await json(r) };
};
const borrarCuentaGoTrue = async (email) => {
  const lista = await gotrue("/auth/v1/admin/users?per_page=1000");
  const u = (lista.json.users ?? []).find((x) => (x.email ?? "").toLowerCase() === email.toLowerCase());
  if (u) await gotrue(`/auth/v1/admin/users/${u.id}`, { method: "DELETE" });
};

const CORREO_TEMP = "zzprueba-bc@grupoer.pe";
const adminClave = "Zz" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
await borrarCuentaGoTrue(CORREO_TEMP);
await sql(`delete from usuarios_admin where correo = '${CORREO_TEMP}'`);
const altaCuenta = await gotrue("/auth/v1/admin/users", {
  method: "POST", body: JSON.stringify({ email: CORREO_TEMP, password: adminClave, email_confirm: true }),
});
const [personaAdmin] = await sql(`select p.dni, p.nombre from personas p
  where p.dni not like 'ZZ%' and not exists (select 1 from usuarios_admin u where u.persona_dni = p.dni) limit 1`);
const [perfil] = await sql(`select id, version from perfiles
  where lower(nombre) like 'superadmin%' and estado = 'activo' order by version desc limit 1`);
if (!altaCuenta.ok || !personaAdmin || !perfil) { mal("admin temporal", JSON.stringify({ altaCuenta: altaCuenta.status })); process.exit(1); }
await sql(`insert into usuarios_admin (persona_dni, perfil_id, perfil_version, correo, creado_por)
  values ('${personaAdmin.dni}', '${perfil.id}', ${perfil.version}, '${CORREO_TEMP}', 'verificar-botones-bc')`);
const admin = await login(CORREO_TEMP, adminClave);
if (!admin.access_token) { mal("login admin", JSON.stringify(admin)); process.exit(1); }
ok(`admin temporal ${personaAdmin.dni} (${personaAdmin.nombre}) con sesión`);

// Trabajador + lote + documento vigente para el acuse.
const DNI = "96" + String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
const LOTE = `ZZBC-${Date.now().toString().slice(-6)}`;
const [sede] = await sql(`select s.id, s.empresa_id from sedes s
  join empresas e on e.id = s.empresa_id where e.estado = 'activa' limit 1`);
await sql(`insert into personas (dni, nombre, portal) values ('${DNI}', 'ZZPRUEBA BC', 'activo')`);
const [vinc] = await sql(`insert into vinculos (persona_dni, empresa_id, sede_id, cargo, fecha_inicio)
  values ('${DNI}', '${sede.empresa_id}', '${sede.id}', 'Operario de limpieza', '2026-01-01') returning id`);
await sql(`insert into lotes (id, empresa_id, tipo, periodo, publicado_por)
  values ('${LOTE}', '${sede.empresa_id}', 'Boleta de pago', '2026-07', 'verificar-botones-bc')`);
const HASH = "aa".repeat(32);
const [docu] = await sql(`insert into documentos (vinculo_id, lote_id, tipo, titulo, periodo, hash_sha256)
  values (${vinc.id}, '${LOTE}', 'Boleta de pago', 'Boleta ZZ BC', '2026-07', '${HASH}') returning id`);
ok(`trabajador ${DNI}, lote ${LOTE}, documento ${docu.id}`);

// El canal real de la app: x-sesion (el proxy la convierte en Authorization;
// una cabecera authorization directa NO viaja por el canal blindado).
const rpcProxy = async (fn, cuerpo, token = admin.access_token) => {
  const r = await fetch(`${APP}/api/supa/rest/v1/rpc/${fn}?apikey=${APIKEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "x-sesion": token } : {}) },
    body: JSON.stringify(cuerpo),
  });
  return { status: r.status, json: await json(r) };
};

console.log("1 · El bucket acepta imágenes otra vez (fix del hardening)");
const RUTA_CARGO = `cargos/${LOTE}/${DNI}-prueba.jpg`;
// JPEG mínimo válido (cabecera SOI + EOI).
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
const subida = await fetch(`${SUPA}/storage/v1/object/documentos/${RUTA_CARGO}`, {
  method: "POST",
  headers: { apikey: service, authorization: `Bearer ${service}`, "content-type": "image/jpeg", "x-upsert": "true" },
  body: jpeg,
});
subida.ok ? ok("image/jpeg aceptado en el bucket") : mal("subida jpg", `${subida.status} ${await subida.text()}`);

console.log("2 · Acuse asistido: SIN adjunto se rechaza; con adjunto real registra supervisor de verdad");
const sinAdjunto = await rpcProxy("registrar_acuse_asistido", {
  p_dni: DNI, p_lote: LOTE, p_motivo: "Sin celular", p_entrega: "2026-08-25T10:00:00Z",
  p_adjunto: "cargos/no-existe.jpg", p_dispositivo: "suite",
});
(sinAdjunto.status >= 400 && /no está subido/i.test(JSON.stringify(sinAdjunto.json)))
  ? ok("adjunto inexistente → rechazo con mensaje accionable") : mal("adjunto fantasma aceptado", JSON.stringify(sinAdjunto));

const conAdjunto = await rpcProxy("registrar_acuse_asistido", {
  p_dni: DNI, p_lote: LOTE, p_motivo: "Sin celular", p_entrega: "2026-08-25T10:00:00Z",
  p_adjunto: RUTA_CARGO, p_dispositivo: "suite verificar-botones-bc",
});
conAdjunto.status < 300 ? ok("acuse registrado") : mal("registrar", JSON.stringify(conAdjunto));
const [acuse] = await sql(`select modalidad, hash_sha256, adjunto_url, supervisor_dni, registrado_por, dispositivo, declaracion
  from acuses where documento_id = ${docu.id}`);
acuse?.hash_sha256 === HASH ? ok("hash del acuse = hash REAL del documento") : mal("hash", JSON.stringify(acuse));
acuse?.adjunto_url === RUTA_CARGO ? ok("adjunto_url = ruta realmente subida") : mal("adjunto_url", acuse?.adjunto_url);
acuse?.supervisor_dni === personaAdmin.dni ? ok(`supervisor_dni = persona del admin que llamó (${personaAdmin.dni})`) : mal("supervisor", JSON.stringify(acuse));
acuse?.registrado_por === personaAdmin.nombre ? ok("registrado_por = nombre real") : mal("registrado_por", acuse?.registrado_por);
/DECLARACIÓN DEL REGISTRADOR/.test(acuse?.declaracion ?? "") ? ok("declaración versionada copiada íntegra") : mal("declaracion", acuse?.declaracion?.slice(0, 60));
const [va] = await sql(`select adjunto, supervisor from v_acuses where documento_id = ${docu.id}`);
va?.adjunto === RUTA_CARGO ? ok("v_acuses expone el adjunto") : mal("v_acuses.adjunto", JSON.stringify(va));

console.log("3 · crear_activo: alta real, duplicado rechazado");
const CODIGO = `ZZBC-${Date.now().toString().slice(-5)}`;
const alta1 = await rpcProxy("crear_activo", { p_codigo: CODIGO, p_categoria: "Cómputo", p_empresa: sede.empresa_id, p_tipo: "LAPTOP", p_marca: "HP" });
alta1.status < 300 ? ok(`activo ${CODIGO} creado`) : mal("crear_activo", JSON.stringify(alta1));
const [act] = await sql(`select codigo, categoria, empresa_id, estado_fisico from activos where codigo = '${CODIGO}'`);
(act?.categoria === "Cómputo" && act?.empresa_id === sede.empresa_id) ? ok("persistido en la BD") : mal("activo en BD", JSON.stringify(act));
const alta2 = await rpcProxy("crear_activo", { p_codigo: CODIGO, p_categoria: "Cómputo", p_empresa: sede.empresa_id });
(alta2.status >= 400 && /ya existe/i.test(JSON.stringify(alta2.json))) ? ok("duplicado rechazado") : mal("duplicado", JSON.stringify(alta2));

console.log("4 · v_actividad_persona devuelve la actividad real del trabajador");
const actividad = await sql(`select accion, tabla from v_actividad_persona where dni = '${DNI}'`);
(Array.isArray(actividad) && actividad.length > 0) ? ok(`${actividad.length} eventos (${[...new Set(actividad.map((a) => a.tabla))].join(", ")})`) : mal("actividad vacía", JSON.stringify(actividad));
const columnas = await sql(`select column_name from information_schema.columns where table_name = 'v_actividad_persona'`);
columnas.some((c) => c.column_name === "detalle" || c.column_name === "datos_despues")
  ? mal("la vista expone el jsonb sensible", JSON.stringify(columnas)) : ok("la vista NO expone el jsonb de auditoría");

console.log("5 · Limpieza total");
await fetch(`${SUPA}/storage/v1/object/documentos/${RUTA_CARGO}`, { method: "DELETE", headers: { apikey: service, authorization: `Bearer ${service}` } });
await sql(`
  alter table acuses disable trigger trg_acuses_inmutables;
  delete from acuses where documento_id = ${docu.id};
  alter table acuses enable trigger trg_acuses_inmutables;
  delete from documentos where id = ${docu.id};
  delete from lotes where id = '${LOTE}';
  delete from activos where codigo = '${CODIGO}';
  delete from vinculos where persona_dni = '${DNI}';
  delete from usuarios_admin where correo = '${CORREO_TEMP}';
  delete from personas where dni = '${DNI}';
`);
await borrarCuentaGoTrue(CORREO_TEMP);
const resto = await sql(`select (select count(*) from personas where dni = '${DNI}')
  + (select count(*) from activos where codigo = '${CODIGO}')
  + (select count(*) from lotes where id = '${LOTE}')
  + (select count(*) from usuarios_admin where correo = '${CORREO_TEMP}') as n`);
resto?.[0]?.n === 0 ? ok("datos ZZ fuera") : mal("limpieza", JSON.stringify(resto));

console.log(fallos === 0 ? "\nTODO EN VERDE" : `\n${fallos} PRUEBAS FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
