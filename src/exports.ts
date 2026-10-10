import { formatRecords, type CardRecord, type OutputFormat } from './generator';
export type ExportType = 'txt' | 'csv' | 'json';
export function fixtureExport(records: CardRecord[], type: ExportType): { filename: string; mime: string; content: string } {
  const formats: Record<ExportType, OutputFormat> = { txt: 'pipe', csv: 'csv', json: 'json' };
  return { filename: `fixture-test-data.${type}`, mime: type === 'json' ? 'application/json' : type === 'csv' ? 'text/csv' : 'text/plain', content: formatRecords(records, formats[type]) };
}
export function downloadFixtures(records: CardRecord[], type: ExportType): void {
  const file = fixtureExport(records, type);
  const url = URL.createObjectURL(new Blob([file.content], { type: `${file.mime};charset=utf-8` }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = file.filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
