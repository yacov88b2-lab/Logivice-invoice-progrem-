import * as XLSX from 'xlsx';
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

        const oldQty = oldQtyCell ? (oldQtyCell.v || oldQtyCell.value) : null;
        const oldTotal = oldTotalCell ? (oldTotalCell.v || oldTotalCell.value) || 0 : 0;
        const rate = rateCell ? (rateCell.v || rateCell.value) || 0 : 0;
        const newTotal = newQty * rate;

        worksheet[qtyCellRef] = { ...oldQtyCell, v: newQty, value: newQty, t: 'n', w: String(newQty) };
        worksheet[totalCellRef] = { ...oldTotalCell, v: newTotal, value: newTotal, t: 'n', w: String(newTotal.toFixed(2)) };

        filledRows.push({ sheet: sheet.name, row: item.row, oldQty: oldQty !== null ? Number(oldQty) : null, newQty, oldTotal: Number(oldTotal), newTotal });
      }
    }

    XLSX.writeFile(workbook, outputPath);
    return { success: errors.length === 0, filePath: outputPath, filledRows, errors };
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
