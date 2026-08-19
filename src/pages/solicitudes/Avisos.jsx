import { useState } from "react";
import { Plus } from "lucide-react";
import { useApp } from "../../state";
import { nivelDe } from "../../data/modulos";
import { PageHeader, Card, Badge, Button, Input, Select, Note, EmptyState } from "../../components/ui";

// SOL-03 — Avisos por correo del Centro de Solicitudes. El destinatario JAMÁS
// vive en el código: se administra aquí (valor inicial sembrado en la BD).
// «Todos los tipos» aplica a papeletas y vacaciones por igual; un aviso por
// tipo lo acota. La copia al jefe inmediato del solicitante es automática al
// crear (si su correo está en el maestro).
export default function AvisosSolicitudes() {
  const { db, user, guardarSolicitudAviso, eliminarSolicitudAviso } = useApp();
  const acceso = user?.acceso ?? { esSuperadmin: user?.esSuperadmin, matriz: {} };
  const puedeAprobar = nivelDe(acceso, "solicitudes") >= 3;
  const [correo, setCorreo] = useState("");
  const [tipoId, setTipoId] = useState("");
  const [copia, setCopia] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [error, setError] = useState(null);

  const ejecutar = async (fn, mensaje) => {
    setError(null);
    try {
      await fn();
      if (mensaje) setAviso(mensaje);
    } catch (err) {
      setError(err.message);
    }
  };

  const agregar = (e) => {
    e.preventDefault();
    const c = correo.trim().toLowerCase();
    if (!c) return;
    ejecutar(async () => {
      await guardarSolicitudAviso(tipoId || null, c, copia, true);
      setCorreo(""); setCopia(false);
    }, `${c} recibirá aviso de cada solicitud nueva.`);
  };

  return (
    <>
      <PageHeader
        code="SOL-03 · Avisos por correo"
        title="Avisos de solicitudes"
        subtitle="Quién se entera cuando se crea una solicitud. El solicitante recibe además cada cambio de estado; nada de esto requiere desplegar código."
      />
      {aviso && <div className="mb-4"><Note tone="conf">{aviso}</Note></div>}
      {error && <div className="mb-4"><Note tone="alerta">{error}</Note></div>}

      <Card>
        {puedeAprobar ? (
          <form onSubmit={agregar} className="mb-4 flex flex-wrap items-end gap-2">
            <Input type="email" placeholder="correo@empresa.pe" value={correo}
              onChange={(e) => setCorreo(e.target.value)} style={{ maxWidth: 260 }} />
            <Select value={tipoId} onChange={(e) => setTipoId(e.target.value)} style={{ maxWidth: 220 }}>
              <option value="">Todos los tipos</option>
              {db.solicitudTipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </Select>
            <label className="flex items-center gap-2 pb-2 text-[13px] font-medium text-tinta-2">
              <input type="checkbox" checked={copia} onChange={(e) => setCopia(e.target.checked)} className="accent-petroleo" />
              En copia (CC)
            </label>
            <Button type="submit" size="sm" disabled={!correo.trim()}><Plus size={13} /> Agregar</Button>
          </form>
        ) : (
          <div className="mb-4"><Note tone="neutral">Editar los avisos requiere nivel de aprobación en Solicitudes.</Note></div>
        )}

        <div className="space-y-1.5">
          {db.solicitudAvisos.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-caja border border-borde p-2.5">
              <span className="font-mono text-[12.5px] text-tinta">{a.correo}</span>
              <Badge tone="neutral">{a.tipo ?? "Todos los tipos"}</Badge>
              {a.copia && <Badge tone="neutral">CC</Badge>}
              <span className="flex-1" />
              <Badge tone={a.activo ? "conf" : "neutral"}>{a.activo ? "Activo" : "Inactivo"}</Badge>
              {puedeAprobar && (
                <>
                  <Button variant="ghost" size="sm"
                    onClick={() => ejecutar(() => guardarSolicitudAviso(a.tipo_id, a.correo, a.copia, !a.activo))}>
                    {a.activo ? "Desactivar" : "Activar"}
                  </Button>
                  <Button variant="ghost" size="sm"
                    onClick={() => ejecutar(() => eliminarSolicitudAviso(a.id), `${a.correo} eliminado.`)}>
                    Eliminar
                  </Button>
                </>
              )}
            </div>
          ))}
          {db.solicitudAvisos.length === 0 && (
            <EmptyState title="Sin destinatarios" body="Agrega al menos un correo para que RRHH se entere de las solicitudes nuevas." />
          )}
        </div>
      </Card>
    </>
  );
}
