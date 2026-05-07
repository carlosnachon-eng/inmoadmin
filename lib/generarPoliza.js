// lib/generarPoliza.js
// Genera la póliza jurídica inmobiliaria en .docx

function fmtFecha(d) {
  if (!d) return '___/___/______'
  if (typeof d === 'string' && d.includes('/')) return d
  return new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fmtMonto(n) {
  return n ? `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : '$0.00'
}

export async function generarPolizaJuridica(exp) {
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    AlignmentType, BorderStyle, WidthType, ShadingType,
  } = await import('docx')

  const bold   = (text, size = 22) => new TextRun({ text: String(text ?? ''), bold: true, size, font: 'Arial' })
  const normal = (text, size = 22) => new TextRun({ text: String(text ?? ''), size, font: 'Arial' })
  const italic = (text, size = 20) => new TextRun({ text: String(text ?? ''), italics: true, size, font: 'Arial' })

  const para = (children, opts = {}) => new Paragraph({
    children: Array.isArray(children) ? children : [children],
    spacing: { before: 100, after: 100 },
    alignment: AlignmentType.JUSTIFIED,
    ...opts,
  })
  const centrado = (children, opts = {}) => new Paragraph({
    children: Array.isArray(children) ? children : [children],
    spacing: { before: 100, after: 100 },
    alignment: AlignmentType.CENTER,
    ...opts,
  })
  const espacio = (n = 1) => Array.from({ length: n }, () =>
    new Paragraph({ children: [new TextRun({ text: '', size: 22 })], spacing: { before: 60, after: 60 } })
  )
  const pageBreak = () => new Paragraph({ children: [new TextRun({ text: '', size: 22 })], pageBreakBefore: true })
  const divider = () => new Paragraph({
    children: [new TextRun({ text: '─'.repeat(60), size: 18, color: '888888' })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 80, after: 80 },
  })

  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }
  const lineBorder = { style: BorderStyle.SINGLE, size: 4, color: '000000' }

  const d = {
    nombre_arrendador:    exp.nombre_arrendador || '',
    domicilio_arrendador: exp.domicilio_arrendador || '',
    telefono_arrendador:  exp.telefono_arrendador || '',
    correo_arrendador:    exp.correo_arrendador || '',
    nombre_arrendatario:  exp.nombre_arrendatario || '',
    telefono_arrendatario:exp.telefono_arrendatario || '',
    correo_arrendatario:  exp.correo_arrendatario || '',
    direccion_inmueble:   exp.direccion_inmueble || '',
    ciudad_estado:        exp.ciudad_estado_inmueble || 'San Andrés Cholula, Puebla',
    renta:                fmtMonto(exp.renta_mensual),
    fecha_inicio:         fmtFecha(exp.fecha_inicio),
    fecha_termino: (() => {
      if (exp.fecha_termino) return fmtFecha(exp.fecha_termino)
      if (!exp.fecha_inicio) return '___/___/______'
      const fi = exp.fecha_inicio.includes('/')
        ? exp.fecha_inicio.split('/').reverse().join('-')
        : exp.fecha_inicio
      const d = new Date(fi + 'T12:00:00')
      d.setFullYear(d.getFullYear() + 1)
      d.setDate(d.getDate() - 1)
      return d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' })
    })(),
    fecha_firma:          fmtFecha(exp.fecha_firma),
  }

  // ── Fila de datos (para la carátula) ──────────────────────
  const filaCaratula = (etiqueta, valor) => new Paragraph({
    children: [bold(etiqueta + ' ', 22), normal(valor, 22)],
    spacing: { before: 80, after: 80 },
    indent: { left: 720 },
  })

  const clausula = (titulo, ...parrafos) => [
    ...espacio(1),
    para([bold(titulo)]),
    ...parrafos,
  ]

  const firmaTable = () => new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [4680, 4680],
    borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideH: noBorder, insideV: noBorder },
    rows: [
      new TableRow({ children: [
        new TableCell({ borders: noBorders, width: { size: 4680, type: WidthType.DXA }, children: [
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '_______________________________', size: 22, font: 'Arial' })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [bold('EMPORIO INMOBILIARIO')] }),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [normal('Carlos Alejandro Nachon Saldivar')] }),
        ]}),
        new TableCell({ borders: noBorders, width: { size: 4680, type: WidthType.DXA }, children: [
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '_______________________________', size: 22, font: 'Arial' })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [bold('EL PROPIETARIO')] }),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [normal(d.nombre_arrendador)] }),
        ]}),
      ]})
    ]
  })

  const children = [

    // ══════════════════════════════════════════════════════
    // CARÁTULA
    // ══════════════════════════════════════════════════════
    centrado([bold('PÓLIZA JURÍDICA INMOBILIARIA', 32)]),
    ...espacio(2),

    // Datos de la póliza
    centrado([bold('DATOS DE LA PÓLIZA', 24)]),
    ...espacio(1),
    filaCaratula('Tipo de movimiento:', 'Alta'),
    filaCaratula('Tipo de póliza:', 'Jurídica Inmobiliaria'),
    filaCaratula('Inicio de vigencia:', d.fecha_inicio),
    filaCaratula('Fin de vigencia:', d.fecha_termino),
    filaCaratula('Duración:', '12 meses'),
    filaCaratula('Forma de pago:', 'Cubierta por el arrendatario'),
    filaCaratula('Tipo de cobertura:', 'Desalojo y deslinde por Extinción de Dominio'),
    ...espacio(2),

    // Datos del propietario
    centrado([bold('DATOS DEL PROPIETARIO', 24)]),
    ...espacio(1),
    filaCaratula('Nombre:', d.nombre_arrendador),
    filaCaratula('Domicilio:', d.domicilio_arrendador),
    filaCaratula('Teléfono:', d.telefono_arrendador),
    filaCaratula('Correo electrónico:', d.correo_arrendador),
    ...espacio(2),

    // Datos del arrendatario
    centrado([bold('DATOS DEL ARRENDATARIO', 24)]),
    ...espacio(1),
    filaCaratula('Nombre:', d.nombre_arrendatario),
    filaCaratula('Teléfono:', d.telefono_arrendatario),
    filaCaratula('Correo electrónico:', d.correo_arrendatario),
    ...espacio(2),

    // Datos del inmueble
    centrado([bold('DATOS DEL INMUEBLE ARRENDADO', 24)]),
    ...espacio(1),
    filaCaratula('Domicilio completo del inmueble:', d.direccion_inmueble),
    filaCaratula('Municipio / Estado:', d.ciudad_estado),
    filaCaratula('Uso del inmueble:', 'Habitacional'),
    ...espacio(2),

    // Datos del contrato
    centrado([bold('DATOS DEL CONTRATO DE ARRENDAMIENTO', 24)]),
    ...espacio(1),
    filaCaratula('Fecha de firma:', d.fecha_firma),
    filaCaratula('Monto de renta mensual:', d.renta),
    ...espacio(2),

    // Observaciones
    centrado([bold('OBSERVACIONES IMPORTANTES', 24)]),
    ...espacio(1),
    para([
      normal('La presente póliza jurídica inmobiliaria '),
      bold('no garantiza el cumplimiento del arrendatario ni la recuperación de pagos'),
      normal(', y se limita a la '),
      bold('gestión jurídica preventiva, extrajudicial y, en su caso, judicial'),
      normal(', para la recuperación del inmueble y el deslinde de responsabilidades del propietario.'),
    ], { indent: { left: 720 } }),
    ...espacio(2),
    divider(),
    ...espacio(1),
    centrado([bold('EMPORIO INMOBILIARIO', 24)]),
    centrado([italic('Tu respaldo jurídico al momento de rentar')]),

    // ══════════════════════════════════════════════════════
    // CONTRATO DE PÓLIZA
    // ══════════════════════════════════════════════════════
    pageBreak(),
    centrado([bold('CONTRATO DE PRESTACIÓN DE SERVICIOS INMOBILIARIOS CON GESTIÓN JURÍDICA PREVENTIVA, EXTRAJUDICIAL Y CONTENCIOSA', 22)]),
    ...espacio(1),
    para([
      normal('QUE CELEBRAN, por una parte GRUPO INMOBILIARIO NACHON TORRES S.A. DE C.V. representado en este acto por su administrador único C. Carlos Alejandro Nachon Saldivar, a quien en lo sucesivo se le denominará '),
      bold('"EMPORIO INMOBILIARIO"'),
      normal(', y por la otra el C. '),
      bold(d.nombre_arrendador),
      normal(', a quien en lo sucesivo se le denominará '),
      bold('"EL PROPIETARIO"'),
      normal(', al tenor de las siguientes:'),
    ]),

    ...espacio(1),
    centrado([bold('DECLARACIONES', 22)]),
    ...espacio(1),

    para([bold('I. Declara EMPORIO INMOBILIARIO:')]),
    para([normal('a) Que es una sociedad legalmente constituida conforme a las leyes mexicanas.')]),
    para([normal('b) Que su objeto social comprende la prestación de servicios inmobiliarios, administración, arrendamiento, promoción, análisis y gestión de inmuebles.')]),
    para([normal('c) Que cuenta con personal interno y con el apoyo de despachos externos para brindar servicios de gestión jurídica inmobiliaria, sin ostentarse como despacho jurídico independiente.')]),

    ...espacio(1),
    para([bold('II. Declara EL PROPIETARIO:')]),
    para([
      normal('a) Que es legítimo propietario o cuenta con facultades suficientes sobre el inmueble ubicado en: '),
      bold(d.direccion_inmueble), normal('.'),
    ]),
    para([normal('b) Que desea contratar una póliza jurídica inmobiliaria anual.')]),
    para([normal('c) Que reconoce que la póliza no garantiza el cumplimiento del arrendatario, sino que brinda mecanismos de prevención, gestión extrajudicial y, en su caso, judicial para la recuperación del inmueble.')]),

    ...espacio(1),
    para([bold('III. Declaran ambas partes:')]),
    para([normal('a) Que se reconocen capacidad legal.')]),
    para([normal('b) Que es su voluntad celebrar el presente contrato.')]),

    ...espacio(1),
    centrado([bold('CLÁUSULAS', 22)]),

    ...clausula('PRIMERA. OBJETO DE LA PÓLIZA.',
      para([normal('EMPORIO INMOBILIARIO prestará a EL PROPIETARIO un servicio integral de póliza jurídica inmobiliaria que comprende investigación, análisis, dictamen, prevención y gestión jurídica.')]),
    ),
    ...clausula('SEGUNDA. NATURALEZA DEL SERVICIO.',
      para([normal('El presente contrato no constituye prestación de servicios legales independientes, sino un servicio inmobiliario con gestión jurídica. EMPORIO INMOBILIARIO no garantiza resultados judiciales ni recuperación económica alguna.')]),
    ),
    ...clausula('TERCERA. MANDATO Y REPRESENTACIÓN.',
      para([normal('EL PROPIETARIO otorga mandato suficiente a EMPORIO INMOBILIARIO para realizar gestiones extrajudiciales y judiciales relacionadas con el contrato de arrendamiento, incluyendo la contratación y coordinación de abogados externos para procedimientos de desalojo o deslinde por extinción de dominio.')]),
    ),
    ...clausula('CUARTA. GESTIÓN EXTRAJUDICIAL.',
      para([normal('Incluye requerimientos, comunicaciones, negociaciones controladas y convenios de entrega voluntaria del inmueble, sin constituir cobranza de rentas.')]),
    ),
    ...clausula('QUINTA. GESTIÓN JUDICIAL.',
      para([normal('EMPORIO INMOBILIARIO coordinará procedimientos judiciales de desalojo, lanzamiento y deslinde por extinción de dominio, a través de abogados externos.')]),
    ),
    ...clausula('SEXTA. NO RECUPERACIÓN DE RENTAS NI PAGOS.',
      para([normal('La póliza no incluye recuperación de rentas, pagos, indemnizaciones ni cobros económicos de ningún tipo.')]),
    ),
    ...clausula('SÉPTIMA. HONORARIOS Y GASTOS JUDICIALES.',
      para([normal('Los honorarios de abogados externos serán cubiertos por EMPORIO INMOBILIARIO.')]),
      para([normal('Los gastos judiciales y administrativos serán cubiertos por EL PROPIETARIO.')]),
    ),
    ...clausula('OCTAVA. VIGENCIA.',
      para([normal('DOCE (12) meses contados a partir de la firma del contrato de arrendamiento y entrega del inmueble.')]),
    ),
    ...clausula('NOVENA. HONORARIOS DE LA PÓLIZA.',
      para([normal('Cubiertos por EL ARRENDATARIO.')]),
    ),
    ...clausula('DÉCIMA. EXCLUSIONES.',
      para([normal('La póliza perderá vigencia si EL PROPIETARIO interviene abogados no autorizados, negocia directamente o incumple obligaciones.')]),
    ),
    ...clausula('DÉCIMA PRIMERA. CONFIDENCIALIDAD.',
      para([normal('Las partes acuerdan que toda la información, documentación y datos personales proporcionados con motivo de la contratación de la presente póliza jurídica inmobiliaria, así como los resultados de la investigación, análisis, dictamen y gestiones realizadas, tendrán el carácter de confidenciales.')]),
      para([normal('EMPORIO INMOBILIARIO se obliga a utilizar dicha información única y exclusivamente para los fines derivados del presente contrato, comprometiéndose a no divulgarla a terceros, salvo que sea requerida por autoridad competente o resulte necesaria para la correcta prestación de los servicios contratados.')]),
    ),
    ...clausula('DÉCIMA SEGUNDA. LIMITACIÓN DE RESPONSABILIDAD.',
      para([normal('EMPORIO INMOBILIARIO no será responsable por daños, perjuicios, pérdidas económicas, lucro cesante o cualquier otra afectación patrimonial que derive directa o indirectamente del incumplimiento del arrendatario, de la información falsa, incompleta u omitida proporcionada por éste, o de resoluciones emitidas por autoridades judiciales o administrativas.')]),
      para([normal('EL PROPIETARIO reconoce que la obligación de EMPORIO INMOBILIARIO se limita a la gestión jurídica preventiva, extrajudicial y, en su caso, judicial, en los términos expresamente establecidos en el presente contrato.')]),
    ),
    ...clausula('DÉCIMA TERCERA. CASO FORTUITO Y FUERZA MAYOR.',
      para([normal('Ninguna de las partes será responsable por el incumplimiento total o parcial de sus obligaciones cuando dicho incumplimiento sea consecuencia de caso fortuito o fuerza mayor, incluyendo de manera enunciativa mas no limitativa actos de autoridad, desastres naturales, fallas en sistemas judiciales o administrativos, huelgas o situaciones extraordinarias ajenas a su control.')]),
    ),
    ...clausula('DÉCIMA CUARTA. MODIFICACIONES.',
      para([normal('El presente contrato únicamente podrá ser modificado mediante convenio por escrito, firmado por ambas partes. Cualquier acuerdo verbal o práctica distinta a lo aquí estipulado carecerá de validez legal.')]),
    ),
    ...clausula('DÉCIMA QUINTA. TOTALIDAD DEL CONTRATO.',
      para([normal('El presente contrato constituye la totalidad del acuerdo entre las partes, dejando sin efecto cualquier otro acuerdo, convenio, comunicación o negociación previa, ya sea verbal o escrita, relacionada con el objeto del mismo.')]),
    ),
    ...clausula('DÉCIMA SEXTA. JURISDICCIÓN Y LEGISLACIÓN APLICABLE.',
      para([normal('Para la interpretación, cumplimiento y ejecución del presente contrato, las partes se someten expresamente a las leyes vigentes del Estado de Puebla y a la competencia de los tribunales del mismo, renunciando a cualquier otro fuero que pudiera corresponderles por razón de su domicilio presente o futuro.')]),
    ),

    ...espacio(1),
    para([
      normal('Leído que fue el presente contrato y enteradas las partes de su contenido y alcance legal, lo firman por duplicado en la ciudad de Puebla, Puebla, a '),
      bold(d.fecha_firma), normal('.'),
    ]),

    ...espacio(3),
    firmaTable(),
    ...espacio(2),
    divider(),
    centrado([bold('EMPORIO INMOBILIARIO | Póliza Jurídica Inmobiliaria', 18)]),
    centrado([italic('Documento confidencial – Uso exclusivo del propietario', 18)]),
  ]

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 22 } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 2268, right: 1134, bottom: 2268, left: 1134 }
        }
      },
      children,
    }]
  })

  const buffer = await Packer.toBlob(doc)
  const url = URL.createObjectURL(buffer)
  const a = document.createElement('a')
  a.href = url
  a.download = `Poliza_${d.nombre_arrendador.replace(/\s+/g, '_')}_${exp.fecha_firma || 'borrador'}.docx`
  a.click()
  URL.revokeObjectURL(url)
}
