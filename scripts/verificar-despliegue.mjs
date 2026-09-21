// scripts/verificar-despliegue.mjs — Corrección de seguridad · FASE 7:
// comprobaciones HTTP contra un despliegue, SIN token ni llave de servicio
// (solo lo que cualquier navegador puede pedir). Corre en CI cuando Vercel
// marca el despliegue de producción como listo, y a mano cuando se quiera.
//   · el paquete publicado (BackOffice y Portal) no lleva URL ni clave de Supabase
//   · el proxy solo reenvía la lista blanca y veda la administración de Auth
//   · sin sesión no se lee ninguna tabla ni vista por el proxy (anon cerrado)
//   · las 4 RPC pre-login responden; una cuenta administrativa no puede fijar
//     una clave débil (400 del proxy antes de Auth, con un JWT sin firma válida)
//   · la compuerta de login está viva (Auth responde 400 a una cuenta inexistente, no 503)
//   env: APP_URL (por defecto https://intranet-general.vercel.app);
//        PORTAL_URL (por defecto APP_URL + /portal)
//   Uso: node scripts/verificar-despliegue.mjs
const APP = (process.env.APP_URL || "https://intranet-general.vercel.app").replace(/\/$/, "");
const PORTAL = (process.env.PORTAL_URL || `${APP}/portal`).replace(/\/$/, "");
const PROXY = `${APP}/api/supa`;
// Solo lo propio del proyecto (supabase-js menciona los prefijos genéricos en su código).
const CREDENCIALES = /sb_publishable_qgP|mzpbdkrmokfxrrsotfgs|sb_secret_[A-Za-z0-9_-]{16,}/;

let fallos = 0;
async function prueba(nombre, fn) {
  try { await fn(); console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); }
}
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
const enLista = (v, lista, msj) => { if (!lista.includes(v)) throw new Error(`${msj}: ${JSON.stringify(v)} no está en ${JSON.stringify(lista)}`); };
const http = async (ruta, init) => { const r = await fetch(`${PROXY}/${ruta}`, init); return { status: r.status, json: await r.json().catch(() => null) }; };
const json = (cuerpo) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });

async function paqueteLimpio(base, nombre) {
  const r = await fetch(base);
  if (!r.ok) throw new Error(`${nombre}: HTTP ${r.status} en ${base}`);
  const html = await r.text();
  const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
  if (!scripts.length) throw new Error(`${nombre}: sin scripts en el HTML`);
  for (const s of scripts) {
    const codigo = await (await fetch(new URL(s, base + "/"))).text();
    if (CREDENCIALES.test(codigo)) throw new Error(`${nombre}: credencial en ${s}`);
    if (codigo.length < 1000) throw new Error(`${nombre}: ${s} demasiado pequeño (${codigo.length})`);
  }
  return scripts.length;
}

console.log(`== Despliegue: ${APP} · Portal: ${PORTAL}`);
await prueba("BackOffice: el paquete publicado no lleva URL ni clave de Supabase", async () => { await paqueteLimpio(`${APP}/admin/login`, "BackOffice"); });
await prueba("Portal: el paquete publicado no lleva URL ni clave de Supabase", async () => { await paqueteLimpio(PORTAL, "Portal"); });
await prueba("proxy: ruta fuera de la lista blanca → 404; administración de Auth → 404; sin ruta → 404", async () => {
  igual((await http("functions/v1/x")).status, 404, "functions");
  igual((await http("auth/v1/admin/users")).status, 404, "admin");
  igual((await http("pg/x")).status, 404, "pg");
  igual((await http("")).status, 404, "vacía");
});
await prueba("proxy: Auth responde por el proxy (health 200) y el cliente no manda credenciales", async () => {
  igual((await http("auth/v1/health")).status, 200, "health");
});
await prueba("anon cerrado: sin sesión no se lee personas, v_personal ni v_portal_datos por el proxy", async () => {
  for (const rel of ["personas?select=dni&limit=1", "v_personal?select=dni&limit=1", "v_portal_datos?select=*&limit=1", "usuarios_admin?select=id&limit=1"]) {
    const r = await http(`rest/v1/${rel}`);
    if (r.status === 200 && Array.isArray(r.json) && r.json.length) throw new Error(`${rel}: devolvió filas`);
    enLista(r.status, [200, 401, 403, 404], rel);  // 200 solo si vacío (RLS filtra)
  }
});
await prueba("pre-login: verificar_bloqueo y portal_verificar_bloqueo responden sin sesión; una RPC administrativa no", async () => {
  igual((await http("rest/v1/rpc/verificar_bloqueo", json({ p_correo: "nadie@ejemplo.invalido" }))).status, 200, "verificar_bloqueo");
  igual((await http("rest/v1/rpc/portal_verificar_bloqueo", json({ p_dni: "00000000" }))).status, 200, "portal_verificar_bloqueo");
  enLista((await http("rest/v1/rpc/api_login_permitido", json({ p_ip: "1.1.1.1", p_correo: "x@y" }))).status, [401, 403, 404], "api_login_permitido");
  enLista((await http("rest/v1/rpc/eliminar_trabajador", json({ p_dni: "00000000" }))).status, [401, 403, 404], "eliminar_trabajador");
});
await prueba("P11: una cuenta administrativa no puede fijar una clave débil (400 del proxy antes de Auth; JWT sin firma válida, no cambia nada)", async () => {
  const jwt = `x.${Buffer.from(JSON.stringify({ email: "verificacion@grupoer.pe" })).toString("base64url")}.y`;
  const r = await http("auth/v1/user", { method: "PUT", headers: { "content-type": "application/json", "x-sesion": jwt }, body: JSON.stringify({ password: "abc123" }) });
  igual(r.status, 400, "status"); igual(r.json?.error_code, "weak_password", "código");
});
await prueba("compuerta de login viva: cuenta inexistente → 400 de Auth (no 503 ni 500)", async () => {
  const r = await http("auth/v1/token?grant_type=password", json({ email: "verificacion-despliegue@ejemplo.invalido", password: "x" }));
  igual(r.status, 400, "status");
});
await prueba("el canal viejo /supa/* ya no existe", async () => {
  const r = await fetch(`${APP}/supa/auth/v1/health`);
  const texto = await r.text();
  if (r.ok && /"name"\s*:\s*"GoTrue"/.test(texto)) throw new Error("el rewrite /supa sigue llegando a Supabase");
});

console.log(fallos ? `\n${fallos} fallo(s).` : "\nTodo verde.");
process.exit(fallos ? 1 : 0);
