import { useEffect, useState } from "react";
import { auth, rpc, vista } from "../lib/api";
import { usePortal } from "../state";
import { Boton, Nota, Tarjeta } from "../components/ui";

// TRB-03 · Primer ingreso: obligatoria y no salteable (el guard central solo
// deja esta pantalla). Reemplaza la clave provisional, registra el celular y
// la aceptación de la política de datos (Ley 29733: fecha, hora y versión).
export default function PrimerIngreso() {
  const { perfil, refrescarPerfil } = usePortal();
  const [clave, setClave] = useState("");
  const [clave2, setClave2] = useState("");
  const [celular, setCelular] = useState("");
  const [sinCelular, setSinCelular] = useState(false);
  const [acepta, setAcepta] = useState(false);
  const [politica, setPolitica] = useState(null); // { version, texto }
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    vista("v_declaraciones_vigentes", "select=version,texto&id=eq.politica-datos&limit=1")
      .then(({ data }) => setPolitica(data?.[0] ?? null));
  }, []);

  const guardar = async (e) => {
    e.preventDefault();
    if (clave.length < 6) return setError("Tu clave nueva debe tener al menos 6 caracteres.");
    if (clave !== clave2) return setError("Las claves no coinciden.");
    if (!sinCelular && !/^[0-9]{9}$/.test(celular)) return setError("El celular tiene 9 dígitos, o marca «No tengo celular».");
    if (!acepta) return setError("Para continuar debes aceptar la política de datos personales.");
    setError(null);
    setCargando(true);
    try {
      const rClave = await auth.cambiarClave(clave);
      if (rClave.error) {
        setError(/different/i.test(rClave.error.message)
          ? "La clave nueva debe ser distinta a la que te entregaron."
          : "No se pudo guardar la clave. Intenta de nuevo.");
        return;
      }
      const rRpc = await rpc("portal_primer_ingreso", {
        p_celular: sinCelular ? null : celular,
        p_sin_celular: sinCelular,
        p_politica_version: politica?.version ?? 1,
      });
      if (rRpc.error) { setError(rRpc.error.message); return; }
      await refrescarPerfil(); // el guard central pasa al inicio
    } finally {
      setCargando(false);
    }
  };

  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <form onSubmit={guardar} className="animar-aparicion space-y-4">
        <Tarjeta>
          <h1 className="text-[18px] font-bold text-tinta">¡Bienvenido, {perfil?.nombrePila}!</h1>
          <p className="mt-1 text-[13.5px] leading-relaxed text-gris">
            Antes de empezar, crea tu clave personal. La clave que te entregaron era de un solo uso.
          </p>
        </Tarjeta>

        <Tarjeta>
          <label className="mb-4 block">
            <span className="mb-1 block text-[13px] font-semibold text-tinta">Tu clave nueva</span>
            <input
              type="password" autoComplete="new-password" value={clave}
              onInput={(e) => setClave(e.currentTarget.value)}
              className="w-full rounded-caja border border-borde-f px-4 py-3 text-[16px] focus:border-petroleo focus:outline-none"
            />
            <span className="mt-1 block text-[12px] text-gris-cl">Mínimo 6 caracteres. Elige algo que recuerdes y no compartas.</span>
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-semibold text-tinta">Repite tu clave nueva</span>
            <input
              type="password" autoComplete="new-password" value={clave2}
              onInput={(e) => setClave2(e.currentTarget.value)}
              className="w-full rounded-caja border border-borde-f px-4 py-3 text-[16px] focus:border-petroleo focus:outline-none"
            />
          </label>
        </Tarjeta>

        <Tarjeta>
          <span className="mb-1 block text-[13px] font-semibold text-tinta">Tu número de celular</span>
          <p className="mb-2 text-[12px] leading-snug text-gris-cl">
            Sirve para avisarte cuando llegue tu boleta y para recuperar tu clave más adelante.
          </p>
          <input
            type="text" inputMode="numeric" maxLength={9} placeholder="9 dígitos"
            value={celular} disabled={sinCelular}
            onInput={(e) => setCelular(e.currentTarget.value.replace(/\D/g, ""))}
            className="w-full rounded-caja border border-borde-f px-4 py-3 text-[16px] disabled:bg-papel disabled:text-gris-cl focus:border-petroleo focus:outline-none"
          />
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-[13.5px] text-gris">
            <input type="checkbox" className="accent-petroleo" checked={sinCelular}
                   onChange={(e) => { setSinCelular(e.currentTarget.checked); if (e.currentTarget.checked) setCelular(""); }} />
            No tengo celular
          </label>
          {sinCelular && (
            <div className="mt-2">
              <Nota tono="pend">Sin celular no recibirás avisos; tu supervisor podrá ayudarte con las confirmaciones.</Nota>
            </div>
          )}
        </Tarjeta>

        <Tarjeta>
          <span className="mb-2 block text-[13px] font-semibold text-tinta">Tus datos personales</span>
          <div className="max-h-44 overflow-y-auto whitespace-pre-line rounded-caja border border-borde bg-papel px-3.5 py-3 text-[12.5px] leading-relaxed text-gris">
            {politica?.texto ?? "Cargando…"}
          </div>
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-[13.5px] text-gris">
            <input type="checkbox" className="mt-1 accent-petroleo" checked={acepta}
                   onChange={(e) => setAcepta(e.currentTarget.checked)} />
            <span>He leído y acepto la política de tratamiento de mis datos personales.</span>
          </label>
        </Tarjeta>

        {error && <Nota tono="alerta">{error}</Nota>}

        <Boton type="submit" disabled={cargando || !politica}>
          {cargando ? "Guardando…" : "Guardar y entrar"}
        </Boton>
      </form>
    </main>
  );
}
