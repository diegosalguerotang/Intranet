import { createContext } from "react";
import { useContext, useEffect, useState } from "react";
import { auth, vista, rpc } from "./lib/api";

const Ctx = createContext(null);

// Política de sesión del portal: inactividad 10 min + sesión única (gana el
// login nuevo; este equipo se autoexpulsa si el marcador del servidor cambió).
const INACTIVIDAD_MS = 10 * 60 * 1000;
const CLAVE_MARCADOR = "portal-sesion-marker";
const nuevoMarcador = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Estado del portal: sesión + perfil de v_portal_perfil. El dni se deriva del
// JWT en el servidor; el cliente jamás lo envía en consultas con sesión.
export function PortalProvider({ children }) {
  // undefined = verificando · null = sin sesión · objeto = trabajador
  const [perfil, setPerfil] = useState(auth.haySesion() ? undefined : null);

  const cargarPerfil = async () => {
    const { data } = await vista("v_portal_perfil", "select=*&limit=1");
    const p = data?.[0] ?? null;
    if (!p || p.modo === "expirado") {
      await auth.salir();
      setPerfil(p ? { expulsado: true } : null);
      return null;
    }
    setPerfil(p);
    return p;
  };

  useEffect(() => {
    if (auth.haySesion()) cargarPerfil();
  }, []);

  const entrar = async (dni, clave) => {
    const r = await auth.entrar(dni, clave);
    if (r.error) return r;
    const p = await cargarPerfil();
    if (p) {
      // Sesión única (gana el login nuevo): registrar el marcador de ESTE
      // ingreso. Si falla, no se bloquea el acceso.
      try {
        const marca = nuevoMarcador();
        localStorage.setItem(CLAVE_MARCADOR, marca);
        await rpc("portal_registrar_sesion", { p_marker: marca });
      } catch { /* la política de sesión no bloquea el login */ }
    }
    return p ? { data: p } : { error: { message: "Tu acceso al portal terminó. Acércate a Recursos Humanos." } };
  };

  const salir = async (aviso = null) => {
    try {
      localStorage.removeItem(CLAVE_MARCADOR);
      if (aviso) sessionStorage.setItem("aviso-sesion-portal", aviso);
    } catch { /* modo privado */ }
    await auth.salir();
    setPerfil(null);
  };

  // Inactividad + sesión única mientras hay un trabajador con sesión válida.
  const sesionActiva = !!(perfil && !perfil.expulsado && perfil.modo !== "expirado");
  useEffect(() => {
    if (!sesionActiva) return;
    let vivo = true;
    let idle;
    const reiniciarIdle = () => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        if (vivo) salir("Tu sesión se cerró por inactividad. Vuelve a ingresar.");
      }, INACTIVIDAD_MS);
    };
    const eventos = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    eventos.forEach((e) => window.addEventListener(e, reiniciarIdle, { passive: true }));
    reiniciarIdle();

    const revisar = async () => {
      if (!vivo || document.hidden) return;
      const marca = (() => { try { return localStorage.getItem(CLAVE_MARCADOR); } catch { return null; } })();
      const { data } = await rpc("portal_mi_sesion");
      if (!vivo || data == null) return;
      if (marca && data !== marca) salir("Tu sesión se cerró porque tu cuenta ingresó desde otro equipo.");
    };
    const poll = setInterval(revisar, 60000);
    const alEnfocar = () => revisar();
    window.addEventListener("focus", alEnfocar);
    document.addEventListener("visibilitychange", alEnfocar);

    return () => {
      vivo = false;
      clearTimeout(idle);
      clearInterval(poll);
      eventos.forEach((e) => window.removeEventListener(e, reiniciarIdle));
      window.removeEventListener("focus", alEnfocar);
      document.removeEventListener("visibilitychange", alEnfocar);
    };
  }, [sesionActiva]);

  const soloLectura = perfil?.modo === "solo-lectura";

  return (
    <Ctx.Provider value={{ perfil, soloLectura, entrar, salir, refrescarPerfil: cargarPerfil }}>
      {children}
    </Ctx.Provider>
  );
}

export const usePortal = () => useContext(Ctx);
