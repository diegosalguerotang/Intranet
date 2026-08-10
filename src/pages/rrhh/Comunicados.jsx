import { useState } from "react";
import { Megaphone, Send } from "lucide-react";
import { useApp } from "../../state";
import {
  PageHeader, Card, Button, Field, Input, Textarea, Select, Note, Badge, Table, Td, Progress, Modal,
} from "../../components/ui";
import { COMUNICADOS, SEDES, PERSONAL } from "../../data/mock";

export default function Comunicados() {
  const { empresaId } = useApp();
  const [nuevo, setNuevo] = useState(false);
  const [comunicados, setComunicados] = useState(COMUNICADOS);
  const [detalle, setDetalle] = useState(null);

  const publicar = (c) => {
    setComunicados((xs) => [{ ...c, id: xs.length + 1, publicado: "2026-08-10", leidos: 0, estado: "vigente" }, ...xs]);
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
                  <Button variant="ghost" size="sm" onClick={() => setDetalle(c)}>Ver pendientes</Button>
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <NuevoComunicado open={nuevo} onClose={() => setNuevo(false)} onPublicar={publicar} empresaId={empresaId} />

      <Modal open={!!detalle} onClose={() => setDetalle(null)} title={`Seguimiento — ${detalle?.titulo ?? ""}`}>
        {detalle && (
          <div className="space-y-3">
            <Note tone="neutral">
              {detalle.alcance - detalle.leidos} personas no han confirmado la lectura. El listado es exportable y el
              recordatorio respeta la ventana horaria.
            </Note>
            <Button size="sm" variant="secondary"><Send size={12} /> Recordar a pendientes</Button>
          </div>
        )}
      </Modal>
    </>
  );
}

// RRH-16 — Nuevo comunicado con segmentación y alcance calculado
function NuevoComunicado({ open, onClose, onPublicar, empresaId }) {
  const [titulo, setTitulo] = useState("");
  const [cuerpo, setCuerpo] = useState("");
  const [vence, setVence] = useState("");
  const [exigeAcuse, setExigeAcuse] = useState(true);
  const [nivel, setNivel] = useState("grupo");
  const [sedeSel, setSedeSel] = useState("");

  const alcance =
    nivel === "grupo"
      ? PERSONAL.filter((p) => p.estado === "vigente").length * 22 // dotación de demostración
      : nivel === "empresa"
      ? PERSONAL.filter((p) => p.empresa === empresaId && p.estado === "vigente").length * 24
      : PERSONAL.filter((p) => p.sede === sedeSel && p.estado === "vigente").length * 21;
  const conCelular = Math.round(alcance * 0.96);

  const segmento =
    nivel === "grupo" ? "Todo el grupo"
    : nivel === "empresa" ? "Toda la empresa"
    : SEDES.find((s) => s.id === sedeSel)?.nombre ?? "Sede";

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
                {SEDES.filter((s) => s.empresa === empresaId).map((s) => (
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
            onClick={() => onPublicar({ titulo, cuerpo, vence, exigeAcuse, alcance, segmento })}
          >
            Publicar
          </Button>
          <Button variant="secondary" onClick={onClose}>Guardar borrador</Button>
        </div>
      </div>
    </Modal>
  );
}
