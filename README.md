# Intranet Grupo NEGLIAF

BackOffice administrador (`src/`) y Portal del Trabajador (`portal/`, microfrontend bajo `/portal`) de la intranet del Grupo NEGLIAF (NEGLIAF, BREMCO, PROMANT, Limpieza Americana).

- **Stack:** React 19 + Vite 7 + Tailwind 4 (BackOffice), Preact (Portal), funciones serverless en `api/` (Vercel), Supabase (Postgres + Auth + Storage).
- **Despliegue:** push a `main` → Vercel (`intranet-general` y `intranet-portal`). Producción: https://intranet-general.vercel.app.
- **Datos:** modelo relacional en `supabase/` (`MODELO.md` explica las decisiones y el orden de carga; `seguridad.sql` es el espejo acumulado de las fases de seguridad).
- **Seguridad:** `docs/seguridad/README.md` (arquitectura resultante e índice de informes) y `docs/funciones-y-permisos.md` (generado desde producción).

## Trabajar en local

```
npm install && npm run dev            # BackOffice (canal directo a Supabase solo en desarrollo)
cd portal && npm install && npm run dev
npm test                              # pruebas unitarias (vitest)
node scripts/ensayar-canon.mjs        # regresión del canon SQL en un Postgres embebido (sin token)
```

Los scripts que hablan con producción (`scripts/verificar-*.mjs`, `aplicar-sql.mjs`, `entorno-pruebas.mjs`) necesitan el token de la Management API: `. .\scripts\token-supabase.ps1` en PowerShell.

## Comprobaciones automáticas

`.github/workflows/seguridad.yml`: en cada push corren las pruebas, la compilación de ambas apps, la revisión de que los paquetes no llevan credenciales y la regresión del canon SQL; en cada despliegue de producción, las comprobaciones HTTP (`scripts/verificar-despliegue.mjs`) y, si el repositorio tiene el secreto `SUPABASE_ACCESS_TOKEN`, los verificadores de base de datos de las fases 4 a 6.

## Requerimientos

Documentos funcionales (Arquitectura Funcional, Casos de Referencia, Flujos y Pantallas v1.0, Accesos y Roles v1.0.1) fuera del repositorio; los códigos de pantalla (RRH-06, TRB-01, ACC-05…) son estables y se usan en la interfaz. Planes y diseños de cada entrega: `docs/superpowers/`.
