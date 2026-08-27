import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, MapPin, BookOpen, Trash2, UserCog, Building2,
} from "lucide-react";
import { useApp } from "../../state";
import { nivelDe } from "../../data/modulos";
import {
  PageHeader, Card, Table, Td, Badge, Button, Modal, Note, Stat,
} from "../../components/ui";

// RRH-21b — Detalle de una sede (pedido de Diego 2026-08-27): quiénes
// trabajan ahí, los activos ubicados en ella y su ficha (código, cliente,
// RIT, supervisor). Desde aquí también se elimina, si nada la referencia.
export default function SedeDetalle() {
  const { id } = useParams();
  const navegar = useNavigate();
  const { db, user, empresaPor, eliminarSede } = useApp();
  const acceso = user?.acceso ?? { esSuperadmin: user?.esSuperadmin, matriz: {} };
  const puedeAprobar = nivelDe(acceso, "personal") >= 3;
  const [confirmar, setConfirmar] = useState(false);
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const sede = db.sedes.find((s) => s.id === id);
  const empresa = empresaPor(sede?.empresa);

  const personal = useMemo(() => {
    const filas = db.personal.filter((p) => p.sede === id);
    return filas.sort((a, b) =>
      (a.estado === "vigente" ? 0 : 1) - (b.estado === "vigente" ? 0 : 1) ||
      a.nombre.localeCompare(b.nombre));
  }, [db.personal, id]);
  const vigentes = personal.filter((p) => p.estado === "vigente");
  const activos = useMemo(() => db.activos.filter((a) => a.sede === id), [db.activos, id]);

  if (!sede) {
    return (
      <Note tone="alerta">
        La sede no existe (¿se eliminó?). <Link className="font-semibold underline" to="/rrhh/sedes">Volver a Sedes</Link>
      </Note>
    );
  }

  const eliminar = async () => {
    setError(null);
    setOcupado(true);
    try {
      await eliminarSede(sede.id);
      navegar("/rrhh/sedes", { state: { aviso: `Sede «${sede.nombre}» eliminada.` } });
    } catch (err) {
      setError(err.message);
      setConfirmar(false);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <>
      <PageHeader
        code={`RRH-21 · ${sede.codigo ?? "Sede"}`}
        title={sede.nombre}
        subtitle={`${empresa?.nombre ?? sede.empresa} — ${sede.cliente}`}
        actions={
          <>
            <Link to="/rrhh/sedes">
              <Button variant="secondary" size="sm"><ArrowLeft size={13} /> Sedes</Button>
            </Link>
            {puedeAprobar && (
              <Button variant="danger" size="sm" onClick={() => setConfirmar(true)}>
                <Trash2 size={13} /> Eliminar sede
              </Button>
            )}
          </>
        }
      />

      {error && <div className="mb-4"><Note tone="alerta">{error}</Note></div>}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Trabajadores vigentes" value={vigentes.length} />
        <Stat label="Vínculos históricos" value={personal.length - vigentes.length} />
        <Stat label="Activos en la sede" value={activos.length} />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-2 flex items-center gap-2 text-[13.5px] font-semibold text-tinta">
            <MapPin size={15} className="text-petroleo" /> Ficha de la sede
          </div>
          <dl className="space-y-1.5 text-[12.5px]">
            <Dato icono={Building2} nombre="Razón social" valor={empresa?.nombre ?? sede.empresa} />
            <Dato nombre="Código" valor={<span className="font-mono font-semibold">{sede.codigo ?? "—"}</span>} />
            <Dato nombre="Cliente" valor={sede.cliente} />
            <Dato nombre="Dirección" valor={sede.direccion ?? "—"} />
            <Dato icono={UserCog} nombre="Supervisor" valor={sede.supervisor ?? "—"} />
            <Dato
              nombre="Estado"
              valor={(sede.estado ?? "activa") === "activa" ? <Badge tone="conf">Activa</Badge> : <Badge tone="neutral">Cerrada</Badge>}
            />
          </dl>
        </Card>
        <Card>
          <div className="mb-2 flex items-center gap-2 text-[13.5px] font-semibold text-tinta">
            <BookOpen size={15} className="text-petroleo" /> Reglamento interno (RIT)
          </div>
          <p className="text-[12.5px] leading-relaxed text-gris">
            {sede.rit_id
              ? <>Esta sede usa su propio reglamento: <span className="font-semibold text-tinta">{sede.rit_nombre}</span>. Su personal lo ve en el portal.</>
              : <>Rige el reglamento de la empresa{sede.rit_nombre ? <>: <span className="font-semibold text-tinta">{sede.rit_nombre}</span></> : ""}. Para asignarle uno propio, hazlo desde la lista de Sedes.</>}
          </p>
        </Card>
      </div>

      <Card pad={false} className="mb-4">
        <div className="border-b border-borde bg-papel/50 p-3.5 text-[13.5px] font-semibold text-tinta">
          Quiénes trabajan aquí
        </div>
        <Table head={["Documento", "Nombre", "Cargo", "Ingreso", "Estado", ""]}>
          {personal.map((p) => (
            <tr key={p.vinculo_id} className="hover:bg-papel/60">
              <Td className="font-mono text-[12px]">{p.dni}</Td>
              <Td className="font-semibold">{p.nombre}</Td>
              <Td className="text-gris">{p.cargo}</Td>
              <Td className="text-gris">{p.ingreso}</Td>
              <Td>
                {p.estado === "vigente"
                  ? <Badge tone="conf">Vigente</Badge>
                  : <Badge tone="neutral">Cesado {p.cese}</Badge>}
              </Td>
              <Td>
                <Link to={`/rrhh/personal/${p.dni}`} className="text-[12px] font-semibold text-petroleo hover:underline">
                  Ver legajo
                </Link>
              </Td>
            </tr>
          ))}
          {personal.length === 0 && (
            <tr><Td colSpan={6}><span className="text-gris-cl">Nadie trabaja (ni trabajó) en esta sede.</span></Td></tr>
          )}
        </Table>
      </Card>

      <Card pad={false}>
        <div className="border-b border-borde bg-papel/50 p-3.5 text-[13.5px] font-semibold text-tinta">
          Activos ubicados en la sede
        </div>
        <Table head={["Código", "Tipo", "Marca y modelo", "Asignado a", "Estado"]}>
          {activos.map((a) => (
            <tr key={a.codigo} className="hover:bg-papel/60">
              <Td className="font-mono text-[12px] font-semibold">{a.codigo}</Td>
              <Td className="text-gris">{a.tipo ?? a.categoria}</Td>
              <Td>{[a.marca, a.modelo].filter(Boolean).join(" ") || "—"}</Td>
              <Td className="text-gris">{a.asignado ? (db.personal.find((p) => p.dni === a.asignado)?.nombre ?? a.asignado) : "—"}</Td>
              <Td><Badge tone={a.estado === "asignado" ? "conf" : a.estado === "baja" ? "neutral" : "tinta"}>{a.estado}</Badge></Td>
            </tr>
          ))}
          {activos.length === 0 && (
            <tr><Td colSpan={5}><span className="text-gris-cl">No hay activos registrados en esta sede.</span></Td></tr>
          )}
        </Table>
      </Card>

      <Modal open={confirmar} onClose={() => !ocupado && setConfirmar(false)} title={`Eliminar la sede «${sede.nombre}»`}>
        <div className="space-y-4">
          <Note tone="alerta">
            Se elimina de forma definitiva. Solo es posible si nada la referencia: sin trabajadores
            (ni históricos), sin activos y sin comunicados dirigidos a ella. Si tiene rastro, el
            sistema lo dirá y no borrará nada.
          </Note>
          {error && <Note tone="alerta">{error}</Note>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={() => setConfirmar(false)} disabled={ocupado}>Cancelar</Button>
            <Button variant="danger" type="button" onClick={eliminar} disabled={ocupado}>
              {ocupado ? "Eliminando…" : "Sí, eliminar"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function Dato({ icono: Icono, nombre, valor }) {
  return (
    <div className="flex items-start gap-2">
      <dt className="w-28 shrink-0 text-gris-cl">
        {Icono && <Icono size={12} className="mr-1 inline" />}{nombre}
      </dt>
      <dd className="flex-1 text-tinta">{valor}</dd>
    </div>
  );
}
