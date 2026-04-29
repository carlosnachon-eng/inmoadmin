import { useState } from "react";

const colors = {
  dark: "#1a1a2e",
  gold: "#c8a96e",
  red: "#c0392b",
  gray: "#f4f5f7",
  white: "#ffffff",
  text: "#374151",
  muted: "#6b7280",
  border: "#e5e7eb",
  success: "#065f46",
  successBg: "#f0fdf4",
};

const Field = ({ label, required, hint, children }) => (
  <div style={{ marginBottom: 20 }}>
    <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: colors.text, marginBottom: 4 }}>
      {label} {required && <span style={{ color: colors.red }}>*</span>}
    </label>
    {hint && <p style={{ margin: "0 0 6px", fontSize: 11, color: colors.muted }}>{hint}</p>}
    {children}
  </div>
);

const Input = (props) => (
  <input {...props} style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: `1.5px solid ${colors.border}`, fontSize: 14, boxSizing: "border-box", background: "#fff", color: colors.text, outline: "none", transition: "border 0.2s", ...props.style }} onFocus={e => e.target.style.borderColor = colors.gold} onBlur={e => e.target.style.borderColor = colors.border} />
);

const Sel = ({ children, ...props }) => (
  <select {...props} style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: `1.5px solid ${colors.border}`, fontSize: 14, boxSizing: "border-box", background: "#fff", color: colors.text, outline: "none", ...props.style }}>
    {children}
  </select>
);

const Textarea = (props) => (
  <textarea {...props} style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: `1.5px solid ${colors.border}`, fontSize: 14, boxSizing: "border-box", background: "#fff", color: colors.text, outline: "none", minHeight: 80, resize: "vertical", ...props.style }} onFocus={e => e.target.style.borderColor = colors.gold} onBlur={e => e.target.style.borderColor = colors.border} />
);

const SectionTitle = ({ number, title, subtitle }) => (
  <div style={{ display: "flex", alignItems: "flex-start", gap: 16, margin: "32px 0 24px", paddingBottom: 16, borderBottom: `2px solid ${colors.gold}` }}>
    <div style={{ background: colors.dark, color: colors.gold, width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 15, flexShrink: 0 }}>{number}</div>
    <div>
      <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: colors.dark }}>{title}</h2>
      {subtitle && <p style={{ margin: "4px 0 0", fontSize: 13, color: colors.muted }}>{subtitle}</p>}
    </div>
  </div>
);

const Grid = ({ cols = 2, children }) => (
  <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 16 }}>{children}</div>
);

export default function SolicitudArrendamiento() {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    direccion_inmueble: "", monto_renta: "", tipo_solicitante: "Persona física",
    nombre_completo: "", telefono: "", email: "", curp: "", rfc: "", nacionalidad: "Mexicana",
    es_extranjero: "No", estatus_migratorio: "", estado_civil: "Soltero(a)",
    nombre_conyuge: "", telefono_conyuge: "", domicilio_actual: "",
    razon_social: "", rfc_empresa: "", giro_empresa: "", domicilio_fiscal: "",
    nombre_representante: "", telefono_representante: "", email_representante: "",
    empresa_labora: "", giro_empresa_labora: "", pagina_web_empresa: "",
    domicilio_trabajo: "", telefono_trabajo: "", nombre_jefe: "", puesto_jefe: "",
    telefono_email_jefe: "", tipo_ingresos: "Empleo formal", ingresos_mensuales: "",
    actividad_empresa: "", giro_comercial: "", pagina_web_empresa2: "",
    origen_recursos: "", ingresos_empresa: "",
    uso_inmueble: "Casa habitación", descripcion_uso: "",
    subarrendamiento: "No", nombre_arrendador: "", telefono_arrendador: "",
    monto_renta_actual: "", motivo_cambio: "",
    ref_fam1_nombre: "", ref_fam1_parentesco: "", ref_fam1_telefono: "",
    ref_fam2_nombre: "", ref_fam2_parentesco: "", ref_fam2_telefono: "",
    ref_fam3_nombre: "", ref_fam3_parentesco: "", ref_fam3_telefono: "",
    ref_per1_nombre: "", ref_per1_relacion: "", ref_per1_telefono: "",
    ref_per2_nombre: "", ref_per2_relacion: "", ref_per2_telefono: "",
    ref_per3_nombre: "", ref_per3_relacion: "", ref_per3_telefono: "",
    num_personas: "", personas_detalle: "",
    mascotas: "No", mascotas_detalle: "",
    personal_servicio: "No", personal_servicio_detalle: "",
  });

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const isMoral = form.tipo_solicitante === "Persona moral";
  const isExtranjero = form.es_extranjero === "Sí";
  const hasConyuge = ["Casado(a)", "Unión libre"].includes(form.estado_civil);

  const totalSteps = 6;

  const handleSubmit = async () => {
    setSubmitting(true); setError("");
    try {
      const res = await fetch("/api/submit-solicitud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) setSubmitted(true);
      else setError("Error al enviar: " + data.error);
    } catch (e) {
      setError("Error de conexión: " + e.message);
    }
    setSubmitting(false);
  };

  if (submitted) return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #1a1a2e, #2d2d5e)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 24, padding: 48, maxWidth: 500, width: "100%", textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ fontSize: 64, marginBottom: 20 }}>✅</div>
        <h2 style={{ margin: "0 0 12px", fontSize: 24, fontWeight: 800, color: colors.dark }}>¡Solicitud enviada!</h2>
        <p style={{ margin: "0 0 8px", fontSize: 15, color: colors.muted }}>Hemos recibido tu solicitud de arrendamiento correctamente.</p>
        <p style={{ margin: "0 0 32px", fontSize: 14, color: colors.muted }}>Nuestro equipo jurídico la revisará y se pondrá en contacto contigo en breve.</p>
        <div style={{ background: colors.successBg, borderRadius: 12, padding: "16px 20px", marginBottom: 24 }}>
          <p style={{ margin: 0, fontSize: 13, color: colors.success, fontWeight: 600 }}>📋 Tus datos han sido registrados en nuestro sistema</p>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: colors.muted }}>¿Tienes dudas? Escríbenos al <strong>222 257 3237</strong></p>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: colors.gray, fontFamily: "system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ background: colors.dark, padding: "20px 24px" }}>
        <div style={{ maxWidth: 780, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <p style={{ margin: 0, fontSize: 11, color: colors.gold, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>Emporio Inmobiliario</p>
            <h1 style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 800, color: "#fff" }}>Solicitud de Arrendamiento</h1>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>Paso {step} de {totalSteps}</p>
            <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
              {Array.from({ length: totalSteps }, (_, i) => (
                <div key={i} style={{ width: 28, height: 4, borderRadius: 2, background: i + 1 <= step ? colors.gold : "rgba(255,255,255,0.2)" }} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 780, margin: "0 auto", padding: "32px 20px" }}>
        <div style={{ background: "#fff", borderRadius: 20, padding: 36, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>

          {/* PASO 1 — Datos del inmueble y tipo de solicitante */}
          {step === 1 && (
            <div>
              <SectionTitle number="1" title="Datos del Inmueble" subtitle="Información sobre la propiedad que deseas rentar" />
              <Field label="Dirección completa del inmueble a rentar" required>
                <Input placeholder="Calle, número, colonia, ciudad" value={form.direccion_inmueble} onChange={e => set("direccion_inmueble", e.target.value)} />
              </Field>
              <Field label="Monto de renta mensual" required hint="Solo el número, sin signos">
                <Input type="number" placeholder="15000" value={form.monto_renta} onChange={e => set("monto_renta", e.target.value)} />
              </Field>

              <SectionTitle number="2" title="Tipo de Solicitante" subtitle="¿Estás rentando como persona física o empresa?" />
              <Field label="Tipo de solicitante" required>
                <div style={{ display: "flex", gap: 12 }}>
                  {["Persona física", "Persona moral"].map(tipo => (
                    <button key={tipo} onClick={() => set("tipo_solicitante", tipo)} style={{ flex: 1, padding: "14px", borderRadius: 12, border: `2px solid ${form.tipo_solicitante === tipo ? colors.gold : colors.border}`, background: form.tipo_solicitante === tipo ? "#fffbeb" : "#fff", color: form.tipo_solicitante === tipo ? colors.dark : colors.muted, fontWeight: 700, cursor: "pointer", fontSize: 14, transition: "all 0.2s" }}>
                      {tipo === "Persona física" ? "👤 Persona física" : "🏢 Persona moral"}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          )}

          {/* PASO 2 — Datos personales */}
          {step === 2 && (
            <div>
              <SectionTitle number="3" title="Datos Personales" subtitle={isMoral ? "Información de la empresa" : "Información del solicitante"} />

              {!isMoral && (
                <>
                  <Grid>
                    <Field label="Nombre completo" required><Input value={form.nombre_completo} onChange={e => set("nombre_completo", e.target.value)} placeholder="Nombre completo" /></Field>
                    <Field label="Teléfono celular" required><Input type="tel" value={form.telefono} onChange={e => set("telefono", e.target.value)} placeholder="2221234567" /></Field>
                  </Grid>
                  <Grid>
                    <Field label="Correo electrónico" required><Input type="email" value={form.email} onChange={e => set("email", e.target.value)} placeholder="correo@ejemplo.com" /></Field>
                    <Field label="CURP"><Input value={form.curp} onChange={e => set("curp", e.target.value)} placeholder="XXXX000000XXXXXX00" /></Field>
                  </Grid>
                  <Grid>
                    <Field label="RFC"><Input value={form.rfc} onChange={e => set("rfc", e.target.value)} placeholder="XXXX000000XXX" /></Field>
                    <Field label="Nacionalidad">
                      <Sel value={form.nacionalidad} onChange={e => set("nacionalidad", e.target.value)}>
                        <option>Mexicana</option>
                        <option>Extranjera</option>
                      </Sel>
                    </Field>
                  </Grid>
                  <Grid>
                    <Field label="¿Eres extranjero?">
                      <Sel value={form.es_extranjero} onChange={e => set("es_extranjero", e.target.value)}>
                        <option>No</option>
                        <option>Sí</option>
                      </Sel>
                    </Field>
                    {isExtranjero && (
                      <Field label="Estatus migratorio"><Input value={form.estatus_migratorio} onChange={e => set("estatus_migratorio", e.target.value)} placeholder="Residente permanente, temporal, etc." /></Field>
                    )}
                  </Grid>
                  <Grid>
                    <Field label="Estado civil">
                      <Sel value={form.estado_civil} onChange={e => set("estado_civil", e.target.value)}>
                        <option>Soltero(a)</option>
                        <option>Casado(a)</option>
                        <option>Unión libre</option>
                        <option>Divorciado(a)</option>
                        <option>Viudo(a)</option>
                      </Sel>
                    </Field>
                    {hasConyuge && (
                      <Field label="Nombre completo del cónyuge"><Input value={form.nombre_conyuge} onChange={e => set("nombre_conyuge", e.target.value)} /></Field>
                    )}
                  </Grid>
                  {hasConyuge && (
                    <Field label="Teléfono del cónyuge"><Input type="tel" value={form.telefono_conyuge} onChange={e => set("telefono_conyuge", e.target.value)} /></Field>
                  )}
                  <Field label="Domicilio actual completo" required><Textarea value={form.domicilio_actual} onChange={e => set("domicilio_actual", e.target.value)} placeholder="Calle, número, colonia, ciudad, CP" /></Field>
                  <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 12, padding: "14px 18px" }}>
                    <p style={{ margin: 0, fontSize: 13, color: "#92400e", fontWeight: 600 }}>📎 Documentos requeridos</p>
                    <p style={{ margin: "6px 0 0", fontSize: 12, color: "#92400e" }}>Identificación oficial vigente y comprobante de domicilio. Envíalos al correo: <strong>administracion@emporioinmobiliario.com.mx</strong></p>
                  </div>
                </>
              )}

              {isMoral && (
                <>
                  <Grid>
                    <Field label="Razón social" required><Input value={form.razon_social} onChange={e => set("razon_social", e.target.value)} /></Field>
                    <Field label="RFC de la empresa" required><Input value={form.rfc_empresa} onChange={e => set("rfc_empresa", e.target.value)} /></Field>
                  </Grid>
                  <Grid>
                    <Field label="Giro o actividad principal"><Input value={form.giro_empresa} onChange={e => set("giro_empresa", e.target.value)} /></Field>
                    <Field label="Domicilio fiscal"><Input value={form.domicilio_fiscal} onChange={e => set("domicilio_fiscal", e.target.value)} /></Field>
                  </Grid>
                  <SectionTitle number="3b" title="Representante Legal" subtitle="" />
                  <Grid>
                    <Field label="Nombre del representante legal" required><Input value={form.nombre_representante} onChange={e => set("nombre_representante", e.target.value)} /></Field>
                    <Field label="Teléfono del representante"><Input type="tel" value={form.telefono_representante} onChange={e => set("telefono_representante", e.target.value)} /></Field>
                  </Grid>
                  <Field label="Correo electrónico del representante"><Input type="email" value={form.email_representante} onChange={e => set("email_representante", e.target.value)} /></Field>
                  <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 12, padding: "14px 18px" }}>
                    <p style={{ margin: 0, fontSize: 13, color: "#92400e", fontWeight: 600 }}>📎 Documentos requeridos</p>
                    <p style={{ margin: "6px 0 0", fontSize: 12, color: "#92400e" }}>Acta constitutiva, Poder del Representante, INE del representante, Constancia de situación fiscal y Comprobante de domicilio. Envíalos a: <strong>administracion@emporioinmobiliario.com.mx</strong></p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* PASO 3 — Información laboral e ingresos */}
          {step === 3 && (
            <div>
              {!isMoral ? (
                <>
                  <SectionTitle number="4" title="Información Laboral" subtitle="Datos de tu empleo o actividad económica" />
                  <Grid>
                    <Field label="Empresa donde laboras o actividad principal" required><Input value={form.empresa_labora} onChange={e => set("empresa_labora", e.target.value)} /></Field>
                    <Field label="Giro de la empresa o actividad económica"><Input value={form.giro_empresa_labora} onChange={e => set("giro_empresa_labora", e.target.value)} /></Field>
                  </Grid>
                  <Grid>
                    <Field label="Página web de la empresa"><Input type="url" placeholder="https://..." value={form.pagina_web_empresa} onChange={e => set("pagina_web_empresa", e.target.value)} /></Field>
                    <Field label="Domicilio del trabajo"><Input value={form.domicilio_trabajo} onChange={e => set("domicilio_trabajo", e.target.value)} /></Field>
                  </Grid>
                  <Grid>
                    <Field label="Teléfono del trabajo"><Input type="tel" value={form.telefono_trabajo} onChange={e => set("telefono_trabajo", e.target.value)} /></Field>
                    <Field label="Nombre del jefe inmediato"><Input value={form.nombre_jefe} onChange={e => set("nombre_jefe", e.target.value)} /></Field>
                  </Grid>
                  <Grid>
                    <Field label="Puesto del jefe inmediato"><Input value={form.puesto_jefe} onChange={e => set("puesto_jefe", e.target.value)} /></Field>
                    <Field label="Teléfono y correo del jefe"><Input value={form.telefono_email_jefe} onChange={e => set("telefono_email_jefe", e.target.value)} /></Field>
                  </Grid>
                  <SectionTitle number="4b" title="Ingresos" subtitle="" />
                  <Grid>
                    <Field label="Tipo de ingresos principales">
                      <Sel value={form.tipo_ingresos} onChange={e => set("tipo_ingresos", e.target.value)}>
                        <option>Empleo formal</option>
                        <option>Negocio propio</option>
                        <option>Honorarios / Freelance</option>
                        <option>Rentas</option>
                        <option>Otro</option>
                      </Sel>
                    </Field>
                    <Field label="Ingresos mensuales aproximados" required><Input type="number" placeholder="30000" value={form.ingresos_mensuales} onChange={e => set("ingresos_mensuales", e.target.value)} /></Field>
                  </Grid>
                  <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 12, padding: "14px 18px" }}>
                    <p style={{ margin: 0, fontSize: 13, color: "#92400e", fontWeight: 600 }}>📎 Documentos de ingresos requeridos</p>
                    <p style={{ margin: "6px 0 0", fontSize: 12, color: "#92400e" }}>Estados de cuenta bancarios de los últimos 3 meses, recibos de nómina, CFDI, contratos o constancia de situación fiscal. Envíalos a: <strong>administracion@emporioinmobiliario.com.mx</strong></p>
                  </div>
                </>
              ) : (
                <>
                  <SectionTitle number="4" title="Información Financiera de la Empresa" subtitle="" />
                  <Grid>
                    <Field label="Actividad principal de la empresa"><Input value={form.actividad_empresa} onChange={e => set("actividad_empresa", e.target.value)} /></Field>
                    <Field label="Giro comercial"><Input value={form.giro_comercial} onChange={e => set("giro_comercial", e.target.value)} /></Field>
                  </Grid>
                  <Field label="Página web"><Input type="url" placeholder="https://..." value={form.pagina_web_empresa2} onChange={e => set("pagina_web_empresa2", e.target.value)} /></Field>
                  <Field label="Describe el origen de los recursos con los que se pagará la renta" required><Textarea value={form.origen_recursos} onChange={e => set("origen_recursos", e.target.value)} /></Field>
                  <Field label="Ingresos mensuales aproximados de la empresa" required><Input type="number" placeholder="100000" value={form.ingresos_empresa} onChange={e => set("ingresos_empresa", e.target.value)} /></Field>
                  <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 12, padding: "14px 18px" }}>
                    <p style={{ margin: 0, fontSize: 13, color: "#92400e", fontWeight: 600 }}>📎 Documentos requeridos</p>
                    <p style={{ margin: "6px 0 0", fontSize: 12, color: "#92400e" }}>Estados de cuenta bancarios, estados financieros, CFDI, contratos. Envíalos a: <strong>administracion@emporioinmobiliario.com.mx</strong></p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* PASO 4 — Uso del inmueble y arrendador actual */}
          {step === 4 && (
            <div>
              <SectionTitle number="5" title="Uso del Inmueble" subtitle="Información sobre cómo utilizarás la propiedad" />
              <Grid>
                <Field label="Uso que se dará al inmueble" required>
                  <Sel value={form.uso_inmueble} onChange={e => set("uso_inmueble", e.target.value)}>
                    <option>Casa habitación</option>
                    <option>Oficina</option>
                    <option>Comercio</option>
                    <option>Bodega</option>
                    <option>Otro</option>
                  </Sel>
                </Field>
                <Field label="¿Existirá subarrendamiento?">
                  <Sel value={form.subarrendamiento} onChange={e => set("subarrendamiento", e.target.value)}>
                    <option>No</option>
                    <option>Sí</option>
                  </Sel>
                </Field>
              </Grid>
              <Field label="Describe de forma clara y específica el uso del inmueble" required>
                <Textarea value={form.descripcion_uso} onChange={e => set("descripcion_uso", e.target.value)} placeholder="Describe el uso que le darás al inmueble..." />
              </Field>

              <SectionTitle number="5b" title="Arrendador Actual" subtitle="Información del lugar donde rentas actualmente" />
              <Grid>
                <Field label="Nombre del arrendador actual"><Input value={form.nombre_arrendador} onChange={e => set("nombre_arrendador", e.target.value)} /></Field>
                <Field label="Teléfono del arrendador"><Input type="tel" value={form.telefono_arrendador} onChange={e => set("telefono_arrendador", e.target.value)} /></Field>
              </Grid>
              <Grid>
                <Field label="Monto de renta actual"><Input type="number" value={form.monto_renta_actual} onChange={e => set("monto_renta_actual", e.target.value)} /></Field>
                <Field label="Motivo del cambio de inmueble"><Input value={form.motivo_cambio} onChange={e => set("motivo_cambio", e.target.value)} /></Field>
              </Grid>
            </div>
          )}

          {/* PASO 5 — Referencias */}
          {step === 5 && (
            <div>
              <SectionTitle number="6" title="Referencias Familiares" subtitle="3 referencias de familiares" />
              {[1, 2, 3].map(n => (
                <div key={n} style={{ background: colors.gray, borderRadius: 12, padding: "16px 20px", marginBottom: 16 }}>
                  <p style={{ margin: "0 0 12px", fontWeight: 700, fontSize: 14, color: colors.dark }}>Referencia familiar {n}</p>
                  <Grid cols={3}>
                    <Field label="Nombre completo"><Input value={form[`ref_fam${n}_nombre`]} onChange={e => set(`ref_fam${n}_nombre`, e.target.value)} /></Field>
                    <Field label="Parentesco"><Input value={form[`ref_fam${n}_parentesco`]} onChange={e => set(`ref_fam${n}_parentesco`, e.target.value)} placeholder="Madre, padre, hermano..." /></Field>
                    <Field label="Teléfono"><Input type="tel" value={form[`ref_fam${n}_telefono`]} onChange={e => set(`ref_fam${n}_telefono`, e.target.value)} /></Field>
                  </Grid>
                </div>
              ))}

              <SectionTitle number="6b" title="Referencias Personales" subtitle="3 referencias de personas que no sean familiares" />
              {[1, 2, 3].map(n => (
                <div key={n} style={{ background: colors.gray, borderRadius: 12, padding: "16px 20px", marginBottom: 16 }}>
                  <p style={{ margin: "0 0 12px", fontWeight: 700, fontSize: 14, color: colors.dark }}>Referencia personal {n}</p>
                  <Grid cols={3}>
                    <Field label="Nombre completo"><Input value={form[`ref_per${n}_nombre`]} onChange={e => set(`ref_per${n}_nombre`, e.target.value)} /></Field>
                    <Field label="Relación"><Input value={form[`ref_per${n}_relacion`]} onChange={e => set(`ref_per${n}_relacion`, e.target.value)} placeholder="Amigo, compañero de trabajo..." /></Field>
                    <Field label="Teléfono"><Input type="tel" value={form[`ref_per${n}_telefono`]} onChange={e => set(`ref_per${n}_telefono`, e.target.value)} /></Field>
                  </Grid>
                </div>
              ))}
            </div>
          )}

          {/* PASO 6 — Ocupantes */}
          {step === 6 && (
            <div>
              <SectionTitle number="7" title="Ocupantes del Inmueble" subtitle="Información sobre quiénes habitarán la propiedad" />
              <Grid>
                <Field label="¿Cuántas personas habitarán el inmueble?" required>
                  <Input type="number" min="1" value={form.num_personas} onChange={e => set("num_personas", e.target.value)} />
                </Field>
                <Field label="¿Habrá mascotas?">
                  <Sel value={form.mascotas} onChange={e => set("mascotas", e.target.value)}>
                    <option>No</option>
                    <option>Sí</option>
                  </Sel>
                </Field>
              </Grid>
              <Field label="Indica el nombre y parentesco de cada persona que habitará el inmueble">
                <Textarea value={form.personas_detalle} onChange={e => set("personas_detalle", e.target.value)} placeholder="Ej: María López (esposa), Juan García Jr. (hijo, 8 años)..." />
              </Field>
              {form.mascotas === "Sí" && (
                <Field label="¿Cuántas mascotas y de qué tipo?">
                  <Input value={form.mascotas_detalle} onChange={e => set("mascotas_detalle", e.target.value)} placeholder="Ej: 1 perro labrador, 2 gatos" />
                </Field>
              )}
              <Grid>
                <Field label="¿Habrá personal de servicio de planta?">
                  <Sel value={form.personal_servicio} onChange={e => set("personal_servicio", e.target.value)}>
                    <option>No</option>
                    <option>Sí</option>
                  </Sel>
                </Field>
                {form.personal_servicio === "Sí" && (
                  <Field label="¿Cuántas personas y bajo qué modalidad?">
                    <Input value={form.personal_servicio_detalle} onChange={e => set("personal_servicio_detalle", e.target.value)} />
                  </Field>
                )}
              </Grid>

              {error && (
                <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 12, padding: "14px 18px", marginTop: 20 }}>
                  <p style={{ margin: 0, fontSize: 14, color: "#991b1b", fontWeight: 600 }}>{error}</p>
                </div>
              )}

              <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 12, padding: "16px 20px", marginTop: 24 }}>
                <p style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 700, color: "#0369a1" }}>📋 Antes de enviar</p>
                <p style={{ margin: 0, fontSize: 13, color: "#0369a1" }}>Asegúrate de haber enviado tus documentos de soporte a <strong>administracion@emporioinmobiliario.com.mx</strong></p>
              </div>
            </div>
          )}

          {/* Navegación */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 32, paddingTop: 24, borderTop: `1px solid ${colors.border}` }}>
            {step > 1 ? (
              <button onClick={() => setStep(s => s - 1)} style={{ background: colors.gray, border: "none", borderRadius: 10, padding: "12px 24px", cursor: "pointer", fontWeight: 700, fontSize: 14, color: colors.muted }}>← Anterior</button>
            ) : <div />}
            {step < totalSteps ? (
              <button onClick={() => setStep(s => s + 1)} style={{ background: colors.dark, color: "#fff", border: "none", borderRadius: 10, padding: "12px 28px", cursor: "pointer", fontWeight: 700, fontSize: 15 }}>Siguiente →</button>
            ) : (
              <button onClick={handleSubmit} disabled={submitting} style={{ background: submitting ? colors.muted : colors.gold, color: "#fff", border: "none", borderRadius: 10, padding: "13px 32px", cursor: submitting ? "not-allowed" : "pointer", fontWeight: 800, fontSize: 15, opacity: submitting ? 0.7 : 1 }}>
                {submitting ? "Enviando..." : "✅ Enviar solicitud"}
              </button>
            )}
          </div>
        </div>

        <p style={{ textAlign: "center", marginTop: 20, fontSize: 12, color: colors.muted }}>
          Emporio Inmobiliario · <a href="https://emporioinmobiliario.com.mx" style={{ color: colors.gold }}>emporioinmobiliario.com.mx</a> · 222 257 3237
        </p>
      </div>
    </div>
  );
}
