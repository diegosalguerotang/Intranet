import { useMemo, useState } from "react";
import { ClipboardPen } from "lucide-react";
import { useApp } from "../../state";
import {
  PageHeader, Card, Badge, Button, Select, Field, Note, EmptyState, Input,
} from "../../components/ui";
import { FormPapeleta, FormVacaciones, resumenDatos, avisarSolicitud } from "./formularios";
import { ESTADOS_SOL } from "./Bandeja";

// Mi solicitud — el botón global del BackOffice (esquina inferior derecha):
// CUALQUIER usuario administrativo activo registra su propia solicitud y sigue
// las suyas, tenga o no acceso al módulo Solicitudes. El solicitante sale de
// la persona vinculada a su usuario; la cadena de V°B° y la regla «nadie se
// aprueba a sí mismo» rigen igual que siempre.
export default function MiSolicitud() {
  const { db, user, crearSolicitudPropia, reenviarSolicitud } = useApp();
  const [tipoId, setTipoId] = useState("");
  const [supervisor, setSupervisor] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [corrigiendo, setCorrigiendo] = useState(null); // solicitud observada mía

  const tipos = db.solicitudTipos.filter((t) => t.activo && t.backoffice);
  const tipo = tipos.find((t) => t.id === tipoId);
  const mias = db.misSolicitudes;

  const enviar = async (datos) => {
    setOcupado(true);
    try {
      const conSupervisor = supervisor.trim()
        ? { ...datos, supervisor_nombre: supervisor.trim() }
        : datos;
      const numero = await crearSolicitudPropia(tipoId, conSupervisor);
      avisarSolicitud(numero, "creada");
      setAviso(`Tu solicitud ${numero} quedó registrada y entró a su cadena de aprobación.`);
      setTipoId(""); setSupervisor("");
    } finally {
      setOcupado(false);
    }
  };

  const reenviar = async (datos) => {
    setOcupado(true);
    try {
      await reenviarSolicitud(corrigiendo.id, datos);
      avisarSolicitud(corrigiendo.numero, "estado");
      setAviso(`Tu solicitud ${corrigiendo.numero} fue corregida y reenviada.`);
      setCorrigiendo(null);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <>
      <PageHeader
        code="Mi solicitud"
        title="Mis solicitudes"
        subtitle={`Se registran a tu nombre (${user?.nombre ?? user?.correo ?? ""}) y siguen la cadena de aprobación normal. No necesitas acceso al módulo Solicitudes.`}
      />

      {aviso && <div className="mb-4"><Note tone="conf">{aviso}</Note></div>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          {corrigiendo ? (
            <>
              <div className="mb-1 flex items-center gap-2 font-display text-[15px] font-semibold text-tinta">
                Corregir {corrigiendo.numero}
              </div>
              {corrigiendo.ultimo_comentario && (
                <div className="mb-3"><Note tone="pend">Observación: «{corrigiendo.ultimo_comentario}»</Note></div>
              )}
              {corrigiendo.tipo_id === "papeleta-permiso" ? (
                <FormPapeleta inicial={corrigiendo.datos} onEnviar={reenviar} ocupado={ocupado} textoEnviar="Reenviar corregida" />
              ) : (
                <FormVacaciones inicial={corrigiendo.datos} onEnviar={reenviar} ocupado={ocupado} textoEnviar="Reenviar corregida" />
              )}
              <div className="mt-2">
                <Button variant="secondary" size="sm" onClick={() => setCorrigiendo(null)} disabled={ocupado}>Cancelar</Button>
              </div>
            </>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2 font-display text-[15px] font-semibold text-tinta">
                <ClipboardPen size={16} className="text-petroleo" /> Nueva solicitud
              </div>
              <div className="space-y-4">
                <Field label="Tipo de solicitud" required>
                  <Select value={tipoId} onChange={(e) => setTipoId(e.target.value)}>
                    <option value="">Seleccionar…</option>
                    {tipos.map((t) => (
                      <option key={t.id} value={t.id}>{t.nombre} ({t.codigo_formato})</option>
                    ))}
                  </Select>
                </Field>
                {tipo && (
                  <>
                    <Field label="Jefe inmediato / supervisor"
                      hint="Si tu sede ya tiene supervisor registrado, puedes dejarlo vacío.">
                      <Input value={supervisor} onChange={(e) => setSupervisor(e.target.value)}
                        placeholder="Nombre de tu jefe inmediato" />
                    </Field>
                    {tipo.id === "papeleta-permiso"
                      ? <FormPapeleta onEnviar={enviar} ocupado={ocupado} textoEnviar="Enviar mi papeleta" />
                      : <FormVacaciones onEnviar={enviar} ocupado={ocupado} textoEnviar="Enviar mi solicitud" />}
                  </>
                )}
              </div>
            </>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 font-display text-[15px] font-semibold text-tinta">Historial</h2>
          {mias.length === 0 ? (
            <EmptyState title="Sin solicitudes" body="Cuando registres una, aquí verás cómo avanza." />
          ) : (
            <div className="space-y-2.5">
              {mias.map((s) => {
                const est = ESTADOS_SOL[s.estado] ?? ESTADOS_SOL.enviada;
                return (
                  <div key={s.numero} className="rounded-caja border border-borde p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12px] font-semibold">{s.numero}</span>
                      <span className="text-[13px] font-semibold">{s.tipo}</span>
                      <span className="flex-1" />
                      <Badge tone={est.tone}>{est.label}</Badge>
                    </div>
                    <div className="mt-1 text-[12px] text-gris">
                      {resumenDatos(s.tipo_id, s.datos ?? {}).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                    </div>
                    {s.paso_titulo && <div className="mt-0.5 text-[11.5px] text-gris-cl">Esperando: {s.paso_titulo}</div>}
                    {s.estado === "observada" && (
                      <div className="mt-2 flex items-center gap-2">
                        {s.ultimo_comentario && <span className="text-[12px] text-alerta">«{s.ultimo_comentario}»</span>}
                        <Button size="sm" variant="secondary" onClick={() => setCorrigiendo(s)}>Corregir y reenviar</Button>
                      </div>
                    )}
                    {s.estado === "rechazada" && s.ultimo_comentario && (
                      <div className="mt-1 text-[12px] text-gris">Motivo: «{s.ultimo_comentario}»</div>
                    )}
                    <div className="mt-1 font-mono text-[10.5px] text-gris-cl">{s.creado}</div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
