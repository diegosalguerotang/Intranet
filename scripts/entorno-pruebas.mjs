// scripts/entorno-pruebas.mjs — Corrección de seguridad · FASE 2.5 — ENTORNO DE
// PRUEBAS con el mismo esquema que producción y DATOS ANONIMIZADOS.
//
// La anonimización ocurre DENTRO de la consulta que corre en producción: cada
// columna con datos de personas viaja ya sustituida (DNI, nombre, celular,
// correo, dirección, cuenta bancaria, secretos, IP, textos libres). Ningún dato
// real de una persona toca el disco de la máquina que extrae. Antes de escribir
// nada, la extracción comprueba en producción que ningún valor transformado
// coincide con el original (prueba por columna, sin exportar originales).
//
// Uso (Diego, con el token de la Management API cargado):
//   node scripts/entorno-pruebas.mjs extraer     → supabase/pruebas/datos-anonimizados.sql (ignorado por git)
//                                                 + supabase/pruebas/resumen.json (versionado: fechas, conteos, columnas)
//   node scripts/entorno-pruebas.mjs verificar   → revisa el archivo generado (dominios, DNIs, correos, secretos)
//   node scripts/entorno-pruebas.mjs probar      → arranca el Postgres local con los datos y comprueba vistas y sesiones
// Carga en el Postgres local: PG_LOCAL_DATOS=1 (scripts/pg-local.mjs) o
// arrancarPgLocal({ datos: true }): reemplaza los seeds por el volcado
// (cargador cargarDatosAnonimizados en pg-local.mjs).
//
// Consistencia: las sustituciones son deterministas (hash md5 del valor real),
// así que el mismo DNI/correo/celular real produce siempre el mismo valor
// ficticio en TODAS las tablas y las relaciones (vínculos, cuentas, acuses,
// auditoría) se conservan. Un correo del Portal (dni@portal.grupoer.pe) se
// convierte en dniFicticio@portal.grupoer.pe para que portal_dni() siga
// funcionando; cualquier otro correo pasa a uNNNNNN@pruebas.invalido.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CARPETA = join(RAIZ, "supabase", "pruebas");
export const ARCHIVO_DATOS = join(CARPETA, "datos-anonimizados.sql");
export const ARCHIVO_RESUMEN = join(CARPETA, "resumen.json");
const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const DOMINIO_PORTAL = "portal.grupoer.pe";
export const DOMINIO_PRUEBAS = "pruebas.invalido";

// --- Expresiones SQL de sustitución (deterministas) -------------------------
const hash = (v, mod) => `(('x' || substr(md5(${v}), 1, 8))::bit(32)::bigint % ${mod})`;
const siNoNulo = (col, expr) => `case when ${col} is null then null else ${expr} end`;
export const MARCAS_SISTEMA = ["Sistema", "sistema", "BackOffice", "ensayo", "importacion", "importación"];
export const SQL = {
  dni: (col) => siNoNulo(col, `'9' || lpad(${hash(col, 10000000)}::text, 7, '0')`),
  nombre: (col) => siNoNulo(col, `'Persona ' || upper(substr(md5(${col}), 1, 5))`),
  celular: (col) => siNoNulo(col, `'9' || lpad(${hash(col, 100000000)}::text, 8, '0')`),
  correo: (col) => siNoNulo(col, `case when lower(${col}) like '%@${DOMINIO_PORTAL}'
      then ${`'9' || lpad(${hash(`split_part(lower(${col}), '@', 1)`, 10000000)}::text, 7, '0')`} || '@${DOMINIO_PORTAL}'
      else 'u' || lpad(${hash(`lower(${col})`, 1000000)}::text, 6, '0') || '@${DOMINIO_PRUEBAS}' end`),
  // Campos «por»: nombre o correo de un administrador, o una marca del sistema.
  actor: (col) => siNoNulo(col, `case when ${col} in (${MARCAS_SISTEMA.map((m) => `'${m}'`).join(", ")}) then ${col}
      when ${col} like '%@%' then ${SQL_correoInline(col)} else 'Admin ' || upper(substr(md5(${col}), 1, 5)) end`),
  sujeto: (col) => siNoNulo(col, `case when ${col} like '%@%' then ${SQL_correoInline(col)} else '9' || lpad(${hash(col, 10000000)}::text, 7, '0') end`),
  direccion: (col) => siNoNulo(col, `'Dirección de prueba ' || ${hash(col, 1000)}::text`),
  texto: (col) => siNoNulo(col, `'Texto de prueba'`),
  ultimos4: (col) => siNoNulo(col, `lpad(${hash(col, 10000)}::text, 4, '0')`),
  ip: (col) => siNoNulo(col, `'10.0.0.1'`),
  agente: (col) => siNoNulo(col, `'Prueba'`),
  nulo: () => `null`,
  jsonVacio: (col) => siNoNulo(col, `'{}'::jsonb`),
  jsonLista: (col) => siNoNulo(col, `'[]'::jsonb`),
  hashSecreto: (col) => siNoNulo(col, `md5(${col})`),
  // Auditoría: se conserva solo la identidad (DNI ficticio) que usa v_actividad_persona.
  auditoria: (col) => siNoNulo(col, `jsonb_strip_nulls(jsonb_build_object(
      'persona_dni', ${SQL_dniInline(`${col} ->> 'persona_dni'`)}, 'dni', ${SQL_dniInline(`${col} ->> 'dni'`)},
      'p_dni', ${SQL_dniInline(`${col} ->> 'p_dni'`)}, 'dni_check', ${SQL_dniInline(`${col} ->> 'dni_check'`)}, 'anonimizado', true))`),
};
function SQL_dniInline(v) { return siNoNulo(`nullif(${v}, '')`, `'9' || lpad(${hash(`nullif(${v}, '')`, 10000000)}::text, 7, '0')`); }
function SQL_correoInline(col) {
  return `case when lower(${col}) like '%@${DOMINIO_PORTAL}' then '9' || lpad(${hash(`split_part(lower(${col}), '@', 1)`, 10000000)}::text, 7, '0') || '@${DOMINIO_PORTAL}'
      else 'u' || lpad(${hash(`lower(${col})`, 1000000)}::text, 6, '0') || '@${DOMINIO_PRUEBAS}' end`;
}

// --- Diccionario: tabla → columna → regla. Lo que no aparece se copia tal cual.
// (Inventario de columnas de producción del 2026-09-18.)
export const REGLAS = {
  personas: { dni: "dni", nombre: "nombre", celular: "celular", direccion: "direccion", cuenta: "nulo", correo: "correo", cci: "nulo", cuenta_cifrada: "nulo", cuenta_ultimos4: "ultimos4" },
  vinculos: { persona_dni: "dni" },
  datos_bancarios: { dni: "dni", cuenta_cifrada: "nulo", cuenta_ultimos4: "ultimos4", cci_cifrado: "nulo", cci_ultimos4: "ultimos4", actualizado_por: "actor" },
  cuentas_portal: { dni: "dni", celular_declarado: "celular", creado_por: "actor", sesion_actual: "nulo" },
  usuarios_admin: { persona_dni: "dni", correo: "correo", celular: "celular", clave_provisional: "nulo", creado_por: "actor", sesion_actual: "nulo" },
  registro_accesos: { dni: "dni", ip: "ip", dispositivo: "agente", correo: "correo" },
  auditoria: { usuario: "actor", datos_antes: "auditoria", datos_despues: "auditoria" },
  acuses: { dni_check: "dni", ip: "ip", dispositivo: "agente", registrado_por: "actor", supervisor_dni: "dni", agente: "agente" },
  asignaciones: { persona_dni: "dni", comentario: "texto" },
  activos: { usuario_anterior: "nombre", asignado_sin_confirmar: "nombre", observaciones: "texto", ip: "ip", clave_equipo: "nulo", clave_gestor: "texto" },
  asistencia_lotes: { creado_por: "actor" },
  cargo_perfiles: { actualizado_por: "actor" },
  comunicado_lecturas: { dni: "dni", dispositivo: "agente", ip: "ip", agente: "agente" },
  consentimientos: { dni: "dni", ip: "ip", agente: "agente" },
  correo_envios: { ip: "ip", sujeto: "sujeto", destinatario: "correo", detalle: "texto" },
  correo_tokens: { token: "hashSecreto", dni: "dni", correo: "correo" },
  descargos: { texto: "texto" },
  epp_entregas: { dni: "dni" },
  horarios_entrada: { persona_dni: "dni", creado_por: "actor" },
  lineas: { numero: "celular", usa: "nombre" },
  lotes: { publicado_por: "actor" },
  marcaciones: { documento: "dni", observacion: "texto", motivo_edicion: "texto" },
  memorandums: { motivo: "texto", falta_texto: "texto", resolucion: "texto", antecedentes: "jsonLista" },
  movimientos: { persona_dni: "dni", detalle: "texto", creado_por: "actor" },
  notificaciones_documento: { destinatario: "correo", enviado_por: "actor" },
  perfil_propuestas: { persona_dni: "dni", decidido_por: "actor" },
  perfiles: { creado_por: "actor" },
  politica_acceso: { actualizado_por: "actor" },
  sedes: { supervisor_dni: "dni" },
  solicitud_avisos: { correo: "correo" },
  solicitud_eventos: { comentario: "texto", datos_previos: "jsonVacio", por: "actor", persona_dni: "dni" },
  solicitudes: { solicitante_dni: "dni", solicitante_nombre: "nombre", supervisor_dni: "dni", supervisor_nombre: "nombre", datos: "jsonVacio", creado_por: "actor" },
  solicitudes_cambio_cuenta: { dni: "dni", motivo: "texto" },
  tardanzas: { dni: "dni" },
  ticket_avisos: { correo: "correo" },
  tickets: { solicitante_dni: "dni", solicitante_nombre: "nombre", solicitante_correo: "correo", comentario: "texto", atendido_por: "actor", nota_interna: "texto", actualizado_por: "actor" },
};
// Columnas cuyo NOMBRE suena a dato personal pero no lo son (revisadas a mano
// el 2026-09-18): booleanos, parámetros de política, nombres de categorías,
// sedes o feriados. Cualquier columna nueva con nombre sensible detiene la
// extracción hasta que se le asigne regla o se añada aquí.
export const REVISADAS_SIN_DATO_PERSONAL = [
  "cuentas_portal.sin_celular", "marcaciones.feriado_nombre", "perfiles.nombre", "personas.nombre_por_confirmar",
  "personas.correo_verificado", "politica_acceso.clave_provisional_dias", "politica_acceso.clave_longitud_min_portal",
  "politica_acceso.clave_longitud_min_backoffice", "solicitudes.sede_nombre", "usuarios_admin.clave_entregada",
  "usuarios_admin.requiere_cambio_clave",
];
// auth.users va aparte (esquema auth): solo id, correo ficticio y fechas.
const AUTH_USERS_SELECT = `select id, ${SQL.correo("email")} as email, created_at, last_sign_in_at, email_confirmed_at from auth.users order by created_at`;

// --- Management API -----------------------------------------------------------
async function consultaProd(q) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("Falta SUPABASE_ACCESS_TOKEN (. .\\scripts\\token-supabase.ps1).");
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}

// --- Literales SQL -------------------------------------------------------------
const TAG = "$anon$";
const literal = (v, tipo) => {
  if (v === null || v === undefined) return "null";
  if (tipo === "jsonb" || tipo === "json") return `${TAG}${JSON.stringify(v)}${TAG}::jsonb`;
  if (tipo === "ARRAY") return `array[${v.map((x) => `${TAG}${x}${TAG}`).join(", ")}]::text[]`;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  const s = String(v);
  if (s.includes(TAG)) throw new Error("un valor contiene la etiqueta de cita");
  return `${TAG}${s}${TAG}`;
};

// --- extraer --------------------------------------------------------------------
async function extraer() {
  // Desde la fase 3a hay tablas en el esquema `interno` (no publicado por la API):
  // se extraen igual; el archivo lleva el esquema real de cada tabla.
  const columnas = await consultaProd(`select c.table_schema as esquema, c.table_name as t, c.column_name as col, c.data_type as tipo, c.ordinal_position as pos,
      (c.is_identity = 'YES' or c.column_default like 'nextval(%') as secuencial
    from information_schema.columns c join pg_class k on k.relname = c.table_name
    join pg_namespace n on n.oid = k.relnamespace and n.nspname = c.table_schema
    where c.table_schema in ('public', 'interno') and k.relkind = 'r' order by 1, 2, 5`);
  // Las tablas respaldo_* las crean las migraciones (definiciones para revertir),
  // no son datos del sistema: no viajan al entorno de pruebas.
  const tablas = [...new Set(columnas.map((c) => c.t))].filter((t) => !/^respaldo_/.test(t));
  const esquemaDe = Object.fromEntries(columnas.map((c) => [c.t, c.esquema]));
  // Tablas de fases futuras pueden no existir aún en producción: se avisa y se ignoran.
  for (const t of Object.keys(REGLAS)) if (!tablas.includes(t)) console.log(`  (REGLAS: la tabla ${t} no existe todavía en producción; se ignora)`);
  for (const [t, reglas] of Object.entries(REGLAS)) for (const col of Object.keys(reglas))
    if (tablas.includes(t) && !columnas.some((c) => c.t === t && c.col === col)) console.log(`  (REGLAS: la columna ${t}.${col} ya no existe en producción; se ignora)`);
  // Columnas con nombre de dato personal que NO tienen regla: se avisa (no se sigue a ciegas).
  const sospechosas = columnas.filter((c) => /dni|nombre|celular|correo|email|telefono|direccion|cuenta|clave|token|ip$|agente|dispositivo/.test(c.col)
    && !REGLAS[c.t]?.[c.col] && !REVISADAS_SIN_DATO_PERSONAL.includes(`${c.t}.${c.col}`) && !["empresas", "sedes", "bancos", "cargos", "rits", "rit_faltas", "tipos_sancion", "declaraciones", "feriados", "solicitud_tipos", "ticket_tipos", "ticket_subtipos", "plantillas", "centros_costo", "comunicados", "lotes", "documentos", "contratos", "perfil_permisos", "perfil_empresas", "solicitud_correlativos", "asistencia_config"].includes(c.t));
  if (sospechosas.length) throw new Error(`Columnas con nombre sensible sin regla: ${sospechosas.map((c) => `${c.t}.${c.col}`).join(", ")}`);

  const salida = [`-- supabase/pruebas/datos-anonimizados.sql — GENERADO por scripts/entorno-pruebas.mjs el ${new Date().toISOString()}`,
    `-- Datos de producción con personas anonimizadas. NO editar. Cargar solo en el Postgres local (PG_LOCAL_DATOS=1).`, ``];
  const resumen = { generado: new Date().toISOString(), proyecto: PROYECTO, tablas: {}, columnas_anonimizadas: {}, pruebas_en_origen: 0 };
  for (const t of tablas) {
    const cols = columnas.filter((c) => c.t === t);
    const reglas = REGLAS[t] ?? {};
    const exprs = cols.map((c) => (reglas[c.col] ? `${SQL[reglas[c.col]](c.col)} as ${c.col}` : c.col));
    // Prueba en origen: ningún valor transformado igual al original (por columna con regla que conserva tipo text).
    for (const [col, regla] of Object.entries(reglas)) {
      const tipo = cols.find((c) => c.col === col)?.tipo;
      if (tipo === undefined) continue;  // columna retirada por una fase posterior
      if (["nulo", "jsonVacio", "jsonLista", "auditoria"].includes(regla) || tipo !== "text") continue;
      const excepto = regla === "actor" ? ` and ${col} not in (${MARCAS_SISTEMA.map((m) => `'${m}'`).join(", ")})` : "";
      const [{ n }] = await consultaProd(`select count(*)::int as n from ${esquemaDe[t]}.${t} where ${col} is not null${excepto} and ${SQL[regla](col)} = ${col}`);
      if (n > 0) throw new Error(`${t}.${col}: ${n} valores quedarían iguales al original`);
      resumen.pruebas_en_origen++;
    }
    const orden = cols.some((c) => c.col === "id") ? "id" : cols[0].col;
    let filas = [], desde = 0;
    for (;;) {
      const lote = await consultaProd(`select ${exprs.join(", ")} from ${esquemaDe[t]}.${t} order by ${orden} limit 1000 offset ${desde}`);
      filas = filas.concat(lote); if (lote.length < 1000) break; desde += 1000;
    }
    resumen.tablas[t] = filas.length;
    if (Object.keys(reglas).length) resumen.columnas_anonimizadas[t] = reglas;
    if (!filas.length) continue;
    salida.push(`-- ${t}: ${filas.length} filas`);
    for (let i = 0; i < filas.length; i += 200) {
      const trozo = filas.slice(i, i + 200);
      salida.push(`insert into ${esquemaDe[t]}.${t} (${cols.map((c) => c.col).join(", ")}) overriding system value values`);
      salida.push(trozo.map((f) => `  (${cols.map((c) => literal(f[c.col], c.tipo)).join(", ")})`).join(",\n") + ";");
    }
    salida.push("");
  }
  const usuarios = await consultaProd(AUTH_USERS_SELECT);
  resumen.tablas["auth.users"] = usuarios.length;
  salida.push(`-- auth.users: ${usuarios.length} cuentas (correos ficticios; la clave local la fija el cargador)`);
  for (const u of usuarios) salida.push(`insert into auth.users (id, email, created_at, last_sign_in_at, email_confirmed_at) values (${literal(u.id)}, ${literal(u.email)}, ${literal(u.created_at)}, ${literal(u.last_sign_in_at)}, ${literal(u.email_confirmed_at)});`);
  salida.push("");
  mkdirSync(CARPETA, { recursive: true });
  const texto = salida.join("\n");
  const problemas = revisarTexto(texto);
  if (problemas.length) throw new Error(`El volcado NO pasa la revisión, no se escribe:\n  ${problemas.join("\n  ")}`);
  writeFileSync(ARCHIVO_DATOS, texto);
  resumen.revision = "sin hallazgos";
  writeFileSync(ARCHIVO_RESUMEN, JSON.stringify(resumen, null, 2) + "\n");
  const total = Object.values(resumen.tablas).reduce((a, b) => a + b, 0);
  console.log(`Volcado anonimizado: ${Object.keys(resumen.tablas).length} tablas, ${total} filas, ${resumen.pruebas_en_origen} pruebas por columna en origen. → ${ARCHIVO_DATOS}`);
}

// --- verificar ---------------------------------------------------------------------
// Revisión del texto generado: dominios reales, DNIs con forma real en columnas
// de identidad, correos fuera del patrón, secretos que no deberían viajar.
export function revisarTexto(texto) {
  const problemas = [];
  const dominiosReales = /@(promant\.pe|redpontis\.com|gmail\.com|hotmail\.com|outlook\.com|negliaf|bremco|americana)/i;
  if (dominiosReales.test(texto)) problemas.push("aparece un dominio de correo real");
  for (const m of texto.matchAll(/\$anon\$([^$]*@[^$]*)\$anon\$/g)) {
    const c = m[1];
    if (!(c.endsWith(`@${DOMINIO_PRUEBAS}`) || /^9\d{7}@portal\.grupoer\.pe$/.test(c))) { problemas.push(`correo fuera de patrón: ${c}`); if (problemas.length > 20) break; }
  }
  // DNIs: toda columna con regla dni debe traer valores que empiezan por 9 (7 dígitos después).
  for (const [t, reglas] of Object.entries(REGLAS)) {
    const colsDni = Object.entries(reglas).filter(([, r]) => r === "dni").map(([c]) => c);
    if (!colsDni.length) continue;
    const cab = new RegExp(`insert into public\\.${t} \\(([^)]+)\\) overriding system value values\\n([\\s\\S]*?);\\n`, "g");
    for (const m of texto.matchAll(cab)) {
      const cols = m[1].split(", ");
      for (const fila of m[2].split("\n")) {
        const vals = [...fila.matchAll(/\$anon\$([^$]*)\$anon\$|null|true|false|(-?\d+(?:\.\d+)?)/g)];
        for (const c of colsDni) {
          const v = vals[cols.indexOf(c)]; const s = v?.[1] ?? v?.[2];
          if (s !== undefined && !/^9\d{7}$/.test(s)) { problemas.push(`${t}.${c}: DNI fuera de patrón (${s})`); break; }
        }
        if (problemas.length > 40) break;
      }
    }
  }
  // Columnas anuladas por regla: en el texto no puede aparecer ningún literal en su posición.
  for (const [t, reglas] of Object.entries(REGLAS)) {
    const colsNulas = Object.entries(reglas).filter(([, r]) => r === "nulo").map(([c]) => c);
    if (!colsNulas.length) continue;
    const cab = new RegExp(`insert into public\\.${t} \\(([^)]+)\\) overriding system value values\\n([\\s\\S]*?);\\n`, "g");
    for (const m of texto.matchAll(cab)) {
      const cols = m[1].split(", ");
      for (const fila of m[2].split("\n")) {
        const vals = [...fila.matchAll(/\$anon\$([^$]*)\$anon\$|null|true|false|(-?\d+(?:\.\d+)?)/g)];
        for (const c of colsNulas) { const i = cols.indexOf(c); if (i < 0) continue; if (vals[i]?.[0] !== "null") { problemas.push(`${t}.${c}: debería ir nula y trae un valor`); break; } }
      }
    }
  }
  return problemas;
}
function verificar() {
  if (!existsSync(ARCHIVO_DATOS)) { console.error(`No existe ${ARCHIVO_DATOS}: corre 'extraer' primero.`); process.exit(1); }
  const problemas = revisarTexto(readFileSync(ARCHIVO_DATOS, "utf8"));
  if (problemas.length) { console.error(`✗ ${problemas.length} hallazgo(s):\n  ${problemas.join("\n  ")}`); process.exit(1); }
  const resumen = JSON.parse(readFileSync(ARCHIVO_RESUMEN, "utf8"));
  console.log(`✓ Volcado del ${resumen.generado}: sin hallazgos (${Object.keys(resumen.tablas).length} tablas).`);
}

// --- cargar: vive en scripts/pg-local.mjs (cargarDatosAnonimizados) para evitar
// la importación circular con await de nivel superior. -------------------------

// --- probar ------------------------------------------------------------------------------
async function probar() {
  const { arrancarPgLocal } = await import("./pg-local.mjs");
  const bd = await arrancarPgLocal({ seguridad: true, datos: true });
  const { sql, cliente } = bd;
  // Desde la fase 3a varias tablas viven en interno: las comprobaciones nombran tablas sin esquema.
  await sql("set search_path = public, interno, extensions");
  let fallos = 0;
  const prueba = async (nombre, fn) => { try { await fn(); console.log(`✓ ${nombre}`); } catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); } };
  const resumen = JSON.parse(readFileSync(ARCHIVO_RESUMEN, "utf8"));
  try {
    await prueba("los conteos por tabla coinciden con el resumen de la extracción", async () => {
      const mal = [];
      for (const [t, n] of Object.entries(resumen.tablas)) {
        const [{ c }] = await sql(`select count(*)::int as c from ${t.includes(".") ? t : t}`);
        if (c !== n) mal.push(`${t}: ${c} ≠ ${n}`);
      }
      if (mal.length) throw new Error(mal.join("; "));
    });
    await prueba("las vistas del BackOffice y del Portal se consultan sin error como dueño", async () => {
      const vistas = await sql(`select c.relname as v from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v'`);
      for (const { v } of vistas) await sql(`select count(*) from public.${v}`);
    });
    await prueba("ningún dato con forma real: DNIs empiezan por 9, correos en dominios de prueba, sin cuentas bancarias ni claves", async () => {
      const [r] = await sql(`select (select count(*) from personas where dni !~ '^9[0-9]{7}$')::int as dni,
        (select count(*) from personas where correo is not null and correo !~ '(@pruebas\\.invalido|^9[0-9]{7}@portal\\.grupoer\\.pe)$')::int as correo,
        (select count(*) from personas where cuenta is not null or cci is not null or cuenta_cifrada is not null)::int as banco,
        (select count(*) from usuarios_admin where clave_provisional is not null or sesion_actual is not null)::int as claves,
        (select count(*) from personas where nombre !~ '^Persona [0-9A-F]{5}$')::int as nombres`);
      for (const [k, v] of Object.entries(r)) if (v !== 0) throw new Error(`${k}: ${v} filas con forma real`);
    });
    await prueba("un superadministrador anonimizado sigue leyendo las vistas con security_invoker (fase 2)", async () => {
      const [u] = await sql(`select ua.correo, au.id from usuarios_admin ua join auth.users au on lower(au.email) = lower(ua.correo)
        join perfiles p on p.id = ua.perfil_id and p.version = ua.perfil_version where ua.estado = 'activo' and p.es_superadmin order by ua.id limit 1`);
      if (!u) throw new Error("no hay superadmin activo con cuenta en el volcado");
      await cliente.query("begin");
      try {
        await cliente.query("set local role authenticated");
        await cliente.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: "authenticated", email: u.correo, sub: u.id })]);
        const { rows } = await cliente.query(`select (select count(*) from v_personal)::int as p, (select count(*) from v_usuarios_admin)::int as u, es_admin() as a`);
        const [{ total }] = await sql(`select count(*)::int as total from v_personal`);
        if (!rows[0].a || rows[0].p !== total || rows[0].u !== resumen.tablas.usuarios_admin) throw new Error(`es_admin=${rows[0].a}, v_personal=${rows[0].p}/${total}, v_usuarios_admin=${rows[0].u}`);
      } finally { await cliente.query("rollback"); }
    });
  } finally { await bd.parar(); }
  console.log(fallos ? `\n${fallos} fallo(s).` : "\nEntorno de pruebas operativo.");
  process.exit(fallos ? 1 : 0);
}

const esPrincipal = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esPrincipal) {
  const cmd = process.argv[2];
  if (cmd === "extraer") await extraer();
  else if (cmd === "verificar") verificar();
  else if (cmd === "probar") await probar();
  else { console.error("Uso: node scripts/entorno-pruebas.mjs extraer | verificar | probar"); process.exit(1); }
}
