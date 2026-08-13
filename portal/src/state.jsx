import { createContext } from "react";
import { useContext, useEffect, useState } from "react";
import { auth, vista } from "./lib/api";

const Ctx = createContext(null);

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
    return p ? { data: p } : { error: { message: "Tu acceso al portal terminó. Acércate a Recursos Humanos." } };
  };

  const salir = async () => {
    await auth.salir();
    setPerfil(null);
  };

  const soloLectura = perfil?.modo === "solo-lectura";

  return (
    <Ctx.Provider value={{ perfil, soloLectura, entrar, salir, refrescarPerfil: cargarPerfil }}>
      {children}
    </Ctx.Provider>
  );
}

export const usePortal = () => useContext(Ctx);
