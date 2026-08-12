import { useState } from "react";
import { Save, RotateCcw } from "lucide-react";
import { useApp } from "../../state";
import { PageHeader, Card, Button, Field, Input, Select, Note } from "../../components/ui";

const RECOMENDADOS = {
  sesionBackofficeHoras: 8, sesionPortalDias: 30,
  multisesionBackoffice: false, multisesionPortal: true,
  intentosBloqueo: 5, bloqueoMinutos: 15,
  recuperacionDefecto: "whatsapp", claveLongitudMinPortal: 6, claveLongitudMinBackoffice: 12,
  claveProvisionalDias: 7,
};

export default function Politica() {
  const { db, guardarPolitica } = useApp();
  const vigente = db.politica[0] ?? RECOMENDADOS;
  const [p, setP] = useState(() => ({ ...vigente }));
  const [guardado, setGuardado] = useState(false);

  const set = (campo, valor) => { setP((x) => ({ ...x, [campo]: valor })); setGuardado(false); };
  const num = (campo) => (e) => set(campo, Math.max(1, Number(e.target.value) || 1));

  return (
    <>
      <PageHeader
        code="ACC-05"
        title="Política de acceso"
        subtitle="Las reglas de autenticación que rigen para toda la instalación: sesiones, bloqueos y claves, por superficie."
        actions={
          <>
            <Button variant="secondary" onClick={() => { setP({ ...vigente, ...RECOMENDADOS }); setGuardado(false); }}>
              <RotateCcw size={14} /> Restaurar valores recomendados
            </Button>
            <Button onClick={() => { guardarPolitica(p); setGuardado(true); }}>
              <Save size={14} /> Guardar
            </Button>
          </>
        }
      />

      <div className="space-y-5">
        {guardado && <Note tone="conf">Política guardada. El cambio quedó registrado en auditoría con valor anterior y valor nuevo.</Note>}

        <Card>
          <h2 className="mb-1 text-[13px] font-bold text-tinta">Sesiones</h2>
          <p className="mb-4 text-[11.5px] leading-snug text-gris-cl">
            El BackOffice y el Portal tienen políticas independientes y no negociables entre sí: una sesión corta en
            un celular de gama baja destruye la adopción del Portal; una sesión larga en una computadora compartida
            destruye la trazabilidad del BackOffice.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Duración de sesión del BackOffice (horas)" hint="Antes de exigir nueva autenticación.">
              <Input type="number" min={1} value={p.sesionBackofficeHoras} onChange={num("sesionBackofficeHoras")} />
            </Field>
            <Field label="Duración de sesión del Portal del Trabajador (días)">
              <Input type="number" min={1} value={p.sesionPortalDias} onChange={num("sesionPortalDias")} />
            </Field>
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-gris">
              <input type="checkbox" className="accent-petroleo" checked={p.multisesionBackoffice}
                onChange={(e) => set("multisesionBackoffice", e.target.checked)} />
              Permitir sesiones simultáneas en el BackOffice
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-gris">
              <input type="checkbox" className="accent-petroleo" checked={p.multisesionPortal}
                onChange={(e) => set("multisesionPortal", e.target.checked)} />
              Permitir sesiones simultáneas en el Portal
            </label>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-[13px] font-bold text-tinta">Bloqueo por intentos fallidos</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Intentos fallidos antes del bloqueo temporal">
              <Input type="number" min={1} value={p.intentosBloqueo} onChange={num("intentosBloqueo")} />
            </Field>
            <Field label="Duración del bloqueo (minutos)">
              <Input type="number" min={1} value={p.bloqueoMinutos} onChange={num("bloqueoMinutos")} />
            </Field>
          </div>
        </Card>

        <Card>
          <h2 className="mb-1 text-[13px] font-bold text-tinta">Claves</h2>
          <p className="mb-4 text-[11.5px] leading-snug text-gris-cl">
            Longitud mínima diferenciada: los trabajadores tipean en celulares de gama baja y una exigencia alta
            destruye la adopción; los usuarios administrativos operan sobre datos de todo el grupo y no tienen esa
            excusa.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Recuperación de clave por defecto (Portal)" hint="Los tres métodos coexisten; aquí se define cuál se ofrece primero.">
              <Select value={p.recuperacionDefecto} onChange={(e) => set("recuperacionDefecto", e.target.value)}>
                <option value="whatsapp">WhatsApp</option>
                <option value="sms">SMS</option>
                <option value="manual">Restablecimiento manual por RRHH</option>
              </Select>
            </Field>
            <Field label="Vigencia de la clave provisional (días)">
              <Input type="number" min={1} value={p.claveProvisionalDias} onChange={num("claveProvisionalDias")} />
            </Field>
            <Field label="Clave mínima — Portal del Trabajador" hint="No menor de 6.">
              <Input type="number" min={6} value={p.claveLongitudMinPortal}
                onChange={(e) => set("claveLongitudMinPortal", Math.max(6, Number(e.target.value) || 6))} />
            </Field>
            <Field label="Clave mínima — BackOffice" hint="No menor de 12.">
              <Input type="number" min={12} value={p.claveLongitudMinBackoffice}
                onChange={(e) => set("claveLongitudMinBackoffice", Math.max(12, Number(e.target.value) || 12))} />
            </Field>
          </div>
        </Card>

        <Note tone="neutral">
          Reducir la duración de la sesión <b>no cierra las sesiones ya abiertas</b>: aplica a partir de la
          siguiente autenticación. Si se necesita un corte inmediato, es una suspensión de usuario (ACC-01), no un
          cambio de política.
        </Note>

        {vigente.actualizado && (
          <div className="text-[11.5px] text-gris-cl">
            Última actualización: {vigente.actualizado} · {vigente.actualizadoPor}
          </div>
        )}
      </div>
    </>
  );
}
