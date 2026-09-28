import { useState } from "react";
import { Save, RotateCcw, MailCheck } from "lucide-react";
import { useApp } from "../../state";
import { PageHeader, Card, Button, Field, Input, Select, Note } from "../../components/ui";
import { CLAVE_MIN_BACKOFFICE } from "../../lib/campos";

const RECOMENDADOS = {
  sesionBackofficeHoras: 8, sesionPortalDias: 30,
  multisesionBackoffice: false, multisesionPortal: true,
  intentosBloqueo: 5, bloqueoMinutos: 15,
  recuperacionDefecto: "whatsapp", claveLongitudMinPortal: 6, claveLongitudMinBackoffice: CLAVE_MIN_BACKOFFICE,
  claveProvisionalDias: 7,
  factorSuperadmin: true,
};

export default function Politica() {
  const { db, guardarPolitica, segundoFactor } = useApp();
  const vigente = db.politica[0] ?? RECOMENDADOS;
  const [p, setP] = useState(() => ({ ...vigente }));
  const [guardado, setGuardado] = useState(false);
  const [olvidados, setOlvidados] = useState(null);
  const [olvidando, setOlvidando] = useState(false);

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
            <Field label="Clave mínima — BackOffice" hint={`No menor de ${CLAVE_MIN_BACKOFFICE} (P11). La clave exige además letras y números.`}>
              <Input type="number" min={CLAVE_MIN_BACKOFFICE} value={p.claveLongitudMinBackoffice}
                onChange={(e) => set("claveLongitudMinBackoffice", Math.max(CLAVE_MIN_BACKOFFICE, Number(e.target.value) || CLAVE_MIN_BACKOFFICE))} />
            </Field>
          </div>
        </Card>

        <Card>
          <h2 className="mb-1 flex items-center gap-2 text-[13px] font-bold text-tinta"><MailCheck size={15} className="text-petroleo" /> Segundo factor del Superadministrador</h2>
          <p className="mb-4 text-[11.5px] leading-snug text-gris-cl">
            Con el interruptor encendido, cada ingreso de una cuenta Superadministrador pide además un código de 6 dígitos
            enviado a su correo (vence en 10 minutos). Hasta verificarlo la sesión no puede leer ni escribir nada. El resto de
            categorías entra solo con su clave. Si el correo dejara de salir, la vía de contingencia es técnica (Management API).
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-gris">
              <input type="checkbox" className="accent-petroleo" checked={p.factorSuperadmin ?? true}
                onChange={(e) => set("factorSuperadmin", e.target.checked)} />
              Exigir código por correo al Superadministrador
            </label>
            <div>
              <Button type="button" variant="secondary" disabled={olvidando} onClick={async () => {
                setOlvidando(true); setOlvidados(null);
                const r = await segundoFactor("olvidar");
                try { localStorage.removeItem("backoffice-dispositivo"); } catch { /* modo privado */ }
                setOlvidando(false);
                setOlvidados(r.status === 200 ? `${r.revocados} equipo${r.revocados === 1 ? "" : "s"} olvidado${r.revocados === 1 ? "" : "s"}. En el próximo ingreso se pedirá el código en todos.` : (r.error ?? "No se pudo olvidar los equipos."));
              }}>
                {olvidando ? "Olvidando…" : "Olvidar todos los equipos recordados"}
              </Button>
              <p className="mt-1 text-[11px] text-gris-cl">Revoca los equipos recordados de <b>tu</b> cuenta (los de 30 días). Este equipo también.</p>
              {olvidados && <Note tone="conf">{olvidados}</Note>}
            </div>
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
