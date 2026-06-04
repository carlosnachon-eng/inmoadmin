// lib/generarPromesaCompraventa.js
// Contrato de Promesa de Compra-Venta
// Soporta: INFONAVIT, crédito bancario, contado
// Hasta 3 pagos (pago 1 y 2 en efectivo, pago 3 con crédito o contado)

export async function generarPromesaCompraventa(data) {
  const {
    Document, Packer, Paragraph, TextRun,
    AlignmentType, BorderStyle, WidthType, Table, TableRow, TableCell,
  } = await import('docx')

  const hoy = new Date()
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  const fechaHoy = `${hoy.getDate()} de ${meses[hoy.getMonth()]} de ${hoy.getFullYear()}`

  const fmt = (n) => n ? `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : '$0.00'

  const bold   = (text, size = 20) => new TextRun({ text: String(text ?? ''), bold: true,   size, font: 'Arial' })
  const normal = (text, size = 20) => new TextRun({ text: String(text ?? ''),                size, font: 'Arial' })
  const italic = (text, size = 20) => new TextRun({ text: String(text ?? ''), italics: true, size, font: 'Arial' })

  const para = (children, opts = {}) => new Paragraph({
    children: Array.isArray(children) ? children : [children],
    spacing: { before: 120, after: 120 },
    alignment: AlignmentType.JUSTIFIED,
    ...opts,
  })
  const espacio = () => new Paragraph({ children: [new TextRun({ text: '', size: 20 })], spacing: { before: 60, after: 60 } })

  const noBorder  = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }

  // ── Género ──────────────────────────────────────────────────────────────
  const sexoV = data.curp_vendedor && data.curp_vendedor.length >= 11 ? (data.curp_vendedor[9].toUpperCase() === "M" ? "mujer" : "hombre") : "hombre"
  const sexoC = data.curp_comprador && data.curp_comprador.length >= 11 ? (data.curp_comprador[9].toUpperCase() === "M" ? "mujer" : "hombre") : "hombre"

  const elLaV     = sexoV === 'mujer' ? 'la C.' : 'el C.'
  const elLaC     = sexoC === 'mujer' ? 'la C.' : 'el C.'
  const senorV    = sexoV === 'mujer' ? 'La señora' : 'El señor'
  const senorC    = sexoC === 'mujer' ? 'La señora' : 'El señor'
  const mexicanoV = sexoV === 'mujer' ? 'mexicana' : 'mexicano'
  const mexicanoC = sexoC === 'mujer' ? 'mexicana' : 'mexicano'
  const declaraV  = sexoV === 'mujer' ? 'declara ser' : 'declara ser'

  // ── Tipo de crédito ─────────────────────────────────────────────────────
  const tipo = (data.tipo_credito || 'contado').toLowerCase()
  const banco = data.nombre_banco || ''
  const nombreCredito = tipo === 'infonavit' ? 'INFONAVIT'
                      : tipo === 'bancario'  ? (banco ? banco.toUpperCase() : 'LA INSTITUCIÓN BANCARIA')
                      : null

  // ── Datos ───────────────────────────────────────────────────────────────
  const d = {
    nombre_vendedor:       data.nombre_vendedor || data.nombre_propietario || '',
    curp_vendedor:         data.curp_vendedor || '',
    rfc_vendedor:          data.rfc_vendedor || '',
    credencial_vendedor:   data.credencial_vendedor || '',
    domicilio_vendedor:    data.domicilio_vendedor || data.domicilio_propietario || '',
    nombre_comprador:      data.nombre_comprador || '',
    curp_comprador:        data.curp_comprador || '',
    rfc_comprador:         data.rfc_comprador || '',
    credencial_comprador:  data.credencial_comprador || '',
    domicilio_comprador:   data.domicilio_comprador || '',
    direccion_inmueble:    data.direccion_inmueble || '',
    superficie:            data.superficie || '',
    volumen_escritura:     data.volumen_escritura || '',
    instrumento_escritura: data.instrumento_escritura || '',
    fecha_escritura:       data.fecha_escritura || '',
    notario:               data.notario || '',
    notaria:               data.notaria || '',
    cuenta_predial:        data.cuenta_predial || '',
    precio_total:          fmt(data.precio_total || data.precio_venta || 0),
    precio_total_letras:   data.precio_total_letras || '',
    pago1_monto:           fmt(data.pago1_monto || data.anticipo || 0),
    pago1_letras:          data.pago1_letras || data.anticipo_letras || '',
    pago1_fecha:           data.pago1_fecha || data.fecha_anticipo || fechaHoy,
    pago2_monto:           data.pago2_monto ? fmt(data.pago2_monto) : null,
    pago2_letras:          data.pago2_letras || '',
    pago2_fecha:           data.pago2_fecha || '',
    pago3_monto:           fmt(data.pago3_monto || data.resto || 0),
    pago3_letras:          data.pago3_letras || data.resto_letras || '',
    pago3_fecha:           data.pago3_fecha || data.fecha_limite || '',
    pena_convencional:     fmt(data.pena_convencional || 100000),
    pena_letras:           data.pena_letras || 'CIEN MIL PESOS 00/100 M.N.',
    gravamen:              data.gravamen || '',
    fecha_firma:           data.fecha_firma || fechaHoy,
  }

  // Formatear fecha pago1 legible si viene como YYYY-MM-DD
  const formatearFecha = (f) => {
    if (!f) return '_______________'
    if (/^\d{4}-\d{2}-\d{2}$/.test(f)) {
      const [y, m, dd] = f.split('-')
      return `${parseInt(dd)} DE ${meses[parseInt(m) - 1].toUpperCase()} DE ${y}`
    }
    return f.toUpperCase()
  }

  // ── Tabla de firmas ─────────────────────────────────────────────────────
  const firmaTable = () => new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [4680, 4680],
    borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideH: noBorder, insideV: noBorder },
    rows: [new TableRow({ children: [
      new TableCell({ borders: noBorders, width: { size: 4680, type: WidthType.DXA }, children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [bold('"EL PROMITENTE VENDEDOR"')] }),
        espacio(), espacio(), espacio(),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '_________________________________', size: 20, font: 'Arial' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [bold(d.nombre_vendedor.toUpperCase())] }),
      ]}),
      new TableCell({ borders: noBorders, width: { size: 4680, type: WidthType.DXA }, children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [bold('"EL PROMITENTE COMPRADOR"')] }),
        espacio(), espacio(), espacio(),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '_________________________________', size: 20, font: 'Arial' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [bold(d.nombre_comprador.toUpperCase())] }),
      ]}),
    ]})],
  })

  // ── Párrafos pago 3 según tipo ──────────────────────────────────────────
  const letraPago2 = d.pago2_monto ? 'c)' : 'b)'

  const parrafosPago3 = () => {
    if (tipo === 'contado') {
      return [
        para([
          bold(`${letraPago2} `),
          normal('El resto del precio, es decir, la cantidad de '),
          bold(d.pago3_monto),
          d.pago3_letras ? bold(` (${d.pago3_letras.toUpperCase()})`) : normal(''),
          normal(', será cubierto en una sola exhibición a más tardar el día '),
          bold(formatearFecha(d.pago3_fecha)),
          normal(', mediante transferencia bancaria o cualquier otro medio de pago que acuerden las partes.'),
        ], { indent: { left: 360 } }),
        espacio(),
      ]
    }
    return [
      para([
        bold(`${letraPago2} `),
        normal('El resto del precio, es decir, la cantidad de '),
        bold(d.pago3_monto),
        d.pago3_letras ? bold(` (${d.pago3_letras.toUpperCase()})`) : normal(''),
        normal(', correspondiente al crédito otorgado por '),
        bold(nombreCredito),
        normal(', será cubierto a más tardar el día '),
        bold(formatearFecha(d.pago3_fecha)),
        normal('.'),
      ], { indent: { left: 360 } }),
      espacio(),
      para([
        normal('No obstante lo anterior, ambas partes reconocen que dicho pago se encuentra sujeto a los tiempos, procesos y autorización de '),
        bold(nombreCredito),
        normal(', por lo que, en caso de presentarse cualquier retraso no imputable al Promitente Comprador, el plazo señalado se entenderá prorrogado automáticamente hasta la fecha en que '),
        bold(nombreCredito),
        normal(' libere los recursos correspondientes, sin que ello constituya incumplimiento o genere penalización alguna para el Promitente Comprador.'),
      ]),
      espacio(),
    ]
  }

  // ── Tercera según tipo ──────────────────────────────────────────────────
  const parrafosTerc = () => {
    if (tipo === 'contado') {
      return [
        para([
          bold('Tercera.- '),
          normal('Convienen las partes fijar como fecha límite para la formalización de la escritura definitiva el día '),
          bold(formatearFecha(d.pago3_fecha)),
          normal(', una vez que se haya cubierto la totalidad del precio pactado.'),
        ]),
        espacio(),
        para([normal('Las partes se obligan a actuar de buena fe y a realizar todas las gestiones necesarias para la conclusión de la operación.')]),
        espacio(),
      ]
    }
    return [
      para([
        bold('Tercera.- '),
        normal('Convienen las partes fijar como fecha límite tentativa para la formalización de la escritura definitiva el día '),
        bold(formatearFecha(d.pago3_fecha)),
        normal('; sin embargo, ambas partes acuerdan que dicho plazo podrá ajustarse conforme a los tiempos y procesos establecidos por '),
        bold(nombreCredito),
        normal(' para la autorización y liberación del crédito.'),
      ]),
      espacio(),
      para([
        normal('El Promitente Comprador se obliga a entregar en tiempo y forma la documentación requerida; no obstante, no será considerado incumplimiento ni dará lugar a penalización alguna cualquier retraso derivado de procesos internos de '),
        bold(nombreCredito),
        normal('.'),
      ]),
      espacio(),
      para([normal('Las partes se obligan a actuar de buena fe y a realizar todas las gestiones necesarias para la conclusión de la operación.')]),
      espacio(),
    ]
  }

  // ── Séptima — gravamen ──────────────────────────────────────────────────
  const parrafosGravamen = () => {
    if (d.gravamen) {
      return [
        para([
          bold('Séptima.- '),
          normal('El Promitente Vendedor manifiesta '),
          italic('"bajo protesta de decir verdad"'),
          normal(` que el inmueble objeto del presente contrato se encuentra actualmente gravado con ${d.gravamen}, obligándose expresamente a liquidar en su totalidad dicho crédito, así como a gestionar y entregar la correspondiente carta de liberación de gravamen, siendo este un requisito indispensable previo a la formalización de la escritura definitiva.`),
        ]),
        espacio(),
        para([
          normal('Asimismo, las partes acuerdan que la liberación del gravamen será condición indispensable para la firma de la escritura definitiva, por lo que en ningún caso podrá formalizarse la compraventa sin que el inmueble se encuentre libre de gravámenes.'),
        ]),
        espacio(),
      ]
    }
    return [
      para([
        bold('Séptima.- '),
        normal('El Promitente Vendedor manifiesta '),
        italic('"bajo protesta de decir verdad"'),
        normal(' que el inmueble objeto del presente contrato se encuentra libre de gravámenes, hipotecas o cualquier carga real, y se compromete a mantenerlo en dicha condición hasta la formalización de la escritura definitiva.'),
      ]),
      espacio(),
    ]
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1800, right: 1440, bottom: 1800, left: 1440 }
        }
      },
      children: [

        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 200 },
          children: [new TextRun({ text: 'CONTRATO DE PROMESA DE COMPRA-VENTA', bold: true, underline: {}, size: 22, font: 'Arial' })],
        }),

        para([
          normal('Que celebra '),
          bold(elLaV + ' '),
          bold(d.nombre_vendedor.toUpperCase()),
          normal(', a quien se le denominará en lo sucesivo como el '),
          bold('"PROMITENTE VENDEDOR"'),
          normal(' y por otra parte '),
          bold(elLaC + ' '),
          bold(d.nombre_comprador.toUpperCase()),
          normal(', quien para los efectos de este contrato se denominará '),
          bold('"EL PROMITENTE COMPRADOR"'),
          normal('; respecto del bien inmueble ubicado en '),
          bold(d.direccion_inmueble.toUpperCase()),
          normal(', que en lo sucesivo será denominado '),
          bold('"EL INMUEBLE"'),
          normal('; y quienes '),
          italic('"Bajo Protesta de Decir Verdad"'),
          normal('; manifiestan:'),
        ]),
        espacio(),

        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 100, after: 100 }, children: [new TextRun({ text: 'D E C L A R A C I O N E S', bold: true, underline: {}, size: 20, font: 'Arial' })] }),
        espacio(),

        para([
          bold('1.- '),
          normal(`${senorV} `),
          bold(d.nombre_vendedor.toUpperCase()),
          normal(`, ${declaraV} ${mexicanoV} por nacimiento`),
          d.curp_vendedor       ? normal(`, Clave Única de Registro de Población ${d.curp_vendedor}`) : normal(''),
          d.rfc_vendedor        ? normal(` y Registro Federal de Contribuyentes ${d.rfc_vendedor}`) : normal(''),
          d.credencial_vendedor ? normal(`, quien se identifica con su credencial de elector número ${d.credencial_vendedor}, expedida por el Instituto Nacional Electoral`) : normal(''),
          normal(', con domicilio en '),
          bold(d.domicilio_vendedor.toUpperCase()),
          normal('.'),
        ]),
        espacio(),

        para([
          bold('2.- '),
          normal(`${senorC} `),
          bold(d.nombre_comprador.toUpperCase()),
          normal(`, declara ser ${mexicanoC} por nacimiento`),
          d.curp_comprador       ? normal(`, Clave Única de Registro de Población ${d.curp_comprador}`) : normal(''),
          d.rfc_comprador        ? normal(` y Registro Federal de Contribuyentes ${d.rfc_comprador}`) : normal(''),
          d.credencial_comprador ? normal(`, quien se identifica con su credencial para votar número: ${d.credencial_comprador}, expedida por el Instituto Nacional Electoral`) : normal(''),
          normal(', con domicilio particular en: '),
          bold(d.domicilio_comprador.toUpperCase()),
          normal('.'),
        ]),
        espacio(),

        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 100, after: 100 }, children: [new TextRun({ text: 'A N T E C E D E N T E S', bold: true, underline: {}, size: 20, font: 'Arial' })] }),
        espacio(),

        para([
          bold('I.    De la Propiedad.- '),
          d.volumen_escritura     ? normal(`Mediante el VOLUMEN NÚMERO ${d.volumen_escritura.toUpperCase()}, `) : normal(''),
          d.instrumento_escritura ? normal(`INSTRUMENTO NÚMERO ${d.instrumento_escritura.toUpperCase()}, `) : normal(''),
          d.fecha_escritura       ? normal(`DE FECHA ${d.fecha_escritura.toUpperCase()}, `) : normal(''),
          d.notario               ? normal(`OTORGADO ANTE LA FE DEL ${d.notario.toUpperCase()}, `) : normal(''),
          d.notaria               ? normal(`${d.notaria.toUpperCase()}, `) : normal(''),
          normal('el hoy promitente vendedor, adquirió por compraventa '),
          bold(d.direccion_inmueble.toUpperCase()),
          d.superficie ? normal(`, la cual tiene una superficie de ${d.superficie.toUpperCase()}`) : normal(''),
          normal('.'),
        ], { indent: { left: 360 } }),
        espacio(),

        para([
          bold('II.   '),
          normal('Que el inmueble objeto de este contrato viene cubriendo su impuesto predial'),
          d.cuenta_predial ? normal(` con el número de cuenta ${d.cuenta_predial}`) : normal(''),
          normal(', de lo que también toma conocimiento en éste acto '),
          bold('"El Promitente Comprador"'),
          normal(' manifestando así su acuerdo en continuar con la celebración de éste contrato; comprometiéndose ambas partes a exhibir la Constancia de no adeudo respectiva por el citado servicio; Documento indispensable para la realización de todos los trámites correspondientes a la escrituración y finalmente poder inscribir el testimonio respectivo ante el Registro Público de la Propiedad correspondiente.'),
        ], { indent: { left: 360 } }),
        espacio(),

        para([normal('Expuesto lo anterior las partes otorgan las siguientes:')]),
        espacio(),

        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 100, after: 100 }, children: [new TextRun({ text: 'C L A U S U L A S', bold: true, underline: {}, size: 20, font: 'Arial' })] }),
        espacio(),

        // PRIMERA
        para([
          bold('Primera.- '),
          italic('"El Promitente Vendedor"'),
          normal(', '),
          bold('promete vender'),
          normal(' en favor de '),
          italic('"El Promitente Comprador"'),
          normal(' quien '),
          bold('promete comprar'),
          normal(' para sí, dentro del término que más adelante se señala, el inmueble identificado como:'),
        ]),
        espacio(),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 100, after: 100 }, children: [bold(d.direccion_inmueble.toUpperCase())] }),
        espacio(),

        // SEGUNDA
        para([
          bold('Segunda.- '),
          normal('Convienen fijar como precio de '),
          italic('"El Inmueble"'),
          normal('; la cantidad de '),
          bold(d.precio_total),
          d.precio_total_letras ? bold(` (${d.precio_total_letras.toUpperCase()})`) : normal(''),
        ]),
        espacio(),
        para([normal('Cantidad que se recibe de la siguiente manera:')]),
        espacio(),

        // Pago 1
        para([
          bold('a) '),
          normal('Un primer monto se hará en calidad de garantía por la cantidad de '),
          bold(d.pago1_monto),
          d.pago1_letras ? bold(` (${d.pago1_letras.toUpperCase()})`) : normal(''),
          normal(', que se entregarán el día '),
          bold(formatearFecha(d.pago1_fecha)),
          normal('.'),
        ], { indent: { left: 360 } }),
        espacio(),
        para([
          normal('Para el caso de cancelación o incumplimiento del presente contrato por cualquiera de las partes, el Promitente Vendedor deberá devolver al Promitente Comprador la totalidad de las cantidades recibidas dentro de un plazo no mayor a 15 (quince) días naturales. En caso de que la cancelación sea imputable al Promitente Comprador, se aplicará la pena convencional establecida en la cláusula CUARTA, pudiendo el Promitente Vendedor retener únicamente el monto correspondiente a dicha pena.'),
        ], { indent: { left: 360 } }),
        espacio(),
        para([
          normal('En caso de que el Promitente Vendedor no realice la devolución dentro del plazo establecido, la cantidad adeudada generará un interés moratorio del 1.5% (uno punto cinco por ciento) mensual sobre saldos insolutos, hasta su total liquidación.'),
        ], { indent: { left: 360 } }),
        espacio(),
        para([normal('Cantidad que se recibe y en esa inteligencia, el Promitente Vendedor mediante este instrumento, otorga el recibo más amplio que en derecho proceda.')], { indent: { left: 360 } }),
        espacio(),

        // Pago 2 (opcional)
        ...(d.pago2_monto ? [
          para([
            bold('b) '),
            normal('Un segundo monto en efectivo por la cantidad de '),
            bold(d.pago2_monto),
            d.pago2_letras ? bold(` (${d.pago2_letras.toUpperCase()})`) : normal(''),
            normal(', que se entregarán el día '),
            bold(formatearFecha(d.pago2_fecha)),
            normal('.'),
          ], { indent: { left: 360 } }),
          espacio(),
        ] : []),

        // Pago 3
        ...parrafosPago3(),

        // TERCERA
        ...parrafosTerc(),

        // CUARTA
        para([
          bold('Cuarta.- '),
          normal('Las partes contratantes convienen fijar como '),
          bold('pena convencional'),
          normal(' para el caso de desistimiento o incumplimiento de lo pactado en la presente promesa de compraventa, '),
          bold(`la cantidad de ${d.pena_convencional} (${d.pena_letras})`),
          normal(', a cargo de quien dé lugar a tal situación.'),
        ]),
        espacio(),
        para([
          normal('La pena establecida, deberá ser cubierta por la parte que corresponda, '),
          bold('dentro de los quince días naturales'),
          normal(' siguientes al hecho generador, en el domicilio que la contraparte haya señalado en el presente contrato, para el caso de no hacerlo en tiempo y forma, dicho monto causará un interés moratorio del 1.5% (uno punto cinco por ciento) mensual sobre saldos insolutos, hasta la total liquidación del monto adeudado.'),
        ]),
        espacio(),

        // QUINTA
        para([
          bold('Quinta.- '),
          italic('"El Promitente Vendedor"'),
          normal(' se compromete a firmar la escritura pública correspondiente en favor de '),
          italic('"El Promitente Comprador"'),
          normal(', en el momento que sea liquidado el precio fijado por las partes y una vez que se cumpla lo pactado en el presente contrato.'),
        ]),
        espacio(),

        // SEXTA
        para([
          bold('Sexta.- '),
          normal('Los contratantes están conscientes del alcance legal de este contrato y enteradas del contenido en las disposiciones legales, aceptan el mismo y convienen, que el precio fijado es el justo y legítimo valor del "inmueble" y que en este contrato no media lesión, dolo, error, mala fe o circunstancia que pudiera viciar el consentimiento, de conformidad con lo que expresa para tal efecto el Código Civil para Estado de Puebla.'),
        ]),
        espacio(),

        // SÉPTIMA
        ...parrafosGravamen(),

        // OCTAVA
        para([
          bold('Octava.- '),
          normal('El Promitente Vendedor otorgará al Promitente Comprador la posesión física del inmueble al momento de la firma de la escritura definitiva, obligándose previamente a:'),
        ]),
        espacio(),
        para([bold('a) '), normal('Entregar el inmueble libre de adeudos por concepto de impuesto predial, agua, energía eléctrica, gas y cualquier otro servicio.')], { indent: { left: 360 } }),
        espacio(),

        // NOVENA
        para([
          bold('Novena.- '),
          normal('Para todo lo referente a este contrato son aplicables las leyes de la ciudad de Puebla y competentes los tribunales de esta, renunciando expresamente las partes a cualquier otro fuero que en razón de su domicilio presente o futuro les pudiera corresponder.'),
        ]),
        espacio(),

        // DÉCIMA
        para([
          bold('Décima.- '),
          normal('Convienen que los impuestos y derechos correspondientes de la escrituración definitiva serán a cargo de '),
          bold('"EL PROMITENTE COMPRADOR"'),
          normal(' y el impuesto sobre la renta, a cargo de '),
          bold('"EL PROMITENTE VENDEDOR"'),
          normal('.'),
        ]),
        espacio(),

        para([
          normal('Que habiendo leído y comprendido el contenido del presente contrato y enteradas las partes del valor y fuerza legales del mismo; expresan su conformidad, firmando el día '),
          bold(d.fecha_firma),
          normal('.'),
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
  a.download = `Promesa_Compraventa_${(d.nombre_vendedor || 'vendedor').replace(/\s+/g, '_')}.docx`
  a.click()
  URL.revokeObjectURL(url)
}
