// scripts/verificar-eliminar-perfil.mjs — pruebas del RPC eliminar_perfil
// contra la BD viva (Management API). Crea una categoría de prueba, verifica
// las negativas (superadmin, con usuarios) y la eliminación completa; al
// final limpia también el perfil basura histórico "prueba-e2e".
// Uso: & scripts/token-supabase.ps1 | Out-Null; node scripts/verificar-eliminar-perfil.mjs
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
const ID = "zz-prueba-eliminar";

// Limpieza previa por si una corrida anterior quedó a medias.
await sql(`delete from usuarios_admin where perfil_id = '${ID}'`);
await sql(`select eliminar_perfil('${ID}')`).catch(() => {});

await prueba("preparación: categoría de prueba con matriz y alcance", async () => {
  await sql(`select guardar_perfil('${ID}', 'ZZ Prueba eliminar', 'temporal', false,
    false, false, false, '{"personal":1}'::jsonb, array['promant'], 'verificar-eliminar-perfil')`);
  const [n] = await sql(`select count(*)::int n from perfiles where id = '${ID}'`);
  igual(n.n, 1, "perfil creado");
});

await prueba("negativa: la categoría de superadministrador no se elimina", async () => {
  let error = null;
  try { await sql("select eliminar_perfil('superadmin')"); } catch (e) { error = e.message; }
  igual(error !== null && error.includes("superadministrador"), true, `error (${error})`);
  const [n] = await sql("select count(*)::int n from perfiles where id = 'superadmin'");
  igual(n.n >= 1, true, "superadmin intacto");
});

await prueba("negativa: con usuarios asignados no se elimina", async () => {
  // Usuario sintético colgado de la categoría de prueba (persona real del
  // maestro que NO es usuario admin; se retira al final de la prueba).
  const [p] = await sql(
    "select dni from personas where dni not in (select persona_dni from usuarios_admin) limit 1"
  );
  await sql(`insert into usuarios_admin (persona_dni, perfil_id, perfil_version, creado_por)
    select '${p.dni}', '${ID}', max(version), 'verificar-eliminar-perfil' from perfiles where id = '${ID}'`);
  let error = null;
  try { await sql(`select eliminar_perfil('${ID}')`); } catch (e) { error = e.message; }
  igual(error !== null && error.includes("usuarios asignados"), true, `error (${error})`);
  const [n] = await sql(`select count(*)::int n from perfiles where id = '${ID}'`);
  igual(n.n >= 1, true, "perfil intacto");
  await sql(`delete from usuarios_admin where perfil_id = '${ID}'`);
});

await prueba("negativa: una categoría inexistente da error claro", async () => {
  let error = null;
  try { await sql("select eliminar_perfil('no-existe-jamas')"); } catch (e) { error = e.message; }
  igual(error !== null && error.includes("no existe"), true, `error (${error})`);
});

await prueba("eliminación completa: perfil, matriz y alcance desaparecen; queda auditoría", async () => {
  await sql(`select eliminar_perfil('${ID}')`);
  const [a] = await sql(`select count(*)::int n from perfiles where id = '${ID}'`);
  const [b] = await sql(`select count(*)::int n from perfil_permisos where perfil_id = '${ID}'`);
  const [c] = await sql(`select count(*)::int n from perfil_empresas where perfil_id = '${ID}'`);
  igual(a.n + b.n + c.n, 0, "sin restos");
  const [au] = await sql(
    `select count(*)::int n from auditoria where accion = 'ELIMINAR_PERFIL' and datos_antes->>'id' = '${ID}'`
  );
  igual(au.n >= 1, true, "auditoría");
});

await prueba("limpieza real: el perfil basura histórico prueba-e2e se elimina", async () => {
  const [antes] = await sql("select count(*)::int n from perfiles where id = 'prueba-e2e'");
  if (antes.n > 0) await sql("select eliminar_perfil('prueba-e2e')");
  const [despues] = await sql("select count(*)::int n from perfiles where id = 'prueba-e2e'");
  igual(despues.n, 0, "prueba-e2e fuera");
});

console.log(fallos ? `\n${fallos} PRUEBAS FALLARON` : "\nTODAS LAS PRUEBAS PASARON");
process.exit(fallos ? 1 : 0);
