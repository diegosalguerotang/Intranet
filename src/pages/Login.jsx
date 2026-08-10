import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { User, KeyRound } from "lucide-react";
import { useApp } from "../state";
import { Note } from "../components/ui";

export default function Login() {
  const { setUser, db } = useApp();
  const navigate = useNavigate();
  const [dni, setDni] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState(null);

  const entrar = (e) => {
    e.preventDefault();
    if (dni.length !== 8) return setError("El usuario debe ser tu DNI de 8 dígitos.");
    if (clave.length < 4) return setError("Ingresa tu contraseña.");
    setUser({ nombre: "Diego Salguero", rol: "Jefe de Recursos Humanos" });
    navigate("/rrhh");
  };

  const logos = db.empresas.filter((e) => e.logo);

  return (
    <main
      className="flex min-h-screen flex-col justify-between"
      style={{ background: "linear-gradient(180deg, #ffffff 0%, #e9eff6 55%, #d5e2ee 100%)" }}
    >
      {/* Marca centrada */}
      <div className="container mx-auto mt-14 mb-6 px-4 text-center">
        <div className="text-[34px] font-bold leading-none tracking-tight text-tinta">
          Grupo<span className="text-petroleo">ER</span>
        </div>
        <div className="mt-1.5 text-[13px] font-medium uppercase tracking-[0.3em] text-acero">
          Intranet Corporativa
        </div>
      </div>

      {/* Formulario */}
      <section className="w-full">
        <div className="mx-auto w-full max-w-md px-6">
          <form onSubmit={entrar}>
            <div className="mb-5 flex">
              <div className="flex items-center border-2 border-r-0 border-petroleo px-3 text-petroleo">
                <User size={20} />
              </div>
              <input
                type="text"
                inputMode="numeric"
                maxLength={8}
                placeholder="Usuario"
                autoFocus
                value={dni}
                onChange={(e) => setDni(e.target.value.replace(/\D/g, ""))}
                className="w-full border-2 border-petroleo bg-transparent px-3 py-2.5 text-[17px] text-petroleo placeholder:text-petroleo/70 focus:outline-none"
              />
            </div>

            <div className="mb-3 flex">
              <div className="flex items-center border-2 border-r-0 border-petroleo px-3 text-petroleo">
                <KeyRound size={20} />
              </div>
              <input
                type="password"
                placeholder="Contraseña"
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                className="w-full border-2 border-petroleo bg-transparent px-3 py-2.5 text-[17px] text-petroleo placeholder:text-petroleo/70 focus:outline-none"
              />
            </div>

            <p className="mb-6 text-right text-[12.5px]">
              <a href="#" className="text-petroleo hover:text-pend hover:underline">Recuperar contraseña</a>
            </p>

            {error && <div className="mb-4"><Note tone="alerta">{error}</Note></div>}

            <p className="text-center">
              <button
                type="submit"
                className="rounded-[4px] bg-petroleo px-10 py-3 text-[20px] font-semibold text-white transition-colors hover:bg-petroleo-cl"
              >
                Ingresar
              </button>
            </p>

            <p className="mt-6 text-center font-mono text-[10px] leading-relaxed text-gris-cl">
              Demostración — cualquier DNI de 8 dígitos y clave ingresan.
              <br />
              Acceso restringido a personal autorizado del Grupo ER.
            </p>
          </form>
        </div>
      </section>

      {/* Franja de logos de las empresas del grupo */}
      <footer className="mb-6 mt-10 w-full px-4">
        <ul className="flex list-none items-center justify-center gap-8">
          {logos.map((e) => (
            <li key={e.id}>
              <div className="flex h-16 w-36 items-center justify-center rounded-[4px] bg-white p-2 shadow-[0_0_3px_rgba(0,0,0,0.15)]">
                <img src={e.logo} alt={e.nombre} className="max-h-full max-w-full object-contain" />
              </div>
            </li>
          ))}
        </ul>
      </footer>
    </main>
  );
}
