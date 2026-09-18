// scripts/fase2-inventario.mjs — Inventario previo a la FASE 2 (vistas con
// security_invoker), corrido en el Postgres LOCAL (scripts/pg-local.mjs) con el
// estado de seguridad de producción (fases 0 + 0b + 1).
//
// Responde, vista por vista:
//   1. qué relaciones (tablas/vistas, con esquema) y qué funciones (y si son
//      SECURITY DEFINER) hay debajo;
//   2. cuántas filas devuelve hoy (vistas como dueño) a un administrador, a un
//      superadministrador y a un trabajador del Portal;
//   3. cuántas devolvería con security_invoker = on SIN políticas nuevas;
//   4. cuántas devolvería con security_invoker = on + política de lectura para
//      administradores activos (lectura_admin) en las tablas base.
// Escribe docs/seguridad/<fecha>-fase2-inventario.md y un JSON al lado.
import { writeFileSync, readFileSync } from "node:fs";
import { arrancarPgLocal } from "./pg-local.mjs";
import { sinFase2 } from "./fase2-generar.mjs";

const FECHA = process.env.FECHA ?? new Date().toISOString().slice(0, 10);
const bd = await arrancarPgLocal({ seguridad: false });
const { sql, cliente } = bd;

// Identidades (mismas que ensayar-fase1): trabajadora Rosa y superadmin Diego
// vienen del seed; el administrador sin marca se crea aquí ANTES de aplicar el
// estado de seguridad (crear_usuario_admin exige superadmin desde la fase 1).
const TRABAJADOR = { dni: "45231876", correo: "45231876@portal.grupoer.pe", sub: "11111111-1111-1111-1111-111111111111" };
const SUPER = { dni: "40776655", correo: "dsalguero@grupoer.pe", sub: "22222222-2222-2222-2222-222222222222" };
const ADMIN = { dni: "41887203", correo: "luis.rrhh@grupoer.pe", sub: "33333333-3333-3333-3333-333333333333" };
await sql(`insert into auth.users (id, email) values ($1, $2), ($3, $4), ($5, $6)`,
  [TRABAJADOR.sub, TRABAJADOR.correo, SUPER.sub, SUPER.correo, ADMIN.sub, ADMIN.correo]);
await sql(`select guardar_perfil('zz-rrhh', 'ZZ RRHH ensayo', '', false, false, false, false,
  '{"personal":3,"boletas":2,"activos":2,"memorandums":2,"comunicados":2,"configuracion":2,"accesos":1,"soporte":2,"solicitudes":2,"asistencia":2}'::jsonb, null, 'ensayo', false)`);
await sql(`select crear_usuario_admin($1, 'zz-rrhh', $2, '', null, 'ensayo')`, [ADMIN.dni, ADMIN.correo]);
// Estado de la fase 1: el espejo SIN el bloque de la fase 2 (que este inventario precede).
await sql(sinFase2(readFileSync("supabase/seguridad.sql", "utf8")));

const como = async (rol, claims, texto, params) => {
  await cliente.query("begin");
  try {
    await cliente.query(`set local role ${rol}`);
    await cliente.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims ?? { role: rol })]);
    const r = await cliente.query(texto, params);
    return { filas: r.rows };
  } catch (e) { return { codigo: e.code, mensaje: e.message }; }
  finally { await cliente.query("rollback"); }
};
const claims = (id) => ({ role: "authenticated", email: id.correo, sub: id.sub });
const SESIONES = { admin: claims(ADMIN), superadmin: claims(SUPER), trabajador: claims(TRABAJADOR) };

const vistas = (await sql(`select c.relname as vista from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v' order by 1`)).map((r) => r.vista);

// 1 · Dependencias directas de cada vista (relaciones y funciones).
const deps = {};
for (const v of vistas) {
  const rels = await sql(`select distinct n.nspname || '.' || c.relname as rel, c.relkind as tipo
    from pg_rewrite rw join pg_depend d on d.objid = rw.oid and d.classid = 'pg_rewrite'::regclass
    join pg_class c on c.oid = d.refobjid and d.refclassid = 'pg_class'::regclass
    join pg_namespace n on n.oid = c.relnamespace
    where rw.ev_class = ('public.' || $1)::regclass and c.relname <> $1 and c.relkind in ('r','v','m','f','p')
    order by 1`, [v]);
  const fns = await sql(`select distinct n.nspname || '.' || p.proname as fn, p.prosecdef as definer
    from pg_rewrite rw join pg_depend d on d.objid = rw.oid and d.classid = 'pg_rewrite'::regclass
    join pg_proc p on p.oid = d.refobjid and d.refclassid = 'pg_proc'::regclass
    join pg_namespace n on n.oid = p.pronamespace
    where rw.ev_class = ('public.' || $1)::regclass order by 1`, [v]);
  deps[v] = { relaciones: rels, funciones: fns };
}

// 2/3/4 · Conteos por sesión en tres estados.
const contar = async () => {
  const out = {};
  for (const v of vistas) {
    out[v] = {};
    const base = await sql(`select count(*)::int as n from public.${v}`);
    out[v].postgres = base[0].n;
    for (const [nombre, cl] of Object.entries(SESIONES)) {
      const r = await como("authenticated", cl, `select count(*)::int as n from public.${v}`);
      out[v][nombre] = r.filas ? r.filas[0].n : `ERR ${r.codigo}`;
    }
  }
  return out;
};
const estadoA = await contar();
await sql(vistas.map((v) => `alter view public.${v} set (security_invoker = on);`).join("\n"));
const estadoB = await contar();
// Tablas base de public bajo cualquier vista (cierre transitivo por vistas anidadas).
const tablasBajo = (v, vistos = new Set()) => {
  for (const r of deps[v].relaciones) {
    const [esq, nombre] = r.rel.split(".");
    if (r.tipo === "v" && esq === "public") tablasBajo(nombre, vistos);
    else if (esq === "public") vistos.add(nombre);
  }
  return vistos;
};
const todasTablas = new Set();
for (const v of vistas) for (const t of tablasBajo(v)) todasTablas.add(t);
await sql([...todasTablas].map((t) =>
  `drop policy if exists lectura_admin on public.${t}; create policy lectura_admin on public.${t} for select to authenticated using (public.es_admin_activo());`).join("\n"));
const estadoC = await contar();

// Informe.
const fila = (v) => {
  const a = estadoA[v], b = estadoB[v], c = estadoC[v];
  const rels = deps[v].relaciones.map((r) => (r.tipo === "v" ? `*${r.rel.replace("public.", "")}*` : r.rel.replace("public.", ""))).join(", ");
  const fns = deps[v].funciones.map((f) => `${f.fn.replace("public.", "")}${f.definer ? "" : " (invoker)"}`).join(", ");
  return `| ${v} | ${a.postgres} | ${a.admin}/${a.superadmin}/${a.trabajador} | ${b.admin}/${b.superadmin}/${b.trabajador} | ${c.admin}/${c.superadmin}/${c.trabajador} | ${rels} | ${fns} |`;
};
const md = [
  `# Fase 2 · Inventario de vistas (Postgres local, estado fases 0+0b+1)`,
  ``,
  `Fecha: ${FECHA}. Conteos = filas devueltas a cada sesión (admin sin marca / superadmin / trabajador del Portal). Estados: **A** = hoy (vistas como dueño); **B** = security_invoker=on sin políticas nuevas; **C** = B + política lectura_admin (es_admin_activo()) en las ${todasTablas.size} tablas base de public. Relaciones en cursiva = vistas anidadas. Funciones marcadas (invoker) corren con los permisos del consultante.`,
  ``,
  `| Vista | filas | A adm/sup/trab | B adm/sup/trab | C adm/sup/trab | Relaciones debajo | Funciones debajo |`,
  `|---|---|---|---|---|---|---|`,
  ...vistas.map(fila),
  ``,
  `Tablas base bajo las vistas (${todasTablas.size}): ${[...todasTablas].sort().join(", ")}.`,
].join("\n");
writeFileSync(`docs/seguridad/${FECHA}-fase2-inventario.md`, md + "\n");
writeFileSync(`supabase/respaldos/${FECHA}-fase2-inventario.json`, JSON.stringify({ deps, estadoA, estadoB, estadoC, tablas: [...todasTablas].sort() }, null, 2));
console.log(md);
await bd.parar();
