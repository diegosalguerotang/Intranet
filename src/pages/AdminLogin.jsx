import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Mail, KeyRound, Eye, EyeOff } from "lucide-react";
import { useApp } from "../state";
import { supabase, supabaseListo, supabaseUrl, supabaseAnonKey, fetchNativo, fetchXhr, cabecerasFallidas, estadoHeaders, blindarHeaders } from "../lib/supabase";
import { Note } from "../components/ui";

// Puerta del BackOffice (/admin/login): correo + clave contra Supabase Auth.
// Cierre de Acceso v1.0: sin autorregistro; solo se autentica quien tiene un
// usuario administrativo creado desde ACC-02 (o el seed). El mensaje de error
// es ÚNICO: distinguir "no existe" de "clave mal" convierte el login en un
// verificador de qué personas están en el sistema.
const MENSAJE_UNICO = "Usuario o clave incorrectos.";

// Resumen técnico de un error de supabase-js para el modo prueba (?probar=1):
// sin el status real es imposible distinguir una clave mal escrita (400) de
// una cabecera apikey eliminada por un interceptor (401).
const detalle = (e) =>
  e ? `${e.name ?? "Error"}·${e.status ?? "sin-status"}${e.code ? `·${e.code}` : ""}: ${(e.message ?? "?").slice(0, 80)}` : "ok";

// Prueba cada canal contra /api/eco: qué cabeceras SOBREVIVEN el viaje real
// hasta el servidor. Un interceptor puede corromperlas en tránsito sin que
// el navegador lo muestre; el espejo del servidor es la única evidencia.
async function ecoCanales() {
  const canales = [
    ["fetchGlobal", (...a) => window.fetch(...a)],
    ["fetchIframe", fetchNativo],
    ["xhr", fetchXhr],
  ];
  const estado = (v, esperado) =>
    v == null ? "ausente" : v === esperado ? "intacta" : `alterada(${String(v).length})`;
  const partes = [];
  for (const [nombre, fn] of canales) {
    try {
      const r = await fn(`/api/eco?canal=${nombre}&apikey=${encodeURIComponent(supabaseAnonKey)}`, {
        headers: { apikey: supabaseAnonKey, authorization: `Bearer ${supabaseAnonKey}`, "x-prueba": "GrupoER" },
      });
      const j = await r.json();
      const cab = j.cabeceras ?? {};
      partes.push(
        `${nombre}[apikey:${estado(cab.apikey, supabaseAnonKey)} auth:${estado(cab.authorization, `Bearer ${supabaseAnonKey}`)} x-prueba:${estado(cab["x-prueba"], "GrupoER")} urlApikey:${estado(j.query?.apikey, supabaseAnonKey)}]`
      );
    } catch (e) {
      partes.push(`${nombre}[ERR:${(e.message ?? "?").slice(0, 35)}]`);
    }
  }
  return partes.join(" · ");
}

export default function AdminLogin() {
  const { user, empresasActivas } = useApp();
  const [correo, setCorreo] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState(null);
  const [exito, setExito] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [verClave, setVerClave] = useState(false);
  const [recuperado, setRecuperado] = useState(null);
  // Motivo por el que se cerró la sesión anterior (inactividad / otro equipo),
  // dejado por state.jsx en sessionStorage al forzar el cierre.
  const [avisoSesion, setAvisoSesion] = useState(null);
  useEffect(() => {
    try {
      const a = sessionStorage.getItem("aviso-sesion");
      if (a) { setAvisoSesion(a); sessionStorage.removeItem("aviso-sesion"); }
    } catch { /* sin sessionStorage */ }
  }, []);

  // ?probar=1 deja ver el formulario aunque el MODO DEMO ya haya puesto un
  // usuario: sin esta puerta no hay forma de diagnosticar el login real
  // mientras la app entra directa como demo.
  const modoPrueba = new URLSearchParams(window.location.search).has("probar");
  if (user && !modoPrueba) return <Navigate to="/" replace />;

  const entrar = async (e) => {
    e.preventDefault();
    if (!supabaseListo) return setError("El servicio de autenticación no está disponible.");
    // El parche del interceptor puede aterrizar DESPUÉS de cargar la app:
    // re-blindar Headers justo antes de usar supabase-js.
    blindarHeaders();
    setError(null);
    setExito(false);
    setCargando(true);
    const dispositivo = navigator.userAgent.slice(0, 150);
    const email = correo.trim().toLowerCase();
    try {
      const { data: bloqueado, error: errBloqueo } = await supabase.rpc("verificar_bloqueo", { p_correo: email });
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
          // Diagnóstico de canales: qué transporte funciona en ESTE navegador.
          const diag = ["v7"];
          const probar = async (nombre, fn) => {
            try {
              const r = await fn(`${supabaseUrl}/auth/v1/health`, { headers: { apikey: supabaseAnonKey } });
              diag.push(`${nombre}:${r.status}`);
            } catch (e) {
              diag.push(`${nombre}:ERR(${(e.message ?? "?").slice(0, 45)})`);
            }
          };
          await probar("fetchGlobal", (...a) => window.fetch(...a));
          await probar("fetchIframe", fetchNativo);
          await probar("xhr", fetchXhr);
          // XHR sin ninguna cabecera, clave solo por URL (inmune a interceptores)
          try {
            const r = await fetchXhr(`${supabaseUrl}/auth/v1/health?apikey=${encodeURIComponent(supabaseAnonKey)}`, {});
            diag.push(`xhrUrl:${r.status}`);
          } catch (e) {
            diag.push(`xhrUrl:ERR(${(e.message ?? "?").slice(0, 40)})`);
          }
          if (cabecerasFallidas.size) diag.push(`cabecerasBloqueadas:[${[...cabecerasFallidas].join(",")}]`);
          diag.push(`headers:${estadoHeaders}`);
          if (modoPrueba) diag.push(`eco: ${await ecoCanales()}`);
          setError(`No hay conexión con el servidor de autenticación. ${errAuth.name ?? "?"}: ${errAuth.message ?? "?"} · Diagnóstico: ${diag.join(" · ")}`);
          return;
        }
        const { error: errReg } = await supabase.rpc("registrar_ingreso", { p_correo: email, p_resultado: "fallido", p_dispositivo: dispositivo });
        setError(
          MENSAJE_UNICO +
            (modoPrueba
              ? ` · [prueba] auth: ${detalle(errAuth)} · registro: ${detalle(errReg)} · bloqueo: ${detalle(errBloqueo)} · headers:${estadoHeaders} · eco: ${await ecoCanales()}`
              : "")
        );
        return;
      }
      // Tener cuenta en el proveedor no basta: hay que estar en el padrón
      // de usuarios administrativos y activo.
      const { data: fila, error: errPadron } = await supabase
        .from("v_usuarios_admin").select("id, estado").eq("correo", email).maybeSingle();
      if (!fila || fila.estado !== "activo") {
        await supabase.auth.signOut();
        await supabase.rpc("registrar_ingreso", { p_correo: email, p_resultado: "fallido", p_dispositivo: dispositivo });
        setError(
          MENSAJE_UNICO +
            (modoPrueba
              ? ` · [prueba] auth: ok · padrón: ${detalle(errPadron)} · fila: ${fila ? fila.estado : "sin fila"}`
              : "")
        );
        return;
      }
      await supabase.rpc("registrar_ingreso", { p_correo: email, p_resultado: "exitoso", p_dispositivo: dispositivo });
      // Sesión única (gana el login nuevo): se registra el marcador de ESTE
      // ingreso; el equipo anterior se autoexpulsa en su próximo chequeo. Si
      // falla, no se bloquea el ingreso.
      try {
        const marca = crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem("backoffice-sesion-marker", marca);
        await supabase.rpc("registrar_sesion_backoffice", { p_marker: marca });
      } catch { /* la política de sesión no bloquea el login */ }
      // El listener de sesión en state.jsx carga el usuario y el guard redirige.
      // En MODO DEMO ese listener está apagado y nada redirige: sin esta señal
      // un login correcto sería indistinguible de un botón muerto.
      setExito(true);
    } finally {
      setCargando(false);
    }
  };

  // Branding del splash: solo empresas activas del grupo (una retirada ya
  // no debe presentarse como parte vigente de la marca).
  const logos = empresasActivas.filter((e) => e.logo);

  return (
    <main
      className="flex min-h-screen flex-col justify-between"
      style={{ background: "linear-gradient(180deg, #ffffff 0%, #e9eff6 55%, #d5e2ee 100%)" }}
    >
      <section className="flex w-full flex-1 items-center py-10">
        <div className="mx-auto w-full max-w-md px-6">
          <form
            onSubmit={entrar}
            className="animar-aparicion rounded-caja bg-white px-8 py-10 shadow-[0_5px_30px_rgba(29,63,114,0.12)]"
          >
            <div className="mb-8 text-center">
              <div className="font-display text-[32px] font-bold leading-none tracking-tight text-tinta">
                Grupo<span className="text-petroleo">ER</span>
              </div>
              <div className="mt-2 text-[12px] font-medium uppercase tracking-[0.3em] text-acero">
                Intranet · BackOffice
              </div>
            </div>

            {avisoSesion && <div className="mb-6"><Note tone="pend">{avisoSesion}</Note></div>}

            <div className="group relative mb-7">
              <div className="flex items-center gap-3 border-b-2 border-borde-f pb-2">
                <Mail size={18} className="shrink-0 text-gris-cl transition-colors group-focus-within:text-petroleo" />
                <input
                  type="email"
                  placeholder="Correo electrónico"
                  autoFocus
                  autoComplete="username"
                  value={correo}
                  onChange={(e) => setCorreo(e.target.value)}
                  className="w-full bg-transparent text-[15px] text-gris placeholder:text-gris-cl focus:outline-none"
                />
              </div>
              <span className="absolute bottom-0 left-0 h-0.5 w-full origin-left scale-x-0 bg-petroleo transition-transform duration-300 group-focus-within:scale-x-100" />
            </div>

            <div className="group relative mb-3">
              <div className="flex items-center gap-3 border-b-2 border-borde-f pb-2">
                <KeyRound size={18} className="shrink-0 text-gris-cl transition-colors group-focus-within:text-petroleo" />
                <input
                  type={verClave ? "text" : "password"}
                  placeholder="Clave"
                  autoComplete="current-password"
                  value={clave}
                  onChange={(e) => setClave(e.target.value)}
                  className="w-full bg-transparent text-[15px] text-gris placeholder:text-gris-cl focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setVerClave((v) => !v)}
                  aria-label={verClave ? "Ocultar clave" : "Mostrar clave"}
                  className="shrink-0 text-gris-cl hover:text-petroleo"
                >
                  {verClave ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <span className="absolute bottom-0 left-0 h-0.5 w-full origin-left scale-x-0 bg-petroleo transition-transform duration-300 group-focus-within:scale-x-100" />
            </div>

            <p className="mb-7 text-right text-[12px] text-gris-cl">
              {recuperado ? (
                <span className="text-gris">{recuperado}</span>
              ) : (
                <button
                  type="button"
                  className="text-petroleo hover:underline"
                  disabled={cargando}
                  onClick={async () => {
                    // Recuperación por el correo NATIVO de Supabase: respuesta
                    // siempre genérica, no revela si la cuenta existe.
                    if (!correo.trim()) { setRecuperado("Escribe tu correo arriba y vuelve a tocar aquí."); return; }
                    try {
                      await supabase.auth.resetPasswordForEmail(correo.trim(), {
                        redirectTo: `${window.location.origin}/admin/restablecer`,
                      });
                    } catch { /* la respuesta es genérica igual */ }
                    setRecuperado("Si el correo pertenece a un usuario activo, te llegará un enlace para crear una clave nueva.");
                  }}
                >
                  ¿Olvidaste tu clave? Te enviamos un enlace a tu correo
                </button>
              )}
            </p>

            {error && <div className="mb-4"><Note tone="alerta">{error}</Note></div>}
            {exito && (
              <div className="mb-4">
                <Note tone="conf">Conexión y credenciales verificadas. El ingreso quedó registrado en ACC-06.</Note>
              </div>
            )}

            <button
              type="submit"
              disabled={cargando || !correo.trim() || !clave}
              className="w-full rounded-full bg-petroleo py-3 text-[16px] font-semibold tracking-wide text-white shadow-md transition-all hover:-translate-y-px hover:bg-pend hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:bg-petroleo"
            >
              {cargando ? "Verificando…" : "Ingresar"}
            </button>

            <p className="mt-7 text-center font-mono text-[10px] leading-relaxed text-gris-cl">
              Acceso restringido a personal autorizado del Grupo ER.
              <br />
              Todo intento de ingreso queda registrado. · v9-diseno
            </p>
          </form>
        </div>
      </section>

      <footer className="mb-6 mt-10 w-full px-4">
        <ul className="flex list-none items-center justify-center gap-8">
          {logos.map((e) => (
            <li key={e.id}>
              <div className="flex h-16 w-36 items-center justify-center rounded-caja bg-white p-2 shadow-[0_2px_10px_rgba(29,63,114,0.10)]">
                <img src={e.logo} alt={e.nombre} className="max-h-full max-w-full object-contain" />
              </div>
            </li>
          ))}
        </ul>
      </footer>
    </main>
  );
}
