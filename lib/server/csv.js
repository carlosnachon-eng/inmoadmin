import { HttpError } from "./condominiosAuth.js";

export function parseCsv(input, { maxRows = 2000, maxColumns = 30 } = {}) {
  const text = String(input || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      if (field) throw new HttpError(400, "CSV inválido: comilla fuera de lugar");
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      if (rows.length > maxRows + 1) throw new HttpError(400, `El CSV excede ${maxRows} filas`);
    } else {
      field += character;
    }
  }

  if (quoted) throw new HttpError(400, "CSV inválido: comillas sin cerrar");
  row.push(field);
  if (row.some((value) => value !== "")) rows.push(row);
  if (!rows.length) throw new HttpError(400, "El CSV está vacío");
  if (rows.some((current) => current.length > maxColumns)) {
    throw new HttpError(400, `El CSV excede ${maxColumns} columnas`);
  }
  return rows;
}

export const UNIT_COLUMNS = [
  "numero",
  "piso",
  "propietario_nombre",
  "propietario_email",
  "propietario_telefono",
  "residente_nombre",
  "residente_email",
  "residente_telefono",
  "residente_es_propietario",
  "notas",
];

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateUnitCsv(csv) {
  const parsed = parseCsv(csv);
  const headers = parsed[0].map((header) => header.trim().toLowerCase());
  const unknown = headers.filter((header) => !UNIT_COLUMNS.includes(header));
  const missing = ["numero"].filter((header) => !headers.includes(header));
  if (unknown.length || missing.length) {
    throw new HttpError(400, `Columnas inválidas. Faltan: ${missing.join(", ") || "ninguna"}; desconocidas: ${unknown.join(", ") || "ninguna"}`);
  }

  const seen = new Set();
  const errors = [];
  const rows = parsed.slice(1).map((values, offset) => {
    const row = Object.fromEntries(headers.map((header, index) => [header, String(values[index] ?? "").trim()]));
    const number = row.numero;
    if (!number || number.length > 40) errors.push({ fila: offset + 2, campo: "numero", mensaje: "Número requerido (máximo 40)" });
    const normalized = number.toLocaleLowerCase("es-MX");
    if (seen.has(normalized)) errors.push({ fila: offset + 2, campo: "numero", mensaje: "Unidad duplicada en el archivo" });
    seen.add(normalized);
    for (const field of ["propietario_email", "residente_email"]) {
      if (row[field] && !emailPattern.test(row[field])) errors.push({ fila: offset + 2, campo: field, mensaje: "Correo inválido" });
    }
    for (const [field, limit] of Object.entries({ piso: 40, propietario_nombre: 160, propietario_telefono: 40, residente_nombre: 160, residente_telefono: 40, notas: 1000 })) {
      if ((row[field] || "").length > limit) errors.push({ fila: offset + 2, campo: field, mensaje: `Máximo ${limit} caracteres` });
    }
    if (row.piso && !/^-?\d{1,4}$/.test(row.piso)) errors.push({ fila: offset + 2, campo: "piso", mensaje: "Debe ser un número entero" });
    const ownerResident = /^(1|true|si|sí|yes)$/i.test(row.residente_es_propietario || "");
    return Object.fromEntries(UNIT_COLUMNS.map((column) => [column, column === "residente_es_propietario" ? ownerResident : (row[column] || "")]));
  });

  if (!rows.length) errors.push({ fila: 1, campo: "archivo", mensaje: "No hay unidades para importar" });
  return { rows, errors, headers };
}

export function toCsv(rows, columns) {
  const escape = (value) => {
    const text = value == null ? "" : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.join(","), ...rows.map((row) => columns.map((column) => escape(row[column])).join(","))].join("\r\n");
}
