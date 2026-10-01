-- supabase/migraciones/2026-10-01-politica-razon-social.sql
-- Generado por scripts/politica-generar.mjs desde supabase/portal.sql (no editar a mano).
-- Una transacción. Reversión: supabase/respaldos/2026-10-01-politica-razon-social-reversion.sql.
-- Aplica DIEGO con `!`:  node scripts/aplicar-sql.mjs supabase/migraciones/2026-10-01-politica-razon-social.sql
-- Política de datos v3: el punto 1 nombra a la razón social de la planilla del
-- trabajador («RAZÓN SOCIAL (RUC n)»). La v2 y sus consentimientos no se tocan;
-- los primeros ingresos posteriores aceptan la v3 con su razón social dentro del
-- texto guardado. Idempotente (on conflict do nothing / create or replace).
begin;
set local search_path = public, interno, extensions;

-- 1 · Texto v3 (plantilla con la marca {{RESPONSABLE}}).
insert into declaraciones (id, version, superficie, texto) values
('politica-datos', 3, 'portal',
'POLÍTICA DE PRIVACIDAD Y TRATAMIENTO DE DATOS PERSONALES
Ley N.º 29733 — Ley de Protección de Datos Personales — y su Reglamento
Versión 3 · Octubre de 2026

1. QUIÉN TRATA TUS DATOS
El responsable del tratamiento es {{RESPONSABLE}}. Es la empresa de IntraTech que figura como tu empleadora en la planilla y en tu boleta de pago. IntraTech administra esta intranet para todas sus empresas.

2. QUÉ DATOS TRATAMOS
· De identificación: nombres y apellidos, tipo y número de documento.
· De contacto: celular, correo y dirección que tú declaras.
· Laborales y de planilla: cargo, sede, fechas de ingreso y cese, remuneraciones, cuenta de haberes.
· De asistencia: tus marcaciones.
· Los que se generan al usar este portal: confirmaciones de recepción, lecturas, solicitudes, tickets de soporte y registros de acceso.

3. PARA QUÉ LOS USAMOS
Únicamente para administrar la relación laboral: pagarte y gestionar la planilla; entregarte boletas y documentos con constancia; comunicarte avisos de la empresa; gestionar tu asistencia, solicitudes y beneficios; tramitar procesos conforme al Reglamento Interno de Trabajo; darte soporte; y proteger la seguridad de la información. El tratamiento necesario para ejecutar la relación laboral y cumplir la ley no requiere tu consentimiento (art. 14 de la Ley 29733); para todo lo demás vale tu aceptación de esta política.

4. ENTREGA ELECTRÓNICA DE BOLETAS Y DOCUMENTOS
AUTORIZO expresamente que mis boletas de pago y demás documentos laborales se pongan a mi disposición a través de este portal, conforme al artículo 3.2 del Decreto Legislativo N.º 1310. Cada documento queda con constancia de emisión (fecha, hora del servidor y huella digital SHA-256 del archivo exacto) y puedo verlo y descargarlo desde mi cuenta en cualquier momento. Puedo pedir además una copia impresa en Recursos Humanos. Confirmar la recepción de un documento reemplaza la firma del cargo físico y NO significa estar de acuerdo con su contenido: conservo intacto mi derecho a reclamar.

5. CON QUIÉN SE COMPARTEN
Tus datos no se venden ni se comparten con terceros ajenos a IntraTech. Solo acceden a ellos: (a) el personal autorizado según su nivel de acceso; (b) los proveedores tecnológicos que alojan la intranet y su base de datos, que actúan por encargo y pueden estar ubicados fuera del Perú (flujo transfronterizo con salvaguardas de seguridad); y (c) las autoridades cuando la ley lo exige (SUNAT, SUNAFIL, Poder Judicial, entre otras).

6. CUÁNTO TIEMPO LOS CONSERVAMOS
Mientras dure tu vínculo laboral y, después, por los plazos que exigen las normas laborales y tributarias (como mínimo cinco años para los documentos de planilla) y los plazos de prescripción de acciones legales.

7. TUS DERECHOS
Puedes ejercer en cualquier momento tus derechos de acceso, rectificación, cancelación y oposición (ARCO), y revocar esta autorización en lo que no sea indispensable para la relación laboral, presentando tu solicitud a Recursos Humanos de tu empresa. Te responderemos en los plazos de ley. Si no estás conforme con la respuesta, puedes acudir a la Autoridad Nacional de Protección de Datos Personales.

8. CÓMO LOS PROTEGEMOS
Los documentos se guardan en un repositorio privado al que solo se accede con identidad verificada; los datos bancarios se almacenan cifrados; tu cuenta tiene clave personal, sesión única y cierre automático por inactividad; y todos los accesos quedan registrados.

9. TU ACEPTACIÓN
Tu aceptación queda registrada con fecha, hora y la versión exacta de este texto, y puedes releer la política vigente cuando quieras desde la pestaña «Yo» del portal.')
on conflict (id, version) do nothing;

-- 2 · Quién es el responsable para la sesión del portal (no es definer: RLS).
create or replace function fn_politica_responsable() returns text
language sql stable set search_path = public, interno, extensions as $$
  select e.nombre || coalesce(' (RUC ' || e.ruc || ')', '')
  from vinculos v join empresas e on e.id = v.empresa_id
  where v.persona_dni = portal_dni()
  order by (v.fecha_fin is null) desc, v.fecha_inicio desc
  limit 1
$$;
revoke execute on function fn_politica_responsable() from public, anon;
grant execute on function fn_politica_responsable() to authenticated;

-- 3 · La vista entrega el texto ya resuelto (mismas columnas; privilegios intactos).
create or replace view public.v_declaraciones_vigentes with (security_invoker = on) as
select distinct on (id) id, version, superficie,
       replace(texto, '{{RESPONSABLE}}', coalesce(fn_politica_responsable(), 'tu empleadora')) as texto
from declaraciones
order by id, version desc;

-- 4 · El primer ingreso guarda en consentimientos el texto resuelto, no la plantilla.
create or replace function portal_primer_ingreso(
  p_celular text, p_sin_celular boolean, p_politica_version integer,
  p_correo text default null
) returns void language plpgsql security definer
set search_path = public, interno, extensions as $$
declare v_dni text; v_correo text; v_texto text; v_responsable text;
begin
  v_dni := portal_dni();
  if v_dni is null then raise exception 'Sesión del portal requerida.'; end if;
  if not p_sin_celular and (p_celular is null or p_celular !~ '^[0-9]{9}$') then
    raise exception 'El celular debe tener 9 dígitos, o marca «No tengo celular».';
  end if;
  v_correo := nullif(lower(trim(coalesce(p_correo, ''))), '');
  if v_correo is not null and v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo no tiene un formato válido.';
  end if;
  select texto into v_texto from declaraciones
  where id = 'politica-datos' and version = p_politica_version;
  if v_texto is null then
    raise exception 'Versión de la política de datos desconocida.';
  end if;
  -- Desde la v3 el texto nombra a la razón social de la planilla: se guarda
  -- EXACTAMENTE lo que mostró v_declaraciones_vigentes, nunca la plantilla.
  if position('{{RESPONSABLE}}' in v_texto) > 0 then
    v_responsable := fn_politica_responsable();
    if v_responsable is null then
      raise exception 'No se pudo identificar la razón social de tu planilla. Avisa a Recursos Humanos.';
    end if;
    v_texto := replace(v_texto, '{{RESPONSABLE}}', v_responsable);
  end if;
  update cuentas_portal
  set primer_ingreso_pendiente = false,
      celular_declarado = case when p_sin_celular then null else p_celular end,
      sin_celular = p_sin_celular,
      politica_version = p_politica_version::text,
      politica_aceptada_en = now()
  where dni = v_dni;
  if not found then raise exception 'La cuenta del portal no existe.'; end if;
  -- Registro probatorio del consentimiento (D.Leg. 1310): texto íntegro,
  -- huella, hora de servidor, IP y user-agent reales.
  insert into consentimientos (dni, declaracion_id, version, superficie, texto,
                               hash_sha256, ip, agente, origen)
  values (v_dni, 'politica-datos', p_politica_version, 'portal', v_texto,
          encode(extensions.digest(v_texto, 'sha256'), 'hex'),
          fn_cabecera('x-ip-real'), fn_cabecera('x-agente'), 'primer_ingreso');
  update personas
  set celular = coalesce(case when p_sin_celular then null else p_celular end, celular),
      portal  = case when p_sin_celular then 'sin_celular' else 'activo' end,
      correo = coalesce(v_correo, correo),
      correo_verificado = case when v_correo is not null and v_correo is distinct from correo
                               then false else correo_verificado end
  where dni = v_dni;
end $$;

-- Verificación embebida: el texto v3 lleva la marca una sola vez; la función
-- nueva NO es definer y solo la ejecuta authenticated; la vista sigue como
-- security_invoker y legible; portal_primer_ingreso sigue definer con
-- search_path fijo, ejecutable por authenticated, y resuelve la marca.
do $v$
declare t text; f pg_proc; p pg_proc;
begin
  select texto into t from declaraciones where id = 'politica-datos' and version = 3;
  if t is null or array_length(string_to_array(t, '{{RESPONSABLE}}'), 1) <> 2 then
    raise exception 'politica: falta la versión 3 o no lleva la marca exactamente una vez';
  end if;
  select * into f from pg_proc where oid = 'public.fn_politica_responsable()'::regprocedure;
  if f.prosecdef then raise exception 'politica: fn_politica_responsable no debe ser security definer'; end if;
  if has_function_privilege('anon', f.oid, 'execute') or not has_function_privilege('authenticated', f.oid, 'execute') then
    raise exception 'politica: privilegios incorrectos en fn_politica_responsable';
  end if;
  if not exists (select 1 from pg_class c, unnest(coalesce(c.reloptions, '{}')) o
                 where c.oid = 'public.v_declaraciones_vigentes'::regclass and o in ('security_invoker=on', 'security_invoker=true'))
     or not has_table_privilege('authenticated', 'public.v_declaraciones_vigentes', 'select')
     or has_table_privilege('anon', 'public.v_declaraciones_vigentes', 'select') then
    raise exception 'politica: v_declaraciones_vigentes perdió security_invoker o sus privilegios';
  end if;
  select * into p from pg_proc where oid = 'public.portal_primer_ingreso(text, boolean, integer, text)'::regprocedure;
  if not p.prosecdef or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
     or p.prosrc !~ 'fn_politica_responsable' or not has_function_privilege('authenticated', p.oid, 'execute')
     or has_function_privilege('anon', p.oid, 'execute') then
    raise exception 'politica: portal_primer_ingreso no quedó como se esperaba';
  end if;
end $v$;

commit;
