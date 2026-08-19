import { useEffect, useMemo, useState } from "react";
import { FilePlus2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../../state";
import { nivelDe } from "../../data/modulos";
import {
  PageHeader, Card, Stat, Table, Td, Badge, Button, Input, Select, Field, Modal, Note, Textarea, EmptyState,
} from "../../components/ui";
import { FormPapeleta, FormVacaciones, resumenDatos, avisarSolicitud } from "./formularios";

export const ESTADOS_SOL = {
  enviada: { tone: "pend", label: "En revisión" },
  observada: { tone: "alerta", label: "Observada" },
  aprobada: { tone: "conf", label: "Aprobada" },
  rechazada: { tone: "neutral", label: "Rechazada" },
  anulada: { tone: "neutral", label: "Anulada" },
};

// SOL-01 — Bandeja del Centro de Solicitudes. Las firmas del papel son pasos
// de aprobación: cada decisión guarda quién, cuándo (hora del servidor) y con
// qué comentario; una aprobada no se edita (se anula y se crea otra).
export default function BandejaSolicitudes() {
  const { db, user, empresaId } = useApp();
  const navigate = useNavigate();
  const acceso = user?.acceso ?? { esSuperadmin: user?.esSuperadmin, matriz: {} };
  const puedeAccionar = nivelDe(acceso, "solicitudes") >= 2;
  const [q, setQ] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [ver, setVer] = useState(null);
  const [aviso, setAviso] = useState(null);

  const filas = useMemo(
    () =>
      db.solicitudes.filter(
        (s) =>
          s.empresa === empresaId &&
          (!fEstado || s.estado === fEstado) &&
          (!fTipo || s.tipo_id === fTipo) &&
          (!q ||
            s.numero.toLowerCase().includes(q.toLowerCase()) ||
            s.solicitante_nombre.toLowerCase().includes(q.toLowerCase()) ||
            s.solicitante_dni.includes(q))
      ),
    [db.solicitudes, empresaId, q, fEstado, fTipo]
  );

  const totales = {
    enRevision: filas.filter((s) => s.estado === "enviada").length,
    observadas: filas.filter((s) => s.estado === "observada").length,
    aprobadas: filas.filter((s) => s.estado === "aprobada").length,
    cerradas: filas.filter((s) => ["rechazada", "anulada"].includes(s.estado)).length,
  };

  return (
    <>
      <PageHeader
        code="SOL-01 · Centro de Solicitudes"
        title="Bandeja de solicitudes"
        subtitle="Papeletas de permiso y vacaciones con su cadena de V°B°. El estado lo mueven los aprobadores; todo queda en el historial."
        actions={
          puedeAccionar && (
            <Button size="sm" onClick={() => navigate("/solicitudes/nueva")}>
              <FilePlus2 size={13} /> Nueva solicitud
            </Button>
          )
        }
      />

      <div className="mb-5 flex flex-wrap gap-4">
        <Stat label="En revisión" value={totales.enRevision} tone={totales.enRevision ? "pend" : "default"} />
        <Stat label="Observadas" value={totales.observadas} />
        <Stat label="Aprobadas" value={totales.aprobadas} tone="conf" />
        <Stat label="Rechazadas / anuladas" value={totales.cerradas} />
      </div>

      {aviso && <div className="mb-4"><Note tone="conf">{aviso}</Note></div>}

      <Card pad={false}>
        <div className="flex flex-wrap gap-2.5 border-b border-borde bg-papel/50 p-3.5">
          <Input placeholder="Buscar por N°, nombre o DNI…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 250 }} />
          <Select value={fEstado} onChange={(e) => setFEstado(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="">Todos los estados</option>
            {Object.entries(ESTADOS_SOL).map(([v, e]) => <option key={v} value={v}>{e.label}</option>)}
          </Select>
          <Select value={fTipo} onChange={(e) => setFTipo(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="">Todos los tipos</option>
            {db.solicitudTipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </Select>
        </div>
        {filas.length === 0 ? (
          <EmptyState title="Sin solicitudes" body="Las solicitudes de esta razón social aparecerán aquí." />
        ) : (
          <Table head={["N°", "Fecha", "Solicitante", "Tipo", "Paso actual", "Estado", ""]}>
            {filas.map((s) => {
              const est = ESTADOS_SOL[s.estado];
              return (
                <tr key={s.id} className="hover:bg-papel/60">
                  <Td className="font-mono text-[12px] font-semibold">{s.numero}</Td>
                  <Td className="font-mono text-[11.5px] text-gris">{s.creado}</Td>
                  <Td>
                    <div className="font-semibold">{s.solicitante_nombre}</div>
                    <div className="text-[11px] text-gris">{s.cargo ?? ""}{s.sede_nombre ? ` · ${s.sede_nombre}` : ""}</div>
                  </Td>
                  <Td className="text-gris">{s.tipo}</Td>
                  <Td className="text-[12.5px]">{s.paso_titulo ?? "—"}</Td>
                  <Td>
                    <Badge tone={est.tone}>{est.label}</Badge>
                    {s.se_superpone && <span className="ml-1.5"><Badge tone="pend">Se superpone</Badge></span>}
                  </Td>
                  <Td><Button variant="ghost" size="sm" onClick={() => setVer(s)}>Ver</Button></Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <DetalleSolicitud solicitud={ver} onClose={() => setVer(null)} onListo={setAviso} />
    </>
  );
}

// Detalle: datos + historial + decisiones del paso. La BD re-valida permisos,
// autoaprobación y motivos: la UI solo esconde lo que no corresponde.
function DetalleSolicitud({ solicitud, onClose, onListo }) {
  const { user, resolverSolicitud, reenviarSolicitud, eventosSolicitud } = useApp();
  const acceso = user?.acceso ?? { esSuperadmin: user?.esSuperadmin, matriz: {} };
  const nivel = nivelDe(acceso, "solicitudes");
  const [eventos, setEventos] = useState(null);
  const [decision, setDecision] = useState(null); // 'aprobar'|'observar'|'rechazar'|'anular'
  const [comentario, setComentario] = useState("");
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setEventos(null); setDecision(null); setComentario(""); setCorrigiendo(false); setError(null);
    if (solicitud) eventosSolicitud(solicitud.id).then(setEventos).catch(() => setEventos([]));
  }, [solicitud]);

  const ejecutar = async () => {
    if (ocupado) return;
    setError(null);
    setOcupado(true);
    try {
      await resolverSolicitud(solicitud.id, decision, comentario || null);
      const evento = decision === "aprobar" ? "resuelta" : "estado";
      avisarSolicitud(solicitud.numero, evento);
      onListo(`Solicitud ${solicitud.numero}: decisión «${decision}» registrada.`);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado(false);
    }
  };

  const reenviar = async (datos) => {
    setOcupado(true);
    try {
      await reenviarSolicitud(solicitud.id, datos);
      avisarSolicitud(solicitud.numero, "estado");
      onListo(`Solicitud ${solicitud.numero} corregida y reenviada a su cadena.`);
      onClose();
    } finally {
      setOcupado(false);
    }
  };

  if (!solicitud) return <Modal open={false} onClose={onClose} title="" />;
  const est = ESTADOS_SOL[solicitud.estado];
  const esUltimoPaso = solicitud.paso_actual >= (solicitud.cadena?.length ?? 1);
  const faltaAdjunto = solicitud.tipo_id === "papeleta-permiso" && !solicitud.datos?.adjunto_url;

  return (
    <Modal open={!!solicitud} onClose={onClose} title={`${solicitud.numero} · ${solicitud.tipo}`} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={est.tone}>{est.label}</Badge>
          {solicitud.paso_titulo && <span className="text-[12.5px] text-gris">{solicitud.paso_titulo}</span>}
          {solicitud.se_superpone && (
            <Badge tone="pend">Se superpone con otra aprobada del mismo trabajador</Badge>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Dato etiqueta="Solicitante" valor={solicitud.solicitante_nombre} />
          <Dato etiqueta="DNI" valor={solicitud.solicitante_dni} />
          <Dato etiqueta="Cargo" valor={solicitud.cargo ?? "—"} />
          <Dato etiqueta="Sede" valor={solicitud.sede_nombre ?? "—"} />
          <Dato etiqueta="Ingreso" valor={solicitud.fecha_ingreso ?? "—"} />
          <Dato etiqueta="Jefe inmediato" valor={solicitud.supervisor_nombre ?? "—"} />
        </div>

        <div className="rounded-caja border border-borde bg-papel/60 p-3.5">
          <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wide text-gris">Datos de la solicitud</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {resumenDatos(solicitud.tipo_id, solicitud.datos ?? {}).map(([k, v]) => (
              <div key={k} className="text-[13px]"><span className="text-gris">{k}:</span> <b>{v}</b></div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-gris">Historial</div>
          {eventos === null ? (
            <div className="text-[12.5px] text-gris">Cargando…</div>
          ) : (
            <div className="space-y-1">
              {eventos.map((e, i) => (
                <div key={i} className="flex flex-wrap gap-x-2 text-[12.5px]">
                  <span className="font-mono text-[11px] text-gris">{e.en}</span>
                  <b>{etiquetaEvento(e.accion)}</b>
                  {e.paso_titulo && <span className="text-gris">({e.paso_titulo})</span>}
                  <span className="text-gris">por {e.por}</span>
                  {e.comentario && <span className="w-full pl-4 text-gris">«{e.comentario}»</span>}
                  {e.datos_previos && <span className="w-full pl-4 text-[11px] text-gris-cl">La versión anterior quedó guardada en el historial.</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {solicitud.estado === "enviada" && nivel >= 2 && !decision && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setDecision("aprobar")}>Dar V°B°</Button>
            <Button size="sm" variant="secondary" onClick={() => setDecision("observar")}>Observar</Button>
            <Button size="sm" variant="secondary" onClick={() => setDecision("rechazar")}>Rechazar</Button>
          </div>
        )}
        {solicitud.estado === "aprobada" && nivel >= 3 && !decision && (
          <Button size="sm" variant="secondary" onClick={() => setDecision("anular")}>Anular (deja sin efecto)</Button>
        )}
        {solicitud.estado === "observada" && nivel >= 2 && !corrigiendo && (
          <Button size="sm" onClick={() => setCorrigiendo(true)}>Corregir y reenviar</Button>
        )}

        {decision && (
          <div className="rounded-caja border border-borde bg-papel/60 p-3.5 space-y-3">
            {decision === "aprobar" && esUltimoPaso && faltaAdjunto && (
              <Note tone="alerta">Falta el original firmado: la papeleta no se puede aprobar sin él (corrígela por «observar»).</Note>
            )}
            <Field
              label={decision === "aprobar" ? "Comentario (opcional)" : "Motivo (obligatorio)"}
              required={decision !== "aprobar"}
            >
              <Textarea rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} />
            </Field>
            {error && <Note tone="alerta">{error}</Note>}
            <div className="flex gap-2">
              <Button onClick={ejecutar} disabled={ocupado || (decision !== "aprobar" && !comentario.trim())}>
                {ocupado ? "Registrando…" : `Confirmar ${decision}`}
              </Button>
              <Button variant="secondary" onClick={() => { setDecision(null); setError(null); }} disabled={ocupado}>Volver</Button>
            </div>
          </div>
        )}

        {corrigiendo && (
          <div className="rounded-caja border border-borde bg-papel/60 p-3.5">
            <div className="mb-2 text-[13px] font-semibold text-tinta">Corregir y reenviar</div>
            {solicitud.tipo_id === "papeleta-permiso" ? (
              <FormPapeleta inicial={solicitud.datos} onEnviar={reenviar} ocupado={ocupado} textoEnviar="Reenviar corregida" />
            ) : (
              <FormVacaciones inicial={solicitud.datos} onEnviar={reenviar} ocupado={ocupado} textoEnviar="Reenviar corregida" />
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function etiquetaEvento(accion) {
  return {
    creada: "Enviada", aprobada_paso: "V°B° dado", aprobada: "Aprobada",
    observada: "Observada", reenviada: "Corregida y reenviada",
    rechazada: "Rechazada", anulada: "Anulada",
  }[accion] ?? accion;
}

function Dato({ etiqueta, valor }) {
  return (
    <div>
      <div className="font-mono text-[10px] font-semibold uppercase tracking-wide text-gris">{etiqueta}</div>
      <div className="mt-0.5 text-[13px] font-semibold text-tinta">{valor}</div>
    </div>
  );
}
