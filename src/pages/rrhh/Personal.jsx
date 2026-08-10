import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { UserPlus, Upload, Download, Send } from "lucide-react";
import { useApp } from "../../state";
import {
  PageHeader, Card, Table, Td, Badge, Button, Input, Select, Field, Modal, Note, EmptyState,
} from "../../components/ui";
import { PERSONAL, SEDES, CARGOS, sede } from "../../data/mock";

const PORTAL_BADGE = {
  activo: { tone: "conf", label: "Activo" },
  nunca_ingreso: { tone: "alerta", label: "Nunca ingresó" },
  sin_celular: { tone: "pend", label: "Sin celular" },
};

export default function Personal() {
  const { empresaId } = useApp();
  const [q, setQ] = useState("");
  const [fSede, setFSede] = useState("");
  const [fPortal, setFPortal] = useState("");
  const [fEstado, setFEstado] = useState("vigente");
  const [alta, setAlta] = useState(false);
  const [importar, setImportar] = useState(false);
  const [aviso, setAviso] = useState(null);

  const sedesEmpresa = SEDES.filter((s) => s.empresa === empresaId);

  const filas = useMemo(
    () =>
      PERSONAL.filter(
        (p) =>
          p.empresa === empresaId &&
          (!fEstado || p.estado === fEstado) &&
          (!fSede || p.sede === fSede) &&
          (!fPortal || p.portal === fPortal) &&
          (!q || p.dni.includes(q) || p.nombre.toLowerCase().includes(q.toLowerCase()))
      ),
    [empresaId, q, fSede, fPortal, fEstado]
  );

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
          <Table head={["DNI", "Trabajador", "Cargo", "Sede", "Ingreso", "Portal", ""]}>
            {filas.map((p) => {
              const pb = PORTAL_BADGE[p.portal];
              return (
                <tr key={p.dni} className="hover:bg-papel/60">
                  <Td className="font-mono text-[12px]">{p.dni}</Td>
                  <Td>
                    <Link to={`/rrhh/personal/${p.dni}`} className="font-semibold text-petroleo hover:underline">
                      {p.nombre}
                    </Link>
                    {p.estado === "cesado" && <Badge tone="neutral">Cesado</Badge>}
                  </Td>
                  <Td className="text-gris">{p.cargo}</Td>
                  <Td className="text-gris">{sede(p.sede)?.cliente}</Td>
                  <Td className="font-mono text-[12px] text-gris">{p.ingreso}</Td>
                  <Td><Badge tone={pb.tone}>{pb.label}</Badge></Td>
                  <Td>
                    {p.portal === "nunca_ingreso" && (
                      <Button variant="ghost" size="sm" onClick={() => setAviso(`Clave provisional reenviada a ${p.nombre}.`)}>
                        <Send size={12} /> Reenviar clave
                      </Button>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      {aviso && (
        <div className="mt-4">
          <Note tone="conf">{aviso}</Note>
        </div>
      )}

      <AltaTrabajador open={alta} onClose={() => setAlta(false)} sedes={sedesEmpresa} />
      <ImportarPlanilla open={importar} onClose={() => setImportar(false)} />
    </>
  );
}

// RRH-04 — Alta de trabajador
function AltaTrabajador({ open, onClose, sedes }) {
  const [dni, setDni] = useState("");
  const [ok, setOk] = useState(false);
  const existente = PERSONAL.find((p) => p.dni === dni);

  const guardar = (e) => {
    e.preventDefault();
    setOk(true);
  };

  const cerrar = () => { setOk(false); setDni(""); onClose(); };

  return (
    <Modal open={open} onClose={cerrar} title="RRH-04 · Alta de trabajador" wide>
      {ok ? (
        <div className="space-y-4">
          <Note tone="conf">
            Trabajador registrado (demostración). Se generó la clave provisional y se envió por el canal configurado.
          </Note>
          <Button onClick={cerrar}>Entendido</Button>
        </div>
      ) : (
        <form onSubmit={guardar} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="DNI" required hint="Si el DNI ya existe como Persona, se agrega un vínculo sin duplicarla.">
              <Input inputMode="numeric" maxLength={8} value={dni} onChange={(e) => setDni(e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Field label="Nombres y apellidos" required>
              <Input placeholder="Como figura en el DNI" />
            </Field>
          </div>
          {existente && (
            <Note tone="pend">
              El DNI {dni} ya existe: <b>{existente.nombre}</b>. Se abrirá un nuevo vínculo laboral sobre la misma
              Persona y conservará todo su historial.
            </Note>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Celular"><Input inputMode="numeric" maxLength={9} placeholder="9 dígitos" /></Field>
            <Field label="Sede" required>
              <Select>{sedes.map((s) => <option key={s.id}>{s.nombre}</option>)}</Select>
            </Field>
            <Field label="Cargo" required>
              <Select>{CARGOS.map((c) => <option key={c}>{c}</option>)}</Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Fecha de ingreso" required><Input type="date" /></Field>
            <Field label="Tipo de contrato">
              <Select><option>Plazo fijo</option><option>Indeterminado</option></Select>
            </Field>
            <Field label="Cuenta de haberes" hint="Dato sensible: su consulta queda en auditoría.">
              <Input placeholder="CCI" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-[13px] font-medium text-tinta-2">
            <input type="checkbox" defaultChecked className="accent-petroleo" />
            Crear acceso al portal y enviar clave provisional
          </label>
          <div className="flex gap-2">
            <Button type="submit">Guardar</Button>
            <Button type="button" variant="secondary" onClick={cerrar}>Cancelar</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// RRH-05 — Importar planilla
function ImportarPlanilla({ open, onClose }) {
  const [paso, setPaso] = useState(1);
  const cerrar = () => { setPaso(1); onClose(); };

  return (
    <Modal open={open} onClose={cerrar} title="RRH-05 · Importar planilla" wide>
      {paso === 1 && (
        <div className="space-y-4">
          <div
            className="cursor-pointer rounded-md border-2 border-dashed border-borde-f bg-papel/60 px-6 py-10 text-center hover:border-petroleo-cl"
            onClick={() => setPaso(2)}
          >
            <div className="text-[14px] font-semibold text-tinta-2">Arrastra el archivo Excel o CSV, o haz clic para elegirlo</div>
            <div className="mt-1 text-[12px] text-gris">La identificación es siempre por DNI, nunca por nombre ni posición de fila.</div>
          </div>
          <button className="text-[12.5px] font-medium text-petroleo underline underline-offset-2">
            Descargar plantilla de columnas esperadas
          </button>
        </div>
      )}
      {paso === 2 && (
        <div className="space-y-4">
          <Note tone="neutral">
            <b>planilla_agosto_2026.xlsx</b> — 312 filas leídas (simulación)
          </Note>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-md bg-conf-bg py-4"><div className="text-[22px] font-bold text-conf">6</div><div className="font-mono text-[10px] uppercase text-gris">Nuevos</div></div>
            <div className="rounded-md bg-pend-bg py-4"><div className="text-[22px] font-bold text-pend">14</div><div className="font-mono text-[10px] uppercase text-gris">A actualizar</div></div>
            <div className="rounded-md bg-alerta-bg py-4"><div className="text-[22px] font-bold text-alerta">2</div><div className="font-mono text-[10px] uppercase text-gris">Con error</div></div>
          </div>
          <Note tone="pend">
            2 filas con error: fila 87 (DNI de 7 dígitos), fila 203 (sede no reconocida "SUNAT LIMA CERC").
            Ninguna fila se aplica hasta confirmar; la importación es transaccional.
          </Note>
          <Note tone="neutral">
            3 trabajadores existentes no figuran en el archivo. La importación <b>no</b> los da de baja: quedan listados
            como diferencia para que RRHH decida.
          </Note>
          <div className="flex gap-2">
            <Button onClick={() => setPaso(3)}>Confirmar importación</Button>
            <Button variant="secondary" onClick={cerrar}>Cancelar</Button>
          </div>
        </div>
      )}
      {paso === 3 && (
        <div className="space-y-4">
          <Note tone="conf">Importación aplicada (demostración): 6 altas, 14 actualizaciones. Los nuevos recibieron su acceso al portal.</Note>
          <Button onClick={cerrar}>Cerrar</Button>
        </div>
      )}
    </Modal>
  );
}
