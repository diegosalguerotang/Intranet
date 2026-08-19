import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../../state";
import { nivelDe } from "../../data/modulos";
import { PageHeader, Card, Field, Select, Note, Button, EmptyState } from "../../components/ui";
import { FormPapeleta, FormVacaciones, avisarSolicitud } from "./formularios";

// SOL-02 — Nueva solicitud (BackOffice, a nombre de un trabajador). El enlace
// directo /solicitudes/nueva abre este formulario sin recorrer el menú; si no
// hay sesión, el guard global lleva al login primero (enlace AUTENTICADO).
export default function NuevaSolicitud() {
  const { db, user, persona, crearSolicitudAdmin } = useApp();
  const navigate = useNavigate();
  const acceso = user?.acceso ?? { esSuperadmin: user?.esSuperadmin, matriz: {} };
  const puedeAccionar = nivelDe(acceso, "solicitudes") >= 2;
  const [tipoId, setTipoId] = useState("");
  const [dni, setDni] = useState("");
  const [supervisor, setSupervisor] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [listo, setListo] = useState(null); // numero creado
  const [avisoFallo, setAvisoFallo] = useState(false);

  const vigentes = db.personal.filter((p) => p.estado === "vigente");
  const tipos = db.solicitudTipos.filter((t) => t.activo && t.backoffice);
  const tipo = tipos.find((t) => t.id === tipoId);
  const trabajador = dni ? persona(dni) : null;
  const sede = trabajador ? db.sedes.find((s) => s.id === trabajador.sede) : null;
  const supervisorSede = sede?.supervisor ?? null; // v_sedes ya trae el nombre

  const enviar = async (datos) => {
    setOcupado(true);
    try {
      const conSupervisor = supervisor.trim()
        ? { ...datos, supervisor_nombre: supervisor.trim() }
        : datos;
      const numero = await crearSolicitudAdmin(dni, tipoId, conSupervisor);
      const ok = await avisarSolicitud(numero, "creada");
      setAvisoFallo(!ok);
      setListo(numero);
    } finally {
      setOcupado(false);
    }
  };

  if (!puedeAccionar) {
    return <EmptyState title="Solo lectura" body="Tu categoría permite consultar solicitudes pero no registrarlas." />;
  }

  if (listo) {
    return (
      <>
        <PageHeader code="SOL-02 · Nueva solicitud" title="Solicitud registrada" />
        <Card>
          <div className="space-y-4">
            <Note tone="conf">
              La solicitud <b className="font-mono">{listo}</b> quedó registrada y entró a su cadena de aprobación.
            </Note>
            {avisoFallo && (
              <Note tone="pend">
                El aviso por correo no pudo salir (¿motor de correo sin proveedor?). La solicitud igual quedó registrada.
              </Note>
            )}
            <div className="flex gap-2">
              <Button onClick={() => navigate("/solicitudes")}>Ir a la bandeja</Button>
              <Button variant="secondary" onClick={() => { setListo(null); setDni(""); setTipoId(""); setSupervisor(""); }}>
                Registrar otra
              </Button>
            </div>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        code="SOL-02 · Nueva solicitud"
        title="Nueva solicitud"
        subtitle="Se registra a nombre de un trabajador del maestro; sus datos se derivan solos. El trabajador crea las suyas (vacaciones) desde su portal."
      />
      <Card>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tipo de solicitud" required>
              <Select value={tipoId} onChange={(e) => setTipoId(e.target.value)}>
                <option value="">Seleccionar…</option>
                {tipos.map((t) => (
                  <option key={t.id} value={t.id}>{t.nombre} ({t.codigo_formato})</option>
                ))}
              </Select>
            </Field>
            <Field label="Trabajador" required hint="Buscador contra el maestro: nada se escribe a mano.">
              <Select value={dni} onChange={(e) => setDni(e.target.value)}>
                <option value="">Buscar…</option>
                {vigentes.map((p) => (
                  <option key={p.dni} value={p.dni}>{p.nombre} — {p.dni}</option>
                ))}
              </Select>
            </Field>
          </div>

          {trabajador && (
            <div className="grid gap-3 rounded-caja border border-borde bg-papel/60 p-3.5 sm:grid-cols-3">
              <Derivado etiqueta="Nombres y apellidos" valor={trabajador.nombre} />
              <Derivado etiqueta="DNI" valor={trabajador.dni} />
              <Derivado etiqueta="Cargo" valor={trabajador.cargo} />
              <Derivado etiqueta="Sede" valor={sede?.nombre ?? trabajador.sede ?? "—"} />
              <Derivado etiqueta="Fecha de ingreso" valor={trabajador.ingreso ?? "—"} />
              <Field label="Jefe inmediato / supervisor"
                hint={supervisorSede ? `La sede propone: ${supervisorSede}. Editable.` : "La sede no tiene supervisor: escríbelo."}>
                <input
                  className="w-full rounded-caja border border-borde bg-white px-3 py-2 text-[13px] outline-none focus:border-petroleo"
                  value={supervisor} onChange={(e) => setSupervisor(e.target.value)}
                  placeholder={supervisorSede ?? "Nombre del jefe inmediato"} />
              </Field>
            </div>
          )}

          {tipo && dni && (
            tipo.id === "papeleta-permiso"
              ? <FormPapeleta onEnviar={enviar} ocupado={ocupado} />
              : <FormVacaciones onEnviar={enviar} ocupado={ocupado} />
          )}
          {tipo && !dni && <Note tone="neutral">Elige primero al trabajador.</Note>}
        </div>
      </Card>
    </>
  );
}

function Derivado({ etiqueta, valor }) {
  return (
    <div>
      <div className="font-mono text-[10px] font-semibold uppercase tracking-wide text-gris">{etiqueta}</div>
      <div className="mt-0.5 text-[13px] font-semibold text-tinta">{valor}</div>
    </div>
  );
}
