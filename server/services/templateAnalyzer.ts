import * as XLSX from 'xlsx';
import type { TemplateStructure, SheetStructure, LineItem } from '../types';

export class TemplateAnalyzer {
  static analyze(buffer: Buffer): TemplateStructure {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    
    const sheets: SheetStructure[] = [];
    let headerRow = 5; // Default based on sample
    let columns = {
      segment: 0,      // A
      clause: 1,       // B
      category: 2,     // C
      unitOfMeasure: 3, // D
      remark: 4,       // E
      rate: 5,         // F
      qty: 6,          // G
      total: 7         // H
    };

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

      // Detect header row by looking for keywords
      let detectedHeaderRow = -1;
      for (let i = 0; i < Math.min(jsonData.length, 20); i++) {
        const row = jsonData[i];
        if (row && row.length > 0) {
          const rowStr = row.join(' ').toLowerCase();
          if (rowStr.includes('segment') && rowStr.includes('rate') && rowStr.includes('qty')) {
            detectedHeaderRow = i;
            break;
          }
        }
      }

      if (detectedHeaderRow === -1) continue;
      headerRow = detectedHeaderRow;

      // Detect column positions
      const headerRowData = jsonData[headerRow];
      headerRowData.forEach((cell: any, index: number) => {
        const cellStr = String(cell).toLowerCase();
        if (cellStr.includes('segment')) columns.segment = index;
        if (cellStr.includes('clause') || cellStr.includes('type')) columns.clause = index;
        if (cellStr.includes('category')) columns.category = index;
        if (cellStr.includes('unit') || cellStr.includes('uom')) columns.unitOfMeasure = index;
        if (cellStr.includes('remark') || cellStr.includes('description')) columns.remark = index;
        if (cellStr.includes('rate')) columns.rate = index;
        if (cellStr.includes('qty') || cellStr.includes('quantity')) columns.qty = index;
        if (cellStr.includes('total')) columns.total = index;
      });

      // Extract line items
      const lineItems: LineItem[] = [];
      for (let i = headerRow + 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (!row || row.length === 0) continue;
        
        const segment = row[columns.segment];
        if (!segment) continue; // Skip empty rows

        lineItems.push({
          row: i + 1, // 1-based row number
          segment: String(segment || ''),
          clause: String(row[columns.clause] || ''),
          category: String(row[columns.category] || ''),
          unitOfMeasure: String(row[columns.unitOfMeasure] || ''),
          remark: String(row[columns.remark] || ''),
          rate: parseFloat(row[columns.rate]) || 0,
          qty: row[columns.qty] !== undefined && row[columns.qty] !== null 
            ? parseFloat(row[columns.qty]) 
            : null,
          total: parseFloat(row[columns.total]) || 0
        });
      }

      sheets.push({
        name: sheetName,
        type: this.detectSheetType(sheetName, lineItems),
        rowCount: lineItems.length,
        lineItems
      });
    }

    return {
      sheets,
      headerRow: headerRow + 1, // Convert to 1-based
      columns
    };
  }

  private static detectSheetType(name: string, items: LineItem[]): 'invoice' | 'other' {
    const invoiceKeywords = ['wh', 'warehouse', 'cts', 'import', 'export', 'courier', 'exw', 'invoice'];
    const lowerName = name.toLowerCase();
    
    if (invoiceKeywords.some(kw => lowerName.includes(kw))) {
      return 'invoice';
    }
    
    // If it has typical invoice columns (rate, qty, total), it's likely an invoice
    if (items.length > 0 && items[0].rate !== undefined) {
      return 'invoice';
    }
    
    return 'other';
  }

  static getLineItemKey(item: LineItem): string {
    return `${item.segment}|${item.clause}|${item.category}|${item.unitOfMeasure}|${item.remark}`;
  }
}
