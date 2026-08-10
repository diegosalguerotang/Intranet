import { NavLink, Outlet, Navigate, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, FileText, CheckSquare, Megaphone, AlertTriangle,
  Clock, FileSignature, Boxes, Smartphone, HardHat, PieChart, LogOut, Building2,
} from "lucide-react";
import { useApp } from "../state";

const NAV_RRHH = [
  { to: "/rrhh", icon: LayoutDashboard, label: "Tablero", code: "RRH-01", end: true },
  { to: "/rrhh/personal", icon: Users, label: "Personal", code: "RRH-02" },
  { to: "/rrhh/boletas", icon: FileText, label: "Carga de boletas", code: "RRH-06" },
  { to: "/rrhh/acuses", icon: CheckSquare, label: "Acuses", code: "RRH-11" },
  { to: "/rrhh/comunicados", icon: Megaphone, label: "Comunicados", code: "RRH-16" },
  { to: "/rrhh/memorandums", icon: AlertTriangle, label: "Memorándums", code: "RRH-18" },
  { to: "/rrhh/contratos", icon: FileSignature, label: "Contratos", code: "RRH-14" },
  { to: "/rrhh/tardanzas", icon: Clock, label: "Tardanzas", code: "RRH-20" },
];

const NAV_ADMIN = [
  { to: "/admin/activos", icon: Boxes, label: "Inventario de activos", code: "ADQ-01" },
  { to: "/admin/lineas", icon: Smartphone, label: "Líneas móviles", code: "ADQ-05" },
  { to: "/admin/epp", icon: HardHat, label: "EPP y uniformes", code: "ADQ-06" },
  { to: "/admin/costos", icon: PieChart, label: "Costo por sede", code: "ADQ-07" },
];

function NavGroup({ title, items }) {
  return (
    <div>
      <h3 className="mb-2 mt-6 px-3 text-[10.5px] font-bold uppercase tracking-[0.14em] text-gris-cl first:mt-0">
        {title}
      </h3>
      {items.map(({ to, icon: Icon, label, code, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `mb-0.5 flex items-center gap-2.5 rounded-[4px] border-l-[3px] px-3 py-2 text-[13px] font-medium transition-colors ${
              isActive
                ? "border-pend bg-pend-bg font-semibold text-pend"
                : "border-transparent text-gris hover:bg-papel hover:text-tinta"
            }`
          }
        >
          {({ isActive }) => (
            <>
              <Icon size={15} className={`shrink-0 ${isActive ? "text-pend" : "text-petroleo"}`} />
              <span className="flex-1">{label}</span>
              <span className="font-mono text-[9px] text-gris-cl">{code}</span>
            </>
          )}
        </NavLink>
      ))}
    </div>
  );
}

export default function Shell() {
  const { user, setUser, empresaId, setEmpresaId, db, origen } = useApp();
  const navigate = useNavigate();

  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-borde bg-white px-3.5 py-5 shadow-[2px_0_6px_rgba(0,0,0,0.05)]">
        <div className="mb-6 px-3">
          <div className="text-[16px] font-bold tracking-tight text-tinta">
            Grupo<span className="text-petroleo">ER</span>
          </div>
          <div className="text-[9.5px] font-medium uppercase tracking-[0.18em] text-acero">
            Intranet · BackOffice
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto">
          <NavGroup title="Recursos Humanos" items={NAV_RRHH} />
          <NavGroup title="Administración" items={NAV_ADMIN} />
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
            onClick={() => { setUser(null); navigate("/login"); }}
            className="mt-3 flex items-center gap-1.5 text-[11.5px] font-medium text-gris-cl hover:text-pend"
          >
            <LogOut size={13} /> Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="ml-[248px] flex-1">
        <header className="sticky top-0 z-30 flex h-[52px] items-center gap-3 bg-white px-5 shadow-[0_1px_6px_rgba(0,0,0,0.12)]">
          <Building2 size={16} className="text-petroleo" />
          <select
            value={empresaId}
            onChange={(e) => setEmpresaId(e.target.value)}
            className="rounded-[4px] border border-borde-f bg-white px-2.5 py-1.5 text-[13px] font-semibold text-tinta focus:border-petroleo focus:outline-none"
          >
            {db.empresas.map((e) => (
              <option key={e.id} value={e.id}>{e.nombre}</option>
            ))}
          </select>
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
