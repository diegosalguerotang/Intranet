// scripts/lib/marcar-factor.mjs — Segundo factor (2026-09-28). Las suites
// que crean un SUPERADMIN temporal (o entran con uno real) y luego llaman por
// el proxy o por endpoints con x-sesion quedarían en nivel 0: aquí se marca la
// sesión del JWT como verificada vía Management API (rol postgres, fuera del
// alcance del navegador). Si la migración no está aplicada, no hace nada.
export function sessionIdDe(jwt) {
  try {
    const partes = String(jwt ?? "").split(".");
    if (partes.length !== 3) return null;
    return JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8")).session_id ?? null;
  } catch { return null; }
}

export async function marcarSesionVerificada(sql, jwt, correo) {
  const sid = sessionIdDe(jwt);
  if (!sid) throw new Error("El JWT no trae session_id: no se puede marcar el segundo factor.");
  const r = await sql(`insert into interno.factor_sesiones (session_id, usuario_id, expira_en, via, agente)
    select '${sid}', u.id, now() + interval '2 hours', 'correo', 'suite'
      from interno.usuarios_admin u where lower(u.correo) = lower('${String(correo).replace(/'/g, "''")}')
    on conflict (session_id) do update set usuario_id = excluded.usuario_id, expira_en = excluded.expira_en`).catch((e) => ({ error: String(e.message ?? e) }));
  const texto = JSON.stringify(r ?? "");
  if (/factor_sesiones.*does not exist|relation .*factor_sesiones/.test(texto)) return null;   // migración sin aplicar
  if (/error|message/i.test(texto) && !Array.isArray(r)) throw new Error(`marcarSesionVerificada: ${texto.slice(0, 200)}`);
  return sid;
}
