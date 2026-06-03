// lib/generarRecibo.js

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

  const FONT = 'Arial'
  const ROJO = 'C8102E'
  const NEGRO = '1A1A1A'
  const GRIS = '666666'
  const LINEA = 'CCCCCC'

  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }

  const d = {
    nombre: exp.nombre_arrendatario || '',
    monto: Number(exp.monto_poliza) || 0,
    letra: numeroALetra(Number(exp.monto_poliza)),
    fecha: fmtFecha(exp.fecha_firma),
    inmueble: exp.direccion_inmueble || '',
  }

  const fila = (etq, val, valBold = false) => new TableRow({
    children: [
      new TableCell({
        borders: noBorders,
        width: { size: 2800, type: WidthType.DXA },
        shading: { fill: 'F5F5F5' },
        margins: { top: 60, bottom: 60, left: 100, right: 60 },
        children: [new Paragraph({ children: [new TextRun({ text: etq, size: 16, font: FONT, color: GRIS })], spacing: { before: 0, after: 0 } })],
      }),
      new TableCell({
        borders: noBorders,
        width: { size: 6200, type: WidthType.DXA },
        margins: { top: 60, bottom: 60, left: 100, right: 60 },
        children: [new Paragraph({ children: [new TextRun({ text: val, size: 16, font: FONT, bold: valBold, color: NEGRO })], spacing: { before: 0, after: 0 } })],
      }),
    ],
  })

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 18 } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 7920 },
          margin: { top: 2160, right: 1200, bottom: 1200, left: 1200 },
        },
      },
      children: [
        // Título
        new Paragraph({
          children: [new TextRun({ text: 'RECIBO DE PAGO', bold: true, size: 28, font: 'Georgia', color: NEGRO })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 0 },
        }),
        new Paragraph({
          children: [new TextRun({ text: 'PÓLIZA JURÍDICA INMOBILIARIA', bold: true, size: 16, font: FONT, color: ROJO })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 0 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ROJO, space: 1 } },
        }),
        // Monto
        new Paragraph({
          children: [new TextRun({ text: fmtMonto(d.monto), bold: true, size: 40, font: 'Georgia', color: ROJO })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 60, after: 0 },
        }),
        new Paragraph({
          children: [new TextRun({ text: d.letra, size: 14, font: FONT, color: GRIS })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 60 },
        }),
        // Tabla de datos
        new Table({
          width: { size: 9000, type: WidthType.DXA },
          columnWidths: [2800, 6200],
          borders: {
            top: noBorder, bottom: noBorder, left: noBorder, right: noBorder,
            insideH: { style: BorderStyle.SINGLE, size: 2, color: LINEA },
            insideV: noBorder,
          },
          rows: [
            fila('Recibí de:', d.nombre, true),
            fila('Concepto:', 'Pago de Póliza Jurídica – Emporio Blindaje Legal'),
            fila('Inmueble:', d.inmueble),
            fila('Fecha:', d.fecha, true),
          ],
        }),
        // Línea de firma
        new Paragraph({
          children: [new TextRun({ text: '', size: 16 })],
          spacing: { before: 300, after: 0 },
          alignment: AlignmentType.CENTER,
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: NEGRO, space: 1 } },
        }),
        new Paragraph({
          children: [new TextRun({ text: 'Carlos Alejandro Nachon Saldivar', bold: true, size: 16, font: FONT, color: NEGRO })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 20, after: 0 },
        }),
        new Paragraph({
          children: [new TextRun({ text: 'Emporio Inmobiliario', size: 14, font: FONT, color: GRIS, italics: true })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 40 },
        }),
        // Pie
        new Paragraph({
          children: [new TextRun({ text: '', size: 4 })],
          spacing: { before: 40, after: 0 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINEA, space: 1 } },
        }),
        new Paragraph({
          children: [new TextRun({ text: 'EMPORIO INMOBILIARIO  |  Póliza Jurídica Inmobiliaria', bold: true, size: 14, font: FONT, color: ROJO })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 20, after: 0 },
        }),
        new Paragraph({
          children: [new TextRun({ text: 'Documento confidencial – Uso exclusivo del propietario', size: 14, font: FONT, color: GRIS, italics: true })],
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
  a.download = `Recibo_Poliza_${d.nombre.replace(/\s+/g, '_')}.docx`
  a.click()
  URL.revokeObjectURL(url)
}
