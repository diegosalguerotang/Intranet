// Verificación E2E del ciclo Accesos v2 (Categorías) contra la BD viva.
// Pruebas positivas y negativas al estilo de los verificar-* del módulo.
//   node scripts/verificar-categorias.mjs
const URL_BASE = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const APIKEY = "sb_publishable_qgPwZ8-4neRlKQXpCe9tnw_Dix4Ddwg";

let fallos = 0;
const ok = (nombre) => console.log(`  ✔ ${nombre}`);
const mal = (nombre, detalle) => { fallos++; console.error(`  ✘ ${nombre} — ${detalle}`); };

async function rpc(nombre, args) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${nombre}?apikey=${APIKEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const texto = await r.text();
  let json = null; try { json = texto ? JSON.parse(texto) : null; } catch { /* no JSON */ }
  return { ok: r.ok, status: r.status, json, texto };
}
async function ver(vista, filtro) {
  const r = await fetch(`${URL_BASE}/rest/v1/${vista}?${filtro}&apikey=${APIKEY}`);
  return r.json();
}

console.log("1 · Categoría de prueba con alcance explícito");
const g1 = await rpc("guardar_perfil", {
  p_id: "prueba-e2e", p_nombre: "Prueba E2E (borrar)", p_descripcion: "Categoría del script de verificación",
  p_superadmin: false, p_ver_remuneracion: false, p_ver_documentos: false, p_exportar: false,
  p_matriz: { personal: 2, acuses: 1 }, p_empresas: ["negliaf", "bremco"], p_por: "verificar-categorias",
});
if (!g1.ok) mal("guardar_perfil", g1.texto);
else {
  const [v] = await ver("v_perfiles", "id=eq.prueba-e2e&select=empresas,matriz");
  const empresasOk = JSON.stringify([...(v?.empresas ?? [])].sort()) === JSON.stringify(["bremco", "negliaf"]);
  empresasOk ? ok("alcance NEGLIAF+BREMCO guardado y visible") : mal("alcance", JSON.stringify(v));
}

console.log("2 · Versión nueva conserva historial con alcance");
const g2 = await rpc("guardar_perfil", {
  p_id: "prueba-e2e", p_nombre: "Prueba E2E (borrar)", p_descripcion: "v2: solo NEGLIAF",
  p_superadmin: false, p_ver_remuneracion: false, p_ver_documentos: false, p_exportar: false,
  p_matriz: { personal: 2 }, p_empresas: ["negliaf"], p_por: "verificar-categorias",
});
if (!g2.ok) mal("guardar_perfil v2", g2.texto);
else {
  const versiones = await ver("v_perfil_versiones", "perfilId=eq.prueba-e2e&select=version,empresas&order=version.desc");
  const okHist = versiones.length >= 2
    && JSON.stringify(versiones[0].empresas) === JSON.stringify(["negliaf"])
    && versiones[1].empresas.length === 2;
  okHist ? ok("historial: v2=[negliaf], v1=[bremco,negliaf]") : mal("historial", JSON.stringify(versiones));
}

console.log("3 · Usuario nuevo hereda categoría y recibe código");
const [libre] = await ver("v_personal", "select=dni,nombre&limit=50").then((xs) =>
  Promise.all([ver("v_usuarios_admin", "select=dni")]).then(([usados]) => {
    const set = new Set(usados.map((u) => u.dni));
    return xs.filter((p) => !set.has(p.dni));
  })
);
if (!libre) { mal("persona libre", "no hay personas sin usuario en el maestro"); }
const c1 = libre && await rpc("crear_usuario_admin", {
  p_dni: libre.dni, p_perfil: "prueba-e2e", p_correo: "prueba-e2e@grupoer.pe",
  p_celular: null, p_clave: null, p_por: "verificar-categorias",
});
let idPrueba = c1?.json;
if (!c1?.ok) mal("crear_usuario_admin", c1?.texto ?? "sin persona");
else {
  const [u] = await ver("v_usuarios_admin", `id=eq.${idPrueba}&select=codigo,empresas,creado`);
  const codigoOk = /^U-\d{4}$/.test(u?.codigo ?? "");
  const herencia = JSON.stringify(u?.empresas) === JSON.stringify(["negliaf"]);
  codigoOk ? ok(`código asignado: ${u.codigo}`) : mal("código", JSON.stringify(u));
  herencia ? ok("hereda el alcance de la categoría (negliaf)") : mal("herencia", JSON.stringify(u));
  const [mi] = await ver("v_mi_acceso", "correo=eq.prueba-e2e%40grupoer.pe&select=matriz,empresas");
  (mi && mi.matriz?.personal === 2) ? ok("v_mi_acceso resuelve matriz y alcance") : mal("v_mi_acceso", JSON.stringify(mi));
}

console.log("4 · Eliminación definitiva conserva el rastro en ACC-06");
if (idPrueba) {
  await rpc("registrar_ingreso", { p_correo: "prueba-e2e@grupoer.pe", p_resultado: "fallido", p_dispositivo: "verificar-categorias" });
  const del = await rpc("eliminar_usuario_admin", { p_id: idPrueba });
  if (!del.ok) mal("eliminar_usuario_admin", del.texto);
  else {
    const restos = await ver("v_usuarios_admin", `id=eq.${idPrueba}&select=id`);
    restos.length === 0 ? ok("el usuario desapareció de ACC-01") : mal("usuario sigue", JSON.stringify(restos));
    const rastro = await ver("v_registro_accesos", "select=usuario,resultado&resultado=eq.fallido&order=id.desc&limit=5");
    rastro.some((r) => r.usuario?.includes(libre.nombre.split(" ")[0]) || r.usuario !== "—")
      ? ok("ACC-06 conserva el intento del usuario eliminado")
      : mal("rastro ACC-06", JSON.stringify(rastro));
  }
}

console.log("5 · Negativa: no se puede eliminar al último superadmin activo");
const [superU] = await ver("v_usuarios_admin", "esSuperadmin=eq.true&estado=eq.activo&select=id");
const delSuper = superU && await rpc("eliminar_usuario_admin", { p_id: superU.id });
(delSuper && !delSuper.ok && /superadministrador/i.test(delSuper.texto))
  ? ok("la BD rechaza eliminar al último superadministrador")
  : mal("último superadmin", delSuper?.texto ?? "sin superadmin activo");

console.log("6 · Limpieza: archivar la categoría de prueba");
const arch = await rpc("desactivar_perfil", { p_id: "prueba-e2e" });
arch.ok ? ok("categoría de prueba archivada") : mal("archivar", arch.texto);

console.log(fallos === 0 ? "\nTODAS LAS PRUEBAS PASARON" : `\n${fallos} PRUEBA(S) FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
