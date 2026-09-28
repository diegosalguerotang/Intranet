# Segundo factor por correo para el Superadministrador — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que toda cuenta con categoría Superadministrador deba teclear un código de 6 dígitos recibido por correo al entrar al BackOffice (salvo equipo recordado 30 días), y que hasta verificarlo su sesión valga nivel 0 en toda la base, aunque salte la pantalla o use la API.

**Architecture:** La regla vive en Postgres: `fn_nivel_modulo` v4 devuelve 0 a un superadmin cuya sesión (`session_id` del JWT) no tiene marca vigente en `interno.factor_sesiones`. Los códigos y equipos recordados solo los escriben funciones `api_factor_*` ejecutables por `service_role` desde el endpoint `api/segundo-factor.js` (misma forma que `api/admin-usuarios.js`: valida el JWT con GoTrue y recién ahí lee el claim). El cliente consulta su estado con `mi_segundo_factor()` y muestra la pantalla `SegundoFactor` antes que cualquier otra. Canónico `supabase/factor.sql` embebido en `seguridad.sql` como bloque `@@FACTOR@@` por `scripts/factor-generar.mjs`, que también genera migración (una transacción, respaldo y verificación embebida) y reversión.

**Tech Stack:** PostgreSQL 17 (Supabase; esquema `interno`, SECURITY DEFINER, RLS), Vercel serverless (Node 22, `node:crypto`, nodemailer vía `api/_correo.js`), React 19 + react-router + Tailwind 4, vitest 4, Postgres embebido (`scripts/pg-local.mjs`) para ensayos, Management API de Supabase para verificadores.

Spec: `docs/superpowers/specs/2026-09-28-segundo-factor-correo-design.md`.

## Global Constraints

- **Código:** 6 dígitos, vence a los **10 minutos**, **5 intentos**, uno vigente por sesión, **60 segundos** entre envíos. Equipo recordado: **30 días** sin renovación. Marca de sesión: `politica_acceso.sesion_backoffice_horas` (hoy 8).
- **Hash del código:** `sha256(codigo || session_id)` en hex (sal = uuid de la sesión tal como viene en el claim). **Token de equipo:** 32 bytes aleatorios en base64url; en BD solo `sha256(token)` hex.
- **Interruptor:** `interno.politica_acceso.factor_superadmin boolean not null default true`. Contingencia = `update interno.politica_acceso set factor_superadmin = false where id = 1` por Management API. Sin códigos de respaldo.
- **Orden de puertas en el cliente:** `factorPendiente` → `requiereCambio` → app.
- **Casilla «Recordar este equipo por 30 días»:** marcada por defecto. Token en `localStorage['backoffice-dispositivo']`.
- **Regla de identidad del proyecto:** un endpoint solo lee claims de un JWT que GoTrue ya validó (`GET /auth/v1/user`). Cuentas `@portal.grupoer.pe` → 403 en el endpoint.
- **Regla de seguridad del canon:** toda función nueva nace sin EXECUTE (default privileges); el grant es explícito. `api_*` solo `service_role`. Tablas de `interno`: sin USAGE de `anon`, sin GRANT a `authenticated`, RLS activada.
- **Regla de despliegue (memoria del proyecto):** la migración en producción la aplica Diego con `!` (el clasificador de auto mode niega DDL en producción a Claude). Migración **antes** del push. Sin `git push` hasta la migración aplicada.
- **Textos de la interfaz en español, literales y accionables** (patrón `RestablecerAdmin`). El 503 del correo dice exactamente: «No se pudo enviar el código. Avisa a soporte técnico.»
- **Códigos de respuesta del endpoint** (fijados aquí; el 401 lo reserva el cliente para «sesión inválida → salir», por eso un equipo no reconocido es **403** y no 401 como decía la spec):
  - `enviar` → 200 `{enviado:true, expiraEn, correo}` · 429 `{error, esperaSeg}` · 503 `{error}` · 403 `{error}` si no es superadmin o la política está apagada.
  - `verificar` → 200 `{listo:true, dispositivo?}` · 400 `{error:"Código incorrecto.", intentosRestantes}` · 410 `{error:"vencido"|"agotado"}`.
  - `dispositivo` → 200 `{listo:true}` · 403 `{error:"Equipo no reconocido."}`.
  - `olvidar` → 200 `{revocados:n}`.
- Commits en español con el prefijo del área (`seguridad(factor): …`, `accesos(ACC-05): …`, `docs(seguridad): …`), terminados con `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Decisiones del plan (donde se aparta de la spec, y por qué)

1. **`factor.sql` NO entra en `CANONICOS` de `pg-local.mjs`.** Referencia `interno.usuarios_admin`, que solo existe tras el bloque `@@FASE3@@` de `seguridad.sql`. Va embebido como bloque `@@FACTOR@@` al final de `seguridad.sql`, igual que `limites.sql` (fase 6). `MODELO.md` documenta el orden así.
2. **`fn_factor_pendiente()` no se concede a `authenticated`.** Solo la llama `fn_nivel_modulo` (definer). El cliente usa `mi_segundo_factor()`. Menos superficie.
3. **`guardar_politica` nueva lleva `p_factor_superadmin boolean default null`** (`coalesce` con el valor vigente): el cliente viejo, sin el parámetro, sigue funcionando entre la migración y el deploy.
4. **Compuerta también en los endpoints con `x-sesion` que autorizan con la llave de servicio** (`admin-usuarios`, `portal-cuentas`, `solicitud-pdf`, `constancia-portal`, `consentimiento-pdf`, `descargar-documento`, `rit`, `enviar-correo`): sin eso un superadmin pendiente crearía cuentas o bajaría documentos por la API. Helper `api/_factor.js`.
5. **Equipo no reconocido → 403** (ver Global Constraints).
6. **Suites:** helper `scripts/lib/marcar-factor.mjs` (carpeta nueva). `verificar-fase4.mjs` (corre en CI) simula al superadmin con `session_id` + marca temporal que borra al final. `SIN_POLITICA` de `fase4-generar.mjs` suma las 3 tablas nuevas (sin políticas: nadie de la API las lee). `sinFase6` de `fase6-generar.mjs` también recorta el bloque `@@FACTOR@@` para que `ensayar-fase6.mjs` siga cargando «estado fase 5».

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `supabase/factor.sql` (nuevo) | Canónico: columna de política, 3 tablas `interno`, `fn_factor_pendiente`, `fn_nivel_modulo` v4, `v_politica_acceso`, `guardar_politica` nueva, `mi_segundo_factor`, 5 `api_factor_*`, grants. |
| `scripts/factor-generar.mjs` (nuevo) | Genera migración `supabase/migraciones/2026-09-28-segundo-factor.sql`, reversión `supabase/respaldos/2026-09-28-segundo-factor-reversion.sql` y bloque `@@FACTOR@@` de `seguridad.sql`. Exporta `FECHA`, `FUNCIONES`, `sinFactor`. |
| `scripts/ensayar-factor.mjs` (nuevo) | Ensayo local sobre Postgres embebido + datos anonimizados: huecos, migración, reglas, reversión, reaplicación. |
| `scripts/ensayar-canon.mjs` | Invariante nuevo (CI). |
| `scripts/fase4-generar.mjs`, `scripts/fase6-generar.mjs` | `SIN_POLITICA` + 3 tablas; `sinFase6` recorta `@@FACTOR@@`. |
| `api/_clave.js` | `claimDeSesion(jwt, nombre)`. |
| `api/_factor.js` (nuevo) | `factorPendiente(jwt)` para la compuerta de los endpoints. |
| `api/segundo-factor.js` (nuevo) | Endpoint: `enviar`, `verificar`, `dispositivo`, `olvidar`. |
| `api/enviar-correo.js` | `LIMITES.sujeto["segundo-factor"] = 15`; compuerta en `llamador()`. |
| `api/admin-usuarios.js`, `api/portal-cuentas.js`, `api/solicitud-pdf.js`, `api/constancia-portal.js`, `api/consentimiento-pdf.js`, `api/descargar-documento.js`, `api/rit.js` | Compuerta `factorPendiente`. |
| `tests/api/factor.test.js`, `tests/api/segundo-factor.test.js`, `tests/api/admin-usuarios.test.js` (nuevos) | vitest con Supabase simulado. |
| `src/state.jsx` | `resolver` consulta `mi_segundo_factor`; `factorPendiente`; `factorVerificado()`; `llamarFactor`; `guardarPolitica` con `p_factor_superadmin`. |
| `src/pages/SegundoFactor.jsx` (nuevo) | Pantalla del código. |
| `src/layout/Shell.jsx` | Puerta `factorPendiente` antes de `requiereCambio`. |
| `src/pages/accesos/Politica.jsx` | Casilla del interruptor + botón «Olvidar todos los equipos recordados». |
| `src/data/mock.js` | `factorSuperadmin: true` en `POLITICA_ACCESO`. |
| `scripts/lib/marcar-factor.mjs` (nuevo) + 10 suites + `scripts/verificar-fase4.mjs` | Marca de sesión para admins temporales / simulados. |
| `scripts/verificar-factor.mjs` (nuevo) | Verificador en producción tras la migración. |
| `docs/seguridad/2026-09-28-segundo-factor.md` (nuevo), `docs/seguridad/README.md`, `supabase/MODELO.md`, `docs/checklists/2026-08-21-flujos-e2e.md`, `docs/funciones-y-permisos.md` | Documentación. |

---

### Task 1: Canónico SQL, generador y ensayo local

**Files:**
- Create: `supabase/factor.sql`
- Create: `scripts/factor-generar.mjs`
- Create: `scripts/ensayar-factor.mjs`
- Modify: `scripts/fase6-generar.mjs:114` (`sinFase6`)
- Modify: `supabase/seguridad.sql` (bloque generado al final)
- Generated: `supabase/migraciones/2026-09-28-segundo-factor.sql`, `supabase/respaldos/2026-09-28-segundo-factor-reversion.sql`

**Interfaces:**
- Consumes: `arrancarPgLocal`, `cargarDatosAnonimizados` de `scripts/pg-local.mjs`; patrón `como()` de `scripts/ensayar-fase6.mjs`.
- Produces (SQL, esquema `public` salvo tablas):
  - `interno.factor_codigos`, `interno.factor_sesiones`, `interno.dispositivos_confiables`; `interno.politica_acceso.factor_superadmin`.
  - `fn_factor_pendiente() returns boolean` (interna).
  - `fn_nivel_modulo(text)` v4.
  - `mi_segundo_factor() returns jsonb {esSuperadmin, exigido, verificado, expiraEn, correo}` (authenticated).
  - `guardar_politica(int, int, boolean, boolean, int, int, text, int, int, int, text, boolean default null)`.
  - `v_politica_acceso` + columna `"factorSuperadmin"`.
  - `api_factor_emitir(p_correo text, p_session_id uuid, p_codigo_hash text, p_ip text, p_agente text) returns jsonb {ok, motivo?, espera_seg?, expira_en?}`
  - `api_factor_verificar(p_correo text, p_session_id uuid, p_codigo_hash text, p_ip text, p_agente text) returns jsonb {ok, motivo?, intentos_restantes?, expira_en?}`
  - `api_factor_dispositivo_crear(p_correo text, p_session_id uuid, p_token_hash text, p_ip text, p_agente text) returns void`
  - `api_factor_dispositivo_usar(p_correo text, p_session_id uuid, p_token_hash text, p_ip text, p_agente text) returns boolean`
  - `api_factor_dispositivos_revocar(p_correo text) returns int`
  - `scripts/factor-generar.mjs` exporta `FECHA = "2026-09-28"`, `FUNCIONES`, `MIGRACION`, `REVERSION`, `ESPEJO`, `sinFactor(texto)`.

- [ ] **Step 1: Escribir el ensayo (prueba que falla)**

Crear `scripts/ensayar-factor.mjs`:

```js
// scripts/ensayar-factor.mjs — Ensayo LOCAL del segundo factor por correo
// (2026-09-28) sobre el entorno 2.5 en estado de la fase 6 + datos
// anonimizados. Demuestra el hueco (superadmin con JWT vale 99 sin verificar),
// aplica la migración, comprueba cada regla, ensaya la reversión y reaplica.
// Uso: node scripts/ensayar-factor.mjs
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { arrancarPgLocal, cargarDatosAnonimizados } from "./pg-local.mjs";
import { FECHA, sinFactor } from "./factor-generar.mjs";

const MIGRACION = readFileSync(`supabase/migraciones/${FECHA}-segundo-factor.sql`, "utf8");
const REVERSION = readFileSync(`supabase/respaldos/${FECHA}-segundo-factor-reversion.sql`, "utf8");
const SEGURIDAD_6 = sinFactor(readFileSync("supabase/seguridad.sql", "utf8"));
const hash = (t) => createHash("sha256").update(t).digest("hex");

let fallos = 0, ok = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); await cliente.query("rollback").catch(() => {}); }
};
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const bd = await arrancarPgLocal({ seguridad: false, datos: false });
const { sql, cliente } = bd;
await sql(SEGURIDAD_6);
await cargarDatosAnonimizados(sql);
await sql("set search_path = public, interno, extensions");

const como = async (rol, { claims, cabeceras, conservar = false, previo = [] } = {}, pasos) => {
  await cliente.query("begin");
  try {
    for (const p of previo) await cliente.query(p);
    if (rol) await cliente.query(`set local role ${rol}`);
    if (claims !== undefined) await cliente.query(`select set_config('request.jwt.claims', $1, true)`, [claims === null ? "" : JSON.stringify(claims)]);
    if (cabeceras) await cliente.query(`select set_config('request.headers', $1, true)`, [JSON.stringify(cabeceras)]);
    let r; for (const [texto, params] of pasos) r = await cliente.query(texto, params);
    await cliente.query(conservar ? "commit" : "rollback");
    return { filas: r.rows, n: r.rowCount };
  } catch (e) { await cliente.query("rollback"); return { codigo: e.code, mensaje: e.message }; }
};
const nivel = async (claims) => {
  const r = await como("authenticated", { claims, previo: ["grant execute on function public.fn_nivel_modulo(text) to authenticated"] }, [["select fn_nivel_modulo('accesos') as n"]]);
  if (r.codigo) throw new Error(`${r.codigo} ${r.mensaje}`); return r.filas[0].n;
};
const servicio = (pasos, conservar = true) => como("service_role", { claims: { role: "service_role" }, conservar }, pasos);
const sinError = (r, msj) => { if (r.codigo) throw new Error(`${msj}: ${r.codigo} ${r.mensaje}`); return r; };

const [SUPER] = await sql(`select ua.correo, au.id as sub from usuarios_admin ua join auth.users au on lower(au.email) = lower(ua.correo)
  join perfiles p on p.id = ua.perfil_id and p.version = ua.perfil_version where ua.estado = 'activo' and p.es_superadmin order by ua.id limit 1`);
const [NO_SUPER] = await sql(`select ua.correo, au.id as sub from usuarios_admin ua join auth.users au on lower(au.email) = lower(ua.correo)
  join perfiles p on p.id = ua.perfil_id and p.version = ua.perfil_version where ua.estado = 'activo' and not p.es_superadmin order by ua.id limit 1`);
const S1 = randomUUID(), S2 = randomUUID(), S3 = randomUUID(), S4 = randomUUID();
const claims = (correo, sub, session_id) => ({ role: "authenticated", email: correo, sub, ...(session_id ? { session_id } : {}) });
const superSin = claims(SUPER.correo, SUPER.sub);
const superS1 = claims(SUPER.correo, SUPER.sub, S1);
console.log(`superadmin ${SUPER.correo} · no superadmin ${NO_SUPER?.correo ?? "(ninguno en los datos)"}`);

const foto = async () => {
  const filas = await sql(`select 'fn:' || p.oid::regprocedure::text as objeto, coalesce(p.proacl::text, '') || '|' || md5(p.prosrc) as valor from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    union all select 'view:v_politica_acceso', coalesce(c.relacl::text, '') || '|' || md5(pg_get_viewdef(c.oid)) || '|' || coalesce(array_to_string(c.reloptions, ','), '') from pg_class c where c.oid = 'public.v_politica_acceso'::regclass
    union all select 'col:' || attname, atttypid::regtype::text from pg_attribute where attrelid = 'interno.politica_acceso'::regclass and attnum > 0 and not attisdropped
    union all select 'tabla:' || relname, '' from pg_class where relnamespace = 'interno'::regnamespace and relkind = 'r'
    order by 1`);
  return new Map(filas.map((f) => [f.objeto, f.valor]));
};
const compararFotos = (a, b) => { const d = []; for (const [k, v] of a) if (!b.has(k)) d.push(`falta: ${k}`); else if (b.get(k) !== v) d.push(`difiere: ${k}`); for (const k of b.keys()) if (!a.has(k)) d.push(`sobra: ${k}`); return d; };

try {
  console.log("== 0 · Base: fase 6 + datos. El hueco");
  const foto0 = await foto();
  await prueba("hoy: un superadmin con JWT vale 99 sin verificar nada", async () => { igual(await nivel(superSin), 99, "nivel"); });

  console.log("\n== 1 · Migración");
  await prueba("la migración se aplica sin errores (verificación embebida incluida)", async () => { await sql(MIGRACION); });
  await prueba("respaldo con 2 funciones + 2 ACL + vista + ACL de vista; política con factor_superadmin = true", async () => {
    const [r] = await sql(`select (select count(*)::int from interno.respaldo_factor) as total, (select factor_superadmin from interno.politica_acceso where id = 1) as pol,
      (select "factorSuperadmin" from public.v_politica_acceso) as vista`);
    igual(r.total, 6, "objetos"); igual(r.pol, true, "política"); igual(r.vista, true, "vista");
  });

  console.log("\n== 2 · Guarda en la base");
  await prueba("superadmin con JWT sin session_id → 0; con session_id sin marca → 0; sin JWT: postgres 99, service_role 99", async () => {
    igual(await nivel(superSin), 0, "sin session_id");
    igual(await nivel(superS1), 0, "sin marca");
    const r = sinError(await como(null, {}, [["select fn_nivel_modulo('accesos') as n"]]), "postgres"); igual(r.filas[0].n, 99, "postgres");
    const s = sinError(await servicio([["select fn_nivel_modulo('accesos') as n"]], false), "service_role"); igual(s.filas[0].n, 99, "service_role");
  });
  await prueba("pendiente: v_usuarios_admin y v_mi_acceso devuelven la fila propia; v_personal vacía; mi_segundo_factor exigido y no verificado con correo enmascarado", async () => {
    const r = sinError(await como("authenticated", { claims: superS1 }, [[`select (select count(*)::int from v_usuarios_admin where lower(correo) = lower($1)) as u, (select count(*)::int from v_mi_acceso) as m, (select count(*)::int from v_personal) as p, mi_segundo_factor() as f`, [SUPER.correo]]]), "vistas");
    const f = r.filas[0];
    igual(`${f.u}/${f.m}/${f.p}`, "1/1/0", "filas");
    igual(`${f.f.exigido}/${f.f.verificado}/${f.f.esSuperadmin}`, "true/false/true", "estado");
    if (!/^.•••@/.test(f.f.correo)) throw new Error(`correo sin enmascarar: ${f.f.correo}`);
  });
  await prueba("un administrador no superadmin no cambia: exigido=false y su nivel es el de su categoría", async () => {
    if (!NO_SUPER) return;
    const r = sinError(await como("authenticated", { claims: claims(NO_SUPER.correo, NO_SUPER.sub) }, [["select mi_segundo_factor() as f, es_superadmin() as s"]]), "no superadmin");
    igual(`${r.filas[0].f.exigido}/${r.filas[0].f.esSuperadmin}/${r.filas[0].s}`, "false/false/false", "estado");
  });
  await prueba("política apagada → 99 sin marca; encendida → 0", async () => {
    await sql("update interno.politica_acceso set factor_superadmin = false where id = 1");
    igual(await nivel(superS1), 99, "apagada");
    await sql("update interno.politica_acceso set factor_superadmin = true where id = 1");
    igual(await nivel(superS1), 0, "encendida");
  });

  console.log("\n== 3 · Códigos (funciones de servicio)");
  const CODIGO = "123456";
  await prueba("emitir: ok; segunda emisión en < 60 s → espera; no superadmin → no_superadmin; política apagada → apagado", async () => {
    let r = sinError(await servicio([["select api_factor_emitir($1, $2, $3, '203.0.113.7', 'Ensayo') as v", [SUPER.correo, S1, hash(CODIGO + S1)]]]), "emitir");
    igual(r.filas[0].v.ok, true, "ok");
    r = sinError(await servicio([["select api_factor_emitir($1, $2, $3, '203.0.113.7', 'Ensayo') as v", [SUPER.correo, S1, hash("000000" + S1)]]], false), "reemitir");
    igual(r.filas[0].v.motivo, "espera", "espera"); if (!(r.filas[0].v.espera_seg > 0 && r.filas[0].v.espera_seg <= 60)) throw new Error(`espera_seg ${r.filas[0].v.espera_seg}`);
    if (NO_SUPER) { r = sinError(await servicio([["select api_factor_emitir($1, $2, 'x', null, null) as v", [NO_SUPER.correo, S1]]], false), "otro"); igual(r.filas[0].v.motivo, "no_superadmin", "otro"); }
    await sql("update interno.politica_acceso set factor_superadmin = false where id = 1");
    r = sinError(await servicio([["select api_factor_emitir($1, $2, 'x', null, null) as v", [SUPER.correo, S2]]], false), "apagado"); igual(r.filas[0].v.motivo, "apagado", "apagado");
    await sql("update interno.politica_acceso set factor_superadmin = true where id = 1");
  });
  await prueba("verificar: 4 fallos bajan intentos_restantes 4→1, el 5.º agota; después ni el código correcto sirve", async () => {
    for (let i = 4; i >= 1; i--) {
      const r = sinError(await servicio([["select api_factor_verificar($1, $2, $3, '203.0.113.7', 'Ensayo') as v", [SUPER.correo, S1, hash("999999" + S1)]]]), `fallo ${i}`);
      igual(`${r.filas[0].v.motivo}/${r.filas[0].v.intentos_restantes}`, `incorrecto/${i}`, `fallo ${i}`);
    }
    let r = sinError(await servicio([["select api_factor_verificar($1, $2, $3, null, null) as v", [SUPER.correo, S1, hash("999999" + S1)]]]), "5.º");
    igual(r.filas[0].v.motivo, "agotado", "agotado");
    r = sinError(await servicio([["select api_factor_verificar($1, $2, $3, null, null) as v", [SUPER.correo, S1, hash(CODIGO + S1)]]]), "correcto tarde");
    igual(r.filas[0].v.ok, false, "agotado no admite el correcto");
  });
  await prueba("nuevo código tras 60 s: ok; el anterior queda inválido; el nuevo verifica y deja marca → nivel 99 y mi_segundo_factor verificado", async () => {
    await sql("update interno.factor_codigos set creado_en = creado_en - interval '61 seconds'");
    let r = sinError(await servicio([["select api_factor_emitir($1, $2, $3, '203.0.113.7', 'Ensayo') as v", [SUPER.correo, S1, hash("654321" + S1)]]]), "emitir");
    igual(r.filas[0].v.ok, true, "ok");
    const [c] = await sql("select count(*)::int as n from interno.factor_codigos where session_id = $1 and usado_en is null", [S1]); igual(c.n, 1, "un solo código vigente");
    r = sinError(await servicio([["select api_factor_verificar($1, $2, $3, '203.0.113.7', 'Ensayo') as v", [SUPER.correo, S1, hash("654321" + S1)]]]), "verificar");
    igual(r.filas[0].v.ok, true, "verificado");
    igual(await nivel(superS1), 99, "nivel");
    const m = sinError(await como("authenticated", { claims: superS1 }, [["select mi_segundo_factor() as f"]]), "mi_segundo_factor"); igual(m.filas[0].f.verificado, true, "verificado");
    const [a] = await sql("select count(*)::int as n from interno.auditoria where accion = 'FACTOR_VERIFICADO'"); igual(a.n, 1, "auditoría");
    const [u] = await sql("select count(*)::int as n from interno.factor_codigos where session_id = $1 and usado_en is null", [S1]); igual(u.n, 0, "código consumido");
  });
  await prueba("código vencido → vencido; marca vencida → 0 otra vez", async () => {
    sinError(await servicio([["select api_factor_emitir($1, $2, $3, null, null) as v", [SUPER.correo, S2, hash(CODIGO + S2)]]]), "emitir S2");
    await sql("update interno.factor_codigos set expira_en = now() - interval '1 second' where session_id = $1", [S2]);
    const r = sinError(await servicio([["select api_factor_verificar($1, $2, $3, null, null) as v", [SUPER.correo, S2, hash(CODIGO + S2)]]]), "vencido"); igual(r.filas[0].v.motivo, "vencido", "vencido");
    await sql("update interno.factor_sesiones set expira_en = now() - interval '1 second' where session_id = $1", [S1]);
    igual(await nivel(superS1), 0, "marca vencida");
    await sql("update interno.factor_sesiones set expira_en = now() + interval '1 hour' where session_id = $1", [S1]);
  });

  console.log("\n== 4 · Equipos recordados");
  const TOKEN = "token-de-ensayo-" + randomUUID();
  await prueba("crear exige sesión verificada (S2 sin marca → error); desde S1 verificado → ok", async () => {
    const r = await servicio([["select api_factor_dispositivo_crear($1, $2, $3, null, null)", [SUPER.correo, S2, hash(TOKEN)]]], false);
    if (!r.codigo) throw new Error("debió rechazar");
    sinError(await servicio([["select api_factor_dispositivo_crear($1, $2, $3, '203.0.113.7', 'Ensayo')", [SUPER.correo, S1, hash(TOKEN)]]]), "crear");
    const [d] = await sql("select count(*)::int as n from interno.dispositivos_confiables where token_hash = $1 and expira_en > now() + interval '29 days'", [hash(TOKEN)]); igual(d.n, 1, "30 días");
  });
  await prueba("usar el equipo desde una sesión nueva S3 → true, marca vía dispositivo, nivel 99; token desconocido → false", async () => {
    let r = sinError(await servicio([["select api_factor_dispositivo_usar($1, $2, $3, '203.0.113.7', 'Ensayo') as v", [SUPER.correo, S3, hash(TOKEN)]]]), "usar"); igual(r.filas[0].v, true, "usar");
    igual(await nivel(claims(SUPER.correo, SUPER.sub, S3)), 99, "nivel S3");
    const [m] = await sql("select via from interno.factor_sesiones where session_id = $1", [S3]); igual(m.via, "dispositivo", "vía");
    r = sinError(await servicio([["select api_factor_dispositivo_usar($1, $2, $3, null, null) as v", [SUPER.correo, S4, hash("otro")]]]), "otro"); igual(r.filas[0].v, false, "desconocido");
    igual(await nivel(claims(SUPER.correo, SUPER.sub, S4)), 0, "S4 sigue en 0");
  });
  await prueba("revocar → 1; el equipo deja de valer para S4; vencido tampoco vale", async () => {
    let r = sinError(await servicio([["select api_factor_dispositivos_revocar($1) as n", [SUPER.correo]]]), "revocar"); igual(r.filas[0].n, 1, "revocados");
    r = sinError(await servicio([["select api_factor_dispositivo_usar($1, $2, $3, null, null) as v", [SUPER.correo, S4, hash(TOKEN)]]]), "usar revocado"); igual(r.filas[0].v, false, "revocado");
    const [a] = await sql("select count(*)::int as n from interno.auditoria where accion in ('FACTOR_DISPOSITIVO', 'FACTOR_DISPOSITIVOS_REVOCADOS')"); igual(a.n, 2, "auditoría");
  });

  console.log("\n== 5 · Política y permisos");
  await prueba("guardar_politica (firma nueva) apaga y enciende el interruptor; la firma vieja ya no existe; v_politica_acceso lo expone", async () => {
    const args = (v) => `select guardar_politica(8, 30, false, true, 5, 15, 'whatsapp', 6, 10, 7, 'ensayo', ${v})`;
    let r = sinError(await como("authenticated", { claims: superS1, conservar: true }, [[args("false")], ['select "factorSuperadmin" as v from v_politica_acceso']]), "apagar"); igual(r.filas[0].v, false, "apagado");
    r = sinError(await como("authenticated", { claims: superS1, conservar: true }, [[args("true")], ['select "factorSuperadmin" as v from v_politica_acceso']]), "encender"); igual(r.filas[0].v, true, "encendido");
    r = sinError(await como("authenticated", { claims: superS1 }, [["select guardar_politica(8, 30, false, true, 5, 15, 'whatsapp', 6, 10, 7, 'ensayo')"], ['select "factorSuperadmin" as v from v_politica_acceso']]), "sin parámetro"); igual(r.filas[0].v, true, "sin parámetro conserva");
    const [f] = await sql("select to_regprocedure('public.guardar_politica(integer, integer, boolean, boolean, integer, integer, text, integer, integer, integer, text)') as vieja"); igual(f.vieja, null, "firma vieja");
  });
  await prueba("api_factor_* solo service_role; mi_segundo_factor solo authenticated; fn_factor_pendiente para nadie de la API; tablas sin acceso de la API", async () => {
    let r = await como("authenticated", { claims: superS1 }, [["select api_factor_dispositivos_revocar($1)", [SUPER.correo]]]); igual(r.codigo, "42501", "authenticated api_");
    r = await como("anon", { claims: { role: "anon" } }, [["select mi_segundo_factor()"]]); igual(r.codigo, "42501", "anon mi_segundo_factor");
    const [g] = await sql(`select bool_and(not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute') and has_function_privilege('service_role', f, 'execute')) as api,
      has_function_privilege('authenticated', 'public.fn_factor_pendiente()', 'execute') as pend,
      bool_and(not has_table_privilege('authenticated', 'interno.' || t, 'select') and not has_table_privilege('anon', 'interno.' || t, 'select')) as tablas
      from unnest(array['public.api_factor_emitir(text, uuid, text, text, text)', 'public.api_factor_verificar(text, uuid, text, text, text)', 'public.api_factor_dispositivo_crear(text, uuid, text, text, text)', 'public.api_factor_dispositivo_usar(text, uuid, text, text, text)', 'public.api_factor_dispositivos_revocar(text)']) f,
           unnest(array['factor_codigos', 'factor_sesiones', 'dispositivos_confiables']) t`);
    igual(`${g.api}/${g.pend}/${g.tablas}`, "true/false/true", "permisos");
  });

  console.log("\n== 6 · Reversión");
  await prueba("la reversión deja la foto idéntica a la inicial y el superadmin vuelve a valer 99 sin marca", async () => {
    await sql(REVERSION);
    const dif = compararFotos(foto0, await foto()); if (dif.length) throw new Error(dif.join("; "));
    igual(await nivel(superSin), 99, "hueco de vuelta (esperado)");
  });
  await prueba("la migración vuelve a aplicarse", async () => { await sql(MIGRACION); igual(await nivel(superSin), 0, "cerrado"); });
} finally {
  await bd.parar();
}
console.log(`\n${ok} verdes, ${fallos} fallo(s).`);
process.exit(fallos ? 1 : 0);
```

- [ ] **Step 2: Correr el ensayo y ver que falla**

Run: `node scripts/ensayar-factor.mjs`
Expected: falla al importar (`Cannot find module './factor-generar.mjs'`).

- [ ] **Step 3: Escribir el canónico `supabase/factor.sql`**

```sql
-- supabase/factor.sql — SEGUNDO FACTOR POR CORREO para el Superadministrador
-- (2026-09-28). Canónico. Lo embebe la migración
-- migraciones/2026-09-28-segundo-factor.sql y el bloque @@FACTOR@@ de
-- seguridad.sql (después de la fase 6). Idempotente. Se aplica con
-- search_path = public, interno, extensions.
--
--  1 · politica_acceso.factor_superadmin: interruptor (contingencia técnica).
--  2 · Tablas privadas: factor_codigos, factor_sesiones, dispositivos_confiables.
--  3 · fn_factor_pendiente + fn_nivel_modulo v4: un superadmin con JWT vale 0
--      hasta que su sesión (claim session_id) tenga marca vigente.
--  4 · v_politica_acceso y guardar_politica con el interruptor.
--  5 · mi_segundo_factor (el navegador consulta su estado).
--  6 · api_factor_* (solo service_role; las llama api/segundo-factor.js).

-- 1 · Interruptor ---------------------------------------------------------------
alter table interno.politica_acceso add column if not exists factor_superadmin boolean not null default true;

-- 2 · Tablas privadas -----------------------------------------------------------
create table if not exists interno.factor_codigos (
  id          bigint generated always as identity primary key,
  usuario_id  bigint not null references interno.usuarios_admin(id) on delete cascade,
  session_id  uuid not null,
  codigo_hash text not null,                 -- sha256(codigo || session_id), hex
  creado_en   timestamptz not null default now(),
  expira_en   timestamptz not null,          -- creado_en + 10 min
  intentos    int not null default 0,
  usado_en    timestamptz,
  ip          text,
  agente      text
);
create index if not exists factor_codigos_sesion_idx on interno.factor_codigos (session_id, creado_en desc);

create table if not exists interno.factor_sesiones (
  session_id    uuid primary key,
  usuario_id    bigint not null references interno.usuarios_admin(id) on delete cascade,
  verificado_en timestamptz not null default now(),
  expira_en     timestamptz not null,        -- verificado_en + sesion_backoffice_horas
  via           text not null check (via in ('correo', 'dispositivo')),
  ip            text,
  agente        text
);

create table if not exists interno.dispositivos_confiables (
  id          bigint generated always as identity primary key,
  usuario_id  bigint not null references interno.usuarios_admin(id) on delete cascade,
  token_hash  text not null unique,          -- sha256(token), hex
  creado_en   timestamptz not null default now(),
  expira_en   timestamptz not null,          -- creado_en + 30 días
  ultimo_uso  timestamptz,
  revocado_en timestamptz,
  ip          text,
  agente      text
);

alter table interno.factor_codigos enable row level security;
alter table interno.factor_sesiones enable row level security;
alter table interno.dispositivos_confiables enable row level security;
revoke all on table interno.factor_codigos, interno.factor_sesiones, interno.dispositivos_confiables from public, anon, authenticated, service_role;
revoke all on sequence interno.factor_codigos_id_seq, interno.dispositivos_confiables_id_seq from public, anon, authenticated, service_role;

-- 3 · Guarda ----------------------------------------------------------------------
-- true cuando la política exige el factor, el JWT trae correo de un superadmin
-- activo y su sesión no tiene marca vigente. Sin claim session_id → pendiente.
create or replace function public.fn_factor_pendiente() returns boolean
language plpgsql stable security definer set search_path = public, interno, extensions as $$
declare v_correo text; v_sesion uuid; v_exige boolean; v_usuario bigint;
begin
  select factor_superadmin into v_exige from politica_acceso where id = 1;
  if not coalesce(v_exige, true) then return false; end if;
  begin
    v_correo := nullif(lower(auth.jwt() ->> 'email'), '');
  exception when others then
    v_correo := null;
  end;
  if v_correo is null then return false; end if;
  select u.id into v_usuario
  from usuarios_admin u join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
  where lower(u.correo) = v_correo and u.estado = 'activo' and p.es_superadmin;
  if v_usuario is null then return false; end if;
  begin
    v_sesion := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when others then
    v_sesion := null;
  end;
  if v_sesion is null then return true; end if;
  return not exists (select 1 from factor_sesiones s
                     where s.session_id = v_sesion and s.usuario_id = v_usuario and s.expira_en > now());
end $$;
revoke all on function public.fn_factor_pendiente() from public, anon, authenticated;

-- v4 (2026-09-28): igual a la v3 (limites.sql, fase 6b) salvo la última regla:
-- un 99 por categoría se vuelve 0 mientras el segundo factor esté pendiente.
create or replace function public.fn_nivel_modulo(p_modulo text)
returns int language plpgsql stable security definer set search_path = public, interno, extensions as $$
declare v_correo text; v_nivel int; v_rol text;
begin
  begin
    v_correo := nullif(auth.jwt() ->> 'email', '');
  exception when others then
    v_correo := null;
  end;
  if v_correo is null then
    v_rol := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
                      nullif(current_setting('role', true), 'none'),
                      session_user::text);
    if v_rol in ('authenticated', 'anon') then return 0; end if;
    if v_rol in ('postgres', 'service_role', 'supabase_admin') then return 99; end if;
    return 0;
  end if;
  select case when p.es_superadmin then 99
              else coalesce((select pp.nivel from perfil_permisos pp
                             where pp.perfil_id = u.perfil_id
                               and pp.perfil_version = u.perfil_version
                               and pp.modulo = p_modulo), 0) end
  into v_nivel
  from usuarios_admin u
  join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
  where lower(u.correo) = lower(v_correo) and u.estado = 'activo';
  -- Segundo factor (2026-09-28): superadmin sin verificar → 0 en toda la base.
  if coalesce(v_nivel, 0) = 99 and fn_factor_pendiente() then return 0; end if;
  return coalesce(v_nivel, 0);
end $$;

-- 4 · Política ---------------------------------------------------------------------
create or replace view public.v_politica_acceso as
select sesion_backoffice_horas as "sesionBackofficeHoras",
       sesion_portal_dias      as "sesionPortalDias",
       multisesion_backoffice  as "multisesionBackoffice",
       multisesion_portal      as "multisesionPortal",
       intentos_bloqueo        as "intentosBloqueo",
       bloqueo_minutos         as "bloqueoMinutos",
       recuperacion_defecto    as "recuperacionDefecto",
       clave_longitud_min_portal     as "claveLongitudMinPortal",
       clave_longitud_min_backoffice as "claveLongitudMinBackoffice",
       clave_provisional_dias  as "claveProvisionalDias",
       to_char(actualizado_en, 'YYYY-MM-DD HH24:MI') as actualizado,
       actualizado_por as "actualizadoPor",
       factor_superadmin as "factorSuperadmin"
from interno.politica_acceso where id = 1;
alter view public.v_politica_acceso set (security_invoker = on);
revoke all on public.v_politica_acceso from anon, public;
grant select on public.v_politica_acceso to authenticated, service_role;

drop function if exists public.guardar_politica(integer, integer, boolean, boolean, integer, integer, text, integer, integer, integer, text);
create or replace function public.guardar_politica(
  p_backoffice_horas int, p_portal_dias int,
  p_multisesion_backoffice boolean, p_multisesion_portal boolean,
  p_intentos int, p_bloqueo_min int, p_recuperacion text,
  p_clave_min_portal int, p_clave_min_backoffice int,
  p_provisional_dias int, p_por text,
  p_factor_superadmin boolean default null
) returns void language plpgsql security definer set search_path = public, interno, extensions as $$
begin
  perform requiere_superadmin();  -- fase 1: guarda central
  if coalesce(p_clave_min_backoffice, 0) < 10 then raise exception 'La clave del BackOffice exige al menos 10 caracteres (P11).'; end if;
  if coalesce(p_clave_min_portal, 0) < 6 then raise exception 'La clave del Portal exige al menos 6 caracteres.'; end if;
  update politica_acceso
  set sesion_backoffice_horas       = p_backoffice_horas,
      sesion_portal_dias            = p_portal_dias,
      multisesion_backoffice        = p_multisesion_backoffice,
      multisesion_portal            = p_multisesion_portal,
      intentos_bloqueo              = p_intentos,
      bloqueo_minutos               = p_bloqueo_min,
      recuperacion_defecto          = p_recuperacion,
      clave_longitud_min_portal     = p_clave_min_portal,
      clave_longitud_min_backoffice = p_clave_min_backoffice,
      clave_provisional_dias        = p_provisional_dias,
      factor_superadmin             = coalesce(p_factor_superadmin, factor_superadmin),
      actualizado_por               = p_por,
      actualizado_en                = now()
  where id = 1;
end $$;
revoke all on function public.guardar_politica(integer, integer, boolean, boolean, integer, integer, text, integer, integer, integer, text, boolean) from public, anon;
grant execute on function public.guardar_politica(integer, integer, boolean, boolean, integer, integer, text, integer, integer, integer, text, boolean) to authenticated;

-- 5 · Estado propio (lo único que el navegador consulta) ----------------------------
create or replace function public.mi_segundo_factor() returns jsonb
language plpgsql stable security definer set search_path = public, interno, extensions as $$
declare v_correo text := correo_llamador(); v_sesion uuid; v_usuario bigint; v_super boolean; v_exige boolean; v_expira timestamptz;
begin
  if v_correo is null then raise insufficient_privilege using message = 'Sesión requerida.'; end if;
  select u.id, p.es_superadmin into v_usuario, v_super
  from usuarios_admin u join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
  where lower(u.correo) = v_correo and u.estado = 'activo';
  if v_usuario is null then raise insufficient_privilege using message = 'No eres un usuario administrativo activo.'; end if;
  select factor_superadmin into v_exige from politica_acceso where id = 1;
  begin
    v_sesion := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when others then
    v_sesion := null;
  end;
  select s.expira_en into v_expira from factor_sesiones s
  where s.session_id = v_sesion and s.usuario_id = v_usuario and s.expira_en > now();
  return jsonb_build_object(
    'esSuperadmin', v_super,
    'exigido', v_super and coalesce(v_exige, true),
    'verificado', v_expira is not null,
    'expiraEn', v_expira,
    'correo', regexp_replace(v_correo, '^(.)[^@]*(@.*)$', '\1•••\2'));
end $$;
revoke all on function public.mi_segundo_factor() from public, anon;
grant execute on function public.mi_segundo_factor() to authenticated;

-- 6 · Funciones de servicio (api/segundo-factor.js, llave de servicio) ----------------
-- La identidad (p_correo) la validó el endpoint contra GoTrue; p_session_id es
-- el claim de ese token ya validado. El navegador jamás ejecuta estas funciones.
create or replace function public.api_factor_emitir(p_correo text, p_session_id uuid, p_codigo_hash text, p_ip text, p_agente text) returns jsonb
language plpgsql security definer set search_path = public, interno, extensions as $$
declare v_usuario bigint; v_super boolean; v_exige boolean; v_ultimo timestamptz; v_expira timestamptz;
begin
  select u.id, p.es_superadmin into v_usuario, v_super
  from usuarios_admin u join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
  where lower(u.correo) = lower(coalesce(p_correo, '')) and u.estado = 'activo';
  if v_usuario is null or not v_super then return jsonb_build_object('ok', false, 'motivo', 'no_superadmin'); end if;
  select factor_superadmin into v_exige from politica_acceso where id = 1;
  if not coalesce(v_exige, true) then return jsonb_build_object('ok', false, 'motivo', 'apagado'); end if;
  if p_session_id is null or coalesce(p_codigo_hash, '') = '' then return jsonb_build_object('ok', false, 'motivo', 'datos'); end if;
  delete from factor_codigos where usuario_id = v_usuario and expira_en < now();  -- limpieza perezosa
  select max(creado_en) into v_ultimo from factor_codigos where session_id = p_session_id and usuario_id = v_usuario;
  if v_ultimo is not null and v_ultimo > now() - interval '60 seconds' then
    return jsonb_build_object('ok', false, 'motivo', 'espera',
      'espera_seg', greatest(1, ceil(extract(epoch from (v_ultimo + interval '60 seconds' - now())))::int));
  end if;
  update factor_codigos set usado_en = now() where session_id = p_session_id and usuario_id = v_usuario and usado_en is null;
  v_expira := now() + interval '10 minutes';
  insert into factor_codigos (usuario_id, session_id, codigo_hash, expira_en, ip, agente)
  values (v_usuario, p_session_id, p_codigo_hash, v_expira, p_ip, p_agente);
  return jsonb_build_object('ok', true, 'expira_en', v_expira);
end $$;

create or replace function public.api_factor_verificar(p_correo text, p_session_id uuid, p_codigo_hash text, p_ip text, p_agente text) returns jsonb
language plpgsql security definer set search_path = public, interno, extensions as $$
declare v_usuario bigint; v_super boolean; c record; v_horas int; v_expira timestamptz;
begin
  select u.id, p.es_superadmin into v_usuario, v_super
  from usuarios_admin u join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
  where lower(u.correo) = lower(coalesce(p_correo, '')) and u.estado = 'activo';
  if v_usuario is null or not v_super then return jsonb_build_object('ok', false, 'motivo', 'no_superadmin'); end if;
  select * into c from factor_codigos
  where session_id = p_session_id and usuario_id = v_usuario and usado_en is null
  order by creado_en desc limit 1;
  if c.id is null or c.expira_en <= now() then return jsonb_build_object('ok', false, 'motivo', 'vencido'); end if;
  if c.intentos >= 5 then return jsonb_build_object('ok', false, 'motivo', 'agotado', 'intentos_restantes', 0); end if;
  if c.codigo_hash <> coalesce(p_codigo_hash, '') then
    update factor_codigos set intentos = intentos + 1 where id = c.id;
    if c.intentos + 1 >= 5 then return jsonb_build_object('ok', false, 'motivo', 'agotado', 'intentos_restantes', 0); end if;
    return jsonb_build_object('ok', false, 'motivo', 'incorrecto', 'intentos_restantes', 5 - (c.intentos + 1));
  end if;
  update factor_codigos set usado_en = now() where id = c.id;
  select sesion_backoffice_horas into v_horas from politica_acceso where id = 1;
  v_expira := now() + make_interval(hours => coalesce(v_horas, 8));
  delete from factor_sesiones where usuario_id = v_usuario and expira_en < now();  -- limpieza perezosa
  insert into factor_sesiones (session_id, usuario_id, expira_en, via, ip, agente)
  values (p_session_id, v_usuario, v_expira, 'correo', p_ip, p_agente)
  on conflict (session_id) do update
    set usuario_id = excluded.usuario_id, verificado_en = now(), expira_en = excluded.expira_en, via = 'correo', ip = excluded.ip, agente = excluded.agente;
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('FACTOR_VERIFICADO', 'factor_sesiones', null, jsonb_build_object('usuario_id', v_usuario, 'via', 'correo', 'ip', p_ip, 'expira_en', v_expira));
  return jsonb_build_object('ok', true, 'expira_en', v_expira);
end $$;

create or replace function public.api_factor_dispositivo_crear(p_correo text, p_session_id uuid, p_token_hash text, p_ip text, p_agente text) returns void
language plpgsql security definer set search_path = public, interno, extensions as $$
declare v_usuario bigint;
begin
  select u.id into v_usuario from usuarios_admin u join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
  where lower(u.correo) = lower(coalesce(p_correo, '')) and u.estado = 'activo' and p.es_superadmin;
  if v_usuario is null then raise exception 'No es un superadministrador activo.'; end if;
  if coalesce(p_token_hash, '') = '' then raise exception 'Falta el token.'; end if;
  if not exists (select 1 from factor_sesiones s where s.session_id = p_session_id and s.usuario_id = v_usuario and s.expira_en > now()) then
    raise exception 'La sesión no ha verificado el código.';
  end if;
  insert into dispositivos_confiables (usuario_id, token_hash, expira_en, ip, agente)
  values (v_usuario, p_token_hash, now() + interval '30 days', p_ip, p_agente);
end $$;

create or replace function public.api_factor_dispositivo_usar(p_correo text, p_session_id uuid, p_token_hash text, p_ip text, p_agente text) returns boolean
language plpgsql security definer set search_path = public, interno, extensions as $$
declare v_usuario bigint; v_id bigint; v_horas int; v_expira timestamptz;
begin
  select u.id into v_usuario from usuarios_admin u join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
  where lower(u.correo) = lower(coalesce(p_correo, '')) and u.estado = 'activo' and p.es_superadmin;
  if v_usuario is null or p_session_id is null then return false; end if;
  select d.id into v_id from dispositivos_confiables d
  where d.token_hash = coalesce(p_token_hash, '') and d.usuario_id = v_usuario and d.revocado_en is null and d.expira_en > now();
  if v_id is null then return false; end if;
  update dispositivos_confiables set ultimo_uso = now() where id = v_id;
  select sesion_backoffice_horas into v_horas from politica_acceso where id = 1;
  v_expira := now() + make_interval(hours => coalesce(v_horas, 8));
  insert into factor_sesiones (session_id, usuario_id, expira_en, via, ip, agente)
  values (p_session_id, v_usuario, v_expira, 'dispositivo', p_ip, p_agente)
  on conflict (session_id) do update
    set usuario_id = excluded.usuario_id, verificado_en = now(), expira_en = excluded.expira_en, via = 'dispositivo', ip = excluded.ip, agente = excluded.agente;
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('FACTOR_DISPOSITIVO', 'factor_sesiones', null, jsonb_build_object('usuario_id', v_usuario, 'dispositivo_id', v_id, 'ip', p_ip, 'expira_en', v_expira));
  return true;
end $$;

create or replace function public.api_factor_dispositivos_revocar(p_correo text) returns int
language plpgsql security definer set search_path = public, interno, extensions as $$
declare v_usuario bigint; n int;
begin
  select u.id into v_usuario from usuarios_admin u where lower(u.correo) = lower(coalesce(p_correo, '')) and u.estado = 'activo';
  if v_usuario is null then return 0; end if;
  update dispositivos_confiables set revocado_en = now()
  where usuario_id = v_usuario and revocado_en is null and expira_en > now();
  get diagnostics n = row_count;
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values ('FACTOR_DISPOSITIVOS_REVOCADOS', 'dispositivos_confiables', null, jsonb_build_object('usuario_id', v_usuario, 'revocados', n));
  return n;
end $$;

revoke all on function
  public.api_factor_emitir(text, uuid, text, text, text),
  public.api_factor_verificar(text, uuid, text, text, text),
  public.api_factor_dispositivo_crear(text, uuid, text, text, text),
  public.api_factor_dispositivo_usar(text, uuid, text, text, text),
  public.api_factor_dispositivos_revocar(text)
from public, anon, authenticated;
grant execute on function
  public.api_factor_emitir(text, uuid, text, text, text),
  public.api_factor_verificar(text, uuid, text, text, text),
  public.api_factor_dispositivo_crear(text, uuid, text, text, text),
  public.api_factor_dispositivo_usar(text, uuid, text, text, text),
  public.api_factor_dispositivos_revocar(text)
to service_role;
```

- [ ] **Step 4: Escribir el generador `scripts/factor-generar.mjs`**

```js
// scripts/factor-generar.mjs — Segundo factor por correo (2026-09-28).
// Canónico: supabase/factor.sql. Genera:
//   supabase/migraciones/2026-09-28-segundo-factor.sql (una transacción; respalda
//     fn_nivel_modulo, guardar_politica y v_politica_acceso en interno.respaldo_factor;
//     verificación embebida)
//   supabase/respaldos/2026-09-28-segundo-factor-reversion.sql
//   bloque @@FACTOR-INICIO@@ … @@FACTOR-FIN@@ de supabase/seguridad.sql
// Uso: node scripts/factor-generar.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const FECHA = "2026-09-28";
export const GUARDAR_POLITICA_VIEJA = "public.guardar_politica(integer, integer, boolean, boolean, integer, integer, text, integer, integer, integer, text)";
export const GUARDAR_POLITICA_NUEVA = "public.guardar_politica(integer, integer, boolean, boolean, integer, integer, text, integer, integer, integer, text, boolean)";
// Funciones que la fase reescribe (se respaldan y la reversión las restaura).
export const FUNCIONES = ["public.fn_nivel_modulo(text)", GUARDAR_POLITICA_VIEJA];
export const FUNCIONES_NUEVAS = [
  "public.fn_factor_pendiente()", "public.mi_segundo_factor()",
  "public.api_factor_emitir(text, uuid, text, text, text)", "public.api_factor_verificar(text, uuid, text, text, text)",
  "public.api_factor_dispositivo_crear(text, uuid, text, text, text)", "public.api_factor_dispositivo_usar(text, uuid, text, text, text)",
  "public.api_factor_dispositivos_revocar(text)",
];
export const TABLAS = ["factor_codigos", "factor_sesiones", "dispositivos_confiables"];
const CANONICO = readFileSync("supabase/factor.sql", "utf8");
const lista = (arr) => arr.map((x) => `'${x}'`).join(", ");

export const MIGRACION = `-- supabase/migraciones/${FECHA}-segundo-factor.sql
-- SEGUNDO FACTOR POR CORREO para el Superadministrador.
-- GENERADA por scripts/factor-generar.mjs a partir de supabase/factor.sql.
-- UNA transacción. Reversión: supabase/respaldos/${FECHA}-segundo-factor-reversion.sql.
-- Requiere la fase 6b aplicada. ORDEN: aplicar ANTES del deploy del cliente
-- (con el cliente viejo un superadmin queda en nivel 0 sin pantalla para
-- verificar; con el cliente nuevo y sin migración, mi_segundo_factor no existe
-- y el cliente entra sin factor). Por eso migración → push, uno tras otro.
begin;
set local search_path = public, interno, extensions;

do $$
begin
  if to_regprocedure('public.api_login_permitido(text, text)') is null then raise exception 'factor: se esperaba la fase 6b aplicada (api_login_permitido)'; end if;
  if to_regclass('interno.respaldo_factor') is not null then raise exception 'factor: interno.respaldo_factor ya existe (¿migración aplicada?)'; end if;
end $$;
create table interno.respaldo_factor (objeto text primary key, definicion text not null);
revoke all on table interno.respaldo_factor from public, anon, authenticated;
insert into interno.respaldo_factor
  select 'fn:' || f, pg_get_functiondef(f::regprocedure) from unnest(array[${lista(FUNCIONES)}]) as f;
insert into interno.respaldo_factor
  select 'acl:' || f, coalesce(p.proacl::text, '') from unnest(array[${lista(FUNCIONES)}]) as f join pg_proc p on p.oid = f::regprocedure;
insert into interno.respaldo_factor
  select 'view:v_politica_acceso', pg_get_viewdef('public.v_politica_acceso'::regclass, true);
insert into interno.respaldo_factor
  select 'acl:view:v_politica_acceso', coalesce(relacl::text, '') from pg_class where oid = 'public.v_politica_acceso'::regclass;

${CANONICO}
-- Verificación embebida.
do $$
declare v jsonb; v_correo text;
begin
  if not exists (select 1 from pg_attribute where attrelid = 'interno.politica_acceso'::regclass and attname = 'factor_superadmin' and not attisdropped) then raise exception 'factor: falta politica_acceso.factor_superadmin'; end if;
  if (select factor_superadmin from interno.politica_acceso where id = 1) is not true then raise exception 'factor: el interruptor no quedó encendido'; end if;
  if (select prosrc from pg_proc where oid = 'public.fn_nivel_modulo(text)'::regprocedure) !~ 'fn_factor_pendiente' then raise exception 'factor: fn_nivel_modulo no consulta fn_factor_pendiente'; end if;
  if to_regprocedure('${GUARDAR_POLITICA_VIEJA}') is not null then raise exception 'factor: la firma vieja de guardar_politica sigue'; end if;
  if not has_function_privilege('authenticated', '${GUARDAR_POLITICA_NUEVA}', 'execute') then raise exception 'factor: authenticated no ejecuta guardar_politica nueva'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'v_politica_acceso' and column_name = 'factorSuperadmin') then raise exception 'factor: v_politica_acceso sin factorSuperadmin'; end if;
  if not has_table_privilege('authenticated', 'public.v_politica_acceso', 'select') then raise exception 'factor: authenticated perdió v_politica_acceso'; end if;
  if not has_function_privilege('authenticated', 'public.mi_segundo_factor()', 'execute') then raise exception 'factor: authenticated no ejecuta mi_segundo_factor'; end if;
  if has_function_privilege('anon', 'public.mi_segundo_factor()', 'execute') then raise exception 'factor: anon ejecuta mi_segundo_factor'; end if;
  if has_function_privilege('authenticated', 'public.fn_factor_pendiente()', 'execute') then raise exception 'factor: authenticated ejecuta fn_factor_pendiente'; end if;
  if exists (select 1 from unnest(array[${lista(FUNCIONES_NUEVAS.filter((f) => f.startsWith("public.api_")))}]) f
             where has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') or not has_function_privilege('service_role', f, 'execute')) then raise exception 'factor: api_factor_* mal concedida'; end if;
  if exists (select 1 from unnest(array[${lista(TABLAS)}]) t
             where to_regclass('interno.' || t) is null or has_table_privilege('authenticated', 'interno.' || t, 'select') or has_table_privilege('anon', 'interno.' || t, 'select')
                or not (select relrowsecurity from pg_class where oid = to_regclass('interno.' || t))) then raise exception 'factor: tabla ausente o abierta a la API'; end if;
  if fn_nivel_modulo('accesos') <> 99 then raise exception 'factor: la sesión de migración (postgres, sin JWT) debería valer 99 y vale %', fn_nivel_modulo('accesos'); end if;
  -- Comportamiento: un superadmin real con JWT y sin marca vale 0 (claims simulados y limpiados aquí mismo).
  select u.correo into v_correo from interno.usuarios_admin u join interno.perfiles p on p.id = u.perfil_id and p.version = u.perfil_version where u.estado = 'activo' and p.es_superadmin order by u.id limit 1;
  if v_correo is not null then
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_correo, 'session_id', '00000000-0000-4000-8000-0000000000fa')::text, true);
    if fn_nivel_modulo('accesos') <> 0 then raise exception 'factor: el superadmin % sin marca debería valer 0', v_correo; end if;
    v := mi_segundo_factor();
    if (v ->> 'exigido')::boolean is not true or (v ->> 'verificado')::boolean is not false then raise exception 'factor: mi_segundo_factor inesperado: %', v; end if;
    perform set_config('request.jwt.claims', '', true);
  end if;
end $$;
commit;
`;

export const REVERSION = `-- supabase/respaldos/${FECHA}-segundo-factor-reversion.sql
-- Reversión del segundo factor: retira funciones y tablas nuevas, restaura
-- fn_nivel_modulo (v3) y guardar_politica (firma vieja, con EXECUTE para
-- authenticated) desde interno.respaldo_factor, devuelve v_politica_acceso a
-- su definición anterior y quita la columna del interruptor.
begin;
set local search_path = public, interno, extensions;
${FUNCIONES_NUEVAS.map((f) => `drop function if exists ${f};`).join("\n")}
drop function if exists ${GUARDAR_POLITICA_NUEVA};
do $$ declare r record; begin
  for r in select objeto, definicion from interno.respaldo_factor where objeto like 'fn:%' loop execute r.definicion; end loop;
end $$;
grant execute on function public.fn_nivel_modulo(text), ${GUARDAR_POLITICA_VIEJA} to authenticated;
drop view if exists public.v_politica_acceso;
alter table interno.politica_acceso drop column if exists factor_superadmin;
do $$ declare r record; begin
  select definicion into r from interno.respaldo_factor where objeto = 'view:v_politica_acceso';
  execute 'create view public.v_politica_acceso with (security_invoker = on) as ' || r.definicion;
end $$;
revoke all on public.v_politica_acceso from anon, public;
grant select on public.v_politica_acceso to authenticated, service_role;
drop table if exists ${TABLAS.map((t) => `interno.${t}`).join(", ")};
drop table interno.respaldo_factor;
do $$ begin
  if to_regclass('interno.factor_sesiones') is not null then raise exception 'reversión factor: factor_sesiones sigue existiendo'; end if;
  if (select prosrc from pg_proc where oid = 'public.fn_nivel_modulo(text)'::regprocedure) ~ 'fn_factor_pendiente' then raise exception 'reversión factor: fn_nivel_modulo sigue en v4'; end if;
  if to_regprocedure('${GUARDAR_POLITICA_VIEJA}') is null then raise exception 'reversión factor: guardar_politica vieja no volvió'; end if;
  if to_regprocedure('public.mi_segundo_factor()') is not null then raise exception 'reversión factor: mi_segundo_factor sigue existiendo'; end if;
end $$;
commit;
`;

export const ESPEJO = `-- @@FACTOR-INICIO@@ (generado por scripts/factor-generar.mjs desde supabase/factor.sql; no editar a mano)
-- 15 · Segundo factor por correo para el Superadministrador: nivel 0 hasta verificar la sesión; códigos, marcas y equipos recordados en interno; funciones de servicio para api/segundo-factor.js.
${CANONICO}
-- @@FACTOR-FIN@@`;

export const sinFactor = (texto) => texto.replace(/-- @@FACTOR-INICIO@@[\s\S]*?-- @@FACTOR-FIN@@\n?/g, "");

const esPrincipal = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esPrincipal) {
  writeFileSync(`supabase/migraciones/${FECHA}-segundo-factor.sql`, MIGRACION);
  writeFileSync(`supabase/respaldos/${FECHA}-segundo-factor-reversion.sql`, REVERSION);
  const ruta = "supabase/seguridad.sql";
  const actual = readFileSync(ruta, "utf8");
  const propio = /-- @@FACTOR-INICIO@@[\s\S]*?-- @@FACTOR-FIN@@\n?/;
  writeFileSync(ruta, propio.test(actual) ? actual.replace(propio, () => `${ESPEJO}\n`) : `${actual.replace(/\s+$/, "")}\n\n${ESPEJO}\n`);
  console.log("Generados: migración segundo-factor, reversión y bloque @@FACTOR@@ de seguridad.sql.");
}
```

Ojo con `writeFileSync(ruta, … actual.replace(propio, () => …))`: se usa función de reemplazo a propósito (lección del proyecto: `String.replace` con texto convierte `$$` en `$`).

- [ ] **Step 5: `sinFase6` también recorta el bloque `@@FACTOR@@`**

En `scripts/fase6-generar.mjs`, reemplazar la línea

```js
export const sinFase6 = (texto) => texto.replace(/-- @@FASE[6-9][A-Z]?-INICIO@@[\s\S]*?-- @@FASE[6-9][A-Z]?-FIN@@\n?/g, "");
```

por

```js
// Recorta la fase 6 y todo lo posterior (fases 7-9 y el bloque @@FACTOR@@ del
// segundo factor, 2026-09-28): así ensayar-fase6 parte del estado de la fase 5.
export const sinFase6 = (texto) => texto.replace(/-- @@(FASE[6-9][A-Z]?|FACTOR)-INICIO@@[\s\S]*?-- @@\1-FIN@@\n?/g, "");
```

- [ ] **Step 6: Generar migración, reversión y espejo**

Run: `node scripts/factor-generar.mjs`
Expected: `Generados: migración segundo-factor, reversión y bloque @@FACTOR@@ de seguridad.sql.` y `git status` muestra `supabase/seguridad.sql` modificado (bloque nuevo al final) más los dos archivos generados.

- [ ] **Step 7: Correr el ensayo hasta verde**

Run: `node scripts/ensayar-factor.mjs`
Expected: todas las pruebas `✓` y `N verdes, 0 fallo(s)`. Si «la reversión deja la foto idéntica» falla con `difiere: view:v_politica_acceso`, la diferencia está en el ACL de la vista: iguala los `revoke`/`grant` de la reversión a lo que imprime la foto inicial (la foto muestra `relacl`). Si falla `fn:public.guardar_politica(...)` por ACL, ajusta el `grant execute … to authenticated` de la reversión. No toques el canónico para cuadrar la reversión.

- [ ] **Step 8: Regresión del canon completo (lo que corre el CI)**

Run: `node scripts/ensayar-canon.mjs`
Expected: verde. El invariante «api_* (servicio) solo para service_role» ahora cuenta 13 funciones. Si falla «toda SECURITY DEFINER con search_path fijo», revisa que cada función de `factor.sql` lleve `set search_path = public, interno, extensions`.

Run: `node scripts/ensayar-fase6.mjs`
Expected: verde (gracias al `sinFase6` del Step 5).

- [ ] **Step 9: Commit**

```bash
git add supabase/factor.sql supabase/seguridad.sql supabase/migraciones/2026-09-28-segundo-factor.sql supabase/respaldos/2026-09-28-segundo-factor-reversion.sql scripts/factor-generar.mjs scripts/ensayar-factor.mjs scripts/fase6-generar.mjs
git commit -m "seguridad(factor): canónico del segundo factor por correo, migración con reversión y ensayo local

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Invariante en CI, lista «nadie» de la fase 4 y orden de canónicos

**Files:**
- Modify: `scripts/ensayar-canon.mjs` (antes del `} finally {`, después de la prueba `corregir_fecha_ingreso`)
- Modify: `scripts/fase4-generar.mjs:95` (`SIN_POLITICA`)
- Modify: `supabase/MODELO.md:6-20` (orden de aplicación)
- Modify: `scripts/pg-local.mjs:18-19` (comentario de cabecera)

**Interfaces:**
- Consumes: tablas y funciones de Task 1.
- Produces: nada nuevo; `SIN_POLITICA` con 6 entradas (lo usan `verificar-fase4.mjs` y `ensayar-fase4.mjs`).

- [ ] **Step 1: Añadir el invariante a `scripts/ensayar-canon.mjs`**

Pegar antes de `} finally {`:

```js
  console.log("\n== Segundo factor (2026-09-28) · el superadmin vale 0 hasta verificar la sesión");
  await prueba("tablas de interno cerradas a la API; api_factor_* solo service_role; mi_segundo_factor solo authenticated; fn_nivel_modulo v4; interruptor encendido y expuesto en v_politica_acceso", async () => {
    const [t] = await sql(`select bool_and(to_regclass('interno.' || t) is not null and (select relrowsecurity from pg_class where oid = to_regclass('interno.' || t))
        and not has_table_privilege('authenticated', 'interno.' || t, 'select') and not has_table_privilege('anon', 'interno.' || t, 'select')) as ok
      from unnest(array['factor_codigos', 'factor_sesiones', 'dispositivos_confiables']) t`);
    igual(t.ok, true, "tablas");
    const [g] = await sql(`select has_function_privilege('authenticated', 'public.mi_segundo_factor()', 'execute') as mio,
      has_function_privilege('anon', 'public.mi_segundo_factor()', 'execute') as mio_anon,
      has_function_privilege('authenticated', 'public.fn_factor_pendiente()', 'execute') as pend,
      ((select prosrc from pg_proc where oid = 'public.fn_nivel_modulo(text)'::regprocedure) ~ 'fn_factor_pendiente') as v4,
      (select factor_superadmin from interno.politica_acceso where id = 1) as pol,
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'v_politica_acceso' and column_name = 'factorSuperadmin') as vista,
      to_regprocedure('public.guardar_politica(integer, integer, boolean, boolean, integer, integer, text, integer, integer, integer, text)') is null as vieja_fuera`);
    igual(`${g.mio}/${g.mio_anon}/${g.pend}/${g.v4}/${g.pol}/${g.vista}/${g.vieja_fuera}`, "true/false/false/true/true/true/true", "guarda");
  });
  await prueba("con claims de superadmin: sin marca → 0; con marca vigente → 99; con la política apagada → 99 (todo en una transacción que se revierte)", async () => {
    await sql("begin");
    try {
      await sql(`insert into public.personas (dni, nombre) values ('ZZFACTOR1', 'ZZ FACTOR CANON')`);
      const [pf] = await sql(`select id, version from interno.perfiles where es_superadmin and estado = 'activo' order by version desc limit 1`);
      await sql(`insert into interno.usuarios_admin (persona_dni, perfil_id, perfil_version, correo, creado_por) values ('ZZFACTOR1', '${pf.id}', ${pf.version}, 'zzfactor@ejemplo.invalido', 'ensayar-canon')`);
      await sql("grant execute on function public.fn_nivel_modulo(text) to authenticated");
      const claims = (sid) => `select set_config('request.jwt.claims', '${JSON.stringify({ role: "authenticated", email: "zzfactor@ejemplo.invalido", session_id: sid })}', true)`;
      const SID = "00000000-0000-4000-8000-0000000000fa";
      await sql("savepoint s1"); await sql("set local role authenticated"); await sql(claims(SID));
      let [r] = await sql("select fn_nivel_modulo('accesos') as n"); await sql("rollback to savepoint s1");
      igual(r.n, 0, "sin marca");
      await sql(`insert into interno.factor_sesiones (session_id, usuario_id, expira_en, via) select '${SID}', id, now() + interval '5 minutes', 'correo' from interno.usuarios_admin where correo = 'zzfactor@ejemplo.invalido'`);
      await sql("savepoint s2"); await sql("set local role authenticated"); await sql(claims(SID));
      [r] = await sql("select fn_nivel_modulo('accesos') as n"); await sql("rollback to savepoint s2");
      igual(r.n, 99, "con marca");
      await sql("update interno.politica_acceso set factor_superadmin = false where id = 1");
      await sql("savepoint s3"); await sql("set local role authenticated"); await sql(claims("00000000-0000-4000-8000-0000000000fb"));
      [r] = await sql("select fn_nivel_modulo('accesos') as n"); await sql("rollback to savepoint s3");
      igual(r.n, 99, "política apagada");
    } finally { await sql("rollback"); }
  });
```

Actualizar además la cabecera del archivo (comentario) con una línea:

```js
//   · 2026-09-28: segundo factor por correo (superadmin con JWT vale 0 hasta
//     verificar; api_factor_* solo service_role; interruptor en la política).
```

- [ ] **Step 2: Correr el canon**

Run: `node scripts/ensayar-canon.mjs`
Expected: verde, incluidas las dos pruebas nuevas.

- [ ] **Step 3: `SIN_POLITICA` de la fase 4**

En `scripts/fase4-generar.mjs:95` dejar:

```js
export const SIN_POLITICA = ["public.correo_envios", "public.solicitud_correlativos", "interno.correo_tokens",
  // Segundo factor (2026-09-28): solo las funciones definer las tocan; nadie de la API las lee.
  "interno.factor_codigos", "interno.factor_sesiones", "interno.dispositivos_confiables"];
```

Run: `node scripts/ensayar-fase4.mjs`
Expected: verde (o el mismo resultado que antes del cambio; este ensayo parte del estado de la fase 3 y no ve las tablas nuevas).

- [ ] **Step 4: Documentar el orden en `supabase/MODELO.md` y `scripts/pg-local.mjs`**

En `supabase/MODELO.md`, en el párrafo «Orden de aplicación en un reset», cambiar «0, 0b, 1, 2, 3a, 3b, 3c, 4, 5a y 6b, cada una con su canónico: `bancario.sql`, `claves-equipos.sql`, `rls.sql`, `auditoria.sql`, `limites.sql`;» por «0, 0b, 1, 2, 3a, 3b, 3c, 4, 5a, 6b y el segundo factor por correo (2026-09-28), cada una con su canónico: `bancario.sql`, `claves-equipos.sql`, `rls.sql`, `auditoria.sql`, `limites.sql`, `factor.sql`;». Y en la sección de seguridad del mismo archivo añadir el punto:

```
- **Segundo factor por correo (2026-09-28):** un Superadministrador con JWT vale nivel 0 en toda la base hasta que su sesión (claim `session_id`) tenga marca vigente en `interno.factor_sesiones` (`fn_nivel_modulo` v4 → `fn_factor_pendiente`). Códigos (`interno.factor_codigos`, sha256(código‖session_id), 10 min, 5 intentos) y equipos recordados (`interno.dispositivos_confiables`, 30 días) solo los escriben `api_factor_*` (service_role) desde `api/segundo-factor.js`. Interruptor `politica_acceso.factor_superadmin`. Canónico `factor.sql`; informe `docs/seguridad/2026-09-28-segundo-factor.md`.
```

En `scripts/pg-local.mjs` líneas 18-19 (comentario de cabecera) añadir `api-servicio.sql` a la lista de canónicos que menciona y la frase «`seguridad.sql` incluye al final el bloque @@FACTOR@@ (segundo factor, canónico `factor.sql`)».

- [ ] **Step 5: Commit**

```bash
git add scripts/ensayar-canon.mjs scripts/fase4-generar.mjs supabase/MODELO.md scripts/pg-local.mjs
git commit -m "seguridad(factor): invariante del segundo factor en la regresión del canon; tablas nuevas en la lista «nadie»; orden documentado

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `claimDeSesion` y helper de compuerta `api/_factor.js`

**Files:**
- Modify: `api/_clave.js` (después de `correoDeSesion`)
- Create: `api/_factor.js`
- Create: `tests/api/factor.test.js`

**Interfaces:**
- Produces: `claimDeSesion(jwt, nombre) → string` (vacío si falta); `factorPendiente(jwt) → Promise<boolean>` (true = bloquear; fallo cerrado salvo función ausente `PGRST202`).

- [ ] **Step 1: Prueba que falla**

Crear `tests/api/factor.test.js`:

```js
// Compuerta del segundo factor para los endpoints con x-sesion (api/_factor.js)
// y lectura de claims de un JWT ya validado (api/_clave.js).
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

let claimDeSesion, factorPendiente;
const estado = {};
const reiniciar = () => Object.assign(estado, { respuesta: { exigido: true, verificado: false }, status: 200, caido: false });
const json = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
const llamadas = [];
globalThis.fetch = vi.fn(async (url, init = {}) => {
  llamadas.push({ url: String(url), init });
  if (estado.caido) throw new TypeError("fetch failed");
  if (String(url).includes("/rest/v1/rpc/mi_segundo_factor")) return json(estado.respuesta, estado.status);
  throw new Error(`ruta no simulada: ${url}`);
});
const jwtCon = (payload) => `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`;

beforeAll(async () => {
  process.env.VITE_SUPABASE_ANON_KEY = "sb_publishable_prueba";
  process.env.SUPA_SERVICE_KEY = "clave-servicio-de-prueba";
  ({ claimDeSesion } = await import("../../api/_clave.js"));
  ({ factorPendiente } = await import("../../api/_factor.js"));
});
beforeEach(() => { reiniciar(); llamadas.length = 0; });

describe("claimDeSesion", () => {
  it("lee un claim del payload y devuelve vacío si falta o el token no es JWT", () => {
    expect(claimDeSesion(jwtCon({ session_id: "abc", email: "A@B.pe" }), "session_id")).toBe("abc");
    expect(claimDeSesion(jwtCon({ email: "a@b.pe" }), "session_id")).toBe("");
    expect(claimDeSesion("no-es-jwt", "session_id")).toBe("");
    expect(claimDeSesion(undefined, "session_id")).toBe("");
  });
});

describe("factorPendiente", () => {
  it("llama a mi_segundo_factor con el JWT del usuario (no con la llave de servicio) y bloquea si exigido && !verificado", async () => {
    expect(await factorPendiente("jwt-usuario")).toBe(true);
    const l = llamadas[0];
    expect(l.url).toContain("/rest/v1/rpc/mi_segundo_factor");
    expect(l.init.headers.authorization).toBe("Bearer jwt-usuario");
    expect(l.init.headers.apikey).toBe("sb_publishable_prueba");
  });
  it("deja pasar si no es exigido o ya está verificado", async () => {
    estado.respuesta = { exigido: false, verificado: false };
    expect(await factorPendiente("jwt")).toBe(false);
    estado.respuesta = { exigido: true, verificado: true };
    expect(await factorPendiente("jwt")).toBe(false);
  });
  it("deja pasar solo si la función no existe (migración sin aplicar, PGRST202); cualquier otro fallo bloquea", async () => {
    estado.respuesta = { code: "PGRST202", message: "Could not find the function" }; estado.status = 404;
    expect(await factorPendiente("jwt")).toBe(false);
    estado.respuesta = { message: "boom" }; estado.status = 500;
    expect(await factorPendiente("jwt")).toBe(true);
    estado.caido = true;
    expect(await factorPendiente("jwt")).toBe(true);
  });
});
```

- [ ] **Step 2: Verla fallar**

Run: `npx vitest run tests/api/factor.test.js`
Expected: FAIL (`Cannot find module '../../api/_factor.js'` / `claimDeSesion is not a function`).

- [ ] **Step 3: Implementar**

En `api/_clave.js`, después de `correoDeSesion`:

```js
// Un claim del JWT SIN verificar la firma. Solo para tokens que GoTrue acaba de
// validar en el mismo endpoint (GET /auth/v1/user): p. ej. session_id del
// segundo factor. Nunca para autorizar por sí solo.
export function claimDeSesion(jwt, nombre) {
  try {
    const partes = String(jwt ?? "").split(".");
    if (partes.length !== 3) return "";
    const carga = JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8"));
    const v = carga?.[nombre];
    return v === undefined || v === null ? "" : String(v);
  } catch {
    return "";
  }
}
```

Crear `api/_factor.js`:

```js
// Compuerta del segundo factor (2026-09-28) para los endpoints que autorizan
// con la llave de servicio a partir de un JWT en x-sesion: un superadmin que
// aún no verificó el código vale nivel 0 en la base, y aquí también.
// Se consulta mi_segundo_factor() CON EL JWT DEL USUARIO (rol authenticated),
// nunca con la llave de servicio (sin correo en el JWT la guarda no aplica).
// Fallo cerrado: si la base no responde, se bloquea. Única excepción: la
// función no existe (PGRST202, migración sin aplicar) → no hay factor que exigir.
const SUPABASE = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const limpiar = (v) => (typeof v === "string" ? v.replace(/^[﻿​\s]+|[﻿​\s]+$/g, "") : v);
const APIKEY = limpiar(process.env.VITE_SUPABASE_ANON_KEY) || limpiar(process.env.SUPA_SERVICE_KEY) || limpiar(process.env.SUPABASE_SERVICE_ROLE_KEY) || "";

export const MSJ_FACTOR = "Verifica el código de ingreso antes de operar.";

export async function factorPendiente(jwt) {
  try {
    const r = await fetch(`${SUPABASE}/rest/v1/rpc/mi_segundo_factor`, {
      method: "POST",
      headers: { apikey: APIKEY, authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      body: "{}",
    });
    const texto = await r.text();
    let json = null; try { json = texto ? JSON.parse(texto) : null; } catch { /* sin JSON */ }
    if (r.status === 404 && json?.code === "PGRST202") return false;
    if (!r.ok) return true;
    return Boolean(json?.exigido) && !json?.verificado;
  } catch {
    return true;
  }
}
```

- [ ] **Step 4: Verla pasar**

Run: `npx vitest run tests/api/factor.test.js`
Expected: PASS (5 pruebas).

- [ ] **Step 5: Commit**

```bash
git add api/_clave.js api/_factor.js tests/api/factor.test.js
git commit -m "api(factor): claimDeSesion y compuerta factorPendiente para los endpoints con x-sesion

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Endpoint `api/segundo-factor.js`

**Files:**
- Create: `api/segundo-factor.js`
- Modify: `api/enviar-correo.js:38-41` (`LIMITES.sujeto`)
- Create: `tests/api/segundo-factor.test.js`

**Interfaces:**
- Consumes: `enviar`, `plantilla`, `motorConfigurado` (`api/_correo.js`); `limitar`, `registrar`, `ipDe` (`api/enviar-correo.js`); `claimDeSesion` (`api/_clave.js`); RPC `api_factor_*` (Task 1).
- Produces: POST `/api/segundo-factor` con cabecera `x-sesion` y cuerpo `{accion, codigo?, recordar?, token?}`; respuestas según Global Constraints.

- [ ] **Step 1: Prueba que falla**

Crear `tests/api/segundo-factor.test.js`:

```js
// Endpoint del segundo factor por correo (api/segundo-factor.js). Supabase y
// el motor de correo se simulan. Lo que se exige: identidad por GoTrue, código
// de 6 dígitos hasheado con el session_id, nunca devuelve código ni hash,
// límites, 503 sin motor, equipo recordado y revocación.
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { createHash } from "node:crypto";

process.env.SUPA_SERVICE_KEY = "clave-servicio-de-prueba";
process.env.VITE_SUPABASE_ANON_KEY = "sb_publishable_prueba";
const enviados = [];
const motor = { configurado: true, falla: false };
vi.mock("../../api/_correo.js", () => ({
  motorConfigurado: () => motor.configurado,
  enviar: vi.fn(async (destino, asunto, html) => { if (motor.falla) return { error: "SMTP caído" }; enviados.push({ destino, asunto, html }); return {}; }),
  plantilla: (t, c) => `${t}${c}`, botonCorreo: (h, t) => `<a href="${h}">${t}</a>`,
}));

let handler;
beforeAll(async () => { ({ default: handler } = await import("../../api/segundo-factor.js")); });

const sha = (t) => createHash("sha256").update(t).digest("hex");
const jwtCon = (payload) => `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`;
const SID = "11111111-2222-4333-8444-555555555555";
const JWT_SUPER = jwtCon({ email: "diego@ejemplo.pe", session_id: SID });
const JWT_SIN_SID = jwtCon({ email: "diego@ejemplo.pe" });
const JWT_PORTAL = jwtCon({ email: "12345678@portal.grupoer.pe", session_id: SID });

const estado = {};
const rpc = [];   // llamadas a api_factor_* con sus argumentos
const reiniciar = () => Object.assign(estado, {
  sesiones: { [JWT_SUPER]: "diego@ejemplo.pe", [JWT_SIN_SID]: "diego@ejemplo.pe", [JWT_PORTAL]: "12345678@portal.grupoer.pe" },
  envios: 0,                                     // filas en correo_envios (para limitar)
  emitir: { ok: true, expira_en: "2026-09-28T12:10:00Z" },
  verificar: { ok: true, expira_en: "2026-09-28T20:00:00Z" },
  dispositivoUsar: true, revocados: 2,
});
const json = (cuerpo, status = 200, headers = {}) => new Response(cuerpo === null ? "" : JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json", ...headers } });
globalThis.fetch = vi.fn(async (url, init = {}) => {
  const u = String(url);
  if (u.includes("/auth/v1/user")) {
    const jwt = String(init.headers?.authorization ?? "").replace("Bearer ", "");
    const email = estado.sesiones[jwt];
    return email ? json({ email }) : json({ error: "invalid" }, 401);
  }
  if (u.includes("/rest/v1/correo_envios") && (init.method ?? "GET") === "GET") return json([], 200, { "content-range": `0-0/${estado.envios}` });
  if (u.includes("/rest/v1/correo_envios")) { estado.rastro = (estado.rastro ?? []).concat(JSON.parse(init.body)); return json(null, 201); }
  const m = /\/rest\/v1\/rpc\/(api_factor_\w+)/.exec(u);
  if (m) {
    const args = JSON.parse(init.body); rpc.push({ fn: m[1], args });
    if (m[1] === "api_factor_emitir") return json(estado.emitir);
    if (m[1] === "api_factor_verificar") return json(estado.verificar);
    if (m[1] === "api_factor_dispositivo_crear") return json(null, 204);
    if (m[1] === "api_factor_dispositivo_usar") return json(estado.dispositivoUsar);
    if (m[1] === "api_factor_dispositivos_revocar") return json(estado.revocados);
  }
  throw new Error(`ruta no simulada: ${u}`);
});
beforeEach(() => { reiniciar(); enviados.length = 0; rpc.length = 0; motor.configurado = true; motor.falla = false; });

const llamar = async (cuerpo, jwt = JWT_SUPER, metodo = "POST") => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
  await handler({ method: metodo, body: cuerpo, headers: { "x-forwarded-for": "190.1.2.3", "user-agent": "Prueba/1", ...(jwt ? { "x-sesion": jwt } : {}) }, socket: {} }, res);
  return { status: res.status.mock.calls[0][0], json: res.json.mock.calls[0][0] };
};

describe("identidad", () => {
  it("405 sin POST; 401 sin sesión o con sesión inválida; 403 para una cuenta del portal; 401 si el token validado no trae session_id", async () => {
    expect((await llamar({ accion: "enviar" }, JWT_SUPER, "GET")).status).toBe(405);
    expect((await llamar({ accion: "enviar" }, null)).status).toBe(401);
    expect((await llamar({ accion: "enviar" }, "jwt-falso")).status).toBe(401);
    expect((await llamar({ accion: "enviar" }, JWT_PORTAL)).status).toBe(403);
    expect((await llamar({ accion: "enviar" }, JWT_SIN_SID)).status).toBe(401);
  });
  it("valida la sesión con GoTrue ANTES de leer el claim (nunca decodifica un token no validado)", async () => {
    await llamar({ accion: "enviar" }, "jwt-falso");
    expect(rpc).toHaveLength(0);
  });
});

describe("enviar", () => {
  it("emite un código de 6 dígitos, lo hashea con el session_id, manda el correo y responde sin el código", async () => {
    const r = await llamar({ accion: "enviar" });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ enviado: true, expiraEn: "2026-09-28T12:10:00Z", correo: "d•••@ejemplo.pe" });
    const e = rpc.find((x) => x.fn === "api_factor_emitir");
    expect(e.args).toMatchObject({ p_correo: "diego@ejemplo.pe", p_session_id: SID, p_ip: "190.1.2.3", p_agente: "Prueba/1" });
    expect(enviados).toHaveLength(1);
    const codigo = /\b(\d{6})\b/.exec(enviados[0].html)?.[1];
    expect(codigo).toMatch(/^\d{6}$/);
    expect(e.args.p_codigo_hash).toBe(sha(codigo + SID));
    expect(JSON.stringify(r.json)).not.toContain(codigo);
    expect(JSON.stringify(r.json)).not.toContain(e.args.p_codigo_hash);
    expect(estado.rastro.at(-1)).toMatchObject({ accion: "segundo-factor", sujeto: "diego@ejemplo.pe", resultado: "enviado" });
  });
  it("429 con esperaSeg cuando la base pide esperar; 403 si no es superadmin o la política está apagada; no manda correo", async () => {
    estado.emitir = { ok: false, motivo: "espera", espera_seg: 42 };
    let r = await llamar({ accion: "enviar" });
    expect(r.status).toBe(429); expect(r.json.esperaSeg).toBe(42);
    estado.emitir = { ok: false, motivo: "no_superadmin" };
    r = await llamar({ accion: "enviar" }); expect(r.status).toBe(403);
    estado.emitir = { ok: false, motivo: "apagado" };
    r = await llamar({ accion: "enviar" }); expect(r.status).toBe(403);
    expect(enviados).toHaveLength(0);
  });
  it("503 con el texto acordado si el motor no está configurado o el envío falla; deja rastro «error»", async () => {
    motor.configurado = false;
    let r = await llamar({ accion: "enviar" });
    expect(r.status).toBe(503); expect(r.json.error).toBe("No se pudo enviar el código. Avisa a soporte técnico.");
    motor.configurado = true; motor.falla = true;
    r = await llamar({ accion: "enviar" });
    expect(r.status).toBe(503);
    expect(estado.rastro.at(-1)).toMatchObject({ accion: "segundo-factor", resultado: "error" });
  });
  it("429 por límite de tasa (correo_envios) sin tocar la base ni el motor", async () => {
    estado.envios = 30;
    const r = await llamar({ accion: "enviar" });
    expect(r.status).toBe(429);
    expect(rpc).toHaveLength(0); expect(enviados).toHaveLength(0);
  });
});

describe("verificar", () => {
  it("normaliza el código, manda el hash con el session_id y responde listo; con recordar crea un equipo y devuelve el token una sola vez", async () => {
    let r = await llamar({ accion: "verificar", codigo: " 12 34-56 ", recordar: false });
    expect(r.status).toBe(200); expect(r.json).toEqual({ listo: true });
    expect(rpc.find((x) => x.fn === "api_factor_verificar").args.p_codigo_hash).toBe(sha("123456" + SID));
    expect(rpc.find((x) => x.fn === "api_factor_dispositivo_crear")).toBeUndefined();
    rpc.length = 0;
    r = await llamar({ accion: "verificar", codigo: "123456", recordar: true });
    expect(r.status).toBe(200); expect(r.json.listo).toBe(true);
    expect(r.json.dispositivo).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(rpc.find((x) => x.fn === "api_factor_dispositivo_crear").args.p_token_hash).toBe(sha(r.json.dispositivo));
  });
  it("400 con intentosRestantes si es incorrecto; 410 vencido/agotado; código mal formado → 400 sin ir a la base; deja rastro «rechazado» solo en fallos", async () => {
    estado.verificar = { ok: false, motivo: "incorrecto", intentos_restantes: 3 };
    let r = await llamar({ accion: "verificar", codigo: "000000" });
    expect(r.status).toBe(400); expect(r.json).toEqual({ error: "Código incorrecto.", intentosRestantes: 3 });
    expect(estado.rastro.at(-1)).toMatchObject({ accion: "segundo-factor", resultado: "rechazado", detalle: "incorrecto" });
    estado.verificar = { ok: false, motivo: "vencido" };
    r = await llamar({ accion: "verificar", codigo: "000000" }); expect(r.status).toBe(410); expect(r.json.error).toBe("vencido");
    estado.verificar = { ok: false, motivo: "agotado", intentos_restantes: 0 };
    r = await llamar({ accion: "verificar", codigo: "000000" }); expect(r.status).toBe(410); expect(r.json.error).toBe("agotado");
    rpc.length = 0;
    r = await llamar({ accion: "verificar", codigo: "12" }); expect(r.status).toBe(400); expect(rpc).toHaveLength(0);
  });
});

describe("dispositivo y olvidar", () => {
  it("dispositivo: hashea el token y responde listo; token no reconocido → 403 genérico (no 401: el cliente reserva 401 para salir)", async () => {
    let r = await llamar({ accion: "dispositivo", token: "abc" });
    expect(r.status).toBe(200); expect(r.json).toEqual({ listo: true });
    expect(rpc.find((x) => x.fn === "api_factor_dispositivo_usar").args.p_token_hash).toBe(sha("abc"));
    estado.dispositivoUsar = false;
    r = await llamar({ accion: "dispositivo", token: "abc" });
    expect(r.status).toBe(403); expect(r.json).toEqual({ error: "Equipo no reconocido." });
    r = await llamar({ accion: "dispositivo" }); expect(r.status).toBe(400);
  });
  it("olvidar: revoca todos los equipos del llamador y responde el número", async () => {
    const r = await llamar({ accion: "olvidar" });
    expect(r.status).toBe(200); expect(r.json).toEqual({ revocados: 2 });
    expect(rpc.find((x) => x.fn === "api_factor_dispositivos_revocar").args).toEqual({ p_correo: "diego@ejemplo.pe" });
  });
  it("acción desconocida → 400", async () => { expect((await llamar({ accion: "x" })).status).toBe(400); });
});
```

- [ ] **Step 2: Verla fallar**

Run: `npx vitest run tests/api/segundo-factor.test.js`
Expected: FAIL (`Cannot find module '../../api/segundo-factor.js'`).

- [ ] **Step 3: Tope por sujeto en `api/enviar-correo.js`**

En `LIMITES.sujeto` añadir `"segundo-factor": 15` (5 envíos + rechazos en la misma hora comparten la ventana por correo):

```js
export const LIMITES = {
  ip: 30,
  sujeto: { verificacion: 3, recuperacion: 3, "recuperacion-admin": 3, "aviso-ticket": 5, "aviso-solicitud": 10, "recordatorio-acuse": 5, "segundo-factor": 15 },
};
```

- [ ] **Step 4: Implementar `api/segundo-factor.js`**

```js
// Segundo factor por correo para el Superadministrador (2026-09-28).
// POST JSON con el JWT del BackOffice en x-sesion. Acciones:
//   enviar      → código de 6 dígitos al correo de la cuenta (10 min, 5 intentos,
//                 60 s entre envíos; la base guarda sha256(codigo || session_id)).
//   verificar   → {codigo, recordar}; si ok, la sesión queda marcada en la base
//                 (fn_nivel_modulo vuelve a dar 99) y, con recordar, se entrega
//                 UNA vez un token de equipo (30 días) del que la base guarda el hash.
//   dispositivo → {token}: marca la sesión sin código si el equipo sigue vigente.
//   olvidar     → revoca todos los equipos recordados del llamador.
// Identidad: GET /auth/v1/user valida el JWT; solo DESPUÉS se lee su claim
// session_id (api/_clave.js → claimDeSesion). Las escrituras van por
// api_factor_* con la llave de servicio (el navegador no puede ejecutarlas).
// Nunca se devuelve el código ni un hash; el único secreto que viaja es el
// token de equipo, una sola vez. Límite de tasa y rastro en correo_envios.
import { createHash, randomInt, randomBytes } from "node:crypto";
import { enviar, plantilla, motorConfigurado } from "./_correo.js";
import { limitar, registrar, ipDe } from "./enviar-correo.js";
import { claimDeSesion, esCorreoPortal } from "./_clave.js";

const SUPABASE = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const ACCION = "segundo-factor";
const MSJ_SIN_CORREO = "No se pudo enviar el código. Avisa a soporte técnico.";
const limpiar = (v) => (typeof v === "string" ? v.replace(/^[﻿​\s]+|[﻿​\s]+$/g, "") : v);
const SERVICE = limpiar(process.env.SUPA_SERVICE_KEY) || limpiar(process.env.SUPABASE_SERVICE_ROLE_KEY) || "";
const cabService = { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" };
const sha = (t) => createHash("sha256").update(String(t)).digest("hex");
const enmascarar = (correo) => correo.replace(/^(.)[^@]*(@.*)$/, "$1•••$2");

async function rest(ruta, opciones = {}) {
  const r = await fetch(`${SUPABASE}${ruta}`, { ...opciones, headers: { ...cabService, ...opciones.headers } });
  const texto = await r.text();
  let json = null; try { json = texto ? JSON.parse(texto) : null; } catch { /* sin JSON */ }
  return { ok: r.ok, status: r.status, json };
}
const rpc = (nombre, args) => rest(`/rest/v1/rpc/${nombre}`, { method: "POST", body: JSON.stringify(args) });

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!SERVICE) return res.status(500).json({ error: "Falta la clave de servicio." });
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido." });

  // 1 · Identidad: sesión válida en GoTrue; recién entonces el claim session_id.
  const sesion = limpiar(req.headers["x-sesion"] ?? "");
  if (!sesion) return res.status(401).json({ error: "Sesión requerida." });
  const quien = await rest("/auth/v1/user", { method: "GET", headers: { authorization: `Bearer ${sesion}` } });
  const correo = String(quien.json?.email ?? "").trim().toLowerCase();
  if (!quien.ok || !correo) return res.status(401).json({ error: "Sesión inválida o vencida." });
  if (esCorreoPortal(correo)) return res.status(403).json({ error: "El Portal no usa segundo factor." });
  const sessionId = claimDeSesion(sesion, "session_id");
  if (!sessionId) return res.status(401).json({ error: "La sesión no trae identificador. Vuelve a ingresar." });

  const ip = ipDe(req);
  const agente = String(req.headers["user-agent"] ?? "").trim().slice(0, 200);
  const cuerpo = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
  const { accion } = cuerpo;
  const comunes = { p_correo: correo, p_session_id: sessionId, p_ip: ip, p_agente: agente };

  if (accion === "enviar") {
    const tope = await limitar(ACCION, ip, correo);
    if (tope) return res.status(tope.status).json({ error: tope.error });
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const e = await rpc("api_factor_emitir", { ...comunes, p_codigo_hash: sha(codigo + sessionId) });
    const v = e.json ?? {};
    if (!e.ok) return res.status(503).json({ error: "La base no respondió. Inténtalo de nuevo." });
    if (!v.ok) {
      if (v.motivo === "espera") return res.status(429).json({ error: `Espera ${v.espera_seg} segundos antes de pedir otro código.`, esperaSeg: v.espera_seg });
      return res.status(403).json({ error: "Tu cuenta no requiere código de ingreso." });
    }
    if (!motorConfigurado()) {
      await registrar({ accion: ACCION, ip, sujeto: correo, destinatario: correo, resultado: "error", detalle: "motor sin configurar" });
      return res.status(503).json({ error: MSJ_SIN_CORREO });
    }
    const r = await enviar(correo, "Tu código de ingreso — GrupoER", plantilla(
      "Tu código de ingreso",
      `<p>Para entrar al BackOffice escribe este código:</p>
       <p style="font-size:30px;letter-spacing:8px;font-weight:bold;margin:12px 0">${codigo}</p>
       <p>Vence en 10 minutos y sirve una sola vez.</p>
       <p>Si no fuiste tú, cambia tu clave cuanto antes.</p>`));
    await registrar({ accion: ACCION, ip, sujeto: correo, destinatario: correo, resultado: r.error ? "error" : "enviado", detalle: r.error ?? null });
    if (r.error) return res.status(503).json({ error: MSJ_SIN_CORREO });
    return res.status(200).json({ enviado: true, expiraEn: v.expira_en, correo: enmascarar(correo) });
  }

  if (accion === "verificar") {
    const codigo = String(cuerpo.codigo ?? "").replace(/\D/g, "");
    if (codigo.length !== 6) return res.status(400).json({ error: "Escribe los 6 dígitos del código." });
    const tope = await limitar(ACCION, ip, correo);
    if (tope) return res.status(tope.status).json({ error: tope.error });
    const e = await rpc("api_factor_verificar", { ...comunes, p_codigo_hash: sha(codigo + sessionId) });
    const v = e.json ?? {};
    if (!e.ok) return res.status(503).json({ error: "La base no respondió. Inténtalo de nuevo." });
    if (!v.ok) {
      await registrar({ accion: ACCION, ip, sujeto: correo, destinatario: correo, resultado: "rechazado", detalle: v.motivo ?? "rechazado" });
      if (v.motivo === "incorrecto") return res.status(400).json({ error: "Código incorrecto.", intentosRestantes: v.intentos_restantes ?? 0 });
      if (v.motivo === "vencido" || v.motivo === "agotado") return res.status(410).json({ error: v.motivo });
      return res.status(403).json({ error: "Tu cuenta no requiere código de ingreso." });
    }
    const respuesta = { listo: true };
    if (cuerpo.recordar === true) {
      const token = randomBytes(32).toString("base64url");
      const d = await rpc("api_factor_dispositivo_crear", { ...comunes, p_token_hash: sha(token) });
      if (d.ok) respuesta.dispositivo = token;
    }
    return res.status(200).json(respuesta);
  }

  if (accion === "dispositivo") {
    const token = String(cuerpo.token ?? "").trim();
    if (!token) return res.status(400).json({ error: "Falta el token del equipo." });
    const d = await rpc("api_factor_dispositivo_usar", { ...comunes, p_token_hash: sha(token) });
    if (!d.ok || d.json !== true) return res.status(403).json({ error: "Equipo no reconocido." });
    return res.status(200).json({ listo: true });
  }

  if (accion === "olvidar") {
    const d = await rpc("api_factor_dispositivos_revocar", { p_correo: correo });
    if (!d.ok) return res.status(503).json({ error: "La base no respondió. Inténtalo de nuevo." });
    return res.status(200).json({ revocados: Number(d.json ?? 0) });
  }

  return res.status(400).json({ error: "Acción desconocida." });
}
```

- [ ] **Step 5: Verla pasar y correr toda la suite**

Run: `npx vitest run tests/api/segundo-factor.test.js`
Expected: PASS. Si `limitar` devuelve 503 en las pruebas («El registro de correo no está disponible»), es porque el doble de `correo_envios` no devolvió `content-range`: revisa el `json(...)` con cabecera del test, no el endpoint.

Run: `npm test`
Expected: PASS en todos los archivos (`clave`, `enviar-correo`, `supa`, `factor`, `segundo-factor`).

- [ ] **Step 6: Commit**

```bash
git add api/segundo-factor.js api/enviar-correo.js tests/api/segundo-factor.test.js
git commit -m "api(segundo-factor): endpoint del código por correo (enviar, verificar, dispositivo, olvidar) con pruebas

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Compuerta del factor en los endpoints con `x-sesion`

**Files:**
- Modify: `api/admin-usuarios.js:61-66`, `api/portal-cuentas.js:111-118`, `api/solicitud-pdf.js:36-42`, `api/constancia-portal.js:73-75`, `api/consentimiento-pdf.js:48-49`, `api/descargar-documento.js:47-49`, `api/rit.js:55-56`, `api/enviar-correo.js:69-83` (`llamador`)
- Create: `tests/api/admin-usuarios.test.js`

**Interfaces:**
- Consumes: `factorPendiente`, `MSJ_FACTOR` de `api/_factor.js` (Task 3).

- [ ] **Step 1: Prueba que falla (admin-usuarios)**

Crear `tests/api/admin-usuarios.test.js`:

```js
// api/admin-usuarios.js: la compuerta del segundo factor va justo después de
// validar la sesión y antes de cualquier operación con la llave de servicio.
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

process.env.SUPA_SERVICE_KEY = "clave-servicio-de-prueba";
process.env.VITE_SUPABASE_ANON_KEY = "sb_publishable_prueba";
vi.mock("../../api/_correo.js", () => ({ enviar: vi.fn(async () => ({})), plantilla: (t, c) => `${t}${c}`, botonCorreo: () => "" }));

let handler;
beforeAll(async () => { ({ default: handler } = await import("../../api/admin-usuarios.js")); });
const estado = {};
const llamadas = [];
const json = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = vi.fn(async (url, init = {}) => {
  const u = String(url); llamadas.push(u);
  if (u.includes("/auth/v1/user")) return json({ email: "diego@ejemplo.pe" });
  if (u.includes("/rest/v1/rpc/mi_segundo_factor")) return json(estado.factor);
  if (u.includes("/rest/v1/v_mi_acceso")) return json([{ esSuperadmin: true, matriz: {} }]);
  if (u.includes("/rest/v1/rpc/api_admin_por_id")) return json([{ id: 7, correo: "x@ejemplo.pe" }]);
  if (u.includes("/rest/v1/rpc/eliminar_usuario_admin")) return json(null);
  if (u.includes("/auth/v1/admin/users")) return json({ users: [] });
  throw new Error(`ruta no simulada: ${u}`);
});
beforeEach(() => { llamadas.length = 0; estado.factor = { exigido: true, verificado: true }; });
const llamar = async (cuerpo) => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
  await handler({ method: "POST", body: cuerpo, headers: { "x-sesion": "jwt-diego" }, socket: {} }, res);
  return { status: res.status.mock.calls[0][0], json: res.json.mock.calls[0][0] };
};

describe("compuerta del segundo factor", () => {
  it("un superadmin con el código pendiente recibe 403 y no se toca ni v_mi_acceso ni la cuenta", async () => {
    estado.factor = { exigido: true, verificado: false };
    const r = await llamar({ accion: "eliminar", usuario_id: 7 });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe("Verifica el código de ingreso antes de operar.");
    expect(llamadas.some((u) => u.includes("v_mi_acceso") || u.includes("eliminar_usuario_admin"))).toBe(false);
  });
  it("verificado: sigue el flujo normal (eliminar llega a la base)", async () => {
    const r = await llamar({ accion: "eliminar", usuario_id: 7 });
    expect(r.status).toBe(200);
    expect(llamadas.some((u) => u.includes("eliminar_usuario_admin"))).toBe(true);
  });
});
```

- [ ] **Step 2: Verla fallar**

Run: `npx vitest run tests/api/admin-usuarios.test.js`
Expected: la primera prueba FALLA (status 200, `eliminar_usuario_admin` llamado).

- [ ] **Step 3: Insertar la compuerta en los 8 endpoints**

En cada archivo, `import { factorPendiente, MSJ_FACTOR } from "./_factor.js";` junto a los demás imports, y la línea de compuerta **inmediatamente después** de la comprobación que da por válida la sesión de un usuario administrativo (antes de leer `v_mi_acceso`, `api_admin_por_correo` o el cuerpo):

```js
  if (await factorPendiente(sesion)) return res.status(403).json({ error: MSJ_FACTOR });
```

Anclas exactas (usar el nombre de variable del JWT de cada archivo):

| Archivo | Después de la línea | Variable |
|---|---|---|
| `api/admin-usuarios.js` | `if (!quien.ok \|\| !correoLlamador) return res.status(401)…` (L65) | `sesion` |
| `api/portal-cuentas.js` | el `if (correoLlamador.toLowerCase().endsWith(\`@${DOMINIO}\`)) {…}` (L116-118) | `sesion` |
| `api/solicitud-pdf.js` | el bloque `if (!quien.ok \|\| !correo \|\| correo.endsWith("@portal.grupoer.pe")) {…}` (L40-42) | `jwt` |
| `api/constancia-portal.js` | dentro del `else` de administrador, antes de `const admin = …` (L73): `if (await factorPendiente(jwt)) return res.status(403).json({ error: MSJ_FACTOR });` | `jwt` |
| `api/consentimiento-pdf.js` | después del `if (correo.endsWith(\`@${DOMINIO_PORTAL}\`)) {…}` (L45-47) | `jwt` |
| `api/descargar-documento.js` | dentro del `else` de administrador, antes de `const admin = …` (L47) | `jwt` |
| `api/rit.js` | dentro del `else` de administrador, antes de `const admin = …` (L55) | `jwt` |
| `api/enviar-correo.js` | en `llamador()`, después de `if (!u) return null;` (L82): `if (await factorPendiente(jwt)) return { tipo: "pendiente", correo, dni: u.persona_dni };` | `jwt` |

Para `enviar-correo.js`, además, en las tres acciones que aceptan un admin (`aviso-ticket` L234-235, `aviso-solicitud` L265-266, `recordatorio-acuse` L321-323) añadir tras el chequeo de `quien`:

```js
    if (quien.tipo === "pendiente") return res.status(403).json({ error: MSJ_FACTOR });
```

- [ ] **Step 4: Verla pasar y toda la suite**

Run: `npx vitest run tests/api/admin-usuarios.test.js` → PASS.
Run: `npm test` → PASS. Si `tests/api/enviar-correo.test.js` falla con «ruta no simulada: …mi_segundo_factor», añade al doble de `fetch` de ese test la rama:

```js
    if (u.includes("/rest/v1/rpc/mi_segundo_factor")) return json({ exigido: false, verificado: false });
```

- [ ] **Step 5: Commit**

```bash
git add api/ tests/api/admin-usuarios.test.js tests/api/enviar-correo.test.js
git commit -m "api: compuerta del segundo factor en los endpoints que autorizan con la llave de servicio

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Cliente — estado, puerta del Shell y pantalla del código

**Files:**
- Modify: `src/state.jsx` (imports; `USUARIO_DEMO`; junto a `llamarServerless`; `useEffect` del resolvedor L162-211; `salir`; `guardarPolitica` L621-632; `value` del provider L995)
- Create: `src/pages/SegundoFactor.jsx`
- Modify: `src/layout/Shell.jsx:11,167`
- Modify: `src/data/mock.js:203-209`

**Interfaces:**
- Consumes: RPC `mi_segundo_factor`; endpoint `/api/segundo-factor` (Task 4).
- Produces en el contexto `useApp()`: `user.factorPendiente: boolean`, `user.factorCorreo: string` (enmascarado), `factorVerificado(): Promise<void>`, `segundoFactor(accion, cuerpo) → Promise<{status, ...json}>`.

- [ ] **Step 1: `src/state.jsx` — llamada al endpoint y usuario demo**

La primera línea de `src/state.jsx` pasa a ser `import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";`. En `USUARIO_DEMO` añadir `factorPendiente: false, factorCorreo: null,`.

Debajo de `const cuentaAdmin = …` añadir:

```js
// Segundo factor por correo (2026-09-28). Devuelve { status, ...json } porque
// la pantalla necesita intentosRestantes / esperaSeg además del error. Un 401
// (sesión inválida en el servidor) cierra la sesión como en llamarServerless.
async function llamarFactor(accion, cuerpo = {}) {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return { status: 0, error: "Sin sesión activa." };
    const r = await fetch("/api/segundo-factor", {
      method: "POST",
      headers: { "content-type": "application/json", "x-sesion": token },
      body: JSON.stringify({ accion, ...cuerpo }),
    });
    const json = await r.json().catch(() => ({}));
    if (r.status === 401 && typeof alSesionInvalida === "function") alSesionInvalida();
    return { status: r.status, ...json, ...(r.ok ? {} : { error: json.error ?? `Error ${r.status}` }) };
  } catch (e) {
    return { status: 0, error: e.message ?? "Fallo de red." };
  }
}
```

- [ ] **Step 2: `src/state.jsx` — el resolvedor consulta el factor**

Dentro de `AppProvider`, antes del `useEffect` del resolvedor, declarar:

```js
  const resolverRef = useRef(null);
  const tokenEnCursoRef = useRef(null);
```

En el `useEffect` del resolvedor: quitar `let tokenEnCurso = null;` y reemplazar

```js
      if (token && token === tokenEnCurso) return;
      tokenEnCurso = token;
```

por

```js
      if (token && token === tokenEnCursoRef.current) return;
      tokenEnCursoRef.current = token;
```

Reemplazar el tramo desde `// La carga completa va ANTES de publicar el usuario` hasta el cierre de `setUser({ … });` por:

```js
      const base = {
        id: data.id, codigo: data.codigo, nombre: data.nombre, rol: data.perfilNombre,
        correo: data.correo, esSuperadmin: data.esSuperadmin, requiereCambio: data.requiereCambio,
        // La categoría vigente manda: de aquí salen menú, selector y guards.
        acceso: {
          esSuperadmin: acc?.esSuperadmin ?? data.esSuperadmin,
          matriz: acc?.matriz ?? {},
          empresas: acc?.empresas ?? [],
        },
        factorPendiente: false, factorCorreo: null,
      };
      // Segundo factor (2026-09-28): un superadmin sin verificar vale nivel 0 en
      // la base; se publica SOLO el usuario (sin cargar vistas, saldrían vacías)
      // y el Shell muestra la pantalla del código. Sin la migración aplicada la
      // RPC no existe (error) y se sigue como antes.
      if (base.acceso.esSuperadmin) {
        const { data: factor, error: eFactor } = await supabase.rpc("mi_segundo_factor");
        if (!activo || mia !== generacion) return;
        if (!eFactor && factor?.exigido && !factor?.verificado) {
          setUser({ ...base, factorPendiente: true, factorCorreo: factor.correo ?? null });
          return;
        }
      }
      // La carga completa va ANTES de publicar el usuario: la interfaz nunca
      // se pinta autenticada con colecciones vacías. Si algo falla, origen
      // queda en "error" y el Shell ofrece reintentar.
      await recargar();
      if (!activo || mia !== generacion) return;
      setUser(base);
```

Justo antes de `supabase.auth.getSession().then(({ data }) => resolver(data.session));` añadir `resolverRef.current = resolver;`, y en el `return () => { … }` del efecto añadir `resolverRef.current = null;`.

Después de `salir`, añadir:

```js
  // Tras verificar el código (o reconocer el equipo): se vuelve a resolver la
  // misma sesión, ahora con nivel 99 → carga completa.
  const factorVerificado = async () => {
    tokenEnCursoRef.current = null;
    const { data } = await supabase.auth.getSession();
    await resolverRef.current?.(data?.session);
  };
  const segundoFactor = (accion, cuerpo) => llamarFactor(accion, cuerpo);
```

En `guardarPolitica`, añadir el argumento `p_factor_superadmin: p.factorSuperadmin ?? true,` después de `p_por: …`.

En el `value={{ … }}` del provider añadir `factorVerificado, segundoFactor,` después de `claveCambiada,`.

- [ ] **Step 3: `src/data/mock.js`**

En `POLITICA_ACCESO` añadir `factorSuperadmin: true,` antes de `actualizado: null`.

- [ ] **Step 4: Crear `src/pages/SegundoFactor.jsx`**

```jsx
import { useEffect, useRef, useState } from "react";
import { MailCheck } from "lucide-react";
import { useApp } from "../state";
import { Card, Button, Field, Input, Note } from "../components/ui";

const CLAVE_DISPOSITIVO = "backoffice-dispositivo";
const ESPERA_REENVIO_S = 60;
const leerDispositivo = () => { try { return localStorage.getItem(CLAVE_DISPOSITIVO); } catch { return null; } };
const guardarDispositivo = (t) => { try { localStorage.setItem(CLAVE_DISPOSITIVO, t); } catch { /* modo privado */ } };
const borrarDispositivo = () => { try { localStorage.removeItem(CLAVE_DISPOSITIVO); } catch { /* modo privado */ } };

// Segundo factor por correo (2026-09-28): hasta verificar el código, la sesión
// del Superadministrador vale nivel 0 en la base. Esta pantalla va ANTES del
// cambio obligatorio de clave. 1) equipo recordado → sin código; 2) si no,
// pide el código y lo verifica; 3) factorVerificado() recarga la app.
export default function SegundoFactor() {
  const { user, salir, segundoFactor, factorVerificado } = useApp();
  const [fase, setFase] = useState("equipo");       // equipo · enviando · codigo · listo
  const [codigo, setCodigo] = useState("");
  const [recordar, setRecordar] = useState(true);
  const [correo, setCorreo] = useState(user?.factorCorreo ?? null);
  const [error, setError] = useState(null);
  const [intentos, setIntentos] = useState(null);
  const [agotado, setAgotado] = useState(false);     // vencido / agotado → solo «pedir uno nuevo»
  const [sinCorreo, setSinCorreo] = useState(false); // 503: no hay más vía en pantalla
  const [espera, setEspera] = useState(0);
  const [cargando, setCargando] = useState(false);
  const montado = useRef(true);
  useEffect(() => () => { montado.current = false; }, []);

  // Cuenta regresiva para reenviar.
  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  const enviar = async () => {
    setError(null); setAgotado(false); setIntentos(null); setCodigo("");
    setFase("enviando");
    const r = await segundoFactor("enviar");
    if (!montado.current) return;
    if (r.status === 200) {
      setCorreo(r.correo ?? correo); setEspera(ESPERA_REENVIO_S); setFase("codigo");
      return;
    }
    setFase("codigo");
    if (r.status === 429 && r.esperaSeg) { setEspera(r.esperaSeg); setError(r.error); return; }
    if (r.status === 503) { setSinCorreo(true); setError(r.error); return; }
    setError(r.error ?? "No se pudo enviar el código.");
  };

  // Al montar: primero el equipo recordado; si no vale, se pide el código.
  useEffect(() => {
    let vivo = true;
    (async () => {
      const token = leerDispositivo();
      if (token) {
        const r = await segundoFactor("dispositivo", { token });
        if (!vivo) return;
        if (r.status === 200 && r.listo) { setFase("listo"); await factorVerificado(); return; }
        borrarDispositivo();
      }
      if (vivo) await enviar();
    })();
    return () => { vivo = false; };
  }, []);

  const verificar = async (e) => {
    e.preventDefault();
    const limpio = codigo.replace(/\D/g, "");
    if (limpio.length !== 6) return setError("Escribe los 6 dígitos del código.");
    setError(null); setCargando(true);
    const r = await segundoFactor("verificar", { codigo: limpio, recordar });
    if (!montado.current) return;
    setCargando(false);
    if (r.status === 200 && r.listo) {
      if (r.dispositivo) guardarDispositivo(r.dispositivo);
      setFase("listo");
      await factorVerificado();
      return;
    }
    if (r.status === 400) { setIntentos(r.intentosRestantes ?? null); setError(r.error ?? "Código incorrecto."); setCodigo(""); return; }
    if (r.status === 410) {
      setAgotado(true);
      setError(r.error === "agotado" ? "Agotaste los 5 intentos de este código." : "El código venció (dura 10 minutos).");
      return;
    }
    if (r.status === 429) { setError(r.error); return; }
    setError(r.error ?? "No se pudo verificar el código.");
  };

  if (fase === "listo") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-papel text-[13px] text-gris-cl">
        Cargando el BackOffice…
      </div>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-papel px-4">
      <Card className="w-full max-w-md">
        <div className="mb-4 text-center">
          <MailCheck size={26} className="mx-auto mb-2 text-petroleo" />
          <h1 className="font-display text-[17px] font-bold text-tinta">Código de ingreso</h1>
          <p className="mt-1 text-[12.5px] leading-relaxed text-gris">
            {user?.nombre}, tu cuenta es de Superadministrador: además de la clave, cada ingreso pide un código
            {correo ? <> enviado a <b>{correo}</b></> : " enviado a tu correo"}. Vence en 10 minutos.
          </p>
        </div>
        {fase === "equipo" || fase === "enviando" ? (
          <p className="text-center text-[12.5px] text-gris-cl">{fase === "equipo" ? "Comprobando este equipo…" : "Enviando el código…"}</p>
        ) : (
          <form onSubmit={verificar} className="space-y-4">
            <Field label="Código de 6 dígitos" required>
              <Input
                inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} pattern="[0-9]*"
                value={codigo} disabled={agotado || sinCorreo || cargando}
                onChange={(e) => { setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(null); }}
                style={{ letterSpacing: 6, fontSize: 20, textAlign: "center" }}
              />
            </Field>
            {error && (
              <Note tone="alerta">
                {error}
                {intentos !== null && intentos > 0 && <> Te quedan {intentos} intento{intentos === 1 ? "" : "s"}.</>}
              </Note>
            )}
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-gris">
              <input type="checkbox" className="accent-petroleo" checked={recordar} onChange={(e) => setRecordar(e.target.checked)} />
              Recordar este equipo por 30 días
            </label>
            {!sinCorreo && !agotado && (
              <Button className="w-full" disabled={cargando || codigo.length !== 6}>
                {cargando ? "Verificando…" : "Verificar"}
              </Button>
            )}
            {!sinCorreo && (
              <Button type="button" variant="secondary" className="w-full" disabled={espera > 0 || fase === "enviando"} onClick={enviar}>
                {agotado ? "Pedir un código nuevo" : espera > 0 ? `Reenviar código (${espera} s)` : "Reenviar código"}
              </Button>
            )}
            <button type="button" onClick={() => salir()} className="w-full text-center text-[12px] text-gris-cl hover:text-tinta">
              Salir
            </button>
          </form>
        )}
      </Card>
    </main>
  );
}
```

- [ ] **Step 5: Puerta en `src/layout/Shell.jsx`**

Añadir `import SegundoFactor from "../pages/SegundoFactor";` bajo el import de `CambioClave` y, en L167, dejar:

```jsx
  if (user.factorPendiente) return <SegundoFactor />;
  if (user.requiereCambio) return <CambioClave />;
```

- [ ] **Step 6: Compilar y probar a mano en desarrollo**

Run: `npx vite build`
Expected: compila sin errores ni avisos nuevos.

Prueba manual (no hay pruebas de React en el proyecto): `npm run dev` con canal directo contra el Postgres local NO es viable (el endpoint exige Vercel); la prueba real es contra producción tras la migración (Task 11). Aquí solo se comprueba que con `MODO_DEMO = true` (cambiar temporalmente en `src/state.jsx`, no commitear) la app arranca y entra directo, y que con `MODO_DEMO = false` y sesión cerrada muestra el login. Revertir `MODO_DEMO` antes de commitear.

- [ ] **Step 7: Commit**

```bash
git add src/state.jsx src/pages/SegundoFactor.jsx src/layout/Shell.jsx src/data/mock.js
git commit -m "backoffice(factor): pantalla del código de ingreso para el Superadministrador, antes del cambio de clave

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: ACC-05 — interruptor y «Olvidar todos los equipos recordados»

**Files:**
- Modify: `src/pages/accesos/Politica.jsx`

**Interfaces:**
- Consumes: `db.politica[0].factorSuperadmin`, `guardarPolitica(p)` (ya manda `p_factor_superadmin`), `segundoFactor("olvidar")` del contexto (Task 6).

- [ ] **Step 1: Añadir la tarjeta**

En `Politica.jsx`:
- Import: `import { Save, RotateCcw, MailCheck } from "lucide-react";`
- `RECOMENDADOS`: añadir `factorSuperadmin: true,`.
- `const { db, guardarPolitica, segundoFactor } = useApp();` y estado `const [olvidados, setOlvidados] = useState(null); const [olvidando, setOlvidando] = useState(false);`
- Nueva `<Card>` después de la tarjeta «Claves» y antes de la `<Note tone="neutral">`:

```jsx
        <Card>
          <h2 className="mb-1 flex items-center gap-2 text-[13px] font-bold text-tinta"><MailCheck size={15} className="text-petroleo" /> Segundo factor del Superadministrador</h2>
          <p className="mb-4 text-[11.5px] leading-snug text-gris-cl">
            Con el interruptor encendido, cada ingreso de una cuenta Superadministrador pide además un código de 6 dígitos
            enviado a su correo (vence en 10 minutos). Hasta verificarlo la sesión no puede leer ni escribir nada. El resto de
            categorías entra solo con su clave. Si el correo dejara de salir, la vía de contingencia es técnica (Management API).
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-gris">
              <input type="checkbox" className="accent-petroleo" checked={p.factorSuperadmin ?? true}
                onChange={(e) => set("factorSuperadmin", e.target.checked)} />
              Exigir código por correo al Superadministrador
            </label>
            <div>
              <Button type="button" variant="secondary" disabled={olvidando} onClick={async () => {
                setOlvidando(true); setOlvidados(null);
                const r = await segundoFactor("olvidar");
                try { localStorage.removeItem("backoffice-dispositivo"); } catch { /* modo privado */ }
                setOlvidando(false);
                setOlvidados(r.status === 200 ? `${r.revocados} equipo${r.revocados === 1 ? "" : "s"} olvidado${r.revocados === 1 ? "" : "s"}. En el próximo ingreso se pedirá el código en todos.` : (r.error ?? "No se pudo olvidar los equipos."));
              }}>
                {olvidando ? "Olvidando…" : "Olvidar todos los equipos recordados"}
              </Button>
              <p className="mt-1 text-[11px] text-gris-cl">Revoca los equipos recordados de <b>tu</b> cuenta (los de 30 días). Este equipo también.</p>
              {olvidados && <Note tone="conf">{olvidados}</Note>}
            </div>
          </div>
        </Card>
```

- [ ] **Step 2: Compilar**

Run: `npx vite build`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/pages/accesos/Politica.jsx
git commit -m "accesos(ACC-05): interruptor del segundo factor y botón para olvidar los equipos recordados

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Suites de producción — marcar la sesión de los superadmins temporales

**Files:**
- Create: `scripts/lib/marcar-factor.mjs`
- Modify: `scripts/verificar-botones-bc.mjs:57`, `scripts/verificar-constancia-pdf.mjs:62`, `scripts/verificar-cuentas-masa.mjs:77`, `scripts/verificar-cumplimiento-boletas.mjs:71`, `scripts/verificar-solicitud-pdf.mjs:74`, `scripts/verificar-movimientos.mjs:198`, `scripts/diagnostico-login-e2e.mjs:80`, `scripts/verificar-fase1.mjs:39`, `scripts/verificar-fase2.mjs:35`, `scripts/verificar-fase3a.mjs:34`
- Modify: `scripts/verificar-fase4.mjs:26-29` y final del archivo

**Interfaces:**
- Produces: `sessionIdDe(jwt) → string|null`; `marcarSesionVerificada(sql, jwt, correo) → Promise<string|null>` (`sql` es el helper de Management API de cada script: `(q) => Promise<filas>`).

- [ ] **Step 1: Helper `scripts/lib/marcar-factor.mjs`**

```js
// scripts/lib/marcar-factor.mjs — Segundo factor (2026-09-28). Las suites
// que crean un SUPERADMIN temporal (o entran con uno real) y luego llaman por
// el proxy o por endpoints con x-sesion quedarían en nivel 0: aquí se marca la
// sesión del JWT como verificada vía Management API (rol postgres, fuera del
// alcance del navegador). Si la migración no está aplicada, no hace nada.
export function sessionIdDe(jwt) {
  try {
    const partes = String(jwt ?? "").split(".");
    if (partes.length !== 3) return null;
    return JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8")).session_id ?? null;
  } catch { return null; }
}

export async function marcarSesionVerificada(sql, jwt, correo) {
  const sid = sessionIdDe(jwt);
  if (!sid) throw new Error("El JWT no trae session_id: no se puede marcar el segundo factor.");
  const r = await sql(`insert into interno.factor_sesiones (session_id, usuario_id, expira_en, via, agente)
    select '${sid}', u.id, now() + interval '2 hours', 'correo', 'suite'
      from interno.usuarios_admin u where lower(u.correo) = lower('${String(correo).replace(/'/g, "''")}')
    on conflict (session_id) do update set usuario_id = excluded.usuario_id, expira_en = excluded.expira_en`).catch((e) => ({ error: String(e.message ?? e) }));
  const texto = JSON.stringify(r ?? "");
  if (/factor_sesiones.*does not exist|relation .*factor_sesiones/.test(texto)) return null;   // migración sin aplicar
  if (/error|message/i.test(texto) && !Array.isArray(r)) throw new Error(`marcarSesionVerificada: ${texto.slice(0, 200)}`);
  return sid;
}
```

- [ ] **Step 2: Aplicar en cada suite**

Inmediatamente después de la línea que confirma el `access_token` del administrador (anclas en **Files**), añadir la llamada. Import al inicio de cada archivo: `import { marcarSesionVerificada } from "./lib/marcar-factor.mjs";`

| Script | Línea a insertar (tras la ancla) |
|---|---|
| `verificar-botones-bc.mjs` (L57) | `await marcarSesionVerificada(sql, admin.access_token, CORREO_TEMP);` |
| `verificar-constancia-pdf.mjs` (L62) | `await marcarSesionVerificada(sql, admin.access_token, CORREO_TEMP);` |
| `verificar-cuentas-masa.mjs` (L77) | `await marcarSesionVerificada(sql, admin.access_token, correoAdmin);` — `correoAdmin` es la variable con el correo usado en el login de ese script (temporal o `ADMIN_EMAIL`); si no existe con ese nombre, usar la que el script pasa a `login(...)`. |
| `verificar-cumplimiento-boletas.mjs` (L71) | `await marcarSesionVerificada(sql, admin.access_token, CORREO_TEMP);` |
| `verificar-solicitud-pdf.mjs` (L74) | ídem `cuentas-masa` (correo usado en el login). |
| `verificar-movimientos.mjs` (L198) | `await marcarSesionVerificada(sql, ses.access_token, CORREO_TEMP);` |
| `diagnostico-login-e2e.mjs` (L80) | `if (ses) await marcarSesionVerificada(sql, ses, CORREO);` — usar el nombre de la constante del correo temporal de ese script. |
| `verificar-fase1.mjs`, `verificar-fase2.mjs`, `verificar-fase3a.mjs` | dentro de `login()`, antes de `return j.access_token;`: `await marcarSesionVerificada(sql, j.access_token, email);` |

Si en un script el helper de Management API no se llama `sql`, pasar el que exista (es `(q) => fetch(...database/query)` en todos).

- [ ] **Step 3: `scripts/verificar-fase4.mjs` (corre en CI)**

Reemplazar `como` (L26-29) por:

```js
// Consulta como una cuenta real (por correo) o sin identidad. Segundo factor
// (2026-09-28): la sesión simulada lleva session_id y una marca temporal (10
// min) que se borra al final; sin ella un superadmin valdría 0.
const SESION_PRUEBA = "00000000-0000-4000-8000-0000000000f4";
const como = (correo, consulta) => sql(`${correo
  ? `insert into interno.factor_sesiones (session_id, usuario_id, expira_en, via, agente)
       select '${SESION_PRUEBA}', u.id, now() + interval '10 minutes', 'correo', 'verificar-fase4' from interno.usuarios_admin u where lower(u.correo) = lower('${correo}')
       on conflict (session_id) do update set usuario_id = excluded.usuario_id, expira_en = excluded.expira_en;
     select set_config('request.jwt.claims', json_build_object('role','authenticated','email','${correo}','session_id','${SESION_PRUEBA}','sub',coalesce((select u.id::text from auth.users u where u.email = '${correo}'), '00000000-0000-0000-0000-00000000dead'))::text, true);`
  : `select set_config('request.jwt.claims', '{"role":"authenticated","email":"nadie@ejemplo.invalido","sub":"00000000-0000-0000-0000-000000000000"}', true);`}
  set local role authenticated; ${consulta}`);
```

Y antes de `console.log(fallos ? …)` al final:

```js
await sql(`delete from interno.factor_sesiones where session_id = '${SESION_PRUEBA}'`).catch(() => {});
```

Nota: `verificar-fase5.mjs` y `verificar-fase6.mjs` no simulan a un superadmin con correo (fase 6 solo prueba sin claims / postgres / service_role) → sin cambios. `verificar-fase4` quedará rojo en producción hasta aplicar la migración (la tabla no existe); se ejecuta en Task 11.

- [ ] **Step 4: Comprobar sintaxis**

Run: `for f in scripts/lib/marcar-factor.mjs scripts/verificar-fase4.mjs scripts/verificar-fase1.mjs scripts/verificar-fase2.mjs scripts/verificar-fase3a.mjs scripts/verificar-botones-bc.mjs scripts/verificar-constancia-pdf.mjs scripts/verificar-cuentas-masa.mjs scripts/verificar-cumplimiento-boletas.mjs scripts/verificar-solicitud-pdf.mjs scripts/verificar-movimientos.mjs scripts/diagnostico-login-e2e.mjs; do node --check "$f" || echo "ROTO $f"; done`
Expected: sin `ROTO`.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/marcar-factor.mjs scripts/verificar-*.mjs scripts/diagnostico-login-e2e.mjs
git commit -m "scripts: las suites marcan como verificada la sesión del superadmin temporal (segundo factor)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Verificador en producción `scripts/verificar-factor.mjs`

**Files:**
- Create: `scripts/verificar-factor.mjs`

**Interfaces:**
- Consumes: Management API (`SUPABASE_ACCESS_TOKEN`), proxy `/api/supa`, endpoint `/api/segundo-factor`, helper `marcarSesionVerificada` (Task 8). Env opcional `CORREO_PRUEBA` (correo real al que puede llegar el código; si falta, la prueba de `enviar` solo comprueba el rastro y el 503/200 sin abrir el correo).
- Produces: salida `✓/✗` y código de salida.

- [ ] **Step 1: Escribir el script**

```js
// scripts/verificar-factor.mjs — Verificación en PRODUCCIÓN del segundo factor
// por correo (2026-09-28) tras aplicar migraciones/2026-09-28-segundo-factor.sql
// y desplegar el cliente. Crea un superadmin TEMPORAL (patrón 2026-08-19),
// entra por el proxy y comprueba: nivel 0 → vistas vacías salvo la fila propia;
// mi_segundo_factor pendiente; código sembrado por Management API → verificar
// → nivel 99; equipo recordado → segunda sesión sin código; olvidar; endpoints
// con x-sesion cerrados mientras está pendiente. Limpieza total al final.
//   env: SUPABASE_ACCESS_TOKEN  (opcional: CORREO_PRUEBA para un envío real)
//   Uso: . .\scripts\token-supabase.ps1; node scripts/verificar-factor.mjs
import { createHash } from "node:crypto";
import { marcarSesionVerificada, sessionIdDe } from "./lib/marcar-factor.mjs";

const APP = "https://intranet-general.vercel.app";
const SUPA = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN."); process.exit(1); }
const sha = (t) => createHash("sha256").update(t).digest("hex");

let fallos = 0;
async function prueba(nombre, fn) {
  try { await fn(); console.log(`✓ ${nombre}`); }
  catch (e) { fallos++; console.error(`✗ ${nombre}: ${e.message}`); }
}
const igual = (a, b, msj) => { if (a !== b) throw new Error(`${msj}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
const json = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { crudo: t, status: r.status }; } };
async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }),
  });
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`); return JSON.parse(t);
}
const login = async (email, clave) => json(await fetch(`${APP}/api/supa/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: clave }),
}));
const proxy = async (ruta, ses, init = {}) => {
  const r = await fetch(`${APP}/api/supa/${ruta}`, { ...init, headers: { "Content-Type": "application/json", ...(ses ? { "x-sesion": ses } : {}), ...(init.headers ?? {}) } });
  return { status: r.status, json: await json(r) };
};
const factor = async (ses, cuerpo) => {
  const r = await fetch(`${APP}/api/segundo-factor`, { method: "POST", headers: { "Content-Type": "application/json", "x-sesion": ses }, body: JSON.stringify(cuerpo) });
  return { status: r.status, json: await json(r) };
};

// 0 · Service key y superadmin temporal.
const claves = await json(await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${token}` } }));
const service = (Array.isArray(claves) ? claves : []).find((k) => k.type === "secret" || k.name === "service_role")?.api_key;
if (!service) { console.error("No se obtuvo la service key."); process.exit(1); }
const cabService = { apikey: service, authorization: `Bearer ${service}`, "Content-Type": "application/json" };
const gotrue = async (ruta, opciones = {}) => { const r = await fetch(`${SUPA}${ruta}`, { ...opciones, headers: { ...cabService, ...opciones.headers } }); return { ok: r.ok, status: r.status, json: await json(r) }; };
const borrarCuentaGoTrue = async (email) => {
  const lista = await gotrue("/auth/v1/admin/users?per_page=1000");
  const u = (lista.json.users ?? []).find((x) => (x.email ?? "").toLowerCase() === email.toLowerCase());
  if (u) await gotrue(`/auth/v1/admin/users/${u.id}`, { method: "DELETE" });
};
const CORREO_TEMP = (process.env.CORREO_PRUEBA || "zzprueba-factor@grupoer.pe").toLowerCase();
const clave = "Zz" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0") + "aa";
const limpiar = async () => {
  await sql(`delete from interno.usuarios_admin where lower(correo) = '${CORREO_TEMP}'`).catch(() => {});
  await borrarCuentaGoTrue(CORREO_TEMP);
};
await limpiar();
const alta = await gotrue("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email: CORREO_TEMP, password: clave, email_confirm: true }) });
const [persona] = await sql(`select p.dni from personas p where p.dni not like 'ZZ%' and not exists (select 1 from interno.usuarios_admin u where u.persona_dni = p.dni) limit 1`);
const [perfil] = await sql(`select id, version from interno.perfiles where es_superadmin and estado = 'activo' order by version desc limit 1`);
if (!alta.ok || !persona || !perfil) { console.error("No se pudo crear el superadmin temporal", alta.status); process.exit(1); }
await sql(`insert into interno.usuarios_admin (persona_dni, perfil_id, perfil_version, correo, creado_por) values ('${persona.dni}', '${perfil.id}', ${perfil.version}, '${CORREO_TEMP}', 'verificar-factor')`);
const [total] = await sql("select count(*)::int as n from public.v_personal");

try {
  console.log("== 1 · Catálogo");
  await prueba("tablas, funciones y permisos como los deja la migración", async () => {
    const [r] = await sql(`select (select factor_superadmin from interno.politica_acceso where id = 1) as pol,
      ((select prosrc from pg_proc where oid = 'public.fn_nivel_modulo(text)'::regprocedure) ~ 'fn_factor_pendiente') as v4,
      has_function_privilege('authenticated', 'public.mi_segundo_factor()', 'execute') as mio,
      (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'api\\_factor\\_%' and has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')) as api,
      (select count(*)::int from pg_class c where c.relnamespace = 'interno'::regnamespace and c.relname in ('factor_codigos', 'factor_sesiones', 'dispositivos_confiables') and c.relrowsecurity) as tablas`);
    igual(`${r.pol}/${r.v4}/${r.mio}/${r.api}/${r.tablas}`, "true/true/true/5/3", "catálogo");
  });

  console.log("\n== 2 · Sesión pendiente (nivel 0)");
  const s1 = await login(CORREO_TEMP, clave);
  if (!s1.access_token) throw new Error(`login: ${JSON.stringify(s1).slice(0, 200)}`);
  const SID1 = sessionIdDe(s1.access_token);
  await prueba("el JWT trae session_id", async () => { if (!SID1) throw new Error("sin session_id"); });
  await prueba("v_personal vacía; v_usuarios_admin y v_mi_acceso con la fila propia; mi_segundo_factor exigido y no verificado", async () => {
    const p = await proxy("rest/v1/v_personal?select=dni&limit=5", s1.access_token);
    igual(`${p.status}/${p.json.length}`, "200/0", "v_personal");
    const u = await proxy(`rest/v1/v_usuarios_admin?select=correo&correo=eq.${encodeURIComponent(CORREO_TEMP)}`, s1.access_token);
    igual(`${u.status}/${u.json.length}`, "200/1", "v_usuarios_admin");
    const m = await proxy("rest/v1/rpc/mi_segundo_factor", s1.access_token, { method: "POST", body: "{}" });
    igual(`${m.status}/${m.json.exigido}/${m.json.verificado}`, "200/true/false", "mi_segundo_factor");
  });
  await prueba("los endpoints con x-sesion responden 403 mientras el factor está pendiente", async () => {
    const r = await fetch(`${APP}/api/admin-usuarios`, { method: "POST", headers: { "Content-Type": "application/json", "x-sesion": s1.access_token }, body: JSON.stringify({ accion: "eliminar", usuario_id: 999999 }) });
    igual(r.status, 403, "admin-usuarios");
    const t = await json(r); if (!/Verifica el código/.test(t.error ?? "")) throw new Error(`mensaje: ${JSON.stringify(t)}`);
  });

  console.log("\n== 3 · Código");
  await prueba(process.env.CORREO_PRUEBA ? "enviar → 200 y rastro «enviado» (revisa el buzón)" : "enviar → 200 (correo del temporal, no llega a nadie) o 503 si el motor no está; rastro en correo_envios", async () => {
    const r = await factor(s1.access_token, { accion: "enviar" });
    if (![200, 503].includes(r.status)) throw new Error(`${r.status} ${JSON.stringify(r.json)}`);
    if (r.status === 200 && (!r.json.enviado || JSON.stringify(r.json).match(/\b\d{6}\b/))) throw new Error(`respuesta: ${JSON.stringify(r.json)}`);
    const [c] = await sql(`select resultado from correo_envios where accion = 'segundo-factor' and sujeto = '${CORREO_TEMP}' order by id desc limit 1`);
    if (!c) throw new Error("sin rastro");
  });
  await prueba("segundo envío inmediato → 429 con esperaSeg", async () => {
    const r = await factor(s1.access_token, { accion: "enviar" });
    if (r.status !== 429 && r.status !== 503) throw new Error(`${r.status} ${JSON.stringify(r.json)}`);
  });
  const CODIGO = "246810";
  await prueba("código incorrecto → 400 con intentosRestantes 4; código sembrado → 200 listo + token de equipo; nivel 99 y v_personal completa", async () => {
    await sql(`update interno.factor_codigos set usado_en = now() where session_id = '${SID1}' and usado_en is null`);
    await sql(`insert into interno.factor_codigos (usuario_id, session_id, codigo_hash, expira_en, agente) select id, '${SID1}', '${sha(CODIGO + SID1)}', now() + interval '10 minutes', 'verificar-factor' from interno.usuarios_admin where lower(correo) = '${CORREO_TEMP}'`);
    let r = await factor(s1.access_token, { accion: "verificar", codigo: "000000", recordar: true });
    igual(`${r.status}/${r.json.intentosRestantes}`, "400/4", "incorrecto");
    r = await factor(s1.access_token, { accion: "verificar", codigo: CODIGO, recordar: true });
    igual(`${r.status}/${r.json.listo}`, "200/true", "verificar");
    if (!r.json.dispositivo) throw new Error("sin token de equipo");
    globalThis.TOKEN_EQUIPO = r.json.dispositivo;
    const p = await proxy("rest/v1/v_personal?select=dni", s1.access_token);
    igual(`${p.status}/${p.json.length}`, `200/${total.n}`, "v_personal tras verificar");
    const m = await proxy("rest/v1/rpc/mi_segundo_factor", s1.access_token, { method: "POST", body: "{}" });
    igual(m.json.verificado, true, "verificado");
  });

  console.log("\n== 4 · Equipo recordado y revocación");
  const s2 = await login(CORREO_TEMP, clave);
  await prueba("segunda sesión: pendiente hasta presentar el token → 200 listo → nivel 99 sin código", async () => {
    let p = await proxy("rest/v1/v_personal?select=dni&limit=1", s2.access_token); igual(p.json.length, 0, "antes");
    const r = await factor(s2.access_token, { accion: "dispositivo", token: globalThis.TOKEN_EQUIPO });
    igual(`${r.status}/${r.json.listo}`, "200/true", "dispositivo");
    p = await proxy("rest/v1/v_personal?select=dni", s2.access_token); igual(p.json.length, total.n, "después");
  });
  await prueba("olvidar → revocados 1; una tercera sesión ya no puede usar el token (403)", async () => {
    const r = await factor(s2.access_token, { accion: "olvidar" }); igual(`${r.status}/${r.json.revocados}`, "200/1", "olvidar");
    const s3 = await login(CORREO_TEMP, clave);
    const d = await factor(s3.access_token, { accion: "dispositivo", token: globalThis.TOKEN_EQUIPO }); igual(d.status, 403, "token revocado");
  });
  await prueba("helper de suites: marcarSesionVerificada deja una sesión nueva en 99", async () => {
    const s4 = await login(CORREO_TEMP, clave);
    await marcarSesionVerificada(sql, s4.access_token, CORREO_TEMP);
    const p = await proxy("rest/v1/v_personal?select=dni", s4.access_token); igual(p.json.length, total.n, "v_personal");
  });
  await prueba("auditoría: FACTOR_VERIFICADO, FACTOR_DISPOSITIVO y FACTOR_DISPOSITIVOS_REVOCADOS del temporal, sin secretos", async () => {
    const r = await sql(`select accion, datos_despues::text as d from interno.auditoria where accion like 'FACTOR_%' and (datos_despues ->> 'usuario_id')::bigint = (select id from interno.usuarios_admin where lower(correo) = '${CORREO_TEMP}') order by id`);
    igual([...new Set(r.map((x) => x.accion))].sort().join(","), "FACTOR_DISPOSITIVO,FACTOR_DISPOSITIVOS_REVOCADOS,FACTOR_VERIFICADO", "acciones");
    if (r.some((x) => /codigo_hash|token_hash/.test(x.d))) throw new Error("hash en auditoría");
  });
} finally {
  console.log("\n== Limpieza");
  await limpiar();   // usuarios_admin → cascade a factor_codigos, factor_sesiones, dispositivos_confiables
  await sql(`delete from correo_envios where sujeto = '${CORREO_TEMP}' and accion = 'segundo-factor'`).catch(() => {});
}
console.log(fallos ? `\n${fallos} fallo(s).` : "\nTodo verde.");
process.exit(fallos ? 1 : 0);
```

- [ ] **Step 2: Comprobar sintaxis (no se ejecuta hasta la migración)**

Run: `node --check scripts/verificar-factor.mjs`
Expected: sin salida.

- [ ] **Step 3: Commit**

```bash
git add scripts/verificar-factor.mjs
git commit -m "scripts: verificador del segundo factor contra producción (superadmin temporal, código sembrado, equipo recordado)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Documentación

**Files:**
- Create: `docs/seguridad/2026-09-28-segundo-factor.md`
- Modify: `docs/seguridad/README.md` (§1 título, §6, §7 tabla, §8 índice)
- Modify: `docs/checklists/2026-08-21-flujos-e2e.md` (nueva sección A3 tras A2)

- [ ] **Step 1: Informe `docs/seguridad/2026-09-28-segundo-factor.md`**

```markdown
# Seguridad · Segundo factor por correo para el Superadministrador

Fecha: 2026-09-28 · Base: proyecto Supabase `mzpbdkrmokfxrrsotfgs` · Estado: **PENDIENTE DE APLICAR** (se actualiza en el despliegue: migración aplicada por Diego, `verificar-factor` verde, prueba manual).

Cierra el punto «2FA superadmin: POR DEFINIR» de `Accesos_y_Roles_Intranet_V1_0_1.md`. Diseño aprobado: `docs/superpowers/specs/2026-09-28-segundo-factor-correo-design.md`.

## 1. Qué hace

| Tema | Regla |
|---|---|
| A quién | Solo cuentas cuya categoría vigente es Superadministrador (`perfiles.es_superadmin`). Las demás entran solo con clave. El Portal no cambia. |
| Qué pide | Tras la clave correcta, un código de **6 dígitos** enviado al correo de la cuenta (`api/_correo.js`, Gmail SMTP). Vence a los **10 minutos**, **5 intentos**, uno vigente por sesión, **60 s** entre envíos. |
| Dónde se cumple | **En la base**: `fn_nivel_modulo` v4 devuelve 0 a un superadmin cuya sesión (claim `session_id` del JWT) no tiene marca vigente en `interno.factor_sesiones`. Caen en cascada `es_superadmin`, `nivel_en`, `requiere_*`, las políticas RLS y toda RPC. Los endpoints con `x-sesion` que autorizan con la llave de servicio consultan `mi_segundo_factor()` y responden 403 (`api/_factor.js`). |
| Equipo recordado | Casilla marcada por defecto: token de 256 bits en `localStorage['backoffice-dispositivo']`, solo su SHA-256 en `interno.dispositivos_confiables`, **30 días** sin renovación. Revocable en ACC-05 («Olvidar todos los equipos recordados») o por SQL. |
| Vigencia de la marca | `politica_acceso.sesion_backoffice_horas` (hoy 8) desde la verificación; después se vuelve a pedir código (o equipo recordado). |
| Interruptor | `interno.politica_acceso.factor_superadmin` (encendido por defecto). Se edita en ACC-05 por un superadmin ya verificado. |
| Orden de puertas | Código → cambio obligatorio de clave → app. |

## 2. Piezas

- Canónico `supabase/factor.sql` (bloque `@@FACTOR@@` de `seguridad.sql`); migración `supabase/migraciones/2026-09-28-segundo-factor.sql` (una transacción, respaldo en `interno.respaldo_factor`, verificación embebida); reversión `supabase/respaldos/2026-09-28-segundo-factor-reversion.sql`; generador `scripts/factor-generar.mjs`.
- Funciones: `fn_factor_pendiente()` (interna), `fn_nivel_modulo` v4, `mi_segundo_factor()` (authenticated), `guardar_politica` con `p_factor_superadmin`, `api_factor_emitir / verificar / dispositivo_crear / dispositivo_usar / dispositivos_revocar` (solo `service_role`).
- Endpoint `api/segundo-factor.js` (`enviar`, `verificar`, `dispositivo`, `olvidar`); helper `api/_factor.js`; compuerta en `admin-usuarios`, `portal-cuentas`, `solicitud-pdf`, `constancia-portal`, `consentimiento-pdf`, `descargar-documento`, `rit`, `enviar-correo`.
- Cliente: `src/pages/SegundoFactor.jsx`, `src/state.jsx` (`factorPendiente`, `factorVerificado`, `segundoFactor`), `src/layout/Shell.jsx`, ACC-05.
- Auditoría: `FACTOR_VERIFICADO`, `FACTOR_DISPOSITIVO`, `FACTOR_DISPOSITIVOS_REVOCADOS` (sin hashes ni códigos). Rastro de envíos en `correo_envios` (`accion = segundo-factor`).

## 3. Verificación

1. Ensayo local: `node scripts/ensayar-factor.mjs` (Postgres embebido + datos anonimizados; huecos, migración, reglas, reversión, reaplicación).
2. Unitarias: `npm test` (`tests/api/factor.test.js`, `segundo-factor.test.js`, `admin-usuarios.test.js`).
3. CI: `scripts/ensayar-canon.mjs` (invariantes nuevos) y `verificar-fase4.mjs` (simula al superadmin con `session_id` + marca temporal).
4. Producción: `node scripts/verificar-factor.mjs` (superadmin temporal, código sembrado, equipo recordado, revocación, endpoints cerrados) y prueba manual de Diego (código real, reenviar, recordar equipo, segundo ingreso sin código, olvidar equipos).

## 4. Contingencia técnica (el correo no sale)

Sin códigos de respaldo (decisión de Diego). Pasos, con `. .\scripts\token-supabase.ps1`:

```
node -e "const q='update interno.politica_acceso set factor_superadmin = false where id = 1';fetch('https://api.supabase.com/v1/projects/mzpbdkrmokfxrrsotfgs/database/query',{method:'POST',headers:{Authorization:'Bearer '+process.env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query:q})}).then(r=>r.text()).then(console.log)"
```

Con eso todos los superadmins entran solo con clave. Arreglar el motor (`SMTP_PASS`, `scripts/verificar-smtp.mjs`) y volver a encender desde ACC-05 o con el mismo comando y `= true`.

## 5. Reversión completa

`supabase/respaldos/2026-09-28-segundo-factor-reversion.sql` por Management API (una transacción): elimina tablas y funciones nuevas, restaura `fn_nivel_modulo` v3, `guardar_politica` (firma vieja) y `v_politica_acceso`, y quita la columna. El cliente desplegado tolera la ausencia de `mi_segundo_factor` (entra sin factor) y ACC-05 sigue guardando (el parámetro extra se ignora solo si se revierte también el cliente; si no, `guardar_politica` con 12 argumentos fallará: revertir también `src/state.jsx` o volver a aplicar).

## 6. Riesgos aceptados

- Token de equipo en `localStorage` (mismo riesgo que «Recordar mis datos»); revocable.
- Fuerza bruta: 5/10⁶ por código, 60 s entre envíos, límite por IP y por correo en el endpoint (`correo_envios`, 15 por hora por correo, 30 por IP).
- Gmail ~500 correos/día: con equipo recordado son pocos al mes.
- Bloqueo del superadmin si cae el correo: solo la vía técnica de §4.
```

- [ ] **Step 2: `docs/seguridad/README.md`**

- Título (L1): «(fases 0–7, 2026-09-17 → 2026-09-21; segundo factor 2026-09-28)».
- §6, añadir viñeta: «**Segundo factor por correo (2026-09-28):** el Superadministrador teclea un código de 6 dígitos enviado a su correo en cada ingreso (o presenta un equipo recordado de 30 días); hasta verificar, su sesión vale nivel 0 en toda la base (`fn_nivel_modulo` v4). Interruptor `politica_acceso.factor_superadmin`; contingencia solo técnica. Informe `2026-09-28-segundo-factor.md`.»
- §7 tabla, fila «Cada push / PR»: cambiar «(17 invariantes de las fases 0–6)» por «(19 invariantes de las fases 0–6 y el segundo factor)»; fila «A mano»: añadir `verificar-factor.mjs`.
- §8 índice: fila `| 2026-09-28 | segundo factor por correo (superadmin) | \`2026-09-28-segundo-factor.md\` |`.

- [ ] **Step 3: Checklist E2E**

Tras A2, añadir:

```markdown
### A3. Segundo factor del Superadministrador — nuevo 2026-09-28
- [ ] Ingresar con una cuenta Superadministrador → tras la clave aparece «Código de ingreso» con el correo enmascarado; llega el correo «Tu código de ingreso» en menos de un minuto.
- [ ] Código incorrecto → «Código incorrecto. Te quedan N intentos»; 5 fallos → «Agotaste los 5 intentos» y solo queda «Pedir un código nuevo».
- [ ] «Reenviar código» queda deshabilitado 60 s; el código anterior deja de valer.
- [ ] Código correcto con «Recordar este equipo» marcado → entra al BackOffice con todos los datos; cerrar sesión y volver a entrar en el mismo navegador → no pide código.
- [ ] ACC-05 → «Olvidar todos los equipos recordados» → N equipos olvidados; volver a entrar → pide código.
- [ ] ACC-05 → desmarcar «Exigir código por correo…» y guardar → el siguiente ingreso no pide código; volver a marcar.
- [ ] Una cuenta que NO es Superadministrador entra directo, sin código.
- [ ] Si la cuenta además tiene clave provisional: primero el código, después «Reemplaza tu clave provisional».
```

- [ ] **Step 4: Commit**

```bash
git add docs/seguridad/2026-09-28-segundo-factor.md docs/seguridad/README.md docs/checklists/2026-08-21-flujos-e2e.md
git commit -m "docs(seguridad): informe del segundo factor por correo, README y checklist E2E

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Despliegue en orden (migración → push → verificación) y cierre

**Files:**
- Modify (tras verificar): `docs/seguridad/2026-09-28-segundo-factor.md` (estado), `docs/funciones-y-permisos.md` (regenerado)
- Memoria del proyecto (fuera del repo): `C:\Users\DiegoSalguero\.claude\projects\C--Users-DiegoSalguero\memory\proyecto-intranet-negliaf.md`

**Precondición:** todo lo anterior commiteado en local y **sin pushear**. `git status` limpio. `npm test`, `npx vite build`, `node scripts/ensayar-canon.mjs` y `node scripts/ensayar-factor.mjs` verdes.

- [ ] **Step 1: Pedir a Diego que aplique la migración con `!`**

Mensaje a Diego (el clasificador de auto mode deniega DDL en producción a Claude). Comando para su prompt (Git Bash, patrón de la memoria del proyecto):

```
! T=$(powershell -NoProfile -Command '. .\scripts\token-supabase.ps1 *>$null; $env:SUPABASE_ACCESS_TOKEN') && node -e "const fs=require('fs');const q=fs.readFileSync('supabase/migraciones/2026-09-28-segundo-factor.sql','utf8');fetch('https://api.supabase.com/v1/projects/mzpbdkrmokfxrrsotfgs/database/query',{method:'POST',headers:{Authorization:'Bearer '+process.env.T,'Content-Type':'application/json'},body:JSON.stringify({query:q})}).then(async r=>{console.log(r.status, (await r.text()).slice(0,400))})"
```

Expected: `200 []` (o `200` con un cuerpo vacío). Cualquier `factor: …` en el texto es la verificación embebida fallando: la transacción se revirtió, nada cambió; corregir y repetir.

Aviso previo a Diego: desde que la migración se aplica hasta que el deploy está Ready, un superadmin que entre con el cliente viejo verá el BackOffice vacío (nivel 0 sin pantalla). Hacerlo seguido y en horario suyo.

- [ ] **Step 2: Push y CI**

```bash
git push origin main
gh run watch --exit-status $(gh run list --workflow seguridad.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

Expected: workflow `seguridad` verde (pruebas, compilación, `ensayar-canon`, `verificar-despliegue` y, con el secreto, `verificar-fase4/5/6`). Deploy de Vercel Ready (`vercel ls intranet-general` o el panel).

- [ ] **Step 3: Verificador en producción**

```powershell
. .\scripts\token-supabase.ps1; node scripts/verificar-factor.mjs
. .\scripts\token-supabase.ps1; node scripts/verificar-fase4.mjs
```

Expected: `Todo verde.` en ambos. Si `verificar-factor` deja algo a medias (el `finally` limpia, pero comprobar): `select * from interno.usuarios_admin where correo like 'zzprueba-factor%'` debe estar vacío.

- [ ] **Step 4: Prueba manual de Diego (checklist A3)**

Diego entra en Chrome con su cuenta real y recorre `docs/checklists/2026-08-21-flujos-e2e.md` §A3 completo. Cualquier fallo se corrige antes de cerrar.

- [ ] **Step 5: Regenerar `docs/funciones-y-permisos.md` y cerrar el informe**

```powershell
. .\scripts\token-supabase.ps1; node scripts/funciones-y-permisos.mjs
```

Expected: 161 funciones (154 + 7), 0 «SIN GUARDA», las 5 `api_factor_*` en el grupo «servicio» y `mi_segundo_factor` como administrativa con guarda «identidad del JWT (correo_llamador…)».

Actualizar en `docs/seguridad/2026-09-28-segundo-factor.md` la línea de Estado: «**APLICADO en producción el 2026-MM-DD (Diego: «go»). `verificar-factor` y `verificar-fase4` verdes; prueba manual A3 completa.**» y el commit del cliente.

```bash
git add docs/funciones-y-permisos.md docs/seguridad/2026-09-28-segundo-factor.md
git commit -m "docs(seguridad): segundo factor aplicado y verificado en producción; funciones-y-permisos regenerado (161 funciones)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 6: Memoria del proyecto**

Añadir al final de `proyecto-intranet-negliaf.md` una línea «**2026-MM-DD SEGUNDO FACTOR CERRADO:** …» con: migración aplicada por Diego, commits, verificadores verdes, contingencia (`factor_superadmin = false` por Management API), y que las suites nuevas deben llamar `marcarSesionVerificada` para superadmins temporales. **Retomar desde aquí:** esperar planilla de la FASE PILOTO.

---

## Autorrevisión del plan (hecha al escribirlo)

- **Cobertura de la spec:** §1 decisiones → Tasks 1, 4, 6, 7; §2 reglas → Task 1 (SQL) + Task 4 (endpoint); §3 modelo → Task 1; §4 guarda (fn_factor_pendiente, v4, fila propia, mi_segundo_factor, api_factor_*) → Task 1 + ensayo; §5 endpoint → Task 4; §6 cliente → Tasks 6 y 7; §7 suites y CI → Tasks 2, 5, 8; §8 riesgos → Task 10 §6; §9 pruebas y despliegue → Tasks 1, 4, 9, 11; documentación → Tasks 2 (MODELO.md) y 10.
- **Desvíos declarados:** ver «Decisiones del plan» (bloque `@@FACTOR@@` en vez de `CANONICOS`; `fn_factor_pendiente` sin grant; `p_factor_superadmin` con default; compuerta en 8 endpoints; equipo no reconocido → 403).
- **Consistencia de nombres:** `factorPendiente` (user) / `factorVerificado()` / `segundoFactor()` en `state.jsx`, `SegundoFactor.jsx` y `Politica.jsx`; `MSJ_FACTOR` en `_factor.js` y `admin-usuarios.test.js`; `SESION_PRUEBA` en `verificar-fase4`; firmas `api_factor_*` iguales en `factor.sql`, `factor-generar.mjs`, `ensayar-factor.mjs`, `segundo-factor.js` y su test.
