import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { MailQuestion, ArrowLeft } from "lucide-react";
import { Card, Button, Field, Input, Note } from "../components/ui";
import { supabase } from "../lib/supabase";

// Landing de «Olvidé mi clave» del BackOffice (pedido de Diego 2026-08-26):
// pide (o trae pre-cargado desde el login) el correo y envía el enlace de
// restablecimiento nativo de Supabase. La respuesta es SIEMPRE genérica — no
// revela si la cuenta existe. El enlace aterriza en /admin/restablecer.
export default function OlvideClaveAdmin() {
  const { state } = useLocation();
  const [correo, setCorreo] = useState(state?.correo ?? "");
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const enviar = async (e) => {
    e.preventDefault();
    const limpio = correo.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(limpio)) {
      return setError("Escribe un correo con formato válido.");
    }
    setError(null);
    setOcupado(true);
    try {
      await supabase.auth.resetPasswordForEmail(limpio, {
        redirectTo: `${window.location.origin}/admin/restablecer`,
      });
    } catch { /* la respuesta es genérica igual */ }
    setOcupado(false);
    setEnviado(true);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-papel px-4">
      <Card className="w-full max-w-md">
        <div className="mb-4 text-center">
          <MailQuestion size={26} className="mx-auto mb-2 text-petroleo" />
          <h1 className="font-display text-[17px] font-bold text-tinta">
            {enviado ? "Revisa tu correo" : "Recupera tu acceso"}
          </h1>
        </div>
        {enviado ? (
          <div className="space-y-4">
            <Note tone="conf">
              Si <b>{correo.trim().toLowerCase()}</b> pertenece a un usuario activo, te llegará un
              enlace para crear una clave nueva. Ábrelo y sigue los pasos (el correo puede tardar
              unos minutos o caer en spam).
            </Note>
            <Link to="/admin/login"><Button className="w-full">Volver al login</Button></Link>
            <button
              type="button"
              className="w-full text-center text-[12.5px] text-petroleo hover:underline"
              onClick={() => setEnviado(false)}
            >
              ¿No te llegó? Enviar de nuevo
            </button>
          </div>
        ) : (
          <form onSubmit={enviar} className="space-y-4">
            <p className="text-[13px] leading-relaxed text-gris">
              Escribe el correo con el que ingresas al BackOffice y te enviaremos un enlace para
              crear una clave nueva.
            </p>
            <Field label="Correo electrónico" required>
              <Input
                type="email" autoComplete="username" autoFocus placeholder="tu-correo@empresa.pe"
                value={correo} onChange={(e) => setCorreo(e.target.value)}
              />
            </Field>
            {error && <Note tone="alerta">{error}</Note>}
            <Button className="w-full" disabled={ocupado || !correo.trim()}>
              {ocupado ? "Enviando…" : "Enviar enlace de restablecimiento"}
            </Button>
            <Link
              to="/admin/login"
              className="flex items-center justify-center gap-1.5 text-[12.5px] font-medium text-petroleo hover:underline"
            >
              <ArrowLeft size={13} /> Volver al login
            </Link>
          </form>
        )}
      </Card>
    </main>
  );
}
