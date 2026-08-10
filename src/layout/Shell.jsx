import { NavLink, Outlet, Navigate, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, FileText, CheckSquare, Megaphone, AlertTriangle,
  Clock, FileSignature, Boxes, Smartphone, HardHat, PieChart, LogOut, Building2,
} from "lucide-react";
import { useApp } from "../state";
import { EMPRESAS } from "../data/mock";

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
      <h3 className="mb-2 mt-6 px-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[#6d949e] first:mt-0">
        {title}
      </h3>
      {items.map(({ to, icon: Icon, label, code, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `mb-0.5 flex items-center gap-2.5 rounded-[5px] border-l-2 px-3 py-2 text-[12.5px] font-medium transition-colors ${
              isActive
                ? "border-pend bg-[#1c4553] font-semibold text-white"
                : "border-transparent text-[#b4c8cd] hover:bg-[#183b47]"
            }`
          }
        >
          <Icon size={15} className="shrink-0" />
          <span className="flex-1">{label}</span>
          <span className="font-mono text-[9px] text-[#6d949e]">{code}</span>
        </NavLink>
      ))}
    </div>
  );
}

export default function Shell() {
  const { user, setUser, empresaId, setEmpresaId } = useApp();
  const navigate = useNavigate();

  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 flex w-[248px] flex-col bg-tinta-3 px-3.5 py-5">
        <div className="mb-6 px-3">
          <div className="text-[15px] font-bold tracking-tight text-white">Grupo NEGLIAF</div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-[#7fa3ac]">
            Intranet · BackOffice
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto">
          <NavGroup title="Recursos Humanos" items={NAV_RRHH} />
          <NavGroup title="Administración" items={NAV_ADMIN} />
        </nav>

        <div className="mt-4 border-t border-[#234a56] px-3 pt-4">
          <div className="text-[12.5px] font-semibold text-white">{user.nombre}</div>
          <div className="text-[11px] text-[#7fa3ac]">{user.rol}</div>
          <button
            onClick={() => { setUser(null); navigate("/login"); }}
            className="mt-2.5 flex items-center gap-1.5 text-[11.5px] font-medium text-[#8fb0b9] hover:text-white"
          >
            <LogOut size={13} /> Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="ml-[248px] flex-1">
        <header className="sticky top-0 z-40 flex h-[50px] items-center gap-3 border-b border-[#2b4f5a] bg-tinta px-5 text-white">
          <Building2 size={15} className="text-[#7fa3ac]" />
          <select
            value={empresaId}
            onChange={(e) => setEmpresaId(e.target.value)}
            className="rounded-[5px] border border-[#2b4f5a] bg-tinta-2 px-2.5 py-1.5 text-[12.5px] font-semibold text-white focus:outline-none"
          >
            {EMPRESAS.map((e) => (
              <option key={e.id} value={e.id}>{e.nombre}</option>
            ))}
          </select>
          <span className="ml-auto font-mono text-[10.5px] text-[#6d949e]">
            Ambiente de demostración — datos ficticios
          </span>
        </header>
        <main className="mx-auto max-w-[1180px] px-6 py-7">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
