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
          // Standard format: has 'segment' column label
          if (rowStr.includes('segment') && rowStr.includes('rate') && rowStr.includes('qty')) {
            detectedHeaderRow = i;
            break;
          }
          // Sensos NL format: header has clause+rate+qty but segment is the value in col 0
          if (rowStr.includes('clause') && rowStr.includes('rate') && rowStr.includes('qty')) {
            detectedHeaderRow = i;
            break;
          }
        }
      }

      if (detectedHeaderRow === -1) continue;
      headerRow = detectedHeaderRow;

      // Reset columns to defaults for each sheet
      columns = {
        segment: 0,
        clause: 1,
        category: 2,
        unitOfMeasure: 3,
        remark: 4,
        rate: 5,
        qty: 6,
        total: 7
      };

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
      let lastSegment = '';
      for (let i = headerRow + 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (!row || row.length === 0) continue;
        
        const segmentRaw = row[columns.segment];
        // Carry forward the last known segment if current row has no segment value
        // but has a clause/rate (data rows that belong to the previous segment block)
        if (segmentRaw) {
          lastSegment = String(segmentRaw);
        }
        const segment = lastSegment;
        if (!segment) continue; // Skip rows before any segment is seen
        // Skip rows that are just segment headers (no clause/rate)
        const hasClause = row[columns.clause] !== undefined && row[columns.clause] !== null && row[columns.clause] !== '';
        const hasRate = row[columns.rate] !== undefined && row[columns.rate] !== null && row[columns.rate] !== '';
        if (!hasClause && !hasRate) continue;

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

    // Month/year pattern (e.g. "March 2026", "April 2026") — Sensos NL main invoice sheet
    const monthPattern = /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}$/i;
    if (monthPattern.test(name.trim())) {
      return 'invoice';
    }
    
    // If it has line items with rates, it's likely an invoice sheet
    if (items.length > 0 && items.some(item => item.rate > 0)) {
      return 'invoice';
    }
    
    return 'other';
  }

  static getLineItemKey(item: LineItem): string {
    return `${item.segment}|${item.clause}|${item.category}|${item.unitOfMeasure}|${item.remark}`;
  }
}
