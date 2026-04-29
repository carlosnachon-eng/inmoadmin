export default function Logo({ size = 40, dark = false }) {
  const textColor = dark ? "#4a4a5a" : "#ffffff";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <svg width={size} height={size * 0.75} viewBox="0 0 120 90" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Corona Emporio - recreación fiel */}
        <polygon points="10,80 35,20 60,50 85,20 110,80 90,80 60,35 30,80" fill="#C8102E" opacity="0.85"/>
        <polygon points="30,80 60,35 90,80 75,80 60,55 45,80" fill="#8B0000" opacity="0.9"/>
        <polygon points="10,80 35,20 50,60 30,80" fill="#C8102E"/>
        <polygon points="110,80 85,20 70,60 90,80" fill="#C8102E"/>
        <polygon points="35,20 60,50 85,20 75,35 60,22 45,35" fill="#C8102E" opacity="0.7"/>
      </svg>
      <div>
        <div style={{ fontSize: size * 0.38, fontWeight: 800, color: dark ? "#4a4a5a" : "#fff", letterSpacing: "0.12em", lineHeight: 1, fontFamily: "'Montserrat', sans-serif" }}>
          EMPORIO
        </div>
        <div style={{ fontSize: size * 0.14, fontWeight: 400, color: dark ? "#9ca3af" : "rgba(255,255,255,0.7)", letterSpacing: "0.25em", lineHeight: 1.2, fontFamily: "'Montserrat', sans-serif" }}>
          INMOBILIARIO
        </div>
      </div>
    </div>
  );
}
