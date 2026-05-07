import { useState, useRef } from 'react'
import Head from 'next/head'
import { supabase } from '../lib/supabase'

const STEPS = [
  { id: 1, label: 'Sus datos' },
  { id: 2, label: 'El inmueble' },
  { id: 3, label: 'Documentos' },
  { id: 4, label: 'Listo' },
]

const initialForm = {
  // Propietario
  nombre_propietario: '',
  telefono_propietario: '',
  correo_propietario: '',
  domicilio_propietario: '',
  rfc_propietario: '',
  clave_elector_propietario: '',
  // Bancarios
  forma_pago: 'transferencia',
  banco: '',
  clabe: '',
  cuenta_bancaria: '',
  // Inmueble
  direccion_inmueble: '',
  tipo_inmueble: 'habitacional_sin_muebles',
  monto_renta: '',
  mantenimiento_incluido: false,
  mascotas_permitidas: 'no',
  detalle_mascotas: '',
  num_habitantes: '',
  reglamento: 'no',
  permiso_mudanzas: '',
  contrato_administracion: false,
}

export default function RegistroPropietario() {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState(initialForm)
  const [files, setFiles] = useState({
    doc_identificacion: null,
    doc_comprobante_domicilio: null,
    doc_predial: null,
  })
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState({})
  const [submitId, setSubmitId] = useState(null)

  const fileRefs = {
    doc_identificacion: useRef(),
    doc_comprobante_domicilio: useRef(),
    doc_predial: useRef(),
  }

  const set = (field, value) => {
    setForm(f => ({ ...f, [field]: value }))
    setErrors(e => ({ ...e, [field]: undefined }))
  }

  const handleFile = (field, file) => {
    setFiles(f => ({ ...f, [field]: file }))
    setErrors(e => ({ ...e, [field]: undefined }))
  }

  // ---------- Validaciones por paso ----------
  const validateStep1 = () => {
    const e = {}
    if (!form.nombre_propietario.trim()) e.nombre_propietario = 'Requerido'
    if (!form.telefono_propietario.trim()) e.telefono_propietario = 'Requerido'
    if (!form.correo_propietario.trim()) e.correo_propietario = 'Requerido'
    if (!form.domicilio_propietario.trim()) e.domicilio_propietario = 'Requerido'
    if (form.forma_pago === 'transferencia' && !form.clabe.trim()) e.clabe = 'Requerido para transferencia'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const validateStep2 = () => {
    const e = {}
    if (!form.direccion_inmueble.trim()) e.direccion_inmueble = 'Requerido'
    if (!form.monto_renta) e.monto_renta = 'Requerido'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const validateStep3 = () => {
    const e = {}
    if (!files.doc_identificacion) e.doc_identificacion = 'Sube tu identificación oficial'
    if (!files.doc_comprobante_domicilio) e.doc_comprobante_domicilio = 'Sube comprobante de domicilio'
    if (!files.doc_predial) e.doc_predial = 'Sube la boleta de predial'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const next = () => {
    if (step === 1 && !validateStep1()) return
    if (step === 2 && !validateStep2()) return
    if (step === 3) { handleSubmit(); return }
    setStep(s => s + 1)
  }

  const back = () => setStep(s => s - 1)

  // ---------- Upload archivo ----------
  const uploadFile = async (field, file, propietarioId) => {
    const ext = file.name.split('.').pop()
    const path = `propietarios/${propietarioId}/${field}.${ext}`
    const { error } = await supabase.storage
      .from('poliza-docs')
      .upload(path, file, { upsert: true })
    if (error) throw error
    return path
  }

  // ---------- Submit ----------
  const handleSubmit = async () => {
    if (!validateStep3()) return
    setLoading(true)
    try {
      // 1. Insertar registro sin docs
      const payload = {
        ...form,
        monto_renta: parseFloat(form.monto_renta) || null,
        num_habitantes: parseInt(form.num_habitantes) || null,
      }
      const { data, error } = await supabase
        .from('propietarios_inmuebles')
        .insert(payload)
        .select('id')
        .single()
      if (error) throw error

      const propietarioId = data.id

      // 2. Subir documentos
      const urls = {}
      for (const field of Object.keys(files)) {
        if (files[field]) {
          urls[field] = await uploadFile(field, files[field], propietarioId)
        }
      }

      // 3. Actualizar con URLs
      await supabase
        .from('propietarios_inmuebles')
        .update(urls)
        .eq('id', propietarioId)

      setSubmitId(propietarioId)
      setStep(4)
    } catch (err) {
      console.error(err)
      setErrors({ global: 'Ocurrió un error. Por favor intenta de nuevo.' })
    } finally {
      setLoading(false)
    }
  }

  // ---------- Componentes internos ----------
  const Field = ({ label, error, children, required }) => (
    <div style={{ marginBottom: 20 }}>
      <label style={styles.label}>
        {label}{required && <span style={{ color: '#C8973A' }}> *</span>}
      </label>
      {children}
      {error && <p style={styles.errorMsg}>{error}</p>}
    </div>
  )

  const Input = ({ field, placeholder, type = 'text', ...rest }) => (
    <input
      type={type}
      value={form[field]}
      onChange={e => set(field, e.target.value)}
      placeholder={placeholder}
      style={{ ...styles.input, ...(errors[field] ? styles.inputError : {}) }}
      {...rest}
    />
  )

  const FileInput = ({ field, label, accept = '.pdf,.jpg,.jpeg,.png' }) => (
    <div
      onClick={() => fileRefs[field].current.click()}
      style={{
        ...styles.fileBox,
        ...(files[field] ? styles.fileBoxDone : {}),
        ...(errors[field] ? styles.fileBoxError : {}),
      }}
    >
      <input
        ref={fileRefs[field]}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={e => handleFile(field, e.target.files[0])}
      />
      <span style={styles.fileIcon}>{files[field] ? '✓' : '↑'}</span>
      <span style={styles.fileLabel}>
        {files[field] ? files[field].name : label}
      </span>
      <span style={styles.fileHint}>
        {files[field] ? 'Toca para cambiar' : 'PDF, JPG o PNG · máx 10 MB'}
      </span>
    </div>
  )

  const RadioGroup = ({ field, options }) => (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => set(field, o.value)}
          style={{
            ...styles.radioBtn,
            ...(form[field] === o.value ? styles.radioBtnActive : {}),
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )

  // ---------- Pasos ----------
  const Step1 = () => (
    <>
      <h2 style={styles.stepTitle}>Sus datos personales</h2>
      <p style={styles.stepDesc}>Esta información aparecerá en su contrato de prestación de servicios.</p>

      <Field label="Nombre completo" required error={errors.nombre_propietario}>
        <Input field="nombre_propietario" placeholder="Como aparece en su identificación oficial" />
      </Field>
      <Field label="Teléfono de contacto" required error={errors.telefono_propietario}>
        <Input field="telefono_propietario" placeholder="10 dígitos" type="tel" />
      </Field>
      <Field label="Correo electrónico" required error={errors.correo_propietario}>
        <Input field="correo_propietario" placeholder="correo@ejemplo.com" type="email" />
      </Field>
      <Field label="Domicilio particular" required error={errors.domicilio_propietario}>
        <textarea
          value={form.domicilio_propietario}
          onChange={e => set('domicilio_propietario', e.target.value)}
          placeholder="Calle, número, colonia, ciudad, estado"
          rows={3}
          style={{ ...styles.input, resize: 'vertical' }}
        />
      </Field>
      <Field label="RFC" error={errors.rfc_propietario}>
        <Input field="rfc_propietario" placeholder="XXXX000000XXX" style={{ textTransform: 'uppercase' }} />
      </Field>
      <Field label="Clave de elector (INE)" error={errors.clave_elector_propietario}>
        <Input field="clave_elector_propietario" placeholder="Clave de elector" />
      </Field>

      <div style={styles.divider} />
      <h3 style={styles.subTitle}>Datos para recibir su renta</h3>

      <Field label="Forma de pago preferida">
        <RadioGroup field="forma_pago" options={[
          { value: 'transferencia', label: 'Transferencia bancaria' },
          { value: 'efectivo', label: 'Efectivo' },
        ]} />
      </Field>

      {form.forma_pago === 'transferencia' && (
        <>
          <Field label="Banco" error={errors.banco}>
            <Input field="banco" placeholder="Ej: BBVA, Banorte, HSBC..." />
          </Field>
          <Field label="CLABE interbancaria" required error={errors.clabe}>
            <Input field="clabe" placeholder="18 dígitos" maxLength={18} />
          </Field>
          <Field label="Número de cuenta" error={errors.cuenta_bancaria}>
            <Input field="cuenta_bancaria" placeholder="Opcional" />
          </Field>
        </>
      )}
    </>
  )

  const Step2 = () => (
    <>
      <h2 style={styles.stepTitle}>Datos del inmueble</h2>
      <p style={styles.stepDesc}>Con esta información promocionaremos su propiedad.</p>

      <Field label="Dirección del inmueble" required error={errors.direccion_inmueble}>
        <textarea
          value={form.direccion_inmueble}
          onChange={e => set('direccion_inmueble', e.target.value)}
          placeholder="Calle, número, colonia, municipio, estado"
          rows={3}
          style={{ ...styles.input, resize: 'vertical' }}
        />
      </Field>

      <Field label="Tipo de inmueble">
        <RadioGroup field="tipo_inmueble" options={[
          { value: 'habitacional_sin_muebles', label: 'Casa/Depto sin muebles' },
          { value: 'habitacional_amueblada', label: 'Casa/Depto amueblada' },
          { value: 'comercial', label: 'Local comercial' },
        ]} />
      </Field>

      <Field label="Monto de renta mensual (MXN)" required error={errors.monto_renta}>
        <div style={{ position: 'relative' }}>
          <span style={styles.prefix}>$</span>
          <input
            type="number"
            value={form.monto_renta}
            onChange={e => set('monto_renta', e.target.value)}
            placeholder="0.00"
            style={{ ...styles.input, paddingLeft: 32 }}
          />
        </div>
      </Field>

      <Field label="¿El mantenimiento está incluido en la renta?">
        <RadioGroup field="mantenimiento_incluido" options={[
          { value: true, label: 'Sí, incluido' },
          { value: false, label: 'No incluido' },
        ]} />
      </Field>

      <Field label="¿Se permiten mascotas?">
        <RadioGroup field="mascotas_permitidas" options={[
          { value: 'si', label: 'Sí' },
          { value: 'no', label: 'No' },
          { value: 'condicionado', label: 'Condicionado' },
        ]} />
      </Field>
      {(form.mascotas_permitidas === 'si' || form.mascotas_permitidas === 'condicionado') && (
        <Field label="Especifique condiciones de mascotas">
          <Input field="detalle_mascotas" placeholder="Ej: Solo perros pequeños, sin gatos, etc." />
        </Field>
      )}

      <Field label="Número máximo de habitantes">
        <Input field="num_habitantes" type="number" placeholder="Ej: 4" min={1} />
      </Field>

      <Field label="¿Cuenta con reglamento de vecinos?">
        <RadioGroup field="reglamento" options={[
          { value: 'si', label: 'Sí' },
          { value: 'no', label: 'No' },
        ]} />
      </Field>

      <Field label="Condiciones para mudanza">
        <Input field="permiso_mudanzas" placeholder="Ej: Solo sábados 9am-5pm, avisar con 48 hrs..." />
      </Field>

      <div style={styles.divider} />
      <h3 style={styles.subTitle}>Servicio de administración</h3>
      <p style={{ ...styles.stepDesc, marginBottom: 12 }}>
        Además del arrendamiento, ¿desea que Emporio administre su inmueble? (cobranza, mantenimiento, reportes mensuales)
      </p>
      <Field label="¿Contratar servicio de administración?">
        <RadioGroup field="contrato_administracion" options={[
          { value: true, label: 'Sí, me interesa' },
          { value: false, label: 'Solo arrendamiento' },
        ]} />
      </Field>
    </>
  )

  const Step3 = () => (
    <>
      <h2 style={styles.stepTitle}>Documentos requeridos</h2>
      <p style={styles.stepDesc}>Suba una foto clara o PDF de cada documento. Todos son obligatorios.</p>

      <Field label="Identificación oficial (INE/Pasaporte)" error={errors.doc_identificacion}>
        <FileInput field="doc_identificacion" label="Toca para subir identificación" />
      </Field>

      <Field label="Comprobante de domicilio del inmueble (reciente)" error={errors.doc_comprobante_domicilio}>
        <FileInput field="doc_comprobante_domicilio" label="Toca para subir comprobante" />
      </Field>

      <Field label="Última boleta de predial (año en curso)" error={errors.doc_predial}>
        <FileInput field="doc_predial" label="Toca para subir predial" />
      </Field>

      {errors.global && (
        <div style={styles.globalError}>{errors.global}</div>
      )}

      <div style={styles.privacyNote}>
        🔒 Al enviar este formulario, acepta nuestro{' '}
        <a href="https://emporio-inmobiliario.easybroker.com/AVISO" target="_blank" rel="noreferrer" style={{ color: '#C8973A' }}>
          Aviso de Privacidad
        </a>
        . Su información es confidencial y se usará únicamente para los fines del contrato.
      </div>
    </>
  )

  const Step4 = () => (
    <div style={styles.successWrap}>
      <div style={styles.successIcon}>✓</div>
      <h2 style={styles.successTitle}>¡Registro enviado!</h2>
      <p style={styles.successDesc}>
        Recibimos los datos de su inmueble correctamente. En breve nos pondremos en contacto con usted para confirmar los detalles y comenzar la promoción.
      </p>
      <p style={{ color: '#888', fontSize: 13, marginTop: 16 }}>
        Folio de registro: <strong style={{ color: '#C8973A' }}>{submitId?.slice(0, 8).toUpperCase()}</strong>
      </p>
      <div style={styles.contactBox}>
        <p style={{ margin: 0, fontWeight: 600, color: '#fff' }}>¿Tiene alguna duda?</p>
        <p style={{ margin: '6px 0 0', color: '#aaa', fontSize: 14 }}>
          Escríbanos al WhatsApp o llámenos al <strong style={{ color: '#C8973A' }}>222 257 3237</strong>
        </p>
      </div>
    </div>
  )

  // ---------- Render ----------
  return (
    <>
      <Head>
        <title>Registra tu inmueble — Emporio Inmobiliario</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet" />
      </Head>

      <div style={styles.page}>
        {/* Header */}
        <header style={styles.header}>
          <img
            src="https://www.emporioinmobiliario.com.mx/logo.png"
            alt="Emporio Inmobiliario"
            style={styles.logo}
          />
        </header>

        {/* Hero */}
        {step < 4 && (
          <div style={styles.hero}>
            <h1 style={styles.heroTitle}>Registra tu inmueble</h1>
            <p style={styles.heroSub}>Completa el formulario y comenzamos a promocionarlo</p>
          </div>
        )}

        {/* Progress */}
        {step < 4 && (
          <div style={styles.progress}>
            {STEPS.slice(0, 3).map((s, i) => (
              <div key={s.id} style={styles.progressStep}>
                <div style={{
                  ...styles.progressDot,
                  ...(step >= s.id ? styles.progressDotActive : {}),
                  ...(step > s.id ? styles.progressDotDone : {}),
                }}>
                  {step > s.id ? '✓' : s.id}
                </div>
                <span style={{
                  ...styles.progressLabel,
                  ...(step === s.id ? styles.progressLabelActive : {}),
                }}>{s.label}</span>
                {i < 2 && <div style={{ ...styles.progressLine, ...(step > s.id ? styles.progressLineDone : {}) }} />}
              </div>
            ))}
          </div>
        )}

        {/* Card */}
        <div style={styles.card}>
          {step === 1 && <Step1 />}
          {step === 2 && <Step2 />}
          {step === 3 && <Step3 />}
          {step === 4 && <Step4 />}

          {/* Botones */}
          {step < 4 && (
            <div style={styles.btnRow}>
              {step > 1 && (
                <button onClick={back} style={styles.btnBack} disabled={loading}>
                  ← Anterior
                </button>
              )}
              <button
                onClick={next}
                style={{ ...styles.btnNext, ...(loading ? styles.btnDisabled : {}) }}
                disabled={loading}
              >
                {loading
                  ? 'Enviando...'
                  : step === 3
                  ? 'Enviar registro'
                  : 'Siguiente →'}
              </button>
            </div>
          )}
        </div>

        <footer style={styles.footer}>
          © {new Date().getFullYear()} Emporio Inmobiliario · Puebla, México
        </footer>
      </div>
    </>
  )
}

// ---------- Estilos ----------
const styles = {
  page: {
    minHeight: '100vh',
    background: '#0F0F0F',
    fontFamily: "'DM Sans', sans-serif",
    color: '#E8E8E8',
    paddingBottom: 60,
  },
  header: {
    display: 'flex',
    justifyContent: 'center',
    padding: '28px 20px 0',
  },
  logo: {
    height: 48,
    objectFit: 'contain',
  },
  hero: {
    textAlign: 'center',
    padding: '32px 20px 16px',
  },
  heroTitle: {
    fontFamily: "'Cormorant Garamond', serif",
    fontSize: 36,
    fontWeight: 700,
    color: '#FFFFFF',
    margin: '0 0 8px',
    letterSpacing: '-0.5px',
  },
  heroSub: {
    color: '#888',
    fontSize: 15,
    margin: 0,
  },
  progress: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 20px',
    gap: 0,
  },
  progressStep: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  progressDot: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: '#222',
    border: '2px solid #333',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 600,
    color: '#555',
    transition: 'all 0.3s',
    flexShrink: 0,
  },
  progressDotActive: {
    background: '#C8973A',
    border: '2px solid #C8973A',
    color: '#000',
  },
  progressDotDone: {
    background: '#2A5C3F',
    border: '2px solid #2A5C3F',
    color: '#5EC98A',
  },
  progressLabel: {
    fontSize: 12,
    color: '#555',
    display: 'none',
  },
  progressLabelActive: {
    color: '#C8973A',
    display: 'block',
  },
  progressLine: {
    width: 40,
    height: 2,
    background: '#222',
    margin: '0 8px',
    transition: 'background 0.3s',
  },
  progressLineDone: {
    background: '#2A5C3F',
  },
  card: {
    maxWidth: 560,
    margin: '0 auto',
    background: '#161616',
    border: '1px solid #222',
    borderRadius: 16,
    padding: '32px 28px',
    marginLeft: 16,
    marginRight: 16,
  },
  stepTitle: {
    fontFamily: "'Cormorant Garamond', serif",
    fontSize: 26,
    fontWeight: 700,
    color: '#FFF',
    margin: '0 0 6px',
  },
  stepDesc: {
    color: '#777',
    fontSize: 14,
    margin: '0 0 24px',
    lineHeight: 1.5,
  },
  subTitle: {
    fontFamily: "'Cormorant Garamond', serif",
    fontSize: 20,
    fontWeight: 600,
    color: '#C8973A',
    margin: '0 0 16px',
  },
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 500,
    color: '#AAA',
    marginBottom: 8,
    letterSpacing: '0.3px',
  },
  input: {
    width: '100%',
    background: '#1E1E1E',
    border: '1px solid #2E2E2E',
    borderRadius: 8,
    padding: '12px 14px',
    color: '#E8E8E8',
    fontSize: 15,
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s',
    fontFamily: "'DM Sans', sans-serif",
  },
  inputError: {
    borderColor: '#8B3A3A',
  },
  prefix: {
    position: 'absolute',
    left: 14,
    top: '50%',
    transform: 'translateY(-50%)',
    color: '#666',
    fontSize: 15,
  },
  radioBtn: {
    padding: '8px 16px',
    borderRadius: 8,
    border: '1px solid #2E2E2E',
    background: '#1E1E1E',
    color: '#888',
    fontSize: 13,
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontFamily: "'DM Sans', sans-serif",
  },
  radioBtnActive: {
    background: '#C8973A20',
    border: '1px solid #C8973A',
    color: '#C8973A',
  },
  fileBox: {
    border: '2px dashed #2E2E2E',
    borderRadius: 10,
    padding: '20px 16px',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s',
    background: '#1A1A1A',
  },
  fileBoxDone: {
    border: '2px dashed #2A5C3F',
    background: '#1A2E20',
  },
  fileBoxError: {
    border: '2px dashed #8B3A3A',
  },
  fileIcon: {
    display: 'block',
    fontSize: 24,
    marginBottom: 8,
    color: '#C8973A',
  },
  fileLabel: {
    display: 'block',
    fontSize: 14,
    color: '#DDD',
    fontWeight: 500,
    marginBottom: 4,
  },
  fileHint: {
    display: 'block',
    fontSize: 12,
    color: '#555',
  },
  divider: {
    height: 1,
    background: '#222',
    margin: '28px 0',
  },
  errorMsg: {
    color: '#E07070',
    fontSize: 12,
    margin: '6px 0 0',
  },
  globalError: {
    background: '#2A1A1A',
    border: '1px solid #8B3A3A',
    borderRadius: 8,
    padding: '12px 16px',
    color: '#E07070',
    fontSize: 14,
    marginBottom: 16,
  },
  privacyNote: {
    fontSize: 12,
    color: '#555',
    lineHeight: 1.6,
    marginTop: 20,
    padding: '14px',
    background: '#111',
    borderRadius: 8,
    border: '1px solid #1E1E1E',
  },
  btnRow: {
    display: 'flex',
    gap: 12,
    marginTop: 32,
    justifyContent: 'flex-end',
  },
  btnBack: {
    padding: '13px 22px',
    borderRadius: 8,
    border: '1px solid #2E2E2E',
    background: 'transparent',
    color: '#888',
    fontSize: 14,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  },
  btnNext: {
    padding: '13px 28px',
    borderRadius: 8,
    border: 'none',
    background: '#C8973A',
    color: '#000',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    letterSpacing: '0.3px',
  },
  btnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  successWrap: {
    textAlign: 'center',
    padding: '20px 0',
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    background: '#2A5C3F',
    color: '#5EC98A',
    fontSize: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 20px',
  },
  successTitle: {
    fontFamily: "'Cormorant Garamond', serif",
    fontSize: 30,
    fontWeight: 700,
    color: '#FFF',
    margin: '0 0 12px',
  },
  successDesc: {
    color: '#888',
    fontSize: 15,
    lineHeight: 1.6,
    maxWidth: 380,
    margin: '0 auto',
  },
  contactBox: {
    marginTop: 28,
    padding: '16px 20px',
    background: '#1A1A1A',
    border: '1px solid #222',
    borderRadius: 10,
    textAlign: 'left',
  },
  footer: {
    textAlign: 'center',
    color: '#333',
    fontSize: 12,
    marginTop: 40,
  },
}
