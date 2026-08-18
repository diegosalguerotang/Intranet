import { useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, Eye, EyeOff } from "lucide-react";
import { Card, Button, Field, Input, Note } from "../components/ui";

// Aterrizaje del enlace de recuperación del BackOffice: el usuario crea aquí
// su clave nueva (mínimo 12). El token de la URL dura 1 hora, un solo uso.
function CampoClave({ ver, setVer, ...props }) {
  return (
    <div className="relative">
      <Input type={ver ? "text" : "password"} style={{ paddingRight: 38 }} {...props} />
      <button
        type="button" onClick={() => setVer((v) => !v)}
        aria-label={ver ? "Ocultar clave" : "Mostrar clave"}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-gris-cl hover:text-tinta"
      >
        {ver ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}

export default function RestablecerAdmin() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [clave, setClave] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [ver1, setVer1] = useState(false);
  const [ver2, setVer2] = useState(false);
  const [error, setError] = useState(null);
  const [listo, setListo] = useState(false);
  const [cargando, setCargando] = useState(false);

  const guardar = async (e) => {
    e.preventDefault();
    if (clave.length < 12) return setError("La clave nueva debe tener al menos 12 caracteres.");
    if (clave !== confirmar) return setError("Las claves no coinciden.");
    setError(null);
    setCargando(true);
    try {
      const r = await fetch(`${window.location.origin}/api/restablecer-clave`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, clave }),
      });
      const json = await r.json().catch(() => null);
      if (!r.ok) { setError(json?.error ?? `Error ${r.status}`); return; }
      setListo(true);
    } catch {
      setError("No se pudo guardar. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setCargando(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-papel px-4">
      <Card className="w-full max-w-md">
        <div className="mb-4 text-center">
          <ShieldCheck size={26} className="mx-auto mb-2 text-petroleo" />
          <h1 className="font-display text-[17px] font-bold text-tinta">
            {listo ? "¡Clave guardada!" : "Crea tu clave nueva"}
          </h1>
        </div>
        {listo ? (
          <div className="space-y-4 text-center">
            <Note tone="conf">Ya puedes ingresar al BackOffice con tu correo y tu clave nueva.</Note>
            <Link to="/admin/login"><Button className="w-full">Ir a ingresar</Button></Link>
          </div>
        ) : !token ? (
          <Note tone="alerta">Enlace incompleto: ábrelo completo desde tu correo, o pide uno nuevo desde el login.</Note>
        ) : (
          <form onSubmit={guardar} className="space-y-4">
            <Field label="Clave nueva" required hint="Mínimo 12 caracteres.">
              <CampoClave ver={ver1} setVer={setVer1} autoComplete="new-password" autoFocus
                          value={clave} onChange={(e) => setClave(e.target.value)} />
            </Field>
            <Field label="Confirmar clave nueva" required>
              <CampoClave ver={ver2} setVer={setVer2} autoComplete="new-password"
                          value={confirmar} onChange={(e) => setConfirmar(e.target.value)} />
            </Field>
            {error && <Note tone="alerta">{error}</Note>}
            <Button className="w-full" disabled={cargando || !clave || !confirmar}>
              {cargando ? "Guardando…" : "Guardar mi clave"}
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}
