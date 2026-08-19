// scripts/verificar-soporte.mjs — pruebas del módulo Soporte (tickets) y de
// los campos nuevos de Gestión de TI contra la BD viva (Management API).
// Las llamadas del Management API van sin JWT → fn_nivel_modulo devuelve 99
// (servicio), así que los gates de nivel se prueban en su rama permitida; la
// rama denegada se cubre con el REST anon del proxy (portal_crear_ticket sin
// sesión) y con la ausencia de grants sobre las tablas crudas.
// Uso: . .\scripts\token-supabase.ps1; node scripts/verificar-soporte.mjs
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

// DNI real de un trabajador vigente (el que tenga vínculo abierto).
const [{ dni: DNI }] = await sql(
  "select persona_dni as dni from vinculos where fecha_fin is null order by fecha_inicio desc limit 1");

await prueba("catálogo sembrado: 7 tipos, 26 subtipos; el activo excluye Correo y Cuenta de usuario", async () => {
  const [t] = await sql("select count(*)::int n from ticket_tipos");
  igual(t.n >= 7, true, `tipos (${t.n})`);
  const [s] = await sql("select count(*)::int n from ticket_subtipos");
  igual(s.n >= 26, true, `subtipos (${s.n})`);
  const inactivos = await sql("select distinct tipo from v_ticket_catalogo where tipo in ('Correo','Cuenta de usuario')");
  igual(inactivos.length, 0, "tipos inactivos visibles");
});

let numero = null;
await prueba("crear_ticket_admin crea con datos derivados del maestro y numera TK-NNNN", async () => {
  const [{ id: tipoHw }] = await sql("select id from ticket_tipos where nombre='Hardware'");
  const [{ n }] = await sql(
    `select crear_ticket_admin('${DNI}', ${tipoHw}, null, 'ZZPRUEBA verificar-soporte', 'verificar-soporte') as n`);
  numero = n;
  igual(/^TK-\d{4,}$/.test(n), true, `número (${n})`);
  const [tk] = await sql(`select solicitante_nombre, area, empresa, estado from v_tickets where numero='${n}'`);
  igual(tk.solicitante_nombre !== null && tk.solicitante_nombre !== "", true, "nombre derivado");
  igual(tk.estado, "abierto", "estado inicial");
});

await prueba("negativa: tipo inactivo (Correo) se rechaza", async () => {
  const [{ id }] = await sql("select id from ticket_tipos where nombre='Correo'");
  let error = null;
  try { await sql(`select crear_ticket_admin('${DNI}', ${id}, null, 'ZZPRUEBA', 'verificar-soporte')`); }
  catch (e) { error = e.message; }
  igual(error !== null && error.includes("inactivo"), true, `error (${error})`);
});

await prueba("negativa: subtipo de otro tipo se rechaza", async () => {
  const [{ id: tipoHw }] = await sql("select id from ticket_tipos where nombre='Hardware'");
  const [{ id: subSw }] = await sql(
    "select ts.id from ticket_subtipos ts join ticket_tipos tt on tt.id=ts.tipo_id where tt.nombre='Software' and ts.nombre='Office'");
  let error = null;
  try { await sql(`select crear_ticket_admin('${DNI}', ${tipoHw}, ${subSw}, 'ZZPRUEBA', 'verificar-soporte')`); }
  catch (e) { error = e.message; }
  igual(error !== null && error.includes("no corresponde"), true, `error (${error})`);
});

await prueba("actualizar_ticket cambia estado, responsable y nota; guarda quién y cuándo", async () => {
  const [{ id }] = await sql(`select id from tickets where numero='${numero}'`);
  await sql(`select actualizar_ticket(${id}, 'en_proceso', 'Equipo TI', 'nota interna de prueba', 'verificar-soporte')`);
  const [tk] = await sql(`select estado, atendido_por, nota_interna, actualizado_por from v_tickets where numero='${numero}'`);
  igual(tk.estado, "en_proceso", "estado");
  igual(tk.atendido_por, "Equipo TI", "atendido_por");
  igual(tk.nota_interna, "nota interna de prueba", "nota");
  igual(tk.actualizado_por, "verificar-soporte", "actualizado_por");
});

await prueba("v_portal_tickets no expone la nota interna y filtra por sesión (vacía sin JWT)", async () => {
  const cols = await sql(
    "select column_name from information_schema.columns where table_name='v_portal_tickets'");
  igual(cols.some((c) => c.column_name === "nota_interna"), false, "nota_interna expuesta");
  const filas = await sql("select count(*)::int n from v_portal_tickets");
  igual(filas[0].n, 0, "sin sesión debería estar vacía");
});

await prueba("las tablas crudas no tienen grants para anon/authenticated", async () => {
  const g = await sql(
    `select count(*)::int n from information_schema.role_table_grants
     where table_name in ('tickets','ticket_tipos','ticket_subtipos','ticket_avisos')
       and grantee in ('anon','authenticated')`);
  igual(g[0].n, 0, `grants (${g[0].n})`);
});

await prueba("alternar tipo lo saca del catálogo activo y vuelve", async () => {
  const [{ id }] = await sql("select id from ticket_tipos where nombre='Otro'");
  await sql(`select alternar_ticket_tipo(${id}, false)`);
  const off = await sql("select count(*)::int n from v_ticket_catalogo where tipo='Otro'");
  igual(off[0].n, 0, "sigue visible apagado");
  await sql(`select alternar_ticket_tipo(${id}, true)`);
  const on = await sql("select count(*)::int n from v_ticket_catalogo where tipo='Otro'");
  igual(on[0].n >= 1, true, "no volvió");
});

await prueba("avisos: alta, desactivación y eliminación", async () => {
  await sql("select guardar_ticket_aviso('zzprueba@correo.pe', true)");
  const [a] = await sql("select activo from v_ticket_avisos where correo='zzprueba@correo.pe'");
  igual(a.activo, true, "alta");
  await sql("select guardar_ticket_aviso('zzprueba@correo.pe', false)");
  const [b] = await sql("select activo from v_ticket_avisos where correo='zzprueba@correo.pe'");
  igual(b.activo, false, "desactivación");
  await sql("select eliminar_ticket_aviso('zzprueba@correo.pe')");
  const c = await sql("select count(*)::int n from ticket_avisos where correo='zzprueba@correo.pe'");
  igual(c[0].n, 0, "eliminación");
});

await prueba("gestión de TI: IPs de PROMANT cargadas y clave_equipo fuera de v_activos", async () => {
  const [ip] = await sql("select ip from v_activos where codigo='PROLT04'");
  igual(ip.ip, "192.168.1.185", "ip PROLT04");
  const [n] = await sql("select count(*)::int n from activos where ip is not null");
  igual(n.n >= 18, true, `activos con ip (${n.n})`);
  const cols = await sql("select column_name from information_schema.columns where table_name='v_activos'");
  igual(cols.some((c) => c.column_name === "clave_equipo"), false, "clave_equipo expuesta");
  igual(cols.some((c) => c.column_name === "tiene_clave"), true, "falta tiene_clave");
});

await prueba("clave de equipo: guardar/ver (servicio=99) y rastro en auditoría", async () => {
  await sql("select guardar_clave_equipo('PROLT04', 'zz-clave-prueba', 'verificar-soporte')");
  const [{ v }] = await sql("select ver_clave_equipo('PROLT04', 'verificar-soporte') as v");
  igual(v, "zz-clave-prueba", "clave leída");
  const [au] = await sql(
    "select count(*)::int n from auditoria where accion='CLAVE_EQUIPO_VISTA' and datos_antes->>'codigo'='PROLT04'");
  igual(au.n >= 1, true, "auditoría");
  await sql("select guardar_clave_equipo('PROLT04', null, 'verificar-soporte')"); // limpiar
  const [t] = await sql("select tiene_clave from v_activos where codigo='PROLT04'");
  igual(t.tiene_clave, false, "clave no quedó limpia");
});

await prueba("asignar_activo acepta antivirus y comentario y v_activos los muestra", async () => {
  // activo disponible cualquiera
  const disp = await sql(
    "select codigo from v_activos where estado='disponible' and empresa='promant' limit 1");
  if (!disp.length) throw new Error("no hay activo disponible para probar");
  const cod = disp[0].codigo;
  await sql(`select asignar_activo('${cod}', '${DNI}', 'Buen estado', true, 'ZZPRUEBA asignación')`);
  const [v] = await sql(`select antivirus, comentario_asignacion from v_activos where codigo='${cod}'`);
  igual(v.antivirus, true, "antivirus");
  igual(v.comentario_asignacion, "ZZPRUEBA asignación", "comentario");
  await sql(`select devolver_activo('${cod}', 'disponible', 'Buen estado')`); // revertir
});

// Limpieza: los tickets ZZPRUEBA quedan cerrados como rastro inofensivo.
await sql("update tickets set estado='cerrado' where comentario like 'ZZPRUEBA%'");

console.log(fallos ? `\n${fallos} PRUEBAS FALLARON` : "\nTODAS LAS PRUEBAS PASARON");
process.exit(fallos ? 1 : 0);
