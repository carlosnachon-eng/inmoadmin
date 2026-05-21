import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabase";

// ── COLORES EMPORIO ──────────────────────────────────────────────────────────
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

// ── NAV ──────────────────────────────────────────────────────────────────────
export const nav = [
  { id: "dashboard",     label: "Panel",          icon: "📊" },
  { id: "caja",          label: "Caja",            icon: "💵",  link: "/caja" },
  { id: "contracts",     label: "Contratos",       icon: "📋",  link: "/contratos" },
  { id: "properties",    label: "Propiedades",     icon: "🏠" },
  { id: "payments",      label: "Cobranza",        icon: "💰",  link: "/cobranza" },
  { id: "owner_payments",label: "Liquidaciones",   icon: "🏦",  link: "/liquidaciones" },
  { id: "tickets",       label: "Mantenimiento",   icon: "🔧",  link: "/mantenimiento" },
  { id: "reports",       label: "Reportes",        icon: "📈",  link: "/reportes" },
  { id: "commissions",   label: "Comisiones",      icon: "💼",  link: "/comisiones" },
  { id: "cierres",       label: "Cierres",         icon: "📊",  link: "/cierres" },
  { id: "firmas",        label: "Firmas",          icon: "📝",  link: "/firmas" },
  { id: "poliza",        label: "Póliza",          icon: "⚖️",  link: "/poliza" },
];

// ── LOGO SVG (corona Emporio) ─────────────────────────────────────────────────
export const EmporioLogo = ({ size = 36 }) => (
  <img
    src="https://www.emporioinmobiliario.com.mx/logo.png"
    alt="Emporio Inmobiliario"
    style={{ height: size, objectFit: "contain" }}
  />
);

// ── LAYOUT PRINCIPAL ─────────────────────────────────────────────────────────
export default function Layout({ children, view = "dashboard", profile, onNavClick, onLogout }) {
  const router = useRouter();
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

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

  const currentLabel = nav.find(n => n.id === view)?.label || "Panel";

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "system-ui, sans-serif", background: brand.bg }}>

      {/* Overlay mobile */}
      {isMobile && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 150 }} />
      )}

      {/* ── SIDEBAR ── */}
      <div style={{
        width: 230, background: brand.white, display: "flex", flexDirection: "column", flexShrink: 0,
        borderRight: `1px solid ${brand.border}`,
        position: isMobile ? "fixed" : "relative", top: 0, left: 0, height: "100vh",
        transform: isMobile ? (sidebarOpen ? "translateX(0)" : "translateX(-230px)") : "none",
        transition: "transform 0.25s ease", zIndex: 200,
        boxShadow: isMobile && sidebarOpen ? "4px 0 20px rgba(0,0,0,0.15)" : "none",
      }}>

        {/* Logo */}
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

        {/* Nav */}
        <nav style={{ padding: "10px 10px", flex: 1, overflowY: "auto" }}>
          {nav.map(n => {
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

        {/* Usuario */}
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
                {profile?.role === "admin" ? "Administrador" : "Staff"}
              </p>
            </div>
          </div>
          <button onClick={onLogout} style={{ width: "100%", background: "#f9fafb", color: brand.grayLight, border: `1px solid ${brand.border}`, borderRadius: 8, padding: "7px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
            Cerrar sesión
          </button>
        </div>
      </div>

      {/* ── CONTENIDO ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>

        {/* Topbar mobile */}
        {isMobile && (
          <div style={{ background: brand.white, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0, position: "sticky", top: 0, zIndex: 100, borderBottom: `1px solid ${brand.border}`, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
            <button onClick={() => setSidebarOpen(true)} style={{ background: "none", border: "none", color: brand.red, fontSize: 22, cursor: "pointer", padding: 0, lineHeight: 1 }}>☰</button>
            <EmporioLogo size={28} />
            <span style={{ color: brand.gray, fontWeight: 700, fontSize: 14 }}>{currentLabel}</span>
          </div>
        )}

        {/* Topbar desktop */}
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

        {/* Página */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ── HEADER PARA PÁGINAS SEPARADAS (mantenimiento, caja, etc.) ────────────────
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

// ── BOTÓN ESTÁNDAR EMPORIO ───────────────────────────────────────────────────
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
