// scripts/verificar-disciplinario.mjs — pruebas del módulo disciplinario
// parametrizado por RIT (Fases 1-2) contra la BD viva. Los memorándums de
// prueba usan un DNI real del maestro y se eliminan al final (los de prueba
// llevan motivo ZZPRUEBA).
// Uso: & scripts/token-supabase.ps1 | Out-Null; node scripts/verificar-disciplinario.mjs
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
const limpiar = () => sql("delete from memorandums where motivo like 'ZZPRUEBA%'");

await limpiar();

await prueba("catálogo: 19 prohibiciones del art. 20 y 31 causales del art. 56, texto literal", async () => {
  const [a20] = await sql("select count(*)::int n from rit_faltas where rit_id='clean-2025' and articulo=20");
  const [a56] = await sql("select count(*)::int n from rit_faltas where rit_id='clean-2025' and articulo=56");
  igual(a20.n, 19, "art. 20");
  igual(a56.n, 31, "art. 56");
  const [c] = await sql("select texto from rit_faltas where rit_id='clean-2025' and articulo=20 and item='c'");
  igual(c.texto.includes("Deje su puesto sin la debida autorización"), true, "texto literal 20 c");
});

await prueba("todas las empresas apuntan al RIT de CLEAN (decisión 4)", async () => {
  const [n] = await sql("select count(*)::int n from empresas where rit_id is distinct from 'clean-2025'");
  igual(n.n, 0, "empresas sin RIT");
});

await prueba("tipos: 6 procesos, la verbal no notificable, preavisos en días naturales", async () => {
  const tipos = await sql("select id, notificable, plazo_habil, plazo_descargo_dias from tipos_sancion where rit_id='clean-2025'");
  igual(tipos.length, 6, "tipos");
  const verbal = tipos.find((t) => t.id === "amonestacion-verbal");
  igual(verbal.notificable, false, "verbal es registro interno");
  const pc = tipos.find((t) => t.id === "preaviso-conducta");
  igual(pc.plazo_habil, false, "preaviso en naturales");
  igual(pc.plazo_descargo_dias, 6, "≥6 naturales (art. 31 LPCL)");
});

await prueba("motor de plazos: el sábado ES hábil; domingos y feriados no", async () => {
  // Viernes 2026-08-14 + 3 hábiles = sáb 15, lun 17, mar 18 (domingo 16 salta).
  const [a] = await sql("select fn_sumar_dias('2026-08-14', 3, true) as f");
  igual(a.f, "2026-08-18", "sábado cuenta");
  // Jueves 2026-04-01 + 3 hábiles: 2 y 3 abril son feriados (Semana Santa),
  // dom 5 salta → sáb 4, lun 6, mar 7.
  const [b] = await sql("select fn_sumar_dias('2026-04-01', 3, true) as f");
  igual(b.f, "2026-04-07", "feriados saltan");
  // Naturales: corren de corrido.
  const [c] = await sql("select fn_sumar_dias('2026-08-14', 6, false) as f");
  igual(c.f, "2026-08-20", "naturales");
});

await prueba("emisión: congela texto literal, antecedentes y reincidencia", async () => {
  const [p] = await sql("select persona_dni dni from vinculos where fecha_fin is null limit 1");
  const [f] = await sql("select id from rit_faltas where rit_id='clean-2025' and articulo=20 and item='c'");
  const [{ id: id1 }] = await sql(
    `select emitir_memorandum('${p.dni}', 'amonestacion-escrita', ${f.id}, 'ZZPRUEBA primera') as id`);
  const [m1] = await sql(`select falta_texto, reincidencia, estado from memorandums where id='${id1}'`);
  igual(m1.falta_texto.includes("concordado con el Art. 56 numeral 1"), true, "concordancia 20→56.1");
  igual(m1.estado, "emitido_sin_notificar", "estado");
  const [{ id: id2 }] = await sql(
    `select emitir_memorandum('${p.dni}', 'amonestacion-escrita', ${f.id}, 'ZZPRUEBA segunda') as id`);
  const [m2] = await sql(`select reincidencia, jsonb_array_length(antecedentes)::int n from memorandums where id='${id2}'`);
  igual(m2.reincidencia, true, "reincidencia (art. 58)");
  igual(m2.n >= 1, true, "antecedentes congelados (art. 54)");
});

await prueba("suspensión: tope duro de 3 días laborables (art. 53 c)", async () => {
  const [p] = await sql("select persona_dni dni from vinculos where fecha_fin is null limit 1");
  const [f] = await sql("select id from rit_faltas where rit_id='clean-2025' and articulo=56 and item='2'");
  let error = null;
  try {
    await sql(`select emitir_memorandum('${p.dni}', 'suspension', ${f.id}, 'ZZPRUEBA suspensión larga', 4)`);
  } catch (e) { error = e.message; }
  igual(error !== null && error.includes("1 a 3"), true, `tope (${error})`);
  const [{ id }] = await sql(
    `select emitir_memorandum('${p.dni}', 'suspension', ${f.id}, 'ZZPRUEBA suspensión ok', 2) as id`);
  const [m] = await sql(`select suspension_dias from memorandums where id='${id}'`);
  igual(m.suspension_dias, 2, "días guardados");
});

await prueba("amonestación verbal: registro interno, sin notificación", async () => {
  const [p] = await sql("select persona_dni dni from vinculos where fecha_fin is null limit 1");
  const [{ id }] = await sql(
    `select emitir_memorandum('${p.dni}', 'amonestacion-verbal', null, 'ZZPRUEBA verbal') as id`);
  const [m] = await sql(`select estado from memorandums where id='${id}'`);
  igual(m.estado, "registro_interno", "estado");
  let error = null;
  try { await sql(`select notificar_memorandum('${id}')`); } catch (e) { error = e.message; }
  igual(error !== null && error.includes("registro interno"), true, `no se notifica (${error})`);
});

await prueba("notificable sin falta invocada se rechaza", async () => {
  const [p] = await sql("select persona_dni dni from vinculos where fecha_fin is null limit 1");
  let error = null;
  try {
    await sql(`select emitir_memorandum('${p.dni}', 'amonestacion-escrita', null, 'ZZPRUEBA sin falta')`);
  } catch (e) { error = e.message; }
  igual(error !== null && error.includes("exige invocar la falta"), true, `rechazo (${error})`);
});

await prueba("notificar arranca el plazo: vence en días hábiles desde HOY", async () => {
  const [p] = await sql("select persona_dni dni from vinculos where fecha_fin is null limit 1");
  const [f] = await sql("select id from rit_faltas where rit_id='clean-2025' and articulo=56 and item='3'");
  const [{ id }] = await sql(
    `select emitir_memorandum('${p.dni}', 'amonestacion-escrita', ${f.id}, 'ZZPRUEBA notificar') as id`);
  await sql(`select notificar_memorandum('${id}')`);
  const [m] = await sql(
    `select estado, vence = fn_sumar_dias(current_date, 3, true) as bien from memorandums where id='${id}'`);
  igual(m.estado, "en_plazo", "estado");
  igual(m.bien, true, "vence = hoy + 3 hábiles");
  let error = null;
  try { await sql(`select notificar_memorandum('${id}')`); } catch (e) { error = e.message; }
  igual(error !== null && error.includes("ya fue notificado"), true, "no se notifica dos veces");
});

await prueba("expediente demo 0141-2026 corregido a art. 20 c) conc. 56.1", async () => {
  const filas = await sql("select falta_texto from memorandums where id = '0141-2026'");
  if (filas.length === 0) { console.log("  (0141-2026 no existe en esta BD — nada que corregir)"); return; }
  igual(filas[0].falta_texto?.includes("Art. 20 inciso c)"), true, "tipificación");
});

await limpiar();
console.log(fallos ? `\n${fallos} PRUEBAS FALLARON` : "\nTODAS LAS PRUEBAS PASARON");
process.exit(fallos ? 1 : 0);
