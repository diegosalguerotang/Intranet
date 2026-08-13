// Verificación E2E del Portal del Trabajador V1 contra producción.
//   env: ADMIN_EMAIL, ADMIN_CLAVE (BackOffice, nivel personal>=2),
//        SUPABASE_ACCESS_TOKEN (para simular cese por SQL directo).
//   node scripts/verificar-portal.mjs
const APP = "https://intranet-general.vercel.app";
const SUPA = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const APIKEY = "sb_publishable_qgPwZ8-4neRlKQXpCe9tnw_Dix4Ddwg";
const A = "45231876", B = "47893456"; // trabajadores seed
const { ADMIN_EMAIL, ADMIN_CLAVE, SUPABASE_ACCESS_TOKEN } = process.env;
if (!ADMIN_EMAIL || !ADMIN_CLAVE || !SUPABASE_ACCESS_TOKEN) {
  console.error("Faltan ADMIN_EMAIL / ADMIN_CLAVE / SUPABASE_ACCESS_TOKEN."); process.exit(1);
}

let fallos = 0;
const ok = (n) => console.log(`  ✔ ${n}`);
const mal = (n, d) => { fallos++; console.error(`  ✘ ${n} — ${String(d).slice(0, 160)}`); };

const json = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { crudo: t }; } };
const login = async (email, clave) => json(await fetch(`${APP}/api/supa/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: clave }),
}));
const conToken = (tok) => ({
  vista: async (v, f = "select=*") => json(await fetch(`${SUPA}/rest/v1/${v}?${f}&apikey=${APIKEY}`, {
    headers: { authorization: `Bearer ${tok}` } })),
  rpc: async (n, args) => {
    const r = await fetch(`${SUPA}/rest/v1/rpc/${n}?apikey=${APIKEY}`, {
      method: "POST", headers: { "Content-Type": "application/json", authorization: `Bearer ${tok}` },
      body: JSON.stringify(args) });
    return { ok: r.ok, cuerpo: await json(r) };
  },
});
const sql = async (q) => json(await fetch(`https://api.supabase.com/v1/projects/mzpbdkrmokfxrrsotfgs/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: q }),
}));

console.log("0 · Sesión del BackOffice y cuentas de los trabajadores de prueba");
const admin = await login(ADMIN_EMAIL, ADMIN_CLAVE);
if (!admin.access_token) { mal("login admin", JSON.stringify(admin)); process.exit(1); }
const cuenta = async (accion, dni) => json(await fetch(`${APP}/api/portal-cuentas`, {
  method: "POST", headers: { "Content-Type": "application/json", "x-sesion": admin.access_token },
  body: JSON.stringify({ accion, dni }),
}));
let cuentaA = await cuenta("restablecer", A);
if (cuentaA.error) cuentaA = await cuenta("crear", A);
let cuentaB = await cuenta("restablecer", B);
if (cuentaB.error) cuentaB = await cuenta("crear", B);
if (cuentaA.clave && cuentaB.clave) ok("cuentas listas con claves numéricas");
else mal("cuentas", JSON.stringify({ cuentaA, cuentaB }));

const sesA = await login(`${A}@portal.grupoer.pe`, cuentaA.clave);
const sesB = await login(`${B}@portal.grupoer.pe`, cuentaB.clave);
if (sesA.access_token && sesB.access_token) ok("ambos trabajadores inician sesión");
else mal("login trabajadores", JSON.stringify({ a: !!sesA.access_token, b: !!sesB.access_token }));
const cliA = conToken(sesA.access_token), cliB = conToken(sesB.access_token);

console.log("1 · Scoping: cada trabajador ve SOLO lo suyo");
const bolA = await cliA.vista("v_portal_boletas", "select=id");
const bolB = await cliB.vista("v_portal_boletas", "select=id");
const idsA = new Set((bolA ?? []).map((x) => x.id));
const idsB = new Set((bolB ?? []).map((x) => x.id));
const cruce = [...idsA].filter((i) => idsB.has(i));
if (cruce.length === 0) ok(`sin cruce de documentos (A=${idsA.size}, B=${idsB.size})`);
else mal("scoping", `documentos compartidos: ${cruce.join(",")}`);
const perfilB = await cliB.vista("v_portal_perfil", "select=dni");
(perfilB?.length === 1 && perfilB[0].dni === B) ? ok("v_portal_perfil devuelve exactamente al dueño de la sesión")
  : mal("perfil", JSON.stringify(perfilB));

console.log("2 · Acuse probatorio (con un trabajador que tenga documento pendiente)");
const [cand] = await sql(`select v.persona_dni as dni, d.id
  from documentos d join vinculos v on v.id = d.vinculo_id
  where d.estado = 'vigente' and v.persona_dni <> '${B}'
    and not exists (select 1 from acuses a where a.documento_id = d.id)
  limit 1`);
if (!cand) mal("documento pendiente", "no queda ningún documento sin acuse en la BD");
else {
  let cuentaC = await cuenta("restablecer", cand.dni);
  if (cuentaC.error) cuentaC = await cuenta("crear", cand.dni);
  const sesC = await login(`${cand.dni}@portal.grupoer.pe`, cuentaC.clave);
  const cliC = conToken(sesC.access_token);
  const c1 = await cliC.rpc("portal_confirmar_recepcion", { p_documento_id: cand.id, p_dispositivo: "verificar-portal" });
  c1.ok ? ok(`recepción confirmada por ${cand.dni}, constancia ${c1.cuerpo}`) : mal("confirmar", JSON.stringify(c1.cuerpo));
  const c2 = await cliC.rpc("portal_confirmar_recepcion", { p_documento_id: cand.id, p_dispositivo: "verificar-portal" });
  (!c2.ok && /ya tiene/i.test(c2.cuerpo?.message ?? "")) ? ok("repetir la confirmación falla (inmutable)")
    : mal("doble confirmación", JSON.stringify(c2.cuerpo));
  const c3 = await cliB.rpc("portal_confirmar_recepcion", { p_documento_id: cand.id, p_dispositivo: "verificar-portal" });
  (!c3.ok) ? ok("otro trabajador no puede confirmar ese documento") : mal("cruce de acuse", JSON.stringify(c3.cuerpo));
  const [acuse] = await sql(`select declaracion from acuses a where a.documento_id = ${cand.id}`);
  (acuse?.declaracion ?? "").includes("DECLARACIÓN DE RECEPCIÓN")
    ? ok("el texto íntegro de la declaración quedó dentro del acuse")
    : mal("declaración copiada", JSON.stringify(acuse).slice(0, 120));
}

console.log("3 · Cesados: solo lectura 12 meses, después nada");
await sql(`update vinculos set fecha_fin = current_date - interval '3 months' where persona_dni = '${B}' and fecha_fin is null`);
const modo3m = (await cliB.vista("v_portal_perfil", "select=modo"))?.[0]?.modo;
modo3m === "solo-lectura" ? ok("cesado hace 3 meses → solo lectura") : mal("cesado 3m", modo3m);
const cesadoConfirma = await cliB.rpc("portal_confirmar_recepcion", { p_documento_id: 999999, p_dispositivo: "x" });
(!cesadoConfirma.ok && /solo lectura/i.test(cesadoConfirma.cuerpo?.message ?? ""))
  ? ok("cesado no puede confirmar recepciones") : mal("cesado confirma", JSON.stringify(cesadoConfirma.cuerpo));
await sql(`update vinculos set fecha_fin = current_date - interval '13 months' where persona_dni = '${B}' and fecha_fin = current_date - interval '3 months'`);
const modo13m = (await cliB.vista("v_portal_perfil", "select=modo"))?.[0]?.modo;
modo13m === "expirado" ? ok("cesado hace 13 meses → expirado (la app lo expulsa)") : mal("cesado 13m", modo13m);
await sql(`update vinculos set fecha_fin = null where persona_dni = '${B}' and fecha_fin = current_date - interval '13 months'`);
ok("vínculo de B restaurado");

console.log("4 · Primer ingreso registra la política de datos");
const primerB = await cliB.rpc("portal_primer_ingreso", { p_celular: "987654321", p_sin_celular: false, p_politica_version: 1 });
if (primerB.ok) {
  const [cp] = await sql(`select politica_version, politica_aceptada_en is not null as fechada from cuentas_portal where dni='${B}'`);
  (cp?.politica_version === "1" && cp?.fechada) ? ok("aceptación registrada con versión y fecha")
    : mal("registro de política", JSON.stringify(cp));
} else mal("portal_primer_ingreso", JSON.stringify(primerB.cuerpo));

console.log(fallos === 0 ? "\nTODAS LAS PRUEBAS DEL PORTAL PASARON" : `\n${fallos} PRUEBA(S) FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
