// scripts/pg-local.mjs — Postgres LOCAL embebido para ENSAYAR migraciones antes
// de tocar producción (regla de la corrección de seguridad, 2026-09-17: cada
// migración va en una transacción, con reversión escrita y ensayada en local).
//
// No hay Docker ni Postgres instalados en la máquina: se usa el paquete
// `embedded-postgres` (binarios oficiales de PostgreSQL 17 descargados por npm,
// sin instalación ni permisos de administrador). Los datos viven en .pg-local/
// (ignorado por git) y se recrean desde cero en cada ensayo.
//
// Lo que Supabase da por hecho y aquí se imita con "dobles" mínimos:
//   · roles anon / authenticated / service_role / supabase_admin / dashboard_user
//   · esquema auth (tabla users, funciones uid()/jwt()/role() leídas de
//     request.jwt.claims, igual que PostgREST)
//   · esquema extensions con pgcrypto (pgp_sym_*, gen_random_bytes, digest)
//   · esquema vault (secrets, decrypted_secrets, create_secret) SIN cifrado real
//   · esquema storage (buckets, objects, foldername) para las políticas del bucket
//   · default privileges de la plataforma (authenticated/service_role reciben todo)
// Después se cargan los canónicos en el orden documentado en MODELO.md:
// schema.sql → accesos.sql → portal.sql → solicitudes.sql → soporte.sql.
//
// Uso directo:  node scripts/pg-local.mjs            → arranca, carga y compara con
//               supabase/respaldos/2026-09-17-paso0-permisos.json (inventario).
// Como módulo:  import { arrancarPgLocal } from "./pg-local.mjs";
//               const bd = await arrancarPgLocal(); … await bd.parar();
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR_DATOS = join(RAIZ, ".pg-local", "datos");
const PUERTO = Number(process.env.PG_LOCAL_PUERTO ?? 54329);
const CANONICOS = ["schema.sql", "accesos.sql", "portal.sql", "solicitudes.sql", "soporte.sql"];
const COMPLEMENTARIAS = [
  "2026-08-22-importar-planilla-unificada.sql",
  "2026-08-24-movimientos-planilla.sql",
  "2026-08-31-control-semanal.sql",
  "2026-08-31-padron-cc.sql",
  "2026-08-31-perfiles-cargos.sql",
  "2026-08-31-recalculo-reactivo.sql",
];

const DOBLES_SUPABASE = `
-- Roles de la plataforma ----------------------------------------------------
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role supabase_admin nologin;
create role dashboard_user nologin;
create role supabase_auth_admin nologin;
grant anon, authenticated, service_role to postgres;
grant usage on schema public to anon, authenticated, service_role;
-- Extensiones ---------------------------------------------------------------
create schema extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;
-- auth ----------------------------------------------------------------------
create schema auth;
create table auth.users (
  id uuid primary key default extensions.gen_random_uuid(),
  email text unique, encrypted_password text,
  created_at timestamptz not null default now(), last_sign_in_at timestamptz,
  confirmed_at timestamptz, email_confirmed_at timestamptz,
  raw_app_meta_data jsonb default '{}'::jsonb, raw_user_meta_data jsonb default '{}'::jsonb
);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(auth.jwt() ->> 'role', '')
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role;
-- vault (sin cifrado real: basta para que fn_clave_cuentas funcione) --------
create schema vault;
create table vault.secrets (
  id uuid primary key default extensions.gen_random_uuid(),
  name text unique, description text default '', secret text not null,
  created_at timestamptz default now()
);
create view vault.decrypted_secrets as
  select id, name, description, secret as decrypted_secret, created_at from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid language sql as $$
  insert into vault.secrets (name, description, secret) values (new_name, new_description, new_secret) returning id
$$;
-- storage -------------------------------------------------------------------
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false, created_at timestamptz default now());
create table storage.objects (
  id uuid primary key default extensions.gen_random_uuid(),
  bucket_id text references storage.buckets(id), name text, owner uuid,
  created_at timestamptz default now(), updated_at timestamptz default now(), metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored
);
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
create function storage.filename(name text) returns text language sql immutable as $$
  select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)]
$$;
insert into storage.buckets (id, name) values ('documentos', 'documentos');
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;
grant execute on all functions in schema storage to anon, authenticated, service_role;
-- Default privileges de la plataforma (lo que Supabase concede a lo nuevo) ----
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
`;

export async function arrancarPgLocal({ silencio = true, cargarCanonicos = true, seguridad = process.env.PG_LOCAL_SEGURIDAD === "1" } = {}) {
  if (existsSync(DIR_DATOS)) rmSync(DIR_DATOS, { recursive: true, force: true });
  const servidor = new EmbeddedPostgres({
    databaseDir: DIR_DATOS, user: "postgres", password: "postgres", port: PUERTO, persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: silencio ? () => {} : console.log, onError: silencio ? () => {} : console.error,
  });
  await servidor.initialise();
  await servidor.start();
  const cliente = new pg.Client({ host: "127.0.0.1", port: PUERTO, user: "postgres", password: "postgres", database: "postgres" });
  await cliente.connect();
  const sql = async (texto, params) => (await cliente.query(texto, params)).rows;
  await sql(DOBLES_SUPABASE);
  if (cargarCanonicos) {
    for (const archivo of CANONICOS) {
      const texto = readFileSync(join(RAIZ, "supabase", archivo), "utf8");
      try { await sql(texto); }
      catch (e) { throw new Error(`Cargando supabase/${archivo}: ${e.message}${e.position ? ` (posición ${e.position})` : ""}`); }
    }
    // Migraciones cuyo canónico ES la propia migración (memoria del proyecto:
    // planilla unificada 22-08, control semanal / padrón / perfiles 31-08) y
    // la sobrecarga vieja de asignar_activo(3) que prod conserva.
    for (const archivo of COMPLEMENTARIAS) {
      const texto = readFileSync(join(RAIZ, "supabase/migraciones", archivo), "utf8");
      try { await sql(texto); }
      catch (e) { throw new Error(`Cargando migraciones/${archivo}: ${e.message}${e.position ? ` (posición ${e.position})` : ""}`); }
    }
    // Nivelación con producción: lo que en prod aplicaron migraciones
    // transversales que los canónicos no repiten al pie de la letra.
    //  (a) search_path fijo en TODA security definer (2026-08-24-hardening, bloque 4).
    await sql(`do $$ declare r record; begin
      for r in select p.oid::regprocedure as firma from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.prosecdef
                 and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
      loop execute format('alter function %s set search_path = public, extensions', r.firma); end loop; end $$`);
    //  (b) cierre del rol anon (2026-09-14-cerrar-anon.sql, idempotente): los
    //      canónicos posteriores a schema.sql aún conceden a anon al crear.
    await sql(readFileSync(join(RAIZ, "supabase/migraciones/2026-09-14-cerrar-anon.sql"), "utf8"));
    //  (c) perfil_empresas nació en prod SIN RLS ni acceso_demo (la migración
    //      de 2026-08-13 no lo incluyó); la foto del paso 0 lo confirma.
    await sql(`drop policy if exists acceso_demo on perfil_empresas; alter table perfil_empresas disable row level security`);
    //      y rits no tiene grant a authenticated en prod (solo por vista/RPC).
    await sql(`revoke all on table rits from authenticated`);
    //  (d) prod conserva una sobrecarga HUÉRFANA asignar_activo(text,text,text)
    //      anterior a gestión TI (2026-08-19); su cuerpo no está en el repo.
    //      Doble con la misma firma y los mismos permisos (definer, sin guarda)
    //      para que los ensayos de permisos la vean. Fase 1 debe eliminarla.
    await sql(`create function asignar_activo(p_codigo text, p_dni text, p_condicion text) returns void
      language plpgsql security definer set search_path = public, extensions as $$
      begin perform asignar_activo(p_codigo, p_dni, p_condicion, null, null); end $$;
      revoke execute on function asignar_activo(text, text, text) from public, anon;
      grant execute on function asignar_activo(text, text, text) to authenticated, service_role`);
    // Estado de permisos de la fase 0 (supabase/seguridad.sql): se carga cuando
    // producción ya la tiene aplicada (PG_LOCAL_SEGURIDAD=1 o la opción seguridad).
    // El espejo acumula TODAS las fases (0, 0b, 1, 2…); para ensayar una fase
    // sobre el estado anterior se carga sin su bloque (ver sinFase2 en
    // scripts/fase2-generar.mjs y su uso en ensayar-fase2.mjs).
    if (seguridad) await sql(readFileSync(join(RAIZ, "supabase/seguridad.sql"), "utf8"));
  }
  const parar = async () => { await cliente.end().catch(() => {}); await servidor.stop().catch(() => {}); };
  return { sql, cliente, parar, puerto: PUERTO };
}

// Inventario comparable con la foto del paso 0 (mismos criterios).
export async function inventario(sql) {
  const funciones = await sql(`
    select p.proname as nombre, pg_get_function_identity_arguments(p.oid) as args,
           p.prosecdef as definer, p.prorettype = 'trigger'::regtype as es_trigger,
           has_function_privilege('anon', p.oid, 'execute') as anon,
           has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
           coalesce(array_to_string(p.proconfig, ';'), '') ~ 'search_path=' as search_path_fijo
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1, 2`);
  const tablas = await sql(`
    select c.relname as tabla, c.relrowsecurity as rls,
           (select count(*)::int from pg_policies pl where pl.schemaname = 'public' and pl.tablename = c.relname) as politicas
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`);
  const vistas = await sql(`
    select c.relname as vista from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v' order by 1`);
  const politicas = await sql(`select tablename, policyname, roles, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2`);
  const acl = await sql(`
    select c.relname as objeto, c.relkind::text as tipo, coalesce(c.relacl::text, '') as acl
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'S') order by 1`);
  return { funciones, tablas, vistas, politicas, acl };
}
// {a=X,b=X} y {b=X,a=X} son el mismo ACL.
export const aclNormal = (v) => (v ?? "").replace(/\{([^}]*)\}/g, (_, s) => "{" + s.split(",").sort().join(",") + "}");

const esPrincipal = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esPrincipal) {
  const foto = JSON.parse(readFileSync(join(RAIZ, "supabase/respaldos/2026-09-17-paso0-permisos.json"), "utf8"));
  const bd = await arrancarPgLocal({ silencio: !process.env.PG_LOCAL_VERBOSO });
  try {
    const inv = await inventario(bd.sql);
    const clave = (f) => `${f.nombre}(${f.args})`;
    const local = new Map(inv.funciones.map((f) => [clave(f), f]));
    const prod = new Map(foto.funciones.map((f) => [clave(f), f]));
    console.log(`Funciones: local ${local.size} · prod ${prod.size}`);
    for (const k of prod.keys()) if (!local.has(k)) console.log(`  FALTA en local: ${k}`);
    for (const k of local.keys()) if (!prod.has(k)) console.log(`  SOBRA en local: ${k}`);
    for (const [k, f] of prod) {
      const l = local.get(k); if (!l) continue;
      const dif = ["definer", "anon", "authenticated", "search_path_fijo"].filter((c) => Boolean(l[c]) !== Boolean(f[c]));
      if (dif.length) console.log(`  DIFIERE ${k}: ${dif.map((c) => `${c} local=${l[c]} prod=${f[c]}`).join(", ")}`);
    }
    const tl = new Set(inv.tablas.map((t) => t.tabla)), tp = new Set(foto.tablas.map((t) => t.tabla));
    console.log(`Tablas: local ${tl.size} · prod ${tp.size}`);
    for (const t of tp) if (!tl.has(t)) console.log(`  FALTA tabla: ${t}`);
    for (const t of tl) if (!tp.has(t)) console.log(`  SOBRA tabla: ${t}`);
    for (const t of foto.tablas) {
      const l = inv.tablas.find((x) => x.tabla === t.tabla); if (!l) continue;
      if (l.rls !== t.rls || l.politicas !== t.politicas) console.log(`  DIFIERE ${t.tabla}: rls local=${l.rls} prod=${t.rls} · políticas local=${l.politicas} prod=${t.politicas}`);
    }
    const vl = new Set(inv.vistas.map((v) => v.vista)), vp = new Set(foto.vistas.map((v) => v.vista));
    console.log(`Vistas: local ${vl.size} · prod ${vp.size}`);
    for (const v of vp) if (!vl.has(v)) console.log(`  FALTA vista: ${v}`);
    for (const v of vl) if (!vp.has(v)) console.log(`  SOBRA vista: ${v}`);
    console.log(`Políticas: local ${inv.politicas.length} · prod ${foto.politicas.length}`);
    const aclProd = new Map([
      ...foto.tablas.map((t) => [t.tabla, t.acl]), ...foto.vistas.map((v) => [v.vista, v.acl]), ...foto.secuencias.map((s) => [s.secuencia, s.acl]),
    ]);
    let aclDif = 0;
    for (const o of inv.acl) {
      if (!aclProd.has(o.objeto)) continue;
      if (aclNormal(o.acl) !== aclNormal(aclProd.get(o.objeto))) { aclDif++; console.log(`  ACL DIFIERE ${o.objeto}: local=${o.acl} prod=${aclProd.get(o.objeto)}`); }
    }
    console.log(`ACL de tablas/vistas/secuencias: ${aclDif} diferencias con prod`);
  } finally {
    await bd.parar();
  }
}
