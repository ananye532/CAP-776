import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import { badRequest } from '../lib/errors.js';
import type { ImportMethod } from '../domain/enums.js';

export const MAX_IMPORT_ROWS = 20_000;

export interface ParsedFile {
  columns: string[];
  rows: Record<string, unknown>[];
  method: ImportMethod;
}

export function detectFormat(fileName: string, mime: string): 'csv' | 'xlsx' | 'json' {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'csv' || ext === 'tsv' || mime === 'text/csv') return 'csv';
  if (ext === 'xlsx' || mime.includes('spreadsheetml')) return 'xlsx';
  if (ext === 'json' || mime === 'application/json') return 'json';
  if (ext === 'xls') throw badRequest('Legacy .xls files are not supported. Save the file as .xlsx or .csv and try again.');
  throw badRequest('Unsupported file type. Upload a CSV, XLSX or JSON file.');
}

export async function parseImportFile(buffer: Buffer, fileName: string, mime: string): Promise<ParsedFile> {
  const format = detectFormat(fileName, mime);
  const parsed = format === 'csv' ? parseCsv(buffer) : format === 'xlsx' ? await parseXlsx(buffer) : parseJson(buffer);
  const method: ImportMethod = format === 'csv' ? 'csv_upload' : format === 'xlsx' ? 'xlsx_upload' : 'json_upload';
  if (!parsed.rows.length) throw badRequest('No data rows were found in the file.');
  if (parsed.rows.length > MAX_IMPORT_ROWS) throw badRequest(`The file has ${parsed.rows.length} rows; the limit per import is ${MAX_IMPORT_ROWS}. Split the file and import in parts.`);
  return { ...parsed, method };
}

function uniqueColumns(cols: string[]): string[] {
  const seen = new Map<string, number>();
  return cols.map((c, i) => {
    const base = (c ?? '').toString().trim() || `Column ${i + 1}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base} (${n + 1})` : base;
  });
}

function parseCsv(buffer: Buffer) {
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const result = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
  if (result.errors.length && !result.data.length) throw badRequest(`Could not read CSV: ${result.errors[0].message}`);
  const [header, ...body] = result.data;
  if (!header) throw badRequest('The CSV file is empty.');
  const columns = uniqueColumns(header);
  const rows = body.map((cells) => Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? ''])));
  return { columns, rows };
}

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('hyperlink' in v) return (v as ExcelJS.CellHyperlinkValue).hyperlink || (v as ExcelJS.CellHyperlinkValue).text;
    if ('result' in v) return cellValue((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('error' in v) return '';
    return String(v);
  }
  return v;
}

async function parseXlsx(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw badRequest('Could not read the Excel file. Make sure it is a valid .xlsx file.');
  }
  // Use the sheet with the most rows (exports sometimes include a cover sheet).
  const sheet = [...wb.worksheets].sort((a, b) => b.actualRowCount - a.actualRowCount)[0];
  if (!sheet) throw badRequest('The Excel file has no worksheets.');
  const matrix: unknown[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: unknown[] = [];
    for (let c = 1; c <= sheet.columnCount; c++) values.push(cellValue(row.getCell(c).value));
    if (values.some((v) => v !== '' && v != null)) matrix.push(values);
  });
  const [header, ...body] = matrix;
  if (!header) throw badRequest('The worksheet is empty.');
  const columns = uniqueColumns(header.map((h) => String(h ?? '')));
  const rows = body.map((cells) => Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? ''])));
  return { columns, rows };
}

function flatten(obj: Record<string, unknown>, prefix = '', out: Record<string, unknown> = {}, depth = 0) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2) flatten(v as Record<string, unknown>, key, out, depth + 1);
    else out[key] = Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ') : v;
  }
  return out;
}

function parseJson(buffer: Buffer) {
  let data: unknown;
  try {
    data = JSON.parse(buffer.toString('utf8').replace(/^﻿/, ''));
  } catch {
    throw badRequest('The JSON file is not valid JSON.');
  }
  let arr: unknown[] | undefined = Array.isArray(data) ? data : undefined;
  if (!arr && data && typeof data === 'object') {
    // Accept { "applications": [...] } or similar wrappers: take the largest array of objects.
    arr = Object.values(data as Record<string, unknown>)
      .filter((v): v is unknown[] => Array.isArray(v) && v.some((x) => x && typeof x === 'object'))
      .sort((a, b) => b.length - a.length)[0];
  }
  if (!arr) throw badRequest('Expected a JSON array of records, or an object containing one.');
  const rows = arr.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)).map((x) => flatten(x));
  const columns: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!columns.includes(k)) columns.push(k);
  return { columns, rows };
}
