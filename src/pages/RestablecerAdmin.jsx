import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, Eye, EyeOff } from "lucide-react";
import { Card, Button, Field, Input, Note } from "../components/ui";
import { supabase } from "../lib/supabase";
import { validarClave } from "../lib/campos";

// Aterrizaje de los enlaces de acceso del BackOffice. Dos modos:
//  · Correo NATIVO de Supabase (invitación al crear el usuario, o
//    recuperación): el enlace trae la sesión en el hash de la URL — el
//    cliente la detecta y la clave nueva se guarda con updateUser.
//  · Token del motor propio (?token=): flujo del webhook, se conserva.
function CampoClave({ ver, setVer, ...props }) {
  return (
    <div className="relative">
      <Input type={ver ? "text" : "password"} style={{ paddingRight: 38 }} {...props} />
      <button
        type="button" onClick={() => setVer((v) => !v)}
        aria-label={ver ? "Ocultar clave" : "Mostrar clave"}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-gris-cl hover:text-tinta"
      >
        {ver ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}

export default function RestablecerAdmin() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [sesionSupabase, setSesionSupabase] = useState(null);
  const [clave, setClave] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [ver1, setVer1] = useState(false);
  const [ver2, setVer2] = useState(false);
  const [error, setError] = useState(null);
  const [listo, setListo] = useState(false);
  const [cargando, setCargando] = useState(false);

  // Los enlaces nativos de Supabase llegan con la sesión en el hash; el
  // cliente la procesa solo, aquí basta escucharla. Si la sesión MUERE con el
  // formulario abierto (otro login la expulsó, venció), hay que enterarse:
  // dejar el formulario visible producía un «No se pudo guardar» sin salida.
  const [sesionPerdida, setSesionPerdida] = useState(false);
  useEffect(() => {
    if (token || !supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session) setSesionSupabase(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((evento, sesion) => {
      if (sesion) { setSesionSupabase(sesion); setSesionPerdida(false); }
      else if (evento === "SIGNED_OUT") { setSesionSupabase(null); setSesionPerdida(true); }
    });
    return () => sub?.subscription?.unsubscribe();
  }, [token]);

  const guardar = async (e) => {
    e.preventDefault();
    const errClave = validarClave(clave, 6);
    if (errClave) return setError(errClave);
    if (clave !== confirmar) return setError("Las claves no coinciden.");
    setError(null);
    setCargando(true);
    try {
      if (sesionSupabase) {
        // Modo nativo: la clave se guarda sobre la sesión del enlace.
        const { error: err } = await supabase.auth.updateUser({ password: clave });
        if (err) {
          setError(/different from the old/i.test(err.message)
            ? "La clave nueva debe ser distinta a la anterior."
            : /session|jwt|token|expired|missing/i.test(err.message ?? "")
              ? "Tu enlace ya no está activo (venció, ya se usó, o tu cuenta ingresó desde otro lado y cerró esta sesión). Pide un enlace nuevo desde «Olvidé mi clave» en el login."
              : `No se pudo guardar la clave: ${err.message}`);
          return;
        }
        const correoSesion = sesionSupabase.user?.email;
        if (correoSesion) {
          await supabase.rpc("marcar_clave_cambiada", { p_correo: correoSesion }).catch?.(() => {});
        }
        setListo(true);
        return;
      }
      // Modo token del motor propio.
      const r = await fetch(`${window.location.origin}/api/restablecer-clave`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, clave }),
      });
      const json = await r.json().catch(() => null);
      if (!r.ok) { setError(json?.error ?? `Error ${r.status}`); return; }
      setListo(true);
    } catch {
      setError("No se pudo guardar. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setCargando(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-papel px-4">
      <Card className="w-full max-w-md">
        <div className="mb-4 text-center">
          <ShieldCheck size={26} className="mx-auto mb-2 text-petroleo" />
          <h1 className="font-display text-[17px] font-bold text-tinta">
            {listo ? "¡Clave guardada!" : "Crea tu clave nueva"}
          </h1>
        </div>
        {listo ? (
          <div className="space-y-4 text-center">
            <Note tone="conf">Ya puedes ingresar al BackOffice con tu correo y tu clave nueva.</Note>
            <Link to={sesionSupabase ? "/" : "/admin/login"}>
              <Button className="w-full">{sesionSupabase ? "Entrar al BackOffice" : "Ir a ingresar"}</Button>
            </Link>
          </div>
        ) : sesionPerdida && !token ? (
          <div className="space-y-4">
            <Note tone="alerta">
              Este enlace ya no está activo: venció, ya se había usado, o tu cuenta ingresó desde otro
              lado y esta sesión se cerró. Pide un enlace nuevo desde «Olvidé mi clave» en el login.
            </Note>
            <Link to="/admin/login"><Button variant="secondary" className="w-full">Ir al login</Button></Link>
          </div>
        ) : !token && !sesionSupabase ? (
          <Note tone="neutral">
            Procesando tu enlace… Si esta pantalla no cambia en unos segundos, el enlace está incompleto o
            vencido: pide uno nuevo desde el login.
          </Note>
        ) : (
          <form onSubmit={guardar} className="space-y-4">
            <Field label="Clave nueva" required hint="Mínimo 6 caracteres, con al menos un número y una letra.">
              <CampoClave ver={ver1} setVer={setVer1} autoComplete="new-password" autoFocus
                          value={clave} onChange={(e) => setClave(e.target.value)} />
            </Field>
            <Field label="Confirmar clave nueva" required>
              <CampoClave ver={ver2} setVer={setVer2} autoComplete="new-password"
                          value={confirmar} onChange={(e) => setConfirmar(e.target.value)} />
            </Field>
            {error && <Note tone="alerta">{error}</Note>}
            <Button className="w-full" disabled={cargando || !clave || !confirmar}>
              {cargando ? "Guardando…" : "Guardar mi clave"}
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}
