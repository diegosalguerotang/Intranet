import { createContext, useContext, useState } from "react";
import { EMPRESAS } from "./data/mock";

const AppCtx = createContext(null);

export function AppProvider({ children }) {
  const [user, setUser] = useState(null); // { nombre, rol }
  const [empresaId, setEmpresaId] = useState("negliaf");
  const empresa = EMPRESAS.find((e) => e.id === empresaId);

  return (
    <AppCtx.Provider value={{ user, setUser, empresaId, setEmpresaId, empresa }}>
      {children}
    </AppCtx.Provider>
  );
}

export const useApp = () => useContext(AppCtx);
