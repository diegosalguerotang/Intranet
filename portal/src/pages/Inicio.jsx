import { usePortal } from "../state";
import { Tarjeta } from "../components/ui";

// Placeholder del scaffold: la pantalla real de TRB-04 llega en la Tarea 6.
export default function Inicio() {
  const { perfil } = usePortal();
  return (
    <Tarjeta>
      <div className="text-[17px] font-bold text-tinta">Hola, {perfil?.nombrePila} 👋</div>
      <p className="mt-1 text-[13.5px] text-gris">El portal está en construcción.</p>
    </Tarjeta>
  );
}
