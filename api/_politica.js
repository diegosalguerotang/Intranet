// api/_politica.js — Política de datos v3 (2026-10-01): el punto 1 nombra a la
// razón social de la planilla del trabajador. La plantilla vive en
// `declaraciones` con la marca {{RESPONSABLE}}; el portal la recibe resuelta
// por fn_politica_responsable() (supabase/portal.sql). Este módulo aplica la
// MISMA regla — «RAZÓN SOCIAL (RUC n)» — al formato de consentimiento en
// papel, para que su huella coincida con la del texto que guarda el portal.
// Las versiones anteriores no llevan la marca: salen tal cual.
export const MARCA_RESPONSABLE = "{{RESPONSABLE}}";

export const responsableDe = (empresa) =>
  empresa?.nombre ? `${empresa.nombre}${empresa.ruc ? ` (RUC ${empresa.ruc})` : ""}` : null;

// split/join y no replace: un nombre con «$» no debe leerse como patrón.
export const textoPolitica = (texto, empresa) =>
  String(texto ?? "").split(MARCA_RESPONSABLE).join(responsableDe(empresa) ?? "tu empleadora");
