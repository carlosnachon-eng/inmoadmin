// lib/generarActaEntregaInmueble.js
// Acta de Entrega y Recepción de Inmueble para expedientes de compraventa.

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

function fmtFechaLarga(value) {
  if (!value) return '___ de ______________ de ______';
  if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  const fecha = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(fecha.getTime())) return value;
  return `${fecha.getDate()} de ${MESES[fecha.getMonth()]} de ${fecha.getFullYear()}`;
}

function fmtFechaCierre(value) {
  const fecha = fmtFechaLarga(value);
  return fecha === '___ de ______________ de ______' ? fecha : fecha;
}

function nombreArchivo(text) {
  return String(text || 'Inmueble')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 70) || 'Inmueble';
}

export async function generarActaEntregaInmueble(data = {}) {
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    AlignmentType, BorderStyle, WidthType, ShadingType,
  } = await import('docx');

  const FONT = 'Arial';
  const SIZE_BODY = 20;
  const SIZE_SMALL = 18;
  const SIZE_TITLE = 24;
  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' };
  const printBorder = { style: BorderStyle.SINGLE, size: 4, color: '6B7280' };
  const tableBorders = { top: printBorder, bottom: printBorder, left: printBorder, right: printBorder, insideH: printBorder, insideV: printBorder };

  const normal = (text, size = SIZE_BODY) => new TextRun({ text: String(text ?? ''), size, font: FONT });
  const bold = (text, size = SIZE_BODY) => new TextRun({ text: String(text ?? ''), size, font: FONT, bold: true });
  const underline = (text, size = SIZE_BODY) => new TextRun({ text: String(text ?? ''), size, font: FONT, underline: {} });

  const para = (children, opts = {}) => new Paragraph({
    children: Array.isArray(children) ? children : [children],
    spacing: { before: 90, after: 90, line: 260 },
    alignment: AlignmentType.JUSTIFIED,
    ...opts,
  });

  const heading = (text) => new Paragraph({
    children: [bold(text, SIZE_BODY)],
    spacing: { before: 220, after: 100 },
    alignment: AlignmentType.LEFT,
  });

  const blank = (count = 1) => Array.from({ length: count }, () => new Paragraph({
    children: [normal(' ', SIZE_SMALL)],
    spacing: { before: 40, after: 40 },
  }));

  const cell = (children, opts = {}) => new TableCell({
    margins: { top: opts.tight ? 70 : 120, bottom: opts.tight ? 70 : 120, left: 110, right: 110 },
    verticalAlign: opts.verticalAlign,
    shading: opts.shading,
    width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    children: Array.isArray(children) ? children : [children],
  });

  const cellText = (text, opts = {}) => cell(new Paragraph({
    children: [opts.bold ? bold(text, opts.size || SIZE_SMALL) : normal(text, opts.size || SIZE_SMALL)],
    alignment: opts.alignment || AlignmentType.LEFT,
    spacing: { before: opts.before || 0, after: opts.after || 0, line: opts.line || 240 },
  }), opts);

  const d = {
    ciudad: data.ciudad || 'Puebla, Puebla',
    fecha_entrega: fmtFechaLarga(data.fecha_entrega),
    fecha_cierre: fmtFechaCierre(data.fecha_entrega),
    fecha_escritura: fmtFechaLarga(data.fecha_escritura),
    nombre_vendedor: data.nombre_vendedor || '',
    identificacion_vendedor: data.identificacion_vendedor || '',
    nombre_comprador: data.nombre_comprador || '',
    compradores_adicionales: String(data.compradores_adicionales || '')
      .split('\n').map((x) => x.trim()).filter(Boolean),
    identificaciones_compradores: data.identificaciones_compradores || '',
    direccion_inmueble: data.direccion_inmueble || data.direccion || '',
    descripcion_inmueble: data.descripcion_inmueble || data.direccion_inmueble || data.direccion || '',
    telefono_vendedor: data.telefono_vendedor || '',
    correo_vendedor: data.correo_vendedor || '',
    observaciones_generales: data.observaciones_generales || '',
    observaciones_checklist: data.observaciones_checklist || '',
  };

  const compradores = [d.nombre_comprador, ...d.compradores_adicionales].filter(Boolean);
  const compradoresTexto = compradores.length > 1
    ? compradores.map((nombre) => nombre.toUpperCase()).join(', ')
    : (compradores[0] || 'LOS COMPRADORES').toUpperCase();
  const identificacionesCompradores = d.identificaciones_compradores || '____________________________';
  const nombreVendedorTexto = String(d.nombre_vendedor || 'EL VENDEDOR').toUpperCase();
  const inmuebleTexto = String(d.descripcion_inmueble || d.direccion_inmueble || 'EL INMUEBLE').toUpperCase();

  const checklist = [
    ['A. ACCESOS Y LLAVES', true],
    ['Juego de llaves puerta principal'],
    ['Juego de llaves puertas interiores'],
    ['Juego de llaves rejas/portones'],
    ['Controles de cochera eléctrica'],
    ['B. SERVICIOS Y MEDIDORES', true],
    ['Lectura Medidor de Luz (CFE)'],
    ['Lectura Medidor de Agua'],
    ['Tanque de Gas Estacionario'],
    ['C. INTERIORES', true],
    ['Muros y Techos', false, 'Sin humedades ni daños visibles.'],
    ['Pisos', false, 'En buen estado general.'],
    ['Puertas y Chapas', false, 'Abren, cierran y aseguran correctamente.'],
    ['Ventanas y Cristales', false, 'Completos, sin roturas.'],
    ['D. INSTALACIONES', true],
    ['Hidráulica (Agua)', true],
    ['Llaves de paso (agua fría/caliente)', false, 'Funcionando, sin fugas.'],
    ['Tarja de Cocina', false, 'Sin fugas, buen drenaje.'],
    ['Lavabos', false, 'Sin fugas, buen drenaje.'],
    ['Regaderas', false, 'Funcionando, sin fugas.'],
    ['Inodoros (WC)', false, 'Descargan y llenan correctamente.'],
    ['Calentador de agua (Boiler)', false, 'Enciende y calienta correctamente.'],
    ['Eléctrica', true],
    ['Contactos (enchufes)', false, 'Todos funcionan.'],
    ['Apagadores y Focos', false, 'Todos funcionan.'],
    ['Timbre / Interfón', false, 'Funcionando.'],
    ['Centro de Carga', false, 'Identificado y funcional.'],
    ['E. EQUIPAMIENTO INCLUIDO', true],
    ['Cocina Integral', false, 'Gabinetes y cubiertas en buen estado.'],
    ['Estufa y Horno', false, 'Quemadores y horno funcionan.'],
    ['Campana Extractora', false, 'Luz y extractor funcionando.'],
    ['Closets', false, 'Puertas y cajones funcionales.'],
    ['Mosquiteros', false, 'Completos y en buen estado.'],
    [''],
    [''],
  ];

  const checklistRows = [
    new TableRow({
      tableHeader: true,
      children: [
        cellText('Concepto', { bold: true, width: 3600, shading: { type: ShadingType.CLEAR, fill: 'E5E7EB' }, alignment: AlignmentType.CENTER }),
        cellText('Estatus\nOK / Falla / N.A.', { bold: true, width: 1900, shading: { type: ShadingType.CLEAR, fill: 'E5E7EB' }, alignment: AlignmentType.CENTER }),
        cellText('Observaciones', { bold: true, width: 3860, shading: { type: ShadingType.CLEAR, fill: 'E5E7EB' }, alignment: AlignmentType.CENTER }),
      ],
    }),
    ...checklist.map(([text, isSection, observacion]) => new TableRow({
      children: [
        cellText(text, { bold: isSection, width: 3600, shading: isSection ? { type: ShadingType.CLEAR, fill: 'F3F4F6' } : undefined, size: isSection ? SIZE_SMALL : SIZE_BODY }),
        cellText(isSection ? text : '☐ OK   ☐ Falla   ☐ N.A.', {
          bold: isSection,
          width: 1900,
          shading: isSection ? { type: ShadingType.CLEAR, fill: 'F3F4F6' } : undefined,
          alignment: isSection ? AlignmentType.LEFT : AlignmentType.CENTER,
          size: isSection ? SIZE_SMALL : 16,
        }),
        cellText(isSection ? text : (observacion || '\n'), {
          bold: isSection,
          width: 3860,
          shading: isSection ? { type: ShadingType.CLEAR, fill: 'F3F4F6' } : undefined,
          size: isSection ? SIZE_SMALL : SIZE_BODY,
          line: 300,
        }),
      ],
    })),
  ];

  const signatures = [
    {
      role: '"LA PROMITENTE VENDEDORA"',
      name: d.nombre_vendedor,
    },
    ...compradores.map((nombre, index) => ({
      role: compradores.length > 1 ? '"PROMITENTES COMPRADORES"' : '"PROMITENTE COMPRADOR"',
      name: nombre,
    })),
  ];

  const firmaCell = (item) => cell([
    new Paragraph({ alignment: AlignmentType.CENTER, children: [bold(item.role, SIZE_SMALL)], spacing: { before: 0, after: 60 } }),
    ...blank(3),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: '111827', space: 4 } },
      children: [normal(' ', SIZE_SMALL)],
      spacing: { before: 0, after: 80 },
    }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [bold(String(item.name || '').toUpperCase(), SIZE_SMALL)], spacing: { before: 0, after: 20 } }),
  ], { width: 4680 });

  const firmaRows = [];
  for (let i = 0; i < signatures.length; i += 2) {
    firmaRows.push(new TableRow({
      children: [
        firmaCell(signatures[i]),
        firmaCell(signatures[i + 1] || { role: '', name: '' }),
      ],
    }));
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: SIZE_BODY } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 280 },
          children: [bold('ACTA DE ENTREGA Y RECEPCIÓN DE INMUEBLE', SIZE_TITLE)],
        }),
        para([
          normal('En '),
          bold(d.ciudad),
          normal(', a los '),
          bold(d.fecha_entrega),
          normal(', se constituyeron en '),
          bold(inmuebleTexto),
          normal(', el C. '),
          bold(nombreVendedorTexto),
          normal(' identificado con credencial de elector expedida por el Instituto Nacional Electoral número '),
          bold(d.identificacion_vendedor || '____________________________'),
          normal(', a quien en lo sucesivo se le denominará '),
          bold('EL VENDEDOR'),
          normal(' y, de la otra parte, '),
          bold(compradoresTexto),
          normal(', quienes se identifican con credencial para votar expedida por el Instituto Nacional Electoral número: '),
          bold(identificacionesCompradores),
          normal(', respectivamente, a quienes en lo sucesivo se les denominará '),
          bold('LOS COMPRADORES'),
          normal(', con la finalidad de efectuar la '),
          bold('ENTREGA/RECEPCIÓN'),
          normal(' del '),
          bold('INMUEBLE'),
          normal(' que se detalla a continuación bajo los siguientes términos:'),
        ]),
        para([
          bold('PRIMERO.- '),
          normal('Con fecha '),
          bold(d.fecha_escritura),
          normal(', '),
          bold('EL VENDEDOR'),
          normal(' y '),
          bold('LOS COMPRADORES'),
          normal(' suscribieron un Contrato de Compraventa (en adelante el '),
          bold('CONTRATO'),
          normal(') respecto del siguiente '),
          bold('INMUEBLE'),
          normal(':'),
        ]),
        para([normal('Inmueble identificado como: '), bold(inmuebleTexto), normal('.')]),
        para([
          bold('SEGUNDO.- '),
          normal('De acuerdo con lo estipulado en el '),
          bold('CONTRATO'),
          normal(', '),
          bold('EL VENDEDOR'),
          normal(' y '),
          bold('LOS COMPRADORES'),
          normal(' pactaron que la entrega del '),
          bold('INMUEBLE'),
          normal(', se realizaría a la firma de la Escritura Pública que el '),
          bold('CONTRATO'),
          normal(' origine.'),
        ]),
        para([
          bold('TERCERO.- '),
          normal('Por este acto, '),
          bold('EL VENDEDOR'),
          normal(' entrega a '),
          bold('LOS COMPRADORES'),
          normal(', y éstos reciben para sí el '),
          bold('INMUEBLE'),
          normal(' totalmente desocupado, conforme a lo pactado, en el estado en que se encuentra a total satisfacción de '),
          bold('LOS COMPRADORES'),
          normal(' cumpliendo al efecto con entregar las llaves del '),
          bold('INMUEBLE'),
          normal('. Quedando establecido en este extremo que se ha dado cumplimiento a lo pactado en el '),
          bold('CONTRATO'),
          normal(' no teniendo que reclamar nada para sí cada una de las Partes.'),
        ]),
        para([
          bold('CUARTO.- '),
          normal('El '),
          bold('INMUEBLE'),
          normal(' se entrega con lo siguiente:'),
        ]),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [3900, 2100, 3360],
          borders: tableBorders,
          rows: checklistRows,
        }),
        ...(d.observaciones_checklist ? [para([bold('Observaciones: '), normal(d.observaciones_checklist)])] : []),
        para([
          bold('QUINTO.- '),
          bold('LOS COMPRADORES'),
          normal(' declaran conocer el estado actual del bien y exoneran de manera expresa a '),
          bold('GRUPO INMOBILIARIO NACHON TORRES S.A. DE C.V.'),
          normal(' y al '),
          bold('VENDEDOR'),
          normal(' de cualquier responsabilidad por vicios ocultos o las posibles averías que el bien manifieste después de 30 días de la presente entrega.'),
        ]),
        para([
          normal('De igual forma, '),
          bold('LAS PARTES'),
          normal(' establecen que en caso de suscitarse algún tema por lo establecido en el párrafo inmediato anterior, '),
          bold('LOS COMPRADORES'),
          normal(' deberán de notificar de forma escrita directamente a la parte '),
          bold('VENDEDORA'),
          normal(' por los siguientes medios:'),
        ]),
        para([bold('TELÉFONO: '), normal(d.telefono_vendedor || '____________________')], { alignment: AlignmentType.LEFT }),
        para([bold('CORREO ELECTRÓNICO: '), normal(d.correo_vendedor || '____________________________')], { alignment: AlignmentType.LEFT }),
        ...(d.observaciones_generales ? [para([bold('OBSERVACIONES GENERALES: '), normal(d.observaciones_generales)])] : []),
        para([
          normal('Enteradas las partes previa lectura del presente instrumento, el cual consta de tres hojas útiles y pleno conocimiento de su contenido y alcance legal que causa, lo firman en su totalidad y por duplicado en la Ciudad de '),
          bold(d.ciudad),
          normal(' el día '),
          bold(d.fecha_cierre),
          normal('.'),
        ]),
        ...blank(2),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [4680, 4680],
          borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideH: noBorder, insideV: noBorder },
          rows: firmaRows,
        }),
      ],
    }],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Acta_Entrega_${nombreArchivo(d.direccion_inmueble || d.descripcion_inmueble)}_${String(new Date().toISOString()).slice(0, 10)}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}
