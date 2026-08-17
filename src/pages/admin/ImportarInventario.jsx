import { useRef, useState } from "react";
import { useApp } from "../../state";
import { Modal, Note, Button } from "../../components/ui";

// ADQ-08 — Importar inventario de activos (Formato 7.1 SUNAT como inventario).
// Flujo: archivo → confirmación BLOQUEANTE de la razón social (la del archivo
// manda: es un sí o un no, jamás un selector) → vista previa (altas,
// actualizaciones campo a campo, duplicados bloqueantes, avisos) → importación
// transaccional (o entra todo o no entra nada).
export default function ImportarInventario({ open, onClose }) {
  const { db, user, previsualizarImportacionActivos, importarActivos } = useApp();
  const [paso, setPaso] = useState(1); // 1 archivo · 2 confirmación · 3 vista previa · 4 resultado
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  const [rechazo, setRechazo] = useState(null); // rechazo total: sin camino de continuar
  const [analisis, setAnalisis] = useState(null); // resultado del parser + empresa + nombre del archivo
  const [previa, setPrevia] = useState(null);
  const [resultado, setResultado] = useState(null);
  // Mismo mecanismo de vigencia que RRH-05: cerrar no cancela una RPC en
  // vuelo, pero su resultado se descarta si el modal se reseteó o reabrió.
  const sesionRef = useRef(0);
  const cerrar = () => {
    sesionRef.current += 1;
    setPaso(1); setOcupado(false); setError(null); setRechazo(null);
    setAnalisis(null); setPrevia(null); setResultado(null);
    onClose();
  };

  const analizar = async (archivo) => {
    const sesion = sesionRef.current;
    setError(null);
    setRechazo(null);
    setOcupado(true);
    try {
      const { leerXlsx } = await import("../../lib/importar/xlsx.js");
      const { parsearActivos, resolverEmpresaArchivo } = await import("../../lib/importar/activos.js");
      const filas = await leerXlsx(new Uint8Array(await archivo.arrayBuffer()), { hoja: "AF EQUIPO DE COMPUTO" });
      const r = parsearActivos(filas);
      if (r.errores.length) {
        if (sesionRef.current === sesion) setRechazo(r.errores.join(" "));
        return;
      }
      if (!r.razonSocial) {
        if (sesionRef.current === sesion) setRechazo(
          "El archivo no trae la razón social en la cabecera (DENOMINACIÓN O RAZÓN SOCIAL). Sin ella no se puede confirmar la empresa: importación rechazada.");
        return;
      }
      const emp = resolverEmpresaArchivo(r.razonSocial, db.empresas, user?.acceso);
      if (emp.rechazo) {
        if (sesionRef.current === sesion) setRechazo(emp.rechazo);
        return;
      }
      if (sesionRef.current !== sesion) return;
      setAnalisis({ ...r, empresa: emp.empresa, archivoNombre: archivo.name });
      setPaso(2);
    } catch (e) {
      if (sesionRef.current === sesion) setError(e.message);
    } finally {
      if (sesionRef.current === sesion) setOcupado(false);
    }
  };

  // "Sí, subir a X": recién aquí se procesa contra el sistema. Los códigos
  // repetidos del archivo ya llegan sufijados por el parser (PROLT51-R2) y
  // marcados repetido=true: no bloquean, entran «falta corregir».
  const confirmarEmpresa = async () => {
    const sesion = sesionRef.current;
    setError(null);
    setOcupado(true);
    try {
      const p = await previsualizarImportacionActivos(
        analisis.empresa.id, analisis.activos, analisis.razonSocial, analisis.archivoNombre);
      if (sesionRef.current !== sesion) return;
      setPrevia(p);
      setPaso(3);
    } catch (e) {
      if (sesionRef.current === sesion) setError(e.message);
    } finally {
      if (sesionRef.current === sesion) setOcupado(false);
    }
  };

  const confirmarImportacion = async () => {
    const sesion = sesionRef.current;
    setError(null);
    setOcupado(true);
    try {
      const r = await importarActivos(
        analisis.empresa.id, analisis.activos, analisis.razonSocial, analisis.archivoNombre);
      if (sesionRef.current !== sesion) return;
      setResultado(r);
      setPaso(4);
    } catch (e) {
      if (sesionRef.current === sesion) setError(e.message);
    } finally {
      if (sesionRef.current === sesion) setOcupado(false);
    }
  };

  // "Quién lo tiene ahora" para los avisos de duplicado: lo que el sistema ya
  // sabe de ese código (asignación real o el texto sin confirmar importado).
  const quienLoTiene = (codigo) => {
    const a = db.activos.find((x) => x.codigo === codigo);
    if (!a) return null;
    return a.asignado ?? a.asignado_sin_confirmar ?? null;
  };

  // Código provisional asignado a cada repetición de un código del archivo.
  const provisionales = (codigo) =>
    (analisis?.activos ?? [])
      .filter((a) => a.repetido && a.codigoArchivo === codigo && a.codigo !== codigo)
      .map((a) => `la fila ${a.fila} entra como ${a.codigo}`)
      .join("; ");

  return (
    <Modal open={open} onClose={cerrar} title="ADQ-08 · Importar inventario" wide>
      <div className="space-y-4">
        {paso === 1 && (
          <>
            <label
              className={`block rounded-md border-2 border-dashed border-borde-f bg-papel/60 px-6 py-10 text-center hover:border-petroleo-cl ${ocupado ? "opacity-60" : "cursor-pointer"}`}
            >
              <input
                type="file"
                accept=".xlsx"
                className="hidden"
                disabled={ocupado}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) analizar(f); }}
              />
              <div className="text-[14px] font-semibold text-tinta-2">
                {ocupado ? "Leyendo el archivo…" : "Haz clic para elegir el inventario Formato 7.1 (.xlsx)"}
              </div>
              <div className="mt-1 text-[12px] text-gris">Solo se importa la hoja «AF EQUIPO DE COMPUTO». La identidad de cada activo es su código.</div>
            </label>
            {rechazo && <Note tone="alerta">{rechazo}</Note>}
            {error && <Note tone="alerta">{error}</Note>}
          </>
        )}

        {paso === 2 && analisis && (
          <>
            <div className="rounded-caja border border-borde bg-papel/60 p-6 text-center">
              <div className="font-mono text-[10px] uppercase tracking-wide text-gris">Esta información será subida a</div>
              <div className="mt-1.5 font-display text-[22px] font-bold leading-tight text-tinta">{analisis.empresa.nombre}</div>
              <div className="mt-3 text-[12.5px] text-gris">
                Razón social del archivo: «{analisis.razonSocial}»
              </div>
              <div className="text-[12.5px] text-gris">
                <b>{analisis.archivoNombre}</b> · {analisis.activos.length} filas de activo encontradas
              </div>
            </div>
            <Note tone="neutral">
              Un inventario cargado a la empresa equivocada mezcla patrimonio de dos razones sociales
              y hay que deshacerlo a mano. La razón social del archivo manda: si no es la correcta,
              corrige el archivo — aquí no se elige otra.
            </Note>
            {error && <Note tone="alerta">{error}</Note>}
            <div className="flex gap-2">
              <Button onClick={confirmarEmpresa} disabled={ocupado}>
                {ocupado ? "Procesando…" : `Sí, subir a ${analisis.empresa.corto}`}
              </Button>
              <Button variant="secondary" onClick={cerrar} disabled={ocupado}>Cancelar</Button>
            </div>
          </>
        )}

        {paso === 3 && analisis && (
          <>
            {previa && (
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-md bg-conf-bg py-4"><div className="text-[22px] font-bold text-conf">{previa.altas.length}</div><div className="font-mono text-[10px] uppercase text-gris">Altas</div></div>
                <div className="rounded-md bg-pend-bg py-4"><div className="text-[22px] font-bold text-pend">{previa.actualizaciones.length}</div><div className="font-mono text-[10px] uppercase text-gris">A actualizar</div></div>
                <div className="rounded-md bg-papel py-4"><div className="text-[22px] font-bold text-tinta-2">{previa.sin_cambio.length}</div><div className="font-mono text-[10px] uppercase text-gris">Sin cambio</div></div>
              </div>
            )}

            {analisis.duplicados.length > 0 && (
              <Note tone="pend">
                <b>{analisis.duplicados.length} código{analisis.duplicados.length === 1 ? "" : "s"} repetido{analisis.duplicados.length === 1 ? "" : "s"} dentro del archivo.</b>{" "}
                Se importan TODOS marcados «repetido — falta corregir»; cada repetición recibe un
                código provisional hasta que se corrija el definitivo:
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  {analisis.duplicados.map((d) => (
                    <li key={d.codigo}>
                      <b>{d.codigo}</b> — filas {d.filas.join(" y ")} del archivo, asignado a{" "}
                      {d.usuarios.map((u) => u || "(sin usuario)").join(" / ")}
                      {quienLoTiene(d.codigo) ? `; en el sistema hoy lo tiene ${quienLoTiene(d.codigo)}` : ""}
                      {provisionales(d.codigo) ? `; ${provisionales(d.codigo)}` : ""}
                    </li>
                  ))}
                </ul>
              </Note>
            )}

            {analisis.recodificados.length > 0 && (
              <Note tone="neutral">
                {analisis.recodificados.length} impresora{analisis.recodificados.length === 1 ? "" : "s"} recodificada{analisis.recodificados.length === 1 ? "" : "s"} por número de serie
                (la marca con el año de compra no identifica un equipo; el código del archivo queda en las observaciones):
                <ul className="mt-1 list-disc pl-4">
                  {analisis.recodificados.map((x) => (
                    <li key={x.fila}>Fila {x.fila}: {x.codigoArchivo} → <b>{x.codigo}</b></li>
                  ))}
                </ul>
              </Note>
            )}

            {analisis.aRevisar.length > 0 && (
              <Note tone="pend">
                {analisis.aRevisar.length} fila{analisis.aRevisar.length === 1 ? "" : "s"} para revisar (no se importa{analisis.aRevisar.length === 1 ? "" : "n"} como activo):
                <ul className="mt-1 list-disc pl-4">
                  {analisis.aRevisar.map((x) => (
                    <li key={x.fila}>Fila {x.fila}{x.usuario ? ` («${x.usuario}»)` : ""}: {x.motivo}{x.observaciones ? ` — ${x.observaciones}` : ""}</li>
                  ))}
                </ul>
              </Note>
            )}

            {analisis.advertenciasTipo.length > 0 && (
              <Note tone="pend">
                El prefijo del código contradice el detalle en {analisis.advertenciasTipo.length} fila{analisis.advertenciasTipo.length === 1 ? "" : "s"} (se importa tal cual; corrige el que esté mal en la pantalla de activos):
                <ul className="mt-1 list-disc pl-4">
                  {analisis.advertenciasTipo.map((x) => (
                    <li key={x.fila}>Fila {x.fila}: <b>{x.codigo}</b> descrito como {x.tipo}</li>
                  ))}
                </ul>
              </Note>
            )}

            {analisis.seriesRepetidas.length > 0 && (
              <Note tone="pend">
                Número de serie repetido en códigos distintos (probablemente el mismo equipo cargado dos veces — resuélvelo antes o después de importar):
                <ul className="mt-1 list-disc pl-4">
                  {analisis.seriesRepetidas.map((s) => (
                    <li key={s.serie}><b>{s.serie}</b> aparece en {s.codigos.join(" y ")} (filas {s.filas.join(", ")})</li>
                  ))}
                </ul>
              </Note>
            )}

            {previa && previa.actualizaciones.length > 0 && (
              <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-borde bg-papel/40 p-3 text-[12.5px]">
                <div className="font-mono text-[10px] uppercase text-gris">Qué cambia, campo por campo</div>
                {previa.actualizaciones.map((a) => (
                  <div key={a.codigo}>
                    <b>{a.codigo}</b>:{" "}
                    {Object.entries(a.cambios).map(([campo, c], i) => (
                      <span key={campo}>{i > 0 ? "; " : ""}{campo} «{c.antes ?? "—"}» → «{c.despues}»</span>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {error && <Note tone="alerta">{error}</Note>}
            <div className="flex gap-2">
              <Button onClick={confirmarImportacion} disabled={ocupado}>
                {ocupado ? "Importando…" : `Importar a ${analisis.empresa.corto}`}
              </Button>
              <Button variant="secondary" onClick={cerrar} disabled={ocupado}>Cancelar</Button>
            </div>
          </>
        )}

        {paso === 4 && resultado && (
          <>
            <Note tone="conf">
              Inventario importado a {analisis.empresa.nombre}: {resultado.altas.length} altas,{" "}
              {resultado.actualizaciones.length} actualizaciones, {resultado.sin_cambio.length} sin cambio.
              {analisis.duplicados.length > 0 &&
                ` ${analisis.activos.filter((a) => a.repetido).length} activos quedaron marcados «repetido — falta corregir».`}{" "}
              La vinculación de cada equipo a un trabajador del maestro se hace desde la pantalla de
              activos (el archivo no trae DNI y los nombres no son confiables).
            </Note>
            <Button onClick={cerrar}>Cerrar</Button>
          </>
        )}
      </div>
    </Modal>
  );
}
