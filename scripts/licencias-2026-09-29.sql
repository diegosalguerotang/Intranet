-- scripts/licencias-2026-09-29.sql — Carga inicial de Licencias Office (ADQ-09) desde
-- «Licencias Office - PROMANT.pdf» (20 grupos, 43 trabajadores). DNI resueltos
-- contra v_personal el 2026-09-29 por tokens del nombre (39 con DNI; Aníbal Mayta por
-- descarte tras Arturo Mayta); 4 sin coincidencia quedan «por afiliar» con el nombre
-- de la fuente. Los nombres de grupo truncados en el PDF se completaron:
-- RRHH_GERENCIA, ADMINISTRACION, OPERACIONES_EMILIO/LK/DM (por el buzón).
-- UNA transacción, idempotente (no duplica si se vuelve a correr).
-- Uso: . .\scripts\token-supabase.ps1; node scripts/aplicar-sql.mjs scripts/licencias-2026-09-29.sql
begin;
set local search_path = public, interno, extensions;

insert into licencias_office (grupo, correo) values
  ('RRHH_GERENCIA', 'g_rrhh@promantserv.onmicrosoft.com'),
  ('RRHH_03', 'rrhh@promantserv.onmicrosoft.com'),
  ('FACTURACION', 'facturacion@promantserv.onmicrosoft.com'),
  ('ADMINISTRACION', 'administracion@promantserv.onmicrosoft.com'),
  ('PLANILLAS', 'planilla@promantserv.onmicrosoft.com'),
  ('SISTEMAS', 'sistemas@promantserv.onmicrosoft.com'),
  ('RRHH_02', 'rrhh2_contratos@promantserv.onmicrosoft.com'),
  ('RRHH_01', 'rrhh1_reclutamiento@promantserv.onmicrosoft.com'),
  ('FINANZAS', 'finanzas@promantserv.onmicrosoft.com'),
  ('CONTABILIDAD', 'contabilidad@promantserv.onmicrosoft.com'),
  ('COMERCIAL', 'comercial@promantserv.onmicrosoft.com'),
  ('LEGAL', 'legal@promantserv.onmicrosoft.com'),
  ('LOGISTICA_02', 'logistica@promantserv.onmicrosoft.com'),
  ('LOGISTICA_01', 'g_logistica@promantserv.onmicrosoft.com'),
  ('OP_PROVINCIA', 'ope_provincia@promantserv.onmicrosoft.com'),
  ('OPERACIONES_EMILIO', 'emilio@promantserv.onmicrosoft.com'),
  ('SST_01', 'sst@promantserv.onmicrosoft.com'),
  ('OP_GERENTE', 'g_ope@promantserv.onmicrosoft.com'),
  ('OPERACIONES_LK', 'ope_lk@promantserv.onmicrosoft.com'),
  ('OPERACIONES_DM', 'ope_dm@promantserv.onmicrosoft.com')
on conflict (grupo) do nothing;

insert into licencias_office_personas (licencia_id, dni, nombre)
select l.id, x.dni, x.nombre
from (values
  ('RRHH_GERENCIA', '73189654', 'ESPINOZA REYES MAITHE JULIA'),
  ('RRHH_03', '03851963', 'GALAN BAYONA AMELIA'),
  ('RRHH_03', '42071281', 'CARRASCO TORRES ANA ROSA'),
  ('RRHH_03', '06025451', 'OLIDEN TORRES MARCO ANTONIO'),
  ('FACTURACION', '43585698', 'VILLANUEVA VARGAS JORGE JOSE'),
  ('FACTURACION', '48358460', 'CASTRO ARANGO VICENTE KEVIN'),
  ('ADMINISTRACION', null, 'ESPERANZA QUEVEDO'),
  ('PLANILLAS', '70491989', 'GALDOS ARIAS IVAN ANDRES'),
  ('PLANILLAS', '43810468', 'UGAZ LEVANO JHONATAN RAUL'),
  ('SISTEMAS', '60733147', 'FLORES CORTEZ FABIAN VALENTINO'),
  ('SISTEMAS', '70122408', 'Jean Paul Camacho Gómez'),
  ('SISTEMAS', '45619796', 'GUSMAN RAMOS KAREN ERIKA'),
  ('RRHH_02', '74220092', 'SANCHEZ MORENO FABRIZZIO ALEXA'),
  ('RRHH_02', '003308122', 'RODRIGUEZ VARGAS JEAN CARLOS'),
  ('RRHH_02', '72505627', 'IPARRAGUIRRE GUARDIA JOSE LUIS'),
  ('RRHH_01', '73386191', 'VARGAS ALARCON DAIRA FRISETH'),
  ('RRHH_01', '73952030', 'CHAVEZ VASQUEZ JHOSEP ANDRE'),
  ('RRHH_01', '74928526', 'FERNANDEZ RAMIREZ SHIRLEY VALE'),
  ('FINANZAS', '73189658', 'ESPINOZA REYES BRENDA MELISSA'),
  ('CONTABILIDAD', null, 'ANA SANABRIA'),
  ('CONTABILIDAD', '71843078', 'CRUZADO CALLUPE JEAN POOL'),
  ('CONTABILIDAD', '74966012', 'Freznel Moises Oblitas Gamonel'),
  ('COMERCIAL', '42899057', 'ZAPATA CASTRO JOSE DAVID'),
  ('COMERCIAL', '47296190', 'ALBAÑIL MUÑOZ DIANA CAROLINA'),
  ('COMERCIAL', '74088846', 'AVILA GUSHIKEN HAJIME HERNAN'),
  ('LEGAL', '70081272', 'ALAMA ALBORNOZ AMANDA MILAGROS'),
  ('LEGAL', '08173681', 'AVALOS ARAOZ ARTURO JAVIER'),
  ('LEGAL', '73072752', 'PRADO AGUILAR LUIS DANIEL'),
  ('LOGISTICA_02', '40899594', 'AIRE ATAYARI IVAN'),
  ('LOGISTICA_02', '10096184', 'GARCIA AVALOS JUAN CARLOS'),
  ('LOGISTICA_01', '72386204', 'MAYTA QUEVEDO ARTURO ANIBAL'),
  ('LOGISTICA_01', '07819030', 'MAYTA QUISPE ANIBAL'),
  ('OP_PROVINCIA', '10129517', 'GODINEZ PALOMINO JOSE ANTONIO'),
  ('OP_PROVINCIA', '10096525', 'QUEVEDO VELASQUEZ SONIA PILAR'),
  ('OPERACIONES_EMILIO', null, 'EMILIO JUAREZ'),
  ('SST_01', '73077029', 'CABRERA SANCHEZ LUIS ALFREDO'),
  ('SST_01', '47609482', 'VARGAS RAZURI MONICA PAMELA'),
  ('OP_GERENTE', '72386207', 'MAYTA QUEVEDO ANA PAULA'),
  ('OP_GERENTE', '61151706', 'MAYTA QUEVEDO CAMILA KRISTEL'),
  ('OPERACIONES_LK', '73099357', 'CUBAS VILCHEZ KEN PIERO'),
  ('OPERACIONES_LK', '10090051', 'VILLA QUEVEDO LARRI HERNAN'),
  ('OPERACIONES_DM', null, 'MARIANO VILLANUEVA'),
  ('OPERACIONES_DM', '44943587', 'ROJAS LOPEZ DEYSI SUSAN')
) as x(grupo, dni, nombre)
join licencias_office l on l.grupo = x.grupo
where not exists (select 1 from licencias_office_personas p
                  where p.licencia_id = l.id and p.hasta is null
                    and (p.dni = x.dni or (x.dni is null and p.dni is null and p.nombre = x.nombre)));

do $$
declare g int; t int; c int; s int;
begin
  select count(*) into g from licencias_office;
  select count(*), count(dni), count(*) - count(dni) into t, c, s from licencias_office_personas where hasta is null;
  if g <> 20 or t <> 43 or c <> 39 or s <> 4 then
    raise exception 'licencias: %/%/%/% (grupos/abiertas/con DNI/sin DNI), esperado 20/43/39/4', g, t, c, s;
  end if;
end $$;
commit;
