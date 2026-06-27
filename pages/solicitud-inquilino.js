import { supabase } from "../lib/supabase";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";

const colors = {
  dark: "#4a4a4a", gold: "#b91c3c", red: "#b91c3c", gray: "#f8f8f8",
  white: "#ffffff", text: "#374151", muted: "#7a7a7a", border: "#e5e7eb",
  success: "#065f46", successBg: "#f0fdf4",
};

const Field = ({ label, required, hint, error, children }) => (
  <div style={{ marginBottom: 20 }}>
    <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: colors.text, marginBottom: 4 }}>
      {label} {required && <span style={{ color: colors.red }}>*</span>}
    </label>
    {hint && <p style={{ margin: "0 0 6px", fontSize: 11, color: colors.muted }}>{hint}</p>}
    {children}
    {error && <p style={{ margin: "4px 0 0", fontSize: 12, color: "#E07070", fontWeight: 600 }}>{error}</p>}
  </div>
);

const Input = (props) => (
  <input {...props} style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: `1.5px solid ${props.error ? "#E07070" : colors.border}`, fontSize: 14, boxSizing: "border-box", background: "#fff", color: colors.text, outline: "none", ...props.style }}
    onFocus={e => e.target.style.borderColor = '#b91c3c'}
    onBlur={e => e.target.style.borderColor = props.error ? "#E07070" : colors.border} />
);

const Sel = ({ children, ...props }) => (
  <select {...props} style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: `1.5px solid ${colors.border}`, fontSize: 14, boxSizing: "border-box", background: "#fff", color: colors.text, outline: "none", ...props.style }}>
    {children}
  </select>
);

const Textarea = (props) => (
  <textarea {...props} style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: `1.5px solid ${props.error ? "#E07070" : colors.border}`, fontSize: 14, boxSizing: "border-box", background: "#fff", color: colors.text, outline: "none", minHeight: 80, resize: "vertical", ...props.style }}
    onFocus={e => e.target.style.borderColor = '#b91c3c'}
    onBlur={e => e.target.style.borderColor = props.error ? "#E07070" : colors.border} />
);

const SectionTitle = ({ number, title, subtitle }) => (
  <div style={{ display: "flex", alignItems: "flex-start", gap: 16, margin: "32px 0 24px", paddingBottom: 16, borderBottom: "2px solid #b91c3c" }}>
    <div style={{ background: "#b91c3c", color: "#fff", width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 15, flexShrink: 0 }}>{number}</div>
    <div>
      <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "#4a4a4a" }}>{title}</h2>
      {subtitle && <p style={{ margin: "4px 0 0", fontSize: 13, color: colors.muted }}>{subtitle}</p>}
    </div>
  </div>
);

const Grid = ({ cols = 2, children }) => (
  <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 16 }}>{children}</div>
);

const FileUpload = ({ label, hint, required, onChange, value, error }) => (
  <Field label={label} required={required} hint={hint} error={error}>
    <div style={{ border: `2px dashed ${error ? "#E07070" : value ? colors.gold : colors.border}`, borderRadius: 10, padding: "16px 20px", textAlign: "center", background: value ? "#fffbeb" : "#fafafa", cursor: "pointer", transition: "all 0.2s" }}>
      <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={onChange} style={{ display: "none" }} id={label.replace(/\s/g, "_")} />
      <label htmlFor={label.replace(/\s/g, "_")} style={{ cursor: "pointer" }}>
        {value ? (
          <div>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: colors.success }}>✅ {value.name}</p>
            <p style={{ margin: "4px 0 0", fontSize: 11, color: colors.muted }}>Clic para cambiar</p>
          </div>
        ) : (
          <div>
            <p style={{ margin: 0, fontSize: 24 }}>📎</p>
            <p style={{ margin: "4px 0 0", fontSize: 13, fontWeight: 600, color: colors.muted }}>Clic para subir archivo</p>
            <p style={{ margin: "2px 0 0", fontSize: 11, color: colors.muted }}>PDF, JPG o PNG — máx. 10MB</p>
          </div>
        )}
      </label>
    </div>
  </Field>
);

const PartnerBanner = ({ branding }) => {
  if (!branding?.agency) return null;
  const color = branding.agency.brand_color || colors.red;
  return (
    <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 14, padding: "16px 18px", marginBottom: 18, display: "flex", alignItems: "center", gap: 14, boxShadow: "0 2px 10px rgba(0,0,0,0.04)" }}>
      {branding.agency.logo_url ? (
        <img src={branding.agency.logo_url} alt={branding.agency.nombre_comercial} style={{ width: 54, height: 54, borderRadius: 12, objectFit: "contain", border: `1px solid ${colors.border}`, background: "#fff" }} />
      ) : (
        <div style={{ width: 54, height: 54, borderRadius: 12, background: color, color: "#fff", display: "grid", placeItems: "center", fontWeight: 900 }}>
          {branding.agency.nombre_comercial?.[0] || "P"}
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, color, fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0.8 }}>Solicitud enviada por {branding.agency.nombre_comercial}</p>
        <p style={{ margin: "4px 0 0", color: colors.text, fontSize: 13, lineHeight: 1.45 }}>En alianza con Emporio Blindaje Legal. Nuestro equipo juridico revisara tu expediente.</p>
      </div>
    </div>
  );
};

export default function SolicitudInquilino() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitId, setSubmitId] = useState(null);
  const [analisis, setAnalisis] = useState(null);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState({});
  const [aceptaPrivacidad, setAceptaPrivacidad] = useState(false);
  const [partnerBranding, setPartnerBranding] = useState(null);

  const [files, setFiles] = useState({
    identidad_fisica: null,
    identidad_moral: null,
    ingresos: null,
    ingresos_extra: [],
    empresa: null,
    carta_laboral: null,
    constancia_fiscal: null,
  });

  const [form, setForm] = useState({
    direccion_inmueble: "", monto_renta: "", tipo_solicitante: "Persona física",
    nombre_completo: "", telefono: "", email: "", curp: "", rfc: "",
    nacionalidad: "Mexicana", es_extranjero: "No", estatus_migratorio: "",
    estado_civil: "Soltero(a)", nombre_conyuge: "", telefono_conyuge: "",
    domicilio_actual: "", razon_social: "", rfc_empresa: "", giro_empresa: "",
    domicilio_fiscal: "", nombre_representante: "", telefono_representante: "",
    email_representante: "", empresa_labora: "", giro_empresa_labora: "",
    pagina_web_empresa: "", domicilio_trabajo: "", telefono_trabajo: "",
    nombre_jefe: "", puesto_jefe: "", telefono_email_jefe: "",
    tipo_ingresos: "Empleo formal", ingresos_mensuales: "",
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

  useEffect(() => {
    if (!router.isReady) return;
    const { partner, operacion } = router.query;
    if (!partner || !operacion) return;
    fetch(`/api/partners/public-branding?partner=${encodeURIComponent(partner)}&operacion=${encodeURIComponent(operacion)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        setPartnerBranding(data);
        setForm(f => ({
          ...f,
          direccion_inmueble: f.direccion_inmueble || data.operation?.direccion_inmueble || "",
          monto_renta: f.monto_renta || (data.operation?.monto_renta ? String(data.operation.monto_renta) : ""),
          nombre_completo: f.nombre_completo || data.operation?.nombre_inquilino || "",
        }));
      })
      .catch(() => {});
  }, [router.isReady, router.query]);

  const handleFile = (key, e) => {
    const file = e.target.files[0];
    if (file) {
      setFiles(f => ({ ...f, [key]: file }));
      setErrors(prev => ({ ...prev, [key]: undefined }));
    }
  };

  // ── VALIDACIONES POR PASO ──────────────────────────────────────────────────
  const validateStep1 = () => {
    const e = {};
    if (!form.direccion_inmueble?.trim()) e.direccion_inmueble = "Este campo es requerido";
    if (!form.monto_renta?.trim()) e.monto_renta = "Este campo es requerido";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateStep2 = () => {
    const e = {};
    if (!isMoral) {
      if (!form.nombre_completo?.trim()) e.nombre_completo = "Este campo es requerido";
      if (!form.telefono?.trim()) e.telefono = "Este campo es requerido";
      if (!form.email?.trim()) e.email = "Este campo es requerido";
      if (!form.domicilio_actual?.trim()) e.domicilio_actual = "Este campo es requerido";
      if (!form.curp?.trim()) e.curp = "La CURP es requerida para verificar tu identidad";
      else if (form.curp.trim().length !== 18) e.curp = "La CURP debe tener exactamente 18 caracteres";
      if (!files.identidad_fisica) e.identidad_fisica = "Debes subir tu identificación oficial";
    } else {
      if (!form.razon_social?.trim()) e.razon_social = "Este campo es requerido";
      if (!form.rfc_empresa?.trim()) e.rfc_empresa = "Este campo es requerido";
      if (!form.nombre_representante?.trim()) e.nombre_representante = "Este campo es requerido";
      if (!files.identidad_moral) e.identidad_moral = "Debes subir los documentos de la empresa";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateStep3 = () => {
    const e = {};
    if (!isMoral) {
      if (!form.empresa_labora?.trim()) e.empresa_labora = "Este campo es requerido";
      if (!files.ingresos) e.ingresos = "Debes subir tus comprobantes de ingresos";
    } else {
      if (!form.origen_recursos?.trim()) e.origen_recursos = "Este campo es requerido";
      if (!files.empresa) e.empresa = "Debes subir los documentos financieros";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateStep4 = () => {
    const e = {};
    if (!form.descripcion_uso?.trim()) e.descripcion_uso = "Este campo es requerido";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateStep5 = () => {
    const e = {};
    if (!form.ref_fam1_nombre?.trim()) e.ref_fam1_nombre = "Agrega al menos una referencia familiar";
    if (!form.ref_fam1_telefono?.trim()) e.ref_fam1_telefono = "El teléfono es requerido";
    if (!form.ref_per1_nombre?.trim()) e.ref_per1_nombre = "Agrega al menos una referencia personal";
    if (!form.ref_per1_telefono?.trim()) e.ref_per1_telefono = "El teléfono es requerido";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => {
    setError("");
    if (step === 1 && !validateStep1()) return;
    if (step === 2 && !validateStep2()) return;
    if (step === 3 && !validateStep3()) return;
    if (step === 4 && !validateStep4()) return;
    if (step === 5 && !validateStep5()) return;
    setErrors({});
    setStep(s => s + 1);
  };

  const fileToBase64 = (file) => new Promise((resolve, reject) => {
    if (!file) { resolve(null); return; }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleSubmit = async () => {
    if (!aceptaPrivacidad) {
      setError("Debes aceptar el Aviso de Privacidad para continuar.");
      return;
    }
    if (!form.num_personas?.trim()) {
      setErrors({ num_personas: "Este campo es requerido" });
      return;
    }
    if (!form.personas_detalle?.trim()) {
      setErrors({ personas_detalle: "Este campo es requerido" });
      return;
    }
    setSubmitting(true);
    setError("");

    try {
      const payload = {
        inmueble_interes: form.direccion_inmueble,
        monto_renta_solicitada: parseFloat(form.monto_renta) || null,
        tipo_solicitante: form.tipo_solicitante,
        nombre_completo: form.nombre_completo || form.nombre_representante,
        telefono: form.telefono || form.telefono_representante,
        correo: form.email || form.email_representante,
        rfc: form.rfc || form.rfc_empresa,
        curp: form.curp,
        nacionalidad: form.nacionalidad,
        estatus_migratorio: form.estatus_migratorio,
        estado_civil: form.estado_civil,
        nombre_conyuge: form.nombre_conyuge,
        telefono_conyuge: form.telefono_conyuge,
        domicilio_actual: form.domicilio_actual,
        razon_social: form.razon_social,
        rfc_empresa: form.rfc_empresa,
        giro_empresa: form.giro_empresa,
        domicilio_fiscal: form.domicilio_fiscal,
        nombre_representante: form.nombre_representante,
        empresa_labora: form.empresa_labora,
        giro_empresa_labora: form.giro_empresa_labora,
        domicilio_trabajo: form.domicilio_trabajo,
        telefono_trabajo: form.telefono_trabajo,
        nombre_jefe: form.nombre_jefe,
        puesto_jefe: form.puesto_jefe,
        telefono_email_jefe: form.telefono_email_jefe,
        tipo_ingresos: form.tipo_ingresos,
        ingresos_mensuales: parseFloat(form.ingresos_mensuales) || null,
        ingresos_empresa: parseFloat(form.ingresos_empresa) || null,
        origen_recursos: form.origen_recursos,
        uso_inmueble: form.uso_inmueble,
        descripcion_uso: form.descripcion_uso,
        subarrendamiento: form.subarrendamiento,
        nombre_arrendador_actual: form.nombre_arrendador,
        telefono_arrendador_actual: form.telefono_arrendador,
        monto_renta_actual: parseFloat(form.monto_renta_actual) || null,
        motivo_cambio: form.motivo_cambio,
        ref_fam1_nombre: form.ref_fam1_nombre, ref_fam1_parentesco: form.ref_fam1_parentesco, ref_fam1_telefono: form.ref_fam1_telefono,
        ref_fam2_nombre: form.ref_fam2_nombre, ref_fam2_parentesco: form.ref_fam2_parentesco, ref_fam2_telefono: form.ref_fam2_telefono,
        ref_fam3_nombre: form.ref_fam3_nombre, ref_fam3_parentesco: form.ref_fam3_parentesco, ref_fam3_telefono: form.ref_fam3_telefono,
        ref_per1_nombre: form.ref_per1_nombre, ref_per1_relacion: form.ref_per1_relacion, ref_per1_telefono: form.ref_per1_telefono,
        ref_per2_nombre: form.ref_per2_nombre, ref_per2_relacion: form.ref_per2_relacion, ref_per2_telefono: form.ref_per2_telefono,
        ref_per3_nombre: form.ref_per3_nombre, ref_per3_relacion: form.ref_per3_relacion, ref_per3_telefono: form.ref_per3_telefono,
        num_habitantes: parseInt(form.num_personas) || null,
        detalle_habitantes: form.personas_detalle,
        tiene_mascotas: form.mascotas === "Sí",
        detalle_mascotas: form.mascotas_detalle,
        personal_servicio: form.personal_servicio === "Sí",
        personal_servicio_detalle: form.personal_servicio_detalle,
        status: "pendiente",
      };

      const { data, error: insertError } = await supabase
        .from("solicitudes_inquilino")
        .insert(payload)
        .select("id")
        .single();

      if (insertError) throw insertError;

      // ── Convertir archivos a base64 ──
      const [b64Ident, b64Ingresos1, b64Ingresos2, b64Ingresos3, b64CartaLaboral, b64ConstanciaFiscal] = await Promise.all([
        fileToBase64(files.identidad_fisica || files.identidad_moral || null),
        fileToBase64(files.ingresos || files.empresa || null),
        fileToBase64(files.ingresos_extra[0] || null),
        fileToBase64(files.ingresos_extra[1] || null),
        fileToBase64(files.carta_laboral || null),
        fileToBase64(files.constancia_fiscal || null),
      ]);

      await supabase.from("solicitudes_inquilino").update({
        doc_identificacion_b64: b64Ident,
        doc_comprobante_ingresos_b64: b64Ingresos1,
        doc_ingresos_b64_2: b64Ingresos2,
        doc_ingresos_b64_3: b64Ingresos3,
        doc_carta_laboral_b64: b64CartaLaboral,
        doc_constancia_fiscal_b64: b64ConstanciaFiscal,
      }).eq("id", data.id);

      setSubmitId(data.id);

      if (router.query.partner && router.query.operacion) {
        fetch('/api/partners/link-submission', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            partner_agency_id: router.query.partner,
            partner_operation_id: router.query.operacion,
            tipo: 'inquilino',
            record_id: data.id,
          }),
        }).catch(() => {});
      }

      // ── Análisis de pre-viabilidad con IA ──
      try {
        // Solo pasamos el ID — el endpoint lee los archivos directo de Supabase
        const analisisRes = await fetch('/api/analizar-solicitud', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ solicitud_id: data.id, tipo_ejecucion: 'inicial' }),
        });
        if (analisisRes.ok) {
          const resultado = await analisisRes.json();
          setAnalisis(resultado);
          // Guardar resultado en Supabase
          const updatePayload = {
            pre_viabilidad: resultado.resultado,
            pre_viabilidad_detalle: resultado.mensaje,
            pre_viabilidad_detalle_interno: resultado.mensajeInterno,
            ingreso_detectado_ia: resultado.detalles?.ingresoDetectado,
            ingreso_total_ia: resultado.detalles?.analisisIA?.ingreso_mensual_total,
          };
          if (resultado.validacionCurp) {
            updatePayload.curp_validada = resultado.validacionCurp.valido;
            updatePayload.curp_nombre_renapo = resultado.validacionCurp.nombre_en_renapo;
            updatePayload.curp_status = resultado.validacionCurp.curp_status;
          }
          await supabase.from('solicitudes_inquilino').update(updatePayload).eq('id', data.id);
        }
      } catch (e) {
        console.error('Error análisis IA:', e.message);
      }

      setSubmitted(true);

    } catch (e) {
      console.error(e);
      setError("Error al enviar: " + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── PANTALLA DE ÉXITO ─────────────────────────────────────────────────────
  if (submitted) return (
    <div style={{ minHeight: "100vh", background: "#f8f8f8", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 24, padding: 48, maxWidth: 500, width: "100%", textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ fontSize: 64, marginBottom: 20 }}>✅</div>
        <h2 style={{ margin: "0 0 12px", fontSize: 24, fontWeight: 800, color: "#4a4a4a" }}>¡Solicitud enviada!</h2>
        <p style={{ margin: "0 0 8px", fontSize: 15, color: colors.muted }}>Hemos recibido tu solicitud de arrendamiento correctamente.</p>
        <p style={{ margin: "0 0 24px", fontSize: 14, color: colors.muted }}>Nuestro equipo jurídico la revisará y se pondrá en contacto contigo en breve.</p>

        {/* Resultado pre-viabilidad */}
        {analisis && (
          <div style={{
            background: analisis.resultado === 'viable' ? '#f0fdf4' : analisis.resultado === 'no_viable' ? '#fee2e2' : '#fffbeb',
            border: `1.5px solid ${analisis.resultado === 'viable' ? '#6ee7b7' : analisis.resultado === 'no_viable' ? '#fca5a5' : '#fcd34d'}`,
            borderRadius: 14, padding: "20px 24px", marginBottom: 20, textAlign: "left"
          }}>
            <p style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 800, color: analisis.color }}>
              {analisis.icono} Resultado preliminar
            </p>
            <p style={{ margin: 0, fontSize: 13, color: "#374151", lineHeight: 1.5 }}>{analisis.mensaje}</p>
            {analisis.resultado === 'no_viable' && (
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "#6b7280" }}>
                Puedes contactarnos para explorar otras opciones.
              </p>
            )}
          </div>
        )}

        <div style={{ background: colors.successBg, borderRadius: 12, padding: "16px 20px", marginBottom: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: colors.success, fontWeight: 600 }}>📋 Tus datos han sido registrados en nuestro sistema</p>
        </div>
        {submitId && (
          <p style={{ margin: "0 0 16px", fontSize: 12, color: colors.muted }}>
            Folio: <strong style={{ color: "#b91c3c" }}>{submitId.slice(0, 8).toUpperCase()}</strong>
          </p>
        )}
        <p style={{ margin: 0, fontSize: 13, color: colors.muted }}>¿Tienes dudas? Escríbenos al <strong>222 257 3237</strong></p>
      </div>
    </div>
  );

  // ── FORMULARIO ────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#f8f8f8", fontFamily: "system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "14px 20px" }}>
        <div style={{ maxWidth: 780, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio Inmobiliario" style={{ height: 36, objectFit: "contain" }} />
          <div style={{ textAlign: "right" }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#b91c3c" }}>Solicitud de Arrendamiento</p>
            <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af" }}>Paso {step} de {totalSteps}</p>
          </div>
        </div>
      </div>
      {/* Barra de progreso */}
      <div style={{ background: "#f3f4f6", height: 4 }}>
        <div style={{ background: "#b91c3c", height: 4, width: `${(step / totalSteps) * 100}%`, transition: "width 0.3s ease" }} />
      </div>

      <div style={{ maxWidth: 780, margin: "0 auto", padding: "32px 20px" }}>
        <PartnerBanner branding={partnerBranding} />
        <div style={{ background: "#fff", borderRadius: 16, padding: 32, boxShadow: "0 2px 12px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb", maxWidth: 780, margin: "24px auto", marginLeft: 16, marginRight: 16 }}>

          {/* PASO 1 — Inmueble y tipo */}
          {step === 1 && (
            <div>
              <SectionTitle number="1" title="Datos del Inmueble" subtitle="Información sobre la propiedad que deseas rentar" />
              <Field label="Dirección completa del inmueble a rentar" required error={errors.direccion_inmueble}>
                <Input placeholder="Calle, número, colonia, ciudad" value={form.direccion_inmueble} onChange={e => set("direccion_inmueble", e.target.value)} error={errors.direccion_inmueble} />
              </Field>
              <Field label="Monto de renta mensual" required hint="Solo el número, sin signos" error={errors.monto_renta}>
                <Input type="number" placeholder="15000" value={form.monto_renta} onChange={e => set("monto_renta", e.target.value)} error={errors.monto_renta} />
              </Field>
              <SectionTitle number="2" title="Tipo de Solicitante" subtitle="¿Estás rentando como persona física o empresa?" />
              <Field label="Tipo de solicitante" required>
                <div style={{ display: "flex", gap: 12 }}>
                  {["Persona física", "Persona moral"].map(tipo => (
                    <button key={tipo} onClick={() => set("tipo_solicitante", tipo)} style={{ flex: 1, padding: "14px", borderRadius: 12, border: `2px solid ${form.tipo_solicitante === tipo ? "#b91c3c" : colors.border}`, background: form.tipo_solicitante === tipo ? "#fff0f3" : "#fff", color: form.tipo_solicitante === tipo ? "#b91c3c" : colors.muted, fontWeight: 700, cursor: "pointer", fontSize: 14 }}>
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
              {!isMoral ? (
                <>
                  <Grid>
                    <Field label="Nombre completo" required error={errors.nombre_completo}>
                      <Input value={form.nombre_completo} onChange={e => set("nombre_completo", e.target.value)} error={errors.nombre_completo} />
                    </Field>
                    <Field label="Teléfono celular" required error={errors.telefono}>
                      <Input type="tel" value={form.telefono} onChange={e => set("telefono", e.target.value)} placeholder="2221234567" error={errors.telefono} />
                    </Field>
                  </Grid>
                  <Grid>
                    <Field label="Correo electrónico" required error={errors.email}>
                      <Input type="email" value={form.email} onChange={e => set("email", e.target.value)} error={errors.email} />
                    </Field>
                    <Field label="CURP" required error={errors.curp} hint="18 caracteres — se verificará contra RENAPO">
                      <Input value={form.curp} onChange={e => set("curp", e.target.value.toUpperCase())} error={errors.curp} maxLength={18} placeholder="XXXX000000XXXXXX00" />
                    </Field>
                  </Grid>
                  <Grid>
                    <Field label="RFC">
                      <Input value={form.rfc} onChange={e => set("rfc", e.target.value)} />
                    </Field>
                    <Field label="Nacionalidad">
                      <Sel value={form.nacionalidad} onChange={e => set("nacionalidad", e.target.value)}>
                        <option>Mexicana</option><option>Extranjera</option>
                      </Sel>
                    </Field>
                  </Grid>
                  <Grid>
                    <Field label="¿Eres extranjero?">
                      <Sel value={form.es_extranjero} onChange={e => set("es_extranjero", e.target.value)}>
                        <option>No</option><option>Sí</option>
                      </Sel>
                    </Field>
                    {isExtranjero && (
                      <Field label="Estatus migratorio">
                        <Input value={form.estatus_migratorio} onChange={e => set("estatus_migratorio", e.target.value)} />
                      </Field>
                    )}
                  </Grid>
                  <Grid>
                    <Field label="Estado civil">
                      <Sel value={form.estado_civil} onChange={e => set("estado_civil", e.target.value)}>
                        <option>Soltero(a)</option><option>Casado(a)</option><option>Unión libre</option><option>Divorciado(a)</option><option>Viudo(a)</option>
                      </Sel>
                    </Field>
                    {hasConyuge && (
                      <Field label="Nombre del cónyuge">
                        <Input value={form.nombre_conyuge} onChange={e => set("nombre_conyuge", e.target.value)} />
                      </Field>
                    )}
                  </Grid>
                  {hasConyuge && (
                    <Field label="Teléfono del cónyuge">
                      <Input type="tel" value={form.telefono_conyuge} onChange={e => set("telefono_conyuge", e.target.value)} />
                    </Field>
                  )}
                  <Field label="Domicilio actual completo" required error={errors.domicilio_actual}>
                    <Textarea value={form.domicilio_actual} onChange={e => set("domicilio_actual", e.target.value)} placeholder="Calle, número, colonia, ciudad, CP" error={errors.domicilio_actual} />
                  </Field>
                  <FileUpload label="Identificación oficial vigente y comprobante de domicilio" hint="Sube un archivo PDF o imagen con ambos documentos" required value={files.identidad_fisica} onChange={e => handleFile("identidad_fisica", e)} error={errors.identidad_fisica} />
                </>
              ) : (
                <>
                  <Grid>
                    <Field label="Razón social" required error={errors.razon_social}>
                      <Input value={form.razon_social} onChange={e => set("razon_social", e.target.value)} error={errors.razon_social} />
                    </Field>
                    <Field label="RFC de la empresa" required error={errors.rfc_empresa}>
                      <Input value={form.rfc_empresa} onChange={e => set("rfc_empresa", e.target.value)} error={errors.rfc_empresa} />
                    </Field>
                  </Grid>
                  <Grid>
                    <Field label="Giro o actividad principal">
                      <Input value={form.giro_empresa} onChange={e => set("giro_empresa", e.target.value)} />
                    </Field>
                    <Field label="Domicilio fiscal">
                      <Input value={form.domicilio_fiscal} onChange={e => set("domicilio_fiscal", e.target.value)} />
                    </Field>
                  </Grid>
                  <SectionTitle number="3b" title="Representante Legal" subtitle="" />
                  <Grid>
                    <Field label="Nombre del representante legal" required error={errors.nombre_representante}>
                      <Input value={form.nombre_representante} onChange={e => set("nombre_representante", e.target.value)} error={errors.nombre_representante} />
                    </Field>
                    <Field label="Teléfono del representante">
                      <Input type="tel" value={form.telefono_representante} onChange={e => set("telefono_representante", e.target.value)} />
                    </Field>
                  </Grid>
                  <Field label="Correo del representante">
                    <Input type="email" value={form.email_representante} onChange={e => set("email_representante", e.target.value)} />
                  </Field>
                  <FileUpload label="Acta constitutiva, Poder del Representante, INE, Constancia fiscal y Comprobante de domicilio" hint="Sube un archivo PDF con todos los documentos" required value={files.identidad_moral} onChange={e => handleFile("identidad_moral", e)} error={errors.identidad_moral} />
                </>
              )}
            </div>
          )}

          {/* PASO 3 — Laboral / Ingresos */}
          {step === 3 && (
            <div>
              {!isMoral ? (
                <>
                  <SectionTitle number="4" title="Información Laboral e Ingresos" subtitle="" />
                  <Grid>
                    <Field label="Empresa donde laboras" required error={errors.empresa_labora}>
                      <Input value={form.empresa_labora} onChange={e => set("empresa_labora", e.target.value)} error={errors.empresa_labora} />
                    </Field>
                    <Field label="Giro de la empresa">
                      <Input value={form.giro_empresa_labora} onChange={e => set("giro_empresa_labora", e.target.value)} />
                    </Field>
                  </Grid>
                  <Grid>
                    <Field label="Página web">
                      <Input type="url" placeholder="https://..." value={form.pagina_web_empresa} onChange={e => set("pagina_web_empresa", e.target.value)} />
                    </Field>
                    <Field label="Domicilio del trabajo">
                      <Input value={form.domicilio_trabajo} onChange={e => set("domicilio_trabajo", e.target.value)} />
                    </Field>
                  </Grid>
                  <Grid>
                    <Field label="Teléfono del trabajo">
                      <Input type="tel" value={form.telefono_trabajo} onChange={e => set("telefono_trabajo", e.target.value)} />
                    </Field>
                    <Field label="Nombre del jefe inmediato">
                      <Input value={form.nombre_jefe} onChange={e => set("nombre_jefe", e.target.value)} />
                    </Field>
                  </Grid>
                  <Grid>
                    <Field label="Puesto del jefe">
                      <Input value={form.puesto_jefe} onChange={e => set("puesto_jefe", e.target.value)} />
                    </Field>
                    <Field label="Teléfono y correo del jefe">
                      <Input value={form.telefono_email_jefe} onChange={e => set("telefono_email_jefe", e.target.value)} />
                    </Field>
                  </Grid>
                  <Grid>
                    <Field label="Tipo de ingresos">
                      <Sel value={form.tipo_ingresos} onChange={e => set("tipo_ingresos", e.target.value)}>
                        <option>Empleo formal</option><option>Negocio propio</option><option>Honorarios / Freelance</option><option>Rentas</option><option>Otro</option>
                      </Sel>
                    </Field>
                    <Field label="Ingresos mensuales aproximados (opcional)" hint="Solo referencia — la verificación se basa en tus documentos">
                      <Input type="number" placeholder="30000" value={form.ingresos_mensuales} onChange={e => set("ingresos_mensuales", e.target.value)} />
                    </Field>
                  </Grid>
                  <div style={{ marginBottom: 20 }}>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: colors.text, marginBottom: 4 }}>
                      Comprobantes de ingresos de los últimos 3 meses <span style={{ color: colors.red }}>*</span>
                    </label>
                    <p style={{ margin: "0 0 6px", fontSize: 11, color: colors.muted }}>
                      Sube hasta 3 archivos (uno por mes). Formatos: PDF, JPG, PNG.<br/>
                      • Nómina quincenal: 2 recibos por mes (6 en total)<br/>
                      • Nómina mensual: 1 recibo por mes (3 en total)<br/>
                      • Estado de cuenta: 1 por mes (3 en total)<br/>
                      • Declaración fiscal: 1 documento
                    </p>
                    {[0, 1, 2].map(idx => (
                      <div key={idx} style={{ marginBottom: 8 }}>
                        <div style={{ border: `2px dashed ${idx === 0 && errors.ingresos ? '#E07070' : (idx === 0 ? files.ingresos : files.ingresos_extra[idx-1]) ? colors.gold : colors.border}`, borderRadius: 10, padding: "12px 16px", background: (idx === 0 ? files.ingresos : files.ingresos_extra[idx-1]) ? "#fffbeb" : "#fafafa", cursor: "pointer" }}>
                          <input type="file" accept=".pdf,.jpg,.jpeg,.png" id={`ingresos_${idx}`} style={{ display: "none" }}
                            onChange={e => {
                              const file = e.target.files[0];
                              if (!file) return;
                              if (idx === 0) { setFiles(f => ({ ...f, ingresos: file })); setErrors(p => ({ ...p, ingresos: undefined })); }
                              else { setFiles(f => { const extra = [...f.ingresos_extra]; extra[idx-1] = file; return { ...f, ingresos_extra: extra }; }); }
                            }}
                          />
                          <label htmlFor={`ingresos_${idx}`} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ fontSize: 18 }}>{(idx === 0 ? files.ingresos : files.ingresos_extra[idx-1]) ? '✅' : '📎'}</span>
                            <div>
                              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: (idx === 0 ? files.ingresos : files.ingresos_extra[idx-1]) ? colors.success : colors.muted }}>
                                {(idx === 0 ? files.ingresos : files.ingresos_extra[idx-1])?.name || `Mes ${idx + 1} ${idx === 0 ? '(requerido)' : '(opcional)'}`}
                              </p>
                              {!(idx === 0 ? files.ingresos : files.ingresos_extra[idx-1]) && <p style={{ margin: 0, fontSize: 11, color: colors.muted }}>Clic para subir</p>}
                            </div>
                          </label>
                        </div>
                      </div>
                    ))}
                    {errors.ingresos && <p style={{ margin: "4px 0 0", fontSize: 12, color: "#E07070", fontWeight: 600 }}>{errors.ingresos}</p>}
                  </div>
                  <div style={{ marginTop: 8, padding: '12px 16px', background: '#f0f9ff', borderRadius: 10, border: '1px solid #bae6fd' }}>
                    <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: '#0369a1' }}>📎 Documentos adicionales (opcionales)</p>
                    <FileUpload label="Carta laboral (opcional)" hint="Solo si eres empleado formal" value={files.carta_laboral} onChange={e => handleFile('carta_laboral', e)} />
                    <FileUpload label="Constancia de situación fiscal (opcional)" hint="CSF del SAT" value={files.constancia_fiscal} onChange={e => handleFile('constancia_fiscal', e)} />
                  </div>
                </>
              ) : (
                <>
                  <SectionTitle number="4" title="Información Financiera" subtitle="" />
                  <Grid>
                    <Field label="Actividad principal">
                      <Input value={form.actividad_empresa} onChange={e => set("actividad_empresa", e.target.value)} />
                    </Field>
                    <Field label="Giro comercial">
                      <Input value={form.giro_comercial} onChange={e => set("giro_comercial", e.target.value)} />
                    </Field>
                  </Grid>
                  <Field label="Página web">
                    <Input type="url" placeholder="https://..." value={form.pagina_web_empresa2} onChange={e => set("pagina_web_empresa2", e.target.value)} />
                  </Field>
                  <Field label="Origen de los recursos con los que se pagará la renta" required error={errors.origen_recursos}>
                    <Textarea value={form.origen_recursos} onChange={e => set("origen_recursos", e.target.value)} error={errors.origen_recursos} />
                  </Field>
                  <Field label="Ingresos mensuales de la empresa (opcional)" hint="Solo referencia — la verificación se basa en tus documentos">
                    <Input type="number" placeholder="100000" value={form.ingresos_empresa} onChange={e => set("ingresos_empresa", e.target.value)} />
                  </Field>
                  <FileUpload
                    label="Comprobantes de ingresos de los últimos 3 meses (en un solo PDF)"
                    hint="Estados de cuenta, estados financieros, declaraciones fiscales o CFDI. Incluye 3 meses consecutivos en un solo archivo."
                    required
                    value={files.empresa}
                    onChange={e => handleFile("empresa", e)}
                    error={errors.empresa}
                  />
                  <div style={{ marginTop: 8, padding: '12px 16px', background: '#f0f9ff', borderRadius: 10, border: '1px solid #bae6fd' }}>
                    <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: '#0369a1' }}>📎 Documentos adicionales (opcionales)</p>
                    <FileUpload label="Constancia de situación fiscal (opcional)" hint="CSF del SAT" value={files.constancia_fiscal} onChange={e => handleFile('constancia_fiscal', e)} />
                  </div>
                </>
              )}
            </div>
          )}

          {/* PASO 4 — Uso del inmueble */}
          {step === 4 && (
            <div>
              <SectionTitle number="5" title="Uso del Inmueble" subtitle="" />
              <Grid>
                <Field label="Uso que se dará al inmueble" required>
                  <Sel value={form.uso_inmueble} onChange={e => set("uso_inmueble", e.target.value)}>
                    <option>Casa habitación</option><option>Oficina</option><option>Comercio</option><option>Bodega</option><option>Otro</option>
                  </Sel>
                </Field>
                <Field label="¿Existirá subarrendamiento?">
                  <Sel value={form.subarrendamiento} onChange={e => set("subarrendamiento", e.target.value)}>
                    <option>No</option><option>Sí</option>
                  </Sel>
                </Field>
              </Grid>
              <Field label="Describe el uso específico del inmueble" required error={errors.descripcion_uso}>
                <Textarea value={form.descripcion_uso} onChange={e => set("descripcion_uso", e.target.value)} error={errors.descripcion_uso} placeholder="Describe detalladamente cómo usarás el inmueble" />
              </Field>
              <SectionTitle number="5b" title="Arrendador Actual" subtitle="" />
              <Grid>
                <Field label="Nombre del arrendador actual">
                  <Input value={form.nombre_arrendador} onChange={e => set("nombre_arrendador", e.target.value)} />
                </Field>
                <Field label="Teléfono del arrendador">
                  <Input type="tel" value={form.telefono_arrendador} onChange={e => set("telefono_arrendador", e.target.value)} />
                </Field>
              </Grid>
              <Grid>
                <Field label="Monto de renta actual">
                  <Input type="number" value={form.monto_renta_actual} onChange={e => set("monto_renta_actual", e.target.value)} />
                </Field>
                <Field label="Motivo del cambio">
                  <Input value={form.motivo_cambio} onChange={e => set("motivo_cambio", e.target.value)} />
                </Field>
              </Grid>
            </div>
          )}

          {/* PASO 5 — Referencias */}
          {step === 5 && (
            <div>
              <SectionTitle number="6" title="Referencias Familiares" subtitle="Mínimo 1 referencia familiar requerida" />
              {[1, 2, 3].map(n => (
                <div key={n} style={{ background: colors.gray, borderRadius: 12, padding: "16px 20px", marginBottom: 16, border: n === 1 && errors.ref_fam1_nombre ? "1px solid #E07070" : "none" }}>
                  <p style={{ margin: "0 0 12px", fontWeight: 700, fontSize: 14, color: colors.dark }}>
                    Referencia familiar {n} {n === 1 && <span style={{ color: colors.red }}>*</span>}
                  </p>
                  <Grid cols={3}>
                    <Field label="Nombre" error={n === 1 ? errors.ref_fam1_nombre : undefined}>
                      <Input value={form[`ref_fam${n}_nombre`]} onChange={e => set(`ref_fam${n}_nombre`, e.target.value)} error={n === 1 ? errors.ref_fam1_nombre : undefined} />
                    </Field>
                    <Field label="Parentesco">
                      <Input value={form[`ref_fam${n}_parentesco`]} onChange={e => set(`ref_fam${n}_parentesco`, e.target.value)} placeholder="Madre, padre..." />
                    </Field>
                    <Field label="Teléfono" error={n === 1 ? errors.ref_fam1_telefono : undefined}>
                      <Input type="tel" value={form[`ref_fam${n}_telefono`]} onChange={e => set(`ref_fam${n}_telefono`, e.target.value)} error={n === 1 ? errors.ref_fam1_telefono : undefined} />
                    </Field>
                  </Grid>
                </div>
              ))}

              <SectionTitle number="6b" title="Referencias Personales" subtitle="Mínimo 1 referencia personal requerida (no familiares)" />
              {[1, 2, 3].map(n => (
                <div key={n} style={{ background: colors.gray, borderRadius: 12, padding: "16px 20px", marginBottom: 16, border: n === 1 && errors.ref_per1_nombre ? "1px solid #E07070" : "none" }}>
                  <p style={{ margin: "0 0 12px", fontWeight: 700, fontSize: 14, color: colors.dark }}>
                    Referencia personal {n} {n === 1 && <span style={{ color: colors.red }}>*</span>}
                  </p>
                  <Grid cols={3}>
                    <Field label="Nombre" error={n === 1 ? errors.ref_per1_nombre : undefined}>
                      <Input value={form[`ref_per${n}_nombre`]} onChange={e => set(`ref_per${n}_nombre`, e.target.value)} error={n === 1 ? errors.ref_per1_nombre : undefined} />
                    </Field>
                    <Field label="Relación">
                      <Input value={form[`ref_per${n}_relacion`]} onChange={e => set(`ref_per${n}_relacion`, e.target.value)} placeholder="Amigo, compañero..." />
                    </Field>
                    <Field label="Teléfono" error={n === 1 ? errors.ref_per1_telefono : undefined}>
                      <Input type="tel" value={form[`ref_per${n}_telefono`]} onChange={e => set(`ref_per${n}_telefono`, e.target.value)} error={n === 1 ? errors.ref_per1_telefono : undefined} />
                    </Field>
                  </Grid>
                </div>
              ))}
            </div>
          )}

          {/* PASO 6 — Ocupantes + envío */}
          {step === 6 && (
            <div>
              <SectionTitle number="7" title="Ocupantes del Inmueble" subtitle="" />
              <Grid>
                <Field label="¿Cuántas personas habitarán?" required error={errors.num_personas}>
                  <Input type="number" min="1" value={form.num_personas} onChange={e => set("num_personas", e.target.value)} error={errors.num_personas} />
                </Field>
                <Field label="¿Habrá mascotas?">
                  <Sel value={form.mascotas} onChange={e => set("mascotas", e.target.value)}>
                    <option>No</option><option>Sí</option>
                  </Sel>
                </Field>
              </Grid>
              <Field label="Nombre y parentesco de cada persona que habitará" required error={errors.personas_detalle}>
                <Textarea value={form.personas_detalle} onChange={e => set("personas_detalle", e.target.value)} placeholder="Ej: María López (esposa), Juan Jr. (hijo, 8 años)..." error={errors.personas_detalle} />
              </Field>
              {form.mascotas === "Sí" && (
                <Field label="¿Cuántas mascotas y de qué tipo?">
                  <Input value={form.mascotas_detalle} onChange={e => set("mascotas_detalle", e.target.value)} placeholder="Ej: 1 perro labrador, 2 gatos" />
                </Field>
              )}
              <Grid>
                <Field label="¿Habrá personal de servicio de planta?">
                  <Sel value={form.personal_servicio} onChange={e => set("personal_servicio", e.target.value)}>
                    <option>No</option><option>Sí</option>
                  </Sel>
                </Field>
                {form.personal_servicio === "Sí" && (
                  <Field label="¿Cuántas personas y modalidad?">
                    <Input value={form.personal_servicio_detalle} onChange={e => set("personal_servicio_detalle", e.target.value)} />
                  </Field>
                )}
              </Grid>

              {/* Aviso de privacidad */}
              <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 12, padding: "20px", margin: "24px 0" }}>
                <p style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: "#0369a1" }}>📄 Aviso de Privacidad</p>
                <p style={{ margin: "0 0 16px", fontSize: 13, color: "#0369a1", lineHeight: 1.6 }}>
                  Tus datos personales serán tratados conforme a nuestro{" "}
                  <a href="https://emporio-inmobiliario.easybroker.com/AVISO" target="_blank" rel="noreferrer" style={{ color: "#b91c3c", fontWeight: 700 }}>Aviso de Privacidad</a>
                  {" "}de Emporio Inmobiliario, en cumplimiento con la LFPDPPP.
                </p>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
                  <input type="checkbox" checked={aceptaPrivacidad} onChange={e => setAceptaPrivacidad(e.target.checked)} style={{ width: 18, height: 18, marginTop: 2, accentColor: "#b91c3c", flexShrink: 0 }} />
                  <span style={{ fontSize: 14, color: colors.text, lineHeight: 1.5 }}>
                    He leído y acepto el <a href="https://emporio-inmobiliario.easybroker.com/AVISO" target="_blank" rel="noreferrer" style={{ color: "#b91c3c", fontWeight: 700 }}>Aviso de Privacidad</a> y autorizo el tratamiento de mis datos personales. <span style={{ color: colors.red }}>*</span>
                  </span>
                </label>
              </div>

              {error && (
                <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 12, padding: "14px 18px" }}>
                  <p style={{ margin: 0, fontSize: 14, color: "#991b1b", fontWeight: 600 }}>{error}</p>
                </div>
              )}
            </div>
          )}

          {/* Navegación */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 32, paddingTop: 24, borderTop: `1px solid ${colors.border}` }}>
            {step > 1 ? (
              <button onClick={() => { setErrors({}); setStep(s => s - 1); }} style={{ background: colors.gray, border: "none", borderRadius: 10, padding: "12px 24px", cursor: "pointer", fontWeight: 700, fontSize: 14, color: colors.muted }}>← Anterior</button>
            ) : <div />}
            {step < totalSteps ? (
              <button onClick={handleNext} style={{ background: "#b91c3c", color: "#fff", border: "none", borderRadius: 10, padding: "12px 28px", cursor: "pointer", fontWeight: 700, fontSize: 15 }}>Siguiente →</button>
            ) : (
              <button onClick={handleSubmit} disabled={submitting || !aceptaPrivacidad} style={{ background: submitting ? "#9ca3af" : !aceptaPrivacidad ? "#e5e7eb" : "#b91c3c", color: !aceptaPrivacidad ? colors.muted : "#fff", border: "none", borderRadius: 10, padding: "13px 32px", cursor: submitting || !aceptaPrivacidad ? "not-allowed" : "pointer", fontWeight: 800, fontSize: 15 }}>
                {submitting ? "Enviando..." : "✅ Enviar solicitud"}
              </button>
            )}
          </div>
        </div>

        <p style={{ textAlign: "center", marginTop: 20, fontSize: 12, color: colors.muted }}>
          Emporio Inmobiliario · <a href="https://emporioinmobiliario.com.mx" style={{ color: "#b91c3c" }}>emporioinmobiliario.com.mx</a> · 222 257 3237
        </p>
      </div>
    </div>
  );
}
