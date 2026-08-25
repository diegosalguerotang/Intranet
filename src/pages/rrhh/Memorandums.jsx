import { useMemo, useState } from "react";
import { AlertTriangle, FileDown, Paperclip, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { useApp } from "../../state";
import {
  PageHeader, Card, Button, Field, Input, Textarea, Select, Note, Badge, Table, Td, Modal, Stat,
} from "../../components/ui";

const ESTADOS = {
  emitido_sin_notificar: { tone: "alerta", label: "Emitido sin notificar" },
  notificado: { tone: "pend", label: "Notificado, sin acuse" },
  en_plazo: { tone: "pend", label: "En plazo de descargo" },
  descargo_presentado: { tone: "tinta", label: "Descargo presentado" },
  vencido: { tone: "alerta", label: "Vencido sin descargo" },
  resuelto: { tone: "neutral", label: "Resuelto" },
  registro_interno: { tone: "neutral", label: "Registro interno" },
};

// Encabezado ordenable: la flechita indica el orden activo y el click lo
// alterna (sin orden → ascendente → descendente).
function OrdenTh({ etiqueta, campo, orden, setOrden }) {
  const activo = orden.campo === campo;
  const Icono = !activo ? ArrowUpDown : orden.dir === 1 ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => setOrden(activo && orden.dir === -1 ? { campo: null, dir: 1 } : { campo, dir: activo ? -1 : 1 })}
      className={`inline-flex items-center gap-1 uppercase tracking-[0.06em] ${activo ? "text-white" : "text-white/80 hover:text-white"}`}
    >
      {etiqueta} <Icono size={11} />
    </button>
  );
}

// RRH-18 / RRH-19 — Emisión y bandeja de memorándums
export default function Memorandums() {
  const { db, persona, resolverMemo, notificarMemorandum } = useApp();
  const [emitir, setEmitir] = useState(false);
  const [detalle, setDetalle] = useState(null);
  const [exportando, setExportando] = useState(false);

  // Expediente en PDF desde el registro congelado del memorándum (falta
  // literal, antecedentes art. 54, descargo y resolución tal como constan).
  const exportarExpediente = async (m) => {
    setExportando(true);
    try {
      const { generarConstanciaPdf } = await import("../../lib/constancia.js");
      const campos = [
        ["Trabajador", `${persona(m.dni)?.nombre ?? "-"} — DNI ${m.dni}`],
        ["Tipo de sanción", m.tipo + (m.suspensionDias ? ` (${m.suspensionDias} día${m.suspensionDias === 1 ? "" : "s"})` : "")],
        ["Emitido", m.emitido],
        ["Notificado", m.notificado ?? (m.estado === "registro_interno" ? "No aplica (registro interno)" : "Pendiente de notificación")],
        ["Plazo de descargo", m.estado === "registro_interno" ? "No aplica"
          : m.vence ? `${m.plazoDias} días ${m.naturaleza === "imputacion" ? "naturales" : "hábiles"} — vence ${m.vence}`
          : `${m.plazoDias || "—"} días — aún no corre`],
        ["Reincidencia (art. 58)", m.reincidencia ? "Sí — agravante" : "No"],
        ["Falta invocada (texto del RIT)", m.faltaTexto ?? m.articulo ?? "—"],
        ["Hechos imputados", m.motivo],
      ];
      if ((m.antecedentes ?? []).length) {
        campos.push(["Antecedentes al momento de emitir (art. 54)",
          m.antecedentes.map((a) => `${a.emitido} · ${a.tipo} (${a.id}) — ${ESTADOS[a.estado]?.label ?? a.estado}`).join("  ·  ")]);
      }
      campos.push(["Descargo del trabajador", m.descargo ? `(${m.descargo.fecha}) ${m.descargo.texto}` : "No presentado"]);
      campos.push(["Resolución", m.resolucion ? `(${m.resolucion.fecha}) ${m.resolucion.decision}` : "Pendiente"]);
      const bytes = await generarConstanciaPdf({
        titulo: "EXPEDIENTE DISCIPLINARIO",
        subtitulo: "Generado desde el registro congelado del memorándum",
        numero: m.id, campos,
      });
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const el = Object.assign(document.createElement("a"), { href: url, download: `expediente-${m.id}.pdf` });
      document.body.appendChild(el);
      el.click();
      el.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } finally {
      setExportando(false);
    }
  };
  const [filtro, setFiltro] = useState("");
  const [busca, setBusca] = useState("");
  const [orden, setOrden] = useState({ campo: null, dir: 1 });
  const [aviso, setAviso] = useState(null);
  const [errorNotificar, setErrorNotificar] = useState(null);
  const memos = db.memorandums;

  const notificar = async (id) => {
    setErrorNotificar(null);
    try {
      await notificarMemorandum(id);
      setDetalle(null);
      setAviso(`Notificación de ${id} registrada: el plazo de descargo empezó a correr hoy.`);
    } catch (e) {
      setErrorNotificar(e.message);
    }
  };

  const filas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const lista = memos.filter((m) => {
      if (filtro && m.estado !== filtro) return false;
      if (!q) return true;
      const p = persona(m.dni);
      return m.dni.includes(q) || (p?.nombre ?? "").toLowerCase().includes(q);
    });
    if (!orden.campo) return lista;
    return [...lista].sort((a, b) => {
      const va = orden.campo === "nombre" ? (persona(a.dni)?.nombre ?? "") : (a.notificado ?? "");
      const vb = orden.campo === "nombre" ? (persona(b.dni)?.nombre ?? "") : (b.notificado ?? "");
      if (va === vb) return 0;
      if (va === "") return 1; // sin fecha/nombre siempre al final
      if (vb === "") return -1;
      return va < vb ? -orden.dir : orden.dir;
    });
  }, [memos, filtro, busca, orden, persona]);

  const resolver = (id, decision) => {
    resolverMemo(id, { fecha: new Date().toISOString().slice(0, 10), decision });
    setDetalle(null);
  };

  return (
    <>
      <PageHeader
        code="RRH-18 / RRH-19 · Disciplina"
        title="Memorándums y descargos"
        subtitle="El plazo corre en días hábiles desde la confirmación de recepción, no desde la emisión. Un memorándum no notificado no produce efectos."
        actions={<Button size="sm" onClick={() => setEmitir(true)}><AlertTriangle size={13} /> Emitir memorándum</Button>}
      />

      <div className="mb-5 flex flex-wrap gap-4">
        <Stat label="Procesos abiertos" value={memos.filter((m) => !["resuelto", "registro_interno"].includes(m.estado)).length} />
        <Stat label="Esperan resolución" value={memos.filter((m) => m.estado === "descargo_presentado").length} tone="pend" />
        <Stat label="Sin notificar" value={memos.filter((m) => m.estado === "emitido_sin_notificar").length} tone="alerta" hint="Considerar notificación física" />
        <Stat label="Preavisos vencidos" value={memos.filter((m) => m.preavisoVencido).length} tone="alerta" hint="Proceder con notificación notarial" />
      </div>

      {aviso && <div className="mb-4"><Note tone="conf">{aviso}</Note></div>}

      <Card pad={false}>
        <div className="flex flex-wrap gap-2.5 border-b border-borde bg-papel/50 p-3.5">
          <Input placeholder="Buscar por trabajador o DNI…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 250 }} />
          <Select value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="">Todos los estados</option>
            <option value="emitido_sin_notificar">Sin notificar</option>
            <option value="descargo_presentado">Descargo presentado</option>
            <option value="resuelto">Resueltos</option>
          </Select>
        </div>
        <Table head={[
          "N°",
          <OrdenTh key="t" etiqueta="Trabajador" campo="nombre" orden={orden} setOrden={setOrden} />,
          "Tipo",
          <OrdenTh key="f" etiqueta="Notificado" campo="notificado" orden={orden} setOrden={setOrden} />,
          "Vence", "Estado", "",
        ]}>
          {filas.map((m) => {
            const est = ESTADOS[m.estado] ?? ESTADOS.notificado;
            return (
              <tr key={m.id} className="hover:bg-papel/60">
                <Td className="font-mono text-[12px]">{m.id}</Td>
                <Td className="font-semibold">{persona(m.dni)?.nombre}</Td>
                <Td className="text-gris">{m.tipo}</Td>
                <Td className="font-mono text-[12px] text-gris">{m.notificado ?? "—"}</Td>
                <Td className="font-mono text-[12px] text-gris">{m.vence ?? "—"}</Td>
                <Td><Badge tone={est.tone}>{est.label}</Badge></Td>
                <Td><Button variant="ghost" size="sm" onClick={() => setDetalle(m)}>Ver expediente</Button></Td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <EmitirMemo
        open={emitir}
        onClose={() => setEmitir(false)}
        onEmitido={(id, tipoNombre) => { setEmitir(false); setAviso(`${tipoNombre} ${id} emitido.`); }}
      />

      <Modal open={!!detalle} onClose={() => setDetalle(null)} title={`Expediente ${detalle?.id ?? ""}`} wide>
        {detalle && (
          <div className="space-y-4">
            <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {[
                ["Trabajador", persona(detalle.dni)?.nombre],
                ["Tipo", detalle.tipo + (detalle.suspensionDias ? ` (${detalle.suspensionDias} día${detalle.suspensionDias === 1 ? "" : "s"})` : "")],
                ["Emitido", detalle.emitido],
                ["Notificado", detalle.notificado ?? (detalle.estado === "registro_interno" ? "No aplica (registro interno)" : "Pendiente de notificación")],
                ["Plazo", detalle.estado === "registro_interno" ? "No aplica" :
                  detalle.vence
                    ? `${detalle.plazoDias} días ${detalle.naturaleza === "imputacion" ? "naturales" : "hábiles"} — vence ${detalle.vence}`
                    : `${detalle.plazoDias || "—"} días ${detalle.naturaleza === "imputacion" ? "naturales" : "hábiles"} — aún no corre`],
                ["Reincidencia (art. 58)", detalle.reincidencia ? "Sí — agravante" : "No"],
              ].map(([k, v]) => (
                <div key={k}>
                  <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-gris">{k}</div>
                  <div className="mt-0.5 text-[13px] text-tinta">{v}</div>
                </div>
              ))}
            </div>
            {(detalle.faltaTexto ?? detalle.articulo) && (
              <div>
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-gris">Falta invocada (texto del RIT)</div>
                <div className="mt-1 text-[13px] leading-relaxed text-tinta">{detalle.faltaTexto ?? detalle.articulo}</div>
              </div>
            )}
            <div>
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-gris">Hechos imputados</div>
              <div className="mt-1 text-[13px] leading-relaxed text-tinta">{detalle.motivo}</div>
            </div>
            {(detalle.antecedentes ?? []).length > 0 && (
              <div className="rounded-md border border-borde bg-papel/60 p-3.5">
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-gris">
                  Antecedentes al momento de emitir (art. 54)
                </div>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[12.5px] text-tinta-2">
                  {detalle.antecedentes.map((a) => (
                    <li key={a.id}>{a.emitido} · {a.tipo} ({a.id}) — {ESTADOS[a.estado]?.label ?? a.estado}</li>
                  ))}
                </ul>
              </div>
            )}
            {detalle.preavisoVencido && (
              <Note tone="alerta">
                <b>Preaviso vencido sin acuse.</b> Proceder con la notificación notarial (vía subsidiaria con
                fecha computable): sin ella el procedimiento se congela y se rompe la inmediatez.
              </Note>
            )}

            {detalle.descargo ? (
              <div className="rounded-md border border-borde bg-papel/60 p-4">
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="text-[12.5px] font-bold text-tinta">Descargo del trabajador</div>
                  <div className="font-mono text-[11px] text-gris">{detalle.descargo.fecha}</div>
                </div>
                <p className="text-[13px] leading-relaxed text-tinta-2">{detalle.descargo.texto}</p>
                <div className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-petroleo">
                  <Paperclip size={12} /> {detalle.descargo.adjuntos} adjunto — constancia_medica.jpg
                </div>
              </div>
            ) : detalle.estado !== "resuelto" && detalle.notificado ? (
              <Note tone="pend">Sin descargo presentado. El plazo {detalle.vence ? `vence el ${detalle.vence}` : "aún no corre"}.</Note>
            ) : null}

            {detalle.resolucion ? (
              <Note tone="neutral"><b>Resolución ({detalle.resolucion.fecha}):</b> {detalle.resolucion.decision}</Note>
            ) : detalle.estado === "descargo_presentado" ? (
              <div className="space-y-2">
                <div className="text-[12.5px] font-bold text-tinta">Resolver el proceso</div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => resolver(detalle.id, "Se archiva el proceso: el descargo acredita causa justificada.")}>Archivar</Button>
                  <Button size="sm" variant="secondary" onClick={() => resolver(detalle.id, "Se mantiene la sanción impuesta.")}>Mantener sanción</Button>
                  <Button size="sm" variant="danger" onClick={() => resolver(detalle.id, "Se eleva a amonestación escrita.")}>Elevar</Button>
                </div>
                <p className="text-[11.5px] text-gris">La resolución se notifica al trabajador por el portal y genera su propio acuse.</p>
              </div>
            ) : detalle.estado === "emitido_sin_notificar" ? (
              <div className="space-y-2">
                <Note tone="alerta">
                  Aún sin notificar: el memorándum no produce efectos y el plazo no corre. Registra aquí la
                  notificación cuando se entregue (electrónica con acuse o física con cargo).
                </Note>
                {errorNotificar && <Note tone="alerta">{errorNotificar}</Note>}
                <Button size="sm" onClick={() => notificar(detalle.id)}>Registrar notificación (el plazo corre desde hoy)</Button>
              </div>
            ) : null}

            <Button variant="secondary" size="sm" onClick={() => exportarExpediente(detalle)} disabled={exportando}>
              <FileDown size={13} /> {exportando ? "Generando PDF…" : "Exportar expediente completo"}
            </Button>
          </div>
        )}
      </Modal>
    </>
  );
}

// RRH-18 — Emitir memorándum, parametrizado por el RIT vigente: tipos del
// art. 53, falta invocada con TEXTO LITERAL (art. 20 conc. 56.1 / art. 56),
// antecedentes a la vista (art. 54), tope de suspensión (art. 53 c). La
// amonestación verbal no genera carta: es un registro interno con reporte a
// RR.HH. dentro de 24 horas.
// Sin acentos y en minúsculas, para que "autorizacion" encuentre «autorización».
const plano = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function EmitirMemo({ open, onClose, onEmitido }) {
  const { db, emitirMemorandum } = useApp();
  const [dni, setDni] = useState("");
  const [tipoId, setTipoId] = useState("amonestacion-escrita");
  const [faltaId, setFaltaId] = useState("");
  const [buscaFalta, setBuscaFalta] = useState("");
  const [motivo, setMotivo] = useState("");
  const [suspensionDias, setSuspensionDias] = useState(1);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);

  const vigentes = db.personal.filter((p) => p.estado === "vigente");
  const tipo = db.tiposSancion.find((t) => t.id === tipoId);
  const falta = db.ritFaltas.find((f) => String(f.id) === String(faltaId));
  const antecedentes = dni ? db.memorandums.filter((m) => m.dni === dni) : [];
  const faltaRequerida = tipo?.notificable ?? true;

  // El catálogo trae 50 faltas: el buscador filtra las opciones del select por
  // texto o por número ("20 c", "56.2", "abandono"...). La falta ya elegida
  // nunca desaparece de la lista aunque no coincida con el filtro.
  const q = plano(buscaFalta.trim());
  const coincide = (f) =>
    !q ||
    plano(f.texto).includes(q) ||
    `${f.articulo} ${f.item}`.includes(q) ||
    `${f.articulo}.${f.item}`.includes(q) ||
    String(f.id) === String(faltaId);
  const faltas20 = db.ritFaltas.filter((f) => f.articulo === 20 && coincide(f));
  const faltas56 = db.ritFaltas.filter((f) => f.articulo === 56 && coincide(f));

  const cerrar = () => {
    setDni(""); setTipoId("amonestacion-escrita"); setFaltaId(""); setBuscaFalta("");
    setMotivo(""); setSuspensionDias(1); setError(null);
    onClose();
  };

  const emitir = async () => {
    setError(null);
    setOcupado(true);
    try {
      const id = await emitirMemorandum({
        dni, tipoSancion: tipoId, faltaId: faltaId ? Number(faltaId) : null, motivo,
        suspensionDias: tipo?.topeSuspension ? suspensionDias : null,
      });
      onEmitido(id, tipo?.nombre ?? "Memorándum");
      cerrar();
    } catch (e) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Modal open={open} onClose={cerrar} title="RRH-18 · Emitir medida disciplinaria" wide>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Trabajador" required>
            <Select value={dni} onChange={(e) => setDni(e.target.value)}>
              <option value="">Buscar…</option>
              {vigentes.map((p) => (
                <option key={p.dni} value={p.dni}>{p.nombre} — {p.dni}</option>
              ))}
            </Select>
          </Field>
          <Field label="Tipo de proceso (art. 53 del RIT)" required>
            <Select value={tipoId} onChange={(e) => setTipoId(e.target.value)}>
              {db.tiposSancion.map((t) => (
                <option key={t.id} value={t.id}>{t.nombre}</option>
              ))}
            </Select>
          </Field>
        </div>

        {tipo && !tipo.notificable && (
          <Note tone="neutral">
            La amonestación verbal es un <b>registro interno</b>: no genera carta al trabajador. El RIT exige
            reportarla a RR.HH. dentro de las 24 horas (art. 53 a) — este registro ES ese reporte.
          </Note>
        )}
        {tipo?.naturaleza === "imputacion" && (
          <Note tone="pend">
            El preaviso es una <b>imputación</b>, no una sanción: plazo de <b>{tipo.plazoDias} días NATURALES</b>{" "}
            (art. 31 LPCL, imperativo) y notificación <b>notarial obligatoria</b>.
          </Note>
        )}

        <Field label={`Falta invocada${faltaRequerida ? "" : " (opcional)"}`} required={faltaRequerida}
               hint="El documento imprime el texto literal de la obligación, no solo el número.">
          <div className="space-y-1.5">
            <Input
              placeholder={`Buscar entre las ${db.ritFaltas.length} faltas del RIT… (ej. «abandono», «20 c», «tardanza»)`}
              value={buscaFalta}
              onChange={(e) => setBuscaFalta(e.target.value)}
            />
            <Select value={faltaId} onChange={(e) => setFaltaId(e.target.value)}>
              <option value="">
                {faltas20.length + faltas56.length === 0
                  ? "Sin coincidencias — ajusta la búsqueda"
                  : `Elegir del RIT… (${faltas20.length + faltas56.length} opción${faltas20.length + faltas56.length === 1 ? "" : "es"})`}
              </option>
              {faltas20.length > 0 && (
                <optgroup label="Art. 20 — Prohibiciones (concordadas con el art. 56.1)">
                  {faltas20.map((f) => (
                    <option key={f.id} value={f.id}>20 {f.item}) {f.texto.slice(0, 90)}{f.texto.length > 90 ? "…" : ""}</option>
                  ))}
                </optgroup>
              )}
              {faltas56.length > 0 && (
                <optgroup label="Art. 56 — Causales de medida disciplinaria">
                  {faltas56.map((f) => (
                    <option key={f.id} value={f.id}>56.{f.item} {f.texto.slice(0, 90)}{f.texto.length > 90 ? "…" : ""}</option>
                  ))}
                </optgroup>
              )}
            </Select>
          </div>
        </Field>
        {falta && (
          <Note tone="neutral">
            <b>Art. {falta.articulo} {falta.articulo === 20 ? "inciso" : "numeral"} {falta.item}):</b>{" "}
            «{falta.texto}»{falta.articulo === 20 && " — se imprime concordado con el art. 56 numeral 1."}
          </Note>
        )}

        {tipo?.topeSuspension && (
          <Field label={`Días de suspensión sin goce (tope ${tipo.topeSuspension} laborables — art. 53 c)`} required>
            <Select value={suspensionDias} onChange={(e) => setSuspensionDias(+e.target.value)} style={{ maxWidth: 160 }}>
              {Array.from({ length: tipo.topeSuspension }, (_, i) => (
                <option key={i + 1} value={i + 1}>{i + 1} día{i ? "s" : ""}</option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Hechos imputados" required hint="Con fechas concretas. Se imprimen en el documento generado.">
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Describe los hechos con fechas…" />
        </Field>

        {antecedentes.length > 0 ? (
          <Note tone="pend">
            <b>Antecedentes de este trabajador ({antecedentes.length}) — se congelan en el expediente (art. 54);
            la reincidencia es agravante (art. 58):</b>
            <ul className="mt-1 list-disc pl-4">
              {antecedentes.map((a) => (
                <li key={a.id}>{a.emitido} · {a.tipo} ({a.id}) — {ESTADOS[a.estado]?.label ?? a.estado}</li>
              ))}
            </ul>
          </Note>
        ) : dni ? (
          <Note tone="neutral">Sin antecedentes disciplinarios registrados.</Note>
        ) : null}

        {tipo?.notificable && tipo?.plazoDias && tipo?.naturaleza !== "imputacion" && (
          <Note tone="neutral">
            Plazo de descargo: <b>{tipo.plazoDias} días hábiles</b> (el sábado cuenta; domingos y feriados no).
            Corre desde la notificación, no desde la emisión. {tipo.fuentePlazo === "Parámetro (RIT por modificar)" &&
            "El plazo es un parámetro del sistema mientras el RIT no lo fije."}
          </Note>
        )}

        {error && <Note tone="alerta">{error}</Note>}
        <div className="flex gap-2">
          <Button disabled={ocupado || !dni || !motivo || (faltaRequerida && !faltaId)} onClick={emitir}>
            {ocupado ? "Emitiendo…" : tipo?.notificable ? "Emitir (luego se registra la notificación)" : "Registrar amonestación verbal"}
          </Button>
          <Button variant="secondary" onClick={cerrar} disabled={ocupado}>Cancelar</Button>
        </div>
      </div>
    </Modal>
  );
}
