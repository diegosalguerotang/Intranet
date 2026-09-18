-- supabase/auditoria.sql — Corrección de seguridad · FASE 5 (2026-09-18):
-- AUDITORÍA SIN VALORES SENSIBLES.
--
-- Canónico de la fase 5a. Lo embebe la migración
-- migraciones/2026-09-18-fase5a-auditoria-sensible.sql y el bloque @@FASE5@@
-- de seguridad.sql. Idempotente.
--
--  · interno.columnas_sensibles: la LISTA DEFINIDA (tabla, columna) cuyos
--    valores nunca deben quedar en la auditoría. Editarla es una migración.
--  · fn_auditar: para esas columnas registra que hubo cambio, no el valor
--    («[sensible]» / «[sensible: cambiado]»; null se conserva como null).
--  · fn_redactar_historico: la regla que aplica la migración de redacción del
--    histórico (fase 5b), única, aprobada y registrada en la propia auditoría.

create table if not exists interno.columnas_sensibles (
  tabla   text not null,
  columna text not null,
  motivo  text not null,
  primary key (tabla, columna)
);
revoke all on table interno.columnas_sensibles from public, anon, authenticated;
insert into interno.columnas_sensibles (tabla, columna, motivo) values
  ('usuarios_admin', 'clave_provisional', 'clave de acceso (hoy siempre null; la API no la guarda)'),
  ('usuarios_admin', 'sesion_actual',     'marcador de sesión única del BackOffice'),
  ('cuentas_portal', 'sesion_actual',     'marcador de sesión única del Portal'),
  ('personas',       'cuenta',            'cuenta bancaria en claro (columna retirada en la fase 3b; regla defensiva)'),
  ('personas',       'cci',               'CCI en claro (columna retirada en la fase 3b; regla defensiva)'),
  ('personas',       'cuenta_cifrada',    'cuenta cifrada (columna retirada en la fase 3b; regla defensiva)'),
  ('activos',        'clave_equipo',      'clave de equipo (columna retirada en la fase 3c; regla defensiva)')
on conflict (tabla, columna) do update set motivo = excluded.motivo;

create or replace function fn_auditar() returns trigger
language plpgsql security definer set search_path = public, interno, extensions as $$
declare j_antes jsonb; j_despues jsonb; c record; v_cambio boolean;
begin
  j_antes := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  j_despues := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  for c in select columna from interno.columnas_sensibles where tabla = tg_table_name loop
    v_cambio := (j_antes -> c.columna) is distinct from (j_despues -> c.columna);
    if j_antes ? c.columna and (j_antes -> c.columna) <> 'null'::jsonb then
      j_antes := jsonb_set(j_antes, array[c.columna], '"[sensible]"'::jsonb);
    end if;
    if j_despues ? c.columna and (j_despues -> c.columna) <> 'null'::jsonb then
      j_despues := jsonb_set(j_despues, array[c.columna], case when v_cambio then '"[sensible: cambiado]"'::jsonb else '"[sensible]"'::jsonb end);
    end if;
  end loop;
  insert into auditoria (accion, tabla, datos_antes, datos_despues)
  values (tg_op, tg_table_name, j_antes, j_despues);
  return coalesce(new, old);
end $$;

-- Regla de redacción del histórico: las claves de secretos con valor pasan a
-- «[redactado 2026-09-18]»; el resto de la fila queda intacto.
create or replace function fn_redactar_historico(p_datos jsonb) returns jsonb
language sql immutable as $$
  select case when p_datos is null then null else (
    select coalesce(jsonb_object_agg(e.key,
      case when e.key in ('cci', 'cuenta', 'cuenta_cifrada', 'clave_provisional', 'clave_equipo', 'sesion_actual')
                and e.value <> 'null'::jsonb and (e.value #>> '{}') <> ''
           then '"[redactado 2026-09-18]"'::jsonb else e.value end), '{}'::jsonb)
    from jsonb_each(p_datos) e) end
$$;
revoke all on function fn_redactar_historico(jsonb) from public, anon, authenticated;
