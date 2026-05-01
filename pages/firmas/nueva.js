async function handleSubmit(e) {
  e.preventDefault()
  setLoading(true)
  try {
    const { data: { user } } = await supabase.auth.getUser()
    
    const res = await fetch('/api/firmas/crear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        monto_apartado: form.monto_apartado ? parseFloat(form.monto_apartado) : null,
        fecha_apartado: new Date().toISOString().split('T')[0],
        creado_por: user.id,
        creado_por_nombre: user.email,
      })
    })
    const data = await res.json()
    if (data.firma) {
      router.push(`/firmas/${data.firma.id}`)
    } else {
      console.error('Error:', data)
      setLoading(false)
    }
  } catch (err) {
    console.error('Error:', err)
    setLoading(false)
  }
}
