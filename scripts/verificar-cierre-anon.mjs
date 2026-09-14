// scripts/verificar-cierre-anon.mjs — Hardening fase 1 (2026-09-14). Prueba
// que SIN sesión, con solo la publishable key, no se lee ni se ejecuta nada
// (salvo las 4 RPCs de login), tanto directo a supabase.co como vía /api/supa.
// Solo lectura: no crea ni borra datos.
//   env: SUPABASE_ACCESS_TOKEN (Management API); opcionales SUPERADMIN_EMAIL,
//        SUPERADMIN_PASSWORD_INICIAL para los casos con sesión.
//   Uso: . .\scripts\token-supabase.ps1; node scripts/verificar-cierre-anon.mjs
const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const SUPA = `https://${PROYECTO}.supabase.co`;
const APP = "https://intranet-general.vercel.app";
const KEY = "sb_publishable_qgPwZ8-4neRlKQXpCe9tnw_Dix4Ddwg";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
const { SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD_INICIAL } = process.env;

let fallos = 0;
async function prueba(nombre, fn) {
  try { await fn(); console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); }
}
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
const enLista = (v, lista, msj) => { if (!lista.includes(v)) throw new Error(`${msj}: ${JSON.stringify(v)} no está en ${JSON.stringify(lista)}`); };

async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}
// Petición anónima: solo apikey, sin Authorization de sesión.
const anonDirecto = (ruta, init = {}) => fetch(`${SUPA}/${ruta}`, {
  ...init, headers: { apikey: KEY, "Content-Type": "application/json", ...(init.headers ?? {}) },
});
// Mismo camino que el navegador sin sesión: el proxy inyecta la apikey.
const anonProxy = (ruta, init = {}) => fetch(`${APP}/api/supa/${ruta}`, {
  ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
});
const filas = async (r) => { const t = await r.text(); try { const j = JSON.parse(t); return Array.isArray(j) ? j.length : -1; } catch { return -1; } };

const TABLAS_SENSIBLES = ["personas", "usuarios_admin", "cuentas_portal", "registro_accesos", "auditoria",
  "vinculos", "v_personal", "v_usuarios_admin", "v_registro_accesos", "v_activos", "v_sedes", "v_portal_datos"];
// Con los argumentos reales: sin ellos PostgREST responde 404 (no encuentra la
// sobrecarga) antes de evaluar permisos, y la prueba no mediría nada.
const RPCS_NEGOCIO = [
  ["importar_padron", { p_filas: [], p_por: "verificar-cierre-anon" }],
  ["eliminar_trabajador", { p_dni: "00000000" }],
  ["fn_ver_cuenta_bancaria", { p_dni: "00000000" }],
  ["fn_nivel_modulo", { p_modulo: "personal" }],
];
const RPCS_LOGIN = [
  ["verificar_bloqueo", { p_correo: "nadie@ejemplo.com" }],
  ["registrar_ingreso", { p_correo: "nadie@ejemplo.com", p_resultado: "fallido", p_dispositivo: "verificar-cierre-anon" }],
  ["portal_verificar_bloqueo", { p_dni: "00000000" }],
  ["portal_registrar_ingreso", { p_dni: "00000000", p_resultado: "fallido", p_dispositivo: "verificar-cierre-anon" }],
];

// 1 · Tablas y vistas sensibles: sin sesión no devuelven filas (401/403).
for (const t of TABLAS_SENSIBLES) {
  await prueba(`anon directo: ${t} no se lee`, async () => {
    const r = await anonDirecto(`rest/v1/${t}?select=*&limit=1`);
    enLista(r.status, [401, 403], `status (filas=${await filas(r)})`);
  });
}
await prueba("anon vía proxy: personas no se lee", async () => {
  const r = await anonProxy("rest/v1/personas?select=*&limit=1");
  enLista(r.status, [401, 403], `status (filas=${await filas(r)})`);
});
await prueba("anon vía proxy: v_personal no se lee", async () => {
  const r = await anonProxy("rest/v1/v_personal?select=*&limit=1");
  enLista(r.status, [401, 403], `status (filas=${await filas(r)})`);
});

// 2 · RPCs de negocio: sin sesión falla por PERMISO (no por validación).
for (const [fn, args] of RPCS_NEGOCIO) {
  await prueba(`anon directo: rpc ${fn} denegada por permiso`, async () => {
    const r = await anonDirecto(`rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
    const cuerpo = await r.text();
    enLista(r.status, [401, 403], `status (${cuerpo.slice(0, 120)})`);
    igual(/permission denied|42501|Unauthorized|JWT/i.test(cuerpo), true, `motivo (${cuerpo.slice(0, 120)})`);
  });
}

// 3 · Las 4 RPCs de login siguen respondiendo sin sesión.
// Las de registro son `returns void` → PostgREST responde 204.
for (const [fn, args] of RPCS_LOGIN) {
  await prueba(`anon directo: rpc ${fn} sigue abierta`, async () => {
    const r = await anonDirecto(`rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
    enLista(r.status, [200, 204], `status (${(await r.text()).slice(0, 120)})`);
  });
}

// 4 · Con sesión de superadmin, el BackOffice lee sus vistas por el proxy.
if (!SUPERADMIN_EMAIL || !SUPERADMIN_PASSWORD_INICIAL) {
  console.log("(sin SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD_INICIAL — se saltan los casos con sesión)");
} else {
  let jwt = null;
  await prueba("login BackOffice por el proxy", async () => {
    const r = await anonProxy("auth/v1/token?grant_type=password", {
      method: "POST", body: JSON.stringify({ email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD_INICIAL }),
    });
    const j = await r.json();
    igual(typeof j.access_token, "string", `access_token (${JSON.stringify(j).slice(0, 120)})`);
    jwt = j.access_token;
  });
  for (const v of ["v_usuarios_admin", "v_mi_acceso", "v_personal", "v_sedes"]) {
    await prueba(`con sesión: ${v} se lee`, async () => {
      const r = await anonProxy(`rest/v1/${v}?select=*&limit=1`, { headers: { "x-sesion": jwt } });
      igual(r.status, 200, `status (${(await r.text()).slice(0, 120)})`);
    });
  }
}

// 5 · fn_nivel_modulo: 99 por Management API (session_user postgres), 0 con claims de anon.
await prueba("fn_nivel_modulo sin JWT por Management API → 99", async () => {
  const [{ n }] = await sql("select fn_nivel_modulo('personal') as n");
  igual(n, 99, "nivel");
});
await prueba("fn_nivel_modulo con claims de rol anon → 0", async () => {
  const [{ n }] = await sql(
    `select set_config('request.jwt.claims', '{"role":"anon"}', true); select fn_nivel_modulo('personal') as n`);
  igual(n, 0, "nivel");
});
await prueba("fn_nivel_modulo con claims de rol authenticated sin email → 0", async () => {
  const [{ n }] = await sql(
    `select set_config('request.jwt.claims', '{"role":"authenticated"}', true); select fn_nivel_modulo('personal') as n`);
  igual(n, 0, "nivel");
});

// 6 · Radiografía: 0 grants a anon en tablas/vistas; solo 4 funciones ejecutables por anon.
await prueba("catálogo: anon sin SELECT en ninguna tabla ni vista de public", async () => {
  const [{ n }] = await sql(`select count(*)::int as n from pg_class c join pg_namespace s on s.oid=c.relnamespace
    where s.nspname='public' and c.relkind in ('r','v') and has_table_privilege('anon', c.oid, 'select')`);
  igual(n, 0, "objetos legibles por anon");
});
await prueba("catálogo: anon ejecuta exactamente las 4 RPCs de login", async () => {
  const lista = await sql(`select p.proname from pg_proc p join pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and has_function_privilege('anon', p.oid, 'execute') order by 1`);
  igual(lista.map((r) => r.proname).join(","),
    "portal_registrar_ingreso,portal_verificar_bloqueo,registrar_ingreso,verificar_bloqueo", "funciones");
});
await prueba("catálogo: privilegios por defecto de postgres ya no incluyen a anon", async () => {
  const [{ n }] = await sql(`select count(*)::int as n from pg_default_acl
    where defaclnamespace='public'::regnamespace and defaclrole='postgres'::regrole and defaclacl::text like '%anon=%'`);
  igual(n, 0, "entradas con anon");
});
await prueba("catálogo: ninguna política acceso_demo aplica a anon", async () => {
  const [{ n }] = await sql(`select count(*)::int as n from pg_policies
    where schemaname='public' and policyname='acceso_demo' and 'anon' = any(roles)`);
  igual(n, 0, "políticas con anon");
});

console.log(fallos ? `\n${fallos} fallo(s).` : "\nTodo verde.");
process.exit(fallos ? 1 : 0);
