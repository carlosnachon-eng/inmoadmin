// lib/generarPagares.js
// Genera los 12 pagarés en un solo .docx

const ORDINALES = [
  '', 'primero', 'segundo', 'tercero', 'cuarto', 'quinto', 'sexto',
  'séptimo', 'octavo', 'noveno', 'décimo', 'décimo primero', 'décimo segundo'
]

const ORDINALES_TITULO = [
  '', 'PRIMERO', 'SEGUNDO', 'TERCERO', 'CUARTO', 'QUINTO', 'SEXTO',
  'SÉPTIMO', 'OCTAVO', 'NOVENO', 'DÉCIMO', 'DÉCIMO PRIMERO', 'DÉCIMO SEGUNDO'
]

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
  return `${millones(entero)} ${String(cents).padStart(2,'0')}/100 MONEDA NACIONAL`
}

function fmtFecha(d) {
  if (!d) return '___/___/______'
  if (typeof d === 'string' && d.includes('/')) return d
  return new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function calcularFechasPagares(fechaInicio) {
  const fechas = []
  const base = typeof fechaInicio === 'string' && fechaInicio.includes('/')
    ? new Date(fechaInicio.split('/').reverse().join('-') + 'T12:00:00')
    : new Date(fechaInicio + 'T12:00:00')
  for (let i = 0; i < 12; i++) {
    const d = new Date(base)
    d.setMonth(d.getMonth() + i)
    fechas.push(d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }))
  }
  return fechas
}

export async function generarPagares(exp) {
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    AlignmentType, BorderStyle, WidthType, PageBreak,
  } = await import('docx')

  const fmt = (n) => n ? `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : '$0.00'
  const bold = (text, size = 22) => new TextRun({ text: String(text ?? ''), bold: true, size, font: 'Arial' })
  const normal = (text, size = 22) => new TextRun({ text: String(text ?? ''), size, font: 'Arial' })

  const para = (children, opts = {}) => new Paragraph({
    children: Array.isArray(children) ? children : [children],
    spacing: { before: 120, after: 120 },
    alignment: AlignmentType.JUSTIFIED,
    ...opts,
  })
  const espacio = () => new Paragraph({ children: [new TextRun({ text: '', size: 22 })], spacing: { before: 60, after: 60 } })

  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const singleBorder = { style: BorderStyle.SINGLE, size: 4, color: '000000' }

  const d = {
    nombre_arrendador:    exp.nombre_arrendador || '',
    nombre_arrendatario:  exp.nombre_arrendatario || '',
    renta:                Number(exp.renta_mensual) || 0,
    renta_letra:          numeroALetra(Number(exp.renta_mensual)),
    forma_pago:           exp.forma_pago || 'Efectivo',
    fecha_firma:          fmtFecha(exp.fecha_firma),
    ciudad:               exp.ciudad_estado_inmueble || 'Puebla',
  }

  // Calcular las 12 fechas
  const fechas = calcularFechasPagares(exp.fecha_inicio)

  const children = []

  for (let i = 0; i < 12; i++) {
    const num = i + 1
    const ordinal = ORDINALES[num]
    const ordinalTitulo = ORDINALES_TITULO[num]
    const fecha = fechas[i]

    // Título del pagaré
    if (i > 0) {
      children.push(new Paragraph({ children: [new PageBreak()], spacing: { before: 0, after: 0 } }))
    }

    children.push(
      new Paragraph({
        children: [bold(`PAGARÉ ${num}/12`)],
        alignment: AlignmentType.CENTER,
        spacing: { before: 160, after: 160 },
      })
    )

    // Texto principal
    children.push(para([
      normal('Por este pagaré prometo pagar incondicionalmente a la orden de '),
      bold(`C. ${d.nombre_arrendador}`),
      normal(' la cantidad de '),
      bold(`${fmt(d.renta)} (`),
      bold(d.renta_letra),
      bold(')'),
      normal(', el día '),
      bold(fecha),
      normal(', por pago en '),
      bold(d.forma_pago),
      normal('. En caso de controversia y ejecución el suscriptor de este pagaré renuncia al fuero que por razón de Territorio les corresponda o les pudiera corresponder, sometiéndose expresamente a los Tribunales Competentes de la Ciudad de Puebla.'),
    ]))

    children.push(espacio())

    children.push(para([
      normal('En caso de que este pagaré no sea pagado en la fecha de su vencimiento, su importe causará intereses moratorios a razón del '),
      bold('5% (CINCO POR CIENTO) MENSUAL '),
      normal('desde la fecha de su vencimiento y hasta la fecha de pago total del mismo, sin que por ello se considere prorrogada la obligación principal.'),
    ]))

    children.push(espacio())

    children.push(para([
      normal(`Este pagaré es el ${ordinal} de una serie de DOCE, en caso de que a su vencimiento no se cubra el mismo, se darán por vencidos los restantes y podrá exigirse el pago total de todos los documentos.`),
    ]))

    children.push(espacio())
    children.push(espacio())

    children.push(new Paragraph({
      children: [bold('FECHA Y LUGAR DE SUSCRIPCIÓN:')],
      spacing: { before: 80, after: 80 },
    }))

    children.push(new Paragraph({
      children: [
        normal('EN LA CIUDAD DE '),
        bold(d.ciudad.split(',')[0].toUpperCase()),
        normal(' EL '),
        bold(d.fecha_firma),
      ],
      spacing: { before: 80, after: 160 },
    }))

    children.push(new Paragraph({
      children: [bold('SUSCRIPTOR.')],
      spacing: { before: 80, after: 80 },
    }))

    children.push(espacio())
    children.push(espacio())

    // Tabla de firma
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [9360],
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 9360, type: WidthType.DXA },
              borders: { top: singleBorder, bottom: singleBorder, left: singleBorder, right: singleBorder },
              margins: { top: 120, bottom: 120, left: 180, right: 180 },
              children: [
                new Paragraph({
                  children: [bold(`NOMBRE: C. ${d.nombre_arrendatario}`)],
                  spacing: { before: 60, after: 60 },
                }),
              ]
            })
          ]
        }),
        new TableRow({
          children: [
            new TableCell({
              width: { size: 9360, type: WidthType.DXA },
              borders: { top: noBorder, bottom: singleBorder, left: singleBorder, right: singleBorder },
              margins: { top: 120, bottom: 120, left: 180, right: 180 },
              children: [
                new Paragraph({
                  children: [bold('FIRMA Y HUELLA: ')],
                  spacing: { before: 60, after: 240 },
                }),
              ]
            })
          ]
        }),
      ]
    }))
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 22 } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
        }
      },
      children,
    }]
  })

  const buffer = await Packer.toBlob(doc)
  const url = URL.createObjectURL(buffer)
  const a = document.createElement('a')
  a.href = url
  a.download = `Pagares_${d.nombre_arrendatario.replace(/\s+/g, '_')}_${exp.fecha_firma || 'borrador'}.docx`
  a.click()
  URL.revokeObjectURL(url)
}
