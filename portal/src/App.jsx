import { useEffect } from "react";
import { PortalProvider, usePortal } from "./state";
import { RouterProvider, useRouter } from "./router";
import Marco from "./layout/Marco";
import Ingreso from "./pages/Ingreso";
import OlvideClave from "./pages/OlvideClave";
import PrimerIngreso from "./pages/PrimerIngreso";
import Inicio from "./pages/Inicio";
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

  let pantalla = <Inicio />;
  // Las pestañas Boletas y Yo llegan en las tareas 6-8 del plan.
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
