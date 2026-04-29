import { useState } from "react";
import Logo from "./Logo";

const NAV_LINKS = [
  { label: "Inicio", href: "/" },
  { label: "Propiedades", href: "/propiedades" },
  { label: "Propietarios", href: "/propietarios" },
  { label: "Arrendatarios", href: "/arrendatarios" },
  { label: "Nosotros", href: "/nosotros" },
  { label: "Contacto", href: "/contacto" },
];

export default function Navbar({ transparent = false }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <nav style={{
        position: transparent ? "absolute" : "sticky",
        top: 0, left: 0, right: 0, zIndex: 50,
        background: transparent ? "transparent" : "#1a1a2e",
        borderBottom: transparent ? "none" : "1px solid rgba(255,255,255,0.08)",
        padding: "0 32px",
        fontFamily: "'Montserrat', sans-serif",
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 72 }}>
          <a href="/" style={{ textDecoration: "none" }}>
            <Logo size={36} dark={false} />
          </a>

          {/* Desktop nav */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {NAV_LINKS.map(link => (
              <a key={link.href} href={link.href} style={{
                color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: 600,
                textDecoration: "none", padding: "8px 14px", borderRadius: 8,
                letterSpacing: "0.03em", transition: "all 0.15s",
              }}
                onMouseEnter={e => { e.target.style.color = "#fff"; e.target.style.background = "rgba(255,255,255,0.1)"; }}
                onMouseLeave={e => { e.target.style.color = "rgba(255,255,255,0.85)"; e.target.style.background = "transparent"; }}
              >
                {link.label}
              </a>
            ))}
            <a href="https://wa.me/522222573237" target="_blank" rel="noreferrer" style={{
              marginLeft: 8, background: "#C8102E", color: "#fff",
              padding: "9px 20px", borderRadius: 8, fontSize: 13,
              fontWeight: 700, textDecoration: "none", letterSpacing: "0.03em",
              transition: "background 0.15s",
            }}
              onMouseEnter={e => e.target.style.background = "#a50d27"}
              onMouseLeave={e => e.target.style.background = "#C8102E"}
            >
              📞 Contáctanos
            </a>
          </div>
        </div>
      </nav>

      {/* Mobile overlay */}
      {open && (
        <div style={{ position: "fixed", inset: 0, background: "#1a1a2e", zIndex: 100, padding: 32, fontFamily: "'Montserrat', sans-serif" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 40 }}>
            <Logo size={36} />
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "#fff", fontSize: 28, cursor: "pointer" }}>✕</button>
          </div>
          {NAV_LINKS.map(link => (
            <a key={link.href} href={link.href} style={{ display: "block", color: "#fff", fontSize: 22, fontWeight: 700, textDecoration: "none", padding: "16px 0", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
              {link.label}
            </a>
          ))}
        </div>
      )}
    </>
  );
}
