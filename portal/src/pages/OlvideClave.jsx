import { useState } from "react";
import { Enlace } from "../router";
import { Boton, Nota, Tarjeta } from "../components/ui";

// TRB-02 (parcial, 2026-08-17): recuperación por CORREO para quien lo declaró
// y verificó en su primer ingreso. Para el resto sigue el camino en persona.
// El código por WhatsApp/SMS llegará con el motor de mensajería.
export default function OlvideClave() {
  const [dni, setDni] = useState("");
  const [mensaje, setMensaje] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const pedir = async (e) => {
    e.preventDefault();
    if (dni.length !== 8 || ocupado) return;
    setOcupado(true);
    try {
      const r = await fetch(`${window.location.origin}/api/enviar-correo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accion: "recuperacion", dni }),
      });
      const json = await r.json().catch(() => null);
      setMensaje(json?.mensaje ?? json?.error ??
        "Si tu correo está registrado y verificado, te llegará un enlace para crear una clave nueva.");
    } catch {
      setMensaje("No se pudo enviar la solicitud. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-8">
      <Tarjeta className="animar-aparicion">
        <h1 className="text-[18px] font-bold text-tinta">¿Olvidaste tu clave?</h1>

        <form onSubmit={pedir} className="mt-3">
          <span className="mb-1 block text-[13px] font-semibold text-tinta">Tu DNI</span>
          <input
            type="text" inputMode="numeric" maxLength={8} placeholder="8 dígitos"
            value={dni}
            onInput={(e) => setDni(e.currentTarget.value.replace(/\D/g, ""))}
            className="w-full rounded-caja border border-borde-f px-4 py-3 text-[16px] focus:border-petroleo focus:outline-none"
          />
          <p className="mt-1 text-[12px] leading-snug text-gris-cl">
            Si registraste y confirmaste tu correo, te mandamos un enlace para crear una clave nueva.
          </p>
          <div className="mt-3">
            <Boton type="submit" disabled={dni.length !== 8 || ocupado}>
              {ocupado ? "Enviando…" : "Enviarme el enlace a mi correo"}
            </Boton>
          </div>
        </form>
        {mensaje && <div className="mt-3"><Nota tono="neutral">{mensaje}</Nota></div>}

        <p className="mt-5 text-[14px] leading-relaxed text-gris">¿No tienes correo registrado? El camino en persona sigue disponible:</p>
        <ul className="mt-2 space-y-2 text-[14px] text-gris">
          <li className="rounded-caja bg-papel px-3.5 py-2.5">👷 Habla con <b>tu supervisor</b> de sede, o</li>
          <li className="rounded-caja bg-papel px-3.5 py-2.5">🏢 acércate a <b>Recursos Humanos</b>.</li>
        </ul>
        <div className="mt-5">
          <Enlace to="/ingreso"><Boton variante="secundario" type="button">Volver</Boton></Enlace>
        </div>
      </Tarjeta>
    </main>
  );
}
