import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase, supabaseListo } from "./lib/supabase";
import * as MOCK from "./data/mock";

const AppCtx = createContext(null);

// Clave de estado → vista/tabla de lectura en Supabase.
// La interfaz nunca lee tablas crudas cuando existe un modelo detrás:
// lee vistas (v_*) que presentan el contrato de datos ya resuelto.
const FUENTES = {
  empresas: "empresas",
  sedes: "v_sedes",
  personal: "v_personal",
  lotes: "v_lotes",
  acuses: "v_acuses",
  comunicados: "v_comunicados",
  memorandums: "v_memorandums",
  tardanzas: "tardanzas",
  asistenciaLotes: "v_asistencia_lotes",
  asistenciaConfig: "asistencia_config",
  plantillas: "plantillas",
  contratos: "v_contratos",
  activos: "v_activos",
  lineas: "lineas",
  epp_entregas: "v_epp_entregas",
  perfiles: "v_perfiles",
  perfilVersiones: "v_perfil_versiones",
  usuariosAdmin: "v_usuarios_admin",
  politica: "v_politica_acceso",
  registroAccesos: "v_registro_accesos",
  tiposSancion: "v_tipos_sancion",
  ritFaltas: "v_rit_faltas",
  tickets: "v_tickets",
  ticketConfig: "v_ticket_config",
  ticketAvisos: "v_ticket_avisos",
  solicitudes: "v_solicitudes",
  solicitudTipos: "v_solicitud_tipos",
  solicitudAvisos: "v_solicitud_avisos",
  misSolicitudes: "v_mis_solicitudes",
  rits: "v_rits",
};

const LOCAL = {
  empresas: MOCK.EMPRESAS,
  sedes: MOCK.SEDES,
  personal: MOCK.PERSONAL,
  lotes: MOCK.LOTES,
  acuses: MOCK.ACUSES,
  comunicados: MOCK.COMUNICADOS,
  memorandums: MOCK.MEMORANDUMS,
  tardanzas: MOCK.TARDANZAS,
  asistenciaLotes: [],  // asistencia: solo existe con conexión real
  asistenciaConfig: [],
  plantillas: MOCK.PLANTILLAS,
  contratos: MOCK.CONTRATOS,
  activos: MOCK.ACTIVOS,
  lineas: MOCK.LINEAS,
  epp_entregas: MOCK.EPP_ENTREGAS,
  perfiles: MOCK.PERFILES,
  perfilVersiones: MOCK.PERFIL_VERSIONES,
  usuariosAdmin: MOCK.USUARIOS_ADMIN,
  politica: MOCK.POLITICA_ACCESO,
  registroAccesos: MOCK.REGISTRO_ACCESOS,
  tiposSancion: [],  // catálogos del RIT: solo existen con conexión real
  ritFaltas: [],
  tickets: [],       // soporte: solo existe con conexión real
  ticketConfig: [],
  ticketAvisos: [],
  solicitudes: [],   // centro de solicitudes: solo existe con conexión real
  solicitudTipos: [],
  solicitudAvisos: [],
  misSolicitudes: [],
  rits: [],          // reglamentos internos: solo existen con conexión real
};

// MODO DEMO: entra directo como superadministrador sin pasar por
// /admin/login. Se usó temporalmente (2026-08-12/13) mientras se cazaba el
// bug del BOM en la env var de Vercel; el login real quedó reparado y
// verificado el 2026-08-13. Poner en true solo para demos sin conexión.
const MODO_DEMO = false;
const USUARIO_DEMO = {
  id: 0, nombre: "Diego Salguero Tang", rol: "Superadministrador · demo",
  correo: "diegosalguerotang@gmail.com", esSuperadmin: true, requiereCambio: false,
  acceso: { esSuperadmin: true, matriz: {}, empresas: [] },
};

// Llama a una función serverless propia con el JWT de la sesión en x-sesion.
// Devuelve { ...json } o { error }.
async function llamarServerless(ruta, cuerpo) {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return { error: "Sin sesión activa." };
    const r = await fetch(ruta, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sesion": token },
      body: JSON.stringify(cuerpo),
    });
    const json = await r.json().catch(() => ({}));
    return r.ok ? json : { error: json.error ?? `Error ${r.status}` };
  } catch (e) {
    return { error: e.message ?? "Fallo de red." };
  }
}
const cuentaAdmin = (accion, usuarioId) => llamarServerless("/api/admin-usuarios", { accion, usuario_id: usuarioId });

// Política de sesión (BackOffice): cierre por inactividad y sesión única.
const INACTIVIDAD_MS = 60 * 60 * 1000; // 1 hora sin actividad → cierre (decisión Diego 2026-08-31)
const CLAVE_MARCADOR = "backoffice-sesion-marker";

export function AppProvider({ children }) {
  // undefined = verificando sesión · null = sin sesión · objeto = autenticado
  const [user, setUser] = useState(MODO_DEMO ? USUARIO_DEMO : supabaseListo ? undefined : null);
  // La razón social seleccionada sobrevive al refresco (localStorage). El
  // guard del Shell la corrige sola si el usuario ya no la tiene en su alcance.
  const CLAVE_EMPRESA = "backoffice-empresa";
  const [empresaId, setEmpresaIdEstado] = useState(() => {
    try { return localStorage.getItem(CLAVE_EMPRESA) ?? "negliaf"; }
    catch { return "negliaf"; }
  });
  const setEmpresaId = (id) => {
    try { localStorage.setItem(CLAVE_EMPRESA, id); } catch { /* modo privado */ }
    setEmpresaIdEstado(id);
  };
  const [db, setDb] = useState(LOCAL);
  const [origen, setOrigen] = useState("local"); // "supabase" | "local"

  const recargar = async (...claves) => {
    if (!supabaseListo) return;
    const lista = claves.length ? claves : Object.keys(FUENTES);
    const resultados = await Promise.all(lista.map((k) => supabase.from(FUENTES[k]).select("*")));
    setDb((d) => {
      const nuevo = { ...d };
      lista.forEach((k, i) => {
        if (!resultados[i].error) nuevo[k] = resultados[i].data;
        else console.error(`Supabase [${FUENTES[k]}]:`, resultados[i].error.message);
      });
      return nuevo;
    });
    return resultados.every((r) => !r.error);
  };

  useEffect(() => {
    if (!supabaseListo) return;
    recargar().then((ok) => setOrigen(ok ? "supabase" : "local"));
  }, []);

  // Cierre de acceso: el usuario se deriva de la sesión de Supabase Auth y
  // del padrón de usuarios administrativos. Tener cuenta en el proveedor no
  // basta: sin fila activa en usuarios_admin, se expulsa.
  useEffect(() => {
    if (MODO_DEMO || !supabaseListo) return;
    let activo = true;
    const resolver = async (session) => {
      const email = session?.user?.email;
      if (!email) { if (activo) setUser(null); return; }
      const [{ data, error }, { data: acc }] = await Promise.all([
        supabase.from("v_usuarios_admin").select("*").eq("correo", email).maybeSingle(),
        supabase.from("v_mi_acceso").select("*").eq("correo", email).maybeSingle(),
      ]);
      if (!activo) return;
      if (error || !data || data.estado !== "activo") {
        await supabase.auth.signOut();
        setUser(null);
        return;
      }
      setUser({
        id: data.id, codigo: data.codigo, nombre: data.nombre, rol: data.perfilNombre,
        correo: data.correo, esSuperadmin: data.esSuperadmin, requiereCambio: data.requiereCambio,
        // La categoría vigente manda: de aquí salen menú, selector y guards.
        acceso: {
          esSuperadmin: acc?.esSuperadmin ?? data.esSuperadmin,
          matriz: acc?.matriz ?? {},
          empresas: acc?.empresas ?? [],
        },
      });
    };
    supabase.auth.getSession().then(({ data }) => resolver(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((evento, session) => {
      if (evento !== "TOKEN_REFRESHED") resolver(session);
    });
    return () => { activo = false; sub.subscription.unsubscribe(); };
  }, []);

  const salir = async (aviso = null) => {
    if (MODO_DEMO) return; // en demo no hay sesión que cerrar
    try {
      localStorage.removeItem(CLAVE_MARCADOR);
      // El motivo del cierre forzado lo lee AdminLogin tras redirigir.
      if (aviso) sessionStorage.setItem("aviso-sesion", aviso);
    } catch { /* modo privado */ }
    if (supabaseListo) await supabase.auth.signOut();
    setUser(null);
  };

  // Política de sesión: cierre por inactividad (1 hora) y sesión única (el
  // login nuevo gana; este equipo se autoexpulsa si el marcador del servidor
  // cambió). Activo solo mientras hay usuario autenticado.
  useEffect(() => {
    if (MODO_DEMO || !supabaseListo || !user) return;
    let vivo = true;
    let idle;
    // La pantalla de restablecer clave usa la sesión temporal del enlace del
    // correo: si la política la expulsa (otro login, inactividad) el guardado
    // muere con un error sin salida. Ahí la política NO aplica — se evalúa al
    // momento de disparar, no al montar.
    const enRestablecer = () => window.location.pathname.startsWith("/admin/restablecer");
    const reiniciarIdle = () => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        if (vivo && !enRestablecer()) salir("Tu sesión se cerró por inactividad. Vuelve a ingresar.");
      }, INACTIVIDAD_MS);
    };
    const eventosActividad = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    eventosActividad.forEach((e) => window.addEventListener(e, reiniciarIdle, { passive: true }));
    reiniciarIdle();

    const revisarSesion = async () => {
      if (!vivo || document.hidden || enRestablecer()) return;
      const marca = (() => { try { return localStorage.getItem(CLAVE_MARCADOR); } catch { return null; } })();
      const { data, error } = await supabase.rpc("mi_sesion_backoffice");
      if (!vivo || error || enRestablecer()) return;
      // Solo expulsa si el servidor tiene un marcador y NO es el nuestro.
      if (data && marca && data !== marca) {
        salir("Tu sesión se cerró porque tu cuenta ingresó desde otro equipo.");
      }
    };
    const poll = setInterval(revisarSesion, 60000);
    const alEnfocar = () => revisarSesion();
    window.addEventListener("focus", alEnfocar);
    document.addEventListener("visibilitychange", alEnfocar);

    return () => {
      vivo = false;
      clearTimeout(idle);
      clearInterval(poll);
      eventosActividad.forEach((e) => window.removeEventListener(e, reiniciarIdle));
      window.removeEventListener("focus", alEnfocar);
      document.removeEventListener("visibilitychange", alEnfocar);
    };
  }, [user?.id]);

  // El primer ingreso exige reemplazar la clave provisional antes de operar.
  const claveCambiada = async () => {
    if (supabaseListo && user?.correo) {
      await supabase.rpc("marcar_clave_cambiada", { p_correo: user.correo });
      await recargar("usuariosAdmin");
    }
    setUser((u) => (u ? { ...u, requiereCambio: false } : u));
  };

  const empresa = db.empresas.find((e) => e.id === empresaId);
  const persona = (dni) => db.personal.find((p) => p.dni === dni);
  const sede = (id) => db.sedes.find((s) => s.id === id);
  const empresaPor = (id) => db.empresas.find((e) => e.id === id);
  // Empresas ofrecidas en altas, asistentes de carga y el selector global: las
  // retiradas (Task 2) siguen existiendo para no romper los históricos, pero
  // dejan de ofrecerse para trabajo nuevo.
  const empresasActivas = useMemo(
    () => db.empresas.filter((e) => (e.estado ?? "activa") === "activa"),
    [db.empresas]
  );

  // Cada acción: actualización optimista local + RPC en el backend (la lógica
  // de negocio vive en Postgres) + recarga de las vistas afectadas.
  const local = (clave, fn) => setDb((d) => ({ ...d, [clave]: fn(d[clave]) }));
  // Un token de sesión vencido viaja caduco al proxy, que lo pone como
  // Authorization; PostgREST lo rechaza con 401 (JWT expired / PGRST301) aunque
  // la apikey esté. Antes esto se tragaba a consola y el guardado "desaparecía"
  // al refrescar. Se detecta por el mensaje para refrescar y reintentar.
  const esErrorSesion = (msg) => /jwt|expired|PGRST301|invalid (api key|claim)|\b401\b/i.test(msg ?? "");
  const rpc = async (nombre, args, ...refrescar) => {
    if (!supabaseListo) return { error: null };
    let { error } = await supabase.rpc(nombre, args);
    if (error && esErrorSesion(error.message)) {
      const { error: eRefresh } = await supabase.auth.refreshSession();
      if (!eRefresh) ({ error } = await supabase.rpc(nombre, args));
    }
    if (error) console.error(`RPC ${nombre}:`, error.message);
    await recargar(...refrescar);
    return { error: error?.message ?? null };
  };

  const acciones = {
    addPersonal: (row) => {
      local("personal", (xs) => [row, ...xs]);
      rpc("alta_trabajador", {
        p_dni: row.dni, p_nombre: row.nombre, p_cargo: row.cargo,
        p_sede: row.sede, p_empresa: row.empresa, p_ingreso: row.ingreso,
        p_celular: row.celular, p_banco: row.banco, p_cuenta: row.cuenta,
        p_correo: row.correo ?? null, p_cci: row.cci ?? null,
        p_tipo_documento: row.tipoDocumento ?? "DNI",
      }, "personal");
    },
    deletePersonal: (dni) => {
      local("personal", (xs) => xs.filter((p) => p.dni !== dni));
      rpc("eliminar_trabajador", { p_dni: dni }, "personal", "acuses", "lotes");
    },
    addLote: (lote) => {
      local("lotes", (xs) => [lote, ...xs]);
      rpc("publicar_lote", {
        p_empresa: lote.empresa, p_tipo: lote.tipo, p_periodo: lote.periodo, p_por: lote.por,
      }, "lotes", "acuses");
    },
    // v2 (2026-08-25): el adjunto YA subido a Storage viaja como ruta y el
    // servidor lo verifica; supervisor/hash los pone la BD (nada inventado).
    // El refresco de v_acuses trae la verdad — sin update local optimista.
    registrarAcuseAsistido: async (dni, lote, datos) =>
      rpc("registrar_acuse_asistido", {
        p_dni: dni, p_lote: lote, p_motivo: datos.motivo,
        p_entrega: datos.fechaEntrega, p_adjunto: datos.adjunto,
        p_dispositivo: navigator.userAgent.slice(0, 150),
      }, "acuses", "lotes"),
    addComunicado: (c) => {
      local("comunicados", (xs) => [c, ...xs]);
      rpc("publicar_comunicado", {
        p_titulo: c.titulo, p_cuerpo: c.cuerpo, p_vence: c.vence,
        p_exige: c.exigeAcuse, p_segmento: c.segmento, p_alcance: c.alcance,
        p_empresa: c.empresa ?? null, p_sede: c.sede ?? null,
      }, "comunicados");
    },
    // RRH-17 — Lista real de pendientes de lectura de un comunicado (se
    // consulta al abrir el modal, no se precarga: crece con el padrón).
    pendientesComunicado: async (id) => {
      if (!supabaseListo) return [];
      const { data, error } = await supabase
        .from("v_comunicado_pendientes").select("*").eq("comunicado_id", id).order("nombre");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    // RRH-18 v2 — Emisión parametrizada por RIT: el servidor valida tipo,
    // falta, nivel del emisor y tope de suspensión; congela antecedentes y el
    // texto literal de la falta. Los errores se muestran tal cual.
    emitirMemorandum: async ({ dni, tipoSancion, faltaId, motivo, suspensionDias }) => {
      if (!supabaseListo) throw new Error("La emisión real requiere conexión a Supabase.");
      const { data, error } = await supabase.rpc("emitir_memorandum", {
        p_dni: dni, p_tipo_sancion: tipoSancion, p_falta_id: faltaId ?? null,
        p_motivo: motivo, p_suspension_dias: suspensionDias ?? null,
        p_por: user?.nombre ?? "RRHH",
      });
      if (error) throw new Error(error.message);
      await recargar("memorandums");
      return data; // correlativo asignado
    },
    // Registrar la notificación: recién aquí empieza a correr el plazo.
    notificarMemorandum: async (id) => {
      if (!supabaseListo) throw new Error("La notificación real requiere conexión a Supabase.");
      const { error } = await supabase.rpc("notificar_memorandum", { p_id: id });
      if (error) throw new Error(error.message);
      await recargar("memorandums");
    },
    resolverMemo: (id, resolucion) => {
      local("memorandums", (xs) => xs.map((m) => (m.id === id ? { ...m, estado: "resuelto", resolucion } : m)));
      rpc("resolver_memorandum", { p_id: id, p_decision: resolucion.decision }, "memorandums");
    },
    asignarActivo: (codigo, dni, sedeId, antivirus = null, comentario = null, condicion = "Buen estado") => {
      local("activos", (xs) => xs.map((a) => (a.codigo === codigo ? { ...a, estado: "asignado", asignado: dni, sede: sedeId, antivirus, comentario_asignacion: comentario } : a)));
      rpc("asignar_activo", { p_codigo: codigo, p_dni: dni, p_condicion: condicion, p_antivirus: antivirus, p_comentario: comentario }, "activos");
    },
    devolverActivo: (codigo, destino, sedeId, condicion = "Buen estado") => {
      local("activos", (xs) => xs.map((a) => (a.codigo === codigo ? { ...a, estado: destino, asignado: null, sede: sedeId } : a)));
      rpc("devolver_activo", { p_codigo: codigo, p_destino: destino, p_condicion: condicion }, "activos");
    },
    // ADQ-02 real (2026-08-25): alta manual contra la BD; devuelve {error} si
    // el código ya existe o falta nivel.
    crearActivo: (a) => rpc("crear_activo", {
      p_codigo: a.codigo, p_categoria: a.categoria, p_empresa: a.empresa,
      p_tipo: a.tipo || null, p_marca: a.marca || null, p_modelo: a.modelo || null,
      p_serie: a.serie || null, p_imei: a.imei || null,
      p_valor: a.valor || 0, p_compra: a.compra || null,
      p_observaciones: a.observaciones || null,
    }, "activos"),
    // Actividad real del legajo (auditoría filtrada por persona; se consulta
    // al abrir, no se precarga: crece sin tope).
    actividadPersona: async (dni) => {
      if (!supabaseListo) return [];
      const { data, error } = await supabase
        .from("v_actividad_persona").select("*").eq("dni", dni)
        .order("id", { ascending: false }).limit(100);
      if (error) { console.error("Supabase [actividad]:", error.message); return []; }
      return data ?? [];
    },
    addLinea: (l) => {
      local("lineas", (xs) => [l, ...xs]);
      if (supabaseListo) {
        supabase.from("lineas").insert(l).then(({ error }) => {
          if (error) console.error("Supabase [lineas]:", error.message);
          recargar("lineas");
        });
      }
    },
    // ADQ-05 — Distribuir una línea a la razón social que la usa (el pago
    // sigue saliendo de quien la paga; son columnas distintas).
    asignarUsoLinea: async (numero, usa) => {
      local("lineas", (xs) => xs.map((l) => (l.numero === numero ? { ...l, usa: usa || null } : l)));
      if (supabaseListo) {
        const { error } = await supabase.from("lineas").update({ usa: usa || null }).eq("numero", numero);
        if (error) console.error("Supabase [lineas]:", error.message);
        await recargar("lineas");
      }
    },
    // ---- Accesos y Roles ----
    // Devuelve { error } para que el editor confirme el guardado ANTES de
    // navegar: sin esto, un 401 por sesión vencida se tragaba y la categoría
    // "aparecía y desaparecía al refrescar" (el update optimista sin respaldo
    // en BD). En modo local/demo sí se actualiza en memoria.
    guardarPerfil: async (perfil) => {
      const autor = user?.nombre ?? "BackOffice";
      if (!supabaseListo) {
        const previa = db.perfiles.find((p) => p.id === perfil.id);
        const version = (previa?.version ?? 0) + 1;
        const ahora = new Date().toISOString().slice(0, 16).replace("T", " ");
        const fila = { ...perfil, version, estado: "activo", usuarios: previa?.usuarios ?? 0, modificado: ahora, modificadoPor: autor };
        local("perfiles", (xs) => [fila, ...xs.filter((p) => p.id !== perfil.id)]);
        local("perfilVersiones", (xs) => [{ perfilId: perfil.id, version, nombre: perfil.nombre, esSuperadmin: perfil.esSuperadmin, matriz: perfil.matriz, creado: ahora, por: autor }, ...xs]);
        return { error: null };
      }
      return rpc("guardar_perfil", {
        p_id: perfil.id, p_nombre: perfil.nombre, p_descripcion: perfil.descripcion,
        p_superadmin: perfil.esSuperadmin, p_ver_remuneracion: perfil.verRemuneracion,
        p_ver_documentos: perfil.verDocumentosTerceros, p_exportar: perfil.exportarDatosPersonales,
        p_ver_bancarios: perfil.verDatosBancarios ?? false,
        p_matriz: perfil.matriz, p_empresas: perfil.empresas ?? null, p_por: autor,
      }, "perfiles", "perfilVersiones", "usuariosAdmin");
    },
    desactivarPerfil: (id) => {
      local("perfiles", (xs) => xs.map((p) => (p.id === id ? { ...p, estado: "desactivado" } : p)));
      rpc("desactivar_perfil", { p_id: id }, "perfiles");
    },
    // Eliminación definitiva de una categoría: los invariantes (jamás
    // superadmin, jamás con usuarios) se validan en el RPC y el error se
    // muestra tal cual en el modal — sin actualización optimista.
    eliminarPerfil: async (id) => {
      if (!supabaseListo) throw new Error("La eliminación real requiere conexión a Supabase.");
      const { error } = await supabase.rpc("eliminar_perfil", { p_id: id });
      if (error) throw new Error(error.message);
      await recargar("perfiles", "perfilVersiones");
    },
    // Alta v2: la fila en BD primero (asigna código), la cuenta de ingreso
    // después (serverless con service key devuelve la clave provisional).
    crearUsuarioAdmin: async (u) => {
      if (!supabaseListo) return { error: "Sin conexión con la base de datos." };
      const { data: id, error } = await supabase.rpc("crear_usuario_admin", {
        p_dni: u.dni, p_perfil: u.perfil, p_correo: u.correo, p_celular: u.celular,
        p_clave: null, p_por: user?.nombre ?? "BackOffice",
      });
      if (error) return { error: error.message };
      let clave = null, errorCuenta = null, enviadoCorreo = null, avisoCorreo = null, invitado = null;
      if (u.correo) {
        const r = await cuentaAdmin("crear", id);
        if (r.error) errorCuenta = r.error;
        else {
          clave = r.clave ?? null; invitado = r.invitado ?? null;
          enviadoCorreo = r.enviadoCorreo ?? null; avisoCorreo = r.avisoCorreo ?? null;
        }
      }
      const { data: fila } = await supabase
        .from("v_usuarios_admin").select("codigo, creado").eq("id", id).maybeSingle();
      await recargar("usuariosAdmin", "perfiles");
      return { id, clave, invitado, errorCuenta, enviadoCorreo, avisoCorreo, codigo: fila?.codigo, creado: fila?.creado };
    },
    actualizarUsuarioAdmin: (id, cambios) => {
      local("usuariosAdmin", (xs) => xs.map((x) => (x.id === id ? { ...x, ...cambios } : x)));
      rpc("actualizar_usuario_admin", {
        p_id: id, p_perfil: cambios.perfil, p_correo: cambios.correo, p_celular: cambios.celular,
        p_estado: cambios.estado,
      }, "usuariosAdmin", "perfiles");
    },
    // Eliminación definitiva: BD + cuenta de ingreso, vía serverless (los
    // invariantes -último superadmin, no a uno mismo- se validan allá).
    eliminarUsuarioAdmin: async (id) => {
      const r = await cuentaAdmin("eliminar", id);
      if (!r.error) local("usuariosAdmin", (xs) => xs.filter((x) => x.id !== id));
      await recargar("usuariosAdmin", "perfiles");
      return r;
    },
    // Restablecer clave v2: cambia la clave REAL de la cuenta y exige cambio.
    reenviarClaveCuenta: async (id) => cuentaAdmin("reenviar", id),
    // Cuentas del Portal del Trabajador (RRH-02): crear / restablecer.
    // extras: { enviarCorreo } — el endpoint envía él mismo el acceso (solo
    // él conoce la clave aleatoria).
    cuentaPortal: async (accion, dni, extras = {}) => {
      const r = await llamarServerless("/api/portal-cuentas", { accion, dni, ...extras });
      if (!r.error) await recargar("personal");
      return r;
    },
    // Lote masivo (RRH-02): un tramo de hasta 10; el caller recarga al final.
    cuentasPortalLote: async (dnis, enviarCorreo) =>
      llamarServerless("/api/portal-cuentas", { accion: "crear-lote", dnis, enviarCorreo }),
    refrescarPersonal: () => recargar("personal"),
    // Recordatorio por correo a un trabajador con acuses pendientes (RRH-06/11).
    // El endpoint valida nivel ≥2 en Acuses y que exista correo + cuenta portal.
    recordarAcuse: async (dni) => llamarServerless("/api/enviar-correo", { accion: "recordatorio-acuse", dni }),
    // Cuenta bancaria completa (#10): única vía de lectura, gated por la
    // casilla «Ver datos bancarios» y auditada en la BD (devuelve null sin
    // permiso — jamás la cuenta).
    verCuentaBancaria: async (dni) => {
      if (!supabaseListo) return { error: "Requiere conexión a Supabase." };
      const { data, error } = await supabase.rpc("fn_ver_cuenta_bancaria", { p_dni: dni });
      if (error) return { error: error.message };
      return data ?? { sinPermiso: true };
    },
    // RRH-03 — Edición del trabajador desde el legajo (superadmin o nivel de
    // acción en Personal; el servidor lo valida de nuevo).
    editarTrabajador: async (dni, cambios) => {
      if (!supabaseListo) throw new Error("La edición real requiere conexión a Supabase.");
      const { error } = await supabase.rpc("editar_trabajador", {
        p_dni: dni, p_nombre: cambios.nombre, p_celular: cambios.celular,
        p_correo: cambios.correo, p_banco: cambios.banco, p_cuenta: cambios.cuenta,
        p_cci: cambios.cci ?? null, p_tipo_documento: cambios.tipoDocumento ?? null,
      });
      if (error) throw new Error(error.message);
      await recargar("personal");
    },
    // Bandeja de propuestas de perfil (spec Tareas 31-08 §5): la importación
    // del padrón SUGIERE; solo un superadministrador decide, y la cuenta se
    // crea en ACC-04 (exige correo). La vista trae también las decididas.
    propuestasPerfil: async () => {
      if (!supabaseListo) return [];
      const { data, error } = await supabase.from("v_perfil_propuestas").select("*");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    decidirPropuestaPerfil: async (id, decision) => {
      if (!supabaseListo) throw new Error("Requiere conexión a Supabase.");
      const { error } = await supabase.rpc("decidir_propuesta_perfil", {
        p_id: id, p_decision: decision, p_por: user?.nombre ?? "BackOffice",
      });
      if (error) throw new Error(error.message);
    },
    // Correspondencia cargo → categoría: dato ADMINISTRADO (aparecerán cargos
    // nuevos); el RPC exige nivel de acción en Configuración o Accesos.
    cargoPerfiles: async () => {
      if (!supabaseListo) return [];
      const { data, error } = await supabase.from("v_cargo_perfiles").select("*");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    guardarCargoPerfil: async (cargo, destino, perfil) => {
      if (!supabaseListo) throw new Error("Requiere conexión a Supabase.");
      const { error } = await supabase.rpc("guardar_cargo_perfil", {
        p_cargo: cargo, p_destino: destino, p_perfil: perfil || null,
        p_por: user?.nombre ?? "BackOffice",
      });
      if (error) throw new Error(error.message);
    },
    // Hora de entrada versionada (2026-08-31): fija o corrige la hora con su
    // fecha de vigencia (hora null borra esa vigencia). El servidor exige
    // nivel de acción en Personal; jamás se supone una hora por defecto.
    fijarHoraEntrada: async (dni, hora, desde) => {
      if (!supabaseListo) throw new Error("Requiere conexión a Supabase.");
      const { error } = await supabase.rpc("fijar_hora_entrada", {
        p_dni: dni, p_hora: hora || null, p_desde: desde,
        p_por: user?.nombre ?? "BackOffice",
      });
      if (error) throw new Error(error.message);
      await recargar("personal");
    },
    suspenderUsuarioAdmin: (id) => {
      local("usuariosAdmin", (xs) => xs.map((x) => (x.id === id ? { ...x, estado: "suspendido" } : x)));
      rpc("suspender_usuario_admin", { p_id: id }, "usuariosAdmin");
    },
    reactivarUsuarioAdmin: (id) => {
      local("usuariosAdmin", (xs) => xs.map((x) => (x.id === id ? { ...x, estado: "activo" } : x)));
      rpc("reactivar_usuario_admin", { p_id: id }, "usuariosAdmin");
    },
    reenviarClave: (id, clave) => {
      rpc("reenviar_clave", { p_id: id, p_clave: clave }, "usuariosAdmin");
    },
    guardarPolitica: (p) => {
      const ahora = new Date().toISOString().slice(0, 16).replace("T", " ");
      local("politica", () => [{ ...p, actualizado: ahora, actualizadoPor: user?.nombre ?? "BackOffice" }]);
      rpc("guardar_politica", {
        p_backoffice_horas: p.sesionBackofficeHoras, p_portal_dias: p.sesionPortalDias,
        p_multisesion_backoffice: p.multisesionBackoffice, p_multisesion_portal: p.multisesionPortal,
        p_intentos: p.intentosBloqueo, p_bloqueo_min: p.bloqueoMinutos,
        p_recuperacion: p.recuperacionDefecto,
        p_clave_min_portal: p.claveLongitudMinPortal, p_clave_min_backoffice: p.claveLongitudMinBackoffice,
        p_provisional_dias: p.claveProvisionalDias, p_por: user?.nombre ?? "BackOffice",
      }, "politica");
    },
    // RRH-05 — Importación del padrón DEFINITIVO (12 columnas con centro de
    // costo; spec Tareas 31-08, único formato soportado). Patrón PV999: la
    // vista previa no escribe nada; el rechazo de una RS (no existe /
    // retirada / fuera de alcance) llega como error y detiene TODO el archivo.
    previsualizarPadron: async (filas, ceses = []) => {
      if (!supabaseListo) throw new Error("La importación del padrón requiere conexión a Supabase.");
      const { data, error } = await supabase.rpc("previsualizar_padron", {
        p_filas: filas, p_ceses: ceses,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    importarPadron: async (filas, ceses = []) => {
      if (!supabaseListo) throw new Error("La importación del padrón requiere conexión a Supabase.");
      const { data, error } = await supabase.rpc("importar_padron", {
        p_filas: filas, p_por: user?.nombre ?? "RRHH", p_ceses: ceses,
      });
      if (error) throw new Error(error.message);
      await recargar("personal");
      return data;
    },
    // Historial del legajo (pestaña Vínculos): todos los vínculos de la
    // persona + los movimientos de planilla (alta/traslado/cese/retorno).
    historialVinculos: async (dni) => {
      if (!supabaseListo) return [];
      const { data, error } = await supabase.from("v_vinculos_persona").select("*").eq("dni", dni);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    historialMovimientos: async (dni) => {
      if (!supabaseListo) return [];
      const { data, error } = await supabase.from("v_movimientos_persona").select("*").eq("dni", dni);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    // RRH-21 — Alta manual de sede: el código S-NNNN lo asigna la BD (misma
    // secuencia que usa la importación de personal al crear sedes).
    crearSede: async ({ empresaId: empresaIdArg, nombre, cliente, direccion, rit }) => {
      if (!supabaseListo) throw new Error("El alta real de sedes requiere conexión a Supabase.");
      const { data, error } = await supabase.rpc("crear_sede", {
        p_empresa: empresaIdArg, p_nombre: nombre, p_cliente: cliente || null,
        p_direccion: direccion || null, p_por: user?.nombre ?? "RRHH",
        p_rit: rit || null,
      });
      if (error) throw new Error(error.message);
      await recargar("sedes");
      return data; // { id, codigo }
    },
    // RIT por sede/contrato: el reglamento se sube UNA vez y las sedes lo
    // declaran; el personal de esa planilla lo lee resuelto (sede → empresa).
    crearRit: async (nombre, archivoRuta, hash, vigente) => {
      const { data, error } = await supabase.rpc("crear_rit", {
        p_nombre: nombre, p_archivo: archivoRuta, p_hash: hash, p_vigente: vigente || null,
      });
      if (error) throw new Error(error.message);
      await recargar("rits");
      return data; // id del rit
    },
    asignarRitSede: async (sedeId, ritId) => {
      const { error } = await supabase.rpc("asignar_rit_sede", { p_sede: sedeId, p_rit: ritId || null });
      if (error) throw new Error(error.message);
      await recargar("sedes", "rits");
    },
    // RRH-21 — Eliminar sede: la BD solo lo permite si nada la referencia
    // (ni vínculos históricos, ni activos, ni comunicados).
    eliminarSede: async (sedeId) => {
      if (!supabaseListo) throw new Error("Eliminar sedes requiere conexión a Supabase.");
      const { error } = await supabase.rpc("eliminar_sede", { p_sede: sedeId });
      if (error) throw new Error(error.message);
      await recargar("sedes", "rits");
    },
    // ADQ — Edición manual de un activo: corregir el código (caso «falta
    // corregir» de la importación) y los datos del equipo. Lo escrito MANDA.
    editarActivo: async (codigo, cambios) => {
      if (!supabaseListo) throw new Error("La edición real requiere conexión a Supabase.");
      const { error } = await supabase.rpc("editar_activo", {
        p_codigo: codigo, p_nuevo_codigo: cambios.codigo, p_tipo: cambios.tipo,
        p_marca: cambios.marca, p_modelo: cambios.modelo, p_serie: cambios.serie,
        p_area: cambios.area, p_asignado_sin_confirmar: cambios.asignadoSinConfirmar,
        p_observaciones: cambios.observaciones, p_ip: cambios.ip ?? null,
        p_por: user?.nombre ?? "Gestión de TI",
      });
      if (error) throw new Error(error.message);
      await recargar("activos");
    },
    // Clave del equipo: solo superadmin (la RPC lo impone y todo acceso se audita).
    guardarClaveEquipo: async (codigo, clave) => {
      if (!supabaseListo) throw new Error("Requiere conexión a Supabase.");
      const { error } = await supabase.rpc("guardar_clave_equipo", {
        p_codigo: codigo, p_clave: clave, p_por: user?.nombre ?? "Gestión de TI",
      });
      if (error) throw new Error(error.message);
      await recargar("activos");
    },
    verClaveEquipo: async (codigo) => {
      if (!supabaseListo) throw new Error("Requiere conexión a Supabase.");
      const { data, error } = await supabase.rpc("ver_clave_equipo", {
        p_codigo: codigo, p_por: user?.nombre ?? "Gestión de TI",
      });
      if (error) throw new Error(error.message);
      return data;
    },
    // SOP — Soporte: tickets de incidencias TI. La creación devuelve el número
    // (TK-000N); el aviso por correo lo dispara la pantalla (fire-and-forget).
    crearTicketAdmin: async (dni, tipoId, subtipoId, comentario) => {
      if (!supabaseListo) throw new Error("Los tickets reales requieren conexión a Supabase.");
      const { data, error } = await supabase.rpc("crear_ticket_admin", {
        p_dni: dni, p_tipo: tipoId, p_subtipo: subtipoId ?? null,
        p_comentario: comentario ?? null, p_por: user?.nombre ?? "Soporte",
      });
      if (error) throw new Error(error.message);
      await recargar("tickets");
      return data;
    },
    actualizarTicket: async (id, { estado, atendidoPor, nota }) => {
      if (!supabaseListo) throw new Error("Los tickets reales requieren conexión a Supabase.");
      const { error } = await supabase.rpc("actualizar_ticket", {
        p_id: id, p_estado: estado ?? null, p_atendido_por: atendidoPor ?? null,
        p_nota: nota ?? null, p_por: user?.nombre ?? "Soporte",
      });
      if (error) throw new Error(error.message);
      await recargar("tickets");
    },
    guardarTicketTipo: async (id, nombre) => {
      const { error } = await supabase.rpc("guardar_ticket_tipo", { p_id: id, p_nombre: nombre });
      if (error) throw new Error(error.message);
      await recargar("ticketConfig");
    },
    guardarTicketSubtipo: async (id, tipoId, nombre) => {
      const { error } = await supabase.rpc("guardar_ticket_subtipo", { p_id: id, p_tipo: tipoId, p_nombre: nombre });
      if (error) throw new Error(error.message);
      await recargar("ticketConfig");
    },
    alternarTicketTipo: (id, activo) => rpc("alternar_ticket_tipo", { p_id: id, p_activo: activo }, "ticketConfig"),
    alternarTicketSubtipo: (id, activo) => rpc("alternar_ticket_subtipo", { p_id: id, p_activo: activo }, "ticketConfig"),
    guardarTicketAviso: async (correo, activo) => {
      const { error } = await supabase.rpc("guardar_ticket_aviso", { p_correo: correo, p_activo: activo });
      if (error) throw new Error(error.message);
      await recargar("ticketAvisos");
    },
    eliminarTicketAviso: async (correo) => {
      const { error } = await supabase.rpc("eliminar_ticket_aviso", { p_correo: correo });
      if (error) throw new Error(error.message);
      await recargar("ticketAvisos");
    },
    // SOL — Centro de Solicitudes. La creación devuelve el correlativo
    // (PAP-NEG-2026-0001); los avisos por correo los dispara la pantalla.
    crearSolicitudAdmin: async (dni, tipoId, datos) => {
      if (!supabaseListo) throw new Error("Las solicitudes reales requieren conexión a Supabase.");
      const { data, error } = await supabase.rpc("crear_solicitud_admin", {
        p_dni: dni, p_tipo: tipoId, p_datos: datos, p_por: user?.nombre ?? "RRHH",
      });
      if (error) throw new Error(error.message);
      await recargar("solicitudes");
      return data;
    },
    resolverSolicitud: async (id, decision, comentario) => {
      if (!supabaseListo) throw new Error("Las solicitudes reales requieren conexión a Supabase.");
      const { error } = await supabase.rpc("resolver_solicitud", {
        p_id: id, p_decision: decision, p_comentario: comentario ?? null,
        p_por: user?.nombre ?? "RRHH",
      });
      if (error) throw new Error(error.message);
      await recargar("solicitudes");
    },
    reenviarSolicitud: async (id, datos) => {
      const { error } = await supabase.rpc("reenviar_solicitud", {
        p_id: id, p_datos: datos, p_por: user?.nombre ?? "RRHH",
      });
      if (error) throw new Error(error.message);
      await recargar("solicitudes", "misSolicitudes");
    },
    // Botón global: la solicitud PROPIA del usuario administrativo (sin
    // requisito de módulo; el solicitante sale de su usuario).
    crearSolicitudPropia: async (tipoId, datos) => {
      if (!supabaseListo) throw new Error("Las solicitudes reales requieren conexión a Supabase.");
      const { data, error } = await supabase.rpc("crear_solicitud_propia", {
        p_tipo: tipoId, p_datos: datos,
      });
      if (error) throw new Error(error.message);
      await recargar("solicitudes", "misSolicitudes");
      return data;
    },
    // Historial de una solicitud: se consulta al abrir el detalle.
    eventosSolicitud: async (id) => {
      if (!supabaseListo) return [];
      const { data, error } = await supabase
        .from("v_solicitud_eventos").select("*").eq("solicitud_id", id);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    guardarSolicitudAviso: async (tipoId, correo, copia, activo) => {
      const { error } = await supabase.rpc("guardar_solicitud_aviso", {
        p_tipo: tipoId, p_correo: correo, p_copia: copia, p_activo: activo,
      });
      if (error) throw new Error(error.message);
      await recargar("solicitudAvisos");
    },
    eliminarSolicitudAviso: async (id) => {
      const { error } = await supabase.rpc("eliminar_solicitud_aviso", { p_id: id });
      if (error) throw new Error(error.message);
      await recargar("solicitudAvisos");
    },
    // Al aprobar: genera el PDF con membrete de la RS y lo archiva al legajo.
    // Idempotente por número; devuelve { documentoId } o { error }.
    generarPdfSolicitud: async (numero) => {
      const r = await llamarServerless("/api/solicitud-pdf", { numero });
      if (!r.error) await recargar("solicitudes");
      return r;
    },
    // ADQ-08 — Importación de inventario de activos (Formato 7.1). La vista
    // previa es de solo lectura (patrón PV999 en Postgres); la confirmación es
    // un único RPC transaccional. Los bloqueos (duplicado, otra empresa)
    // llegan como error del RPC y detienen todo.
    previsualizarImportacionActivos: async (empresaIdArg, activos, razonSocial, archivo) => {
      if (!supabaseListo) throw new Error("La importación de inventario requiere conexión a Supabase.");
      const { data, error } = await supabase.rpc("previsualizar_importacion_activos", {
        p_empresa: empresaIdArg, p_activos: activos, p_razon_social: razonSocial, p_archivo: archivo,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    importarActivos: async (empresaIdArg, activos, razonSocial, archivo) => {
      if (!supabaseListo) throw new Error("La importación de inventario requiere conexión a Supabase.");
      const { data, error } = await supabase.rpc("importar_activos", {
        p_empresa: empresaIdArg, p_activos: activos, p_razon_social: razonSocial,
        p_archivo: archivo, p_por: user?.nombre ?? user?.correo ?? "Administración",
      });
      if (error) throw new Error(error.message);
      await recargar("activos");
      return data;
    },
    // RRH-22 — Importación de asistencias (#8). Vista previa PV999; la
    // importación reemplaza el rango completo (idempotente). La consulta de
    // marcaciones NO va por FUENTES: se pide por empresa+fecha bajo demanda
    // (la tabla crece por día y una recarga completa truncaría en 1000 filas).
    previsualizarAsistencia: async (empresaIdArg, registros, archivo, resumen) => {
      if (!supabaseListo) throw new Error("La importación de asistencia requiere conexión a Supabase.");
      const { data, error } = await supabase.rpc("previsualizar_asistencia", {
        p_empresa: empresaIdArg, p_registros: registros, p_archivo: archivo, p_resumen: resumen,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    importarAsistencia: async (empresaIdArg, registros, archivo, resumen) => {
      if (!supabaseListo) throw new Error("La importación de asistencia requiere conexión a Supabase.");
      const { data, error } = await supabase.rpc("importar_asistencia", {
        p_empresa: empresaIdArg, p_registros: registros, p_archivo: archivo,
        p_resumen: resumen, p_por: user?.nombre ?? user?.correo ?? "Administración",
      });
      if (error) throw new Error(error.message);
      await recargar("asistenciaLotes");
      return data;
    },
    cargarMarcaciones: async (empresaIdArg, fecha) => {
      if (!supabaseListo) return [];
      const { data, error } = await supabase.from("v_marcaciones").select("*")
        .eq("empresa", empresaIdArg).eq("fecha", fecha)
        .order("reconocido", { ascending: false }).order("nombre");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    // RRH-22 — CONTROL SEMANAL (spec Tareas 31-08): multi-empresa resuelto
    // por documento contra el padrón (la RS de cada fila sale del vínculo).
    // Vista previa PV999; reimportar el rango reemplaza, jamás duplica.
    previsualizarControl: async (registros, trabajadores, archivo) => {
      if (!supabaseListo) throw new Error("La importación del control requiere conexión a Supabase.");
      const { data, error } = await supabase.rpc("previsualizar_control", {
        p_registros: registros, p_trabajadores: trabajadores, p_archivo: archivo,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    importarControl: async (registros, trabajadores, archivo) => {
      if (!supabaseListo) throw new Error("La importación del control requiere conexión a Supabase.");
      const { data, error } = await supabase.rpc("importar_control", {
        p_registros: registros, p_trabajadores: trabajadores, p_archivo: archivo,
        p_por: user?.nombre ?? user?.correo ?? "RRHH",
      });
      if (error) throw new Error(error.message);
      await recargar("asistenciaLotes", "personal");
      return data;
    },
    // Calendario de feriados ADMINISTRADO: agregar o retirar uno recalcula el
    // mes afectado de todos los que tengan control importado (y los días
    // cambiados quedan marcados «recalculado» con el motivo).
    cargarFeriados: async () => {
      if (!supabaseListo) return [];
      const { data, error } = await supabase.from("v_feriados").select("*");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    guardarFeriado: async (fecha, nombre) => {
      if (!supabaseListo) throw new Error("Requiere conexión a Supabase.");
      const { data, error } = await supabase.rpc("guardar_feriado", {
        p_fecha: fecha, p_nombre: nombre, p_por: user?.nombre ?? "BackOffice",
      });
      if (error) throw new Error(error.message);
      return data; // trabajadores recalculados
    },
    eliminarFeriado: async (fecha) => {
      if (!supabaseListo) throw new Error("Requiere conexión a Supabase.");
      const { data, error } = await supabase.rpc("eliminar_feriado", {
        p_fecha: fecha, p_por: user?.nombre ?? "BackOffice",
      });
      if (error) throw new Error(error.message);
      return data;
    },
    // Tablero mensual del control, agrupado por centro de costo (bajo demanda:
    // un mes por consulta; el alcance por RS lo aplica la pantalla).
    tableroAsistencia: async (empresaIdArg, periodo) => {
      if (!supabaseListo) return [];
      const { data, error } = await supabase.from("v_asistencia_mensual").select("*")
        .eq("empresa", empresaIdArg).eq("periodo", periodo)
        .order("centroCosto").order("nombre");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    // RRH-06→10 — Carga real de boletas desde PDF consolidado (Task 14). El
    // análisis/división/hash/subida a Storage ocurren en la pantalla (Boletas.jsx,
    // necesita progreso y reintento por archivo); esta acción es solo la
    // publicación transaccional final: crea el lote y sus documentos en un
    // único RPC y refresca las vistas que dependen de él.
    publicarLotePdf: async ({ empresaId: empresaIdArg, tipo, periodo, boletas }) => {
      if (!supabaseListo) throw new Error("Publicación real requiere conexión a Supabase.");
      const { data, error } = await supabase.rpc("publicar_lote_pdf", {
        p_empresa: empresaIdArg, p_tipo: tipo, p_periodo: periodo,
        p_por: user?.nombre ?? "RRHH", p_boletas: boletas,
      });
      if (error) throw new Error(error.message);
      await recargar("lotes", "acuses");
      return data;
    },
    addEpp: (rows) => {
      local("epp_entregas", (xs) => [...rows, ...xs]);
      (async () => {
        for (const r of rows) {
          await rpc("registrar_epp", {
            p_dni: r.dni, p_items: r.items, p_entrega: r.entrega, p_reposicion: r.reposicion,
          });
        }
        await recargar("epp_entregas");
      })();
    },
  };

  return (
    <AppCtx.Provider
      value={{ user, salir, claveCambiada, empresaId, setEmpresaId, empresa, db, empresasActivas, origen, persona, sede, empresaPor, recargar, ...acciones }}
    >
      {children}
    </AppCtx.Provider>
  );
}

export const useApp = () => useContext(AppCtx);
