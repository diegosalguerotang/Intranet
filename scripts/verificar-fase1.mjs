// scripts/verificar-fase1.mjs — Verificación en PRODUCCIÓN de la fase 1
// (cimiento) DESPUÉS de aplicar migraciones/2026-09-17-fase1-cimiento.sql.
// Catálogo por Management API + comportamiento por el proxy con sesiones reales.
// Las llamadas administrativas se hacen con datos que fallan por VALIDACIÓN
// después de pasar la guarda (DNI inexistente): no crean ni cambian nada.
//   env: SUPABASE_ACCESS_TOKEN; opcionales SUPERADMIN_EMAIL + SUPERADMIN_PASSWORD_INICIAL,
//        ADMIN_EMAIL + ADMIN_PASSWORD (un administrador SIN marca de superadmin),
//        PORTAL_DNI + PORTAL_CLAVE (trabajador).
//   Uso: . .\scripts\token-supabase.ps1; node scripts/verificar-fase1.mjs
import { GUARDAS, NOMBRES } from "./fase1-generar.mjs";
const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const APP = "https://intranet-general.vercel.app";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
const { SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD_INICIAL, ADMIN_EMAIL, ADMIN_PASSWORD, PORTAL_DNI, PORTAL_CLAVE } = process.env;
const CON_GRANT = NOMBRES.filter((n) => GUARDAS[n].grant);
const SUPERADMIN_SOLO = NOMBRES.filter((n) => GUARDAS[n].guarda === "perform requiere_superadmin();" && GUARDAS[n].grant);

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
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}
const proxy = (ruta, init = {}) => fetch(`${APP}/api/supa/${ruta}`, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
const guardaDenego = (status, cuerpo) => status === 403 && /Permiso insuficiente/.test(cuerpo);
const fnDenegada = (status, cuerpo) => [401, 403].includes(status) && /permission denied for function/i.test(cuerpo);
async function login(email, password) {
  const r = await proxy("auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
  const j = await r.json(); if (typeof j.access_token !== "string") throw new Error(`login ${email}: ${JSON.stringify(j).slice(0, 160)}`);
  return j.access_token;
}
// Argumentos con nombre para PostgREST: todos null (la guarda corre antes).
async function argsNulos(nombre) {
  const [f] = await sql(`select coalesce((select jsonb_object_agg(a.nombre, null) from unnest(p.proargnames[1:p.pronargs]) as a(nombre)), '{}'::jsonb) as args
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = '${nombre}' order by p.pronargs desc limit 1`);
  return f.args;
}
const rpc = (jwt, fn, args) => proxy(`rest/v1/rpc/${fn}`, { method: "POST", headers: { "x-sesion": jwt }, body: JSON.stringify(args) });

console.log("== Catálogo");
await prueba("ayudantes de la guarda central: 7, definer, stable, con search_path", async () => {
  const l = await sql(`select proname, prosecdef, provolatile, coalesce(array_to_string(proconfig, ';'), '') as cfg from pg_proc p join pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and proname in ('correo_llamador','es_admin','es_superadmin','nivel_en','requiere_nivel','requiere_superadmin','requiere_correo_propio') order by 1`);
  igual(l.length, 7, "ayudantes");
  for (const f of l) { igual(f.prosecdef, true, `${f.proname} definer`); igual(f.provolatile, "s", `${f.proname} stable`); if (!f.cfg.includes("search_path")) throw new Error(`${f.proname} sin search_path`); }
});
await prueba("las 26 administrativas tienen la guarda como primera instrucción", async () => {
  const l = await sql(`select proname, prosrc from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and proname in (${NOMBRES.map((n) => `'${n}'`).join(",")})`);
  for (const f of l) if (!f.prosrc.includes(GUARDAS[f.proname].guarda)) throw new Error(`${f.proname} sin guarda`);
  igual(l.length, 26, "funciones");
});
await prueba("anon: exactamente las 4 RPC de login; ninguna security definer sin search_path", async () => {
  const [{ l }] = await sql(`select string_agg(p.proname, ',' order by p.proname) as l from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and has_function_privilege('anon', p.oid, 'execute')`);
  igual(l, "portal_registrar_ingreso,portal_verificar_bloqueo,registrar_ingreso,verificar_bloqueo", "anon");
  const [{ n }] = await sql(`select count(*)::int as n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.prosecdef and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))`);
  igual(n, 0, "definers sin search_path");
});
await prueba("ninguna función ejecutable por authenticated sin verificación del llamador (salvo la lista explícita)", async () => {
  const [{ l }] = await sql(`select string_agg(p.proname, ',' order by p.proname) as l from pg_proc p join pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and has_function_privilege('authenticated', p.oid, 'execute')
      and not (p.proname = any(array['verificar_bloqueo','registrar_ingreso','portal_verificar_bloqueo','portal_registrar_ingreso','fn_hora_entrada','portal_modo','es_admin','es_superadmin','nivel_en']))
      and p.prosrc !~ '(requiere_nivel|requiere_superadmin|requiere_correo_propio|fn_nivel_modulo|fn_nivel_memorandums|portal_dni|fn_persona_llamador|es_admin_activo|auth\\.(uid|jwt)|importar_control|importar_padron|importar_planilla_unificada|fn_ver_cuenta_bancaria)'`);
  igual(l, null, "sin guarda");
});
await prueba("una función nueva nace sin EXECUTE para authenticated ni anon (default privileges global + esquema)", async () => {
  const [r] = await sql(`create function public.zz_verif_fase1() returns int language sql as $f$ select 1 $f$;
    select has_function_privilege('authenticated','public.zz_verif_fase1()','execute') as a, has_function_privilege('anon','public.zz_verif_fase1()','execute') as an,
           has_function_privilege('service_role','public.zz_verif_fase1()','execute') as s;`);
  await sql(`drop function public.zz_verif_fase1()`);
  igual(r.a, false, "authenticated"); igual(r.an, false, "anon"); igual(r.s, true, "service_role");
});
await prueba("la sobrecarga huérfana asignar_activo(text,text,text) ya no existe", async () => {
  const [{ n }] = await sql(`select count(*)::int as n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and proname='asignar_activo'`); igual(n, 1, "sobrecargas");
});

console.log("\n== Superadministrador");
if (!SUPERADMIN_EMAIL || !SUPERADMIN_PASSWORD_INICIAL) console.log("(sin SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD_INICIAL — se saltan)");
else {
  let jwt;
  await prueba("login BackOffice", async () => { jwt = await login(SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD_INICIAL); });
  if (jwt) {
    await prueba("superadmin: es_admin() y es_superadmin() = true, nivel_en('personal') = 99", async () => {
      const a = await (await rpc(jwt, "es_admin", {})).json(); const s = await (await rpc(jwt, "es_superadmin", {})).json(); const n = await (await rpc(jwt, "nivel_en", { p_modulo: "personal" })).json();
      igual(a, true, "es_admin"); igual(s, true, "es_superadmin"); igual(n, 99, "nivel");
    });
    await prueba("superadmin: crear_usuario_admin pasa la guarda y falla por validación (DNI inexistente) → RESTITUIDA", async () => {
      const r = await rpc(jwt, "crear_usuario_admin", { p_dni: "00000000", p_perfil: "superadmin", p_correo: "x@x.com", p_celular: "", p_clave: null, p_por: "verificar-fase1" });
      const c = await r.text(); if (guardaDenego(r.status, c) || fnDenegada(r.status, c)) throw new Error(`${r.status} ${c.slice(0, 120)}`);
      if (r.status < 400) throw new Error("no debería crear con DNI inexistente");
    });
    await prueba("superadmin: alta_trabajador y publicar_comunicado pasan la guarda (fallan por validación)", async () => {
      for (const [fn, args] of [["alta_trabajador", { p_dni: "ZZ", p_nombre: "x", p_cargo: "x", p_sede: "x", p_empresa: "x", p_ingreso: "2026-01-01", p_celular: null, p_banco: null, p_cuenta: null, p_correo: null, p_cci: null, p_tipo_documento: "DNI" }],
        ["publicar_comunicado", { p_titulo: null, p_cuerpo: null, p_vence: null, p_exige: null, p_segmento: null, p_alcance: null, p_empresa: null, p_sede: null }]]) {
        const r = await rpc(jwt, fn, args); const c = await r.text();
        if (guardaDenego(r.status, c) || fnDenegada(r.status, c)) throw new Error(`${fn}: ${r.status} ${c.slice(0, 120)}`);
        if (r.status < 400) throw new Error(`${fn}: no debería completar con datos nulos/inválidos`);
      }
    });
    await prueba("superadmin: marcar_clave_cambiada sobre OTRO correo → Permiso insuficiente", async () => {
      const r = await rpc(jwt, "marcar_clave_cambiada", { p_correo: "nadie@grupoer.pe" }); const c = await r.text();
      if (!guardaDenego(r.status, c)) throw new Error(`${r.status} ${c.slice(0, 120)}`);
    });
  }
}

console.log("\n== Administrador sin marca de superadmin");
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) console.log("(sin ADMIN_EMAIL/ADMIN_PASSWORD — se saltan)");
else {
  let jwt;
  await prueba("login BackOffice (admin)", async () => { jwt = await login(ADMIN_EMAIL, ADMIN_PASSWORD); });
  if (jwt) {
    await prueba("admin: es_superadmin() = false", async () => { igual(await (await rpc(jwt, "es_superadmin", {})).json(), false, "es_superadmin"); });
    for (const n of SUPERADMIN_SOLO) {
      await prueba(`admin: ${n} → Permiso insuficiente (solo superadmin)`, async () => {
        const r = await rpc(jwt, n, await argsNulos(n)); const c = await r.text();
        if (!guardaDenego(r.status, c)) throw new Error(`${r.status} ${c.slice(0, 120)}`);
      });
    }
  }
}

console.log("\n== Trabajador del Portal: las 25 administrativas re-otorgadas, una por una");
if (!PORTAL_DNI || !PORTAL_CLAVE) console.log("(sin PORTAL_DNI/PORTAL_CLAVE — se salta)");
else {
  let jwt;
  await prueba("login del Portal", async () => { jwt = await login(`${PORTAL_DNI.toLowerCase()}@portal.grupoer.pe`, PORTAL_CLAVE); });
  if (jwt) {
    let denegadas = 0; const mal = [];
    for (const n of CON_GRANT) {
      const r = await rpc(jwt, n, await argsNulos(n)); const c = await r.text();
      if (guardaDenego(r.status, c)) { denegadas++; console.log(`  ✓ ${n}: Permiso insuficiente`); } else mal.push(`${n} → ${r.status} ${c.slice(0, 100)}`);
    }
    await prueba(`trabajador: ${denegadas}/${CON_GRANT.length} denegadas por la guarda`, async () => { if (mal.length) throw new Error("\n   " + mal.join("\n   ")); });
    await prueba("trabajador: es_admin() = false", async () => { igual(await (await rpc(jwt, "es_admin", {})).json(), false, "es_admin"); });
  }
}

console.log(fallos ? `\n${fallos} fallo(s).` : "\nTodo verde.");
process.exit(fallos ? 1 : 0);
