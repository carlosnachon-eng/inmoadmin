import { useState } from "react";

const fmt_section = (title) => (
  <div style={{ marginBottom: 8 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
      <div style={{ height: 2, flex: 1, background: "#f3f4f6" }} />
      <span style={{ fontSize: 11, fontWeight: 700, color: "#C8102E", letterSpacing: "0.15em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{title}</span>
      <div style={{ height: 2, flex: 1, background: "#f3f4f6" }} />
    </div>
  </div>
);

function Campo({ label, children, required }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 6, letterSpacing: "0.02em" }}>
        {label}{required && <span style={{ color: "#C8102E" }}> *</span>}
      </label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%", padding: "10px 12px", borderRadius: 8,
  border: "1.5px solid #e5e7eb", fontSize: 14, boxSizing: "border-box",
  fontFamily: "system-ui, sans-serif", color: "#1a1a2e",
  outline: "none", transition: "border 0.15s",
};

const selectStyle = { ...inputStyle, background: "#fff", cursor: "pointer" };
const textareaStyle = { ...inputStyle, minHeight: 80, resize: "vertical" };

export default function Dictamen() {
  const [generando, setGenerando] = useState(false);
  const [form, setForm] = useState({
    // Datos generales
    folio: "", fecha: new Date().toLocaleDateString("es-MX"),
    nombre_solicitante: "", tipo_solicitante: "PERSONA FÍSICA",
    tipo_identificacion: "INE", num_identificacion: "", fecha_nacimiento: "",
    telefono_inquilino: "", correo_inquilino: "",
    domicilio_anterior: "", tiempo_domicilio_anterior: "",
    direccion_inmueble: "", monto_renta: "", fecha_inicio: "",
    // Actividad
    perfil_general: "Los solicitantes fueron evaluados en cuanto a identidad, actividad principal y condiciones generales declaradas para el uso del inmueble.",
    actividad_principal: "", fuente_ingresos: "NÓMINA",
    empresa: "", tel_empresa: "",
    ingreso_mensual: "", relacion_ingreso_renta: "Adecuada",
    comprobante_ingresos: "Sí — 3 recibos de nómina presentados",
    // Uso
    uso_declarado: "HABITACIONAL", descripcion_uso: "",
    num_ocupantes: "", mascotas: "No", personal_servicio: "No", modalidad_servicio: "",
    // Referencias
    ref1_nombre: "", ref1_telefono: "", ref1_relacion: "",
    ref2_nombre: "", ref2_telefono: "", ref2_relacion: "",
    // Legal
    resultado_legal: "Sin antecedentes", observaciones_legales: "",
    referencias: "Se revisaron referencias e historial de arrendamiento, no detectándose alertas relevantes para el propietario.",
    revision_legal: "Se realizó verificación de identidad y consulta de antecedentes jurídicos en plataforma BuroMexico. No se detectaron impedimentos legales, inconsistencias relevantes ni riesgos jurídicos que comprometan la celebración del contrato de arrendamiento ni la emisión de la póliza jurídica.",
    // Conclusión
    conclusion: "Derivado de la investigación realizada, el perfil de los solicitantes resulta congruente con el inmueble y el monto de renta.",
    observaciones_analista: "",
    // Dictamen
    dictamen: "APROBADO", condiciones: "",
    analista: "LIC. ZAYETZY MONTES LUNA",
  });

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const handleGenerar = async () => {
    if (!form.folio || !form.nombre_solicitante) {
      alert("Por favor completa al menos el Folio y Nombre del solicitante.");
      return;
    }
    setGenerando(true);
    try {
      const res = await fetch("/api/generar-dictamen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Error al generar PDF");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Dictamen_${form.folio || "nuevo"}_${form.nombre_solicitante.split(" ")[0]}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Error al generar el PDF: " + e.message);
    }
    setGenerando(false);
  };

  const DICTAMEN_OPTS = [
    { value: "APROBADO",                color: "#22c55e", bg: "#dcfce7", icon: "✓", label: "APROBADO" },
    { value: "APROBADO CON CONDICIONES", color: "#eab308", bg: "#fef9c3", icon: "!", label: "CON CONDICIONES" },
    { value: "NO APROBADO",             color: "#ef4444", bg: "#fee2e2", icon: "✗", label: "NO APROBADO" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", fontFamily: "system-ui, sans-serif" }}>

      {/* Header */}
      <div style={{ background: "#1a1a2e", padding: "20px 32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, color: "#C8102E", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>Emporio Inmobiliario</p>
          <h1 style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 800, color: "#fff" }}>📋 Generador de Dictamen</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "rgba(255,255,255,0.5)" }}>Póliza Jurídica de Desalojo y Deslinde — Habitacional</p>
        </div>
        <a href="/index" style={{ color: "#c8a96e", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>← Panel admin</a>
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px 20px" }}>

        {/* Semáforo selector */}
        <div style={{ background: "#fff", borderRadius: 16, padding: "24px 28px", marginBottom: 24, border: "1px solid #f0f0f0", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
          <p style={{ margin: "0 0 16px", fontSize: 12, fontWeight: 700, color: "#C8102E", letterSpacing: "0.15em", textTransform: "uppercase" }}>Dictamen Final</p>
          <div style={{ display: "flex", gap: 16 }}>
            {DICTAMEN_OPTS.map(opt => (
              <button key={opt.value} onClick={() => set("dictamen", opt.value)} style={{
                flex: 1, padding: "20px 12px", borderRadius: 14, cursor: "pointer",
                border: form.dictamen === opt.value ? `3px solid ${opt.color}` : "2px solid #f3f4f6",
                background: form.dictamen === opt.value ? opt.bg : "#fafafa",
                transition: "all 0.2s",
              }}>
                <div style={{ fontSize: 28, marginBottom: 8,
                  color: form.dictamen === opt.value ? opt.color : "#d1d5db" }}>
                  {opt.icon === "✓" ? "●" : opt.icon === "!" ? "●" : "●"}
                </div>
                <div style={{ width: 44, height: 44, borderRadius: "50%", margin: "0 auto 10px",
                  background: form.dictamen === opt.value ? opt.bg : "#f3f4f6",
                  border: form.dictamen === opt.value ? `3px solid ${opt.color}` : "2px solid #e5e7eb",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 20, fontWeight: 900,
                  color: form.dictamen === opt.value ? opt.color : "#d1d5db"
                }}>
                  {opt.icon}
                </div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 800,
                  color: form.dictamen === opt.value ? opt.color : "#9ca3af" }}>
                  {opt.label}
                </p>
              </button>
            ))}
          </div>
          {form.dictamen === "APROBADO CON CONDICIONES" && (
            <div style={{ marginTop: 16 }}>
              <Campo label="Especifica las condiciones">
                <input value={form.condiciones} onChange={e => set("condiciones", e.target.value)}
                  placeholder="Ej. Requiere aval, Primer mes de garantía adicional..."
                  style={inputStyle} />
              </Campo>
            </div>
          )}
        </div>

        {/* Formulario principal */}
        <div style={{ background: "#fff", borderRadius: 16, padding: "28px 32px", border: "1px solid #f0f0f0", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>

          {/* I. Datos generales */}
          {fmt_section("I. Datos Generales")}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <Campo label="Folio" required>
              <input value={form.folio} onChange={e => set("folio", e.target.value)}
                placeholder="E646" style={inputStyle} />
            </Campo>
            <Campo label="Fecha">
              <input value={form.fecha} onChange={e => set("fecha", e.target.value)}
                placeholder="27/04/2026" style={inputStyle} />
            </Campo>
            <Campo label="Tipo de solicitante">
              <select value={form.tipo_solicitante} onChange={e => set("tipo_solicitante", e.target.value)} style={selectStyle}>
                <option>PERSONA FÍSICA</option>
                <option>PERSONA MORAL</option>
              </select>
            </Campo>
          </div>

          <Campo label="Nombre completo del solicitante" required>
            <input value={form.nombre_solicitante} onChange={e => set("nombre_solicitante", e.target.value)}
              placeholder="Nombre completo tal como aparece en identificación" style={inputStyle} />
          </Campo>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <Campo label="Tipo de identificación">
              <select value={form.tipo_identificacion} onChange={e => set("tipo_identificacion", e.target.value)} style={selectStyle}>
                <option>INE</option>
                <option>Pasaporte</option>
                <option>Cédula Profesional</option>
                <option>Otro</option>
              </select>
            </Campo>
            <Campo label="Número de identificación">
              <input value={form.num_identificacion} onChange={e => set("num_identificacion", e.target.value)}
                placeholder="Clave de elector o número de doc." style={inputStyle} />
            </Campo>
            <Campo label="Fecha de nacimiento">
              <input value={form.fecha_nacimiento} onChange={e => set("fecha_nacimiento", e.target.value)}
                placeholder="DD/MM/AAAA" style={inputStyle} />
            </Campo>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Campo label="Teléfono del inquilino">
              <input value={form.telefono_inquilino} onChange={e => set("telefono_inquilino", e.target.value)}
                placeholder="222 123 4567" style={inputStyle} />
            </Campo>
            <Campo label="Correo electrónico">
              <input value={form.correo_inquilino} onChange={e => set("correo_inquilino", e.target.value)}
                placeholder="inquilino@correo.com" style={inputStyle} />
            </Campo>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
            <Campo label="Domicilio anterior">
              <input value={form.domicilio_anterior} onChange={e => set("domicilio_anterior", e.target.value)}
                placeholder="Calle, número, colonia, ciudad" style={inputStyle} />
            </Campo>
            <Campo label="Tiempo vivido ahí">
              <input value={form.tiempo_domicilio_anterior} onChange={e => set("tiempo_domicilio_anterior", e.target.value)}
                placeholder="Ej. 2 años" style={inputStyle} />
            </Campo>
          </div>

          <Campo label="Dirección del inmueble a rentar" required>
            <input value={form.direccion_inmueble} onChange={e => set("direccion_inmueble", e.target.value)}
              placeholder="Dirección completa del inmueble" style={inputStyle} />
          </Campo>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Campo label="Monto de renta mensual" required>
              <input value={form.monto_renta} onChange={e => set("monto_renta", e.target.value)}
                placeholder="$16,000.00 (DIECISÉIS MIL 00/100 M.N)" style={inputStyle} />
            </Campo>
            <Campo label="Fecha de inicio del contrato">
              <input value={form.fecha_inicio} onChange={e => set("fecha_inicio", e.target.value)}
                placeholder="01/05/2026" style={inputStyle} />
            </Campo>
          </div>

          {/* II. Actividad e Ingresos */}
          {fmt_section("II. Actividad y Fuente de Ingresos")}

          <Campo label="Actividad principal">
            <input value={form.actividad_principal} onChange={e => set("actividad_principal", e.target.value)}
              placeholder="Profesión u ocupación" style={inputStyle} />
          </Campo>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <Campo label="Fuente de ingresos">
              <select value={form.fuente_ingresos} onChange={e => set("fuente_ingresos", e.target.value)} style={selectStyle}>
                <option>NÓMINA</option>
                <option>HONORARIOS</option>
                <option>NEGOCIO PROPIO</option>
                <option>PENSIÓN</option>
                <option>INVERSIONES</option>
                <option>OTRA</option>
              </select>
            </Campo>
            <Campo label="Empresa / Empleador">
              <input value={form.empresa} onChange={e => set("empresa", e.target.value)}
                placeholder="Nombre de la empresa" style={inputStyle} />
            </Campo>
            <Campo label="Teléfono RRHH / Empresa">
              <input value={form.tel_empresa} onChange={e => set("tel_empresa", e.target.value)}
                placeholder="222 000 0000" style={inputStyle} />
            </Campo>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <Campo label="Ingreso mensual aproximado">
              <input value={form.ingreso_mensual} onChange={e => set("ingreso_mensual", e.target.value)}
                placeholder="$36,000.00" style={inputStyle} />
            </Campo>
            <Campo label="Relación ingreso-renta">
              <select value={form.relacion_ingreso_renta} onChange={e => set("relacion_ingreso_renta", e.target.value)} style={selectStyle}>
                <option>Adecuada</option>
                <option>Adecuada — ingresos 2x el monto de renta</option>
                <option>Adecuada — ingresos 2.5x el monto de renta</option>
                <option>Adecuada — ingresos 3x el monto de renta</option>
                <option>Ajustada</option>
                <option>Insuficiente</option>
              </select>
            </Campo>
            <Campo label="Comprobante de ingresos">
              <select value={form.comprobante_ingresos} onChange={e => set("comprobante_ingresos", e.target.value)} style={selectStyle}>
                <option>Sí — 3 recibos de nómina presentados</option>
                <option>Sí — estados de cuenta presentados</option>
                <option>Sí — declaración fiscal presentada</option>
                <option>Parcial — documentación incompleta</option>
                <option>No presentado</option>
              </select>
            </Campo>
          </div>

          {/* III. Uso y Ocupantes */}
          {fmt_section("III. Uso del Inmueble y Ocupantes")}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Campo label="Uso declarado">
              <select value={form.uso_declarado} onChange={e => set("uso_declarado", e.target.value)} style={selectStyle}>
                <option>HABITACIONAL</option>
                <option>COMERCIAL</option>
                <option>MIXTO</option>
              </select>
            </Campo>
            <Campo label="Descripción del uso">
              <input value={form.descripcion_uso} onChange={e => set("descripcion_uso", e.target.value)}
                placeholder="Ej. Casa familiar, Departamento para estudiante..." style={inputStyle} />
            </Campo>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <Campo label="Número de ocupantes">
              <input value={form.num_ocupantes} onChange={e => set("num_ocupantes", e.target.value)}
                placeholder="Ej. 2 personas" style={inputStyle} />
            </Campo>
            <Campo label="Mascotas">
              <select value={form.mascotas} onChange={e => set("mascotas", e.target.value)} style={selectStyle}>
                <option>No</option>
                <option>Sí — perro</option>
                <option>Sí — gato</option>
                <option>Sí — especificar en observaciones</option>
              </select>
            </Campo>
            <Campo label="Personal de servicio">
              <select value={form.personal_servicio} onChange={e => set("personal_servicio", e.target.value)} style={selectStyle}>
                <option>No</option>
                <option>Sí — modalidad entrada y salida</option>
                <option>Sí — modalidad de planta</option>
              </select>
            </Campo>
          </div>

          {/* IV. Referencias */}
          {fmt_section("IV. Referencias Personales")}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 16 }}>
            <Campo label="Referencia 1 — Nombre">
              <input value={form.ref1_nombre} onChange={e => set("ref1_nombre", e.target.value)}
                placeholder="Nombre completo" style={inputStyle} />
            </Campo>
            <Campo label="Teléfono">
              <input value={form.ref1_telefono} onChange={e => set("ref1_telefono", e.target.value)}
                placeholder="222 000 0000" style={inputStyle} />
            </Campo>
            <Campo label="Relación">
              <input value={form.ref1_relacion} onChange={e => set("ref1_relacion", e.target.value)}
                placeholder="Ej. Colega, Familiar..." style={inputStyle} />
            </Campo>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 16 }}>
            <Campo label="Referencia 2 — Nombre">
              <input value={form.ref2_nombre} onChange={e => set("ref2_nombre", e.target.value)}
                placeholder="Nombre completo" style={inputStyle} />
            </Campo>
            <Campo label="Teléfono">
              <input value={form.ref2_telefono} onChange={e => set("ref2_telefono", e.target.value)}
                placeholder="222 000 0000" style={inputStyle} />
            </Campo>
            <Campo label="Relación">
              <input value={form.ref2_relacion} onChange={e => set("ref2_relacion", e.target.value)}
                placeholder="Ej. Amigo, Vecino..." style={inputStyle} />
            </Campo>
          </div>

          {/* V. Antecedentes */}
          {fmt_section("V. Antecedentes Legales — BuroMexico")}
          <Campo label="Resultado de consulta">
            <div style={{ display: "flex", gap: 12 }}>
              {["Sin antecedentes", "Con antecedentes"].map(opt => (
                <button key={opt} onClick={() => set("resultado_legal", opt)} style={{
                  flex: 1, padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 14,
                  border: "2px solid",
                  borderColor: form.resultado_legal === opt
                    ? (opt === "Sin antecedentes" ? "#22c55e" : "#ef4444")
                    : "#e5e7eb",
                  background: form.resultado_legal === opt
                    ? (opt === "Sin antecedentes" ? "#dcfce7" : "#fee2e2")
                    : "#fafafa",
                  color: form.resultado_legal === opt
                    ? (opt === "Sin antecedentes" ? "#166534" : "#991b1b")
                    : "#9ca3af",
                }}>
                  {opt === "Sin antecedentes" ? "✓ " : "⚠ "}{opt}
                </button>
              ))}
            </div>
          </Campo>
          {form.resultado_legal === "Con antecedentes" && (
            <Campo label="Descripción de antecedentes">
              <textarea value={form.observaciones_legales} onChange={e => set("observaciones_legales", e.target.value)}
                placeholder="Describe los antecedentes encontrados..." style={textareaStyle} />
            </Campo>
          )}

          {/* VI. Conclusión */}
          {fmt_section("VI. Conclusión y Observaciones")}
          <Campo label="Conclusión y recomendación">
            <textarea value={form.conclusion} onChange={e => set("conclusion", e.target.value)}
              style={{ ...textareaStyle, minHeight: 90 }} />
          </Campo>
          <Campo label="Observaciones adicionales del analista">
            <textarea value={form.observaciones_analista} onChange={e => set("observaciones_analista", e.target.value)}
              placeholder="Notas adicionales, contexto relevante para el propietario..."
              style={{ ...textareaStyle, minHeight: 80 }} />
          </Campo>

          {/* Analista */}
          {fmt_section("VII. Firma")}
          <Campo label="Analista responsable">
            <select value={form.analista} onChange={e => set("analista", e.target.value)} style={selectStyle}>
              <option>LIC. ZAYETZY MONTES LUNA</option>
              <option>LIC. CARLOS NACHÓN</option>
              <option>OTRO</option>
            </select>
          </Campo>

          {/* Botón generar */}
          <div style={{ marginTop: 32, paddingTop: 24, borderTop: "1px solid #f3f4f6" }}>
            <button onClick={handleGenerar} disabled={generando} style={{
              width: "100%", background: generando ? "#9ca3af" : "#C8102E",
              color: "#fff", border: "none", borderRadius: 12, padding: "16px",
              fontWeight: 800, fontSize: 17, cursor: generando ? "not-allowed" : "pointer",
              fontFamily: "system-ui, sans-serif", letterSpacing: "0.02em",
              transition: "background 0.15s",
            }}>
              {generando ? "⏳ Generando PDF..." : "📄 Generar y Descargar Dictamen PDF"}
            </button>
            <p style={{ textAlign: "center", fontSize: 12, color: "#9ca3af", marginTop: 12 }}>
              El PDF se descargará automáticamente con el folio y nombre del solicitante
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
