import { useState } from "react";
import { AlertTriangle, FileDown, Paperclip } from "lucide-react";
import {
  PageHeader, Card, Button, Field, Input, Textarea, Select, Note, Badge, Table, Td, Modal, Stat,
} from "../../components/ui";
import { MEMORANDUMS, PERSONAL, persona } from "../../data/mock";

const ESTADOS = {
  emitido_sin_notificar: { tone: "alerta", label: "Emitido sin notificar" },
  notificado: { tone: "pend", label: "Notificado, sin acuse" },
  en_plazo: { tone: "pend", label: "En plazo de descargo" },
  descargo_presentado: { tone: "tinta", label: "Descargo presentado" },
  vencido: { tone: "alerta", label: "Vencido sin descargo" },
  resuelto: { tone: "neutral", label: "Resuelto" },
};

// RRH-18 / RRH-19 — Emisión y bandeja de memorándums
export default function Memorandums() {
  const [emitir, setEmitir] = useState(false);
  const [memos, setMemos] = useState(MEMORANDUMS);
  const [detalle, setDetalle] = useState(null);
  const [filtro, setFiltro] = useState("");

  const filas = memos.filter((m) => !filtro || m.estado === filtro);

  const emitirMemo = (datos) => {
    const correlativo = `01${43 + memos.length}-2026`;
    setMemos((xs) => [
      { id: correlativo, ...datos, emitido: "2026-08-10", notificado: null, vence: null, estado: "emitido_sin_notificar", descargo: null, resolucion: null },
      ...xs,
    ]);
    setEmitir(false);
  };

  const resolver = (id, decision) => {
    setMemos((xs) => xs.map((m) => (m.id === id ? { ...m, estado: "resuelto", resolucion: { fecha: "2026-08-10", decision } } : m)));
    setDetalle(null);
  };

  return (
    <>
      <PageHeader
        code="RRH-18 / RRH-19 · Disciplina"
        title="Memorándums y descargos"
        subtitle="El plazo corre en días hábiles desde la confirmación de recepción, no desde la emisión. Un memorándum no notificado no produce efectos."
        actions={<Button size="sm" onClick={() => setEmitir(true)}><AlertTriangle size={13} /> Emitir memorándum</Button>}
      />

      <div className="mb-5 flex flex-wrap gap-4">
        <Stat label="Procesos abiertos" value={memos.filter((m) => m.estado !== "resuelto").length} />
        <Stat label="Esperan resolución" value={memos.filter((m) => m.estado === "descargo_presentado").length} tone="pend" />
        <Stat label="Sin notificar" value={memos.filter((m) => m.estado === "emitido_sin_notificar").length} tone="alerta" hint="Considerar notificación física" />
        <Stat label="Resueltos (año)" value={memos.filter((m) => m.estado === "resuelto").length} />
      </div>

      <Card pad={false}>
        <div className="flex flex-wrap gap-2.5 border-b border-borde bg-papel/50 p-3.5">
          <Select value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="">Todos los estados</option>
            <option value="emitido_sin_notificar">Sin notificar</option>
            <option value="descargo_presentado">Descargo presentado</option>
            <option value="resuelto">Resueltos</option>
          </Select>
        </div>
        <Table head={["N°", "Trabajador", "Tipo", "Notificado", "Vence", "Estado", ""]}>
          {filas.map((m) => {
            const est = ESTADOS[m.estado] ?? ESTADOS.notificado;
            return (
              <tr key={m.id} className="hover:bg-papel/60">
                <Td className="font-mono text-[12px]">{m.id}</Td>
                <Td className="font-semibold">{persona(m.dni)?.nombre}</Td>
                <Td className="text-gris">{m.tipo}</Td>
                <Td className="font-mono text-[12px] text-gris">{m.notificado ?? "—"}</Td>
                <Td className="font-mono text-[12px] text-gris">{m.vence ?? "—"}</Td>
                <Td><Badge tone={est.tone}>{est.label}</Badge></Td>
                <Td><Button variant="ghost" size="sm" onClick={() => setDetalle(m)}>Ver expediente</Button></Td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <EmitirMemo open={emitir} onClose={() => setEmitir(false)} onEmitir={emitirMemo} />

      <Modal open={!!detalle} onClose={() => setDetalle(null)} title={`Expediente ${detalle?.id ?? ""}`} wide>
        {detalle && (
          <div className="space-y-4">
            <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {[
                ["Trabajador", persona(detalle.dni)?.nombre],
                ["Tipo", detalle.tipo],
                ["Artículo invocado", detalle.articulo],
                ["Emitido", detalle.emitido],
                ["Notificado (acuse)", detalle.notificado ?? "Pendiente de notificación"],
                ["Plazo", detalle.vence ? `${detalle.plazoDias} días hábiles — vence ${detalle.vence}` : `${detalle.plazoDias} días hábiles — aún no corre`],
              ].map(([k, v]) => (
                <div key={k}>
                  <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-gris">{k}</div>
                  <div className="mt-0.5 text-[13px] text-tinta">{v}</div>
                </div>
              ))}
            </div>
            <div>
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-gris">Hechos imputados</div>
              <div className="mt-1 text-[13px] leading-relaxed text-tinta">{detalle.motivo}</div>
            </div>

            {detalle.descargo ? (
              <div className="rounded-md border border-borde bg-papel/60 p-4">
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="text-[12.5px] font-bold text-tinta">Descargo del trabajador</div>
                  <div className="font-mono text-[11px] text-gris">{detalle.descargo.fecha}</div>
                </div>
                <p className="text-[13px] leading-relaxed text-tinta-2">{detalle.descargo.texto}</p>
                <div className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-petroleo">
                  <Paperclip size={12} /> {detalle.descargo.adjuntos} adjunto — constancia_medica.jpg
                </div>
              </div>
            ) : detalle.estado !== "resuelto" && detalle.notificado ? (
              <Note tone="pend">Sin descargo presentado. El plazo {detalle.vence ? `vence el ${detalle.vence}` : "aún no corre"}.</Note>
            ) : null}

            {detalle.resolucion ? (
              <Note tone="neutral"><b>Resolución ({detalle.resolucion.fecha}):</b> {detalle.resolucion.decision}</Note>
            ) : detalle.estado === "descargo_presentado" ? (
              <div className="space-y-2">
                <div className="text-[12.5px] font-bold text-tinta">Resolver el proceso</div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => resolver(detalle.id, "Se archiva el proceso: el descargo acredita causa justificada.")}>Archivar</Button>
                  <Button size="sm" variant="secondary" onClick={() => resolver(detalle.id, "Se mantiene la sanción impuesta.")}>Mantener sanción</Button>
                  <Button size="sm" variant="danger" onClick={() => resolver(detalle.id, "Se eleva a amonestación escrita.")}>Elevar</Button>
                </div>
                <p className="text-[11.5px] text-gris">La resolución se notifica al trabajador por el portal y genera su propio acuse.</p>
              </div>
            ) : detalle.estado === "emitido_sin_notificar" ? (
              <Note tone="alerta">
                El trabajador aún no confirma la recepción. Si no lo hace en un plazo razonable, proceder con
                notificación física por la vía tradicional: el sistema acompaña el procedimiento legal, no lo reemplaza.
              </Note>
            ) : null}

            <Button variant="secondary" size="sm"><FileDown size={13} /> Exportar expediente completo</Button>
          </div>
        )}
      </Modal>
    </>
  );
}

// RRH-18 — Emitir memorándum
function EmitirMemo({ open, onClose, onEmitir, precarga }) {
  const [dni, setDni] = useState(precarga?.dni ?? "");
  const [tipo, setTipo] = useState("Llamada de atención");
  const [motivo, setMotivo] = useState(precarga?.motivo ?? "");
  const [articulo, setArticulo] = useState("Art. 12 RIT");
  const [plazoDias, setPlazoDias] = useState(5);

  const vigentes = PERSONAL.filter((p) => p.estado === "vigente");

  return (
    <Modal open={open} onClose={onClose} title="RRH-18 · Emitir memorándum" wide>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Trabajador" required>
            <Select value={dni} onChange={(e) => setDni(e.target.value)}>
              <option value="">Buscar…</option>
              {vigentes.map((p) => (
                <option key={p.dni} value={p.dni}>{p.nombre} — {p.dni}</option>
              ))}
            </Select>
          </Field>
          <Field label="Tipo de proceso" required>
            <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option>Llamada de atención</option>
              <option>Amonestación escrita</option>
              <option>Preaviso de despido</option>
            </Select>
          </Field>
        </div>
        <Field label="Hechos imputados" required hint="Con fechas concretas. Se imprimen en el documento generado desde plantilla.">
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Describe los hechos con fechas…" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Artículo del RIT invocado">
            <Input value={articulo} onChange={(e) => setArticulo(e.target.value)} />
          </Field>
          <Field label="Plazo de descargo (días hábiles)" hint="Se calcula excluyendo domingos y feriados del calendario administrado.">
            <Select value={plazoDias} onChange={(e) => setPlazoDias(+e.target.value)}>
              <option value={3}>3 días hábiles</option>
              <option value={5}>5 días hábiles</option>
              <option value={6}>6 días hábiles</option>
            </Select>
          </Field>
        </div>
        <Note tone="neutral">
          La numeración es correlativa por empresa y año, sin huecos ni reutilización. El plazo empezará a correr recién
          cuando el trabajador confirme la recepción.
        </Note>
        <div className="flex gap-2">
          <Button disabled={!dni || !motivo} onClick={() => onEmitir({ dni, tipo, motivo, articulo, plazoDias })}>
            Emitir y notificar
          </Button>
          <Button variant="secondary" onClick={onClose}>Guardar borrador</Button>
        </div>
      </div>
    </Modal>
  );
}
