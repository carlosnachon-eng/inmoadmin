// lib/generarPoliza.js
// Genera la póliza jurídica inmobiliaria en .docx — diseño mejorado para hoja membretada

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

  // ── Tipografía ──────────────────────────────────────────
  const FONT_TITULO  = 'Georgia'
  const FONT_CUERPO  = 'Arial'
  const COLOR_ROJO   = 'C8102E'
  const COLOR_GRIS   = '555555'
  const COLOR_NEGRO  = '1A1A1A'
  const COLOR_LINEA  = 'DDDDDD'

  const bold    = (text, size = 20, font = FONT_CUERPO, color = COLOR_NEGRO) =>
    new TextRun({ text: String(text ?? ''), bold: true, size, font, color })
  const normal  = (text, size = 18, font = FONT_CUERPO, color = COLOR_NEGRO) =>
    new TextRun({ text: String(text ?? ''), size, font, color })
  const italic  = (text, size = 16, font = FONT_CUERPO, color = COLOR_GRIS) =>
    new TextRun({ text: String(text ?? ''), italics: true, size, font, color })
  const rojo    = (text, size = 18) =>
    new TextRun({ text: String(text ?? ''), bold: true, size, font: FONT_CUERPO, color: COLOR_ROJO })

  const para = (children, opts = {}) => new Paragraph({
    children: Array.isArray(children) ? children : [children],
    spacing: { before: 40, after: 40 },
    alignment: AlignmentType.JUSTIFIED,
    ...opts,
  })
  const centrado = (children, opts = {}) => new Paragraph({
    children: Array.isArray(children) ? children : [children],
    spacing: { before: 40, after: 40 },
    alignment: AlignmentType.CENTER,
    ...opts,
  })
  const espacio = (n = 1) => Array.from({ length: n }, () =>
    new Paragraph({ children: [new TextRun({ text: '', size: 20 })], spacing: { before: 40, after: 40 } })
  )
  const pageBreak = () => new Paragraph({
    children: [new TextRun({ text: '', size: 20, break: 1 })],
    pageBreakBefore: true,
  })

  // Línea divisora elegante como borde inferior de párrafo
  const divider = (color = COLOR_LINEA) => new Paragraph({
    children: [new TextRun({ text: '', size: 4 })],
    spacing: { before: 120, after: 120 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 4, color, space: 1 },
    },
  })

  const dividerRojo = () => new Paragraph({
    children: [new TextRun({ text: '', size: 4 })],
    spacing: { before: 100, after: 100 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: COLOR_ROJO, space: 1 },
    },
  })

  const noBorder  = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }

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
      const fi = exp.fecha_inicio.includes('/') ? exp.fecha_inicio.split('/').reverse().join('-') : exp.fecha_inicio
      const dd = new Date(fi + 'T12:00:00'); dd.setFullYear(dd.getFullYear() + 1); dd.setDate(dd.getDate() - 1)
      return dd.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' })
    })(),
    fecha_firma: fmtFecha(exp.fecha_firma),
  }

  // ── Tabla de datos de carátula ─────────────────────────
  const filaDatos = (etiqueta, valor) => new TableRow({
    children: [
      new TableCell({
        borders: noBorders,
        width: { size: 3200, type: WidthType.DXA },
        margins: { top: 30, bottom: 30, left: 80, right: 80 },
        children: [new Paragraph({
          children: [bold(etiqueta, 16)],
          spacing: { before: 0, after: 0 },
        })],
      }),
      new TableCell({
        borders: noBorders,
        width: { size: 5800, type: WidthType.DXA },
        margins: { top: 30, bottom: 30, left: 80, right: 80 },
        children: [new Paragraph({
          children: [normal(valor || '—', 16)],
          spacing: { before: 0, after: 0 },
        })],
      }),
    ],
  })

  const seccionDatos = (titulo, filas) => [
    new Paragraph({ children: [new TextRun({ text: '', size: 12 })], spacing: { before: 20, after: 20 } }),
    new Paragraph({
      children: [rojo(titulo, 16)],
      spacing: { before: 60, after: 30 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR_ROJO, space: 2 } },
    }),
    new Table({
      width: { size: 9000, type: WidthType.DXA },
      columnWidths: [3200, 5800],
      borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideH: noBorder, insideV: noBorder },
      rows: filas.map(([etq, val]) => filaDatos(etq, val)),
    }),
  ]

  // ── Cláusulas ──────────────────────────────────────────
  const clausula = (titulo, ...parrafos) => [
    new Paragraph({ children: [new TextRun({ text: '', size: 12 })], spacing: { before: 30, after: 10 } }),
    new Paragraph({
      children: [bold(titulo, 20, FONT_CUERPO, COLOR_ROJO)],
      spacing: { before: 60, after: 30 },
    }),
    ...parrafos,
  ]

  // ── Tabla de firmas ────────────────────────────────────
  const firmaTable = () => new Table({
    width: { size: 9000, type: WidthType.DXA },
    columnWidths: [4500, 4500],
    borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideH: noBorder, insideV: noBorder },
    rows: [
      new TableRow({ children: [
        new TableCell({
          borders: noBorders,
          width: { size: 4500, type: WidthType.DXA },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR_NEGRO, space: 1 } },
              spacing: { before: 800, after: 80 },
              children: [new TextRun({ text: '', size: 20 })],
            }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [bold('EMPORIO INMOBILIARIO', 18)], spacing: { before: 40, after: 20 } }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [normal('Carlos Alejandro Nachon Saldivar', 18)], spacing: { before: 0, after: 0 } }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [italic('Administrador Único', 16)], spacing: { before: 0, after: 0 } }),
          ],
        }),
        new TableCell({
          borders: noBorders,
          width: { size: 4500, type: WidthType.DXA },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR_NEGRO, space: 1 } },
              spacing: { before: 800, after: 80 },
              children: [new TextRun({ text: '', size: 20 })],
            }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [bold('EL PROPIETARIO', 18)], spacing: { before: 40, after: 20 } }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [normal(d.nombre_arrendador, 18)], spacing: { before: 0, after: 0 } }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [italic('Propietario del inmueble', 16)], spacing: { before: 0, after: 0 } }),
          ],
        }),
      ]}),
    ],
  })

  const children = [

    // ══════════════════════════════════════════════════════
    // CARÁTULA
    // ══════════════════════════════════════════════════════

    // Título principal
    ...espacio(1),
    centrado([
      new TextRun({ text: 'PÓLIZA JURÍDICA INMOBILIARIA', bold: true, size: 32, font: FONT_TITULO, color: COLOR_NEGRO }),
    ], { spacing: { before: 0, after: 10 } }),
    dividerRojo(),

    // Secciones de datos
    ...seccionDatos('DATOS DE LA PÓLIZA', [
      ['Tipo de movimiento:', 'Alta'],
      ['Tipo de póliza:', 'Jurídica Inmobiliaria'],
      ['Inicio de vigencia:', d.fecha_inicio],
      ['Fin de vigencia:', d.fecha_termino],
      ['Duración:', '12 meses'],
      ['Forma de pago:', 'Cubierta por el arrendatario'],
      ['Tipo de cobertura:', 'Desalojo y deslinde por Extinción de Dominio'],
    ]),

    ...seccionDatos('DATOS DEL PROPIETARIO', [
      ['Nombre:', d.nombre_arrendador],
      ['Domicilio:', d.domicilio_arrendador],
      ['Teléfono:', d.telefono_arrendador],
      ['Correo electrónico:', d.correo_arrendador],
    ]),

    ...seccionDatos('DATOS DEL ARRENDATARIO', [
      ['Nombre:', d.nombre_arrendatario],
      ['Teléfono:', d.telefono_arrendatario],
      ['Correo electrónico:', d.correo_arrendatario],
    ]),

    ...seccionDatos('DATOS DEL INMUEBLE ARRENDADO', [
      ['Domicilio completo:', d.direccion_inmueble],
      ['Municipio / Estado:', d.ciudad_estado],
      ['Uso del inmueble:', 'Habitacional'],
    ]),

    ...seccionDatos('DATOS DEL CONTRATO DE ARRENDAMIENTO', [
      ['Fecha de firma:', d.fecha_firma],
      ['Monto de renta mensual:', d.renta],
    ]),

    // Observaciones
    new Paragraph({
      children: [rojo('OBSERVACIONES IMPORTANTES', 18)],
      spacing: { before: 30, after: 20 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR_ROJO, space: 2 } },
    }),
    new Paragraph({
      children: [
        normal('La presente póliza jurídica inmobiliaria ', 16),
        new TextRun({ text: 'no garantiza el cumplimiento del arrendatario ni la recuperación de pagos', bold: true, size: 16, font: FONT_CUERPO }),
        normal(', y se limita a la ', 16),
        new TextRun({ text: 'gestión jurídica preventiva, extrajudicial y, en su caso, judicial', bold: true, size: 16, font: FONT_CUERPO }),
        normal(', para la recuperación del inmueble y el deslinde de responsabilidades del propietario.', 16),
      ],
      spacing: { before: 20, after: 30 },
      alignment: AlignmentType.JUSTIFIED,
    }),

    centrado([bold('EMPORIO INMOBILIARIO', 16, FONT_TITULO, COLOR_ROJO)], { spacing: { before: 30, after: 6 } }),
    centrado([italic('Tu respaldo jurídico al momento de rentar', 16)], { spacing: { before: 0, after: 0 } }),

    // ══════════════════════════════════════════════════════
    // CONTRATO — página 2
    // ══════════════════════════════════════════════════════
    pageBreak(),
    ...espacio(2),
    centrado([
      new TextRun({ text: 'CONTRATO DE PRESTACIÓN DE SERVICIOS INMOBILIARIOS', bold: true, size: 24, font: FONT_TITULO, color: COLOR_NEGRO }),
    ], { spacing: { before: 0, after: 10 } }),
    centrado([
      new TextRun({ text: 'CON GESTIÓN JURÍDICA PREVENTIVA, EXTRAJUDICIAL Y CONTENCIOSA', bold: true, size: 20, font: FONT_TITULO, color: COLOR_GRIS }),
    ], { spacing: { before: 0, after: 10 } }),
    dividerRojo(),
    ...espacio(1),

    para([
      normal('QUE CELEBRAN, por una parte '),
      bold('GRUPO INMOBILIARIO NACHON TORRES S.A. DE C.V.'),
      normal(' representado en este acto por su administrador único C. Carlos Alejandro Nachon Saldivar, a quien en lo sucesivo se le denominará '),
      bold('"EMPORIO INMOBILIARIO"'),
      normal(', y por la otra el C. '),
      bold(d.nombre_arrendador),
      normal(', a quien en lo sucesivo se le denominará '),
      bold('"EL PROPIETARIO"'),
      normal(', al tenor de las siguientes:'),
    ]),

    ...espacio(1),
    centrado([bold('DECLARACIONES', 22, FONT_TITULO)], { spacing: { before: 80, after: 40 } }),

    para([bold('I. Declara EMPORIO INMOBILIARIO:')]),
    para([normal('a)\tQue es una sociedad legalmente constituida conforme a las leyes mexicanas.')]),
    para([normal('b)\tQue su objeto social comprende la prestación de servicios inmobiliarios, administración, arrendamiento, promoción, análisis y gestión de inmuebles.')]),
    para([normal('c)\tQue cuenta con personal interno y con el apoyo de despachos externos para brindar servicios de gestión jurídica inmobiliaria, sin ostentarse como despacho jurídico independiente.')]),

    ...espacio(1),
    para([bold('II. Declara EL PROPIETARIO:')]),
    para([normal('a)\tQue es legítimo propietario o cuenta con facultades suficientes sobre el inmueble ubicado en: '), bold(d.direccion_inmueble), normal('.')]),
    para([normal('b)\tQue desea contratar una póliza jurídica inmobiliaria anual.')]),
    para([normal('c)\tQue reconoce que la póliza no garantiza el cumplimiento del arrendatario, sino que brinda mecanismos de prevención, gestión extrajudicial y, en su caso, judicial para la recuperación del inmueble.')]),

    ...espacio(1),
    para([bold('III. Declaran ambas partes:')]),
    para([normal('a)\tQue se reconocen capacidad legal.')]),
    para([normal('b)\tQue es su voluntad celebrar el presente contrato.')]),

    ...espacio(1),
    divider(),
    centrado([bold('CLÁUSULAS', 22, FONT_TITULO)], { spacing: { before: 80, after: 40 } }),

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

    ...espacio(2),
    firmaTable(),
    ...espacio(1),
    divider(),
    centrado([bold('EMPORIO INMOBILIARIO  |  Póliza Jurídica Inmobiliaria', 16, FONT_TITULO, COLOR_ROJO)], { spacing: { before: 60, after: 20 } }),
    centrado([italic('Documento confidencial – Uso exclusivo del propietario', 16)], { spacing: { before: 0, after: 0 } }),
  ]

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT_CUERPO, size: 18 } },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          // Márgenes generosos para respetar el membrete:
          // top: ~2.2cm arriba del encabezado, bottom: ~2.5cm sobre el pie de página
          margin: { top: 2880, right: 1200, bottom: 2160, left: 1200 },
        },
      },
      children,
    }],
  })

  const buffer = await Packer.toBlob(doc)
  const url = URL.createObjectURL(buffer)
  const a = document.createElement('a')
  a.href = url
  a.download = `Poliza_${d.nombre_arrendador.replace(/\s+/g, '_')}_${exp.fecha_firma || 'borrador'}.docx`
  a.click()
  URL.revokeObjectURL(url)
}
