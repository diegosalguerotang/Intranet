// scripts/verificar-importacion-activos.mjs — pruebas E2E de BD de la
// importación de inventario de activos (ADQ-08, Fase 2): migración aplicada y
// comportamiento de importar_activos / previsualizar_importacion_activos.
// Datos sintéticos SIEMPRE con prefijo ZZPRUEBA- (jamás toca activos reales);
// limpieza acotada a ese prefijo al inicio y al final.
// Uso: & scripts/token-supabase.ps1 | Out-Null; node scripts/verificar-importacion-activos.mjs
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
const act = (codigo, extra = {}) => JSON.stringify({
  codigo, tipo: "LAPTOP", marca: "LENOVO", modelo: "20392", serie: "ZZSER0001",
  usuario: "PRUEBA PRUEBA", usuarioAnterior: "", area: "RRHH", observaciones: "", ...extra,
}).replace(/'/g, "''");
const importar = (empresa, activos, por = "verificacion") =>
  sql(`select importar_activos('${empresa}', '[${activos}]'::jsonb, 'RAZON DE PRUEBA', 'prueba.xlsx', '${por}') as r`);
const limpiar = () => sql("delete from activos where codigo like 'ZZPRUEBA-%'");

await limpiar();

await prueba("migración: columnas nuevas presentes en activos", async () => {
  const cols = (await sql(
    "select column_name from information_schema.columns where table_schema='public' and table_name='activos'"
  )).map((c) => c.column_name);
  for (const c of ["tipo", "area", "asignado_sin_confirmar", "usuario_anterior", "observaciones"]) {
    igual(cols.includes(c), true, c);
  }
});

await prueba("migración: marca/modelo/serie opcionales y sin unicidad categoria+serie", async () => {
  const cols = await sql(
    "select column_name, is_nullable from information_schema.columns where table_schema='public' and table_name='activos' and column_name in ('marca','modelo','serie')"
  );
  igual(cols.every((c) => c.is_nullable === "YES"), true, "nullables");
  const [k] = await sql(
    "select count(*)::int n from pg_constraint where conname = 'activos_categoria_serie_key'"
  );
  igual(k.n, 0, "constraint fuera");
});

await prueba("v_activos expone tipo, área y asignado sin confirmar", async () => {
  const cols = (await sql(
    "select column_name from information_schema.columns where table_schema='public' and table_name='v_activos'"
  )).map((c) => c.column_name);
  for (const c of ["tipo", "area", "asignado_sin_confirmar"]) igual(cols.includes(c), true, c);
});

await prueba("duplicado dentro del archivo: bloquea TODO y nombra el código", async () => {
  let error = null;
  try { await importar("promant", `${act("ZZPRUEBA-A")},${act("ZZPRUEBA-A")}`); }
  catch (e) { error = e.message; }
  igual(error !== null, true, "debió fallar");
  igual(error.includes("ZZPRUEBA-A"), true, `nombra el código (${error})`);
  const [n] = await sql("select count(*)::int n from activos where codigo like 'ZZPRUEBA-%'");
  igual(n.n, 0, "no importó ningún activo");
});

await prueba("altas: dos códigos nuevos entran completos", async () => {
  const [{ r }] = await importar("promant", `${act("ZZPRUEBA-A")},${act("ZZPRUEBA-B", { marca: "HP", serie: "" })}`);
  igual(r.altas.length, 2, "altas");
  const [a] = await sql("select marca, serie, tipo, area, asignado_sin_confirmar from activos where codigo='ZZPRUEBA-B'");
  igual(a.marca, "HP", "marca");
  igual(a.serie, null, "serie vacía → null");
  igual(a.area, "RRHH", "area");
  igual(a.asignado_sin_confirmar, "PRUEBA PRUEBA", "usuario como texto sin confirmar");
});

await prueba("reimportar idéntico: todo sin_cambio, nada se duplica", async () => {
  const [{ r }] = await importar("promant", `${act("ZZPRUEBA-A")},${act("ZZPRUEBA-B", { marca: "HP", serie: "" })}`);
  igual(r.sin_cambio.length, 2, "sin_cambio");
  igual(r.altas.length, 0, "altas");
  const [n] = await sql("select count(*)::int n from activos where codigo like 'ZZPRUEBA-%'");
  igual(n.n, 2, "sin duplicados");
});

await prueba("una celda vacía no borra un valor ya registrado", async () => {
  const [{ r }] = await importar("promant", act("ZZPRUEBA-A", { marca: "" }));
  igual(r.sin_cambio.length, 1, "sin_cambio (el vacío no cuenta como cambio)");
  const [a] = await sql("select marca from activos where codigo='ZZPRUEBA-A'");
  igual(a.marca, "LENOVO", "marca intacta");
});

await prueba("un prefijo más corto no degrada el valor guardado", async () => {
  await importar("promant", act("ZZPRUEBA-A", { usuario: "PRUEBA" }));
  const [a] = await sql("select asignado_sin_confirmar from activos where codigo='ZZPRUEBA-A'");
  igual(a.asignado_sin_confirmar, "PRUEBA PRUEBA", "no degradado");
});

await prueba("actualización real: diff campo por campo con antes y después", async () => {
  const [{ r }] = await importar("promant", act("ZZPRUEBA-A", { modelo: "20999" }));
  igual(r.actualizaciones.length, 1, "actualizaciones");
  const cambio = r.actualizaciones[0];
  igual(cambio.codigo, "ZZPRUEBA-A", "codigo");
  igual(cambio.cambios.modelo.antes, "20392", "antes");
  igual(cambio.cambios.modelo.despues, "20999", "despues");
});

await prueba("código registrado en OTRA empresa: bloquea la importación completa", async () => {
  await sql("insert into activos (codigo, categoria, empresa_id) values ('ZZPRUEBA-OTRA', 'Cómputo', 'negliaf') on conflict do nothing");
  let error = null;
  try { await importar("promant", `${act("ZZPRUEBA-C")},${act("ZZPRUEBA-OTRA")}`); }
  catch (e) { error = e.message; }
  igual(error !== null, true, "debió fallar");
  igual(error.includes("ZZPRUEBA-OTRA") && error.includes("negliaf"), true, `nombra código y empresa (${error})`);
  const [n] = await sql("select count(*)::int n from activos where codigo='ZZPRUEBA-C'");
  igual(n.n, 0, "el alta del mismo lote también se revirtió (todo-o-nada)");
});

await prueba("un activo ausente del archivo no se da de baja ni se toca", async () => {
  const [antes] = await sql("select to_jsonb(ac) j from activos ac where codigo='ZZPRUEBA-B'");
  await importar("promant", act("ZZPRUEBA-A", { modelo: "21000" }));
  const [despues] = await sql("select to_jsonb(ac) j from activos ac where codigo='ZZPRUEBA-B'");
  igual(JSON.stringify(antes.j), JSON.stringify(despues.j), "ZZPRUEBA-B intacto");
});

await prueba("la vista previa clasifica igual y no deja rastro", async () => {
  const [{ r }] = await sql(
    `select previsualizar_importacion_activos('promant', '[${act("ZZPRUEBA-NUEVO")}]'::jsonb, 'RAZON DE PRUEBA', 'prueba.xlsx') as r`
  );
  igual(r.altas.length, 1, "clasifica el alta");
  const [n] = await sql("select count(*)::int n from activos where codigo='ZZPRUEBA-NUEVO'");
  igual(n.n, 0, "sin rastro");
});

await prueba("empresa retirada: importación rechazada completa", async () => {
  let error = null;
  try { await importar("bremco", act("ZZPRUEBA-D")); }
  catch (e) { error = e.message; }
  igual(error !== null && error.includes("no está activa"), true, `rechazo (${error})`);
});

await prueba("auditoría: queda la razón social confirmada, el archivo y quién", async () => {
  const [a] = await sql(
    "select datos_despues d from auditoria where accion='IMPORTAR_ACTIVOS' order by id desc limit 1"
  );
  igual(a.d.razon_social_confirmada, "RAZON DE PRUEBA", "razón social");
  igual(a.d.archivo, "prueba.xlsx", "archivo");
  igual(a.d.por, "verificacion", "quién");
});

// --- Canal real (--proxy): el MISMO camino que usa la pantalla ADQ-08 -------
// /api/supa con JWT admin en x-sesion, contra producción. Requiere
// SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD_INICIAL.
if (process.argv.includes("--proxy")) {
  const APP = "https://intranet-general.vercel.app";
  const { SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD_INICIAL } = process.env;
  if (!SUPERADMIN_EMAIL || !SUPERADMIN_PASSWORD_INICIAL) {
    console.log("(sin SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD_INICIAL — se salta el canal real)");
  } else {
    const login = await fetch(`${APP}/api/supa/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD_INICIAL }),
    });
    const sesion = await login.json();
    if (!sesion.access_token) {
      fallos++; console.error(`✗ proxy: login admin — HTTP ${login.status}`);
    } else {
      const rpcProxy = (nombre, args) => fetch(`${APP}/api/supa/rest/v1/rpc/${nombre}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-sesion": sesion.access_token },
        body: JSON.stringify(args),
      });
      await prueba("proxy: previsualizar_importacion_activos clasifica por el canal del navegador", async () => {
        const r = await rpcProxy("previsualizar_importacion_activos", {
          p_empresa: "promant",
          p_activos: [{ codigo: "ZZPRUEBA-PROXY", tipo: "LAPTOP", marca: "LENOVO", modelo: "20392",
            serie: "", usuario: "PRUEBA", usuarioAnterior: "", area: "RRHH", observaciones: "" }],
          p_razon_social: "RAZON DE PRUEBA", p_archivo: "prueba.xlsx",
        });
        igual(r.status, 200, `status (${await r.clone().text()})`);
        const cuerpo = await r.json();
        igual(cuerpo.altas.length, 1, "clasifica el alta");
        const [n] = await sql("select count(*)::int n from activos where codigo='ZZPRUEBA-PROXY'");
        igual(n.n, 0, "sin rastro");
      });
      await prueba("proxy: el bloqueo por duplicado viaja como error legible", async () => {
        const dup = { codigo: "ZZPRUEBA-DUP", tipo: "PC", marca: "", modelo: "", serie: "",
          usuario: "", usuarioAnterior: "", area: "", observaciones: "" };
        const r = await rpcProxy("importar_activos", {
          p_empresa: "promant", p_activos: [dup, dup],
          p_razon_social: "RAZON DE PRUEBA", p_archivo: "prueba.xlsx", p_por: "verificacion",
        });
        igual(r.status >= 400, true, `status ${r.status}`);
        const cuerpo = await r.json();
        igual((cuerpo.message ?? "").includes("ZZPRUEBA-DUP"), true, `mensaje (${JSON.stringify(cuerpo)})`);
      });
    }
  }
}

await limpiar();
console.log(fallos ? `\n${fallos} PRUEBAS FALLARON` : "\nTODAS LAS PRUEBAS PASARON");
process.exit(fallos ? 1 : 0);
