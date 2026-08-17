import { useMemo, useState } from "react";
import { MapPin, Plus } from "lucide-react";
import { useApp } from "../../state";
import {
  PageHeader, Card, Table, Td, Badge, Button, Input, Field, Modal, Note,
} from "../../components/ui";

// RRH-21 — Sedes de la empresa seleccionada. Cada sede lleva un código propio
// (S-0001…, lo asigna la BD con la misma secuencia que usa la importación de
// personal al crear sedes implícitamente).
export default function Sedes() {
  const { empresaId, empresa, db, crearSede } = useApp();
  const [q, setQ] = useState("");
  const [alta, setAlta] = useState(false);
  const [aviso, setAviso] = useState(null);

  const filas = useMemo(
    () =>
      db.sedes.filter(
        (s) =>
          s.empresa === empresaId &&
          (!q ||
            s.nombre.toLowerCase().includes(q.toLowerCase()) ||
            (s.codigo ?? "").toLowerCase().includes(q.toLowerCase()) ||
            (s.cliente ?? "").toLowerCase().includes(q.toLowerCase()))
      ),
    [db.sedes, empresaId, q]
  );

  return (
    <>
      <PageHeader
        code="RRH-21 · Sedes"
        title="Sedes"
        subtitle="Las unidades de servicio de la empresa seleccionada. El código lo asigna el sistema y no cambia."
        actions={
          <Button size="sm" onClick={() => setAlta(true)}><Plus size={13} /> Nueva sede</Button>
        }
      />

      {aviso && <div className="mb-4"><Note tone="conf">{aviso}</Note></div>}

      <Card pad={false}>
        <div className="flex flex-wrap gap-2.5 border-b border-borde bg-papel/50 p-3.5">
          <Input placeholder="Buscar por código, nombre o cliente…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
        </div>
        <Table head={["Código", "Sede", "Cliente", "Supervisor", "Dirección", "Estado"]}>
          {filas.map((s) => (
            <tr key={s.id} className="hover:bg-papel/60">
              <Td className="font-mono text-[12px] font-semibold">{s.codigo ?? "—"}</Td>
              <Td className="font-semibold">{s.nombre}</Td>
              <Td className="text-gris">{s.cliente}</Td>
              <Td>{s.supervisor ?? <span className="text-gris-cl">—</span>}</Td>
              <Td className="text-gris">{s.direccion ?? <span className="text-gris-cl">—</span>}</Td>
              <Td>
                {(s.estado ?? "activa") === "activa"
                  ? <Badge tone="conf">Activa</Badge>
                  : <Badge tone="neutral">Cerrada</Badge>}
              </Td>
            </tr>
          ))}
          {filas.length === 0 && (
            <tr><Td colSpan={6}><span className="text-gris-cl">No hay sedes que coincidan.</span></Td></tr>
          )}
        </Table>
      </Card>

      <div className="mt-4">
        <Note tone="neutral">
          <MapPin size={13} className="mr-1 inline" />
          La importación de personal también crea sedes cuando el reporte trae una nueva: reciben su código
          igual que las creadas aquí. El supervisor se asigna desde el maestro de Personal.
        </Note>
      </div>

      <AltaSede
        open={alta}
        onClose={() => setAlta(false)}
        empresa={empresa}
        crearSede={crearSede}
        onCreada={(r, nombre) => setAviso(`Sede «${nombre}» creada con el código ${r.codigo}.`)}
      />
    </>
  );
}

function AltaSede({ open, onClose, empresa, crearSede, onCreada }) {
  const vacio = { nombre: "", cliente: "", direccion: "" };
  const [form, setForm] = useState(vacio);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const cerrar = () => { setForm(vacio); setError(null); onClose(); };

  const guardar = async (e) => {
    e.preventDefault();
    if (ocupado) return;
    setError(null);
    setOcupado(true);
    try {
      const r = await crearSede({
        empresaId: empresa.id, nombre: form.nombre, cliente: form.cliente, direccion: form.direccion,
      });
      onCreada(r, form.nombre.trim());
      cerrar();
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Modal open={open} onClose={cerrar} title={`RRH-21 · Nueva sede en ${empresa?.corto ?? ""}`}>
      <form onSubmit={guardar} className="space-y-4">
        <Note tone="neutral">
          El código (S-0001…) lo asigna el sistema al guardar y no se puede elegir ni cambiar: es la
          identidad estable de la sede aunque el nombre se corrija después.
        </Note>
        <Field label="Nombre de la sede">
          <Input value={form.nombre} onChange={set("nombre")} placeholder="MINEDU — San Borja" autoFocus required />
        </Field>
        <Field label="Cliente">
          <Input value={form.cliente} onChange={set("cliente")} placeholder="MINEDU (vacío = Por asignar)" />
        </Field>
        <Field label="Dirección (opcional)">
          <Input value={form.direccion} onChange={set("direccion")} placeholder="Calle Del Comercio 193, San Borja" />
        </Field>
        {error && <Note tone="alerta">{error}</Note>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={cerrar} disabled={ocupado}>Cancelar</Button>
          <Button type="submit" disabled={ocupado || !form.nombre.trim()}>
            {ocupado ? "Creando…" : "Crear sede"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
