-- Regla de negocio (Diego 2026-08-17): el pago de TODAS las líneas móviles
-- sale de PROMANT. Las 3 líneas demo que pagaban otras empresas se corrigen y
-- el default queda fijado; la distribución (usa) sí es libre. Idempotente.
update lineas set paga = 'promant' where paga <> 'promant';
alter table lineas alter column paga set default 'promant';
