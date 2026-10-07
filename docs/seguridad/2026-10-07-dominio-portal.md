# Dominio técnico de las cuentas del Portal — 2026-10-07

Spec: `docs/superpowers/specs/2026-10-07-dominio-portal-design.md` · Plan: `docs/superpowers/plans/2026-10-07-dominio-portal.md`

## 1. Motivo

Cada cuenta del Portal necesita un correo único en Supabase Auth; el sistema lo fabrica como `dni@dominio`. Ese dominio era `portal.grupoer.pe`: una marca que ya no es la del proyecto y un dominio que el proyecto no controla. Desde el 2026-10-01 la intranet vive en `servicios-intranet.net`; con 2 cuentas del Portal y sin trabajadores reales, migrar costaba minutos.

## 2. Qué cambió

- **Base:** `portal_dni()`, `portal_registrar_ingreso`, `api_login_permitido` y `api_login_registrar` comparan con `@portal.servicios-intranet.net`. Migración `supabase/migraciones/2026-10-07-dominio-portal.sql` (reversión en `respaldos/`, que se niega si `auth.users` tiene cuentas con el dominio nuevo). Canónicos `portal.sql` y `limites.sql`; bloque `@@DOMINIO@@` al final de `seguridad.sql` (el `@@FASE6@@` histórico no se tocó). `portal_dni` pasa de `search_path = public, extensions` (fase 0) a `public, interno, extensions`, alineado con las otras tres; la reversión conserva el valor nuevo (inocuo).
- **Auth:** `scripts/migrar-dominio-portal.mjs --aplicar` renombró las cuentas (`PUT /auth/v1/admin/users/{id}`, `email_confirm`).
- **Código:** `api/_clave.js` es el único dueño de `DOMINIO_PORTAL`; ocho endpoints lo importan; `portal/src/lib/api.js` fabrica el correo con el dominio nuevo.
- **DNS (Vercel):** `portal MX 0 .` (MX nulo) y `portal TXT "v=spf1 -all"`.

## 3. Operación

Orden: migración SQL (Diego) → `--aplicar` (Diego) → push → DNS → verificadores. Entre la migración y el deploy el Portal no deja entrar (minutos).

Reversión: `git revert` → `migrar-dominio-portal.mjs --revertir` → `respaldos/2026-10-07-dominio-portal-reversion.sql`.

## 4. Verificación

(Se completa en Task 7 con la salida real: ensayar-dominio-portal, ensayar-canon, vitest, verificar-despliegue, verificar-fase4, verificar-fase6, verificar-portal, verificar-cuentas-masa, migrar-dominio-portal --verificar, funciones-y-permisos.)

## 5. Estado

(Se completa en Task 7.)
