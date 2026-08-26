// api/constancia-portal.js — constancia de recepción en PDF (2026-08-25).
// Antes el portal generaba un .txt en el navegador; para una inspección
// (SUNAFIL) hace falta un documento formal. La constancia NO se archiva: se
// regenera a demanda desde el registro inmutable (acuses), que es la fuente
// de verdad. Gate igual que descargar-documento: cuenta del portal → solo lo
// suyo; admin activo del BackOffice → cualquiera.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const periodoLegible = (p) => {
  const m = /^(\d{4})-(\d{2})/.exec(p ?? "");
  return m ? `${MESES[Number(m[2]) - 1]} ${m[1]}` : (p ?? "");
};
// Lima (UTC-5, sin horario de verano): la hora del servidor, legible.
const fechaLima = (iso) => {
  if (!iso) return "-";
  const d = new Date(new Date(iso).getTime() - 5 * 3600e3);
  const dosD = (n) => String(n).padStart(2, "0");
  return `${dosD(d.getUTCDate())}/${dosD(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${dosD(d.getUTCHours())}:${dosD(d.getUTCMinutes())} (hora de Perú)`;
};
// Helvetica de pdf-lib codifica WinAnsi: se sustituye lo que no entra.
const winAnsi = (t) => String(t ?? "-")
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/–/g, "-").replace(/…/g, "...")
  .replace(/[^ -~¡-ÿ—]/g, "?");

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!SERVICE) return res.status(500).json({ error: "Falta la clave de servicio." });
  const id = String(req.query.id ?? "");
  const jwt = limpiar(req.headers["x-sesion"] ?? "");
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: "Falta el id del documento." });
  if (!jwt) return res.status(401).json({ error: "Sesión requerida." });

  const quien = await rest("/auth/v1/user", { headers: { authorization: `Bearer ${jwt}`, apikey: SERVICE } });
  const correo = (quien.json?.email ?? "").toLowerCase();
  if (!quien.ok || !correo) return res.status(401).json({ error: "Sesión inválida o vencida." });

  // Acuse + documento + trabajador + empresa en una sola consulta embebida.
  const a = (await rest(
    `/rest/v1/acuses?documento_id=eq.${id}&select=id,modalidad,registrado_en,dispositivo,ip,agente,hash_sha256,declaracion,` +
    `registrado_por,entrega_fisica_en,documentos(id,tipo,titulo,periodo,version,publicado_en,archivo_url,` +
    `notificaciones_documento(enviado_en),` +
    `vinculos(persona_dni,personas(nombre,tipo_documento),empresas(nombre,ruc,corto,logo)))&limit=1`
  )).json?.[0];
  if (!a) return res.status(404).json({ error: "Este documento no tiene recepción confirmada." });

  const doc = a.documentos;
  const persona = doc?.vinculos?.personas;
  const empresa = doc?.vinculos?.empresas;
  const dni = doc?.vinculos?.persona_dni ?? "";

  let autorizado = false;
  if (correo.endsWith(`@${DOMINIO_PORTAL}`)) {
    autorizado = dni.toLowerCase() === correo.split("@")[0];
  } else {
    const admin = (await rest(
      `/rest/v1/usuarios_admin?correo=eq.${encodeURIComponent(correo)}&estado=eq.activo&select=id&limit=1`
    )).json?.[0];
    autorizado = Boolean(admin);
  }
  if (!autorizado) return res.status(403).json({ error: "No tienes acceso a esta constancia." });

  // ---------------- PDF ----------------
  const pdf = await PDFDocument.create();
  const pagina = pdf.addPage([595, 842]); // A4
  const fuente = await pdf.embedFont(StandardFonts.Helvetica);
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const azul = rgb(0.208, 0.412, 0.627); // #3569a0
  const gris = rgb(0.35, 0.35, 0.35);
  const negro = rgb(0.1, 0.1, 0.1);

  const texto = (t, x, y, o = {}) =>
    pagina.drawText(winAnsi(t), { x, y, size: o.size ?? 9.5, font: o.mono ? mono : o.b ? negrita : fuente, color: o.color ?? negro });
  const linea = (x1, y1, x2, y2, grosor = 0.7) =>
    pagina.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: grosor, color: gris });
  // Envuelve un párrafo al ancho de la caja; devuelve la y final.
  const parrafo = (t, x, y, ancho, o = {}) => {
    const f = o.b ? negrita : fuente;
    const size = o.size ?? 9;
    for (const bloque of winAnsi(t).split("\n")) {
      let fila = "";
      const palabras = bloque.split(/\s+/).filter(Boolean);
      if (!palabras.length) { y -= o.salto ?? 12; continue; }
      for (const p of palabras) {
        const intento = fila ? `${fila} ${p}` : p;
        if (f.widthOfTextAtSize(intento, size) > ancho && fila) {
          pagina.drawText(fila, { x, y, size, font: f, color: o.color ?? negro });
          y -= o.salto ?? 12;
          fila = p;
        } else fila = intento;
      }
      if (fila) { pagina.drawText(fila, { x, y, size, font: f, color: o.color ?? negro }); y -= o.salto ?? 12; }
    }
    return y;
  };
  const campo = (etiqueta, valor, x, y, o = {}) => {
    texto(etiqueta, x, y, { size: 8.5, color: gris });
    texto(valor, x, y - 13, { size: o.size ?? 10, b: true, mono: o.mono });
  };

  let y = 800;
  try {
    if (empresa?.logo) {
      const bytes = new Uint8Array(await (await fetch(`${APP}${empresa.logo}`)).arrayBuffer());
      const img = empresa.logo.endsWith(".png") ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      const alto = 38;
      pagina.drawImage(img, { x: 50, y: y - alto, width: (img.width / img.height) * alto, height: alto });
    }
  } catch { /* sin logo */ }
  texto("Intranet GrupoER", 430, y - 12, { b: true, size: 10, color: azul });
  texto(`N.º de constancia: ${a.id}`, 430, y - 26, { size: 9 });
  y -= 58;
  texto(empresa?.nombre ?? "", 50, y, { size: 9, color: gris });
  texto(empresa?.ruc ? `RUC ${empresa.ruc}` : "", 430, y, { size: 9, color: gris });
  y -= 26;

  texto("CONSTANCIA DE RECEPCIÓN DE DOCUMENTO", 50, y, { b: true, size: 15, color: azul });
  y -= 8;
  linea(50, y, 545, y, 1.2);
  y -= 28;

  campo("Trabajador", persona?.nombre ?? "-", 50, y);
  campo(`${persona?.tipo_documento ?? "DNI"} N.º`, dni, 400, y);
  y -= 38;
  campo("Documento recibido", doc?.titulo ?? "-", 50, y);
  campo("Período", periodoLegible(doc?.periodo) || "-", 400, y);
  y -= 38;
  campo("Tipo", doc?.tipo ?? "-", 50, y);
  campo("Versión publicada", `v${doc?.version ?? 1} · ${fechaLima(doc?.publicado_en).split(" ")[0]}`, 400, y);
  y -= 38;
  // Puesta a disposición ≠ confirmación (D.Leg. 1310): fechas separadas y
  // evidencia de notificación aunque el trabajador nunca confirme.
  const notifs = (doc?.notificaciones_documento ?? [])
    .map((n) => n.enviado_en).filter(Boolean).sort();
  campo("Puesta a disposición en el portal", fechaLima(doc?.publicado_en), 50, y);
  campo("Última notificación por correo",
    notifs.length ? `${fechaLima(notifs[notifs.length - 1])} (${notifs.length} en total)` : "—", 300, y);
  y -= 38;
  const archivo = String(doc?.archivo_url ?? "").split("/").pop() || "-";
  campo("Archivo entregado", archivo, 50, y, { mono: true, size: 8.5 });
  y -= 44;

  texto("REGISTRO DE LA CONFIRMACIÓN", 50, y, { b: true, size: 10, color: azul });
  y -= 6; linea(50, y, 545, y); y -= 20;
  campo("Confirmado el", fechaLima(a.registrado_en), 50, y);
  campo("Modalidad", a.modalidad === "asistido" ? "Acuse asistido" : "Personal (desde el portal)", 400, y);
  y -= 38;
  campo("Dispositivo", (a.dispositivo ?? "-").slice(0, 95), 50, y, { size: 8 });
  y -= 36;
  // IP y user-agent capturados en el SERVIDOR (los inyecta el proxy; el
  // cliente no puede fijarlos). Los acuses previos a la mejora no los tienen.
  const sinDato = "No registrada (acuse anterior al 26/08/2026)";
  campo("Dirección IP", a.ip ?? sinDato, 50, y, { mono: Boolean(a.ip) });
  y -= 36;
  campo("Navegador (user-agent verificado en servidor)", (a.agente ?? sinDato).slice(0, 95), 50, y, { size: 8 });
  y -= 36;
  if (a.modalidad === "asistido") {
    campo("Registrado por", a.registrado_por ?? "-", 50, y);
    campo("Entrega física", fechaLima(a.entrega_fisica_en), 300, y);
    y -= 38;
  }
  texto("Huella digital del archivo exacto que se mostró y recibió — Algoritmo: SHA-256:", 50, y, { size: 8.5, color: gris });
  y -= 13;
  texto(a.hash_sha256 ?? "-", 50, y, { mono: true, size: 8.5, b: true });
  y -= 30;

  texto("TEXTO ACEPTADO POR EL TRABAJADOR AL CONFIRMAR", 50, y, { b: true, size: 10, color: azul });
  y -= 6; linea(50, y, 545, y); y -= 16;
  y = parrafo(a.declaracion ?? "-", 50, y, 495, { size: 8.5, salto: 11.5 });
  y -= 16;

  linea(50, y, 545, y); y -= 14;
  y = parrafo(
    "Esta constancia se genera desde el registro inmutable de acuses de la Intranet GrupoER y acredita la " +
    "puesta a disposición y recepción del documento por medios electrónicos conforme al artículo 3.2 del " +
    "Decreto Legislativo N.º 1310. La confirmación de recepción reemplaza la firma del cargo físico y no " +
    "implica conformidad con el contenido del documento. La huella SHA-256 permite verificar que el archivo " +
    "conservado es exactamente el que se entregó. Todas las marcas de tiempo corresponden al reloj del " +
    "servidor, sincronizado por NTP, expresadas en la zona horaria UTC-5 (América/Lima).",
    50, y, 495, { size: 7.5, color: gris, salto: 10 }
  );

  const bytes = await pdf.save();
  const nombre = `Constancia de recepción ${periodoLegible(doc?.periodo)} - ${persona?.nombre ?? ""} - ${dni}`
    .replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim() + ".pdf";
  res.setHeader("Content-Type", "application/pdf");
  // El nombre va en RFC 5987 (UTF-8) con reserva ASCII para navegadores viejos.
  const ascii = nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7E]/g, "_");
  res.setHeader("Content-Disposition",
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`);
  return res.status(200).send(Buffer.from(bytes));
}
