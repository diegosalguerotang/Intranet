import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, Navigate, useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Users, FileText, CheckSquare, Megaphone, AlertTriangle,
  Clock, FileSignature, Boxes, Smartphone, HardHat, LogOut, Building2,
  UserCog, ShieldCheck, KeyRound, ScrollText, MapPin, LifeBuoy, Settings2,
  Inbox, BellRing, BarChart3, ChevronDown, ClipboardPen,
} from "lucide-react";
import { useApp } from "../state";
import { nivelDe, MODULOS_RRHH } from "../data/modulos";
import CambioClave from "../pages/CambioClave";

// Cada item declara su módulo: el menú solo muestra lo que la categoría del
// usuario concede (enforcement de Accesos v2; el guard de ruta lo respalda).
const NAV_RRHH = [
  { to: "/rrhh", icon: LayoutDashboard, label: "Tablero", code: "RRH-01", end: true, modulo: MODULOS_RRHH },
  { to: "/rrhh/personal", icon: Users, label: "Planilla", code: "RRH-02", modulo: "personal" },
  { to: "/rrhh/sedes", icon: MapPin, label: "Sedes", code: "RRH-21", modulo: "personal" },
  { to: "/rrhh/boletas", icon: FileText, label: "Carga de boletas", code: "RRH-06", modulo: "boletas" },
  { to: "/rrhh/acuses", icon: CheckSquare, label: "Acuses", code: "RRH-11", modulo: "acuses" },
  { to: "/rrhh/comunicados", icon: Megaphone, label: "Comunicados", code: "RRH-16", modulo: "comunicados" },
  { to: "/rrhh/memorandums", icon: AlertTriangle, label: "Memorándums", code: "RRH-18", modulo: "memorandums" },
  { to: "/rrhh/contratos", icon: FileSignature, label: "Contratos", code: "RRH-14", modulo: "contratos" },
  { to: "/rrhh/tardanzas", icon: Clock, label: "Tardanzas", code: "RRH-20", modulo: "tardanzas" },
];

// Costo por sede (ADQ-07) retirado a pedido de Diego (2026-08-17): no sirve
// por ahora. EPP queda visible pero deshabilitado («Próximamente»).
const NAV_ADMIN = [
  { to: "/admin/activos", icon: Boxes, label: "Inventario de activos", code: "ADQ-01", modulo: "activos" },
  { to: "/admin/lineas", icon: Smartphone, label: "Líneas móviles", code: "ADQ-05", modulo: "activos" },
  { to: "/admin/epp", icon: HardHat, label: "EPP y uniformes", code: "ADQ-06", modulo: "activos", proximamente: true },
];

// El módulo Solicitudes es de los RESPONSABLES de responder (Diego,
// 2026-08-19): crear la propia va por el botón global «Mi solicitud», y
// registrar a nombre de un trabajador es una acción dentro de la Bandeja.
const NAV_SOLICITUDES = [
  { to: "/solicitudes", icon: Inbox, label: "Bandeja", code: "SOL-01", end: true, modulo: "solicitudes" },
  { to: "/solicitudes/tablero", icon: BarChart3, label: "Tablero mensual", code: "SOL-04", modulo: "solicitudes" },
  { to: "/solicitudes/avisos", icon: BellRing, label: "Avisos por correo", code: "SOL-03", modulo: "solicitudes" },
];

const NAV_SOPORTE = [
  { to: "/soporte/tickets", icon: LifeBuoy, label: "Tickets", code: "SOP-01", modulo: "soporte" },
  { to: "/soporte/config", icon: Settings2, label: "Config. de tickets", code: "SOP-02", modulo: "soporte" },
];

const NAV_ACCESOS = [
  { to: "/accesos/usuarios", icon: UserCog, label: "Usuarios administrativos", code: "ACC-01", modulo: "accesos" },
  { to: "/accesos/perfiles", icon: ShieldCheck, label: "Categorías", code: "ACC-03", modulo: "accesos" },
  { to: "/accesos/politica", icon: KeyRound, label: "Política de acceso", code: "ACC-05", modulo: "accesos" },
  { to: "/accesos/registro", icon: ScrollText, label: "Registro de accesos", code: "ACC-06", modulo: "auditoria" },
];

function NavGroup({ title, items, acceso }) {
  const { pathname } = useLocation();
  const visibles = items.filter((i) => nivelDe(acceso, i.modulo) >= 1);
  // Plegable (Diego, 2026-08-19): TODO arranca contraído siempre; la flechita
  // despliega o contrae. Al navegar HACIA una pantalla de un grupo contraído
  // (enlace directo), ese grupo se abre para orientar; contraerlo estando
  // dentro se respeta (no cambia la ruta). Nada se persiste: cada carga de la
  // app vuelve a empezar con el menú corto.
  const contieneActiva = visibles.some((i) => pathname === i.to || pathname.startsWith(i.to + "/"));
  const [abierto, setAbierto] = useState(false);
  const rutaPrevia = useRef(pathname);
  const alternar = () => setAbierto((v) => !v);
  useEffect(() => {
    if (rutaPrevia.current !== pathname && contieneActiva) setAbierto(true);
    rutaPrevia.current = pathname;
  }, [pathname]);
  if (!visibles.length) return null;
  return (
    <div>
      <button
        type="button"
        onClick={alternar}
        aria-expanded={abierto}
        className="mb-2 mt-6 flex w-full items-center gap-1.5 px-3 text-left text-[10.5px] font-bold uppercase tracking-[0.14em] text-gris-cl transition-colors hover:text-tinta first:mt-0"
      >
        <span className="flex-1">{title}</span>
        <ChevronDown
          size={13}
          className={`shrink-0 transition-transform duration-200 ${abierto ? "" : "-rotate-90"}`}
        />
      </button>
      {abierto && visibles.map(({ to, icon: Icon, label, code, end, proximamente }) =>
        proximamente ? (
          // Módulo anunciado pero aún sin función: gris y sin click.
          <div
            key={to}
            className="mb-1 flex cursor-not-allowed items-center gap-2.5 rounded-caja px-3 py-2 text-[13px] font-medium text-gris-cl opacity-70"
            title="Próximamente"
          >
            <Icon size={15} className="shrink-0 text-gris-cl" />
            <span className="flex-1">{label}</span>
            <span className="rounded-full bg-papel px-2 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-wide text-gris-cl">
              Próximamente
            </span>
          </div>
        ) : (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `mb-1 flex items-center gap-2.5 rounded-caja px-3 py-2 text-[13px] font-medium ${
              isActive
                ? "bg-petroleo font-semibold text-white shadow-[0_2px_8px_rgba(53,105,160,0.35)]"
                : "text-gris hover:translate-x-0.5 hover:bg-papel hover:text-tinta"
            }`
          }
        >
          {({ isActive }) => (
            <>
              <Icon size={15} className={`shrink-0 ${isActive ? "text-white" : "text-petroleo"}`} />
              <span className="flex-1">{label}</span>
              <span className={`font-mono text-[9px] ${isActive ? "text-white/70" : "text-gris-cl"}`}>{code}</span>
            </>
          )}
        </NavLink>
        )
      )}
    </div>
  );
}

export default function Shell() {
  const { user, salir, empresaId, setEmpresaId, empresasActivas, origen, db } = useApp();
  // Buzón personal: cuántas de MIS solicitudes siguen sin respuesta (enviadas)
  // o me fueron devueltas para corregir (observadas). Alimenta el globito del
  // botón flotante para que el usuario sepa que hay movimiento sin navegar.
  const misPendientes = (db?.misSolicitudes ?? []).filter(
    (s) => s.estado === "enviada" || s.estado === "observada"
  ).length;
  const navigate = useNavigate();

  // Selector de empresa restringido al alcance de la categoría. Solo ofrece
  // empresas activas: una empresa retirada no debe poder elegirse para
  // trabajo nuevo, aunque su historial siga accesible desde otras pantallas.
  const acceso = user?.acceso ?? (user ? { esSuperadmin: user.esSuperadmin, matriz: {}, empresas: [] } : null);
  const empresasVisibles = acceso?.esSuperadmin
    ? empresasActivas
    : empresasActivas.filter((e) => (acceso?.empresas ?? []).includes(e.id));
  useEffect(() => {
    if (user && empresasVisibles.length && !empresasVisibles.some((e) => e.id === empresaId)) {
      setEmpresaId(empresasVisibles[0].id);
    }
  }, [user, empresaId, empresasVisibles.length]);

  if (user === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-papel text-[13px] text-gris-cl">
        Verificando sesión…
      </div>
    );
  }
  if (!user) return <Navigate to="/admin/login" replace />;
  if (user.requiereCambio) return <CambioClave />;

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-borde bg-white px-3.5 py-5 shadow-[2px_0_6px_rgba(0,0,0,0.05)]">
        <div className="mb-6 px-3">
          <div className="font-display text-[16px] font-bold tracking-tight text-tinta">
            Grupo<span className="text-petroleo">ER</span>
          </div>
          <div className="text-[9.5px] font-medium uppercase tracking-[0.18em] text-acero">
            Intranet · BackOffice
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto">
          <NavGroup title="Accesos y Roles" items={NAV_ACCESOS} acceso={acceso} />
          <NavGroup title="Recursos Humanos" items={NAV_RRHH} acceso={acceso} />
          <NavGroup title="Solicitudes" items={NAV_SOLICITUDES} acceso={acceso} />
          <NavGroup title="Gestión de TI" items={NAV_ADMIN} acceso={acceso} />
          <NavGroup title="Soporte" items={NAV_SOPORTE} acceso={acceso} />
        </nav>

        <div className="mt-4 border-t border-borde px-3 pt-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-petroleo text-[13px] font-bold text-white">
              {user.nombre.split(" ").map((p) => p[0]).slice(0, 2).join("")}
            </div>
            <div>
              <div className="text-[12.5px] font-semibold leading-tight text-tinta">{user.nombre}</div>
              <div className="text-[11px] text-gris-cl">{user.rol}</div>
            </div>
          </div>
          <button
            onClick={async () => { await salir(); navigate("/admin/login"); }}
            className="mt-3 flex items-center gap-1.5 text-[11.5px] font-medium text-gris-cl hover:text-pend"
          >
            <LogOut size={13} /> Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="ml-[248px] flex-1">
        <header className="sticky top-0 z-30 flex h-[52px] items-center gap-3 bg-white px-5 shadow-[0_1px_6px_rgba(0,0,0,0.12)]">
          <Building2 size={16} className="text-petroleo" />
          {empresasVisibles.length === 1 ? (
            <span className="text-[13px] font-semibold text-tinta">{empresasVisibles[0].nombre}</span>
          ) : (
            <select
              value={empresaId}
              onChange={(e) => setEmpresaId(e.target.value)}
              className="rounded-caja border border-borde-f bg-white px-2.5 py-1.5 text-[13px] font-semibold text-tinta focus:border-petroleo focus:shadow-[0_0_0_3px_rgba(53,105,160,0.14)] focus:outline-none"
            >
              {empresasVisibles.map((e) => (
                <option key={e.id} value={e.id}>{e.nombre}</option>
              ))}
            </select>
          )}
          <span className="ml-auto font-mono text-[10.5px] text-gris-cl">
            {origen === "supabase" ? "Conectado a Supabase" : "Datos locales de demostración"}
          </span>
        </header>
        <main className="mx-auto max-w-[1180px] px-6 py-7">
          <Outlet />
        </main>
      </div>
      {/* Botón global «Mi solicitud» (Diego, 2026-08-19): cualquier usuario
          autenticado registra su propia solicitud, tenga o no el módulo. */}
      <NavLink
        to="/mi-solicitud"
        title="Mi solicitud"
        className={({ isActive }) =>
          `fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full px-4 py-3 text-[13px] font-semibold shadow-[0_4px_16px_rgba(53,105,160,0.4)] transition-transform hover:-translate-y-0.5 ${
            isActive ? "bg-tinta text-white" : "bg-petroleo text-white"
          }`
        }
      >
        <ClipboardPen size={16} />
        Mi solicitud
        {misPendientes > 0 && (
          <span className="ml-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 font-mono text-[10.5px] font-bold text-petroleo">
            {misPendientes}
          </span>
        )}
      </NavLink>
    </div>
  );
}
