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
    esAdmin: perfil?.role_id === "admin",
  };
}

// Componente listo para usar cuando alguien no tiene acceso a un módulo
export function SinAcceso() {
  return (
    <div style={{
      minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "system-ui, sans-serif", textAlign: "center", padding: 24,
    }}>
      <div>
        <p style={{ fontSize: 48, margin: "0 0 12px" }}>🔒</p>
        <h2 style={{ margin: "0 0 8px", color: "#1a1a2e" }}>No tienes acceso a este módulo</h2>
        <p style={{ color: "#6b7280", fontSize: 14 }}>Si crees que esto es un error, contacta a Carlos.</p>
      </div>
    </div>
  );
}
