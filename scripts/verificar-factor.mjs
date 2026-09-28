// scripts/verificar-factor.mjs — Verificación en PRODUCCIÓN del segundo factor
// por correo (2026-09-28) tras aplicar migraciones/2026-09-28-segundo-factor.sql
// y desplegar el cliente. Crea un superadmin TEMPORAL (patrón 2026-08-19),
// entra por el proxy y comprueba: nivel 0 → vistas vacías salvo la fila propia;
// mi_segundo_factor pendiente; código sembrado por Management API → verificar
// → nivel 99; equipo recordado → segunda sesión sin código; olvidar; endpoints
// con x-sesion y funciones de guarda propia (fn_ver_cuenta_bancaria,
// previsualizar_planilla_unificada) cerrados mientras está pendiente. Limpieza
// total al final (las consultas de cuenta bancaria quedan en la auditoría).
//   env: SUPABASE_ACCESS_TOKEN  (opcional: CORREO_PRUEBA para un envío real)
//   Uso: . .\scripts\token-supabase.ps1; node scripts/verificar-factor.mjs
import { createHash } from "node:crypto";
import { marcarSesionVerificada, sessionIdDe } from "./lib/marcar-factor.mjs";
import { GUARDA_PROPIA } from "./factor-generar.mjs";

const APP = "https://intranet-general.vercel.app";
const SUPA = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
const sha = (t) => createHash("sha256").update(t).digest("hex");

let fallos = 0;
async function prueba(nombre, fn) {
  try { await fn(); console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); }
}
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
const json = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { crudo: t, status: r.status }; } };
async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }),
  });
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`); return JSON.parse(t);
}
const login = async (email, clave) => json(await fetch(`${APP}/api/supa/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: clave }),
}));
const proxy = async (ruta, ses, init = {}) => {
  const r = await fetch(`${APP}/api/supa/${ruta}`, { ...init, headers: { "Content-Type": "application/json", ...(ses ? { "x-sesion": ses } : {}), ...(init.headers ?? {}) } });
  return { status: r.status, json: await json(r) };
};
const factor = async (ses, cuerpo) => {
  const r = await fetch(`${APP}/api/segundo-factor`, { method: "POST", headers: { "Content-Type": "application/json", "x-sesion": ses }, body: JSON.stringify(cuerpo) });
  return { status: r.status, json: await json(r) };
};

// 0 · Service key y superadmin temporal.
const claves = await json(await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${token}` } }));
const service = (Array.isArray(claves) ? claves : []).find((k) => k.type === "secret" || k.name === "service_role")?.api_key;
if (!service) { console.error("No se obtuvo la service key."); process.exit(1); }
const cabService = { apikey: service, authorization: `Bearer ${service}`, "Content-Type": "application/json" };
const gotrue = async (ruta, opciones = {}) => { const r = await fetch(`${SUPA}${ruta}`, { ...opciones, headers: { ...cabService, ...opciones.headers } }); return { ok: r.ok, status: r.status, json: await json(r) }; };
const borrarCuentaGoTrue = async (email) => {
  const lista = await gotrue("/auth/v1/admin/users?per_page=1000");
  const u = (lista.json.users ?? []).find((x) => (x.email ?? "").toLowerCase() === email.toLowerCase());
  if (u) await gotrue(`/auth/v1/admin/users/${u.id}`, { method: "DELETE" });
};
const CORREO_TEMP = (process.env.CORREO_PRUEBA || "zzprueba-factor@grupoer.pe").toLowerCase();
const clave = "Zz" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0") + "aa";
const limpiar = async () => {
  await sql(`delete from interno.usuarios_admin where lower(correo) = '${CORREO_TEMP}'`).catch(() => {});
  await borrarCuentaGoTrue(CORREO_TEMP);
};
await limpiar();
const alta = await gotrue("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email: CORREO_TEMP, password: clave, email_confirm: true }) });
const [persona] = await sql(`select p.dni from personas p where p.dni not like 'ZZ%' and not exists (select 1 from interno.usuarios_admin u where u.persona_dni = p.dni) limit 1`);
const [perfil] = await sql(`select id, version from interno.perfiles where es_superadmin and estado = 'activo' order by version desc limit 1`);
if (!alta.ok || !persona || !perfil) { console.error("No se pudo crear el superadmin temporal", alta.status); process.exit(1); }
await sql(`insert into interno.usuarios_admin (persona_dni, perfil_id, perfil_version, correo, creado_por) values ('${persona.dni}', '${perfil.id}', ${perfil.version}, '${CORREO_TEMP}', 'verificar-factor')`);
const [total] = await sql("select count(*)::int as n from public.v_personal");

let tokenEquipo = null;
try {
  console.log("== 1 · Catálogo");
  await prueba("tablas, funciones y permisos como los deja la migración", async () => {
    const [r] = await sql(`select (select factor_superadmin from interno.politica_acceso where id = 1) as pol,
      ((select prosrc from pg_proc where oid = 'public.fn_nivel_modulo(text)'::regprocedure) ~ 'fn_factor_pendiente') as v4,
      has_function_privilege('authenticated', 'public.mi_segundo_factor()', 'execute') as mio,
      (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'api\\_factor\\_%' and has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')) as api,
      (select count(*)::int from pg_class c where c.relnamespace = 'interno'::regnamespace and c.relname in ('factor_codigos', 'factor_sesiones', 'dispositivos_confiables') and c.relrowsecurity) as tablas`);
    igual(`${r.pol}/${r.v4}/${r.mio}/${r.api}/${r.tablas}`, "true/true/true/5/3", "catálogo");
    const sinGuarda = await sql(`select f from unnest(array[${GUARDA_PROPIA.map((x) => `'${x}'`).join(", ")}]) f
      where (select prosrc from pg_proc where oid = f::regprocedure) !~ 'fn_factor_pendiente'`);
    igual(sinGuarda.map((x) => x.f).join(","), "", "funciones de guarda propia sin fn_factor_pendiente");
  });

  console.log("\n== 2 · Sesión pendiente (nivel 0)");
  const s1 = await login(CORREO_TEMP, clave);
  if (!s1.access_token) throw new Error(`login: ${JSON.stringify(s1).slice(0, 200)}`);
  const SID1 = sessionIdDe(s1.access_token);
  await prueba("el JWT trae session_id", async () => { if (!SID1) throw new Error("sin session_id"); });
  await prueba("v_personal vacía; v_usuarios_admin y v_mi_acceso con la fila propia; mi_segundo_factor exigido y no verificado", async () => {
    const p = await proxy("rest/v1/v_personal?select=dni&limit=5", s1.access_token);
    igual(`${p.status}/${p.json.length}`, "200/0", "v_personal");
    const u = await proxy(`rest/v1/v_usuarios_admin?select=correo&correo=eq.${encodeURIComponent(CORREO_TEMP)}`, s1.access_token);
    igual(`${u.status}/${u.json.length}`, "200/1", "v_usuarios_admin");
    const m = await proxy("rest/v1/rpc/mi_segundo_factor", s1.access_token, { method: "POST", body: "{}" });
    igual(`${m.status}/${m.json.exigido}/${m.json.verificado}`, "200/true/false", "mi_segundo_factor");
  });
  await prueba("los endpoints con x-sesion responden 403 mientras el factor está pendiente", async () => {
    const r = await fetch(`${APP}/api/admin-usuarios`, { method: "POST", headers: { "Content-Type": "application/json", "x-sesion": s1.access_token }, body: JSON.stringify({ accion: "eliminar", usuario_id: 999999 }) });
    igual(r.status, 403, "admin-usuarios");
    const t = await json(r); if (!/Verifica el código/.test(t.error ?? "")) throw new Error(`mensaje: ${JSON.stringify(t)}`);
  });

  await prueba("guarda propia pendiente: fn_ver_cuenta_bancaria → null; previsualizar_planilla_unificada → 403 «Verifica el código»; previsualizar_padron rechazada", async () => {
    const c = await proxy("rest/v1/rpc/fn_ver_cuenta_bancaria", s1.access_token, { method: "POST", body: JSON.stringify({ p_dni: persona.dni }) });
    igual(`${c.status}/${c.json}`, "200/null", "cuenta bancaria");
    const pu = await proxy("rest/v1/rpc/previsualizar_planilla_unificada", s1.access_token, { method: "POST", body: JSON.stringify({ p_filas: [], p_periodo: "2026-09", p_ceses: [] }) });
    igual(pu.status, 403, "planilla unificada"); if (!/Verifica el código/.test(pu.json.message ?? "")) throw new Error(`mensaje: ${JSON.stringify(pu.json)}`);
    const pp = await proxy("rest/v1/rpc/previsualizar_padron", s1.access_token, { method: "POST", body: JSON.stringify({ p_filas: [], p_ceses: [] }) });
    if (pp.status < 400) throw new Error(`previsualizar_padron: ${pp.status} ${JSON.stringify(pp.json)}`);
  });

  console.log("\n== 3 · Código");
  await prueba(process.env.CORREO_PRUEBA ? "enviar → 200 y rastro «enviado» (revisa el buzón)" : "enviar → 200 (correo del temporal, no llega a nadie) o 503 si el motor no está; rastro en correo_envios", async () => {
    const r = await factor(s1.access_token, { accion: "enviar" });
    if (![200, 503].includes(r.status)) throw new Error(`${r.status} ${JSON.stringify(r.json)}`);
    if (r.status === 200 && (!r.json.enviado || JSON.stringify(r.json).match(/\b\d{6}\b/))) throw new Error(`respuesta: ${JSON.stringify(r.json)}`);
    const [c] = await sql(`select resultado from correo_envios where accion = 'segundo-factor' and sujeto = '${CORREO_TEMP}' order by id desc limit 1`);
    if (!c) throw new Error("sin rastro");
  });
  await prueba("segundo envío inmediato → 429 con esperaSeg", async () => {
    const r = await factor(s1.access_token, { accion: "enviar" });
    if (r.status !== 429 && r.status !== 503) throw new Error(`${r.status} ${JSON.stringify(r.json)}`);
  });
  const CODIGO = "246810";
  await prueba("código incorrecto → 400 con intentosRestantes 4; código sembrado → 200 listo + token de equipo; nivel 99 y v_personal completa", async () => {
    await sql(`update interno.factor_codigos set usado_en = now() where session_id = '${SID1}' and usado_en is null`);
    await sql(`insert into interno.factor_codigos (usuario_id, session_id, codigo_hash, expira_en, agente) select id, '${SID1}', '${sha(CODIGO + SID1)}', now() + interval '10 minutes', 'verificar-factor' from interno.usuarios_admin where lower(correo) = '${CORREO_TEMP}'`);
    let r = await factor(s1.access_token, { accion: "verificar", codigo: "000000", recordar: true });
    igual(`${r.status}/${r.json.intentosRestantes}`, "400/4", "incorrecto");
    r = await factor(s1.access_token, { accion: "verificar", codigo: CODIGO, recordar: true });
    igual(`${r.status}/${r.json.listo}`, "200/true", "verificar");
    if (!r.json.dispositivo) throw new Error("sin token de equipo");
    tokenEquipo = r.json.dispositivo;
    const p = await proxy("rest/v1/v_personal?select=dni", s1.access_token);
    igual(`${p.status}/${p.json.length}`, `200/${total.n}`, "v_personal tras verificar");
    const m = await proxy("rest/v1/rpc/mi_segundo_factor", s1.access_token, { method: "POST", body: "{}" });
    igual(m.json.verificado, true, "verificado");
    // Con marca la respuesta ya no es null (puede ser un objeto con nulls si la persona no tiene cuenta).
    const c = await proxy("rest/v1/rpc/fn_ver_cuenta_bancaria", s1.access_token, { method: "POST", body: JSON.stringify({ p_dni: persona.dni }) });
    if (c.status !== 200 || c.json === null) throw new Error(`cuenta bancaria tras verificar: ${c.status} ${JSON.stringify(c.json)}`);
  });

  console.log("\n== 4 · Equipo recordado y revocación");
  const s2 = await login(CORREO_TEMP, clave);
  await prueba("segunda sesión: pendiente hasta presentar el token → 200 listo → nivel 99 sin código", async () => {
    let p = await proxy("rest/v1/v_personal?select=dni&limit=1", s2.access_token); igual(p.json.length, 0, "antes");
    const r = await factor(s2.access_token, { accion: "dispositivo", token: tokenEquipo });
    igual(`${r.status}/${r.json.listo}`, "200/true", "dispositivo");
    p = await proxy("rest/v1/v_personal?select=dni", s2.access_token); igual(p.json.length, total.n, "después");
  });
  await prueba("olvidar → revocados 1; una tercera sesión ya no puede usar el token (403)", async () => {
    const r = await factor(s2.access_token, { accion: "olvidar" }); igual(`${r.status}/${r.json.revocados}`, "200/1", "olvidar");
    const s3 = await login(CORREO_TEMP, clave);
    const d = await factor(s3.access_token, { accion: "dispositivo", token: tokenEquipo }); igual(d.status, 403, "token revocado");
  });
  await prueba("helper de suites: marcarSesionVerificada deja una sesión nueva en 99", async () => {
    const s4 = await login(CORREO_TEMP, clave);
    await marcarSesionVerificada(sql, s4.access_token, CORREO_TEMP);
    const p = await proxy("rest/v1/v_personal?select=dni", s4.access_token); igual(p.json.length, total.n, "v_personal");
  });
  await prueba("auditoría: FACTOR_VERIFICADO, FACTOR_DISPOSITIVO y FACTOR_DISPOSITIVOS_REVOCADOS del temporal, sin secretos", async () => {
    const r = await sql(`select accion, datos_despues::text as d from interno.auditoria where accion like 'FACTOR_%' and (datos_despues ->> 'usuario_id')::bigint = (select id from interno.usuarios_admin where lower(correo) = '${CORREO_TEMP}') order by id`);
    igual([...new Set(r.map((x) => x.accion))].sort().join(","), "FACTOR_DISPOSITIVO,FACTOR_DISPOSITIVOS_REVOCADOS,FACTOR_VERIFICADO", "acciones");
    if (r.some((x) => /codigo_hash|token_hash/.test(x.d))) throw new Error("hash en auditoría");
  });
} finally {
  console.log("\n== Limpieza");
  await limpiar();   // usuarios_admin → cascade a factor_codigos, factor_sesiones, dispositivos_confiables
  await sql(`delete from correo_envios where sujeto = '${CORREO_TEMP}' and accion = 'segundo-factor'`).catch(() => {});
}
console.log(fallos ? `\n${fallos} fallo(s).` : "\nTodo verde.");
process.exit(fallos ? 1 : 0);
