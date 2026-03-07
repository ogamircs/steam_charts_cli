const CSV_COLUMNS = ['appid', 'name', 'current_players', 'queried_at', 'source'];

export function serializeRecord(record, { format = 'csv' } = {}) {
  if (format === 'json') {
    return JSON.stringify(record, null, 2);
  }

  if (format !== 'csv') {
    throw new Error(`Unsupported output format: ${format}`);
  }

  const header = CSV_COLUMNS.join(',');
  const row = CSV_COLUMNS
    .map((column) => escapeCsvValue(record[column]))
    .join(',');

  return `${header}\n${row}`;
}

function escapeCsvValue(value) {
  const stringValue = value == null ? '' : String(value);

  if (!/[,"\n]/.test(stringValue)) {
    return stringValue;
  }

  return `"${stringValue.replaceAll('"', '""')}"`;
}
