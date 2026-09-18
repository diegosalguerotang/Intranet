// scripts/ensayar-fase3b.mjs — Ensayo LOCAL de la FASE 3b (datos bancarios en
// interno.datos_bancarios) sobre el ENTORNO DE PRUEBAS de la fase 2.5 en el
// estado de la fase 3a (seguridad.sql sin el bloque 3b) + datos anonimizados.
// El volcado trae cuentas y CCI en null (regla «nulo»), así que el ensayo
// siembra datos bancarios ficticios en varias personas antes de migrar y
// comprueba que se copian, se cifran, se enmascaran y se revierten.
//
// Uso: node scripts/ensayar-fase3b.mjs
import { readFileSync } from "node:fs";
import { arrancarPgLocal, cargarDatosAnonimizados } from "./pg-local.mjs";
import { FECHA, COLUMNAS_PERSONAS, FUNCIONES_NUEVAS, sinFase3b } from "./fase3b-generar.mjs";

const MIGRACION = readFileSync(`supabase/migraciones/${FECHA}-fase3b-datos-bancarios.sql`, "utf8");
const REVERSION = readFileSync(`supabase/respaldos/${FECHA}-fase3b-reversion.sql`, "utf8");
const SEGURIDAD_3A = sinFase3b(readFileSync("supabase/seguridad.sql", "utf8"));

let fallos = 0, ok = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); await cliente.query("rollback").catch(() => {}); }
};
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const bd = await arrancarPgLocal({ seguridad: false, datos: false });
const { sql, cliente } = bd;
await sql(SEGURIDAD_3A);
await cargarDatosAnonimizados(sql);
await sql("set search_path = public, interno, extensions");
// El canónico bancario.sql NO forma parte de CANONICOS (vive en el espejo), así
// que aquí no hay nada que retirar: el estado es exactamente el de la fase 3a.

const como = async (rol, claims, pasos) => {
  await cliente.query("begin");
  try {
    await cliente.query(`set local role ${rol}`);
    await cliente.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims ?? { role: rol })]);
    let r; for (const [texto, params] of pasos) r = await cliente.query(texto, params);
    return { filas: r.rows, n: r.rowCount };
  } catch (e) { return { codigo: e.code, mensaje: e.message }; }
  finally { await cliente.query("rollback"); }
};
const claims = (u) => ({ role: "authenticated", email: u.correo, sub: u.sub });

// Identidades del volcado.
const [SUPER] = await sql(`select ua.correo, au.id as sub from usuarios_admin ua join auth.users au on lower(au.email) = lower(ua.correo)
  join perfiles p on p.id = ua.perfil_id and p.version = ua.perfil_version where ua.estado = 'activo' and p.es_superadmin order by ua.id limit 1`);
const [ADMIN] = await sql(`select ua.correo, au.id as sub from usuarios_admin ua join auth.users au on lower(au.email) = lower(ua.correo)
  join perfiles p on p.id = ua.perfil_id and p.version = ua.perfil_version where ua.estado = 'activo' and not p.es_superadmin and not p.ver_datos_bancarios order by ua.id limit 1`);
if (!SUPER) throw new Error("el volcado no trae un superadministrador activo con cuenta");
// Personas con vínculo vigente (salen en v_personal) para sembrar datos bancarios.
const PERSONAS = await sql(`select p.dni from personas p where exists (select 1 from vinculos v where v.persona_dni = p.dni and v.fecha_fin is null) order by p.dni limit 5`);
const [{ banco_codigo, banco_nombre }] = await sql(`select codigo as banco_codigo, nombre as banco_nombre from bancos order by codigo limit 1`);
const SEMILLA = PERSONAS.map((p, i) => ({ dni: p.dni, cuenta: `19${i}00${i}1122334${i}`, cci: `00219100${i}0011223344${i}`, banco: banco_nombre, banco_id: banco_codigo }));
// Siembra como lo haría el sistema antes de la 3b: cuenta cifrada + CCI en claro.
for (const s of SEMILLA) await sql(`update personas set banco = $2, banco_id = $3, cuenta_cifrada = fn_cifrar_cuenta($4), cuenta_ultimos4 = right($4, 4), cci = $5 where dni = $1`, [s.dni, s.banco, s.banco_id, s.cuenta, s.cci]);
// Una persona más con la columna «cuenta» en texto plano (el caso que P7 elimina).
const [EXTRA] = await sql(`select p.dni from personas p where p.dni <> all($1) order by p.dni limit 1`, [SEMILLA.map((s) => s.dni)]);
await sql(`update personas set cuenta = '19999999999999' where dni = $1`, [EXTRA.dni]);
const TRABAJADOR = { correo: `${SEMILLA[0].dni}@portal.grupoer.pe`, sub: "11111111-1111-1111-1111-111111111111" };

const foto = async () => {
  const filas = await sql(`
    select 'fn:' || p.oid::regprocedure::text as objeto,
           coalesce(p.proacl::text, '') || '|definer=' || p.prosecdef::text || '|config=' || coalesce(array_to_string(p.proconfig, ';'), '') as valor
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'interno')
    union all
    select 'rel:' || n.nspname || '.' || c.relname || ':' || c.relkind::text, coalesce(c.relacl::text, '') || '|rls=' || c.relrowsecurity::text || '|opts=' || coalesce(array_to_string(c.reloptions, ';'), '')
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'interno') and c.relkind in ('r', 'v', 'S')
    union all
    select 'col:personas.' || column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = 'personas'
    union all
    select 'pol:' || schemaname || '.' || tablename || '.' || policyname, roles::text || '|' || cmd::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
      from pg_policies where schemaname in ('public', 'interno')
    order by 1`);
  const normal = (v) => v.replace(/\{([^}]*)\}/g, (_, s) => "{" + s.split(",").sort().join(",") + "}");
  return new Map(filas.map((f) => [f.objeto, normal(f.valor)]));
};
const compararFotos = (a, b) => {
  const dif = [];
  for (const [k, v] of a) if (!b.has(k)) dif.push(`falta tras revertir: ${k}`); else if (b.get(k) !== v) dif.push(`difiere ${k}: antes=${v} después=${b.get(k)}`);
  for (const k of b.keys()) if (!a.has(k)) dif.push(`sobra tras revertir: ${k}`);
  return dif;
};

try {
  console.log("== 0 · Base: entorno 2.5 en estado de la fase 3a, con datos bancarios sembrados");
  const foto0 = await foto();
  const [{ antes_personal }] = await sql(`select count(*)::int as antes_personal from v_personal`);
  const [{ antes_aud }] = await sql(`select count(*)::int as antes_aud from auditoria`);
  const [{ antes_con_datos }] = await sql(`select count(*)::int as antes_con_datos from personas where cuenta_cifrada is not null or cuenta is not null or cci is not null or banco is not null or banco_id is not null`);
  await prueba("hoy: v_personal expone el CCI en claro y la cuenta enmascarada", async () => {
    const [r] = await sql(`select cci, cuenta from v_personal where dni = $1`, [SEMILLA[0].dni]);
    igual(r.cci, SEMILLA[0].cci, "cci en claro"); igual(r.cuenta, "···· " + SEMILLA[0].cuenta.slice(-4), "cuenta enmascarada");
  });

  console.log("\n== 1 · Aplicar la fase 3b");
  await prueba("la migración se aplica sin errores (verificación embebida incluida)", async () => { await sql(MIGRACION); });
  await prueba("catálogo: personas sin columnas bancarias; datos_bancarios con RLS y lectura_admin; ayudantes cerrados a la API", async () => {
    const [{ n }] = await sql(`select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'personas' and column_name = any($1)`, [COLUMNAS_PERSONAS]);
    igual(n, 0, "columnas");
    const [t] = await sql(`select relrowsecurity as rls, has_table_privilege('anon', 'interno.datos_bancarios', 'select') as an, has_table_privilege('authenticated', 'interno.datos_bancarios', 'select') as au from pg_class where oid = 'interno.datos_bancarios'::regclass`);
    igual(`${t.rls}${t.an}${t.au}`, "truefalsetrue", "tabla");
    for (const f of FUNCIONES_NUEVAS) { const [x] = await sql(`select has_function_privilege('authenticated', $1, 'execute') as a`, [`public.${f}`]); igual(x.a, false, f); }
  });
  await prueba("los datos sembrados se copiaron: cuenta cifrada intacta, CCI cifrado, cuenta en texto plano cifrada al vuelo", async () => {
    igual((await sql(`select count(*)::int as n from datos_bancarios`))[0].n, antes_con_datos, "filas");
    for (const s of SEMILLA) {
      const [r] = await sql(`select fn_descifrar_cuenta(cuenta_cifrada) as cuenta, fn_descifrar_cuenta(cci_cifrado) as cci, cuenta_ultimos4 as u4, cci_ultimos4 as c4, banco, banco_id from datos_bancarios where dni = $1`, [s.dni]);
      igual(r.cuenta, s.cuenta, `${s.dni} cuenta`); igual(r.cci, s.cci, `${s.dni} cci`); igual(r.u4, s.cuenta.slice(-4), "u4"); igual(r.c4, s.cci.slice(-4), "c4"); igual(r.banco, s.banco, "banco"); igual(r.banco_id, s.banco_id, "banco_id");
    }
    const [x] = await sql(`select fn_descifrar_cuenta(cuenta_cifrada) as cuenta from datos_bancarios where dni = $1`, [EXTRA.dni]);
    igual(x.cuenta, "19999999999999", "cuenta en texto plano cifrada");
  });
  await prueba("superadministrador: v_personal muestra las mismas filas, cuenta y CCI ENMASCARADOS", async () => {
    const r = await como("authenticated", claims(SUPER), [[`select count(*)::int as n from v_personal`]]);
    if (r.codigo) throw new Error(`${r.codigo} ${r.mensaje}`); igual(r.filas[0].n, antes_personal, "filas");
    const f = await como("authenticated", claims(SUPER), [[`select cci, cuenta, banco from v_personal where dni = $1`, [SEMILLA[0].dni]]]);
    igual(f.filas[0].cci, "···· " + SEMILLA[0].cci.slice(-4), "cci"); igual(f.filas[0].cuenta, "···· " + SEMILLA[0].cuenta.slice(-4), "cuenta"); igual(f.filas[0].banco, SEMILLA[0].banco, "banco");
  });
  await prueba("superadministrador: fn_ver_cuenta_bancaria devuelve cuenta y CCI completos y deja auditoría", async () => {
    const r = await como("authenticated", claims(SUPER), [[`select fn_ver_cuenta_bancaria($1) as j`, [SEMILLA[1].dni]], [`select count(*)::int as n from auditoria where accion = 'VER_CUENTA_BANCARIA'`]]);
    if (r.codigo) throw new Error(`${r.codigo} ${r.mensaje}`);
    const j = await como("authenticated", claims(SUPER), [[`select fn_ver_cuenta_bancaria($1) as j`, [SEMILLA[1].dni]]]);
    igual(j.filas[0].j.cuenta, SEMILLA[1].cuenta, "cuenta"); igual(j.filas[0].j.cci, SEMILLA[1].cci, "cci");
    if (r.filas[0].n < 1) throw new Error("sin auditoría de la consulta");
  });
  if (ADMIN) await prueba("administrador sin casilla «ver datos bancarios»: fn_ver_cuenta_bancaria devuelve null (y audita)", async () => {
    const r = await como("authenticated", claims(ADMIN), [[`select fn_ver_cuenta_bancaria($1) as j`, [SEMILLA[1].dni]]]);
    if (r.codigo) throw new Error(`${r.codigo} ${r.mensaje}`); igual(r.filas[0].j, null, "sin permiso");
  }); else console.log("  (el volcado no trae un administrador sin la casilla: se salta)");
  await prueba("trabajador: v_personal 0 filas; interno.datos_bancarios 0 filas; su v_portal_datos trae banco y cuenta enmascarada", async () => {
    for (const rel of ["v_personal", "interno.datos_bancarios"]) { const r = await como("authenticated", claims(TRABAJADOR), [[`select count(*)::int as n from ${rel}`]]); if (r.codigo) throw new Error(`${rel}: ${r.codigo} ${r.mensaje}`); igual(r.filas[0].n, 0, rel); }
    const p = await como("authenticated", claims(TRABAJADOR), [[`select banco, "cuentaEnmascarada" as c from v_portal_datos`]]);
    if (p.codigo) throw new Error(`${p.codigo} ${p.mensaje}`); igual(p.filas.length, 1, "fila propia"); igual(p.filas[0].c, "···· " + SEMILLA[0].cuenta.slice(-4), "cuenta"); igual(p.filas[0].banco, SEMILLA[0].banco, "banco");
  });
  await prueba("editar_trabajador: vacío conserva, '-' borra, texto reemplaza (cuenta y CCI); auditoría sin valores", async () => {
    const s = SEMILLA[2];
    const [p] = await sql(`select nombre, celular, correo from personas where dni = $1`, [s.dni]);
    const args = (cuenta, cci) => [`select editar_trabajador($1, $2, $3, $4, $5, $6, $7, null)`, [s.dni, p.nombre, p.celular, p.correo, s.banco, cuenta, cci]];
    const r1 = await como("authenticated", claims(SUPER), [args("", ""), [`reset role`], [`select fn_descifrar_cuenta(cuenta_cifrada) as cuenta, fn_descifrar_cuenta(cci_cifrado) as cci from datos_bancarios where dni = $1`, [s.dni]]]);
    if (r1.codigo) throw new Error(`vacío: ${r1.codigo} ${r1.mensaje}`); igual(r1.filas[0].cuenta, s.cuenta, "vacío conserva cuenta"); igual(r1.filas[0].cci, s.cci, "vacío conserva cci");
    const r2 = await como("authenticated", claims(SUPER), [args("-", "-"), [`reset role`], [`select cuenta_cifrada, cci_cifrado, cuenta_ultimos4 from datos_bancarios where dni = $1`, [s.dni]]]);
    if (r2.codigo) throw new Error(`borrar: ${r2.codigo} ${r2.mensaje}`); igual(r2.filas[0].cuenta_cifrada, null, "'-' borra cuenta"); igual(r2.filas[0].cci_cifrado, null, "'-' borra cci");
    const r3 = await como("authenticated", claims(SUPER), [args("555-1234", "00255500001234"), [`reset role`], [`select fn_descifrar_cuenta(cuenta_cifrada) as cuenta, fn_descifrar_cuenta(cci_cifrado) as cci, cuenta_ultimos4 as u4 from datos_bancarios where dni = $1`, [s.dni]],
    ]);
    if (r3.codigo) throw new Error(`reemplazar: ${r3.codigo} ${r3.mensaje}`); igual(r3.filas[0].cuenta, "555-1234", "reemplaza cuenta"); igual(r3.filas[0].cci, "00255500001234", "reemplaza cci"); igual(r3.filas[0].u4, "1234", "u4");
    const a = await como("authenticated", claims(SUPER), [args("555-1234", "00255500001234"), [`reset role`], [`select datos_despues::text as d from auditoria where accion = 'CAMBIO_DATOS_BANCARIOS' order by id desc limit 1`]]);
    if (a.codigo) throw new Error(`auditoría: ${a.codigo} ${a.mensaje}`);
    if (/555-1234|00255500001234/.test(a.filas[0].d)) throw new Error(`la auditoría lleva el valor en claro: ${a.filas[0].d}`);
    if (!/"ultimos4": ?"1234"/.test(a.filas[0].d)) throw new Error(`auditoría sin últimos 4: ${a.filas[0].d}`);
  });
  await prueba("alta_trabajador (superadmin) guarda banco, cuenta y CCI por el ayudante; personas queda sin columnas bancarias", async () => {
    const [v] = await sql(`select v.empresa_id, v.sede_id, v.cargo from vinculos v where v.fecha_fin is null limit 1`);
    const r = await como("authenticated", claims(SUPER), [
      [`select alta_trabajador('91234567', 'PERSONA ENSAYO 3B', $1, $2, $3, current_date, '987654321', $4, '19100200300', null, '00219100200300400', 'DNI')`, [v.cargo, v.sede_id, v.empresa_id, SEMILLA[0].banco]],
      [`reset role`], [`select fn_descifrar_cuenta(cuenta_cifrada) as cuenta, fn_descifrar_cuenta(cci_cifrado) as cci, banco from datos_bancarios where dni = '91234567'`]]);
    if (r.codigo) throw new Error(`${r.codigo} ${r.mensaje}`); igual(r.filas[0].cuenta, "19100200300", "cuenta"); igual(r.filas[0].cci, "00219100200300400", "cci"); igual(r.filas[0].banco, SEMILLA[0].banco, "banco");
  });
  await prueba("importar_planilla_unificada quedó transformada y sigue compilando (se invoca con filas vacías)", async () => {
    const [{ n }] = await sql(`select count(*)::int as n from pg_proc where proname = 'importar_planilla_unificada' and prosrc ~ 'fn_guardar_datos_bancarios' and prosrc !~ 'cuenta_ultimos4 = v_u4'`);
    igual(n, 1, "transformada");
    const r = await como("authenticated", claims(SUPER), [[`select importar_planilla_unificada('[]'::jsonb, '2026-09', 'ensayo', '[]'::jsonb) as j`]]);
    if (r.codigo && !/permiso|Permiso|categoría/i.test(r.mensaje)) throw new Error(`${r.codigo} ${r.mensaje}`);
  });
  await prueba("la migración NO se re-aplica sobre sí misma (precondición)", async () => {
    const r = await como("postgres", null, [[MIGRACION]]);
    if (!r.codigo || !/fase 3b aplicada|ya existe/.test(r.mensaje ?? "")) throw new Error(`esperaba fallo de precondición: ${r.codigo ?? "pasó"} ${r.mensaje ?? ""}`);
  });

  console.log("\n== 2 · Reversión y re-aplicación");
  await prueba("la reversión se aplica sin errores", async () => { await sql(REVERSION); });
  await prueba("la foto (funciones, relaciones, columnas de personas, políticas) es idéntica a la de la fase 3a", async () => {
    const dif = compararFotos(foto0, await foto());
    if (dif.length) throw new Error(`${dif.length} diferencias:\n   ` + dif.slice(0, 15).join("\n   "));
  });
  await prueba("tras revertir, personas vuelve a tener cuenta cifrada, CCI en claro y banco con los valores sembrados", async () => {
    for (const s of SEMILLA.slice(0, 2)) { const [r] = await sql(`select fn_descifrar_cuenta(cuenta_cifrada) as cuenta, cci, banco, banco_id from personas where dni = $1`, [s.dni]); igual(r.cuenta, s.cuenta, "cuenta"); igual(r.cci, s.cci, "cci"); igual(r.banco_id, s.banco_id, "banco_id"); }
    const [r] = await sql(`select cci from v_personal where dni = $1`, [SEMILLA[0].dni]); igual(r.cci, SEMILLA[0].cci, "v_personal original");
  });
  await prueba("la fase 3b vuelve a aplicarse sobre el estado revertido", async () => { await sql(MIGRACION); });
  void antes_aud;
} finally {
  await bd.parar();
}
console.log(`\n${ok} verdes, ${fallos} fallo(s).`);
process.exit(fallos ? 1 : 0);
