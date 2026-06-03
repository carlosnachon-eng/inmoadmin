import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

const colors = {
  red: '#b91c3c', text: '#374151', muted: '#9ca3af', border: '#e5e7eb',
  success: '#065f46', successBg: '#f0fdf4', white: '#ffffff',
}

const Field = ({ label, hint, children }) => (
  <div style={{ marginBottom: 20 }}>
    <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: colors.text, marginBottom: 4 }}>{label}</label>
    {hint && <p style={{ margin: '0 0 6px', fontSize: 11, color: colors.muted }}>{hint}</p>}
    {children}
  </div>
)

const FileUpload = ({ label, hint, onChange, value }) => (
  <Field label={label} hint={hint}>
    <div style={{ border: `2px dashed ${value ? colors.red : colors.border}`, borderRadius: 10, padding: '14px 18px', textAlign: 'center', background: value ? '#fffbeb' : '#fafafa', cursor: 'pointer' }}>
      <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={onChange} style={{ display: 'none' }} id={label.replace(/\s/g, '_')} />
      <label htmlFor={label.replace(/\s/g, '_')} style={{ cursor: 'pointer' }}>
        {value ? (
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: colors.success }}>✅ {value.name}</p>
        ) : (
          <div>
            <p style={{ margin: 0, fontSize: 22 }}>📎</p>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: colors.muted }}>Clic para subir</p>
          </div>
        )}
      </label>
    </div>
  </Field>
)

export default function ComplementarSolicitud() {
  const router = useRouter()
  const { id } = router.query
  const [sol, setSol] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [files, setFiles] = useState({
    carta_laboral: null,
    constancia_fiscal: null,
    doc_extra_1: null,
    doc_extra_2: null,
  })

  useEffect(() => {
    if (!id) return
    supabase.from('solicitudes_inquilino').select('nombre_completo, inmueble_interes, correo').eq('id', id).single()
      .then(({ data }) => { setSol(data); setLoading(false) })
  }, [id])

  const fileToBase64 = (file) => new Promise((resolve) => {
    if (!file) { resolve(null); return }
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.readAsDataURL(file)
  })

  const handleSubmit = async () => {
    setSubmitting(true)
    const [b64CartaLaboral, b64Constancia, b64Extra1, b64Extra2] = await Promise.all([
      fileToBase64(files.carta_laboral),
      fileToBase64(files.constancia_fiscal),
      fileToBase64(files.doc_extra_1),
      fileToBase64(files.doc_extra_2),
    ])

    const updates = {}
    if (b64CartaLaboral) updates.doc_carta_laboral_b64 = b64CartaLaboral
    if (b64Constancia) updates.doc_constancia_fiscal_b64 = b64Constancia
    if (b64Extra1) updates.doc_extra_1_b64 = b64Extra1
    if (b64Extra2) updates.doc_extra_2_b64 = b64Extra2

    if (Object.keys(updates).length === 0) { setSubmitting(false); return }

    await supabase.from('solicitudes_inquilino').update({ ...updates, documentos_complementados: true }).eq('id', id)
    setSubmitting(false)
    setSubmitted(true)
  }

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p>Cargando...</p></div>

  if (!sol) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p>Solicitud no encontrada.</p></div>

  if (submitted) return (
    <div style={{ minHeight: '100vh', background: '#f8f8f8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 20, padding: 48, maxWidth: 480, width: '100%', textAlign: 'center', boxShadow: '0 10px 40px rgba(0,0,0,0.1)' }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
        <h2 style={{ margin: '0 0 12px', fontSize: 22, fontWeight: 800, color: colors.text }}>¡Documentos enviados!</h2>
        <p style={{ color: colors.muted, fontSize: 14 }}>Nuestro equipo jurídico los revisará y te contactará pronto.</p>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#f8f8f8', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 36 }} />
        <div>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: colors.text }}>Complementar solicitud</p>
          <p style={{ margin: 0, fontSize: 12, color: colors.muted }}>{sol.nombre_completo} · {sol.inmueble_interes}</p>
        </div>
      </div>
      <div style={{ maxWidth: 560, margin: '32px auto', padding: '0 20px' }}>
        <div style={{ background: '#fff', borderRadius: 16, padding: 32, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 800, color: colors.text }}>Sube los documentos solicitados</h2>
          <p style={{ margin: '0 0 24px', fontSize: 13, color: colors.muted }}>Nuestro equipo jurídico necesita la siguiente información para continuar con tu solicitud.</p>

          <FileUpload label="Carta laboral" hint="Carta de tu empleador con sueldo y puesto" value={files.carta_laboral} onChange={e => setFiles(f => ({ ...f, carta_laboral: e.target.files[0] || null }))} />
          <FileUpload label="Constancia de situación fiscal" hint="CSF del SAT (actualizada)" value={files.constancia_fiscal} onChange={e => setFiles(f => ({ ...f, constancia_fiscal: e.target.files[0] || null }))} />
          <FileUpload label="Documento adicional 1 (opcional)" hint="Cualquier documento que el equipo haya solicitado" value={files.doc_extra_1} onChange={e => setFiles(f => ({ ...f, doc_extra_1: e.target.files[0] || null }))} />
          <FileUpload label="Documento adicional 2 (opcional)" value={files.doc_extra_2} onChange={e => setFiles(f => ({ ...f, doc_extra_2: e.target.files[0] || null }))} />

          <button onClick={handleSubmit} disabled={submitting || (!files.carta_laboral && !files.constancia_fiscal && !files.doc_extra_1 && !files.doc_extra_2)}
            style={{ width: '100%', background: colors.red, color: '#fff', border: 'none', borderRadius: 10, padding: 14, fontWeight: 800, fontSize: 15, cursor: 'pointer', opacity: submitting ? 0.7 : 1, marginTop: 8 }}>
            {submitting ? 'Enviando...' : 'Enviar documentos →'}
          </button>
        </div>
      </div>
    </div>
  )
}
