import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { UserPlus, Upload, Download, Trash2, Smartphone, KeyRound } from "lucide-react";
import { useApp } from "../../state";
import {
  PageHeader, Card, Table, Td, Badge, Button, Input, Select, Field, Modal, Note, EmptyState,
} from "../../components/ui";
import { CARGOS } from "../../data/mock";
import { soloDigitos } from "../../lib/campos";

const PORTAL_BADGE = {
  activo: { tone: "conf", label: "Activo" },
  nunca_ingreso: { tone: "alerta", label: "Nunca ingresó" },
  sin_celular: { tone: "pend", label: "Sin celular" },
  // Estado derivado: sin fila en cuentas_portal (v_personal."tieneCuenta").
  sin_cuenta: { tone: "alerta", label: "Sin cuenta" },
};

export default function Personal() {
  const { empresaId, db, sede, user, addPersonal, deletePersonal, cuentaPortal, cuentasPortalLote, refrescarPersonal } = useApp();
  const acceso = user?.acceso ?? { esSuperadmin: user?.esSuperadmin };
  const puedeExportar = acceso.esSuperadmin || acceso.exportarDatosPersonales;
  const [q, setQ] = useState("");
  const [fSede, setFSede] = useState("");
  const [fPortal, setFPortal] = useState("");
  const [fEstado, setFEstado] = useState("vigente");
  const [alta, setAlta] = useState(false);
  const [importar, setImportar] = useState(false);
  const [eliminar, setEliminar] = useState(null); // persona a eliminar
  const [aviso, setAviso] = useState(null);
  const [cuenta, setCuenta] = useState(null);      // persona → modal cuenta portal
  const [cuentaOcupado, setCuentaOcupado] = useState(false);
  const [cuentaResultado, setCuentaResultado] = useState(null); // { clave, enviado?, errorCorreo? } | { error }
  const [conCorreo, setConCorreo] = useState(true); // checkbox del modal individual
  const [masa, setMasa] = useState(false);          // modal masivo
  const [bajandoConsent, setBajandoConsent] = useState(false);

  // Consentimientos para firma física de TODO el personal vigente de la RS
  // activa (D.Leg. 1310 / Ley 29733): un PDF, un formato por trabajador.
  const descargarConsentimientos = async () => {
    setBajandoConsent(true);
    try {
      const { descargarPdfSesion } = await import("../../lib/descargas.js");
      const r = await descargarPdfSesion(`/api/consentimiento-pdf?empresa=${encodeURIComponent(empresaId)}`,
        `consentimientos-${empresaId}.pdf`);
      if (r.error) setAviso(`No se pudo generar el PDF de consentimientos: ${r.error}`);
    } finally {
      setBajandoConsent(false);
    }
  };

  const accionCuenta = async (accion) => {
    if (cuentaOcupado) return;
    setCuentaOcupado(true);
    setCuentaResultado(null);
    const r = await cuentaPortal(accion, cuenta.dni, { enviarCorreo: conCorreo && !!cuenta.correo });
    setCuentaOcupado(false);
    setCuentaResultado(r);
  };

  const sedesEmpresa = db.sedes.filter((s) => s.empresa === empresaId);

  const filas = useMemo(
    () =>
      db.personal.filter(
        (p) =>
          p.empresa === empresaId &&
          (!fEstado || p.estado === fEstado) &&
          (!fSede || p.sede === fSede) &&
          (!fPortal || (fPortal === "sin_cuenta" ? !p.tieneCuenta : p.portal === fPortal)) &&
          (!q || p.dni.includes(q) || p.nombre.toLowerCase().includes(q.toLowerCase()))
      ),
    [db.personal, empresaId, q, fSede, fPortal, fEstado]
  );

  // Exportación real del maestro filtrado (gated por la casilla «Exportar
  // datos personales»; sin columnas bancarias — la cuenta ni enmascarada sale).
  const exportar = () => {
    const enc = ["DNI", "Nombre", "Cargo", "Sede", "Estado", "Ingreso", "Celular", "Correo", "Portal"];
    const csv = [enc, ...filas.map((p) => [p.dni, p.nombre, p.cargo ?? "", sede(p.sede)?.nombre ?? "",
      p.estado, p.ingreso ?? "", p.celular ?? "", p.correo ?? "", p.portal ?? ""])]
      .map((f) => f.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const el = Object.assign(document.createElement("a"), { href: url, download: `planilla-${empresaId}.csv` });
    el.click();
    URL.revokeObjectURL(url);
  };

  const guardarAlta = (row) => {
    addPersonal({ ...row, empresa: empresaId });
    setAlta(false);
    setAviso(`${row.nombre} registrado en el maestro de personal. Se generó su clave provisional de acceso al portal.`);
  };

  const confirmarEliminar = () => {
    deletePersonal(eliminar.dni);
    setAviso(`${eliminar.nombre} fue eliminado del maestro de personal.`);
    setEliminar(null);
  };

  return (
    <>
      <PageHeader
        code="RRH-02 · Maestro de planilla"
        title="Planilla"
        subtitle="Consulta y administra la dotación, y detecta quién no está usando el portal."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setImportar(true)}>
              <Upload size={13} /> Importar planilla
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setMasa(true)}>
              <Smartphone size={13} /> Cuentas del portal
            </Button>
            <Button variant="secondary" size="sm" onClick={descargarConsentimientos} disabled={bajandoConsent}>
              <Download size={13} /> {bajandoConsent ? "Generando…" : "Consentimientos"}
            </Button>
            {puedeExportar && (
              <Button variant="secondary" size="sm" onClick={exportar}>
                <Download size={13} /> Exportar
              </Button>
            )}
            <Button size="sm" onClick={() => setAlta(true)}>
              <UserPlus size={13} /> Nuevo trabajador
            </Button>
          </>
        }
      />

      {aviso && <div className="mb-4"><Note tone="conf">{aviso}</Note></div>}

      <Card pad={false} className="overflow-hidden">
        <div className="flex flex-wrap gap-2.5 border-b border-borde bg-papel/50 p-3.5">
          <Input placeholder="Buscar por DNI o nombre…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 240 }} />
          <Select value={fSede} onChange={(e) => setFSede(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="">Todas las sedes</option>
            {sedesEmpresa.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </Select>
          <Select value={fPortal} onChange={(e) => setFPortal(e.target.value)} style={{ maxWidth: 190 }}>
            <option value="">Estado del portal</option>
            <option value="sin_cuenta">Sin cuenta</option>
            <option value="activo">Activo</option>
            <option value="nunca_ingreso">Nunca ingresó</option>
            <option value="sin_celular">Sin celular</option>
          </Select>
          <Select value={fEstado} onChange={(e) => setFEstado(e.target.value)} style={{ maxWidth: 160 }}>
            <option value="vigente">Vigentes</option>
            <option value="cesado">Cesados</option>
            <option value="">Todos</option>
          </Select>
        </div>

        {filas.length === 0 ? (
          <div className="p-5">
            <EmptyState title="Sin resultados" body="Ningún trabajador coincide con los filtros aplicados." />
          </div>
        ) : (
          <Table head={["Documento", "Trabajador", "Cargo", "Sede", "Contacto", "Ingreso", "Portal", ""]}>
            {filas.map((p) => {
              const pb = !p.tieneCuenta ? PORTAL_BADGE.sin_cuenta : (PORTAL_BADGE[p.portal] ?? PORTAL_BADGE.activo);
              return (
                <tr key={p.dni} className="hover:bg-papel/60">
                  <Td className="font-mono text-[12px]">{p.dni}</Td>
                  <Td>
                    <Link to={`/rrhh/personal/${p.dni}`} className="font-semibold text-petroleo hover:underline">
                      {p.nombre}
                    </Link>{" "}
                    {p.estado === "cesado" && <Badge tone="neutral">Cesado</Badge>}
                  </Td>
                  <Td className="text-gris">{p.cargo}</Td>
                  <Td className="text-gris">{sede(p.sede)?.cliente ?? "—"}</Td>
                  <Td className="font-mono text-[12px] text-gris">
                    {/* Se completan solos cuando el trabajador los declara en
                        el primer ingreso del portal. */}
                    <div>{p.celular ?? <span className="text-gris-cl">—</span>}</div>
                    {p.correo && <div className="text-[11px] text-gris-cl">{p.correo}{p.correoVerificado ? " ✓" : ""}</div>}
                  </Td>
                  <Td className="font-mono text-[12px] text-gris">{p.ingreso}</Td>
                  <Td><Badge tone={pb.tone}>{pb.label}</Badge></Td>
                  <Td>
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        to={`/rrhh/personal/${p.dni}`}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-[12px] font-semibold text-petroleo hover:bg-papel"
                      >
                        Ver detalle
                      </Link>
                      <Button variant="ghost" size="sm" onClick={() => { setCuenta(p); setCuentaResultado(null); setConCorreo(!!p.correo); }}>
                        <Smartphone size={12} /> Portal
                      </Button>
                      <button
                        onClick={() => setEliminar(p)}
                        className="rounded p-1.5 text-gris-cl transition-colors hover:bg-alerta-bg hover:text-alerta"
                        title="Eliminar trabajador"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <Modal open={!!cuenta} onClose={() => setCuenta(null)} title={`Cuenta del portal — ${cuenta?.nombre}`}>
        {cuenta && (
          <div className="space-y-4">
            <p className="text-[13px] leading-relaxed text-gris">
              El trabajador entra al portal con su <b>documento {cuenta.dni}</b>. La clave inicial es
              <b> aleatoria de 6 dígitos</b>: se muestra aquí al crearla o restablecerla (para entrega en
              mano) y, si tiene correo, se le puede enviar directamente. En su primer ingreso el portal lo
              obliga a crear una clave propia antes de poder usar nada.
            </p>
            {cuentaResultado?.clave && (
              <div className="rounded-caja border border-borde bg-papel px-4 py-5 text-center">
                <KeyRound size={18} className="mx-auto mb-2 text-petroleo" />
                <div className="font-mono text-[26px] font-bold tracking-[0.25em] text-tinta">{cuentaResultado.clave}</div>
                <div className="mt-1 text-[11.5px] text-gris-cl">
                  Clave inicial de {cuenta.nombre}. No se puede volver a consultar: anótala o descárgala ahora.
                </div>
              </div>
            )}
            {cuentaResultado?.enviado && (
              <Note tone="conf">Acceso enviado por correo a <b>{cuentaResultado.enviado}</b>.</Note>
            )}
            {cuentaResultado?.errorCorreo && (
              <Note tone="pend">La cuenta quedó lista, pero el correo falló: {cuentaResultado.errorCorreo}. Entrega la clave en mano o reintenta con Restablecer.</Note>
            )}
            {cuentaResultado?.error && <Note tone="alerta">{cuentaResultado.error}</Note>}
            {cuenta.correo ? (
              <label className="flex items-center gap-2 text-[13px] text-gris">
                <input type="checkbox" checked={conCorreo} onChange={(e) => setConCorreo(e.target.checked)} />
                Enviar el acceso a su correo (<b>{cuenta.correo}</b>)
              </label>
            ) : (
              <Note tone="neutral">Sin correo registrado: la clave se entrega en mano. El correo se captura en el alta o cuando el trabajador lo declare en su primer ingreso.</Note>
            )}
            <div className="flex flex-wrap justify-end gap-2 border-t border-borde pt-4">
              <Button variant="secondary" onClick={() => setCuenta(null)}>Cerrar</Button>
              <Button variant="secondary" disabled={cuentaOcupado} onClick={() => accionCuenta("restablecer")}>
                {cuentaOcupado ? "Procesando…" : "Restablecer clave"}
              </Button>
              <Button disabled={cuentaOcupado} onClick={() => accionCuenta("crear")}>
                {cuentaOcupado ? "Procesando…" : "Crear cuenta"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <AltaTrabajador open={alta} onClose={() => setAlta(false)} onGuardar={guardarAlta} sedes={sedesEmpresa} personal={db.personal} />
      <ImportarPlanilla open={importar} onClose={() => setImportar(false)} />
      <CuentasMasa
        open={masa} onClose={() => setMasa(false)} personal={db.personal} empresaId={empresaId}
        sedes={sedesEmpresa} cuentasPortalLote={cuentasPortalLote} refrescarPersonal={refrescarPersonal}
      />

      <Modal open={!!eliminar} onClose={() => setEliminar(null)} title="Eliminar trabajador">
        {eliminar && (
          <div className="space-y-4">
            <Note tone="alerta">
              Vas a eliminar a <b>{eliminar.nombre}</b> (DNI {eliminar.dni}) del maestro de personal. Esta acción quedará
              registrada en auditoría.
            </Note>
            <Note tone="neutral">
              Recomendación del documento de arquitectura: para un cese laboral usa el cierre del vínculo (el historial
              nunca se borra). La eliminación definitiva es solo para registros creados por error.
            </Note>
            <div className="flex gap-2">
              <Button variant="danger" onClick={confirmarEliminar}>Eliminar definitivamente</Button>
              <Button variant="secondary" onClick={() => setEliminar(null)}>Cancelar</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

// #13 — Creación masiva de cuentas del portal: toma a los vigentes SIN cuenta
// de la razón social activa, las crea por tramos de 10 (tope del endpoint:
// cada envío SMTP suma segundos) y entrega un CSV con las claves — que no se
// pueden volver a consultar — para quienes no tienen correo.
function CuentasMasa({ open, onClose, personal, empresaId, sedes, cuentasPortalLote, refrescarPersonal }) {
  const [fSede, setFSede] = useState("");
  const [enviarCorreo, setEnviarCorreo] = useState(true);
  const [paso, setPaso] = useState(1);
  const [avance, setAvance] = useState(0);
  const [total, setTotal] = useState(0);
  const [resultados, setResultados] = useState([]);
  // Cerrar no cancela un tramo en vuelo, pero su resultado tardío se descarta
  // (mismo patrón sesionRef del modal de importación).
  const sesionRef = useRef(0);

  const candidatos = useMemo(
    () => personal.filter((p) =>
      p.empresa === empresaId && p.estado === "vigente" && !p.tieneCuenta && (!fSede || p.sede === fSede)),
    [personal, empresaId, fSede]
  );
  const conCorreoN = candidatos.filter((p) => p.correo).length;
  const envios = enviarCorreo ? conCorreoN : 0;

  const cerrar = () => {
    sesionRef.current += 1;
    setPaso(1); setAvance(0); setTotal(0); setResultados([]); setFSede(""); setEnviarCorreo(true);
    onClose();
  };

  const crear = async () => {
    const sesion = sesionRef.current;
    const lista = candidatos.map((p) => p.dni);
    setTotal(lista.length); setAvance(0); setPaso(2);
    const acumulado = [];
    for (let i = 0; i < lista.length; i += 10) {
      const tramo = lista.slice(i, i + 10);
      const r = await cuentasPortalLote(tramo, enviarCorreo);
      if (sesionRef.current !== sesion) return;
      acumulado.push(...(r.resultados ?? tramo.map((d) => ({ dni: d, error: r.error ?? "Sin respuesta del servidor." }))));
      setAvance(Math.min(i + 10, lista.length));
    }
    setResultados(acumulado);
    setPaso(3);
    refrescarPersonal();
  };

  const creadas = resultados.filter((r) => r.clave);
  const enviados = resultados.filter((r) => r.enviado).length;
  const fallidas = resultados.filter((r) => r.error);
  const correosFallidos = resultados.filter((r) => r.errorCorreo).length;

  const descargarCsv = () => {
    const nombreDe = (dni) => personal.find((p) => p.dni === dni)?.nombre ?? "";
    const head = ["Documento", "Trabajador", "Clave inicial", "Correo", "Acceso enviado"];
    const rows = creadas.map((r) => [r.dni, r.nombre ?? nombreDe(r.dni), r.clave, personal.find((p) => p.dni === r.dni)?.correo ?? "", r.enviado ? "Sí" : "No"]);
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `claves-portal-${empresaId}.csv`;
    a.click();
  };

  return (
    <Modal open={open} onClose={cerrar} title="Cuentas del portal en masa" wide>
      <div className="space-y-4">
        {paso === 1 && (
          <>
            <p className="text-[13px] leading-relaxed text-gris">
              Crea de una sola vez las cuentas del portal de los trabajadores <b>vigentes sin cuenta</b> de la razón
              social activa. Usuario: su número de documento. Clave inicial: <b>aleatoria de 6 dígitos</b> — se envía
              al correo registrado y queda en un CSV descargable para entrega en mano.
            </p>
            <Select value={fSede} onChange={(e) => setFSede(e.target.value)} style={{ maxWidth: 260 }}>
              <option value="">Todas las sedes</option>
              {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </Select>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-md bg-alerta-bg py-4"><div className="text-[22px] font-bold text-alerta">{candidatos.length}</div><div className="font-mono text-[10px] uppercase text-gris">Sin cuenta</div></div>
              <div className="rounded-md bg-conf-bg py-4"><div className="text-[22px] font-bold text-conf">{conCorreoN}</div><div className="font-mono text-[10px] uppercase text-gris">Con correo</div></div>
              <div className="rounded-md bg-papel py-4"><div className="text-[22px] font-bold text-tinta-2">{candidatos.length - conCorreoN}</div><div className="font-mono text-[10px] uppercase text-gris">Solo CSV</div></div>
            </div>
            <label className="flex items-center gap-2 text-[13px] text-gris">
              <input type="checkbox" checked={enviarCorreo} onChange={(e) => setEnviarCorreo(e.target.checked)} />
              Enviar el acceso por correo a quienes lo tienen registrado ({conCorreoN})
            </label>
            {envios > 400 && (
              <Note tone="pend">
                Se enviarían {envios} correos y el tope diario de Gmail ronda los 500: corre la creación por sede
                o en varios días para no perder envíos.
              </Note>
            )}
            {candidatos.length === 0 ? (
              <Note tone="conf">Todos los vigentes {fSede ? "de esa sede " : ""}ya tienen cuenta del portal.</Note>
            ) : (
              <div className="flex gap-2">
                <Button onClick={crear}>Crear {candidatos.length} {candidatos.length === 1 ? "cuenta" : "cuentas"}</Button>
                <Button variant="secondary" onClick={cerrar}>Cancelar</Button>
              </div>
            )}
          </>
        )}
        {paso === 2 && (
          <div className="py-8 text-center">
            <div className="text-[15px] font-semibold text-tinta-2">Creando cuentas… {avance} de {total}</div>
            <div className="mx-auto mt-3 h-2 w-64 overflow-hidden rounded-full bg-papel">
              <div className="h-full rounded-full bg-petroleo transition-all" style={{ width: `${total ? Math.round((avance / total) * 100) : 0}%` }} />
            </div>
            <div className="mt-2 text-[12px] text-gris-cl">No cierres esta ventana: los envíos de correo van en el mismo paso.</div>
          </div>
        )}
        {paso === 3 && (
          <>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-md bg-conf-bg py-4"><div className="text-[22px] font-bold text-conf">{creadas.length}</div><div className="font-mono text-[10px] uppercase text-gris">Creadas</div></div>
              <div className="rounded-md bg-papel py-4"><div className="text-[22px] font-bold text-tinta-2">{enviados}</div><div className="font-mono text-[10px] uppercase text-gris">Correos enviados</div></div>
              <div className="rounded-md bg-alerta-bg py-4"><div className="text-[22px] font-bold text-alerta">{fallidas.length}</div><div className="font-mono text-[10px] uppercase text-gris">Con error</div></div>
            </div>
            {correosFallidos > 0 && (
              <Note tone="pend">{correosFallidos} {correosFallidos === 1 ? "correo falló" : "correos fallaron"}: esas cuentas quedaron creadas, entrega su clave con el CSV.</Note>
            )}
            {fallidas.length > 0 && (
              <Note tone="alerta">
                No se pudieron crear:
                <ul className="mt-1 list-disc pl-4">
                  {fallidas.map((r) => <li key={r.dni}>{r.dni}: {r.error}</li>)}
                </ul>
              </Note>
            )}
            {creadas.length > 0 && (
              <Note tone="pend">Descarga el CSV antes de cerrar: las claves no se pueden volver a consultar (solo restablecer).</Note>
            )}
            <div className="flex gap-2">
              {creadas.length > 0 && (
                <Button onClick={descargarCsv}><Download size={13} /> Descargar claves (CSV)</Button>
              )}
              <Button variant="secondary" onClick={cerrar}>Cerrar</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// RRH-04 — Alta de trabajador
// Reglas de formato por tipo de documento (espejo de fn_validar_documento).
const TIPOS_DOCUMENTO = {
  DNI: { etiqueta: "DNI", regex: /^[0-9]{8}$/, error: "El DNI debe tener 8 dígitos.", numerico: true, max: 8 },
  CE: { etiqueta: "Carné de extranjería", regex: /^[0-9A-Z]{9,12}$/, error: "El carné de extranjería tiene de 9 a 12 caracteres.", numerico: false, max: 12 },
  Pasaporte: { etiqueta: "Pasaporte", regex: /^[0-9A-Z]{6,15}$/, error: "El pasaporte tiene de 6 a 15 caracteres.", numerico: false, max: 15 },
};

export function sanearDocumento(tipo, valor) {
  const t = TIPOS_DOCUMENTO[tipo] ?? TIPOS_DOCUMENTO.DNI;
  const limpio = valor.toUpperCase().replace(t.numerico ? /[^0-9]/g : /[^0-9A-Z]/g, "");
  return limpio.slice(0, t.max);
}

function AltaTrabajador({ open, onClose, onGuardar, sedes, personal }) {
  const vacio = { tipoDocumento: "DNI", dni: "", nombre: "", celular: "", correo: "", sede: "", cargo: CARGOS[0], ingreso: "", banco: "BCP", cuenta: "", cci: "" };
  const [form, setForm] = useState(vacio);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const existente = personal.find((p) => p.dni === form.dni);
  const regla = TIPOS_DOCUMENTO[form.tipoDocumento];

  const guardar = (e) => {
    e.preventDefault();
    if (!regla.regex.test(form.dni)) return setError(regla.error);
    if (existente) return setError("Este documento ya está registrado. Para una recontratación, abre un nuevo vínculo desde su legajo.");
    if (!form.nombre.trim()) return setError("Ingresa los nombres y apellidos.");
    if (!form.sede) return setError("Toda alta requiere sede asignada: la segmentación posterior depende de ese dato.");
    if (!form.ingreso) return setError("Ingresa la fecha de ingreso.");
    onGuardar({
      dni: form.dni,
      tipoDocumento: form.tipoDocumento,
      nombre: form.nombre.trim(),
      cargo: form.cargo,
      sede: form.sede,
      ingreso: form.ingreso,
      celular: form.celular || null,
      correo: form.correo.trim().toLowerCase() || null,
      cci: form.cci.trim() || null,
      portal: form.celular ? "nunca_ingreso" : "sin_celular",
      estado: "vigente",
      banco: form.banco,
      cuenta: form.cuenta || null,
    });
    setForm(vacio);
    setError(null);
  };

  const cerrar = () => { setForm(vacio); setError(null); onClose(); };

  return (
    <Modal open={open} onClose={cerrar} title="RRH-04 · Alta de trabajador" wide>
      <form onSubmit={guardar} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Tipo de documento" required>
            <Select value={form.tipoDocumento}
              onChange={(e) => setForm((f) => ({ ...f, tipoDocumento: e.target.value, dni: sanearDocumento(e.target.value, f.dni) }))}>
              {Object.entries(TIPOS_DOCUMENTO).map(([id, t]) => <option key={id} value={id}>{t.etiqueta}</option>)}
            </Select>
          </Field>
          <Field label="Número de documento" required hint="Si ya existe como Persona, se agrega un vínculo sin duplicarla.">
            <Input inputMode={regla.numerico ? "numeric" : "text"} value={form.dni}
              placeholder={regla.numerico ? "8 dígitos" : "Letras y números"}
              onChange={(e) => setForm((f) => ({ ...f, dni: sanearDocumento(f.tipoDocumento, e.target.value) }))} />
          </Field>
          <Field label="Nombres y apellidos" required>
            <Input placeholder="Como figura en el documento" value={form.nombre} onChange={set("nombre")} />
          </Field>
        </div>
        {existente && (
          <Note tone="pend">
            El documento {form.dni} ya existe: <b>{existente.nombre}</b>. No se creará un duplicado.
          </Note>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Celular" hint="Sin celular queda marcado para acuse asistido.">
            {/* Campo LIBRE (2026-08-17): puede venir con +51 o espacios, igual
                que en los Excels de planilla. Se guarda tal cual. */}
            <Input placeholder="987 654 321 o +51 987 654 321" value={form.celular} onChange={set("celular")} />
          </Field>
          <Field label="Correo (opcional)" hint="Si lo registras, podrás enviarle su acceso al portal por correo.">
            <Input type="email" placeholder="persona@correo.com" value={form.correo} onChange={set("correo")} />
          </Field>
          <Field label="Sede" required>
            <Select value={form.sede} onChange={set("sede")}>
              <option value="">Elegir sede…</option>
              {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </Select>
          </Field>
          <Field label="Cargo" required>
            <Select value={form.cargo} onChange={set("cargo")}>
              {CARGOS.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Fecha de ingreso" required>
            <Input type="date" value={form.ingreso} onChange={set("ingreso")} />
          </Field>
          <Field label="Banco de haberes">
            <Select value={form.banco} onChange={set("banco")}>
              <option>BCP</option><option>BBVA</option><option>Interbank</option><option>Scotiabank</option>
            </Select>
          </Field>
          <Field label="N° de cuenta" hint="Dato sensible: su consulta queda en auditoría.">
            <Input value={form.cuenta} onChange={set("cuenta")} />
          </Field>
          <Field label="CCI" hint="Código interbancario (20 dígitos).">
            <Input value={form.cci} onChange={set("cci")} />
          </Field>
        </div>
        {error && <Note tone="alerta">{error}</Note>}
        <div className="flex gap-2">
          <Button type="submit">Guardar</Button>
          <Button type="button" variant="secondary" onClick={cerrar}>Cancelar</Button>
        </div>
      </form>
    </Modal>
  );
}

// RRH-05 — Importar el padrón de planilla en su formato DEFINITIVO (spec
// Tareas 31-08): 12 columnas con centro de costo y cargo, varias razones
// sociales resueltas por RUC. Es el ÚNICO formato soportado: PLATRA1 y el
// unificado con banco se retiraron (los datos bancarios ya no llegan por
// archivo: se editan en la ficha y viven cifrados).
function ImportarPlanilla({ open, onClose }) {
  const { previsualizarPadron, importarPadron } = useApp();
  const [paso, setPaso] = useState(1);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  const [rechazo, setRechazo] = useState(null); // rechazo total: string, sin botón de continuar
  const [pad, setPad] = useState(null); // {empresas, filas, errores, nombreArchivo, previa, resultado}
  const [cesesMarcados, setCesesMarcados] = useState([]); // documentos cuyo cese confirmó el usuario
  // Vigencia de la "sesión" del modal: cerrar (X/backdrop) no cancela una
  // operación en vuelo (previsualizar/importar), pero incrementar este ref
  // hace que su resultado, cuando llegue, se descarte en vez de reaplicar
  // paso/analisis/resultado sobre un modal ya reseteado o reabierto.
  const sesionRef = useRef(0);
  const cerrar = () => {
    sesionRef.current += 1;
    setPaso(1); setOcupado(false); setError(null); setRechazo(null); setPad(null); setCesesMarcados([]);
    onClose();
  };

  const analizar = async (archivo) => {
    const sesion = sesionRef.current;
    setError(null);
    setRechazo(null);
    setOcupado(true);
    try {
      const { leerXlsx } = await import("../../lib/importar/xlsx.js");
      const { parsearPadron } = await import("../../lib/importar/padron.js");
      const bytes = new Uint8Array(await archivo.arrayBuffer());
      // Un solo formato: si los 12 encabezados no calzan, se dice y se detiene.
      let parseo;
      try {
        parseo = parsearPadron(await leerXlsx(bytes));
      } catch (e) {
        if (sesionRef.current === sesion) setRechazo(e.message);
        return;
      }
      if (parseo.filas.length === 0) {
        if (sesionRef.current === sesion) setRechazo(
          `El archivo no tiene filas importables.${parseo.errores.length ? ` Errores: ${parseo.errores.slice(0, 5).map((e) => `fila ${e.fila}: ${e.error}`).join(" · ")}` : ""}`);
        return;
      }
      const previa = await previsualizarPadron(parseo.filas);
      if (sesionRef.current !== sesion) return; // el modal se cerró/reabrió mientras se esperaba la RPC
      setPad({ ...parseo, nombreArchivo: archivo.name, previa });
      setPaso(2);
    } catch (e) {
      if (sesionRef.current === sesion) setError(e.message);
    } finally {
      if (sesionRef.current === sesion) setOcupado(false);
    }
  };

  const confirmar = async () => {
    const sesion = sesionRef.current;
    setError(null);
    setOcupado(true);
    try {
      const r = await importarPadron(pad.filas, cesesMarcados);
      if (sesionRef.current !== sesion) return;
      setPad((u) => ({ ...u, resultado: r }));
      setPaso(3);
    } catch (e) {
      if (sesionRef.current === sesion) setError(e.message);
    } finally {
      if (sesionRef.current === sesion) setOcupado(false);
    }
  };

  const empresasDe = (objeto) => Object.entries(objeto?.empresas ?? {}).map(([id, e]) => ({ id, ...e }));
  const cargosCambiaron = pad?.previa
    ? empresasDe(pad.previa).flatMap((e) => (e.cargosCambiaron ?? []).map((c) => ({ ...c, empresa: e.nombre })))
    : [];
  // Resumen de la sugerencia de perfiles (spec §5): la importación propone,
  // el acceso lo otorga un superadmin desde la bandeja de ACC-01/ACC-04.
  const perfilesResumen = pad?.previa ? {
    propuestas: empresasDe(pad.previa).reduce((n, e) => n + (e.propuestas?.length ?? 0), 0),
    soloPortal: empresasDe(pad.previa).reduce((n, e) => n + (e.soloPortal?.length ?? 0), 0),
    sinSugerencia: empresasDe(pad.previa).flatMap((e) => e.sinSugerencia ?? []),
  } : null;

  return (
    <Modal open={open} onClose={cerrar} title="RRH-05 · Importar planilla" wide>
      <div className="space-y-4">
        {paso === 1 && (
          <>
            <label
              className={`block rounded-md border-2 border-dashed border-borde-f bg-papel/60 px-6 py-10 text-center hover:border-petroleo-cl ${ocupado ? "opacity-60" : "cursor-pointer"}`}
            >
              <input
                type="file"
                accept=".xlsx"
                className="hidden"
                disabled={ocupado}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) analizar(f); }}
              />
              <div className="text-[14px] font-semibold text-tinta-2">
                {ocupado ? "Leyendo el archivo…" : "Haz clic para elegir el padrón de planilla (.xlsx, 12 columnas con centro de costo)"}
              </div>
              <div className="mt-1 text-[12px] text-gris">La identificación es siempre por documento, nunca por nombre ni posición de fila.</div>
            </label>
            {rechazo && <Note tone="alerta">{rechazo}</Note>}
          </>
        )}
        {paso === 2 && pad?.previa && (
          <>
            <Note tone="neutral">
              <b>{pad.nombreArchivo}</b> · padrón de planilla · {pad.filas.length} filas válidas.
              {" "}Esta información será subida a <b>{empresasDe(pad.previa).map((e) => e.nombre).join(", ")}</b> (resolución por RUC).
            </Note>
            <div className="grid gap-3 sm:grid-cols-3">
              {empresasDe(pad.previa).map((e) => (
                <div key={e.id} className="rounded-caja border border-borde bg-papel/60 p-3.5">
                  <div className="text-[13px] font-bold text-tinta">{e.nombre}</div>
                  <div className="font-mono text-[10.5px] text-gris-cl">RUC {e.ruc}</div>
                  <div className="mt-2 space-y-0.5 text-[12px] text-gris">
                    <div>{e.altas.length} altas nuevas</div>
                    <div>{e.vinculosNuevos.length} vínculos nuevos</div>
                    <div>{e.actualizaciones.length} a actualizar · {e.sinCambio.length} sin cambio</div>
                  </div>
                </div>
              ))}
            </div>
            {cargosCambiaron.length > 0 && (
              <Note tone="pend">
                {cargosCambiaron.length === 1 ? "1 cargo cambió" : `${cargosCambiaron.length} cargos cambiaron`} respecto
                de lo registrado. Un cambio de cargo NO cambia el perfil de acceso: queda como aviso para revisarlo.
                <ul className="mt-1 list-disc pl-4">
                  {cargosCambiaron.slice(0, 12).map((c, i) => (
                    <li key={i}>{c.nombre} ({c.documento}): {c.antes ?? "sin cargo"} → {c.ahora}</li>
                  ))}
                  {cargosCambiaron.length > 12 && <li>… y {cargosCambiaron.length - 12} más.</li>}
                </ul>
              </Note>
            )}
            {empresasDe(pad.previa).flatMap((e) => (e.traslados ?? []).map((t) => ({ ...t, a: e.nombre }))).length > 0 && (
              <Note tone="pend">
                Traslados de razón social (el vínculo anterior SE CIERRA al confirmar y el movimiento queda en el legajo):
                <ul className="mt-1 list-disc pl-4">
                  {empresasDe(pad.previa).flatMap((e) => (e.traslados ?? []).map((t) => ({ ...t, a: e.nombre }))).map((t, i) => (
                    <li key={i}>{t.nombre} ({t.documento}): {t.desde} → {t.a}</li>
                  ))}
                </ul>
              </Note>
            )}
            {empresasDe(pad.previa).flatMap((e) => e.retornos ?? []).length > 0 && (
              <Note tone="neutral">
                Retornos al grupo (se les abre vínculo nuevo y queda en su historial):{" "}
                {empresasDe(pad.previa).flatMap((e) => (e.retornos ?? []).map((d) => `${d} (${e.nombre})`)).join(" · ")}
              </Note>
            )}
            {(pad.previa.posiblesCeses ?? []).length > 0 && (
              <Note tone="pend">
                {(pad.previa.posiblesCeses ?? []).length === 1
                  ? "1 trabajador vigente no viene en este padrón."
                  : `${pad.previa.posiblesCeses.length} trabajadores vigentes no vienen en este padrón.`}{" "}
                Marca SOLO a quienes ya no trabajan: su vínculo se cierra y el cese queda en su historial.
                Los que dejes sin marcar siguen igual — nadie cesa por ausencia.
                <ul className="mt-2 space-y-1">
                  {pad.previa.posiblesCeses.map((c) => (
                    <li key={c.documento}>
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={cesesMarcados.includes(c.documento)}
                          onChange={(ev) => setCesesMarcados((m) => ev.target.checked
                            ? [...m, c.documento] : m.filter((d) => d !== c.documento))}
                        />
                        <span>{c.nombre} ({c.documento}) — {c.empresaNombre}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </Note>
            )}
            {(pad.errores.length > 0 || (pad.previa.problemas ?? []).length > 0) && (
              <Note tone="alerta">
                Filas que NO se importan (corrígelas a mano):
                <ul className="mt-1 list-disc pl-4">
                  {pad.errores.map((e, i) => <li key={`e${i}`}>Fila {e.fila}: {e.error}</li>)}
                  {(pad.previa.problemas ?? []).map((p, i) => <li key={`p${i}`}>{p.nombre} ({p.documento}): {p.motivo}</li>)}
                </ul>
              </Note>
            )}
            {perfilesResumen && (
              <Note tone="neutral">
                <b>Perfiles de acceso:</b> {perfilesResumen.propuestas} propuestas por cargo,
                {" "}{perfilesResumen.soloPortal} solo Portal y {perfilesResumen.sinSugerencia.length} sin sugerencia.
                Ningún acceso al BackOffice se otorga por esta importación: las propuestas quedan en la bandeja de
                Accesos y Roles y las decide un superadministrador.
                {perfilesResumen.sinSugerencia.length > 0 && (
                  <ul className="mt-1 list-disc pl-4">
                    {perfilesResumen.sinSugerencia.map((s, i) => (
                      <li key={i}>{s.nombre} ({s.documento}): cargo «{s.cargo}» sin correspondencia.</li>
                    ))}
                  </ul>
                )}
              </Note>
            )}
            <Note tone="neutral">
              Este padrón no trae banco, cuenta, sede ni contrato: lo ya registrado en esos campos queda intacto.
            </Note>
            {error && <Note tone="alerta">{error}</Note>}
            <div className="flex gap-2">
              <Button onClick={confirmar} disabled={ocupado}>
                {ocupado ? "Importando…" : `Sí, subir a ${empresasDe(pad.previa).length === 1 ? "esa razón social" : `las ${empresasDe(pad.previa).length} razones sociales`}${cesesMarcados.length ? ` y cesar a ${cesesMarcados.length}` : ""}`}
              </Button>
              <Button variant="secondary" onClick={cerrar} disabled={ocupado}>Cancelar</Button>
            </div>
          </>
        )}
        {paso === 3 && pad?.resultado && (
          <>
            <Note tone="conf">
              Padrón aplicado:
              {" "}{empresasDe(pad.resultado).map((e) =>
                `${e.nombre} (${e.altas.length} altas, ${e.vinculosNuevos.length} vínculos nuevos, ${e.actualizaciones.length} actualizadas${(e.traslados ?? []).length ? `, ${e.traslados.length} traslados` : ""}${(e.retornos ?? []).length ? `, ${e.retornos.length} retornos` : ""}${(e.cesados ?? []).length ? `, ${e.cesados.length} ceses` : ""})`).join(" · ")}.
            </Note>
            {(pad.resultado.problemas ?? []).length > 0 && (
              <Note tone="pend">
                {(pad.resultado.problemas ?? []).length} filas quedaron para resolver a mano (documento ambiguo).
              </Note>
            )}
            <Button onClick={cerrar}>Cerrar</Button>
          </>
        )}
        {paso === 1 && error && <Note tone="alerta">{error}</Note>}
      </div>
    </Modal>
  );
}
