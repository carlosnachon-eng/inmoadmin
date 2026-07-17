// lib/permisos.js
//
// Helper centralizado para verificar permisos por rol y módulo.
// En vez de escribir "if (email === 'guillermo@...')" en cada archivo,
// cada página solo necesita llamar a usePermiso("nombre-del-modulo")
// y preguntarle al resultado si puede ver/editar.
//
// Uso típico al inicio de cualquier pages/algo.js:
//
//   import { usePermiso } from "../lib/permisos";
//   ...
//   const { cargando, puedeVer, puedeEditar, alcance, perfil } = usePermiso("mantenimiento");
//   if (cargando) return null;
//   if (!puedeVer) return <SinAcceso />;
//   ...
//   {puedeEditar && <button>Editar</button>}

import { useState, useEffect } from "react";
import { supabase } from "./supabase";

export function usePermiso(modulo) {
  const [cargando, setCargando] = useState(true);
  const [perfil, setPerfil] = useState(null);
  const [permiso, setPermiso] = useState({ puedeVer: false, puedeEditar: false, alcance: "todos" });

  useEffect(() => {
    let activo = true;

    async function cargar() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        if (activo) { setCargando(false); }
        return;
      }

      const { data: perfilData } = await supabase
        .from("profiles")
        .select("*, roles:role_id(id, nombre, es_externo)")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!activo) return;
      setPerfil(perfilData);

      const perfilBloqueado = !perfilData || perfilData.active === false || perfilData.roles?.es_externo;
      if (perfilBloqueado) {
        setPermiso({ puedeVer: false, puedeEditar: false, alcance: "todos" });
        setCargando(false);
        return;
      }

      // Admin siempre tiene acceso total, sin necesidad de consultar la matriz
      if (perfilData?.role_id === "admin") {
        setPermiso({ puedeVer: true, puedeEditar: true, alcance: "todos" });
        setCargando(false);
        return;
      }

      if (!perfilData?.role_id) {
        // Sin rol asignado: por seguridad, sin acceso a nada hasta que se le asigne uno
        setPermiso({ puedeVer: false, puedeEditar: false, alcance: "todos" });
        setCargando(false);
        return;
      }

      const { data: permisoData } = await supabase
        .from("permisos_modulo")
        .select("*")
        .eq("role_id", perfilData.role_id)
        .eq("modulo", modulo)
        .maybeSingle();

      if (!activo) return;

      if (permisoData) {
        setPermiso({
          puedeVer: permisoData.puede_ver,
          puedeEditar: permisoData.puede_editar,
          alcance: permisoData.alcance,
        });
      } else {
        // No hay fila para ese rol+módulo => sin acceso
        setPermiso({ puedeVer: false, puedeEditar: false, alcance: "todos" });
      }
      setCargando(false);
    }

    cargar();
    return () => { activo = false; };
  }, [modulo]);

  return {
    cargando,
    perfil,
    puedeVer: permiso.puedeVer,
    puedeEditar: permiso.puedeEditar,
    alcance: permiso.alcance, // "todos" | "propio"
    esAdmin: perfil?.active !== false && !perfil?.roles?.es_externo && perfil?.role_id === "admin",
  };
}

// Hook para traer de una sola consulta todos los módulos a los que el
// usuario tiene acceso de ver. Pensado para construir menús/sidebars
// dinámicos sin tener que llamar usePermiso(modulo) uno por uno.
//
// Uso típico en Layout.js:
//
//   import { useModulosPermitidos } from "../lib/permisos";
//   ...
//   const { cargando, modulosPermitidos, esAdmin, perfil } = useModulosPermitidos();
//   const navFiltrado = nav.filter(n => !n.modulo || esAdmin || modulosPermitidos.includes(n.modulo));

export function useModulosPermitidos(enabled = true) {
  const [cargando, setCargando] = useState(enabled);
  const [perfil, setPerfil] = useState(null);
  const [modulosPermitidos, setModulosPermitidos] = useState([]);

  useEffect(() => {
    if (!enabled) return;
    let activo = true;

    async function cargar() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        if (activo) setCargando(false);
        return;
      }

      const { data: perfilData } = await supabase
        .from("profiles")
        .select("*, roles:role_id(id, nombre, es_externo)")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!activo) return;
      setPerfil(perfilData);

      const perfilBloqueado = !perfilData || perfilData.active === false || perfilData.roles?.es_externo;
      if (perfilBloqueado) {
        setModulosPermitidos([]);
        setCargando(false);
        return;
      }

      // Admin no necesita consultar la matriz: tiene acceso a todo
      if (perfilData?.role_id === "admin") {
        setModulosPermitidos([]); // se ignora cuando esAdmin es true
        setCargando(false);
        return;
      }

      if (!perfilData?.role_id) {
        setModulosPermitidos([]);
        setCargando(false);
        return;
      }

      const { data: permisosData } = await supabase
        .from("permisos_modulo")
        .select("modulo")
        .eq("role_id", perfilData.role_id)
        .eq("puede_ver", true);

      if (!activo) return;

      setModulosPermitidos((permisosData || []).map(p => p.modulo));
      setCargando(false);
    }

    cargar();
    return () => { activo = false; };
  }, [enabled]);

  return {
    cargando,
    perfil,
    modulosPermitidos,
    esAdmin: perfil?.active !== false && !perfil?.roles?.es_externo && perfil?.role_id === "admin",
  };
}


export function SinAcceso() {
  return (
    <div style={{
      minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "system-ui, sans-serif", textAlign: "center", padding: 24,
    }}>
      <div>
        <p style={{ fontSize: 48, margin: "0 0 12px" }}>🔒</p>
        <h2 style={{ margin: "0 0 8px", color: "#1a1a2e" }}>No tienes acceso a este módulo</h2>
        <p style={{ color: "#6b7280", fontSize: 14 }}>Si crees que esto es un error, contacta al administrador del sistema.</p>
      </div>
    </div>
  );
}
