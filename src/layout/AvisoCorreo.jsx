import { useState } from "react";
import { MailWarning } from "lucide-react";
import { useApp } from "../state";
import { Modal, Table, Td, Button } from "../components/ui";
import { etiquetaAccion, resumenFallos, formatearHora } from "../lib/correoFallos";

// Franja para superadministradores (2026-09-30): envíos de correo con error en
// las últimas 24 h (correo_fallos_recientes). Desaparece sola cuando no hay
// fallos recientes; no hay «marcar como visto».
export default function AvisoCorreo() {
  const { correoFallos, recargarCorreoFallos } = useApp();
  const [abierto, setAbierto] = useState(false);
  const [actualizando, setActualizando] = useState(false);
  const resumen = resumenFallos(correoFallos);
  if (!resumen) return null;
  const actualizar = async () => { setActualizando(true); await recargarCorreoFallos(); setActualizando(false); };
  return (
    <>
      <div role="alert" className="flex items-center gap-3 border-b border-borde-f bg-[#fff8ee] px-5 py-2 text-[13px] text-tinta">
        <MailWarning size={15} className="text-pend" />
        <span>{resumen}.</span>
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="rounded-caja border border-borde-f bg-white px-2.5 py-1 font-semibold text-petroleo hover:bg-[#f3f7fb]"
        >
          Ver detalle
        </button>
      </div>
      <Modal open={abierto} onClose={() => setAbierto(false)} title="Correos que no se pudieron enviar" wide>
        <p className="mb-3 text-[13px] text-gris">
          Últimas 24 horas. El error es la respuesta literal del proveedor (Resend); si se repite, revisa la llave y el dominio en resend.com.
        </p>
        <Table head={["Hora", "Tipo de correo", "Destinatario", "Error"]}>
          {correoFallos.map((f) => (
            <tr key={f.id}>
              <Td className="font-mono text-[12px]">{formatearHora(f.creado_en)}</Td>
              <Td>{etiquetaAccion(f.accion)}</Td>
              <Td>{f.destinatario ?? "—"}</Td>
              <Td className="text-[12px]">{f.detalle ?? "—"}</Td>
            </tr>
          ))}
        </Table>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={actualizar} disabled={actualizando}>
            {actualizando ? "Actualizando…" : "Actualizar"}
          </Button>
          <Button onClick={() => setAbierto(false)}>Cerrar</Button>
        </div>
      </Modal>
    </>
  );
}
