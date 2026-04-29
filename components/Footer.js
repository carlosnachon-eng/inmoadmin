import Logo from "./Logo";

export default function Footer() {
  return (
    <footer style={{ background: "#0f0f1a", color: "#fff", fontFamily: "'Montserrat', sans-serif", paddingTop: 64 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 32px 48px", display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 48 }}>

        {/* Columna 1 - Brand */}
        <div>
          <Logo size={36} />
          <p style={{ marginTop: 20, fontSize: 14, color: "rgba(255,255,255,0.55)", lineHeight: 1.8, maxWidth: 280 }}>
            Más de 20 años ayudando a familias y empresas a vender, rentar o encontrar su propiedad ideal en Puebla. Sin estrés, sin sorpresas.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
            {[
              { icon: "f", href: "https://facebook.com", label: "Facebook" },
              { icon: "in", href: "https://instagram.com", label: "Instagram" },
              { icon: "tt", href: "https://tiktok.com", label: "TikTok" },
              { icon: "yt", href: "https://youtube.com", label: "YouTube" },
            ].map(s => (
              <a key={s.label} href={s.href} target="_blank" rel="noreferrer" style={{
                width: 36, height: 36, borderRadius: "50%",
                background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, textDecoration: "none",
                transition: "background 0.15s",
              }}
                onMouseEnter={e => e.currentTarget.style.background = "#C8102E"}
                onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}
              >
                {s.icon}
              </a>
            ))}
          </div>
        </div>

        {/* Columna 2 - Navegación */}
        <div>
          <h4 style={{ fontSize: 11, fontWeight: 700, color: "#C8102E", letterSpacing: "0.15em", textTransform: "uppercase", margin: "0 0 20px" }}>Navegación</h4>
          {[
            { label: "Inicio", href: "/" },
            { label: "Propiedades", href: "/propiedades" },
            { label: "Propietarios", href: "/propietarios" },
            { label: "Arrendatarios", href: "/arrendatarios" },
            { label: "Quiénes somos", href: "/nosotros" },
            { label: "Contacto", href: "/contacto" },
          ].map(l => (
            <a key={l.href} href={l.href} style={{ display: "block", color: "rgba(255,255,255,0.55)", fontSize: 14, textDecoration: "none", marginBottom: 10, transition: "color 0.15s" }}
              onMouseEnter={e => e.target.style.color = "#fff"}
              onMouseLeave={e => e.target.style.color = "rgba(255,255,255,0.55)"}
            >{l.label}</a>
          ))}
        </div>

        {/* Columna 3 - Servicios */}
        <div>
          <h4 style={{ fontSize: 11, fontWeight: 700, color: "#C8102E", letterSpacing: "0.15em", textTransform: "uppercase", margin: "0 0 20px" }}>Servicios</h4>
          {[
            { label: "Solicitud de arrendamiento", href: "https://app.emporioinmobiliario.com.mx/solicitud" },
            { label: "Simulador de crédito", href: "/simulador" },
            { label: "Portal inquilino", href: "https://app.emporioinmobiliario.com.mx/inquilino" },
            { label: "Portal propietario", href: "https://app.emporioinmobiliario.com.mx/propietario" },
            { label: "Aviso de privacidad", href: "/aviso-privacidad" },
          ].map(l => (
            <a key={l.href} href={l.href} style={{ display: "block", color: "rgba(255,255,255,0.55)", fontSize: 14, textDecoration: "none", marginBottom: 10, transition: "color 0.15s" }}
              onMouseEnter={e => e.target.style.color = "#fff"}
              onMouseLeave={e => e.target.style.color = "rgba(255,255,255,0.55)"}
            >{l.label}</a>
          ))}
        </div>

        {/* Columna 4 - Contacto */}
        <div>
          <h4 style={{ fontSize: 11, fontWeight: 700, color: "#C8102E", letterSpacing: "0.15em", textTransform: "uppercase", margin: "0 0 20px" }}>Contacto</h4>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", lineHeight: 1.8, margin: "0 0 12px" }}>
            5to Retorno de Osa Menor 2A<br />
            Reserva Territorial Atlixcayotl<br />
            San Andrés Cholula, Pue.
          </p>
          <a href="tel:2222573237" style={{ display: "block", color: "#fff", fontSize: 18, fontWeight: 700, textDecoration: "none", marginBottom: 8 }}>222 257 3237</a>
          <a href="mailto:ventas@emporioinmobiliario.mx" style={{ display: "block", color: "rgba(255,255,255,0.55)", fontSize: 13, textDecoration: "none" }}>ventas@emporioinmobiliario.mx</a>
          <a href="https://wa.me/522222573237" target="_blank" rel="noreferrer" style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            marginTop: 20, background: "#25d366", color: "#fff",
            padding: "10px 20px", borderRadius: 8, fontSize: 13,
            fontWeight: 700, textDecoration: "none",
          }}>
            💬 WhatsApp
          </a>
        </div>
      </div>

      <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", padding: "20px 32px", display: "flex", justifyContent: "space-between", alignItems: "center", maxWidth: 1200, margin: "0 auto" }}>
        <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.3)" }}>© 2025 Emporio Inmobiliario · Grupo Inmobiliario Nachón Torres S.A. de C.V.</p>
        <a href="/aviso-privacidad" style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", textDecoration: "none" }}>Aviso de privacidad</a>
      </div>
    </footer>
  );
}
