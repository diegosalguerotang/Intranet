import { useState } from "react";
import { FilePlus2, Eye } from "lucide-react";
import { useApp } from "../../state";
import {
  PageHeader, Card, Button, Note, Badge, Table, Td, Modal, Field, Select, Stat,
} from "../../components/ui";

export default function Contratos() {
  const { empresaId, db, persona } = useApp();
  const [tab, setTab] = useState("vencimientos");
  const [lote, setLote] = useState(false);

  const plantillas = db.plantillas.filter((p) => p.empresa === empresaId);
  const porVencer = db.contratos.filter((c) => c.estado === "por_vencer");

  return (
    <>
      <PageHeader
        code="RRH-14 / RRH-15 · Contratos"
        title="Contratos y plantillas"
        subtitle="Generación desde plantilla y control de vencimientos. La firma de contratos está POR DEFINIR con asesoría legal: el estado de firma se registra como dato manual."
        actions={<Button size="sm" onClick={() => setLote(true)}><FilePlus2 size={13} /> Generar en lote</Button>}
      />

      <div className="mb-5 flex flex-wrap gap-4">
        <Stat label="Contratos vigentes" value={db.contratos.filter((c) => c.estado === "vigente").length + porVencer.length} />
        <Stat label="Vencen en 30 días" value={porVencer.length} tone="pend" hint="Decidir renovación o no renovación" />
        <Stat label="Pendientes de firma" value={db.contratos.filter((c) => c.firma === "pendiente").length} tone="alerta" />
        <Stat label="Plantillas activas" value={plantillas.length} />
      </div>

      <div className="mb-4 flex gap-1 border-b border-borde-f">
        {[["vencimientos", "Control de vencimientos"], ["plantillas", "Plantillas"]].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3.5 py-2 text-[13px] font-semibold ${
              tab === k ? "border-petroleo text-petroleo" : "border-transparent text-gris hover:text-tinta"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "vencimientos" && (
        <Card pad={false}>
          <Table head={["Trabajador", "Tipo", "Inicio", "Fin", "Firma", "Estado"]}>
            {db.contratos.map((c, i) => (
              <tr key={i} className="hover:bg-papel/60">
                <Td className="font-semibold">{persona(c.dni)?.nombre}</Td>
                <Td className="text-gris">{c.tipo}</Td>
                <Td className="font-mono text-[12px] text-gris">{c.inicio}</Td>
                <Td className="font-mono text-[12px] text-gris">{c.fin}</Td>
                <Td>
                  <Badge tone={c.firma === "firmado" ? "conf" : "alerta"}>
                    {c.firma === "firmado" ? "Firmado" : "Pendiente"}
                  </Badge>
                </Td>
                <Td>
                  <Badge tone={c.estado === "por_vencer" ? "pend" : "conf"}>
                    {c.estado === "por_vencer" ? "Por vencer" : "Vigente"}
                  </Badge>
                </Td>
              </tr>
            ))}
          </Table>
          <div className="border-t border-borde p-4">
            <Note tone="pend">
              Dejar vencer un contrato a plazo fijo sin comunicar la no renovación es el problema más caro de este
              módulo. Los contratos "por vencer" requieren decisión antes de su fecha de fin.
            </Note>
          </div>
        </Card>
      )}

      {tab === "plantillas" && (
        <Card pad={false}>
          <Table head={["Plantilla", "Tipo", "Versión", "Actualizada", ""]}>
            {plantillas.map((p) => (
              <tr key={p.id} className="hover:bg-papel/60">
                <Td className="font-semibold">{p.nombre}</Td>
                <Td className="text-gris">{p.tipo}</Td>
                <Td className="font-mono text-[12px]">v{p.version}</Td>
                <Td className="font-mono text-[12px] text-gris">{p.actualizada}</Td>
                <Td><Button variant="ghost" size="sm"><Eye size={12} /> Previsualizar</Button></Td>
              </tr>
            ))}
          </Table>
          <div className="border-t border-borde p-4">
            <Note tone="neutral">
              Al generar un documento se guarda una copia de la plantilla usada: cambiarla después no altera los
              documentos ya emitidos. Variables disponibles: nombre, DNI, cargo, sede, remuneración, fechas, empresa, RUC.
            </Note>
          </div>
        </Card>
      )}

      <GenerarLote open={lote} onClose={() => setLote(false)} plantillas={plantillas} empresaId={empresaId} />
    </>
  );
}

// RRH-15 — Generar contratos en lote
function GenerarLote({ open, onClose, plantillas, empresaId }) {
  const { empresaPor } = useApp();
  const [paso, setPaso] = useState(1);
  const e = empresaPor(empresaId);
  const cerrar = () => { setPaso(1); onClose(); };

  return (
    <Modal open={open} onClose={cerrar} title="RRH-15 · Generar contratos en lote" wide>
      {paso === 1 && (
        <div className="space-y-4">
          <Field label="Plantilla" required>
            <Select>
              {plantillas.filter((p) => p.tipo === "Contrato" || p.tipo === "Adenda").map((p) => (
                <option key={p.id}>{p.nombre} (v{p.version})</option>
              ))}
            </Select>
          </Field>
          <Field label="Destinatarios" hint="Por filtro o por lista de DNI.">
            <Select>
              <option>Ingresos de agosto 2026 (6 trabajadores)</option>
              <option>Renovaciones que vencen el 31/08 (2 trabajadores)</option>
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Vigencia desde"><Select><option>01/09/2026</option></Select></Field>
            <Field label="Vigencia hasta"><Select><option>28/02/2027</option></Select></Field>
          </div>
          <Button onClick={() => setPaso(2)}>Previsualizar</Button>
        </div>
      )}
      {paso === 2 && (
        <div className="space-y-4">
          <Note tone="neutral">
            Vista previa con datos reales del primer destinatario — no un ejemplo genérico. Un error de plantilla
            multiplicado por 300 contratos es un incidente serio.
          </Note>
          <div className="rounded-md border border-borde bg-papel/60 p-5 font-mono text-[11.5px] leading-relaxed text-tinta-2">
            <div className="mb-2 text-center font-bold">{e?.nombre} — RUC {e?.ruc}</div>
            <div className="mb-2 text-center">CONTRATO DE TRABAJO SUJETO A MODALIDAD — SERVICIO ESPECÍFICO</div>
            <p>
              Conste por el presente documento el contrato de trabajo que celebran, de una parte, {e?.nombre}…
              y de la otra parte, <b>MARÍA FERNÁNDEZ RÍOS</b>, identificada con DNI <b>46782301</b>, con domicilio en…
              quien prestará servicios como <b>OPERARIO DE LIMPIEZA</b> en la sede <b>SUNAT LIMA — SEDE CENTRAL</b>,
              del <b>01/09/2026</b> al <b>28/02/2027</b>…
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setPaso(3)}>Generar 6 contratos</Button>
            <Button variant="secondary" onClick={() => setPaso(1)}>Atrás</Button>
          </div>
        </div>
      )}
      {paso === 3 && (
        <div className="space-y-4">
          <Note tone="conf">
            6 contratos generados (demostración). Quedan en estado <b>pendiente de firma</b> — no de acuse: la validez
            de un contrato depende de su suscripción, que hoy ocurre fuera de la plataforma.
          </Note>
          <Button onClick={cerrar}>Cerrar</Button>
        </div>
      )}
    </Modal>
  );
}
