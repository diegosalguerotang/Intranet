-- Recuperación de clave del BACKOFFICE por correo (pedido de Diego
-- 2026-08-17): los tokens ganan el propósito 'recuperacion-admin'. El dni del
-- token es el persona_dni del usuario administrativo; el correo, su correo de
-- cuenta. Idempotente.
alter table correo_tokens drop constraint if exists correo_tokens_proposito_check;
alter table correo_tokens add constraint correo_tokens_proposito_check
  check (proposito in ('verificacion','recuperacion','recuperacion-admin'));
