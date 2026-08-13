import { useEffect, useRef, useState } from "react";
import { Boton } from "./ui";

// TRB-07 · Hoja de declaración: el texto que el trabajador acepta, de forma
// que no pueda alegar que confirmó sin saber qué confirmaba. El botón se
// habilita solo cuando la declaración se leyó hasta el final.
export default function HojaDeclaracion({ titulo, explicacion, texto, textoBoton, onConfirmar, onCerrar, ocupado }) {
  const caja = useRef(null);
  const [leida, setLeida] = useState(false);

  useEffect(() => {
    const el = caja.current;
    if (el && el.scrollHeight <= el.clientHeight + 8) setLeida(true); // cabe completa
  }, [texto]);

  const alDesplazar = (e) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setLeida(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-tinta/60" onClick={onCerrar}>
      <div
        className="animar-aparicion max-h-[88dvh] w-full max-w-md overflow-hidden rounded-t-[16px] bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex max-h-[88dvh] flex-col p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          <h2 className="text-[17px] font-bold text-tinta">{titulo}</h2>
          <p className="mt-1 text-[12.5px] leading-snug text-gris-cl">{explicacion}</p>
          <div
            ref={caja}
            onScroll={alDesplazar}
            className="mt-3 flex-1 overflow-y-auto whitespace-pre-line rounded-caja border border-borde bg-papel px-3.5 py-3 text-[13px] leading-relaxed text-gris"
          >
            {texto}
          </div>
          {!leida && (
            <p className="mt-2 text-center text-[11.5px] text-gris-cl">Desliza hasta el final para poder confirmar.</p>
          )}
          <div className="mt-4 space-y-2">
            <Boton onClick={onConfirmar} disabled={!leida || ocupado}>
              {ocupado ? "Registrando…" : textoBoton}
            </Boton>
            <Boton variante="secundario" type="button" onClick={onCerrar} disabled={ocupado}>
              Todavía no
            </Boton>
          </div>
        </div>
      </div>
    </div>
  );
}
