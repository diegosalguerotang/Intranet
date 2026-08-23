// Catálogo de bancos (#10 Fase 1). El archivo unificado trae el banco como
// texto libre y hasta mal escrito ("Banco Scotianbank"): aquí se canoniza a
// un código estable y nada se guarda como texto libre. Espejo del catálogo
// SQL (tabla bancos + fn_resolver_banco): mantener ambos sincronizados.
export const BANCOS = [
  { codigo: "bcp", nombre: "BCP", alias: ["banco de credito", "banco de credito del peru", "credito", "banco credito"] },
  { codigo: "bbva", nombre: "BBVA", alias: ["continental", "banco continental", "bbva continental"] },
  { codigo: "scotiabank", nombre: "Scotiabank", alias: ["scotianbank", "banco scotianbank", "banco scotiabank"] },
  { codigo: "interbank", nombre: "Interbank", alias: ["banco interbank", "banco internacional del peru"] },
  { codigo: "nacion", nombre: "Banco de la Nación", alias: ["banco de la nacion", "nacion"] },
  { codigo: "banbif", nombre: "BanBif", alias: ["banco interamericano de finanzas"] },
  { codigo: "pichincha", nombre: "Banco Pichincha", alias: ["banco financiero"] },
];

// Normaliza para casar: minúsculas, sin tildes, sin el prefijo "banco ".
const normalizar = (t) => String(t ?? "")
  .toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/\s+/g, " ")
  .trim();

export function resolverBanco(texto) {
  const buscado = normalizar(texto);
  if (!buscado) return null;
  const sinPrefijo = buscado.replace(/^banco (de |del |de la )?/, "");
  for (const b of BANCOS) {
    const candidatos = [normalizar(b.nombre), b.codigo, ...b.alias.map(normalizar)];
    if (candidatos.includes(buscado) || candidatos.includes(sinPrefijo)) {
      return { codigo: b.codigo, nombre: b.nombre };
    }
  }
  return null;
}
