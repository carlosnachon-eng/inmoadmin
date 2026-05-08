// lib/generarContratoPromocion.js
// Contrato de Prestación de Servicios de Mediación para Compraventa

export async function generarContratoPromocion(data) {
  const {
    Document, Packer, Paragraph, TextRun,
    AlignmentType, BorderStyle, WidthType, Table, TableRow, TableCell,
  } = await import('docx')

  const hoy = new Date()
  const mesesMay = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE']
  const meses    = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  const fechaHoy    = `${hoy.getDate()} de ${meses[hoy.getMonth()]} de ${hoy.getFullYear()}`
  const fechaHoyMay = `${hoy.getDate()} de ${mesesMay[hoy.getMonth()]} de ${hoy.getFullYear()}`

  const fmt = (n) => n ? `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : '$0.00'

  const bold   = (text, size = 20) => new TextRun({ text: String(text ?? ''), bold: true,  size, font: 'Arial' })
  const normal = (text, size = 20) => new TextRun({ text: String(text ?? ''),               size, font: 'Arial' })

  const para = (children, opts = {}) => new Paragraph({
    children: Array.isArray(children) ? children : [children],
    spacing: { before: 100, after: 100 },
    alignment: AlignmentType.JUSTIFIED,
    ...opts,
  })
  const espacio = () => new Paragraph({ children: [new TextRun({ text: '', size: 20 })], spacing: { before: 60, after: 60 } })

  const noBorder  = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }

  const d = {
    nombre_propietario:    data.nombre_arrendador || data.nombre_propietario || '',
    domicilio_propietario: data.domicilio_arrendador || data.domicilio_propietario || '',
    telefono_propietario:  data.telefono_arrendador || data.telefono_propietario || '',
    direccion_inmueble:    data.direccion_inmueble || '',
    precio_venta:          fmt(data.precio_venta || data.precio),
    fecha_firma:           fechaHoy,
    fecha_firma_may:       fechaHoyMay,
  }

  // Precio en letras (básico — se puede ampliar)
  const precioValor = Number(data.precio_venta || data.precio || 0)
  const precioLetras = data.precio_letras || ''

  const firmaTable = () => new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [4680, 4680],
    borders: {
      top: noBorder, bottom: noBorder, left: noBorder, right: noBorder,
      insideH: noBorder, insideV: noBorder,
    },
    rows: [new TableRow({ children: [
      new TableCell({ borders: noBorders, width: { size: 4680, type: WidthType.DXA }, children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '_______________________________________________________________________________', size: 20, font: 'Arial' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [bold(d.nombre_propietario)] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [bold('"EL PROPIETARIO"')] }),
      ]}),
      new TableCell({ borders: noBorders, width: { size: 4680, type: WidthType.DXA }, children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '___________________________________________', size: 20, font: 'Arial' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [bold('GRUPO INMOBILIARIO NACHON TORRES S.A. DE C.V.')] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [normal('REPRESENTADO POR SU ADMINISTRADOR ÚNICO')] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [bold('CARLOS ALEJANDRO NACHON SALDIVAR')] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [bold('"LA INMOBILIARIA"')] }),
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

        // ── ENCABEZADO ──────────────────────────────────────────────────────
        para([
          bold('CONTRATO DE PRESTACIÓN DE SERVICIOS DE MEDIACIÓN PARA LA COMPRA VENTA DE INMUEBLE '),
          bold('QUE CELEBRAN POR UNA PARTE '),
          bold('GRUPO INMOBILIARIO NACHON TORRES S.A. DE C.V. REPRESENTADO POR SU ADMINISTRADOR ÚNICO EL SR. CARLOS ALEJANDRO NACHON SALDIVAR '),
          bold('CON DOMICILIO EN 5TO RETORNO DE OSA MENOR 2ª RESERVA TERRITORIAL ATLIXCAYOTL, SAN ANDRES CHOLULA, '),
          bold('PUEBLA, C.P. 72830, TELÉFONO 2222573237 '),
          bold('QUE EN ADELANTE SE DENOMINARÁ '),
          bold('"LA INMOBILIARIA"'),
          bold(' Y POR LA OTRA '),
          bold(d.nombre_propietario.toUpperCase()),
          bold(', QUE EN ADELANTE SE DENOMINARÁ '),
          bold('"EL PROPIETARIO"'),
          bold(' CON DOMICILIO EN '),
          bold(d.domicilio_propietario.toUpperCase()),
          bold(', TELÉFONO '),
          bold(d.telefono_propietario),
          bold(', Y EL INMUEBLE UBICADO EN: '),
          bold(d.direccion_inmueble.toUpperCase()),
          bold(', QUE EN ADELANTE SE DENOMINARÁ '),
          bold('"EL INMUEBLE"'),
          bold(', QUIENES SE SUJETAN A LAS SIGUIENTES DECLARACIONES Y CLÁUSULAS:'),
        ]),

        espacio(),

        // ── DECLARACIONES ───────────────────────────────────────────────────
        para([bold('DECLARACIONES:')]),
        espacio(),

        para([
          bold('PRIMERA.- '),
          normal('DECLARA '),
          bold('"LA INMOBILIARIA"'),
          normal(' SER PERSONA MORAL DEBIDAMENTE CONSTITUIDA BAJO LAS LEYES MEXICANAS, DEDICADA A LA ACTIVIDAD INMOBILIARIA CON '),
          bold('R.F.C. GIN191025L80.'),
        ]),

        para([
          bold('SEGUNDA.- '),
          normal('DECLARA '),
          bold('"EL PROPIETARIO"'),
          normal(' SER LEGÍTIMO DUEÑO DEL INMUEBLE UBICADO EN '),
          bold('"'),
          bold(d.direccion_inmueble.toUpperCase()),
          bold('"'),
          normal('.'),
        ]),

        espacio(),

        // ── CLÁUSULAS ───────────────────────────────────────────────────────
        para([bold('CLÁUSULAS:')]),
        espacio(),
        para([bold('SERVICIOS')]),
        espacio(),

        para([
          bold('PRIMERA.- '),
          normal('EL OBJETO DEL PRESENTE CONTRATO ES LA PRESTACIÓN DE LOS SIGUIENTES SERVICIOS:'),
        ]),
        espacio(),

        para([
          bold('ASESORÍA.- '),
          bold('"LA INMOBILIARIA"'),
          normal(' ANALIZARÁ '),
          bold('"EL INMUEBLE"'),
          normal(' A FIN DE DETERMINAR SU VALOR EN EL MERCADO Y LA FORMA MÁS ADECUADA PARA ENAJENARLO TOMANDO EN CONSIDERACIÓN SUS CARACTERÍSTICAS FÍSICAS Y FISCALES.'),
        ]),
        espacio(),

        para([
          bold('"LA INMOBILIARIA"'),
          normal(' ORIENTARÁ A '),
          bold('"EL PROPIETARIO"'),
          normal(' EN RELACIÓN CON LOS INSTRUMENTOS JURÍDICOS Y FINANCIEROS NECESARIOS PARA EL MANEJO DE LA OPERACIÓN, LA INTEGRACIÓN DE LA DOCUMENTACIÓN Y LA VENTA DE '),
          bold('"EL INMUEBLE"'),
          normal('.'),
        ]),
        espacio(),

        para([
          bold('PROMOCIÓN.- '),
          bold('"LA INMOBILIARIA"'),
          normal(' PROMOVERÁ '),
          bold('"EL INMUEBLE"'),
          normal(' UTILIZANDO LOS MEDIOS DE DIFUSIÓN QUE CONSIDERE ADECUADOS CONFORME A SUS CARACTERÍSTICAS Y PROPORCIONARÁ INFORMACIÓN A LOS POSIBLES CLIENTES QUE LA SOLICITEN Y CONSISTIRÁ EN ANUNCIOS EN REDES SOCIALES, BOLSA INMOBILIARIA A TRAVÉS DE EASYBROKER, PÁGINA WEB DE LA EMPRESA CON PUBLICIDAD Y OTRAS PÁGINAS WEB RELACIONADAS CON EL GIRO INMOBILIARIO.'),
        ]),
        espacio(),

        para([
          bold('GESTIÓN.- '),
          bold('"LA INMOBILIARIA"'),
          normal(' RECIBIRÁ POR SU CUENTA Y ORDEN LAS PROPUESTAS Y OFERTAS DE VENTA DE '),
          bold('"EL INMUEBLE"'),
          normal(' Y LAS SOMETERÁ A '),
          bold('"EL PROPIETARIO"'),
          normal(' PARA SU CONSIDERACIÓN.'),
        ]),
        espacio(),

        para([
          normal('LOS IMPORTES DE DICHAS PROPUESTAS SERÁN ENTREGADAS A '),
          bold('"EL PROPIETARIO"'),
          normal(' EN EL MOMENTO DE SU ACEPTACIÓN.'),
        ]),
        espacio(),

        para([
          bold('INFORMACIÓN.- '),
          bold('"LA INMOBILIARIA"'),
          normal(' RENDIRÁ CADA '),
          bold('30'),
          normal(' DÍAS A '),
          bold('"EL PROPIETARIO"'),
          normal(' UN INFORME DE LOS RESULTADOS DE LAS LABORES QUE SE HAYAN REALIZADO.'),
        ]),
        espacio(),

        para([
          bold('SEGUNDA.- '),
          bold('"EL PROPIETARIO"'),
          normal(' ENTREGARÁ A '),
          bold('"LA INMOBILIARIA"'),
          normal(' EN EL MOMENTO DE LA FIRMA DE ESTE INSTRUMENTO COPIA DEL TÍTULO DE '),
          bold('"EL INMUEBLE"'),
          normal(' EN EL CUAL APAREZCAN LOS DATOS DEL REGISTRO PÚBLICO, BOLETA PREDIAL, BOLETA DE AGUA Y MANTENIMIENTO DE LA PROPIEDAD.'),
        ]),
        espacio(),

        para([
          bold('TERCERA.- '),
          bold('"EL PROPIETARIO"'),
          normal(' SEÑALA QUE ES SU INTENCIÓN DE VENDER '),
          bold('"EL INMUEBLE"'),
          normal(' EN LA CANTIDAD DE '),
          bold(d.precio_venta),
          precioLetras ? bold(` (${precioLetras.toUpperCase()})`) : normal(''),
          normal(', ESTANDO OBLIGADA '),
          bold('"LA INMOBILIARIA"'),
          normal(' A PASAR A LA CONSIDERACIÓN DEL MISMO TODAS LAS OFERTAS QUE SE LE PRESENTEN.'),
        ]),
        espacio(),

        para([
          bold('CUARTA.- '),
          normal('DURANTE LA VIGENCIA DEL PRESENTE CONTRATO '),
          bold('"LA INMOBILIARIA"'),
          normal(' TENDRÁ CARÁCTER DE EXCLUSIVA PARA LA INTERMEDIACIÓN DE LA OPERACIÓN DE VENTA DE '),
          bold('"EL INMUEBLE"'),
          normal('.'),
        ]),
        espacio(),

        // ── HONORARIOS ──────────────────────────────────────────────────────
        para([bold('HONORARIOS.')]),
        espacio(),

        para([
          bold('QUINTA.- '),
          normal('LAS PARTES CONTRATANTES CONVIENEN EN QUE '),
          bold('"LA INMOBILIARIA"'),
          normal(' COBRARÁ COMO HONORARIOS POR LOS SERVICIOS PRESTADOS '),
          bold('EL 5% DEL VALOR DE VENTA DEL INMUEBLE'),
          normal(' Y SERÁ PAGADA DE LA SIGUIENTE MANERA:'),
        ]),
        espacio(),

        para([
          bold('10%'),
          normal(' DE LA COMISIÓN AL MOMENTO DE LA FIRMA DEL CONTRATO DE PROMESA DE COMPRA VENTA.'),
        ], { indent: { left: 720 } }),

        para([
          bold('90%'),
          normal(' DE LA COMISIÓN AL MOMENTO DE LA FIRMA DE LA ESCRITURA DE COMPRAVENTA CORRESPONDIENTE.'),
        ], { indent: { left: 720 } }),
        espacio(),

        para([
          bold('SEXTA.- '),
          normal('EN CASO DE CANCELACIÓN POR PARTE DEL COMPRADOR U OFERTANTE UNA VEZ FIRMADO EL CONTRATO DE COMPRA VENTA, ACUERDAN LAS PARTES QUE '),
          bold('"LA INMOBILIARIA"'),
          normal(', RECIBIRÁ EL '),
          bold('10%'),
          normal(' DE LA CANTIDAD QUE SE MENCIONA EN LA CLÁUSULA QUINTA COMO HONORARIOS.'),
        ]),
        espacio(),

        para([
          bold('SÉPTIMA.- '),
          normal('CUANDO '),
          bold('"EL PROPIETARIO"'),
          normal(' POR RAZONES IMPUTABLES A ÉL, RECHACE UNA OFERTA DE VENTA EN EL PRECIO INDICADO EN ESTE INSTRUMENTO POR PRETENDER AUMENTARLO SIN PREVIO AVISO POR ESCRITO A '),
          bold('"LA INMOBILIARIA"'),
          normal(', '),
          bold('"EL PROPIETARIO"'),
          normal(' SE OBLIGA A PAGARLE EL '),
          bold('100%'),
          normal(' DE LOS HONORARIOS PACTADOS SOBRE LA BASE PARA SU CÁLCULO EL PRECIO DE VENTA SEÑALADO ORIGINALMENTE.'),
        ]),
        espacio(),

        para([
          bold('OCTAVA.- '),
          normal('LA DURACIÓN DEL PRESENTE CONTRATO SERÁ DE '),
          bold('90 DÍAS CALENDARIO'),
          normal(' FORZOSOS PARA AMBAS PARTES.'),
        ]),
        espacio(),

        // ── CLÁUSULAS ADICIONALES ────────────────────────────────────────────
        para([bold(' CLÁUSULAS ADICIONALES')]),
        espacio(),

        para([
          bold('NOVENA.- '),
          normal('LAS PARTES QUE INTERVIENEN EN EL PRESENTE CONTRATO CONVIENEN EN SOMETERSE PARA LA INTERPRETACIÓN Y CUMPLIMIENTO DEL MISMO A LA JURISDICCIÓN DE LOS TRIBUNALES DE ESTA CIUDAD RENUNCIANDO EXPRESAMENTE AL FUERO DE SU DOMICILIO PRESENTE O FUTURO.'),
        ]),
        espacio(),

        para([
          bold('DÉCIMA.- '),
          normal('LAS PARTES CONTRATANTES SEÑALAN COMO DOMICILIO PARA RECIBIR NOTIFICACIONES, EMPLAZAMIENTOS O CUALQUIER OTRO EFECTO LEGAL EL MENCIONADO EN ESTE INSTRUMENTO.'),
        ]),
        espacio(),

        para([
          normal('LAS PARTES MANIFIESTAN HABERLO LEÍDO EN SU INTEGRIDAD, ESTAR CONFORMES CON SU CONTENIDO Y TENER PLENA CAPACIDAD JURÍDICA PARA COMPROMETERSE.'),
        ]),
        espacio(),

        para([
          normal('LEÍDO POR LAS PARTES EL PRESENTE CONTRATO, LO FIRMAN DE CONFORMIDAD Y POR DUPLICADO EN LA CIUDAD DE PUEBLA EL DÍA '),
          bold(d.fecha_firma_may),
          normal(', EN TODAS Y CADA UNA DE LAS HOJAS QUE LO INTEGRAN.'),
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
