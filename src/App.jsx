import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppProvider } from "./state";
import Shell from "./layout/Shell";
import Login from "./pages/Login";
import Tablero from "./pages/rrhh/Tablero";
import Personal from "./pages/rrhh/Personal";
import Legajo from "./pages/rrhh/Legajo";
import Boletas from "./pages/rrhh/Boletas";
import Acuses, { Constancia } from "./pages/rrhh/Acuses";
import Comunicados from "./pages/rrhh/Comunicados";
import Memorandums from "./pages/rrhh/Memorandums";
import Contratos from "./pages/rrhh/Contratos";
import Tardanzas from "./pages/rrhh/Tardanzas";
import Inventario from "./pages/admin/Inventario";
import Lineas from "./pages/admin/Lineas";
import EPP from "./pages/admin/EPP";
import Costos from "./pages/admin/Costos";
import Usuarios from "./pages/accesos/Usuarios";
import Perfiles from "./pages/accesos/Perfiles";
import PerfilEditor from "./pages/accesos/PerfilEditor";
import Politica from "./pages/accesos/Politica";
import RegistroAccesos from "./pages/accesos/RegistroAccesos";

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Shell />}>
            <Route path="/" element={<Navigate to="/rrhh" replace />} />
            <Route path="/rrhh" element={<Tablero />} />
            <Route path="/rrhh/personal" element={<Personal />} />
            <Route path="/rrhh/personal/:dni" element={<Legajo />} />
            <Route path="/rrhh/boletas" element={<Boletas />} />
            <Route path="/rrhh/acuses" element={<Acuses />} />
            <Route path="/rrhh/acuses/:dni" element={<Constancia />} />
            <Route path="/rrhh/comunicados" element={<Comunicados />} />
            <Route path="/rrhh/memorandums" element={<Memorandums />} />
            <Route path="/rrhh/contratos" element={<Contratos />} />
            <Route path="/rrhh/tardanzas" element={<Tardanzas />} />
            <Route path="/admin/activos" element={<Inventario />} />
            <Route path="/admin/lineas" element={<Lineas />} />
            <Route path="/admin/epp" element={<EPP />} />
            <Route path="/admin/costos" element={<Costos />} />
            <Route path="/accesos/usuarios" element={<Usuarios />} />
            <Route path="/accesos/perfiles" element={<Perfiles />} />
            <Route path="/accesos/perfiles/:id" element={<PerfilEditor />} />
            <Route path="/accesos/politica" element={<Politica />} />
            <Route path="/accesos/registro" element={<RegistroAccesos />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}
