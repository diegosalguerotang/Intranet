import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, ShieldCheck, Send, Pencil, Ban, RotateCcw, Download, KeyRound, Trash2 } from "lucide-react";
import { useApp } from "../../state";
import { PageHeader, Card, Stat, Table, Td, Badge, Button, Field, Input, Select, Modal, Note, EmptyState } from "../../components/ui";
import { MODULOS, NIVELES, nivelDe } from "../../data/modulos";

// ACC-02 · Alta y edición de usuario administrativo (modal). Accesos v2: el
// usuario HEREDA su categoría tal cual (módulos + razones sociales); el
// código U-000N y la cuenta de ingreso los asignan la BD y el serverless.
function FormUsuario({ usuario, onClose, onClave, onEditar }) {
  const { db, crearUsuarioAdmin, actualizarUsuarioAdmin } = useApp();
  const edicion = !!usuario;

  const [busca, setBusca] = useState("");
  const [personaSel, setPersonaSel] = useState(edicion ? db.personal.find((p) => p.dni === usuario.dni) ?? { dni: usuario.dni, nombre: usuario.nombre } : null);
  const [correo, setCorreo] = useState(usuario?.correo ?? "");
  const [celular, setCelular] = useState(usuario?.celular ?? "");
  const [perfilId, setPerfilId] = useState(usuario?.perfil ?? "");
  const [estado, setEstado] = useState(usuario?.estado ?? "activo");
  const [confirmSuper, setConfirmSuper] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState(null);

  const coincidencias = busca.trim().length >= 2
    ? db.personal.filter((p) => p.dni.includes(busca.trim()) || p.nombre.toLowerCase().includes(busca.trim().toLowerCase())).slice(0, 6)
    : [];

  const existente = !edicion && personaSel ? db.usuariosAdmin.find((u) => u.dni === personaSel.dni) : null;
  const perfilObj = db.perfiles.find((p) => p.id === perfilId);
  const esSuper = perfilObj?.esSuperadmin ?? false;
  const cesado = personaSel?.estado === "cesado";
  const valido = personaSel && perfilObj && !existente;

  const persistir = async (otro = false) => {
    if (edicion) {
      actualizarUsuarioAdmin(usuario.id, {
        perfil: perfilId, perfilNombre: perfilObj.nombre, esSuperadmin: esSuper,
        correo: correo.trim() || null, celular: celular.trim() || null, estado,
      });
      onClose();
      return;
    }
    setGuardando(true);
    setErrorGuardar(null);
    const r = await crearUsuarioAdmin({
      dni: personaSel.dni, perfil: perfilId,
      correo: correo.trim() || null, celular: celular.trim() || null,
    });
    setGuardando(false);
    if (r.error) { setErrorGuardar(r.error); return; }
    onClave({
      nombre: personaSel.nombre, clave: r.clave, correo: correo.trim() || null,
      codigo: r.codigo, creado: r.creado, errorCuenta: r.errorCuenta,
      enviadoCorreo: r.enviadoCorreo, avisoCorreo: r.avisoCorreo,
    });
    if (otro) {
      setBusca(""); setPersonaSel(null); setCorreo(""); setCelular(""); setPerfilId("");
    } else {
      onClose();
    }
  };

  const guardar = (otro = false) => {
    if (!valido || guardando) return;
    // La concesión de la marca de superadministrador exige confirmación
    // explícita en una segunda pantalla.
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
                        onClick={() => {
                          setPersonaSel(p);
                          // Los datos ya registrados en Personal se jalan al
                          // formulario; siguen siendo editables aquí.
                          setCelular((c) => c || p.celular || "");
                          setCorreo((c) => c || p.correo || "");
                        }}
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

        {edicion && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-caja border border-borde bg-papel/60 px-3.5 py-2.5 text-[12px] text-gris sm:grid-cols-4">
            <div><span className="block text-[10px] font-semibold uppercase tracking-wide text-gris-cl">Código de usuario</span><span className="font-mono font-semibold text-tinta">{usuario.codigo ?? "—"}</span></div>
            <div><span className="block text-[10px] font-semibold uppercase tracking-wide text-gris-cl">Fecha de registro</span>{usuario.creado ?? "—"}</div>
            <div><span className="block text-[10px] font-semibold uppercase tracking-wide text-gris-cl">DNI</span><span className="font-mono">{usuario.dni}</span></div>
            <div><span className="block text-[10px] font-semibold uppercase tracking-wide text-gris-cl">Último ingreso</span>{usuario.ultimoIngreso ?? "Nunca"}</div>
          </div>
        )}

        {personaSel && personaSel.cargo && !edicion && (
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

        <Field label="Categoría" required hint="La categoría define módulos y razones sociales; el usuario la hereda tal cual.">
          <Select value={perfilId} onChange={(e) => setPerfilId(e.target.value)}>
            <option value="">— Elegir categoría —</option>
            {db.perfiles.filter((p) => p.estado === "activo").map((p) => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
            ))}
          </Select>
        </Field>

        {perfilObj && (
          <div className="rounded-caja border border-borde bg-papel/60 p-3.5">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gris-cl">Accesos que hereda de la categoría</div>
            {esSuper ? (
              <Badge tone="tinta"><ShieldCheck size={11} /> Superadministrador — todo el grupo, todos los módulos</Badge>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {MODULOS.filter((m) => (perfilObj.matriz?.[m.id] ?? 0) > 0).map((m) => (
                    <Badge key={m.id} tone="neutral">{m.nombre}: {NIVELES[perfilObj.matriz[m.id]]}</Badge>
                  ))}
                  {MODULOS.every((m) => (perfilObj.matriz?.[m.id] ?? 0) === 0) && (
                    <span className="text-[11.5px] italic text-gris-cl">Sin acceso a ningún módulo.</span>
                  )}
                </div>
                <div className="mb-1.5 mt-3 text-[11px] font-bold uppercase tracking-wide text-gris-cl">Razones sociales</div>
                <div className="flex flex-wrap gap-1.5">
                  {(perfilObj.empresas ?? []).map((eid) => (
                    <Badge key={eid} tone="conf">{db.empresas.find((e) => e.id === eid)?.corto ?? eid}</Badge>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Correo de contacto" hint="Con correo se crea su cuenta de ingreso al guardar; sin correo, el usuario queda registrado pero no puede iniciar sesión.">
            <Input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} placeholder="usuario@grupoer.pe" />
          </Field>
          <Field label="Celular de contacto">
            {/* Campo LIBRE: acepta +51 y espacios, se guarda tal cual. */}
            <Input value={celular} onChange={(e) => setCelular(e.target.value)} placeholder="987 654 321 o +51 987 654 321" />
          </Field>
        </div>

        {edicion && (
          <Field label="Estado" hint="Suspender corta el acceso de inmediato; no borra nada de lo que el usuario hizo.">
            <Select value={estado} onChange={(e) => setEstado(e.target.value)}>
              <option value="activo">Activo</option>
              <option value="suspendido">Suspendido</option>
            </Select>
          </Field>
        )}

        {errorGuardar && <Note tone="alerta">{errorGuardar}</Note>}

        <div className="flex justify-end gap-2 border-t border-borde pt-4">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          {!edicion && (
            <Button variant="secondary" disabled={!valido || guardando} onClick={() => guardar(true)}>Guardar y crear otro</Button>
          )}
          <Button disabled={!valido || guardando} onClick={() => guardar(false)}>
            {guardando ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>

      <Modal open={!!confirmSuper} onClose={() => setConfirmSuper(false)} title="Confirmar acceso de superadministrador">
        <div className="space-y-4">
          <Note tone="alerta">
            Estás por dar a <b>{personaSel?.nombre}</b> una categoría con la <b>marca de superadministrador</b>:
            operará sobre todo el grupo, en todos los módulos, y podrá crear otros superadministradores.
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
  const { db, user, suspenderUsuarioAdmin, reactivarUsuarioAdmin, reenviarClaveCuenta, eliminarUsuarioAdmin } = useApp();
  const [search] = useSearchParams();

  const [fPerfil, setFPerfil] = useState(search.get("perfil") ?? "");
  const [fEmpresa, setFEmpresa] = useState("");
  const [fEstado, setFEstado] = useState("todos");
  const [fAcceso, setFAcceso] = useState("todos");
  const [busca, setBusca] = useState("");
  const [form, setForm] = useState(null);          // null | { usuario: obj|null }
  const [claveModal, setClaveModal] = useState(null); // { nombre, clave?, correo?, codigo?, creado?, errorCuenta?, error? }
  const [eliminar, setEliminar] = useState(null);  // usuario a eliminar
  const [confirmTexto, setConfirmTexto] = useState("");
  const [eliminando, setEliminando] = useState(false);
  const [errorEliminar, setErrorEliminar] = useState(null);

  const usuarios = db.usuariosAdmin;
  const superadminsActivos = usuarios.filter((u) => u.esSuperadmin && u.estado === "activo");
  // Eliminar definitivamente exige nivel de aprobación en Accesos (o la marca).
  const puedeEliminar = nivelDe(user?.acceso ?? { esSuperadmin: user?.esSuperadmin }, "accesos") >= 3;

  const filtrados = usuarios.filter((u) => {
    if (fPerfil && u.perfil !== fPerfil) return false;
    if (fEmpresa && !u.esSuperadmin && !(u.empresas ?? []).includes(fEmpresa)) return false;
    if (fEstado !== "todos" && u.estado !== fEstado) return false;
    if (fAcceso === "superadmin" && !u.esSuperadmin) return false;
    if (fAcceso === "estandar" && u.esSuperadmin) return false;
    const q = busca.trim().toLowerCase();
    if (q && !u.dni.includes(q) && !u.nombre.toLowerCase().includes(q) && !(u.correo ?? "").toLowerCase().includes(q) && !(u.codigo ?? "").toLowerCase().includes(q)) return false;
    return true;
  });

  const inconsistente = (u) => u.inconsistencia || (u.estado === "activo" && db.personal.find((p) => p.dni === u.dni)?.estado === "cesado");

  const alcance = (u) =>
    u.esSuperadmin ? null : (u.empresas ?? []).map((id) => db.empresas.find((e) => e.id === id)?.corto ?? id);

  const reenviar = async (u) => {
    const r = await reenviarClaveCuenta(u.id);
    setClaveModal(r.error
      ? { nombre: u.nombre, error: r.error }
      : { nombre: u.nombre, clave: r.clave, correo: u.correo,
          enviadoCorreo: r.enviadoCorreo, avisoCorreo: r.avisoCorreo });
  };

  const ejecutarEliminar = async () => {
    if (confirmTexto !== "ELIMINAR" || eliminando) return;
    setEliminando(true);
    setErrorEliminar(null);
    const r = await eliminarUsuarioAdmin(eliminar.id);
    setEliminando(false);
    if (r.error) { setErrorEliminar(r.error); return; }
    setEliminar(null);
    setConfirmTexto("");
  };

  const exportar = () => {
    const head = ["Código", "DNI", "Nombre", "Categoría", "Razones sociales", "Correo", "Fecha de registro", "Último ingreso", "Estado"];
    const rows = filtrados.map((u) => [
      u.codigo ?? "", u.dni, u.nombre, u.perfilNombre,
      u.esSuperadmin ? "Todo el grupo" : (alcance(u) ?? []).join(" · "),
      u.correo ?? "", u.creado ?? "", u.ultimoIngreso ?? "Nunca ingresó", u.estado,
    ]);
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
        subtitle="Quién tiene acceso al BackOffice y con qué categoría. Los accesos por módulo y razón social se heredan de la categoría y se aplican desde el ingreso."
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
          <Input placeholder="Buscar por código, DNI, nombre o correo…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <Select value={fPerfil} onChange={(e) => setFPerfil(e.target.value)}>
            <option value="">Todas las categorías</option>
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
          <Table head={["Código", "Usuario", "Categoría", "Razones sociales", "Último ingreso", "Estado", "Acciones"]}>
            {filtrados.map((u) => {
              const esUltimoSuper = u.esSuperadmin && u.estado === "activo" && superadminsActivos.length === 1;
              const soyYo = user?.id === u.id;
              return (
                <tr key={u.id} className="hover:bg-papel/60">
                  <Td><span className="font-mono text-[12px] font-semibold text-tinta">{u.codigo ?? "—"}</span></Td>
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
                      <div className="flex flex-wrap gap-1">{(alcance(u) ?? []).map((c) => <Badge key={c} tone="neutral">{c}</Badge>)}</div>
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
                      <Button size="sm" variant="ghost" onClick={() => reenviar(u)}><Send size={12} /> Restablecer clave</Button>
                      {puedeEliminar && (
                        <Button
                          size="sm" variant="ghost" disabled={esUltimoSuper || soyYo}
                          className="text-alerta hover:bg-alerta-bg"
                          title={soyYo ? "No puedes eliminarte a ti mismo." : esUltimoSuper ? "No se puede eliminar al único superadministrador activo." : undefined}
                          onClick={() => { setEliminar(u); setConfirmTexto(""); setErrorEliminar(null); }}
                        >
                          <Trash2 size={12} /> Eliminar
                        </Button>
                      )}
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

      <Modal open={!!claveModal} onClose={() => setClaveModal(null)} title="Usuario y cuenta de ingreso">
        {claveModal && (
          <div className="space-y-4">
            {(claveModal.codigo || claveModal.creado) && (
              <div className="grid grid-cols-2 gap-4 rounded-caja border border-borde bg-papel/60 px-3.5 py-2.5 text-[12px] text-gris">
                <div><span className="block text-[10px] font-semibold uppercase tracking-wide text-gris-cl">Código de usuario</span><span className="font-mono text-[15px] font-bold text-tinta">{claveModal.codigo ?? "—"}</span></div>
                <div><span className="block text-[10px] font-semibold uppercase tracking-wide text-gris-cl">Fecha de registro</span>{claveModal.creado ?? "—"}</div>
              </div>
            )}
            {claveModal.error && <Note tone="alerta">{claveModal.error}</Note>}
            {claveModal.errorCuenta && (
              <Note tone="alerta">El usuario se registró, pero su cuenta de ingreso falló: {claveModal.errorCuenta}. Usa «Restablecer clave» para reintentar.</Note>
            )}
            {claveModal.clave ? (
              <>
                <div className="rounded-caja border border-borde bg-papel px-4 py-5 text-center">
                  <KeyRound size={18} className="mx-auto mb-2 text-petroleo" />
                  <div className="font-mono text-[22px] font-bold tracking-[0.15em] text-tinta">{claveModal.clave}</div>
                  <div className="mt-1 text-[11.5px] text-gris-cl">Clave provisional para {claveModal.nombre}. Deberá reemplazarla en su primer ingreso.</div>
                </div>
                {claveModal.enviadoCorreo ? (
                  <Note tone="conf">El acceso también <b>se envió por correo</b> a {claveModal.enviadoCorreo}.</Note>
                ) : claveModal.correo ? (
                  <Note tone="pend">
                    Entrégala a <b>{claveModal.correo}</b> en mano.
                    {claveModal.avisoCorreo && <> No se pudo enviar por correo: {claveModal.avisoCorreo}</>}
                  </Note>
                ) : (
                  <Note tone="pend">La persona no tiene correo registrado: entrega la clave <b>presencialmente</b>.</Note>
                )}
              </>
            ) : (
              !claveModal.error && !claveModal.errorCuenta && (
                <Note tone="pend">
                  {claveModal.nombre} quedó registrado <b>sin cuenta de ingreso</b> (no tiene correo). Regístrale un
                  correo con «Editar» y luego usa «Restablecer clave» para crearla.
                </Note>
              )
            )}
            <div className="flex justify-end">
              <Button onClick={() => setClaveModal(null)}>Entendido</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!eliminar} onClose={() => { setEliminar(null); setConfirmTexto(""); }} title={`Eliminar definitivamente a ${eliminar?.nombre}`}>
        {eliminar && (
          <div className="space-y-4">
            <Note tone="alerta">
              Esta acción <b>no se puede deshacer</b>: se elimina el usuario <b>{eliminar.codigo}</b> y su cuenta de
              ingreso para siempre. Sus ingresos históricos quedan en el Registro de accesos (ACC-06) con su nombre y
              DNI. Si solo quieres cortarle el acceso, usa <b>Suspender</b>.
            </Note>
            <Field label={<>Escribe <b>ELIMINAR</b> para confirmar</>}>
              <Input value={confirmTexto} onChange={(e) => setConfirmTexto(e.target.value)} placeholder="ELIMINAR" autoFocus />
            </Field>
            {errorEliminar && <Note tone="alerta">{errorEliminar}</Note>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => { setEliminar(null); setConfirmTexto(""); }}>Cancelar</Button>
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
