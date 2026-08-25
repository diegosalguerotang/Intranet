import { useEffect, useState } from "react";
import { LogOut, BookOpen, ShieldCheck } from "lucide-react";
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

// La política de datos SIEMPRE consultable (Diego, 2026-08-25): el trabajador
// la aceptó en su primer ingreso y debe poder releerla cuando quiera.
function PoliticaDatos() {
  const [pol, setPol] = useState(null);
  const [abierta, setAbierta] = useState(false);
  useEffect(() => {
    vista("v_declaraciones_vigentes", "select=version,texto&id=eq.politica-datos&limit=1")
      .then(({ data }) => setPol(data?.[0] ?? null));
  }, []);
  if (!pol) return null;
  return (
    <Tarjeta>
      <div className="flex items-center gap-2 text-[13px] font-semibold text-tinta">
        <ShieldCheck size={16} className="text-petroleo" /> Política de datos personales
      </div>
      <div className="mt-1 text-[12.5px] text-gris-cl">
        Versión {pol.version}. Es el texto que aceptaste al activar tu cuenta; puedes releerlo cuando quieras.
      </div>
      {abierta && (
        <div className="mt-3 max-h-[46dvh] overflow-y-auto whitespace-pre-wrap rounded-caja bg-papel p-3 text-[12.5px] leading-relaxed text-gris">
          {pol.texto}
        </div>
      )}
      <div className="mt-3">
        <Boton variante="secundario" type="button" onClick={() => setAbierta((v) => !v)}>
          {abierta ? "Ocultar" : "Leer la política"}
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
      <PoliticaDatos />

      <Boton variante="secundario" type="button" onClick={salir}>
        <span className="inline-flex items-center gap-2"><LogOut size={16} /> Cerrar sesión</span>
      </Boton>
    </div>
  );
}
