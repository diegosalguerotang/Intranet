import { useState } from "react";
import { HardHat, Users } from "lucide-react";
import {
  PageHeader, Card, Stat, Table, Td, Badge, Button, Modal, Field, Input, Select, Note,
} from "../../components/ui";
import { EPP_ENTREGAS, PERSONAL, SEDES, persona, sede } from "../../data/mock";

// ADQ-06 — Entrega de EPP y uniformes
export default function EPP() {
  const [entregas, setEntregas] = useState(EPP_ENTREGAS);
  const [individual, setIndividual] = useState(false);
  const [masiva, setMasiva] = useState(false);
  const [aviso, setAviso] = useState(null);

  const porReponer = entregas.filter((e) => e.estado === "por_reponer");

  const registrarMasiva = (sedeId) => {
    const s = SEDES.find((x) => x.id === sedeId);
    const cuadrilla = PERSONAL.filter((p) => p.sede === sedeId && p.estado === "vigente");
    setEntregas((xs) => [
      ...cuadrilla.map((p, i) => ({
        id: xs.length + i + 1, dni: p.dni,
        items: "Guantes de nitrilo (2), Mascarilla (5), Uniforme (1)",
        entrega: "2026-08-10", reposicion: "2026-11-10", estado: "vigente",
      })),
      ...xs,
    ]);
    setMasiva(false);
    setAviso(`Entrega masiva registrada para ${cuadrilla.length} trabajadores de ${s?.nombre}. Cada cargo entró al motor de acuses.`);
  };

  return (
    <>
      <PageHeader
        code="ADQ-06 · EPP y uniformes"
        title="EPP y uniformes"
        subtitle="El EPP es consumible: no se devuelve, se repone. La constancia de entrega de EPP es de lo primero que pide una fiscalización de seguridad y salud."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setMasiva(true)}><Users size={13} /> Entrega masiva por sede</Button>
            <Button size="sm" onClick={() => setIndividual(true)}><HardHat size={13} /> Registrar entrega</Button>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap gap-4">
        <Stat label="Entregas vigentes" value={entregas.filter((e) => e.estado === "vigente").length} tone="conf" />
        <Stat label="Por reponer" value={porReponer.length} tone={porReponer.length ? "pend" : "conf"} hint="Vencieron su fecha estimada" />
      </div>

      {aviso && <div className="mb-4"><Note tone="conf">{aviso}</Note></div>}

      <Card pad={false}>
        <Table head={["Trabajador", "Sede", "Ítems entregados", "Entrega", "Reposición", "Estado"]}>
          {entregas.map((e) => {
            const p = persona(e.dni);
            return (
              <tr key={e.id} className="hover:bg-papel/60">
                <Td className="font-semibold">{p?.nombre}</Td>
                <Td className="text-gris">{sede(p?.sede)?.cliente}</Td>
                <Td className="max-w-xs text-gris">{e.items}</Td>
                <Td className="font-mono text-[12px] text-gris">{e.entrega}</Td>
                <Td className="font-mono text-[12px] text-gris">{e.reposicion}</Td>
                <Td>
                  <Badge tone={e.estado === "vigente" ? "conf" : "pend"}>
                    {e.estado === "vigente" ? "Vigente" : "Por reponer"}
                  </Badge>
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <Modal open={individual} onClose={() => setIndividual(false)} title="ADQ-06 · Registrar entrega de EPP">
        <form onSubmit={(e) => { e.preventDefault(); setIndividual(false); setAviso("Entrega registrada. El cargo digital entró al motor de acuses."); }} className="space-y-4">
          <Field label="Trabajador" required>
            <Select>
              {PERSONAL.filter((p) => p.estado === "vigente").map((p) => (
                <option key={p.dni}>{p.nombre} — {p.dni}</option>
              ))}
            </Select>
          </Field>
          <Field label="Ítems entregados" required>
            <Input placeholder="Ej. Guantes (2), Mascarilla (5), Botas talla 40 (1)" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fecha de entrega"><Input type="date" defaultValue="2026-08-10" /></Field>
            <Field label="Reposición estimada"><Input type="date" defaultValue="2026-11-10" /></Field>
          </div>
          <label className="flex items-center gap-2 text-[13px] font-medium text-tinta-2">
            <input type="checkbox" defaultChecked className="accent-petroleo" />
            Generar cargo para acuse (activo por defecto)
          </label>
          <Button type="submit">Registrar entrega</Button>
        </form>
      </Modal>

      <EntregaMasiva open={masiva} onClose={() => setMasiva(false)} onRegistrar={registrarMasiva} />
    </>
  );
}

function EntregaMasiva({ open, onClose, onRegistrar }) {
  const [sedeId, setSedeId] = useState("");
  const cuadrilla = sedeId ? PERSONAL.filter((p) => p.sede === sedeId && p.estado === "vigente").length : 0;

  return (
    <Modal open={open} onClose={onClose} title="ADQ-06 · Entrega masiva por sede">
      <div className="space-y-4">
        <Note tone="neutral">En la práctica el EPP se reparte a toda una cuadrilla el mismo día. Esta acción genera un cargo individual por trabajador.</Note>
        <Field label="Sede" required>
          <Select value={sedeId} onChange={(e) => setSedeId(e.target.value)}>
            <option value="">Elegir sede…</option>
            {SEDES.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </Select>
        </Field>
        {sedeId && (
          <Note tone="pend">Se registrará la entrega para <b>{cuadrilla} trabajadores</b> con vínculo vigente en esta sede.</Note>
        )}
        <Field label="Ítems del paquete" required>
          <Input defaultValue="Guantes de nitrilo (2), Mascarilla (5), Uniforme (1)" />
        </Field>
        <div className="flex gap-2">
          <Button disabled={!sedeId} onClick={() => onRegistrar(sedeId)}>Registrar entrega masiva</Button>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        </div>
      </div>
    </Modal>
  );
}
