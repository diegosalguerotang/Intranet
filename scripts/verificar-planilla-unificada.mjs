// scripts/verificar-planilla-unificada.mjs — pruebas E2E de #10 (Fases 1-4)
// contra la BD viva (Management API, patrón verificar-solicitudes). Las
// llamadas van sin JWT: el RPC las trata como servicio (alcance total). Datos
// ZZ acotados con limpieza al final. Los criterios del PARSER los cubre la
// suite vitest (tests/importar/planilla-unificada.test.js, fixture local).
// Uso: . .\scripts\token-supabase.ps1; node scripts/verificar-planilla-unificada.mjs
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }

let fallos = 0;
const ok = (n) => console.log(`  ✔ ${n}`);
const mal = (n, d) => { fallos++; console.error(`  ✘ ${n} — ${String(d).slice(0, 220)}`); };

async function sql(q) {
  const r = await fetch("https://api.supabase.com/v1/projects/mzpbdkrmokfxrrsotfgs/database/query", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  if (!r.ok) return { error: t };
  try { return JSON.parse(t); } catch { return { crudo: t }; }
}

const A = "99885511";   // alta nueva (no existe)
const B = "09911223";   // persona pre-creada CON cero inicial (el archivo la trae sin cero)
const fila = (extra) => JSON.stringify({
  ruc: "20605159398", denominacion: "NEGOCIOS DE LIMPIEZA Y AFINES S.R.L.",
  documento: A, nombre: "ZZ UNIFICADA PRUEBA UNO", tipoDoc: "DNI",
  bancoCodigo: "bbva", cuenta: "00110999912345678901",
  centroCostoCodigo: "3101", centroCostoDesc: "ADMINISTRACIO",
  contrato: "OFICINA", sede: null, fechaIngreso: null, ...extra,
}).replace(/'/g, "''");
const importar = (filas) => sql(`select importar_planilla_unificada('[${filas}]'::jsonb, '2026-07', 'verificacion') as r`);

// Desde el ciclo Movimientos (2026-08-24) la importación deja filas en la
// tabla insert-only `movimientos`: para limpiar hay que apagar su trigger un
// instante (mismo patrón que verificar-movimientos.mjs).
const limpiar = () => sql(`
  alter table movimientos disable trigger tg_movimientos_inmutables;
  delete from movimientos where persona_dni in ('${A}','${B}');
  alter table movimientos enable trigger tg_movimientos_inmutables;
  delete from vinculos where persona_dni in ('${A}','${B}');
  delete from personas where dni in ('${A}','${B}');
`);

console.log("0 · Preparación (persona con cero inicial + limpieza previa)");
await limpiar();
const prep = await sql(`insert into personas (dni, nombre, portal) values ('${B}', 'ZZ CONCERO', 'sin_celular') returning dni`);
prep?.[0]?.dni === B ? ok(`persona ${B} lista en el maestro`) : mal("preparación", JSON.stringify(prep));

console.log("1 · RUC desconocido → rechazo total");
const r1 = await importar(fila({ ruc: "99999999999", denominacion: "NO EXISTE SAC" }));
(r1.error && /no está en el catálogo.*ninguna fila/s.test(r1.error)) ? ok("rechaza el archivo completo") : mal("ruc desconocido", JSON.stringify(r1));

console.log("2 · Empresa retirada → rechazo total");
const r2 = await importar(fila({ ruc: "20512345678", denominacion: "BREMCO" }));
(r2.error && /retirada/.test(r2.error)) ? ok("BREMCO retirada rechaza todo") : mal("retirada", JSON.stringify(r2));

console.log("3 · Alta nueva: persona + vínculo con sede «Por asignar» y fecha del período");
const r3 = await importar(fila({}));
const res3 = r3?.[0]?.r;
(res3?.empresas?.negliaf?.altas ?? []).includes(A) ? ok("alta contada") : mal("alta", JSON.stringify(r3));
const [pA] = await sql(`select cuenta, cuenta_ultimos4, banco, banco_id,
  fn_descifrar_cuenta(cuenta_cifrada) as descifrada from personas where dni = '${A}'`);
(pA && pA.cuenta === null && pA.cuenta_ultimos4 === "8901" && pA.banco_id === "bbva" &&
 pA.descifrada === "00110999912345678901")
  ? ok("cuenta cifrada en reposo (sin texto plano, últimos 4 y descifrado exactos)")
  : mal("cifrado", JSON.stringify(pA));
const [vA] = await sql(`select sede_id, cargo, contrato, centro_costo,
  to_char(fecha_inicio,'YYYY-MM-DD') as inicio from vinculos
  where persona_dni = '${A}' and empresa_id = 'negliaf' and fecha_fin is null`);
(vA && vA.sede_id === "negliaf-por-asignar" && vA.inicio === "2026-07-01" &&
 vA.contrato === "OFICINA" && vA.centro_costo === "3101 ADMINISTRACIO")
  ? ok("vínculo con sede Por asignar, fecha 2026-07-01, contrato y centro de costo")
  : mal("vínculo", JSON.stringify(vA));

console.log("4 · Resolución sin ceros: '9911223' del archivo casa con el maestro '09911223'");
const r4 = await importar(fila({ documento: "9911223", nombre: "ZZ CONCERO APELLIDO LARGO" }));
const res4 = r4?.[0]?.r?.empresas?.negliaf;
(!((res4?.altas ?? []).length) && (res4?.vinculosNuevos ?? []).includes(B))
  ? ok("no crea duplicado: usa la forma canónica del maestro") : mal("sin ceros", JSON.stringify(r4));
const [pB] = await sql(`select nombre from personas where dni = '${B}'`);
(pB?.nombre === "ZZ CONCERO APELLIDO LARGO") ? ok("el nombre más completo reemplaza al corto") : mal("nombre mejora", JSON.stringify(pB));

console.log("5 · El nombre más corto NO acorta al guardado");
await importar(fila({ documento: "9911223", nombre: "ZZ CONCERO" }));
const [pB2] = await sql(`select nombre from personas where dni = '${B}'`);
(pB2?.nombre === "ZZ CONCERO APELLIDO LARGO") ? ok("prefijo corto no degrada") : mal("prefijo", JSON.stringify(pB2));

console.log("6 · Reimportar no duplica y sale «sin cambio»");
const r6 = await importar(fila({}));
const res6 = r6?.[0]?.r?.empresas?.negliaf;
((res6?.sinCambio ?? []).includes(A) && !(res6?.altas ?? []).length) ? ok("idempotente") : mal("reimport", JSON.stringify(r6));
const [nv] = await sql(`select count(*)::int as n from vinculos where persona_dni = '${A}'`);
(nv?.n === 1) ? ok("un solo vínculo") : mal("vínculos duplicados", JSON.stringify(nv));

console.log("7 · Cambio de cuenta = marcado explícito con banco y últimos 4");
const r7 = await importar(fila({ bancoCodigo: "bcp", cuenta: "19112345670049" }));
const cambio = r7?.[0]?.r?.empresas?.negliaf?.cambiosCuenta?.[0];
(cambio && cambio.documento === A && cambio.antes?.banco === "BBVA" && cambio.antes?.ultimos4 === "8901" &&
 cambio.despues?.banco === "BCP" && cambio.despues?.ultimos4 === "0049")
  ? ok(`cambio explícito: ${cambio.antes.banco} ····${cambio.antes.ultimos4} → ${cambio.despues.banco} ····${cambio.despues.ultimos4}`)
  : mal("cambio cuenta", JSON.stringify(r7));
const [pA7] = await sql(`select fn_descifrar_cuenta(cuenta_cifrada) as d from personas where dni = '${A}'`);
(pA7?.d === "19112345670049") ? ok("la cuenta nueva quedó cifrada") : mal("cuenta nueva", JSON.stringify(pA7));

console.log("8 · SEDE/FECHA vacías no pisan lo registrado");
await sql(`update vinculos set fecha_inicio = '2020-01-15' where persona_dni = '${A}' and empresa_id = 'negliaf'`);
await importar(fila({ bancoCodigo: "bcp", cuenta: "19112345670049" }));
const [v8] = await sql(`select to_char(fecha_inicio,'YYYY-MM-DD') as inicio, sede_id from vinculos
  where persona_dni = '${A}' and empresa_id = 'negliaf' and fecha_fin is null`);
(v8?.inicio === "2020-01-15") ? ok("la fecha registrada se conserva") : mal("fecha pisada", JSON.stringify(v8));

console.log("9 · Nadie se cesa por ausencia (archivo parcial)");
const [otros] = await sql(`select count(*)::int as n from vinculos
  where empresa_id = 'negliaf' and fecha_fin is null and persona_dni not in ('${A}','${B}')`);
(otros?.n > 0) ? ok(`los ${otros.n} vínculos ajenos al archivo siguen vigentes`) : mal("cese por ausencia", JSON.stringify(otros));

console.log("10 · Limpieza");
await limpiar();
const [resto] = await sql(`select count(*)::int as n from personas where dni in ('${A}','${B}')`);
(resto?.n === 0) ? ok("datos ZZ fuera") : mal("limpieza", JSON.stringify(resto));

console.log(fallos === 0 ? "\nTODO EN VERDE" : `\n${fallos} PRUEBAS FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
