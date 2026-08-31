import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { rpc } from "../lib/api";
import { usePortal } from "../state";
import { Enlace } from "../router";
import { Boton, Nota } from "../components/ui";

// TRB-01 · Ingreso: el trabajador se autentica con datos que sabe de memoria.
// El identificador es su documento (DNI, CE o pasaporte), nunca un correo. El
// mensaje de error es único: no revela si el documento existe en el sistema.
const MENSAJE_UNICO = "Documento o clave incorrectos. Si aún no tienes cuenta, acércate a Recursos Humanos.";

export const TIPOS_DOC = {
  DNI: { etiqueta: "DNI", regex: /^[0-9]{8}$/, numerico: true, max: 8, placeholder: "8 dígitos", error: "El DNI tiene 8 dígitos." },
  CE: { etiqueta: "Carné de extranjería", regex: /^[0-9A-Z]{9,12}$/, numerico: false, max: 12, placeholder: "9 a 12 caracteres", error: "El carné tiene de 9 a 12 caracteres." },
  Pasaporte: { etiqueta: "Pasaporte", regex: /^[0-9A-Z]{6,15}$/, numerico: false, max: 15, placeholder: "6 a 15 caracteres", error: "El pasaporte tiene de 6 a 15 caracteres." },
};

export default function Ingreso() {
  const { perfil, entrar } = usePortal();
  const [tipoDoc, setTipoDoc] = useState("DNI");
  const [dni, setDni] = useState("");
  const [clave, setClave] = useState("");
  const [ver, setVer] = useState(false);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);
  // Motivo del cierre forzado (inactividad / otro equipo), dejado por state.jsx.
  const [avisoSesion, setAvisoSesion] = useState(null);
  // «Recordar mis datos»: documento en localStorage (prefill); la clave JAMÁS
  // en texto plano — va al almacén cifrado del navegador (Credential
  // Management API) y se recupera al abrir el ingreso.
  const [recordar, setRecordar] = useState(() => {
    try { return localStorage.getItem("portal-recordar") !== "no"; } catch { return true; }
  });
  useEffect(() => {
    try {
      const a = sessionStorage.getItem("aviso-sesion-portal");
      if (a) { setAvisoSesion(a); sessionStorage.removeItem("aviso-sesion-portal"); }
    } catch { /* sin sessionStorage */ }
    try {
      const t = localStorage.getItem("portal-tipo-doc");
      if (t && TIPOS_DOC[t]) setTipoDoc(t);
      const u = localStorage.getItem("portal-usuario");
      if (u) setDni(u);
      if (localStorage.getItem("portal-recordar") !== "no"
          && navigator.credentials?.get && window.PasswordCredential) {
        navigator.credentials.get({ password: true, mediation: "optional" }).then((c) => {
          if (c?.type === "password") {
            setDni(c.id);
            if (c.password) setClave(c.password);
          }
        }).catch(() => { /* el navegador decide */ });
      }
    } catch { /* modo privado */ }
  }, []);

  const ingresar = async (e) => {
    e.preventDefault();
    // El campo vuelve a type=password antes de autenticar: con el ojito
    // activo el navegador no lo reconocería como clave y no ofrece guardarla.
    setVer(false);
    if (!TIPOS_DOC[tipoDoc].regex.test(dni)) return setError(TIPOS_DOC[tipoDoc].error);
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
      // «Recordar mis datos»: con la casilla marcada, documento y tipo en
      // localStorage y la clave al almacén CIFRADO del navegador (jamás en
      // texto plano). Desmarcada, se borra todo lo recordado.
      try {
        if (recordar) {
          localStorage.setItem("portal-usuario", dni);
          localStorage.setItem("portal-tipo-doc", tipoDoc);
          localStorage.setItem("portal-recordar", "si");
          if (window.PasswordCredential) {
            await navigator.credentials.store(new window.PasswordCredential({ id: dni, password: clave }));
          }
        } else {
          localStorage.removeItem("portal-usuario");
          localStorage.removeItem("portal-tipo-doc");
          localStorage.setItem("portal-recordar", "no");
          await navigator.credentials?.preventSilentAccess?.();
        }
      } catch { /* sin soporte o denegado: se sigue igual */ }
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

        {avisoSesion && <div className="mb-4"><Nota tono="pend">{avisoSesion}</Nota></div>}

        <label className="mb-3 block">
          <span className="mb-1 block text-[13px] font-semibold text-tinta">Tu documento</span>
          <select
            value={tipoDoc}
            onChange={(e) => { setTipoDoc(e.target.value); setDni(""); }}
            className="w-full rounded-caja border border-borde-f bg-white px-4 py-3 text-[15px] text-gris focus:border-petroleo focus:outline-none"
          >
            {Object.entries(TIPOS_DOC).map(([id, t]) => <option key={id} value={id}>{t.etiqueta}</option>)}
          </select>
        </label>
        <label className="mb-5 block">
          <span className="mb-1 block text-[13px] font-semibold text-tinta">Número de documento</span>
          <input
            type="text"
            name="username"
            id="ingreso-documento"
            inputMode={TIPOS_DOC[tipoDoc].numerico ? "numeric" : "text"}
            autoComplete="username"
            maxLength={TIPOS_DOC[tipoDoc].max}
            placeholder={TIPOS_DOC[tipoDoc].placeholder}
            value={dni}
            onInput={(e) => setDni(e.currentTarget.value.toUpperCase().replace(TIPOS_DOC[tipoDoc].numerico ? /[^0-9]/g : /[^0-9A-Z]/g, ""))}
            className="w-full rounded-caja border border-borde-f bg-white px-4 py-3 text-[17px] tracking-[0.15em] text-gris placeholder:tracking-normal placeholder:text-gris-cl focus:border-petroleo focus:outline-none"
            autoFocus
          />
        </label>

        <label className="mb-2 block">
          <span className="mb-1 block text-[13px] font-semibold text-tinta">Tu clave</span>
          <div className="flex items-center rounded-caja border border-borde-f bg-white focus-within:border-petroleo">
            <input
              type={ver ? "text" : "password"}
              name="password"
              id="ingreso-clave"
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

        <div className="mb-6 flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-gris">
            <input
              type="checkbox"
              checked={recordar}
              onChange={(e) => setRecordar(e.target.checked)}
              className="h-4 w-4 accent-petroleo"
            />
            Recordar mis datos
          </label>
          <Enlace to="/olvide-clave" className="text-[13px] font-semibold text-petroleo">Olvidé mi clave</Enlace>
        </div>

        {error && <div className="mb-4"><Nota tono="alerta">{error}</Nota></div>}

        <Boton type="submit" disabled={cargando || !TIPOS_DOC[tipoDoc].regex.test(dni) || !clave}>
          {cargando ? "Verificando…" : "Entrar"}
        </Boton>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-gris-cl">
          Cada ingreso queda registrado por tu seguridad.
        </p>
      </form>
    </main>
  );
}
