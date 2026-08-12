// Bootstrap del primer superadministrador (Cierre de Acceso v1.0).
// Se crea por seed, no por pantalla: nadie puede crearlo desde una interfaz
// que exige ya serlo.
//
// Credenciales SOLO por variables de entorno (nunca en el código):
//   SUPERADMIN_EMAIL · SUPERADMIN_PASSWORD_INICIAL · SUPERADMIN_DNI
// Además: SUPABASE_ACCESS_TOKEN (scripts/token-supabase.ps1).
//
// IDEMPOTENTE: correrlo dos veces no duplica el usuario ni resetea la clave
// (un seed que resetea claves es una puerta trasera con otro nombre).
// La cuenta nace con cambio de clave obligatorio en el primer ingreso.

const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const SUPA_URL = `https://${PROYECTO}.supabase.co`;

const { SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD_INICIAL, SUPERADMIN_DNI, SUPABASE_ACCESS_TOKEN } = process.env;
for (const [k, v] of Object.entries({ SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD_INICIAL, SUPERADMIN_DNI, SUPABASE_ACCESS_TOKEN })) {
  if (!v) { console.error(`Falta la variable de entorno ${k}.`); process.exit(1); }
}
if (SUPERADMIN_PASSWORD_INICIAL.length < 12) {
  console.error("La clave inicial debe tener 12 caracteres o más (mínimo del BackOffice).");
  process.exit(1);
}
if (!/^[0-9]{8}$/.test(SUPERADMIN_DNI)) {
  console.error("SUPERADMIN_DNI debe ser un DNI de 8 dígitos.");
  process.exit(1);
}

const sql = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`SQL: ${JSON.stringify(d)}`);
  return d;
};

// La service_role se obtiene al vuelo desde la Management API; no se guarda.
const keysRes = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` },
});
if (!keysRes.ok) { console.error(`api-keys HTTP ${keysRes.status}: ${await keysRes.text()}`); process.exit(1); }
const service = (await keysRes.json()).find((k) => k.name === "service_role")?.api_key;
if (!service) { console.error("No se encontró la clave service_role."); process.exit(1); }
const cabAdmin = { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" };

// 1) Usuario en el proveedor de identidad — solo si no existe. Jamás se toca
//    la clave de una cuenta existente.
const lista = await fetch(`${SUPA_URL}/auth/v1/admin/users?per_page=1000`, { headers: cabAdmin });
if (!lista.ok) { console.error(`admin/users HTTP ${lista.status}: ${await lista.text()}`); process.exit(1); }
const { users = [] } = await lista.json();
const existente = users.find((u) => (u.email ?? "").toLowerCase() === SUPERADMIN_EMAIL.toLowerCase());

let authNuevo = false;
if (existente) {
  console.log(`Usuario Auth ya existe (${existente.id}); la clave NO se modifica.`);
} else {
  const crear = await fetch(`${SUPA_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: cabAdmin,
    body: JSON.stringify({ email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD_INICIAL, email_confirm: true }),
  });
  if (!crear.ok) { console.error(`crear usuario HTTP ${crear.status}: ${await crear.text()}`); process.exit(1); }
  authNuevo = true;
  console.log(`Usuario Auth creado para ${SUPERADMIN_EMAIL}.`);
}

// 2) Persona, perfil superadmin y usuario administrativo — todo idempotente.
const esc = (s) => s.replace(/'/g, "''");
const email = esc(SUPERADMIN_EMAIL);
const dni = esc(SUPERADMIN_DNI);

await sql(`
insert into personas (dni, nombre, portal)
values ('${dni}', 'Superadministrador (bootstrap)', 'activo')
on conflict (dni) do nothing;

insert into perfiles (id, version, nombre, descripcion, es_superadmin, creado_por)
select 'superadmin', 1, 'Superadministrador',
       'Control total del grupo. La marca ignora la matriz y el alcance.', true, 'Seed bootstrap'
where not exists (select 1 from perfiles where id = 'superadmin');

do $$
declare v_version int;
begin
  if not exists (select 1 from usuarios_admin where lower(correo) = lower('${email}')) then
    if exists (select 1 from usuarios_admin where persona_dni = '${dni}') then
      update usuarios_admin set correo = '${email}' where persona_dni = '${dni}';
    else
      select max(version) into v_version from perfiles where id = 'superadmin';
      insert into usuarios_admin (persona_dni, perfil_id, perfil_version, correo,
                                  clave_entregada, requiere_cambio_clave, creado_por)
      values ('${dni}', 'superadmin', v_version, '${email}', 'pantalla', true, 'Seed bootstrap');
    end if;
  end if;
end $$;

${authNuevo ? `update usuarios_admin set requiere_cambio_clave = true where lower(correo) = lower('${email}');` : ""}

insert into auditoria (accion, tabla, datos_despues)
values ('SEED', 'bootstrap_superadmin',
        jsonb_build_object('correo', '${email}', 'dni', '${dni}',
                           'auth_creado', ${authNuevo}, 'momento', now()));
`);

const check = await sql(`
select (select count(*) from usuarios_admin u join perfiles p on p.id = u.perfil_id and p.version = u.perfil_version
        where p.es_superadmin and u.estado = 'activo') as superadmins_activos,
       (select requiere_cambio_clave from usuarios_admin where lower(correo) = lower('${email}')) as requiere_cambio;
`);
console.log(`Verificación: ${JSON.stringify(check)}`);
console.log("Seed completado. La clave inicial es de un solo uso: el sistema exige cambiarla en el primer ingreso.");
