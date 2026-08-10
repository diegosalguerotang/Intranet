import { X } from "lucide-react";

export function PageHeader({ code, title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {code && (
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-gris">{code}</div>
        )}
        <h1 className="mt-0.5 text-xl font-bold tracking-tight text-tinta">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-gris">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "", pad = true }) {
  return (
    <div className={`rounded-md border border-borde bg-white shadow-[0_1px_3px_rgba(12,30,36,0.06)] ${pad ? "p-5" : ""} ${className}`}>
      {children}
    </div>
  );
}

export function Stat({ label, value, tone = "default", hint }) {
  const tones = {
    default: "text-tinta",
    pend: "text-pend",
    conf: "text-conf",
    alerta: "text-alerta",
  };
  return (
    <Card className="flex-1 min-w-[150px]">
      <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-gris">{label}</div>
      <div className={`mt-1.5 text-[26px] font-bold leading-none tracking-tight ${tones[tone]}`}>{value}</div>
      {hint && <div className="mt-1.5 text-[11.5px] text-gris-cl">{hint}</div>}
    </Card>
  );
}

const BADGE_TONES = {
  pend: "bg-pend-bg text-pend",
  conf: "bg-conf-bg text-conf",
  alerta: "bg-alerta-bg text-alerta",
  neutral: "bg-papel text-gris border border-borde",
  tinta: "bg-tinta text-white",
};

export function Badge({ tone = "neutral", children }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-[4px] px-2 py-0.5 text-[11px] font-semibold ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Button({ variant = "primary", size = "md", className = "", ...props }) {
  const variants = {
    primary: "bg-petroleo text-white hover:bg-petroleo-cl",
    secondary: "bg-white text-tinta border border-borde-f hover:bg-papel",
    ghost: "text-petroleo hover:bg-conf-bg/60",
    danger: "bg-alerta text-white hover:opacity-90",
  };
  const sizes = { md: "px-4 py-2 text-[13px]", sm: "px-2.5 py-1.5 text-[12px]" };
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-[5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, hint, required, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-semibold text-tinta-2">
        {label} {required && <span className="text-alerta">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] leading-snug text-gris-cl">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-[5px] border border-borde-f bg-white px-3 py-2 text-[13px] text-tinta placeholder:text-gris-cl focus:border-petroleo-cl focus:outline-none";

export function Input(props) {
  return <input className={inputCls} {...props} />;
}

export function Select({ children, ...props }) {
  return (
    <select className={inputCls} {...props}>
      {children}
    </select>
  );
}

export function Textarea(props) {
  return <textarea className={`${inputCls} min-h-[90px]`} {...props} />;
}

export function Table({ head, children }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-borde-f">
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-gris">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-borde">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className = "", ...props }) {
  return (
    <td className={`px-3 py-2.5 align-middle text-tinta ${className}`} {...props}>
      {children}
    </td>
  );
}

export function EmptyState({ title, body }) {
  return (
    <div className="rounded-md border border-dashed border-borde-f bg-papel/60 px-6 py-10 text-center">
      <div className="text-[14px] font-semibold text-tinta-2">{title}</div>
      {body && <div className="mx-auto mt-1 max-w-md text-[12.5px] text-gris">{body}</div>}
    </div>
  );
}

export function Progress({ value, tone = "conf" }) {
  const tones = { conf: "bg-conf", pend: "bg-pend", petroleo: "bg-petroleo" };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-borde">
      <div className={`h-full rounded-full ${tones[tone]}`} style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-tinta/50 p-4" onClick={onClose}>
      <div
        className={`max-h-[90vh] w-full ${wide ? "max-w-3xl" : "max-w-lg"} overflow-y-auto rounded-lg border border-borde-f bg-white p-6 shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-[16px] font-bold text-tinta">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-gris hover:bg-papel" aria-label="Cerrar">
            <X size={17} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Note({ tone = "pend", children }) {
  const tones = {
    pend: "border-pend/30 bg-pend-bg text-pend",
    alerta: "border-alerta/30 bg-alerta-bg text-alerta",
    conf: "border-conf/30 bg-conf-bg text-conf",
    neutral: "border-borde bg-papel text-gris",
  };
  return <div className={`rounded-[5px] border px-3.5 py-2.5 text-[12.5px] leading-relaxed ${tones[tone]}`}>{children}</div>;
}
