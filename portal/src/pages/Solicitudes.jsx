import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2 } from "lucide-react";
import { vista, rpc } from "../lib/api";
import { usePortal } from "../state";
import { Tarjeta, Boton, Nota, Etiqueta, Cargando, Vacio } from "../components/ui";

const ESTADOS = {
  enviada: { tono: "pend", texto: "En revisión" },
  observada: { tono: "alerta", texto: "Observada" },
  aprobada: { tono: "conf", texto: "Aprobada" },
  rechazada: { tono: "neutral", texto: "Rechazada" },
  anulada: { tono: "neutral", texto: "Anulada" },
};

const cajaCls =
  "w-full rounded-caja border border-borde bg-white px-3 py-2.5 text-[14px] text-tinta outline-none focus:border-petroleo";

// TRB — Solicitudes del trabajador (web responsive, no un aplicativo). Aquí
// SOLO aparecen los tipos habilitados para el portal (hoy: vacaciones); la
// papeleta de permiso se gestiona en persona ante el supervisor y la registra
// RRHH. El solicitante es la sesión: nada se escribe a mano.
export default function Solicitudes() {
  const { perfil } = usePortal();
  const [tipos, setTipos] = useState(null);
  const [mias, setMias] = useState(null);
  const [creando, setCreando] = useState(false);
  const [creada, setCreada] = useState(null);
  const [corrigiendo, setCorrigiendo] = useState(null); // solicitud observada

  const cargar = () => {
    vista("v_solicitud_tipos", "select=*&portal=is.true&activo=is.true").then(({ data }) => setTipos(data ?? []));
    vista("v_portal_solicitudes").then(({ data }) => setMias(data ?? []));
  };
  useEffect(cargar, []);

  if (tipos === null || mias === null) return <Cargando />;
  const tipoVacaciones = tipos.find((t) => t.id === "vacaciones");

  return (
    <div className="animar-aparicion space-y-4">
      <div className="flex items-center gap-2">
        <CalendarDays size={20} className="text-petroleo" />
        <div className="text-[17px] font-bold text-tinta">Mis solicitudes</div>
      </div>

      {creada ? (
        <Tarjeta className="space-y-3">
          <div className="flex items-center gap-3">
            <CheckCircle2 size={22} className="shrink-0 text-conf" />
            <div>
              <div className="text-[15px] font-semibold text-conf">Solicitud {creada} enviada</div>
              <div className="text-[12.5px] text-gris-cl">Entró a revisión de RRHH; aquí abajo verás cómo avanza.</div>
            </div>
          </div>
          <Boton variante="secundario" onClick={() => setCreada(null)}>Listo</Boton>
        </Tarjeta>
      ) : corrigiendo ? (
        <Tarjeta>
          <div className="mb-2 text-[14px] font-bold text-tinta">Corregir {corrigiendo.numero}</div>
          {corrigiendo.ultimo_comentario && (
            <div className="mb-3"><Nota tono="alerta">Observación: «{corrigiendo.ultimo_comentario}»</Nota></div>
          )}
          <FormVacacionesPortal
            inicial={corrigiendo.datos}
            texto="Reenviar corregida"
            onEnviar={async (datos) => {
              const { error } = await rpc("reenviar_solicitud", { p_id: corrigiendo.id, p_datos: datos });
              if (error) throw new Error(error.message);
              fetch("/api/enviar-correo", { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ accion: "aviso-solicitud", numero: corrigiendo.numero, evento: "estado" }) }).catch(() => {});
              setCorrigiendo(null);
              cargar();
            }}
            onCancelar={() => setCorrigiendo(null)}
          />
        </Tarjeta>
      ) : creando && tipoVacaciones ? (
        <Tarjeta>
          <div className="mb-1 text-[14px] font-bold text-tinta">Solicitud de vacaciones</div>
          <div className="mb-3 text-[12px] text-gris-cl">
            {perfil?.nombre} · {perfil?.cargo} · {perfil?.sede}. Los días se declaran; RRHH los valida con la planilla.
          </div>
          <FormVacacionesPortal
            onEnviar={async (datos) => {
              const { data, error } = await rpc("portal_crear_solicitud", { p_tipo: "vacaciones", p_datos: datos });
              if (error) throw new Error(error.message);
              fetch("/api/enviar-correo", { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ accion: "aviso-solicitud", numero: data, evento: "creada" }) }).catch(() => {});
              setCreando(false);
              setCreada(data);
              cargar();
            }}
            onCancelar={() => setCreando(false)}
          />
        </Tarjeta>
      ) : (
        tipoVacaciones && perfil?.modo !== "solo-lectura" && (
          <Boton className="w-full" onClick={() => setCreando(true)}>Pedir vacaciones</Boton>
        )
      )}

      <section>
        <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-gris-cl">Historial</h2>
        {mias.length === 0 ? (
          <Vacio titulo="Sin solicitudes" detalle="Cuando pidas vacaciones, aquí verás cómo avanzan." />
        ) : (
          <div className="space-y-2">
            {mias.map((s) => {
              const est = ESTADOS[s.estado] ?? ESTADOS.enviada;
              return (
                <Tarjeta key={s.numero}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[12.5px] font-bold text-tinta">{s.numero}</span>
                    <Etiqueta tono={est.tono}>{est.texto}</Etiqueta>
                  </div>
                  <div className="mt-1 text-[13.5px] font-semibold text-tinta">{s.tipo}</div>
                  {s.datos?.desde && (
                    <div className="text-[12.5px] text-gris">
                      {s.datos.desde} → {s.datos.hasta} · {s.datos.dias_gozados} día(s)
                    </div>
                  )}
                  {s.paso_titulo && <div className="mt-0.5 text-[11.5px] text-gris-cl">Esperando: {s.paso_titulo}</div>}
                  {s.estado === "observada" && (
                    <>
                      {s.ultimo_comentario && (
                        <div className="mt-1 text-[12.5px] text-alerta">«{s.ultimo_comentario}»</div>
                      )}
                      <div className="mt-2">
                        <Boton variante="secundario" onClick={() => setCorrigiendo(s)}>Corregir y reenviar</Boton>
                      </div>
                    </>
                  )}
                  {s.estado === "rechazada" && s.ultimo_comentario && (
                    <div className="mt-1 text-[12.5px] text-gris">Motivo: «{s.ultimo_comentario}»</div>
                  )}
                  <div className="mt-1 text-[11.5px] text-gris-cl">{s.creado}</div>
                </Tarjeta>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function FormVacacionesPortal({ inicial = {}, onEnviar, onCancelar, texto = "Enviar solicitud" }) {
  const [f, setF] = useState({
    tipo_goce: inicial.tipo_goce ?? "Efectivas", desde: inicial.desde ?? "", hasta: inicial.hasta ?? "",
    dias_gozados: inicial.dias_gozados ?? "", dias_trabajados: inicial.dias_trabajados ?? "",
    periodo: inicial.periodo ?? "", horario: inicial.horario ?? "",
  });
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const propuestos = useMemo(() => {
    if (!f.desde || !f.hasta || f.hasta < f.desde) return null;
    return Math.round((new Date(f.hasta) - new Date(f.desde)) / 86400000) + 1;
  }, [f.desde, f.hasta]);

  const enviar = async (e) => {
    e.preventDefault();
    setError(null);
    setOcupado(true);
    try {
      await onEnviar({
        ...f,
        dias_gozados: Number(f.dias_gozados || propuestos || 0),
        dias_trabajados: f.dias_trabajados === "" ? null : Number(f.dias_trabajados),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <form onSubmit={enviar} className="space-y-3">
      <div>
        <label className="mb-1 block text-[12.5px] font-semibold text-gris">Tipo</label>
        <select className={cajaCls} value={f.tipo_goce} onChange={set("tipo_goce")}>
          <option>Efectivas</option>
          <option>Gozadas</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-[12.5px] font-semibold text-gris">Desde el</label>
          <input type="date" className={cajaCls} value={f.desde} onChange={set("desde")} required />
        </div>
        <div>
          <label className="mb-1 block text-[12.5px] font-semibold text-gris">Hasta el</label>
          <input type="date" className={cajaCls} value={f.hasta} onChange={set("hasta")} required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-[12.5px] font-semibold text-gris">Días gozados</label>
          <input inputMode="numeric" className={cajaCls} value={f.dias_gozados} onChange={set("dias_gozados")}
            placeholder={propuestos ? String(propuestos) : ""} />
          {propuestos && <div className="mt-0.5 text-[11px] text-gris-cl">El rango propone {propuestos}; lo tuyo manda.</div>}
        </div>
        <div>
          <label className="mb-1 block text-[12.5px] font-semibold text-gris">Días trabajados</label>
          <input inputMode="numeric" className={cajaCls} value={f.dias_trabajados} onChange={set("dias_trabajados")} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-[12.5px] font-semibold text-gris">Periodo</label>
          <input className={cajaCls} value={f.periodo} onChange={set("periodo")} placeholder="2025-2026" />
        </div>
        <div>
          <label className="mb-1 block text-[12.5px] font-semibold text-gris">Horario</label>
          <input className={cajaCls} value={f.horario} onChange={set("horario")} placeholder="L-V 8:00-17:00" />
        </div>
      </div>
      {error && <Nota tono="alerta">{error}</Nota>}
      <div className="flex gap-2">
        <Boton type="submit" disabled={ocupado} className="flex-1">{ocupado ? "Enviando…" : texto}</Boton>
        {onCancelar && <Boton type="button" variante="secundario" onClick={onCancelar}>Cancelar</Boton>}
      </div>
    </form>
  );
}
