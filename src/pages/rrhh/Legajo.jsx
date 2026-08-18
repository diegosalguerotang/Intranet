import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Download, Pencil } from "lucide-react";
import { PageHeader, Card, Badge, Button, Table, Td, EmptyState, Note, Modal, Field, Input, Select } from "../../components/ui";
import { useApp } from "../../state";
import { AUDITORIA } from "../../data/mock";
import { nivelDe } from "../../data/modulos";

const TABS = ["Datos personales", "Vínculos", "Documentos", "Disciplina", "Activos", "Actividad"];

const ESTADO_ACUSE = {
  confirmado: { tone: "conf", label: "Confirmado" },
  asistido: { tone: "tinta", label: "Acuse asistido" },
  pendiente: { tone: "pend", label: "Pendiente" },
  nunca_ingreso: { tone: "alerta", label: "Nunca ingresó" },
};

export default function Legajo() {
  const { dni } = useParams();
  const [tab, setTab] = useState(0);
  const [editar, setEditar] = useState(false);
  const [aviso, setAviso] = useState(null);
  const { db, persona, sede, empresaPor, user, editarTrabajador } = useApp();
  const p = persona(dni);
  // Editar exige nivel de ACCIÓN en Personal (el RPC lo vuelve a validar).
  const puedeEditar = nivelDe(user?.acceso ?? (user ? { esSuperadmin: user.esSuperadmin } : null), "personal") >= 2;

  if (!p) {
    return <EmptyState title="Trabajador no encontrado" body={`No existe un registro con DNI ${dni}.`} />;
  }

  const s = sede(p.sede);
  const e = empresaPor(p.empresa);
  const acuses = db.acuses.filter((a) => a.dni === dni);
  const memos = db.memorandums.filter((m) => m.dni === dni);
  const activos = db.activos.filter((a) => a.asignado === dni);
  const epp = db.epp_entregas.filter((x) => x.dni === dni);
  const contrato = db.contratos.find((c) => c.dni === dni);
  const antiguedad = new Date().getFullYear() - new Date(p.ingreso).getFullYear();

  return (
    <>
      <Link to="/rrhh/personal" className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-petroleo hover:underline">
        <ArrowLeft size={13} /> Volver al maestro de personal
      </Link>
      <PageHeader
        code="RRH-03 · Legajo del trabajador"
        title={p.nombre}
        subtitle={`${p.cargo} · ${s?.nombre} · ${e?.nombre}`}
        actions={
          <>
            {puedeEditar && (
              <Button size="sm" onClick={() => setEditar(true)}><Pencil size={13} /> Editar datos</Button>
            )}
            <Button variant="secondary" size="sm"><Download size={13} /> Descargar legajo</Button>
            <Button variant="secondary" size="sm"><Download size={13} /> Constancias</Button>
          </>
        }
      />

      {aviso && <div className="mb-4"><Note tone="conf">{aviso}</Note></div>}

      <div className="mb-5 flex flex-wrap gap-4">
        {[
          ["DNI", p.dni],
          ["Ingreso", p.ingreso],
          ["Antigüedad", `${antiguedad} años`],
          ["Celular", p.celular ?? "Sin registrar"],
          ["Estado", p.estado === "vigente" ? "Vigente" : `Cesado ${p.cese ?? ""}`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-md border border-borde bg-white px-4 py-2.5">
            <div className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-gris">{k}</div>
            <div className="mt-0.5 text-[13px] font-semibold text-tinta">{v}</div>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-1 border-b border-borde-f">
        {TABS.map((t, i) => (
          <button
            key={t}
            onClick={() => setTab(i)}
            className={`-mb-px border-b-2 px-3.5 py-2 text-[13px] font-semibold transition-colors ${
              tab === i ? "border-petroleo text-petroleo" : "border-transparent text-gris hover:text-tinta"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 0 && (
        <Card>
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Nombre completo", p.nombre],
              ["DNI", p.dni],
              ["Celular", p.celular ?? "Sin registrar"],
              ["Correo", p.correo ? `${p.correo}${p.correoVerificado ? " ✓ verificado" : " (sin verificar)"}` : "Sin registrar"],
              ["Banco de haberes", p.banco],
              ["N° de cuenta", p.cuenta ?? "Sin registrar"],
              ["CCI", p.cci ?? "Sin registrar"],
              ["Estado del portal", { activo: "Activo", nunca_ingreso: "Nunca ingresó", sin_celular: "Sin celular" }[p.portal]],
            ].map(([k, v]) => (
              <div key={k}>
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-gris">{k}</div>
                <div className="mt-1 text-[13.5px] text-tinta">{v}</div>
              </div>
            ))}
          </div>
          <Note tone="neutral">
            La remuneración y la cuenta de haberes son datos sensibles: esta consulta queda registrada en auditoría.
          </Note>
        </Card>
      )}

      {tab === 1 && (
        <Card pad={false}>
          <Table head={["Empresa", "Sede", "Cargo", "Inicio", "Fin", "Estado"]}>
            <tr>
              <Td className="font-semibold">{e?.nombre}</Td>
              <Td>{s?.nombre}</Td>
              <Td>{p.cargo}</Td>
              <Td className="font-mono text-[12px]">{p.ingreso}</Td>
              <Td className="font-mono text-[12px]">{p.cese ?? "—"}</Td>
              <Td><Badge tone={p.estado === "vigente" ? "conf" : "neutral"}>{p.estado === "vigente" ? "Vigente" : "Cerrado"}</Badge></Td>
            </tr>
          </Table>
          <div className="border-t border-borde p-4">
            <Note tone="neutral">
              El legajo es por Persona, no por vínculo: si trabajó en otra empresa del grupo, ambas historias aparecen aquí.
            </Note>
          </div>
        </Card>
      )}

      {tab === 2 && (
        <Card pad={false}>
          {acuses.length === 0 && !contrato ? (
            <div className="p-5"><EmptyState title="Sin documentos" body="Este trabajador aún no tiene documentos publicados." /></div>
          ) : (
            <Table head={["Documento", "Lote", "Estado", "Fecha de acuse", ""]}>
              {contrato && (
                <tr>
                  <Td className="font-semibold">Contrato {contrato.tipo} ({contrato.inicio} → {contrato.fin})</Td>
                  <Td className="font-mono text-[12px] text-gris">—</Td>
                  <Td><Badge tone={contrato.firma === "firmado" ? "conf" : "pend"}>{contrato.firma === "firmado" ? "Firmado" : "Pendiente de firma"}</Badge></Td>
                  <Td className="text-gris">—</Td>
                  <Td />
                </tr>
              )}
              {acuses.map((a, i) => {
                const est = ESTADO_ACUSE[a.estado];
                return (
                  <tr key={i}>
                    <Td className="font-semibold">{a.doc}</Td>
                    <Td className="font-mono text-[12px] text-gris">{a.lote}</Td>
                    <Td><Badge tone={est.tone}>{est.label}</Badge></Td>
                    <Td className="font-mono text-[12px] text-gris">{a.fecha ?? "—"}</Td>
                    <Td>
                      {(a.estado === "confirmado" || a.estado === "asistido") && (
                        <Link to={`/rrhh/acuses/${a.dni}`} className="text-[12px] font-semibold text-petroleo hover:underline">
                          Ver constancia
                        </Link>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      )}

      {tab === 3 && (
        <Card pad={false}>
          {memos.length === 0 ? (
            <div className="p-5"><EmptyState title="Sin procesos disciplinarios" /></div>
          ) : (
            <Table head={["N°", "Tipo", "Motivo", "Estado", "Vence"]}>
              {memos.map((m) => (
                <tr key={m.id}>
                  <Td className="font-mono text-[12px]">{m.id}</Td>
                  <Td className="font-semibold">{m.tipo}</Td>
                  <Td className="max-w-md text-gris">{m.motivo}</Td>
                  <Td>
                    <Badge tone={{ resuelto: "neutral", descargo_presentado: "pend", emitido_sin_notificar: "alerta" }[m.estado] ?? "pend"}>
                      {{ resuelto: "Resuelto", descargo_presentado: "Descargo presentado", emitido_sin_notificar: "Sin notificar" }[m.estado] ?? m.estado}
                    </Badge>
                  </Td>
                  <Td className="font-mono text-[12px] text-gris">{m.vence ?? "—"}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === 4 && (
        <Card pad={false}>
          {activos.length === 0 && epp.length === 0 ? (
            <div className="p-5"><EmptyState title="Sin activos a cargo" /></div>
          ) : (
            <Table head={["Código / Entrega", "Descripción", "Desde", "Estado"]}>
              {activos.map((a) => (
                <tr key={a.codigo}>
                  <Td className="font-mono text-[12px]">{a.codigo}</Td>
                  <Td className="font-semibold">{a.marca} {a.modelo}</Td>
                  <Td className="font-mono text-[12px] text-gris">{a.compra}</Td>
                  <Td><Badge tone="tinta">Asignado</Badge></Td>
                </tr>
              ))}
              {epp.map((x) => (
                <tr key={`epp-${x.id}`}>
                  <Td className="font-mono text-[12px]">EPP</Td>
                  <Td className="text-gris">{x.items}</Td>
                  <Td className="font-mono text-[12px] text-gris">{x.entrega}</Td>
                  <Td><Badge tone={x.estado === "vigente" ? "conf" : "pend"}>{x.estado === "vigente" ? "Vigente" : "Por reponer"}</Badge></Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {editar && (
        <EditarDatos
          persona={p}
          onClose={() => setEditar(false)}
          editarTrabajador={editarTrabajador}
          onListo={() => { setEditar(false); setAviso("Datos actualizados. El cambio quedó en auditoría."); }}
        />
      )}

      {tab === 5 && (
        <Card pad={false}>
          <Table head={["Fecha", "Usuario", "Acción", "Entidad", "IP"]}>
            {AUDITORIA.map((a, i) => (
              <tr key={i}>
                <Td className="font-mono text-[12px]">{a.fecha}</Td>
                <Td>{a.usuario} <span className="text-gris">({a.rol})</span></Td>
                <Td className="font-semibold">{a.accion}</Td>
                <Td className="text-gris">{a.entidad}</Td>
                <Td className="font-mono text-[12px] text-gris">{a.ip}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}

// Edición de datos personales: lo escrito manda (vaciar sí borra), el nombre
// no puede quedar vacío (corregirlo limpia «por confirmar») y cambiar el
// correo lo deja pendiente de verificación. El RPC valida el nivel de nuevo.
function EditarDatos({ persona: p, onClose, editarTrabajador, onListo }) {
  const [form, setForm] = useState({
    nombre: p.nombre ?? "", celular: p.celular ?? "", correo: p.correo ?? "",
    banco: p.banco ?? "", cuenta: p.cuenta ?? "", cci: p.cci ?? "",
  });
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const guardar = async (e) => {
    e.preventDefault();
    if (ocupado) return;
    setError(null);
    setOcupado(true);
    try {
      await editarTrabajador(p.dni, form);
      onListo();
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Editar datos — ${p.nombre}`} wide>
      <form onSubmit={guardar} className="space-y-4">
        <Field label="Nombres y apellidos" required hint="Corregirlo quita la marca «por confirmar» de la importación.">
          <Input value={form.nombre} onChange={set("nombre")} required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Celular" hint="Libre: acepta +51 y espacios. Vaciarlo lo borra.">
            <Input value={form.celular} onChange={set("celular")} placeholder="987 654 321 o +51 987 654 321" />
          </Field>
          <Field label="Correo" hint="Cambiarlo lo deja pendiente de verificación.">
            <Input type="email" value={form.correo} onChange={set("correo")} placeholder="persona@correo.com" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Banco de haberes">
            <Select value={form.banco} onChange={set("banco")}>
              <option value="">Sin banco</option>
              <option>BCP</option><option>BBVA</option><option>Interbank</option><option>Scotiabank</option>
            </Select>
          </Field>
          <Field label="N° de cuenta" hint="Dato sensible: el cambio queda en auditoría sin guardar el número en claro.">
            <Input value={form.cuenta} onChange={set("cuenta")} />
          </Field>
        </div>
        <Field label="CCI" hint="Código interbancario (20 dígitos). Mismo tratamiento sensible que la cuenta.">
          <Input value={form.cci} onChange={set("cci")} />
        </Field>
        {error && <Note tone="alerta">{error}</Note>}
        <div className="flex gap-2">
          <Button type="submit" disabled={ocupado || !form.nombre.trim()}>
            {ocupado ? "Guardando…" : "Guardar cambios"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={ocupado}>Cancelar</Button>
        </div>
      </form>
    </Modal>
  );
}
