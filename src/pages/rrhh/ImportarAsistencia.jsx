import { useRef, useState } from "react";
import { useApp } from "../../state";
import { Modal, Note, Button, Select } from "../../components/ui";

const ETIQUETA = {
  incompletos: "marcaciones impares (falta una)",
  dobles: "dobles marcaciones bajo el umbral",
  sinRefrigerio: "jornadas sin refrigerio",
  invertidos: "horas en orden invertido",
  huecos: "huecos entre marcaciones",
  sinMarca: "días sin ninguna marcación (no son faltas)",
};

// RRH-22 — Importar asistencia. UN solo botón para DOS archivos que se
// distinguen solos: el reporte crudo del RELOJ (una empresa, elegida por el
// usuario) y el CONTROL SEMANAL (hoja «Detalle Diario», multi-empresa: la RS
// de cada fila sale del padrón resolviendo el documento sin ceros).
export default function ImportarAsistencia({ open, onClose }) {
  const { db, empresaId, empresasActivas, previsualizarAsistencia, importarAsistencia,
    previsualizarControl, importarControl } = useApp();
  const [empresaSel, setEmpresaSel] = useState(empresaId);
  const [paso, setPaso] = useState(1); // 1 archivo · 2/3 reloj · 4/5 control
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  const [rechazo, setRechazo] = useState(null);
  const [analisis, setAnalisis] = useState(null); // parser + nombre archivo
  const [previa, setPrevia] = useState(null);     // respuesta del RPC de vista previa
  const [resultado, setResultado] = useState(null);
  const [control, setControl] = useState(null);   // {parseo, previa, archivoNombre, resultado}
  const sesionRef = useRef(0); // mismo mecanismo de vigencia que ADQ-08
  const umbral = db.asistenciaConfig?.[0]?.doble_marcacion_min ?? 15;
  const empresaObj = empresasActivas.find((e) => e.id === empresaSel);
  const nombreEmpresa = (id) => db.empresas.find((e) => e.id === id)?.nombre ?? id;

  const cerrar = () => {
    sesionRef.current += 1;
    setPaso(1); setOcupado(false); setError(null); setRechazo(null);
    setAnalisis(null); setPrevia(null); setResultado(null); setControl(null);
    onClose();
  };

  const registrosPayload = (a) =>
    a.importables.map((r) => ({
      codigo: r.codigo, fecha: r.fecha,
      m1: r.marcas[0] ?? null, m2: r.marcas[1] ?? null,
      m3: r.marcas[2] ?? null, m4: r.marcas[3] ?? null,
    }));

  // Payload del CONTROL: el parser ya normaliza; se envía tal cual.
  const analizar = async (archivo) => {
    const sesion = sesionRef.current;
    setError(null); setRechazo(null); setOcupado(true);
    try {
      // ¿Es el control semanal? Se decide por la hoja «Detalle Diario».
      const { leerXlsx, nombresHojas } = await import("../../lib/importar/xlsx.js");
      const bytes0 = new Uint8Array(await archivo.arrayBuffer());
      const hojas = await nombresHojas(bytes0);
      if (hojas.includes("Detalle Diario")) {
        const { parsearControlSemanal } = await import("../../lib/importar/control-semanal.js");
        const detalle = await leerXlsx(bytes0, { hoja: "Detalle Diario" });
        const resumen = hojas.includes("Resumen Mensual")
          ? await leerXlsx(bytes0, { hoja: "Resumen Mensual" }) : null;
        const parseo = parsearControlSemanal(detalle, resumen); // lanza si algo detiene la lectura
        if (parseo.registros.length === 0) {
          if (sesionRef.current === sesion) setRechazo("El control no trae filas importables.");
          return;
        }
        const p = await previsualizarControl(parseo.registros, parseo.trabajadores, archivo.name);
        if (sesionRef.current !== sesion) return;
        setControl({ parseo, previa: p, archivoNombre: archivo.name });
        setPaso(4);
        return;
      }

      const { parsearAsistencia } = await import("../../lib/importar/asistencia.js");
      // Fecha de hoy en hora LOCAL (Perú, UTC-5): usar la fecha UTC descartaría
      // como futuro un día que localmente ya empezó entre 19:00 y medianoche,
      // o dejaría pasar uno que localmente aún no llega — hallazgo de revisión.
      const d = new Date();
      const hoyLocal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const r = await parsearAsistencia(bytes0, { umbralDobleMin: umbral, hoy: hoyLocal });
      if (!r.importables.length) {
        if (sesionRef.current === sesion) setRechazo("El archivo no trae días importables (todas las fechas son futuras o no hay filas de datos).");
        return;
      }
      const a = { ...r, archivoNombre: archivo.name };
      // Vista previa contra la BD: resuelve códigos y bloquea si ninguno
      // pertenece a la empresa elegida (el error del RPC llega como rechazo).
      const p = await previsualizarAsistencia(empresaSel, registrosPayload(a), a.archivoNombre, a.stats);
      if (sesionRef.current !== sesion) return;
      setAnalisis(a); setPrevia(p); setPaso(2);
    } catch (e) {
      if (sesionRef.current === sesion) setRechazo(e.message);
    } finally {
      if (sesionRef.current === sesion) setOcupado(false);
    }
  };

  const confirmar = async () => {
    const sesion = sesionRef.current;
    setError(null); setOcupado(true);
    try {
      const r = await importarAsistencia(empresaSel, registrosPayload(analisis), analisis.archivoNombre, analisis.stats);
      if (sesionRef.current !== sesion) return;
      setResultado(r); setPaso(3);
    } catch (e) {
      if (sesionRef.current === sesion) setError(e.message);
    } finally {
      if (sesionRef.current === sesion) setOcupado(false);
    }
  };

  const confirmarControl = async () => {
    const sesion = sesionRef.current;
    setError(null); setOcupado(true);
    try {
      const r = await importarControl(control.parseo.registros, control.parseo.trabajadores, control.archivoNombre);
      if (sesionRef.current !== sesion) return;
      setControl((c) => ({ ...c, resultado: r }));
      setPaso(5);
    } catch (e) {
      if (sesionRef.current === sesion) setError(e.message);
    } finally {
      if (sesionRef.current === sesion) setOcupado(false);
    }
  };

  const anomaliasResumen = analisis
    ? Object.entries({
        incompletos: analisis.stats.incompletos, dobles: analisis.stats.dobles,
        sinRefrigerio: analisis.stats.sinRefrigerio, invertidos: analisis.stats.invertidos,
        huecos: analisis.stats.huecos, sinMarca: analisis.stats.sinMarca,
      }).filter(([, n]) => n > 0)
    : [];

  return (
    <Modal open={open} onClose={cerrar} title="RRH-22 · Importar marcaciones" wide>
      <div className="space-y-4">
        {paso === 1 && (
          <>
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-gris">Razón social a la que se sube</div>
              <Select value={empresaSel} onChange={(e) => setEmpresaSel(e.target.value)} disabled={ocupado}>
                {empresasActivas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </Select>
            </div>
            <label className={`block rounded-md border-2 border-dashed border-borde-f bg-papel/60 px-6 py-10 text-center hover:border-petroleo-cl ${ocupado ? "opacity-60" : "cursor-pointer"}`}>
              <input type="file" accept=".xlsx" className="hidden" disabled={ocupado}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) analizar(f); }} />
              <div className="text-[14px] font-semibold text-tinta-2">
                {ocupado ? "Leyendo el archivo…" : "Haz clic para elegir el reporte del reloj o el control semanal (.xlsx)"}
              </div>
              <div className="mt-1 text-[12px] text-gris">
                El reporte del reloj se sube a la razón social elegida arriba. El control semanal (hoja «Detalle
                Diario») trae a todo el grupo: la empresa de cada fila sale del padrón por documento.
                Reimportar un periodo lo reemplaza completo.
              </div>
            </label>
            {rechazo && <Note tone="alerta">{rechazo}</Note>}
          </>
        )}

        {paso === 2 && analisis && previa && (
          <>
            <div className="rounded-caja border border-borde bg-papel/60 p-6 text-center">
              <div className="font-mono text-[10px] uppercase tracking-wide text-gris">Estas marcaciones serán subidas a</div>
              <div className="mt-1.5 font-display text-[22px] font-bold leading-tight text-tinta">{empresaObj?.nombre}</div>
              <div className="mt-3 text-[12.5px] text-gris">
                <b>{analisis.archivoNombre}</b> · del {previa.desde} al {previa.hasta} · {previa.filas} días-persona
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-md bg-conf-bg py-4"><div className="text-[22px] font-bold text-conf">{previa.reconocidos}</div><div className="font-mono text-[10px] uppercase text-gris">Trabajadores reconocidos</div></div>
              <div className="rounded-md bg-pend-bg py-4"><div className="text-[22px] font-bold text-pend">{previa.no_reconocidos.length}</div><div className="font-mono text-[10px] uppercase text-gris">Códigos sin resolver</div></div>
              <div className="rounded-md bg-papel py-4"><div className="text-[22px] font-bold text-tinta-2">{analisis.stats.futurasDescartadas}</div><div className="font-mono text-[10px] uppercase text-gris">Días futuros descartados</div></div>
            </div>
            {previa.no_reconocidos.length > 0 && (
              <Note tone="pend">
                Estos códigos no corresponden a ningún trabajador de {empresaObj?.corto} (se importan igual,
                marcados «no está en el maestro», por si la persona se da de alta después):{" "}
                <span className="font-mono text-[12px]">{previa.no_reconocidos.join(", ")}</span>
              </Note>
            )}
            {anomaliasResumen.length > 0 && (
              <Note tone="neutral">
                Para revisión de RRHH (nada de esto bloquea ni genera faltas):
                <ul className="mt-1 list-disc pl-4">
                  {anomaliasResumen.map(([k, n]) => <li key={k}>{n} {ETIQUETA[k]}</li>)}
                </ul>
              </Note>
            )}
            <Note tone="neutral">
              La importación reemplaza TODO el periodo {previa.desde} → {previa.hasta} de {empresaObj?.corto}:
              lo que había en ese rango se sustituye por este archivo (reimportar corrige, jamás duplica).
            </Note>
            {error && <Note tone="alerta">{error}</Note>}
            <div className="flex gap-2">
              <Button onClick={confirmar} disabled={ocupado}>
                {ocupado ? "Importando…" : `Sí, subir a ${empresaObj?.corto}`}
              </Button>
              <Button variant="secondary" onClick={cerrar} disabled={ocupado}>Cancelar</Button>
            </div>
          </>
        )}

        {paso === 3 && resultado && (
          <>
            <Note tone="conf">
              Marcaciones importadas a {empresaObj?.nombre}: {resultado.filas} días-persona del{" "}
              {resultado.desde} al {resultado.hasta}, {resultado.reconocidos} trabajadores reconocidos
              {resultado.no_reconocidos.length > 0 && ` y ${resultado.no_reconocidos.length} códigos sin resolver`}.
              El detalle se consulta abajo, día por día.
            </Note>
            <Button onClick={cerrar}>Cerrar</Button>
          </>
        )}

        {paso === 4 && control?.previa && (() => {
          const c = control, p = c.previa, pa = c.parseo;
          const empresas = Object.entries(p.porEmpresa ?? {});
          return (
            <>
              <Note tone="neutral">
                <b>{c.archivoNombre}</b> · control semanal · del <b>{p.desde}</b> al <b>{p.hasta}</b> ·{" "}
                {p.trabajadores} trabajadores resueltos por documento · {p.filas} filas
                {pa.descartadas > 0 && ` · ${pa.descartadas} filas posteriores al corte descartadas`}.
                {" "}Empresas (del padrón): {empresas.map(([id, n]) => `${nombreEmpresa(id)} (${n})`).join(", ")}.
              </Note>
              {pa.contrasteResumen?.length === 0 ? (
                <Note tone="conf">
                  El resumen mensual recalculado <b>coincide</b> con el del archivo en los {pa.trabajadores.length} trabajadores.
                </Note>
              ) : (pa.contrasteResumen ?? []).length > 0 && (
                <Note tone="alerta">
                  El resumen recalculado difiere del archivo (no se ajusta la regla para que cuadre — revísalo):
                  <ul className="mt-1 list-disc pl-4">
                    {pa.contrasteResumen.slice(0, 12).map((d, i) => (
                      <li key={i}>{d.documento} · {d.columna}: archivo {d.archivo}, recalculado {d.recalculado}</li>
                    ))}
                    {pa.contrasteResumen.length > 12 && <li>… y {pa.contrasteResumen.length - 12} más.</li>}
                  </ul>
                </Note>
              )}
              {(p.excepciones ?? []).length > 0 && (
                <Note tone="pend">
                  Documentos que NO se importan (excepción, no alta silenciosa):
                  <ul className="mt-1 list-disc pl-4">
                    {p.excepciones.map((e, i) => <li key={i}>{e.documento} {e.nombre}: {e.motivo}</li>)}
                  </ul>
                </Note>
              )}
              {(p.horasPobladas ?? []).length > 0 && (
                <Note tone="neutral">
                  Hora de entrada: se poblará la ficha de <b>{p.horasPobladas.length}</b> trabajadores desde la
                  columna H.E. (primera importación). Después se contrasta, no se pisa.
                </Note>
              )}
              {(p.discrepanciasHora ?? []).length > 0 && (
                <Note tone="pend">
                  Horas de entrada que difieren de la ficha (la importación no decide cuál vale):
                  <ul className="mt-1 list-disc pl-4">
                    {p.discrepanciasHora.map((d, i) => (
                      <li key={i}>{d.nombre} ({d.documento}): ficha {d.ficha}, archivo {d.archivo}. {d.motivo}</li>
                    ))}
                  </ul>
                </Note>
              )}
              {(p.sinHora ?? []).length > 0 && (
                <Note tone="pend">
                  Sin hora de entrada (no generan tardanza; quedan pendientes de configurar):{" "}
                  {p.sinHora.map((s) => `${s.nombre ?? s.documento}`).join(" · ")}
                </Note>
              )}
              {(pa.reportadas ?? []).length > 0 && (
                <Note tone="pend">
                  Filas con inconsistencias internas (se importan igual, revísalas):
                  <ul className="mt-1 list-disc pl-4">
                    {pa.reportadas.slice(0, 10).map((x, i) => <li key={i}>Fila {x.fila} ({x.documento} · {x.fecha}): {x.motivo}</li>)}
                    {pa.reportadas.length > 10 && <li>… y {pa.reportadas.length - 10} más.</li>}
                  </ul>
                </Note>
              )}
              {(p.diferencias ?? []).length > 0 && (
                <Note tone="pend">
                  Cifras declaradas que difieren del recálculo propio (conviven; nadie elige ganador):
                  <ul className="mt-1 list-disc pl-4">
                    {p.diferencias.slice(0, 10).map((d, i) => (
                      <li key={i}>{d.documento} · {d.fecha} · {d.concepto}: declarado {d.declarado}, calculado {d.calculado}</li>
                    ))}
                    {p.diferencias.length > 10 && <li>… y {p.diferencias.length - 10} más.</li>}
                  </ul>
                </Note>
              )}
              <Note tone="neutral">
                «Revisar» no es falta. Reimportar el rango {p.desde} → {p.hasta} reemplaza lo que había, jamás duplica.
              </Note>
              {error && <Note tone="alerta">{error}</Note>}
              <div className="flex gap-2">
                <Button onClick={confirmarControl} disabled={ocupado}>
                  {ocupado ? "Importando…" : `Sí, subir el control (${p.trabajadores} trabajadores)`}
                </Button>
                <Button variant="secondary" onClick={cerrar} disabled={ocupado}>Cancelar</Button>
              </div>
            </>
          );
        })()}

        {paso === 5 && control?.resultado && (
          <>
            <Note tone="conf">
              Control semanal importado: {control.resultado.filas} días-persona del {control.resultado.desde} al{" "}
              {control.resultado.hasta}, {control.resultado.trabajadores} trabajadores en{" "}
              {Object.keys(control.resultado.porEmpresa ?? {}).length} razones sociales.
              {(control.resultado.horasPobladas ?? []).length > 0 &&
                ` Se pobló la hora de entrada de ${control.resultado.horasPobladas.length} fichas.`}
              {" "}El tablero mensual se consulta abajo, agrupado por centro de costo.
            </Note>
            {(control.resultado.excepciones ?? []).length > 0 && (
              <Note tone="pend">
                {control.resultado.excepciones.length} documentos quedaron como excepción (no se importaron):{" "}
                {control.resultado.excepciones.map((e) => e.documento).join(", ")}.
              </Note>
            )}
            <Button onClick={cerrar}>Cerrar</Button>
          </>
        )}
      </div>
    </Modal>
  );
}
