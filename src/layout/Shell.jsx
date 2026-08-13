import { useEffect } from "react";
import { NavLink, Outlet, Navigate, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, FileText, CheckSquare, Megaphone, AlertTriangle,
  Clock, FileSignature, Boxes, Smartphone, HardHat, PieChart, LogOut, Building2,
  UserCog, ShieldCheck, KeyRound, ScrollText,
} from "lucide-react";
import { useApp } from "../state";
import { nivelDe, MODULOS_RRHH } from "../data/modulos";
import CambioClave from "../pages/CambioClave";

// Cada item declara su módulo: el menú solo muestra lo que la categoría del
// usuario concede (enforcement de Accesos v2; el guard de ruta lo respalda).
const NAV_RRHH = [
  { to: "/rrhh", icon: LayoutDashboard, label: "Tablero", code: "RRH-01", end: true, modulo: MODULOS_RRHH },
  { to: "/rrhh/personal", icon: Users, label: "Personal", code: "RRH-02", modulo: "personal" },
  { to: "/rrhh/boletas", icon: FileText, label: "Carga de boletas", code: "RRH-06", modulo: "boletas" },
  { to: "/rrhh/acuses", icon: CheckSquare, label: "Acuses", code: "RRH-11", modulo: "acuses" },
  { to: "/rrhh/comunicados", icon: Megaphone, label: "Comunicados", code: "RRH-16", modulo: "comunicados" },
  { to: "/rrhh/memorandums", icon: AlertTriangle, label: "Memorándums", code: "RRH-18", modulo: "memorandums" },
  { to: "/rrhh/contratos", icon: FileSignature, label: "Contratos", code: "RRH-14", modulo: "contratos" },
  { to: "/rrhh/tardanzas", icon: Clock, label: "Tardanzas", code: "RRH-20", modulo: "tardanzas" },
];

const NAV_ADMIN = [
  { to: "/admin/activos", icon: Boxes, label: "Inventario de activos", code: "ADQ-01", modulo: "activos" },
  { to: "/admin/lineas", icon: Smartphone, label: "Líneas móviles", code: "ADQ-05", modulo: "activos" },
  { to: "/admin/epp", icon: HardHat, label: "EPP y uniformes", code: "ADQ-06", modulo: "activos" },
  { to: "/admin/costos", icon: PieChart, label: "Costo por sede", code: "ADQ-07", modulo: "activos" },
];

const NAV_ACCESOS = [
  { to: "/accesos/usuarios", icon: UserCog, label: "Usuarios administrativos", code: "ACC-01", modulo: "accesos" },
  { to: "/accesos/perfiles", icon: ShieldCheck, label: "Categorías", code: "ACC-03", modulo: "accesos" },
  { to: "/accesos/politica", icon: KeyRound, label: "Política de acceso", code: "ACC-05", modulo: "accesos" },
  { to: "/accesos/registro", icon: ScrollText, label: "Registro de accesos", code: "ACC-06", modulo: "auditoria" },
];

function NavGroup({ title, items, acceso }) {
  const visibles = items.filter((i) => nivelDe(acceso, i.modulo) >= 1);
  if (!visibles.length) return null;
  return (
    <div>
      <h3 className="mb-2 mt-6 px-3 text-[10.5px] font-bold uppercase tracking-[0.14em] text-gris-cl first:mt-0">
        {title}
      </h3>
      {visibles.map(({ to, icon: Icon, label, code, end }) => (
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
      ))}
    </div>
  );
}

export default function Shell() {
  const { user, salir, empresaId, setEmpresaId, db, origen } = useApp();
  const navigate = useNavigate();

  // Selector de empresa restringido al alcance de la categoría.
  const acceso = user?.acceso ?? (user ? { esSuperadmin: user.esSuperadmin, matriz: {}, empresas: [] } : null);
  const empresasVisibles = acceso?.esSuperadmin
    ? db.empresas
    : db.empresas.filter((e) => (acceso?.empresas ?? []).includes(e.id));
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
          <NavGroup title="Administración" items={NAV_ADMIN} acceso={acceso} />
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
    </div>
  );
}
