import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { MapPin, Plus, BookOpen, Trash2 } from "lucide-react";
import { useApp } from "../../state";
import { supabase } from "../../lib/supabase";
import { nivelDe } from "../../data/modulos";
import {
  PageHeader, Card, Table, Td, Badge, Button, Input, Field, Modal, Note, Select,
} from "../../components/ui";

// RRH-21 — Sedes de la empresa seleccionada. Cada sede lleva un código propio
// (S-0001…) y, desde 2026-08-19, puede declarar SU reglamento interno (el RIT
// cambia según sede o contrato): el personal de esa planilla lo «jala» solo al
// leerlo desde su portal. Sin RIT propio rige el de la empresa (el general).
export default function Sedes() {
  const { empresaId, empresa, db, user, crearSede, crearRit, asignarRitSede, eliminarSede } = useApp();
  const acceso = user?.acceso ?? { esSuperadmin: user?.esSuperadmin, matriz: {} };
  const puedeAprobar = nivelDe(acceso, "personal") >= 3;
  const [q, setQ] = useState("");
  const [alta, setAlta] = useState(false);
  const [subirRit, setSubirRit] = useState(false);
  // El detalle deja su aviso al volver (p. ej. «Sede eliminada»).
  const [aviso, setAviso] = useState(useLocation().state?.aviso ?? null);
  const [error, setError] = useState(null);
  const [porEliminar, setPorEliminar] = useState(null); // sede del modal
  const [eliminando, setEliminando] = useState(false);

  const filas = useMemo(
    () =>
      db.sedes.filter(
        (s) =>
          s.empresa === empresaId &&
          (!q ||
            s.nombre.toLowerCase().includes(q.toLowerCase()) ||
            (s.codigo ?? "").toLowerCase().includes(q.toLowerCase()) ||
            (s.cliente ?? "").toLowerCase().includes(q.toLowerCase()))
      ),
    [db.sedes, empresaId, q]
  );

  const eliminar = async () => {
    if (!porEliminar) return;
    setError(null);
    setEliminando(true);
    try {
      await eliminarSede(porEliminar.id);
      setAviso(`Sede «${porEliminar.nombre}» eliminada.`);
      setPorEliminar(null);
    } catch (err) {
      setError(err.message);
      setPorEliminar(null);
    } finally {
      setEliminando(false);
    }
  };

  const cambiarRit = async (sede, ritId) => {
    setError(null);
    try {
      await asignarRitSede(sede.id, ritId || null);
      setAviso(ritId
        ? `La sede «${sede.nombre}» ahora usa su propio reglamento; su personal lo verá en el portal.`
        : `La sede «${sede.nombre}» vuelve al reglamento de la empresa.`);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <PageHeader
        code="RRH-21 · Sedes"
        title="Sedes"
        subtitle="Las unidades de servicio de la empresa seleccionada. Cada sede puede tener su propio RIT según el contrato; sin uno propio rige el general."
        actions={
          <>
            {puedeAprobar && (
              <Button variant="secondary" size="sm" onClick={() => setSubirRit(true)}>
                <BookOpen size={13} /> Subir reglamento
              </Button>
            )}
            <Button size="sm" onClick={() => setAlta(true)}><Plus size={13} /> Nueva sede</Button>
          </>
        }
      />

      {aviso && <div className="mb-4"><Note tone="conf">{aviso}</Note></div>}
      {error && <div className="mb-4"><Note tone="alerta">{error}</Note></div>}

      <Card pad={false}>
        <div className="flex flex-wrap gap-2.5 border-b border-borde bg-papel/50 p-3.5">
          <Input placeholder="Buscar por código, nombre o cliente…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
        </div>
        <Table head={["Código", "Sede", "Cliente", "Supervisor", "Reglamento (RIT)", "Estado", ""]}>
          {filas.map((s) => (
            <tr key={s.id} className="hover:bg-papel/60">
              <Td className="font-mono text-[12px] font-semibold">{s.codigo ?? "—"}</Td>
              <Td>
                <Link to={`/rrhh/sedes/${s.id}`} className="font-semibold text-petroleo hover:underline">
                  {s.nombre}
                </Link>
                {s.direccion && <div className="text-[11px] text-gris">{s.direccion}</div>}
              </Td>
              <Td className="text-gris">{s.cliente}</Td>
              <Td>{s.supervisor ?? <span className="text-gris-cl">—</span>}</Td>
              <Td>
                {puedeAprobar ? (
                  <Select value={s.rit_id ?? ""} onChange={(e) => cambiarRit(s, e.target.value)} style={{ maxWidth: 230 }}>
                    <option value="">De la empresa ({db.rits.find((r) => r.id === s.rit_efectivo && !s.rit_id)?.nombre ?? "general"})</option>
                    {db.rits.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                  </Select>
                ) : (
                  <span className="text-[12.5px]">{s.rit_nombre ?? "—"}{s.rit_id && <Badge tone="tinta"> propio</Badge>}</span>
                )}
              </Td>
              <Td>
                {(s.estado ?? "activa") === "activa"
                  ? <Badge tone="conf">Activa</Badge>
                  : <Badge tone="neutral">Cerrada</Badge>}
              </Td>
              <Td>
                <div className="flex items-center justify-end gap-1">
                  <Link to={`/rrhh/sedes/${s.id}`} className="text-[12px] font-semibold text-petroleo hover:underline">
                    Detalle
                  </Link>
                  {puedeAprobar && (
                    <button
                      type="button"
                      onClick={() => setPorEliminar(s)}
                      title="Eliminar sede"
                      aria-label={`Eliminar la sede ${s.nombre}`}
                      className="ml-1.5 rounded-full p-1.5 text-gris-cl hover:bg-alerta/10 hover:text-alerta"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
          {filas.length === 0 && (
            <tr><Td colSpan={7}><span className="text-gris-cl">No hay sedes que coincidan.</span></Td></tr>
          )}
        </Table>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Note tone="neutral">
          <MapPin size={13} className="mr-1 inline" />
          La importación de personal también crea sedes cuando el reporte trae una nueva: nacen con el
          reglamento de la empresa y aquí se les asigna uno propio si su contrato lo exige.
        </Note>
        <Card>
          <div className="mb-2 flex items-center gap-2 text-[13.5px] font-semibold text-tinta">
            <BookOpen size={15} className="text-petroleo" /> Reglamentos cargados
          </div>
          {db.rits.map((r) => (
            <div key={r.id} className="mb-1.5 flex items-center gap-2 text-[12.5px]">
              <span className="flex-1">{r.nombre}</span>
              <span className="text-gris-cl">desde {r.vigente_desde}</span>
              {r.tiene_pdf ? <Badge tone="conf">PDF</Badge> : <Badge tone="pend">Sin PDF</Badge>}
              <span className="text-[11px] text-gris">{r.sedes_propias} sede(s)</span>
            </div>
          ))}
        </Card>
      </div>

      <AltaSede
        open={alta}
        onClose={() => setAlta(false)}
        empresa={empresa}
        rits={db.rits}
        crearSede={crearSede}
        onCreada={(r, nombre) => setAviso(`Sede «${nombre}» creada con el código ${r.codigo}.`)}
      />
      <Modal
        open={!!porEliminar}
        onClose={() => !eliminando && setPorEliminar(null)}
        title={porEliminar ? `Eliminar la sede «${porEliminar.nombre}»` : ""}
      >
        <div className="space-y-4">
          <Note tone="alerta">
            Se elimina de forma definitiva. Solo es posible si nada la referencia: sin trabajadores
            (ni históricos), sin activos y sin comunicados dirigidos a ella. Si tiene rastro, el
            sistema lo dirá y no borrará nada.
          </Note>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={() => setPorEliminar(null)} disabled={eliminando}>
              Cancelar
            </Button>
            <Button variant="danger" type="button" onClick={eliminar} disabled={eliminando}>
              {eliminando ? "Eliminando…" : "Sí, eliminar"}
            </Button>
          </div>
        </div>
      </Modal>

      <SubirReglamento
        open={subirRit}
        onClose={() => setSubirRit(false)}
        crearRit={crearRit}
        onListo={(nombre) => setAviso(`Reglamento «${nombre}» cargado: ya se puede asignar a las sedes que lo usen.`)}
      />
    </>
  );
}

function AltaSede({ open, onClose, empresa, rits, crearSede, onCreada }) {
  const vacio = { nombre: "", cliente: "", direccion: "", rit: "" };
  const [form, setForm] = useState(vacio);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const cerrar = () => { setForm(vacio); setError(null); onClose(); };

  const guardar = async (e) => {
    e.preventDefault();
    if (ocupado) return;
    setError(null);
    setOcupado(true);
    try {
      const r = await crearSede({
        empresaId: empresa.id, nombre: form.nombre, cliente: form.cliente,
        direccion: form.direccion, rit: form.rit || null,
      });
      onCreada(r, form.nombre.trim());
      cerrar();
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Modal open={open} onClose={cerrar} title={`RRH-21 · Nueva sede en ${empresa?.corto ?? ""}`}>
      <form onSubmit={guardar} className="space-y-4">
        <Note tone="neutral">
          El código (S-0001…) lo asigna el sistema al guardar y no se puede elegir ni cambiar: es la
          identidad estable de la sede aunque el nombre se corrija después.
        </Note>
        <Field label="Nombre de la sede">
          <Input value={form.nombre} onChange={set("nombre")} placeholder="MINEDU — San Borja" autoFocus required />
        </Field>
        <Field label="Cliente">
          <Input value={form.cliente} onChange={set("cliente")} placeholder="MINEDU (vacío = Por asignar)" />
        </Field>
        <Field label="Dirección (opcional)">
          <Input value={form.direccion} onChange={set("direccion")} placeholder="Calle Del Comercio 193, San Borja" />
        </Field>
        <Field label="Reglamento interno (RIT)" hint="Solo si el contrato de esta sede tiene reglamento propio; vacío = el de la empresa.">
          <Select value={form.rit} onChange={set("rit")}>
            <option value="">El de la empresa (general)</option>
            {rits.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </Select>
        </Field>
        {error && <Note tone="alerta">{error}</Note>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={cerrar} disabled={ocupado}>Cancelar</Button>
          <Button type="submit" disabled={ocupado || !form.nombre.trim()}>
            {ocupado ? "Creando…" : "Crear sede"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// Cargar un reglamento nuevo: PDF al bucket privado + registro en el catálogo.
function SubirReglamento({ open, onClose, crearRit, onListo }) {
  const [nombre, setNombre] = useState("");
  const [vigente, setVigente] = useState("");
  const [archivo, setArchivo] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  const cerrar = () => { setNombre(""); setVigente(""); setArchivo(null); setError(null); onClose(); };

  const guardar = async (e) => {
    e.preventDefault();
    if (ocupado || !archivo) return;
    setError(null);
    setOcupado(true);
    try {
      const bytes = new Uint8Array(await archivo.arrayBuffer());
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const slug = nombre.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const ruta = `rit/${slug}.pdf`;
      const { error: errSubida } = await supabase.storage.from("documentos")
        .upload(ruta, bytes, { contentType: "application/pdf", upsert: true });
      if (errSubida) throw new Error(`No se pudo subir el PDF: ${errSubida.message}`);
      await crearRit(nombre.trim(), ruta, hash, vigente || null);
      onListo(nombre.trim());
      cerrar();
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Modal open={open} onClose={cerrar} title="Subir reglamento interno (RIT)">
      <form onSubmit={guardar} className="space-y-4">
        <Note tone="neutral">
          El PDF queda en el repositorio privado y disponible al instante para el personal de las sedes que
          lo declaren. El catálogo de faltas del módulo disciplinario sigue usando el RIT general hasta que
          se cargue el articulado del reglamento nuevo.
        </Note>
        <Field label="Nombre del reglamento" required hint="Ej.: «RIT — Contrato MINEDU (2026)». Jamás se muestra la razón social del cliente al trabajador si no corresponde.">
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} required autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vigente desde">
            <Input type="date" value={vigente} onChange={(e) => setVigente(e.target.value)} />
          </Field>
          <Field label="PDF del reglamento" required>
            <Input type="file" accept=".pdf" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} required />
          </Field>
        </div>
        {error && <Note tone="alerta">{error}</Note>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={cerrar} disabled={ocupado}>Cancelar</Button>
          <Button type="submit" disabled={ocupado || !nombre.trim() || !archivo}>
            {ocupado ? "Subiendo…" : "Cargar reglamento"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
