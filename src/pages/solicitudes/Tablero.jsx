import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { useApp } from "../../state";
import { PageHeader, Card, Stat, Select, Input, Note, EmptyState, Button } from "../../components/ui";

// SOL-04 — Tablero mensual del Centro de Solicitudes. Cuenta SOLICITUDES:
// jamás montos ni descuentos estimados (la planilla es la fuente de verdad).
// Un mes cerrado devuelve siempre los mismos números: todo sale de fechas
// registradas, no del estado presente de la pantalla.
const mesDe = (fechaTexto) => (fechaTexto ?? "").slice(0, 7);
const mesAnterior = (m) => {
  const [a, mm] = m.split("-").map(Number);
  return mm === 1 ? `${a - 1}-12` : `${a}-${String(mm - 1).padStart(2, "0")}`;
};
const mismoMesAnioAnterior = (m) => `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;

const horasPapeleta = (d) => {
  if (!d?.salida || !d?.retorno) return 0;
  const h = (new Date(d.retorno) - new Date(d.salida)) / 3600000;
  return h > 0 ? h : 0;
};

export default function TableroSolicitudes() {
  const { db, user, empresaId } = useApp();
  const acceso = user?.acceso ?? { esSuperadmin: user?.esSuperadmin };
  const puedeExportar = acceso.esSuperadmin || acceso.exportarDatosPersonales;
  const hoy = new Date().toISOString().slice(0, 7);
  const [mes, setMes] = useState(hoy);
  const [fSede, setFSede] = useState("");
  const [fTipo, setFTipo] = useState("");

  const base = useMemo(
    () => db.solicitudes.filter((s) => s.empresa === empresaId && (!fSede || s.sede_id === fSede) && (!fTipo || s.tipo_id === fTipo)),
    [db.solicitudes, empresaId, fSede, fTipo]
  );
  const delMes = (m) => base.filter((s) => mesDe(s.creado) === m);
  const filas = useMemo(() => delMes(mes), [base, mes]);

  const resumen = useMemo(() => {
    const porTipoEstado = {};
    const porMotivo = { Salud: 0, Particular: 0, Comisión: 0, Otros: 0 };
    let horasPermiso = 0, diasVacaciones = 0;
    const pendientes = {};
    const porSolicitante = {};
    const porSede = {};
    let resueltas = 0, horasResolucion = 0;
    const ahora = Date.now();

    for (const s of filas) {
      porTipoEstado[s.tipo] ??= {};
      porTipoEstado[s.tipo][s.estado] = (porTipoEstado[s.tipo][s.estado] ?? 0) + 1;
      if (s.tipo_id === "papeleta-permiso") {
        if (s.datos?.motivo in porMotivo) porMotivo[s.datos.motivo] += 1;
        if (s.estado === "aprobada") horasPermiso += horasPapeleta(s.datos);
      }
      if (s.tipo_id === "vacaciones" && s.estado === "aprobada") {
        diasVacaciones += Number(s.datos?.dias_gozados ?? 0);
      }
      if (s.estado === "enviada") {
        const clave = s.paso_titulo ?? "(sin paso)";
        pendientes[clave] ??= { n: 0, masAntigua: 0 };
        pendientes[clave].n += 1;
        const dias = Math.floor((ahora - new Date(s.creado_en)) / 86400000);
        pendientes[clave].masAntigua = Math.max(pendientes[clave].masAntigua, dias);
      }
      if (s.resuelto_en) {
        resueltas += 1;
        horasResolucion += (new Date(s.resuelto_en) - new Date(s.creado_en)) / 3600000;
      }
      porSolicitante[s.solicitante_nombre] = (porSolicitante[s.solicitante_nombre] ?? 0) + 1;
      const sede = s.sede_nombre ?? "(sin sede)";
      porSede[sede] = (porSede[sede] ?? 0) + 1;
    }
    return {
      porTipoEstado, porMotivo, horasPermiso, diasVacaciones, pendientes,
      promedioResolucionHoras: resueltas ? horasResolucion / resueltas : null,
      topSolicitantes: Object.entries(porSolicitante).sort((a, b) => b[1] - a[1]).slice(0, 5),
      porSede: Object.entries(porSede).sort((a, b) => b[1] - a[1]),
    };
  }, [filas]);

  const totalMes = filas.length;
  const totalAnterior = delMes(mesAnterior(mes)).length;
  const totalAnioPasado = delMes(mismoMesAnioAnterior(mes)).length;

  const exportar = () => {
    const enc = ["Número", "Fecha", "Solicitante", "DNI", "Tipo", "Sede", "Estado", "Datos"];
    const csv = [enc, ...filas.map((s) => [s.numero, s.creado, s.solicitante_nombre, s.solicitante_dni,
      s.tipo, s.sede_nombre ?? "", s.estado, JSON.stringify(s.datos)])]
      .map((f) => f.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const el = Object.assign(document.createElement("a"), { href: url, download: `solicitudes-${empresaId}-${mes}.csv` });
    el.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        code="SOL-04 · Tablero mensual"
        title="Tablero de solicitudes"
        subtitle="Cuenta solicitudes; no calcula planilla ni muestra descuentos. Cualquier mes cerrado se puede consultar y da siempre lo mismo."
        actions={
          puedeExportar && totalMes > 0 && (
            <Button variant="secondary" size="sm" onClick={exportar}><Download size={13} /> Exportar</Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-2.5">
        <Input type="month" value={mes} onChange={(e) => setMes(e.target.value)} style={{ maxWidth: 170 }} />
        <Select value={fTipo} onChange={(e) => setFTipo(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">Todos los tipos</option>
          {db.solicitudTipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
        </Select>
        <Select value={fSede} onChange={(e) => setFSede(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">Todas las sedes</option>
          {db.sedes.filter((s) => s.empresa === empresaId).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </Select>
      </div>

      <div className="mb-5 flex flex-wrap gap-4">
        <Stat label={`Solicitudes de ${mes}`} value={totalMes} />
        <Stat label={`Mes anterior (${mesAnterior(mes)})`} value={totalAnterior}
          hint={totalAnterior ? `${totalMes >= totalAnterior ? "+" : ""}${totalMes - totalAnterior} vs. este mes` : undefined} />
        <Stat label={`Mismo mes ${mes.slice(0, 4) - 1}`} value={totalAnioPasado} />
        <Stat label="Horas de permiso aprobadas" value={resumen.horasPermiso.toFixed(1)} />
        <Stat label="Días de vacaciones aprobados" value={resumen.diasVacaciones} tone="conf" />
      </div>

      {totalMes === 0 ? (
        <EmptyState title="Sin solicitudes en el periodo" body="Cambia el mes o los filtros." />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <h2 className="mb-2 font-display text-[15px] font-semibold text-tinta">Por tipo y estado</h2>
            {Object.entries(resumen.porTipoEstado).map(([tipo, estados]) => (
              <div key={tipo} className="mb-2">
                <div className="text-[13px] font-semibold text-tinta">{tipo}</div>
                <div className="text-[12.5px] text-gris">
                  {Object.entries(estados).map(([e, n]) => `${e}: ${n}`).join(" · ")}
                </div>
              </div>
            ))}
            {(!fTipo || fTipo === "papeleta-permiso") && (
              <>
                <h2 className="mb-1 mt-4 font-display text-[15px] font-semibold text-tinta">Papeletas por motivo</h2>
                <div className="text-[12.5px] text-gris">
                  {Object.entries(resumen.porMotivo).map(([m, n]) => `${m}: ${n}`).join(" · ")}
                </div>
                <div className="mt-1 text-[11px] text-gris-cl">
                  El corte que conecta con los descuentos de planilla; el descuento lo informa RRHH con la planilla.
                </div>
              </>
            )}
          </Card>

          <Card>
            <h2 className="mb-2 font-display text-[15px] font-semibold text-tinta">Pendientes por aprobador</h2>
            {Object.keys(resumen.pendientes).length === 0 ? (
              <Note tone="conf">No hay solicitudes esperando V°B° en el periodo.</Note>
            ) : (
              Object.entries(resumen.pendientes).map(([paso, d]) => (
                <div key={paso} className="mb-1.5 flex items-center justify-between text-[13px]">
                  <span>{paso}</span>
                  <span className="font-semibold">{d.n} <span className="font-normal text-gris">(la más antigua: {d.masAntigua} día(s))</span></span>
                </div>
              ))
            )}
            {resumen.promedioResolucionHoras !== null && (
              <div className="mt-3 text-[12.5px] text-gris">
                Tiempo promedio del envío a la resolución: <b>{resumen.promedioResolucionHoras.toFixed(1)} h</b>
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-2 font-display text-[15px] font-semibold text-tinta">Trabajadores con más solicitudes</h2>
            {resumen.topSolicitantes.map(([nombre, n]) => (
              <div key={nombre} className="mb-1 flex items-center justify-between text-[13px]">
                <span>{nombre}</span><span className="font-semibold">{n}</span>
              </div>
            ))}
          </Card>

          <Card>
            <h2 className="mb-2 font-display text-[15px] font-semibold text-tinta">Distribución por sede</h2>
            {resumen.porSede.map(([sede, n]) => (
              <div key={sede} className="mb-1 flex items-center justify-between text-[13px]">
                <span>{sede}</span><span className="font-semibold">{n}</span>
              </div>
            ))}
          </Card>
        </div>
      )}
    </>
  );
}
