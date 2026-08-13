import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, Send, Camera } from "lucide-react";
import { useApp } from "../../state";
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
  const { empresaId, db, persona, sede, registrarAcuseAsistido } = useApp();
  const [fEstado, setFEstado] = useState("");
  const [fSede, setFSede] = useState("");
  const [asistido, setAsistido] = useState(null); // acuse al que se registra asistencia
  const [aviso, setAviso] = useState(null);

  const lote = db.lotes.find((l) => l.empresa === empresaId);

  const filas = useMemo(
    () =>
      db.acuses.filter((a) => {
        const p = persona(a.dni);
        return (
          p?.empresa === empresaId &&
          (!fEstado || a.estado === fEstado) &&
          (!fSede || p.sede === fSede)
        );
      }),
    [db.acuses, db.personal, empresaId, fEstado, fSede]
  );

  const counts = {
    confirmado: filas.filter((a) => a.estado === "confirmado").length,
    asistido: filas.filter((a) => a.estado === "asistido").length,
    pendiente: filas.filter((a) => a.estado === "pendiente").length,
    nunca: filas.filter((a) => a.estado === "nunca_ingreso").length,
  };

  const registrarAsistido = (acuse, datos) => {
    registrarAcuseAsistido(acuse.dni, acuse.lote, {
      estado: "asistido", modalidad: "asistido",
      fecha: new Date().toISOString().slice(0, 16).replace("T", " "),
      supervisor: "Registro RRHH", motivo: datos.motivo, fechaEntrega: datos.fechaEntrega,
      dispositivo: "Registrado desde BackOffice", ip: "—",
      hash: "e4a9b1d7f3f1a9c7e2b8d4a6f0c5e1b7a9d3f8c2e6a4b0d9f1c7e3a5b8d2f6c0",
    });
    setAsistido(null);
    setAviso("Acuse asistido registrado. Queda marcado como modalidad asistida y nunca se mezcla con los acuses propios en los conteos.");
  };

  return (
    <>
      <PageHeader
        code="RRH-11 · Seguimiento de acuses"
        title="Acuses"
        subtitle={lote ? `Lote ${lote.id} — ${lote.tipo}, ${lote.periodo}` : "Sin lote publicado para esta empresa"}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setAviso("Recordatorio masivo encolado por WhatsApp, respetando la ventana horaria configurada.")}>
              <Send size={13} /> Recordar por WhatsApp
            </Button>
            <Button variant="secondary" size="sm">
              <Download size={13} /> Exportar constancias del lote
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
            <option value="sunat">SUNAT Lima</option>
            <option value="migraciones">MIGRACIONES</option>
            <option value="minedu">MINEDU</option>
            <option value="ins">INS</option>
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

// RRH-13 — Registrar acuse asistido
function AcuseAsistido({ acuse, onClose, onRegistrar }) {
  const { persona } = useApp();
  const [motivo, setMotivo] = useState("Sin celular");
  const [fechaEntrega, setFechaEntrega] = useState("2026-08-10");
  const [foto, setFoto] = useState(false);
  const [declaro, setDeclaro] = useState(false);
  const p = acuse ? persona(acuse.dni) : null;

  return (
    <Modal open={!!acuse} onClose={onClose} title="RRH-13 · Registrar acuse asistido">
      {p && (
        <div className="space-y-4">
          <Note tone="neutral">
            <b>{p.nombre}</b> — Boleta de pago, Julio 2026. El acuse quedará registrado como modalidad{" "}
            <b>asistida</b>, identificando a quien lo registra.
          </Note>
          <Field label="Fecha de la entrega física" required hint="Puede ser anterior al registro, nunca futura. La diferencia queda visible en la constancia.">
            <Input type="date" value={fechaEntrega} max="2026-08-10" onChange={(e) => setFechaEntrega(e.target.value)} />
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
            <button
              type="button"
              onClick={() => setFoto(true)}
              className={`flex w-full items-center justify-center gap-2 rounded-caja border-2 border-dashed px-4 py-6 text-[13px] font-semibold transition-colors ${
                foto ? "border-conf bg-conf-bg text-conf" : "border-borde-f text-gris hover:border-petroleo-cl"
              }`}
            >
              <Camera size={16} /> {foto ? "cargo_firmado_20260810.jpg adjuntado" : "Adjuntar foto del cargo firmado"}
            </button>
          </Field>
          <label className="flex items-start gap-2 text-[12.5px] leading-snug text-tinta-2">
            <input type="checkbox" checked={declaro} onChange={(e) => setDeclaro(e.target.checked)} className="mt-0.5 accent-petroleo" />
            Declaro que entregué el documento físicamente al trabajador en la fecha indicada y que el cargo adjunto
            corresponde a su firma.
          </label>
          <div className="flex gap-2">
            <Button disabled={!foto || !declaro} onClick={() => onRegistrar(acuse, { motivo, fechaEntrega })}>
              Registrar acuse
            </Button>
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
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

  return (
    <>
      <Link to="/rrhh/acuses" className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-petroleo hover:underline">
        <ArrowLeft size={13} /> Volver a acuses
      </Link>
      <PageHeader
        code="RRH-12 · Constancia de entrega"
        title={`Constancia — ${p.nombre}`}
        subtitle="Todos los campos provienen del registro inmutable del acuse. Ninguno se recalcula al generar la constancia."
        actions={<Button size="sm"><Download size={13} /> Descargar en PDF</Button>}
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
              Acuse <b>asistido</b>: la constancia lo declara de forma expresa, identifica al supervisor que lo registró y
              adjunta el cargo firmado escaneado. No se presenta como acuse propio.
            </Note>
          )}
          <Note tone="neutral">
            Declaración aceptada por el trabajador: «Declaro haber recibido mi boleta de pago del periodo indicado y
            haber podido revisar su contenido.» El texto se guarda junto con el acuse, no como referencia a la plantilla.
          </Note>
        </div>
      </Card>
    </>
  );
}
