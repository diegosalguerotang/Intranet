// Aplica un archivo SQL (o una consulta suelta) contra el proyecto Supabase
// vía Management API. Se usa Node porque ConvertTo-Json de PowerShell 5.1
// rompe el cuerpo de la petición.
//
//   node scripts/aplicar-sql.mjs supabase/accesos.sql
//   node scripts/aplicar-sql.mjs --query "select count(*) from v_perfiles"
//
// Requiere SUPABASE_ACCESS_TOKEN (token de la CLI, guardado en el
// Administrador de credenciales de Windows como "Supabase CLI:supabase").

import { readFileSync } from "node:fs";

const PROYECTO = "mzpbdkrmokfxrrsotfgs";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("Falta SUPABASE_ACCESS_TOKEN.");
  process.exit(1);
}

const [arg1, arg2] = process.argv.slice(2);
const query = arg1 === "--query" ? arg2 : readFileSync(arg1, "utf8");

const res = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
});

const texto = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${texto}`);
  process.exit(1);
}
console.log(texto);
