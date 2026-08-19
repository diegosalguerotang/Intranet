import { useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Button, Input, Select, Field, Note, Textarea } from "../../components/ui";

// Formularios de los dos tipos iniciales del Centro de Solicitudes. Son
// componentes reutilizables (crear y corregir-y-reenviar): reciben `inicial`
// y entregan el jsonb `datos` validado en el cliente; la validación DURA vive
// en fn_solicitud_validar (BD). Las superposiciones y el cruce de medianoche
// son ADVERTENCIAS aquí, jamás bloqueos.

export const MOTIVOS_PAPELETA = ["Salud", "Particular", "Comisión", "Otros"];

// Etiquetas legibles del jsonb datos (bandeja, portal y PDF comparten campos).
export function resumenDatos(tipoId, datos) {
  if (tipoId === "papeleta-permiso") {
    return [
      ["Salida", (datos.salida ?? "").replace("T", " ")],
      ["Retorno", (datos.retorno ?? "").replace("T", " ")],
      ["Motivo", datos.motivo + (datos.especificacion ? ` — ${datos.especificacion}` : "")],
      ["Fundamentación", datos.fundamentacion],
      ["Original firmado", datos.adjunto_url ? "adjuntado" : "PENDIENTE (obligatorio para aprobar)"],
    ];
  }
  return [
    ["Tipo", datos.tipo_goce],
    ["Desde / Hasta", `${datos.desde} → ${datos.hasta}`],
    ["Días gozados", String(datos.dias_gozados ?? "")],
    ["Días trabajados", String(datos.dias_trabajados ?? "")],
    ["Periodo", datos.periodo ?? "—"],
    ["Horario", datos.horario ?? "—"],
  ];
}

// Sube el original firmado al bucket privado y devuelve la RUTA interna.
async function subirAdjunto(archivo) {
  const nombre = archivo.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
  const ruta = `solicitudes/adjuntos/${Date.now()}-${nombre}`;
  const { error } = await supabase.storage.from("documentos")
    .upload(ruta, archivo, { contentType: archivo.type || "application/octet-stream", upsert: true });
  if (error) throw new Error(`No se pudo subir el adjunto: ${error.message}`);
  return ruta;
}

export function FormPapeleta({ inicial = {}, onEnviar, ocupado, textoEnviar = "Registrar papeleta" }) {
  const [f, setF] = useState({
    salida: inicial.salida ?? "", retorno: inicial.retorno ?? "",
    motivo: inicial.motivo ?? "", especificacion: inicial.especificacion ?? "",
    fundamentacion: inicial.fundamentacion ?? "", adjunto_url: inicial.adjunto_url ?? "",
  });
  const [archivo, setArchivo] = useState(null);
  const [error, setError] = useState(null);
  const [confirmaNoche, setConfirmaNoche] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const cruzaMedianoche = useMemo(
    () => f.salida && f.retorno && f.salida.slice(0, 10) !== f.retorno.slice(0, 10),
    [f.salida, f.retorno]
  );
  const retornoInvalido = f.salida && f.retorno && f.retorno <= f.salida;

  const enviar = async (e) => {
    e.preventDefault();
    setError(null);
    if (retornoInvalido) { setError("El retorno no puede ser anterior (ni igual) a la salida."); return; }
    if (cruzaMedianoche && !confirmaNoche) {
      setError("La papeleta cruza la medianoche: suele ser un error de tipeo. Marca la confirmación si es correcto.");
      return;
    }
    try {
      const datos = { ...f };
      if (archivo) datos.adjunto_url = await subirAdjunto(archivo);
      await onEnviar(datos);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form onSubmit={enviar} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Salida" required hint="Fecha y hora en que sale.">
          <Input type="datetime-local" value={f.salida} onChange={set("salida")} required />
        </Field>
        <Field label="Retorno" required hint="Debe ser posterior a la salida.">
          <Input type="datetime-local" value={f.retorno} onChange={set("retorno")} required />
        </Field>
      </div>
      {retornoInvalido && <Note tone="alerta">El retorno es anterior o igual a la salida.</Note>}
      {cruzaMedianoche && !retornoInvalido && (
        <label className="flex items-center gap-2 text-[13px] font-medium text-pend">
          <input type="checkbox" checked={confirmaNoche} onChange={(e) => setConfirmaNoche(e.target.checked)} className="accent-petroleo" />
          El permiso realmente termina otro día (confirmo que no es un error de tipeo)
        </label>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Motivo" required hint="Salud, Comisión y Particular no son equivalentes para la planilla; el descuento lo decide la planilla, no este sistema.">
          <Select value={f.motivo} onChange={set("motivo")} required>
            <option value="">Seleccionar…</option>
            {MOTIVOS_PAPELETA.map((m) => <option key={m}>{m}</option>)}
          </Select>
        </Field>
        {f.motivo === "Otros" && (
          <Field label="Especificación del motivo" required>
            <Input value={f.especificacion} onChange={set("especificacion")} required />
          </Field>
        )}
      </div>
      <Field label="Fundamentación" required>
        <Textarea rows={2} value={f.fundamentacion} onChange={set("fundamentacion")} required />
      </Field>
      <Field label="Original firmado (escaneado)"
        hint="Opcional al registrar; OBLIGATORIO para aprobar. Igual que el acuse asistido: el papel se gestionó en persona y aquí queda el registro.">
        <Input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
        {f.adjunto_url && !archivo && <div className="mt-1 text-[11.5px] text-conf">Ya hay un original adjuntado; subir otro lo reemplaza.</div>}
      </Field>
      {error && <Note tone="alerta">{error}</Note>}
      <Button type="submit" disabled={ocupado}>{ocupado ? "Guardando…" : textoEnviar}</Button>
    </form>
  );
}

export function FormVacaciones({ inicial = {}, onEnviar, ocupado, textoEnviar = "Enviar solicitud" }) {
  const [f, setF] = useState({
    tipo_goce: inicial.tipo_goce ?? "Efectivas / Gozadas", desde: inicial.desde ?? "", hasta: inicial.hasta ?? "",
    dias_gozados: inicial.dias_gozados ?? "", dias_trabajados: inicial.dias_trabajados ?? "",
    periodo: inicial.periodo ?? "", horario: inicial.horario ?? "",
  });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  // Días propuestos por el rango (inclusive); lo escrito MANDA (sin saldo:
  // se declara y RRHH valida contra la planilla al aprobar).
  const propuestos = useMemo(() => {
    if (!f.desde || !f.hasta || f.hasta < f.desde) return null;
    return Math.round((new Date(f.hasta) - new Date(f.desde)) / 86400000) + 1;
  }, [f.desde, f.hasta]);
  const difieren = propuestos !== null && f.dias_gozados !== "" && Number(f.dias_gozados) !== propuestos;

  const enviar = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await onEnviar({
        ...f,
        dias_gozados: Number(f.dias_gozados || propuestos || 0),
        dias_trabajados: f.dias_trabajados === "" ? null : Number(f.dias_trabajados),
      });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form onSubmit={enviar} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Solicito vacaciones" required hint="Las dos casillas del formato GR-F-012.">
          <Select value={f.tipo_goce} onChange={set("tipo_goce")}>
            <option>Efectivas / Gozadas</option>
            <option>Pagadas / Trabajadas</option>
          </Select>
        </Field>
        <Field label="Desde el" required>
          <Input type="date" value={f.desde} onChange={set("desde")} required />
        </Field>
        <Field label="Hasta el" required>
          <Input type="date" value={f.hasta} onChange={set("hasta")} required />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Días gozados" required
          hint={propuestos ? `El rango propone ${propuestos} día(s); lo que escribas manda.` : "Se proponen según el rango."}>
          <Input inputMode="numeric" value={f.dias_gozados} onChange={set("dias_gozados")}
            placeholder={propuestos ? String(propuestos) : ""} />
        </Field>
        <Field label="Días trabajados">
          <Input inputMode="numeric" value={f.dias_trabajados} onChange={set("dias_trabajados")} />
        </Field>
        <Field label="Periodo al que pertenecen" hint="Ej.: 2025-2026">
          <Input value={f.periodo} onChange={set("periodo")} placeholder="2025-2026" />
        </Field>
      </div>
      <Field label="Horario" hint="El sistema aún no modela jornadas; escríbelo tal como va en el formato.">
        <Input value={f.horario} onChange={set("horario")} placeholder="L-V 8:00-17:00" />
      </Field>
      {difieren && (
        <Note tone="pend">
          Escribiste <b>{f.dias_gozados}</b> día(s) pero el rango de fechas da <b>{propuestos}</b>. Se enviará lo que escribiste.
        </Note>
      )}
      {error && <Note tone="alerta">{error}</Note>}
      <Button type="submit" disabled={ocupado}>{ocupado ? "Enviando…" : textoEnviar}</Button>
    </form>
  );
}

// Aviso por correo del Centro de Solicitudes. Fire-and-forget: el fallo de
// correo jamás bloquea el registro (queda visible en la pantalla que llama).
export function avisarSolicitud(numero, evento) {
  return fetch("/api/enviar-correo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accion: "aviso-solicitud", numero, evento }),
  }).then((r) => r.ok).catch(() => false);
}
