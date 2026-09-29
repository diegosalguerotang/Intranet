import { useMemo, useState } from "react";
import { MailCheck, UserPlus, X } from "lucide-react";
import { useApp } from "../../state";
import {
  PageHeader, Card, Stat, Table, Td, Badge, Button, Modal, Field, Input, Select, Note,
} from "../../components/ui";
import { normalizarGrupo, normalizarCorreoLicencia, correoValido, sugerirPersona } from "../../lib/licencias";

// ADQ-09 — Licencias Office (2026-09-29). Buzones de grupo de Microsoft 365
// (tenant PROMANTSERV): cada trabajador dentro de un grupo es una licencia.
// Paga PROMANT; los usuarios son de las tres razones sociales. Los nombres que
// no estaban en el padrón al cargar quedan «por afiliar» y se enlazan aquí.
const ESTADOS = [["activa", "Activa"], ["suspendida", "Suspendida"], ["baja", "De baja"]];
const tonoEstado = (e) => (e === "activa" ? "conf" : e === "suspendida" ? "pend" : "neutral");
const etiqueta = (e) => ESTADOS.find(([v]) => v === e)?.[1] ?? e;

export default function LicenciasOffice() {
  const { db, empresaPor, guardarLicenciaOffice, afiliarLicenciaOffice, desafiliarLicenciaOffice } = useApp();
  const [nuevo, setNuevo] = useState(false);
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const GRUPOS = db.licenciasOffice ?? [];
  // Padrón vigente, ordenado: es la lista de los selectores de afiliación.
  const padron = useMemo(
    () => (db.personal ?? []).filter((p) => p.estado === "vigente").slice().sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [db.personal],
  );
  const activos = GRUPOS.filter((g) => g.estado === "activa");
  const licencias = activos.reduce((s, g) => s + (g.cantidad ?? 0), 0);
  const porAfiliar = GRUPOS.reduce((s, g) => s + (g.porAfiliar ?? 0), 0);

  // Toda escritura pasa por aquí: un solo aviso de error, un solo candado.
  const correr = async (fn) => {
    setError(null); setOcupado(true);
    try { const r = await fn(); if (r?.error) setError(r.error); return r; }
    finally { setOcupado(false); }
  };

  return (
    <>
      <PageHeader
        code="ADQ-09 · Licencias Office"
        title="Licencias Office"
        subtitle="Buzones de grupo de Microsoft 365 pagados por PROMANT. Cada trabajador dentro de un grupo es una licencia; los nombres sin DNI quedan por afiliar hasta que existan en el padrón."
        actions={<Button size="sm" onClick={() => setNuevo(true)}><MailCheck size={13} /> Nuevo grupo</Button>}
      />

      <div className="mb-5 flex flex-wrap gap-4">
        <Stat label="Grupos activos" value={activos.length} hint={`${GRUPOS.length} en total`} />
        <Stat label="Licencias" value={licencias} hint="Personas en grupos activos" />
        <Stat label="Por afiliar" value={porAfiliar} tone={porAfiliar ? "pend" : "conf"} hint="Nombres sin DNI del padrón" />
      </div>

      {error && <div className="mb-4"><Note tone="alerta">{error}</Note></div>}

      <Card pad={false}>
        <Table head={["Grupo", "Correo del buzón", "Trabajadores", "Cantidad", "Estado"]}>
          {GRUPOS.map((g) => (
            <FilaGrupo
              key={g.id} grupo={g} padron={padron} empresaPor={empresaPor} ocupado={ocupado}
              onEstado={(estado) => correr(() => guardarLicenciaOffice({ id: g.id, grupo: g.grupo, correo: g.correo, estado }))}
              onAfiliar={(datos) => correr(() => afiliarLicenciaOffice(g.id, datos))}
              onDesafiliar={(filaId) => correr(() => desafiliarLicenciaOffice(filaId))}
            />
          ))}
          {!GRUPOS.length && (
            <tr><Td className="py-8 text-center text-gris-cl" colSpan={5}>Aún no hay grupos registrados.</Td></tr>
          )}
        </Table>
      </Card>

      <NuevoGrupo
        open={nuevo}
        onClose={() => setNuevo(false)}
        padron={padron}
        ocupado={ocupado}
        onGuardar={async ({ grupo, correo, dnis }) => {
          const r = await correr(async () => {
            const g = await guardarLicenciaOffice({ grupo, correo });
            if (g.error || !g.data) return g;
            for (const dni of dnis) {
              const a = await afiliarLicenciaOffice(g.data, { dni });
              if (a.error) return { error: `Grupo creado, pero no se pudo afiliar a ${dni}: ${a.error}` };
            }
            return { error: null };
          });
          if (!r?.error) setNuevo(false);
        }}
      />
    </>
  );
}

function FilaGrupo({ grupo: g, padron, empresaPor, ocupado, onEstado, onAfiliar, onDesafiliar }) {
  const [agregando, setAgregando] = useState(false);
  const [dniNuevo, setDniNuevo] = useState("");
  const personas = g.personas ?? [];
  const dnisDelGrupo = personas.filter((p) => p.dni).map((p) => p.dni);
  const disponibles = padron.filter((p) => !dnisDelGrupo.includes(p.dni));

  return (
    <tr className="align-top hover:bg-papel/60">
      <Td className="font-semibold">{g.grupo}</Td>
      <Td className="font-mono text-[11.5px] text-gris">{g.correo}</Td>
      <Td>
        <div className="flex flex-col gap-1.5">
          {personas.map((p) => p.afiliado ? (
            <span key={p.id} className="inline-flex items-center gap-1.5 text-[12.5px]">
              <span className="text-tinta">{p.nombre}</span>
              {p.empresa && <span className="text-[11px] text-gris-cl">· {empresaPor(p.empresa)?.corto ?? p.empresa}</span>}
              <button
                type="button" title="Desafiliar" disabled={ocupado}
                onClick={() => onDesafiliar(p.id)}
                className="rounded p-0.5 text-gris-cl hover:bg-papel hover:text-alerta disabled:opacity-50"
              >
                <X size={12} />
              </button>
            </span>
          ) : (
            <PorAfiliar key={p.id} fila={p} candidatos={disponibles} ocupado={ocupado}
              onAfiliar={(dni) => onAfiliar({ dni, fila: p.id })} />
          ))}
          {agregando ? (
            <div className="flex items-center gap-1.5">
              <Select value={dniNuevo} onChange={(e) => setDniNuevo(e.target.value)} className="text-[12px]">
                <option value="">Elige del padrón…</option>
                {disponibles.map((p) => <option key={p.dni} value={p.dni}>{p.nombre} — {p.dni}</option>)}
              </Select>
              <Button size="sm" disabled={!dniNuevo || ocupado}
                onClick={async () => { await onAfiliar({ dni: dniNuevo }); setDniNuevo(""); setAgregando(false); }}>
                Afiliar
              </Button>
              <button type="button" className="text-[12px] text-gris-cl hover:text-tinta" onClick={() => { setAgregando(false); setDniNuevo(""); }}>Cancelar</button>
            </div>
          ) : (
            <button type="button" disabled={ocupado} onClick={() => setAgregando(true)}
              className="inline-flex w-fit items-center gap-1 text-[12px] text-petroleo hover:underline disabled:opacity-50">
              <UserPlus size={12} /> Afiliar
            </button>
          )}
        </div>
      </Td>
      <Td className="font-mono text-[12px]">{g.cantidad}</Td>
      <Td>
        <div className="flex items-center gap-2">
          <Badge tone={tonoEstado(g.estado)}>{etiqueta(g.estado)}</Badge>
          {/* Estado editable aquí mismo, como «RS Uso» en líneas. */}
          <select
            value={g.estado} disabled={ocupado}
            onChange={(e) => onEstado(e.target.value)}
            className="rounded border border-borde bg-white px-1.5 py-1 text-[12px] text-tinta"
          >
            {ESTADOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </div>
      </Td>
    </tr>
  );
}

// Nombre de la fuente sin DNI: selector del padrón con la sugerencia
// preseleccionada cuando la coincidencia por nombre es única.
function PorAfiliar({ fila, candidatos, ocupado, onAfiliar }) {
  const sugerido = useMemo(() => sugerirPersona(fila.nombre, candidatos), [fila.nombre, candidatos]);
  const [dni, setDni] = useState(sugerido?.dni ?? "");
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone="pend">Por afiliar</Badge>
      <span className="text-[12.5px] text-gris">{fila.nombre}</span>
      <Select value={dni} onChange={(e) => setDni(e.target.value)} className="text-[12px]">
        <option value="">{sugerido ? "Sugerencia del padrón…" : "Elige del padrón…"}</option>
        {candidatos.map((p) => <option key={p.dni} value={p.dni}>{p.nombre} — {p.dni}</option>)}
      </Select>
      <Button size="sm" variant="secondary" disabled={!dni || ocupado} onClick={() => onAfiliar(dni)}>Afiliar</Button>
    </div>
  );
}

function NuevoGrupo({ open, onClose, padron, ocupado, onGuardar }) {
  const vacio = { grupo: "", correo: "", filtro: "", dnis: [] };
  const [form, setForm] = useState(vacio);
  const [aviso, setAviso] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const filtro = form.filtro.trim().toLowerCase();
  const lista = (filtro ? padron.filter((p) => `${p.nombre} ${p.dni}`.toLowerCase().includes(filtro)) : padron).slice(0, 12);
  const alternar = (dni) => setForm((f) => ({ ...f, dnis: f.dnis.includes(dni) ? f.dnis.filter((d) => d !== dni) : [...f.dnis, dni] }));

  const guardar = async (e) => {
    e.preventDefault();
    const grupo = normalizarGrupo(form.grupo);
    const correo = normalizarCorreoLicencia(form.correo);
    if (grupo.length < 2) return setAviso("El grupo necesita al menos 2 caracteres.");
    if (!correoValido(correo)) return setAviso("Escribe el correo del buzón (usuario@dominio).");
    setAviso(null);
    await onGuardar({ grupo, correo, dnis: form.dnis });
    setForm(vacio);
  };

  return (
    <Modal open={open} onClose={onClose} title="ADQ-09 · Nuevo grupo">
      <form onSubmit={guardar} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Grupo" required hint="Se guarda en mayúsculas.">
            <Input placeholder="Ej. LOGISTICA_03" value={form.grupo} onChange={set("grupo")} />
          </Field>
          <Field label="Correo del buzón" required>
            <Input placeholder="grupo@promantserv.onmicrosoft.com" value={form.correo} onChange={set("correo")} />
          </Field>
        </div>
        <Field label="Trabajadores" hint={`${form.dnis.length} seleccionado${form.dnis.length === 1 ? "" : "s"}. Puedes afiliar más después desde la tabla.`}>
          <Input placeholder="Buscar en el padrón vigente…" value={form.filtro} onChange={set("filtro")} />
          <div className="mt-2 max-h-48 space-y-1 overflow-auto rounded border border-borde p-2">
            {lista.map((p) => (
              <label key={p.dni} className="flex cursor-pointer items-center gap-2 text-[12.5px] text-gris">
                <input type="checkbox" className="accent-petroleo" checked={form.dnis.includes(p.dni)} onChange={() => alternar(p.dni)} />
                <span className="text-tinta">{p.nombre}</span> <span className="text-gris-cl">{p.dni}</span>
              </label>
            ))}
            {!lista.length && <p className="text-[12px] text-gris-cl">Sin coincidencias.</p>}
          </div>
        </Field>
        {aviso && <Note tone="alerta">{aviso}</Note>}
        <Button type="submit" disabled={ocupado}>{ocupado ? "Guardando…" : "Guardar"}</Button>
      </form>
    </Modal>
  );
}
