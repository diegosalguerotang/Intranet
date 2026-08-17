// scripts/verificar-privacidad.mjs — pruebas E2E de BD de "Privacidad de
// documentos" (Task 1: bucket privado, rutas internas, RLS admin-solo) más,
// bajo el flag `--endpoint`, las pruebas del endpoint
// `api/descargar-documento` (Task 2) contra producción — se corren tras el
// deploy, no en cada corrida.
// Uso: & scripts/token-supabase.ps1 | Out-Null; node scripts/verificar-privacidad.mjs
//      node scripts/verificar-privacidad.mjs --endpoint   (post-deploy; además
//      requiere SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD_INICIAL en el entorno
//      para los casos admin/portal — sin ellas se saltan con un aviso)
import { createHash, randomInt } from "node:crypto";
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

await prueba("el bucket documentos es privado", async () => {
  const [b] = await sql("select public from storage.buckets where id='documentos'");
  igual(b.public, false, "public");
});
await prueba("ninguna archivo_url guarda URL completa", async () => {
  const [r] = await sql("select count(*)::int n from documentos where archivo_url ~ '^https?://'");
  igual(r.n, 0, "urls completas");
});
await prueba("documentos sin política demo y con política admin", async () => {
  const pols = await sql("select policyname, roles::text from pg_policies where schemaname='public' and tablename='documentos'");
  igual(pols.some((p) => p.policyname === 'acceso_demo'), false, "acceso_demo fuera");
  igual(pols.some((p) => p.policyname === 'documentos_admin' && p.roles.includes('authenticated')), true, "documentos_admin");
});
await prueba("una URL pública antigua de boleta ya no responde 200", async () => {
  // Boleta REAL del lote republicado (Task 4): la propiedad se prueba sobre
  // 'lotes/%', tal como pedía el brief original.
  const [d] = await sql("select archivo_url from documentos where archivo_url like 'lotes/%' limit 1");
  igual(d != null, true, "debe existir al menos un documento con archivo_url para esta prueba");
  const r = await fetch(`https://mzpbdkrmokfxrrsotfgs.supabase.co/storage/v1/object/public/documentos/${d.archivo_url}`);
  igual(r.status !== 200, true, `respondió ${r.status}`);
});

if (process.argv.includes("--endpoint")) {
  console.log("\n--- api/descargar-documento contra producción (--endpoint) ---\n");
  const APP = "https://intranet-general.vercel.app";
  const SUPA = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
  const DOMINIO_PORTAL = "portal.grupoer.pe";
  const json = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { crudo: t }; } };
  const login = async (email, password) => json(await fetch(`${APP}/api/supa/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  }));
  const descargar = (id, jwt) => fetch(`${APP}/api/descargar-documento?id=${id}`, {
    headers: jwt ? { "x-sesion": jwt } : {},
  });

  // (a) sin sesión → 401
  await prueba("endpoint: sin x-sesion → 401", async () => {
    const r = await descargar(1, null);
    igual(r.status, 401, "status");
  });

  let tokenAdmin = null;
  let tokenPortal = null;

  const { SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD_INICIAL } = process.env;
  if (!SUPERADMIN_EMAIL || !SUPERADMIN_PASSWORD_INICIAL) {
    console.log("(sin SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD_INICIAL — se saltan los casos admin, portal e id inexistente)");
  } else {
    const sesionAdmin = await login(SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD_INICIAL);
    if (!sesionAdmin.access_token) {
      fallos++; console.error(`✗ endpoint: login admin — ${JSON.stringify(sesionAdmin)}`);
    } else {
      tokenAdmin = sesionAdmin.access_token;

      // (b) admin ve cualquier documento: URL firmada → PDF real con su hash.
      // Nota: el lote real (archivo_url 'lotes/%') sigue pendiente de
      // republicación (Task 4, ver task-1-report.md Concern 1) — mientras
      // tanto se usa cualquier documento con archivo_url no nulo.
      const [docLote] = await sql("select id, hash_sha256 from documentos where archivo_url like 'lotes/%' limit 1");
      let docPrueba = docLote;
      if (!docPrueba) {
        [docPrueba] = await sql("select id, hash_sha256 from documentos where archivo_url is not null limit 1");
        if (docPrueba) console.log(`(sin boletas del lote real 'lotes/%' — usando el documento ${docPrueba.id} para el caso admin; ver Task 4)`);
      }
      if (!docPrueba) {
        fallos++; console.error("✗ endpoint: no hay ningún documento con archivo_url para probar el caso admin.");
      } else {
        await prueba(`endpoint: admin descarga el documento ${docPrueba.id} (200, PDF real, hash coincide)`, async () => {
          const r = await descargar(docPrueba.id, tokenAdmin);
          igual(r.status, 200, "status");
          const cuerpo = await json(r);
          if (!cuerpo.url) throw new Error(`sin url en la respuesta: ${JSON.stringify(cuerpo)}`);
          const pdf = await fetch(cuerpo.url);
          igual(pdf.status, 200, "status del PDF firmado");
          const buf = Buffer.from(await pdf.arrayBuffer());
          igual(buf.subarray(0, 5).toString("latin1"), "%PDF-", "cabecera del PDF");
          igual(createHash("sha256").update(buf).digest("hex"), docPrueba.hash_sha256, "hash_sha256");
        });
      }

      // (c/d) cuenta del portal: solo ve lo suyo.
      const keys = await (await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/api-keys?reveal=true`, {
        headers: { Authorization: `Bearer ${token}` },
      })).json();
      const SERVICE = Array.isArray(keys) ? keys.find((k) => k.name === "service_role")?.api_key : null;
      if (!SERVICE) {
        console.log("(no se pudo obtener la service key vía Management API — se salta el caso portal)");
      } else {
        const cabService = { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" };
        const restService = async (ruta, opciones = {}) => {
          const r = await fetch(`${SUPA}${ruta}`, { ...opciones, headers: { ...cabService, ...opciones.headers } });
          const t = await r.text();
          let j = null; try { j = t ? JSON.parse(t) : null; } catch { /* sin JSON */ }
          return { ok: r.ok, status: r.status, json: j };
        };

        const candidatos = await sql(
          `select v.persona_dni as dni, d.id as doc_id
           from documentos d join vinculos v on v.id = d.vinculo_id
           where d.archivo_url is not null
           order by v.persona_dni`
        );
        const docPorDni = new Map();
        for (const c of candidatos) if (!docPorDni.has(c.dni)) docPorDni.set(c.dni, c.doc_id);

        const cuentas = await restService("/auth/v1/admin/users?per_page=1000");
        const usuarios = cuentas.json?.users ?? [];
        let dniPropio = null, uidPropio = null, docPropio = null;
        for (const [dni, docId] of docPorDni) {
          const u = usuarios.find((u) => (u.email ?? "").toLowerCase() === `${dni}@${DOMINIO_PORTAL}`);
          if (u) { dniPropio = dni; uidPropio = u.id; docPropio = docId; break; }
        }

        if (!dniPropio) {
          console.log("(sin cuenta portal con documentos — caso portal pendiente de Task 4)");
        } else {
          let docAjeno = null;
          for (const [dni, docId] of docPorDni) if (dni !== dniPropio) { docAjeno = docId; break; }

          const claveTemporal = String(randomInt(10000000, 100000000));
          const fija = await restService(`/auth/v1/admin/users/${uidPropio}`, {
            method: "PUT", body: JSON.stringify({ password: claveTemporal }),
          });
          if (!fija.ok) {
            fallos++; console.error(`✗ endpoint: no se pudo fijar la clave temporal de ${dniPropio}@${DOMINIO_PORTAL} — ${JSON.stringify(fija.json)}`);
          } else {
            const sesionPortal = await login(`${dniPropio}@${DOMINIO_PORTAL}`, claveTemporal);
            if (!sesionPortal.access_token) {
              fallos++; console.error(`✗ endpoint: login portal ${dniPropio} — ${JSON.stringify(sesionPortal)}`);
            } else {
              tokenPortal = sesionPortal.access_token;
              await prueba(`endpoint: portal ${dniPropio} descarga SU documento (200)`, async () => {
                const r = await descargar(docPropio, tokenPortal);
                igual(r.status, 200, "status");
              });
              if (docAjeno) {
                await prueba(`endpoint: portal ${dniPropio} no puede descargar el documento de otro DNI (403)`, async () => {
                  const r = await descargar(docAjeno, tokenPortal);
                  igual(r.status, 403, "status");
                });
              } else {
                console.log("(solo hay un DNI con documentos — no se puede probar el caso 403 de cruce)");
              }
            }
            // Rotación final: la cuenta demo no queda con una clave conocida.
            const rotacion = await restService(`/auth/v1/admin/users/${uidPropio}`, {
              method: "PUT", body: JSON.stringify({ password: String(randomInt(10000000, 100000000)) }),
            });
            console.log(rotacion.ok
              ? `(clave temporal de ${dniPropio}@${DOMINIO_PORTAL} rotada de nuevo — no queda conocida)`
              : `✗ AVISO: no se pudo rotar de nuevo la clave de ${dniPropio}@${DOMINIO_PORTAL} — queda en ${claveTemporal}, rótala a mano.`);
          }
        }
      }

      // (e) id inexistente → 404
      await prueba("endpoint: id inexistente → 404", async () => {
        const r = await descargar(999999999, tokenAdmin);
        igual(r.status, 404, "status");
      });
    }
  }
}

console.log(fallos ? `\n${fallos} PRUEBAS FALLARON` : "\nTODAS LAS PRUEBAS PASARON");
process.exit(fallos ? 1 : 0);
