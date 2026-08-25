import { useEffect, useState } from "react";
import { ArrowLeft, Download, ShieldCheck, RefreshCw } from "lucide-react";
import { vista, rpc, urlDocumento, tokenSesion } from "../lib/api";
import { usePortal } from "../state";
import { Enlace } from "../router";
import { Tarjeta, Boton, Nota, Etiqueta, Cargando, Vacio } from "../components/ui";
import HojaDeclaracion from "../components/HojaDeclaracion";

// TRB-06 · Detalle del documento y confirmación de recepción. Regla dura del
// spec: NUNCA se ofrece confirmar algo que no se pudo mostrar.
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
// "2026-06" → "Junio 2026"; si el período no viene, se usa tal cual.
const periodoLegible = (p) => {
  const m = /^(\d{4})-(\d{2})/.exec(p ?? "");
  return m ? `${MESES[Number(m[2]) - 1]} ${m[1]}` : (p ?? "");
};

export default function Documento({ id }) {
  const { soloLectura, perfil } = usePortal();
  const [doc, setDoc] = useState(undefined);
  // "cargando" | "sin-archivo" | "error:<mensaje>" | URL firmada (https://…)
  const [archivo, setArchivo] = useState("cargando");
  const [hoja, setHoja] = useState(false);
  const [declaracion, setDeclaracion] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);

  const cargar = async () => {
    const { data } = await vista("v_portal_boletas", `select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
    setDoc(data?.[0] ?? null);
  };
  useEffect(() => { cargar(); }, [id]);

  // El archivo se valida ANTES de mostrar el visor: el botón de confirmar
  // depende de que el documento se haya podido mostrar de verdad. El bucket es
  // privado: el endpoint verifica la identidad y firma una URL de 10 minutos.
  const pedirUrl = async () => {
    setArchivo("cargando");
    const r = await urlDocumento(id);
    setArchivo(r.url ?? `error:${r.error}`);
  };
  useEffect(() => {
    if (doc === undefined || doc === null) return;
    if (!doc.archivo_url) { setArchivo("sin-archivo"); return; }
    pedirUrl();
  }, [doc?.archivo_url]);

  const seMuestra = archivo.startsWith("http");

  // Nombre de archivo veraz (Diego, 2026-08-25): tipo + mes + nombre + n.º de
  // documento, en vez del hash del bucket que ponía el navegador.
  const nombreArchivo = (prefijo) =>
    `${prefijo ?? doc.tipo} ${periodoLegible(doc.periodo)} - ${perfil?.nombre ?? ""} - ${perfil?.dni ?? ""}`
      .replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim() + ".pdf";

  // La URL firmada expira: la descarga pide una fresca en el momento del clic.
  // Se baja como blob para poder ponerle nombre propio (con la URL firmada
  // directa el navegador ignora `download` por ser de otro origen).
  const descargarPdf = async () => {
    const r = await urlDocumento(id);
    if (r.error) { setArchivo(`error:${r.error}`); return; }
    try {
      const pdf = await (await fetch(r.url)).blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(pdf);
      a.download = nombreArchivo();
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(r.url, "_blank"); // sin blob al menos se abre el documento
    }
  };

  useEffect(() => {
    vista("v_declaraciones_vigentes", "select=version,texto&id=eq.recepcion-documento&limit=1")
      .then(({ data }) => setDeclaracion(data?.[0] ?? null));
  }, []);

  if (doc === undefined) return <Cargando />;
  if (doc === null) return <Vacio titulo="El documento no existe" detalle="Vuelve al inicio e inténtalo de nuevo." />;

  const pendiente = !doc.confirmadoEn && doc.estado === "vigente";

  const confirmar = async () => {
    setOcupado(true);
    setError(null);
    const r = await rpc("portal_confirmar_recepcion", {
      p_documento_id: Number(id),
      p_dispositivo: navigator.userAgent.slice(0, 150),
    });
    setOcupado(false);
    if (r.error) { setHoja(false); setError(r.error.message); return; }
    setHoja(false);
    await cargar(); // la constancia aparece de inmediato
  };

  // La constancia formal en PDF la genera el servidor desde el registro
  // inmutable (antes era un .txt armado en el navegador).
  const [bajandoConstancia, setBajandoConstancia] = useState(false);
  const descargarConstancia = async () => {
    setBajandoConstancia(true);
    setError(null);
    try {
      const r = await fetch(`${window.location.origin}/api/constancia-portal?id=${encodeURIComponent(id)}`, {
        headers: { "x-sesion": tokenSesion() ?? "" },
      });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        throw new Error(j?.error ?? "No se pudo generar la constancia. Inténtalo de nuevo.");
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await r.blob());
      a.download = nombreArchivo("Constancia de recepción");
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e.message);
    } finally {
      setBajandoConstancia(false);
    }
  };

  return (
    <div className="animar-aparicion space-y-4">
      <Enlace to="/boletas" className="inline-flex items-center gap-1 text-[13px] font-semibold text-petroleo">
        <ArrowLeft size={15} /> Mis boletas
      </Enlace>

      <div>
        <h1 className="text-[17px] font-bold leading-snug text-tinta">{doc.titulo}</h1>
        <div className="text-[12.5px] text-gris-cl">{doc.tipo} · {doc.empresa} · publicado el {doc.publicado}</div>
      </div>

      {doc.estado === "reemplazado" && (
        <Nota tono="pend">
          Este documento fue <b>reemplazado por una versión más reciente</b>. Puedes verlo, pero la versión que
          vale es la nueva; búscala en Mis boletas.
        </Nota>
      )}

      {archivo === "sin-archivo" && (
        <Nota tono="pend">El archivo de este documento aún no está disponible. Avisa a Recursos Humanos.</Nota>
      )}
      {archivo.startsWith("error:") && (
        <Nota tono="alerta">
          <div className="flex items-center justify-between gap-3">
            <span>{archivo.slice(6) || "No se pudo cargar el documento. Revisa tu conexión."}</span>
            <button className="inline-flex items-center gap-1 font-semibold" onClick={pedirUrl}>
              <RefreshCw size={13} /> Reintentar
            </button>
          </div>
        </Nota>
      )}
      {seMuestra && (
        <div className="overflow-hidden rounded-caja border border-borde bg-white shadow-[0_2px_10px_rgba(29,63,114,0.06)]">
          <iframe title={doc.titulo} src={archivo} className="h-[46dvh] w-full" />
          <button
            type="button" onClick={descargarPdf}
            className="flex w-full items-center justify-center gap-2 border-t border-borde py-3 text-[14px] font-semibold text-petroleo"
          >
            <Download size={16} /> Descargar PDF
          </button>
        </div>
      )}

      {error && <Nota tono="alerta">{error}</Nota>}

      {doc.confirmadoEn ? (
        <Tarjeta>
          <div className="flex items-center gap-2 text-conf">
            <ShieldCheck size={18} />
            <span className="text-[15px] font-bold">Recepción confirmada</span>
          </div>
          <dl className="mt-2 space-y-1 text-[12.5px] text-gris">
            <div className="flex justify-between"><dt className="text-gris-cl">Constancia N.º</dt><dd className="font-mono font-semibold">{doc.constanciaId}</dd></div>
            <div className="flex justify-between"><dt className="text-gris-cl">Fecha y hora</dt><dd>{doc.confirmadoEn}</dd></div>
            <div className="flex justify-between gap-4"><dt className="shrink-0 text-gris-cl">Huella del archivo</dt><dd className="truncate font-mono text-[11px]">{doc.huella}</dd></div>
          </dl>
          <div className="mt-3">
            <Boton variante="secundario" type="button" onClick={descargarConstancia} disabled={bajandoConstancia}>
              {bajandoConstancia ? "Generando PDF…" : "Descargar constancia (PDF)"}
            </Boton>
          </div>
        </Tarjeta>
      ) : pendiente && !soloLectura ? (
        <div className="space-y-2">
          <Nota tono="neutral">
            Al confirmar dejas constancia de que <b>recibiste</b> este documento — reemplaza la firma del cargo en
            papel. No significa estar de acuerdo con el contenido: si algo no cuadra, avisa a Recursos Humanos.
          </Nota>
          <Boton onClick={() => setHoja(true)} disabled={!seMuestra || !declaracion}>
            Confirmar recepción
          </Boton>
          {!seMuestra && (
            <p className="text-center text-[11.5px] text-gris-cl">Podrás confirmar cuando el documento se muestre correctamente.</p>
          )}
        </div>
      ) : null}

      {hoja && declaracion && (
        <HojaDeclaracion
          titulo="Confirmar recepción"
          explicacion="Quedarán registrados la fecha, la hora, tu dispositivo y la huella del archivo."
          texto={declaracion.texto}
          textoBoton="Sí, confirmo la recepción"
          onConfirmar={confirmar}
          onCerrar={() => setHoja(false)}
          ocupado={ocupado}
        />
      )}
    </div>
  );
}
