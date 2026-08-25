// Verificación E2E de la constancia de recepción en PDF (api/constancia-portal)
// en PRODUCCIÓN (ciclo 2026-08-25). Flujo: admin temporal (patrón 2026-08-19)
// → trabajador ZZPRUEBA con documento y acuse por SQL → cuenta de portal real
// → GET /api/constancia-portal con x-sesion → PDF real con nombre veraz →
// negativas (sin sesión, cuenta ajena, sin acuse) → limpieza total (el trigger
// de inmutabilidad de acuses se apaga un instante solo aquí, patrón
// verificar-movimientos).
//   env: SUPABASE_ACCESS_TOKEN (Management API).
//   Uso: . .\scripts\token-supabase.ps1; node scripts/verificar-constancia-pdf.mjs
const APP = "https://intranet-general.vercel.app";
const SUPA = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
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
if (!service) { mal("service key", "la Management API no la devolvió"); process.exit(1); }
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

const CORREO_TEMP = "zzprueba-const@grupoer.pe";
const adminClave = "Zz" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
await borrarCuentaGoTrue(CORREO_TEMP);
await sql(`delete from usuarios_admin where correo = '${CORREO_TEMP}'`);
const altaCuenta = await gotrue("/auth/v1/admin/users", {
  method: "POST", body: JSON.stringify({ email: CORREO_TEMP, password: adminClave, email_confirm: true }),
});
const [personaAdmin] = await sql(`select dni from personas p
  where dni not like 'ZZ%' and not exists (select 1 from usuarios_admin u where u.persona_dni = p.dni) limit 1`);
const [perfil] = await sql(`select id, version from perfiles
  where lower(nombre) like 'superadmin%' and estado = 'activo' order by version desc limit 1`);
if (!altaCuenta.ok || !personaAdmin || !perfil) {
  mal("admin temporal", JSON.stringify({ cuenta: altaCuenta.status, personaAdmin, perfil })); process.exit(1);
}
await sql(`insert into usuarios_admin (persona_dni, perfil_id, perfil_version, correo, creado_por)
  values ('${personaAdmin.dni}', '${perfil.id}', ${perfil.version}, '${CORREO_TEMP}', 'verificar-constancia-pdf')`);
const admin = await login(CORREO_TEMP, adminClave);
if (!admin.access_token) { mal("login admin", JSON.stringify(admin)); process.exit(1); }
ok("admin temporal con sesión");

// Trabajador + documento + acuse (por SQL, con la declaración vigente copiada
// íntegra, igual que hace portal_confirmar_recepcion).
const DNI = "98" + String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
const AJENO = "97" + String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
const [sede] = await sql(`select s.id, s.empresa_id from sedes s
  join empresas e on e.id = s.empresa_id where e.estado = 'activa' limit 1`);
await sql(`insert into personas (dni, nombre, portal) values
  ('${DNI}', 'ZZPRUEBA CONSTANCIA', 'activo'), ('${AJENO}', 'ZZPRUEBA AJENO', 'activo')`);
const [vinc] = await sql(`insert into vinculos (persona_dni, empresa_id, sede_id, cargo, fecha_inicio)
  values ('${DNI}', '${sede.empresa_id}', '${sede.id}', 'Operario de limpieza', '2026-01-01') returning id`);
const HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const [docCon] = await sql(`insert into documentos (vinculo_id, tipo, titulo, periodo, hash_sha256)
  values (${vinc.id}, 'Boleta de pago', 'Boleta de pago Julio 2026', '2026-07', '${HASH}') returning id`);
const [docSin] = await sql(`insert into documentos (vinculo_id, tipo, titulo, periodo, hash_sha256)
  values (${vinc.id}, 'Boleta de pago', 'Boleta sin acuse', '2026-07', '${HASH}') returning id`);
await sql(`insert into acuses (documento_id, modalidad, dispositivo, hash_sha256, declaracion, dni_check)
  select ${docCon.id}, 'personal', 'suite verificar-constancia-pdf', '${HASH}', d.texto, '${DNI}'
  from declaraciones d where d.id = 'recepcion-documento' order by d.version desc limit 1`);
ok(`trabajador ${DNI} con documento ${docCon.id} acusado y ${docSin.id} sin acuse`);

// Cuentas de portal reales (GoTrue) para el dueño y para un ajeno.
const clavePortal = "Cl" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
for (const d of [DNI, AJENO]) {
  await borrarCuentaGoTrue(`${d}@portal.grupoer.pe`);
  const r = await gotrue("/auth/v1/admin/users", {
    method: "POST", body: JSON.stringify({ email: `${d}@portal.grupoer.pe`, password: clavePortal, email_confirm: true }),
  });
  if (!r.ok) mal(`cuenta portal ${d}`, r.status);
}
const sesionDueno = await login(`${DNI}@portal.grupoer.pe`, clavePortal);
const sesionAjeno = await login(`${AJENO}@portal.grupoer.pe`, clavePortal);
if (!sesionDueno.access_token || !sesionAjeno.access_token) { mal("login portal", "sin token"); }

const constancia = async (id, token) => {
  const r = await fetch(`${APP}/api/constancia-portal?id=${id}`, {
    headers: token ? { "x-sesion": token } : {},
  });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, buf, disp: r.headers.get("content-disposition") ?? "", tipo: r.headers.get("content-type") ?? "" };
};

console.log("1 · El dueño descarga su constancia en PDF con nombre veraz");
const r1 = await constancia(docCon.id, sesionDueno.access_token);
r1.status === 200 ? ok("HTTP 200") : mal("status", `${r1.status} ${r1.buf.toString().slice(0, 120)}`);
r1.buf.subarray(0, 5).toString() === "%PDF-" ? ok("es un PDF real") : mal("magia PDF", r1.buf.subarray(0, 8).toString("hex"));
r1.tipo.includes("application/pdf") ? ok("content-type application/pdf") : mal("content-type", r1.tipo);
(/Constancia de recepci/i.test(r1.disp) && r1.disp.includes(DNI) && /Julio 2026/i.test(decodeURIComponent(r1.disp)))
  ? ok("nombre de archivo con documento, nombre y mes")
  : mal("content-disposition", r1.disp);
r1.buf.length > 2000 ? ok(`tamaño razonable (${r1.buf.length} bytes)`) : mal("tamaño", r1.buf.length);

console.log("2 · Negativas");
const sin = await constancia(docCon.id, null);
sin.status === 401 ? ok("sin sesión → 401") : mal("sin sesión", sin.status);
const ajeno = await constancia(docCon.id, sesionAjeno.access_token);
ajeno.status === 403 ? ok("cuenta ajena → 403") : mal("cuenta ajena", `${ajeno.status} ${ajeno.buf.toString().slice(0, 120)}`);
const sinAcuse = await constancia(docSin.id, sesionDueno.access_token);
sinAcuse.status === 404 ? ok("documento sin acuse → 404") : mal("sin acuse", sinAcuse.status);
const malId = await constancia("abc", sesionDueno.access_token);
malId.status === 400 ? ok("id inválido → 400") : mal("id inválido", malId.status);

console.log("3 · El admin del BackOffice también puede descargarla");
const r3 = await constancia(docCon.id, admin.access_token);
(r3.status === 200 && r3.buf.subarray(0, 5).toString() === "%PDF-")
  ? ok("admin activo → 200 PDF") : mal("admin", `${r3.status}`);

console.log("4 · Limpieza total");
await sql(`
  alter table acuses disable trigger trg_acuses_inmutables;
  delete from acuses where documento_id in (${docCon.id}, ${docSin.id});
  alter table acuses enable trigger trg_acuses_inmutables;
  delete from documentos where id in (${docCon.id}, ${docSin.id});
  delete from vinculos where persona_dni in ('${DNI}', '${AJENO}');
  delete from usuarios_admin where correo = '${CORREO_TEMP}';
  delete from personas where dni in ('${DNI}', '${AJENO}');
`);
await borrarCuentaGoTrue(CORREO_TEMP);
await borrarCuentaGoTrue(`${DNI}@portal.grupoer.pe`);
await borrarCuentaGoTrue(`${AJENO}@portal.grupoer.pe`);
const resto = await sql(`select (select count(*) from personas where dni in ('${DNI}','${AJENO}'))
  + (select count(*) from documentos where id in (${docCon.id}, ${docSin.id}))
  + (select count(*) from usuarios_admin where correo = '${CORREO_TEMP}') as n`);
resto?.[0]?.n === 0 ? ok("datos ZZ fuera") : mal("limpieza", JSON.stringify(resto));

console.log(fallos === 0 ? "\nTODO EN VERDE" : `\n${fallos} PRUEBAS FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
