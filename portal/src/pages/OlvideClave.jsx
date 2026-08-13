import { Enlace } from "../router";
import { Boton, Tarjeta } from "../components/ui";

// TRB-02 llegará con el motor de mensajería (código por WhatsApp/SMS).
// Mientras tanto: el camino seguro es una persona de confianza.
export default function OlvideClave() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-8">
      <Tarjeta className="animar-aparicion">
        <h1 className="text-[18px] font-bold text-tinta">¿Olvidaste tu clave?</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-gris">
          Para cuidar tus documentos, la clave solo se puede restablecer en persona:
        </p>
        <ul className="mt-3 space-y-2 text-[14px] text-gris">
          <li className="rounded-caja bg-papel px-3.5 py-2.5">👷 Habla con <b>tu supervisor</b> de sede, o</li>
          <li className="rounded-caja bg-papel px-3.5 py-2.5">🏢 acércate a <b>Recursos Humanos</b>.</li>
        </ul>
        <p className="mt-3 text-[13px] leading-relaxed text-gris-cl">
          Te entregarán una clave nueva de un solo uso. Muy pronto también podrás recuperarla tú mismo con un
          código a tu celular.
        </p>
        <div className="mt-5">
          <Enlace to="/ingreso"><Boton variante="secundario" type="button">Volver</Boton></Enlace>
        </div>
      </Tarjeta>
    </main>
  );
}
