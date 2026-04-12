import * as XLSX from 'xlsx';
import type { Transaction } from '../types';

/**
 * Extracts transaction data from uploaded Excel files
 * Specifically handles the Analyze sheet structure from billing workbooks
 */
export class ExcelDataExtractor {
  /**
   * Extract transactions from the Analyze sheet
   * This sheet typically contains order data with columns:
   * - Type (inbound/outbound)
   * - Order Reference
   * - Order count
   * - QTY
   */
  static extractFromAnalyzeSheet(buffer: Buffer): Transaction[] {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    
    // Look for Analyze sheet
    const analyzeSheetName = workbook.SheetNames.find(name => 
      name.toLowerCase().includes('analyze') || 
      name.toLowerCase().includes('analysis') ||
      name.toLowerCase().includes('data')
    );
    
    if (!analyzeSheetName) {
      console.log('No Analyze sheet found, trying Management sheet');
      // Try Management sheet as fallback
      const mgmtSheetName = workbook.SheetNames.find(name =>
        name.toLowerCase().includes('manag') ||
        name.toLowerCase().includes('mgmt')
      );
      if (mgmtSheetName) {
        return this.extractFromManagementSheet(workbook, mgmtSheetName);
      }
      return [];
    }

    const worksheet = workbook.Sheets[analyzeSheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

    const transactions: Transaction[] = [];
    let currentType = '';
    
    // Find the header row (contains 'Type', 'Ref', 'Order count', 'QTY')
    let headerRow = -1;
    for (let i = 0; i < Math.min(jsonData.length, 10); i++) {
      const row = jsonData[i];
      if (row && row.length > 0) {
        const rowStr = row.join(' ').toLowerCase();
        if (rowStr.includes('type') && (rowStr.includes('qty') || rowStr.includes('order count'))) {
          headerRow = i;
          break;
        }
      }
    }

    if (headerRow === -1) {
      console.log('Could not find header row in Analyze sheet');
      return [];
    }

    // Map column positions
    const headerRowData = jsonData[headerRow];
    const colMap: Record<string, number> = {};
    headerRowData.forEach((cell: any, index: number) => {
      const cellStr = String(cell).toLowerCase();
      if (cellStr.includes('type')) colMap['type'] = index;
      if (cellStr.includes('ref') || cellStr.includes('order')) colMap['ref'] = index;
      if (cellStr.includes('order count')) colMap['orderCount'] = index;
      if (cellStr.includes('qty') || cellStr.includes('quantity')) colMap['qty'] = index;
    });

    // Default column positions if not found in header
    const typeCol = colMap['type'] ?? 5;      // Column F
    const refCol = colMap['ref'] ?? 6;        // Column G
    const orderCountCol = colMap['orderCount'] ?? 7; // Column H
    const qtyCol = colMap['qty'] ?? 8;        // Column I

    // Process data rows
    for (let i = headerRow + 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      if (!row || row.length === 0) continue;

      const type = row[typeCol];
      const ref = row[refCol];
      const qty = row[qtyCol];

      // Update current type if specified
      if (type && typeof type === 'string' && (type.toLowerCase().includes('inbound') || type.toLowerCase().includes('outbound'))) {
        currentType = type.toLowerCase().includes('inbound') ? 'Inbound' : 'Outbound';
      }

      // Skip rows without reference or quantity
      if (!ref || !qty) continue;
      if (typeof qty !== 'number' && isNaN(parseFloat(qty))) continue;

      // Skip total/summary rows
      if (String(ref).toLowerCase().includes('total')) continue;

      transactions.push({
        id: `TXN-${i}`,
        date: new Date().toISOString().split('T')[0],
        orderNumber: String(ref),
        customer: 'Unknown',  // Will be filled from pricelist
        warehouse: 'Unknown', // Will be filled from pricelist
        segment: currentType || 'Outbound',
        movementType: 'Per order',
        category: currentType === 'Inbound' ? 'General' : 'Domestic',
        unitOfMeasure: 'order',
        description: '',
        quantity: typeof qty === 'number' ? qty : parseFloat(qty)
      });
    }

    console.log(`Extracted ${transactions.length} transactions from Analyze sheet`);
    
    // Also extract Storage data from Storge sheet
    const storageTransactions = this.extractFromStorageSheet(workbook);
    if (storageTransactions.length > 0) {
      console.log(`Extracted ${storageTransactions.length} transactions from Storge sheet`);
      transactions.push(...storageTransactions);
    }
    
    return transactions;
  }

  /**
   * Extract Storage data from Storge/Storage sheet
   */
  private static extractFromStorageSheet(workbook: XLSX.WorkBook): Transaction[] {
    // Look for Storage/Storge sheet (common misspelling)
    const storageSheetName = workbook.SheetNames.find(name => 
      name.toLowerCase().includes('storage') || 
      name.toLowerCase().includes('storge')
    );
    
    if (!storageSheetName) {
      console.log('No Storage/Storge sheet found');
      return [];
    }

    const worksheet = workbook.Sheets[storageSheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

    const transactions: Transaction[] = [];
    
    // Find the header row
    let headerRow = -1;
    for (let i = 0; i < Math.min(jsonData.length, 5); i++) {
      const row = jsonData[i];
      if (row && row.length > 0) {
        const rowStr = row.join(' ').toLowerCase();
        if (rowStr.includes('warehouse') || rowStr.includes('locations') || rowStr.includes('pallet')) {
          headerRow = i;
          break;
        }
      }
    }

    if (headerRow === -1) {
      console.log('Could not find header row in Storage sheet');
      return [];
    }

    // Map column positions from header
    const headerRowData = jsonData[headerRow];
    const colMap: Record<string, number> = {};
    headerRowData.forEach((cell: any, index: number) => {
      const cellStr = String(cell).toLowerCase();
      if (cellStr.includes('pallet')) colMap['pallet'] = index;
      if (cellStr.includes('shelf')) colMap['shelf'] = index;
      if (cellStr.includes('warehouse')) colMap['warehouse'] = index;
    });

    // Calculate storage metrics from the data
    let maxPallets = 0;
    let maxShelves = 0;
    let warehouse = 'HKG';
    
    for (let i = headerRow + 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      if (!row || row.length === 0) continue;
      
      const palletCol = colMap['pallet'] ?? 2;  // Column C
      const shelfCol = colMap['shelf'] ?? 3;    // Column D
      
      const pallets = row[palletCol];
      const shelves = row[shelfCol];
      
      if (typeof pallets === 'number' && pallets > maxPallets) {
        maxPallets = pallets;
      }
      if (typeof shelves === 'number' && shelves > maxShelves) {
        maxShelves = shelves;
      }
      
      // Get warehouse from first row
      if (i === headerRow + 1 && row[0]) {
        warehouse = String(row[0]);
      }
    }

    // STORAGE BILLING RULE: Bill the MAX of (per_area_cost, minimum_cost)
    // This means we only create ONE transaction for whichever is higher
    
    // Constants (typically from pricelist, using defaults here)
    const PER_AREA_RATE = 42.5;  // per sqm per month
    const MINIMUM_AREA_CHARGE = 425;  // minimum monthly charge
    const PALLET_TO_SQM = 1.5;  // sqm per pallet
    const MINIMUM_PALLETS = 10;  // minimum pallet locations
    
    // Calculate actual usage
    const actualSqm = maxPallets * PALLET_TO_SQM;
    const perAreaCost = actualSqm * PER_AREA_RATE;
    
    // Calculate if minimum applies
    // Minimum is 10 pallet locations, each at 1.5 sqm = 15 sqm minimum
    // At 42.5/sqm = 637.5 minimum, or flat 425 as specified
    const minimumCost = MINIMUM_AREA_CHARGE;
    
    console.log(`Storage calculation: ${maxPallets} pallets × ${PALLET_TO_SQM} sqm/pallet = ${actualSqm} sqm`);
    console.log(`Per area cost: ${actualSqm} sqm × $${PER_AREA_RATE} = $${perAreaCost}`);
    console.log(`Minimum cost: $${minimumCost}`);
    
    // Apply the rule: bill MAX of (per_area, minimum)
    if (perAreaCost >= minimumCost) {
      // Bill per area (actual usage is higher than minimum)
      console.log(`Billing per area: $${perAreaCost} > $${minimumCost} (minimum)`);
      transactions.push({
        id: 'STORAGE-PER-AREA',
        date: new Date().toISOString().split('T')[0],
        orderNumber: 'STORAGE-MONTHLY',
        customer: 'Unknown',
        warehouse: warehouse,
        segment: 'Storage',
        movementType: 'Space',
        category: 'per area',
        unitOfMeasure: 'sqm per month',
        description: 'Per SqM Per Month',
        quantity: actualSqm  // Bill actual sqm used
      });
    } else {
      // Bill minimum (minimum is higher than actual usage)
      console.log(`Billing minimum: $${minimumCost} > $${perAreaCost} (per area)`);
      transactions.push({
        id: 'STORAGE-MINIMUM',
        date: new Date().toISOString().split('T')[0],
        orderNumber: 'STORAGE-MONTHLY',
        customer: 'Unknown',
        warehouse: warehouse,
        segment: 'Storage',
        movementType: 'Space',
        category: 'Minimum Area',
        unitOfMeasure: 'month',
        description: 'Minimum area charge 10 Pallet Location or equivalent in space',
        quantity: 1  // Fixed monthly charge unit
      });
    }

    console.log(`Storage billing: ${transactions.length} transaction(s) created`);
    return transactions;
  }

  /**
   * Extract from Management sheet as fallback
   */
  private static extractFromManagementSheet(workbook: XLSX.WorkBook, sheetName: string): Transaction[] {
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

    const transactions: Transaction[] = [];

    // Find header row
    let headerRow = -1;
    for (let i = 0; i < Math.min(jsonData.length, 5); i++) {
      const row = jsonData[i];
      if (row && row.length > 0) {
        const rowStr = row.join(' ').toLowerCase();
        if (rowStr.includes('ref') || rowStr.includes('qty')) {
          headerRow = i;
          break;
        }
      }
    }

    if (headerRow === -1) return [];

    // Process data rows
    for (let i = headerRow + 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      if (!row || row.length < 3) continue;

      const ref = row[5]; // Column F - Ref (Orders)
      const qty = row[6]; // Column G - qty

      if (!ref || !qty) continue;

      transactions.push({
        id: `TXN-${i}`,
        date: new Date().toISOString().split('T')[0],
        orderNumber: String(ref),
        customer: 'Unknown',
        warehouse: 'Unknown',
        segment: 'Outbound',
        movementType: 'Per order',
        category: 'Domestic',
        unitOfMeasure: 'order',
        description: '',
        quantity: typeof qty === 'number' ? qty : parseFloat(qty)
      });
    }

    return transactions;
  }

  /**
   * Get all sheet names in the workbook
   */
  static getSheetNames(buffer: Buffer): string[] {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    return workbook.SheetNames;
  }
}
