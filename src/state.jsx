import { createContext, useContext, useEffect, useState } from "react";
import { supabase, supabaseListo } from "./lib/supabase";
import * as MOCK from "./data/mock";

const AppCtx = createContext(null);

// Clave de estado → vista/tabla de lectura en Supabase.
// La interfaz nunca lee tablas crudas cuando existe un modelo detrás:
// lee vistas (v_*) que presentan el contrato de datos ya resuelto.
const FUENTES = {
  empresas: "empresas",
  sedes: "v_sedes",
  personal: "v_personal",
  lotes: "v_lotes",
  acuses: "v_acuses",
  comunicados: "v_comunicados",
  memorandums: "v_memorandums",
  tardanzas: "tardanzas",
  plantillas: "plantillas",
  contratos: "v_contratos",
  activos: "v_activos",
  lineas: "lineas",
  epp_entregas: "v_epp_entregas",
};

const LOCAL = {
  empresas: MOCK.EMPRESAS,
  sedes: MOCK.SEDES,
  personal: MOCK.PERSONAL,
  lotes: MOCK.LOTES,
  acuses: MOCK.ACUSES,
  comunicados: MOCK.COMUNICADOS,
  memorandums: MOCK.MEMORANDUMS,
  tardanzas: MOCK.TARDANZAS,
  plantillas: MOCK.PLANTILLAS,
  contratos: MOCK.CONTRATOS,
  activos: MOCK.ACTIVOS,
  lineas: MOCK.LINEAS,
  epp_entregas: MOCK.EPP_ENTREGAS,
};

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [empresaId, setEmpresaId] = useState("negliaf");
  const [db, setDb] = useState(LOCAL);
  const [origen, setOrigen] = useState("local"); // "supabase" | "local"

  const recargar = async (...claves) => {
    if (!supabaseListo) return;
    const lista = claves.length ? claves : Object.keys(FUENTES);
    const resultados = await Promise.all(lista.map((k) => supabase.from(FUENTES[k]).select("*")));
    setDb((d) => {
      const nuevo = { ...d };
      lista.forEach((k, i) => {
        if (!resultados[i].error) nuevo[k] = resultados[i].data;
        else console.error(`Supabase [${FUENTES[k]}]:`, resultados[i].error.message);
      });
      return nuevo;
    });
    return resultados.every((r) => !r.error);
  };

  useEffect(() => {
    if (!supabaseListo) return;
    recargar().then((ok) => setOrigen(ok ? "supabase" : "local"));
  }, []);

  const empresa = db.empresas.find((e) => e.id === empresaId);
  const persona = (dni) => db.personal.find((p) => p.dni === dni);
  const sede = (id) => db.sedes.find((s) => s.id === id);
  const empresaPor = (id) => db.empresas.find((e) => e.id === id);

  // Cada acción: actualización optimista local + RPC en el backend (la lógica
  // de negocio vive en Postgres) + recarga de las vistas afectadas.
  const local = (clave, fn) => setDb((d) => ({ ...d, [clave]: fn(d[clave]) }));
  const rpc = async (nombre, args, ...refrescar) => {
    if (!supabaseListo) return;
    const { error } = await supabase.rpc(nombre, args);
    if (error) console.error(`RPC ${nombre}:`, error.message);
    await recargar(...refrescar);
  };

  const acciones = {
    addPersonal: (row) => {
      local("personal", (xs) => [row, ...xs]);
      rpc("alta_trabajador", {
        p_dni: row.dni, p_nombre: row.nombre, p_cargo: row.cargo,
        p_sede: row.sede, p_empresa: row.empresa, p_ingreso: row.ingreso,
        p_celular: row.celular, p_banco: row.banco, p_cuenta: row.cuenta,
      }, "personal");
    },
    deletePersonal: (dni) => {
      local("personal", (xs) => xs.filter((p) => p.dni !== dni));
      rpc("eliminar_trabajador", { p_dni: dni }, "personal", "acuses", "lotes");
    },
    addLote: (lote) => {
      local("lotes", (xs) => [lote, ...xs]);
      rpc("publicar_lote", {
        p_empresa: lote.empresa, p_tipo: lote.tipo, p_periodo: lote.periodo, p_por: lote.por,
      }, "lotes", "acuses");
    },
    registrarAcuseAsistido: (dni, lote, cambios) => {
      local("acuses", (xs) => xs.map((a) => (a.dni === dni && a.lote === lote ? { ...a, ...cambios } : a)));
      rpc("registrar_acuse_asistido", {
        p_dni: dni, p_lote: lote, p_motivo: cambios.motivo,
        p_entrega: cambios.fechaEntrega, p_registrado_por: cambios.supervisor,
      }, "acuses", "lotes");
    },
    addComunicado: (c) => {
      local("comunicados", (xs) => [c, ...xs]);
      rpc("publicar_comunicado", {
        p_titulo: c.titulo, p_cuerpo: c.cuerpo, p_vence: c.vence,
        p_exige: c.exigeAcuse, p_segmento: c.segmento, p_alcance: c.alcance,
      }, "comunicados");
    },
    addMemo: (m) => {
      local("memorandums", (xs) => [m, ...xs]);
      rpc("emitir_memorandum", {
        p_dni: m.dni, p_tipo: m.tipo, p_motivo: m.motivo,
        p_articulo: m.articulo, p_plazo: m.plazoDias,
      }, "memorandums");
    },
    resolverMemo: (id, resolucion) => {
      local("memorandums", (xs) => xs.map((m) => (m.id === id ? { ...m, estado: "resuelto", resolucion } : m)));
      rpc("resolver_memorandum", { p_id: id, p_decision: resolucion.decision }, "memorandums");
    },
    asignarActivo: (codigo, dni, sedeId) => {
      local("activos", (xs) => xs.map((a) => (a.codigo === codigo ? { ...a, estado: "asignado", asignado: dni, sede: sedeId } : a)));
      rpc("asignar_activo", { p_codigo: codigo, p_dni: dni }, "activos");
    },
    devolverActivo: (codigo, destino, sedeId) => {
      local("activos", (xs) => xs.map((a) => (a.codigo === codigo ? { ...a, estado: destino, asignado: null, sede: sedeId } : a)));
      rpc("devolver_activo", { p_codigo: codigo, p_destino: destino }, "activos");
    },
    addLinea: (l) => {
      local("lineas", (xs) => [l, ...xs]);
      if (supabaseListo) {
        supabase.from("lineas").insert(l).then(({ error }) => {
          if (error) console.error("Supabase [lineas]:", error.message);
          recargar("lineas");
        });
      }
    },
    addEpp: (rows) => {
      local("epp_entregas", (xs) => [...rows, ...xs]);
      (async () => {
        for (const r of rows) {
          await rpc("registrar_epp", {
            p_dni: r.dni, p_items: r.items, p_entrega: r.entrega, p_reposicion: r.reposicion,
          });
        }
        await recargar("epp_entregas");
      })();
    },
  };

  return (
    <AppCtx.Provider
      value={{ user, setUser, empresaId, setEmpresaId, empresa, db, origen, persona, sede, empresaPor, recargar, ...acciones }}
    >
      {children}
    </AppCtx.Provider>
  );
}

export const useApp = () => useContext(AppCtx);
