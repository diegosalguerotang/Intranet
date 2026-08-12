import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Mail, KeyRound } from "lucide-react";
import { useApp } from "../state";
import { supabase, supabaseListo, supabaseUrl } from "../lib/supabase";
import { Note } from "../components/ui";

// Puerta del BackOffice (/admin/login): correo + clave contra Supabase Auth.
// Cierre de Acceso v1.0: sin autorregistro; solo se autentica quien tiene un
// usuario administrativo creado desde ACC-02 (o el seed). El mensaje de error
// es ÚNICO: distinguir "no existe" de "clave mal" convierte el login en un
// verificador de qué personas están en el sistema.
const MENSAJE_UNICO = "Usuario o clave incorrectos.";

export default function AdminLogin() {
  const { user, db } = useApp();
  const [correo, setCorreo] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const entrar = async (e) => {
    e.preventDefault();
    if (!supabaseListo) return setError("El servicio de autenticación no está disponible.");
    setError(null);
    setCargando(true);
    const dispositivo = navigator.userAgent.slice(0, 150);
    const email = correo.trim().toLowerCase();
    try {
      const { data: bloqueado } = await supabase.rpc("verificar_bloqueo", { p_correo: email });
      if (bloqueado) {
        await supabase.rpc("registrar_ingreso", { p_correo: email, p_resultado: "bloqueado", p_dispositivo: dispositivo });
        setError("Demasiados intentos fallidos. Vuelve a intentarlo en unos minutos.");
        return;
      }
      const { error: errAuth } = await supabase.auth.signInWithPassword({ email, password: clave });
      if (errAuth) {
        // Un fallo de RED no es una credencial mal escrita: decir "usuario o
        // clave incorrectos" cuando el servidor nunca respondió despista al
        // usuario y no deja rastro en ACC-06.
        const esRed = !errAuth.status || errAuth.status === 0 || errAuth.status >= 500;
        if (esRed) {
          setError(`No hay conexión con el servidor de autenticación. Detalle técnico: ${errAuth.name ?? "?"} · ${errAuth.message ?? "?"} · servidor: ${supabaseUrl}`);
          return;
        }
        await supabase.rpc("registrar_ingreso", { p_correo: email, p_resultado: "fallido", p_dispositivo: dispositivo });
        setError(MENSAJE_UNICO);
        return;
      }
      // Tener cuenta en el proveedor no basta: hay que estar en el padrón
      // de usuarios administrativos y activo.
      const { data: fila } = await supabase
        .from("v_usuarios_admin").select("id, estado").eq("correo", email).maybeSingle();
      if (!fila || fila.estado !== "activo") {
        await supabase.auth.signOut();
        await supabase.rpc("registrar_ingreso", { p_correo: email, p_resultado: "fallido", p_dispositivo: dispositivo });
        setError(MENSAJE_UNICO);
        return;
      }
      await supabase.rpc("registrar_ingreso", { p_correo: email, p_resultado: "exitoso", p_dispositivo: dispositivo });
      // El listener de sesión en state.jsx carga el usuario y el guard redirige.
    } finally {
      setCargando(false);
    }
  };

  const logos = db.empresas.filter((e) => e.logo);

  return (
    <main
      className="flex min-h-screen flex-col justify-between"
      style={{ background: "linear-gradient(180deg, #ffffff 0%, #e9eff6 55%, #d5e2ee 100%)" }}
    >
      <div className="container mx-auto mt-14 mb-6 px-4 text-center">
        <div className="text-[34px] font-bold leading-none tracking-tight text-tinta">
          Grupo<span className="text-petroleo">ER</span>
        </div>
        <div className="mt-1.5 text-[13px] font-medium uppercase tracking-[0.3em] text-acero">
          Intranet · BackOffice
        </div>
      </div>

      <section className="w-full">
        <div className="mx-auto w-full max-w-md px-6">
          <form onSubmit={entrar}>
            <div className="mb-5 flex">
              <div className="flex items-center border-2 border-r-0 border-petroleo px-3 text-petroleo">
                <Mail size={20} />
              </div>
              <input
                type="email"
                placeholder="Correo electrónico"
                autoFocus
                autoComplete="username"
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                className="w-full border-2 border-petroleo bg-transparent px-3 py-2.5 text-[17px] text-petroleo placeholder:text-petroleo/70 focus:outline-none"
              />
            </div>

            <div className="mb-3 flex">
              <div className="flex items-center border-2 border-r-0 border-petroleo px-3 text-petroleo">
                <KeyRound size={20} />
              </div>
              <input
                type="password"
                placeholder="Clave"
                autoComplete="current-password"
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                className="w-full border-2 border-petroleo bg-transparent px-3 py-2.5 text-[17px] text-petroleo placeholder:text-petroleo/70 focus:outline-none"
              />
            </div>

            <p className="mb-6 text-right text-[12.5px] text-gris-cl">
              ¿Olvidaste tu clave? Pídele a un administrador que te la reenvíe.
            </p>

            {error && <div className="mb-4"><Note tone="alerta">{error}</Note></div>}

            <p className="text-center">
              <button
                type="submit"
                disabled={cargando || !correo.trim() || !clave}
                className="rounded-[4px] bg-petroleo px-10 py-3 text-[20px] font-semibold text-white transition-colors hover:bg-petroleo-cl disabled:cursor-not-allowed disabled:opacity-40"
              >
                {cargando ? "Verificando…" : "Ingresar"}
              </button>
            </p>

            <p className="mt-6 text-center font-mono text-[10px] leading-relaxed text-gris-cl">
              Acceso restringido a personal autorizado del Grupo ER.
              <br />
              Todo intento de ingreso queda registrado. · v5-blindado
            </p>
          </form>
        </div>
      </section>

      <footer className="mb-6 mt-10 w-full px-4">
        <ul className="flex list-none items-center justify-center gap-8">
          {logos.map((e) => (
            <li key={e.id}>
              <div className="flex h-16 w-36 items-center justify-center rounded-[4px] bg-white p-2 shadow-[0_0_3px_rgba(0,0,0,0.15)]">
                <img src={e.logo} alt={e.nombre} className="max-h-full max-w-full object-contain" />
              </div>
            </li>
          ))}
        </ul>
      </footer>
    </main>
  );
}
