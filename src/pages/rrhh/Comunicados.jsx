import { useState } from "react";
import { Megaphone, Send } from "lucide-react";
import { useApp } from "../../state";
import {
  PageHeader, Card, Button, Field, Input, Textarea, Select, Note, Badge, Table, Td, Progress, Modal,
} from "../../components/ui";

export default function Comunicados() {
  const { empresaId, db, addComunicado, pendientesComunicado } = useApp();
  const [nuevo, setNuevo] = useState(false);
  const [detalle, setDetalle] = useState(null);
  const [pendientes, setPendientes] = useState(null); // null = cargando
  const [errorPendientes, setErrorPendientes] = useState(null);
  const comunicados = db.comunicados;

  const abrirDetalle = async (c) => {
    setDetalle(c);
    setPendientes(null);
    setErrorPendientes(null);
    try {
      setPendientes(await pendientesComunicado(c.id));
    } catch (e) {
      setErrorPendientes(e.message);
      setPendientes([]);
    }
  };

  const publicar = (c) => {
    addComunicado({
      ...c,
      id: Date.now(),
      publicado: new Date().toISOString().slice(0, 10),
      leidos: 0,
      estado: "vigente",
    });
    setNuevo(false);
  };

  return (
    <>
      <PageHeader
        code="RRH-16 / RRH-17 · Comunicados"
        title="Comunicados"
        subtitle="Difusión segmentada con acuse de lectura. El avance se calcula sobre el alcance congelado al publicar."
        actions={<Button size="sm" onClick={() => setNuevo(true)}><Megaphone size={13} /> Nuevo comunicado</Button>}
      />

      <Card pad={false}>
        <Table head={["Comunicado", "Segmento", "Publicado", "Vigencia", "Lectura", ""]}>
          {comunicados.map((c) => {
            const pct = c.alcance ? Math.round((c.leidos / c.alcance) * 100) : 0;
            return (
              <tr key={c.id} className="hover:bg-papel/60">
                <Td>
                  <div className="font-semibold">{c.titulo}</div>
                  <div className="mt-0.5 flex gap-1.5">
                    {c.exigeAcuse && <Badge tone="pend">Exige acuse</Badge>}
                    {c.estado === "vencido" && <Badge tone="neutral">Vencido</Badge>}
                  </div>
                </Td>
                <Td className="text-gris">{c.segmento}</Td>
                <Td className="font-mono text-[12px] text-gris">{c.publicado}</Td>
                <Td className="font-mono text-[12px] text-gris">hasta {c.vence}</Td>
                <Td style={{ minWidth: 140 }}>
                  <div className="mb-1 font-mono text-[11px] text-gris">{c.leidos}/{c.alcance} · {pct}%</div>
                  <Progress value={pct} tone={pct >= 90 ? "conf" : "pend"} />
                </Td>
                <Td>
                  <Button variant="ghost" size="sm" onClick={() => abrirDetalle(c)}>Ver pendientes</Button>
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <NuevoComunicado open={nuevo} onClose={() => setNuevo(false)} onPublicar={publicar} empresaId={empresaId} />

      <Modal open={!!detalle} onClose={() => setDetalle(null)} title={`Pendientes de lectura — ${detalle?.titulo ?? ""}`} wide>
        {detalle && (
          <div className="space-y-3">
            {pendientes === null ? (
              <Note tone="neutral">Cargando pendientes…</Note>
            ) : pendientes.length === 0 && !errorPendientes ? (
              <Note tone="conf">Todos los del segmento confirmaron la lectura. Nadie pendiente.</Note>
            ) : (
              <>
                <Note tone="pend">
                  <b>{pendientes.length}</b> persona{pendientes.length === 1 ? "" : "s"} del segmento aún no
                  confirma{pendientes.length === 1 ? "" : "n"} la lectura.
                </Note>
                <div className="max-h-72 overflow-y-auto rounded-caja border border-borde">
                  <Table head={["Trabajador", "DNI", "Sede", "Contacto"]}>
                    {pendientes.map((p) => (
                      <tr key={p.dni}>
                        <Td className="font-semibold">{p.nombre}</Td>
                        <Td className="font-mono text-[12px]">{p.dni}</Td>
                        <Td className="text-gris">{p.sede ?? "—"}</Td>
                        <Td className="font-mono text-[12px] text-gris">{p.celular ?? <span className="text-gris-cl">sin celular</span>}</Td>
                      </tr>
                    ))}
                  </Table>
                </div>
              </>
            )}
            {errorPendientes && <Note tone="alerta">{errorPendientes}</Note>}
            <Button size="sm" variant="secondary" disabled title="Llega con el motor de mensajería">
              <Send size={12} /> Recordar a pendientes (próximamente)
            </Button>
          </div>
        )}
      </Modal>
    </>
  );
}

// RRH-16 — Nuevo comunicado con segmentación y alcance calculado
function NuevoComunicado({ open, onClose, onPublicar, empresaId }) {
  const { db } = useApp();
  const [titulo, setTitulo] = useState("");
  const [cuerpo, setCuerpo] = useState("");
  const [vence, setVence] = useState("");
  const [exigeAcuse, setExigeAcuse] = useState(true);
  const [nivel, setNivel] = useState("grupo");
  const [sedeSel, setSedeSel] = useState("");

  // Alcance REAL sobre el padrón vigente (nada de multiplicadores de demo).
  const destinatarios =
    nivel === "grupo"
      ? db.personal.filter((p) => p.estado === "vigente")
      : nivel === "empresa"
      ? db.personal.filter((p) => p.empresa === empresaId && p.estado === "vigente")
      : db.personal.filter((p) => p.sede === sedeSel && p.estado === "vigente");
  const alcance = destinatarios.length;
  const conCelular = destinatarios.filter((p) => p.celular).length;

  const segmento =
    nivel === "grupo" ? "Todo el grupo"
    : nivel === "empresa" ? "Toda la empresa"
    : db.sedes.find((s) => s.id === sedeSel)?.nombre ?? "Sede";

  return (
    <Modal open={open} onClose={onClose} title="RRH-16 · Nuevo comunicado" wide>
      <div className="space-y-4">
        <Field label="Título" required>
          <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej. Cambio de horario de ingreso" />
        </Field>
        <Field label="Cuerpo" required>
          <Textarea value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} placeholder="Redacta el comunicado…" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Vigente hasta" required>
            <Input type="date" value={vence} onChange={(e) => setVence(e.target.value)} />
          </Field>
          <Field label="Segmentación" required>
            <Select value={nivel} onChange={(e) => setNivel(e.target.value)}>
              <option value="grupo">Todo el grupo</option>
              <option value="empresa">Esta empresa</option>
              <option value="sede">Una sede</option>
            </Select>
          </Field>
          {nivel === "sede" && (
            <Field label="Sede" required>
              <Select value={sedeSel} onChange={(e) => setSedeSel(e.target.value)}>
                <option value="">Elegir…</option>
                {db.sedes.filter((s) => s.empresa === empresaId).map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <label className="flex items-center gap-2 text-[13px] font-medium text-tinta-2">
          <input type="checkbox" checked={exigeAcuse} onChange={(e) => setExigeAcuse(e.target.checked)} className="accent-petroleo" />
          Exige acuse de lectura (genera constancia con la misma evidencia que un documento)
        </label>
        <Note tone="neutral">
          Alcance calculado: <b>{alcance} personas</b> recibirán este comunicado · {conCelular} tienen celular registrado
          para el aviso por WhatsApp. La segmentación se congela al publicar: quien ingrese después no lo recibe
          retroactivamente.
        </Note>
        <div className="flex gap-2">
          <Button
            disabled={!titulo || !cuerpo || !vence || (nivel === "sede" && !sedeSel)}
            onClick={() => onPublicar({
              titulo, cuerpo, vence, exigeAcuse, alcance, segmento,
              // Segmentación estructural: con ella el sistema sabe a QUIÉN le
              // falta leer (lista de pendientes). null = todo el grupo.
              empresa: nivel === "grupo" ? null : empresaId,
              sede: nivel === "sede" ? sedeSel : null,
            })}
          >
            Publicar
          </Button>
          <Button variant="secondary" onClick={onClose}>Guardar borrador</Button>
        </div>
      </div>
    </Modal>
  );
}
