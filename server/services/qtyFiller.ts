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

export class QTYFiller {
  static extractAfimilkStoragePeriod(storageData: any[]): { mm: string; yyyy: string } | null {
    const parsed = this.buildAfimilkStorageEntries(storageData);
    if (!parsed.length) return null;
    const mm = String(parsed[0].date.getMonth() + 1).padStart(2, '0');
    const yyyy = String(parsed[0].date.getFullYear());
    return { mm, yyyy };
  }

  private static getFieldValue(row: any, fieldName: string): any {
    if (!row || !fieldName) return undefined;
    if (Object.prototype.hasOwnProperty.call(row, fieldName)) return row[fieldName];
    const target = String(fieldName).toLowerCase().trim();
    const key = Object.keys(row).find(k => String(k).toLowerCase().trim() === target);
    return key ? row[key] : undefined;
  }

  private static parseTableauDate(value: any): Date | null {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value > 20000 && value < 80000) {
        const excelEpoch = new Date(Date.UTC(1899, 11, 30));
        const d = new Date(excelEpoch.getTime() + value * 24 * 60 * 60 * 1000);
        return isNaN(d.getTime()) ? null : d;
      }
      if (value > 1000000000000) {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
      }
      if (value > 1000000000) {
        const d = new Date(value * 1000);
        return isNaN(d.getTime()) ? null : d;
      }
    }

    const s = String(value).trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+.*)?$/);
    if (m) {
      const dd = Number(m[1]);
      const mm = Number(m[2]);
      const yyyy = Number(m[3]);
      if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
        const d = new Date(yyyy, mm - 1, dd);
        return isNaN(d.getTime()) ? null : d;
      }
    }

    const mdot = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+.*)?$/);
    if (mdot) {
      const dd = Number(mdot[1]);
      const mm = Number(mdot[2]);
      const yyyy = Number(mdot[3]);
      if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
        const d = new Date(yyyy, mm - 1, dd);
        return isNaN(d.getTime()) ? null : d;
      }
    }

    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  private static extractPeriodFromRows(rows: any[], dateField: string): { mm: string; yyyy: string } | null {
    for (const r of rows || []) {
      const raw = this.getFieldValue(r, dateField);
      const dt = this.parseTableauDate(raw);
      if (!dt) continue;
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const yyyy = String(dt.getFullYear());
      return { mm, yyyy };
    }
    return null;
  }

  private static extractUniquePeriodFromRows(
    rows: any[],
    dateField: string
  ): { mm: string; yyyy: string } | null {
    let period: { mm: string; yyyy: string } | null = null;
    for (const r of rows || []) {
      const raw = this.getFieldValue(r, dateField);
      const dt = this.parseTableauDate(raw);
      if (!dt) continue;
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const yyyy = String(dt.getFullYear());
      const p = { mm, yyyy };
      if (!period) {
        period = p;
        continue;
      }
      if (period.mm !== p.mm || period.yyyy !== p.yyyy) return null;
    }
    return period;
  }

  private static patchScansInboundWorksheetXml(
    worksheetObj: any,
    sharedStrings: string[],
    inboundRows: any[]
  ): void {
    const sheetData = worksheetObj?.worksheet?.sheetData;
    const rows: any[] = this.forceArray(sheetData?.row);

    const findRow = (rowNum: number): any | null => {
      const r = rows.find((rr: any) => Number(rr?.['@_r'] ?? 0) === rowNum);
      return r ?? null;
    };

    const getOrCreateRow = (rowNum: number): any => {
      let row = findRow(rowNum);
      if (row) return row;
      row = { '@_r': String(rowNum), c: [] };
      rows.push(row);
      return row;
    };

    const getCell = (row: any, colLetter: string, rowNum: number): any | null => {
      const cells = this.forceArray(row?.c);
      const ref = `${colLetter.toUpperCase()}${rowNum}`;
      const c = cells.find((cc: any) => String(cc['@_r'] ?? '').toUpperCase() === ref);
      return c ?? null;
    };

    const getOrCreateCell = (row: any, colLetter: string, rowNum: number): any => {
      if (!row.c) row.c = [];
      const cells = this.forceArray(row.c);
      const ref = `${colLetter.toUpperCase()}${rowNum}`;
      let cell = cells.find((cc: any) => String(cc['@_r'] ?? '').toUpperCase() === ref);
      if (!cell) {
        cell = { '@_r': ref };
        cells.push(cell);
        row.c = cells;
      }
      return cell;
    };

    const clearCellValue = (cell: any): void => {
      if (!cell) return;
      delete cell.v;
      delete cell.is;
      delete cell['@_t'];
    };

    const setInlineString = (cell: any, text: string): void => {
      delete cell.v;
      cell['@_t'] = 'inlineStr';
      cell.is = { t: { '#text': text } };
    };

    const formatDDMMYYYY = (d: Date): string => {
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = String(d.getFullYear());
      return `${dd}/${mm}/${yyyy}`;
    };

    const getField = (row: any, key: string): string => {
      const v = this.getFieldValue(row, key);
      return v === undefined || v === null ? '' : String(v);
    };

    const maxClearRows = 5000;
    const maxWriteRows = Math.min(inboundRows.length, maxClearRows);

    for (let r = 2; r <= maxClearRows + 1; r++) {
      const row = findRow(r);
      if (!row) continue;
      for (const col of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']) {
        const cell = getCell(row, col, r);
        clearCellValue(cell);
      }
    }

    for (let idx = 0; idx < maxWriteRows; idx++) {
      const rowNum = idx + 2;
      const templateRow = getOrCreateRow(rowNum);

      const bCell = getOrCreateCell(templateRow, 'B', rowNum);
      const cCell = getOrCreateCell(templateRow, 'C', rowNum);
      const dCell = getOrCreateCell(templateRow, 'D', rowNum);
      const eCell = getOrCreateCell(templateRow, 'E', rowNum);
      const fCell = getOrCreateCell(templateRow, 'F', rowNum);
      const gCell = getOrCreateCell(templateRow, 'G', rowNum);
      const hCell = getOrCreateCell(templateRow, 'H', rowNum);
      const iCell = getOrCreateCell(templateRow, 'I', rowNum);
      const jCell = getOrCreateCell(templateRow, 'J', rowNum);

      const data = inboundRows[idx] ?? {};
      setInlineString(bCell, getField(data, 'Sub Inventory'));
      setInlineString(cCell, getField(data, 'Name (Service Levels)'));
      setInlineString(dCell, getField(data, 'Ref (Orders)'));

      const inboundAtRaw = this.getFieldValue(data, 'Inbound at');
      const dt = this.parseTableauDate(inboundAtRaw);
      setInlineString(eCell, dt ? formatDDMMYYYY(dt) : getField(data, 'Inbound at'));

      setInlineString(fCell, getField(data, 'Item'));
      setInlineString(gCell, getField(data, 'box'));
      setInlineString(hCell, getField(data, 'item'));
      setInlineString(iCell, getField(data, 'pallet'));
      setInlineString(jCell, getField(data, 'serial'));
    }

    worksheetObj.worksheet.sheetData.row = rows;
  }

  private static patchScansOutboundWorksheetXml(
    worksheetObj: any,
    sharedStrings: string[],
    outboundRows: any[]
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

    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 200); i++) {
      const r = rows[i];
      const bCell = findCell(r, 'B');
      const text = getCellText(bCell).toLowerCase().trim();
      if (text === 'sub inventory') {
        headerRowIdx = i;
        break;
      }
    }
    if (headerRowIdx === -1) return;

    const formatDDMMYYYY = (d: Date): string => {
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = String(d.getFullYear());
      return `${dd}/${mm}/${yyyy}`;
    };

    const getField = (row: any, key: string): string => {
      const v = this.getFieldValue(row, key);
      return v === undefined || v === null ? '' : String(v);
    };

    for (let idx = 0; idx < outboundRows.length; idx++) {
      const templateRow = rows[headerRowIdx + 1 + idx];
      if (!templateRow) break;
      const rowNum = Number(templateRow['@_r'] ?? headerRowIdx + 2 + idx);

      const bCell = getOrCreateCell(templateRow, 'B', rowNum);
      const cCell = getOrCreateCell(templateRow, 'C', rowNum);
      const eCell = getOrCreateCell(templateRow, 'E', rowNum);
      const fCell = getOrCreateCell(templateRow, 'F', rowNum);
      const gCell = getOrCreateCell(templateRow, 'G', rowNum);

      const data = outboundRows[idx] ?? {};
      setInlineString(bCell, getField(data, 'Sub Inventory'));
      setInlineString(cCell, getField(data, 'Name (Service Levels)'));
      setInlineString(eCell, getField(data, 'Ref (Orders)'));

      const shippedOutRaw = this.getFieldValue(data, 'Shipped out');
      const dt = this.parseTableauDate(shippedOutRaw);
      setInlineString(fCell, dt ? formatDDMMYYYY(dt) : getField(data, 'Shipped out'));

      setInlineString(gCell, getField(data, 'Repacking/Labeling'));
    }
  }

  private static findRawViewData(rawViewData: Map<string, any[]>, needle: string): any[] | null {
    const target = needle.toLowerCase().trim();
    for (const [k, v] of rawViewData.entries()) {
      if (!k) continue;
      const key = String(k).toLowerCase();
      if (key === target || key.includes(target)) return Array.isArray(v) ? v : null;
    }
    return null;
  }

  static async fillAfimilkPreserveTemplate(
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
      const zip = await JSZip.loadAsync(pricelistBuffer);
      const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
      const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', suppressEmptyNode: true });

      const wbXmlPath = 'xl/workbook.xml';
      const wbXmlRaw = await zip.file(wbXmlPath)?.async('string');
      if (!wbXmlRaw) throw new Error('Missing xl/workbook.xml in template');
      const wbObj: any = parser.parse(wbXmlRaw);

      // We patch cell values directly in OpenXML; force Excel to recalculate formulas on open
      // so cached <v> values (e.g. summary totals) do not stay stale.
      if (!wbObj.workbook.calcPr) wbObj.workbook.calcPr = {};
      wbObj.workbook.calcPr['@_calcMode'] = 'auto';
      wbObj.workbook.calcPr['@_fullCalcOnLoad'] = '1';
      const sheets: any[] = this.forceArray(wbObj?.workbook?.sheets?.sheet);
      wbObj.workbook.sheets.sheet = sheets;
      if (!sheets.length) throw new Error('No sheets found in template');

      const sharedStringsXml = await zip.file('xl/sharedStrings.xml')?.async('string');
      const sharedStrings = sharedStringsXml ? this.parseSharedStrings(parser.parse(sharedStringsXml)) : [];

      const inboundData = rawViewData ? this.findRawViewData(rawViewData, 'inbound') : null;
      if (inboundData && inboundData.length) {
        const inboundSheetEntry = sheets.find(s => String(s['@_name'] ?? '').toLowerCase().trim().includes('scans inbound'));
        if (inboundSheetEntry) {
          const cleanedInboundData = (() => {
            const rows = Array.isArray(inboundData) ? inboundData.slice() : [];
            if (!rows.length) return rows;
            const first = rows[0] ?? {};
            const hasTypeHeader = Object.entries(first).some(([k, v]) => {
              const kk = String(k || '').toLowerCase();
              const vv = String(v || '').toLowerCase();
              return kk.includes('type') && vv.includes('billable scan logs');
            });
            if (hasTypeHeader) return rows.slice(1);
            const anyFirstValue = Object.values(first).some(v => String(v || '').toLowerCase().includes('billable scan logs'));
            return anyFirstValue ? rows.slice(1) : rows;
          })();

          const inboundRowsInExpectedPeriod = expectedInboundPeriod
            ? cleanedInboundData.filter(r => {
                const raw = this.getFieldValue(r, 'Inbound at');
                const dt = this.parseTableauDate(raw);
                if (!dt) return false;
                const mm = String(dt.getMonth() + 1).padStart(2, '0');
                const yyyy = String(dt.getFullYear());
                return mm === expectedInboundPeriod.mm && yyyy === expectedInboundPeriod.yyyy;
              })
            : cleanedInboundData;

          const inboundPeriod = this.extractUniquePeriodFromRows(inboundRowsInExpectedPeriod, 'Inbound at');
          const oldInboundName = String(inboundSheetEntry['@_name'] ?? 'Scans Inbound');
          const shouldRenameInbound =
            !!expectedInboundPeriod &&
            !!inboundPeriod &&
            inboundPeriod.mm === expectedInboundPeriod.mm &&
            inboundPeriod.yyyy === expectedInboundPeriod.yyyy;

          if (shouldRenameInbound) {
            inboundSheetEntry['@_name'] = `Scans Inbound ${inboundPeriod.mm}-${inboundPeriod.yyyy}`;
            suggestedFilename = `Afimilk New-Zealand -Test Invoice ${inboundPeriod.mm}-${inboundPeriod.yyyy}.xlsx`;
          }

          const inboundRelId = String(inboundSheetEntry['@_r:id'] ?? '');
          const inboundSheetPath = await this.resolveWorksheetPathFromWorkbookRel(zip, parser, inboundRelId);
          if (inboundSheetPath) {
            const inboundXmlRaw = await zip.file(inboundSheetPath)?.async('string');
            if (inboundXmlRaw) {
              const inboundObj: any = parser.parse(inboundXmlRaw);
              this.patchScansInboundWorksheetXml(inboundObj, sharedStrings, inboundRowsInExpectedPeriod);
              zip.file(inboundSheetPath, builder.build(inboundObj));
            }
          }

          const newInboundName = String(inboundSheetEntry['@_name'] ?? oldInboundName);
          if (newInboundName !== oldInboundName) {
            await this.replaceSheetNameInAllFormulas(zip, parser, builder, oldInboundName, newInboundName);
          }
        }
      }

      // Patch invoice QTY cells without rewriting the workbook (preserve styles/formulas)
      await this.patchInvoiceQtyOpenXml(zip, parser, builder, wbObj, templateStructure, quantities, filledRows, errors);

      zip.file(wbXmlPath, builder.build(wbObj));

      const outBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      await this.writeBufferToFile(outputPath, outBuffer);

      return { success: errors.length === 0, filePath: outputPath, suggestedFilename, filledRows, errors };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      return { success: false, filePath: outputPath, suggestedFilename, filledRows, errors: [...errors, err.message] };
    }
  }

  private static colIdxToLetter(idx: number): string {
    let n = idx + 1;
    let col = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      col = String.fromCharCode(65 + rem) + col;
      n = Math.floor((n - 1) / 26);
    }
    return col;
  }

  private static async patchInvoiceQtyOpenXml(
    zip: JSZip,
    parser: XMLParser,
    builder: XMLBuilder,
    wbObj: any,
    templateStructure: TemplateStructure,
    quantities: Map<string, number>,
    filledRows: FillResult['filledRows'],
    errors: string[]
  ): Promise<void> {
    const qtyCol = this.colIdxToLetter(templateStructure.columns.qty);
    const rateCol = this.colIdxToLetter(templateStructure.columns.rate);

    const sheets: any[] = this.forceArray(wbObj?.workbook?.sheets?.sheet);
    wbObj.workbook.sheets.sheet = sheets;

    const getOrCreateCell = (row: any, colLetter: string, rowNum: number): any => {
      if (!row.c) row.c = [];
      const cells = this.forceArray(row.c);
      const ref = `${colLetter.toUpperCase()}${rowNum}`;
      let cell = cells.find((cc: any) => String(cc['@_r'] ?? '').toUpperCase() === ref);
      if (!cell) {
        cell = { '@_r': ref };
        cells.push(cell);
        row.c = cells;
      }
      return cell;
    };

    const getCellNumber = (row: any, colLetter: string, rowNum: number): number => {
      const cells = this.forceArray(row?.c);
      const ref = `${colLetter.toUpperCase()}${rowNum}`;
      const cell = cells.find((cc: any) => String(cc['@_r'] ?? '').toUpperCase() === ref);
      if (!cell) return 0;
      const raw = cell.v ?? cell.value;
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '').replace(/,/g, ''));
      return Number.isFinite(n) ? n : 0;
    };

    for (const sheet of templateStructure.sheets) {
      if (sheet.type !== 'invoice') continue;
      const sheetEntry = sheets.find(s => String(s['@_name'] ?? '') === sheet.name);
      if (!sheetEntry) {
        errors.push(`Sheet not found: ${sheet.name}`);
        continue;
      }

      const relId = String(sheetEntry['@_r:id'] ?? '');
      const sheetPath = await this.resolveWorksheetPathFromWorkbookRel(zip, parser, relId);
      if (!sheetPath) {
        errors.push(`Could not resolve worksheet XML path for: ${sheet.name}`);
        continue;
      }

      const xmlRaw = await zip.file(sheetPath)?.async('string');
      if (!xmlRaw) {
        errors.push(`Missing worksheet XML for: ${sheet.name}`);
        continue;
      }

      const wsObj: any = parser.parse(xmlRaw);
      const sheetData = wsObj?.worksheet?.sheetData;
      const rows: any[] = this.forceArray(sheetData?.row);
      if (!sheetData) {
        errors.push(`Missing sheetData for: ${sheet.name}`);
        continue;
      }

      for (const item of sheet.lineItems) {
        const key = this.getLineItemKey(item);
        const newQty = quantities.get(key);
        if (newQty === undefined) continue;

        const rowNum = item.row;
        let row = rows.find((r: any) => Number(r['@_r'] ?? 0) === rowNum);
        if (!row) {
          // If the row doesn't exist in XML, don't create it (would affect formatting). Just report.
          errors.push(`Row not found in ${sheet.name}: ${rowNum}`);
          continue;
        }

        const qtyCell = getOrCreateCell(row, qtyCol, rowNum);
        const oldQtyRaw = qtyCell.v ?? qtyCell.value;
        const oldQty = oldQtyRaw !== undefined && oldQtyRaw !== null ? Number(oldQtyRaw) : null;

        // Preserve style/formula, only update value as numeric
        delete qtyCell.is;
        delete qtyCell['@_t'];
        qtyCell.v = String(newQty);

        const rate = getCellNumber(row, rateCol, rowNum);
        const newTotal = newQty * rate;

        filledRows.push({
          sheet: sheet.name,
          row: rowNum,
          oldQty: oldQty !== null && Number.isFinite(oldQty) ? oldQty : null,
          newQty,
          oldTotal: 0,
          newTotal
        });
      }

      wsObj.worksheet.sheetData.row = rows;
      zip.file(sheetPath, builder.build(wsObj));
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

  /**
   * For Sensos NL: compute correct quantities from raw Tableau view data.
   * - Inbound Per Order  = distinct Ref (Orders) in Inbound view
   * - Inbound Per Unit Scan (Per Box) = rows where Type (Billable Scan Logs) === 'box'
   * - Outbound Per Order Domestic/International = distinct refs filtered by Dom/Int'l
   * - Outbound Per Unit Scan (Per Box) = rows where Type === 'box' in Outbound view
   * Returns a Map keyed by getLineItemKey pattern that callers merge into the quantities map.
   */
  private static buildSensosQuantities(rawViewData: Map<string, any[]>): Map<string, number> {
    const result = new Map<string, number>();

    const getView = (name: string): any[] => {
      if (rawViewData.has(name)) return rawViewData.get(name)!;
      for (const [k, v] of rawViewData.entries()) {
        if (k.trim() === name) return v;
      }
      return [];
    };

    const findCol = (headers: string[], keywords: string[]): string | undefined =>
      headers.find(h => keywords.some(kw => h.toLowerCase().includes(kw.toLowerCase())));

    // --- Inbound ---
    const inboundData = getView('Inbound');
    if (inboundData.length > 0) {
      const headers = Object.keys(inboundData[0]);
      const refCol  = findCol(headers, ['Ref (Orders)', 'ref']);
      const distinctCountIdCol = findCol(headers, ['Distinct count of Id', 'Billable Scan Logs']);

      const distinctRefs = new Set<string>();
      let boxCount = 0;
      for (const row of inboundData) {
        if (refCol) distinctRefs.add(String(row[refCol] ?? ''));
        // Sum "Distinct count of Id (Billable Scan Logs)" values for box count
        if (distinctCountIdCol) {
          const val = parseFloat(String(row[distinctCountIdCol] ?? '0')) || 0;
          boxCount += val;
        }
      }

      // Match pricelist keys: segment=Inbound, clause=Per Order / Per Unit Scan
      // We match by segment+clause prefix and override — iterate quantities to find matching keys
      result.set('__sensos_inbound_orders', distinctRefs.size);
      result.set('__sensos_inbound_boxes', boxCount);
      console.log(`[QTYFiller] Sensos Inbound: ${distinctRefs.size} orders, ${boxCount} boxes (summing Distinct count of Id)`);
    }

    // --- Outbound ---
    const outboundData = getView('Outbound');
    if (outboundData.length > 0) {
      const headers   = Object.keys(outboundData[0]);
      console.log(`[QTYFiller] Outbound headers: ${JSON.stringify(headers)}`);
      console.log(`[QTYFiller] Outbound row[0]: ${JSON.stringify(outboundData[0])}`);
      const refCol    = findCol(headers, ['Ref (Orders)', 'ref']);
      // exact match 'box' first, then fallback to includes
      const boxCol    = headers.find(h => h.trim().toLowerCase() === 'box') ?? findCol(headers, ['box']);
      const domIntCol = findCol(headers, ["Dom/Int", 'domint', 'domestic']);
      console.log(`[QTYFiller] Outbound cols - ref:${refCol}, box:${boxCol}, domInt:${domIntCol}`);

      const domRefs = new Set<string>();
      const intRefs = new Set<string>();
      let outBoxCount = 0;
      for (const row of outboundData) {
        const ref    = refCol ? String(row[refCol] ?? '') : '';
        const boxVal = boxCol ? (parseFloat(String(row[boxCol] ?? '0')) || 0) : 0;
        const domInt = domIntCol ? String(row[domIntCol] ?? '').toLowerCase() : '';
        outBoxCount += boxVal; // sum numeric box column
        if ((domInt.includes('local') || domInt.includes('dom')) && ref) domRefs.add(ref);
        else if ((domInt.includes("int'l") || domInt.includes('int')) && ref) intRefs.add(ref);
        else if (ref) domRefs.add(ref); // default to domestic
      }

      result.set('__sensos_outbound_dom_orders', domRefs.size);
      result.set('__sensos_outbound_int_orders', intRefs.size);
      result.set('__sensos_outbound_boxes', outBoxCount);
      console.log(`[QTYFiller] Sensos Outbound: ${domRefs.size} dom orders, ${intRefs.size} int orders, ${outBoxCount} boxes`);
    }

    return result;
  }

  private static async fillWithExcelJS(
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
      if (!worksheet) {
        errors.push(`Sheet not found: ${sheet.name}`);
        continue;
      }

      for (const item of sheet.lineItems) {
        const key = this.getLineItemKey(item);
        const newQty = quantities.get(key);
        if (newQty === undefined) continue;

        const { columns } = templateStructure;
        // ExcelJS uses 1-based row and 1-based column
        const row = worksheet.getRow(item.row);
        const qtyCell   = row.getCell(columns.qty + 1);
        const totalCell = row.getCell(columns.total + 1);
        const rateCell  = row.getCell(columns.rate + 1);

        const oldQty   = qtyCell.value as number | null;
        const rate     = (rateCell.value as number) || 0;
        const newTotal = newQty * rate;

        qtyCell.value   = newQty;
        totalCell.value = newTotal;

        filledRows.push({
          sheet: sheet.name,
          row: item.row,
          oldQty: oldQty !== null ? Number(oldQty) : null,
          newQty,
          oldTotal: 0,
          newTotal
        });
      }
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await excelWorkbook.xlsx.writeFile(outputPath);
    console.log(`[QTYFiller] ExcelJS wrote template with styles preserved: ${outputPath}`);
  }

  static async fill(
    pricelistBuffer: Buffer,
    templateStructure: TemplateStructure,
    quantities: Map<string, number>,
    outputPath: string,
    transactions?: Transaction[],
    rawViewData?: Map<string, any[]>
  ): Promise<FillResult> {
    const filledRows: FillResult['filledRows'] = [];
    const errors: string[] = [];

    // For Sensos NL: override quantity map using raw view data (orders + boxes)
    if (rawViewData) {
      const sensosSummary = this.buildSensosQuantities(rawViewData);
      // Map internal sensos keys to actual pricelist line item keys
      for (const sheet of templateStructure.sheets) {
        if (sheet.type !== 'invoice') continue;
        for (const item of sheet.lineItems) {
          const seg    = item.segment.toLowerCase();
          const clause = item.clause.toLowerCase();
          const cat    = item.category.toLowerCase();
          const key    = this.getLineItemKey(item);
          if (seg === 'inbound' && clause.includes('per order')) {
            quantities.set(key, sensosSummary.get('__sensos_inbound_orders') ?? 0);
          } else if (seg === 'inbound' && clause.includes('per unit scan') && (cat.includes('box') || cat.includes('per box'))) {
            quantities.set(key, sensosSummary.get('__sensos_inbound_boxes') ?? 0);
          } else if (seg === 'outbound' && clause.includes('per order') && cat.includes('dom')) {
            quantities.set(key, sensosSummary.get('__sensos_outbound_dom_orders') ?? 0);
          } else if (seg === 'outbound' && clause.includes('per order') && cat.includes('int')) {
            quantities.set(key, sensosSummary.get('__sensos_outbound_int_orders') ?? 0);
          } else if (seg === 'outbound' && clause.includes('per unit scan') && (cat.includes('box') || cat.includes('per box'))) {
            quantities.set(key, sensosSummary.get('__sensos_outbound_boxes') ?? 0);
          }
        }
      }
    }

    // Step 1: Use ExcelJS to fill Qty/Total into the template (preserves all styles/colors)
    await this.fillWithExcelJS(pricelistBuffer, templateStructure, quantities, outputPath, filledRows, errors);

    // Step 2: Use XLSX to add raw data sheets on top of the already-written file
    const writtenBuffer = await fs.readFile(outputPath);
    const workbook = XLSX.read(writtenBuffer, { type: 'buffer', cellStyles: true });

    if (rawViewData) {
      console.log('[QTYFiller] rawViewData keys:', Array.from(rawViewData.keys()).map(k => `"${k}"(${rawViewData.get(k)?.length}rows)`).join(', '));
      const getView = (name: string) => {
        if (rawViewData.has(name)) return rawViewData.get(name);
        for (const [k, v] of rawViewData.entries()) {
          if (k.trim() === name) return v;
        }
        return undefined;
      };
      const inbound = getView('Inbound');
      if (inbound) this.addRawSheet(workbook, inbound, 'Inbound');
      const outbound = getView('Outbound');
      if (outbound) this.addRawSheet(workbook, outbound, 'Outbound');
      const storage = getView('Storage');
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

    XLSX.writeFile(workbook, outputPath, { cellStyles: true });
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
    sorted: Array<{ date: Date; week: string; warehouseName: string; pallet: number; shelf: number }>,
    weeklyAllTotals: Map<string, { pallet?: number; shelf?: number }>
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
    let weekDayCount = 0;
    let lastWeek = '';
    let lastWarehouse = '';

    for (let i = headerRowIdx + 1; i < rows.length && dataIdx < sorted.length; i++) {
      const r = rows[i];
      const rowNum = Number(r['@_r'] ?? i + 1);
      const cCell = getOrCreateCell(r, 'C', rowNum);
      const existingStr = getCellText(cCell).toLowerCase().trim();

      // Preserve separator/total rows in the template
      if (existingStr.includes('total')) {
        const aCell = getOrCreateCell(r, 'A', rowNum);
        const bCell = getOrCreateCell(r, 'B', rowNum);
        const dCell = getOrCreateCell(r, 'D', rowNum);
        const eCell = getOrCreateCell(r, 'E', rowNum);

        const week = getCellText(bCell).trim() || lastWeek;
        const warehouseName = getCellText(aCell).trim() || lastWarehouse;
        const key = `${week}|${warehouseName}`;
        const totals = weeklyAllTotals.get(key);
        if (totals) {
          if (typeof totals.pallet === 'number') setNumber(dCell, totals.pallet);
          if (typeof totals.shelf === 'number') setNumber(eCell, totals.shelf);
        }
        continue;
      }

      const entry = sorted[dataIdx];
      if (!entry) break;

      if (entry.week !== lastWeek) {
        lastWeek = entry.week;
        weekDayCount = 0;
      }

      lastWarehouse = entry.warehouseName;

      const aCell = getOrCreateCell(r, 'A', rowNum);
      const bCell = getOrCreateCell(r, 'B', rowNum);
      const dCell = getOrCreateCell(r, 'D', rowNum);
      const eCell = getOrCreateCell(r, 'E', rowNum);

      setInlineString(aCell, entry.warehouseName);
      setInlineString(bCell, entry.week);
      setInlineString(cCell, this.formatDDMMYYYY(entry.date));
      setNumber(dCell, entry.pallet);
      setNumber(eCell, entry.shelf);

      dataIdx++;
      weekDayCount++;

      // Template uses groups of 7 days followed by a yellow Total separator row.
      // If the next row is a Total row, we will naturally skip it in the next iteration.
      if (weekDayCount >= 7) {
        weekDayCount = 0;
      }
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

  private static buildAfimilkStorageEntries(
    storageData: any[]
  ): Array<{ date: Date; week: string; warehouseName: string; pallet: number; shelf: number }> {
    const parseDate = (value: any): Date | null => {
      if (!value) return null;
      if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

      // Excel/CSV sometimes gives a numeric serial or epoch-like value
      if (typeof value === 'number' && Number.isFinite(value)) {
        // Heuristic: Excel serial date (days since 1899-12-30)
        if (value > 20000 && value < 80000) {
          const excelEpoch = new Date(Date.UTC(1899, 11, 30));
          const ms = excelEpoch.getTime() + value * 24 * 60 * 60 * 1000;
          const d = new Date(ms);
          return isNaN(d.getTime()) ? null : d;
        }

        // Epoch milliseconds
        if (value > 1000000000000) {
          const d = new Date(value);
          return isNaN(d.getTime()) ? null : d;
        }

        // Epoch seconds
        if (value > 1000000000) {
          const d = new Date(value * 1000);
          return isNaN(d.getTime()) ? null : d;
        }
      }

      const s = String(value).trim();

      // DD/MM/YYYY or DD-MM-YYYY
      const m1 = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
      if (m1) {
        let dd = Number(m1[1]);
        let mm = Number(m1[2]);
        const yyyy = Number(m1[3].length === 2 ? `20${m1[3]}` : m1[3]);

        // If ambiguous (both <= 12), prefer MM/DD/YYYY when it makes more sense.
        // This prevents dropping valid US-formatted dates.
        if (dd <= 12 && mm <= 12) {
          // If the "month" value is > 12, swap; otherwise leave as-is.
          // We'll also try a swap as a fallback below.
        }

        const d = new Date(yyyy, mm - 1, dd);
        if (!isNaN(d.getTime())) return d;

        // Fallback swap (MM/DD/YYYY)
        const swapped = new Date(yyyy, dd - 1, mm);
        return isNaN(swapped.getTime()) ? null : swapped;
      }

      // Tableau can return "1 March 2026"
      const m2 = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
      if (m2) {
        const monthNames = [
          'january',
          'february',
          'march',
          'april',
          'may',
          'june',
          'july',
          'august',
          'september',
          'october',
          'november',
          'december'
        ];
        const dd = Number(m2[1]);
        const mm = monthNames.indexOf(String(m2[2]).toLowerCase()) + 1;
        const yyyy = Number(m2[3]);
        if (mm >= 1) {
          const d = new Date(yyyy, mm - 1, dd);
          return isNaN(d.getTime()) ? null : d;
        }
      }

      // Hebrew month names (e.g. "1 במרץ 2026")
      const mHe = s.match(/^(\d{1,2})\s+([^\s]+)\s+(\d{4})/);
      if (mHe) {
        const dd = Number(mHe[1]);
        const rawMonth = String(mHe[2]).trim();
        const monthToken = rawMonth.startsWith('ב') ? rawMonth.slice(1) : rawMonth;
        const yyyy = Number(mHe[3]);

        const hebrewMonths: Record<string, number> = {
          'ינואר': 1,
          'פברואר': 2,
          'מרץ': 3,
          'אפריל': 4,
          'מאי': 5,
          'יוני': 6,
          'יולי': 7,
          'אוגוסט': 8,
          'ספטמבר': 9,
          'אוקטובר': 10,
          'נובמבר': 11,
          'דצמבר': 12
        };

        const mm = hebrewMonths[monthToken];
        if (mm) {
          const d = new Date(yyyy, mm - 1, dd);
          return isNaN(d.getTime()) ? null : d;
        }
      }

      const d2 = new Date(s);
      return isNaN(d2.getTime()) ? null : d2;
    };

    const toNumber = (v: any): number => {
      const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''));
      return Number.isFinite(n) ? n : 0;
    };

    // Tableau Storage view for Afimilk often comes as rows:
    // Day of Created At (Stats), Weeks, Name (Warehouses), Name, Value
    // Where Name indicates Pallet/Shelf and Value is the numeric amount.
    const grouped = new Map<
      string,
      { date: Date; week: string; warehouseName: string; pallet: number; shelf: number }
    >();

    for (const r of storageData) {
      const date =
        parseDate(r['Day of Created At (Stats)']) ||
        parseDate(r['Day of Created At']) ||
        parseDate(r['Date']) ||
        parseDate(r['Day']) ||
        parseDate(r['Created At']);
      if (!date) continue;

      const week = String(r['Weeks'] ?? r['Week'] ?? r['Week Number'] ?? r['Week of Created At'] ?? '').trim();
      const warehouseName = String(r['Name (Warehouses)'] ?? r['Warehouse'] ?? 'Rohlig NZ').trim() || 'Rohlig NZ';

      const key = `${date.toISOString().slice(0, 10)}|${week}|${warehouseName}`;
      if (!grouped.has(key)) {
        grouped.set(key, { date, week, warehouseName, pallet: 0, shelf: 0 });
      }

      const metricName = String(r['Name'] ?? r['Metric'] ?? '').toLowerCase();
      const value = toNumber(r['Value'] ?? r['value'] ?? r['Locations of type Pallet'] ?? r['Locations of type Shelf']);
      const entry = grouped.get(key)!;

      if (metricName.includes('pallet')) {
        entry.pallet = value;
      } else if (metricName.includes('shelf')) {
        entry.shelf = value;
      } else {
        // If the view already provides wide columns, support that too
        const pallet = toNumber(r['Locations of type Pallet'] ?? r['Locations of type pallet']);
        const shelf = toNumber(r['Locations of type Shelf'] ?? r['Locations of type shelf']);
        if (pallet) entry.pallet = pallet;
        if (shelf) entry.shelf = shelf;
      }
    }

    const out = Array.from(grouped.values());
    out.sort((a, b) => a.date.getTime() - b.date.getTime());
    return out;
  }

  private static buildAfimilkStorageWeeklyAllTotals(storageData: any[]): Map<string, { pallet?: number; shelf?: number }> {
    const toNumber = (v: any): number => {
      const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''));
      return Number.isFinite(n) ? n : 0;
    };

    const out = new Map<string, { pallet?: number; shelf?: number }>();

    for (const r of storageData) {
      const dayRaw = r['Day of Created At (Stats)'] ?? r['Day of Created At'] ?? r['Date'] ?? r['Day'] ?? r['Created At'];
      const isAll = String(dayRaw ?? '').trim().toLowerCase() === 'all';
      if (!isAll) continue;

      const week = String(r['Weeks'] ?? r['Week'] ?? r['Week Number'] ?? r['Week of Created At'] ?? '').trim();
      const warehouseName = String(r['Name (Warehouses)'] ?? r['Warehouse'] ?? 'Rohlig NZ').trim() || 'Rohlig NZ';
      if (!week) continue;

      const metricName = String(r['Name'] ?? r['Metric'] ?? '').toLowerCase();
      const value = toNumber(r['Value'] ?? r['value'] ?? r['Locations of type Pallet'] ?? r['Locations of type Shelf']);
      const key = `${week}|${warehouseName}`;
      if (!out.has(key)) out.set(key, {});
      const entry = out.get(key)!;

      if (metricName.includes('pallet')) entry.pallet = value;
      if (metricName.includes('shelf')) entry.shelf = value;
    }

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
    if (!workbook.SheetNames.includes(sheetName)) {
      workbook.SheetNames.push(sheetName);
    }
    workbook.Sheets[sheetName] = sheet;
    console.log(`[QTYFiller] ${sheetName}: ${rows.length} months`);
  }

  private static addRawSheet(workbook: XLSX.WorkBook, data: any[], name: string): void {
    if (!data.length) return;

    const headers = Object.keys(data[0]);
    
    // DEBUG: Log headers to diagnose Boxed count issue
    console.log(`[QTYFiller] ${name} sheet headers:`, headers);
    console.log(`[QTYFiller] ${name} first row sample:`, data[0]);
    
    const rows = data.map(r => headers.map(h => r[h] ?? ''));

    // Build the sheet as AoA so we can append the summary table to the right
    const aoa: any[][] = [headers, ...rows];

    // For Inbound / Outbound sheets: add a summary calculation table to the right
    if (name === 'Inbound' || name === 'Outbound') {
      const findCol = (keywords: string[]) =>
        headers.find(h => keywords.some(kw => h.toLowerCase().includes(kw.toLowerCase())));

      const serviceLevelCol = findCol(['Service Level', 'service_name', 'Name (Service']);
      const refCol          = findCol(['Ref (Orders)', 'Ref(Orders)', 'ref']);
      const distinctCountIdCol = findCol(['Distinct count of Id', 'Billable Scan Logs']);
      
      // DEBUG: Log which column was found
      console.log(`[QTYFiller] ${name} - Service Level col:`, serviceLevelCol);
      console.log(`[QTYFiller] ${name} - Ref col:`, refCol);
      console.log(`[QTYFiller] ${name} - Distinct count of Id col:`, distinctCountIdCol);

      const startCol = headers.length + 1;
      let summaryHeader: string[];
      let summaryDataRows: any[][];
      let totalRefs = 0;
      let totalBoxes = 0;

      if (name === 'Inbound') {
        // Inbound: group by Service Level only
        // Box count = sum of "Distinct count of Id (Billable Scan Logs)" values
        const distinctCountIdCol = findCol(['Distinct count of Id', 'Billable Scan Logs']);
        const pivot = new Map<string, { refs: Set<string>; boxes: number }>();
        for (const row of data) {
          const svcLevel  = serviceLevelCol ? String(row[serviceLevelCol] ?? 'Unknown') : 'Unknown';
          const ref       = refCol ? String(row[refCol] ?? '') : '';
          if (!pivot.has(svcLevel)) pivot.set(svcLevel, { refs: new Set(), boxes: 0 });
          const entry = pivot.get(svcLevel)!;
          if (ref) entry.refs.add(ref);
          // Sum "Distinct count of Id (Billable Scan Logs)" values for box count
          if (distinctCountIdCol) {
            const val = parseFloat(String(row[distinctCountIdCol] ?? '0')) || 0;
            entry.boxes += val;
          }
        }
        summaryHeader = [
          serviceLevelCol ?? 'Name (Service Levels)',
          'Distinct count of Ref (Orders)',
          'Boxed count'
        ];
        summaryDataRows = [];
        for (const [svcLevel, { refs, boxes }] of pivot.entries()) {
          summaryDataRows.push([svcLevel, refs.size, boxes]);
          totalRefs  += refs.size;
          totalBoxes += boxes;
        }
        
        // DEBUG: Log Inbound totals
        console.log(`[QTYFiller] Inbound - Total Refs: ${totalRefs}, Total Boxes: ${totalBoxes}`);
        console.log(`[QTYFiller] Inbound - Summary rows:`, summaryDataRows);

      } else {
        // Outbound: group by Service Level + Dom/Int'l
        // Box count = sum of "Distinct count of Id (Billable Scan Logs)" values
        const domIntCol = findCol(["Dom/Int'l", 'Dom/Int', 'domint']);
        const distinctCountIdCol = findCol(['Distinct count of Id', 'Billable Scan Logs']);
        const pivot = new Map<string, { svc: string; domInt: string; refs: Set<string>; boxes: number }>();
        for (const row of data) {
          const svcLevel = serviceLevelCol ? String(row[serviceLevelCol] ?? 'Unknown') : 'Unknown';
          const domInt   = domIntCol ? String(row[domIntCol] ?? '') : '';
          const ref      = refCol ? String(row[refCol] ?? '') : '';
          const key      = `${svcLevel}||${domInt}`;
          if (!pivot.has(key)) pivot.set(key, { svc: svcLevel, domInt, refs: new Set(), boxes: 0 });
          const entry = pivot.get(key)!;
          if (ref) entry.refs.add(ref);
          // Sum "Distinct count of Id (Billable Scan Logs)" values for box count
          if (distinctCountIdCol) {
            const val = parseFloat(String(row[distinctCountIdCol] ?? '0')) || 0;
            entry.boxes += val;
          }
        }
        summaryHeader = ['Name', "Dom/Int'l", 'Ref count', 'Boxed count'];
        summaryDataRows = [];
        for (const { svc, domInt, refs, boxes } of pivot.values()) {
          summaryDataRows.push([svc, domInt, refs.size, boxes]);
          totalRefs  += refs.size;
          totalBoxes += boxes;
        }
        
        // DEBUG: Log Outbound totals
        console.log(`[QTYFiller] Outbound - Total Refs: ${totalRefs}, Total Boxes: ${totalBoxes}`);
        console.log(`[QTYFiller] Outbound - Summary rows:`, summaryDataRows);
      }

      // Write header row into aoa[0]
      if (!aoa[0]) aoa[0] = [];
      while (aoa[0].length < startCol) aoa[0].push('');
      summaryHeader.forEach((h, i) => { aoa[0][startCol + i] = h; });

      // Write data rows
      for (let i = 0; i < summaryDataRows.length; i++) {
        const r = i + 1;
        if (!aoa[r]) aoa[r] = [];
        while (aoa[r].length < startCol) aoa[r].push('');
        summaryDataRows[i].forEach((v, j) => { aoa[r][startCol + j] = v; });
      }

      // Totals row
      const totalRow = summaryDataRows.length + 1;
      if (!aoa[totalRow]) aoa[totalRow] = [];
      while (aoa[totalRow].length < startCol) aoa[totalRow].push('');
      if (name === 'Inbound') {
        aoa[totalRow][startCol]     = 'Total';
        aoa[totalRow][startCol + 1] = totalRefs;
        aoa[totalRow][startCol + 2] = totalBoxes;
      } else {
        aoa[totalRow][startCol]     = 'Total';
        aoa[totalRow][startCol + 2] = totalRefs;
        aoa[totalRow][startCol + 3] = totalBoxes;
      }

      console.log(`[QTYFiller] ${name} summary: ${summaryDataRows.length} groups, ${totalRefs} orders, ${totalBoxes} boxes`);
    }

    const sheet = XLSX.utils.aoa_to_sheet(aoa);

    // Write into workbook (overwrite if sheet already exists in template)
    if (workbook.SheetNames.includes(name)) {
      console.log(`[QTYFiller] Overwriting existing sheet '${name}' with ${data.length} rows + summary`);
      workbook.Sheets[name] = sheet;
    } else {
      workbook.SheetNames.push(name);
      workbook.Sheets[name] = sheet;
      console.log(`[QTYFiller] ${name}: ${data.length} rows`);
    }
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
