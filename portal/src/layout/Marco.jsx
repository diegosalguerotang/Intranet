import { Home, FileText, LifeBuoy, User } from "lucide-react";
import { usePortal } from "../state";
import { useRouter, Enlace } from "../router";
import { Nota } from "../components/ui";

// Marco del portal: cabecera compacta + contenido + barra inferior fija
// (Inicio · Boletas · Soporte · Yo). Pensado para una mano y un celular de gama baja.
const PESTANAS = [
  { to: "/", icon: Home, label: "Inicio" },
  { to: "/boletas", icon: FileText, label: "Boletas" },
  { to: "/soporte", icon: LifeBuoy, label: "Soporte" },
  { to: "/yo", icon: User, label: "Yo" },
];

export default function Marco({ children }) {
  const { soloLectura } = usePortal();
  const { ruta } = useRouter();

  const activa = (to) => (to === "/" ? ruta === "/" : ruta.startsWith(to));

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="sticky top-0 z-30 flex items-center justify-between bg-white px-4 py-3 shadow-[0_1px_6px_rgba(0,0,0,0.08)]">
        <div className="font-display text-[17px] font-bold tracking-tight text-tinta">
          Grupo<span className="text-petroleo">ER</span>
        </div>
        <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-acero">Portal del Trabajador</div>
      </header>

      {soloLectura && (
        <div className="px-4 pt-3">
          <Nota tono="pend">
            Tu vínculo laboral terminó: puedes ver y descargar tus documentos, pero ya no confirmar ni editar.
          </Nota>
        </div>
      )}

      <main className="flex-1 px-4 py-4 pb-24">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-md border-t border-borde bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="flex">
          {PESTANAS.map(({ to, icon: Icon, label }) => (
            <Enlace
              key={to}
              to={to}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold ${
                activa(to) ? "text-petroleo" : "text-gris-cl"
              }`}
            >
              <Icon size={20} />
              {label}
            </Enlace>
          ))}
        </div>
      </nav>
    </div>
  );
}
