import { useMemo, useState } from "react";
import { TicketPlus } from "lucide-react";
import { useApp } from "../../state";
import { nivelDe } from "../../data/modulos";
import {
  PageHeader, Card, Stat, Table, Td, Badge, Button, Input, Select, Field, Modal, Note, Textarea, EmptyState,
} from "../../components/ui";

const ESTADOS = {
  abierto: { tone: "pend", label: "Abierto" },
  en_proceso: { tone: "tinta", label: "En proceso" },
  resuelto: { tone: "conf", label: "Resuelto" },
  cerrado: { tone: "neutral", label: "Cerrado" },
};

// Dispara el aviso por correo a los configurados en SOP-02. Fire-and-forget:
// un fallo de correo no es un fallo del ticket (puede no haber proveedor aún).
export function avisarTicket(numero) {
  fetch("/api/enviar-correo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accion: "aviso-ticket", numero }),
  }).catch(() => {});
}

// SOP-01 — Tickets de soporte (incidencias TI). Las solicitudes formales con
// aprobación van al Centro de Solicitudes, no aquí.
export default function Tickets() {
  const { db, user, empresaId, crearTicketAdmin, actualizarTicket } = useApp();
  const acceso = user?.acceso ?? { esSuperadmin: user?.esSuperadmin, matriz: {} };
  const puedeAccionar = nivelDe(acceso, "soporte") >= 2;
  const [q, setQ] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [ver, setVer] = useState(null);     // ticket abierto en el modal
  const [nuevo, setNuevo] = useState(false);
  const [aviso, setAviso] = useState(null);

  // Un ticket sin empresa (solicitante sin vínculo vigente) se muestra siempre
  // para no esconderlo del equipo de soporte.
  const filas = useMemo(
    () =>
      db.tickets.filter(
        (t) =>
          (!t.empresa || t.empresa === empresaId) &&
          (!fEstado || t.estado === fEstado) &&
          (!fTipo || t.tipo === fTipo) &&
          (!q ||
            t.numero.toLowerCase().includes(q.toLowerCase()) ||
            t.solicitante_nombre.toLowerCase().includes(q.toLowerCase()) ||
            (t.solicitante_dni ?? "").includes(q))
      ),
    [db.tickets, empresaId, q, fEstado, fTipo]
  );

  const totales = {
    abiertos: filas.filter((t) => t.estado === "abierto").length,
    enProceso: filas.filter((t) => t.estado === "en_proceso").length,
    resueltos: filas.filter((t) => t.estado === "resuelto").length,
    cerrados: filas.filter((t) => t.estado === "cerrado").length,
  };

  const tipos = useMemo(
    () => [...new Set(db.tickets.map((t) => t.tipo))].sort(),
    [db.tickets]
  );

  return (
    <>
      <PageHeader
        code="SOP-01 · Tickets de soporte"
        title="Tickets"
        subtitle="Incidencias y pedidos al equipo de TI. Los trabajadores los crean desde su portal; aquí también se registran a nombre de alguien."
        actions={
          puedeAccionar && (
            <Button size="sm" onClick={() => setNuevo(true)}><TicketPlus size={13} /> Nuevo ticket</Button>
          )
        }
      />

      <div className="mb-5 flex flex-wrap gap-4">
        <Stat label="Abiertos" value={totales.abiertos} tone={totales.abiertos ? "pend" : "default"} />
        <Stat label="En proceso" value={totales.enProceso} />
        <Stat label="Resueltos" value={totales.resueltos} tone="conf" />
        <Stat label="Cerrados" value={totales.cerrados} />
      </div>

      {aviso && <div className="mb-4"><Note tone="conf">{aviso}</Note></div>}

      <Card pad={false}>
        <div className="flex flex-wrap gap-2.5 border-b border-borde bg-papel/50 p-3.5">
          <Input placeholder="Buscar por N°, nombre o DNI…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 250 }} />
          <Select value={fEstado} onChange={(e) => setFEstado(e.target.value)} style={{ maxWidth: 170 }}>
            <option value="">Todos los estados</option>
            {Object.entries(ESTADOS).map(([v, e]) => <option key={v} value={v}>{e.label}</option>)}
          </Select>
          <Select value={fTipo} onChange={(e) => setFTipo(e.target.value)} style={{ maxWidth: 210 }}>
            <option value="">Todos los tipos</option>
            {tipos.map((t) => <option key={t}>{t}</option>)}
          </Select>
        </div>
        {filas.length === 0 ? (
          <EmptyState title="Sin tickets" body="Cuando un trabajador reporte un problema desde su portal, aparecerá aquí." />
        ) : (
          <Table head={["N°", "Fecha", "Solicitante", "Área", "Tipo / Subtipo", "Estado", "Atendido por", ""]}>
            {filas.map((t) => {
              const est = ESTADOS[t.estado] ?? ESTADOS.abierto;
              return (
                <tr key={t.id} className="hover:bg-papel/60">
                  <Td className="font-mono text-[12px] font-semibold">{t.numero}</Td>
                  <Td className="font-mono text-[11.5px] text-gris">{t.creado}</Td>
                  <Td>
                    <div className="font-semibold">{t.solicitante_nombre}</div>
                    {t.solicitante_correo && <div className="text-[11px] text-gris">{t.solicitante_correo}</div>}
                  </Td>
                  <Td className="text-gris">{t.area ?? "—"}</Td>
                  <Td>{t.tipo}{t.subtipo ? <span className="text-gris"> · {t.subtipo}</span> : null}</Td>
                  <Td><Badge tone={est.tone}>{est.label}</Badge></Td>
                  <Td className="text-gris">{t.atendido_por ?? "—"}</Td>
                  <Td><Button variant="ghost" size="sm" onClick={() => setVer(t)}>Ver</Button></Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <VerTicket ticket={ver} onClose={() => setVer(null)} puedeAccionar={puedeAccionar}
        actualizarTicket={actualizarTicket} onListo={setAviso} />
      <NuevoTicket open={nuevo} onClose={() => setNuevo(false)} crearTicketAdmin={crearTicketAdmin} onListo={setAviso} />
    </>
  );
}

// Detalle + gestión: estado, responsable y nota interna (solo la ve el equipo).
function VerTicket({ ticket, onClose, puedeAccionar, actualizarTicket, onListo }) {
  const [estado, setEstado] = useState("");
  const [atendido, setAtendido] = useState("");
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);

  const guardar = async () => {
    if (ocupado) return;
    setError(null);
    setOcupado(true);
    try {
      await actualizarTicket(ticket.id, {
        estado: estado || null, atendidoPor: atendido || null, nota: nota || null,
      });
      onListo(`Ticket ${ticket.numero} actualizado.`);
      setEstado(""); setAtendido(""); setNota("");
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado(false);
    }
  };

  const est = ticket ? (ESTADOS[ticket.estado] ?? ESTADOS.abierto) : null;
  return (
    <Modal open={!!ticket} onClose={onClose} title={`Ticket ${ticket?.numero ?? ""}`} wide>
      {ticket && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={est.tone}>{est.label}</Badge>
            <span className="font-mono text-[11.5px] text-gris">{ticket.creado}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Dato etiqueta="Solicitante" valor={ticket.solicitante_nombre} />
            <Dato etiqueta="DNI" valor={ticket.solicitante_dni ?? "—"} />
            <Dato etiqueta="Correo" valor={ticket.solicitante_correo ?? "—"} />
            <Dato etiqueta="Área" valor={ticket.area ?? "—"} />
            <Dato etiqueta="Tipo" valor={ticket.tipo} />
            <Dato etiqueta="Subtipo" valor={ticket.subtipo ?? "—"} />
          </div>
          {ticket.comentario && (
            <div>
              <div className="font-mono text-[10px] font-semibold uppercase tracking-wide text-gris">Comentario del solicitante</div>
              <div className="mt-1 rounded-caja border border-borde bg-papel/60 p-3 text-[13px]">{ticket.comentario}</div>
            </div>
          )}
          {ticket.actualizado && (
            <div className="text-[11.5px] text-gris">
              Última actualización: {ticket.actualizado_por ?? "—"} · {ticket.actualizado}
            </div>
          )}
          {puedeAccionar && (
            <div className="rounded-caja border border-borde bg-papel/60 p-3.5 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Cambiar estado">
                  <Select value={estado} onChange={(e) => setEstado(e.target.value)}>
                    <option value="">(sin cambio)</option>
                    {Object.entries(ESTADOS).map(([v, e]) => <option key={v} value={v}>{e.label}</option>)}
                  </Select>
                </Field>
                <Field label="Atendido por">
                  <Input value={atendido} onChange={(e) => setAtendido(e.target.value)}
                    placeholder={ticket.atendido_por ?? "Responsable del equipo de TI"} />
                </Field>
              </div>
              <Field label="Nota interna" hint="Solo la ve el equipo; el trabajador no la ve en su portal.">
                <Textarea rows={2} value={nota} onChange={(e) => setNota(e.target.value)}
                  placeholder={ticket.nota_interna ?? ""} />
              </Field>
              {ticket.nota_interna && !nota && (
                <div className="text-[12px] text-gris">Nota actual: {ticket.nota_interna}</div>
              )}
              {error && <Note tone="alerta">{error}</Note>}
              <div className="flex gap-2">
                <Button onClick={guardar} disabled={ocupado || (!estado && !atendido && !nota)}>
                  {ocupado ? "Guardando…" : "Guardar cambios"}
                </Button>
                <Button variant="secondary" onClick={onClose} disabled={ocupado}>Cerrar</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Dato({ etiqueta, valor }) {
  return (
    <div>
      <div className="font-mono text-[10px] font-semibold uppercase tracking-wide text-gris">{etiqueta}</div>
      <div className="mt-0.5 text-[13px] font-semibold text-tinta">{valor}</div>
    </div>
  );
}

// Registrar un ticket a nombre de un trabajador del maestro (como el acuse
// asistido: la gestión llegó por otro canal y aquí queda registrada).
function NuevoTicket({ open, onClose, crearTicketAdmin, onListo }) {
  const { db } = useApp();
  const [dni, setDni] = useState("");
  const [tipoId, setTipoId] = useState("");
  const [subtipoId, setSubtipoId] = useState("");
  const [comentario, setComentario] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  const vigentes = db.personal.filter((p) => p.estado === "vigente");

  // Catálogo activo: v_ticket_config trae todo; aquí solo se ofrecen activos.
  const tiposActivos = useMemo(() => {
    const vistos = new Map();
    for (const f of db.ticketConfig) {
      if (f.tipo_activo && !vistos.has(f.tipo_id)) vistos.set(f.tipo_id, f.tipo);
    }
    return [...vistos.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [db.ticketConfig]);
  const subtiposDelTipo = useMemo(
    () => db.ticketConfig.filter((f) => String(f.tipo_id) === tipoId && f.subtipo_id && f.subtipo_activo),
    [db.ticketConfig, tipoId]
  );

  const cerrar = () => {
    setDni(""); setTipoId(""); setSubtipoId(""); setComentario(""); setError(null);
    onClose();
  };

  const crear = async (e) => {
    e.preventDefault();
    if (ocupado) return;
    setError(null);
    setOcupado(true);
    try {
      const numero = await crearTicketAdmin(dni, Number(tipoId), subtipoId ? Number(subtipoId) : null, comentario);
      avisarTicket(numero);
      onListo(`Ticket ${numero} registrado. El aviso por correo salió a los destinatarios configurados.`);
      cerrar();
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Modal open={open} onClose={cerrar} title="Nuevo ticket de soporte" wide>
      <form onSubmit={crear} className="space-y-4">
        <Field label="Trabajador" required hint="El ticket queda a nombre de una persona del maestro.">
          <Select value={dni} onChange={(e) => setDni(e.target.value)}>
            <option value="">Buscar por nombre…</option>
            {vigentes.map((p) => (
              <option key={p.dni} value={p.dni}>{p.nombre} — {p.dni}</option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo de problema" required>
            <Select value={tipoId} onChange={(e) => { setTipoId(e.target.value); setSubtipoId(""); }}>
              <option value="">Seleccionar…</option>
              {tiposActivos.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
            </Select>
          </Field>
          {subtiposDelTipo.length > 0 && (
            <Field label="Subtipo">
              <Select value={subtipoId} onChange={(e) => setSubtipoId(e.target.value)}>
                <option value="">Seleccionar…</option>
                {subtiposDelTipo.map((s) => <option key={s.subtipo_id} value={s.subtipo_id}>{s.subtipo}</option>)}
              </Select>
            </Field>
          )}
        </div>
        <Field label="Comentario" hint="Qué pasa, desde cuándo, qué equipo.">
          <Textarea rows={3} value={comentario} onChange={(e) => setComentario(e.target.value)} />
        </Field>
        {error && <Note tone="alerta">{error}</Note>}
        <div className="flex gap-2">
          <Button type="submit" disabled={ocupado || !dni || !tipoId}>
            {ocupado ? "Registrando…" : "Registrar ticket"}
          </Button>
          <Button type="button" variant="secondary" onClick={cerrar} disabled={ocupado}>Cancelar</Button>
        </div>
      </form>
    </Modal>
  );
}
