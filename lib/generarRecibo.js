// lib/generarRecibo.js
// Genera el recibo de pago de póliza jurídica en .docx — diseño profesional para hoja membretada

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
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    AlignmentType, BorderStyle, WidthType,
  } = await import('docx')

  const FONT     = 'Arial'
  const COLOR_ROJO  = 'C8102E'
  const COLOR_NEGRO = '1A1A1A'
  const COLOR_GRIS  = '555555'
  const COLOR_LINEA = 'DDDDDD'

  const bold   = (text, size = 20) => new TextRun({ text: String(text ?? ''), bold: true, size, font: FONT, color: COLOR_NEGRO })
  const normal = (text, size = 20) => new TextRun({ text: String(text ?? ''), size, font: FONT, color: COLOR_NEGRO })
  const muted  = (text, size = 18) => new TextRun({ text: String(text ?? ''), size, font: FONT, color: COLOR_GRIS })
  const rojo   = (text, size = 20) => new TextRun({ text: String(text ?? ''), bold: true, size, font: FONT, color: COLOR_ROJO })

  const noBorder  = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }

  const d = {
    nombre_arrendatario: exp.nombre_arrendatario || '',
    monto_poliza:        Number(exp.monto_poliza) || 0,
    monto_letra:         numeroALetra(Number(exp.monto_poliza)),
    fecha_firma:         fmtFecha(exp.fecha_firma),
    direccion_inmueble:  exp.direccion_inmueble || '',
  }

  // Fila de datos con etiqueta y valor
  const filaInfo = (etiqueta, valor, valorBold = false) => new TableRow({
    children: [
      new TableCell({
        borders: noBorders,
        width: { size: 3200, type: WidthType.DXA },
        shading: { fill: 'F5F5F5' },
        margins: { top: 50, bottom: 50, left: 100, right: 60 },
        children: [new Paragraph({
          children: [muted(etiqueta, 16)],
          spacing: { before: 0, after: 0 },
        })],
      }),
      new TableCell({
        borders: noBorders,
        width: { size: 5800, type: WidthType.DXA },
        margins: { top: 50, bottom: 50, left: 100, right: 60 },
        children: [new Paragraph({
          children: [valorBold ? bold(valor, 18) : normal(valor, 18)],
          spacing: { before: 0, after: 0 },
        })],
      }),
    ],
  })

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 7920 },
          margin: { top: 2160, right: 1200, bottom: 1440, left: 1200 },
        },
      },
      children: [

        // Título
        new Paragraph({
          children: [new TextRun({ text: 'RECIBO DE PAGO', bold: true, size: 26, font: 'Georgia', color: COLOR_NEGRO })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 10 },
        }),
        new Paragraph({
          children: [rojo('PÓLIZA JURÍDICA INMOBILIARIA', 17)],
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 20 },
        }),
        // Línea roja decorativa
        new Paragraph({
          children: [new TextRun({ text: '', size: 4 })],
          spacing: { before: 0, after: 100 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: COLOR_ROJO, space: 1 } },
        }),

        // Monto destacado
        new Paragraph({
          children: [
            new TextRun({ text: fmtMonto(d.monto_poliza), bold: true, size: 36, font: 'Georgia', color: COLOR_ROJO }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { before: 40, after: 10 },
        }),
        new Paragraph({
          children: [muted(d.monto_letra, 15)],
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 120 },
        }),

        // Tabla de datos
        new Table({
          width: { size: 9000, type: WidthType.DXA },
          columnWidths: [3200, 5800],
          borders: {
            top: noBorder, bottom: noBorder, left: noBorder, right: noBorder,
            insideH: { style: BorderStyle.SINGLE, size: 2, color: COLOR_LINEA },
            insideV: noBorder,
          },
          rows: [
            filaInfo('Recibí de:', d.nombre_arrendatario, true),
            filaInfo('Concepto:', 'Pago de Póliza Jurídica – Emporio Blindaje Legal'),
            filaInfo('Inmueble:', d.direccion_inmueble),
            filaInfo('Fecha:', d.fecha_firma, true),
          ],
        }),

        // Espacio para firma
        new Paragraph({ children: [new TextRun({ text: '', size: 20 })], spacing: { before: 60, after: 0 } }),

        // Línea de firma
        new Paragraph({
          children: [new TextRun({ text: '', size: 20 })],
          spacing: { before: 200, after: 30 },
          alignment: AlignmentType.CENTER,
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR_NEGRO, space: 1 } },
        }),
        new Paragraph({
          children: [bold('Carlos Alejandro Nachon Saldivar', 18)],
          alignment: AlignmentType.CENTER,
          spacing: { before: 20, after: 6 },
        }),
        new Paragraph({
          children: [muted('Emporio Inmobiliario', 16)],
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 0 },
        }),

        // Pie
        new Paragraph({
          children: [new TextRun({ text: '', size: 4 })],
          spacing: { before: 80, after: 40 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR_LINEA, space: 1 } },
        }),
        new Paragraph({
          children: [rojo('EMPORIO INMOBILIARIO  |  Póliza Jurídica Inmobiliaria', 14)],
          alignment: AlignmentType.CENTER,
          spacing: { before: 30, after: 6 },
        }),
        new Paragraph({
          children: [muted('Documento confidencial – Uso exclusivo del propietario', 14)],
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 0 },
        }),
      ],
    }],
  })

  const buffer = await Packer.toBlob(doc)
  const url = URL.createObjectURL(buffer)
  const a = document.createElement('a')
  a.href = url
  a.download = `Recibo_Poliza_${d.nombre_arrendatario.replace(/\s+/g, '_')}.docx`
  a.click()
  URL.revokeObjectURL(url)
}
