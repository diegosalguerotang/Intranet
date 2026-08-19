import { useEffect, useMemo, useState } from "react";
import { LifeBuoy, CheckCircle2 } from "lucide-react";
import { vista, rpc } from "../lib/api";
import { Tarjeta, Boton, Nota, Etiqueta, Cargando, Vacio } from "../components/ui";

const ESTADOS = {
  abierto: { tono: "pend", texto: "Abierto" },
  en_proceso: { tono: "neutral", texto: "En proceso" },
  resuelto: { tono: "conf", texto: "Resuelto" },
  cerrado: { tono: "neutral", texto: "Cerrado" },
};

// TRB — Soporte TI: reportar un problema (ticket) y seguir los propios.
// La sesión define el solicitante (portal_crear_ticket usa el DNI del JWT).
export default function Soporte() {
  const [catalogo, setCatalogo] = useState(null); // filas de v_ticket_catalogo
  const [mios, setMios] = useState(null);
  const [tipoId, setTipoId] = useState("");
  const [subtipoId, setSubtipoId] = useState("");
  const [comentario, setComentario] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  const [creado, setCreado] = useState(null); // número del ticket recién creado

  const cargar = () => {
    vista("v_ticket_catalogo").then(({ data }) => setCatalogo(data ?? []));
    vista("v_portal_tickets").then(({ data }) => setMios(data ?? []));
  };
  useEffect(cargar, []);

  const tipos = useMemo(() => {
    const vistos = new Map();
    for (const f of catalogo ?? []) if (!vistos.has(f.tipo_id)) vistos.set(f.tipo_id, f.tipo);
    return [...vistos.entries()];
  }, [catalogo]);
  const subtipos = useMemo(
    () => (catalogo ?? []).filter((f) => String(f.tipo_id) === tipoId && f.subtipo_id),
    [catalogo, tipoId]
  );

  const enviar = async (e) => {
    e.preventDefault();
    if (ocupado) return;
    setError(null);
    setOcupado(true);
    const { data, error: err } = await rpc("portal_crear_ticket", {
      p_tipo: Number(tipoId),
      p_subtipo: subtipoId ? Number(subtipoId) : null,
      p_comentario: comentario.trim() || null,
    });
    setOcupado(false);
    if (err) {
      setError(err.message);
      return;
    }
    // Aviso al equipo de TI: fire-and-forget (sin proveedor de correo no falla el ticket).
    fetch("/api/enviar-correo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "aviso-ticket", numero: data }),
    }).catch(() => {});
    setCreado(data);
    setTipoId(""); setSubtipoId(""); setComentario("");
    cargar();
  };

  if (catalogo === null || mios === null) return <Cargando />;

  const cajaCls =
    "w-full rounded-caja border border-borde bg-white px-3 py-2.5 text-[14px] text-tinta outline-none focus:border-petroleo";

  return (
    <div className="animar-aparicion space-y-4">
      <div className="flex items-center gap-2">
        <LifeBuoy size={20} className="text-petroleo" />
        <div className="text-[17px] font-bold text-tinta">Soporte TI</div>
      </div>

      {creado ? (
        <Tarjeta className="space-y-3">
          <div className="flex items-center gap-3">
            <CheckCircle2 size={22} className="shrink-0 text-conf" />
            <div>
              <div className="text-[15px] font-semibold text-conf">Ticket {creado} registrado</div>
              <div className="text-[12.5px] text-gris-cl">El equipo de TI ya fue avisado. Aquí abajo verás cómo avanza.</div>
            </div>
          </div>
          <Boton variante="secundario" onClick={() => setCreado(null)}>Reportar otro problema</Boton>
        </Tarjeta>
      ) : (
        <Tarjeta>
          <form onSubmit={enviar} className="space-y-3">
            <div>
              <label className="mb-1 block text-[12.5px] font-semibold text-gris">¿Qué tipo de problema tienes?</label>
              <select className={cajaCls} value={tipoId}
                onChange={(e) => { setTipoId(e.target.value); setSubtipoId(""); }}>
                <option value="">Seleccionar…</option>
                {tipos.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
              </select>
            </div>
            {subtipos.length > 0 && (
              <div>
                <label className="mb-1 block text-[12.5px] font-semibold text-gris">¿Cuál exactamente?</label>
                <select className={cajaCls} value={subtipoId} onChange={(e) => setSubtipoId(e.target.value)}>
                  <option value="">Seleccionar…</option>
                  {subtipos.map((s) => <option key={s.subtipo_id} value={s.subtipo_id}>{s.subtipo}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="mb-1 block text-[12.5px] font-semibold text-gris">Cuéntanos qué pasa</label>
              <textarea className={cajaCls} rows={3} value={comentario}
                onChange={(e) => setComentario(e.target.value)}
                placeholder="Qué pasa, desde cuándo, en qué equipo…" />
            </div>
            {error && <Nota tono="alerta">{error}</Nota>}
            <Boton type="submit" disabled={ocupado || !tipoId} className="w-full">
              {ocupado ? "Enviando…" : "Enviar ticket"}
            </Boton>
          </form>
        </Tarjeta>
      )}

      <section>
        <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-gris-cl">Mis tickets</h2>
        {mios.length === 0 ? (
          <Vacio titulo="Sin tickets" detalle="Cuando reportes un problema, aquí verás cómo avanza." />
        ) : (
          <div className="space-y-2">
            {mios.map((t) => {
              const est = ESTADOS[t.estado] ?? ESTADOS.abierto;
              return (
                <Tarjeta key={t.numero}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[12.5px] font-bold text-tinta">{t.numero}</span>
                    <Etiqueta tono={est.tono}>{est.texto}</Etiqueta>
                  </div>
                  <div className="mt-1 text-[13.5px] font-semibold text-tinta">
                    {t.tipo}{t.subtipo ? ` · ${t.subtipo}` : ""}
                  </div>
                  {t.comentario && <div className="mt-0.5 text-[12.5px] text-gris line-clamp-2">{t.comentario}</div>}
                  <div className="mt-1 text-[11.5px] text-gris-cl">{t.creado}</div>
                </Tarjeta>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
