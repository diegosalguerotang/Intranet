// scripts/verificar-fase6.mjs — Verificación en PRODUCCIÓN de la fase 6:
//   6b (SQL): fn_nivel_modulo con fallo cerrado, registro_accesos.fuente,
//       bitácoras con guarda de sesión, api_login_* solo para service_role,
//       política con piso 10. Comportamiento en transacciones revertidas.
//   6a/6c/6d (HTTP, solo lecturas o peticiones que el proxy rechaza ANTES de
//       tocar Auth): lista blanca, admin de Auth vedado, clave débil rechazada
//       con un JWT sin firma válida (no cambia nada), paquete sin credenciales.
//   Si la migración 6b aún no está aplicada lo dice y no falla en las HTTP.
//   env: SUPABASE_ACCESS_TOKEN
//   Uso: . .\scripts\token-supabase.ps1; node scripts/verificar-fase6.mjs
import { CLAVE_MIN_BACKOFFICE, LIMITE_IP_FALLIDOS } from "./fase6-generar.mjs";
const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const APP = process.env.APP_URL || "https://intranet-general.vercel.app";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }

let fallos = 0;
async function prueba(nombre, fn) {
  try { await fn(); console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); }
}
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }),
  });
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`); return JSON.parse(t);
}

const [estado] = await sql(`select to_regclass('interno.respaldo_fase6') is not null as aplicada,
  exists (select 1 from pg_attribute where attrelid = 'interno.registro_accesos'::regclass and attname = 'fuente' and not attisdropped) as fuente`);
console.log(`== 6b · Migración ${estado.aplicada ? "APLICADA" : "NO aplicada (pendiente del go)"}`);

if (estado.aplicada) {
  await prueba("catálogo: fuente, índice, funciones reescritas, api_login_* solo service_role, pre-login sigue abierto a anon", async () => {
    const [r] = await sql(`select
      (select prosrc ~ 'current_setting\\(''role''' from pg_proc where oid = 'public.fn_nivel_modulo(text)'::regprocedure) as rol_activo,
      (select prosrc ~ 'fuente = ''proxy''' from pg_proc where oid = 'public.verificar_bloqueo(text)'::regprocedure) as vb,
      (select prosrc ~ 'fuente = ''proxy''' from pg_proc where oid = 'public.portal_verificar_bloqueo(text)'::regprocedure) as pvb,
      (select prosrc ~ 'correo_llamador' from pg_proc where oid = 'public.registrar_ingreso(text, text, text)'::regprocedure) as ri,
      (select prosrc ~ 'correo_llamador' from pg_proc where oid = 'public.portal_registrar_ingreso(text, text, text)'::regprocedure) as pri,
      exists (select 1 from pg_indexes where schemaname = 'interno' and indexname = 'registro_accesos_ip_idx') as idx,
      has_function_privilege('authenticated', 'public.api_login_permitido(text, text)', 'execute') as a1,
      has_function_privilege('anon', 'public.api_login_registrar(text, text, text, text)', 'execute') as a2,
      has_function_privilege('service_role', 'public.api_login_permitido(text, text)', 'execute') as s1,
      has_function_privilege('service_role', 'public.api_login_registrar(text, text, text, text)', 'execute') as s2,
      (select bool_and(has_function_privilege('anon', f, 'execute')) from unnest(array['public.verificar_bloqueo(text)', 'public.registrar_ingreso(text, text, text)', 'public.portal_verificar_bloqueo(text)', 'public.portal_registrar_ingreso(text, text, text)']) f) as pre`);
    igual(JSON.stringify(r), JSON.stringify({ rol_activo: true, vb: true, pvb: true, ri: true, pri: true, idx: true, a1: false, a2: false, s1: true, s2: true, pre: true }), "catálogo");
  });
  await prueba(`política: clave del BackOffice ≥ ${CLAVE_MIN_BACKOFFICE}, constraint y default`, async () => {
    const [r] = await sql(`select clave_longitud_min_backoffice as v, (select pg_get_constraintdef(oid) from pg_constraint where conname = 'chk_clave_min_backoffice' and conrelid = 'interno.politica_acceso'::regclass) as chk,
      (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum where d.adrelid = 'interno.politica_acceso'::regclass and a.attname = 'clave_longitud_min_backoffice') as def
      from interno.politica_acceso where id = 1`);
    if (r.v < CLAVE_MIN_BACKOFFICE) throw new Error(`valor ${r.v}`);
    if (!/>= 10/.test(r.chk)) throw new Error(`constraint ${r.chk}`);
    igual(r.def, "10", "default");
  });
  await prueba("comportamiento (revertido): rol activo authenticated sin claims → nivel 0; sesión de servicio → 99", async () => {
    const [r] = await sql(`begin; grant execute on function public.fn_nivel_modulo(text) to authenticated; set local role authenticated;
      select fn_nivel_modulo('accesos') as n; rollback;`);
    igual(r.n, 0, "authenticated sin claims");
    const [s] = await sql(`select fn_nivel_modulo('accesos') as n`);
    igual(s.n, 99, "sesión postgres");
  });
  await prueba("comportamiento (revertido): anon no puede anotar un «exitoso» ajeno; un fallo del navegador no cuenta para el bloqueo", async () => {
    const [u] = await sql(`select correo from interno.usuarios_admin where estado = 'activo' order by id limit 1`);
    const r = await sql(`begin; set local role anon; select set_config('request.jwt.claims', '{"role":"anon"}', true);
      do $$ begin perform registrar_ingreso('${u.correo}', 'exitoso', 'verificacion'); raise exception 'PASO'; exception when insufficient_privilege then null; end $$;
      select 'ok' as r; rollback;`);
    igual(r[0]?.r, "ok", "guarda de sesión");
    const [b] = await sql(`begin; set local role anon; select set_config('request.jwt.claims', '{"role":"anon"}', true); select set_config('request.headers', '{"x-ip-real":"203.0.113.250"}', true);
      select registrar_ingreso('${u.correo}', 'fallido', 'verificacion'), registrar_ingreso('${u.correo}', 'fallido', 'verificacion'), registrar_ingreso('${u.correo}', 'fallido', 'verificacion'), registrar_ingreso('${u.correo}', 'fallido', 'verificacion'), registrar_ingreso('${u.correo}', 'fallido', 'verificacion'), registrar_ingreso('${u.correo}', 'fallido', 'verificacion'), registrar_ingreso('${u.correo}', 'fallido', 'verificacion'), registrar_ingreso('${u.correo}', 'fallido', 'verificacion'), registrar_ingreso('${u.correo}', 'fallido', 'verificacion'), registrar_ingreso('${u.correo}', 'fallido', 'verificacion');
      select verificar_bloqueo('${u.correo}') as b; rollback;`);
    igual(b.b, false, "fallos del cliente no bloquean");
  });
  await prueba(`comportamiento (revertido): ${LIMITE_IP_FALLIDOS} fallos del proxy desde una IP cierran esa IP`, async () => {
    const [r] = await sql(`begin; set local role service_role; select set_config('request.jwt.claims', '{"role":"service_role"}', true);
      select api_login_registrar('intento' || g || '@ejemplo.invalido', 'fallido', '198.51.100.250', 'verificacion') from generate_series(1, ${LIMITE_IP_FALLIDOS}) g;
      select api_login_permitido('198.51.100.250', 'otra@ejemplo.invalido') ->> 'motivo' as m, api_login_permitido('198.51.100.251', 'otra@ejemplo.invalido') ->> 'permitido' as p; rollback;`);
    igual(`${r.m}/${r.p}`, "ip/true", "compuerta");
  });
  await prueba("inventario: filas del proxy y del cliente desde la aplicación", async () => {
    const r = await sql(`select fuente, resultado, count(*)::int as n from interno.registro_accesos where fecha > (select min(actualizado_en) from interno.politica_acceso) group by 1, 2 order by 1, 2`);
    console.log("  " + (r.map((f) => `${f.fuente}/${f.resultado}: ${f.n}`).join(" · ") || "sin filas aún"));
  });
}

console.log(`\n== 6a/6c/6d · Proxy en ${APP}`);
const http = async (ruta, init) => { const r = await fetch(`${APP}/api/supa/${ruta}`, init); return { status: r.status, json: await r.json().catch(() => null) }; };
await prueba("ruta fuera de la lista blanca → 404; administración de Auth → 404", async () => {
  igual((await http("functions/v1/x")).status, 404, "functions");
  igual((await http("auth/v1/admin/users")).status, 404, "admin");
  igual((await http("pg/x")).status, 404, "pg");
});
await prueba("ruta permitida responde (health de Auth por el proxy, sin credenciales del cliente)", async () => {
  igual((await http("auth/v1/health")).status, 200, "health");
});
await prueba("clave débil de una cuenta administrativa: 400 del proxy antes de Auth (JWT sin firma válida: no cambia nada)", async () => {
  const jwt = `x.${Buffer.from(JSON.stringify({ email: "verificacion@grupoer.pe" })).toString("base64url")}.y`;
  const r = await http("auth/v1/user", { method: "PUT", headers: { "content-type": "application/json", "x-sesion": jwt }, body: JSON.stringify({ password: "abc123" }) });
  igual(r.status, 400, "status"); igual(r.json?.error_code, "weak_password", "código");
});
await prueba("login por clave de una cuenta inexistente pasa la compuerta y Auth responde 400 (no 503): la compuerta está viva", async () => {
  const r = await http("auth/v1/token?grant_type=password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "verificacion-fase6@ejemplo.invalido", password: "x" }) });
  igual(r.status, 400, "status");
});
await prueba("el paquete publicado no lleva URL ni clave de Supabase", async () => {
  const html = await (await fetch(`${APP}/admin/login`)).text();
  const js = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
  if (!js.length) throw new Error("sin scripts en el HTML");
  for (const s of js) {
    const t = await (await fetch(new URL(s, APP))).text();
    if (/sb_publishable_qgP|mzpbdkrmokfxrrsotfgs/.test(t)) throw new Error(`credencial en ${s}`);
  }
});

console.log(fallos ? `\n${fallos} fallo(s).` : "\nTodo verde.");
process.exit(fallos ? 1 : 0);
