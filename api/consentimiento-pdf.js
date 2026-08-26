// api/consentimiento-pdf.js — formato de CONSENTIMIENTO para firma física
// (2026-08-26). El consentimiento digital del primer ingreso ya queda con
// estándar probatorio (tabla consentimientos); este PDF respalda con firma en
// papel al personal YA contratado (recomendación legal D.Leg. 1310 / Ley
// 29733). Imprime el texto ÍNTEGRO de la política vigente + su versión y su
// huella SHA-256, para que el papel firmado apunte exactamente al mismo texto
// que acepta el portal. No se archiva: se genera a demanda.
//  · ?dni=XXXX      → un formato para esa persona (gate: admin activo)
//  · ?empresa=id    → un PDF con el formato de TODOS los vigentes de la RS
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createHash } from "node:crypto";

const SUPABASE = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const APP = "https://intranet-general.vercel.app";
const DOMINIO_PORTAL = "portal.grupoer.pe";
const limpiar = (v) => (typeof v === "string" ? v.replace(/^[﻿​\s]+|[﻿​\s]+$/g, "") : v);
const SERVICE = limpiar(process.env.SUPA_SERVICE_KEY) || "";
const cabService = { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" };

async function rest(ruta, opciones = {}) {
  const r = await fetch(`${SUPABASE}${ruta}`, { ...opciones, headers: { ...cabService, ...opciones.headers } });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* sin JSON */ }
  return { ok: r.ok, status: r.status, json };
}

const winAnsi = (t) => String(t ?? "-")
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/–/g, "-").replace(/…/g, "...")
  .replace(/[^ -~¡-ÿ—]/g, "?");

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!SERVICE) return res.status(500).json({ error: "Falta la clave de servicio." });
  const dni = String(req.query.dni ?? "").trim().toUpperCase();
  const empresaId = String(req.query.empresa ?? "").trim().toLowerCase();
  const jwt = limpiar(req.headers["x-sesion"] ?? "");
  if (!jwt) return res.status(401).json({ error: "Sesión requerida." });
  if (!dni && !empresaId) return res.status(400).json({ error: "Indica ?dni= o ?empresa=." });

  const quien = await rest("/auth/v1/user", { headers: { authorization: `Bearer ${jwt}`, apikey: SERVICE } });
  const correo = (quien.json?.email ?? "").toLowerCase();
  if (!quien.ok || !correo) return res.status(401).json({ error: "Sesión inválida o vencida." });
  if (correo.endsWith(`@${DOMINIO_PORTAL}`)) {
    return res.status(403).json({ error: "Solo el BackOffice genera estos formatos." });
  }
  const admin = (await rest(
    `/rest/v1/usuarios_admin?correo=eq.${encodeURIComponent(correo)}&estado=eq.activo&select=id&limit=1`
  )).json?.[0];
  if (!admin) return res.status(403).json({ error: "Necesitas una cuenta admin activa." });

  // Política vigente: el papel firma EXACTAMENTE el texto que acepta el portal.
  const politica = (await rest(
    `/rest/v1/declaraciones?id=eq.politica-datos&select=version,texto&order=version.desc&limit=1`
  )).json?.[0];
  if (!politica) return res.status(500).json({ error: "No hay política de datos publicada." });
  const huella = createHash("sha256").update(politica.texto, "utf8").digest("hex");

  // Destinatarios del formato.
  let filas;
  if (dni) {
    if (!/^[0-9A-Z-]{4,20}$/.test(dni)) return res.status(400).json({ error: "Documento inválido." });
    filas = (await rest(
      `/rest/v1/vinculos?persona_dni=ilike.${encodeURIComponent(dni)}&select=persona_dni,fecha_fin,` +
      `personas(nombre,tipo_documento),empresas(nombre,ruc,logo)&order=fecha_inicio.desc`
    )).json ?? [];
    filas = [filas.find((f) => f.fecha_fin === null) ?? filas[0]].filter(Boolean);
    if (!filas.length) return res.status(404).json({ error: "La persona no tiene vínculos registrados." });
  } else {
    filas = (await rest(
      `/rest/v1/vinculos?empresa_id=eq.${encodeURIComponent(empresaId)}&fecha_fin=is.null&select=persona_dni,` +
      `personas(nombre,tipo_documento),empresas(nombre,ruc,logo)`
    )).json ?? [];
    filas.sort((a, b) => String(a.personas?.nombre ?? "").localeCompare(String(b.personas?.nombre ?? "")));
    if (!filas.length) return res.status(404).json({ error: "La razón social no tiene personal vigente." });
  }

  // ---------------- PDF (texto fluido con salto de página) ----------------
  const pdf = await PDFDocument.create();
  const fuente = await pdf.embedFont(StandardFonts.Helvetica);
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const azul = rgb(0.208, 0.412, 0.627);
  const gris = rgb(0.35, 0.35, 0.35);
  const negro = rgb(0.1, 0.1, 0.1);
  const logos = new Map(); // por ruta: no descargar el mismo logo por página

  const logoDe = async (ruta) => {
    if (!ruta) return null;
    if (!logos.has(ruta)) {
      try {
        const bytes = new Uint8Array(await (await fetch(`${APP}${ruta}`)).arrayBuffer());
        logos.set(ruta, ruta.endsWith(".png") ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes));
      } catch { logos.set(ruta, null); }
    }
    return logos.get(ruta);
  };

  for (const f of filas) {
    const persona = f.personas ?? {};
    const empresa = f.empresas ?? {};
    let pagina = pdf.addPage([595, 842]);
    let y = 800;
    const salto = (necesario = 60) => {
      if (y < necesario) { pagina = pdf.addPage([595, 842]); y = 800; }
    };
    const texto = (t, x, yy, o = {}) =>
      pagina.drawText(winAnsi(t), { x, y: yy, size: o.size ?? 9.5, font: o.mono ? mono : o.b ? negrita : fuente, color: o.color ?? negro });
    const parrafo = (t, x, ancho, o = {}) => {
      const fnt = o.b ? negrita : fuente;
      const size = o.size ?? 9;
      for (const bloque of winAnsi(t).split("\n")) {
        let fila = "";
        const palabras = bloque.split(/\s+/).filter(Boolean);
        if (!palabras.length) { y -= o.salto ?? 12; continue; }
        for (const pal of palabras) {
          const intento = fila ? `${fila} ${pal}` : pal;
          if (fnt.widthOfTextAtSize(intento, size) > ancho && fila) {
            salto();
            pagina.drawText(fila, { x, y, size, font: fnt, color: o.color ?? negro });
            y -= o.salto ?? 12;
            fila = pal;
          } else fila = intento;
        }
        if (fila) {
          salto();
          pagina.drawText(fila, { x, y, size, font: fnt, color: o.color ?? negro });
          y -= o.salto ?? 12;
        }
      }
    };
    const linea = (x1, yy, x2) =>
      pagina.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: 0.7, color: gris });

    const img = await logoDe(empresa.logo);
    if (img) {
      const alto = 34;
      pagina.drawImage(img, { x: 50, y: y - alto, width: (img.width / img.height) * alto, height: alto });
    }
    texto("Intranet GrupoER", 440, y - 12, { b: true, size: 10, color: azul });
    y -= 50;
    texto(empresa.nombre ?? "Grupo ER", 50, y, { size: 9, color: gris });
    texto(empresa.ruc ? `RUC ${empresa.ruc}` : "", 440, y, { size: 9, color: gris });
    y -= 26;
    texto("CONSENTIMIENTO — ENTREGA ELECTRÓNICA DE DOCUMENTOS", 50, y, { b: true, size: 13, color: azul });
    y -= 16;
    texto("LABORALES Y TRATAMIENTO DE DATOS PERSONALES", 50, y, { b: true, size: 13, color: azul });
    y -= 8; linea(50, y, 545); y -= 22;

    texto("Trabajador:", 50, y, { size: 8.5, color: gris });
    texto(persona.nombre ?? "-", 110, y, { b: true, size: 10 });
    y -= 16;
    texto(`${persona.tipo_documento ?? "DNI"} N.º:`, 50, y, { size: 8.5, color: gris });
    texto(f.persona_dni ?? "-", 110, y, { b: true, size: 10 });
    texto("Empresa:", 300, y, { size: 8.5, color: gris });
    texto(empresa.nombre ?? "-", 350, y, { b: true, size: 9 });
    y -= 24;

    parrafo(
      "Declaro que he leído y acepto el texto íntegro que sigue, que corresponde a la política " +
      `de datos personales y autorización de entrega electrónica versión ${politica.version} de la ` +
      "Intranet GrupoER — el mismo texto que se acepta en el primer ingreso al Portal del Trabajador.",
      50, 495, { size: 9, salto: 12 }
    );
    y -= 6; linea(50, y, 545); y -= 16;
    parrafo(politica.texto, 50, 495, { size: 8.2, salto: 10.5 });
    y -= 4; salto(120); linea(50, y, 545); y -= 14;
    texto(`Versión del texto: ${politica.version} · Algoritmo de huella: SHA-256`, 50, y, { size: 8, color: gris });
    y -= 12;
    texto(huella, 50, y, { mono: true, size: 7.5, color: gris });
    y -= 30;

    salto(120);
    texto("Firma del trabajador:", 50, y, { size: 9 });
    linea(150, y - 2, 340);
    texto("Fecha:", 370, y, { size: 9 });
    linea(405, y - 2, 545);
    y -= 34;
    texto(`${persona.tipo_documento ?? "DNI"} y nombre:`, 50, y, { size: 9 });
    linea(150, y - 2, 545);
    y -= 26;
    parrafo(
      "Este formato respalda con firma física el consentimiento regulado por la Ley N.º 29733 y la " +
      "autorización de entrega de documentos laborales por medios electrónicos conforme al artículo 3.2 " +
      "del Decreto Legislativo N.º 1310. La huella SHA-256 identifica el texto exacto aceptado.",
      50, 495, { size: 7.5, color: gris, salto: 10 }
    );
  }

  const bytes = await pdf.save();
  const nombre = (dni
    ? `Consentimiento - ${filas[0]?.personas?.nombre ?? dni} - ${dni}`
    : `Consentimientos - ${filas[0]?.empresas?.nombre ?? empresaId}`)
    .replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim() + ".pdf";
  res.setHeader("Content-Type", "application/pdf");
  const ascii = nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7E]/g, "_");
  res.setHeader("Content-Disposition",
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`);
  return res.status(200).send(Buffer.from(bytes));
}
