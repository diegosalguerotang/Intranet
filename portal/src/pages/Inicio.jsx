import { useEffect, useState } from "react";
import { ChevronRight, CheckCircle2 } from "lucide-react";
import { vista } from "../lib/api";
import { usePortal } from "../state";
import { Enlace } from "../router";
import { Tarjeta, Etiqueta, Cargando } from "../components/ui";

// TRB-04 · Inicio: lo que requiere acción, sin obligar a navegar. El vacío es
// explícito: el trabajador debe saber que está al día.
export default function Inicio() {
  const { perfil } = usePortal();
  const [pendientes, setPendientes] = useState(null);
  const [mes, setMes] = useState(null);

  useEffect(() => {
    vista("v_portal_pendientes").then(({ data }) => setPendientes(data ?? []));
    vista("v_portal_mes", "select=*&limit=1").then(({ data }) => setMes(data?.[0] ?? null));
  }, []);

  if (pendientes === null) return <Cargando />;

  return (
    <div className="animar-aparicion space-y-4">
      <div>
        <div className="text-[19px] font-bold text-tinta">Hola, {perfil?.nombrePila} 👋</div>
        <div className="text-[13px] text-gris-cl">{perfil?.cargo} · {perfil?.sede}</div>
      </div>

      <section>
        <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-gris-cl">Te falta revisar</h2>
        {pendientes.length === 0 ? (
          <Tarjeta className="flex items-center gap-3">
            <CheckCircle2 size={22} className="shrink-0 text-conf" />
            <div>
              <div className="text-[15px] font-semibold text-conf">Estás al día</div>
              <div className="text-[12.5px] text-gris-cl">No tienes documentos pendientes de revisar.</div>
            </div>
          </Tarjeta>
        ) : (
          <div className="space-y-2">
            {pendientes.map((p) => (
              <Enlace
                key={`${p.clase}-${p.ref}`}
                to={p.clase === "comunicado" ? `/comunicado/${p.ref}` : `/documento/${p.ref}`}
                className="flex items-center gap-3 rounded-caja border border-borde bg-white p-3.5 shadow-[0_2px_10px_rgba(29,63,114,0.06)] active:bg-papel"
              >
                <div className="flex-1">
                  <Etiqueta tono="pend">Por revisar</Etiqueta>
                  <div className="mt-1 text-[14.5px] font-semibold leading-snug text-tinta">{p.titulo}</div>
                  <div className="text-[12px] text-gris-cl">{p.etiqueta} · {p.fecha}</div>
                </div>
                <ChevronRight size={18} className="shrink-0 text-gris-cl" />
              </Enlace>
            ))}
          </div>
        )}
      </section>

      {mes && (
        <section>
          <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-gris-cl">Tu mes</h2>
          <Tarjeta className="flex items-center justify-between">
            <div className="text-[13.5px] text-gris">Tardanzas del periodo {mes.periodo}</div>
            <div className={`text-[22px] font-bold ${mes.tardanzas > 0 ? "text-pend" : "text-conf"}`}>{mes.tardanzas}</div>
          </Tarjeta>
        </section>
      )}
    </div>
  );
}
