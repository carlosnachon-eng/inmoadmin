// lib/generarRecibo.js
// Genera el recibo de pago de póliza jurídica en .docx

function numeroALetra(n) {
  if (!n || isNaN(n)) return ''
  const entero = Math.floor(Number(n))
  const cents = Math.round((Number(n) - entero) * 100)
  const unidades = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE',
    'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE',
    'VEINTE', 'VEINTIÚN', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE']
  const decenas = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA']
  const centenas = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS']
  function menorMil(num) {
    if (num <= 0) return ''
    if (num < 30) return unidades[num]
    if (num < 100) { const d = Math.floor(num/10), u = num%10; return decenas[d]+(u>0?' Y '+unidades[u]:'') }
    if (num === 100) return 'CIEN'
    const c = Math.floor(num/100), r = num%100
    let res = centenas[c]+(r>0?' ':'')
    if (r>0&&r<30) res+=unidades[r]
    else if (r>=30) { const d=Math.floor(r/10),u=r%10; res+=decenas[d]+(u>0?' Y '+unidades[u]:'') }
    return res.trim()
  }
  function miles(num) {
    if (num===0) return ''
    if (num<1000) return menorMil(num)
    const m=Math.floor(num/1000), r=num%1000
    let res=m===1?'MIL':menorMil(m)+' MIL'
    if (r>0) res+=' '+menorMil(r)
    return res.trim()
  }
  function millones(num) {
    if (num===0) return 'CERO'
    if (num<1000000) return miles(num)
    const m=Math.floor(num/1000000), r=num%1000000
    let res=m===1?'UN MILLÓN':menorMil(m)+' MILLONES'
    if (r>0) res+=' '+miles(r)
    return res.trim()
  }
  return `${millones(entero)} ${String(cents).padStart(2,'0')}/100 M.N.`
}

function fmtFecha(d) {
  if (!d) return ''
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  let fecha
  if (typeof d === 'string' && d.includes('/')) {
    const parts = d.split('/')
    fecha = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00`)
  } else {
    fecha = new Date(d + 'T12:00:00')
  }
  return `${fecha.getDate()} de ${meses[fecha.getMonth()]} de ${fecha.getFullYear()}`
}

function fmtMonto(n) {
  return n ? `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : '$0.00'
}

export async function generarReciboPoliza(exp) {
  const {
    Document, Packer, Paragraph, TextRun,
    AlignmentType, BorderStyle, WidthType,
  } = await import('docx')

  const bold   = (text, size = 24) => new TextRun({ text: String(text ?? ''), bold: true, size, font: 'Arial' })
  const normal = (text, size = 24) => new TextRun({ text: String(text ?? ''), size, font: 'Arial' })

  const para = (children, opts = {}) => new Paragraph({
    children: Array.isArray(children) ? children : [children],
    spacing: { before: 160, after: 160 },
    ...opts,
  })
  const espacio = () => new Paragraph({ children: [new TextRun({ text: '', size: 24 })], spacing: { before: 80, after: 80 } })

  const d = {
    nombre_arrendatario: exp.nombre_arrendatario || '',
    monto_poliza:        Number(exp.monto_poliza) || 0,
    monto_letra:         numeroALetra(Number(exp.monto_poliza)),
    fecha_firma:         fmtFecha(exp.fecha_firma),
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 24 } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 2268, right: 1440, bottom: 2268, left: 1440 }
        }
      },
      children: [
        new Paragraph({
          children: [bold('RECIBO DE PAGO – PÓLIZA JURÍDICA', 32)],
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 400 },
        }),

        para([bold('Recibí de: '), bold(d.nombre_arrendatario)]),

        para([
          bold('La cantidad de: '),
          bold(`${fmtMonto(d.monto_poliza)} ( ${d.monto_letra})`),
        ]),

        para([bold('Concepto: '), normal('Pago de Póliza Jurídica – Emporio Blindaje Legal')]),

        para([bold('Forma de pago: '), normal('______________________________')]),

        para([bold('Fecha: '), normal(d.fecha_firma)]),

        espacio(),
        espacio(),
        espacio(),

        para([normal('Recibe:')]),
        para([bold('Carlos Alejandro Nachon Saldivar')]),
        para([bold('Firma: '), normal('______________________________')]),
      ]
    }]
  })

  const buffer = await Packer.toBlob(doc)
  const url = URL.createObjectURL(buffer)
  const a = document.createElement('a')
  a.href = url
  a.download = `Recibo_Poliza_${d.nombre_arrendatario.replace(/\s+/g, '_')}.docx`
  a.click()
  URL.revokeObjectURL(url)
}
