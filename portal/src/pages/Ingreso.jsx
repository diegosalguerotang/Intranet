import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { rpc } from "../lib/api";
import { usePortal } from "../state";
import { Enlace } from "../router";
import { Boton, Nota } from "../components/ui";

// TRB-01 · Ingreso: el trabajador se autentica con datos que sabe de memoria.
// El identificador es el DNI, nunca un correo. El mensaje de error es único:
// no revela si el DNI existe en el sistema.
const MENSAJE_UNICO = "DNI o clave incorrectos. Si aún no tienes cuenta, acércate a Recursos Humanos.";

export default function Ingreso() {
  const { perfil, entrar } = usePortal();
  const [dni, setDni] = useState("");
  const [clave, setClave] = useState("");
  const [ver, setVer] = useState(false);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  const ingresar = async (e) => {
    e.preventDefault();
    if (!/^[0-9]{8}$/.test(dni)) return setError("El DNI tiene 8 dígitos.");
    setError(null);
    setCargando(true);
    const dispositivo = navigator.userAgent.slice(0, 150);
    try {
      const { data: bloqueado } = await rpc("portal_verificar_bloqueo", { p_dni: dni }, { conSesion: false });
      if (bloqueado) {
        await rpc("portal_registrar_ingreso", { p_dni: dni, p_resultado: "bloqueado", p_dispositivo: dispositivo }, { conSesion: false });
        setError("Demasiados intentos. Espera 15 minutos y vuelve a intentar.");
        return;
      }
      const r = await entrar(dni, clave);
      if (r.error) {
        await rpc("portal_registrar_ingreso", { p_dni: dni, p_resultado: "fallido", p_dispositivo: dispositivo }, { conSesion: false });
        setError(r.error.status === 400 ? MENSAJE_UNICO : r.error.message);
        return;
      }
      await rpc("portal_registrar_ingreso", { p_dni: dni, p_resultado: "exitoso", p_dispositivo: dispositivo });
      // El guard central redirige al inicio (o al primer ingreso).
    } finally {
      setCargando(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-8">
      <form onSubmit={ingresar} className="animar-aparicion rounded-caja bg-white px-6 py-8 shadow-[0_5px_30px_rgba(29,63,114,0.12)]">
        <div className="mb-7 text-center">
          <div className="font-display text-[30px] font-bold leading-none tracking-tight text-tinta">
            Grupo<span className="text-petroleo">ER</span>
          </div>
          <div className="mt-2 text-[11.5px] font-medium uppercase tracking-[0.25em] text-acero">
            Portal del Trabajador
          </div>
        </div>

        {perfil?.expulsado && (
          <div className="mb-4">
            <Nota tono="pend">Tu acceso al portal terminó. Si necesitas tus documentos, acércate a Recursos Humanos.</Nota>
          </div>
        )}

        <label className="mb-5 block">
          <span className="mb-1 block text-[13px] font-semibold text-tinta">Tu DNI</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="username"
            maxLength={8}
            placeholder="8 dígitos"
            value={dni}
            onInput={(e) => setDni(e.currentTarget.value.replace(/\D/g, ""))}
            className="w-full rounded-caja border border-borde-f bg-white px-4 py-3 text-[17px] tracking-[0.15em] text-gris placeholder:tracking-normal placeholder:text-gris-cl focus:border-petroleo focus:outline-none"
            autoFocus
          />
        </label>

        <label className="mb-2 block">
          <span className="mb-1 block text-[13px] font-semibold text-tinta">Tu clave</span>
          <div className="flex items-center rounded-caja border border-borde-f bg-white focus-within:border-petroleo">
            <input
              type={ver ? "text" : "password"}
              autoComplete="current-password"
              value={clave}
              onInput={(e) => setClave(e.currentTarget.value)}
              className="w-full bg-transparent px-4 py-3 text-[17px] text-gris focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setVer((v) => !v)}
              aria-label={ver ? "Ocultar clave" : "Mostrar clave"}
              className="px-3 text-gris-cl"
            >
              {ver ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
        </label>

        <p className="mb-6 text-right">
          <Enlace to="/olvide-clave" className="text-[13px] font-semibold text-petroleo">Olvidé mi clave</Enlace>
        </p>

        {error && <div className="mb-4"><Nota tono="alerta">{error}</Nota></div>}

        <Boton type="submit" disabled={cargando || dni.length !== 8 || !clave}>
          {cargando ? "Verificando…" : "Entrar"}
        </Boton>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-gris-cl">
          Cada ingreso queda registrado por tu seguridad.
        </p>
      </form>
    </main>
  );
}
