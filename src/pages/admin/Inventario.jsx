import { useEffect, useMemo, useState } from "react";
import { PackagePlus, Upload, Download, Eye, EyeOff } from "lucide-react";
import { useApp } from "../../state";
import {
  PageHeader, Card, Stat, Table, Td, Badge, Button, Input, Select, Field, Modal, Note,
} from "../../components/ui";
import ImportarInventario from "./ImportarInventario";

const ESTADOS = {
  disponible: { tone: "conf", label: "Disponible" },
  asignado: { tone: "tinta", label: "Asignado" },
  mantenimiento: { tone: "pend", label: "En mantenimiento" },
  baja: { tone: "neutral", label: "De baja" },
};

// ADQ-01 — Inventario de activos
export default function Inventario() {
  const { empresaId, db, persona, asignarActivo, devolverActivo, editarActivo,
    guardarClaveEquipo, verClaveEquipo, user } = useApp();
  const [q, setQ] = useState("");
  const [fCat, setFCat] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [alta, setAlta] = useState(false);
  const [importar, setImportar] = useState(false);
  const [editar, setEditar] = useState(null); // activo a editar
  const [asignar, setAsignar] = useState(null); // activo a asignar
  const [devolver, setDevolver] = useState(null); // activo a devolver
  const [aviso, setAviso] = useState(null);
  const activos = db.activos;
  const esSuperadmin = user?.acceso?.esSuperadmin ?? user?.esSuperadmin ?? false;

  const tipos = useMemo(
    () => [...new Set(activos.filter((a) => a.empresa === empresaId).map((a) => a.tipo).filter(Boolean))].sort(),
    [activos, empresaId]
  );

  const filas = useMemo(
    () =>
      activos.filter(
        (a) =>
          a.empresa === empresaId &&
          (!fCat || a.categoria === fCat) &&
          (!fTipo || a.tipo === fTipo) &&
          (!fEstado || a.estado === fEstado) &&
          (!q ||
            a.codigo.toLowerCase().includes(q.toLowerCase()) ||
            (a.serie ?? "").toLowerCase().includes(q.toLowerCase()) ||
            (a.marca ?? "").toLowerCase().includes(q.toLowerCase()) ||
            (a.modelo ?? "").toLowerCase().includes(q.toLowerCase()) ||
            (a.ip ?? "").includes(q) ||
            (a.imei ?? "").includes(q))
      ),
    [activos, empresaId, q, fCat, fTipo, fEstado]
  );

  // Exportar lo filtrado a CSV (sin valor ni clave de equipo).
  const exportar = () => {
    const enc = ["Tipo", "Código", "Marca", "Modelo", "Serie", "IMEI", "IP", "Asignado", "Estado"];
    const csv = [enc, ...filas.map((a) => [a.tipo ?? a.categoria, a.codigo, a.marca ?? "", a.modelo ?? "",
      a.serie ?? "", a.imei ?? "", a.ip ?? "",
      persona(a.asignado)?.nombre ?? a.asignado_sin_confirmar ?? "", a.estado])]
      .map((f) => f.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const el = Object.assign(document.createElement("a"), { href: url, download: `activos-${empresaId}.csv` });
    el.click();
    URL.revokeObjectURL(url);
  };

  const totales = {
    total: filas.length,
    asignados: filas.filter((a) => a.estado === "asignado").length,
    disponibles: filas.filter((a) => a.estado === "disponible").length,
    mantenimiento: filas.filter((a) => a.estado === "mantenimiento").length,
  };

  const ejecutarAsignacion = (codigo, dni, antivirus, comentario) => {
    const p = persona(dni);
    asignarActivo(codigo, dni, p?.sede ?? null, antivirus, comentario || null);
    setAsignar(null);
    setAviso(`Activo ${codigo} asignado a ${p?.nombre}. El cargo digital entró al motor de acuses y aparecerá en su portal como pendiente de confirmar.`);
  };

  const ejecutarDevolucion = (codigo, destino) => {
    const actual = activos.find((a) => a.codigo === codigo);
    devolverActivo(codigo, destino, destino === "mantenimiento" ? actual?.sede ?? null : null);
    setDevolver(null);
    setAviso(`Devolución de ${codigo} registrada. El activo quedó ${destino === "mantenimiento" ? "en mantenimiento" : destino === "baja" ? "de baja" : "disponible"} y el cargo del trabajador se cerró.`);
  };

  return (
    <>
      <PageHeader
        code="ADQ-01 · Inventario de activos"
        title="Inventario"
        subtitle="El estado de un activo y su asignación son cosas distintas: un activo puede estar operativo y sin asignar."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={exportar}>
              <Download size={13} /> Exportar
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setImportar(true)}>
              <Upload size={13} /> Importar inventario
            </Button>
            <Button size="sm" onClick={() => setAlta(true)}><PackagePlus size={13} /> Nuevo activo</Button>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap gap-4">
        <Stat label="Total de activos" value={totales.total} />
        <Stat label="Asignados" value={totales.asignados} />
        <Stat label="Disponibles" value={totales.disponibles} tone="conf" />
        <Stat label="En mantenimiento" value={totales.mantenimiento} tone="pend" />
      </div>

      {aviso && <div className="mb-4"><Note tone="conf">{aviso}</Note></div>}

      <Card pad={false}>
        <div className="flex flex-wrap gap-2.5 border-b border-borde bg-papel/50 p-3.5">
          <Input placeholder="Buscar por código, modelo, serie o IP…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 250 }} />
          <Select value={fCat} onChange={(e) => setFCat(e.target.value)} style={{ maxWidth: 190 }}>
            <option value="">Todas las categorías</option>
            <option>Cómputo</option>
            <option>Comunicaciones</option>
            <option>Maquinaria</option>
          </Select>
          <Select value={fTipo} onChange={(e) => setFTipo(e.target.value)} style={{ maxWidth: 170 }}>
            <option value="">Todos los tipos</option>
            {tipos.map((t) => <option key={t}>{t}</option>)}
          </Select>
          <Select value={fEstado} onChange={(e) => setFEstado(e.target.value)} style={{ maxWidth: 190 }}>
            <option value="">Todos los estados</option>
            <option value="disponible">Disponible</option>
            <option value="asignado">Asignado</option>
            <option value="mantenimiento">En mantenimiento</option>
          </Select>
        </div>
        <Table head={["Tipo", "Código interno", "Marca y modelo", "Serie / IMEI", "IP", "Asignado a", "Estado", ""]}>
          {filas.map((a) => {
            const est = ESTADOS[a.estado];
            return (
              <tr key={a.codigo} className="hover:bg-papel/60">
                <Td className="text-gris">{a.tipo ?? a.categoria}</Td>
                <Td className="font-mono text-[12px] font-semibold">
                  {a.codigo}
                  {a.por_corregir && (
                    // Código repetido en el inventario importado: identidad
                    // pendiente de corrección (se limpia reimportando el
                    // archivo ya corregido).
                    <span className="ml-1.5"><Badge tone="pend">Falta corregir</Badge></span>
                  )}
                </Td>
                <Td className="font-semibold">{a.marca} {a.modelo}</Td>
                <Td className="font-mono text-[11.5px] text-gris">{a.serie}{a.imei ? ` · ${a.imei}` : ""}</Td>
                <Td className="font-mono text-[11.5px]">{a.ip ?? <span className="text-gris-cl">—</span>}</Td>
                <Td>
                  {a.asignado ? (
                    <>
                      {persona(a.asignado)?.nombre}
                      {a.antivirus === true && <span className="ml-1.5"><Badge tone="conf">AV</Badge></span>}
                      {a.comentario_asignacion && (
                        <div className="text-[11px] text-gris">{a.comentario_asignacion}</div>
                      )}
                    </>
                  ) : a.asignado_sin_confirmar ? (
                    // Texto importado del inventario: NO es un vínculo al
                    // maestro; la vinculación real se hace con "Asignar".
                    <span className="text-gris">{a.asignado_sin_confirmar} <span className="font-mono text-[10px] uppercase text-pend">sin confirmar</span></span>
                  ) : (
                    <span className="text-gris-cl">—</span>
                  )}
                </Td>
                <Td><Badge tone={est.tone}>{est.label}</Badge></Td>
                <Td>
                  <Button variant="ghost" size="sm" onClick={() => setEditar(a)}>Editar</Button>
                  {a.estado === "disponible" && (
                    <Button variant="ghost" size="sm" onClick={() => setAsignar(a)}>Asignar</Button>
                  )}
                  {a.estado === "asignado" && (
                    <Button variant="ghost" size="sm" onClick={() => setDevolver(a)}>Devolución</Button>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <AltaActivo open={alta} onClose={() => setAlta(false)} />
      <EditarActivo activo={editar} onClose={() => setEditar(null)} editarActivo={editarActivo} onListo={setAviso}
        esSuperadmin={esSuperadmin} guardarClaveEquipo={guardarClaveEquipo} verClaveEquipo={verClaveEquipo} />
      <ImportarInventario open={importar} onClose={() => setImportar(false)} />
      <AsignarActivo activo={asignar} onClose={() => setAsignar(null)} onAsignar={ejecutarAsignacion} />
      <DevolucionActivo activo={devolver} onClose={() => setDevolver(null)} onDevolver={ejecutarDevolucion} />
    </>
  );
}

// Edición manual de un activo: corregir el código (caso «falta corregir» de la
// importación) y los datos del equipo. Renombrar el código arrastra el
// historial de asignaciones y las líneas, y quita la marca de repetido.
function EditarActivo({ activo, onClose, editarActivo, onListo, esSuperadmin, guardarClaveEquipo, verClaveEquipo }) {
  const [form, setForm] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  const [clave, setClave] = useState("");       // valor nuevo escrito (solo superadmin)
  const [claveTocada, setClaveTocada] = useState(false);
  const [claveVisible, setClaveVisible] = useState(false);
  const [claveActual, setClaveActual] = useState(null); // resultado de "Ver clave actual"
  useEffect(() => {
    if (!activo) { setForm(null); setError(null); return; }
    setForm({
      codigo: activo.codigo, tipo: activo.tipo ?? "", marca: activo.marca ?? "",
      modelo: activo.modelo ?? "", serie: activo.serie ?? "", area: activo.area ?? "",
      ip: activo.ip ?? "",
      asignadoSinConfirmar: activo.asignado_sin_confirmar ?? "",
      observaciones: activo.observaciones ?? "",
    });
    setClave(""); setClaveTocada(false); setClaveVisible(false); setClaveActual(null);
  }, [activo]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const verActual = async () => {
    setError(null);
    try {
      const v = await verClaveEquipo(activo.codigo);
      setClaveActual(v ?? "(sin clave registrada)");
    } catch (err) {
      setError(err.message);
    }
  };

  const guardar = async (e) => {
    e.preventDefault();
    if (ocupado) return;
    setError(null);
    setOcupado(true);
    try {
      await editarActivo(activo.codigo, form);
      if (esSuperadmin && claveTocada) await guardarClaveEquipo(form.codigo, clave);
      onListo(
        form.codigo !== activo.codigo
          ? `Activo ${activo.codigo} corregido: ahora es ${form.codigo}. Su historial de asignaciones lo siguió.`
          : `Activo ${activo.codigo} actualizado.`
      );
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Modal open={!!activo} onClose={onClose} title={`Editar activo ${activo?.codigo ?? ""}`} wide>
      {form && (
        <form onSubmit={guardar} className="space-y-4">
          {activo.por_corregir && (
            <Note tone="pend">
              Este activo quedó marcado <b>«repetido — falta corregir»</b> en la importación: al guardarlo
              con un código nuevo la marca se quita sola.
            </Note>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Código" required hint="La identidad del activo: renombrarlo arrastra su historial.">
              <Input value={form.codigo} onChange={set("codigo")} required />
            </Field>
            <Field label="Tipo">
              <Input value={form.tipo} onChange={set("tipo")} placeholder="LAPTOP, PC, IMPRESORA…" />
            </Field>
            <Field label="Área">
              <Input value={form.area} onChange={set("area")} placeholder="RRHH, LOGISTICA…" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Marca">
              <Input value={form.marca} onChange={set("marca")} />
            </Field>
            <Field label="Modelo">
              <Input value={form.modelo} onChange={set("modelo")} />
            </Field>
            <Field label="Número de serie">
              <Input value={form.serie} onChange={set("serie")} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="IP" hint="Dirección en la red interna.">
              <Input value={form.ip} onChange={set("ip")} placeholder="192.168.1.100" />
            </Field>
          </div>
          <Field label="Asignado a (sin confirmar)" hint="Texto del inventario; la asignación real se hace con «Asignar».">
            <Input value={form.asignadoSinConfirmar} onChange={set("asignadoSinConfirmar")} />
          </Field>
          <Field label="Observaciones">
            <Input value={form.observaciones} onChange={set("observaciones")} />
          </Field>
          {esSuperadmin && (
            <div className="rounded-caja border border-borde bg-papel/60 p-3.5 space-y-3">
              <div className="text-[13px] font-semibold text-tinta">Clave del equipo</div>
              <div className="flex flex-wrap items-end gap-2">
                <Field label={activo.tiene_clave ? "Reemplazar clave" : "Registrar clave"} hint="Todo acceso queda registrado en auditoría.">
                  <div className="relative">
                    <Input type={claveVisible ? "text" : "password"} value={clave} autoComplete="new-password"
                      onChange={(e) => { setClave(e.target.value); setClaveTocada(true); }} style={{ paddingRight: 34 }} />
                    <button type="button" onClick={() => setClaveVisible((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gris hover:text-tinta"
                      title={claveVisible ? "Ocultar" : "Mostrar"}>
                      {claveVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </Field>
                {activo.tiene_clave && (
                  <Button type="button" variant="secondary" size="sm" onClick={verActual}>Ver clave actual</Button>
                )}
              </div>
              {claveActual !== null && (
                <Note tone="neutral">Clave actual: <span className="font-mono font-semibold">{claveActual}</span></Note>
              )}
            </div>
          )}
          {error && <Note tone="alerta">{error}</Note>}
          <div className="flex gap-2">
            <Button type="submit" disabled={ocupado || !form.codigo.trim()}>
              {ocupado ? "Guardando…" : "Guardar cambios"}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} disabled={ocupado}>Cancelar</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ADQ-02 — Alta de activo
function AltaActivo({ open, onClose }) {
  const [cat, setCat] = useState("Cómputo");
  const [ok, setOk] = useState(false);
  const cerrar = () => { setOk(false); onClose(); };

  return (
    <Modal open={open} onClose={cerrar} title="ADQ-02 · Alta de activo" wide>
      {ok ? (
        <div className="space-y-4">
          <Note tone="conf">Activo registrado (demostración) en estado disponible.</Note>
          <Button onClick={cerrar}>Cerrar</Button>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); setOk(true); }} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Categoría" required>
              <Select value={cat} onChange={(e) => setCat(e.target.value)}>
                <option>Cómputo</option>
                <option>Comunicaciones</option>
                <option>Maquinaria</option>
              </Select>
            </Field>
            <Field label="Marca" required><Input /></Field>
            <Field label="Modelo" required><Input /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Número de serie" required hint="Único por categoría."><Input /></Field>
            {cat === "Comunicaciones" && (
              <Field label="IMEI" required hint="Único en todo el sistema."><Input inputMode="numeric" maxLength={15} /></Field>
            )}
            <Field label="Valor de adquisición (S/)" required><Input inputMode="decimal" /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Fecha de compra"><Input type="date" /></Field>
            <Field label="Proveedor"><Input /></Field>
            <Field label="Fotografía del equipo"><Input type="file" /></Field>
          </div>
          <Note tone="neutral">
            El activo pertenece a una empresa concreta del grupo aunque se asigne a personal de otra: eso importa para
            el costeo y la contabilidad.
          </Note>
          <div className="flex gap-2">
            <Button type="submit">Guardar</Button>
            <Button type="button" variant="secondary" onClick={cerrar}>Cancelar</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ADQ-03 — Asignar activo
function AsignarActivo({ activo, onClose, onAsignar }) {
  const { db } = useApp();
  const [dni, setDni] = useState("");
  const [cargo, setCargo] = useState(true);
  const [antivirus, setAntivirus] = useState(false);
  const [comentario, setComentario] = useState("");
  const vigentes = db.personal.filter((p) => p.estado === "vigente");

  return (
    <Modal open={!!activo} onClose={onClose} title="ADQ-03 · Asignar activo">
      {activo && (
        <div className="space-y-4">
          <Note tone="neutral">
            <b>{activo.codigo}</b> — {activo.marca} {activo.modelo} · Serie {activo.serie}
          </Note>
          <Field label="Persona receptora" required hint="El activo se asigna a una Persona, no a un cargo ni a una sede.">
            <Select value={dni} onChange={(e) => setDni(e.target.value)}>
              <option value="">Buscar por DNI…</option>
              {vigentes.map((p) => (
                <option key={p.dni} value={p.dni}>{p.nombre} — {p.dni}</option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fecha de entrega"><Input type="date" defaultValue="2026-08-10" /></Field>
            <Field label="Condición en la entrega">
              <Select><option>Nuevo</option><option>Buen estado</option><option>Con observaciones</option></Select>
            </Field>
          </div>
          <Field label="Fotografías del estado" hint="Referencia contra la cual se evaluará la devolución. Sin ella, cualquier discusión sobre deterioro es palabra contra palabra.">
            <Input type="file" multiple />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-[13px] font-medium text-tinta-2">
              <input type="checkbox" checked={antivirus} onChange={(e) => setAntivirus(e.target.checked)} className="accent-petroleo" />
              El equipo lleva antivirus instalado
            </label>
            <Field label="Comentario" hint="Ej.: «PC que perteneció a…»">
              <Input value={comentario} onChange={(e) => setComentario(e.target.value)} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-[13px] font-medium text-tinta-2">
            <input type="checkbox" checked={cargo} onChange={(e) => setCargo(e.target.checked)} className="accent-petroleo" />
            Generar cargo digital para acuse del trabajador
          </label>
          <div className="flex gap-2">
            <Button disabled={!dni} onClick={() => onAsignar(activo.codigo, dni, antivirus, comentario)}>Asignar</Button>
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ADQ-04 — Devolución de activo
function DevolucionActivo({ activo, onClose, onDevolver }) {
  const { persona } = useApp();
  const [destino, setDestino] = useState("disponible");

  return (
    <Modal open={!!activo} onClose={onClose} title="ADQ-04 · Devolución de activo">
      {activo && (
        <div className="space-y-4">
          <Note tone="neutral">
            <b>{activo.codigo}</b> — {activo.marca} {activo.modelo}, asignado a <b>{persona(activo.asignado)?.nombre}</b>
          </Note>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-borde bg-papel/60 p-3.5">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-wide text-gris">Condición en la entrega</div>
              <div className="mt-1 text-[13px] font-semibold text-tinta">Buen estado</div>
              <div className="mt-0.5 text-[11.5px] text-gris">2 fotografías · {activo.compra}</div>
            </div>
            <div className="rounded-md border border-petroleo/40 bg-white p-3.5">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-wide text-gris">Condición en la devolución</div>
              <Select className="mt-1"><option>Buen estado</option><option>Deteriorado</option><option>Inoperativo</option></Select>
            </div>
          </div>
          <Field label="Fotografías del estado actual"><Input type="file" multiple /></Field>
          <Field label="Destino del activo">
            <Select value={destino} onChange={(e) => setDestino(e.target.value)}>
              <option value="disponible">Disponible</option>
              <option value="mantenimiento">Mantenimiento</option>
              <option value="baja">Baja</option>
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button onClick={() => onDevolver(activo.codigo, destino)}>Registrar devolución</Button>
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
