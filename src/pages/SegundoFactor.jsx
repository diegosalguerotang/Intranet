import { useEffect, useRef, useState } from "react";
import { MailCheck } from "lucide-react";
import { useApp } from "../state";
import { Card, Button, Field, Input, Note } from "../components/ui";

const CLAVE_DISPOSITIVO = "backoffice-dispositivo";
const ESPERA_REENVIO_S = 60;
const leerDispositivo = () => { try { return localStorage.getItem(CLAVE_DISPOSITIVO); } catch { return null; } };
const guardarDispositivo = (t) => { try { localStorage.setItem(CLAVE_DISPOSITIVO, t); } catch { /* modo privado */ } };
const borrarDispositivo = () => { try { localStorage.removeItem(CLAVE_DISPOSITIVO); } catch { /* modo privado */ } };

// Segundo factor por correo (2026-09-28): hasta verificar el código, la sesión
// del Superadministrador vale nivel 0 en la base. Esta pantalla va ANTES del
// cambio obligatorio de clave. 1) equipo recordado → sin código; 2) si no,
// pide el código y lo verifica; 3) factorVerificado() recarga la app.
export default function SegundoFactor() {
  const { user, salir, segundoFactor, factorVerificado } = useApp();
  const [fase, setFase] = useState("equipo");       // equipo · enviando · codigo · listo
  const [codigo, setCodigo] = useState("");
  const [recordar, setRecordar] = useState(true);
  const [correo, setCorreo] = useState(user?.factorCorreo ?? null);
  const [error, setError] = useState(null);
  const [intentos, setIntentos] = useState(null);
  const [agotado, setAgotado] = useState(false);     // vencido / agotado → solo «pedir uno nuevo»
  const [sinCorreo, setSinCorreo] = useState(false); // 503: no hay más vía en pantalla
  const [espera, setEspera] = useState(0);
  const [cargando, setCargando] = useState(false);
  const montado = useRef(true);
  useEffect(() => () => { montado.current = false; }, []);

  // Cuenta regresiva para reenviar.
  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  const enviar = async () => {
    setError(null); setAgotado(false); setIntentos(null); setCodigo("");
    setFase("enviando");
    const r = await segundoFactor("enviar");
    if (!montado.current) return;
    if (r.status === 200) {
      setCorreo(r.correo ?? correo); setEspera(ESPERA_REENVIO_S); setFase("codigo");
      return;
    }
    setFase("codigo");
    if (r.status === 429 && r.esperaSeg) { setEspera(r.esperaSeg); setError(r.error); return; }
    if (r.status === 503) { setSinCorreo(true); setError(r.error); return; }
    setError(r.error ?? "No se pudo enviar el código.");
  };

  // Al montar: primero el equipo recordado; si no vale, se pide el código.
  useEffect(() => {
    let vivo = true;
    (async () => {
      const token = leerDispositivo();
      if (token) {
        const r = await segundoFactor("dispositivo", { token });
        if (!vivo) return;
        if (r.status === 200 && r.listo) { setFase("listo"); await factorVerificado(); return; }
        borrarDispositivo();
      }
      if (vivo) await enviar();
    })();
    return () => { vivo = false; };
  }, []);

  const verificar = async (e) => {
    e.preventDefault();
    const limpio = codigo.replace(/\D/g, "");
    if (limpio.length !== 6) return setError("Escribe los 6 dígitos del código.");
    setError(null); setCargando(true);
    const r = await segundoFactor("verificar", { codigo: limpio, recordar });
    if (!montado.current) return;
    setCargando(false);
    if (r.status === 200 && r.listo) {
      if (r.dispositivo) guardarDispositivo(r.dispositivo);
      setFase("listo");
      await factorVerificado();
      return;
    }
    if (r.status === 400) { setIntentos(r.intentosRestantes ?? null); setError(r.error ?? "Código incorrecto."); setCodigo(""); return; }
    if (r.status === 410) {
      setAgotado(true);
      setError(r.error === "agotado" ? "Agotaste los 5 intentos de este código." : "El código venció (dura 10 minutos).");
      return;
    }
    if (r.status === 429) { setError(r.error); return; }
    setError(r.error ?? "No se pudo verificar el código.");
  };

  if (fase === "listo") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-papel text-[13px] text-gris-cl">
        Cargando el BackOffice…
      </div>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-papel px-4">
      <Card className="w-full max-w-md">
        <div className="mb-4 text-center">
          <MailCheck size={26} className="mx-auto mb-2 text-petroleo" />
          <h1 className="font-display text-[17px] font-bold text-tinta">Código de ingreso</h1>
          <p className="mt-1 text-[12.5px] leading-relaxed text-gris">
            {user?.nombre}, tu cuenta es de Superadministrador: además de la clave, cada ingreso pide un código
            {correo ? <> enviado a <b>{correo}</b></> : " enviado a tu correo"}. Vence en 10 minutos.
          </p>
        </div>
        {fase === "equipo" || fase === "enviando" ? (
          <p className="text-center text-[12.5px] text-gris-cl">{fase === "equipo" ? "Comprobando este equipo…" : "Enviando el código…"}</p>
        ) : (
          <form onSubmit={verificar} className="space-y-4">
            <Field label="Código de 6 dígitos" required>
              <Input
                inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} pattern="[0-9]*"
                value={codigo} disabled={agotado || sinCorreo || cargando}
                onChange={(e) => { setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(null); }}
                style={{ letterSpacing: 6, fontSize: 20, textAlign: "center" }}
              />
            </Field>
            {error && (
              <Note tone="alerta">
                {error}
                {intentos !== null && intentos > 0 && <> Te quedan {intentos} intento{intentos === 1 ? "" : "s"}.</>}
              </Note>
            )}
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-gris">
              <input type="checkbox" className="accent-petroleo" checked={recordar} onChange={(e) => setRecordar(e.target.checked)} />
              Recordar este equipo por 30 días
            </label>
            {!sinCorreo && !agotado && (
              <Button className="w-full" disabled={cargando || codigo.length !== 6}>
                {cargando ? "Verificando…" : "Verificar"}
              </Button>
            )}
            {!sinCorreo && (
              <Button type="button" variant="secondary" className="w-full" disabled={espera > 0 || fase === "enviando"} onClick={enviar}>
                {agotado ? "Pedir un código nuevo" : espera > 0 ? `Reenviar código (${espera} s)` : "Reenviar código"}
              </Button>
            )}
            <button type="button" onClick={() => salir()} className="w-full text-center text-[12px] text-gris-cl hover:text-tinta">
              Salir
            </button>
          </form>
        )}
      </Card>
    </main>
  );
}
