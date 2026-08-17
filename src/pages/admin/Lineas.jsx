import { useState } from "react";
import { Smartphone } from "lucide-react";
import { useApp } from "../../state";
import {
  PageHeader, Card, Stat, Table, Td, Badge, Button, Modal, Field, Input, Select, Note,
} from "../../components/ui";
import { normalizarCelular } from "../../lib/campos";

// ADQ-05 — Líneas móviles
export default function Lineas() {
  const { db, persona, empresaPor, empresasActivas, addLinea } = useApp();
  const [nueva, setNueva] = useState(false);
  const LINEAS = db.lineas;
  const ACTIVOS = db.activos;
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
                <Td className="text-gris">{empresaPor(l.paga)?.corto}</Td>
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

      <NuevaLinea
        open={nueva}
        onClose={() => setNueva(false)}
        onGuardar={(l) => { addLinea(l); setNueva(false); }}
        activos={ACTIVOS}
        empresas={empresasActivas}
      />
    </>
  );
}

function NuevaLinea({ open, onClose, onGuardar, activos, empresas }) {
  const vacio = { numero: "", operador: "Claro", plan: "", costo: "", equipo: "", paga: "negliaf" };
  const [form, setForm] = useState(vacio);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const guardar = (e) => {
    e.preventDefault();
    if (form.numero.length !== 9 || !form.plan || !form.costo) return;
    onGuardar({
      numero: form.numero, operador: form.operador, plan: form.plan,
      costo: parseFloat(form.costo) || 0, equipo: form.equipo || null, paga: form.paga,
      alta: new Date().toISOString().slice(0, 10), estado: "activa",
    });
    setForm(vacio);
  };

  return (
    <Modal open={open} onClose={onClose} title="ADQ-05 · Nueva línea">
      <form onSubmit={guardar} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Número" required>
            <Input inputMode="numeric" value={form.numero} onChange={(e) => setForm((f) => ({ ...f, numero: normalizarCelular(e.target.value) }))} />
          </Field>
          <Field label="Operador" required>
            <Select value={form.operador} onChange={set("operador")}>
              <option>Claro</option><option>Movistar</option><option>Entel</option><option>Bitel</option>
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Plan" required><Input placeholder="Ej. Plan Negocios 39.90" value={form.plan} onChange={set("plan")} /></Field>
          <Field label="Costo mensual (S/)" required><Input inputMode="decimal" value={form.costo} onChange={set("costo")} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Equipo vinculado (opcional)">
            <Select value={form.equipo} onChange={set("equipo")}>
              <option value="">Sin equipo</option>
              {activos.filter((a) => a.categoria === "Comunicaciones").map((a) => (
                <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.modelo}</option>
              ))}
            </Select>
          </Field>
          <Field label="Empresa que paga" required>
            <Select value={form.paga} onChange={set("paga")}>
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </Select>
          </Field>
        </div>
        <Button type="submit">Guardar</Button>
      </form>
    </Modal>
  );
}
