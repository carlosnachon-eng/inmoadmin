// lib/generarContratoPromocion.js
// Contrato de Prestación de Servicios de Mediación para Arrendamiento

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
  if (!d) return '___/___/______'
  if (typeof d === 'string' && d.includes('/')) return d
  const fecha = new Date(d + 'T12:00:00')
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  return `${fecha.getDate()} de ${meses[fecha.getMonth()]} de ${fecha.getFullYear()}`
}

function fmtFechaDia(d) {
  if (!d) return '___'
  if (typeof d === 'string' && d.includes('/')) {
    const parts = d.split('/')
    const fecha = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00`)
    const meses = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE']
    return `${fecha.getDate()} de ${meses[fecha.getMonth()]} de ${fecha.getFullYear()}`
  }
  const fecha = new Date(d + 'T12:00:00')
  const meses = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE']
  return `${fecha.getDate()} de ${meses[fecha.getMonth()]} de ${fecha.getFullYear()}`
}

export async function generarContratoPromocion(data) {
  const {
    Document, Packer, Paragraph, TextRun,
    AlignmentType, BorderStyle, WidthType, Table, TableRow, TableCell,
  } = await import('docx')

  const bold   = (text, size = 20) => new TextRun({ text: String(text ?? ''), bold: true, size, font: 'Arial' })
  const normal = (text, size = 20) => new TextRun({ text: String(text ?? ''), size, font: 'Arial' })

  const para = (children, opts = {}) => new Paragraph({
    children: Array.isArray(children) ? children : [children],
    spacing: { before: 100, after: 100 },
    alignment: AlignmentType.JUSTIFIED,
    ...opts,
  })
  const espacio = () => new Paragraph({ children: [new TextRun({ text: '', size: 20 })], spacing: { before: 60, after: 60 } })

  const noBorder  = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }

  const hoy = new Date()
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  const mesesMay = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE']
  const fechaHoy = `${hoy.getDate()} de ${meses[hoy.getMonth()]} de ${hoy.getFullYear()}`
  const fechaHoyMay = `${hoy.getDate()} de ${mesesMay[hoy.getMonth()]} de ${hoy.getFullYear()}`

  const d = {
    nombre_propietario:    data.nombre_arrendador || data.nombre_propietario || '',
    domicilio_propietario: data.domicilio_arrendador || data.domicilio_propietario || '',
    telefono_propietario:  data.telefono_arrendador || data.telefono_propietario || '',
    direccion_inmueble:    data.direccion_inmueble || '',
    monto_renta:           Number(data.renta_mensual || data.monto_renta || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 }),
    monto_renta_letra:     data.renta_mensual_letra || data.monto_renta_letra || numeroALetra(Number(data.renta_mensual || data.monto_renta || 0)),
    fecha_inicio:          fechaHoyMay,
    fecha_firma:           fechaHoy,
  }

  const firmaTable = () => new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [4680, 4680],
    borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideH: noBorder, insideV: noBorder },
    rows: [new TableRow({ children: [
      new TableCell({ borders: noBorders, width: { size: 4680, type: WidthType.DXA }, children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '_________________________________', size: 20, font: 'Arial' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [bold(d.nombre_propietario)] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [normal('EL PROPIETARIO')] }),
      ]}),
      new TableCell({ borders: noBorders, width: { size: 4680, type: WidthType.DXA }, children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [bold('GRUPO INMOBILIARIO NACHON TORRES S.A. DE C.V.')] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [normal('REPRESENTADO POR SU ADMINISTRADOR ÚNICO')] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [bold('CARLOS ALEJANDRO NACHON SALDIVAR')] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [normal('LA INMOBILIARIA')] }),
      ]}),
    ]})]
  })

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 2268, right: 1134, bottom: 2268, left: 1134 }
        }
      },
      children: [
        // TÍTULO
        para([
          bold('CONTRATO DE PRESTACIÓN DE SERVICIOS DE MEDIACIÓN PARA EL ARRENDAMIENTO DE INMUEBLE '),
          bold('QUE CELEBRAN POR UNA PARTE '),
          bold('GRUPO INMOBILIARIO NACHON TORRES S.A. DE C.V., REPRESENTADA POR SU ADMINISTRADOR ÚNICO, EL SR. CARLOS ALEJANDRO NACHON SALDIVAR'),
          bold(', CON DOMICILIO EN '),
          bold('5TO RETORNO DE OSA MENOR 2ª RESERVA TERRITORIAL ATLIXCAYOTL, SAN ANDRÉS CHOLULA, PUEBLA, C.P. 72820'),
          bold(', TELÉFONO '),
          bold('2222573237'),
          bold(', A QUIEN EN LO SUCESIVO SE LE DENOMINARÁ '),
          bold('"LA INMOBILIARIA"'),
          bold(', Y POR LA OTRA LA C. '),
          bold(d.nombre_propietario),
          bold(' CON DOMICILIO EN '),
          bold(d.domicilio_propietario),
          bold(', TELÉFONO '),
          bold(d.telefono_propietario),
          bold(', QUIEN EN LO SUCESIVO SE DENOMINARÁ '),
          bold('"EL PROPIETARIO"'),
          bold(', CON RESPECTO AL INMUEBLE UBICADO EN '),
          bold(d.direccion_inmueble),
          bold(', A QUIEN EN LO SUCESIVO SE DENOMINARÁ '),
          bold('"EL INMUEBLE"'),
          bold(', SE SUJETAN A LAS SIGUIENTES DECLARACIONES Y CLÁUSULAS:'),
        ]),

        espacio(),
        para([bold('DECLARACIONES:')]),
        espacio(),

        para([
          bold('PRIMERA. '),
          normal('Declara '),
          bold('"LA INMOBILIARIA"'),
          normal(' ser una persona moral debidamente constituida bajo las leyes mexicanas, dedicada a la actividad inmobiliaria, con R.F.C. '),
          bold('GIN191025L80'),
          normal('.'),
        ]),

        para([
          bold('SEGUNDA. '),
          normal('Declara '),
          bold('"EL PROPIETARIO"'),
          normal(' ser legítimo dueño de '),
          bold('"EL INMUEBLE"'),
          normal(' ubicado en '),
          bold(d.direccion_inmueble),
          normal('.'),
        ]),

        espacio(),
        para([bold('CLÁUSULAS:')]),
        espacio(),
        para([bold('SERVICIOS')]),
        espacio(),

        para([
          bold('PRIMERA.-'),
          normal(' El objeto del presente contrato es la prestación de los siguientes servicios:'),
        ]),

        para([
          bold('1. Asesoría: '),
          bold('"LA INMOBILIARIA"'),
          normal(' analizará '),
          bold('"EL INMUEBLE"'),
          normal(' para determinar su valor en el mercado y la forma más adecuada para rentarlo, tomando en consideración sus características físicas y de ubicación. '),
          bold('"LA INMOBILIARIA"'),
          normal(' orientará a '),
          bold('"EL PROPIETARIO"'),
          normal(' en relación con los instrumentos jurídicos y fiscales necesarios para la operación, la integración de la documentación y la renta de '),
          bold('"EL INMUEBLE"'),
          normal('.'),
        ], { indent: { left: 720 } }),

        para([
          bold('2. Promoción: '),
          bold('"LA INMOBILIARIA"'),
          normal(' promoverá '),
          bold('"EL INMUEBLE"'),
          normal(' utilizando los medios de difusión que considere adecuados conforme a sus características. La promoción consistirá en publicidad en redes sociales, anuncios en clasificados digitales, bolsa inmobiliaria a través de la red EasyBroker, y la página web de la empresa con publicidad en sitios web relacionados con el giro inmobiliario.'),
        ], { indent: { left: 720 } }),

        para([
          bold('3. Gestión: '),
          bold('"LA INMOBILIARIA"'),
          normal(' recibirá, por cuenta y orden de '),
          bold('"EL PROPIETARIO"'),
          normal(', las propuestas y ofertas de renta de '),
          bold('"EL INMUEBLE"'),
          normal(' y las someterá a consideración de '),
          bold('"EL PROPIETARIO"'),
          normal('.'),
        ], { indent: { left: 720 } }),

        para([
          bold('4. Información: '),
          bold('"LA INMOBILIARIA"'),
          normal(' rendirá un informe mensual a '),
          bold('"EL PROPIETARIO"'),
          normal(' sobre los resultados de las labores realizadas.'),
        ], { indent: { left: 720 } }),

        para([
          bold('SEGUNDA.- '),
          bold('"EL PROPIETARIO"'),
          normal(' entregará a '),
          bold('"LA INMOBILIARIA"'),
          normal(' en el momento de la firma de este instrumento, copia del último recibo predial de '),
          bold('"EL INMUEBLE"'),
          normal('.'),
        ]),

        para([
          bold('TERCERA.- '),
          bold('"EL PROPIETARIO"'),
          normal(' manifiesta su intención de rentar '),
          bold('"EL INMUEBLE"'),
          normal(' por la cantidad de '),
          bold(`$${d.monto_renta} (${d.monto_renta_letra})`),
          normal(', '),
          bold('"LA INMOBILIARIA"'),
          normal(' estará obligada a presentar a '),
          bold('"EL PROPIETARIO"'),
          normal(' todas las ofertas que se reciban.'),
        ]),

        para([
          bold('CUARTA.-'),
          normal(' Durante la vigencia del presente contrato, '),
          bold('"LA INMOBILIARIA"'),
          normal(' tendrá el carácter de exclusiva para la intermediación de la operación de renta de '),
          bold('"EL INMUEBLE"'),
          normal('.'),
        ]),

        espacio(),
        para([bold('HONORARIOS')]),
        espacio(),

        para([
          bold('QUINTA.-'),
          normal(' Las partes acuerdan que '),
          bold('"LA INMOBILIARIA"'),
          normal(' cobrará como honorarios por los servicios prestados el equivalente a un mes de renta sobre el valor final de la operación.'),
        ]),

        para([
          bold('SEXTA.-'),
          normal(' En caso de que '),
          bold('"EL PROPIETARIO"'),
          normal(', por razones imputables a él, rechace una oferta de renta al precio indicado en este instrumento con la intención de aumentarlo sin previo aviso por escrito a '),
          bold('"LA INMOBILIARIA"'),
          normal(', '),
          bold('"EL PROPIETARIO"'),
          normal(' se obliga a pagar el 100% de los honorarios pactados, calculados sobre la base del precio de renta señalado originalmente. Asimismo, '),
          bold('"EL PROPIETARIO"'),
          normal(' se obliga a trabajar mediante una póliza de arrendamiento con la empresa que '),
          bold('"LA INMOBILIARIA"'),
          normal(' designe, la cual deberá ser aceptada por '),
          bold('"EL PROPIETARIO"'),
          normal(' y pagada por el posible arrendatario. '),
          bold('"EL PROPIETARIO"'),
          normal(' deberá aceptar al cliente que haya sido debidamente calificado y aprobado por el despacho de póliza. En caso de que '),
          bold('"EL PROPIETARIO"'),
          normal(' rechace al cliente aprobado o decida rentar por su cuenta dentro del plazo del presente contrato, '),
          bold('"EL PROPIETARIO"'),
          normal(' deberá pagar a '),
          bold('"LA INMOBILIARIA"'),
          normal(' el 100% de la comisión pactada por la renta de '),
          bold('"EL INMUEBLE"'),
          normal('.'),
        ]),

        para([
          bold('SÉPTIMA.-'),
          normal(' La duración del presente contrato será de 60 días naturales, forzosos para ambas partes iniciando el dia '),
          bold(d.fecha_inicio),
          normal('.'),
        ]),

        espacio(),
        para([bold('CLÁUSULAS ADICIONALES')]),
        espacio(),

        para([
          bold('OCTAVA.-'),
          normal(' Las partes que intervienen en el presente contrato acuerdan someterse para la interpretación y cumplimiento del mismo a la jurisdicción de los tribunales de la ciudad de Puebla, renunciando expresamente al fuero de su domicilio presente o futuro.'),
        ]),

        para([
          bold('NOVENA.-'),
          normal(' Las partes señalan como domicilio para recibir notificaciones, emplazamientos o cualquier otro efecto legal, los mencionados en este instrumento.'),
        ]),

        espacio(),
        para([normal('Las partes manifiestan haber leído en su integridad este contrato, estar conformes con su contenido y tener plena capacidad jurídica para comprometerse.')]),
        espacio(),
        para([
          normal('Leído por las partes, el presente contrato se firma de conformidad y por duplicado en la ciudad de Puebla el día '),
          bold(d.fecha_firma),
          normal(', en todas y cada una de las hojas que lo integran.'),
        ]),
        espacio(), espacio(), espacio(),
        firmaTable(),
      ]
    }]
  })

  const buffer = await Packer.toBlob(doc)
  const url = URL.createObjectURL(buffer)
  const a = document.createElement('a')
  a.href = url
  a.download = `Contrato_Promocion_${d.nombre_propietario.replace(/\s+/g, '_')}.docx`
  a.click()
  URL.revokeObjectURL(url)
}
