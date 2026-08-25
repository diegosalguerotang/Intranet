import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppProvider, useApp } from "./state";
import { nivelDe, primeraRuta, MODULOS_RRHH } from "./data/modulos";
import { EmptyState } from "./components/ui";
import Shell from "./layout/Shell";
import AdminLogin from "./pages/AdminLogin";
import RestablecerAdmin from "./pages/RestablecerAdmin";
import Tablero from "./pages/rrhh/Tablero";
import Personal from "./pages/rrhh/Personal";
import Sedes from "./pages/rrhh/Sedes";
import Legajo from "./pages/rrhh/Legajo";
import Boletas from "./pages/rrhh/Boletas";
import Acuses, { Constancia } from "./pages/rrhh/Acuses";
import Comunicados from "./pages/rrhh/Comunicados";
import Memorandums from "./pages/rrhh/Memorandums";
import Asistencia from "./pages/rrhh/Asistencia";
import Inventario from "./pages/admin/Inventario";
import Lineas from "./pages/admin/Lineas";
import Tickets from "./pages/soporte/Tickets";
import ConfigTickets from "./pages/soporte/ConfigTickets";
import BandejaSolicitudes from "./pages/solicitudes/Bandeja";
import MiSolicitud from "./pages/solicitudes/MiSolicitud";
import NuevaSolicitud from "./pages/solicitudes/Nueva";
import AvisosSolicitudes from "./pages/solicitudes/Avisos";
import TableroSolicitudes from "./pages/solicitudes/Tablero";
// EPP (ADQ-06, «Próximamente») y Costo por sede (ADQ-07, retirado) sin ruta
// desde 2026-08-17: sus pantallas siguen en el repo para cuando vuelvan.
import Usuarios from "./pages/accesos/Usuarios";
import Perfiles from "./pages/accesos/Perfiles";
import PerfilEditor from "./pages/accesos/PerfilEditor";
import Politica from "./pages/accesos/Politica";
import RegistroAccesos from "./pages/accesos/RegistroAccesos";

// Enforcement de ruta (Accesos v2): si la categoría del usuario no concede el
// módulo, la pantalla no se renderiza y se redirige al inicio permitido. La
// BD aún confía en la app (RLS = fase siguiente, documentada en la spec).
function RequiereModulo({ modulo, children }) {
  const { user } = useApp();
  if (!user) return children; // la puerta de sesión la maneja Shell
  const acceso = user.acceso ?? { esSuperadmin: user.esSuperadmin, matriz: {} };
  if (nivelDe(acceso, modulo) >= 1) return children;
  const inicio = primeraRuta(acceso);
  return inicio ? <Navigate to={inicio} replace /> : <SinAccesos />;
}

function SinAccesos() {
  return (
    <EmptyState
      title="Tu categoría no concede acceso a ningún módulo"
      body="Pide a un administrador que revise tu categoría en Accesos y Roles."
    />
  );
}

// La raíz aterriza en la primera pantalla que la categoría permite.
function Inicio() {
  const { user } = useApp();
  const inicio = user ? primeraRuta(user.acceso ?? { esSuperadmin: user.esSuperadmin }) : "/rrhh";
  return inicio ? <Navigate to={inicio} replace /> : <SinAccesos />;
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          {/* Puerta del BackOffice. /login queda reservado al Portal del
              Trabajador (aún no construido) y por ahora redirige. */}
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin/restablecer" element={<RestablecerAdmin />} />
          <Route path="/login" element={<Navigate to="/admin/login" replace />} />
          <Route element={<Shell />}>
            <Route path="/" element={<Inicio />} />
            <Route path="/rrhh" element={<RequiereModulo modulo={MODULOS_RRHH}><Tablero /></RequiereModulo>} />
            <Route path="/rrhh/personal" element={<RequiereModulo modulo="personal"><Personal /></RequiereModulo>} />
            <Route path="/rrhh/personal/:dni" element={<RequiereModulo modulo="personal"><Legajo /></RequiereModulo>} />
            <Route path="/rrhh/sedes" element={<RequiereModulo modulo="personal"><Sedes /></RequiereModulo>} />
            <Route path="/rrhh/boletas" element={<RequiereModulo modulo="boletas"><Boletas /></RequiereModulo>} />
            <Route path="/rrhh/acuses" element={<RequiereModulo modulo="acuses"><Acuses /></RequiereModulo>} />
            <Route path="/rrhh/acuses/:dni" element={<RequiereModulo modulo="acuses"><Constancia /></RequiereModulo>} />
            <Route path="/rrhh/comunicados" element={<RequiereModulo modulo="comunicados"><Comunicados /></RequiereModulo>} />
            <Route path="/rrhh/memorandums" element={<RequiereModulo modulo="memorandums"><Memorandums /></RequiereModulo>} />
            <Route path="/rrhh/asistencia" element={<RequiereModulo modulo="asistencia"><Asistencia /></RequiereModulo>} />
            <Route path="/admin/activos" element={<RequiereModulo modulo="activos"><Inventario /></RequiereModulo>} />
            <Route path="/admin/lineas" element={<RequiereModulo modulo="activos"><Lineas /></RequiereModulo>} />
            <Route path="/soporte/tickets" element={<RequiereModulo modulo="soporte"><Tickets /></RequiereModulo>} />
            <Route path="/soporte/config" element={<RequiereModulo modulo="soporte"><ConfigTickets /></RequiereModulo>} />
            {/* Mi solicitud: SIN guard de módulo — cualquier usuario autenticado
                registra la suya (botón flotante global del Shell). */}
            <Route path="/mi-solicitud" element={<MiSolicitud />} />
            <Route path="/solicitudes" element={<RequiereModulo modulo="solicitudes"><BandejaSolicitudes /></RequiereModulo>} />
            <Route path="/solicitudes/nueva" element={<RequiereModulo modulo="solicitudes"><NuevaSolicitud /></RequiereModulo>} />
            <Route path="/solicitudes/avisos" element={<RequiereModulo modulo="solicitudes"><AvisosSolicitudes /></RequiereModulo>} />
            <Route path="/solicitudes/tablero" element={<RequiereModulo modulo="solicitudes"><TableroSolicitudes /></RequiereModulo>} />
            <Route path="/accesos/usuarios" element={<RequiereModulo modulo="accesos"><Usuarios /></RequiereModulo>} />
            <Route path="/accesos/perfiles" element={<RequiereModulo modulo="accesos"><Perfiles /></RequiereModulo>} />
            <Route path="/accesos/perfiles/:id" element={<RequiereModulo modulo="accesos"><PerfilEditor /></RequiereModulo>} />
            <Route path="/accesos/politica" element={<RequiereModulo modulo="accesos"><Politica /></RequiereModulo>} />
            <Route path="/accesos/registro" element={<RequiereModulo modulo="auditoria"><RegistroAccesos /></RequiereModulo>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}
