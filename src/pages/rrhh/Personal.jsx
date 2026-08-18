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
};

export default function Personal() {
  const { empresaId, db, sede, addPersonal, deletePersonal, cuentaPortal, enviarAccesoPortal } = useApp();
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
  const [cuentaResultado, setCuentaResultado] = useState(null); // { clave } | { error }

  const accionCuenta = async (accion) => {
    if (cuentaOcupado) return;
    setCuentaOcupado(true);
    setCuentaResultado(null);
    const r = await cuentaPortal(accion, cuenta.dni);
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
          (!fPortal || p.portal === fPortal) &&
          (!q || p.dni.includes(q) || p.nombre.toLowerCase().includes(q.toLowerCase()))
      ),
    [db.personal, empresaId, q, fSede, fPortal, fEstado]
  );

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
        code="RRH-02 · Maestro de personal"
        title="Personal"
        subtitle="Consulta y administra la dotación, y detecta quién no está usando el portal."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setImportar(true)}>
              <Upload size={13} /> Importar planilla
            </Button>
            <Button variant="secondary" size="sm">
              <Download size={13} /> Exportar
            </Button>
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
          <Table head={["DNI", "Trabajador", "Cargo", "Sede", "Contacto", "Ingreso", "Portal", ""]}>
            {filas.map((p) => {
              const pb = PORTAL_BADGE[p.portal] ?? PORTAL_BADGE.activo;
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
                      <Button variant="ghost" size="sm" onClick={() => { setCuenta(p); setCuentaResultado(null); }}>
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
              El trabajador entra al portal con su <b>DNI {cuenta.dni}</b> y la clave inicial <b>111111</b>
              (igual para todos: no hay medio de contacto para repartir claves). En su primer ingreso el
              portal lo obliga a crear una clave propia y declarar su celular antes de poder usar nada.
            </p>
            {cuentaResultado?.clave && (
              <div className="rounded-caja border border-borde bg-papel px-4 py-5 text-center">
                <KeyRound size={18} className="mx-auto mb-2 text-petroleo" />
                <div className="font-mono text-[26px] font-bold tracking-[0.25em] text-tinta">{cuentaResultado.clave}</div>
                <div className="mt-1 text-[11.5px] text-gris-cl">
                  Clave inicial de {cuenta.nombre}. Deberá crear la suya y declarar su celular en el primer ingreso.
                </div>
              </div>
            )}
            {cuentaResultado?.enviado && (
              <Note tone="conf">Acceso enviado por correo a <b>{cuentaResultado.enviado}</b>.</Note>
            )}
            {cuentaResultado?.error && <Note tone="alerta">{cuentaResultado.error}</Note>}
            {cuenta.correo ? (
              <Note tone="neutral">
                Tiene correo registrado (<b>{cuenta.correo}</b>): puedes enviarle su acceso por ahí en vez de
                entregarlo en mano.
              </Note>
            ) : (
              <Note tone="neutral">Sin correo registrado: la clave se entrega en mano. El correo se captura en el alta o cuando el trabajador lo declare en su primer ingreso.</Note>
            )}
            <div className="flex flex-wrap justify-end gap-2 border-t border-borde pt-4">
              <Button variant="secondary" onClick={() => setCuenta(null)}>Cerrar</Button>
              {cuenta.correo && (
                <Button variant="secondary" disabled={cuentaOcupado} onClick={async () => {
                  setCuentaOcupado(true);
                  setCuentaResultado(await enviarAccesoPortal(cuenta.dni));
                  setCuentaOcupado(false);
                }}>
                  {cuentaOcupado ? "Procesando…" : "Enviar acceso por correo"}
                </Button>
              )}
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

// RRH-04 — Alta de trabajador
function AltaTrabajador({ open, onClose, onGuardar, sedes, personal }) {
  const vacio = { dni: "", nombre: "", celular: "", correo: "", sede: "", cargo: CARGOS[0], ingreso: "", banco: "BCP", cuenta: "", cci: "" };
  const [form, setForm] = useState(vacio);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const existente = personal.find((p) => p.dni === form.dni);

  const guardar = (e) => {
    e.preventDefault();
    if (form.dni.length !== 8) return setError("El DNI debe tener 8 dígitos.");
    if (existente) return setError("Este DNI ya está registrado. Para una recontratación, abre un nuevo vínculo desde su legajo.");
    if (!form.nombre.trim()) return setError("Ingresa los nombres y apellidos.");
    if (!form.sede) return setError("Toda alta requiere sede asignada: la segmentación posterior depende de ese dato.");
    if (!form.ingreso) return setError("Ingresa la fecha de ingreso.");
    onGuardar({
      dni: form.dni,
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="DNI" required hint="Si el DNI ya existe como Persona, se agrega un vínculo sin duplicarla.">
            <Input inputMode="numeric" value={form.dni} onChange={(e) => setForm((f) => ({ ...f, dni: soloDigitos(e.target.value, 8) }))} />
          </Field>
          <Field label="Nombres y apellidos" required>
            <Input placeholder="Como figura en el DNI" value={form.nombre} onChange={set("nombre")} />
          </Field>
        </div>
        {existente && (
          <Note tone="pend">
            El DNI {form.dni} ya existe: <b>{existente.nombre}</b>. No se creará un duplicado.
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

// RRH-05 — Importar planilla
function ImportarPlanilla({ open, onClose }) {
  const { db, previsualizarImportacion, importarPlanilla } = useApp();
  const [paso, setPaso] = useState(1);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  const [rechazo, setRechazo] = useState(null); // rechazo total: string, sin botón de continuar
  const [analisis, setAnalisis] = useState(null); // {empresaId, empresaNombre, nombreArchivo, filas, errores, previa}
  const [resultado, setResultado] = useState(null);
  // Vigencia de la "sesión" del modal: cerrar (X/backdrop) no cancela una
  // operación en vuelo (previsualizar/importar), pero incrementar este ref
  // hace que su resultado, cuando llegue, se descarte en vez de reaplicar
  // paso/analisis/resultado sobre un modal ya reseteado o reabierto.
  const sesionRef = useRef(0);
  const cerrar = () => {
    sesionRef.current += 1;
    setPaso(1); setOcupado(false); setError(null); setRechazo(null); setAnalisis(null); setResultado(null);
    onClose();
  };

  const analizar = async (archivo) => {
    const sesion = sesionRef.current;
    setError(null);
    setRechazo(null);
    setOcupado(true);
    try {
      const { leerXlsx } = await import("../../lib/importar/xlsx.js");
      const { parsearPlanilla, normalizar } = await import("../../lib/importar/planilla.js");
      const filas = await leerXlsx(new Uint8Array(await archivo.arrayBuffer()));
      const r = parsearPlanilla(filas);
      // Empresa exacta primero, en TODO el catálogo (para poder distinguir
      // "no existe" de "existe pero retirada"); solo si no hay exacta se
      // busca por prefijo, y si el prefijo es ambiguo se rechaza sin elegir.
      const empresaNorm = normalizar(r.empresa);
      let emp = db.empresas.find((e) => normalizar(e.nombre) === empresaNorm);
      if (!emp) {
        const candidatas = db.empresas.filter((e) => empresaNorm.startsWith(normalizar(e.nombre)));
        if (candidatas.length > 1) {
          if (sesionRef.current === sesion) setRechazo(
            `La razón social del reporte («${r.empresa}») coincide parcialmente con ${candidatas.length} empresas del catálogo (${candidatas.map((e) => e.nombre).join(", ")}) y no se puede determinar cuál es. Importación rechazada: ninguna fila se aplica.`);
          return;
        }
        emp = candidatas[0];
      }
      if (!emp) {
        if (sesionRef.current === sesion) setRechazo(
          `La razón social del reporte («${r.empresa}») no está en el catálogo de empresas del grupo. Importación rechazada: ninguna fila se aplica.`);
        return;
      }
      if (emp.estado === "retirada") {
        if (sesionRef.current === sesion) setRechazo(`${emp.nombre} está retirada del grupo: no admite importaciones.`);
        return;
      }
      const previa = await previsualizarImportacion(emp.id, r.filas);
      if (sesionRef.current !== sesion) return; // el modal se cerró/reabrió mientras se esperaba la RPC
      setAnalisis({ empresaId: emp.id, empresaNombre: emp.nombre, nombreArchivo: archivo.name, ...r, previa });
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
      const r = await importarPlanilla(analisis.empresaId, analisis.filas);
      if (sesionRef.current !== sesion) return; // el modal se cerró/reabrió mientras se esperaba la RPC
      setResultado(r);
      setPaso(3);
    } catch (e) {
      if (sesionRef.current === sesion) setError(e.message);
    } finally {
      if (sesionRef.current === sesion) setOcupado(false);
    }
  };

  const nombresPorConfirmar = analisis?.filas.filter((f) => f.nombreTruncado).length ?? 0;

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
                {ocupado ? "Leyendo el archivo…" : "Haz clic para elegir el reporte PLATRA1 exportado a Excel (.xlsx)"}
              </div>
              <div className="mt-1 text-[12px] text-gris">La identificación es siempre por DNI, nunca por nombre ni posición de fila.</div>
            </label>
            {rechazo && <Note tone="alerta">{rechazo}</Note>}
          </>
        )}
        {paso === 2 && analisis && (
          <>
            <Note tone="neutral"><b>{analisis.nombreArchivo}</b> — {analisis.empresaNombre} · {analisis.filas.length} filas válidas</Note>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-md bg-conf-bg py-4"><div className="text-[22px] font-bold text-conf">{analisis.previa.altas.length}</div><div className="font-mono text-[10px] uppercase text-gris">Altas</div></div>
              <div className="rounded-md bg-pend-bg py-4"><div className="text-[22px] font-bold text-pend">{analisis.previa.actualizaciones.length}</div><div className="font-mono text-[10px] uppercase text-gris">A actualizar</div></div>
              <div className="rounded-md bg-papel py-4"><div className="text-[22px] font-bold text-tinta-2">{analisis.previa.sin_cambio.length}</div><div className="font-mono text-[10px] uppercase text-gris">Sin cambio</div></div>
            </div>
            {analisis.errores.length > 0 && (
              <Note tone="pend">
                {analisis.errores.length} {analisis.errores.length === 1 ? "fila" : "filas"} con error, no se importan:
                <ul className="mt-1 list-disc pl-4">
                  {analisis.errores.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </Note>
            )}
            {nombresPorConfirmar > 0 && (
              <Note tone="pend">{nombresPorConfirmar} nombres quedarán «por confirmar» (truncados a 30 caracteres en el reporte).</Note>
            )}
            {error && <Note tone="alerta">{error}</Note>}
            <div className="flex gap-2">
              <Button onClick={confirmar} disabled={ocupado}>{ocupado ? "Importando…" : "Confirmar importación"}</Button>
              <Button variant="secondary" onClick={cerrar} disabled={ocupado}>Cancelar</Button>
            </div>
          </>
        )}
        {paso === 3 && resultado && (
          <>
            <Note tone="conf">
              Importación aplicada: {resultado.altas.length} altas, {resultado.actualizaciones.length} actualizaciones,
              {" "}{resultado.sin_cambio.length} sin cambio.
              {resultado.nombres_por_confirmar > 0 && ` ${resultado.nombres_por_confirmar} nombres quedaron «por confirmar».`}
            </Note>
            <Button onClick={cerrar}>Cerrar</Button>
          </>
        )}
        {paso === 1 && error && <Note tone="alerta">{error}</Note>}
      </div>
    </Modal>
  );
}
