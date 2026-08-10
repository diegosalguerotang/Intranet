import { useState } from "react";
import { Smartphone } from "lucide-react";
import {
  PageHeader, Card, Stat, Table, Td, Badge, Button, Modal, Field, Input, Select, Note,
} from "../../components/ui";
import { LINEAS, ACTIVOS, persona, empresa } from "../../data/mock";

// ADQ-05 — Líneas móviles
export default function Lineas() {
  const [nueva, setNueva] = useState(false);
  const costoTotal = LINEAS.filter((l) => l.estado === "activa").reduce((s, l) => s + l.costo, 0);

  return (
    <>
      <PageHeader
        code="ADQ-05 · Líneas móviles"
        title="Líneas móviles"
        subtitle="Una línea puede existir sin equipo y un equipo sin línea: son entidades separadas que se vinculan. El costo mensual alimenta el costeo por sede."
        actions={<Button size="sm" onClick={() => setNueva(true)}><Smartphone size={13} /> Nueva línea</Button>}
      />

      <div className="mb-5 flex flex-wrap gap-4">
        <Stat label="Líneas activas" value={LINEAS.filter((l) => l.estado === "activa").length} />
        <Stat label="Suspendidas" value={LINEAS.filter((l) => l.estado === "suspendida").length} tone="pend" />
        <Stat label="Gasto mensual" value={`S/ ${costoTotal.toFixed(2)}`} hint="Solo líneas activas" />
      </div>

      <Card pad={false}>
        <Table head={["Número", "Operador", "Plan", "Costo (S/)", "Equipo vinculado", "Usuario", "Paga", "Estado"]}>
          {LINEAS.map((l) => {
            const eq = l.equipo ? ACTIVOS.find((a) => a.codigo === l.equipo) : null;
            const usuario = eq?.asignado ? persona(eq.asignado)?.nombre : null;
            return (
              <tr key={l.numero} className="hover:bg-papel/60">
                <Td className="font-mono text-[12px] font-semibold">{l.numero}</Td>
                <Td className="text-gris">{l.operador}</Td>
                <Td className="text-gris">{l.plan}</Td>
                <Td className="font-mono text-[12px]">{l.costo.toFixed(2)}</Td>
                <Td>{eq ? `${eq.codigo} — ${eq.modelo}` : <span className="text-gris-cl">Sin equipo</span>}</Td>
                <Td>{usuario ?? <span className="text-gris-cl">—</span>}</Td>
                <Td className="text-gris">{empresa(l.paga)?.corto}</Td>
                <Td>
                  <Badge tone={l.estado === "activa" ? "conf" : l.estado === "suspendida" ? "pend" : "neutral"}>
                    {l.estado === "activa" ? "Activa" : l.estado === "suspendida" ? "Suspendida" : "De baja"}
                  </Badge>
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <Modal open={nueva} onClose={() => setNueva(false)} title="ADQ-05 · Nueva línea">
        <form onSubmit={(e) => { e.preventDefault(); setNueva(false); }} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Número" required><Input inputMode="numeric" maxLength={9} /></Field>
            <Field label="Operador" required>
              <Select><option>Claro</option><option>Movistar</option><option>Entel</option><option>Bitel</option></Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Plan" required><Input placeholder="Ej. Plan Negocios 39.90" /></Field>
            <Field label="Costo mensual (S/)" required><Input inputMode="decimal" /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Equipo vinculado (opcional)">
              <Select>
                <option value="">Sin equipo</option>
                {ACTIVOS.filter((a) => a.categoria === "Telefonía").map((a) => (
                  <option key={a.codigo}>{a.codigo} — {a.modelo}</option>
                ))}
              </Select>
            </Field>
            <Field label="Empresa que paga" required>
              <Select><option>NEGLIAF S.R.L.</option><option>BREMCO S.C.R.L.</option><option>PROMANT</option></Select>
            </Field>
          </div>
          <Button type="submit">Guardar</Button>
        </form>
      </Modal>
    </>
  );
}
