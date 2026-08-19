// Centro de Solicitudes — PDF al legajo (2026-08-19). Al aprobarse una
// solicitud, este endpoint genera el PDF CALCADO del formato en papel de la
// razón social del TIPO (PAPELETA DE PERMISO NEGLIAF.docx y SOLICITUD
// VACACIONES PROMANT SERVICIOS.xlsx, subidos por Diego el 2026-08-19): cajas
// de salida/retorno, casillas de motivo y de goce, y el bloque de V°B° donde
// el registro digital (quién y cuándo, hora del servidor) SUSTITUYE a las
// firmas manuscritas, igual que el acuse sustituye a la firma de recepción.
// Se sube al bucket privado `documentos` y se archiva en el legajo.
// Idempotente por número. Gate: sesión admin (x-sesion) con nivel ≥ 2 en
// Solicitudes.
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

const ETIQUETA_DOC = { DNI: "DNI", CE: "C.E.", Pasaporte: "Pasaporte" };

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
  const negro = rgb(0.1, 0.1, 0.1);

  const texto = (t, x, y, opciones = {}) =>
    pagina.drawText(String(t ?? "-"), { x, y, size: opciones.size ?? 9.5, font: opciones.b ? negrita : fuente, color: opciones.color ?? negro });
  const linea = (x1, y1, x2, y2, grosor = 0.7) =>
    pagina.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: grosor, color: gris });
  const caja = (x, y, w, h) =>
    pagina.drawRectangle({ x, y, width: w, height: h, borderColor: gris, borderWidth: 0.7 });
  // Casilla del formato: cuadradito con X si está marcada.
  const casilla = (x, y, marcada, etiqueta) => {
    caja(x, y - 2, 9, 9);
    if (marcada) texto("X", x + 1.5, y - 0.5, { b: true, size: 8 });
    texto(etiqueta, x + 14, y, { size: 9 });
  };
  const campo = (etiqueta, valor, x, y, anchoLinea) => {
    texto(etiqueta, x, y, { size: 8.5, color: gris });
    const ex = x + etiqueta.length * 4.4 + 6;
    texto(valor, ex, y, { size: 9.5, b: true });
    if (anchoLinea) linea(ex - 2, y - 2.5, x + anchoLinea, y - 2.5, 0.5);
  };

  // Cabecera común: logo + recuadro código/versión + título.
  let y = 800;
  try {
    if (membrete?.logo) {
      const bytes = new Uint8Array(await (await fetch(`${APP}${membrete.logo}`)).arrayBuffer());
      const img = membrete.logo.endsWith(".png") ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      const alto = 40;
      pagina.drawImage(img, { x: 50, y: y - alto, width: (img.width / img.height) * alto, height: alto });
    }
  } catch { /* sin logo */ }
  caja(455, y - 40, 90, 40);
  texto(tipo.codigo_formato, 462, y - 16, { b: true, size: 10 });
  texto(`Versión: ${tipo.version}`, 462, y - 30, { size: 8.5, color: gris });
  y -= 58;
  texto(membrete?.nombre ?? "", 50, y, { size: 8.5, color: gris });
  texto(s.numero, 455, y, { b: true, size: 11, color: azul });
  y -= 24;

  const tituloFormato = s.tipo_id === "papeleta-permiso" ? "PAPELETA DE PERMISO" : "SOLICITUD Y AUTORIZACION DE VACACIONES";
  texto(tituloFormato, 50, y, { b: true, size: 14, color: azul });
  y -= 8;
  linea(50, y, 545, y, 1.2);
  y -= 24;

  const d = s.datos ?? {};
  const etiquetaDoc = ETIQUETA_DOC[s.solicitante_tipo_documento] ?? "DNI";
  const vb = (paso) => eventos.find((e) => (e.accion === "aprobada_paso" || e.accion === "aprobada") && e.paso_titulo === paso);

  if (s.tipo_id === "papeleta-permiso") {
    // Fila de identificación (como el papel: Nombres | DNI | Cargo | Fecha).
    campo("Nombres y Apellidos:", s.solicitante_nombre, 50, y, 330);
    campo(`${etiquetaDoc}:`, s.solicitante_dni, 400, y, 145);
    y -= 22;
    campo("Cargo:", s.cargo ?? "-", 50, y, 330);
    campo("Fecha:", s.creado, 400, y, 145);
    y -= 32;

    // Cajas SALIDA y RETORNO: día/mes/año + hora.
    const cajaFecha = (titulo, valor, x) => {
      const [f, h] = String(valor ?? "").split("T");
      const [anio, mes, dia] = (f ?? "").split("-");
      caja(x, y - 44, 240, 58);
      texto(titulo, x + 8, y, { b: true, size: 9.5 });
      const cab = ["DÍA", "MES", "AÑO", "HORA"];
      const vals = [dia ?? "-", mes ?? "-", anio ?? "-", h ?? "-"];
      cab.forEach((c, i) => {
        const cx = x + 10 + i * 56;
        texto(c, cx, y - 16, { size: 7.5, color: gris });
        caja(cx - 2, y - 38, 50, 16);
        texto(vals[i], cx + 4, y - 33, { size: 9.5, b: true });
      });
    };
    cajaFecha("SALIDA", d.salida, 50);
    cajaFecha("RETORNO", d.retorno, 305);
    y -= 66;

    // MOTIVO con las 4 casillas del formato.
    texto("MOTIVO:", 50, y, { b: true, size: 9.5 });
    casilla(120, y, d.motivo === "Salud", "SALUD");
    casilla(195, y, d.motivo === "Particular", "PARTICULAR");
    casilla(300, y, d.motivo === "Comisión", "COMISIÓN");
    casilla(400, y, d.motivo === "Otros", "OTROS. Especifique:");
    y -= 14;
    if (d.motivo === "Otros" && d.especificacion) {
      texto(d.especificacion, 400, y, { size: 9 });
      linea(398, y - 2.5, 545, y - 2.5, 0.5);
    }
    y -= 18;

    texto("FUNDAMENTACIÓN:", 50, y, { b: true, size: 9.5 });
    y -= 14;
    const fund = String(d.fundamentacion ?? "");
    for (const parte of [fund.slice(0, 105), fund.slice(105, 210)]) {
      if (parte) { texto(parte, 50, y, { size: 9 }); }
      linea(50, y - 2.5, 545, y - 2.5, 0.5);
      y -= 14;
    }
    y -= 8;
    campo("Supervisor - Sede:", `${s.supervisor_nombre ?? "-"}  /  ${s.sede_nombre ?? "-"}`, 50, y, 495);
    y -= 16;
    if (d.adjunto_url) {
      texto("El original firmado está adjunto al expediente digital de esta papeleta.", 50, y, { size: 8, color: gris });
    }
    y -= 34;

    // Bloque de 3 V°B° del papel, con el registro digital.
    const creado = eventos.find((e) => e.accion === "creada");
    const firmas = [
      ["Solicitante", creado ? `${s.solicitante_nombre}` : "-", creado?.en ?? ""],
      ["V°B° Jefe Inmediato", vb("V°B° del jefe inmediato")?.por ?? "(paso no requerido)", vb("V°B° del jefe inmediato")?.en ?? ""],
      ["V°B° Dpto. RR.HH.", vb("V°B° de RRHH")?.por ?? "-", vb("V°B° de RRHH")?.en ?? ""],
    ];
    firmas.forEach(([titulo, quien2, cuando], i) => {
      const x = 50 + i * 170;
      linea(x, y, x + 150, y, 0.8);
      texto(titulo, x + 10, y - 12, { b: true, size: 8.5 });
      texto(quien2, x, y + 6, { size: 8.5 });
      if (cuando) texto(cuando, x, y + 16, { size: 7.5, color: gris });
    });
    y -= 30;
  } else {
    // ---- SOLICITUD Y AUTORIZACION DE VACACIONES (GR-F-012) ----
    campo("FECHA DE SOLICITUD:", s.creado, 370, y + 24, 175); // junto al título
    texto("DATOS DEL TRABAJADOR:", 50, y, { b: true, size: 9.5, color: azul });
    y -= 18;
    campo("Apellidos y Nombres:", s.solicitante_nombre, 50, y, 330);
    campo("DNI / Pasaporte / C.E.:", `${s.solicitante_dni} (${etiquetaDoc})`, 390, y, 155);
    y -= 20;
    campo("Cargo:", s.cargo ?? "-", 50, y, 250);
    campo("Área / Cliente - Sede:", s.sede_nombre ?? "-", 300, y, 245);
    y -= 20;
    campo("Fecha de Ingreso:", s.fecha_ingreso ?? "-", 50, y, 250);
    campo("Horario:", d.horario ?? "-", 300, y, 245);
    y -= 20;
    campo("Jefe Inmediato / Supervisor:", s.supervisor_nombre ?? "-", 50, y, 495);
    y -= 30;

    texto("SOLICITO VACACIONES:", 50, y, { b: true, size: 9.5 });
    casilla(220, y, d.tipo_goce === "Efectivas / Gozadas", "Efectivas / Gozadas");
    casilla(380, y, d.tipo_goce === "Pagadas / Trabajadas", "Pagadas / Trabajadas");
    y -= 26;
    campo("DESDE EL:", d.desde ?? "-", 50, y, 200);
    campo("HASTA EL:", d.hasta ?? "-", 300, y, 200);
    y -= 20;
    campo("DIAS GOZADOS:", String(d.dias_gozados ?? "-"), 50, y, 200);
    campo("DIAS TRABAJADOS:", String(d.dias_trabajados ?? "-"), 300, y, 200);
    y -= 20;
    campo("PERIODO AL QUE PERTENECEN:", d.periodo ?? "-", 50, y, 350);
    y -= 44;

    const creado = eventos.find((e) => e.accion === "creada");
    const rrhh = vb("V°B° de Gerencia de RRHH");
    [["Solicitante", s.solicitante_nombre, creado?.en ?? ""],
     ["V°B° Gerente RR.HH.", rrhh?.por ?? "-", rrhh?.en ?? ""]].forEach(([titulo, quien2, cuando], i) => {
      const x = 90 + i * 250;
      linea(x, y, x + 170, y, 0.8);
      texto(titulo, x + 25, y - 12, { b: true, size: 8.5 });
      texto(quien2, x, y + 6, { size: 8.5 });
      if (cuando) texto(cuando, x, y + 16, { size: 7.5, color: gris });
    });
    y -= 30;
  }

  y -= 14;
  texto("Documento generado por la Intranet GrupoER: el registro de aprobación (hora del servidor) sustituye a las", 50, y, { size: 7.5, color: gris });
  y -= 10;
  texto("firmas manuscritas. El descuento, si corresponde, lo determina la planilla.", 50, y, { size: 7.5, color: gris });

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
    `/rest/v1/vinculos?persona_dni=eq.${encodeURIComponent(s.solicitante_dni)}&select=id,fecha_fin&order=fecha_inicio.desc&limit=1`
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
