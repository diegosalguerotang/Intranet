import { Download } from "lucide-react";
import { useApp } from "../../state";
import { PageHeader, Card, Table, Td, Button, Note } from "../../components/ui";

// ADQ-07 — Costo de activos por sede
export default function Costos() {
  const { db } = useApp();
  const filas = db.sedes.map((s) => {
    const activosSede = db.activos.filter((a) => a.sede === s.id && a.estado !== "baja");
    const valor = activosSede.reduce((sum, a) => sum + a.valor, 0);
    const lineasSede = db.lineas.filter((l) => {
      const eq = l.equipo ? db.activos.find((a) => a.codigo === l.equipo) : null;
      return eq?.sede === s.id && l.estado === "activa";
    });
    const costoLineas = lineasSede.reduce((sum, l) => sum + l.costo, 0);
    return { ...s, n: activosSede.length, valor, costoLineas };
  }).filter((f) => f.n > 0 || f.costoLineas > 0);

  const totalValor = filas.reduce((s, f) => s + f.valor, 0);
  const totalLineas = filas.reduce((s, f) => s + f.costoLineas, 0);

  return (
    <>
      <PageHeader
        code="ADQ-07 · Costo de activos por sede"
        title="Costo por sede y cliente"
        subtitle="Insumo directo para costear licitaciones. Reporte de solo lectura sobre asignaciones vigentes."
        actions={<Button variant="secondary" size="sm"><Download size={13} /> Exportar a Excel</Button>}
      />

      <Card pad={false}>
        <Table head={["Sede", "Cliente", "Activos", "Valor de adquisición (S/)", "Costo mensual líneas (S/)"]}>
          {filas.map((f) => (
            <tr key={f.id} className="hover:bg-papel/60">
              <Td className="font-semibold">{f.nombre}</Td>
              <Td className="text-gris">{f.cliente}</Td>
              <Td className="font-mono text-[12px]">{f.n}</Td>
              <Td className="font-mono text-[12px]">{f.valor.toLocaleString("es-PE", { minimumFractionDigits: 2 })}</Td>
              <Td className="font-mono text-[12px]">{f.costoLineas.toFixed(2)}</Td>
            </tr>
          ))}
          <tr className="bg-papel/70 font-bold">
            <Td colSpan={2}>Total</Td>
            <Td className="font-mono text-[12px]">{filas.reduce((s, f) => s + f.n, 0)}</Td>
            <Td className="font-mono text-[12px]">{totalValor.toLocaleString("es-PE", { minimumFractionDigits: 2 })}</Td>
            <Td className="font-mono text-[12px]">{totalLineas.toFixed(2)}</Td>
          </tr>
        </Table>
        <div className="border-t border-borde p-4">
          <Note tone="pend">
            <b>POR DEFINIR</b> — El criterio de depreciación está pendiente con Contabilidad. Mientras tanto el reporte
            muestra valor de adquisición, no valor en libros.
          </Note>
        </div>
      </Card>
    </>
  );
}
