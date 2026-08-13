// Componentes mínimos del portal (estética GrupoER v2 en versión ligera).

export function Tarjeta({ children, className = "" }) {
  return (
    <div className={`rounded-caja border border-borde bg-white p-4 shadow-[0_2px_10px_rgba(29,63,114,0.06)] ${className}`}>
      {children}
    </div>
  );
}

export function Boton({ variante = "primario", className = "", ...props }) {
  const variantes = {
    primario: "bg-petroleo text-white active:bg-petroleo-cl disabled:opacity-40",
    secundario: "border-2 border-petroleo text-petroleo bg-white active:bg-petroleo/10 disabled:opacity-40",
    peligro: "bg-alerta text-white disabled:opacity-40",
  };
  return (
    <button
      className={`w-full rounded-full px-5 py-3 text-[16px] font-semibold disabled:cursor-not-allowed ${variantes[variante]} ${className}`}
      {...props}
    />
  );
}

export function Nota({ tono = "pend", children }) {
  const tonos = {
    pend: "border-pend/30 bg-pend-bg text-pend",
    alerta: "border-alerta/30 bg-alerta-bg text-alerta",
    conf: "border-conf/30 bg-conf-bg text-conf",
    neutral: "border-borde bg-white text-gris",
  };
  return (
    <div className={`animar-aparicion rounded-caja border px-3.5 py-3 text-[13.5px] leading-relaxed ${tonos[tono]}`}>
      {children}
    </div>
  );
}

export function Etiqueta({ tono = "neutral", children }) {
  const tonos = {
    pend: "bg-pend-bg text-pend",
    conf: "bg-conf-bg text-conf",
    alerta: "bg-alerta-bg text-alerta",
    neutral: "bg-papel text-gris border border-borde",
  };
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${tonos[tono]}`}>
      {children}
    </span>
  );
}

export function Cargando() {
  return (
    <div className="space-y-3 p-4" aria-label="Cargando">
      <div className="h-5 w-2/3 animate-pulse rounded-caja bg-borde" />
      <div className="h-24 animate-pulse rounded-caja bg-borde" />
      <div className="h-24 animate-pulse rounded-caja bg-borde" />
    </div>
  );
}

export function Vacio({ titulo, detalle }) {
  return (
    <div className="rounded-caja border border-dashed border-borde-f bg-white px-5 py-8 text-center">
      <div className="text-[15px] font-semibold text-tinta">{titulo}</div>
      {detalle && <div className="mt-1 text-[13px] text-gris-cl">{detalle}</div>}
    </div>
  );
}
