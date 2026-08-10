import { useState } from "react";
import { Link } from "react-router-dom";
import { FileUp, CheckCircle2 } from "lucide-react";
import { useApp } from "../../state";
import {
  PageHeader, Card, Button, Field, Select, Note, Badge, Table, Td, Progress,
} from "../../components/ui";

const PASOS = ["Periodo y tipo", "Carga del archivo", "Excepciones", "Revisión", "Publicado"];

const EXCEPCIONES_DEMO = [
  { pagina: 41, dni: "4?2318?6", problema: "DNI ilegible", resuelto: false },
  { pagina: 187, dni: "39876120", problema: "DNI no corresponde a personal activo (cesado en junio)", resuelto: false },
  { pagina: "220–221", dni: "40987654", problema: "Dos páginas consecutivas con el mismo DNI", resuelto: false },
];

export default function Boletas() {
  const { db, empresaId, empresaPor, addLote, user } = useApp();
  const [paso, setPaso] = useState(0);
  const [empresaLote, setEmpresaLote] = useState(empresaId);
  const [tipo, setTipo] = useState("Boleta de pago");
  const [periodo, setPeriodo] = useState("Agosto 2026");
  const [procesando, setProcesando] = useState(false);
  const [excepciones, setExcepciones] = useState(EXCEPCIONES_DEMO);
  const [loteCreado, setLoteCreado] = useState(null);

  const emp = empresaPor(empresaLote);
  const loteExistente = db.lotes.find(
    (l) => l.empresa === empresaLote && l.tipo === tipo && l.periodo === periodo
  );
  const sinResolver = excepciones.filter((x) => !x.resuelto).length;

  const resolver = (i, accion) =>
    setExcepciones((xs) => xs.map((x, j) => (j === i ? { ...x, resuelto: true, accion } : x)));

  const procesar = () => {
    setProcesando(true);
    setTimeout(() => { setProcesando(false); setPaso(2); }, 1400);
  };

  const publicar = () => {
    const codigoTipo = { "Boleta de pago": "BOL", "Gratificación": "GRA", "Liquidación de CTS": "CTS", "Utilidades": "UTI" }[tipo] ?? "DOC";
    const codigoEmp = (emp?.corto ?? "EMP").slice(0, 3).toUpperCase();
    const [mes, anio] = periodo.split(" ");
    const meses = { Enero: "01", Febrero: "02", Marzo: "03", Abril: "04", Mayo: "05", Junio: "06", Julio: "07", Agosto: "08", Septiembre: "09", Octubre: "10", Noviembre: "11", Diciembre: "12" };
    const correlativo = db.lotes.filter((l) => l.empresa === empresaLote && l.tipo === tipo && l.periodo === periodo).length + 1;
    const lote = {
      id: `${codigoTipo}-${codigoEmp}-${anio}${meses[mes] ?? "00"}-${String(correlativo).padStart(3, "0")}`,
      empresa: empresaLote, tipo, periodo,
      publicado: new Date().toISOString().slice(0, 16).replace("T", " "),
      por: user?.nombre ?? "RRHH",
      total: 310, confirmados: 0, asistidos: 0, pendientes: 310, avisos: 299,
      version: loteExistente ? (loteExistente.version ?? 1) + 1 : 1,
    };
    addLote(lote);
    setLoteCreado(lote);
    setPaso(4);
  };

  const reiniciar = () => { setPaso(0); setExcepciones(EXCEPCIONES_DEMO); setLoteCreado(null); };

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
                {db.empresas.map((e) => (
                  <option key={e.id} value={e.id}>{e.nombre} — RUC {e.ruc}</option>
                ))}
              </Select>
            </Field>
            <Field label="Tipo de documento" required>
              <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                <option>Boleta de pago</option>
                <option>Gratificación</option>
                <option>Liquidación de CTS</option>
                <option>Utilidades</option>
              </Select>
            </Field>
            <Field label="Periodo" required>
              <Select value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
                <option>Agosto 2026</option>
                <option>Julio 2026</option>
                <option>Junio 2026</option>
              </Select>
            </Field>
            {loteExistente && (
              <Note tone="pend">
                Ya existe el lote <b>{loteExistente.id}</b> publicado para esta combinación. Continuar cargará una{" "}
                <b>corrección de versión</b>: los documentos corregidos generarán versión {(loteExistente.version ?? 1) + 1}{" "}
                con acuse nuevo, sin tocar ningún acuse existente. Nunca se sobrescribe en silencio.
              </Note>
            )}
            <Button onClick={() => setPaso(1)}>
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
            <div
              className={`rounded-md border-2 border-dashed px-6 py-12 text-center transition-colors ${
                procesando ? "border-petroleo bg-conf-bg/40" : "cursor-pointer border-borde-f bg-papel/60 hover:border-petroleo-cl"
              }`}
              onClick={!procesando ? procesar : undefined}
            >
              <FileUp size={26} className="mx-auto mb-2 text-gris" />
              {procesando ? (
                <>
                  <div className="text-[14px] font-semibold text-tinta-2">Procesando en segundo plano…</div>
                  <div className="mx-auto mt-3 max-w-[240px]"><Progress value={64} tone="petroleo" /></div>
                  <div className="mt-2 font-mono text-[11px] text-gris">Leyendo el DNI de cada página</div>
                </>
              ) : (
                <>
                  <div className="text-[14px] font-semibold text-tinta-2">Arrastra el PDF consolidado del periodo</div>
                  <div className="mt-1 text-[12px] text-gris">
                    Un único PDF por lote (máx. 200 MB). La separación se hace leyendo el número de DNI en cada página,
                    nunca por posición.
                  </div>
                  <div className="mt-3 font-mono text-[11px] text-petroleo">(clic para simular la carga)</div>
                </>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setPaso(0)} disabled={procesando}>Atrás</Button>
            </div>
          </div>
        </Card>
      )}

      {/* Paso 3 — RRH-08 */}
      {paso === 2 && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4">
            {[["Páginas leídas", 318], ["Boletas identificadas", 309], ["Requieren revisión", excepciones.length]].map(([k, v]) => (
              <Card key={k} className="flex-1 min-w-[150px]">
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-gris">{k}</div>
                <div className="mt-1 text-[24px] font-bold text-tinta">{v}</div>
              </Card>
            ))}
          </div>
          <Card pad={false}>
            <Table head={["Página", "DNI leído", "Problema", "Acción"]}>
              {excepciones.map((x, i) => (
                <tr key={i} className={x.resuelto ? "opacity-50" : ""}>
                  <Td className="font-mono text-[12px]">{x.pagina}</Td>
                  <Td className="font-mono text-[12px]">{x.dni}</Td>
                  <Td className="text-gris">{x.problema}</Td>
                  <Td>
                    {x.resuelto ? (
                      <Badge tone="conf">{x.accion}</Badge>
                    ) : (
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => resolver(i, "Asignada manualmente")}>Asignar</Button>
                        <Button size="sm" variant="secondary" onClick={() => resolver(i, "Excluida del lote")}>Excluir</Button>
                        {String(x.pagina).includes("–") && (
                          <Button size="sm" variant="secondary" onClick={() => resolver(i, "Agrupada (2 hojas)")}>Agrupar</Button>
                        )}
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
          <Note tone={sinResolver ? "pend" : "conf"}>
            {sinResolver
              ? `${sinResolver} excepciones sin resolver. Ninguna se descarta automáticamente: o se asigna a un trabajador, o se excluye del lote de forma explícita. Ningún documento se publica sin trabajador identificado.`
              : "Todas las excepciones fueron resueltas. Puedes continuar a la revisión final."}
          </Note>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setPaso(1)}>Atrás</Button>
            <Button onClick={() => setPaso(3)}>Continuar</Button>
          </div>
        </div>
      )}

      {/* Paso 4 — RRH-09 */}
      {paso === 3 && (
        <Card className="max-w-2xl">
          <h2 className="mb-4 text-[15px] font-bold text-tinta">Revisión previa a la publicación</h2>
          <div className="mb-4 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
            {[
              ["Empresa", emp?.corto],
              ["Tipo", tipo],
              ["Periodo", periodo],
              ["A publicar", "310 boletas"],
              ["Excepciones sin resolver", String(sinResolver)],
              ["Sin celular (acuse asistido)", "11"],
            ].map(([k, v]) => (
              <div key={k}>
                <div className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-gris">{k}</div>
                <div className="mt-0.5 text-[13.5px] font-semibold text-tinta">{v}</div>
              </div>
            ))}
          </div>
          <div className="space-y-2.5">
            <Note tone="neutral">
              Al publicar: se calculará el hash SHA-256 de cada archivo, los documentos quedarán visibles en el portal de
              cada trabajador y se enviarán <b>299 avisos</b> por WhatsApp respetando la ventana horaria.
            </Note>
            <Note tone="alerta">
              <b>Publicar es irreversible.</b> El documento queda visible para el trabajador y cualquier corrección
              posterior generará una versión nueva con acuse nuevo.
            </Note>
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={() => setPaso(2)}>Atrás</Button>
            <Button onClick={publicar}>Publicar</Button>
          </div>
        </Card>
      )}

      {/* Paso 5 — RRH-10 */}
      {paso === 4 && loteCreado && (
        <Card className="max-w-2xl">
          <div className="mb-4 flex items-center gap-3">
            <CheckCircle2 size={26} className="text-conf" />
            <div>
              <h2 className="text-[15px] font-bold text-tinta">Publicación confirmada</h2>
              <div className="font-mono text-[12px] text-gris">Lote {loteCreado.id} · registrado en auditoría</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[["Publicadas", "310"], ["Avisos WhatsApp", "299"], ["Acuse asistido", "11"], ["Versión", `v${loteCreado.version}`]].map(([k, v]) => (
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
              <Table head={["Lote", "Tipo", "Periodo", "Recepción"]}>
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
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
