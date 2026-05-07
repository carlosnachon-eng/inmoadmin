// lib/generarContrato.js
// Genera el contrato de arrendamiento en .docx y lo descarga directamente

// ─── Número a letra ────────────────────────────────────────
function numeroALetra(n) {
  if (!n || isNaN(n)) return ''
  const entero = Math.floor(Number(n))
  const cents = Math.round((Number(n) - entero) * 100)

  const unidades = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE',
    'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE',
    'VEINTE', 'VEINTIÚN', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE']
  const decenas = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA']
  const centenas = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS']

  function cientos(num) {
    if (num === 0) return ''
    if (num === 100) return 'CIEN'
    const c = Math.floor(num / 100)
    const resto = num % 100
    let r = c > 0 ? centenas[c] + (resto > 0 ? ' ' : '') : ''
    if (resto > 0 && resto < 30) {
      r += unidades[resto]
    } else if (resto >= 30) {
      const d = Math.floor(resto / 10)
      const u = resto % 10
      r += decenas[d] + (u > 0 ? ' Y ' + unidades[u] : '')
    }
    return r.trim()
  }

  function menorMil(num) {
    // Handles 1-999 correctly
    if (num <= 0) return ''
    if (num < 30) return unidades[num]
    if (num < 100) {
      const d = Math.floor(num / 10)
      const u = num % 10
      return decenas[d] + (u > 0 ? ' Y ' + unidades[u] : '')
    }
    return cientos(num)
  }

  function miles(num) {
    if (num === 0) return ''
    if (num < 1000) return menorMil(num)
    const m = Math.floor(num / 1000)
    const resto = num % 1000
    let r = m === 1 ? 'MIL' : menorMil(m) + ' MIL'
    if (resto > 0) r += ' ' + menorMil(resto)
    return r.trim()
  }

  function millones(num) {
    if (num === 0) return 'CERO'
    if (num < 1000000) return miles(num)
    const mill = Math.floor(num / 1000000)
    const resto = num % 1000000
    let r = mill === 1 ? 'UN MILLÓN' : menorMil(mill) + ' MILLONES'
    if (resto > 0) r += ' ' + miles(resto)
    return r.trim()
  }

  return `${millones(entero)} ${String(cents).padStart(2, '0')}/100 M.N.`
}

export async function generarContratoArrendamiento(exp) {
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    AlignmentType, BorderStyle, WidthType, ShadingType,
  } = await import('docx')

  const fmt = (n) => n ? `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : '$0.00'

  const fmtFecha = (d) => {
    if (!d) return '___/___/______'
    if (typeof d === 'string' && d.includes('/')) return d
    return new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  // Día del mes de inicio
  const diaInicio = (() => {
    if (!exp.fecha_inicio) return exp.dia_limite_pago || 5
    if (typeof exp.fecha_inicio === 'string' && exp.fecha_inicio.includes('/'))
      return exp.fecha_inicio.split('/')[0]
    return new Date(exp.fecha_inicio + 'T12:00:00').getDate()
  })()

  const bold   = (text, size = 20) => new TextRun({ text: String(text ?? ''), bold: true, size, font: 'Arial' })
  const normal = (text, size = 20) => new TextRun({ text: String(text ?? ''), size, font: 'Arial' })

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
  const espacio = () => new Paragraph({ children: [new TextRun({ text: '', size: 20 })], spacing: { before: 40, after: 40 } })
  const pageBreak = () => new Paragraph({ children: [new TextRun({ text: '', size: 20 })], pageBreakBefore: true })
  const clausula = (titulo, ...parrafos) => [espacio(), para([bold(titulo)]), ...parrafos]

  const noBorder  = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }

  const firmaTable = (izq, der) => new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [4680, 4680],
    borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideH: noBorder, insideV: noBorder },
    rows: [new TableRow({ children: [
      new TableCell({ borders: noBorders, width: { size: 4680, type: WidthType.DXA }, children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '_______________________________', size: 20, font: 'Arial' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [bold(izq.nombre)] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [normal(izq.rol)] }),
      ]}),
      new TableCell({ borders: noBorders, width: { size: 4680, type: WidthType.DXA }, children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '_______________________________', size: 20, font: 'Arial' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [bold(der.nombre)] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [normal(der.rol)] }),
      ]}),
    ]})]
  })

  const d = {
    nombre_arrendador:          exp.nombre_arrendador || '',
    domicilio_arrendador:       exp.domicilio_arrendador || '',
    rfc_arrendador:             exp.rfc_arrendador || '',
    clave_elector_arrendador:   exp.clave_elector_arrendador || '',
    telefono_arrendador:        exp.telefono_arrendador || '',
    correo_arrendador:          exp.correo_arrendador || '',
    nombre_arrendatario:        exp.nombre_arrendatario || '',
    domicilio_arrendatario:     exp.domicilio_arrendatario || '',
    rfc_arrendatario:           exp.rfc_arrendatario || '',
    clave_elector_arrendatario: exp.clave_elector_arrendatario || '',
    telefono_arrendatario:      exp.telefono_arrendatario || '',
    correo_arrendatario:        exp.correo_arrendatario || '',
    ocupacion:                  exp.ocupacion_arrendatario || '',
    comprobante:                exp.comprobante_ingresos || 'Estados de cuenta',
    direccion:                  exp.direccion_inmueble || '',
    ciudad:                     exp.ciudad_estado_inmueble || 'Puebla, Puebla',
    renta:                      Number(exp.renta_mensual) || 0,
    renta_letra: numeroALetra(Number(exp.renta_mensual)),
    deposito:                   Number(exp.deposito_garantia) || 0,
    deposito_letra: numeroALetra(Number(exp.deposito_garantia)),
    forma_pago:                 exp.forma_pago || 'Efectivo',
    dia:                        String(diaInicio),
    fi:                         fmtFecha(exp.fecha_inicio),
    ft: (() => {
      if (exp.fecha_termino) return fmtFecha(exp.fecha_termino)
      if (exp.fecha_inicio) {
        const fi = exp.fecha_inicio.includes('/') 
          ? exp.fecha_inicio.split('/').reverse().join('-')
          : exp.fecha_inicio
        const d = new Date(fi + 'T12:00:00')
        d.setFullYear(d.getFullYear() + 1)
        d.setDate(d.getDate() - 1)
        return d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' })
      }
      return '___/___/______'
    })(),
    fe:                         fmtFecha(exp.fecha_entrega_posesion),
    ff:                         fmtFecha(exp.fecha_firma),
    mascotas:                   exp.mascotas_permitidas || 'no',
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } },
      children: [

        para([bold('CONTRATO DE ARRENDAMIENTO QUE CELEBRAN POR UNA PARTE EL C. '), bold(d.nombre_arrendador),
          bold(' A QUIEN EN LO SUCESIVO SE LE DENOMINARÁ '), bold('"EL ARRENDADOR"'),
          bold(', Y POR OTRA PARTE '), bold(d.nombre_arrendatario),
          bold(', A QUIEN EN LO SUCESIVO SE LE DENOMINARÁ, '), bold('"EL ARRENDATARIO"'),
          bold(', A QUIENES EN CONJUNTO SE LES DENOMINARÁ "LAS PARTES" Y QUIENES SE SUJETAN AL TENOR DE LAS SIGUIENTES DECLARACIONES Y CLÁUSULAS:'),
        ]),

        espacio(), centrado([bold('DECLARACIONES', 22)]), espacio(),
        para([bold('DECLARA "EL ARRENDADOR", bajo protesta de decir verdad:')]), espacio(),

        para([bold('1.1. '), normal('Que es persona física de nacionalidad mexicana, con domicilio en: '), bold(d.domicilio_arrendador),
          normal(' quien se identifica en este acto jurídico con su Credencial para votar, expedida por el Instituto Nacional Electoral, con clave de elector número: '), bold(d.clave_elector_arrendador),
          normal(', con RFC: '), bold(d.rfc_arrendador), normal(', con número de contacto '), bold(d.telefono_arrendador),
          normal(', con correo electrónico: '), bold(d.correo_arrendador), normal(' y que cuenta con la suficiente capacidad jurídica para celebrar el presente contrato.'),
        ]),
        para([bold('1.2. '), normal('Que es legítimo propietario de la Casa Habitación ubicada en: '), bold(d.direccion), normal('.')]),
        para([bold('1.3. '), normal('Que su deseo celebrar el presente contrato de Arrendamiento, a efecto de que "EL ARRENDATARIO" tome en arrendamiento el inmueble citado en el punto número 1.2 párrafo que antecede, el cual será utilizado exclusivamente como Casa Habitación.')]),
        para([bold('1.4. '), normal('Declara así mismo "EL ARRENDADOR", que sobre dicho inmueble no pesa ningún derecho real o personal de los que sea titular persona extraña al propietario.')]),
        para([normal('Así mismo, declara que dicho inmueble no presenta vicios o defectos en su construcción y, por lo tanto, aunado esto a la infraestructura que lo constituye, se encuentra en buenas condiciones para ser utilizado.')]),
        para([bold('1.5. '), normal('Que no tiene conocimiento alguno sobre si "EL ARRENDATARIO" se encuentra o ha estado involucrado, directa o indirectamente, en la comisión de delitos, particularmente aquellos que establece la Ley Nacional de Extinción De Dominio y los que menciona La Constitución Política de Los Estados Unidos Mexicanos, por lo que hasta donde es de su conocimiento "EL ARRENDATARIO" se dedica exclusivamente a la realización de actividades lícitas.')]),
        para([bold('1.6. '), normal('Que al no conocer sobre la realización por parte de "EL ARRENDATARIO" de ninguno de los hechos ilícitos y delitos a los que se refieren la Ley Nacional De Extinción De Dominio, actúa con absoluta buena fe en la celebración de este Contrato.')]),
        para([bold('1.7. '), normal('"EL ARRENDADOR" declara haber recibido y analizado un reporte de investigación y dictamen jurídico emitido respecto de "EL ARRENDATARIO", tomando la decisión de celebrar el presente contrato con base en la información contenida en dicho reporte, por lo que se deslinda de cualquier responsabilidad derivada de información falsa, incompleta u omitida proporcionada por "EL ARRENDATARIO".')]),

        espacio(), para([bold('DECLARA "EL ARRENDATARIO" bajo protesta de decir verdad:')]), espacio(),

        para([bold('2.1. '), normal('Que es persona física de nacionalidad mexicana, con domicilio en: '), bold(d.domicilio_arrendatario),
          normal(' quien se identifica en este acto jurídico con su Credencial para votar, expedida por el Instituto Nacional Electoral, con clave de elector número: '), bold(d.clave_elector_arrendatario),
          normal(', con RFC: '), bold(d.rfc_arrendatario), normal(', con número de contacto '), bold(d.telefono_arrendatario),
          normal(', con correo electrónico: '), bold(d.correo_arrendatario), normal(' y que cuenta con la suficiente capacidad jurídica para celebrar el presente contrato.'),
        ]),
        para([bold('2.2. '), normal('Que es su voluntad tomar en arrendamiento el bien inmueble descrito en el punto 1.2 de las Declaraciones de "EL ARRENDADOR" mismo que señala como domicilio convencional para recibir todo tipo de notificaciones.')]),
        para([bold('2.3. '), normal('Que cuenta con los recursos económicos, la solvencia y las aptitudes idóneas para obligarse jurídicamente con "EL ARRENDADOR".')]),
        para([bold('2.4. '), normal('Que conoce la responsabilidad que para todos los efectos legales se refiere la LEY FEDERAL DE EXTINCIÓN DOMINIO, REGLAMENTARIA DEL ARTÍCULO 22 DE LA CONSTITUCIÓN POLITICA DE LOS ESTADOS UNIDOS MEXICANOS en sus artículos 2, 3, 5 y 8, y a sus correlativos de la LEY DE EXTINCIÓN DE DOMINIO PARA EL ESTADO DE PUEBLA, los cuales se dan por reproducidos como si a la letra se insertasen; por lo que manifiesta que EL INMUEBLE arrendado en este contrato no es, ni será instrumento, objeto producto de algún delito; tampoco será utilizado o destinado a ocultar o bienes del producto de algún delito; y que si son utilizados para la utilización de un delito, el "ARRENDADOR" no tiene conocimiento de dicho ilícito, relevándolo en su caso de cualquier responsabilidad.')]),
        para([bold('2.5. '), normal('Que tiene como actividad laboral: '), bold(d.ocupacion),
          normal(' situación que comprueba con '), bold(d.comprobante),
          normal('; manifestando que los ingresos que percibe son de esta actividad económica, por tanto los recursos con los que pagará la renta provienen de actividades lícitas.'),
        ]),
        para([bold('2.6. '), normal('Las partes reconocen que, previo a la celebración del presente contrato, EL ARRENDADOR solicitó y recibió un REPORTE DE INVESTIGACIÓN Y DICTAMEN JURÍDICO respecto de EL ARRENDATARIO, el cual incluyó, entre otros aspectos, la verificación de identidad, actividad económica, origen lícito de los ingresos y consulta de antecedentes legales, como parte de un proceso de diligencia razonable. EL ARRENDATARIO manifiesta que toda la información y documentación proporcionada para la elaboración de dicho reporte es veraz, completa, lícita y comprobable.')]),

        espacio(), para([bold('III. DECLARAN "LAS PARTES":')]), espacio(),
        para([bold('3.1. '), normal('Que es su voluntad celebrar el presente contrato de ARRENDAMIENTO, y que en el mismo no existe error, violencia, dolo, mala fe o cualquier otro vicio del consentimiento que pudiera afectar la validez del presente Contrato.')]),
        para([bold('3.2. '), normal('Que enteradas de todas y cada una de las declaraciones que anteceden manifiestan su entera conformidad con las mismas, por lo que manifiestan su consentimiento expreso para obligarse en los términos y condiciones establecidos en el presente Contrato, manifestando su conformidad para que en el mismo surtan todos los efectos legales correspondientes y que para tal efecto dispone la Ley de la materia.')]),
        para([bold('3.3. '), normal('Que, bajo protesta de decir verdad, ambas partes manifiestan reconocerse personalidad con la que se ostentan en el presente acto jurídico.')]),
        espacio(),
        para([normal('Expuesto lo anterior ambas partes están conformes en obligarse de acuerdo con el contenido de las siguientes:')]),
        espacio(), centrado([bold('CLAUSULAS', 22)]),

        ...clausula('PRIMERA. OBJETO.',
          para([normal('Que el objeto del presente contrato consiste en el arrendamiento del bien inmueble descrito en el punto 1.2 del Capítulo de Declaraciones del presente Instrumento.')]),
        ),
        ...clausula('SEGUNDA. CALIDAD DEL BIEN INMUEBLE.',
          para([normal('Por medio de la presente cláusula "EL ARRENDADOR" manifiesta que el bien inmueble objeto del presente contrato se encuentra en perfectas condiciones, así como todas y cada una de sus partes accesorias que lo integran, las cuales se encuentran en total estado de servir y disfrutar por parte de "EL ARRENDATARIO".')]),
        ),
        ...clausula('TERCERA. VIGENCIA.',
          para([normal('Manifiestan "EL ARRENDADOR" y "EL ARRENDATARIO" que la duración del presente contrato será de '), bold('un año forzoso, que comenzarán el día '), bold(d.fi), bold(' y terminarán el '), bold(d.ft)]),
          para([normal('Al terminar la vigencia del presente contrato ambas partes podrán negociar la prórroga del plazo de vigencia del presente contrato antes de la terminación de este, junto con el incremento respectivo a la renta mensual, pero en todo caso dicho convenio deberá constar por escrito, firmado por ambas partes.')]),
          para([normal('Si por el contrario EL ARRENDATARIO no desea renovar el plazo del arrendamiento, deberá dar aviso por escrito a EL ARRENDADOR con treinta días naturales de anticipación a la fecha de vencimiento del plazo y lo autoriza a poner cédulas visibles en el exterior del INMUEBLE ofreciéndolo en arrendamiento.')]),
          para([normal('En caso de que las partes no llegasen a celebrar un nuevo Contrato de arrendamiento a la fecha en que termina el presente Contrato, "EL ARRENDATARIO" se obliga a desocupar sin pretexto alguno, la localidad arrendada precisamente el día del vencimiento de éste Contrato, obligándose a que en su caso de no hacerlo pagará a "EL ARRENDADOR" una pena convencional equivalente a un 100% respecto del monto de la renta señalada y adicional a ésta, de acuerdo a lo dispuesto por el artículo 1489 del Código Civil para el Estado de Puebla, y ello con independencia del pago de la renta correspondiente, la que deberá cubrirse en los términos de la cláusula siguiente, sin que ello implique en forma alguna novación prórroga de éste Contrato.')]),
          para([normal('Renunciando expresamente para este caso "EL ARRENDATARIO" a lo dispuesto en el artículo 2323, en relación con el 2332, fracción II del Código Civil para el Estado de Puebla.')]),
        ),
        ...clausula('CUARTA. RENTA MENSUAL Y FORMA DE PAGO.',
          para([
            normal('"LAS PARTES" acuerdan que "EL ARRENDATARIO" a "EL ARRENDADOR" o a quien en su derecho la represente, la cantidad de '),
            bold(`${fmt(d.renta)} M.N. (`), bold(d.renta_letra), bold(' PESOS)'),
            normal(' netos de manera mensual y por adelantado, dentro de los 5 días de cada mes a partir del dia '),
            bold(d.dia), normal(' mediante '), bold(d.forma_pago),
            normal(', dicho monto incluye la renta mensual y la cuota de mantenimiento.'),
          ]),
          para([normal('Ambas partes convienen expresamente en que el pago de dicha cantidad deberá hacerse en una sola exhibición y no en parcialidades, y en caso de incumplimiento por parte de "EL ARRENDATARIO", éste pagará a "EL ARRENDADOR" el 10% (diez por ciento), sobre el monto de la renta, por concepto de intereses moratorios, obligándose "EL ARRENDATARIO" a no retener por ningun motivo alguno la renta pactada.')]),
          para([normal('Si "EL ARRENDATARIO" llega a depositar la renta y ponerla a disposición de "EL ARRENDADOR" ante cualquier juzgado deberá dar aviso inmediato por escrito a "EL ARRENDADOR", indicándole la causa que tuvo para hacerlo dentro de un plazo de cinco días naturales, el lugar en donde se encuentra depositada y continuar efectuando las consignaciones en el mismo sitio, estando conforme que en caso de no hacerlo cubrirá un 10% de dicha cantidad como pena convencional. De lo contrario la renta depositada no se entenderá pagada para los efectos conducentes.')]),
          para([normal('La cantidad de renta mensual pactada en la presente cláusula será vigente por el primer año, en caso de que "LAS PARTES" convengan la prórroga del plazo de vigencia del presente contrato, la renta aumentará, un 5% (cinco por ciento) o de acuerdo con el Índice Inflacionario determinado por el Banco de México de manera anual o lo que resulte mayor, salvo pacto contrario que exista entre ambas.')]),
          para([normal('Asimismo en caso de el incumplimiento del pago de dos meses continuos de renta autoriza "EL ARRENDATARIO" a "EL ARRENDADOR" a restringir, limitar y/o cortar los servicios como son agua potable, energía eléctrica y/o servicio de mantenimiento (uso del servicio de caseta y los que este proporcione según sea el caso), por así convenirlo "LAS PARTES".')]),
        ),
        ...clausula('QUINTA. SERVICIO DE PROTECCIÓN JURÍDICA EN ARRENDAMIENTO INMOBILIARIO.',
          para([normal('"EL ARRENDATARIO" se obliga a cubrir el importe de la póliza a la empresa moral denominada GRUPO INMOBILIARIO NACHON TORRES S.A. DE C.V. "EMPORIO BLINDAJE LEGAL" a la firma del presente contrato, y en su caso, durante cada período anual por concepto de servicios legales, la cuota anual que señale la carátula, misma que deberá ser cubierta en efectivo y/o depósito según sea el caso; en caso de no ser cubierto el pago en su totalidad, se suspenderán los servicios legales sin responsabilidad para la empresa antes citada.')]),
          para([normal('"EL ARRENDATARIO" se compromete a renovar el servicio de la póliza cada 12 meses, en caso de no efectuarlo se compromete a hacer la devolución de EL INMUEBLE, por así convenirlo LAS PARTES.')]),
        ),
        ...clausula('SEXTA. SUBARRENDAMIENTO O CESIÓN DE DERECHOS.',
          para([normal('"EL ARRENDATARIO" no podrá subarrendar, ceder o traspasar sus derechos de inquilino del inmueble, en todo o en parte.')]),
          para([normal('El incumplimiento a esta cláusula tendrá como consecuencia que "EL ARRENDATARIO" deberá pagar a "EL ARRENDADOR" por todos y cada uno de los daños que se generen sin condición alguna, siendo nulo de pleno derecho el convenio que haya celebrado con terceros.')]),
        ),
        ...clausula('SÉPTIMA. DE LA EXPROPIACIÓN.',
          para([normal('En el caso de que la propiedad en que se ubica el inmueble materia de arrendamiento sea expropiado por causa de utilidad pública, el presente contrato de arrendamiento se dará por terminado de común acuerdo y sin responsabilidad alguna para "EL ARRENDADOR" y la indemnización que corresponda por la expropiación, será de la exclusiva propiedad de "EL ARRENDADOR".')]),
          para([normal('"EL ARRENDATARIO" no podrá reclamar a "EL ARRENDADOR" pago o reparación alguna por dicho concepto.')]),
        ),
        ...clausula('OCTAVA. OBLIGACIONES DE "LAS PARTES".',
          para([bold('8.1.- DEL ARRENDADOR.-')]),
          para([normal('Durante la vigencia del presente Contrato, "EL ARRENDADOR" se obliga además de cualquier otra obligación que tuviere conforme a este Contrato, a lo siguiente:')]),
          para([normal('- Entregar a "EL ARRENDATARIO" el bien objeto de este contrato, con todos sus accesorios y servidumbres en condiciones óptimas para el uso pactado;')]),
          para([normal('- Garantizar el uso y goce pacífico del bien arrendado por el tiempo que dure el contrato;')]),
          para([normal('- Responder por los daños que se causen al inmueble en cuanto a desperfectos estructurales, así como los vicios ocultos (instalaciones eléctricas, hidráulicas, etc.) los cuales deberán notificársele por escrito a más tardar treinta días naturales;')]),
          para([normal('- Entregar reglamentos ya sea de forma impresa o digital según sea el caso;')]),
          para([normal(d.mascotas === 'si' || d.mascotas === 'condicionado'
            ? '- Se autoriza la tenencia de mascotas del "EL ARRENDATARIO" en el inmueble conforme a lo establecido en la clausula DÉCIMA QUINTA, del presente contrato;'
            : '- No se permite la tenencia de mascotas en el inmueble arrendado;'
          )]),
          para([normal('- Devolver al "EL ARRENDATARIO" el DEPÓSITO en términos de lo señalado en la Cláusula Décima Cuarta del presente Contrato, una vez validado y entregado el reporte de daños, así como la cotización, para hacer el descuento según sea el caso, y/o entregarlo completo en caso de no existir cobro alguno.')]),
          espacio(),
          para([bold('II.- DEL ARRENDATARIO')]),
          para([normal('Durante la vigencia del presente Contrato, "EL ARRENDATARIO" se obliga además de cualquier otra obligación que tuviere conforme a este Contrato, a lo siguiente:')]),
          para([normal('- Pagar la renta en el lugar, tiempo y forma convenidos en el clausulado del presente Contrato.')]),
          para([normal('- Pagar puntualmente los recibos correspondientes, Luz, agua, teléfono, Internet y cualquier otro servicio que contrate posteriormente con terceros.')]),
          para([normal('- En caso de contratar servicio de internet y/o servicio de larga distancia, "EL ARRENDATARIO" se obliga a cancelar el o los servicios antes de la desocupación y/o terminación de la vigencia presente.')]),
          para([normal('- Responder de los daños que el inmueble sufra por su culpa o negligencia, ya sea por sus actos u omisiones o de la(s) persona(s) a quien(es) le(s) haya permitido el acceso al mismo.')]),
          para([normal('- No usar o disponer el inmueble para un fin distinto al de "Casa Habitación".')]),
          para([normal('- "EL ARRENDATARIO", se ve obligado a indemnizar a "EL ARRENDADOR", por cualquier daño a la localidad arrendada, cuando esta la haya sufrido por culpa de "EL ARRENDATARIO", empleados o cualquier otra persona que acuda a la misma, de acuerdo con el presupuesto que "EL ARRENDADOR" le presente.')]),
          para([normal('- No subarrendar, total o parcialmente el inmueble, ni ceder o traspasar los derechos derivados del presente Contrato.')]),
          para([normal('- No introducir materiales explosivos, sustancias ilegales o cualquier material prohibido por las autoridades mexicanas.')]),
          para([normal('- No desarrollar actividades de narcotráfico, lavado de dinero, trata de blancas y cualquier otra actividad prohibida por las autoridades mexicanas.')]),
          para([normal('- Permitir a "EL ARRENDADOR" o las personas autorizadas por éste por escrito, el acceso al inmueble, con objeto de comprobar su estado físico y/o llevar a cabo las reparaciones y mantenimiento necesario en su caso.')]),
          para([normal('- Devolver el inmueble a "EL ARRENDADOR" en las mismas condiciones en que lo recibió originalmente.')]),
          para([normal('- Respetar el Reglamento Interior de Condominios si hubiere; por lo que en caso de ser acreedor a una multa por el incumplimiento del mismo deberá hacerse responsable.')]),
        ),
        ...clausula('NOVENA. RESCISIÓN DE CONTRATO Y DESOCUPACIÓN DEL INMUEBLE.',
          para([normal('Serán causas de rescisión de este Contrato, sin necesidad de resolución judicial previa, además de las previstas en el Código Civil para el Estado de Puebla y en otras disposiciones del presente Contrato, debiendo desocupar en un plazo no mayor a diez días naturales posteriores a la notificación de la rescisión ya sea por escrito, directamente en EL INMUEBLE o por medios electrónicos, establecidos en las declaraciones de "EL ARRENDATARIO":')]),
          para([normal('- La falta de pago, pago extemporáneo o pago parcial de dos mensualidades de renta, cuota de mantenimiento si hubiere y/o cuota por concepto de servicios;')]),
          para([normal('- Que "EL ARRENDATARIO" subarriende en todo o en parte el INMUEBLE, o ceda en todo o en parte sus derechos, sin el consentimiento de "EL ARRENDADOR";')]),
          para([normal('- Que "EL ARRENDATARIO" destine EL INMUEBLE a fines distintos del convenido;')]),
          para([normal('- Incurrir de manera reiterada al reglamento del clúster y/o fraccionamiento;')]),
          para([normal('- Que se acredite hecho ilícito cometido por "EL ARRENDATARIO" o alguna persona a la que "EL ARRENDATARIO" permita ocupar o usar el INMUEBLE, en casos de delincuencia organizada, secuestro, robo de vehículos y trata de personas y/o en caso de que el INMUEBLE pudiera estar sujeto a una acción de "Extinción de Dominio" o de medidas cautelares relacionadas con una acción de "Extinción de Dominio" por actos que lleven a cabo "EL ARRENDATARIO" o las personas a las que esté permita ocupar o usar el INMUEBLE, sin menoscabo de las acciones de indemnización que pudieran corresponder a "EL ARRENDADOR" en contra de "EL ARRENDATARIO" por virtud de lo anterior;')]),
          para([normal('- En caso de incumplimiento por cualquiera de las partes a sus obligaciones y;')]),
          para([normal('- Que "EL ARRENDATARIO" no mantenga limpio EL INMUEBLE arrendado y la parte exterior frente al mismo.')]),
          para([normal('- Será causa grave de rescisión inmediata del presente contrato, sin necesidad de declaración judicial previa, la falsedad, omisión o alteración de la información o documentación proporcionada por "EL ARRENDATARIO" con motivo de la investigación y análisis previo realizado antes de la celebración del presente contrato.')]),
        ),
        ...clausula('DÉCIMA. DE LA DESOCUPACIÓN ANTICIPADA DEL INMUEBLE.',
          para([normal('"LAS PARTES" convienen que si "EL ARRENDATARIO" desocupa el inmueble por causas imputables a él, antes de la fecha señalada para la terminación del presente contrato, éste se obliga expresamente a pagar a "EL ARRENDADOR" '), bold('dos meses de renta'), normal(' y por consiguiente no se le devolvería el mes de depósito, por concepto de daños y perjuicios causados por el incumplimiento de este Contrato, subsistiendo la obligación de desocupar y restituir el inmueble en las mismas condiciones en que lo recibe, salvo el deterioro por el uso normal y adecuado del inmueble, tendrá que avisar con un mes de anticipación la desocupación del mismo.')]),
          para([normal('En caso contrario que sea "EL ARRENDADOR" quien pretenda dar por concluido el arrendamiento tendrá que notificar con treinta días naturales cualquiera que sea la causa, debiendo desocupar en un plazo no mayor a diez días naturales.')]),
          para([normal('El Abandono de el inmueble, al suscribir este contrato, "EL ARRENDATARIO" faculta a "EL ARRENDADOR" para penetrar en el inmueble y recuperar su tenencia, con el solo requisito de la presencia de dos testigos, en procura de evitar el deterioro o el desmantelamiento de tal inmueble, siempre que por cualquier circunstancia el mismo permanezca abandonado o deshabitado por el término de un mes o que amenace la integridad física del bien o la seguridad del vecindario. La misma facultad tendrán los deudores solidarios en caso de abandono del inmueble para efectos de restituirlo a "EL ARRENDADOR".')]),
        ),
        ...clausula('DÉCIMA PRIMERA. DEL USO DEL BIEN INMUEBLE.',
          para([normal('El bien inmueble será destinado única y exclusivamente para USO HABITACIONAL, del cual podrá usar y disponer en forma ordenada y pacífica, quedando prohibido expresamente el uso del mismo contrario a la ley, la moral y las buenas costumbres.')]),
          para([normal('"EL ARRENDATARIO" no podrá variar ni modificar el destino del INMUEBLE arrendado.')]),
          para([normal('"EL ARRENDATARIO" se obliga a que el uso real del inmueble sea congruente en todo momento con el uso declarado para efectos de la investigación previa, quedando estrictamente prohibido cualquier uso distinto, no declarado o susceptible de generar riesgos jurídicos o procedimientos de Extinción de Dominio.')]),
          para([normal('"EL ARRENDADOR" no se hace responsable de los muebles o artículos que "EL ARRENDATARIO" introduzca al bien inmueble citado en este contrato.')]),
        ),
        ...clausula('DÉCIMA SEGUNDA. LICITUD DE LAS ACTIVIDADES DE "EL ARRENDATARIO" CONFORME A LA LFPIORPI.',
          para([normal('En relación con la Ley Federal de Prevención e Identificación de Operaciones con Recursos de Procedencia Ilícita (en adelante la LFPIORPI) y las demás disposiciones para la prevención y detención de lavado de dinero y financiamiento al terrorismo, las partes acuerdan que los pagos que realice "EL ARRENDATARIO" deberán ser con fondos propios y procedentes de actividades lícitas.')]),
          para([normal('"EL ARRENDATARIO" manifiesta que todos los actos jurídicos que lleva a cabo en relación con su actividad en general y en particular en el inmueble arrendado son lícitos conforme a derecho y se ajustan a todas y cada una de las disposiciones legales en materia de comercio, fiscal, laboral, ambiental, civil, administrativa y penal, entre otras, tanto del fuero federal, como del fuero estatal y municipal y que todos y cada uno de los recursos financieros y económicos que obtiene proceden de actividades de igual manera lícitas, sin vínculo alguno con el lavado de dinero, narcotráfico, actividades delictivas ni maneja recursos derivados de operaciones de procedencia ilegal y, en esa virtud, "EL ARRENDATARIO" libera a "EL ARRENDADOR" de cualquier responsabilidad por algún problema derivado de la incongruencia con lo aquí narrado, así como se obliga a resarcir cualquier daño o perjuicio que este último pudiere sufrir por lo mismo, obligándose a cubrir el costo de los honorarios de los abogados y demás especialistas que tuviere que contratar para tales fines.')]),
          para([normal('Al efecto "EL ARRENDATARIO" manifiesta obtener sus ingresos por '), bold(d.ocupacion), normal(' por lo que manifiesta bajo protesta de decir verdad que los ingresos que percibe son de esa actividad, por lo tanto los recursos con los que pagará la renta provienen de actividades lícitas y que el inmueble no será destinado para la realización de ningún hecho ilícito en términos de lo establecido por la Ley Nacional de Extinción de Dominio, "EL ARRENDADOR" actúa de buena fe y se encuentra impedido para conocer la utilización ilícita del INMUEBLE arrendado.')]),
          para([normal('Así mismo es causa de rescisión del contrato usar o disponer de el inmueble para un uso distinto al señalado en la cláusula Décima Primera del presente contrato.')]),
          para([normal('En virtud de que el arrendamiento de bienes inmuebles es considerado como "Actividad Vulnerable" para efectos de lo dispuesto en la Ley Federal para la Prevención e Identificación de Operaciones con Recursos de Procedencia Ilícita Articulo 14, "EL ARRENDATARIO" se obliga a proporcionar a "EL ARRENDADOR" la documentación e información que se requiera para la identificación de "Actividades Vulnerables" conforme a la Ley Federal para la Prevención e Identificación de Operaciones con Recursos de Procedencia Ilícita, su Reglamento y Reglas de Carácter General; por lo que desde este acto, "EL ARRENDATARIO" declara bajo protesta de decir verdad que los recursos monetarios con los que pague la renta mensual total, así como las demás prestaciones derivadas del uso del inmueble son y serán siempre de origen lícito.')]),
          para([normal('De conformidad con el artículo 15 de la Ley Nacional de Extinción de Dominio "LAS PARTES" manifiestan que previo a la firma del presente, "EL ARRENDATARIO" entregó a "EL ARRENDADOR" '), bold(d.comprobante), normal('; referencias personales, así como laborales, además de haberse realizado una investigación económica, legal y financiera; en la que se obtuvieron resultados favorables para que "EL ARRENDATARIO" pudiere tomar en arrendamiento el inmueble objeto del presente contrato. Es por lo anterior que se acredita la buena fe con la que actúa "EL ARRENDADOR" al momento de otorgar el uso y goce temporal del inmueble a "EL ARRENDATARIO".')]),
          para([normal('De igual manera, acorde a lo dispuesto por la ley, "EL ARRENDADOR" tiene prohibido ingresar al inmueble mientras "EL ARRENDATARIO" cuente con el uso y goce del mismo, por lo que le sería imposible percatarse de las actividades que "EL ARRENDATARIO" realice dentro de éste, considerando la buena fe de "EL ARRENDATARIO" de usar el inmueble única y exclusivamente para el uso pactado.')]),
          para([normal('Por lo tanto, es obligación de "EL ARRENDATARIO" liberar y eximir de toda responsabilidad a "EL ARRENDADOR" así como a reintegrarle la legal y material posesión del INMUEBLE sin limitación ni responsabilidad alguna, por lo que si "EL ARRENDATARIO" llegase a cometer algún ilícito vinculado con la delincuencia organizada, secuestro, delitos en materia de hidrocarburos, petrolíferos y petroquímicos, delitos contra la salud, trata de personas, corrupción, encubrimiento, delitos cometidos por servidores públicos, robo de vehículos y/o extorsión, etc., y que por tales causas, surtiera efectos la Ley Nacional de Extinción de Dominio, sobre la localidad arrendada, manifiesta expresamente ser responsable de todo lo acontecido en el inmueble en razón de que mediante la figura del arrendamiento, le ha sido otorgada la material y legal posesión del inmueble objeto de este instrumento, dejando desde este momento fuera, en paz y a salvo a "EL ARRENDADOR" de toda repercusión que pudiera traer su conducta.')]),
          para([normal('"EL ARRENDATARIO" también se obliga a no tener o permitir en dicho inmueble el almacén de armas de fuego, armas blancas, pólvora, explosivos, droga de cualquier naturaleza, instrumentos para procesarla y/o cualquier otro de naturaleza análoga que sirva o haya servido para cometer algún ilícito, siendo responsables de estos, en caso de que se pretenda involucrar al inmueble materia de este contrato y/o al arrendador o propietario del mismo, deslindando desde este momento tanto al inmueble como a su propietario de dicha responsabilidad y por lo tanto, no será aplicable la Ley Nacional de Extinción de Dominio.')]),
        ),
        ...clausula('DÉCIMA TERCERA. DE LA ENTREGA DEL BIEN INMUEBLE Y DE LAS CONSTRUCCIONES.',
          para([normal('"EL ARRENDADOR", se obliga a entregar el bien inmueble objeto del presente contrato con todos los servicios funcionando y en buen estado, el día '), bold(d.fe), normal('.')]),
          para([normal('Asimismo "EL ARRENDATARIO" se obliga a entregar el bien inmueble en las condiciones en que lo recibe; sin dejar deudas pendientes de los servicios que haya contratado, para lo cual se obliga a entregar finiquito de todos y cada uno de ellos al momento de entregar el bien inmueble objeto de este contrato.')]),
          para([normal('"EL ARRENDATARIO" no podrá hacer obras y/o construcciones al bien inmueble arrendado sin el conocimiento expreso y autorización de "EL ARRENDADOR".')]),
          para([normal('"EL ARRENDATARIO" se obliga a hacer por su cuenta y al beneficio del inmueble de que se trata, las reparaciones de aquellos deterioros de poca importancia que regularmente son causados por las personas que habitan en el inmueble arrendado, sin derecho a compensación o remuneración alguna, por lo que renuncia a lo dispuesto en el artículo 2286 del Código Civil del Estado Libre y Soberano de Puebla.')]),
          para([normal('Por lo que a la desocupación del inmueble por parte de "EL ARRENDATARIO", convienen las partes en que todas las obras y mejoras permanentes que se hayan hecho, quedarán en beneficio del inmueble sin obligación de contraprestación alguna por parte de "EL ARRENDATARIO".')]),
          para([normal('En caso de que por razones de seguridad o funcionalidad de "EL INMUEBLE" resulte necesaria la demolición o desinstalación de las obras y mejoras permanentes realizadas, los gastos que se originen correrán enteramente a cargo de "EL ARRENDATARIO", dejando el inmueble tal y como lo recibió, es decir en óptimas condiciones para ser nuevamente ocupado.')]),
          para([normal('Serán por exclusiva cuenta del "EL ARRENDATARIO" todos los gastos que se efectuaran para el mantenimiento de "EL INMUEBLE", entendiéndose como tal todo tipo de reparaciones y reposiciones de faltantes que "EL INMUEBLE" necesite mientras "EL ARRENDATARIO" se encuentre en posesión de ella y hasta que lo entregue a "EL ARRENDADOR", sin que tenga derecho a reclamar la devolución de sus importes, ni deducirla en rentas cualquiera que haya sido su costo, renunciando a los beneficios que le conceden los artículos 2273 fracciones II, IV y V, 2276 fracciones II 2276 fracción VI del Código Civil.')]),
          para([normal('Ambas partes acuerdan que el concepto de gastos de mantenimiento se refiere a cualquier desperfecto, o deterioro causado por no darle un uso normal y adecuado al inmueble, por la omisión o falla en la utilización de este y los elementos que en el se encuentran; no así lo son las fallas o desperfectos por vicios ocultos, grietas, fisuras o daños estructurales, donde estos últimos son propios de "EL INMUEBLE" y en correspondientes a "EL ARRENDADOR".')]),
          para([normal('La contravención de lo pactado en esta Cláusula será causa de rescisión de contrato, independientemente de la obligación de "EL ARRENDATARIO" de pagar a "EL ARRENDADOR" el cien por ciento de los daños y perjuicios que le cause, además del inmediato restablecimiento de las condiciones originales del inmueble arrendado.')]),
        ),
        ...clausula('DÉCIMA CUARTA. DE LA DEVOLUCIÓN DEL DEPÓSITO.',
          para([normal('Utilizándose este contrato como el más fiel recibo de este dinero, en la firma de este contrato se entrega la cantidad de '), bold(`${fmt(d.deposito)} M.N. (`), bold(d.deposito_letra), bold(' PESOS)'), normal(' por concepto del depósito, el cual "EL ARRENDADOR" se compromete a devolver a "EL ARRENDATARIO" dentro de los treinta días naturales siguientes a la terminación del presente contrato.')]),
          para([normal('Lo anterior queda condicionado a que la "EL ARRENDATARIO" entregue el inmueble en las mismas condiciones en que lo recibió conforme a lo enunciado en la cláusula DÉCIMA SEGUNDA por lo que de existir la necesidad de llevar a cabo alguna reparación al inmueble por causa de "EL ARRENDATARIO", el importe del depósito cubrirá los desperfectos que en el momento tuviera el inmueble y en caso de presentarse remanente alguno, "EL ARRENDADOR" entregará a "EL ARRENDATARIO" el saldo correspondiente del depósito mencionado.')]),
          para([normal('Asimismo, se condiciona la devolución del depósito mencionado, a que "EL ARRENDATARIO", entregue el finiquito de todos los servicios contratados o bien documento idóneo que pruebe el pago total de los mismos, en caso de que esto no suceda, el depósito será utilizado para el pago de los servicios y de existir remanente se devolverá.')]),
          para([normal('El depósito no es aplicable a las rentas por ningún concepto, ni causará intereses.')]),
          para([normal('Del mismo modo "EL ARRENDATARIO" estará obligado a entregar el inmueble junto con los últimos recibos de servicios pagados y la cancelación de por lo menos un mes antes de su partida de los servicios extras contratados por él mismo.')]),
          para([normal('En caso de cualquier incumplimiento, "EL ARRENDADOR" podrá legalmente rescindir este contrato sin devolución de la suma de depósito en garantía debido a los gastos administrativos y de servicios legales o de cualquier tipo en que haya incurrido "EL ARRENDATARIO".')]),
        ),
        ...clausula('DÉCIMA QUINTA. SOBRE LA TENENCIA DE ANIMALES.',
          para([normal(d.mascotas === 'si' || d.mascotas === 'condicionado'
            ? '"EL ARRENDATARIO", así como sus visitas, serán conjunta e individualmente responsables de pagar todos los daños causados por las mascotas que entren al inmueble y/o vivan dentro de él, así como toda limpieza, erradicación de pulgas y eliminación de olores.'
            : 'No se permite la tenencia de mascotas en el inmueble arrendado. El incumplimiento de esta disposición será causa de rescisión del presente contrato.'
          )]),
          ...(d.mascotas === 'si' || d.mascotas === 'condicionado' ? [
            para([normal('Esta disposición aplica a todo el inmueble, si los artículos no se pueden limpiar o reparar satisfactoriamente, "EL ARRENDATARIO" se compromete a reemplazarlos en su totalidad.')]),
            para([normal('La compensación por daños, reparaciones, limpieza, reemplazos, etc. es pagadera a la vista.')]),
            para([normal('Como dueño de la mascota, "EL ARRENDATARIO" es estrictamente responsable de toda cantidad incurrida por cualquier daño que la mascota cause, ya sea agrediendo a una(s) persona(s) y/o a la propiedad, "EL ARRENDATARIO" se hará responsable por todos y cada uno de los costos, reparaciones y hasta los de índole penal según sea el caso.')]),
          ] : []),
        ),
        ...clausula('DÉCIMA SEXTA. DE LA EXCLUSIÓN DE GASTOS.',
          para([normal('"LAS PARTES" acuerdan que en el pago de la renta no incluye servicios, como agua potable, energía eléctrica, gas, teléfono, televisión por cable, internet, alarma o cualquier otro servicio que se contrate con terceros, serán por cuenta exclusiva de "EL ARRENDATARIO", quien deberá justificar que se encuentra al corriente en dichos pagos, cada vez que sea requerido por "EL ARRENDADOR", comprometiéndose a mostrar los originales de los recibos de pago debidamente pagados, a "EL ARRENDADOR".')]),
        ),
        ...clausula('DÉCIMA SÉPTIMA. DERECHO DEL TANTO Y TRANSMISIÓN DEL INMUEBLE.',
          para([normal('"EL ARRENDATARIO" en este acto renuncia expresamente al derecho del tanto establecido en el Artículo 30 y sus fracciones del Código Civil para el Estado Libre y Soberano de Puebla en caso de que "EL ARRENDADOR" desee vender el INMUEBLE y, adicionalmente reconoce que dicho derecho del tanto no será aplicable en caso que "EL ARRENDADOR" tenga intención de vender el INMUEBLE.')]),
          para([normal('En caso que, por cualquier motivo el "INMUEBLE" fuera transmitido a algún tercero, LAS PARTES acuerdan que el presente Contrato subsistiendo el presente con plena fuerza y alcance legal en todas y cada una de sus cláusulas así como en los mismos términos y condiciones para el nuevo propietario.')]),
          para([normal('En el supuesto que "EL ARRENDADOR" decida vender la propiedad notificará a "EL ARRENDATARIO" del cambio del nuevo propietario conservando los mismos términos y condiciones del contrato original; notificando en el momento inmediato, los datos que correspondan al nuevo propietario, así como la cuenta bancaria y datos de contactos de este, firmando LAS PARTES un adendum para realizar las modificaciones al contrato general.')]),
          para([normal('Si "EL ARRENDATARIO" pago meses de renta por anticipado "EL ARRENDADOR" será responsable del pago al nuevo propietario de los pagos y deja sin responsabilidad alguna a "EL ARRENDATARIO".')]),
        ),
        ...clausula('DÉCIMA OCTAVA. DEL JUICIO ORAL SUMARISIMO.',
          para([normal('Manifiestan ambas partes someterse al Juicio Oral Sumarísimo para la solución de los conflictos que pudiesen derivarse del incumplimiento de las obligaciones dentro del presente contrato, tal y como lo establecen los Artículos 574, 575, 576, 577, 578, 579, 580, 581, 582, 583, 584, 585 y 586 del Código de Procedimientos Civiles para el Estado de Puebla.')]),
        ),
        ...clausula('DÉCIMA NOVENA. CASO FORTUITO O CAUSAS DE FUERZA MAYOR.',
          para([normal('Las partes convienen que si durante la vigencia del presente instrumento acontecieran sucesos que aparejen caso fortuito o causa de fuerza mayor, resultando de estos la inhabitación del inmueble, se supeditarán a los preceptos de derecho consagrados en el artículo 2318 del Código Civil para el Estado Libre y Soberano de Puebla; asimismo se someterán a una negociación conveniente para ambas partes, en caso de no llegar a un acuerdo, un perito certificado en la materia definirá la responsabilidad del caso o causa efectuada con costo para las partes afectadas, así mismo se realizará un convenio en donde se estipularán las condiciones y los acuerdos adoptados por ambas partes, mediante los cuales se podría dar por terminado anticipadamente la vigencia del presente contrato, comprometiéndose ambas a firmar dicho convenio.')]),
          para([normal('Así mismo convienen las "PARTES" contratadas para el caso de que "EL ARRENDATARIO" o "EL ARRENDADOR" fallezca, estando vigente el presente contrato, éste deberá rescindirse, salvo convenio en otro sentido de acuerdo al Código Civil vigente en el Estado de Puebla.')]),
          para([normal('En caso de pérdida o despido del trabajo fuente de ingreso "EL ARRENDATARIO" tendrá cinco días naturales para notificar por escrito a "EL ARRENDADOR" la situación por la que versa, presentando la documentación que justifique pérdida o despido del trabajo, con la finalidad de mediar, si así lo desearan "LAS PARTES" la terminación del contrato, sin penalización, presentando al corriente el pago de los servicios contratados dentro del inmueble sin adeudos.')]),
        ),
        ...clausula('VIGÉSIMA. DE LA RESPONSABILIDAD DE EL ARRENDATARIO POR ROBO.',
          para([normal('"EL ARRENDADOR" no responde ante "EL ARRENDATARIO" por el robo o extravío de bienes propiedad de éste dentro del INMUEBLE, sin embargo "EL ARRENDATARIO" sí debe responder por el robo o extravío de los bienes de "EL ARRENDADOR" que se encuentran dentro del INMUEBLE y los cuales se encuentran descritos en los Anexo(s) "A".')]),
        ),
        ...clausula('VIGÉSIMA PRIMERA. AVISO DE PRIVACIDAD.',
          para([normal('Las partes se obligan a que la información contenida en este contrato, sólo podrá ser usada para los fines propios de este acto jurídico, por lo que cualquier uso distinto al pactado será considerado como incumplimiento de contrato.')]),
        ),
        ...clausula('VIGÉSIMA SEGUNDA.',
          para([normal('Será motivo de rescisión del presente contrato el incumplimiento de cualquiera de las cláusulas antes descritas, así como por el abuso en el ruido emitido dentro y fuera del inmueble, por cualquier motivo, que afecten a los vecinos, así mismo, "EL ARRENDATARIO" se compromete a revisar y cumplir explícitamente con el reglamento de vecinos vigente.')]),
        ),
        ...clausula('VIGÉSIMA TERCERA. DE LAS NOTIFICACIONES.',
          para([normal('LAS PARTES señalan para efectos de las notificaciones y/o requerimientos previstas en este CONTRATO las cuentas de correo electrónico señaladas en el apartado de declaraciones.')]),
          para([normal('Las direcciones de correo electrónico mencionadas a la firma del presente CONTRATO se encuentran activas, en caso de que "EL ARRENDATARIO" realice un cambio en su cuenta de correo electrónico, se obliga a hacer del conocimiento por escrito a "EL ARRENDADOR" del cambio de la cuenta de correo electrónico, en caso de no hacerlo toda notificación o comunicación entre LAS PARTES quedará hecha conforme a la última cuenta que "EL ARRENDADOR" tenga conocimiento.')]),
        ),
        ...clausula('VIGÉSIMA CUARTA. CONTRATACIÓN POR MEDIOS ELECTRÓNICOS.',
          para([normal('Las partes acuerdan que en lugar de una firma original autógrafa, este contrato, así como cualquier consentimiento, aprobación u otros documentos relacionados con el mismo, podrán ser firmados por medio del uso de firmas electrónicas, digitales, numéricas, alfanuméricas, huellas de voz, biométricas o de cualquier otra forma y que dichos medios alternativos de firma y los registros en donde sean aplicadas dichas firmas, serán consideradas para todos los efectos, incluyendo pero no limitado a la legislación civil, mercantil, protección al consumidor y a la NOM-151-SCFI-2016, con la misma fuerza y consecuencias que la firma autógrafa original física de la parte firmante. Si el contrato o cualquier otro documento relacionado con el mismo es firmado por medios electrónicos o digitales, las Partes acuerdan que los formatos del contrato y los demás documentos firmados de tal modo serán conservados y estarán a disposición del consumidor, por lo que convienen que cada una y toda la información enviada por el Proveedor a la dirección de correo electrónico proporcionada por el Consumidor al momento de celebrar el presente Contrato será considerada como entregada en el momento en que la misma es enviada, siempre y cuando exista confirmación de recepción.')]),
        ),
        ...clausula('VIGÉSIMA QUINTA. DE LOS TRIBUNALES COMPETENTES Y LEGISLACIÓN APLICABLE.',
          para([normal('Para la interpretación y cumplimiento de este contrato, las partes acuerdan someterse a la aplicación de las leyes mexicanas y a la jurisdicción de los Tribunales competentes de la Ciudad de Puebla, Puebla, por lo que renuncian a cualquier otro fuero que pudiese corresponderle a razón de su domicilio presente o futuro.')]),
        ),

        espacio(), espacio(),
        para([normal('Enteradas las partes previa lectura del presente instrumento, el cual consta de nueve hojas útiles y pleno conocimiento de su contenido y alcance legal que causa el presente contrato, lo firman por triplicado en su totalidad en la ciudad de '), bold(d.ciudad), normal(' el día '), bold(d.ff), normal('.')]),
        espacio(), espacio(), espacio(),
        firmaTable({ nombre: d.nombre_arrendatario, rol: '"EL ARRENDATARIO"' }, { nombre: d.nombre_arrendador, rol: '"EL ARRENDADOR"' }),

        pageBreak(),
        centrado([bold(`ANEXO "A" DEL INMUEBLE UBICADO EN: ${d.direccion}`)]),
        centrado([bold('LEÍDA QUE FUE POR LAS PERSONAS QUE EN EL INTERVINIERON Y DEBIDAMENTE ENTERADAS DE SU CONTENIDO, FIRMAN DE CONFORMIDAD.')]),
        espacio(),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [6240, 3120],
          rows: [
            new TableRow({ children: [
              new TableCell({ width: { size: 6240, type: WidthType.DXA }, shading: { fill: 'D5E8F0', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [bold('DESCRIPCIÓN')] })] }),
              new TableCell({ width: { size: 3120, type: WidthType.DXA }, shading: { fill: 'D5E8F0', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [bold('OBSERVACIONES')] })] }),
            ]}),
            ...['1. Lámparas en todo el inmueble.', '2. Calentador de agua en buen estado y funcionando.',
              '3. Paredes y techos recién pintados, sin rayones y sin perforaciones o desperfectos.',
              '4. Vidrios y azulejos sin roturas, astilladuras o cualquier daño.',
              '5. Accesorios de baños completos en buen estado y funcionando.',
              '6. Cocina integral completa, con estufa, tarja en buen estado y funcionando.',
              '7. Instalaciones hidráulicas y eléctricas tales como llaves, regaderas, apagadores y tomas de corriente completas y funcionando.',
              '8. Puertas de recámaras y baños, bien pintadas y sin daños, con chapas completas y llave.',
              '9. Puerta principal de acceso bien pintada, sin daños, con chapa completa y llave.',
              '10. Persianas.', '11. Otros.',
            ].map(item => new TableRow({ children: [
              new TableCell({ width: { size: 6240, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [normal(item)] })] }),
              new TableCell({ width: { size: 3120, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [normal('')] })] }),
            ]}))
          ]
        }),
        espacio(), espacio(),
        firmaTable({ nombre: d.nombre_arrendatario, rol: '"EL ARRENDATARIO"' }, { nombre: d.nombre_arrendador, rol: '"EL ARRENDADOR"' }),
      ]
    }]
  })

  const buffer = await Packer.toBlob(doc)
  const url = URL.createObjectURL(buffer)
  const a = document.createElement('a')
  a.href = url
  a.download = `Contrato_${d.nombre_arrendatario.replace(/\s+/g, '_')}_${exp.fecha_firma || 'borrador'}.docx`
  a.click()
  URL.revokeObjectURL(url)
}
