import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabase";
import { useModulosPermitidos } from "../lib/permisos";

export const brand = {
  red:       "#b91c3c",
  redDark:   "#7f1d2e",
  redLight:  "#fce8ed",
  gray:      "#4a4a4a",
  grayLight: "#7a7a7a",
  bg:        "#f4f5f7",
  white:     "#ffffff",
  border:    "#e5e7eb",
};

export const nav = [
  { id: "bienvenida",    label: "Inicio",             icon: "🏡",  link: "/",                  modulo: null, siempreVisible: true },
  { id: "caja",          label: "Caja",              icon: "💵",  link: "/caja",              modulo: "caja" },
  { id: "reporte-propietario", label: "Reporte Propietarios", icon: "📊", link: "/reporte-propietario", modulo: "reporte-propietario" },
  { id: "checador",      label: "Checador",          icon: "🕒",  link: "/checador",           modulo: "checador" },
  { id: "guias",         label: "Guías",              icon: "📍",  link: "/guias",              modulo: "guias" },
  { id: "kpis",          label: "KPIs",               icon: "🎯",  link: "/kpis",               modulo: "kpis" },
  { id: "kpis_dashboard",label: "KPIs Dashboard",     icon: "📊",  link: "/kpis-dashboard",     modulo: "kpis-dashboard" },
  { id: "propiedades",   label: "Propiedades",        icon: "🏠",  link: "/propiedades",        modulo: "propiedades" },
  { id: "catalogo_venta",label: "Catálogo Web",       icon: "🌐",  link: "/propiedades-admin",  modulo: "propiedades-admin" },
  { id: "payments",      label: "Cobranza",           icon: "💰",  link: "/cobranza",           modulo: "cobranza" },
  { id: "owner_payments",label: "Liquidaciones",      icon: "🏦",  link: "/liquidaciones",      modulo: "liquidaciones" },
  { id: "tickets",       label: "Mantenimiento",      icon: "🔧",  link: "/mantenimiento",      modulo: "mantenimiento" },
  { id: "reports",       label: "Reportes",           icon: "📈",  link: "/reportes",           modulo: "reportes" },
  { id: "commissions",   label: "Comisiones",         icon: "💼",  link: "/comisiones",         modulo: "comisiones" },
  { id: "cierres",       label: "Cierres",            icon: "📊",  link: "/cierres",            modulo: "cierres" },
  { id: "ejecutivo",     label: "Resumen Ejecutivo",  icon: "👑",  link: "/ejecutivo",          modulo: "ejecutivo" },
  { id: "firmas",        label: "Firmas",             icon: "📝",  link: "/firmas",             modulo: "firmas" },
  { id: "poliza",        label: "Póliza",             icon: "⚖️",  link: "/poliza",             modulo: "poliza" },
  { id: "dictamen",      label: "Dictamen",           icon: "📋",  link: "/dictamen",           modulo: "dictamen" },
  { id: "contracts",     label: "Contratos",          icon: "📋",  link: "/contratos",          modulo: "contratos" },
  { id: "kpis_mtto",     label: "KPIs Mtto/Admon",    icon: "📊",  link: "/kpis-mtto-admon",    modulo: "kpis-mtto-admon" },
  { id: "condominios",   label: "Condominios",        icon: "🏢",  link: "/condominios",        modulo: "condominios" },
  { id: "recibos",       label: "Recibos",            icon: "🧾",  link: "/recibos",            modulo: "recibos" },
  { id: "cartas",        label: "Cartas de Oferta",   icon: "📄",  link: "/cartas",             modulo: "cartas" },
];

export const EmporioLogo = ({ size = 36 }) => (
  <img
    src="https://www.emporioinmobiliario.com.mx/logo.png"
    alt="Emporio Inmobiliario"
    style={{ height: size, objectFit: "contain" }}
  />
);

export default function Layout({ children, view = "dashboard", profile, onNavClick, onLogout, modulosPermitidos: modulosProp, esAdmin: esAdminProp, permisosCargando: permisosCargandoProp }) {
  const router = useRouter();
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Si el padre ya consultó los permisos (p. ej. pages/index.js), los reutilizamos
  // en vez de volver a consultar Supabase. Si no, Layout consulta por su cuenta.
  const yaTienePermisos = modulosProp !== undefined && esAdminProp !== undefined;
  const permisosHook = useModulosPermitidos(!yaTienePermisos);

  const permisosCargando = yaTienePermisos ? !!permisosCargandoProp : permisosHook.cargando;
  const modulosPermitidos = yaTienePermisos ? modulosProp : permisosHook.modulosPermitidos;
  const esAdmin = yaTienePermisos ? esAdminProp : permisosHook.esAdmin;
  const perfilPermisos = yaTienePermisos ? profile : permisosHook.perfil;

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const handleNav = (n) => {
    if (n.link) { window.location.href = n.link; }
    else { onNavClick?.(n.id); setSidebarOpen(false); }
  };

  const navFiltrado = permisosCargando
    ? []
    : nav.filter(n => n.siempreVisible || esAdmin || modulosPermitidos.includes(n.modulo));

  const currentLabel = navFiltrado.find(n => n.id === view)?.label || "Inicio";
  const nombreRol = perfilPermisos?.roles?.nombre || (esAdmin ? "Administrador" : "Staff");

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "system-ui, sans-serif", background: brand.bg }}>
      {isMobile && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 150 }} />
      )}
      <div style={{
        width: 230, background: brand.white, display: "flex", flexDirection: "column", flexShrink: 0,
        borderRight: `1px solid ${brand.border}`,
        position: isMobile ? "fixed" : "relative", top: 0, left: 0, height: "100vh",
        transform: isMobile ? (sidebarOpen ? "translateX(0)" : "translateX(-230px)") : "none",
        transition: "transform 0.25s ease", zIndex: 200,
        boxShadow: isMobile && sidebarOpen ? "4px 0 20px rgba(0,0,0,0.15)" : "none",
      }}>
        <div style={{ padding: "20px 20px 16px", borderBottom: `1px solid ${brand.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <EmporioLogo size={32} />
            <div>
              <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: brand.grayLight, textTransform: "uppercase", letterSpacing: 1 }}>InmoAdmin</p>
            </div>
          </div>
          {isMobile && (
            <button onClick={() => setSidebarOpen(false)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: brand.grayLight, padding: 4 }}>✕</button>
          )}
        </div>
        <nav style={{ padding: "10px 10px", flex: 1, overflowY: "auto" }}>
          {navFiltrado.map(n => {
            const isActive = view === n.id;
            return (
              <button key={n.id} onClick={() => handleNav(n)} style={{
                width: "100%", textAlign: "left", padding: "9px 12px",
                borderRadius: 8, border: "none", cursor: "pointer", marginBottom: 2,
                fontSize: 13, fontWeight: isActive ? 700 : 500,
                background: isActive ? brand.redLight : "transparent",
                color: isActive ? brand.red : brand.gray,
                display: "flex", alignItems: "center", gap: 10,
                transition: "background 0.15s",
              }}>
                <span style={{ fontSize: 15 }}>{n.icon}</span>
                {n.label}
                {isActive && <div style={{ marginLeft: "auto", width: 4, height: 4, borderRadius: "50%", background: brand.red }} />}
              </button>
            );
          })}
        </nav>
        <div style={{ padding: "14px 16px", borderTop: `1px solid ${brand.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: brand.redLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: brand.red, flexShrink: 0 }}>
              {profile?.email?.[0]?.toUpperCase() || "U"}
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: brand.gray, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {profile?.email?.split("@")[0]}
              </p>
              <p style={{ margin: 0, fontSize: 10, color: brand.grayLight, textTransform: "uppercase" }}>
                {nombreRol}
              </p>
            </div>
          </div>
          <button onClick={onLogout} style={{ width: "100%", background: "#f9fafb", color: brand.grayLight, border: `1px solid ${brand.border}`, borderRadius: 8, padding: "7px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
            Cerrar sesión
          </button>
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        {isMobile && (
          <div style={{ background: brand.white, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0, position: "sticky", top: 0, zIndex: 100, borderBottom: `1px solid ${brand.border}`, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
            <button onClick={() => setSidebarOpen(true)} style={{ background: "none", border: "none", color: brand.red, fontSize: 22, cursor: "pointer", padding: 0, lineHeight: 1 }}>☰</button>
            <EmporioLogo size={28} />
            <span style={{ color: brand.gray, fontWeight: 700, fontSize: 14 }}>{currentLabel}</span>
          </div>
        )}
        {!isMobile && (
          <div style={{ background: brand.white, padding: "12px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${brand.border}`, flexShrink: 0 }}>
            <div>
              <p style={{ margin: 0, fontSize: 11, color: brand.grayLight, textTransform: "uppercase", letterSpacing: 1 }}>InmoAdmin</p>
              <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: brand.gray }}>{currentLabel}</h1>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e" }} />
                <span style={{ fontSize: 12, color: brand.grayLight }}>Sistema activo</span>
              </div>
            </div>
          </div>
        )}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function PageHeader({ title, icon, actions }) {
  const router = useRouter();
  return (
    <div style={{ background: brand.white, borderBottom: `1px solid ${brand.border}`, padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button onClick={() => router.push("/")} style={{ display: "flex", alignItems: "center", gap: 8, background: "#f9fafb", border: `1px solid ${brand.border}`, borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600, color: brand.grayLight }}>
          <EmporioLogo size={20} />
          <span>Panel</span>
        </button>
        <div style={{ width: 1, height: 24, background: brand.border }} />
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: brand.gray }}>
          {icon} {title}
        </h1>
      </div>
      {actions && <div style={{ display: "flex", gap: 8 }}>{actions}</div>}
    </div>
  );
}

export function Btn({ children, onClick, variant = "primary", disabled, small }) {
  const styles = {
    primary:   { bg: brand.red,    color: "#fff" },
    secondary: { bg: "#f9fafb",    color: brand.gray },
    danger:    { bg: "#dc2626",    color: "#fff" },
    success:   { bg: "#065f46",    color: "#fff" },
  };
  const s = styles[variant] || styles.primary;
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: s.bg, color: s.color, border: "none",
      borderRadius: small ? 6 : 10, padding: small ? "5px 10px" : "10px 20px",
      fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer",
      fontSize: small ? 12 : 14, opacity: disabled ? 0.6 : 1, whiteSpace: "nowrap",
    }}>
      {children}
    </button>
  );
}
