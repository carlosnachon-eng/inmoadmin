// lib/generarContrato.js
// Genera el contrato de arrendamiento en .docx y lo descarga directamente

export async function generarContratoArrendamiento(exp) {
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    AlignmentType, BorderStyle, WidthType, ShadingType,
  } = await import('docx')

  const fmt = (n) => n ? `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : '$0.00'
  const fmtFecha = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '___/___/______'

  const bold   = (text, size = 20) => new TextRun({ text: String(text || ''), bold: true, size, font: 'Arial' })
  const normal = (text, size = 20) => new TextRun({ text: String(text || ''), size, font: 'Arial' })

  const para = (children, opts = {}) => new Paragraph({
    children: Array.isArray(children) ? children : [children],
    spacing: { before: 80, after: 80 },
    alignment: AlignmentType.JUSTIFIED,
    ...opts,
  })

  const centrado = (children, opts = {}) => new Paragraph({
    children: Array.isArray(children) ? children : [children],
    spacing: { before: 80, after: 80 },
    alignment: AlignmentType.CENTER,
    ...opts,
  })

  const espacio = () => new Paragraph({
    children: [new TextRun({ text: '', size: 20 })],
    spacing: { before: 40, after: 40 },
  })

  const pageBreak = () => new Paragraph({
    children: [new TextRun({ text: '', size: 20 })],
    pageBreakBefore: true,
  })

  const clausula = (titulo, ...parrafos) => [
    espacio(),
    para([bold(titulo)]),
    ...parrafos,
  ]

  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }

  const firmaTable = (izq, der) => new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [4680, 4680],
    borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideH: noBorder, insideV: noBorder },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: noBorders,
            width: { size: 4680, type: WidthType.DXA },
            children: [
              new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '_______________________________', size: 20, font: 'Arial' })] }),
              new Paragraph({ alignment: AlignmentType.CENTER, children: [bold(izq.nombre)] }),
              new Paragraph({ alignment: AlignmentType.CENTER, children: [normal(izq.rol)] }),
            ]
          }),
          new TableCell({
            borders: noBorders,
            width: { size: 4680, type: WidthType.DXA },
            children: [
              new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '_______________________________', size: 20, font: 'Arial' })] }),
              new Paragraph({ alignment: AlignmentType.CENTER, children: [bold(der.nombre)] }),
              new Paragraph({ alignment: AlignmentType.CENTER, children: [normal(der.rol)] }),
            ]
          }),
        ]
      })
    ]
  })

  // Datos del expediente
  const d = {
    nombre_arrendador:         exp.nombre_arrendador || '',
    domicilio_arrendador:      exp.domicilio_arrendador || '',
    rfc_arrendador:            exp.rfc_arrendador || '',
    clave_elector_arrendador:  exp.clave_elector_arrendador || '',
    telefono_arrendador:       exp.telefono_arrendador || '',
    correo_arrendador:         exp.correo_arrendador || '',
    nombre_arrendatario:       exp.nombre_arrendatario || '',
    domicilio_arrendatario:    exp.domicilio_arrendatario || '',
    rfc_arrendatario:          exp.rfc_arrendatario || '',
    clave_elector_arrendatario:exp.clave_elector_arrendatario || '',
    telefono_arrendatario:     exp.telefono_arrendatario || '',
    correo_arrendatario:       exp.correo_arrendatario || '',
    ocupacion_arrendatario:    exp.ocupacion_arrendatario || '',
    comprobante_ingresos:      exp.comprobante_ingresos || 'Estados de cuenta',
    direccion_inmueble:        exp.direccion_inmueble || '',
    ciudad_estado:             exp.ciudad_estado_inmueble || 'Puebla, Puebla',
    renta_mensual:             exp.renta_mensual || 0,
    renta_mensual_letra:       exp.renta_mensual_letra || '',
    deposito_garantia:         exp.deposito_garantia || 0,
    deposito_garantia_letra:   exp.deposito_garantia_letra || '',
    forma_pago:                exp.forma_pago || 'Efectivo',
    dia_limite_pago:           exp.dia_limite_pago || 5,
    fecha_inicio:              fmtFecha(exp.fecha_inicio),
    fecha_termino:             fmtFecha(exp.fecha_termino),
    fecha_entrega_posesion:    fmtFecha(exp.fecha_entrega_posesion),
    fecha_firma:               fmtFecha(exp.fecha_firma),
    mascotas_permitidas:       exp.mascotas_permitidas || 'no',
  }

  const doc = new Document({
    styles: {
      default: { document: { run: { font: 'Arial', size: 20 } } }
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 }
        }
      },
      children: [
        // TÍTULO
        centrado([bold('CONTRATO DE ARRENDAMIENTO', 22)]),
        espacio(),
        para([
          normal('QUE CELEBRAN POR UNA PARTE EL C. '), bold(d.nombre_arrendador),
          normal(' A QUIEN EN LO SUCESIVO SE LE DENOMINARÁ '), bold('"EL ARRENDADOR"'),
          normal(', Y POR OTRA PARTE '), bold(d.nombre_arrendatario),
          normal(', A QUIEN EN LO SUCESIVO SE LE DENOMINARÁ '), bold('"EL ARRENDATARIO"'),
          normal(', A QUIENES EN CONJUNTO SE LES DENOMINARÁ "LAS PARTES" Y QUIENES SE SUJETAN AL TENOR DE LAS SIGUIENTES DECLARACIONES Y CLÁUSULAS:'),
        ]),

        espacio(),
        centrado([bold('DECLARACIONES', 22)]),
        espacio(),
        para([bold('DECLARA "EL ARRENDADOR", bajo protesta de decir verdad:')]),
        espacio(),

        para([bold('1.1. '), normal('Que es persona física de nacionalidad mexicana, con domicilio en: '), bold(d.domicilio_arrendador),
          normal(' quien se identifica en este acto jurídico con su Credencial para votar, expedida por el Instituto Nacional Electoral, con clave de elector número: '), bold(d.clave_elector_arrendador),
          normal(', con RFC: '), bold(d.rfc_arrendador), normal(', con número de contacto '), bold(d.telefono_arrendador),
          normal(', con correo electrónico: '), bold(d.correo_arrendador), normal(' y que cuenta con la suficiente capacidad jurídica para celebrar el presente contrato.'),
        ]),
        para([bold('1.2. '), normal('Que es legítimo propietario de la Casa Habitación ubicada en: '), bold(d.direccion_inmueble), normal('.')]),
        para([bold('1.3. '), normal('Que su deseo celebrar el presente contrato de Arrendamiento, a efecto de que "EL ARRENDATARIO" tome en arrendamiento el inmueble citado en el punto número 1.2 párrafo que antecede, el cual será utilizado exclusivamente como Casa Habitación.')]),
        para([bold('1.4. '), normal('Declara así mismo "EL ARRENDADOR", que sobre dicho inmueble no pesa ningún derecho real o personal de los que sea titular persona extraña al propietario. Así mismo, declara que dicho inmueble no presenta vicios o defectos en su construcción y, por lo tanto, se encuentra en buenas condiciones para ser utilizado.')]),
        para([bold('1.5. '), normal('Que no tiene conocimiento alguno sobre si "EL ARRENDATARIO" se encuentra o ha estado involucrado, directa o indirectamente, en la comisión de delitos, particularmente aquellos que establece la Ley Nacional de Extinción De Dominio, por lo que hasta donde es de su conocimiento "EL ARRENDATARIO" se dedica exclusivamente a la realización de actividades lícitas.')]),
        para([bold('1.6. '), normal('"EL ARRENDADOR" declara haber recibido y analizado un reporte de investigación y dictamen jurídico emitido respecto de "EL ARRENDATARIO", tomando la decisión de celebrar el presente contrato con base en la información contenida en dicho reporte, por lo que se deslinda de cualquier responsabilidad derivada de información falsa, incompleta u omitida proporcionada por "EL ARRENDATARIO".')]),

        espacio(),
        para([bold('DECLARA "EL ARRENDATARIO" bajo protesta de decir verdad:')]),
        espacio(),

        para([bold('2.1. '), normal('Que es persona física de nacionalidad mexicana, con domicilio en: '), bold(d.domicilio_arrendatario),
          normal(' quien se identifica en este acto jurídico con su Credencial para votar, expedida por el Instituto Nacional Electoral, con clave de elector número: '), bold(d.clave_elector_arrendatario),
          normal(', con RFC: '), bold(d.rfc_arrendatario), normal(', con número de contacto '), bold(d.telefono_arrendatario),
          normal(', con correo electrónico: '), bold(d.correo_arrendatario), normal(' y que cuenta con la suficiente capacidad jurídica para celebrar el presente contrato.'),
        ]),
        para([bold('2.2. '), normal('Que es su voluntad tomar en arrendamiento el bien inmueble descrito en el punto 1.2 de las Declaraciones de "EL ARRENDADOR" mismo que señala como domicilio convencional para recibir todo tipo de notificaciones.')]),
        para([bold('2.3. '), normal('Que cuenta con los recursos económicos, la solvencia y las aptitudes idóneas para obligarse jurídicamente con "EL ARRENDADOR".')]),
        para([bold('2.4. '), normal('Que conoce la responsabilidad que para todos los efectos legales se refiere la LEY FEDERAL DE EXTINCIÓN DOMINIO, REGLAMENTARIA DEL ARTÍCULO 22 DE LA CONSTITUCIÓN POLITICA DE LOS ESTADOS UNIDOS MEXICANOS en sus artículos 2, 3, 5 y 8, y a sus correlativos de la LEY DE EXTINCIÓN DE DOMINIO PARA EL ESTADO DE PUEBLA, por lo que manifiesta que EL INMUEBLE arrendado en este contrato no es, ni será instrumento, objeto o producto de algún delito.')]),
        para([bold('2.5. '), normal('Que tiene como actividad laboral: '), bold(d.ocupacion_arrendatario), normal(', situación que comprueba con '), bold(d.comprobante_ingresos), normal('; manifestando que los ingresos que percibe son de esta actividad económica, por tanto los recursos con los que pagará la renta provienen de actividades lícitas.')]),
        para([bold('2.6. '), normal('Las partes reconocen que, previo a la celebración del presente contrato, EL ARRENDADOR solicitó y recibió un REPORTE DE INVESTIGACIÓN Y DICTAMEN JURÍDICO respecto de EL ARRENDATARIO, el cual incluyó la verificación de identidad, actividad económica, origen lícito de los ingresos y consulta de antecedentes legales. EL ARRENDATARIO manifiesta que toda la información y documentación proporcionada es veraz, completa, lícita y comprobable.')]),

        espacio(),
        para([bold('III. DECLARAN "LAS PARTES":')]),
        espacio(),
        para([bold('3.1. '), normal('Que es su voluntad celebrar el presente contrato de ARRENDAMIENTO, y que en el mismo no existe error, violencia, dolo, mala fe o cualquier otro vicio del consentimiento que pudiera afectar la validez del presente Contrato.')]),
        para([bold('3.2. '), normal('Que enteradas de todas y cada una de las declaraciones que anteceden manifiestan su entera conformidad con las mismas, por lo que manifiestan su consentimiento expreso para obligarse en los términos y condiciones establecidos en el presente Contrato.')]),
        para([bold('3.3. '), normal('Que, bajo protesta de decir verdad, ambas partes manifiestan reconocerse personalidad con la que se ostentan en el presente acto jurídico.')]),
        espacio(),
        para([normal('Expuesto lo anterior ambas partes están conformes en obligarse de acuerdo con el contenido de las siguientes:')]),
        espacio(),
        centrado([bold('CLAUSULAS', 22)]),

        ...clausula('PRIMERA. OBJETO.',
          para([normal('Que el objeto del presente contrato consiste en el arrendamiento del bien inmueble descrito en el punto 1.2 del Capítulo de Declaraciones del presente Instrumento.')]),
        ),
        ...clausula('SEGUNDA. CALIDAD DEL BIEN INMUEBLE.',
          para([normal('Por medio de la presente cláusula "EL ARRENDADOR" manifiesta que el bien inmueble objeto del presente contrato se encuentra en perfectas condiciones, así como todas y cada una de sus partes accesorias que lo integran, las cuales se encuentran en total estado de servir y disfrutar por parte de "EL ARRENDATARIO".')]),
        ),
        ...clausula('TERCERA. VIGENCIA.',
          para([normal('Manifiestan "EL ARRENDADOR" y "EL ARRENDATARIO" que la duración del presente contrato será de un año forzoso, que comenzarán el día '), bold(d.fecha_inicio), normal(' y terminarán el '), bold(d.fecha_termino), normal('.')]),
          para([normal('Al terminar la vigencia del presente contrato ambas partes podrán negociar la prórroga del plazo de vigencia antes de la terminación de este, pero en todo caso dicho convenio deberá constar por escrito, firmado por ambas partes.')]),
          para([normal('En caso de que las partes no llegasen a celebrar un nuevo Contrato de arrendamiento a la fecha en que termina el presente Contrato, "EL ARRENDATARIO" se obliga a desocupar sin pretexto alguno, la localidad arrendada precisamente el día del vencimiento de éste Contrato, obligándose a pagar a "EL ARRENDADOR" una pena convencional equivalente a un 100% respecto del monto de la renta señalada.')]),
        ),
        ...clausula('CUARTA. RENTA MENSUAL Y FORMA DE PAGO.',
          para([
            normal('"LAS PARTES" acuerdan que "EL ARRENDATARIO" pagará a "EL ARRENDADOR" la cantidad de '),
            bold(`${fmt(d.renta_mensual)} M.N. (${d.renta_mensual_letra})`),
            normal(' netos de manera mensual y por adelantado, dentro de los 5 días de cada mes a partir del día '),
            bold(String(d.dia_limite_pago)), normal(' mediante '), bold(d.forma_pago),
            normal(', dicho monto incluye la renta mensual y la cuota de mantenimiento.'),
          ]),
          para([normal('Ambas partes convienen expresamente en que el pago de dicha cantidad deberá hacerse en una sola exhibición y no en parcialidades, y en caso de incumplimiento por parte de "EL ARRENDATARIO", éste pagará a "EL ARRENDADOR" el 10% (diez por ciento), sobre el monto de la renta, por concepto de intereses moratorios.')]),
          para([normal('La cantidad de renta mensual pactada en la presente cláusula será vigente por el primer año, en caso de prórroga la renta aumentará un 5% (cinco por ciento) o de acuerdo con el Índice Inflacionario determinado por el Banco de México de manera anual o lo que resulte mayor, salvo pacto contrario.')]),
        ),
        ...clausula('QUINTA. SERVICIO DE PROTECCIÓN JURÍDICA EN ARRENDAMIENTO INMOBILIARIO.',
          para([normal('"EL ARRENDATARIO" se obliga a cubrir el importe de la póliza a la empresa moral denominada GRUPO INMOBILIARIO NACHON TORRES S.A. DE C.V. "EMPORIO BLINDAJE LEGAL" a la firma del presente contrato, y en su caso, durante cada período anual por concepto de servicios legales, la cuota anual que señale la carátula, misma que deberá ser cubierta en efectivo y/o depósito según sea el caso.')]),
          para([normal('"EL ARRENDATARIO" se compromete a renovar el servicio de la póliza cada 12 meses, en caso de no efectuarlo se compromete a hacer la devolución de EL INMUEBLE, por así convenirlo LAS PARTES.')]),
        ),
        ...clausula('SEXTA. SUBARRENDAMIENTO O CESIÓN DE DERECHOS.',
          para([normal('"EL ARRENDATARIO" no podrá subarrendar, ceder o traspasar sus derechos de inquilino del inmueble, en todo o en parte. El incumplimiento a esta cláusula tendrá como consecuencia que "EL ARRENDATARIO" deberá pagar a "EL ARRENDADOR" por todos y cada uno de los daños que se generen sin condición alguna.')]),
        ),
        ...clausula('SÉPTIMA. DE LA EXPROPIACIÓN.',
          para([normal('En el caso de que la propiedad en que se ubica el inmueble materia de arrendamiento sea expropiada por causa de utilidad pública, el presente contrato de arrendamiento se dará por terminado de común acuerdo y sin responsabilidad alguna para "EL ARRENDADOR".')]),
        ),
        ...clausula('OCTAVA. OBLIGACIONES DE "LAS PARTES".',
          para([bold('8.1.- DEL ARRENDADOR.-')]),
          para([normal('Durante la vigencia del presente Contrato, "EL ARRENDADOR" se obliga a:')]),
          para([normal('- Entregar a "EL ARRENDATARIO" el bien objeto de este contrato, con todos sus accesorios y servidumbres en condiciones óptimas para el uso pactado.')]),
          para([normal('- Garantizar el uso y goce pacífico del bien arrendado por el tiempo que dure el contrato.')]),
          para([normal('- Responder por los daños que se causen al inmueble en cuanto a desperfectos estructurales, así como los vicios ocultos.')]),
          para([normal('- Devolver al "EL ARRENDATARIO" el DEPÓSITO en términos de lo señalado en la Cláusula Décima Cuarta del presente Contrato.')]),
          espacio(),
          para([bold('II.- DEL ARRENDATARIO')]),
          para([normal('Durante la vigencia del presente Contrato, "EL ARRENDATARIO" se obliga a:')]),
          para([normal('- Pagar la renta en el lugar, tiempo y forma convenidos en el clausulado del presente Contrato.')]),
          para([normal('- Pagar puntualmente los recibos de Luz, agua, teléfono, Internet y cualquier otro servicio que contrate con terceros.')]),
          para([normal('- Responder de los daños que el inmueble sufra por su culpa o negligencia.')]),
          para([normal('- No usar o disponer el inmueble para un fin distinto al de "Casa Habitación".')]),
          para([normal('- No subarrendar, total o parcialmente el inmueble, ni ceder o traspasar los derechos derivados del presente Contrato.')]),
          para([normal('- Devolver el inmueble a "EL ARRENDADOR" en las mismas condiciones en que lo recibió originalmente.')]),
          para([normal('- Respetar el Reglamento Interior de Condominios si hubiere.')]),
        ),
        ...clausula('NOVENA. RESCISIÓN DE CONTRATO Y DESOCUPACIÓN DEL INMUEBLE.',
          para([normal('Serán causas de rescisión de este Contrato, sin necesidad de resolución judicial previa:')]),
          para([normal('- La falta de pago, pago extemporáneo o pago parcial de dos mensualidades de renta.')]),
          para([normal('- Que "EL ARRENDATARIO" subarriende en todo o en parte el INMUEBLE.')]),
          para([normal('- Que "EL ARRENDATARIO" destine EL INMUEBLE a fines distintos del convenido.')]),
          para([normal('- Incurrir de manera reiterada al reglamento del clúster y/o fraccionamiento.')]),
          para([normal('- Será causa grave de rescisión inmediata la falsedad, omisión o alteración de la información o documentación proporcionada por "EL ARRENDATARIO".')]),
        ),
        ...clausula('DÉCIMA. DE LA DESOCUPACIÓN ANTICIPADA DEL INMUEBLE.',
          para([normal('"LAS PARTES" convienen que si "EL ARRENDATARIO" desocupa el inmueble por causas imputables a él, antes de la fecha señalada para la terminación del presente contrato, éste se obliga expresamente a pagar a "EL ARRENDADOR" dos meses de renta y no se le devolvería el mes de depósito, por concepto de daños y perjuicios causados por el incumplimiento de este Contrato.')]),
        ),
        ...clausula('DÉCIMA PRIMERA. DEL USO DEL BIEN INMUEBLE.',
          para([normal('El bien inmueble será destinado única y exclusivamente para USO HABITACIONAL, del cual podrá usar y disponer en forma ordenada y pacífica, quedando prohibido expresamente el uso del mismo contrario a la ley, la moral y las buenas costumbres.')]),
        ),
        ...clausula('DÉCIMA SEGUNDA. LICITUD DE LAS ACTIVIDADES DE "EL ARRENDATARIO" CONFORME A LA LFPIORPI.',
          para([
            normal('En relación con la Ley Federal de Prevención e Identificación de Operaciones con Recursos de Procedencia Ilícita, las partes acuerdan que los pagos que realice "EL ARRENDATARIO" deberán ser con fondos propios y procedentes de actividades lícitas. Al efecto "EL ARRENDATARIO" manifiesta obtener sus ingresos por '), bold(d.ocupacion_arrendatario),
            normal(' por lo que manifiesta bajo protesta de decir verdad que los recursos con los que pagará la renta provienen de actividades lícitas y que el inmueble no será destinado para la realización de ningún hecho ilícito.'),
          ]),
        ),
        ...clausula('DÉCIMA TERCERA. DE LA ENTREGA DEL BIEN INMUEBLE.',
          para([normal('"EL ARRENDADOR", se obliga a entregar el bien inmueble objeto del presente contrato con todos los servicios funcionando y en buen estado, el día '), bold(d.fecha_entrega_posesion), normal('.')]),
          para([normal('"EL ARRENDATARIO" se obliga a entregar el bien inmueble en las condiciones en que lo recibe, sin dejar deudas pendientes de los servicios que haya contratado.')]),
        ),
        ...clausula('DÉCIMA CUARTA. DE LA DEVOLUCIÓN DEL DEPÓSITO.',
          para([
            normal('En la firma de este contrato se entrega la cantidad de '),
            bold(`${fmt(d.deposito_garantia)} M.N. (${d.deposito_garantia_letra})`),
            normal(' por concepto del depósito, el cual "EL ARRENDADOR" se compromete a devolver a "EL ARRENDATARIO" dentro de los treinta días naturales siguientes a la terminación del presente contrato.'),
          ]),
          para([normal('El depósito no es aplicable a las rentas por ningún concepto, ni causará intereses.')]),
        ),
        ...clausula('DÉCIMA QUINTA. SOBRE LA TENENCIA DE ANIMALES.',
          para([normal(
            (d.mascotas_permitidas === 'si' || d.mascotas_permitidas === 'condicionado')
              ? '"EL ARRENDATARIO", así como sus visitas, serán conjunta e individualmente responsables de pagar todos los daños causados por las mascotas que entren al inmueble y/o vivan dentro de él, así como toda limpieza, erradicación de pulgas y eliminación de olores.'
              : 'No se permite la tenencia de mascotas en el inmueble arrendado. El incumplimiento de esta disposición será causa de rescisión del presente contrato.'
          )]),
        ),
        ...clausula('DÉCIMA SEXTA. DE LA EXCLUSIÓN DE GASTOS.',
          para([normal('"LAS PARTES" acuerdan que en el pago de la renta no se incluyen servicios como agua potable, energía eléctrica, gas, teléfono, televisión por cable, internet, alarma o cualquier otro servicio que se contrate con terceros, los cuales serán por cuenta exclusiva de "EL ARRENDATARIO".')]),
        ),
        ...clausula('DÉCIMA SÉPTIMA. DERECHO DEL TANTO Y TRANSMISIÓN DEL INMUEBLE.',
          para([normal('"EL ARRENDATARIO" en este acto renuncia expresamente al derecho del tanto establecido en el Artículo 30 del Código Civil para el Estado Libre y Soberano de Puebla en caso de que "EL ARRENDADOR" desee vender el INMUEBLE.')]),
        ),
        ...clausula('DÉCIMA OCTAVA. DEL JUICIO ORAL SUMARISIMO.',
          para([normal('Manifiestan ambas partes someterse al Juicio Oral Sumarísimo para la solución de los conflictos que pudiesen derivarse del incumplimiento de las obligaciones dentro del presente contrato, tal y como lo establecen los Artículos 574 al 586 del Código de Procedimientos Civiles para el Estado de Puebla.')]),
        ),
        ...clausula('DÉCIMA NOVENA. CASO FORTUITO O CAUSAS DE FUERZA MAYOR.',
          para([normal('Las partes convienen que si durante la vigencia del presente instrumento acontecieran sucesos que aparejen caso fortuito o causa de fuerza mayor, resultando de estos la inhabitación del inmueble, se supeditarán a los preceptos de derecho consagrados en el artículo 2318 del Código Civil para el Estado Libre y Soberano de Puebla.')]),
        ),
        ...clausula('VIGÉSIMA. DE LA RESPONSABILIDAD DE EL ARRENDATARIO POR ROBO.',
          para([normal('"EL ARRENDADOR" no responde ante "EL ARRENDATARIO" por el robo o extravío de bienes propiedad de éste dentro del INMUEBLE.')]),
        ),
        ...clausula('VIGÉSIMA PRIMERA. AVISO DE PRIVACIDAD.',
          para([normal('Las partes se obligan a que la información contenida en este contrato, sólo podrá ser usada para los fines propios de este acto jurídico, por lo que cualquier uso distinto al pactado será considerado como incumplimiento de contrato.')]),
        ),
        ...clausula('VIGÉSIMA SEGUNDA.',
          para([normal('Será motivo de rescisión del presente contrato el incumplimiento de cualquiera de las cláusulas antes descritas, así como por el abuso en el ruido emitido dentro y fuera del inmueble.')]),
        ),
        ...clausula('VIGÉSIMA TERCERA. DE LAS NOTIFICACIONES.',
          para([normal('LAS PARTES señalan para efectos de las notificaciones y/o requerimientos previstas en este CONTRATO las cuentas de correo electrónico señaladas en el apartado de declaraciones.')]),
        ),
        ...clausula('VIGÉSIMA CUARTA. CONTRATACIÓN POR MEDIOS ELECTRÓNICOS.',
          para([normal('Las partes acuerdan que en lugar de una firma original autógrafa, este contrato podrá ser firmado por medio del uso de firmas electrónicas, digitales, biométricas o de cualquier otra forma, con la misma fuerza y consecuencias que la firma autógrafa original.')]),
        ),
        ...clausula('VIGÉSIMA QUINTA. DE LOS TRIBUNALES COMPETENTES Y LEGISLACIÓN APLICABLE.',
          para([normal('Para la interpretación y cumplimiento de este contrato, las partes acuerdan someterse a la aplicación de las leyes mexicanas y a la jurisdicción de los Tribunales competentes de la Ciudad de Puebla, Puebla, por lo que renuncian a cualquier otro fuero que pudiese corresponderle a razón de su domicilio presente o futuro.')]),
        ),

        // Cierre
        espacio(), espacio(),
        para([
          normal('Enteradas las partes previa lectura del presente instrumento, el cual consta de nueve hojas útiles y pleno conocimiento de su contenido y alcance legal que causa el presente contrato, lo firman por triplicado en su totalidad en la ciudad de '),
          bold(d.ciudad_estado), normal(' el día '), bold(d.fecha_firma), normal('.'),
        ]),
        espacio(), espacio(), espacio(),
        firmaTable(
          { nombre: d.nombre_arrendatario, rol: '"EL ARRENDATARIO"' },
          { nombre: d.nombre_arrendador,   rol: '"EL ARRENDADOR"' }
        ),

        // ANEXO A
        pageBreak(),
        centrado([bold(`ANEXO "A" DEL INMUEBLE UBICADO EN: ${d.direccion_inmueble}`, 20)]),
        espacio(),

        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [6240, 3120],
          rows: [
            new TableRow({
              children: [
                new TableCell({ width: { size: 6240, type: WidthType.DXA }, shading: { fill: 'D5E8F0', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [bold('DESCRIPCIÓN')] })] }),
                new TableCell({ width: { size: 3120, type: WidthType.DXA }, shading: { fill: 'D5E8F0', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [bold('OBSERVACIONES')] })] }),
              ]
            }),
            ...[
              '1. Lámparas en todo el inmueble.',
              '2. Calentador de agua en buen estado y funcionando.',
              '3. Paredes y techos recién pintados, sin rayones y sin perforaciones o desperfectos.',
              '4. Vidrios y azulejos sin roturas, astilladuras o cualquier daño.',
              '5. Accesorios de baños completos en buen estado y funcionando.',
              '6. Cocina integral completa, con estufa, tarja en buen estado y funcionando.',
              '7. Instalaciones hidráulicas y eléctricas tales como llaves, regaderas, apagadores y tomas de corriente completas y funcionando.',
              '8. Puertas de recámaras y baños, bien pintadas y sin daños, con chapas completas y llave.',
              '9. Puerta principal de acceso bien pintada, sin daños, con chapa completa y llave.',
              '10. Persianas.',
              '11. Otros.',
            ].map(item => new TableRow({
              children: [
                new TableCell({ width: { size: 6240, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [normal(item)] })] }),
                new TableCell({ width: { size: 3120, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [normal('')] })] }),
              ]
            }))
          ]
        }),

        espacio(), espacio(),
        firmaTable(
          { nombre: d.nombre_arrendatario, rol: '"EL ARRENDATARIO"' },
          { nombre: d.nombre_arrendador,   rol: '"EL ARRENDADOR"' }
        ),
      ]
    }]
  })

  // Descargar en el navegador
  const buffer = await Packer.toBlob(doc)
  const url = URL.createObjectURL(buffer)
  const a = document.createElement('a')
  a.href = url
  a.download = `Contrato_${d.nombre_arrendatario.replace(/\s+/g, '_')}_${exp.fecha_firma || 'borrador'}.docx`
  a.click()
  URL.revokeObjectURL(url)
}
