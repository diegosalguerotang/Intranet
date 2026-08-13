import { useEffect } from "react";
import { PortalProvider, usePortal } from "./state";
import { RouterProvider, useRouter } from "./router";
import Marco from "./layout/Marco";
import Ingreso from "./pages/Ingreso";
import OlvideClave from "./pages/OlvideClave";
import PrimerIngreso from "./pages/PrimerIngreso";
import Inicio from "./pages/Inicio";
import Boletas from "./pages/Boletas";
import Documento from "./pages/Documento";
import Comunicado from "./pages/Comunicado";
import MisDatos from "./pages/MisDatos";
import { Cargando } from "./components/ui";

// Guards centralizados: sin sesión → Ingreso; primer ingreso pendiente →
// TRB-03 no salteable; con sesión → Marco con la pantalla de la ruta.
function Pantallas() {
  const { perfil } = usePortal();
  const { ruta, ir } = useRouter();

  // Con sesión activa, las rutas públicas rebotan al inicio.
  useEffect(() => {
    if (perfil && !perfil.expulsado && !perfil.primerIngresoPendiente
        && (ruta === "/ingreso" || ruta === "/olvide-clave" || ruta === "/primer-ingreso")) {
      ir("/", { reemplazar: true });
    }
  }, [perfil, ruta]);

  if (ruta === "/olvide-clave") return <OlvideClave />;
  if (perfil === undefined) return <Cargando />;
  if (!perfil || perfil.expulsado) return <Ingreso />;
  if (perfil.primerIngresoPendiente) return <PrimerIngreso />;

  let pantalla;
  if (ruta === "/boletas") pantalla = <Boletas />;
  else if (ruta.startsWith("/documento/")) pantalla = <Documento id={ruta.split("/")[2]} />;
  else if (ruta.startsWith("/comunicado/")) pantalla = <Comunicado id={ruta.split("/")[2]} />;
  else if (ruta === "/yo") pantalla = <MisDatos />;
  else pantalla = <Inicio />;

  return <Marco>{pantalla}</Marco>;
}

export default function App() {
  return (
    <PortalProvider>
      <RouterProvider>
        <Pantallas />
      </RouterProvider>
    </PortalProvider>
  );
}
