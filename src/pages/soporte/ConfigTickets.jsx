import { useMemo, useState } from "react";
import { Plus, ChevronDown, ChevronRight } from "lucide-react";
import { useApp } from "../../state";
import { nivelDe } from "../../data/modulos";
import {
  PageHeader, Card, Badge, Button, Input, Field, Modal, Note, EmptyState,
} from "../../components/ui";

// SOP-02 — Configuración de tickets: catálogo de tipos/subtipos (activables,
// como en el sistema TI de PROMANT) y correos que reciben aviso de cada
// ticket nuevo. Todo exige nivel de aprobación en Soporte.
export default function ConfigTickets() {
  const {
    db, user, guardarTicketTipo, guardarTicketSubtipo, alternarTicketTipo,
    alternarTicketSubtipo, guardarTicketAviso, eliminarTicketAviso,
  } = useApp();
  const acceso = user?.acceso ?? { esSuperadmin: user?.esSuperadmin, matriz: {} };
  const puedeAprobar = nivelDe(acceso, "soporte") >= 3;
  const [abiertos, setAbiertos] = useState(() => new Set());
  const [editor, setEditor] = useState(null); // { clase: 'tipo'|'subtipo', id, tipoId, nombre }
  const [correoNuevo, setCorreoNuevo] = useState("");
  const [aviso, setAviso] = useState(null);
  const [error, setError] = useState(null);

  // v_ticket_config es plana (tipo × subtipo); aquí se agrupa por tipo.
  const tipos = useMemo(() => {
    const m = new Map();
    for (const f of db.ticketConfig) {
      if (!m.has(f.tipo_id)) m.set(f.tipo_id, { id: f.tipo_id, nombre: f.tipo, activo: f.tipo_activo, subtipos: [] });
      if (f.subtipo_id) m.get(f.tipo_id).subtipos.push({ id: f.subtipo_id, nombre: f.subtipo, activo: f.subtipo_activo });
    }
    return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [db.ticketConfig]);

  const alternarAbierto = (id) =>
    setAbiertos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  const ejecutar = async (fn, mensaje) => {
    setError(null);
    try {
      await fn();
      if (mensaje) setAviso(mensaje);
    } catch (err) {
      setError(err.message);
    }
  };

  const agregarCorreo = (e) => {
    e.preventDefault();
    const c = correoNuevo.trim().toLowerCase();
    if (!c) return;
    ejecutar(async () => {
      await guardarTicketAviso(c, true);
      setCorreoNuevo("");
    }, `${c} recibirá aviso de cada ticket nuevo.`);
  };

  return (
    <>
      <PageHeader
        code="SOP-02 · Configuración de tickets"
        title="Config. de tickets"
        subtitle="El catálogo de tipos y subtipos que ven los trabajadores, y los correos que reciben aviso de cada ticket nuevo."
      />

      {aviso && <div className="mb-4"><Note tone="conf">{aviso}</Note></div>}
      {error && <div className="mb-4"><Note tone="alerta">{error}</Note></div>}
      {!puedeAprobar && (
        <div className="mb-4">
          <Note tone="neutral">Tu categoría permite consultar la configuración pero no editarla (requiere nivel de aprobación en Soporte).</Note>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-[15px] font-semibold text-tinta">Tipos y subtipos</h2>
            {puedeAprobar && (
              <Button size="sm" variant="secondary" onClick={() => setEditor({ clase: "tipo", id: null, nombre: "" })}>
                <Plus size={13} /> Nuevo tipo
              </Button>
            )}
          </div>
          {tipos.length === 0 ? (
            <EmptyState title="Sin catálogo" body="El catálogo se siembra desde la base de datos." />
          ) : (
            <div className="space-y-1.5">
              {tipos.map((t) => (
                <div key={t.id} className="rounded-caja border border-borde">
                  <div className="flex items-center gap-2 p-2.5">
                    <button type="button" onClick={() => alternarAbierto(t.id)} className="text-gris hover:text-tinta">
                      {abiertos.has(t.id) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>
                    <span className="flex-1 text-[13px] font-semibold text-tinta">{t.nombre}</span>
                    <span className="text-[11px] text-gris">{t.subtipos.length} subtipo(s)</span>
                    <Badge tone={t.activo ? "conf" : "neutral"}>{t.activo ? "Activo" : "Inactivo"}</Badge>
                    {puedeAprobar && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => setEditor({ clase: "tipo", id: t.id, nombre: t.nombre })}>Renombrar</Button>
                        <Button variant="ghost" size="sm" onClick={() => ejecutar(() => alternarTicketTipo(t.id, !t.activo))}>
                          {t.activo ? "Desactivar" : "Activar"}
                        </Button>
                      </>
                    )}
                  </div>
                  {abiertos.has(t.id) && (
                    <div className="border-t border-borde bg-papel/50 p-2.5 pl-9 space-y-1">
                      {t.subtipos.map((s) => (
                        <div key={s.id} className="flex items-center gap-2">
                          <span className="flex-1 text-[12.5px] text-tinta-2">{s.nombre}</span>
                          <Badge tone={s.activo ? "conf" : "neutral"}>{s.activo ? "Activo" : "Inactivo"}</Badge>
                          {puedeAprobar && (
                            <>
                              <Button variant="ghost" size="sm"
                                onClick={() => setEditor({ clase: "subtipo", id: s.id, tipoId: t.id, nombre: s.nombre })}>Renombrar</Button>
                              <Button variant="ghost" size="sm" onClick={() => ejecutar(() => alternarTicketSubtipo(s.id, !s.activo))}>
                                {s.activo ? "Desactivar" : "Activar"}
                              </Button>
                            </>
                          )}
                        </div>
                      ))}
                      {puedeAprobar && (
                        <Button variant="ghost" size="sm"
                          onClick={() => setEditor({ clase: "subtipo", id: null, tipoId: t.id, nombre: "" })}>
                          <Plus size={12} /> Nuevo subtipo
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-1 font-display text-[15px] font-semibold text-tinta">Avisos por correo</h2>
          <p className="mb-3 text-[12.5px] text-gris">
            Cada correo de esta lista recibe un aviso automático cuando alguien crea un ticket.
            Los avisos salen cuando el motor de correo tiene proveedor configurado.
          </p>
          {puedeAprobar && (
            <form onSubmit={agregarCorreo} className="mb-3 flex gap-2">
              <Input type="email" placeholder="correo@empresa.pe" value={correoNuevo}
                onChange={(e) => setCorreoNuevo(e.target.value)} style={{ maxWidth: 280 }} />
              <Button type="submit" size="sm" disabled={!correoNuevo.trim()}><Plus size={13} /> Agregar</Button>
            </form>
          )}
          <div className="space-y-1.5">
            {db.ticketAvisos.map((a) => (
              <div key={a.correo} className="flex items-center gap-2 rounded-caja border border-borde p-2.5">
                <span className="flex-1 font-mono text-[12.5px] text-tinta">{a.correo}</span>
                <Badge tone={a.activo ? "conf" : "neutral"}>{a.activo ? "Activo" : "Inactivo"}</Badge>
                {puedeAprobar && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => ejecutar(() => guardarTicketAviso(a.correo, !a.activo))}>
                      {a.activo ? "Desactivar" : "Activar"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => ejecutar(() => eliminarTicketAviso(a.correo), `${a.correo} eliminado de los avisos.`)}>
                      Eliminar
                    </Button>
                  </>
                )}
              </div>
            ))}
            {db.ticketAvisos.length === 0 && (
              <EmptyState title="Sin destinatarios" body="Agrega al menos un correo para que el equipo se entere de los tickets nuevos." />
            )}
          </div>
        </Card>
      </div>

      <EditorNombre editor={editor} onClose={() => setEditor(null)}
        onGuardar={async (e, nombre) => {
          if (e.clase === "tipo") await guardarTicketTipo(e.id, nombre);
          else await guardarTicketSubtipo(e.id, e.tipoId, nombre);
        }} />
    </>
  );
}

function EditorNombre({ editor, onClose, onGuardar }) {
  const [nombre, setNombre] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  // El nombre inicial se fija al abrir (key del Modal por editor).
  const abierto = !!editor;
  const titulo = editor
    ? `${editor.id ? "Renombrar" : "Nuevo"} ${editor.clase === "tipo" ? "tipo" : "subtipo"}`
    : "";

  const guardar = async (e) => {
    e.preventDefault();
    if (ocupado) return;
    setError(null);
    setOcupado(true);
    try {
      await onGuardar(editor, nombre.trim());
      setNombre("");
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Modal open={abierto} onClose={() => { setNombre(""); onClose(); }} title={titulo}>
      {editor && (
        <form onSubmit={guardar} className="space-y-4">
          <Field label="Nombre" required>
            <Input autoFocus value={nombre} placeholder={editor.nombre || undefined}
              onChange={(e) => setNombre(e.target.value)} />
          </Field>
          {error && <Note tone="alerta">{error}</Note>}
          <div className="flex gap-2">
            <Button type="submit" disabled={ocupado || !nombre.trim()}>{ocupado ? "Guardando…" : "Guardar"}</Button>
            <Button type="button" variant="secondary" onClick={() => { setNombre(""); onClose(); }} disabled={ocupado}>Cancelar</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
