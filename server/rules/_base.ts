import * as XLSX from 'xlsx';
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const ExcelJS = _require('exceljs') as any;
import { promises as fs } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { TemplateStructure, LineItem, Transaction } from '../types';

export interface FillResult {
  success: boolean;
  filePath: string;
  suggestedFilename?: string;
  filledRows: Array<{
    sheet: string;
    row: number;
    oldQty: number | null;
    newQty: number;
    oldTotal: number;
    newTotal: number;
  }>;
  errors: string[];
}

export function getLineItemKey(item: LineItem): string {
  return `${item.segment}|${item.clause}|${item.category}|${item.unitOfMeasure}|${item.remark}`;
}

export function getFieldValue(row: any, fieldName: string): any {
  if (!row || !fieldName) return undefined;
  if (Object.prototype.hasOwnProperty.call(row, fieldName)) return row[fieldName];
  const target = String(fieldName).toLowerCase().trim();
  const key = Object.keys(row).find(k => String(k).toLowerCase().trim() === target);
  return key ? row[key] : undefined;
}

export function parseTableauDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 20000 && value < 80000) {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(excelEpoch.getTime() + value * 24 * 60 * 60 * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
    if (value > 1000000000000) { const d = new Date(value); return isNaN(d.getTime()) ? null : d; }
    if (value > 1000000000)    { const d = new Date(value * 1000); return isNaN(d.getTime()) ? null : d; }
  }
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+.*)?$/);
  if (m) {
    const dd = Number(m[1]), mm = Number(m[2]), yyyy = Number(m[3]);
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      const d = new Date(yyyy, mm - 1, dd); return isNaN(d.getTime()) ? null : d;
    }
  }
  const mdot = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+.*)?$/);
  if (mdot) {
    const dd = Number(mdot[1]), mm = Number(mdot[2]), yyyy = Number(mdot[3]);
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      const d = new Date(yyyy, mm - 1, dd); return isNaN(d.getTime()) ? null : d;
    }
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function formatDDMMYYYY(d: Date): string {
  const dd   = String(d.getDate()).padStart(2, '0');
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

export function forceArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseSharedStrings(sharedStringsObj: any): string[] {
  const sst = sharedStringsObj?.sst;
  const si  = forceArray(sst?.si);
  const out: string[] = [];
  for (const item of si) {
    if (typeof item?.t === 'string') { out.push(String(item.t)); continue; }
    if (typeof item?.t?.['#text'] === 'string') { out.push(String(item.t['#text'])); continue; }
    const runs   = forceArray(item?.r);
    const pieces = runs.map((r: any) => {
      const t = r?.t;
      if (typeof t === 'string') return t;
      if (typeof t?.['#text'] === 'string') return t['#text'];
      return '';
    }).join('');
    out.push(String(pieces));
  }
  return out;
}

export async function resolveWorksheetPathFromWorkbookRel(
  zip: JSZip, parser: XMLParser, relId: string
): Promise<string | null> {
  const relsPath = 'xl/_rels/workbook.xml.rels';
  const relsRaw  = await zip.file(relsPath)?.async('string');
  if (!relsRaw) return null;
  const relsObj: any = parser.parse(relsRaw);
  const rels = forceArray(relsObj?.Relationships?.Relationship);
  const rel  = rels.find((r: any) => String(r['@_Id']) === relId);
  if (!rel) return null;
  const target     = String(rel['@_Target'] ?? '');
  if (!target) return null;
  const normalized = target.startsWith('/') ? target.slice(1) : target;
  return normalized.startsWith('xl/') ? normalized : `xl/${normalized}`;
}

export function colIdxToLetter(idx: number): string {
  let n = idx + 1, col = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n   = Math.floor((n - 1) / 26);
  }
  return col;
}

export async function writeBufferToFile(filePath: string, buffer: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
}

export function fillInvoiceSheets(
  workbook: XLSX.WorkBook,
  templateStructure: TemplateStructure,
  quantities: Map<string, number>,
  filledRows: FillResult['filledRows'],
  errors: string[]
): void {
  for (const sheet of templateStructure.sheets) {
    if (sheet.type !== 'invoice') continue;
    const worksheet = workbook.Sheets[sheet.name];
    if (!worksheet) { errors.push(`Sheet not found: ${sheet.name}`); continue; }
    for (const item of sheet.lineItems) {
      const key    = getLineItemKey(item);
      const newQty = quantities.get(key);
      if (newQty === undefined) continue;
      const { columns }  = templateStructure;
      const qtyCellRef   = XLSX.utils.encode_cell({ r: item.row - 1, c: columns.qty });
      const totalCellRef = XLSX.utils.encode_cell({ r: item.row - 1, c: columns.total });
      const rateCellRef  = XLSX.utils.encode_cell({ r: item.row - 1, c: columns.rate });
      const oldQtyCell   = worksheet[qtyCellRef];
      const oldTotalCell = worksheet[totalCellRef];
      const rateCell     = worksheet[rateCellRef];
      const oldQty   = oldQtyCell   ? (oldQtyCell.v   ?? oldQtyCell.value)   : null;
      const oldTotal = oldTotalCell ? (oldTotalCell.v ?? oldTotalCell.value ?? 0) : 0;
      const rate     = rateCell     ? (rateCell.v     ?? rateCell.value     ?? 0) : 0;
      const newTotal = newQty * rate;
      worksheet[qtyCellRef]   = { ...oldQtyCell,   v: newQty,   value: newQty,   t: 'n', w: String(newQty) };
      worksheet[totalCellRef] = { ...oldTotalCell, v: newTotal, value: newTotal, t: 'n',
        w: String(Number.isFinite(newTotal) ? newTotal.toFixed(2) : newTotal) };
      filledRows.push({ sheet: sheet.name, row: item.row,
        oldQty: oldQty !== null ? Number(oldQty) : null,
        newQty, oldTotal: Number(oldTotal), newTotal });
    }
  }
}

export async function fillWithExcelJS(
  pricelistBuffer: Buffer,
  templateStructure: TemplateStructure,
  quantities: Map<string, number>,
  outputPath: string,
  filledRows: FillResult['filledRows'],
  errors: string[]
): Promise<void> {
  const excelWorkbook = new ExcelJS.Workbook();
  await excelWorkbook.xlsx.load(pricelistBuffer as any);
  for (const sheet of templateStructure.sheets) {
    if (sheet.type !== 'invoice') continue;
    const worksheet = excelWorkbook.getWorksheet(sheet.name);
    if (!worksheet) { errors.push(`Sheet not found: ${sheet.name}`); continue; }
    for (const item of sheet.lineItems) {
      const key    = getLineItemKey(item);
      const newQty = quantities.get(key);
      if (newQty === undefined) continue;
      const { columns } = templateStructure;
      const row       = worksheet.getRow(item.row);
      const qtyCell   = row.getCell(columns.qty   + 1);
      const totalCell = row.getCell(columns.total + 1);
      const rateCell  = row.getCell(columns.rate  + 1);
      const oldQty    = qtyCell.value as number | null;
      const rate      = (rateCell.value as number) || 0;
      const newTotal  = newQty * rate;
      qtyCell.value   = newQty;
      totalCell.value = newTotal;
      if (newQty !== Math.floor(newQty)) qtyCell.numFmt = '0.0';
      filledRows.push({ sheet: sheet.name, row: item.row,
        oldQty: oldQty !== null ? Number(oldQty) : null, newQty, oldTotal: 0, newTotal });
    }
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await excelWorkbook.xlsx.writeFile(outputPath);
  console.log(`[Base] ExcelJS wrote template: ${outputPath}`);
}

export async function patchInvoiceQtyOpenXml(
  zip: JSZip, parser: XMLParser, builder: XMLBuilder, wbObj: any,
  templateStructure: TemplateStructure, quantities: Map<string, number>,
  filledRows: FillResult['filledRows'], errors: string[]
): Promise<void> {
  const qtyCol  = colIdxToLetter(templateStructure.columns.qty);
  const rateCol = colIdxToLetter(templateStructure.columns.rate);
  const sheets: any[] = forceArray(wbObj?.workbook?.sheets?.sheet);
  wbObj.workbook.sheets.sheet = sheets;

  const getOrCreateCell = (row: any, colLetter: string, rowNum: number): any => {
    if (!row.c) row.c = [];
    const cells = forceArray(row.c);
    const ref   = `${colLetter.toUpperCase()}${rowNum}`;
    let cell    = cells.find((cc: any) => String(cc['@_r'] ?? '').toUpperCase() === ref);
    if (!cell) { cell = { '@_r': ref }; cells.push(cell); row.c = cells; }
    return cell;
  };

  const getCellNumber = (row: any, colLetter: string, rowNum: number): number => {
    const cells = forceArray(row?.c);
    const ref   = `${colLetter.toUpperCase()}${rowNum}`;
    const cell  = cells.find((cc: any) => String(cc['@_r'] ?? '').toUpperCase() === ref);
    if (!cell) return 0;
    const raw = cell.v ?? cell.value;
    const n   = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  for (const sheet of templateStructure.sheets) {
    if (sheet.type !== 'invoice') continue;
    const sheetEntry = sheets.find(s => String(s['@_name'] ?? '') === sheet.name);
    if (!sheetEntry) { errors.push(`Sheet not found: ${sheet.name}`); continue; }
    const relId     = String(sheetEntry['@_r:id'] ?? '');
    const sheetPath = await resolveWorksheetPathFromWorkbookRel(zip, parser, relId);
    if (!sheetPath) { errors.push(`Could not resolve worksheet XML path for: ${sheet.name}`); continue; }
    const xmlRaw = await zip.file(sheetPath)?.async('string');
    if (!xmlRaw) { errors.push(`Missing worksheet XML for: ${sheet.name}`); continue; }
    const wsObj: any  = parser.parse(xmlRaw);
    const sheetData   = wsObj?.worksheet?.sheetData;
    const rows: any[] = forceArray(sheetData?.row);
    if (!sheetData) { errors.push(`Missing sheetData for: ${sheet.name}`); continue; }
    for (const item of sheet.lineItems) {
      const key    = getLineItemKey(item);
      const newQty = quantities.get(key);
      if (newQty === undefined) continue;
      const rowNum = item.row;
      const row    = rows.find((r: any) => Number(r['@_r'] ?? 0) === rowNum);
      if (!row) { errors.push(`Row not found in ${sheet.name}: ${rowNum}`); continue; }
      const qtyCell   = getOrCreateCell(row, qtyCol, rowNum);
      const oldQtyRaw = qtyCell.v ?? qtyCell.value;
      const oldQty    = oldQtyRaw !== undefined && oldQtyRaw !== null ? Number(oldQtyRaw) : null;
      delete qtyCell.is; delete qtyCell['@_t'];
      qtyCell.v       = String(newQty);
      const rate      = getCellNumber(row, rateCol, rowNum);
      const newTotal  = newQty * rate;
      filledRows.push({ sheet: sheet.name, row: rowNum,
        oldQty: oldQty !== null && Number.isFinite(oldQty) ? oldQty : null,
        newQty, oldTotal: 0, newTotal });
    }
    wsObj.worksheet.sheetData.row = rows;
    zip.file(sheetPath, builder.build(wsObj));
  }
}

export async function replaceSheetNameInAllFormulas(
  zip: JSZip, parser: XMLParser, builder: XMLBuilder,
  oldName: string, newName: string
): Promise<void> {
  const files     = Object.keys(zip.files).filter(p => p.startsWith('xl/worksheets/sheet') && p.endsWith('.xml'));
  const quotedOld = `'${oldName.replace(/'/g, "''")}\'!`;
  const quotedNew = `'${newName.replace(/'/g, "''")}\'!`;
  const plainOld  = `${oldName}!`;
  const plainNew  = `${newName}!`;
  for (const f of files) {
    const raw = await zip.file(f)?.async('string');
    if (!raw) continue;
    const obj: any    = parser.parse(raw);
    let changed       = false;
    const rows: any[] = forceArray(obj?.worksheet?.sheetData?.row);
    for (const row of rows) {
      const cells = forceArray(row?.c);
      for (const cell of cells) {
        if (typeof cell?.f === 'string') {
          let formula = cell.f;
          if (formula.includes(quotedOld)) { formula = formula.split(quotedOld).join(quotedNew); changed = true; }
          if (formula.includes(plainOld))  { formula = formula.split(plainOld).join(plainNew);   changed = true; }
          cell.f = formula;
        } else if (typeof cell?.f?.['#text'] === 'string') {
          let formula = String(cell.f['#text']);
          if (formula.includes(quotedOld)) { formula = formula.split(quotedOld).join(quotedNew); changed = true; }
          if (formula.includes(plainOld))  { formula = formula.split(plainOld).join(plainNew);   changed = true; }
          cell.f['#text'] = formula;
        }
      }
    }
    if (changed) zip.file(f, builder.build(obj));
  }
}

export async function addOrReplaceWorksheetOpenXml(
  zip: JSZip, parser: XMLParser, builder: XMLBuilder,
  wbObj: any, sheetName: string, data: any[]
): Promise<void> {
  const wbXmlPath = 'xl/workbook.xml';
  const relsPath  = 'xl/_rels/workbook.xml.rels';
  const ctPath    = '[Content_Types].xml';
  const sheets: any[] = forceArray(wbObj?.workbook?.sheets?.sheet);
  wbObj.workbook.sheets.sheet = sheets;
  const relsRaw = await zip.file(relsPath)?.async('string');
  if (!relsRaw) throw new Error('Missing xl/_rels/workbook.xml.rels');
  const relsObj: any   = parser.parse(relsRaw);
  const rels: any[]    = forceArray(relsObj?.Relationships?.Relationship);
  relsObj.Relationships.Relationship = rels;
  const ctRaw = await zip.file(ctPath)?.async('string');
  if (!ctRaw) throw new Error('Missing [Content_Types].xml');
  const ctObj: any      = parser.parse(ctRaw);
  const overrides: any[] = forceArray(ctObj?.Types?.Override);
  ctObj.Types.Override   = overrides;
  const existingSheet = sheets.find(s => String(s['@_name']).toLowerCase() === sheetName.toLowerCase());
  let relId: string, targetPath: string;
  if (existingSheet) {
    relId = String(existingSheet['@_r:id']);
    const resolved = await resolveWorksheetPathFromWorkbookRel(zip, parser, relId);
    if (!resolved) throw new Error(`Could not resolve worksheet path for ${sheetName}`);
    targetPath = resolved;
  } else {
    const usedRelIds    = rels.map(r => Number(String(r['@_Id'] ?? '').replace(/^rId/i, ''))).filter(n => Number.isFinite(n));
    const nextRelNum    = (usedRelIds.length ? Math.max(...usedRelIds) : 0) + 1;
    relId               = `rId${nextRelNum}`;
    const sheetFiles    = Object.keys(zip.files).filter(p => p.startsWith('xl/worksheets/sheet') && p.endsWith('.xml'))
      .map(p => Number(p.match(/sheet(\d+)\.xml$/i)?.[1] ?? '0')).filter(n => n > 0);
    const nextSheetNum  = (sheetFiles.length ? Math.max(...sheetFiles) : 0) + 1;
    targetPath          = `xl/worksheets/sheet${nextSheetNum}.xml`;
    const usedSheetIds  = sheets.map(s => Number(s['@_sheetId'])).filter(n => Number.isFinite(n));
    const sheetId       = (usedSheetIds.length ? Math.max(...usedSheetIds) : 0) + 1;
    sheets.push({ '@_name': sheetName, '@_sheetId': String(sheetId), '@_r:id': relId });
    rels.push({ '@_Id': relId,
      '@_Type': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet',
      '@_Target': `worksheets/sheet${nextSheetNum}.xml` });
    const partName = `/${targetPath}`;
    if (!overrides.some(o => String(o['@_PartName']) === partName)) {
      overrides.push({ '@_PartName': partName,
        '@_ContentType': 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml' });
    }
  }
  const headers = data.length ? Object.keys(data[0]) : [];
  const aoa: any[][] = [];
  if (headers.length) { aoa.push(headers); for (const row of data) aoa.push(headers.map(h => row[h] ?? '')); }
  const makeCellRef = (colIdx: number, rowIdx: number): string => {
    let n = colIdx + 1, col = '';
    while (n > 0) { const rem = (n - 1) % 26; col = String.fromCharCode(65 + rem) + col; n = Math.floor((n - 1) / 26); }
    return `${col}${rowIdx + 1}`;
  };
  const sheetDataRows: any[] = [];
  for (let r = 0; r < aoa.length; r++) {
    const rowCells: any[] = [];
    for (let c = 0; c < aoa[r].length; c++) {
      const ref = makeCellRef(c, r), val = aoa[r][c];
      if (typeof val === 'number' && Number.isFinite(val)) rowCells.push({ '@_r': ref, v: String(val) });
      else rowCells.push({ '@_r': ref, '@_t': 'inlineStr', is: { t: { '#text': String(val ?? '') } } });
    }
    sheetDataRows.push({ '@_r': String(r + 1), c: rowCells });
  }
  const wsObj: any = { worksheet: {
    '@_xmlns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    '@_xmlns:r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    sheetData: { row: sheetDataRows }
  }};
  zip.file(targetPath, builder.build(wsObj));
  zip.file(relsPath,   builder.build(relsObj));
  zip.file(ctPath,     builder.build(ctObj));
  zip.file(wbXmlPath,  builder.build(wbObj));
}

export function addRawSheet(workbook: XLSX.WorkBook, data: any[], name: string): void {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  console.log(`[Base] ${name} sheet headers:`, headers);
  console.log(`[Base] ${name} first row sample:`, data[0]);
  const rows = data.map(r => headers.map(h => r[h] ?? ''));
  const aoa: any[][] = [headers, ...rows];
  if (name === 'Inbound' || name === 'Outbound') {
    const findCol = (keywords: string[]) =>
      headers.find(h => keywords.some(kw => h.toLowerCase().includes(kw.toLowerCase())));
    const serviceLevelCol    = findCol(['Service Level', 'service_name', 'Name (Service']);
    const refCol             = findCol(['Ref (Orders)', 'Ref(Orders)', 'ref']);
    const distinctCountIdCol = findCol(['Distinct count of Id (Billable Scan Logs)', 'Distinct count of Id']);
    const startCol = headers.length + 1;
    let summaryHeader: string[], summaryDataRows: any[][], totalRefs = 0, totalBoxes = 0;
    if (name === 'Inbound') {
      const pivot = new Map<string, { refs: Set<string>; boxes: number }>();
      for (const row of data) {
        const svcLevel = serviceLevelCol ? String(row[serviceLevelCol] ?? 'Unknown') : 'Unknown';
        const ref      = refCol ? String(row[refCol] ?? '') : '';
        if (!pivot.has(svcLevel)) pivot.set(svcLevel, { refs: new Set(), boxes: 0 });
        const entry = pivot.get(svcLevel)!;
        if (ref) entry.refs.add(ref);
        if (distinctCountIdCol) entry.boxes += parseFloat(String(row[distinctCountIdCol] ?? '0')) || 0;
      }
      summaryHeader   = [serviceLevelCol ?? 'Name (Service Levels)', 'Distinct count of Ref (Orders)', 'Boxed count'];
      summaryDataRows = [];
      for (const [svcLevel, { refs, boxes }] of pivot.entries()) {
        summaryDataRows.push([svcLevel, refs.size, boxes]);
        totalRefs += refs.size; totalBoxes += boxes;
      }
    } else {
      const domIntCol          = findCol(["Dom/Int'l", 'Dom/Int', 'domint']);
      const distinctCountIdCol2 = findCol(['Distinct count of Id (Billable Scan Logs)', 'Distinct count of Id']);
      const pivot = new Map<string, { svc: string; domInt: string; refs: Set<string>; boxes: number }>();
      for (const row of data) {
        const svcLevel = serviceLevelCol ? String(row[serviceLevelCol] ?? 'Unknown') : 'Unknown';
        const domInt   = domIntCol ? String(row[domIntCol] ?? '') : '';
        const ref      = refCol ? String(row[refCol] ?? '') : '';
        const key      = `${svcLevel}||${domInt}`;
        if (!pivot.has(key)) pivot.set(key, { svc: svcLevel, domInt, refs: new Set(), boxes: 0 });
        const entry = pivot.get(key)!;
        if (ref) entry.refs.add(ref);
        if (distinctCountIdCol2) entry.boxes += parseFloat(String(row[distinctCountIdCol2] ?? '0')) || 0;
      }
      summaryHeader   = ['Name', "Dom/Int'l", 'Ref count', 'Boxed count'];
      summaryDataRows = [];
      for (const { svc, domInt, refs, boxes } of pivot.values()) {
        summaryDataRows.push([svc, domInt, refs.size, boxes]);
        totalRefs += refs.size; totalBoxes += boxes;
      }
    }
    if (!aoa[0]) aoa[0] = [];
    while (aoa[0].length < startCol) aoa[0].push('');
    summaryHeader.forEach((h, i) => { aoa[0][startCol + i] = h; });
    for (let i = 0; i < summaryDataRows.length; i++) {
      const r = i + 1;
      if (!aoa[r]) aoa[r] = [];
      while (aoa[r].length < startCol) aoa[r].push('');
      summaryDataRows[i].forEach((v, j) => { aoa[r][startCol + j] = v; });
    }
    const totalRow = summaryDataRows.length + 1;
    if (!aoa[totalRow]) aoa[totalRow] = [];
    while (aoa[totalRow].length < startCol) aoa[totalRow].push('');
    if (name === 'Inbound') {
      aoa[totalRow][startCol] = 'Total'; aoa[totalRow][startCol + 1] = totalRefs; aoa[totalRow][startCol + 2] = totalBoxes;
    } else {
      aoa[totalRow][startCol] = 'Total'; aoa[totalRow][startCol + 2] = totalRefs; aoa[totalRow][startCol + 3] = totalBoxes;
    }
    console.log(`[Base] ${name} summary: ${summaryDataRows.length} groups, ${totalRefs} orders, ${totalBoxes} boxes`);
  }
  if (name === 'Storage') {
    const toNumber = (v: any): number => {
      const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''));
      return Number.isFinite(n) ? n : 0;
    };
    let maxPallet = 0, maxShelf = 0;
    for (const row of data) {
      const metricName = String(row['Name'] ?? row['Metric'] ?? '').toLowerCase();
      const value      = toNumber(row['Value'] ?? row['value']);
      if (metricName.includes('pallet')) maxPallet = Math.max(maxPallet, value);
      else if (metricName.includes('shelf')) maxShelf = Math.max(maxShelf, value);
    }
    const shelfSqm = maxShelf * 0.5, palletSqm = maxPallet * 1.5, totalSqm = shelfSqm + palletSqm;
    const startCol = headers.length + 1;
    aoa[0][startCol] = 'Type'; aoa[0][startCol + 1] = 'Sqm'; aoa[0][startCol + 2] = 'TotalMax'; aoa[0][startCol + 3] = 'Total space (Sqm)';
    aoa[1] = aoa[1] || []; aoa[1][startCol] = 'Shelf';  aoa[1][startCol + 1] = 0.5; aoa[1][startCol + 2] = maxShelf;  aoa[1][startCol + 3] = shelfSqm;
    aoa[2] = aoa[2] || []; aoa[2][startCol] = 'Pallet'; aoa[2][startCol + 1] = 1.5; aoa[2][startCol + 2] = maxPallet; aoa[2][startCol + 3] = palletSqm;
    aoa[3] = aoa[3] || []; aoa[3][startCol] = 'Total';  aoa[3][startCol + 1] = '';  aoa[3][startCol + 2] = '';         aoa[3][startCol + 3] = totalSqm;
    console.log(`[Base] Storage summary: maxShelf=${maxShelf}(${shelfSqm}sqm), maxPallet=${maxPallet}(${palletSqm}sqm), total=${totalSqm}sqm`);
  }
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  if (workbook.SheetNames.includes(name)) { workbook.Sheets[name] = sheet; }
  else { workbook.SheetNames.push(name); workbook.Sheets[name] = sheet; }
  console.log(`[Base] ${name}: ${data.length} rows`);
}

export function addAnalyzeSheet(workbook: XLSX.WorkBook, transactions: Transaction[]): void {
  const groups = new Map<string, { type: string; orders: Set<string>; qty: number }>();
  transactions.forEach(t => {
    const key = t.segment;
    if (!groups.has(key)) groups.set(key, { type: t.segment, orders: new Set(), qty: 0 });
    const g = groups.get(key)!;
    g.orders.add(t.orderNumber); g.qty += t.quantity;
  });
  const rows: (string | number)[][] = [];
  groups.forEach((g, type) => {
    rows.push([type, '', '', '']);
    rows.push(['', 'Total', g.orders.size, g.qty]);
  });
  const sheet = XLSX.utils.aoa_to_sheet([['Type', 'Ref (Orders)', 'Order count', 'QTY'], ...rows]);
  workbook.SheetNames.push('Analyze');
  workbook.Sheets['Analyze'] = sheet;
  console.log(`[Base] Analyze: ${groups.size} groups`);
}
