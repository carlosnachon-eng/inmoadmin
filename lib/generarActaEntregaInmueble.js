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
  const tableBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder, insideH: thinBorder, insideV: thinBorder };

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
    margins: { top: 90, bottom: 90, left: 90, right: 90 },
    verticalAlign: opts.verticalAlign,
    shading: opts.shading,
    width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    children: Array.isArray(children) ? children : [children],
  });

  const cellText = (text, opts = {}) => cell(new Paragraph({
    children: [opts.bold ? bold(text, opts.size || SIZE_SMALL) : normal(text, opts.size || SIZE_SMALL)],
    alignment: opts.alignment || AlignmentType.LEFT,
    spacing: { before: 0, after: 0 },
  }), opts);

  const d = {
    ciudad: data.ciudad || 'Puebla, Puebla',
    fecha_entrega: fmtFechaLarga(data.fecha_entrega),
    fecha_escritura: fmtFechaLarga(data.fecha_escritura),
    nombre_vendedor: data.nombre_vendedor || '',
    nombre_comprador: data.nombre_comprador || '',
    compradores_adicionales: String(data.compradores_adicionales || '')
      .split('\n').map((x) => x.trim()).filter(Boolean),
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

  const checklist = [
    ['A. ACCESOS Y LLAVES', true],
    ['Juego de llaves puerta principal'],
    ['Juego de llaves puertas interiores'],
    ['Juego de llaves rejas/portones'],
    ['Controles de cochera eléctrica'],
    ['Tarjetas, TAGs o accesos electrónicos'],
    ['B. SERVICIOS Y MEDIDORES', true],
    ['Lectura medidor de luz (CFE)'],
    ['Lectura medidor de agua'],
    ['Gas estacionario / cilindro / toma de gas'],
    ['Servicios contratados o pendientes de cambio'],
    ['C. INTERIORES', true],
    ['Muros y techos'],
    ['Pisos'],
    ['Puertas y chapas'],
    ['Ventanas y cancelería'],
    ['Baños y muebles sanitarios'],
    ['Cocina, tarja y muebles instalados'],
    ['D. INSTALACIONES', true],
    ['Instalación eléctrica'],
    ['Instalación hidráulica'],
    ['Instalación sanitaria'],
    ['Instalación de gas'],
    ['E. EQUIPAMIENTO', true],
    ['Closets'],
    ['Calentador / boiler'],
    ['Aires acondicionados / ventiladores'],
    ['Persianas, cortinas o accesorios'],
    ['Otros equipos o accesorios entregados'],
  ];

  const checklistRows = [
    new TableRow({
      tableHeader: true,
      children: [
        cellText('Concepto', { bold: true, width: 3900, shading: { type: ShadingType.CLEAR, fill: 'F3F4F6' } }),
        cellText('Estatus (OK / Falla / N.A.)', { bold: true, width: 2100, shading: { type: ShadingType.CLEAR, fill: 'F3F4F6' } }),
        cellText('Observaciones', { bold: true, width: 3360, shading: { type: ShadingType.CLEAR, fill: 'F3F4F6' } }),
      ],
    }),
    ...checklist.map(([text, isSection]) => new TableRow({
      children: [
        cellText(text, { bold: isSection, width: 3900, shading: isSection ? { type: ShadingType.CLEAR, fill: 'EEF2FF' } : undefined }),
        cellText(isSection ? '' : ' ', { width: 2100, shading: isSection ? { type: ShadingType.CLEAR, fill: 'EEF2FF' } : undefined }),
        cellText(isSection ? '' : ' ', { width: 3360, shading: isSection ? { type: ShadingType.CLEAR, fill: 'EEF2FF' } : undefined }),
      ],
    })),
  ];

  const signatures = [
    {
      role: '"EL VENDEDOR"',
      name: d.nombre_vendedor,
    },
    ...compradores.map((nombre, index) => ({
      role: compradores.length > 1 ? `"COMPRADOR ${index + 1}"` : '"EL COMPRADOR"',
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
          normal(', se constituyeron las partes en el inmueble objeto de la operación, con el fin de formalizar la entrega y recepción física del mismo.'),
        ]),
        para([
          bold('PRIMERO.- '),
          normal('Con fecha '),
          bold(d.fecha_escritura),
          normal(', '),
          bold(String(d.nombre_vendedor || 'EL VENDEDOR').toUpperCase()),
          normal(' y '),
          bold(compradoresTexto),
          normal(' suscribieron o formalizaron la operación de compraventa respecto del siguiente inmueble:'),
        ]),
        para([bold(String(d.descripcion_inmueble || d.direccion_inmueble).toUpperCase())]),
        para([
          bold('SEGUNDO.- '),
          normal('De acuerdo con lo pactado por las partes, la entrega del inmueble se realiza en la fecha señalada en la presente acta, recibiéndolo la parte compradora en el estado físico y jurídico que declara conocer.'),
        ]),
        para([
          bold('TERCERO.- '),
          normal('Por este acto, '),
          bold(String(d.nombre_vendedor || 'EL VENDEDOR').toUpperCase()),
          normal(' entrega a '),
          bold(compradoresTexto),
          normal(', y estos reciben para sí, el inmueble totalmente desocupado, salvo las observaciones expresamente asentadas en este documento.'),
        ]),
        para([
          bold('CUARTO.- '),
          normal('El inmueble se entrega con los elementos, accesos, servicios, medidores, interiores, instalaciones y equipamiento que se detallan en el siguiente checklist:'),
        ]),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [3900, 2100, 3360],
          borders: tableBorders,
          rows: checklistRows,
        }),
        d.observaciones_checklist ? para([bold('Observaciones del checklist: '), normal(d.observaciones_checklist)]) : para([bold('Observaciones del checklist: '), underline('____________________________________________________________')]),
        heading('OBSERVACIONES GENERALES'),
        d.observaciones_generales
          ? para([normal(d.observaciones_generales)])
          : para([underline('________________________________________________________________________________')]),
        heading('DATOS DE CONTACTO DEL VENDEDOR'),
        para([bold('Teléfono: '), normal(d.telefono_vendedor || '____________________'), normal('     '), bold('Correo electrónico: '), normal(d.correo_vendedor || '____________________________')]),
        para([
          bold('QUINTO.- '),
          normal('Los compradores declaran conocer el estado actual del inmueble y recibirlo a su entera satisfacción, salvo las observaciones asentadas por escrito en la presente acta.'),
        ]),
        para([
          normal('Enteradas las partes del contenido y alcance legal del presente instrumento, lo firman por duplicado en la ciudad de '),
          bold(d.ciudad),
          normal(', en la fecha indicada al inicio.'),
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
