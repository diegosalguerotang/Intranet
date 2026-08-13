import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { vista } from "../lib/api";
import { Enlace } from "../router";
import { Etiqueta, Cargando, Vacio } from "../components/ui";

// TRB-05 · Mis boletas: histórico completo agrupado por año, de TODAS las
// empresas del grupo — la persona es una sola y su historial la sigue.
export default function Boletas() {
  const [filas, setFilas] = useState(null);
  const [abiertos, setAbiertos] = useState({});

  useEffect(() => {
    vista("v_portal_boletas").then(({ data }) => {
      const xs = data ?? [];
      setFilas(xs);
      if (xs[0]) setAbiertos({ [xs[0].anio]: true }); // el año más reciente abierto
    });
  }, []);

  if (filas === null) return <Cargando />;
  if (filas.length === 0) {
    return <Vacio titulo="Aún no tienes boletas" detalle="Cuando Recursos Humanos publique tus documentos, aparecerán aquí." />;
  }

  const porAnio = {};
  for (const f of filas) (porAnio[f.anio] ??= []).push(f);
  const anios = Object.keys(porAnio).sort((a, b) => b.localeCompare(a));

  return (
    <div className="animar-aparicion space-y-3">
      <h1 className="text-[17px] font-bold text-tinta">Mis boletas y documentos</h1>
      {anios.map((anio) => (
        <section key={anio} className="overflow-hidden rounded-caja border border-borde bg-white shadow-[0_2px_10px_rgba(29,63,114,0.06)]">
          <button
            className="flex w-full items-center justify-between px-4 py-3 text-left"
            onClick={() => setAbiertos((a) => ({ ...a, [anio]: !a[anio] }))}
          >
            <span className="text-[15px] font-bold text-tinta">{anio}</span>
            <span className="flex items-center gap-2 text-[12px] text-gris-cl">
              {porAnio[anio].length} documento{porAnio[anio].length !== 1 ? "s" : ""}
              {abiertos[anio] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </span>
          </button>
          {abiertos[anio] && (
            <div className="divide-y divide-borde border-t border-borde">
              {porAnio[anio].map((b) => (
                <Enlace key={b.id} to={`/documento/${b.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-papel">
                  <div className="flex-1">
                    <div className="text-[14px] font-semibold leading-snug text-tinta">{b.titulo}</div>
                    <div className="text-[12px] text-gris-cl">
                      {b.tipo} · {b.empresa}{b.estado === "reemplazado" ? " · versión anterior" : ""}
                    </div>
                  </div>
                  {b.estado === "reemplazado" ? (
                    <Etiqueta tono="neutral">Reemplazada</Etiqueta>
                  ) : b.confirmadoEn ? (
                    <div className="text-right">
                      <Etiqueta tono="conf">Conforme</Etiqueta>
                      <div className="mt-0.5 text-[10.5px] text-gris-cl">{b.confirmadoEn}</div>
                    </div>
                  ) : (
                    <Etiqueta tono="pend">Por revisar</Etiqueta>
                  )}
                </Enlace>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
