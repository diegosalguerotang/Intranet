import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FileUp, CheckCircle2 } from "lucide-react";
import { useApp } from "../../state";
import { supabase } from "../../lib/supabase";
import {
  PageHeader, Card, Button, Field, Select, Note, Badge, Table, Td, Progress, Textarea, Modal, inputCls,
} from "../../components/ui";

const PASOS = ["Periodo y tipo", "Carga del archivo", "Excepciones", "Revisión", "Publicado"];

export default function Boletas() {
  const { db, empresaId, empresaPor, empresasActivas, publicarLotePdf, persona, sede, recordarAcuse } = useApp();
  const [paso, setPaso] = useState(0);
  const [empresaLote, setEmpresaLote] = useState(empresaId);
  const [lotePend, setLotePend] = useState(null); // lote cuyo listado de pendientes está abierto
  const [recordatorios, setRecordatorios] = useState({}); // dni → "enviando" | {ok} | {error}

  const recordar = async (dni) => {
    setRecordatorios((r) => ({ ...r, [dni]: "enviando" }));
    const r = await recordarAcuse(dni);
    setRecordatorios((prev) => ({ ...prev, [dni]: r.error ? { error: r.error } : { ok: r.enviado } }));
  };
  const [tipo, setTipo] = useState("Boleta de pago");
  const [periodo, setPeriodo] = useState("");

  // Paso 2 — lectura y análisis del PDF.
  const [procesando, setProcesando] = useState(false);
  const [fase, setFase] = useState("");
  const [bloqueo, setBloqueo] = useState(null); // RUC/periodo del PDF ≠ elegidos: bloquea, sin continuar
  const [errorArchivo, setErrorArchivo] = useState(null);
  // { totalPaginas, boletas: Boleta[], excepciones: Excepcion[] } — de solo lectura tras el análisis.
  const [analisis, setAnalisis] = useState(null);
  const bytesRef = useRef(null); // bytes del PDF original, para dividirPdf en la publicación

  // Paso 3 — exclusiones (descartes) sobre las boletas del análisis.
  const [descartes, setDescartes] = useState({}); // { [índice en analisis.boletas]: motivo }
  const [promptIdx, setPromptIdx] = useState(null);
  const [motivoTexto, setMotivoTexto] = useState("");

  // Paso 4 — publicación (dividir → hash → subir → RPC).
  const [piezas, setPiezas] = useState(null); // null antes de publicar; luego [{boleta, bytes, hash, estado, url, error}]
  const [publicando, setPublicando] = useState(false);
  const [errorPublicar, setErrorPublicar] = useState(null);
  const [loteCreado, setLoteCreado] = useState(null);

  // Vigencia de la sesión del flujo: reiniciar (paso 5 → "Cargar otro periodo")
  // incrementa este ref para que cualquier resultado async en vuelo
  // (análisis o publicación) que llegue después se descarte en vez de
  // reaplicarse sobre un flujo ya reseteado. Mismo patrón que ImportarPlanilla
  // en Personal.jsx (Task 8).
  const sesionRef = useRef(0);

  const emp = empresaPor(empresaLote);
  const loteExistente = db.lotes.find(
    (l) => l.empresa === empresaLote && l.tipo === tipo && l.periodo === periodo
  );

  // Excepción → índice de la boleta que la originó (todas las excepciones
  // "de página" de analizarLote, y la de vínculo que agregamos aquí, apuntan
  // a la primera página de su boleta: pagina === b.paginas[0] + 1). Las que
  // no tienen página asociada (ej. "falta el correlativo No N": una página
  // perdida, sin boleta que excluir) no tienen resolución local posible.
  const indiceBoletaDe = (exc) => {
    if (exc.pagina == null || !analisis) return -1;
    return analisis.boletas.findIndex((b) => b.paginas[0] + 1 === exc.pagina);
  };
  const excepcionResuelta = (exc) => {
    const idx = indiceBoletaDe(exc);
    return idx >= 0 && descartes[idx] !== undefined;
  };
  const sinResolver = analisis ? analisis.excepciones.filter((exc) => !excepcionResuelta(exc)).length : 0;
  const boletasActivas = analisis ? analisis.boletas.filter((_, i) => descartes[i] === undefined) : [];
  const boletasDescartadas = analisis
    ? analisis.boletas.map((b, i) => ({ b, i })).filter(({ i }) => descartes[i] !== undefined)
    : [];

  const analizarArchivo = async (archivo) => {
    const sesion = sesionRef.current;
    setErrorArchivo(null);
    setBloqueo(null);
    setProcesando(true);
    setFase("Leyendo el PDF…");
    try {
      const bytes = new Uint8Array(await archivo.arrayBuffer());
      const { extraerPaginas } = await import("../../lib/boletas/pdf.js");
      const paginasTexto = await extraerPaginas(bytes);
      if (sesionRef.current !== sesion) return;

      setFase("Identificando boletas y DNI de cada página…");
      const { analizarLote } = await import("../../lib/boletas/lote.js");
      const { lote, boletas, excepciones } = analizarLote(paginasTexto);
      if (sesionRef.current !== sesion) return;

      if (!lote.ruc || lote.ruc !== emp?.ruc) {
        setBloqueo(
          `El RUC leído en el PDF (${lote.ruc ?? "no se pudo determinar"}) no coincide con el RUC de ` +
          `${emp?.nombre ?? "la empresa elegida"} (${emp?.ruc ?? "—"}). Verifica que elegiste la empresa correcta ` +
          `o que este es el PDF que corresponde a este lote.`
        );
        return;
      }
      if (!lote.periodo || lote.periodo !== periodo) {
        setBloqueo(
          `El periodo leído en el PDF (${lote.periodo ?? "no se pudo determinar"}) no coincide con el periodo ` +
          `elegido en el paso 1 (${periodo}). Corrige el periodo o carga el PDF correcto.`
        );
        return;
      }

      // Excepción local (no viene de analizarLote): DNI leído pero sin
      // vínculo vigente en esta empresa — cesado, de otra empresa, o
      // inexistente en el padrón. No se elige solo: queda como excepción.
      const excepcionesVinculo = [];
      boletas.forEach((b) => {
        if (!b.dni) return;
        const vinculado = db.personal.some(
          (p) => p.dni === b.dni && p.empresa === empresaLote && p.estado === "vigente"
        );
        if (!vinculado) {
          excepcionesVinculo.push({
            tipo: "sin_vinculo",
            pagina: b.paginas[0] + 1,
            detalle: `El DNI ${b.dni} (${b.nombre ?? "sin nombre leído"}) no tiene un vínculo vigente en ${emp?.nombre ?? "esta empresa"}.`,
          });
        }
      });

      bytesRef.current = bytes;
      setAnalisis({
        totalPaginas: paginasTexto.length,
        boletas,
        excepciones: [...excepciones, ...excepcionesVinculo],
      });
      setDescartes({});
      setPaso(2);
    } catch (e) {
      if (sesionRef.current === sesion) setErrorArchivo(e.message || "No se pudo leer el archivo.");
    } finally {
      if (sesionRef.current === sesion) setProcesando(false);
    }
  };

  const abrirExclusion = (idx) => { setPromptIdx(idx); setMotivoTexto(""); };
  const cancelarExclusion = () => { setPromptIdx(null); setMotivoTexto(""); };
  const confirmarExclusion = () => {
    if (!motivoTexto.trim()) return;
    setDescartes((d) => ({ ...d, [promptIdx]: motivoTexto.trim() }));
    setPromptIdx(null);
    setMotivoTexto("");
  };

  // Sube las piezas pendientes/erróneas en orden y, si todas terminan bien,
  // dispara el RPC de publicación. Reintentar una subida vuelve a llamar a
  // esta función con el arreglo actual: las piezas ya "ok" se saltan.
  const subirDesde = async (piezasIniciales, sesion) => {
    let actuales = piezasIniciales;
    for (let i = 0; i < actuales.length; i++) {
      if (actuales[i].estado === "ok") continue;
      actuales = actuales.map((p, j) => (j === i ? { ...p, estado: "subiendo", error: null } : p));
      if (sesionRef.current === sesion) setPiezas(actuales);
      try {
        const { sha256Hex } = await import("../../lib/boletas/dividir.js");
        const hash = await sha256Hex(actuales[i].bytes);
        const ruta = `lotes/${empresaLote}/${periodo}/${hash}.pdf`;
        const { error: errSubida } = await supabase.storage
          .from("documentos")
          .upload(ruta, actuales[i].bytes, { contentType: "application/pdf", upsert: true });
        if (errSubida) throw new Error(errSubida.message);
        // El bucket es privado: archivo_url guarda la RUTA interna, no una URL.
        actuales = actuales.map((p, j) =>
          j === i ? { ...p, estado: "ok", hash, url: ruta, error: null } : p
        );
        if (sesionRef.current === sesion) setPiezas(actuales);
      } catch (e) {
        actuales = actuales.map((p, j) => (j === i ? { ...p, estado: "error", error: e.message } : p));
        if (sesionRef.current === sesion) {
          setPiezas(actuales);
          // También a nivel de flujo (no solo en la pieza): así el bloque de
          // reintentar/cancelar de la publicación, que se guía por
          // errorPublicar, aparece también cuando lo que falló fue subir un
          // archivo (y no solo cuando falla el RPC final).
          setErrorPublicar(e.message);
        }
        return; // se detiene: el archivo fallido se reintenta, no se sigue con el resto en silencio
      }
    }
    if (sesionRef.current !== sesion) return;
    await finalizarPublicacion(actuales, sesion);
  };

  // Cola la llamada al RPC de publicación (última etapa, tras subir todas las
  // piezas). Separada de subirDesde para poder reintentar SOLO esta etapa
  // cuando todas las piezas ya están "ok" pero el RPC falló (ej. blip de red
  // o rechazo del backend): no tiene sentido volver a subir archivos que ya
  // se subieron con éxito.
  const finalizarPublicacion = async (piezasFinal, sesion) => {
    try {
      const cuerpo = piezasFinal.map((p) => ({
        dni: p.boleta.dni, correlativo: p.boleta.correlativo, nombre: p.boleta.nombre,
        cargo: p.boleta.cargo, sede: p.boleta.sede, centroCosto: p.boleta.centroCosto,
        ingreso: p.boleta.ingreso, neto: p.boleta.neto, hash: p.hash, archivo_url: p.url,
      }));
      const data = await publicarLotePdf({ empresaId: empresaLote, tipo, periodo, boletas: cuerpo });
      if (sesionRef.current !== sesion) return;
      setLoteCreado(data);
      setPaso(4);
    } catch (e) {
      if (sesionRef.current === sesion) setErrorPublicar(e.message);
    }
  };

  const publicar = async () => {
    const sesion = sesionRef.current;
    setErrorPublicar(null);
    setPublicando(true);
    try {
      const { dividirPdf } = await import("../../lib/boletas/dividir.js");
      const grupos = boletasActivas.map((b) => b.paginas);
      const partes = await dividirPdf(bytesRef.current, grupos);
      if (sesionRef.current !== sesion) return;
      const iniciales = boletasActivas.map((b, i) => ({
        boleta: b, bytes: partes[i], hash: null, estado: "pendiente", url: null, error: null,
      }));
      setPiezas(iniciales);
      await subirDesde(iniciales, sesion);
    } catch (e) {
      if (sesionRef.current === sesion) setErrorPublicar(e.message);
    } finally {
      if (sesionRef.current === sesion) setPublicando(false);
    }
  };

  // Reintento único para todo lo que puede fallar tras pulsar "Publicar": si
  // alguna pieza quedó en error, retoma la subida desde ahí (subirDesde salta
  // las que ya están "ok"); si TODAS las piezas ya subieron y lo único que
  // falló fue el RPC final, repite solo esa llamada — nunca vuelve a subir
  // archivos ya confirmados.
  const reintentarPublicacion = async () => {
    const sesion = sesionRef.current;
    setErrorPublicar(null);
    setPublicando(true);
    try {
      if (piezas.every((p) => p.estado === "ok")) {
        await finalizarPublicacion(piezas, sesion);
      } else {
        await subirDesde(piezas, sesion);
      }
    } finally {
      if (sesionRef.current === sesion) setPublicando(false);
    }
  };

  const reiniciar = () => {
    sesionRef.current += 1;
    setPaso(0);
    setProcesando(false);
    setFase("");
    setBloqueo(null);
    setErrorArchivo(null);
    setAnalisis(null);
    bytesRef.current = null;
    setDescartes({});
    setPromptIdx(null);
    setMotivoTexto("");
    setPiezas(null);
    setPublicando(false);
    setErrorPublicar(null);
    setLoteCreado(null);
  };

  return (
    <>
      <PageHeader
        code="RRH-06 → RRH-10 · Asistente de carga"
        title="Carga de boletas"
        subtitle="Flujo de mayor volumen del sistema. Funciona con el PDF que la planilla ya genera hoy."
      />

      <div className="mb-6 flex items-center gap-0">
        {PASOS.map((p, i) => (
          <div key={p} className="flex items-center">
            <div className="flex items-center gap-2">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full font-mono text-[10.5px] font-bold ${
                  i < paso ? "bg-conf text-white" : i === paso ? "bg-pend text-white" : "border border-borde-f bg-white text-gris"
                }`}
              >
                {i < paso ? "✓" : i + 1}
              </div>
              <span className={`text-[12px] font-semibold ${i === paso ? "text-tinta" : "text-gris-cl"}`}>{p}</span>
            </div>
            {i < PASOS.length - 1 && <div className="mx-3 h-px w-8 bg-borde-f" />}
          </div>
        ))}
      </div>

      {/* Paso 1 — RRH-06 */}
      {paso === 0 && (
        <Card className="max-w-xl">
          <div className="space-y-4">
            <Field label="Empresa" required hint="Cada lote pertenece a una sola razón social: sus documentos llevan el membrete y RUC de esa empresa.">
              <Select value={empresaLote} onChange={(e) => setEmpresaLote(e.target.value)}>
                {empresasActivas.map((e) => (
                  <option key={e.id} value={e.id}>{e.nombre} — RUC {e.ruc}</option>
                ))}
              </Select>
            </Field>
            <Field label="Tipo de documento" required>
              {/* Gratificación y Utilidades retirados a pedido de Diego (2026-08-17). */}
              <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                <option>Boleta de pago</option>
                <option>Liquidación de CTS</option>
              </Select>
            </Field>
            <Field label="Periodo" required>
              <input type="month" className={inputCls} value={periodo} onChange={(e) => setPeriodo(e.target.value)} />
            </Field>
            {loteExistente && (
              <Note tone="pend">
                Ya existe el lote <b>{loteExistente.id}</b> publicado para esta combinación. Continuar cargará una{" "}
                <b>corrección de versión</b>: los documentos corregidos generarán versión {(loteExistente.version ?? 1) + 1}{" "}
                con acuse nuevo, sin tocar ningún acuse existente. Nunca se sobrescribe en silencio.
              </Note>
            )}
            <Button onClick={() => setPaso(1)} disabled={!periodo}>
              {loteExistente ? "Continuar como corrección de versión" : "Continuar"}
            </Button>
          </div>
        </Card>
      )}

      {/* Paso 2 — RRH-07 */}
      {paso === 1 && (
        <Card className="max-w-xl">
          <div className="space-y-4">
            <Note tone="neutral">
              Lote para <b>{emp?.nombre}</b> · {tipo} · {periodo}
            </Note>
            <label
              className={`block rounded-md border-2 border-dashed px-6 py-12 text-center transition-colors ${
                procesando ? "border-petroleo bg-conf-bg/40" : "cursor-pointer border-borde-f bg-papel/60 hover:border-petroleo-cl"
              }`}
            >
              <input
                type="file"
                accept=".pdf"
                className="hidden"
                disabled={procesando}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) analizarArchivo(f); }}
              />
              <FileUp size={26} className="mx-auto mb-2 text-gris" />
              {procesando ? (
                <>
                  <div className="text-[14px] font-semibold text-tinta-2">{fase}</div>
                  <div className="mx-auto mt-3 max-w-[240px]"><Progress value={64} tone="petroleo" /></div>
                </>
              ) : (
                <>
                  <div className="text-[14px] font-semibold text-tinta-2">Haz clic para elegir el PDF consolidado del periodo</div>
                  <div className="mt-1 text-[12px] text-gris">
                    Un único PDF por lote. La separación se hace leyendo el número de DNI en cada página, nunca por posición.
                  </div>
                </>
              )}
            </label>
            {bloqueo && <Note tone="alerta">{bloqueo}</Note>}
            {errorArchivo && <Note tone="alerta">No se pudo procesar el archivo: {errorArchivo}</Note>}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setPaso(0)} disabled={procesando}>Atrás</Button>
            </div>
          </div>
        </Card>
      )}

      {/* Paso 3 — RRH-08 */}
      {paso === 2 && analisis && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4">
            {[
              ["Páginas leídas", analisis.totalPaginas],
              ["Boletas identificadas", analisis.boletas.length],
              ["Requieren revisión", analisis.excepciones.length],
            ].map(([k, v]) => (
              <Card key={k} className="flex-1 min-w-[150px]">
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-gris">{k}</div>
                <div className="mt-1 text-[24px] font-bold text-tinta">{v}</div>
              </Card>
            ))}
          </div>
          {analisis.excepciones.length > 0 && (
            <Card pad={false}>
              <Table head={["Página", "Tipo", "Detalle", "Acción"]}>
                {analisis.excepciones.map((exc, i) => {
                  const idx = indiceBoletaDe(exc);
                  const resuelta = idx >= 0 && descartes[idx] !== undefined;
                  return (
                    <tr key={i} className={resuelta ? "opacity-50" : ""}>
                      <Td className="font-mono text-[12px]">{exc.pagina ?? "—"}</Td>
                      <Td className="font-mono text-[11px] uppercase text-gris">{exc.tipo.replace(/_/g, " ")}</Td>
                      <Td className="text-gris">{exc.detalle}</Td>
                      <Td>
                        {resuelta ? (
                          <Badge tone="conf">Excluida — {descartes[idx]}</Badge>
                        ) : idx < 0 ? (
                          <span className="text-[11.5px] text-gris-cl">Corrige el PDF y vuelve a cargarlo</span>
                        ) : promptIdx === idx ? (
                          <div className="flex flex-col gap-1.5">
                            <Textarea
                              value={motivoTexto}
                              onChange={(e) => setMotivoTexto(e.target.value)}
                              placeholder="Motivo de la exclusión (obligatorio)"
                            />
                            <div className="flex gap-1.5">
                              <Button size="sm" onClick={confirmarExclusion} disabled={!motivoTexto.trim()}>Confirmar</Button>
                              <Button size="sm" variant="secondary" onClick={cancelarExclusion}>Cancelar</Button>
                            </div>
                          </div>
                        ) : (
                          <Button size="sm" variant="secondary" onClick={() => abrirExclusion(idx)}>Excluir boleta</Button>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </Table>
            </Card>
          )}
          <Note tone={sinResolver ? "pend" : "conf"}>
            {sinResolver
              ? `${sinResolver} excepciones sin resolver. Ninguna se descarta automáticamente: o se corrige el PDF y se vuelve a cargar, o se excluye la boleta del lote de forma explícita, con motivo. Ningún documento se publica sin trabajador identificado.`
              : "Todas las excepciones fueron resueltas. Puedes continuar a la revisión final."}
          </Note>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setPaso(1)}>Atrás</Button>
            <Button onClick={() => setPaso(3)}>Continuar</Button>
          </div>
        </div>
      )}

      {/* Paso 4 — RRH-09 */}
      {paso === 3 && analisis && (
        <Card className="max-w-2xl">
          <h2 className="mb-4 text-[15px] font-bold text-tinta">Revisión previa a la publicación</h2>
          <div className="mb-4 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
            {[
              ["Empresa", emp?.corto],
              ["Tipo", tipo],
              ["Periodo", periodo],
              ["A publicar", `${boletasActivas.length} boletas`],
              ["Excluidas del lote", String(boletasDescartadas.length)],
              ["Excepciones sin resolver", String(sinResolver)],
            ].map(([k, v]) => (
              <div key={k}>
                <div className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-gris">{k}</div>
                <div className="mt-0.5 text-[13.5px] font-semibold text-tinta">{v}</div>
              </div>
            ))}
          </div>

          {piezas === null ? (
            <>
              <Card pad={false} className="mb-4">
                <Table head={["Correlativo", "DNI", "Nombre", "Neto"]}>
                  {boletasActivas.map((b) => (
                    <tr key={b.correlativo}>
                      <Td className="font-mono text-[12px]">{b.correlativo}</Td>
                      <Td className="font-mono text-[12px]">{b.dni}</Td>
                      <Td>{b.nombre}</Td>
                      <Td className="font-mono text-[12px]">{b.neto != null ? `S/ ${b.neto.toFixed(2)}` : "—"}</Td>
                    </tr>
                  ))}
                </Table>
              </Card>

              {boletasDescartadas.length > 0 && (
                <Note tone="pend">
                  <b>{boletasDescartadas.length}</b> {boletasDescartadas.length === 1 ? "boleta excluida" : "boletas excluidas"} del lote:
                  <ul className="mt-1 list-disc pl-4">
                    {boletasDescartadas.map(({ b, i }) => (
                      <li key={i}>Correlativo {b.correlativo} ({b.dni ?? "sin DNI"}, {b.nombre ?? "sin nombre"}): {descartes[i]}</li>
                    ))}
                  </ul>
                </Note>
              )}

              <div className="mt-4 space-y-2.5">
                <Note tone="neutral">
                  Al publicar: se dividirá el PDF en un archivo por boleta, se calculará el hash SHA-256 de cada uno, se
                  subirán a almacenamiento y los documentos quedarán visibles en el portal de cada trabajador.
                </Note>
                <Note tone="alerta">
                  <b>Publicar es irreversible.</b> El documento queda visible para el trabajador y cualquier corrección
                  posterior generará una versión nueva con acuse nuevo.
                </Note>
                {sinResolver > 0 && (
                  <Note tone="alerta">
                    No se puede publicar: quedan {sinResolver} excepciones sin resolver. Vuelve al paso anterior para
                    excluir esas boletas o corrige el PDF y vuelve a cargarlo.
                  </Note>
                )}
                {boletasActivas.length === 0 && (
                  <Note tone="alerta">No hay boletas para publicar: todas fueron excluidas o el lote quedó vacío.</Note>
                )}
                {errorPublicar && <Note tone="alerta">{errorPublicar}</Note>}
              </div>
              <div className="mt-4 flex gap-2">
                <Button variant="secondary" onClick={() => setPaso(2)} disabled={publicando}>Atrás</Button>
                <Button onClick={publicar} disabled={publicando || sinResolver > 0 || boletasActivas.length === 0}>
                  {publicando ? "Publicando…" : "Publicar"}
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="mx-auto max-w-[320px]">
                <Progress value={(piezas.filter((p) => p.estado === "ok").length / piezas.length) * 100} tone="petroleo" />
              </div>
              <div className="text-center font-mono text-[12px] text-gris">
                {piezas.filter((p) => p.estado === "ok").length} / {piezas.length} archivos subidos
              </div>
              <Card pad={false}>
                <Table head={["Correlativo", "DNI", "Estado"]}>
                  {piezas.map((p) => (
                    <tr key={p.boleta.correlativo}>
                      <Td className="font-mono text-[12px]">{p.boleta.correlativo}</Td>
                      <Td className="font-mono text-[12px]">{p.boleta.dni}</Td>
                      <Td>
                        {p.estado === "ok" && <Badge tone="conf">Subido</Badge>}
                        {p.estado === "subiendo" && <Badge tone="pend">Subiendo…</Badge>}
                        {p.estado === "pendiente" && <Badge tone="neutral">En espera</Badge>}
                        {p.estado === "error" && <Badge tone="alerta">Error: {p.error}</Badge>}
                      </Td>
                    </tr>
                  ))}
                </Table>
              </Card>
              {errorPublicar && <Note tone="alerta">{errorPublicar}</Note>}
              {errorPublicar && !publicando && (
                <div className="flex gap-2">
                  <Button onClick={reintentarPublicacion}>Reintentar publicación</Button>
                  <Button variant="secondary" onClick={() => { setPiezas(null); setErrorPublicar(null); }}>
                    Cancelar publicación
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Paso 5 — RRH-10 */}
      {paso === 4 && loteCreado && (
        <Card className="max-w-2xl">
          <div className="mb-4 flex items-center gap-3">
            <CheckCircle2 size={26} className="text-conf" />
            <div>
              <h2 className="text-[15px] font-bold text-tinta">Publicación confirmada</h2>
              <div className="font-mono text-[12px] text-gris">Lote {loteCreado.lote_id} · registrado en auditoría</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              ["Publicadas", String(loteCreado.documentos ?? boletasActivas.length)],
              ["Excluidas", String(boletasDescartadas.length)],
              ["Versión", `v${loteCreado.version}`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-md bg-papel px-3 py-3 text-center">
                <div className="text-[20px] font-bold text-tinta">{v}</div>
                <div className="font-mono text-[9.5px] uppercase tracking-wide text-gris">{k}</div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex gap-2">
            <Link to="/rrhh/acuses"><Button>Ir a seguimiento de acuses</Button></Link>
            <Button variant="secondary" onClick={reiniciar}>Cargar otro periodo</Button>
          </div>
        </Card>
      )}

      {paso < 2 && (
        <div className="mt-6 max-w-xl">
          <h3 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-gris">
            Lotes recientes — {emp?.corto}
          </h3>
          <Card pad={false}>
            {db.lotes.filter((l) => l.empresa === empresaLote).length === 0 ? (
              <div className="p-4 text-[12.5px] text-gris">Esta empresa aún no tiene lotes publicados.</div>
            ) : (
              <Table head={["Lote", "Tipo", "Periodo", "Recepción", "Pendientes"]}>
                {db.lotes.filter((l) => l.empresa === empresaLote).map((l) => (
                  <tr key={l.id}>
                    <Td className="font-mono text-[12px]">{l.id}</Td>
                    <Td>{l.tipo}</Td>
                    <Td className="text-gris">{l.periodo}</Td>
                    <Td>
                      <Badge tone={l.pendientes === 0 ? "conf" : "pend"}>
                        {Math.round(((l.confirmados + l.asistidos) / l.total) * 100)}%
                      </Badge>
                    </Td>
                    <Td>
                      {l.pendientes > 0 ? (
                        <button
                          type="button"
                          onClick={() => setLotePend(l)}
                          className="text-[12px] font-semibold text-petroleo hover:underline"
                        >
                          {l.pendientes} sin acusar
                        </button>
                      ) : (
                        <span className="text-[12px] text-gris-cl">0</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      )}

      <Modal
        open={!!lotePend}
        onClose={() => setLotePend(null)}
        title={`Pendientes de acuse — ${lotePend?.id ?? ""}`}
      >
        {lotePend && (() => {
          // v_acuses trae una fila por documento del lote; los que faltan son
          // los sin acuse registrado: 'pendiente' (aún no confirma) y
          // 'nunca_ingreso' (jamás entró al portal, exige otra acción).
          const faltan = db.acuses.filter(
            (a) => a.lote === lotePend.id && (a.estado === "pendiente" || a.estado === "nunca_ingreso")
          );
          return (
            <div className="space-y-3">
              <Note tone="pend">
                {faltan.length} de {lotePend.total} trabajadores del lote aún no dejan constancia de recepción.
                Los «nunca ingresó» necesitan otra acción: reenviar la clave del portal o registrar acuse asistido.
              </Note>
              <Card pad={false}>
                <Table head={["DNI", "Trabajador", "Sede", "Estado", ""]}>
                  {faltan.map((a) => {
                    const p = persona(a.dni);
                    const r = recordatorios[a.dni];
                    return (
                      <tr key={a.dni}>
                        <Td className="font-mono text-[12px]">{a.dni}</Td>
                        <Td className="font-semibold">{p?.nombre ?? "—"}</Td>
                        <Td className="text-gris">{sede(p?.sede)?.cliente ?? p?.sede ?? "—"}</Td>
                        <Td>
                          <Badge tone={a.estado === "nunca_ingreso" ? "alerta" : "pend"}>
                            {a.estado === "nunca_ingreso" ? "Nunca ingresó" : "Sin confirmar"}
                          </Badge>
                        </Td>
                        <Td>
                          {r === "enviando" ? (
                            <span className="text-[11.5px] text-gris-cl">Enviando…</span>
                          ) : r?.ok ? (
                            <span className="text-[11.5px] font-semibold text-conf">Enviado a {r.ok}</span>
                          ) : (
                            <div className="flex flex-col gap-1">
                              <Button size="sm" variant="secondary" onClick={() => recordar(a.dni)}>
                                Recordar por correo
                              </Button>
                              {r?.error && <span className="max-w-[220px] text-[11px] leading-snug text-alerta">{r.error}</span>}
                            </div>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </Table>
              </Card>
              <div className="flex justify-end">
                <Link to="/rrhh/acuses" onClick={() => setLotePend(null)}>
                  <Button size="sm" variant="secondary">Ir a seguimiento de acuses</Button>
                </Link>
              </div>
            </div>
          );
        })()}
      </Modal>
    </>
  );
}
