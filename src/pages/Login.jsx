import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../state";
import { Button, Field, Input, Note } from "../components/ui";

export default function Login() {
  const { setUser } = useApp();
  const navigate = useNavigate();
  const [dni, setDni] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState(null);

  const entrar = (e) => {
    e.preventDefault();
    if (dni.length !== 8) return setError("El DNI debe tener 8 dígitos.");
    if (clave.length < 4) return setError("Ingresa tu clave.");
    setUser({ nombre: "Diego Salguero", rol: "Jefe de Recursos Humanos" });
    navigate("/rrhh");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-tinta p-4">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <div className="text-[22px] font-bold tracking-tight text-white">Grupo NEGLIAF</div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[#7fa3ac]">
            Intranet Corporativa · BackOffice
          </div>
        </div>
        <form onSubmit={entrar} className="rounded-lg border border-[#2b4f5a] bg-white p-6 shadow-2xl">
          <div className="space-y-4">
            <Field label="Número de DNI" required>
              <Input
                inputMode="numeric"
                maxLength={8}
                placeholder="8 dígitos"
                value={dni}
                onChange={(e) => setDni(e.target.value.replace(/\D/g, ""))}
                autoFocus
              />
            </Field>
            <Field label="Clave" required>
              <Input type="password" placeholder="••••••••" value={clave} onChange={(e) => setClave(e.target.value)} />
            </Field>
            {error && <Note tone="alerta">{error}</Note>}
            <Button type="submit" className="w-full">Ingresar</Button>
            <button type="button" className="w-full text-center text-[12px] font-medium text-petroleo underline underline-offset-2">
              Olvidé mi clave
            </button>
          </div>
        </form>
        <p className="mt-5 text-center font-mono text-[10px] leading-relaxed text-[#6d949e]">
          Demostración — cualquier DNI de 8 dígitos y clave ingresan.
          <br />
          Acceso restringido a personal autorizado.
        </p>
      </div>
    </div>
  );
}
