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
        title="Catálogo de categorías"
        subtitle="Qué concede cada categoría, sobre qué razones sociales opera y cuántas personas la usan. El usuario hereda su categoría tal cual."
        actions={<Button onClick={() => navigate("/accesos/perfiles/nuevo")}><Plus size={14} /> Nueva categoría</Button>}
      />
      <Card pad={false}>
        <Table head={["Categoría", "Matriz", "Razones sociales", "Usuarios", "Estado", "Última modificación", "Acciones"]}>
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
                {p.esSuperadmin ? (
                  <span className="text-[12px] font-semibold text-pend">Todo el grupo</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {(p.empresas ?? []).map((eid) => (
                      <Badge key={eid} tone="neutral">{db.empresas.find((e) => e.id === eid)?.corto ?? eid}</Badge>
                    ))}
                  </div>
                )}
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
              <Td>{p.estado === "activo" ? <Badge tone="conf">Activa</Badge> : <Badge tone="neutral">Archivada</Badge>}</Td>
              <Td>
                <div className="text-[12px]">{p.modificado}</div>
                <div className="font-mono text-[10.5px] text-gris-cl">v{p.version} · {p.modificadoPor}</div>
              </Td>
              <Td className="whitespace-nowrap">
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/accesos/perfiles/${p.id}`)}><Pencil size={12} /> Editar</Button>
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/accesos/perfiles/nuevo?desde=${p.id}`)}><Copy size={12} /> Duplicar</Button>
                  {p.estado === "activo" && !p.esSuperadmin && (
                    <Button size="sm" variant="ghost" onClick={() => setConfirmar(p)}><Ban size={12} /> Archivar</Button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="mt-4">
        <Note tone="neutral">
          <b>Duplicar es la vía recomendada para crear variantes.</b> Crear desde cero una categoría casi idéntica a
          otra es cómo se acumulan permisos que nadie recuerda haber otorgado. Una categoría con usuarios asignados
          no se elimina: se archiva.
        </Note>
      </div>

      <Modal open={!!confirmar} onClose={() => setConfirmar(null)} title={`Archivar «${confirmar?.nombre}»`}>
        {confirmar && (
          <div className="space-y-4">
            {confirmar.usuarios > 0 ? (
              <Note tone="alerta">
                <b>{confirmar.usuarios}</b> usuario(s) tienen asignada esta categoría. Archivarla impide asignarla a
                usuarios nuevos y <b>no altera</b> a los que ya la tienen. Para retirarla por completo, primero
                reasigna a sus usuarios.
              </Note>
            ) : (
              <Note tone="neutral">
                La categoría no tiene usuarios asignados. Si más adelante hace falta, puede recuperarse guardando una
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
              <Button variant="danger" onClick={() => { desactivarPerfil(confirmar.id); setConfirmar(null); }}>Archivar</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
