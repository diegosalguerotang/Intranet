import { useEffect, useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { useApp } from "../../state";
import { PageHeader, Card, Button, Note, Table, Td, Badge, Input } from "../../components/ui";
import { nivelDe } from "../../data/modulos";
import { anomaliasDeMarcas } from "../../lib/importar/asistencia";
import ImportarAsistencia from "./ImportarAsistencia";

const OBSERVACION = {
  incompleto: ["pend", "Incompleto"],
  doble: ["pend", "Doble marcación"],
  invertido: ["alerta", "Orden invertido"],
  sin_refrigerio: ["pend", "Sin refrigerio"],
};

const aMin = (hhmm) => {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
// Horas referenciales: suma de pares completos (E→S refrigerio + retorno→salida,
// o el único par del día). La planilla sigue siendo la fuente de verdad.
const horasRef = (marcas) => {
  let total = 0;
  for (let i = 0; i + 1 < marcas.length; i += 2) {
    const a = aMin(marcas[i]), b = aMin(marcas[i + 1]);
    if (a == null || b == null || b < a) return null;
    total += b - a;
  }
  return marcas.length >= 2 && marcas.length % 2 === 0 ? total : null;
};
const fmtHoras = (min) => min == null ? "—" : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;

// RRH-22 — Asistencia: lotes importados + consulta de marcaciones por día.
// Solo lectura + importación; NO clasifica tardanzas ni faltas (sin horario
// modelado, un día sin marcación no es una falta).
export default function Asistencia() {
  const { db, user, empresaId, empresa, cargarMarcaciones } = useApp();
  const puedeImportar = nivelDe(user?.acceso, "asistencia") >= 2;
  const [abierto, setAbierto] = useState(false);
  const [fecha, setFecha] = useState("");
  const [filas, setFilas] = useState([]);
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const umbral = db.asistenciaConfig?.[0]?.doble_marcacion_min ?? 15;
  const lotes = useMemo(() => (db.asistenciaLotes ?? []).filter((l) => l.empresa === empresaId), [db.asistenciaLotes, empresaId]);

  // Fecha por defecto: el último día con datos de la empresa activa.
  useEffect(() => { setFecha(lotes[0]?.hasta ?? ""); }, [empresaId, lotes[0]?.hasta]);

  useEffect(() => {
    if (!fecha) { setFilas([]); return; }
    let vigente = true;
    setOcupado(true); setError(null);
    cargarMarcaciones(empresaId, fecha)
      .then((d) => { if (vigente) setFilas(d); })
      .catch((e) => { if (vigente) setError(e.message); })
      .finally(() => { if (vigente) setOcupado(false); });
    return () => { vigente = false; };
  }, [empresaId, fecha]);

  return (
    <>
      <PageHeader
        code="RRH-22 · Asistencia"
        title="Asistencia"
        subtitle="Marcaciones del reloj, importadas por razón social. Sin horario modelado no se clasifican tardanzas ni faltas: el cálculo es referencial y la planilla es la fuente de verdad."
        actions={puedeImportar && (
          <Button size="sm" onClick={() => setAbierto(true)}>
            <Upload size={13} /> Importar marcaciones
          </Button>
        )}
      />

      <div className="mb-4">
        <Note tone="neutral">
          Un día sin marcación <b>no</b> es una falta (relevos, descansos y permisos no están modelados).
          Reimportar un periodo lo reemplaza completo: corregir en el reloj y volver a subir.
        </Note>
      </div>

      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2.5 border-b border-borde bg-papel/50 p-3.5">
          <span className="font-mono text-[10px] uppercase tracking-wide text-gris">Marcaciones de {empresa?.corto} el día</span>
          <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={{ maxWidth: 170 }} />
        </div>
        {error && <div className="p-3.5"><Note tone="alerta">{error}</Note></div>}
        <Table head={["Documento", "Trabajador", "Entrada", "Salida refrigerio", "Retorno", "Salida", "Horas ref.", "Observación"]}>
          {filas.map((m) => {
            const marcas = [m.m1, m.m2, m.m3, m.m4].filter(Boolean);
            const anomalias = anomaliasDeMarcas(marcas, umbral);
            return (
              <tr key={m.documento} className="hover:bg-papel/60">
                <Td className="font-mono text-[12px]">{m.documento}</Td>
                <Td className="font-semibold">{m.reconocido ? m.nombre : <span className="text-gris">No está en el maestro</span>}</Td>
                <Td className="font-mono text-[12px]">{m.m1 ?? "—"}</Td>
                <Td className="font-mono text-[12px]">{m.m2 ?? "—"}</Td>
                <Td className="font-mono text-[12px]">{m.m3 ?? "—"}</Td>
                <Td className="font-mono text-[12px]">{m.m4 ?? "—"}</Td>
                <Td className="font-mono text-[12px]">{fmtHoras(horasRef(marcas))}</Td>
                <Td>
                  {marcas.length === 0
                    ? <Badge tone="neutral">Sin marcación</Badge>
                    : anomalias.length === 0
                      ? <Badge tone="conf">Completo</Badge>
                      : anomalias.map((a) => {
                          const [tone, texto] = OBSERVACION[a] ?? ["pend", a];
                          return <Badge key={a} tone={tone}>{texto}</Badge>;
                        })}
                </Td>
              </tr>
            );
          })}
          {!ocupado && filas.length === 0 && (
            <tr><Td colSpan={8} className="text-center text-gris">{fecha ? "Sin marcaciones ese día." : "Aún no hay lotes importados para esta empresa."}</Td></tr>
          )}
        </Table>
      </Card>

      <div className="mt-5">
        <Card pad={false}>
          <div className="border-b border-borde bg-papel/50 p-3.5 font-mono text-[10px] uppercase tracking-wide text-gris">
            Lotes importados de {empresa?.corto}
          </div>
          <Table head={["Archivo", "Periodo", "Trabajadores", "Días-persona", "Importado por", "Fecha"]}>
            {lotes.map((l) => (
              <tr key={l.id} className="hover:bg-papel/60">
                <Td className="font-semibold">{l.archivo}</Td>
                <Td className="font-mono text-[12px]">{l.desde} → {l.hasta}</Td>
                <Td>{l.trabajadores}</Td>
                <Td>{l.filas}</Td>
                <Td className="text-gris">{l.creado_por}</Td>
                <Td className="font-mono text-[12px] text-gris">{l.creado_en}</Td>
              </tr>
            ))}
            {lotes.length === 0 && (
              <tr><Td colSpan={6} className="text-center text-gris">Todavía no se importa ningún reporte para esta empresa.</Td></tr>
            )}
          </Table>
        </Card>
      </div>

      <ImportarAsistencia open={abierto} onClose={() => setAbierto(false)} />
    </>
  );
}
