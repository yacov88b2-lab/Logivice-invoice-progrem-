import JSZip from 'jszip';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { TemplateStructure, Transaction } from '../types';
import {
  FillResult,
  getFieldValue, parseTableauDate, formatDDMMYYYY,
  forceArray, parseSharedStrings, resolveWorksheetPathFromWorkbookRel,
  writeBufferToFile, patchInvoiceQtyOpenXml, replaceSheetNameInAllFormulas
} from './_base';

export function extractAfimilkStoragePeriod(storageData: any[]): { mm: string; yyyy: string } | null {
  const parsed = buildAfimilkStorageEntries(storageData);
  if (!parsed.length) return null;
  const mm   = String(parsed[0].date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(parsed[0].date.getFullYear());
  return { mm, yyyy };
}

function extractUniquePeriodFromRows(
  rows: any[], dateField: string
): { mm: string; yyyy: string } | null {
  let period: { mm: string; yyyy: string } | null = null;
  for (const r of rows || []) {
    const raw = getFieldValue(r, dateField);
    const dt  = parseTableauDate(raw);
    if (!dt) continue;
    const mm   = String(dt.getMonth() + 1).padStart(2, '0');
    const yyyy = String(dt.getFullYear());
    const p    = { mm, yyyy };
    if (!period) { period = p; continue; }
    if (period.mm !== p.mm || period.yyyy !== p.yyyy) return null;
  }
  return period;
}

function findRawViewData(rawViewData: Map<string, any[]>, needle: string): any[] | null {
  const target = needle.toLowerCase().trim();
  for (const [k, v] of rawViewData.entries()) {
    if (!k) continue;
    const key = String(k).toLowerCase();
    if (key === target || key.includes(target)) return Array.isArray(v) ? v : null;
  }
  return null;
}

function patchScansInboundWorksheetXml(
  worksheetObj: any, sharedStrings: string[], inboundRows: any[]
): void {
  const sheetData   = worksheetObj?.worksheet?.sheetData;
  const rows: any[] = forceArray(sheetData?.row);

  const findRow = (rowNum: number): any | null =>
    rows.find((rr: any) => Number(rr?.['@_r'] ?? 0) === rowNum) ?? null;

  const getOrCreateRow = (rowNum: number): any => {
    let row = findRow(rowNum);
    if (row) return row;
    row = { '@_r': String(rowNum), c: [] };
    rows.push(row);
    return row;
  };

  const getCell = (row: any, colLetter: string, rowNum: number): any | null => {
    const cells = forceArray(row?.c);
    const ref   = `${colLetter.toUpperCase()}${rowNum}`;
    return cells.find((cc: any) => String(cc['@_r'] ?? '').toUpperCase() === ref) ?? null;
  };

  const getOrCreateCell = (row: any, colLetter: string, rowNum: number): any => {
    if (!row.c) row.c = [];
    const cells = forceArray(row.c);
    const ref   = `${colLetter.toUpperCase()}${rowNum}`;
    let cell    = cells.find((cc: any) => String(cc['@_r'] ?? '').toUpperCase() === ref);
    if (!cell) { cell = { '@_r': ref }; cells.push(cell); row.c = cells; }
    return cell;
  };

  const clearCellValue = (cell: any): void => {
    if (!cell) return;
    delete cell.v; delete cell.is; delete cell['@_t'];
  };

  const setInlineString = (cell: any, text: string): void => {
    delete cell.v;
    cell['@_t'] = 'inlineStr';
    cell.is     = { t: { '#text': text } };
  };

  const getField = (row: any, key: string): string => {
    const v = getFieldValue(row, key);
    return v === undefined || v === null ? '' : String(v);
  };

  const maxClearRows = 5000;
  const maxWriteRows = Math.min(inboundRows.length, maxClearRows);

  for (let r = 2; r <= maxClearRows + 1; r++) {
    const row = findRow(r);
    if (!row) continue;
    for (const col of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']) {
      clearCellValue(getCell(row, col, r));
    }
  }

  for (let idx = 0; idx < maxWriteRows; idx++) {
    const rowNum      = idx + 2;
    const templateRow = getOrCreateRow(rowNum);
    const data        = inboundRows[idx] ?? {};

    setInlineString(getOrCreateCell(templateRow, 'B', rowNum), getField(data, 'Sub Inventory'));
    setInlineString(getOrCreateCell(templateRow, 'C', rowNum), getField(data, 'Name (Service Levels)'));
    setInlineString(getOrCreateCell(templateRow, 'D', rowNum), getField(data, 'Ref (Orders)'));

    const inboundAtRaw = getFieldValue(data, 'Inbound at');
    const dt           = parseTableauDate(inboundAtRaw);
    setInlineString(getOrCreateCell(templateRow, 'E', rowNum), dt ? formatDDMMYYYY(dt) : getField(data, 'Inbound at'));

    setInlineString(getOrCreateCell(templateRow, 'F', rowNum), getField(data, 'Item'));
    setInlineString(getOrCreateCell(templateRow, 'G', rowNum), getField(data, 'box'));
    setInlineString(getOrCreateCell(templateRow, 'H', rowNum), getField(data, 'item'));
    setInlineString(getOrCreateCell(templateRow, 'I', rowNum), getField(data, 'pallet'));
    setInlineString(getOrCreateCell(templateRow, 'J', rowNum), getField(data, 'serial'));
  }

  worksheetObj.worksheet.sheetData.row = rows;
}

function patchScansOutboundWorksheetXml(
  worksheetObj: any, sharedStrings: string[], outboundRows: any[]
): void {
  const sheetData   = worksheetObj?.worksheet?.sheetData;
  const rows: any[] = forceArray(sheetData?.row);

  const getCellText = (cell: any): string => {
    if (!cell) return '';
    const t = String(cell['@_t'] ?? '');
    if (t === 's') {
      const idx = Number(cell.v ?? -1);
      return idx >= 0 && idx < sharedStrings.length ? String(sharedStrings[idx]) : '';
    }
    if (t === 'inlineStr') {
      const tt = cell.is?.t;
      if (typeof tt === 'string') return tt;
      if (typeof tt?.['#text'] === 'string') return tt['#text'];
      return '';
    }
    if (cell.v !== undefined && cell.v !== null) return String(cell.v);
    return '';
  };

  const findCell = (row: any, colLetter: string): any | null => {
    const cells = forceArray(row?.c);
    return cells.find((cc: any) => String(cc['@_r'] ?? '').toUpperCase().startsWith(colLetter.toUpperCase())) ?? null;
  };

  const getOrCreateCell = (row: any, colLetter: string, rowNum: number): any => {
    if (!row.c) row.c = [];
    const cells = forceArray(row.c);
    const ref   = `${colLetter.toUpperCase()}${rowNum}`;
    let cell    = cells.find((cc: any) => String(cc['@_r'] ?? '').toUpperCase() === ref);
    if (!cell) { cell = { '@_r': ref }; cells.push(cell); row.c = cells; }
    return cell;
  };

  const setInlineString = (cell: any, text: string): void => {
    delete cell.v; cell['@_t'] = 'inlineStr'; cell.is = { t: { '#text': text } };
  };

  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 200); i++) {
    const bCell = findCell(rows[i], 'B');
    if (getCellText(bCell).toLowerCase().trim() === 'sub inventory') { headerRowIdx = i; break; }
  }
  if (headerRowIdx === -1) return;

  const getField = (row: any, key: string): string => {
    const v = getFieldValue(row, key);
    return v === undefined || v === null ? '' : String(v);
  };

  for (let idx = 0; idx < outboundRows.length; idx++) {
    const templateRow = rows[headerRowIdx + 1 + idx];
    if (!templateRow) break;
    const rowNum = Number(templateRow['@_r'] ?? headerRowIdx + 2 + idx);
    const data   = outboundRows[idx] ?? {};

    setInlineString(getOrCreateCell(templateRow, 'B', rowNum), getField(data, 'Sub Inventory'));
    setInlineString(getOrCreateCell(templateRow, 'C', rowNum), getField(data, 'Name (Service Levels)'));
    setInlineString(getOrCreateCell(templateRow, 'E', rowNum), getField(data, 'Ref (Orders)'));

    const shippedOutRaw = getFieldValue(data, 'Shipped out');
    const dt            = parseTableauDate(shippedOutRaw);
    setInlineString(getOrCreateCell(templateRow, 'F', rowNum), dt ? formatDDMMYYYY(dt) : getField(data, 'Shipped out'));
    setInlineString(getOrCreateCell(templateRow, 'G', rowNum), getField(data, 'Repacking/Labeling'));
  }
}

function patchStorageWorksheetXml(
  worksheetObj: any, sharedStrings: string[],
  sorted: Array<{ date: Date; week: string; warehouseName: string; pallet: number; shelf: number }>,
  weeklyAllTotals: Map<string, { pallet?: number; shelf?: number }>
): void {
  const sheetData   = worksheetObj?.worksheet?.sheetData;
  const rows: any[] = forceArray(sheetData?.row);

  const getCellText = (cell: any): string => {
    if (!cell) return '';
    const t = String(cell['@_t'] ?? '');
    if (t === 's') { const idx = Number(cell.v ?? -1); return idx >= 0 && idx < sharedStrings.length ? String(sharedStrings[idx]) : ''; }
    if (t === 'inlineStr') { const tt = cell.is?.t; if (typeof tt === 'string') return tt; if (typeof tt?.['#text'] === 'string') return tt['#text']; return ''; }
    if (cell.v !== undefined && cell.v !== null) return String(cell.v);
    return '';
  };

  const findCell = (row: any, colLetter: string): any | null =>
    forceArray(row?.c).find((cc: any) => String(cc['@_r'] ?? '').toUpperCase().startsWith(colLetter.toUpperCase())) ?? null;

  const getOrCreateCell = (row: any, colLetter: string, rowNum: number): any => {
    if (!row.c) row.c = [];
    const cells = forceArray(row.c);
    const ref   = `${colLetter.toUpperCase()}${rowNum}`;
    let cell    = cells.find((cc: any) => String(cc['@_r'] ?? '').toUpperCase() === ref);
    if (!cell) { cell = { '@_r': ref }; cells.push(cell); row.c = cells; }
    return cell;
  };

  const setInlineString = (cell: any, text: string): void => { delete cell.v; cell['@_t'] = 'inlineStr'; cell.is = { t: { '#text': text } }; };
  const setNumber       = (cell: any, n: number): void    => { delete cell.is; delete cell['@_t']; cell.v = Number.isFinite(n) ? String(n) : '0'; };

  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 200); i++) {
    const cCell = findCell(rows[i], 'C');
    const text  = getCellText(cCell).toLowerCase();
    if (text.includes('day of created') || text.includes('created at')) { headerRowIdx = i; break; }
  }
  if (headerRowIdx === -1) throw new Error('Could not find Storage header row');

  let dataIdx = 0, weekDayCount = 0, lastWeek = '', lastWarehouse = '';

  for (let i = headerRowIdx + 1; i < rows.length && dataIdx < sorted.length; i++) {
    const r      = rows[i];
    const rowNum = Number(r['@_r'] ?? i + 1);
    const cCell  = getOrCreateCell(r, 'C', rowNum);
    const existingStr = getCellText(cCell).toLowerCase().trim();

    if (existingStr.includes('total')) {
      const aCell = getOrCreateCell(r, 'A', rowNum);
      const bCell = getOrCreateCell(r, 'B', rowNum);
      const dCell = getOrCreateCell(r, 'D', rowNum);
      const eCell = getOrCreateCell(r, 'E', rowNum);
      const week          = getCellText(bCell).trim() || lastWeek;
      const warehouseName = getCellText(aCell).trim() || lastWarehouse;
      const totals        = weeklyAllTotals.get(`${week}|${warehouseName}`);
      if (totals) {
        if (typeof totals.pallet === 'number') setNumber(dCell, totals.pallet);
        if (typeof totals.shelf  === 'number') setNumber(eCell, totals.shelf);
      }
      continue;
    }

    const entry = sorted[dataIdx];
    if (!entry) break;
    if (entry.week !== lastWeek) { lastWeek = entry.week; weekDayCount = 0; }
    lastWarehouse = entry.warehouseName;

    setInlineString(getOrCreateCell(r, 'A', rowNum), entry.warehouseName);
    setInlineString(getOrCreateCell(r, 'B', rowNum), entry.week);
    setInlineString(cCell,                           formatDDMMYYYY(entry.date));
    setNumber(getOrCreateCell(r, 'D', rowNum),       entry.pallet);
    setNumber(getOrCreateCell(r, 'E', rowNum),       entry.shelf);

    dataIdx++; weekDayCount++;
    if (weekDayCount >= 7) weekDayCount = 0;
  }
}

export function buildAfimilkStorageEntries(
  storageData: any[]
): Array<{ date: Date; week: string; warehouseName: string; pallet: number; shelf: number }> {
  const parseDate = (value: any): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value > 20000 && value < 80000) {
        const d = new Date(new Date(Date.UTC(1899, 11, 30)).getTime() + value * 86400000);
        return isNaN(d.getTime()) ? null : d;
      }
      if (value > 1000000000000) { const d = new Date(value);        return isNaN(d.getTime()) ? null : d; }
      if (value > 1000000000)    { const d = new Date(value * 1000); return isNaN(d.getTime()) ? null : d; }
    }
    const s  = String(value).trim();
    const m1 = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (m1) {
      const dd = Number(m1[1]), mm = Number(m1[2]), yyyy = Number(m1[3].length === 2 ? `20${m1[3]}` : m1[3]);
      const d  = new Date(yyyy, mm - 1, dd);
      if (!isNaN(d.getTime())) return d;
      const swapped = new Date(yyyy, dd - 1, mm);
      return isNaN(swapped.getTime()) ? null : swapped;
    }
    const m2 = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
    if (m2) {
      const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
      const dd = Number(m2[1]), mm = monthNames.indexOf(String(m2[2]).toLowerCase()) + 1, yyyy = Number(m2[3]);
      if (mm >= 1) { const d = new Date(yyyy, mm - 1, dd); return isNaN(d.getTime()) ? null : d; }
    }
    const mHe = s.match(/^(\d{1,2})\s+([^\s]+)\s+(\d{4})/);
    if (mHe) {
      const hebrewMonths: Record<string, number> = { 'ינואר':1,'פברואר':2,'מרץ':3,'אפריל':4,'מאי':5,'יוני':6,'יולי':7,'אוגוסט':8,'ספטמבר':9,'אוקטובר':10,'נובמבר':11,'דצמבר':12 };
      const dd         = Number(mHe[1]);
      const rawMonth   = String(mHe[2]).trim();
      const monthToken = rawMonth.startsWith('ב') ? rawMonth.slice(1) : rawMonth;
      const yyyy       = Number(mHe[3]);
      const mm         = hebrewMonths[monthToken];
      if (mm) { const d = new Date(yyyy, mm - 1, dd); return isNaN(d.getTime()) ? null : d; }
    }
    const d2 = new Date(s);
    return isNaN(d2.getTime()) ? null : d2;
  };

  const toNumber = (v: any): number => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  const grouped = new Map<string, { date: Date; week: string; warehouseName: string; pallet: number; shelf: number }>();

  for (const r of storageData) {
    const date = parseDate(r['Day of Created At (Stats)']) || parseDate(r['Day of Created At']) ||
                 parseDate(r['Date']) || parseDate(r['Day']) || parseDate(r['Created At']);
    if (!date) continue;
    const week          = String(r['Weeks'] ?? r['Week'] ?? r['Week Number'] ?? r['Week of Created At'] ?? '').trim();
    const warehouseName = String(r['Name (Warehouses)'] ?? r['Warehouse'] ?? 'Rohlig NZ').trim() || 'Rohlig NZ';
    const key           = `${date.toISOString().slice(0, 10)}|${week}|${warehouseName}`;
    if (!grouped.has(key)) grouped.set(key, { date, week, warehouseName, pallet: 0, shelf: 0 });
    const metricName = String(r['Name'] ?? r['Metric'] ?? '').toLowerCase();
    const value      = toNumber(r['Value'] ?? r['value'] ?? r['Locations of type Pallet'] ?? r['Locations of type Shelf']);
    const entry      = grouped.get(key)!;
    if (metricName.includes('pallet')) entry.pallet = value;
    else if (metricName.includes('shelf')) entry.shelf = value;
    else {
      const pallet = toNumber(r['Locations of type Pallet'] ?? r['Locations of type pallet']);
      const shelf  = toNumber(r['Locations of type Shelf']  ?? r['Locations of type shelf']);
      if (pallet) entry.pallet = pallet;
      if (shelf)  entry.shelf  = shelf;
    }
  }

  const out = Array.from(grouped.values());
  out.sort((a, b) => a.date.getTime() - b.date.getTime());
  return out;
}

function buildAfimilkStorageWeeklyAllTotals(storageData: any[]): Map<string, { pallet?: number; shelf?: number }> {
  const toNumber = (v: any): number => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const out = new Map<string, { pallet?: number; shelf?: number }>();
  for (const r of storageData) {
    const dayRaw = r['Day of Created At (Stats)'] ?? r['Day of Created At'] ?? r['Date'] ?? r['Day'] ?? r['Created At'];
    if (String(dayRaw ?? '').trim().toLowerCase() !== 'all') continue;
    const week          = String(r['Weeks'] ?? r['Week'] ?? r['Week Number'] ?? r['Week of Created At'] ?? '').trim();
    const warehouseName = String(r['Name (Warehouses)'] ?? r['Warehouse'] ?? 'Rohlig NZ').trim() || 'Rohlig NZ';
    if (!week) continue;
    const metricName = String(r['Name'] ?? r['Metric'] ?? '').toLowerCase();
    const value      = toNumber(r['Value'] ?? r['value'] ?? r['Locations of type Pallet'] ?? r['Locations of type Shelf']);
    const key        = `${week}|${warehouseName}`;
    if (!out.has(key)) out.set(key, {});
    const entry = out.get(key)!;
    if (metricName.includes('pallet')) entry.pallet = value;
    if (metricName.includes('shelf'))  entry.shelf  = value;
  }
  return out;
}

export async function fillAfimilkPreserveTemplate(
  pricelistBuffer: Buffer,
  outputPath: string,
  templateStructure: TemplateStructure,
  quantities: Map<string, number>,
  transactions?: Transaction[],
  rawViewData?: Map<string, any[]>,
  expectedInboundPeriod?: { mm: string; yyyy: string } | null
): Promise<FillResult> {
  const filledRows: FillResult['filledRows'] = [];
  const errors: string[] = [];
  let suggestedFilename: string | undefined;

  try {
    const zip     = await JSZip.loadAsync(pricelistBuffer);
    const parser  = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', suppressEmptyNode: true });

    const wbXmlPath = 'xl/workbook.xml';
    const wbXmlRaw  = await zip.file(wbXmlPath)?.async('string');
    if (!wbXmlRaw) throw new Error('Missing xl/workbook.xml in template');
    const wbObj: any = parser.parse(wbXmlRaw);

    if (!wbObj.workbook.calcPr) wbObj.workbook.calcPr = {};
    wbObj.workbook.calcPr['@_calcMode']     = 'auto';
    wbObj.workbook.calcPr['@_fullCalcOnLoad'] = '1';
    const sheets: any[] = forceArray(wbObj?.workbook?.sheets?.sheet);
    wbObj.workbook.sheets.sheet = sheets;
    if (!sheets.length) throw new Error('No sheets found in template');

    const sharedStringsXml = await zip.file('xl/sharedStrings.xml')?.async('string');
    const sharedStrings    = sharedStringsXml ? parseSharedStrings(parser.parse(sharedStringsXml)) : [];

    const inboundData = rawViewData ? findRawViewData(rawViewData, 'inbound') : null;
    if (inboundData && inboundData.length) {
      const inboundSheetEntry = sheets.find(s => String(s['@_name'] ?? '').toLowerCase().trim().includes('scans inbound'));
      if (inboundSheetEntry) {
        const cleanedInboundData = (() => {
          const rows = Array.isArray(inboundData) ? inboundData.slice() : [];
          if (!rows.length) return rows;
          const first = rows[0] ?? {};
          const hasTypeHeader = Object.entries(first).some(([k, v]) => {
            return String(k || '').toLowerCase().includes('type') && String(v || '').toLowerCase().includes('billable scan logs');
          });
          if (hasTypeHeader) return rows.slice(1);
          const anyFirstValue = Object.values(first).some(v => String(v || '').toLowerCase().includes('billable scan logs'));
          return anyFirstValue ? rows.slice(1) : rows;
        })();

        const inboundRowsInExpectedPeriod = expectedInboundPeriod
          ? cleanedInboundData.filter(r => {
              const raw = getFieldValue(r, 'Inbound at');
              const dt  = parseTableauDate(raw);
              if (!dt) return false;
              const mm   = String(dt.getMonth() + 1).padStart(2, '0');
              const yyyy = String(dt.getFullYear());
              return mm === expectedInboundPeriod.mm && yyyy === expectedInboundPeriod.yyyy;
            })
          : cleanedInboundData;

        const inboundPeriod    = extractUniquePeriodFromRows(inboundRowsInExpectedPeriod, 'Inbound at');
        const oldInboundName   = String(inboundSheetEntry['@_name'] ?? 'Scans Inbound');
        const shouldRenameInbound =
          !!expectedInboundPeriod && !!inboundPeriod &&
          inboundPeriod.mm === expectedInboundPeriod.mm && inboundPeriod.yyyy === expectedInboundPeriod.yyyy;

        if (shouldRenameInbound) {
          inboundSheetEntry['@_name'] = `Scans Inbound ${inboundPeriod.mm}-${inboundPeriod.yyyy}`;
          suggestedFilename = `Afimilk New-Zealand -Test Invoice ${inboundPeriod.mm}-${inboundPeriod.yyyy}.xlsx`;
        }

        const inboundRelId   = String(inboundSheetEntry['@_r:id'] ?? '');
        const inboundSheetPath = await resolveWorksheetPathFromWorkbookRel(zip, parser, inboundRelId);
        if (inboundSheetPath) {
          const inboundXmlRaw = await zip.file(inboundSheetPath)?.async('string');
          if (inboundXmlRaw) {
            const inboundObj: any = parser.parse(inboundXmlRaw);
            patchScansInboundWorksheetXml(inboundObj, sharedStrings, inboundRowsInExpectedPeriod);
            zip.file(inboundSheetPath, builder.build(inboundObj));
          }
        }

        const newInboundName = String(inboundSheetEntry['@_name'] ?? oldInboundName);
        if (newInboundName !== oldInboundName) {
          await replaceSheetNameInAllFormulas(zip, parser, builder, oldInboundName, newInboundName);
        }
      }
    }

    await patchInvoiceQtyOpenXml(zip, parser, builder, wbObj, templateStructure, quantities, filledRows, errors);
    zip.file(wbXmlPath, builder.build(wbObj));

    const outBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    await writeBufferToFile(outputPath, outBuffer);

    return { success: errors.length === 0, filePath: outputPath, suggestedFilename, filledRows, errors };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    return { success: false, filePath: outputPath, suggestedFilename, filledRows, errors: [...errors, err.message] };
  }
}
