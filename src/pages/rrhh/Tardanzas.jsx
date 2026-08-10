import { useState } from "react";
import { Upload, AlertTriangle } from "lucide-react";
import {
  PageHeader, Card, Button, Note, Table, Td, Select, Badge,
} from "../../components/ui";
import { TARDANZAS, persona, sede } from "../../data/mock";

// RRH-20 — Tardanzas y asistencia (solo lectura, importación)
export default function Tardanzas() {
  const [importado, setImportado] = useState(true);
  const [aviso, setAviso] = useState(null);

  return (
    <>
      <PageHeader
        code="RRH-20 · Tardanzas y asistencia"
        title="Tardanzas"
        subtitle="Este módulo solo lee e importa. La fuente de verdad sigue siendo el sistema de marcaciones actual; las correcciones se hacen allá y se vuelven a importar."
        actions={
          <Button variant="secondary" size="sm" onClick={() => setAviso("Marcaciones de julio reimportadas. La importación es idempotente: reprocesar el mismo archivo no duplica registros.")}>
            <Upload size={13} /> Importar marcaciones
          </Button>
        }
      />

      <div className="mb-4">
        <Note tone="neutral">
          <b>Módulo de solo lectura.</b> El descuento mostrado es referencial; el cálculo oficial lo hace la planilla.
          Los parámetros de tolerancia coinciden con los del sistema de origen.
        </Note>
      </div>

      {aviso && <div className="mb-4"><Note tone="conf">{aviso}</Note></div>}

      <Card pad={false}>
        <div className="flex flex-wrap gap-2.5 border-b border-borde bg-papel/50 p-3.5">
          <Select style={{ maxWidth: 180 }}>
            <option>Julio 2026</option>
            <option>Junio 2026</option>
          </Select>
        </div>
        <Table head={["DNI", "Trabajador", "Sede", "Tardanzas", "Minutos", "Descuento ref. (S/)", ""]}>
          {TARDANZAS.map((t) => {
            const p = persona(t.dni);
            const reiterada = t.tardanzas >= 2;
            return (
              <tr key={t.dni} className="hover:bg-papel/60">
                <Td className="font-mono text-[12px]">{t.dni}</Td>
                <Td className="font-semibold">{p?.nombre}</Td>
                <Td className="text-gris">{sede(p?.sede)?.cliente}</Td>
                <Td>
                  <Badge tone={t.tardanzas === 0 ? "conf" : reiterada ? "alerta" : "pend"}>{t.tardanzas}</Badge>
                </Td>
                <Td className="font-mono text-[12px]">{t.minutos}</Td>
                <Td className="font-mono text-[12px] text-gris">{t.descuento.toFixed(2)}</Td>
                <Td>
                  {reiterada && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAviso(`Memorándum precargado para ${p?.nombre} con los hechos de las ${t.tardanzas} tardanzas de julio. Completa la emisión en el módulo de Memorándums (RRH-18).`)}
                    >
                      <AlertTriangle size={12} /> Emitir memorándum
                    </Button>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
