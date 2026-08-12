import { useState } from "react";
import { Download } from "lucide-react";
import { useApp } from "../../state";
import { PageHeader, Card, Stat, Table, Td, Badge, Button, Input, Select, Note, EmptyState } from "../../components/ui";

const TONO_RESULTADO = { exitoso: "conf", fallido: "pend", bloqueado: "alerta" };

export default function RegistroAccesos() {
  const { db } = useApp();
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [busca, setBusca] = useState("");
  const [fResultado, setFResultado] = useState("");
  const [fSuperficie, setFSuperficie] = useState("");
  const [fEmpresa, setFEmpresa] = useState("");

  const filtrados = db.registroAccesos.filter((r) => {
    const dia = r.fecha.slice(0, 10);
    if (desde && dia < desde) return false;
    if (hasta && dia > hasta) return false;
    if (busca && !r.usuario.toLowerCase().includes(busca.trim().toLowerCase())) return false;
    if (fResultado && r.resultado !== fResultado) return false;
    if (fSuperficie && r.superficie !== fSuperficie) return false;
    if (fEmpresa && r.empresa !== fEmpresa) return false;
    return true;
  });

  const exportar = () => {
    const head = ["Fecha (servidor)", "Usuario", "Perfil vigente", "Superficie", "Resultado", "IP", "Dispositivo"];
    const rows = filtrados.map((r) => [r.fecha, r.usuario, r.perfil, r.superficie, r.resultado, r.ip ?? "", r.dispositivo ?? ""]);
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = "registro-accesos.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <PageHeader
        code="ACC-06"
        title="Registro de accesos"
        subtitle="Quién ingresó, cuándo, desde dónde y qué intentos fallaron — en el Portal y en el BackOffice."
        actions={<Button variant="secondary" onClick={exportar}><Download size={14} /> Exportar</Button>}
      />

      <div className="mb-5 flex flex-wrap gap-3">
        <Stat label="Ingresos del periodo" value={filtrados.filter((r) => r.resultado === "exitoso").length} tone="conf" />
        <Stat label="Intentos fallidos" value={filtrados.filter((r) => r.resultado === "fallido").length} tone="pend" />
        <Stat label="Cuentas bloqueadas" value={filtrados.filter((r) => r.resultado === "bloqueado").length} tone="alerta" />
        <Stat label="Nunca ingresaron" value={db.usuariosAdmin.filter((u) => u.nuncaIngreso).length} hint="Usuarios administrativos con clave sin estrenar." />
      </div>

      <Card className="mb-5">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} title="Desde" />
          <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} title="Hasta" />
          <Input placeholder="Usuario…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <Select value={fResultado} onChange={(e) => setFResultado(e.target.value)}>
            <option value="">Todo resultado</option>
            <option value="exitoso">Exitoso</option>
            <option value="fallido">Fallido</option>
            <option value="bloqueado">Bloqueado</option>
          </Select>
          <Select value={fSuperficie} onChange={(e) => setFSuperficie(e.target.value)}>
            <option value="">Ambas superficies</option>
            <option value="backoffice">BackOffice</option>
            <option value="portal">Portal</option>
          </Select>
          <Select value={fEmpresa} onChange={(e) => setFEmpresa(e.target.value)}>
            <option value="">Todas las razones sociales</option>
            {db.empresas.map((e) => <option key={e.id} value={e.id}>{e.corto}</option>)}
          </Select>
        </div>
      </Card>

      <Card pad={false}>
        {filtrados.length === 0 ? (
          <EmptyState title="Sin registros" body="No hay ingresos que coincidan con los filtros." />
        ) : (
          <Table head={["Fecha (servidor)", "Usuario", "Perfil vigente en ese momento", "Superficie", "Resultado", "IP", "Dispositivo"]}>
            {filtrados.map((r) => (
              <tr key={r.id} className="hover:bg-papel/60">
                <Td className="whitespace-nowrap font-mono text-[12px]">{r.fecha}</Td>
                <Td className="font-semibold text-tinta">{r.usuario}</Td>
                <Td>{r.perfil}</Td>
                <Td>{r.superficie === "backoffice" ? <Badge tone="tinta">BackOffice</Badge> : <Badge tone="neutral">Portal</Badge>}</Td>
                <Td><Badge tone={TONO_RESULTADO[r.resultado]}>{r.resultado}</Badge></Td>
                <Td className="font-mono text-[12px]">{r.ip ?? "—"}</Td>
                <Td className="text-[12px]">{r.dispositivo ?? "—"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div className="mt-4">
        <Note tone="neutral">
          Registro de <b>solo lectura para todos los roles sin excepción</b>, incluido el superadministrador: no
          existe interfaz de borrado. La columna de perfil muestra la versión vigente al momento del ingreso, no la
          actual. Es un corte especializado del registro general de auditoría; ambos leen la misma fuente.
        </Note>
      </div>
    </>
  );
}
