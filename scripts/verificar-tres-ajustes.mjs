// scripts/verificar-tres-ajustes.mjs — pruebas E2E de BD de los tres ajustes.
// Uso: & scripts/token-supabase.ps1 | Out-Null; node scripts/verificar-tres-ajustes.mjs
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

await prueba("L. Americana tiene el RUC real", async () => {
  const [e] = await sql("select ruc from empresas where id='lamericana'");
  igual(e.ruc, "20601705185", "ruc");
});
await prueba("BREMCO está retirada", async () => {
  const [e] = await sql("select estado from empresas where id='bremco'");
  igual(e.estado, "retirada", "estado");
});
await prueba("no se puede crear un vínculo en BREMCO", async () => {
  let fallo = false;
  try {
    await sql("insert into vinculos (persona_dni, empresa_id, sede_id, cargo, fecha_inicio) values ('45231876','bremco','essalud','Operario de limpieza','2026-01-01')");
  } catch { fallo = true; }
  igual(fallo, true, "el insert debió fallar");
});
await prueba("los históricos de BREMCO siguen consultables", async () => {
  const [r] = await sql("select count(*)::int n from vinculos where empresa_id='bremco'");
  igual(r.n >= 2, true, "vínculos históricos");
});
await prueba("catálogo de cargos existe", async () => {
  const [r] = await sql("select count(*)::int n from cargos");
  igual(r.n >= 8, true, "cargos seed");
});
await prueba("cargos tiene RLS habilitado", async () => {
  const [r] = await sql("select relrowsecurity from pg_class where relname='cargos'");
  igual(r.relrowsecurity, true, "relrowsecurity");
});
await prueba("el sistema muestra cuatro razones sociales activas", async () => {
  const [r] = await sql("select count(*)::int n from empresas where estado='activa'");
  igual(r.n, 4, "empresas activas");
});
// --- Task 7: RPCs previsualizar_importacion / importar_planilla -----------
// DNIs claramente sintéticos (099999xx) para no chocar con datos reales; se
// limpian SIEMPRE al final, incluso si alguna prueba falla en el camino.
const EMPRESA_TEST = "lamericana";
const DNI1 = "09999921";
const DNI2 = "09999922";
const SEDE_TEST = "SEDE VERIFICACION E2E";
const filasPrueba = JSON.stringify([
  { codigo: "V01", nombres: "VERIFICACION UNO", dni: DNI1, sexo: "M", sede: SEDE_TEST,
    cargo: "Operario de limpieza", centroCosto: "CC VERIFICACION", ingreso: "2026-01-01",
    cese: null, situacion: "ACTIVO", nombreTruncado: false },
  { codigo: "V02", nombres: "VERIFICACION DOS NOMBRE BASTANTE LARGO PARA TRUNCAR", dni: DNI2, sexo: "F",
    sede: SEDE_TEST, cargo: "Supervisor de sede", centroCosto: "CC VERIFICACION", ingreso: "2026-02-01",
    cese: null, situacion: "ACTIVO", nombreTruncado: true },
]).replace(/'/g, "''");

async function limpiarDatosPrueba() {
  await sql(`delete from vinculos where persona_dni in ('${DNI1}','${DNI2}')`);
  await sql(`delete from personas where dni in ('${DNI1}','${DNI2}')`);
  await sql(`delete from sedes where empresa_id = '${EMPRESA_TEST}' and nombre = '${SEDE_TEST}'`);
}

await limpiarDatosPrueba(); // por si quedó basura de una corrida anterior fallida

try {
  await prueba("importar_planilla: alta conserva el DNI con cero a la izquierda", async () => {
    const [fila] = await sql(`select importar_planilla('${EMPRESA_TEST}', '${filasPrueba}'::jsonb, 'verificacion') as r`);
    const { altas } = fila.r;
    igual(altas.includes(DNI1) && altas.includes(DNI2), true, "altas debe incluir ambos DNI");
    const [p] = await sql(`select dni from personas where dni = '${DNI1}'`);
    igual(p.dni, DNI1, "el DNI debe conservar el cero inicial");
  });

  await prueba("importar_planilla: reimportar la misma fila da sin_cambio (idempotente)", async () => {
    const [fila] = await sql(`select importar_planilla('${EMPRESA_TEST}', '${filasPrueba}'::jsonb, 'verificacion') as r`);
    const { altas, sin_cambio } = fila.r;
    igual(altas.length, 0, "no debe haber altas nuevas al reimportar");
    igual([...sin_cambio].sort().join(","), [DNI1, DNI2].sort().join(","), "ambos DNI deben quedar sin_cambio");
  });

  await prueba("previsualizar_importacion no deja rastro", async () => {
    const [antes] = await sql(`select count(*)::int n from personas where dni in ('${DNI1}','${DNI2}')`);
    const [fila] = await sql(`select previsualizar_importacion('${EMPRESA_TEST}', '${filasPrueba}'::jsonb) as r`);
    igual([...fila.r.sin_cambio].sort().join(","), [DNI1, DNI2].sort().join(","), "la vista previa debe clasificar sin_cambio");
    const [despues] = await sql(`select count(*)::int n from personas where dni in ('${DNI1}','${DNI2}')`);
    igual(despues.n, antes.n, "previsualizar_importacion no debe alterar el conteo de personas");
  });

  await prueba("fila sin fecha de cese no cesa a nadie", async () => {
    const [antes] = await sql(`select count(*)::int n from vinculos where persona_dni in ('${DNI1}','${DNI2}') and fecha_fin is null`);
    await sql(`select importar_planilla('${EMPRESA_TEST}', '${filasPrueba}'::jsonb, 'verificacion') as r`);
    const [despues] = await sql(`select count(*)::int n from vinculos where persona_dni in ('${DNI1}','${DNI2}') and fecha_fin is null`);
    igual(despues.n, antes.n, "los vínculos vigentes no deben cesar por ausencia de fecha de cese");
    igual(despues.n, 2, "ambos vínculos de prueba deben seguir vigentes");
  });
} finally {
  await limpiarDatosPrueba();
}

await prueba("limpieza de datos de prueba de importación queda completa", async () => {
  const [r] = await sql(`select count(*)::int n from personas where dni in ('${DNI1}','${DNI2}')`);
  igual(r.n, 0, "no deben quedar personas de prueba");
});

console.log(fallos ? `\n${fallos} PRUEBAS FALLARON` : "\nTODAS LAS PRUEBAS PASARON");
process.exit(fallos ? 1 : 0);
