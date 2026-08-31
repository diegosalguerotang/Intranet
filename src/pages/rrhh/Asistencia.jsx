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

// RRH-22 — Asistencia: control semanal (tablero mensual por centro de
// costo, con tardanzas y tolerancia YA calculadas) + reporte del reloj
// (marcaciones crudas por día) + lotes importados.
export default function Asistencia() {
  const { db, user, empresaId, empresa, cargarMarcaciones, tableroAsistencia } = useApp();
  const puedeImportar = nivelDe(user?.acceso, "asistencia") >= 2;
  const [abierto, setAbierto] = useState(false);
  const [fecha, setFecha] = useState("");
  const [filas, setFilas] = useState([]);
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const umbral = db.asistenciaConfig?.[0]?.doble_marcacion_min ?? 15;
  // El lote del control es del GRUPO (empresa null): se muestra siempre.
  const lotes = useMemo(() => (db.asistenciaLotes ?? []).filter((l) => l.empresa === empresaId || l.empresa == null), [db.asistenciaLotes, empresaId]);
  const lotesControl = useMemo(() => (db.asistenciaLotes ?? []).filter((l) => l.origen === "control"), [db.asistenciaLotes]);

  // Tablero mensual del control (v_asistencia_mensual), agrupado por centro
  // de costo — la misma agrupación oficial que Personal. El alcance por RS ya
  // rige: la consulta va por la empresa activa del Shell.
  const [periodo, setPeriodo] = useState("");
  const [tablero, setTablero] = useState(null);
  useEffect(() => { setPeriodo((p) => p || (lotesControl[0]?.hasta ?? "").slice(0, 7)); }, [lotesControl]);
  useEffect(() => {
    if (!periodo) { setTablero(null); return; }
    let vigente = true;
    tableroAsistencia(empresaId, periodo)
      .then((d) => { if (vigente) setTablero(d); })
      .catch(() => { if (vigente) setTablero([]); });
    return () => { vigente = false; };
  }, [empresaId, periodo]); // eslint-disable-line react-hooks/exhaustive-deps
  const grupos = useMemo(() => {
    const m = new Map();
    for (const t of tablero ?? []) {
      const k = t.centroCosto ?? "Sin centro de costo";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(t);
    }
    return [...m.entries()];
  }, [tablero]);

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
        subtitle="El control semanal se sube tal cual se produce: la empresa de cada fila sale del padrón por documento, y el tablero se agrupa por centro de costo — la misma llave que Personal."
        actions={puedeImportar && (
          <Button size="sm" onClick={() => setAbierto(true)}>
            <Upload size={13} /> Importar control
          </Button>
        )}
      />

      <div className="mb-4">
        <Note tone="neutral">
          «Revisar» <b>no</b> es una falta: es un día laborable sin marcación que se convierte en falta solo
          cuando alguien lo revisa. Reimportar un periodo lo reemplaza completo, jamás duplica.
        </Note>
      </div>

      <Card pad={false} className="mb-5">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-borde bg-papel/50 p-3.5">
          <span className="font-mono text-[10px] uppercase tracking-wide text-gris">Control semanal de {empresa?.corto} · mes</span>
          <Input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} style={{ maxWidth: 170 }} />
          {tablero?.some((t) => t.sinHora) && (
            <Badge tone="pend">{tablero.filter((t) => t.sinHora).length} sin hora de entrada</Badge>
          )}
        </div>
        {(tablero ?? []).length === 0 ? (
          <div className="p-4 text-center text-[13px] text-gris">
            {periodo ? `Sin control importado para ${empresa?.corto} en ${periodo}.` : "Todavía no se importa ningún control semanal."}
          </div>
        ) : (
          <Table head={["Trabajador", "Hora entrada", "Días lab.", "Horas", "Tardanza efec.", "Días tard.", "Revisar", "F. semana", "Estado"]}>
            {grupos.map(([cc, xs]) => [
              <tr key={`cc-${cc}`} className="bg-papel/70">
                <Td colSpan={9} className="font-mono text-[10.5px] font-semibold uppercase tracking-wide text-gris">
                  {cc} — {xs.length} trabajador{xs.length === 1 ? "" : "es"}
                </Td>
              </tr>,
              ...xs.map((t) => (
                <tr key={t.documento} className="hover:bg-papel/60">
                  <Td>
                    <div className="font-semibold text-tinta">{t.nombre}</div>
                    <div className="font-mono text-[11px] text-gris-cl">{t.documento}</div>
                  </Td>
                  <Td className="font-mono text-[12px]">
                    {t.horaEntrada ?? <Badge tone="pend">Pendiente de configurar</Badge>}
                  </Td>
                  <Td>{t.laborables}</Td>
                  <Td className="font-mono text-[12px]">{fmtHoras(t.minTrab)}</Td>
                  <Td className="font-mono text-[12px]">{t.tardEfec > 0 ? `${t.tardEfec} min` : "—"}</Td>
                  <Td>{t.diasTardanza > 0 ? t.diasTardanza : "—"}</Td>
                  <Td>{t.revisar > 0 ? <Badge tone="pend">{t.revisar}</Badge> : "—"}</Td>
                  <Td>{t.finSemana > 0 ? t.finSemana : "—"}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {t.recalculados > 0 && <Badge tone="tinta">{t.recalculados} recalculados</Badge>}
                      {t.editados > 0 && <Badge tone="neutral">{t.editados} editados</Badge>}
                      {t.recalculados === 0 && t.editados === 0 && <Badge tone="conf">Original</Badge>}
                    </div>
                  </Td>
                </tr>
              )),
            ])}
          </Table>
        )}
      </Card>

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
            Lotes importados ({empresa?.corto} y del grupo)
          </div>
          <Table head={["Archivo", "Periodo", "Trabajadores", "Días-persona", "Importado por", "Fecha"]}>
            {lotes.map((l) => (
              <tr key={l.id} className="hover:bg-papel/60">
                <Td className="font-semibold">
                  {l.archivo}{" "}
                  {l.origen === "control"
                    ? <Badge tone="tinta">Control · todo el grupo</Badge>
                    : <Badge tone="neutral">Reloj</Badge>}
                </Td>
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
