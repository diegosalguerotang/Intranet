# Selección de trabajadores para crear cuentas del portal — diseño

**Fecha:** 2026-09-30 · **Estado:** aprobado por Diego («Está bien así, aprobado»)

## 1. Por qué

En Planilla (RRH-02) la cuenta del portal se crea una por una (botón «Portal» de cada fila → «Crear cuenta») o en masa desde «Cuentas del portal» (todos los vigentes sin cuenta de la razón social activa, con filtro por sede). No hay forma de elegir personas concretas. Diego pidió poder marcar a varios y enviarles el acceso de una vez.

## 2. Diseño

1. **Casillas en la tabla**, solo en filas **seleccionables**: trabajador `vigente`, sin cuenta (`!tieneCuenta`) y de la razón social activa (la tabla ya filtra por ella). Las demás filas no tienen casilla.
2. **Casilla de cabecera** «seleccionar visibles»: marca las filas seleccionables que pasan los filtros vigentes (búsqueda, sede, estado del portal, estado). Estado indeterminado si hay algunas marcadas; desmarcar quita solo las visibles.
3. **Barra de acción** sobre la tabla cuando hay marcadas: «N seleccionados · Crear cuentas del portal · Limpiar selección».
4. «Crear cuentas del portal» abre el modal existente `CuentasMasa` con la prop nueva `seleccion` (lista de DNI): sus candidatos son las personas marcadas que siguen siendo seleccionables; el selector de sede se oculta; el resto (completar correos, envío por correo, tramos de 10, progreso, CSV de claves, aviso de tope 100/día) no cambia. El título pasa a «Cuentas del portal — N seleccionados».
5. La selección se limpia al cerrar el modal tras crear (paso 3) y al cambiar de razón social. Las marcas de personas que dejan de ser seleccionables (por ejemplo, ya con cuenta tras recargar) se ignoran.
6. El botón de cabecera «Cuentas del portal» (todos / por sede) sigue igual.

Sin cambios en el servidor: `api/portal-cuentas.js` (`crear-lote`) ya recibe una lista de DNI.

## 3. Pruebas

- Helper puro `src/lib/seleccionPortal.js` con vitest: `esSeleccionable(p, empresaId)`, `alternarVisibles(seleccion, filas, empresaId, marcar)`, `depurar(seleccion, personal, empresaId)`.
- Build y prueba manual de Diego: marcar dos personas sin cuenta, crear, ver CSV y correos; comprobar que las filas con cuenta no tienen casilla.

## 4. Fuera de alcance

Acciones masivas distintas de crear cuenta (restablecer claves en masa, recordatorios) y selección entre razones sociales.
