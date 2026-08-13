import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, ShieldCheck, Send, Pencil, Ban, RotateCcw, Download, KeyRound } from "lucide-react";
import { useApp } from "../../state";
import { PageHeader, Card, Stat, Table, Td, Badge, Button, Field, Input, Select, Modal, Note, EmptyState, inputCls } from "../../components/ui";
import { MODULOS, NIVELES } from "../../data/modulos";

const genClave = () => Math.random().toString(36).slice(2, 10).toUpperCase();

// ACC-02 · Alta y edición de usuario administrativo (modal).
function FormUsuario({ usuario, onClose, onClave, onEditar }) {
  const { db, crearUsuarioAdmin, actualizarUsuarioAdmin } = useApp();
  const edicion = !!usuario;

  const [busca, setBusca] = useState("");
  const [personaSel, setPersonaSel] = useState(edicion ? db.personal.find((p) => p.dni === usuario.dni) ?? { dni: usuario.dni, nombre: usuario.nombre } : null);
  const [correo, setCorreo] = useState(usuario?.correo ?? "");
  const [celular, setCelular] = useState(usuario?.celular ?? "");
  const [perfilId, setPerfilId] = useState(usuario?.perfil ?? "");
  const [empresasSel, setEmpresasSel] = useState(usuario?.empresas ?? []);
  const [sedesSel, setSedesSel] = useState(usuario?.sedes ?? []);
  const [estado, setEstado] = useState(usuario?.estado ?? "activo");
  const [confirmSuper, setConfirmSuper] = useState(false);

  const coincidencias = busca.trim().length >= 2
    ? db.personal.filter((p) => p.dni.includes(busca.trim()) || p.nombre.toLowerCase().includes(busca.trim().toLowerCase())).slice(0, 6)
    : [];

  const existente = !edicion && personaSel ? db.usuariosAdmin.find((u) => u.dni === personaSel.dni) : null;
  const perfilObj = db.perfiles.find((p) => p.id === perfilId);
  const esSuper = perfilObj?.esSuperadmin ?? false;
  const cesado = personaSel?.estado === "cesado";
  const sedesDisponibles = db.sedes.filter((s) => empresasSel.includes(s.empresa));
  const valido = personaSel && perfilObj && !existente && (esSuper || empresasSel.length > 0);

  const persistir = (otro = false) => {
    if (edicion) {
      actualizarUsuarioAdmin(usuario.id, {
        perfil: perfilId, perfilNombre: perfilObj.nombre, esSuperadmin: esSuper,
        correo: correo.trim() || null, celular: celular.trim() || null,
        empresas: esSuper ? [] : empresasSel, sedes: esSuper ? [] : sedesSel, estado,
      });
      onClose();
      return;
    }
    const clave = genClave();
    crearUsuarioAdmin({
      dni: personaSel.dni, nombre: personaSel.nombre,
      perfil: perfilId, perfilNombre: perfilObj.nombre, esSuperadmin: esSuper,
      correo: correo.trim() || null, celular: celular.trim() || null,
      empresas: esSuper ? [] : empresasSel, sedes: esSuper ? [] : sedesSel,
      clave, cargo: personaSel.cargo, sede: personaSel.sede, empresa: personaSel.empresa,
    });
    onClave({ nombre: personaSel.nombre, clave, correo: correo.trim() || null });
    if (otro) {
      setBusca(""); setPersonaSel(null); setCorreo(""); setCelular("");
      setPerfilId(""); setEmpresasSel([]); setSedesSel([]);
    } else {
      onClose();
    }
  };

  const guardar = (otro = false) => {
    if (!valido) return;
    // La concesión de la marca de superadministrador exige confirmación
    // explícita en una segunda pantalla. (Quitarse la marca a uno mismo se
    // bloquea en el servidor; el login demo aún no vincula sesión y usuario.)
    if (esSuper && !usuario?.esSuperadmin) setConfirmSuper(otro ? "otro" : "cerrar");
    else persistir(otro);
  };

  return (
    <>
      <div className="space-y-4">
        {!edicion && (
          <Field label="Persona" required hint="Debe existir en el maestro de Personal. Desde aquí no se crean personas: rompería la trazabilidad.">
            {personaSel ? (
              <div className="flex items-center justify-between rounded-caja border border-borde bg-papel/60 px-3 py-2">
                <div>
                  <span className="text-[13px] font-semibold text-tinta">{personaSel.nombre}</span>
                  <span className="ml-2 font-mono text-[11.5px] text-gris-cl">DNI {personaSel.dni}</span>
                </div>
                <Button size="sm" variant="ghost" onClick={() => { setPersonaSel(null); setBusca(""); }}>Cambiar</Button>
              </div>
            ) : (
              <div>
                <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por DNI o nombre…" autoFocus />
                {coincidencias.length > 0 && (
                  <div className="mt-1 divide-y divide-borde rounded-caja border border-borde bg-white">
                    {coincidencias.map((p) => (
                      <button
                        key={p.dni}
                        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-papel"
                        onClick={() => setPersonaSel(p)}
                      >
                        <span className="text-[13px] text-tinta">{p.nombre}</span>
                        <span className="font-mono text-[11.5px] text-gris-cl">{p.dni}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Field>
        )}

        {personaSel && personaSel.cargo && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-caja border border-borde bg-papel/60 px-3.5 py-2.5 text-[12px] text-gris sm:grid-cols-4">
            <div><span className="block text-[10px] font-semibold uppercase tracking-wide text-gris-cl">Cargo</span>{personaSel.cargo}</div>
            <div><span className="block text-[10px] font-semibold uppercase tracking-wide text-gris-cl">Sede</span>{db.sedes.find((s) => s.id === personaSel.sede)?.nombre ?? personaSel.sede}</div>
            <div><span className="block text-[10px] font-semibold uppercase tracking-wide text-gris-cl">Empresa</span>{db.empresas.find((e) => e.id === personaSel.empresa)?.corto ?? personaSel.empresa}</div>
            <div><span className="block text-[10px] font-semibold uppercase tracking-wide text-gris-cl">Vínculo</span>{personaSel.estado ?? "—"}</div>
          </div>
        )}

        {cesado && (
          <Note tone="alerta">
            La persona tiene el vínculo laboral <b>cesado</b>. Si mantiene un usuario administrativo activo se
            marcará como inconsistencia a resolver.
          </Note>
        )}

        {existente && (
          <Note tone="alerta">
            <div className="flex items-center justify-between gap-3">
              <span>Esta persona <b>ya tiene un usuario administrativo</b> ({existente.perfilNombre}). Edítalo en lugar de duplicarlo.</span>
              <Button size="sm" variant="secondary" onClick={() => onEditar(existente)}>Editar ese usuario</Button>
            </div>
          </Note>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Correo de contacto" hint="Si queda vacío, la clave provisional se mostrará en pantalla para entrega presencial.">
            <Input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} placeholder="usuario@grupoer.pe" />
          </Field>
          <Field label="Celular de contacto">
            <Input value={celular} onChange={(e) => setCelular(e.target.value)} placeholder="9 dígitos" maxLength={9} />
          </Field>
        </div>

        <Field label="Perfil" required hint="Asignar un perfil sin ver qué concede es la vía más rápida a un permiso otorgado por error.">
          <Select value={perfilId} onChange={(e) => setPerfilId(e.target.value)}>
            <option value="">— Elegir perfil —</option>
            {db.perfiles.filter((p) => p.estado === "activo").map((p) => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
            ))}
          </Select>
        </Field>

        {perfilObj && (
          <div className="rounded-caja border border-borde bg-papel/60 p-3.5">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gris-cl">Matriz del perfil (solo lectura)</div>
            {esSuper ? (
              <Badge tone="tinta"><ShieldCheck size={11} /> Superadministrador — todo el grupo, todos los módulos</Badge>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {MODULOS.filter((m) => (perfilObj.matriz?.[m.id] ?? 0) > 0).map((m) => (
                  <Badge key={m.id} tone="neutral">{m.nombre}: {NIVELES[perfilObj.matriz[m.id]]}</Badge>
                ))}
                {MODULOS.every((m) => (perfilObj.matriz?.[m.id] ?? 0) === 0) && (
                  <span className="text-[11.5px] italic text-gris-cl">Sin acceso a ningún módulo.</span>
                )}
              </div>
            )}
          </div>
        )}

        <Field
          label="Alcance — razones sociales"
          required={!esSuper}
          hint={esSuper ? "El superadministrador opera sobre todo el grupo: el alcance no aplica." : "El alcance solo restringe: nunca otorga un permiso que el perfil no concede."}
        >
          {esSuper ? (
            <div className={`${inputCls} bg-papel/60 italic text-gris-cl`}>Todo el grupo</div>
          ) : (
            <div className="flex flex-wrap gap-3">
              {db.empresas.map((e) => (
                <label key={e.id} className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-gris">
                  <input
                    type="checkbox"
                    className="accent-petroleo"
                    checked={empresasSel.includes(e.id)}
                    onChange={(ev) => {
                      setEmpresasSel((xs) => (ev.target.checked ? [...xs, e.id] : xs.filter((x) => x !== e.id)));
                      if (!ev.target.checked) setSedesSel((xs) => xs.filter((sid) => db.sedes.find((s) => s.id === sid)?.empresa !== e.id));
                    }}
                  />
                  {e.corto}
                </label>
              ))}
            </div>
          )}
        </Field>

        {!esSuper && empresasSel.length > 0 && (
          <Field label="Alcance — sedes" hint="Sin marcar ninguna, el alcance son todas las sedes de esas razones sociales.">
            <div className="flex flex-wrap gap-3">
              {sedesDisponibles.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-gris">
                  <input
                    type="checkbox"
                    className="accent-petroleo"
                    checked={sedesSel.includes(s.id)}
                    onChange={(ev) => setSedesSel((xs) => (ev.target.checked ? [...xs, s.id] : xs.filter((x) => x !== s.id)))}
                  />
                  {s.nombre}
                </label>
              ))}
            </div>
          </Field>
        )}

        {edicion && (
          <Field label="Estado" hint="Suspender corta el acceso de inmediato e invalida las sesiones abiertas; no borra nada de lo que el usuario hizo.">
            <Select value={estado} onChange={(e) => setEstado(e.target.value)}>
              <option value="activo">Activo</option>
              <option value="suspendido">Suspendido</option>
            </Select>
          </Field>
        )}

        <div className="flex justify-end gap-2 border-t border-borde pt-4">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          {!edicion && (
            <Button variant="secondary" disabled={!valido} onClick={() => guardar(true)}>Guardar y crear otro</Button>
          )}
          <Button disabled={!valido} onClick={() => guardar(false)}>Guardar</Button>
        </div>
      </div>

      <Modal open={!!confirmSuper} onClose={() => setConfirmSuper(false)} title="Confirmar acceso de superadministrador">
        <div className="space-y-4">
          <Note tone="alerta">
            Estás por dar a <b>{personaSel?.nombre}</b> un perfil con la <b>marca de superadministrador</b>: operará
            sobre todo el grupo, en todos los módulos, y podrá crear otros superadministradores.
          </Note>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmSuper(false)}>Cancelar</Button>
            <Button variant="danger" onClick={() => { const otro = confirmSuper === "otro"; setConfirmSuper(false); persistir(otro); }}>
              Entiendo, conceder
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export default function Usuarios() {
  const { db, suspenderUsuarioAdmin, reactivarUsuarioAdmin, reenviarClave } = useApp();
  const [search] = useSearchParams();

  const [fPerfil, setFPerfil] = useState(search.get("perfil") ?? "");
  const [fEmpresa, setFEmpresa] = useState("");
  const [fEstado, setFEstado] = useState("todos");
  const [fAcceso, setFAcceso] = useState("todos");
  const [busca, setBusca] = useState("");
  const [form, setForm] = useState(null);        // null | { usuario: obj|null }
  const [claveModal, setClaveModal] = useState(null); // { nombre, clave, correo }

  const usuarios = db.usuariosAdmin;
  const superadminsActivos = usuarios.filter((u) => u.esSuperadmin && u.estado === "activo");

  const filtrados = usuarios.filter((u) => {
    if (fPerfil && u.perfil !== fPerfil) return false;
    if (fEmpresa && !u.esSuperadmin && !u.empresas.includes(fEmpresa)) return false;
    if (fEstado !== "todos" && u.estado !== fEstado) return false;
    if (fAcceso === "superadmin" && !u.esSuperadmin) return false;
    if (fAcceso === "estandar" && u.esSuperadmin) return false;
    const q = busca.trim().toLowerCase();
    if (q && !u.dni.includes(q) && !u.nombre.toLowerCase().includes(q) && !(u.correo ?? "").toLowerCase().includes(q)) return false;
    return true;
  });

  const inconsistente = (u) => u.inconsistencia || (u.estado === "activo" && db.personal.find((p) => p.dni === u.dni)?.estado === "cesado");

  const alcanceTexto = (u) => {
    if (u.esSuperadmin) return null;
    const cortos = u.empresas.map((id) => db.empresas.find((e) => e.id === id)?.corto ?? id);
    const sedes = u.sedes.length
      ? u.sedes.map((id) => db.sedes.find((s) => s.id === id)?.nombre ?? id).join(", ")
      : "Todas las sedes";
    return { cortos, sedes };
  };

  const reenviar = (u) => {
    const clave = genClave();
    reenviarClave(u.id, clave);
    setClaveModal({ nombre: u.nombre, clave, correo: u.correo });
  };

  const exportar = () => {
    const head = ["DNI", "Nombre", "Perfil", "Razones sociales", "Sedes", "Correo", "Último ingreso", "Estado"];
    const rows = filtrados.map((u) => {
      const a = alcanceTexto(u);
      return [u.dni, u.nombre, u.perfilNombre, u.esSuperadmin ? "Todo el grupo" : a.cortos.join(" · "),
        u.esSuperadmin ? "Todas" : a.sedes, u.correo ?? "", u.ultimoIngreso ?? "Nunca ingresó", u.estado];
    });
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = "usuarios-administrativos.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <PageHeader
        code="ACC-01"
        title="Usuarios administrativos"
        subtitle="Quién tiene acceso al BackOffice, con qué perfil y sobre qué razones sociales. El Trabajador no se administra aquí: entra al Portal con su DNI y ve solo lo suyo."
        actions={
          <>
            <Button variant="secondary" onClick={exportar}><Download size={14} /> Exportar</Button>
            <Button onClick={() => setForm({ usuario: null })}><Plus size={14} /> Nuevo usuario</Button>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap gap-3">
        <Stat label="Activos" value={usuarios.filter((u) => u.estado === "activo").length} tone="conf" />
        <Stat label="Suspendidos" value={usuarios.filter((u) => u.estado === "suspendido").length} />
        <Stat label="Superadministradores" value={superadminsActivos.length} tone="pend" hint="El número que nadie debería descubrir por accidente." />
        <Stat label="Nunca ingresaron" value={usuarios.filter((u) => u.nuncaIngreso).length} tone="alerta" />
      </div>

      <Card className="mb-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Input placeholder="Buscar por DNI, nombre o correo…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <Select value={fPerfil} onChange={(e) => setFPerfil(e.target.value)}>
            <option value="">Todos los perfiles</option>
            {db.perfiles.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </Select>
          <Select value={fEmpresa} onChange={(e) => setFEmpresa(e.target.value)}>
            <option value="">Todas las razones sociales</option>
            {db.empresas.map((e) => <option key={e.id} value={e.id}>{e.corto}</option>)}
          </Select>
          <Select value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
            <option value="todos">Todos los estados</option>
            <option value="activo">Activos</option>
            <option value="suspendido">Suspendidos</option>
          </Select>
          <Select value={fAcceso} onChange={(e) => setFAcceso(e.target.value)}>
            <option value="todos">Todo tipo de acceso</option>
            <option value="superadmin">Superadministradores</option>
            <option value="estandar">Acceso estándar</option>
          </Select>
        </div>
      </Card>

      <Card pad={false}>
        {filtrados.length === 0 ? (
          <EmptyState title="Sin resultados" body="Ajusta los filtros o la búsqueda." />
        ) : (
          <Table head={["Usuario", "Perfil", "Alcance", "Último ingreso", "Estado", "Acciones"]}>
            {filtrados.map((u) => {
              const a = alcanceTexto(u);
              const esUltimoSuper = u.esSuperadmin && u.estado === "activo" && superadminsActivos.length === 1;
              return (
                <tr key={u.id} className="hover:bg-papel/60">
                  <Td>
                    <div className="flex items-center gap-2 font-semibold text-tinta">
                      {u.nombre}
                      {u.esSuperadmin && <Badge tone="tinta"><ShieldCheck size={11} /> Superadmin</Badge>}
                      {inconsistente(u) && <Badge tone="alerta">Vínculo cesado</Badge>}
                    </div>
                    <div className="font-mono text-[11px] text-gris-cl">DNI {u.dni}{u.correo ? ` · ${u.correo}` : ""}</div>
                  </Td>
                  <Td>{u.perfilNombre}</Td>
                  <Td>
                    {u.esSuperadmin ? (
                      <span className="text-[12px] font-semibold text-pend">Todo el grupo</span>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-1">{a.cortos.map((c) => <Badge key={c} tone="neutral">{c}</Badge>)}</div>
                        <div className="mt-0.5 text-[11px] text-gris-cl">{a.sedes}</div>
                      </>
                    )}
                  </Td>
                  <Td>
                    {u.nuncaIngreso ? <Badge tone="pend">Nunca ingresó</Badge> : <span className="text-[12px]">{u.ultimoIngreso}</span>}
                  </Td>
                  <Td>{u.estado === "activo" ? <Badge tone="conf">Activo</Badge> : <Badge tone="neutral">Suspendido</Badge>}</Td>
                  <Td className="whitespace-nowrap">
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setForm({ usuario: u })}><Pencil size={12} /> Editar</Button>
                      {u.estado === "activo" ? (
                        <Button
                          size="sm" variant="ghost" disabled={esUltimoSuper}
                          title={esUltimoSuper ? "No se puede suspender al único superadministrador activo." : undefined}
                          onClick={() => suspenderUsuarioAdmin(u.id)}
                        >
                          <Ban size={12} /> Suspender
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => reactivarUsuarioAdmin(u.id)}><RotateCcw size={12} /> Reactivar</Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => reenviar(u)}><Send size={12} /> Reenviar clave</Button>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.usuario ? `Editar usuario — ${form.usuario.nombre}` : "Nuevo usuario administrativo"}
        wide
      >
        {form && (
          <FormUsuario
            usuario={form.usuario}
            onClose={() => setForm(null)}
            onClave={setClaveModal}
            onEditar={(u) => setForm({ usuario: u })}
          />
        )}
      </Modal>

      <Modal open={!!claveModal} onClose={() => setClaveModal(null)} title="Clave provisional generada">
        {claveModal && (
          <div className="space-y-4">
            <div className="rounded-caja border border-borde bg-papel px-4 py-5 text-center">
              <KeyRound size={18} className="mx-auto mb-2 text-petroleo" />
              <div className="font-mono text-[22px] font-bold tracking-[0.2em] text-tinta">{claveModal.clave}</div>
              <div className="mt-1 text-[11.5px] text-gris-cl">Clave de un solo uso para {claveModal.nombre}. Deberá reemplazarla en el primer ingreso.</div>
            </div>
            {claveModal.correo ? (
              <Note tone="conf">Se envió al correo <b>{claveModal.correo}</b>.</Note>
            ) : (
              <Note tone="pend">La persona no tiene correo registrado: entrega la clave <b>presencialmente</b>. Queda registrado que se entregó en pantalla.</Note>
            )}
            <div className="flex justify-end">
              <Button onClick={() => setClaveModal(null)}>Entendido</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
