import { useEffect, useState } from "react";
import { LogOut, BookOpen } from "lucide-react";
import { vista, rpc, tokenSesion } from "../lib/api";
import { usePortal } from "../state";
import { Tarjeta, Boton, Nota, Cargando } from "../components/ui";

// El RIT SIEMPRE está disponible para leer (pedido de Diego 2026-08-19): el
// reglamento del trabajador se resuelve por su planilla (sede → empresa) y la
// URL firmada se pide fresca en cada lectura (bucket privado).
function ReglamentoInterno() {
  const [rit, setRit] = useState(null);
  const [error, setError] = useState(null);
  const [abriendo, setAbriendo] = useState(false);
  useEffect(() => {
    vista("v_portal_rit", "select=*&limit=1").then(({ data }) => setRit(data?.[0] ?? null));
  }, []);
  if (!rit) return null;

  const leer = async () => {
    setError(null);
    setAbriendo(true);
    try {
      const r = await fetch("/api/rit", { headers: { "x-sesion": tokenSesion() ?? "" } });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo abrir el reglamento.");
      window.open(j.url, "_blank");
    } catch (e) {
      setError(e.message);
    } finally {
      setAbriendo(false);
    }
  };

  return (
    <Tarjeta>
      <div className="flex items-center gap-2 text-[13px] font-semibold text-tinta">
        <BookOpen size={16} className="text-petroleo" /> Reglamento Interno de Trabajo
      </div>
      <div className="mt-1 text-[12.5px] text-gris-cl">
        {rit.nombre} · vigente desde {rit.vigente_desde}. Es el reglamento que aplica a tu sede.
      </div>
      {error && <div className="mt-2"><Nota tono="alerta">{error}</Nota></div>}
      <div className="mt-3">
        <Boton variante="secundario" type="button" onClick={leer} disabled={abriendo || !rit.disponible}>
          {abriendo ? "Abriendo…" : "Leer el reglamento (PDF)"}
        </Boton>
      </div>
    </Tarjeta>
  );
}

// TRB-12 · Mis datos: contacto actualizable sin abrir la puerta a fraude.
// La cuenta de haberes JAMÁS se edita aquí: genera solicitud para RRHH.
export default function MisDatos() {
  const { salir, soloLectura } = usePortal();
  const [datos, setDatos] = useState(undefined);
  const [celular, setCelular] = useState("");
  const [direccion, setDireccion] = useState("");
  const [aviso, setAviso] = useState(null);
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [solicitud, setSolicitud] = useState(false);
  const [motivo, setMotivo] = useState("");

  const cargar = async () => {
    const { data } = await vista("v_portal_datos", "select=*&limit=1");
    const d = data?.[0] ?? null;
    setDatos(d);
    setCelular(d?.celular ?? "");
    setDireccion(d?.direccion ?? "");
  };
  useEffect(() => { cargar(); }, []);

  if (datos === undefined) return <Cargando />;
  if (!datos) return null;

  const guardar = async (e) => {
    e.preventDefault();
    if (celular && !/^[0-9]{9}$/.test(celular)) return setError("El celular tiene 9 dígitos.");
    setError(null);
    setOcupado(true);
    const r = await rpc("portal_actualizar_datos", { p_celular: celular || null, p_direccion: direccion || null });
    setOcupado(false);
    if (r.error) return setError(r.error.message);
    setAviso("Tus datos quedaron guardados.");
    await cargar();
  };

  const enviarSolicitud = async () => {
    if (motivo.trim().length < 5) return setError("Cuéntanos brevemente el motivo del cambio.");
    setError(null);
    setOcupado(true);
    const r = await rpc("portal_solicitar_cambio_cuenta", { p_motivo: motivo });
    setOcupado(false);
    setSolicitud(false);
    setMotivo("");
    if (r.error) return setError(r.error.message);
    setAviso("Tu solicitud fue enviada. Recursos Humanos verificará tu identidad antes del cambio.");
    await cargar();
  };

  return (
    <div className="animar-aparicion space-y-4">
      <h1 className="text-[17px] font-bold text-tinta">Mis datos</h1>

      <Tarjeta>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
          <div><div className="text-[10.5px] font-semibold uppercase tracking-wide text-gris-cl">Nombre</div>{datos.nombre}</div>
          <div><div className="text-[10.5px] font-semibold uppercase tracking-wide text-gris-cl">DNI</div><span className="font-mono">{datos.dni}</span></div>
          <div><div className="text-[10.5px] font-semibold uppercase tracking-wide text-gris-cl">Empresa</div>{datos.empresa ?? "—"}</div>
          <div><div className="text-[10.5px] font-semibold uppercase tracking-wide text-gris-cl">Cargo</div>{datos.cargo}</div>
        </div>
      </Tarjeta>

      {aviso && <Nota tono="conf">{aviso}</Nota>}
      {error && <Nota tono="alerta">{error}</Nota>}

      <form onSubmit={guardar}>
        <Tarjeta>
          <label className="mb-3 block">
            <span className="mb-1 block text-[13px] font-semibold text-tinta">Celular</span>
            <input
              type="text" inputMode="numeric" maxLength={9} value={celular} disabled={soloLectura}
              onInput={(e) => setCelular(e.currentTarget.value.replace(/\D/g, ""))}
              className="w-full rounded-caja border border-borde-f px-4 py-3 text-[15px] disabled:bg-papel focus:border-petroleo focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-semibold text-tinta">Dirección</span>
            <input
              type="text" value={direccion} disabled={soloLectura}
              onInput={(e) => setDireccion(e.currentTarget.value)}
              className="w-full rounded-caja border border-borde-f px-4 py-3 text-[15px] disabled:bg-papel focus:border-petroleo focus:outline-none"
            />
          </label>
          {!soloLectura && (
            <div className="mt-4">
              <Boton type="submit" disabled={ocupado}>{ocupado ? "Guardando…" : "Guardar cambios"}</Boton>
            </div>
          )}
        </Tarjeta>
      </form>

      <ReglamentoInterno />

      <Tarjeta>
        <div className="text-[13px] font-semibold text-tinta">Cuenta de haberes</div>
        <div className="mt-1 text-[14px] text-gris">{datos.banco ?? "—"} · <span className="font-mono">{datos.cuentaEnmascarada ?? "—"}</span></div>
        <p className="mt-2 text-[12px] leading-snug text-gris-cl">
          Por tu seguridad, la cuenta donde recibes tu pago solo se cambia con verificación de identidad por
          Recursos Humanos.
        </p>
        {datos.solicitudPendiente ? (
          <div className="mt-3"><Nota tono="pend">Tienes una solicitud de cambio en revisión.</Nota></div>
        ) : !soloLectura && (
          <div className="mt-3">
            <Boton variante="secundario" type="button" onClick={() => setSolicitud(true)}>Solicitar cambio de cuenta</Boton>
          </div>
        )}
      </Tarjeta>

      <Boton variante="secundario" type="button" onClick={salir}>
        <span className="inline-flex items-center gap-2"><LogOut size={16} /> Cerrar sesión</span>
      </Boton>

      {solicitud && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-tinta/60" onClick={() => setSolicitud(false)}>
          <div className="animar-aparicion w-full max-w-md rounded-t-[16px] bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[16px] font-bold text-tinta">Solicitar cambio de cuenta</h2>
            <p className="mt-1 text-[12.5px] text-gris-cl">Recursos Humanos te contactará para verificar tu identidad.</p>
            <textarea
              value={motivo}
              onInput={(e) => setMotivo(e.currentTarget.value)}
              placeholder="Ej.: cambié de banco, mi cuenta anterior está cerrada…"
              className="mt-3 min-h-24 w-full rounded-caja border border-borde-f px-4 py-3 text-[14px] focus:border-petroleo focus:outline-none"
            />
            <div className="mt-3 space-y-2">
              <Boton onClick={enviarSolicitud} disabled={ocupado}>{ocupado ? "Enviando…" : "Enviar solicitud"}</Boton>
              <Boton variante="secundario" type="button" onClick={() => setSolicitud(false)}>Cancelar</Boton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
