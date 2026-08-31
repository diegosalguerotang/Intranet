import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Download, Pencil } from "lucide-react";
import { PageHeader, Card, Badge, Button, Table, Td, EmptyState, Note, Modal, Field, Input, Select } from "../../components/ui";
import { useApp } from "../../state";
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
  const { db, persona, sede, empresaPor, user, editarTrabajador, verCuentaBancaria,
    fijarHoraEntrada, historialVinculos, historialMovimientos, actividadPersona } = useApp();
  const [editarHora, setEditarHora] = useState(false);
  // Actividad real (auditoría filtrada por persona), cargada al entrar a la pestaña.
  const [actividad, setActividad] = useState(null);
  useEffect(() => {
    if (tab !== 5 || actividad) return;
    actividadPersona(dni).then(setActividad).catch(() => setActividad([]));
  }, [tab, dni, actividad]); // eslint-disable-line react-hooks/exhaustive-deps
  const [bajandoLegajo, setBajandoLegajo] = useState(false);
  const [bajandoConsent, setBajandoConsent] = useState(false);
  const [cuentaCompleta, setCuentaCompleta] = useState(null);
  // Historial de la pestaña Vínculos: todos los vínculos + movimientos de
  // planilla (alta/traslado/cese/retorno). Se carga al entrar a la pestaña.
  const [historial, setHistorial] = useState(null); // {vinculos, movimientos}
  useEffect(() => {
    if (tab !== 1 || historial) return;
    Promise.all([historialVinculos(dni), historialMovimientos(dni)])
      .then(([vinculos, movimientos]) => setHistorial({ vinculos, movimientos }))
      .catch(() => setHistorial({ vinculos: [], movimientos: [] }));
  }, [tab, dni, historial]); // eslint-disable-line react-hooks/exhaustive-deps
  const p = persona(dni);
  // Editar exige nivel de ACCIÓN en Personal (el RPC lo vuelve a validar).
  const puedeEditar = nivelDe(user?.acceso ?? (user ? { esSuperadmin: user.esSuperadmin } : null), "personal") >= 2;
  // La cuenta completa vive cifrada: solo con la casilla «Ver datos
  // bancarios» (o superadmin); la BD registra cada consulta en auditoría.
  const puedeVerCuenta = Boolean(user?.acceso?.verDatosBancarios || user?.acceso?.esSuperadmin || user?.esSuperadmin);

  if (!p) {
    return <EmptyState title="Trabajador no encontrado" body={`No existe un registro con DNI ${dni}.`} />;
  }

  const s = sede(p.sede);
  const e = empresaPor(p.empresa);
  const acuses = db.acuses.filter((a) => a.dni === dni);
  const memos = db.memorandums.filter((m) => m.dni === dni);
  const activos = db.activos.filter((a) => a.asignado === dni);
  const epp = db.epp_entregas.filter((x) => x.dni === dni);
  const antiguedad = new Date().getFullYear() - new Date(p.ingreso).getFullYear();

  // PDF resumen de UNA página con lo que el legajo sabe — JAMÁS datos
  // bancarios (esos exigen la casilla y quedan auditados por consulta).
  const descargarLegajo = async () => {
    setBajandoLegajo(true);
    try {
      const { generarConstanciaPdf } = await import("../../lib/constancia.js");
      const [vincs, movs] = historial
        ? [historial.vinculos, historial.movimientos]
        : await Promise.all([historialVinculos(dni), historialMovimientos(dni)]).catch(() => [[], []]);
      const conAcuse = acuses.filter((a) => a.estado === "confirmado" || a.estado === "asistido").length;
      const campos = [
        ["Trabajador", `${p.nombre} — ${p.tipo_documento === "CE" ? "C.E." : p.tipo_documento === "Pasaporte" ? "Pasaporte" : "DNI"} ${p.dni}`],
        ["Empresa · Sede · Cargo", `${e?.nombre ?? "—"} · ${s?.nombre ?? "—"} · ${p.cargo ?? "—"}`],
        ["Ingreso / Estado", `${p.ingreso ?? "—"} · ${p.estado === "vigente" ? "Vigente" : "Cesado"}`],
        ["Contacto", `${p.celular ?? "sin celular"} · ${p.correo ?? "sin correo"}`],
        ["Vínculos en el grupo", (vincs?.length ? vincs : [null]).map((v) =>
          v ? `${v.empresaNombre} (${v.inicio} → ${v.fin ?? "vigente"})` : `${e?.nombre ?? "—"} (${p.ingreso ?? "—"} → vigente)`
        ).join("  ·  ")],
        ["Movimientos de planilla", (movs ?? []).length
          ? movs.slice(0, 8).map((m) => `${m.fecha} ${m.tipo}${m.tipo === "traslado" ? ` ${m.deEmpresa} → ${m.aEmpresa}` : ""}`).join("  ·  ")
          : "Sin movimientos registrados"],
        ["Documentos publicados", `${acuses.length} — con acuse de recepción: ${conAcuse}`],
        ["Procesos disciplinarios", String(memos.length)],
        ["Activos a cargo", String(activos.length)],
      ];
      const bytes = await generarConstanciaPdf({
        titulo: "LEGAJO DEL TRABAJADOR — RESUMEN",
        subtitulo: "Generado desde el maestro y los registros de la Intranet GrupoER",
        numero: p.dni, campos,
      });
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const el = Object.assign(document.createElement("a"), { href: url, download: `legajo-${p.dni}.pdf` });
      document.body.appendChild(el);
      el.click();
      el.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } finally {
      setBajandoLegajo(false);
    }
  };

  // Formato de consentimiento para firma física (D.Leg. 1310 / Ley 29733):
  // respalda en papel al personal contratado antes del consentimiento digital.
  const descargarConsentimiento = async () => {
    setBajandoConsent(true);
    try {
      const { descargarPdfSesion } = await import("../../lib/descargas.js");
      const r = await descargarPdfSesion(`/api/consentimiento-pdf?dni=${encodeURIComponent(dni)}`,
        `consentimiento-${dni}.pdf`);
      if (r.error) setAviso(`No se pudo generar el consentimiento: ${r.error}`);
    } finally {
      setBajandoConsent(false);
    }
  };

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
            <Button variant="secondary" size="sm" onClick={descargarLegajo} disabled={bajandoLegajo}>
              <Download size={13} /> {bajandoLegajo ? "Generando…" : "Descargar legajo"}
            </Button>
            <Button variant="secondary" size="sm" onClick={descargarConsentimiento} disabled={bajandoConsent}>
              <Download size={13} /> {bajandoConsent ? "Generando…" : "Consentimiento"}
            </Button>
            <Link to={`/rrhh/acuses/${dni}`}>
              <Button variant="secondary" size="sm"><Download size={13} /> Constancias</Button>
            </Link>
          </>
        }
      />

      {aviso && <div className="mb-4"><Note tone="conf">{aviso}</Note></div>}

      <div className="mb-5 flex flex-wrap gap-4">
        {[
          [p.tipo_documento === "CE" ? "Carné de extranjería" : p.tipo_documento === "Pasaporte" ? "Pasaporte" : "DNI", p.dni],
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
              [p.tipo_documento === "CE" ? "Carné de extranjería" : p.tipo_documento === "Pasaporte" ? "Pasaporte" : "DNI", p.dni],
              ["Celular", p.celular ?? "Sin registrar"],
              ["Correo", p.correo ? `${p.correo}${p.correoVerificado ? " ✓ verificado" : " (sin verificar)"}` : "Sin registrar"],
              ["Banco de haberes", p.banco ?? "Sin registrar"],
              ["N° de cuenta", cuentaCompleta?.cuenta ?? p.cuenta ?? "Sin registrar"],
              ["CCI", p.cci ?? "Sin registrar"],
              ["Estado del portal", { activo: "Activo", nunca_ingreso: "Nunca ingresó", sin_celular: "Sin celular" }[p.portal]],
              ["Sexo", p.sexo === "M" ? "Masculino" : p.sexo === "F" ? "Femenino" : "Sin registrar"],
              ["Centro de costo", p.centroCosto ?? "Sin asignar"],
              ["Hora de entrada", p.horaEntrada ?? "Pendiente de configurar"],
            ].map(([k, v]) => (
              <div key={k}>
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-gris">{k}</div>
                <div className="mt-1 text-[13.5px] text-tinta">{v}</div>
              </div>
            ))}
          </div>
          {(puedeEditar || (p.cuenta && puedeVerCuenta && !cuentaCompleta?.cuenta)) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {p.cuenta && puedeVerCuenta && !cuentaCompleta?.cuenta && (
                <Button variant="secondary" size="sm" onClick={async () => setCuentaCompleta(await verCuentaBancaria(p.dni))}>
                  Ver cuenta completa
                </Button>
              )}
              {puedeEditar && (
                <Button variant="secondary" size="sm" onClick={() => setEditarHora(true)}>
                  <Pencil size={13} /> {p.horaEntrada ? "Cambiar hora de entrada" : "Fijar hora de entrada"}
                </Button>
              )}
            </div>
          )}
          {cuentaCompleta?.error && <div className="mt-3"><Note tone="alerta">{cuentaCompleta.error}</Note></div>}
          {cuentaCompleta?.sinPermiso && <div className="mt-3"><Note tone="alerta">Tu categoría no permite ver la cuenta completa.</Note></div>}
          <Note tone="neutral">
            La cuenta de haberes vive cifrada y sale enmascarada; verla completa queda registrado en auditoría (Ley 29733).
          </Note>
        </Card>
      )}

      {tab === 1 && (
        <div className="space-y-4">
          <Card pad={false}>
            <Table head={["Empresa", "Sede", "Cargo", "Inicio", "Fin", "Estado"]}>
              {(historial?.vinculos?.length
                ? historial.vinculos
                : [{ id: 0, empresaNombre: e?.nombre, sedeNombre: s?.nombre, cargo: p.cargo,
                     inicio: p.ingreso, fin: p.cese ?? null, vigente: p.estado === "vigente" }]
              ).map((v) => (
                <tr key={v.id}>
                  <Td className="font-semibold">{v.empresaNombre}</Td>
                  <Td>{v.sedeNombre}</Td>
                  <Td>{v.cargo}</Td>
                  <Td className="font-mono text-[12px]">{v.inicio}</Td>
                  <Td className="font-mono text-[12px]">{v.fin ?? "—"}</Td>
                  <Td><Badge tone={v.vigente ? "conf" : "neutral"}>{v.vigente ? "Vigente" : "Cerrado"}</Badge></Td>
                </tr>
              ))}
            </Table>
            <div className="border-t border-borde p-4">
              <Note tone="neutral">
                El legajo es por Persona, no por vínculo: si trabajó en otra empresa del grupo, ambas historias aparecen aquí.
              </Note>
            </div>
          </Card>
          <Card pad={false}>
            <div className="border-b border-borde px-5 py-3.5 text-[13px] font-bold text-tinta">Historial de movimientos</div>
            {(historial?.movimientos ?? []).length === 0 ? (
              <div className="p-5">
                <EmptyState title="Sin movimientos registrados" body="Los movimientos (altas, traslados, ceses y retornos) los generan las importaciones de planilla." />
              </div>
            ) : (
              <Table head={["Fecha", "Movimiento", "Detalle", "Período", "Registrado por"]}>
                {historial.movimientos.map((m) => (
                  <tr key={m.id}>
                    <Td className="font-mono text-[12px]">{m.fecha}</Td>
                    <Td>
                      <Badge tone={{ alta: "conf", traslado: "pend", cese: "neutral", retorno: "tinta" }[m.tipo] ?? "neutral"}>
                        {{ alta: "Alta", traslado: "Traslado", cese: "Cese", retorno: "Retorno" }[m.tipo] ?? m.tipo}
                      </Badge>
                    </Td>
                    <Td>{m.tipo === "traslado" ? `${m.deEmpresa} → ${m.aEmpresa}` : (m.aEmpresa ?? m.deEmpresa ?? "—")}</Td>
                    <Td className="font-mono text-[12px]">{m.periodo ?? "—"}</Td>
                    <Td className="text-[12px] text-gris">{m.por}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      )}

      {tab === 2 && (
        <Card pad={false}>
          {acuses.length === 0 ? (
            <div className="p-5"><EmptyState title="Sin documentos" body="Este trabajador aún no tiene documentos publicados." /></div>
          ) : (
            <Table head={["Documento", "Lote", "Estado", "Fecha de acuse", ""]}>
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

      {editarHora && (
        <EditarHoraEntrada
          persona={p}
          onClose={() => setEditarHora(false)}
          fijarHoraEntrada={fijarHoraEntrada}
          onListo={() => { setEditarHora(false); setAviso("Hora de entrada registrada. El cambio quedó en auditoría."); }}
        />
      )}

      {tab === 5 && (
        <Card pad={false}>
          {actividad === null ? (
            <div className="p-5 text-[13px] text-gris-cl">Cargando actividad…</div>
          ) : actividad.length === 0 ? (
            <div className="p-5">
              <EmptyState title="Sin actividad registrada" body="Aquí aparece lo que la auditoría sabe de esta persona: importaciones, ediciones, acuses, consultas de cuenta." />
            </div>
          ) : (
            <>
              <Table head={["Fecha", "Acción", "Entidad"]}>
                {actividad.map((a) => (
                  <tr key={a.id}>
                    <Td className="font-mono text-[12px]">{a.fecha}</Td>
                    <Td className="font-semibold">{a.accion}</Td>
                    <Td className="text-gris">{a.tabla}</Td>
                  </tr>
                ))}
              </Table>
              <div className="border-t border-borde p-4">
                <Note tone="neutral">
                  Registro inmutable de auditoría filtrado por esta persona (últimos 100). El detalle completo no se
                  muestra: puede contener datos sensibles.
                </Note>
              </div>
            </>
          )}
        </Card>
      )}
    </>
  );
}

// Hora de entrada VERSIONADA (spec Tareas 31-08): una sola hora por persona,
// con fecha de vigencia para que el recálculo de un mes pasado use la que
// regía entonces. Sin hora no hay tardanza; jamás se supone una por defecto.
function EditarHoraEntrada({ persona: p, onClose, fijarHoraEntrada, onListo }) {
  const [hora, setHora] = useState(p.horaEntrada ?? "");
  const [desde, setDesde] = useState(new Date().toISOString().slice(0, 10));
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);

  const guardar = async (e) => {
    e.preventDefault();
    if (ocupado) return;
    setError(null);
    setOcupado(true);
    try {
      await fijarHoraEntrada(p.dni, hora, desde);
      onListo();
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Hora de entrada — ${p.nombre}`}>
      <form onSubmit={guardar} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Hora de entrada" required hint="La tardanza se calcula contra esta hora.">
            <Input type="time" value={hora} onChange={(e) => setHora(e.target.value)} required />
          </Field>
          <Field label="Vigente desde" required hint="Un recálculo de un mes pasado usa la hora que regía entonces.">
            <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} required />
          </Field>
        </div>
        <Note tone="neutral">
          {p.horaEntrada
            ? `Hora vigente hoy: ${p.horaEntrada}. Registrar una nueva vigencia no borra el historial.`
            : "Sin hora de entrada el trabajador no genera tardanzas y figura como pendiente de configurar."}
        </Note>
        {error && <Note tone="alerta">{error}</Note>}
        <div className="flex gap-2">
          <Button type="submit" disabled={ocupado || !hora || !desde}>
            {ocupado ? "Guardando…" : "Guardar"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={ocupado}>Cancelar</Button>
        </div>
      </form>
    </Modal>
  );
}

// Edición de datos personales: lo escrito manda (vaciar sí borra), el nombre
// no puede quedar vacío (corregirlo limpia «por confirmar») y cambiar el
// correo lo deja pendiente de verificación. El RPC valida el nivel de nuevo.
function EditarDatos({ persona: p, onClose, editarTrabajador, onListo }) {
  const [form, setForm] = useState({
    nombre: p.nombre ?? "", celular: p.celular ?? "", correo: p.correo ?? "",
    // La cuenta llega ENMASCARADA (vive cifrada): el campo arranca vacío y
    // vacío significa «conservar la actual» (el RPC lo maneja así).
    banco: p.banco ?? "", cuenta: "", cci: p.cci ?? "",
    tipoDocumento: p.tipo_documento ?? "DNI",
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombres y apellidos" required hint="Corregirlo quita la marca «por confirmar» de la importación.">
            <Input value={form.nombre} onChange={set("nombre")} required />
          </Field>
          <Field label="Tipo de documento" hint={`El número (${p.dni}) es la identidad y no se edita aquí.`}>
            <Select value={form.tipoDocumento} onChange={set("tipoDocumento")}>
              <option value="DNI">DNI</option>
              <option value="CE">Carné de extranjería</option>
              <option value="Pasaporte">Pasaporte</option>
            </Select>
          </Field>
        </div>
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
          <Field label="N° de cuenta" hint="Vacío conserva la actual; escribe «-» para borrarla. Se guarda cifrada y el cambio queda en auditoría.">
            <Input value={form.cuenta} onChange={set("cuenta")} placeholder={p.cuenta ? `Actual: ${p.cuenta}` : "Sin cuenta registrada"} />
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
