// Centro de Solicitudes — PDF al legajo (2026-08-19). Al aprobarse una
// solicitud, este endpoint genera el PDF con el membrete de la razón social
// del TIPO (logo, código de formato y versión), lo sube al bucket privado
// `documentos` y lo archiva en el legajo del trabajador. El registro de
// aprobación (quién y cuándo, hora del servidor) SUSTITUYE a las firmas
// manuscritas, igual que el acuse sustituye a la firma de recepción.
// Idempotente por número: si la solicitud ya tiene documento, lo devuelve.
// Gate: sesión admin (x-sesion) con nivel ≥ 2 en Solicitudes.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createHash } from "node:crypto";

const SUPABASE = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const APP = "https://intranet-general.vercel.app";
const limpiar = (v) => (typeof v === "string" ? v.replace(/^[﻿​\s]+|[﻿​\s]+$/g, "") : v);
const SERVICE = limpiar(process.env.SUPA_SERVICE_KEY) || "";
const cabService = { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" };

async function rest(ruta, opciones = {}) {
  const r = await fetch(`${SUPABASE}${ruta}`, { ...opciones, headers: { ...cabService, ...opciones.headers } });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* sin JSON */ }
  return { ok: r.ok, status: r.status, json, texto };
}

// Campos legibles del jsonb datos (espejo de resumenDatos del front, sin
// caracteres fuera de WinAnsi: nada de flechas).
function lineasDatos(tipoId, d) {
  if (tipoId === "papeleta-permiso") {
    return [
      ["Salida", (d.salida ?? "").replace("T", " ")],
      ["Retorno", (d.retorno ?? "").replace("T", " ")],
      ["Motivo", (d.motivo ?? "") + (d.especificacion ? ` - ${d.especificacion}` : "")],
      ["Fundamentacion", d.fundamentacion ?? ""],
      ["Original firmado", d.adjunto_url ? "Adjuntado al expediente digital" : "-"],
    ];
  }
  return [
    ["Tipo", d.tipo_goce ?? ""],
    ["Desde el", d.desde ?? ""],
    ["Hasta el", d.hasta ?? ""],
    ["Dias gozados", String(d.dias_gozados ?? "")],
    ["Dias trabajados", String(d.dias_trabajados ?? "")],
    ["Periodo al que pertenecen", d.periodo ?? "-"],
    ["Horario", d.horario ?? "-"],
  ];
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!SERVICE) return res.status(500).json({ error: "Falta la clave de servicio." });
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido." });

  // Sesión admin con nivel en Solicitudes.
  const jwt = limpiar(req.headers["x-sesion"] ?? "");
  if (!jwt) return res.status(401).json({ error: "Sesión requerida." });
  const quien = await rest("/auth/v1/user", { headers: { authorization: `Bearer ${jwt}`, apikey: SERVICE } });
  const correo = (quien.json?.email ?? "").toLowerCase();
  if (!quien.ok || !correo || correo.endsWith("@portal.grupoer.pe")) {
    return res.status(401).json({ error: "Sesión inválida." });
  }
  const acceso = (await rest(`/rest/v1/v_mi_acceso?correo=eq.${encodeURIComponent(correo)}&limit=1`)).json?.[0];
  const nivel = acceso?.esSuperadmin ? 3 : (acceso?.matriz?.solicitudes ?? 0);
  if (!acceso || nivel < 2) return res.status(403).json({ error: "Necesitas nivel de acción en Solicitudes." });

  const cuerpo = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
  const numero = String(cuerpo.numero ?? "").trim();
  const s = (await rest(`/rest/v1/v_solicitudes?numero=eq.${encodeURIComponent(numero)}&select=*&limit=1`)).json?.[0];
  if (!s) return res.status(404).json({ error: "La solicitud no existe." });
  if (s.estado !== "aprobada") return res.status(400).json({ error: "Solo una solicitud aprobada genera documento." });
  if (s.documento_id) return res.status(200).json({ documentoId: s.documento_id, yaExistia: true });

  const tipo = (await rest(`/rest/v1/v_solicitud_tipos?id=eq.${s.tipo_id}&limit=1`)).json?.[0];
  if (!tipo?.genera_documento) return res.status(200).json({ sinDocumento: true });
  const membrete = (await rest(`/rest/v1/empresas?id=eq.${tipo.empresa_id}&select=nombre,corto,ruc,logo&limit=1`)).json?.[0];
  const eventos = (await rest(
    `/rest/v1/v_solicitud_eventos?solicitud_id=eq.${s.id}&accion=in.(creada,aprobada_paso,aprobada)&select=*`
  )).json ?? [];

  // ---------------- PDF ----------------
  const pdf = await PDFDocument.create();
  const pagina = pdf.addPage([595, 842]); // A4
  const fuente = await pdf.embedFont(StandardFonts.Helvetica);
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);
  const azul = rgb(0.208, 0.412, 0.627); // #3569a0
  const gris = rgb(0.35, 0.35, 0.35);
  let y = 800;

  // Logo del membrete (estático del deploy). Si falla, sigue sin logo.
  try {
    if (membrete?.logo) {
      const bytes = new Uint8Array(await (await fetch(`${APP}${membrete.logo}`)).arrayBuffer());
      const img = membrete.logo.endsWith(".png") ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      const alto = 42;
      pagina.drawImage(img, { x: 50, y: y - alto, width: (img.width / img.height) * alto, height: alto });
    }
  } catch { /* sin logo */ }
  pagina.drawText(`${tipo.codigo_formato}  ·  Version ${tipo.version}`, { x: 400, y: y - 12, size: 9, font: fuente, color: gris });
  pagina.drawText(s.numero, { x: 400, y: y - 26, size: 12, font: negrita, color: azul });
  y -= 60;
  pagina.drawText(membrete?.nombre ?? "", { x: 50, y, size: 9, font: fuente, color: gris });
  if (membrete?.ruc) pagina.drawText(`RUC ${membrete.ruc}`, { x: 400, y, size: 9, font: fuente, color: gris });
  y -= 26;
  pagina.drawText(tipo.nombre.toUpperCase(), { x: 50, y, size: 15, font: negrita, color: azul });
  y -= 10;
  pagina.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 1, color: azul });
  y -= 22;

  const fila = (etiqueta, valor, x = 50, ancho = 240) => {
    pagina.drawText(etiqueta.toUpperCase(), { x, y, size: 7.5, font: negrita, color: gris });
    const texto = String(valor ?? "-").slice(0, 90);
    pagina.drawText(texto, { x, y: y - 12, size: 10.5, font: fuente });
    return ancho;
  };
  // Solicitante (dos columnas).
  fila("Apellidos y nombres", s.solicitante_nombre); fila("Documento de identidad", s.solicitante_dni, 320); y -= 32;
  fila("Cargo", s.cargo ?? "-"); fila("Area / Sede", s.sede_nombre ?? "-", 320); y -= 32;
  fila("Fecha de ingreso", s.fecha_ingreso ?? "-"); fila("Jefe inmediato / supervisor", s.supervisor_nombre ?? "-", 320); y -= 32;
  fila("Fecha de la solicitud", s.creado); y -= 40;

  pagina.drawText("DETALLE", { x: 50, y, size: 9, font: negrita, color: azul });
  y -= 16;
  for (const [k, v] of lineasDatos(s.tipo_id, s.datos ?? {})) {
    pagina.drawText(`${k}:`, { x: 50, y, size: 9.5, font: negrita, color: gris });
    // Envolver el valor a dos líneas si es largo (fundamentación).
    const texto = String(v ?? "-");
    const partes = texto.length > 80 ? [texto.slice(0, 80), texto.slice(80, 170)] : [texto];
    for (const p of partes) {
      pagina.drawText(p, { x: 200, y, size: 9.5, font: fuente });
      y -= 13;
    }
    if (partes.length === 1) { /* ya bajó una vez */ } else { y -= 0; }
  }
  y -= 20;

  pagina.drawText("REGISTRO DE APROBACION (sustituye a las firmas manuscritas)", { x: 50, y, size: 9, font: negrita, color: azul });
  y -= 16;
  for (const e of eventos) {
    const etiqueta = e.accion === "creada" ? "Solicitud registrada" : (e.paso_titulo ?? "V°B°");
    pagina.drawText(`${etiqueta}: ${e.por} - ${e.en} (hora del servidor)`, { x: 50, y, size: 9.5, font: fuente });
    y -= 13;
  }
  y -= 24;
  pagina.drawText(
    "Documento generado por la Intranet GrupoER. El descuento, si corresponde, lo determina la planilla.",
    { x: 50, y, size: 8, font: fuente, color: gris });

  const bytes = await pdf.save();
  const hash = createHash("sha256").update(bytes).digest("hex");
  const ruta = `solicitudes/${s.empresa}/${s.numero}.pdf`;

  // Subida al bucket privado (service key, upsert).
  const subida = await fetch(`${SUPABASE}/storage/v1/object/documentos/${ruta}`, {
    method: "POST",
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/pdf", "x-upsert": "true" },
    body: Buffer.from(bytes),
  });
  if (!subida.ok) {
    return res.status(502).json({ error: `No se pudo archivar el PDF (${subida.status}).` });
  }

  // Vínculo del solicitante (vigente; si no hay, el último) para el legajo.
  const vinc = (await rest(
    `/rest/v1/vinculos?persona_dni=eq.${s.solicitante_dni}&select=id,fecha_fin&order=fecha_inicio.desc&limit=1`
  )).json?.[0];
  if (!vinc) return res.status(500).json({ error: "El solicitante no tiene vínculo para archivar el documento." });

  const exigeAcuse = tipo.acuse === "siempre" ||
    (tipo.acuse === "motivo_particular" && (s.datos?.motivo === "Particular"));
  const doc = await rest(`/rest/v1/documentos`, {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({
      vinculo_id: vinc.id, tipo: "solicitud",
      titulo: `${tipo.nombre} ${s.numero}`,
      hash_sha256: hash, archivo_url: ruta, exige_acuse: exigeAcuse,
    }),
  });
  const documentoId = doc.json?.[0]?.id;
  if (!doc.ok || !documentoId) {
    return res.status(502).json({ error: "El PDF se archivó pero el legajo no lo registró." });
  }
  await rest(`/rest/v1/solicitudes?id=eq.${s.id}`, {
    method: "PATCH", headers: { prefer: "return=minimal" },
    body: JSON.stringify({ documento_id: documentoId }),
  });
  return res.status(200).json({ documentoId, ruta, exigeAcuse });
}
