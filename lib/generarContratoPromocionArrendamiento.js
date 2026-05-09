// lib/generarContratoPromocionArrendamiento.js
// Contrato de Prestación de Servicios de Mediación para Arrendamiento
// Emporio Inmobiliario — Grupo Inmobiliario Nachon Torres S.A. de C.V.

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  BorderStyle,
  WidthType,
  VerticalAlign,
} from 'docx'
import { saveAs } from 'file-saver'

// ─── helpers ────────────────────────────────────────────────────────────────

function bold(text) {
  return new TextRun({ text, bold: true })
}

function normal(text) {
  return new TextRun({ text })
}

// Párrafo con texto mixto (array de TextRun o strings)
function p(children, opts = {}) {
  const runs = children.map((c) =>
    typeof c === 'string' ? new TextRun(c) : c
  )
  return new Paragraph({
    children: runs,
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 160 },
    ...opts,
  })
}

function spacer() {
  return new Paragraph({ children: [new TextRun('')], spacing: { after: 80 } })
}

// ─── función principal ───────────────────────────────────────────────────────

export async function generarContratoPromocionArrendamiento({
  nombre_arrendador,
  domicilio_arrendador,
  telefono_arrendador,
  direccion_inmueble,
  renta_mensual,       // número o string, ej: "7,500.00"
  renta_mensual_letra, // ej: "SIETE MIL QUINIENTOS PESOS 00/100 M.N."
}) {
  // Fecha de hoy en español
  const hoy = new Date()
  const dia = hoy.getDate()
  const mes = hoy.toLocaleDateString('es-MX', { month: 'long' }).toUpperCase()
  const anio = hoy.getFullYear()
  const fechaTexto = `${dia} de ${mes} de ${anio}`

  // Formato de renta
  const rentaFormateada =
    typeof renta_mensual === 'number'
      ? renta_mensual.toLocaleString('es-MX', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : renta_mensual

  const letraRenta = renta_mensual_letra || ''

  // ── Encabezado ──────────────────────────────────────────────────────────────
  const encabezado = p([
    bold('CONTRATO DE PRESTACIÓN DE SERVICIOS DE MEDIACIÓN PARA EL ARRENDAMIENTO DE INMUEBLE '),
    bold('QUE CELEBRAN POR UNA PARTE '),
    bold(
      'GRUPO INMOBILIARIO NACHON TORRES S.A. DE C.V., REPRESENTADA POR SU ADMINISTRADOR ÚNICO, EL SR. CARLOS ALEJANDRO NACHON SALDIVAR'
    ),
    bold(', CON DOMICILIO EN '),
    bold('5TO RETORNO DE OSA MENOR 2ª RESERVA TERRITORIAL ATLIXCAYOTL, SAN ANDRÉS CHOLULA, PUEBLA, C.P. 72820'),
    bold(', TELÉFONO '),
    bold('2222573237'),
    bold(', A QUIEN EN LO SUCESIVO SE LE DENOMINARÁ '),
    bold('"LA INMOBILIARIA"'),
    bold(', Y POR LA OTRA LA C. '),
    bold(nombre_arrendador),
    bold(' CON DOMICILIO EN '),
    bold(domicilio_arrendador),
    bold(', TELÉFONO '),
    bold(telefono_arrendador),
    bold(', QUIEN EN LO SUCESIVO SE DENOMINARÁ '),
    bold('"EL PROPIETARIO"'),
    bold(', CON RESPECTO AL INMUEBLE UBICADO EN '),
    bold(direccion_inmueble),
    bold(', A QUIEN EN LO SUCESIVO SE DENOMINARÁ '),
    bold('"EL INMUEBLE"'),
    bold(', SE SUJETAN A LAS SIGUIENTES DECLARACIONES Y CLÁUSULAS:'),
  ])

  // ── Declaraciones ────────────────────────────────────────────────────────────
  const tituloDeclaraciones = p([bold('DECLARACIONES:')], {
    spacing: { before: 240, after: 160 },
  })

  const decPrimera = p([
    bold('PRIMERA. '),
    normal('Declara '),
    bold('"LA INMOBILIARIA"'),
    normal(
      ' ser una persona moral debidamente constituida bajo las leyes mexicanas, dedicada a la actividad inmobiliaria, con R.F.C. '
    ),
    bold('GIN191025L80'),
    normal('.'),
  ])

  const decSegunda = p([
    bold('SEGUNDA. '),
    normal('Declara '),
    bold('"EL PROPIETARIO"'),
    normal(' ser legítimo dueño de '),
    bold('"EL INMUEBLE"'),
    normal(' ubicado en '),
    bold(direccion_inmueble),
    normal('.'),
  ])

  // ── Cláusulas ────────────────────────────────────────────────────────────────
  const tituloCláusulas = p([bold('CLÁUSULAS:')], {
    spacing: { before: 240, after: 80 },
  })
  const tituloServicios = p([bold('SERVICIOS')], {
    spacing: { before: 80, after: 160 },
  })

  const clausulaPrimera = p([
    bold('PRIMERA.-'),
    normal(' El objeto del presente contrato es la prestación de los siguientes servicios:'),
  ])

  const srv1 = p([
    bold('1. Asesoría: '),
    bold('"LA INMOBILIARIA"'),
    normal(' analizará '),
    bold('"EL INMUEBLE"'),
    normal(
      ' para determinar su valor en el mercado y la forma más adecuada para rentarlo, tomando en consideración sus características físicas y de ubicación. '
    ),
    bold('"LA INMOBILIARIA"'),
    normal(' orientará a '),
    bold('"EL PROPIETARIO"'),
    normal(
      ' en relación con los instrumentos jurídicos y fiscales necesarios para la operación, la integración de la documentación y la renta de '
    ),
    bold('"EL INMUEBLE"'),
    normal('.'),
  ], { indent: { left: 720 } })

  const srv2 = p([
    bold('2. Promoción: '),
    bold('"LA INMOBILIARIA"'),
    normal(' promoverá '),
    bold('"EL INMUEBLE"'),
    normal(
      ' utilizando los medios de difusión que considere adecuados conforme a sus características. La promoción consistirá en publicidad en redes sociales, anuncios en clasificados digitales, bolsa inmobiliaria a través de la red EasyBroker, y la página web de la empresa con publicidad en sitios web relacionados con el giro inmobiliario.'
    ),
  ], { indent: { left: 720 } })

  const srv3 = p([
    bold('3. Gestión: '),
    bold('"LA INMOBILIARIA"'),
    normal(' recibirá, por cuenta y orden de '),
    bold('"EL PROPIETARIO"'),
    normal(', las propuestas y ofertas de renta de '),
    bold('"EL INMUEBLE"'),
    normal(' y las someterá a consideración de '),
    bold('"EL PROPIETARIO"'),
    normal('.'),
  ], { indent: { left: 720 } })

  const srv4 = p([
    bold('4. Información: '),
    bold('"LA INMOBILIARIA"'),
    normal(' rendirá un informe mensual a '),
    bold('"EL PROPIETARIO"'),
    normal(' sobre los resultados de las labores realizadas.'),
  ], { indent: { left: 720 } })

  const clausulaSegunda = p([
    bold('SEGUNDA.- '),
    bold('"EL PROPIETARIO"'),
    normal(' entregará a '),
    bold('"LA INMOBILIARIA"'),
    normal(
      ' en el momento de la firma de este instrumento, copia del último recibo predial de '
    ),
    bold('"EL INMUEBLE"'),
    normal('.'),
  ])

  const clausulaTercera = p([
    bold('TERCERA.- '),
    bold('"EL PROPIETARIO"'),
    normal(' manifiesta su intención de rentar '),
    bold('"EL INMUEBLE"'),
    normal(' por la cantidad de '),
    bold(`$${rentaFormateada} (${letraRenta})`),
    normal(', '),
    bold('"LA INMOBILIARIA"'),
    normal(
      ' estará obligada a presentar a '
    ),
    bold('"EL PROPIETARIO"'),
    normal(' todas las ofertas que se reciban.'),
  ])

  const clausulaCuarta = p([
    bold('CUARTA.-'),
    normal(' Durante la vigencia del presente contrato, '),
    bold('"LA INMOBILIARIA"'),
    normal(
      ' tendrá el carácter de exclusiva para la intermediación de la operación de renta de '
    ),
    bold('"EL INMUEBLE"'),
    normal('.'),
  ])

  const tituloHonorarios = p([bold('HONORARIOS')], {
    spacing: { before: 200, after: 160 },
  })

  const clausulaQuinta = p([
    bold('QUINTA.-'),
    normal(' Las partes acuerdan que '),
    bold('"LA INMOBILIARIA"'),
    normal(
      ' cobrará como honorarios por los servicios prestados el equivalente a un mes de renta sobre el valor final de la operación.'
    ),
  ])

  const clausulaSexta = p([
    bold('SEXTA.-'),
    normal(' En caso de que '),
    bold('"EL PROPIETARIO"'),
    normal(
      ', por razones imputables a él, rechace una oferta de renta al precio indicado en este instrumento con la intención de aumentarlo sin previo aviso por escrito a '
    ),
    bold('"LA INMOBILIARIA"'),
    normal(', '),
    bold('"EL PROPIETARIO"'),
    normal(
      ' se obliga a pagar el 100% de los honorarios pactados, calculados sobre la base del precio de renta señalado originalmente. Asimismo, '
    ),
    bold('"EL PROPIETARIO"'),
    normal(' se obliga a trabajar mediante una póliza de arrendamiento con la empresa que '),
    bold('"LA INMOBILIARIA"'),
    normal(' designe, la cual deberá ser aceptada por '),
    bold('"EL PROPIETARIO"'),
    normal(
      ' y pagada por el posible arrendatario. '
    ),
    bold('"EL PROPIETARIO"'),
    normal(
      ' deberá aceptar al cliente que haya sido debidamente calificado y aprobado por el despacho de póliza. En caso de que '
    ),
    bold('"EL PROPIETARIO"'),
    normal(
      ' rechace al cliente aprobado o decida rentar por su cuenta dentro del plazo del presente contrato, '
    ),
    bold('"EL PROPIETARIO"'),
    normal(' deberá pagar a '),
    bold('"LA INMOBILIARIA"'),
    normal(' el 100% de la comisión pactada por la renta de '),
    bold('"EL INMUEBLE"'),
    normal('.'),
  ])

  const clausulaSeptima = p([
    bold('SÉPTIMA.-'),
    normal(
      ' La duración del presente contrato será de 60 días naturales, forzosos para ambas partes iniciando el día '
    ),
    bold(fechaTexto),
    normal('.'),
  ])

  const tituloCláusulasAdicionales = p([bold('CLÁUSULAS ADICIONALES')], {
    spacing: { before: 200, after: 160 },
  })

  const clausulaOctava = p([
    bold('OCTAVA.-'),
    normal(
      ' Las partes que intervienen en el presente contrato acuerdan someterse para la interpretación y cumplimiento del mismo a la jurisdicción de los tribunales de la ciudad de Puebla, renunciando expresamente al fuero de su domicilio presente o futuro.'
    ),
  ])

  const clausulaNovena = p([
    bold('NOVENA.-'),
    normal(
      ' Las partes señalan como domicilio para recibir notificaciones, emplazamientos o cualquier otro efecto legal, los mencionados en este instrumento.'
    ),
  ])

  const cierre = p([
    normal(
      'Las partes manifiestan haber leído en su integridad este contrato, estar conformes con su contenido y tener plena capacidad jurídica para comprometerse.'
    ),
  ], { spacing: { before: 160, after: 160 } })

  const firmaPie = p([
    normal(
      `Leído por las partes, el presente contrato se firma de conformidad y por duplicado en la ciudad de Puebla el día `
    ),
    bold(fechaTexto),
    normal(', en todas y cada una de las hojas que lo integran.'),
  ], { spacing: { after: 320 } })

  // ── Tabla de firmas ──────────────────────────────────────────────────────────
  const noBorder = {
    style: BorderStyle.NONE,
    size: 0,
    color: 'FFFFFF',
  }
  const noBorders = {
    top: noBorder,
    bottom: noBorder,
    left: noBorder,
    right: noBorder,
    insideHorizontal: noBorder,
    insideVertical: noBorder,
  }

  const tablaFirmas = new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [4680, 4680],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: noBorders,
            width: { size: 4680, type: WidthType.DXA },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            verticalAlign: VerticalAlign.TOP,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: '_________________________________', bold: true })],
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: nombre_arrendador, bold: true })],
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: 'EL PROPIETARIO', bold: true })],
              }),
            ],
          }),
          new TableCell({
            borders: noBorders,
            width: { size: 4680, type: WidthType.DXA },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            verticalAlign: VerticalAlign.TOP,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: 'GRUPO INMOBILIARIO NACHON TORRES S.A. DE C.V.',
                    bold: true,
                  }),
                ],
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: 'REPRESENTADO POR SU ADMINISTRADOR ÚNICO', bold: true }),
                ],
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: 'CARLOS ALEJANDRO NACHON SALDIVAR', bold: true }),
                ],
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: 'LA INMOBILIARIA', bold: true })],
              }),
            ],
          }),
        ],
      }),
    ],
  })

  // ── Armar documento ──────────────────────────────────────────────────────────
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children: [
          encabezado,
          spacer(),
          tituloDeclaraciones,
          decPrimera,
          decSegunda,
          spacer(),
          tituloCláusulas,
          tituloServicios,
          clausulaPrimera,
          srv1,
          srv2,
          srv3,
          srv4,
          spacer(),
          clausulaSegunda,
          clausulaTercera,
          clausulaCuarta,
          spacer(),
          tituloHonorarios,
          clausulaQuinta,
          clausulaSexta,
          clausulaSeptima,
          spacer(),
          tituloCláusulasAdicionales,
          clausulaOctava,
          clausulaNovena,
          spacer(),
          cierre,
          firmaPie,
          tablaFirmas,
        ],
      },
    ],
  })

  const blob = await Packer.toBlob(doc)
  saveAs(blob, `Contrato_Promocion_Arrendamiento_${nombre_arrendador.replace(/\s+/g, '_')}.docx`)
}
