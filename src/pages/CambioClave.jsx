import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useApp } from "../state";
import { supabase } from "../lib/supabase";
import { Card, Button, Field, Input, Note } from "../components/ui";

// Cambio de clave obligatorio en el primer ingreso (Cierre de Acceso v1.0):
// hasta reemplazar la clave provisional no se puede operar ninguna pantalla.
// Así, ni siquiera quien configuró el despliegue conserva la clave operativa.
export default function CambioClave() {
  const { user, db, claveCambiada } = useApp();
  const minimo = Math.max(12, db.politica[0]?.claveLongitudMinBackoffice ?? 12);
  const [clave, setClave] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  const guardar = async (e) => {
    e.preventDefault();
    if (clave.length < minimo) return setError(`La clave nueva debe tener al menos ${minimo} caracteres.`);
    if (clave !== confirmar) return setError("Las claves no coinciden.");
    setError(null);
    setCargando(true);
    const { error: err } = await supabase.auth.updateUser({ password: clave });
    if (err) {
      setCargando(false);
      return setError(err.message.includes("different from the old")
        ? "La clave nueva debe ser distinta de la provisional."
        : "No se pudo actualizar la clave. Inténtalo de nuevo.");
    }
    await claveCambiada();
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-papel px-4">
      <Card className="w-full max-w-md">
        <div className="mb-4 text-center">
          <ShieldCheck size={26} className="mx-auto mb-2 text-petroleo" />
          <h1 className="font-display text-[17px] font-bold text-tinta">Reemplaza tu clave provisional</h1>
          <p className="mt-1 text-[12.5px] leading-relaxed text-gris">
            {user?.nombre}, tu clave actual es de un solo uso. Hasta que la reemplaces no puedes operar
            ninguna pantalla del BackOffice.
          </p>
        </div>
        <form onSubmit={guardar} className="space-y-4">
          <Field label="Clave nueva" required hint={`Mínimo ${minimo} caracteres. No se guarda en texto plano en ningún entorno.`}>
            <Input type="password" autoComplete="new-password" autoFocus value={clave} onChange={(e) => setClave(e.target.value)} />
          </Field>
          <Field label="Confirmar clave nueva" required>
            <Input type="password" autoComplete="new-password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} />
          </Field>
          {error && <Note tone="alerta">{error}</Note>}
          <Button className="w-full" disabled={cargando || !clave || !confirmar}>
            {cargando ? "Guardando…" : "Guardar y continuar"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
