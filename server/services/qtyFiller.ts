import * as XLSX from 'xlsx';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { TemplateStructure, LineItem, Transaction } from '../types';

export interface FillResult {
  success: boolean;
  filePath: string;
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

export class QTYFiller {
  static async fillAfimilkPreserveTemplate(
    pricelistBuffer: Buffer,
    outputPath: string,
    templateStructure: TemplateStructure,
    quantities: Map<string, number>,
    transactions?: Transaction[],
    rawViewData?: Map<string, any[]>
  ): Promise<FillResult> {
    const filledRows: FillResult['filledRows'] = [];
    const errors: string[] = [];

    try {
      const storageData = rawViewData?.get('Storage') ?? [];
      const management = rawViewData?.get('Management') || rawViewData?.get('Managment') || [];
      const analyzeRows = this.buildAnalyzeRows(transactions ?? []);

      const zip = await JSZip.loadAsync(pricelistBuffer);
      const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
      const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', suppressEmptyNode: true });

      const wbXmlPath = 'xl/workbook.xml';
      const wbXmlRaw = await zip.file(wbXmlPath)?.async('string');
      if (!wbXmlRaw) throw new Error('Missing xl/workbook.xml in template');
      const wbObj: any = parser.parse(wbXmlRaw);
      const sheets: any[] = this.forceArray(wbObj?.workbook?.sheets?.sheet);
      wbObj.workbook.sheets.sheet = sheets;
      if (!sheets.length) throw new Error('No sheets found in template');

      const sharedStringsXml = await zip.file('xl/sharedStrings.xml')?.async('string');
      const sharedStrings = sharedStringsXml ? this.parseSharedStrings(parser.parse(sharedStringsXml)) : [];

      if (storageData.length) {
        const sorted = this.buildAfimilkStorageEntries(storageData);
        if (!sorted.length) {
          const first = storageData?.[0] ?? {};
          const keys = Object.keys(first).slice(0, 30);
          throw new Error(`No Storage rows with valid dates. First row keys: ${JSON.stringify(keys)}`);
        }

        const mm = String(sorted[0].date.getMonth() + 1).padStart(2, '0');
        const yyyy = String(sorted[0].date.getFullYear());
        const newStorageName = `Storage ${mm} ${yyyy}`;

        const storageSheetEntry = sheets.find(s => String(s['@_name'] ?? '').toLowerCase().trim().startsWith('storage'));
        if (!storageSheetEntry) throw new Error('Storage sheet not found in uploaded pricelist');
        const oldStorageName = String(storageSheetEntry['@_name']);
        storageSheetEntry['@_name'] = newStorageName;

        const storageRelId = String(storageSheetEntry['@_r:id'] ?? '');
        const storageSheetPath = await this.resolveWorksheetPathFromWorkbookRel(zip, parser, storageRelId);
        if (!storageSheetPath) throw new Error('Could not resolve Storage worksheet XML path');

        const storageXmlRaw = await zip.file(storageSheetPath)?.async('string');
        if (!storageXmlRaw) throw new Error(`Missing Storage worksheet XML at ${storageSheetPath}`);
        const storageObj: any = parser.parse(storageXmlRaw);
        this.patchStorageWorksheetXml(storageObj, sharedStrings, sorted);
        zip.file(storageSheetPath, builder.build(storageObj));

        await this.replaceSheetNameInAllFormulas(zip, parser, builder, oldStorageName, newStorageName);
      }

      await this.addOrReplaceWorksheetOpenXml(zip, parser, builder, wbObj, 'Management', management);
      await this.addOrReplaceWorksheetOpenXml(zip, parser, builder, wbObj, 'Analyze', analyzeRows);

      zip.file(wbXmlPath, builder.build(wbObj));

      const outBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      // Fill invoice QTY cells using SheetJS to avoid implementing full OpenXML cell patching
      // (Afimilk templates must preserve original sheets/formulas as much as possible)
      const workbook = XLSX.read(outBuffer, { type: 'buffer' });
      this.fillInvoiceSheets(workbook, templateStructure, quantities, filledRows, errors);
      XLSX.writeFile(workbook, outputPath);

      return { success: errors.length === 0, filePath: outputPath, filledRows, errors };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      return { success: false, filePath: outputPath, filledRows, errors: [...errors, err.message] };
    }
  }

  private static fillInvoiceSheets(
    workbook: XLSX.WorkBook,
    templateStructure: TemplateStructure,
    quantities: Map<string, number>,
    filledRows: FillResult['filledRows'],
    errors: string[]
  ) {
    for (const sheet of templateStructure.sheets) {
      if (sheet.type !== 'invoice') continue;
      const worksheet = workbook.Sheets[sheet.name];
      if (!worksheet) {
        errors.push(`Sheet not found: ${sheet.name}`);
        continue;
      }

      for (const item of sheet.lineItems) {
        const key = this.getLineItemKey(item);
        const newQty = quantities.get(key);
        if (newQty === undefined) continue;

        const { columns } = templateStructure;
        const qtyCellRef = XLSX.utils.encode_cell({ r: item.row - 1, c: columns.qty });
        const totalCellRef = XLSX.utils.encode_cell({ r: item.row - 1, c: columns.total });
        const rateCellRef = XLSX.utils.encode_cell({ r: item.row - 1, c: columns.rate });

        const oldQtyCell = worksheet[qtyCellRef];
        const oldTotalCell = worksheet[totalCellRef];
        const rateCell = worksheet[rateCellRef];

        const oldQty = oldQtyCell ? (oldQtyCell.v ?? oldQtyCell.value) : null;
        const oldTotal = oldTotalCell ? (oldTotalCell.v ?? oldTotalCell.value ?? 0) : 0;
        const rate = rateCell ? (rateCell.v ?? rateCell.value ?? 0) : 0;
        const newTotal = newQty * rate;

        worksheet[qtyCellRef] = { ...oldQtyCell, v: newQty, value: newQty, t: 'n', w: String(newQty) };
        worksheet[totalCellRef] = {
          ...oldTotalCell,
          v: newTotal,
          value: newTotal,
          t: 'n',
          w: String(Number.isFinite(newTotal) ? newTotal.toFixed(2) : newTotal)
        };

        filledRows.push({
          sheet: sheet.name,
          row: item.row,
          oldQty: oldQty !== null ? Number(oldQty) : null,
          newQty,
          oldTotal: Number(oldTotal),
          newTotal
        });
      }
    }
  }

  static fill(
    pricelistBuffer: Buffer,
    templateStructure: TemplateStructure,
    quantities: Map<string, number>,
    outputPath: string,
    transactions?: Transaction[],
    rawViewData?: Map<string, any[]>
  ): FillResult {
    const workbook = XLSX.read(pricelistBuffer, { type: 'buffer' });
    const filledRows: FillResult['filledRows'] = [];
    const errors: string[] = [];

    // Add raw data sheets for Afimilk NZ structure
    if (rawViewData) {
      // Raw data sheets from Tableau views
      const inbound = rawViewData.get('Inbound');
      if (inbound) this.addRawSheet(workbook, inbound, 'Inbound');

      const outbound = rawViewData.get('Outbound');
      if (outbound) this.addRawSheet(workbook, outbound, 'Outbound');

      const storage = rawViewData.get('Storage');
      if (storage) this.addRawSheet(workbook, storage, 'Storage');
      
      const vas = rawViewData.get('VAS');
      if (vas) this.addRawSheet(workbook, vas, 'VAS');
      
      const management = rawViewData.get('Management') || rawViewData.get('Managment');
      if (management) this.addRawSheet(workbook, management, 'Management');
      
      const pivot = rawViewData.get('Pivot');
      if (pivot) this.addRawSheet(workbook, pivot, 'Pivot');
      
      const pivotOut = rawViewData.get('Pivot Out');
      if (pivotOut) this.addRawSheet(workbook, pivotOut, 'Pivot Out');
      
      const exw = rawViewData.get('EXW');
      if (exw) this.addRawSheet(workbook, exw, 'EXW');
    }

    if (transactions && transactions.length > 0) {
      this.addAnalyzeSheet(workbook, transactions);
    }

    this.fillInvoiceSheets(workbook, templateStructure, quantities, filledRows, errors);

    XLSX.writeFile(workbook, outputPath);
    return { success: errors.length === 0, filePath: outputPath, filledRows, errors };
  }

  private static async writeBufferToFile(filePath: string, buffer: Buffer): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
  }

  private static forceArray<T>(value: T | T[] | undefined | null): T[] {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
  }

  private static parseSharedStrings(sharedStringsObj: any): string[] {
    const sst = sharedStringsObj?.sst;
    const si = this.forceArray(sst?.si);
    const out: string[] = [];
    for (const item of si) {
      if (typeof item?.t === 'string') {
        out.push(String(item.t));
        continue;
      }
      if (typeof item?.t?.['#text'] === 'string') {
        out.push(String(item.t['#text']));
        continue;
      }
      const runs = this.forceArray(item?.r);
      const pieces = runs
        .map((r: any) => {
          const t = r?.t;
          if (typeof t === 'string') return t;
          if (typeof t?.['#text'] === 'string') return t['#text'];
          return '';
        })
        .join('');
      out.push(String(pieces));
    }
    return out;
  }

  private static async resolveWorksheetPathFromWorkbookRel(
    zip: JSZip,
    parser: XMLParser,
    relId: string
  ): Promise<string | null> {
    const relsPath = 'xl/_rels/workbook.xml.rels';
    const relsRaw = await zip.file(relsPath)?.async('string');
    if (!relsRaw) return null;
    const relsObj: any = parser.parse(relsRaw);
    const rels = this.forceArray(relsObj?.Relationships?.Relationship);
    const rel = rels.find((r: any) => String(r['@_Id']) === relId);
    if (!rel) return null;
    const target = String(rel['@_Target'] ?? '');
    if (!target) return null;
    const normalized = target.startsWith('/') ? target.slice(1) : target;
    return normalized.startsWith('xl/') ? normalized : `xl/${normalized}`;
  }

  private static patchStorageWorksheetXml(
    worksheetObj: any,
    sharedStrings: string[],
    sorted: Array<{ date: Date; week: string; pallet: number; shelf: number }>
  ): void {
    const sheetData = worksheetObj?.worksheet?.sheetData;
    const rows: any[] = this.forceArray(sheetData?.row);

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
      const cells = this.forceArray(row?.c);
      const c = cells.find((cc: any) => String(cc['@_r'] ?? '').toUpperCase().startsWith(colLetter.toUpperCase()));
      return c ?? null;
    };

    const getOrCreateCell = (row: any, colLetter: string, rowNum: number): any => {
      if (!row.c) row.c = [];
      const cells = this.forceArray(row.c);
      let cell = cells.find((cc: any) => String(cc['@_r'] ?? '').toUpperCase() === `${colLetter.toUpperCase()}${rowNum}`);
      if (!cell) {
        cell = { '@_r': `${colLetter.toUpperCase()}${rowNum}` };
        cells.push(cell);
        row.c = cells;
      }
      return cell;
    };

    const setInlineString = (cell: any, text: string): void => {
      delete cell.v;
      cell['@_t'] = 'inlineStr';
      cell.is = { t: { '#text': text } };
    };

    const setNumber = (cell: any, n: number): void => {
      delete cell.is;
      delete cell['@_t'];
      cell.v = Number.isFinite(n) ? String(n) : '0';
    };

    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 200); i++) {
      const r = rows[i];
      const cCell = findCell(r, 'C');
      const text = getCellText(cCell).toLowerCase();
      if (text.includes('day of created') || text.includes('created at')) {
        headerRowIdx = i;
        break;
      }
    }
    if (headerRowIdx === -1) throw new Error('Could not find Storage header row');

    let dataIdx = 0;
    for (let i = headerRowIdx + 1; i < rows.length && dataIdx < sorted.length; i++) {
      const r = rows[i];
      const rowNum = Number(r['@_r'] ?? i + 1);
      const cCell = getOrCreateCell(r, 'C', rowNum);
      const existingStr = getCellText(cCell).toLowerCase().trim();
      if (existingStr.includes('total')) continue;

      const entry = sorted[dataIdx++];
      const bCell = getOrCreateCell(r, 'B', rowNum);
      const dCell = getOrCreateCell(r, 'D', rowNum);
      const eCell = getOrCreateCell(r, 'E', rowNum);

      setInlineString(bCell, entry.week);
      setInlineString(cCell, this.formatDDMMYYYY(entry.date));
      setNumber(dCell, entry.pallet);
      setNumber(eCell, entry.shelf);
    }
  }

  private static async replaceSheetNameInAllFormulas(
    zip: JSZip,
    parser: XMLParser,
    builder: XMLBuilder,
    oldName: string,
    newName: string
  ): Promise<void> {
    const files = Object.keys(zip.files).filter(p => p.startsWith('xl/worksheets/sheet') && p.endsWith('.xml'));
    const quotedOld = `'${oldName.replace(/'/g, "''")}'!`;
    const quotedNew = `'${newName.replace(/'/g, "''")}'!`;
    const plainOld = `${oldName}!`;
    const plainNew = `${newName}!`;

    for (const f of files) {
      const raw = await zip.file(f)?.async('string');
      if (!raw) continue;
      const obj: any = parser.parse(raw);
      let changed = false;
      const rows: any[] = this.forceArray(obj?.worksheet?.sheetData?.row);
      for (const row of rows) {
        const cells = this.forceArray(row?.c);
        for (const cell of cells) {
          if (typeof cell?.f === 'string') {
            let formula = cell.f;
            if (formula.includes(quotedOld)) {
              formula = formula.split(quotedOld).join(quotedNew);
              changed = true;
            }
            if (formula.includes(plainOld)) {
              formula = formula.split(plainOld).join(plainNew);
              changed = true;
            }
            cell.f = formula;
          } else if (typeof cell?.f?.['#text'] === 'string') {
            let formula = String(cell.f['#text']);
            if (formula.includes(quotedOld)) {
              formula = formula.split(quotedOld).join(quotedNew);
              changed = true;
            }
            if (formula.includes(plainOld)) {
              formula = formula.split(plainOld).join(plainNew);
              changed = true;
            }
            cell.f['#text'] = formula;
          }
        }
      }
      if (changed) zip.file(f, builder.build(obj));
    }
  }

  private static buildAnalyzeRows(transactions: Transaction[]): any[] {
    const groups = new Map<string, { type: string; orders: Set<string>; qty: number }>();
    transactions.forEach(t => {
      const key = t.segment;
      if (!groups.has(key)) groups.set(key, { type: t.segment, orders: new Set(), qty: 0 });
      const g = groups.get(key)!;
      g.orders.add(t.orderNumber);
      g.qty += t.quantity;
    });

    const rows: any[] = [];
    rows.push({ Type: 'Type', Ref: 'Ref (Orders)', OrderCount: 'Order count', QTY: 'QTY' });
    groups.forEach((g, type) => {
      rows.push({ Type: type, Ref: '', OrderCount: '', QTY: '' });
      rows.push({ Type: '', Ref: 'Total', OrderCount: g.orders.size, QTY: g.qty });
    });
    return rows;
  }

  private static async addOrReplaceWorksheetOpenXml(
    zip: JSZip,
    parser: XMLParser,
    builder: XMLBuilder,
    wbObj: any,
    sheetName: string,
    data: any[]
  ): Promise<void> {
    const wbXmlPath = 'xl/workbook.xml';
    const relsPath = 'xl/_rels/workbook.xml.rels';
    const ctPath = '[Content_Types].xml';

    const sheets: any[] = this.forceArray(wbObj?.workbook?.sheets?.sheet);
    wbObj.workbook.sheets.sheet = sheets;

    const relsRaw = await zip.file(relsPath)?.async('string');
    if (!relsRaw) throw new Error('Missing xl/_rels/workbook.xml.rels');
    const relsObj: any = parser.parse(relsRaw);
    const rels: any[] = this.forceArray(relsObj?.Relationships?.Relationship);
    relsObj.Relationships.Relationship = rels;

    const ctRaw = await zip.file(ctPath)?.async('string');
    if (!ctRaw) throw new Error('Missing [Content_Types].xml');
    const ctObj: any = parser.parse(ctRaw);
    const overrides: any[] = this.forceArray(ctObj?.Types?.Override);
    ctObj.Types.Override = overrides;

    const existingSheet = sheets.find(s => String(s['@_name']).toLowerCase() === sheetName.toLowerCase());
    let relId: string;
    let targetPath: string;

    if (existingSheet) {
      relId = String(existingSheet['@_r:id']);
      const resolved = await this.resolveWorksheetPathFromWorkbookRel(zip, parser, relId);
      if (!resolved) throw new Error(`Could not resolve worksheet path for ${sheetName}`);
      targetPath = resolved;
    } else {
      const usedRelIds = rels
        .map(r => String(r['@_Id'] ?? ''))
        .map(id => Number(String(id).replace(/^rId/i, '')))
        .filter(n => Number.isFinite(n));
      const nextRelNum = (usedRelIds.length ? Math.max(...usedRelIds) : 0) + 1;
      relId = `rId${nextRelNum}`;

      const sheetFiles = Object.keys(zip.files)
        .filter(p => p.startsWith('xl/worksheets/sheet') && p.endsWith('.xml'))
        .map(p => Number(p.match(/sheet(\d+)\.xml$/i)?.[1] ?? '0'))
        .filter(n => n > 0);
      const nextSheetFileNum = (sheetFiles.length ? Math.max(...sheetFiles) : 0) + 1;
      targetPath = `xl/worksheets/sheet${nextSheetFileNum}.xml`;

      const usedSheetIds = sheets.map(s => Number(s['@_sheetId'])).filter(n => Number.isFinite(n));
      const sheetId = (usedSheetIds.length ? Math.max(...usedSheetIds) : 0) + 1;

      sheets.push({ '@_name': sheetName, '@_sheetId': String(sheetId), '@_r:id': relId });
      rels.push({
        '@_Id': relId,
        '@_Type': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet',
        '@_Target': `worksheets/sheet${nextSheetFileNum}.xml`
      });

      const partName = `/${targetPath}`;
      const hasOverride = overrides.some(o => String(o['@_PartName']) === partName);
      if (!hasOverride) {
        overrides.push({
          '@_PartName': partName,
          '@_ContentType': 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
        });
      }
    }

    const headers = data.length ? Object.keys(data[0]) : [];
    const aoa: any[][] = [];
    if (headers.length) {
      aoa.push(headers);
      for (const row of data) aoa.push(headers.map(h => row[h] ?? ''));
    }

    const makeCellRef = (colIdx: number, rowIdx: number): string => {
      let n = colIdx + 1;
      let col = '';
      while (n > 0) {
        const rem = (n - 1) % 26;
        col = String.fromCharCode(65 + rem) + col;
        n = Math.floor((n - 1) / 26);
      }
      return `${col}${rowIdx + 1}`;
    };

    const sheetDataRows: any[] = [];
    for (let r = 0; r < aoa.length; r++) {
      const rowCells: any[] = [];
      for (let c = 0; c < aoa[r].length; c++) {
        const ref = makeCellRef(c, r);
        const val = aoa[r][c];
        if (typeof val === 'number' && Number.isFinite(val)) {
          rowCells.push({ '@_r': ref, v: String(val) });
        } else {
          rowCells.push({ '@_r': ref, '@_t': 'inlineStr', is: { t: { '#text': String(val ?? '') } } });
        }
      }
      sheetDataRows.push({ '@_r': String(r + 1), c: rowCells });
    }

    const wsObj: any = {
      worksheet: {
        '@_xmlns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
        '@_xmlns:r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        sheetData: { row: sheetDataRows }
      }
    };

    zip.file(targetPath, builder.build(wsObj));
    zip.file(relsPath, builder.build(relsObj));
    zip.file(ctPath, builder.build(ctObj));
    zip.file(wbXmlPath, builder.build(wbObj));
  }

  private static formatDDMMYYYY(d: Date): string {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = String(d.getFullYear());
    return `${dd}/${mm}/${yyyy}`;
  }

  private static buildAfimilkStorageEntries(storageData: any[]): Array<{ date: Date; week: string; pallet: number; shelf: number }> {
    const parseDate = (value: any): Date | null => {
      if (!value) return null;
      if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
      const s = String(value).trim();
      const m1 = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
      if (m1) {
        const dd = Number(m1[1]);
        const mm = Number(m1[2]);
        const yyyy = Number(m1[3].length === 2 ? `20${m1[3]}` : m1[3]);
        const d = new Date(yyyy, mm - 1, dd);
        return isNaN(d.getTime()) ? null : d;
      }
      const d2 = new Date(s);
      return isNaN(d2.getTime()) ? null : d2;
    };

    const out: Array<{ date: Date; week: string; pallet: number; shelf: number }> = [];
    for (const r of storageData) {
      const date =
        parseDate(r['Day of Created At (Stats)']) ||
        parseDate(r['Day of Created At']) ||
        parseDate(r['Date']) ||
        parseDate(r['Day']) ||
        parseDate(r['Created At']);
      if (!date) continue;
      const week = String(r['Week'] ?? r['Week Number'] ?? r['Week of Created At'] ?? '').trim();
      const pallet = Number(r['Pallet'] ?? r['Pallet Qty'] ?? r['Locations of type Pallet'] ?? r['Locations of type pallet'] ?? 0);
      const shelf = Number(r['Shelf'] ?? r['Shelf Qty'] ?? r['Locations of type Shelf'] ?? r['Locations of type shelf'] ?? 0);
      out.push({ date, week, pallet: Number.isFinite(pallet) ? pallet : 0, shelf: Number.isFinite(shelf) ? shelf : 0 });
    }
    out.sort((a, b) => a.date.getTime() - b.date.getTime());
    return out;
  }

  private static addStorageSheet(workbook: XLSX.WorkBook, data: any[], sheetName: string = 'Storage'): void {
    const monthly = new Map<string, { pallet: number; shelf: number }>();

    data.forEach(row => {
      const dateStr = String(row['Day of Created At (Stats)'] || '');
      const name = String(row['Name'] || '').toLowerCase();
      const value = parseFloat(row['Value']) || 0;

      const match = dateStr.match(/(\d{1,2})\s+(\d{4})/);
      if (!match) return;
      const monthKey = `${match[2]}-${match[1].padStart(2, '0')}`;

      if (!monthly.has(monthKey)) monthly.set(monthKey, { pallet: 0, shelf: 0 });
      const m = monthly.get(monthKey)!;

      if (name.includes('pallet')) m.pallet = Math.max(m.pallet, value);
      else if (name.includes('shelf')) m.shelf = Math.max(m.shelf, value);
    });

    const sorted = Array.from(monthly.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const rows = sorted.map(([month, v]) => [month, v.pallet, v.shelf]);

    const sheet = XLSX.utils.aoa_to_sheet([['Month', 'Locations of type Pallet', 'Locations of type Shelf'], ...rows]);
    workbook.SheetNames.push(sheetName);
    workbook.Sheets[sheetName] = sheet;
    console.log(`[QTYFiller] ${sheetName}: ${rows.length} months`);
  }

  private static addRawSheet(workbook: XLSX.WorkBook, data: any[], name: string): void {
    if (!data.length) return;
    const headers = Object.keys(data[0]);
    const rows = data.map(r => headers.map(h => r[h] ?? ''));
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    workbook.SheetNames.push(name);
    workbook.Sheets[name] = sheet;
    console.log(`[QTYFiller] ${name}: ${data.length} rows`);
  }

  private static addAnalyzeSheet(workbook: XLSX.WorkBook, transactions: Transaction[]): void {
    const groups = new Map<string, { type: string; orders: Set<string>; qty: number }>();

    transactions.forEach(t => {
      const key = t.segment;
      if (!groups.has(key)) groups.set(key, { type: t.segment, orders: new Set(), qty: 0 });
      const g = groups.get(key)!;
      g.orders.add(t.orderNumber);
      g.qty += t.quantity;
    });

    const rows: (string | number)[][] = [];
    groups.forEach((g, type) => {
      rows.push([type, '', '', '']);
      rows.push(['', 'Total', g.orders.size, g.qty]);
    });

    const sheet = XLSX.utils.aoa_to_sheet([['Type', 'Ref (Orders)', 'Order count', 'QTY'], ...rows]);
    workbook.SheetNames.push('Analyze');
    workbook.Sheets['Analyze'] = sheet;
    console.log(`[QTYFiller] Analyze: ${groups.size} groups`);
  }

  private static getLineItemKey(item: LineItem): string {
    return `${item.segment}|${item.clause}|${item.category}|${item.unitOfMeasure}|${item.remark}`;
  }
}
