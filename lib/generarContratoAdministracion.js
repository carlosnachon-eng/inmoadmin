// lib/generarContratoAdministracion.js
// Contrato de Prestación de Servicios de Administración Inmobiliaria

function fmtFecha(d) {
  if (!d) return '___/___/______'
  if (typeof d === 'string' && d.includes('/')) return d
  const fecha = new Date(d + 'T12:00:00')
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  return `${fecha.getDate()} de ${meses[fecha.getMonth()]} de ${fecha.getFullYear()}`
}

export async function generarContratoAdministracion(data) {
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

  const firmaTable = () => new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [4680, 4680],
    borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideH: noBorder, insideV: noBorder },
    rows: [new TableRow({ children: [
      new TableCell({ borders: noBorders, width: { size: 4680, type: WidthType.DXA }, children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [bold('GRUPO INMOBILIARIO NACHON TORRES S.A. DE C.V.')] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [bold('"LA ADMINISTRADORA"')] }),
        espacio(),
        espacio(),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '_____________________________', size: 20, font: 'Arial' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [bold('C. CARLOS ALEJANDRO NACHÓN SALDÍVAR')] }),
      ]}),
      new TableCell({ borders: noBorders, width: { size: 4680, type: WidthType.DXA }, children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [bold('LA PROPIETARIA')] }),
        espacio(),
        espacio(),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '_____________________________', size: 20, font: 'Arial' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [bold(`C. ${d.nombre_propietario}`)] }),
      ]}),
    ]})]
  })

  const d = {
  nombre_propietario:  data.nombre_arrendador || data.nombre_propietario || '',
  direccion_inmueble:  data.direccion_inmueble || '',
  fecha_firma:         fmtFecha(data.fecha_firma),
  comision_porcentaje: data.comision_porcentaje || '10',
}

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
          bold('CONTRATO DE PRESTACIÓN DE SERVICIOS DE ADMINISTRACIÓN INMOBILIARIA, '),
          normal('que celebran por una parte GRUPO INMOBILIARIO NACHON TORRES S.A. DE C.V., representada por el '),
          bold('C. CARLOS ALEJANDRO NACHÓN SALDÍVAR'),
          normal(', en su carácter de representante legal, a quien en lo sucesivo se le denominará "LA ADMINISTRADORA"; y por la otra parte el '),
          bold(`C. ${d.nombre_propietario}`),
          normal(', a quien se le denominará "LA PROPIETARIA", de conformidad con las siguientes:'),
        ]),

        espacio(),
        para([bold('DECLARACIONES')]),
        espacio(),

        para([bold('I. Declara "LA PROPIETARIA":')]),
        para([
          normal('a) Que es legítima propietaria del inmueble ubicado en '),
          bold(d.direccion_inmueble),
          normal('.'),
        ]),
        para([normal('b) Que tiene interés en contratar los servicios profesionales de administración inmobiliaria.')]),
        para([normal('c) Que conoce y acepta los términos del presente contrato.')]),

        espacio(),
        para([bold('II. Declara "LA ADMINISTRADORA":')]),
        para([normal('a) Que es una persona moral legalmente constituida, con domicilio en 5to Retorno de Osa Menor 2A, Reserva Territorial Atlixcáyotl, San Andrés Cholula, Puebla, cuyo objeto incluye la administración de inmuebles.')]),
        para([normal('b) Que cuenta con el personal, experiencia y estructura necesaria para prestar los servicios materia del presente contrato.')]),

        espacio(),
        para([bold('CLÁUSULAS')]),
        espacio(),

        para([bold('PRIMERA.- Objeto del contrato')]),
        para([
          normal('"LA PROPIETARIA" encomienda a "LA ADMINISTRADORA" la administración del inmueble antes mencionado, incluyendo: Promoción para arrendamiento, investigación y selección de inquilinos, elaboración y firma de contratos, cobranza y emisión de recibos, gestión de mantenimiento preventivo y correctivo, representación ante arrendatarios, y liquidación mensual de rentas.'),
        ]),

        para([bold('SEGUNDA.- Honorarios')]),
        para([
          normal('"LA ADMINISTRADORA" percibirá el '),
          bold(`${d.comision_porcentaje}% (${d.comision_porcentaje === '10' ? 'diez' : d.comision_porcentaje} por ciento)`),
          normal(' del monto mensual efectivamente cobrado por concepto de renta de cada departamento. Este porcentaje incluye la gestión integral del inmueble y será descontado de las rentas antes de su entrega.'),
        ]),

        para([bold('TERCERA.- Vigencia')]),
        para([normal('El contrato tendrá una duración inicial de 1 año, contada a partir de su firma, renovándose automáticamente por periodos iguales salvo notificación escrita con 30 días de anticipación por cualquiera de las partes.')]),

        para([bold('CUARTA.- Promoción y contratación')]),
        para([normal("Además del servicio de administración, 'LA ADMINISTRADORA' cobrará el equivalente a un mes completo de renta por concepto de promoción y contratación de nuevos arrendamientos. En caso de renovaciones de contratos con los mismos inquilinos, se cobrará únicamente el 50% del valor de la renta mensual. Todos los contratos celebrados serán por una vigencia mínima de un año.")]),

        para([bold('QUINTA.- Facultades de representación')]),
        para([normal('"LA PROPIETARIA" faculta expresamente a "LA ADMINISTRADORA" para firmar contratos de arrendamiento, recibos, convenios de pago y cualquier documento necesario para la operación ordinaria del inmueble.')]),

        para([bold('SEXTA.- Entrega de rentas')]),
        para([normal('"LA ADMINISTRADORA" realizará un corte mensual y entregará a "EL PROPIETARIO" la renta neta, una vez descontados los honorarios y los gastos de mantenimiento o reparaciones autorizadas, en cuanto se haya realizado el cobro efectivo de la renta mensual.')]),
        para([normal('La liquidación se realizará conforme a las fechas y condiciones de pago establecidas en el contrato de arrendamiento vigente, y se efectuará mediante transferencia bancaria o cualquier otro medio previamente acordado, acompañada de un reporte detallado del ingreso y los descuentos aplicados.')]),

        para([bold('SÉPTIMA.- Mantenimiento y reparaciones')]),
        para([normal('"LA ADMINISTRADORA" podrá gestionar reparaciones menores con cargo a las rentas hasta por un monto equivalente al 10% (diez por ciento) del ingreso mensual sin necesidad de autorización previa del PROPIETARIO.')]),
        para([normal('Dichos gastos serán comprobados mediante evidencia fotográfica y comprobantes fiscales o tickets, y se incluirán en la liquidación mensual correspondiente.')]),
        para([normal('Para reparaciones o trabajos que excedan dicho monto, se requerirá autorización previa y por escrito de la PROPIETARIA.')]),

        para([bold('OCTAVA.- Obligaciones fiscales')]),
        para([normal('Las partes acuerdan que "LA PROPIETARIA" es responsable del cumplimiento de sus obligaciones fiscales derivadas del arrendamiento. "LA ADMINISTRADORA" podrá emitir constancias mensuales si así se solicita.')]),

        para([bold('NOVENA.- Terminación anticipada')]),
        para([normal('Cualquiera de las partes podrá dar por terminado este contrato notificando con 30 días naturales de anticipación, sin penalización alguna. En caso de terminación sin previo aviso, se deberá cubrir a la otra parte el equivalente a un mes de honorarios por concepto de indemnización.')]),

        para([bold('DÉCIMA.- Notificaciones')]),
        para([normal('Toda comunicación podrá realizarse mediante correo electrónico o vía WhatsApp, teniendo pleno valor legal las notificaciones enviadas a los medios registrados por las partes.')]),

        para([bold('DÉCIMA PRIMERA.- Contratos de arrendamiento')]),
        para([normal('El propietario autoriza a LA ADMINISTRADORA a celebrar y firmar, en su representación, los contratos de arrendamiento correspondientes, así como cualquier convenio adicional o renovación que resulte necesario. LA ADMINISTRADORA entregará copia simple del contrato celebrado a la PROPIETARIA, dentro de los cinco días hábiles siguientes a su firma.')]),

        para([bold('DÉCIMA SEGUNDA.- Jurisdicción')]),
        para([normal('Para la interpretación y cumplimiento de este contrato, las partes se someten a los tribunales de la ciudad de Puebla, renunciando expresamente a cualquier otro fuero.')]),

        para([bold('DÉCIMA TERCERA.– Prevención de Lavado de Dinero (PLD)')]),
        para([normal('"LA ADMINISTRADORA", en su carácter de prestador de servicios de intermediación y administración inmobiliaria, reconoce que las actividades objeto del presente contrato pueden considerarse Operaciones Vulnerables conforme a la Ley Federal para la Prevención e Identificación de Operaciones con Recursos de Procedencia Ilícita (LFPIORPI).')]),
        para([normal('Por lo anterior, las partes acuerdan lo siguiente:')]),

        para([bold('1. Obligaciones de "LA ADMINISTRADORA"')]),
        para([normal('a) Recabar de propietarios, arrendatarios y cualquier parte involucrada la documentación necesaria para integrar el Expediente de Identificación del Cliente (KYC).')]),
        para([normal('b) Solicitar, cuando corresponda, información sobre el origen lícito de los recursos utilizados en las operaciones.')]),
        para([normal('c) Integrar, conservar y administrar los Expedientes PLD.')]),
        para([normal('d) Presentar los avisos que resulten aplicables ante la Secretaría de Hacienda y Crédito Público (SISE / SAT).')]),
        para([normal('e) Negarse a realizar operaciones que no cumplan con los requisitos de identificación o integración documental.')]),
        para([normal('f) Reportar operaciones inusuales, internas preocupantes o relevantes, cuando corresponda.')]),

        para([bold('2. Obligaciones de "LA PROPIETARIA"')]),
        para([normal('a) Proporcionar a "LA ADMINISTRADORA" la información requerida para cumplir con la ley, incluyendo identificación, comprobantes, declaraciones de origen de recursos y datos de beneficiarios finales.')]),
        para([normal('b) Notificar cualquier cambio relevante en su situación legal o fiscal.')]),
        para([normal('c) Colaborar en la integración del expediente de los arrendatarios y permitir que "LA ADMINISTRADORA" solicite documentación adicional cuando sea necesario por motivos de cumplimiento.')]),

        para([bold('3. Aceptación expresa')]),
        para([normal('"LA PROPIETARIA" reconoce y acepta que la falta de entrega de documentos o la negativa a colaborar para fines de PLD podrá ser motivo suficiente para: no celebrar contratos de arrendamiento, no entregar llaves a inquilinos, suspender temporalmente los servicios, o dar por terminado el contrato sin responsabilidad para "LA ADMINISTRADORA".')]),

        para([bold('4. Atribuciones del Oficial de Cumplimiento')]),
        para([normal('"LA PROPIETARIA" reconoce que el Oficial de Cumplimiento designado por "LA ADMINISTRADORA" (actualmente Carlos Alejandro Nachón Saldívar) podrá solicitar documentación adicional, requerir información y emitir recomendaciones vinculantes para el cumplimiento de la LFPIORPI.')]),

        para([bold('5. Responsabilidad')]),
        para([normal('"LA PROPIETARIA" será responsable de la veracidad de la información proporcionada y deslinda a "LA ADMINISTRADORA" de cualquier consecuencia derivada de datos falsos, incompletos o entregados de manera tardía.')]),

        espacio(),
        para([
          normal('Leído que fue el presente contrato y conformes las partes con su contenido y alcances legales, lo firman por duplicado en la ciudad de Puebla, a los '),
          bold(d.fecha_firma),
          normal('.'),
        ]),
        espacio(),
        firmaTable(),
      ]
    }]
  })

  const buffer = await Packer.toBlob(doc)
  const url = URL.createObjectURL(buffer)
  const a = document.createElement('a')
  a.href = url
  a.download = `Contrato_Administracion_${d.nombre_propietario.replace(/\s+/g, '_')}.docx`
  a.click()
  URL.revokeObjectURL(url)
}
