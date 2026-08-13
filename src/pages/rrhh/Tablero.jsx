import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useApp } from "../../state";
import { PageHeader, Card, Stat, Progress, Badge, Note } from "../../components/ui";

export default function Tablero() {
  const { empresa, empresaId, db } = useApp();
  const dotacion = db.personal.filter((p) => p.empresa === empresaId && p.estado === "vigente");
  const lote = db.lotes.find((l) => l.empresa === empresaId);
  const pctRecepcion = lote ? Math.round(((lote.confirmados + lote.asistidos) / lote.total) * 100) : null;
  const nuncaIngresaron = dotacion.filter((p) => p.portal === "nunca_ingreso");
  const sinCelular = dotacion.filter((p) => p.portal === "sin_celular");
  const porVencer = db.contratos.filter((c) => c.estado === "por_vencer");
  const descargosPendientes = db.memorandums.filter((m) => m.estado === "descargo_presentado");

  const porSede = db.sedes.filter((s) => s.empresa === empresaId).map((s) => {
    const n = dotacion.filter((p) => p.sede === s.id).length;
    // Distribución de avance de ejemplo por sede
    const pct = { sunat: 96, migraciones: 82, minedu: 78, ins: 91 }[s.id] ?? 85;
    return { ...s, n, pct };
  });

  const alertas = [
    lote && lote.pendientes > 0 && {
      texto: `${lote.pendientes} acuses del lote ${lote.id} siguen pendientes después de 4 días`,
      to: "/rrhh/acuses", tone: "pend",
    },
    nuncaIngresaron.length > 0 && {
      texto: `${nuncaIngresaron.length} trabajadores nunca han ingresado al portal — reenviar clave`,
      to: "/rrhh/personal", tone: "alerta",
    },
    sinCelular.length > 0 && {
      texto: `${sinCelular.length} trabajadores sin celular registrado — derivar a acuse asistido`,
      to: "/rrhh/personal", tone: "pend",
    },
    porVencer.length > 0 && {
      texto: `${porVencer.length} contratos vencen en los próximos 30 días`,
      to: "/rrhh/contratos", tone: "pend",
    },
    descargosPendientes.length > 0 && {
      texto: `${descargosPendientes.length} descargo presentado espera resolución`,
      to: "/rrhh/memorandums", tone: "alerta",
    },
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        code="RRH-01 · Tablero"
        title={`Entrega documental — ${empresa.corto}`}
        subtitle="Responde en un vistazo si la entrega del periodo está completa y qué requiere atención."
      />

      <div className="mb-5 flex flex-wrap gap-4">
        <Stat label="Personal activo" value={dotacion.length} hint="Vínculos vigentes" />
        <Stat label="Documentos publicados" value={lote ? lote.total : 0} hint={lote ? `Lote ${lote.periodo}` : "Sin lote publicado"} />
        <Stat label="Acuses pendientes" value={lote ? lote.pendientes : "—"} tone={lote?.pendientes ? "pend" : "conf"} hint="Del último lote" />
        <Stat label="Recepción" value={pctRecepcion !== null ? `${pctRecepcion}%` : "—"} tone={pctRecepcion >= 95 ? "conf" : "pend"} hint="Confirmados + asistidos" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-[14px] font-bold text-tinta">Requiere tu atención</h2>
          {alertas.length === 0 ? (
            <Note tone="conf">No hay situaciones pendientes. La entrega del periodo está al día.</Note>
          ) : (
            <div className="space-y-2">
              {alertas.map((a, i) => (
                <Link
                  key={i}
                  to={a.to}
                  className={`flex items-center justify-between gap-3 rounded-caja border px-3.5 py-2.5 text-[12.5px] font-medium transition-colors ${
                    a.tone === "alerta"
                      ? "border-alerta/25 bg-alerta-bg text-alerta hover:border-alerta/50"
                      : "border-pend/25 bg-pend-bg text-pend hover:border-pend/50"
                  }`}
                >
                  <span>{a.texto}</span>
                  <ArrowRight size={14} className="shrink-0" />
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-[14px] font-bold text-tinta">Recepción por sede — {lote ? lote.periodo : "sin periodo"}</h2>
          {porSede.length === 0 ? (
            <Note tone="neutral">Esta empresa no tiene sedes registradas.</Note>
          ) : (
            <div className="space-y-3.5">
              {porSede.map((s) => (
                <div key={s.id}>
                  <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
                    <span className="font-semibold text-tinta-2">{s.nombre}</span>
                    <span className="font-mono text-[11px] text-gris">{s.pct}%</span>
                  </div>
                  <Progress value={s.pct} tone={s.pct >= 95 ? "conf" : "pend"} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {lote && (
        <Card className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[11px] text-gris">Último lote publicado</div>
              <div className="mt-0.5 text-[14px] font-bold text-tinta">
                {lote.id} <Badge tone="neutral">{lote.tipo}</Badge>
              </div>
              <div className="mt-1 text-[12px] text-gris">
                Publicado el {lote.publicado} por {lote.por} · {lote.avisos} avisos enviados por WhatsApp
              </div>
            </div>
            <div className="flex gap-6 text-center">
              <div>
                <div className="text-[20px] font-bold text-conf">{lote.confirmados}</div>
                <div className="font-mono text-[9.5px] uppercase tracking-wide text-gris">Confirmados</div>
              </div>
              <div>
                <div className="text-[20px] font-bold text-petroleo">{lote.asistidos}</div>
                <div className="font-mono text-[9.5px] uppercase tracking-wide text-gris">Asistidos</div>
              </div>
              <div>
                <div className="text-[20px] font-bold text-pend">{lote.pendientes}</div>
                <div className="font-mono text-[9.5px] uppercase tracking-wide text-gris">Pendientes</div>
              </div>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
