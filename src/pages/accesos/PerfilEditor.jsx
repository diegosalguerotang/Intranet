import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Save, Copy, History, ShieldCheck } from "lucide-react";
import { useApp } from "../../state";
import { PageHeader, Card, Button, Field, Input, Textarea, Select, Badge, Modal, Note, EmptyState } from "../../components/ui";
import { MODULOS, NIVELES, CASILLAS } from "../../data/modulos";

const slug = (s) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// Resumen en lenguaje natural: requisito, no adorno. Quien crea perfiles no
// siempre lee matrices, y una casilla marcada por error es invisible en una
// tabla de once filas.
function ResumenNatural({ superadmin, matriz, casillas }) {
  if (superadmin) {
    return (
      <Note tone="pend">
        Quien tenga este perfil opera sobre <b>todo el grupo, en todos los módulos</b>, ignora la matriz y el
        alcance, y es el único que puede crear otros superadministradores.
      </Note>
    );
  }
  const frases = [];
  MODULOS.forEach((m) => {
    const n = matriz[m.id] ?? 0;
    if (n === 1) frases.push(`En ${m.nombre} solo puede ${m.ver}.`);
    if (n >= 2) frases.push(`En ${m.nombre} puede ${m.ver}, y también ${m.accionar}${n === 3 ? `; además puede ${m.aprobar}` : ""}.`);
  });
  CASILLAS.forEach((c) => { if (casillas[c.id]) frases.push(`${c.nombre}: ${c.detalle.toLowerCase()}.`); });
  if (!frases.length) {
    return <Note tone="neutral">Este perfil no concede ningún acceso. Solo sirve como base para duplicar.</Note>;
  }
  return (
    <ul className="space-y-2 text-[12.5px] leading-relaxed text-gris">
      {frases.map((f, i) => (
        <li key={i} className="border-l-2 border-borde pl-2.5">{f}</li>
      ))}
    </ul>
  );
}

export default function PerfilEditor() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { db, guardarPerfil } = useApp();

  const nuevo = id === "nuevo";
  const base = nuevo ? db.perfiles.find((p) => p.id === search.get("desde")) : db.perfiles.find((p) => p.id === id);

  const [nombre, setNombre] = useState(nuevo ? (base ? `${base.nombre} (copia)` : "") : base?.nombre ?? "");
  const [descripcion, setDescripcion] = useState(base?.descripcion ?? "");
  const [superadmin, setSuperadmin] = useState(nuevo ? false : base?.esSuperadmin ?? false);
  const [matriz, setMatriz] = useState(() => Object.fromEntries(MODULOS.map((m) => [m.id, base?.matriz?.[m.id] ?? 0])));
  const [casillas, setCasillas] = useState({
    verRemuneracion: base?.verRemuneracion ?? false,
    verDocumentosTerceros: base?.verDocumentosTerceros ?? false,
    exportarDatosPersonales: base?.exportarDatosPersonales ?? false,
  });
  const [paso, setPaso] = useState(null); // "superadmin" | "cambios"
  const [historial, setHistorial] = useState(false);

  if (!nuevo && !base) {
    return (
      <>
        <PageHeader code="ACC-04" title="Constructor de perfil" />
        <EmptyState title="El perfil no existe" body="Vuelve al catálogo y elige un perfil, o crea uno nuevo." />
      </>
    );
  }

  const idActual = nuevo ? slug(nombre || "perfil") : id;
  const nombreRepetido = db.perfiles.some(
    (p) => p.nombre.trim().toLowerCase() === nombre.trim().toLowerCase() && (nuevo || p.id !== id)
  );
  const todoSinAcceso = !superadmin && MODULOS.every((m) => (matriz[m.id] ?? 0) === 0);
  const afectados = !nuevo ? base.usuarios : 0;

  // Diff contra la versión vigente: qué ganan o pierden los usuarios asignados.
  const cambios = [];
  if (!nuevo) {
    if (base.esSuperadmin !== superadmin) {
      cambios.push(superadmin ? "Pasa a ser superadministrador (la matriz deja de aplicar)" : "Deja de ser superadministrador (la matriz vuelve a aplicar)");
    }
    if (!superadmin) {
      MODULOS.forEach((m) => {
        const antes = base.esSuperadmin ? null : base.matriz?.[m.id] ?? 0;
        const ahora = matriz[m.id] ?? 0;
        if (antes !== null && antes !== ahora) cambios.push(`${m.nombre}: ${NIVELES[antes]} → ${NIVELES[ahora]}`);
      });
    }
    CASILLAS.forEach((c) => {
      const antes = base[c.id] ?? false;
      if (antes !== casillas[c.id]) cambios.push(`${casillas[c.id] ? "Gana" : "Pierde"} «${c.nombre}»`);
    });
  }

  // Módulos que quedarían sin ningún perfil activo con nivel de aprobación.
  // Excepción: accesos — el invariante del superadministrador lo cubre el servidor.
  const sinAprobador = !nuevo && !superadmin
    ? MODULOS.filter((m) =>
        m.aprobacion && m.id !== "accesos" &&
        (base.matriz?.[m.id] ?? 0) === 3 && (matriz[m.id] ?? 0) < 3 &&
        !db.perfiles.some((p) => p.id !== id && p.estado === "activo" && !p.esSuperadmin && (p.matriz?.[m.id] ?? 0) === 3)
      )
    : [];

  const valido = nombre.trim().length > 0 && !nombreRepetido;

  const persistir = () => {
    guardarPerfil({
      id: idActual,
      nombre: nombre.trim(),
      descripcion: descripcion.trim(),
      esSuperadmin: superadmin,
      verRemuneracion: casillas.verRemuneracion,
      verDocumentosTerceros: casillas.verDocumentosTerceros,
      exportarDatosPersonales: casillas.exportarDatosPersonales,
      matriz: superadmin ? {} : matriz,
    });
    navigate("/accesos/perfiles");
  };

  const guardar = () => {
    if (!valido) return;
    const exigeConfirmSuper = superadmin && (nuevo || !base.esSuperadmin);
    if (exigeConfirmSuper) setPaso("superadmin");
    else if (afectados > 0 && cambios.length > 0) setPaso("cambios");
    else persistir();
  };

  const confirmarPaso = () => {
    if (paso === "superadmin" && afectados > 0 && cambios.length > 0) setPaso("cambios");
    else { setPaso(null); persistir(); }
  };

  const aplicarTodos = (nivel) => {
    setMatriz(Object.fromEntries(MODULOS.map((m) => [m.id, Math.min(nivel, m.aprobacion ? 3 : 2)])));
  };

  const versiones = db.perfilVersiones.filter((v) => v.perfilId === id);

  return (
    <>
      <PageHeader
        code="ACC-04"
        title={nuevo ? "Nuevo perfil" : `Perfil: ${base.nombre}`}
        subtitle="El perfil responde a qué puede hacer alguien, nunca a sobre quiénes. Es del Grupo: un mismo perfil sirve para todas las razones sociales."
        actions={
          <>
            {!nuevo && (
              <>
                <Button variant="secondary" onClick={() => setHistorial(true)}><History size={14} /> Historial</Button>
                <Button variant="secondary" onClick={() => navigate(`/accesos/perfiles/nuevo?desde=${id}`)}><Copy size={14} /> Duplicar</Button>
              </>
            )}
            <Button variant="ghost" onClick={() => navigate("/accesos/perfiles")}>Cancelar</Button>
            <Button onClick={guardar} disabled={!valido}><Save size={14} /> Guardar versión</Button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Card>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nombre del perfil" required hint="Único en el sistema.">
                <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: RRHH operativo — solo NEGLIAF" />
              </Field>
              <Field label="Descripción breve" hint="Para qué sirve y a quién se le da.">
                <Input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej.: Analistas que publican boletas" />
              </Field>
            </div>
            {nombreRepetido && (
              <div className="mt-3">
                <Note tone="alerta">Ya existe otro perfil con ese nombre. El nombre del perfil es único en el sistema.</Note>
              </div>
            )}
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-caja border border-borde bg-papel/60 p-3.5">
              <input
                type="checkbox"
                checked={superadmin}
                onChange={(e) => setSuperadmin(e.target.checked)}
                className="mt-0.5 accent-pend"
              />
              <span>
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-tinta">
                  <ShieldCheck size={14} className="text-pend" /> Marca de superadministrador
                </span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-gris-cl">
                  No es un nivel más de la matriz: quien la tiene ignora la matriz y el alcance. Su concesión exige
                  confirmación explícita.
                </span>
              </span>
            </label>
          </Card>

          {superadmin ? (
            <Note tone="pend">
              La matriz queda <b>colapsada e inaplicable</b>: no se guarda una matriz junto a la marca, porque sería
              una configuración que no se evalúa nunca y que alguien leería años después como si significara algo.
            </Note>
          ) : (
            <Card pad={false}>
              <div className="flex items-center justify-between gap-3 border-b border-borde px-5 py-3">
                <h2 className="text-[13px] font-bold text-tinta">Matriz de módulos</h2>
                <div className="flex items-center gap-2 text-[12px] text-gris-cl">
                  Aplicar a todos:
                  <select
                    className="rounded-caja border border-borde-f bg-white px-2 py-1 text-[12px] text-gris focus:border-petroleo focus:outline-none"
                    value=""
                    onChange={(e) => { if (e.target.value !== "") aplicarTodos(Number(e.target.value)); }}
                  >
                    <option value="">—</option>
                    {NIVELES.map((n, i) => <option key={i} value={i}>{n}</option>)}
                  </select>
                </div>
              </div>
              <div className="divide-y divide-borde">
                {MODULOS.map((m) => (
                  <div key={m.id} className="flex items-center gap-4 px-5 py-2.5">
                    <div className="flex-1">
                      <div className="text-[13px] font-semibold text-tinta">{m.nombre}</div>
                      <div className="text-[11px] leading-snug text-gris-cl">Solo ver: {m.ver}</div>
                    </div>
                    <select
                      className="w-[210px] rounded-caja border border-borde-f bg-white px-2.5 py-1.5 text-[12.5px] text-gris focus:border-petroleo focus:outline-none"
                      value={matriz[m.id]}
                      onChange={(e) => setMatriz((mx) => ({ ...mx, [m.id]: Number(e.target.value) }))}
                    >
                      {NIVELES.slice(0, m.aprobacion ? 4 : 3).map((n, i) => (
                        <option key={i} value={i}>{i} · {n}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {!superadmin && (
            <Card>
              <h2 className="mb-3 text-[13px] font-bold text-tinta">Casillas especiales</h2>
              <p className="mb-3 text-[11.5px] text-gris-cl">
                Permisos que atraviesan varios módulos. Ninguno se concede por defecto; su uso se registra en
                auditoría, tenga el usuario el permiso o no.
              </p>
              <div className="space-y-2.5">
                {CASILLAS.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={casillas[c.id]}
                      onChange={(e) => setCasillas((cs) => ({ ...cs, [c.id]: e.target.checked }))}
                      className="mt-0.5 accent-petroleo"
                    />
                    <span>
                      <span className="block text-[12.5px] font-semibold text-tinta-2">{c.nombre}</span>
                      <span className="block text-[11.5px] leading-snug text-gris-cl">{c.detalle}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Card>
          )}

          {todoSinAcceso && (
            <Note tone="pend">
              Todos los módulos están en «Sin acceso». Se puede guardar así: sirve como base para duplicar.
            </Note>
          )}
          {sinAprobador.length > 0 && (
            <Note tone="pend">
              Con este cambio, ningún perfil activo tendría nivel de aprobación en:{" "}
              <b>{sinAprobador.map((m) => m.nombre).join(", ")}</b>. Se advierte, no se impide.
            </Note>
          )}
        </div>

        <div className="space-y-5">
          <Card>
            <h2 className="mb-3 text-[13px] font-bold text-tinta">Qué podrá hacer alguien con este perfil</h2>
            <ResumenNatural superadmin={superadmin} matriz={matriz} casillas={casillas} />
          </Card>
          {!nuevo && (
            <Card>
              <div className="flex items-center justify-between">
                <h2 className="text-[13px] font-bold text-tinta">Versión vigente</h2>
                <Badge tone="neutral">v{base.version}</Badge>
              </div>
              <p className="mt-2 text-[11.5px] leading-snug text-gris-cl">
                Cada guardado crea una versión nueva con su autor y su fecha; las anteriores se conservan. La
                auditoría referencia la versión vigente al momento de cada acción.
              </p>
              {afectados > 0 && (
                <p className="mt-2 text-[12px] text-gris">
                  <b>{afectados}</b> usuario(s) usan este perfil y pasarán a la versión nueva en su siguiente
                  petición.
                </p>
              )}
            </Card>
          )}
        </div>
      </div>

      {/* Confirmación explícita de la marca de superadministrador (segunda pantalla) */}
      <Modal open={paso === "superadmin"} onClose={() => setPaso(null)} title="Confirmar marca de superadministrador">
        <div className="space-y-4">
          <Note tone="alerta">
            Estás por guardar un perfil con la <b>marca de superadministrador</b>. Quien lo tenga asignado operará
            sobre todo el grupo, en todos los módulos, sin alcance que lo limite, y podrá crear otros
            superadministradores.
          </Note>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPaso(null)}>Cancelar</Button>
            <Button variant="danger" onClick={confirmarPaso}>Entiendo, continuar</Button>
          </div>
        </div>
      </Modal>

      {/* Aviso de usuarios afectados al guardar un perfil en uso */}
      <Modal open={paso === "cambios"} onClose={() => setPaso(null)} title="Usuarios afectados por esta versión">
        <div className="space-y-4">
          <Note tone="pend">
            <b>{afectados}</b> usuario(s) tienen asignado este perfil. Al guardar, pasarán a la versión nueva en su
            siguiente petición al servidor (no en su siguiente ingreso).
          </Note>
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-tinta-2">Qué cambia:</div>
            <ul className="max-h-[220px] space-y-1 overflow-y-auto text-[12.5px] text-gris">
              {cambios.map((c, i) => (
                <li key={i} className="border-l-2 border-borde pl-2.5">{c}</li>
              ))}
            </ul>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPaso(null)}>Cancelar</Button>
            <Button onClick={confirmarPaso}>Guardar versión</Button>
          </div>
        </div>
      </Modal>

      {/* Historial de versiones */}
      <Modal open={historial} onClose={() => setHistorial(false)} title={`Historial de «${base?.nombre}»`} wide>
        {versiones.length === 0 ? (
          <EmptyState title="Sin historial" body="Las versiones aparecerán aquí con cada guardado." />
        ) : (
          <div className="divide-y divide-borde">
            {versiones.map((v) => (
              <div key={v.version} className="flex items-start gap-4 py-3">
                <Badge tone={v.version === base.version ? "conf" : "neutral"}>v{v.version}</Badge>
                <div className="flex-1">
                  <div className="text-[12.5px] font-semibold text-tinta">{v.nombre}</div>
                  <div className="text-[11.5px] text-gris-cl">{v.creado} · {v.por}</div>
                  {v.esSuperadmin ? (
                    <div className="mt-1 text-[11.5px] italic text-gris-cl">Superadministrador — sin matriz</div>
                  ) : (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {MODULOS.filter((m) => (v.matriz?.[m.id] ?? 0) > 0).map((m) => (
                        <Badge key={m.id} tone="neutral">{m.nombre}: {v.matriz[m.id]}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
