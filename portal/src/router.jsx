import { createContext } from "react";
import { useContext, useEffect, useState } from "react";

// Mini-router del portal (~1KB): history API con base /portal. Las pantallas
// son pocas y conocidas; un router completo costaría ~20KB gzip.
const BASE = "/portal";
const Ctx = createContext(null);

const rutaActual = () => {
  const p = window.location.pathname;
  const sinBase = p.startsWith(BASE) ? p.slice(BASE.length) : p;
  return sinBase || "/";
};

export function RouterProvider({ children }) {
  const [ruta, setRuta] = useState(rutaActual);
  useEffect(() => {
    const alVolver = () => setRuta(rutaActual());
    window.addEventListener("popstate", alVolver);
    return () => window.removeEventListener("popstate", alVolver);
  }, []);
  const ir = (destino, { reemplazar = false } = {}) => {
    window.history[reemplazar ? "replaceState" : "pushState"]({}, "", BASE + destino);
    setRuta(destino);
    window.scrollTo(0, 0);
  };
  return <Ctx.Provider value={{ ruta, ir }}>{children}</Ctx.Provider>;
}

export const useRouter = () => useContext(Ctx);

export function Enlace({ to, className = "", children }) {
  const { ir } = useRouter();
  return (
    <a
      href={BASE + to}
      className={className}
      onClick={(e) => { e.preventDefault(); ir(to); }}
    >
      {children}
    </a>
  );
}
