// E2E del módulo de Accesos con la MISMA clave publishable que usa el
// frontend: lecturas de las 5 vistas nuevas y una escritura vía RPC
// (guardar_politica) que luego se comprueba releyendo la vista.
const URL = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const KEY = "sb_publishable_qgPwZ8-4neRlKQXpCe9tnw_Dix4Ddwg";
const cab = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const leer = async (vista) => {
  const r = await fetch(`${URL}/rest/v1/${vista}?select=*`, { headers: cab });
  const d = await r.json();
  if (!r.ok) throw new Error(`${vista}: HTTP ${r.status} ${JSON.stringify(d)}`);
  return d;
};

for (const v of ["v_perfiles", "v_perfil_versiones", "v_usuarios_admin", "v_politica_acceso", "v_registro_accesos"]) {
  const d = await leer(v);
  console.log(`${v}: ${d.length} filas`);
}

const rpc = await fetch(`${URL}/rest/v1/rpc/guardar_politica`, {
  method: "POST",
  headers: { ...cab, "Content-Type": "application/json" },
  body: JSON.stringify({
    p_backoffice_horas: 8, p_portal_dias: 30,
    p_multisesion_backoffice: false, p_multisesion_portal: true,
    p_intentos: 5, p_bloqueo_min: 15, p_recuperacion: "whatsapp",
    p_clave_min: 8, p_provisional_dias: 7, p_por: "Verificación E2E",
  }),
});
if (!rpc.ok) throw new Error(`RPC guardar_politica: HTTP ${rpc.status} ${await rpc.text()}`);
const pol = await leer("v_politica_acceso");
console.log(`RPC guardar_politica OK → actualizadoPor: ${pol[0].actualizadoPor} (${pol[0].actualizado})`);

// La escritura directa sobre el registro inmutable debe fallar (revoke + trigger).
const patch = await fetch(`${URL}/rest/v1/registro_accesos?id=eq.1`, {
  method: "PATCH",
  headers: { ...cab, "Content-Type": "application/json" },
  body: JSON.stringify({ ip: "0.0.0.0" }),
});
console.log(`PATCH registro_accesos (debe fallar): HTTP ${patch.status} ${patch.ok ? "⚠ PERMITIDO" : "denegado ✔"}`);
