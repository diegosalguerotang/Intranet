import { useEffect, useMemo, useState } from "react";
import { ClipboardPen, MailCheck, Hourglass, LifeBuoy, Stamp } from "lucide-react";
import { useApp } from "../../state";
import {
  PageHeader, Card, Badge, Button, Select, Field, Note, EmptyState, Textarea,
} from "../../components/ui";
import { FormPapeleta, FormVacaciones, SelectorJefe, resumenDatos, avisarSolicitud } from "./formularios";
import { ESTADOS_SOL } from "./Bandeja";
import { avisarTicket } from "../soporte/Tickets";
import { JEFE_VACIO, datosConJefe } from "../../lib/jefe";

// Una solicitud que espera el visto bueno del usuario como jefe designado. La
// base decide si puede (resolver_solicitud); aquí solo se pide el motivo que
// observar y rechazar exigen. El original firmado no se muestra: lo revisa RRHH.
function VistoBueno({ solicitud: s }) {
  const { resolverSolicitud } = useApp();
  const [decision, setDecision] = useState(null); // null | "observar" | "rechazar"
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);

  const resolver = async (d) => {
    if (ocupado) return;
    setOcupado(true); setError(null);
    try {
      await resolverSolicitud(s.id, d, d === "aprobar" ? null : motivo.trim());
      avisarSolicitud(s.numero, "estado");
    } catch (err) {
      setError(err.message);
      setOcupado(false);
    }
  };
  const datos = resumenDatos(s.tipo_id, s.datos ?? {}).filter(([k]) => k !== "Original firmado");

  return (
    <div className="rounded-caja border border-borde p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12px] font-semibold">{s.numero}</span>
        <span className="text-[13px] font-semibold">{s.tipo}</span>
        <span className="flex-1" />
        <span className="font-mono text-[10.5px] text-gris-cl">{s.creado}</span>
      </div>
      <div className="mt-1 text-[13px] text-tinta">
        {s.solicitante_nombre}
        <span className="text-gris">{[s.cargo, s.sede_nombre].filter(Boolean).map((t) => ` · ${t}`).join("")}</span>
      </div>
      <div className="mt-1 space-y-0.5 text-[12px] text-gris">
        {datos.map(([k, v]) => <div key={k}><b className="font-semibold text-tinta-2">{k}:</b> {v}</div>)}
      </div>
      {decision && (
        <div className="mt-2">
          <Field label={decision === "observar" ? "¿Qué debe corregir?" : "Motivo del rechazo"} required>
            <Textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} />
          </Field>
        </div>
      )}
      {error && <div className="mt-2"><Note tone="alerta">{error}</Note></div>}
      <div className="mt-2 flex flex-wrap gap-2">
        {decision ? (
          <>
            <Button size="sm" variant={decision === "rechazar" ? "danger" : "primary"}
              disabled={ocupado || !motivo.trim()} onClick={() => resolver(decision)}>
              {ocupado ? "Enviando…" : decision === "observar" ? "Devolver con observación" : "Rechazar"}
            </Button>
            <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => { setDecision(null); setMotivo(""); setError(null); }}>Cancelar</Button>
          </>
        ) : (
          <>
            <Button size="sm" disabled={ocupado} onClick={() => resolver("aprobar")}>
              {ocupado ? "Enviando…" : "Dar visto bueno"}
            </Button>
            <Button size="sm" variant="secondary" disabled={ocupado} onClick={() => setDecision("observar")}>Observar</Button>
            <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => setDecision("rechazar")}>Rechazar</Button>
          </>
        )}
      </div>
    </div>
  );
}

const ESTADOS_TK = {
  abierto: { tone: "pend", label: "Abierto" },
  en_proceso: { tone: "tinta", label: "En proceso" },
  resuelto: { tone: "conf", label: "Resuelto" },
  cerrado: { tone: "neutral", label: "Cerrado" },
};

// Mi solicitud — el botón global del BackOffice (esquina inferior derecha):
// CUALQUIER usuario administrativo activo registra su propia solicitud y sigue
// las suyas, tenga o no acceso al módulo Solicitudes. El solicitante sale de
// la persona vinculada a su usuario; la cadena de V°B° y la regla «nadie se
// aprueba a sí mismo» rigen igual que siempre.
// Desde 2026-09-22 también aloja Soporte TI: el ticket propio del usuario
// administrativo (crear_ticket_propio) y su buzón (v_mis_tickets). Soporte TI
// salió del Portal del Trabajador ese día por decisión de Diego.
// Desde 2026-10-01 es también el buzón del JEFE DIRECTO: quien fue elegido
// como jefe inmediato en una solicitud ve aquí las que esperan su visto bueno
// y lo da (o la observa / rechaza con motivo) sin necesitar el módulo.
export default function MiSolicitud() {
  const { db, user, crearSolicitudPropia, reenviarSolicitud, crearTicketPropio, vistosBuenos, recargarVistosBuenos } = useApp();
  // Al abrir el buzón se vuelve a preguntar qué espera mi visto bueno (la
  // carga inicial es de cuando entré a la intranet).
  useEffect(() => { recargarVistosBuenos?.(); }, []);
  const [tipoId, setTipoId] = useState("");
  const [jefe, setJefe] = useState(JEFE_VACIO);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [corrigiendo, setCorrigiendo] = useState(null); // solicitud observada mía

  const tipos = db.solicitudTipos.filter((t) => t.activo && t.backoffice);
  const tipo = tipos.find((t) => t.id === tipoId);
  const mias = db.misSolicitudes;

  // Soporte TI propio: catálogo activo de v_ticket_config (misma fuente que SOP-01).
  const [tkTipo, setTkTipo] = useState("");
  const [tkSubtipo, setTkSubtipo] = useState("");
  const [tkComentario, setTkComentario] = useState("");
  const [tkOcupado, setTkOcupado] = useState(false);
  const [tkError, setTkError] = useState(null);
  const [tkAviso, setTkAviso] = useState(null);
  const tkTipos = useMemo(() => {
    const vistos = new Map();
    for (const f of db.ticketConfig) if (f.tipo_activo && !vistos.has(f.tipo_id)) vistos.set(f.tipo_id, f.tipo);
    return [...vistos.entries()];
  }, [db.ticketConfig]);
  const tkSubtipos = useMemo(
    () => db.ticketConfig.filter((f) => String(f.tipo_id) === tkTipo && f.subtipo_id && f.subtipo_activo),
    [db.ticketConfig, tkTipo]
  );
  const misTickets = db.misTickets ?? [];

  const enviarTicket = async (e) => {
    e.preventDefault();
    if (tkOcupado || !tkTipo) return;
    setTkError(null);
    setTkOcupado(true);
    try {
      const numero = await crearTicketPropio(Number(tkTipo), tkSubtipo ? Number(tkSubtipo) : null, tkComentario.trim());
      avisarTicket(numero);
      setTkAviso(numero);
      setTkTipo(""); setTkSubtipo(""); setTkComentario("");
    } catch (err) {
      setTkError(err.message);
    } finally {
      setTkOcupado(false);
    }
  };

  const enviar = async (datos) => {
    setOcupado(true);
    try {
      const numero = await crearSolicitudPropia(tipoId, datosConJefe(datos, jefe));
      avisarSolicitud(numero, "creada");
      setAviso(numero);
      setTipoId(""); setJefe(JEFE_VACIO);
    } finally {
      setOcupado(false);
    }
  };

  const reenviar = async (datos) => {
    setOcupado(true);
    try {
      await reenviarSolicitud(corrigiendo.id, datos);
      avisarSolicitud(corrigiendo.numero, "estado");
      setAviso(corrigiendo.numero);
      setCorrigiendo(null);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <>
      <PageHeader
        code="Mi solicitud"
        title="Mis solicitudes"
        subtitle={`Se registran a tu nombre (${user?.nombre ?? user?.correo ?? ""}) y siguen la cadena de aprobación normal. No necesitas acceso al módulo Solicitudes. Más abajo, Soporte TI: reporta un problema y sigue tus tickets.`}
      />

      {aviso && (
        <div className="mb-4 flex items-start gap-3 rounded-caja border border-conf/40 bg-conf-bg p-4">
          <MailCheck size={20} className="mt-0.5 shrink-0 text-conf" />
          <div>
            <div className="text-[14px] font-semibold text-conf">
              Tu solicitud <span className="font-mono">{aviso}</span> fue enviada
            </div>
            <div className="mt-0.5 text-[12.5px] text-gris">
              Aún no hay respuesta. En este buzón verás cada avance, y te llegará un correo cuando la resuelvan.
            </div>
          </div>
        </div>
      )}

      {vistosBuenos.length > 0 && (
        <div className="mb-5">
          <Card>
            <h2 className="mb-1 flex items-center gap-2 font-display text-[15px] font-semibold text-tinta">
              <Stamp size={16} className="text-petroleo" /> Esperan tu visto bueno
              <Badge tone="pend">{vistosBuenos.length}</Badge>
            </h2>
            <p className="mb-3 text-[12.5px] text-gris">
              Te eligieron como jefe inmediato. Tu visto bueno es el primer paso; después la solicitud sigue su cadena.
            </p>
            <div className="space-y-2.5">
              {vistosBuenos.map((s) => <VistoBueno key={s.id} solicitud={s} />)}
            </div>
          </Card>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          {corrigiendo ? (
            <>
              <div className="mb-1 flex items-center gap-2 font-display text-[15px] font-semibold text-tinta">
                Corregir {corrigiendo.numero}
              </div>
              {corrigiendo.ultimo_comentario && (
                <div className="mb-3"><Note tone="pend">Observación: «{corrigiendo.ultimo_comentario}»</Note></div>
              )}
              {corrigiendo.tipo_id === "papeleta-permiso" ? (
                <FormPapeleta inicial={corrigiendo.datos} onEnviar={reenviar} ocupado={ocupado} textoEnviar="Reenviar corregida" />
              ) : (
                <FormVacaciones inicial={corrigiendo.datos} onEnviar={reenviar} ocupado={ocupado} textoEnviar="Reenviar corregida" />
              )}
              <div className="mt-2">
                <Button variant="secondary" size="sm" onClick={() => setCorrigiendo(null)} disabled={ocupado}>Cancelar</Button>
              </div>
            </>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2 font-display text-[15px] font-semibold text-tinta">
                <ClipboardPen size={16} className="text-petroleo" /> Nueva solicitud
              </div>
              <div className="space-y-4">
                <Field label="Tipo de solicitud" required>
                  <Select value={tipoId} onChange={(e) => setTipoId(e.target.value)}>
                    <option value="">Seleccionar…</option>
                    {tipos.map((t) => (
                      <option key={t.id} value={t.id}>{t.nombre} ({t.codigo_formato})</option>
                    ))}
                  </Select>
                </Field>
                {tipo && (
                  <>
                    <SelectorJefe valor={jefe} onCambio={setJefe} excluirPropio />
                    {tipo.id === "papeleta-permiso"
                      ? <FormPapeleta onEnviar={enviar} ocupado={ocupado} textoEnviar="Enviar mi papeleta" />
                      : <FormVacaciones onEnviar={enviar} ocupado={ocupado} textoEnviar="Enviar mi solicitud" />}
                  </>
                )}
              </div>
            </>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 font-display text-[15px] font-semibold text-tinta">Buzón</h2>
          {mias.length === 0 ? (
            <EmptyState title="Buzón vacío" body="Cuando envíes una solicitud, aquí verás si ya te respondieron." />
          ) : (
            <div className="space-y-2.5">
              {mias.map((s) => {
                const est = ESTADOS_SOL[s.estado] ?? ESTADOS_SOL.enviada;
                return (
                  <div key={s.numero} className="rounded-caja border border-borde p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12px] font-semibold">{s.numero}</span>
                      <span className="text-[13px] font-semibold">{s.tipo}</span>
                      <span className="flex-1" />
                      <Badge tone={est.tone}>{s.estado === "enviada" ? "Enviada" : est.label}</Badge>
                    </div>
                    <div className="mt-1 text-[12px] text-gris">
                      {resumenDatos(s.tipo_id, s.datos ?? {}).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                    </div>
                    {s.estado === "enviada" && (
                      <div className="mt-1 flex items-center gap-1.5 text-[12px] font-medium text-pend">
                        <Hourglass size={12} />
                        Aún no hay respuesta{s.paso_titulo ? ` · esperando ${s.paso_titulo}` : ""}
                      </div>
                    )}
                    {s.estado === "aprobada" && (
                      <div className="mt-1 text-[12px] font-medium text-conf">Respondida: aprobada ✓</div>
                    )}
                    {s.estado === "observada" && (
                      <div className="mt-2 flex items-center gap-2">
                        {s.ultimo_comentario && <span className="text-[12px] text-alerta">«{s.ultimo_comentario}»</span>}
                        <Button size="sm" variant="secondary" onClick={() => setCorrigiendo(s)}>Corregir y reenviar</Button>
                      </div>
                    )}
                    {s.estado === "rechazada" && s.ultimo_comentario && (
                      <div className="mt-1 text-[12px] text-gris">Motivo: «{s.ultimo_comentario}»</div>
                    )}
                    <div className="mt-1 font-mono text-[10.5px] text-gris-cl">{s.creado}</div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Soporte TI (2026-09-22): antes vivía en el Portal del Trabajador. */}
      <h2 className="mb-3 mt-8 flex items-center gap-2 font-display text-[16px] font-semibold text-tinta">
        <LifeBuoy size={17} className="text-petroleo" /> Soporte TI
      </h2>
      {tkAviso && (
        <div className="mb-4 flex items-start gap-3 rounded-caja border border-conf/40 bg-conf-bg p-4">
          <MailCheck size={20} className="mt-0.5 shrink-0 text-conf" />
          <div>
            <div className="text-[14px] font-semibold text-conf">
              Tu ticket <span className="font-mono">{tkAviso}</span> fue registrado
            </div>
            <div className="mt-0.5 text-[12.5px] text-gris">
              El equipo de TI recibió el aviso. Aquí verás cuando lo tomen y cuando lo resuelvan.
            </div>
          </div>
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <div className="mb-3 font-display text-[15px] font-semibold text-tinta">Reportar un problema</div>
          <form onSubmit={enviarTicket} className="space-y-4">
            <Field label="Tipo" required>
              <Select value={tkTipo} onChange={(e) => { setTkTipo(e.target.value); setTkSubtipo(""); }}>
                <option value="">Seleccionar…</option>
                {tkTipos.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
              </Select>
            </Field>
            {tkSubtipos.length > 0 && (
              <Field label="Subtipo">
                <Select value={tkSubtipo} onChange={(e) => setTkSubtipo(e.target.value)}>
                  <option value="">Seleccionar…</option>
                  {tkSubtipos.map((s) => <option key={s.subtipo_id} value={s.subtipo_id}>{s.subtipo}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Comentario" hint="Qué pasa, desde cuándo y en qué equipo.">
              <Textarea rows={3} value={tkComentario} onChange={(e) => setTkComentario(e.target.value)} maxLength={1000} />
            </Field>
            {tkError && <Note tone="alerta">{tkError}</Note>}
            <Button type="submit" disabled={tkOcupado || !tkTipo}>
              {tkOcupado ? "Enviando…" : "Enviar ticket"}
            </Button>
          </form>
        </Card>

        <Card>
          <h2 className="mb-3 font-display text-[15px] font-semibold text-tinta">Mis tickets</h2>
          {misTickets.length === 0 ? (
            <EmptyState title="Sin tickets" body="Cuando reportes un problema, aquí verás en qué va." />
          ) : (
            <div className="space-y-2.5">
              {misTickets.map((t) => {
                const est = ESTADOS_TK[t.estado] ?? ESTADOS_TK.abierto;
                return (
                  <div key={t.numero} className="rounded-caja border border-borde p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12px] font-semibold">{t.numero}</span>
                      <span className="text-[13px] font-semibold">{t.tipo}{t.subtipo ? <span className="font-normal text-gris"> · {t.subtipo}</span> : null}</span>
                      <span className="flex-1" />
                      <Badge tone={est.tone}>{est.label}</Badge>
                    </div>
                    {t.comentario && <div className="mt-1 text-[12px] text-gris">{t.comentario}</div>}
                    {t.atendido_por && t.estado !== "abierto" && (
                      <div className="mt-1 text-[12px] text-gris">Atiende: {t.atendido_por}</div>
                    )}
                    <div className="mt-1 font-mono text-[10.5px] text-gris-cl">{t.creado}</div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
