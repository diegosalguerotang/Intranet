// E2E del cierre de acceso, con la MISMA clave publishable que usa el
// navegador. Credenciales del superadmin por env: SUPERADMIN_EMAIL y
// SUPERADMIN_PASSWORD_INICIAL (no se persisten en ningún archivo).
const URL = "https://mzpbdkrmokfxrrsotfgs.supabase.co";
const KEY = "sb_publishable_qgPwZ8-4neRlKQXpCe9tnw_Dix4Ddwg";
const cab = { apikey: KEY, "Content-Type": "application/json" };

const { SUPERADMIN_EMAIL: EMAIL, SUPERADMIN_PASSWORD_INICIAL: CLAVE } = process.env;
if (!EMAIL || !CLAVE) { console.error("Faltan SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD_INICIAL."); process.exit(1); }

let fallas = 0;
const caso = (nombre, ok) => { console.log(`${ok ? "✔" : "✘"} ${nombre}`); if (!ok) fallas++; };

// 1) No existe endpoint público de registro de cuentas.
const signup = await fetch(`${URL}/auth/v1/signup`, {
  method: "POST", headers: cab,
  body: JSON.stringify({ email: "intruso@ejemplo.com", password: "ClaveLarga12345" }),
});
caso(`Autorregistro rechazado (HTTP ${signup.status})`, !signup.ok);

// 2) Clave equivocada → error, y el intento queda en ACC-06.
const mal = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: cab,
  body: JSON.stringify({ email: EMAIL, password: "clave-equivocada-123" }),
});
caso(`Login con clave equivocada rechazado (HTTP ${mal.status})`, !mal.ok);
await fetch(`${URL}/rest/v1/rpc/registrar_ingreso`, {
  method: "POST", headers: { ...cab, Authorization: `Bearer ${KEY}` },
  body: JSON.stringify({ p_correo: EMAIL, p_resultado: "fallido", p_dispositivo: "E2E automatizado" }),
});
const reg = await (await fetch(
  `${URL}/rest/v1/v_registro_accesos?select=resultado&usuario=eq.Diego%20Salguero%20Tang&resultado=eq.fallido`,
  { headers: { ...cab, Authorization: `Bearer ${KEY}` } }
)).json();
caso(`Intento fallido registrado en ACC-06 (${reg.length} fila/s)`, reg.length >= 1);

// 3) Credenciales correctas → sesión (prueba además que el re-seed NO reseteó la clave).
const ok = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: cab,
  body: JSON.stringify({ email: EMAIL, password: CLAVE }),
});
const sesion = await ok.json();
caso(`Login correcto emite sesión (HTTP ${ok.status})`, ok.ok && !!sesion.access_token);

// 4) El usuario está en el padrón, activo y con rol superadmin. requiereCambio
// es un booleano de estado normal (true cuando la clave inicial aún no se
// cambió, false una vez cambiada) y no una invariante de este E2E: en esta
// cuenta la clave YA fue cambiada en una corrida anterior, así que hoy vale
// false; ambos valores son aceptables mientras estado y rol sean correctos.
const fila = await (await fetch(
  `${URL}/rest/v1/v_usuarios_admin?select=estado,requiereCambio,esSuperadmin&correo=eq.${encodeURIComponent(EMAIL)}`,
  { headers: { ...cab, Authorization: `Bearer ${KEY}` } }
)).json();
caso(`Padrón: activo, superadmin (requiereCambio=${fila[0]?.requiereCambio})`,
  fila[0]?.estado === "activo" && fila[0]?.esSuperadmin === true && typeof fila[0]?.requiereCambio === "boolean");

console.log(fallas ? `\n${fallas} caso(s) fallaron.` : "\nTodos los casos pasaron.");
process.exit(fallas ? 1 : 0);
