import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { vista, rpc } from "../lib/api";
import { usePortal } from "../state";
import { Enlace } from "../router";
import { Boton, Nota, Cargando, Vacio } from "../components/ui";
import HojaDeclaracion from "../components/HojaDeclaracion";

// TRB-08 · Comunicado: leer y, solo si lo exige, dejar constancia de la
// lectura. Sin exigencia, el visto queda en auditoría sin constancia.
export default function Comunicado({ id }) {
  const { soloLectura } = usePortal();
  const [com, setCom] = useState(undefined);
  const [hoja, setHoja] = useState(false);
  const [declaracion, setDeclaracion] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);

  const cargar = async () => {
    const { data } = await vista("v_portal_comunicados", `select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
    setCom(data?.[0] ?? null);
  };
  useEffect(() => {
    cargar();
    rpc("portal_marcar_visto", { p_comunicado_id: Number(id) }); // visto automático
    vista("v_declaraciones_vigentes", "select=version,texto&id=eq.lectura-comunicado&limit=1")
      .then(({ data }) => setDeclaracion(data?.[0] ?? null));
  }, [id]);

  if (com === undefined) return <Cargando />;
  if (com === null) return <Vacio titulo="El comunicado no existe" />;

  const confirmar = async () => {
    setOcupado(true);
    setError(null);
    const r = await rpc("portal_confirmar_lectura", {
      p_comunicado_id: Number(id),
      p_dispositivo: navigator.userAgent.slice(0, 150),
    });
    setOcupado(false);
    setHoja(false);
    if (r.error) { setError(r.error.message); return; }
    await cargar();
  };

  return (
    <div className="animar-aparicion space-y-4">
      <Enlace to="/" className="inline-flex items-center gap-1 text-[13px] font-semibold text-petroleo">
        <ArrowLeft size={15} /> Inicio
      </Enlace>

      <div>
        <div className="text-[12px] font-semibold uppercase tracking-wide text-acero">
          Comunicado · {com.publicado}
        </div>
        <h1 className="mt-1 text-[18px] font-bold leading-snug text-tinta">{com.titulo}</h1>
      </div>

      <div className="whitespace-pre-line rounded-caja border border-borde bg-white p-4 text-[14.5px] leading-relaxed text-gris shadow-[0_2px_10px_rgba(29,63,114,0.06)]">
        {com.cuerpo}
      </div>

      {error && <Nota tono="alerta">{error}</Nota>}

      {com.exigeAcuse && (
        com.confirmado ? (
          <Nota tono="conf">
            <span className="flex items-center gap-2"><CheckCircle2 size={16} /> Lectura confirmada el {com.confirmadoEn}.</span>
          </Nota>
        ) : !soloLectura && com.vigente ? (
          <Boton onClick={() => setHoja(true)} disabled={!declaracion}>Confirmar que lo leí</Boton>
        ) : null
      )}

      {hoja && declaracion && (
        <HojaDeclaracion
          titulo="Confirmar lectura"
          explicacion="Quedarán registrados la fecha, la hora y tu dispositivo."
          texto={declaracion.texto}
          textoBoton="Sí, confirmo la lectura"
          onConfirmar={confirmar}
          onCerrar={() => setHoja(false)}
          ocupado={ocupado}
        />
      )}
    </div>
  );
}
