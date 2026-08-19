// scripts/verificar-tipo-documento.mjs — pruebas del tipo de documento
// (DNI/CE/Pasaporte) contra la BD viva + E2E real del portal con una cuenta
// alfanumérica (GoTrue admin con la service key del Management API). Datos de
// prueba ZZPRUEBA, limpieza total al final.
// Uso: . .\scripts\token-supabase.ps1; node scripts/verificar-tipo-documento.mjs
const SUPA = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const ANON = "sb_publishable_qgPwZ8-4neRlKQXpCe9tnw_Dix4Ddwg";
const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
let fallos = 0;
async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
async function prueba(nombre, fn) {
  try { await fn(); console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); }
}
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
const esperaError = async (q, fragmento, msj) => {
  let error = null;
  try { await sql(q); } catch (e) { error = e.message; }
  if (!error || !error.includes(fragmento)) throw new Error(`${msj}: esperaba «${fragmento}», llegó ${error}`);
};

const CE = "ZZ9PRUEBA1"; // 10 caracteres alfanuméricos, prefijo de limpieza
const [{ sede }] = await sql("select id as sede from sedes where empresa_id='promant' and estado='activa' limit 1");

await prueba("alta con CE: número en mayúsculas, tipo guardado, visible en v_personal", async () => {
  await sql(`select alta_trabajador('${CE.toLowerCase()}', 'ZZPRUEBA Extranjero Uno', 'OPERARIO', '${sede}', 'promant',
             current_date, null, null, null, null, null, 'CE')`);
  const [p] = await sql(`select dni, tipo_documento from v_personal where dni='${CE}'`);
  igual(p?.dni, CE, "número canónico en mayúsculas");
  igual(p?.tipo_documento, "CE", "tipo");
});

await prueba("negativa: formatos inválidos por tipo se rechazan", async () => {
  await esperaError(`select alta_trabajador('123', 'X', 'OPERARIO', '${sede}', 'promant', current_date)`,
    "8 dígitos", "DNI corto");
  await esperaError(`select alta_trabajador('ABC12', 'X', 'OPERARIO', '${sede}', 'promant', current_date,
    null, null, null, null, null, 'CE')`, "9 a 12", "CE corto");
  await esperaError(`select alta_trabajador('AB!', 'X', 'OPERARIO', '${sede}', 'promant', current_date,
    null, null, null, null, null, 'Pasaporte')`, "6 a 15", "pasaporte inválido");
  await esperaError(`select alta_trabajador('12345678', 'X', 'OPERARIO', '${sede}', 'promant', current_date,
    null, null, null, null, null, 'Cedula')`, "Tipo de documento inválido", "tipo desconocido");
});

await prueba("editar_trabajador cambia el tipo validando el número existente", async () => {
  await sql(`select editar_trabajador('${CE}', 'ZZPRUEBA Extranjero Uno', null, null, null, null, null, 'Pasaporte')`);
  const [p] = await sql(`select tipo_documento from personas where dni='${CE}'`);
  igual(p.tipo_documento, "Pasaporte", "tipo cambiado");
  await esperaError(`select editar_trabajador('${CE}', 'ZZPRUEBA Extranjero Uno', null, null, null, null, null, 'DNI')`,
    "8 dígitos", "número CE no es un DNI válido");
  await sql(`select editar_trabajador('${CE}', 'ZZPRUEBA Extranjero Uno', null, null, null, null, null, 'CE')`);
});

await prueba("los DNI existentes siguen intactos (tipo por defecto DNI)", async () => {
  const [n] = await sql("select count(*)::int n from personas where tipo_documento <> 'DNI' and dni not like 'ZZ%'");
  igual(n.n, 0, "solo la prueba tiene tipo distinto");
});

// ---- E2E real del portal con cuenta alfanumérica ----
let authId = null;
await prueba("E2E portal: cuenta técnica en minúsculas entra y portal_dni() resuelve canónico", async () => {
  const llaves = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  const SERVICE = llaves.find((k) => k.name === "service_role" || k.type === "secret")?.api_key;
  const admin = { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" };
  const correo = `${CE.toLowerCase()}@portal.grupoer.pe`;
  const alta = await fetch(`${SUPA}/auth/v1/admin/users`, {
    method: "POST", headers: admin,
    body: JSON.stringify({ email: correo, password: "111111", email_confirm: true }),
  }).then((r) => r.json());
  authId = alta.id;
  if (!authId) throw new Error(`no se creó la cuenta: ${JSON.stringify(alta).slice(0, 120)}`);
  const login = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email: correo, password: "111111" }),
  }).then((r) => r.json());
  if (!login.access_token) throw new Error("login falló");
  const cab = { apikey: ANON, authorization: `Bearer ${login.access_token}` };
  const perfil = (await fetch(`${SUPA}/rest/v1/v_portal_perfil?select=dni,nombre`, { headers: cab }).then((r) => r.json()))?.[0];
  igual(perfil?.dni, CE, "portal_dni canónico (mayúsculas) desde correo en minúsculas");
  // Borrar la cuenta Auth de prueba
  await fetch(`${SUPA}/auth/v1/admin/users/${authId}`, { method: "DELETE", headers: admin });
});

// Limpieza BD
await sql(`delete from vinculos where persona_dni='${CE}'; delete from personas where dni='${CE}';`);

console.log(fallos ? `\n${fallos} PRUEBAS FALLARON` : "\nTODAS LAS PRUEBAS PASARON");
process.exit(fallos ? 1 : 0);
