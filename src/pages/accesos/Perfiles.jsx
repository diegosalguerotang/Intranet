import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Copy, Ban, ShieldCheck, Users as UsersIcon, Pencil } from "lucide-react";
import { useApp } from "../../state";
import { PageHeader, Card, Table, Td, Badge, Button, Modal, Note } from "../../components/ui";
import { MODULOS, NIVELES } from "../../data/modulos";

// Resumen visual de la matriz: cuántos módulos hay en cada nivel.
function ResumenMatriz({ matriz }) {
  const conteo = [0, 0, 0, 0];
  MODULOS.forEach((m) => { conteo[matriz?.[m.id] ?? 0]++; });
  const tonos = ["bg-borde", "bg-acero", "bg-petroleo", "bg-pend"];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {conteo.map((n, i) =>
        n > 0 ? (
          <span key={i} className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-gris">
            <span className={`h-2.5 w-2.5 rounded-[2px] ${tonos[i]}`} />
            {n} · {NIVELES[i].toLowerCase()}
          </span>
        ) : null
      )}
    </div>
  );
}

export default function Perfiles() {
  const { db, desactivarPerfil } = useApp();
  const navigate = useNavigate();
  const [confirmar, setConfirmar] = useState(null);

  return (
    <>
      <PageHeader
        code="ACC-03"
        title="Catálogo de perfiles"
        subtitle="Qué concede cada perfil y cuántas personas lo usan. Los perfiles son del Grupo: el alcance por razón social se define al asignarlos, no aquí."
        actions={<Button onClick={() => navigate("/accesos/perfiles/nuevo")}><Plus size={14} /> Nuevo perfil</Button>}
      />
      <Card pad={false}>
        <Table head={["Perfil", "Matriz", "Usuarios", "Estado", "Última modificación", "Acciones"]}>
          {db.perfiles.map((p) => (
            <tr key={p.id} className="hover:bg-papel/60">
              <Td className="max-w-[260px]">
                <div className="flex items-center gap-2 font-semibold text-tinta">
                  {p.nombre}
                  {p.esSuperadmin && <Badge tone="tinta"><ShieldCheck size={11} /> Superadmin</Badge>}
                </div>
                <div className="mt-0.5 text-[11.5px] leading-snug text-gris-cl">{p.descripcion}</div>
              </Td>
              <Td>
                {p.esSuperadmin
                  ? <span className="text-[11.5px] italic text-gris-cl">Sin matriz — acceso total</span>
                  : <ResumenMatriz matriz={p.matriz} />}
              </Td>
              <Td>
                <button
                  className="inline-flex items-center gap-1 text-petroleo hover:underline"
                  onClick={() => navigate(`/accesos/usuarios?perfil=${p.id}`)}
                  title="Ver usuarios asignados"
                >
                  <UsersIcon size={12} /> {p.usuarios}
                </button>
              </Td>
              <Td>{p.estado === "activo" ? <Badge tone="conf">Activo</Badge> : <Badge tone="neutral">Desactivado</Badge>}</Td>
              <Td>
                <div className="text-[12px]">{p.modificado}</div>
                <div className="font-mono text-[10.5px] text-gris-cl">v{p.version} · {p.modificadoPor}</div>
              </Td>
              <Td className="whitespace-nowrap">
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/accesos/perfiles/${p.id}`)}><Pencil size={12} /> Editar</Button>
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/accesos/perfiles/nuevo?desde=${p.id}`)}><Copy size={12} /> Duplicar</Button>
                  {p.estado === "activo" && !p.esSuperadmin && (
                    <Button size="sm" variant="ghost" onClick={() => setConfirmar(p)}><Ban size={12} /> Desactivar</Button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="mt-4">
        <Note tone="neutral">
          <b>Duplicar es la vía recomendada para crear variantes.</b> Crear desde cero un perfil casi idéntico a otro
          es cómo se acumulan permisos que nadie recuerda haber otorgado. Un perfil con usuarios asignados no se
          elimina: se desactiva.
        </Note>
      </div>

      <Modal open={!!confirmar} onClose={() => setConfirmar(null)} title={`Desactivar «${confirmar?.nombre}»`}>
        {confirmar && (
          <div className="space-y-4">
            {confirmar.usuarios > 0 ? (
              <Note tone="alerta">
                <b>{confirmar.usuarios}</b> usuario(s) tienen asignado este perfil. Desactivarlo impide asignarlo a
                usuarios nuevos y <b>no altera</b> a los que ya lo tienen. Para retirarlo por completo, primero
                reasigna a sus usuarios.
              </Note>
            ) : (
              <Note tone="neutral">
                El perfil no tiene usuarios asignados. Si más adelante hace falta, puede recuperarse guardando una
                versión nueva desde el constructor.
              </Note>
            )}
            <div className="flex justify-end gap-2">
              {confirmar.usuarios > 0 && (
                <Button variant="secondary" onClick={() => navigate(`/accesos/usuarios?perfil=${confirmar.id}`)}>
                  Ver usuarios asignados
                </Button>
              )}
              <Button variant="secondary" onClick={() => setConfirmar(null)}>Cancelar</Button>
              <Button variant="danger" onClick={() => { desactivarPerfil(confirmar.id); setConfirmar(null); }}>Desactivar</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
