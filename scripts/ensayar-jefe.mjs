// scripts/ensayar-jefe.mjs — Ensayo LOCAL del V°B° del jefe directo (2026-10-01).
// Postgres embebido, canónicos + seguridad.sql, seeds de schema.sql más tres
// usuarios administrativos de prueba SIN nivel en Solicitudes (ZZ). pg-local
// arranca ya con el canon nuevo: primero la REVERSIÓN (estado anterior y su
// defecto), luego la MIGRACIÓN, las reglas, y reversión + reaplicación.
// Uso: node scripts/ensayar-jefe.mjs
import { readFileSync } from "node:fs";
import { arrancarPgLocal } from "./pg-local.mjs";
import { FECHA } from "./jefe-generar.mjs";

const MIGRACION = readFileSync(`supabase/migraciones/${FECHA}-jefe-directo.sql`, "utf8");
const REVERSION = readFileSync(`supabase/respaldos/${FECHA}-jefe-directo-reversion.sql`, "utf8");

let fallos = 0, ok = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); await cliente.query("rollback").catch(() => {}); }
};
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const bd = await arrancarPgLocal({ seguridad: true, datos: false });
const { sql, cliente } = bd;
await sql("set search_path = public, interno, extensions");

// Tres administradores sin nivel en Solicitudes: el solicitante (sede con otro
// supervisor), su jefe designado y un tercero. Ninguno es superadministrador.
const [PERFIL] = await sql(`select p.id, p.version from perfiles p where p.estado = 'activo' and not p.es_superadmin
  and not exists (select 1 from perfil_permisos pp where pp.perfil_id = p.id and pp.perfil_version = p.version and pp.modulo = 'solicitudes' and pp.nivel > 0)
  order by p.id limit 1`);
const [SOL] = await sql(`select v.persona_dni as dni, v.sede_id, s.supervisor_dni from vinculos v join sedes s on s.id = v.sede_id
  where v.fecha_fin is null and s.supervisor_dni is not null and s.supervisor_dni <> v.persona_dni
    and not exists (select 1 from usuarios_admin u where u.persona_dni = v.persona_dni) order by v.persona_dni limit 1`);
const otros = await sql(`select v.persona_dni as dni, pe.nombre from vinculos v join personas pe on pe.dni = v.persona_dni
  where v.fecha_fin is null and v.persona_dni not in ($1, $2) and not exists (select 1 from usuarios_admin u where u.persona_dni = v.persona_dni)
  order by v.persona_dni limit 2`, [SOL.dni, SOL.supervisor_dni]);
const JEFE = { ...otros[0], codigo: "U-9001", correo: "zzjefe@ejemplo.invalido" };
const OTRO = { ...otros[1], codigo: "U-9002", correo: "zzotro@ejemplo.invalido" };
const YO = { dni: SOL.dni, codigo: "U-9003", correo: "zzsolicitante@ejemplo.invalido" };
for (const u of [JEFE, OTRO, YO]) {
  await sql(`insert into usuarios_admin (persona_dni, perfil_id, perfil_version, correo, codigo, creado_por) values ($1, $2, $3, $4, $5, 'ensayo')`,
    [u.dni, PERFIL.id, PERFIL.version, u.correo, u.codigo]);
}
console.log(`perfil ${PERFIL.id} · solicitante ${YO.dni} (sede ${SOL.sede_id}, supervisor ${SOL.supervisor_dni}) · jefe ${JEFE.dni} · otro ${OTRO.dni}`);

// Sesión de un administrador (o rol sin claims): transacción SIEMPRE revertida.
const sesion = async (usuario, fn, rol = "authenticated") => {
  await cliente.query("begin");
  try {
    await cliente.query(`set local role ${rol}`);
    await cliente.query(`select set_config('request.jwt.claims', $1, true)`, [usuario ? JSON.stringify({ role: rol, email: usuario.correo }) : ""]);
    return await fn(async (texto, params) => (await cliente.query(texto, params)).rows);
  } finally { await cliente.query("rollback"); }
};
// Cambia de identidad dentro de la misma transacción.
const como = async (q, usuario) => {
  await q("reset role");
  await q(`select set_config('request.jwt.claims', $1, true)`, [usuario ? JSON.stringify({ role: "authenticated", email: usuario.correo }) : ""]);
  if (usuario) await q("set local role authenticated");
};
const falla = async (q, texto, params) => {
  await q("savepoint f");
  try { await q(texto, params); await q("release savepoint f"); return null; }
  catch (e) { await q("rollback to savepoint f"); return e; }
};
const PAPELETA = { salida: "2026-10-05T09:00", retorno: "2026-10-05T12:00", motivo: "Particular", fundamentacion: "ZZ ensayo" };
const crear = async (q, extra) => (await q(`select crear_solicitud_propia('papeleta-permiso', $1::jsonb) as n`, [JSON.stringify({ ...PAPELETA, ...extra })]))[0].n;
const fila = async (q, numero) => { await como(q, null); return (await q(`select id, supervisor_dni, supervisor_nombre, paso_actual, estado, jsonb_array_length(cadena) as pasos, datos from solicitudes where numero = $1`, [numero]))[0]; };
const catalogo = async () => (await sql(`select
  to_regprocedure('public.jefes_disponibles()') is not null as j, to_regprocedure('public.solicitudes_por_mi_visto_bueno()') is not null as b,
  to_regprocedure('public.api_admin_correo_por_dni(text)') is not null as a,
  (select prosrc from pg_proc where oid = 'public.resolver_solicitud(bigint, text, text, text)'::regprocedure) ~ 'v_caller = s\\.supervisor_dni' as regla`))[0];

try {
  console.log("== 0 · estado anterior (reversión aplicada sobre el canon nuevo)");
  await prueba("la reversión aplica: sin funciones nuevas ni regla del jefe designado", async () => {
    await sql(REVERSION);
    const c = await catalogo(); igual(`${c.j}/${c.b}/${c.a}/${c.regla}`, "false/false/false/false", "catálogo");
  });
  await prueba("defecto anterior: el cliente podía mandar su propio documento como jefe y el paso «jefe» desaparecía", async () => {
    const s = await sesion(YO, async (q) => fila(q, await crear(q, { supervisor_nombre: "Yo mismo", supervisor_dni: YO.dni })));
    igual(`${s.supervisor_dni}/${s.pasos}`, `${YO.dni}/1`, "paso saltado");
  });
  await prueba("antes: el jefe escrito a mano no puede dar su visto bueno", async () => {
    const e = await sesion(YO, async (q) => {
      const s = await fila(q, await crear(q, { supervisor_nombre: JEFE.nombre }));
      await como(q, JEFE);
      return falla(q, `select resolver_solicitud($1, 'aprobar', null, 'Jefe')`, [s.id]);
    });
    igual(/exige nivel de aprobación/.test(e?.message ?? ""), true, "rechazo");
  });

  console.log("\n== 1 · migración");
  await prueba("aplica en una transacción (verificación embebida incluida)", async () => { await sql(MIGRACION); });

  console.log("\n== 2 · elegir al jefe");
  await prueba("jefes_disponibles: lista de usuarios activos con código, nombre y cargo (sin documento), marcando al propio", async () => {
    const l = await sesion(YO, (q) => q("select * from jefes_disponibles()"));
    igual(Object.keys(l[0]).sort().join(","), "cargo,codigo,nombre,soy_yo", "columnas");
    igual(l.some((x) => x.codigo === JEFE.codigo && !x.soy_yo), true, "jefe en la lista");
    igual(l.find((x) => x.codigo === YO.codigo)?.soy_yo, true, "soy yo");
  });
  await prueba("una cuenta del portal y una sesión sin identidad reciben la lista vacía; anon no la ejecuta", async () => {
    igual((await sesion({ correo: `${OTRO.dni}@portal.grupoer.pe` }, (q) => q("select * from jefes_disponibles()"))).length, 0, "portal");
    igual((await sesion(null, (q) => q("select * from jefes_disponibles()"))).length, 0, "sin claims");
    let codigo = null;
    try { await sesion(null, (q) => q("select * from jefes_disponibles()"), "anon"); } catch (e) { codigo = e.code; }
    igual(codigo, "42501", "anon");
  });
  await prueba("elegido por código: queda su persona y su nombre del padrón; la clave no se guarda en datos; la cadena conserva el paso «jefe»", async () => {
    const s = await sesion(YO, async (q) => fila(q, await crear(q, { supervisor_usuario: JEFE.codigo })));
    igual(`${s.supervisor_dni}/${s.supervisor_nombre}/${s.pasos}`, `${JEFE.dni}/${JEFE.nombre}/2`, "jefe");
    igual("supervisor_usuario" in s.datos, false, "datos limpios");
  });
  await prueba("no puede elegirse a sí mismo, ni un código inexistente; un documento enviado por el cliente se ignora (nombre a mano, sin persona, paso intacto)", async () => {
    const r = await sesion(YO, async (q) => {
      const propio = await falla(q, `select crear_solicitud_propia('papeleta-permiso', $1::jsonb)`, [JSON.stringify({ ...PAPELETA, supervisor_usuario: YO.codigo })]);
      const nadie = await falla(q, `select crear_solicitud_propia('papeleta-permiso', $1::jsonb)`, [JSON.stringify({ ...PAPELETA, supervisor_usuario: "U-0000" })]);
      const s = await fila(q, await crear(q, { supervisor_nombre: "Yo mismo", supervisor_dni: YO.dni }));
      return { propio, nadie, s };
    });
    igual(/su propio jefe inmediato/.test(r.propio?.message ?? ""), true, "a sí mismo");
    igual(/no existe o ya no está activo/.test(r.nadie?.message ?? ""), true, "inexistente");
    igual(`${r.s.supervisor_dni}/${r.s.supervisor_nombre}/${r.s.pasos}`, "null/Yo mismo/2", "documento del cliente ignorado");
  });
  await prueba("sin elegir ni escribir: sigue proponiéndose el supervisor de la sede", async () => {
    const s = await sesion(YO, async (q) => fila(q, await crear(q, {})));
    igual(s.supervisor_dni, SOL.supervisor_dni, "supervisor de la sede");
  });

  console.log("\n== 3 · el visto bueno del jefe");
  await prueba("el jefe designado la ve en su buzón (sin adjunto ni documento), el tercero no; la aprueba sin tener el módulo y avanza al paso 2", async () => {
    const r = await sesion(YO, async (q) => {
      const numero = await crear(q, { supervisor_usuario: JEFE.codigo });
      await como(q, OTRO); const ajeno = await q("select * from solicitudes_por_mi_visto_bueno()");
      const eOtro = await falla(q, `select resolver_solicitud((select id from solicitudes_por_mi_visto_bueno() limit 1), 'aprobar', null, 'Otro')`);
      await como(q, JEFE); const buzon = await q("select * from solicitudes_por_mi_visto_bueno()");
      await q(`select resolver_solicitud($1, 'aprobar', null, 'Jefe')`, [buzon[0].id]);
      const despues = await q("select * from solicitudes_por_mi_visto_bueno()");
      const eSegundo = await falla(q, `select resolver_solicitud($1, 'aprobar', null, 'Jefe')`, [buzon[0].id]);
      const s = await fila(q, numero);
      const [ev] = await q(`select accion, persona_dni from solicitud_eventos where solicitud_id = $1 order by id desc limit 1`, [s.id]);
      return { numero, ajeno, eOtro, buzon, despues, eSegundo, s, ev };
    });
    igual(r.ajeno.length, 0, "buzón del tercero");
    igual(`${r.buzon.length}/${r.buzon[0].numero === r.numero}/${"adjunto_url" in r.buzon[0].datos}/${"solicitante_dni" in r.buzon[0]}`, "1/true/false/false", "buzón del jefe");
    igual(`${r.s.paso_actual}/${r.s.estado}/${r.ev.accion}/${r.ev.persona_dni}`, `2/enviada/aprobada_paso/${JEFE.dni}`, "avance");
    igual(r.despues.length, 0, "sale del buzón");
    igual(/exige nivel de aprobación/.test(r.eSegundo?.message ?? ""), true, "el jefe no da el paso de RRHH");
  });
  await prueba("un tercero sin nivel no da el visto bueno del jefe; el jefe puede observar o rechazar con motivo (y sin motivo no)", async () => {
    const r = await sesion(YO, async (q) => {
      const s = await fila(q, await crear(q, { supervisor_usuario: JEFE.codigo }));
      await como(q, OTRO); const eOtro = await falla(q, `select resolver_solicitud($1, 'aprobar', null, 'Otro')`, [s.id]);
      await como(q, JEFE); const eSinMotivo = await falla(q, `select resolver_solicitud($1, 'observar', null, 'Jefe')`, [s.id]);
      await q(`select resolver_solicitud($1, 'observar', 'Falta la hora de retorno', 'Jefe')`, [s.id]);
      await como(q, null); const [o] = await q(`select estado from solicitudes where id = $1`, [s.id]);
      return { eOtro, eSinMotivo, estado: o.estado };
    });
    igual(/exige nivel de aprobación/.test(r.eOtro?.message ?? ""), true, "tercero");
    igual(/exige un motivo/.test(r.eSinMotivo?.message ?? ""), true, "sin motivo");
    igual(r.estado, "observada", "observada");
  });
  await prueba("la jefatura (nivel de aprobación) sigue pudiendo dar el paso «jefe»; nadie resuelve la suya", async () => {
    const r = await sesion(YO, async (q) => {
      const s = await fila(q, await crear(q, { supervisor_usuario: JEFE.codigo }));
      await como(q, YO); const ePropia = await falla(q, `select resolver_solicitud($1, 'aprobar', null, 'Yo')`, [s.id]);
      await como(q, null); await q("set local role service_role");
      await q(`select resolver_solicitud($1, 'aprobar', null, 'Jefatura')`, [s.id]);
      await q("reset role"); const [o] = await q(`select paso_actual from solicitudes where id = $1`, [s.id]);
      return { ePropia, paso: o.paso_actual };
    });
    igual(/Nadie resuelve su propia solicitud/.test(r.ePropia?.message ?? ""), true, "propia");
    igual(r.paso, 2, "jefatura");
  });
  await prueba("el supervisor de la sede con nivel de acción conserva su vía (regla anterior intacta)", async () => {
    const [p2] = await sql(`select p.id, p.version from perfiles p join perfil_permisos pp on pp.perfil_id = p.id and pp.perfil_version = p.version
      where p.estado = 'activo' and not p.es_superadmin and pp.modulo = 'solicitudes' and pp.nivel = 2 order by p.id limit 1`);
    const r = await sesion(YO, async (q) => {
      await como(q, null);
      await q(`insert into usuarios_admin (persona_dni, perfil_id, perfil_version, correo, codigo, creado_por) values ($1, $2, $3, 'zzsupervisor@ejemplo.invalido', 'U-9004', 'ensayo')`, [SOL.supervisor_dni, p2.id, p2.version]);
      await como(q, YO); const numero = await crear(q, { supervisor_usuario: JEFE.codigo });
      const s = await fila(q, numero);
      await como(q, { correo: "zzsupervisor@ejemplo.invalido" });
      await q(`select resolver_solicitud($1, 'aprobar', null, 'Supervisor')`, [s.id]);
      await como(q, null); return (await q(`select paso_actual from solicitudes where id = $1`, [s.id]))[0].paso_actual;
    });
    igual(r, 2, "supervisor de sede");
  });

  console.log("\n== 4 · correo del jefe (servicio)");
  await prueba("api_admin_correo_por_dni: service_role obtiene el correo de la cuenta; authenticated no la ejecuta", async () => {
    await cliente.query("begin"); await cliente.query("set local role service_role");
    const [c] = (await cliente.query(`select api_admin_correo_por_dni($1) as c`, [JEFE.dni])).rows; await cliente.query("rollback");
    igual(c.c, JEFE.correo, "correo");
    let codigo = null;
    try { await sesion(YO, (q) => q(`select api_admin_correo_por_dni($1)`, [JEFE.dni])); } catch (e) { codigo = e.code; }
    igual(codigo, "42501", "authenticated");
  });

  console.log("\n== 5 · reversión y reaplicación");
  await prueba("la reversión restaura los cuerpos anteriores y quita las funciones; la migración se reaplica", async () => {
    await sql(REVERSION);
    let c = await catalogo(); igual(`${c.j}/${c.b}/${c.a}/${c.regla}`, "false/false/false/false", "tras reversión");
    await sql(MIGRACION);
    c = await catalogo(); igual(`${c.j}/${c.b}/${c.a}/${c.regla}`, "true/true/true/true", "reaplicada");
  });
} finally {
  await bd.parar();
}
console.log(`\n${ok} ok · ${fallos} fallo(s)`);
process.exit(fallos ? 1 : 0);
