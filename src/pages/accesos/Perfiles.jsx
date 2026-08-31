import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Copy, Ban, ShieldCheck, Users as UsersIcon, Pencil, Trash2, Briefcase } from "lucide-react";
import { useApp } from "../../state";
import { PageHeader, Card, Table, Td, Badge, Button, Modal, Note, Field, Input, Select } from "../../components/ui";
import { MODULOS, NIVELES, nivelDe } from "../../data/modulos";

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
  const { db, user, desactivarPerfil, eliminarPerfil, cargoPerfiles, guardarCargoPerfil } = useApp();
  const navigate = useNavigate();
  const [confirmar, setConfirmar] = useState(null);

  // Correspondencia cargo → categoría (spec Tareas 31-08 §5): dato
  // ADMINISTRADO — la importación del padrón sugiere según esta tabla.
  const [cargos, setCargos] = useState(null);
  const [errorCargo, setErrorCargo] = useState(null);
  const cargarCargos = () => cargoPerfiles().then(setCargos).catch(() => setCargos([]));
  useEffect(() => { cargarCargos(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const puedeEditarCargos = Boolean(user?.esSuperadmin || user?.acceso?.esSuperadmin
    || nivelDe(user?.acceso, "configuracion") >= 2 || nivelDe(user?.acceso, "accesos") >= 2);
  const asignarCargo = async (cargo, valor) => {
    setErrorCargo(null);
    const [destino, perfil] = valor.startsWith("perfil:") ? ["perfil", valor.slice(7)] : [valor, null];
    try { await guardarCargoPerfil(cargo, destino, perfil); await cargarCargos(); }
    catch (e) { setErrorCargo(e.message); }
  };
  const [eliminar, setEliminar] = useState(null); // categoría a eliminar definitivamente
  const [confirmTexto, setConfirmTexto] = useState("");
  const [eliminando, setEliminando] = useState(false);
  const [errorEliminar, setErrorEliminar] = useState(null);

  const cerrarEliminar = () => { setEliminar(null); setConfirmTexto(""); setErrorEliminar(null); };
  const ejecutarEliminar = async () => {
    if (confirmTexto !== "ELIMINAR" || eliminando) return;
    setEliminando(true);
    setErrorEliminar(null);
    try {
      await eliminarPerfil(eliminar.id);
      cerrarEliminar();
    } catch (e) {
      setErrorEliminar(e.message);
    } finally {
      setEliminando(false);
    }
  };

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
                  {!p.esSuperadmin && p.usuarios === 0 && (
                    <Button size="sm" variant="ghost" onClick={() => setEliminar(p)}><Trash2 size={12} /> Eliminar</Button>
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
          no se elimina: se archiva. Eliminar borra la categoría con todas sus versiones (el registro de accesos
          conserva el rastro).
        </Note>
      </div>

      {cargos !== null && (
        <Card className="mt-5" pad={false}>
          <div className="flex items-center gap-2 border-b border-borde px-5 py-3.5">
            <Briefcase size={15} className="text-petroleo" />
            <span className="text-[14px] font-bold text-tinta">Correspondencia cargo → categoría</span>
            <span className="text-[11.5px] text-gris">
              La importación del padrón sugiere según esta tabla; jamás otorga un acceso.
            </span>
          </div>
          {errorCargo && <div className="px-5 pt-3"><Note tone="alerta">{errorCargo}</Note></div>}
          <Table head={["Cargo", "Vigentes", "Sugerencia"]}>
            {cargos.map((c) => (
              <tr key={c.cargo} className="hover:bg-papel/60">
                <Td><span className="font-mono text-[12px] text-tinta">{c.cargo}</span></Td>
                <Td>{c.vigentes}</Td>
                <Td>
                  {puedeEditarCargos ? (
                    <Select
                      value={c.destino === "perfil" ? `perfil:${c.perfilId}` : c.destino}
                      onChange={(e) => asignarCargo(c.cargo, e.target.value)}
                      style={{ maxWidth: 260 }}
                    >
                      <option value="portal">Solo Portal</option>
                      <option value="sin_sugerencia">Sin sugerencia</option>
                      {db.perfiles.filter((p) => !p.esSuperadmin && p.estado === "activo").map((p) => (
                        <option key={p.id} value={`perfil:${p.id}`}>{p.nombre}</option>
                      ))}
                    </Select>
                  ) : (
                    c.destino === "perfil" ? c.perfilNombre
                      : c.destino === "portal" ? "Solo Portal" : "Sin sugerencia"
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

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

      <Modal open={!!eliminar} onClose={cerrarEliminar} title={`Eliminar «${eliminar?.nombre}»`}>
        {eliminar && (
          <div className="space-y-4">
            <Note tone="alerta">
              La eliminación es <b>definitiva</b>: borra la categoría con todas sus versiones, su matriz de
              permisos y su alcance de razones sociales. No se puede deshacer. El registro de accesos (ACC-06)
              conserva el rastro de los ingresos que se hicieron con ella.
            </Note>
            <Field label={<>Escribe <b>ELIMINAR</b> para confirmar</>}>
              <Input value={confirmTexto} onChange={(e) => setConfirmTexto(e.target.value)} placeholder="ELIMINAR" autoFocus />
            </Field>
            {errorEliminar && <Note tone="alerta">{errorEliminar}</Note>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={cerrarEliminar} disabled={eliminando}>Cancelar</Button>
              <Button variant="danger" disabled={confirmTexto !== "ELIMINAR" || eliminando} onClick={ejecutarEliminar}>
                {eliminando ? "Eliminando…" : "Eliminar definitivamente"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
