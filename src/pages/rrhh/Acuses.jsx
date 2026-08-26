import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, Send, Camera, FileSpreadsheet, FileText } from "lucide-react";
import { useApp } from "../../state";
import { supabase } from "../../lib/supabase";
import {
  PageHeader, Card, Stat, Table, Td, Badge, Button, Select, Note, Modal, Field, Input,
} from "../../components/ui";

const ESTADOS = {
  confirmado: { tone: "conf", label: "Confirmado" },
  asistido: { tone: "tinta", label: "Acuse asistido" },
  pendiente: { tone: "pend", label: "Sin confirmar" },
  nunca_ingreso: { tone: "alerta", label: "Nunca ingresó" },
};

// RRH-11 — Seguimiento de acuses
export default function Acuses() {
  const { empresaId, db, persona, sede, empresaPor, registrarAcuseAsistido } = useApp();
  const [fEstado, setFEstado] = useState("");
  const [fSede, setFSede] = useState("");
  const [fPeriodo, setFPeriodo] = useState("");
  const [asistido, setAsistido] = useState(null); // acuse al que se registra asistencia
  const [aviso, setAviso] = useState(null);
  const [exportando, setExportando] = useState(false);
  const [reportando, setReportando] = useState(false);

  const lote = db.lotes.find((l) => l.empresa === empresaId);
  const sedesEmpresa = db.sedes.filter((s) => s.empresa === empresaId);

  const filasEmpresa = useMemo(
    () => db.acuses.filter((a) => persona(a.dni)?.empresa === empresaId),
    [db.acuses, db.personal, empresaId] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const periodos = useMemo(
    () => [...new Set(filasEmpresa.map((a) => a.periodo).filter(Boolean))].sort().reverse(),
    [filasEmpresa]
  );

  const filas = useMemo(
    () =>
      filasEmpresa.filter((a) => {
        const p = persona(a.dni);
        return (
          (!fEstado || a.estado === fEstado) &&
          (!fSede || p?.sede === fSede) &&
          (!fPeriodo || a.periodo === fPeriodo)
        );
      }),
    [filasEmpresa, fEstado, fSede, fPeriodo] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const counts = {
    confirmado: filas.filter((a) => a.estado === "confirmado").length,
    asistido: filas.filter((a) => a.estado === "asistido").length,
    pendiente: filas.filter((a) => a.estado === "pendiente").length,
    nunca: filas.filter((a) => a.estado === "nunca_ingreso").length,
  };

  // El servidor pone hash, supervisor y verifica el adjunto — aquí nada se
  // inventa. Devuelve el error para que el modal lo muestre.
  const registrarAsistido = async (acuse, datos) => {
    const r = await registrarAcuseAsistido(acuse.dni, acuse.lote, datos);
    if (r?.error) return r;
    setAsistido(null);
    setAviso("Acuse asistido registrado con el cargo firmado adjunto. Queda marcado como modalidad asistida y nunca se mezcla con los acuses propios en los conteos.");
    return {};
  };

  // Un solo PDF con una constancia por página, desde el registro inmutable.
  const exportarConstancias = async () => {
    const conAcuse = filas.filter((a) => a.estado === "confirmado" || a.estado === "asistido");
    if (!conAcuse.length) { setAviso("No hay acuses registrados que exportar con los filtros actuales."); return; }
    setExportando(true);
    try {
      const { generarConstanciaPdf, unirPdfs } = await import("../../lib/constancia.js");
      const partes = [];
      for (const a of conAcuse) {
        const p = persona(a.dni);
        const e = p ? empresaPor(p.empresa) : null;
        const campos = [
          ["Trabajador", `${p?.nombre ?? "-"} — DNI ${a.dni}`],
          ["Empresa emisora", `${e?.nombre ?? "-"} — RUC ${e?.ruc ?? "-"}`],
          ["Documento entregado", a.doc],
          ["Lote", a.lote],
          ["Fecha y hora (reloj del servidor, GMT-5)", a.fecha],
          ["Modalidad del acuse", a.modalidad === "asistido" ? `Asistido por supervisor — ${a.supervisor} (motivo: ${a.motivo})` : "Personal, sesión autenticada"],
          ["Versión del documento", `v${a.version}`],
          ["Hash SHA-256 del archivo entregado", a.hash],
        ];
        partes.push(await generarConstanciaPdf({ numero: `${a.lote}-${a.dni}`, campos }));
      }
      const bytes = await unirPdfs(partes);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const el = Object.assign(document.createElement("a"), {
        href: url, download: `constancias-${String(lote?.id ?? empresaId).replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`,
      });
      document.body.appendChild(el);
      el.click();
      el.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setAviso(`${conAcuse.length} constancia${conAcuse.length === 1 ? "" : "s"} exportada${conAcuse.length === 1 ? "" : "s"} en un solo PDF.`);
    } finally {
      setExportando(false);
    }
  };

  // Reporte de fiscalización (2026-08-26): consolidado por período y empresa
  // con publicación / notificación / confirmación separadas (D.Leg. 1310).
  const filasReporte = () =>
    filas.map((a) => ({
      dni: a.dni,
      nombre: persona(a.dni)?.nombre ?? a.nombre ?? "—",
      doc: a.doc,
      periodo: a.periodo ?? "—",
      publicado: a.publicado ?? "—",
      notificado: a.ultimaNotificacion
        ? `${a.ultimaNotificacion}${(a.notificaciones ?? 0) > 1 ? ` (${a.notificaciones})` : ""}`
        : "—",
      confirmado: a.fecha ?? "—",
      modalidad: a.estado === "confirmado" ? "Personal"
        : a.estado === "asistido" ? "Asistido"
        : a.estado === "nunca_ingreso" ? "Nunca ingresó" : "Pendiente",
      hash: a.hash ?? "—",
    }));

  const reporteCsv = () => {
    const r = filasReporte();
    if (!r.length) { setAviso("No hay filas que reportar con los filtros actuales."); return; }
    const enc = ["DNI", "Trabajador", "Documento", "Período", "Publicado (puesta a disposición)",
      "Última notificación por correo", "Confirmado (acuse)", "Modalidad", "Hash SHA-256"];
    const csv = [enc, ...r.map((f) => [f.dni, f.nombre, f.doc, f.periodo, f.publicado, f.notificado, f.confirmado, f.modalidad, f.hash])]
      .map((f) => f.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const el = Object.assign(document.createElement("a"), {
      href: url, download: `reporte-acuses-${empresaId}${fPeriodo ? `-${fPeriodo}` : ""}.csv`,
    });
    document.body.appendChild(el);
    el.click();
    el.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const reportePdf = async () => {
    const r = filasReporte();
    if (!r.length) { setAviso("No hay filas que reportar con los filtros actuales."); return; }
    setReportando(true);
    try {
      const { generarReporteAcusesPdf } = await import("../../lib/constancia.js");
      const e = empresaPor(empresaId);
      const bytes = await generarReporteAcusesPdf({
        empresa: e?.nombre ?? empresaId, ruc: e?.ruc,
        periodo: fPeriodo || "todos",
        generadoEl: new Date().toLocaleString("es-PE", { timeZone: "America/Lima", hour12: false }),
        filas: r,
      });
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const el = Object.assign(document.createElement("a"), {
        href: url, download: `reporte-acuses-${empresaId}${fPeriodo ? `-${fPeriodo}` : ""}.pdf`,
      });
      document.body.appendChild(el);
      el.click();
      el.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } finally {
      setReportando(false);
    }
  };

  return (
    <>
      <PageHeader
        code="RRH-11 · Seguimiento de acuses"
        title="Acuses"
        subtitle={lote ? `Lote ${lote.id} — ${lote.tipo}, ${lote.periodo}` : "Sin lote publicado para esta empresa"}
        actions={
          <>
            <Button variant="secondary" size="sm" disabled title="Llega con el motor de mensajería (Motor 9)">
              <Send size={13} /> Recordar por WhatsApp (próximamente)
            </Button>
            <Button variant="secondary" size="sm" onClick={exportarConstancias} disabled={exportando}>
              <Download size={13} /> {exportando ? "Generando PDF…" : "Exportar constancias del lote"}
            </Button>
            <Button variant="secondary" size="sm" onClick={reporteCsv}>
              <FileSpreadsheet size={13} /> Reporte fiscalización (Excel)
            </Button>
            <Button variant="secondary" size="sm" onClick={reportePdf} disabled={reportando}>
              <FileText size={13} /> {reportando ? "Generando…" : "Reporte fiscalización (PDF)"}
            </Button>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap gap-4">
        <Stat label="Confirmados" value={counts.confirmado} tone="conf" />
        <Stat label="Acuse asistido" value={counts.asistido} hint="Se contabilizan por separado" />
        <Stat label="Sin confirmar" value={counts.pendiente} tone="pend" />
        <Stat label="Nunca ingresaron" value={counts.nunca} tone="alerta" hint="Exige otra acción: reenviar clave" />
      </div>

      {aviso && <div className="mb-4"><Note tone="conf">{aviso}</Note></div>}

      <Card pad={false}>
        <div className="flex flex-wrap gap-2.5 border-b border-borde bg-papel/50 p-3.5">
          <Select value={fEstado} onChange={(e) => setFEstado(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="">Todos los estados</option>
            <option value="confirmado">Confirmado</option>
            <option value="asistido">Acuse asistido</option>
            <option value="pendiente">Sin confirmar</option>
            <option value="nunca_ingreso">Nunca ingresó</option>
          </Select>
          <Select value={fSede} onChange={(e) => setFSede(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="">Todas las sedes</option>
            {sedesEmpresa.map((s) => (
              <option key={s.id} value={s.id}>{s.cliente ?? s.nombre}</option>
            ))}
          </Select>
          <Select value={fPeriodo} onChange={(e) => setFPeriodo(e.target.value)} style={{ maxWidth: 170 }}>
            <option value="">Todos los períodos</option>
            {periodos.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </Select>
        </div>
        <Table head={["DNI", "Trabajador", "Sede", "Estado", "Fecha del acuse", ""]}>
          {filas.map((a, i) => {
            const p = persona(a.dni);
            const est = ESTADOS[a.estado];
            return (
              <tr key={i} className="hover:bg-papel/60">
                <Td className="font-mono text-[12px]">{a.dni}</Td>
                <Td className="font-semibold">{p?.nombre}</Td>
                <Td className="text-gris">{sede(p?.sede)?.cliente}</Td>
                <Td><Badge tone={est.tone}>{est.label}</Badge></Td>
                <Td className="font-mono text-[12px] text-gris">{a.fecha ?? "—"}</Td>
                <Td>
                  {a.estado === "confirmado" || a.estado === "asistido" ? (
                    <Link to={`/rrhh/acuses/${a.dni}`} className="text-[12px] font-semibold text-petroleo hover:underline">
                      Ver evidencia
                    </Link>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setAsistido(a)}>
                      Registrar acuse asistido
                    </Button>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <AcuseAsistido acuse={asistido} onClose={() => setAsistido(null)} onRegistrar={registrarAsistido} />
    </>
  );
}

// RRH-13 — Registrar acuse asistido. La foto del cargo firmado se sube DE
// VERDAD al bucket privado antes de llamar al RPC, que verifica su existencia;
// hash y supervisor los pone la BD desde el documento y la sesión.
function AcuseAsistido({ acuse, onClose, onRegistrar }) {
  const { persona } = useApp();
  const hoy = new Date().toISOString().slice(0, 10);
  const [motivo, setMotivo] = useState("Sin celular");
  const [fechaEntrega, setFechaEntrega] = useState(hoy);
  const [archivo, setArchivo] = useState(null);
  const [declaro, setDeclaro] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  const p = acuse ? persona(acuse.dni) : null;

  const cerrar = () => { setArchivo(null); setDeclaro(false); setError(null); onClose(); };

  const registrar = async () => {
    setOcupado(true);
    setError(null);
    try {
      const extension = (archivo.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const ruta = `cargos/${String(acuse.lote).replace(/[^A-Za-z0-9._-]+/g, "-")}/${acuse.dni}-${Date.now()}.${extension}`;
      const { error: errSubida } = await supabase.storage.from("documentos")
        .upload(ruta, archivo, { contentType: archivo.type || "image/jpeg", upsert: true });
      if (errSubida) throw new Error(`No se pudo subir el cargo firmado: ${errSubida.message}`);
      const r = await onRegistrar(acuse, { motivo, fechaEntrega, adjunto: ruta });
      if (r?.error) throw new Error(r.error.message ?? String(r.error));
      setArchivo(null);
      setDeclaro(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Modal open={!!acuse} onClose={cerrar} title="RRH-13 · Registrar acuse asistido">
      {p && (
        <div className="space-y-4">
          <Note tone="neutral">
            <b>{p.nombre}</b> — {acuse.doc}. El acuse quedará registrado como modalidad{" "}
            <b>asistida</b>, identificando a quien lo registra.
          </Note>
          <Field label="Fecha de la entrega física" required hint="Puede ser anterior al registro, nunca futura. La diferencia queda visible en la constancia.">
            <Input type="date" value={fechaEntrega} max={hoy} onChange={(e) => setFechaEntrega(e.target.value)} />
          </Field>
          <Field label="Motivo" required>
            <Select value={motivo} onChange={(e) => setMotivo(e.target.value)}>
              <option>Sin celular</option>
              <option>Sin acceso a datos</option>
              <option>Negativa a usar el portal</option>
              <option>Otro</option>
            </Select>
          </Field>
          <Field label="Cargo firmado (obligatorio)" hint="Sin el adjunto no se registra el acuse: un acuse asistido sin respaldo físico no vale más que una afirmación.">
            <label
              className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-caja border-2 border-dashed px-4 py-6 text-[13px] font-semibold transition-colors ${
                archivo ? "border-conf bg-conf-bg text-conf" : "border-borde-f text-gris hover:border-petroleo-cl"
              }`}
            >
              <Camera size={16} /> {archivo ? `${archivo.name} listo para subir` : "Adjuntar foto del cargo firmado"}
              <input
                type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden"
                onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
              />
            </label>
          </Field>
          <label className="flex items-start gap-2 text-[12.5px] leading-snug text-tinta-2">
            <input type="checkbox" checked={declaro} onChange={(e) => setDeclaro(e.target.checked)} className="mt-0.5 accent-petroleo" />
            Declaro que entregué el documento físicamente al trabajador en la fecha indicada y que el cargo adjunto
            corresponde a su firma.
          </label>
          {error && <Note tone="alerta">{error}</Note>}
          <div className="flex gap-2">
            <Button disabled={!archivo || !declaro || ocupado} onClick={registrar}>
              {ocupado ? "Subiendo y registrando…" : "Registrar acuse"}
            </Button>
            <Button variant="secondary" onClick={cerrar}>Cancelar</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// RRH-12 — Constancia de entrega
export function Constancia() {
  const { dni } = useParams();
  const { db, persona, empresaPor } = useApp();
  const [errorCargo, setErrorCargo] = useState(null);
  const a = db.acuses.find((x) => x.dni === dni && (x.estado === "confirmado" || x.estado === "asistido"));
  const p = persona(dni);
  const e = p ? empresaPor(p.empresa) : null;

  if (!a || !p) {
    return (
      <>
        <Link to="/rrhh/acuses" className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-petroleo hover:underline">
          <ArrowLeft size={13} /> Volver a acuses
        </Link>
        <Note tone="pend">No existe un acuse registrado para el DNI {dni}.</Note>
      </>
    );
  }

  const campos = [
    ["Trabajador", `${p.nombre} — DNI ${p.dni}`],
    ["Empresa emisora", `${e?.nombre} — RUC ${e?.ruc}`],
    ["Documento entregado", a.doc],
    ["Lote", a.lote],
    ["Fecha y hora (reloj del servidor, GMT-5)", a.fecha],
    ["Dirección IP de origen", a.ip],
    ["Dispositivo y navegador", a.dispositivo],
    ["Modalidad del acuse", a.modalidad === "asistido" ? `Asistido por supervisor — ${a.supervisor} (motivo: ${a.motivo})` : "Personal, sesión autenticada"],
    ["Versión del documento", `v${a.version} — sin correcciones posteriores`],
    ["Hash SHA-256 del archivo entregado", a.hash],
  ];
  if (a.modalidad === "asistido") campos.splice(5, 0, ["Fecha de entrega física declarada", a.fechaEntrega]);

  const descargarPdf = async () => {
    // pdf-lib entra por import dinámico para no cargarlo en el chunk principal.
    const { generarConstanciaPdf } = await import("../../lib/constancia.js");
    const bytes = await generarConstanciaPdf({
      numero: `${a.lote}-${p.dni}`,
      campos,
      notaAsistido: a.modalidad === "asistido"
        ? `Acuse asistido: la constancia lo declara de forma expresa, identifica al supervisor que lo registró (${a.supervisor}) y adjunta el cargo firmado escaneado. No se presenta como acuse propio.`
        : null,
      declaracion: "Declaro haber recibido mi boleta de pago del periodo indicado y haber podido revisar su contenido.",
    });
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = `constancia-${`${a.lote}-${p.dni}`.replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`;
    enlace.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Link to="/rrhh/acuses" className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-petroleo hover:underline">
        <ArrowLeft size={13} /> Volver a acuses
      </Link>
      <PageHeader
        code="RRH-12 · Constancia de entrega"
        title={`Constancia — ${p.nombre}`}
        subtitle="Todos los campos provienen del registro inmutable del acuse. Ninguno se recalcula al generar la constancia."
        actions={<Button size="sm" onClick={descargarPdf}><Download size={13} /> Descargar en PDF</Button>}
      />
      <Card className="max-w-3xl">
        <div className="mb-5 border-b border-borde pb-4">
          <div className="text-[15px] font-bold text-tinta">CONSTANCIA DE ENTREGA DE DOCUMENTO LABORAL</div>
          <div className="mt-0.5 font-mono text-[11px] text-gris">N° {a.lote}-{p.dni} · Generada desde el registro de acuses</div>
        </div>
        <div className="space-y-3.5">
          {campos.map(([k, v]) => (
            <div key={k} className="grid gap-1 sm:grid-cols-[280px_1fr]">
              <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-gris">{k}</div>
              <div className={`text-[13px] text-tinta ${k.includes("Hash") ? "break-all font-mono text-[11.5px]" : ""}`}>{v}</div>
            </div>
          ))}
        </div>
        <div className="mt-5 space-y-2.5">
          {a.modalidad === "asistido" && (
            <Note tone="pend">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Acuse <b>asistido</b>: la constancia lo declara de forma expresa, identifica al supervisor que lo
                  registró y adjunta el cargo firmado escaneado. No se presenta como acuse propio.
                </span>
                {a.adjunto && (
                  <button
                    type="button"
                    className="shrink-0 font-semibold text-petroleo hover:underline"
                    onClick={async () => {
                      setErrorCargo(null);
                      const { data, error } = await supabase.storage.from("documentos").createSignedUrl(a.adjunto, 600);
                      if (data?.signedUrl) window.open(data.signedUrl, "_blank");
                      else setErrorCargo(error?.message ?? "No se pudo abrir el cargo firmado.");
                    }}
                  >
                    Ver cargo firmado
                  </button>
                )}
              </div>
            </Note>
          )}
          {errorCargo && <Note tone="alerta">{errorCargo}</Note>}
          <Note tone="neutral">
            Declaración aceptada por el trabajador: «Declaro haber recibido mi boleta de pago del periodo indicado y
            haber podido revisar su contenido.» El texto se guarda junto con el acuse, no como referencia a la plantilla.
          </Note>
        </div>
      </Card>
    </>
  );
}
