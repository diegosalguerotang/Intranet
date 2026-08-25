import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "../router";
import { Boton, Nota, Tarjeta } from "../components/ui";

// Aterrizaje del enlace de recuperación por correo: el trabajador crea aquí su
// clave nueva. El token viene en la URL, dura 1 hora y sirve una sola vez.
function CampoClave({ ver, setVer, ...props }) {
  return (
    <div className="relative">
      <input
        {...props}
        type={ver ? "text" : "password"}
        className="w-full rounded-caja border border-borde-f px-4 py-3 pr-12 text-[16px] focus:border-petroleo focus:outline-none"
      />
      <button
        type="button" onClick={() => setVer(!ver)}
        aria-label={ver ? "Ocultar clave" : "Mostrar clave"}
        className="absolute inset-y-0 right-0 flex items-center px-3.5 text-gris-cl"
      >
        {ver ? <EyeOff size={19} /> : <Eye size={19} />}
      </button>
    </div>
  );
}

export default function Restablecer() {
  const { ir } = useRouter();
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [clave, setClave] = useState("");
  const [clave2, setClave2] = useState("");
  const [ver1, setVer1] = useState(false);
  const [ver2, setVer2] = useState(false);
  const [error, setError] = useState(null);
  const [listo, setListo] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const guardar = async (e) => {
    e.preventDefault();
    if (clave.length < 6) return setError("Tu clave nueva debe tener al menos 6 caracteres.");
    if (clave !== clave2) return setError("Las claves no coinciden.");
    setError(null);
    setOcupado(true);
    try {
      const r = await fetch(`${window.location.origin}/api/restablecer-clave`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, clave }),
      });
      const json = await r.json().catch(() => null);
      if (!r.ok) { setError(json?.error ?? `Error ${r.status}`); return; }
      setListo(true);
    } catch {
      setError("No se pudo guardar. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-8">
      <Tarjeta className="animar-aparicion">
        {listo ? (
          <>
            <h1 className="text-[18px] font-bold text-tinta">¡Clave guardada! ✅</h1>
            <p className="mt-2 text-[14px] leading-relaxed text-gris">
              Ya puedes entrar al portal con tu DNI y tu clave nueva.
            </p>
            <div className="mt-4">
              <Boton type="button" onClick={() => ir("/ingreso")}>Ir a ingresar</Boton>
            </div>
          </>
        ) : !token ? (
          <>
            <h1 className="text-[18px] font-bold text-tinta">Enlace incompleto</h1>
            <p className="mt-2 text-[14px] leading-relaxed text-gris">
              Abre el enlace completo desde tu correo, o pide uno nuevo.
            </p>
            <div className="mt-4">
              <Boton variante="secundario" type="button" onClick={() => ir("/olvide-clave")}>Pedir enlace nuevo</Boton>
            </div>
          </>
        ) : (
          <form onSubmit={guardar}>
            <h1 className="text-[18px] font-bold text-tinta">Crea tu clave nueva</h1>
            <label className="mt-4 block">
              <span className="mb-1 block text-[13px] font-semibold text-tinta">Tu clave nueva</span>
              <CampoClave ver={ver1} setVer={setVer1} autoComplete="new-password" value={clave}
                          onInput={(e) => setClave(e.currentTarget.value)} />
              <span className="mt-1 block text-[12px] text-gris-cl">Mínimo 6 caracteres.</span>
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block text-[13px] font-semibold text-tinta">Repite tu clave nueva</span>
              <CampoClave ver={ver2} setVer={setVer2} autoComplete="new-password" value={clave2}
                          onInput={(e) => setClave2(e.currentTarget.value)} />
            </label>
            {error && <div className="mt-3"><Nota tono="alerta">{error}</Nota></div>}
            <div className="mt-4">
              <Boton type="submit" disabled={ocupado || !clave || !clave2}>
                {ocupado ? "Guardando…" : "Guardar mi clave"}
              </Boton>
            </div>
          </form>
        )}
      </Tarjeta>
    </main>
  );
}
