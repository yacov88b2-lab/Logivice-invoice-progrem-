import * as XLSX from 'xlsx';
import { promises as fs } from 'node:fs';
import type { TemplateStructure, Transaction } from '../types';
import {
  FillResult, getLineItemKey,
  fillWithExcelJS, addRawSheet
} from './_base';

function buildSensosQuantities(rawViewData: Map<string, any[]>): Map<string, number> {
  const result = new Map<string, number>();

  const getView = (name: string): any[] => {
    if (rawViewData.has(name)) return rawViewData.get(name)!;
    for (const [k, v] of rawViewData.entries()) { if (k.trim() === name) return v; }
    return [];
  };

  const findCol = (headers: string[], keywords: string[]): string | undefined =>
    headers.find(h => keywords.some(kw => h.toLowerCase().includes(kw.toLowerCase())));

  const toNumber = (v: any): number => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  // --- Inbound ---
  const inboundData = getView('Inbound');
  if (inboundData.length > 0) {
    const headers           = Object.keys(inboundData[0]);
    const refCol            = findCol(headers, ['Ref (Orders)', 'ref']);
    const distinctCountIdCol = findCol(headers, ['Distinct count of Id (Billable Scan Logs)', 'Distinct count of Id']);
    const distinctRefs      = new Set<string>();
    let boxCount            = 0;
    for (const row of inboundData) {
      if (refCol) distinctRefs.add(String(row[refCol] ?? ''));
      if (distinctCountIdCol) boxCount += parseFloat(String(row[distinctCountIdCol] ?? '0')) || 0;
    }
    result.set('__sensos_inbound_orders', distinctRefs.size);
    result.set('__sensos_inbound_boxes',  boxCount);
    console.log(`[Sensos] Inbound: ${distinctRefs.size} orders, ${boxCount} boxes`);
  }

  // --- Outbound ---
  const outboundData = getView('Outbound');
  if (outboundData.length > 0) {
    const headers            = Object.keys(outboundData[0]);
    const refCol             = findCol(headers, ['Ref (Orders)', 'ref']);
    const distinctCountIdCol = findCol(headers, ['Distinct count of Id (Billable Scan Logs)', 'Distinct count of Id']);
    const domIntCol          = findCol(headers, ["Dom/Int", 'domint', 'domestic']);
    const domRefs = new Set<string>(), intRefs = new Set<string>();
    let outBoxCount = 0;
    for (const row of outboundData) {
      const ref    = refCol    ? String(row[refCol]    ?? '') : '';
      const boxVal = distinctCountIdCol ? (parseFloat(String(row[distinctCountIdCol] ?? '0')) || 0) : 0;
      const domInt = domIntCol ? String(row[domIntCol] ?? '').toLowerCase() : '';
      outBoxCount += boxVal;
      if ((domInt.includes('local') || domInt.includes('dom')) && ref) domRefs.add(ref);
      else if ((domInt.includes("int'l") || domInt.includes('int')) && ref) intRefs.add(ref);
      else if (ref) domRefs.add(ref);
    }
    result.set('__sensos_outbound_dom_orders', domRefs.size);
    result.set('__sensos_outbound_int_orders', intRefs.size);
    result.set('__sensos_outbound_boxes',      outBoxCount);
    console.log(`[Sensos] Outbound: ${domRefs.size} dom, ${intRefs.size} int, ${outBoxCount} boxes`);
  }

  // --- Storage ---
  const storageData = getView('Storage');
  if (storageData.length > 0) {
    let maxPallet = 0, maxShelf = 0;
    for (const row of storageData) {
      const metricName = String(row['Name'] ?? row['Metric'] ?? '').toLowerCase();
      const value      = toNumber(row['Value'] ?? row['value']);
      if (metricName.includes('pallet')) maxPallet = Math.max(maxPallet, value);
      else if (metricName.includes('shelf')) maxShelf = Math.max(maxShelf, value);
    }
    const shelfSqm = maxShelf * 0.5, palletSqm = maxPallet * 1.5, totalSqm = shelfSqm + palletSqm;
    result.set('__sensos_storage_max_pallet', maxPallet);
    result.set('__sensos_storage_max_shelf',  maxShelf);
    result.set('__sensos_storage_total_sqm',  totalSqm);
    console.log(`[Sensos] Storage: maxPallet=${maxPallet}, maxShelf=${maxShelf}, totalSqm=${totalSqm}`);
  }

  // --- Management ---
  const mgmtData = getView('Management') || getView('Managment');
  if (mgmtData.length > 0) {
    let manualOrderCount = 0;
    for (const row of mgmtData) {
      const userName = String(row['Name (Users)'] ?? '').trim();
      if (userName.toLowerCase() === 'lilach almasi') continue;
      const count = toNumber(row['Distinct count of Ref (Orders)'] ?? row['Distinct count of Ref'] ?? 0);
      manualOrderCount += count;
    }
    result.set('__sensos_management_manual_orders', manualOrderCount);
    console.log(`[Sensos] Management: ${manualOrderCount} manual orders (excl. Lilach Almasi)`);
  }

  // --- EXW ---
  const exwData = getView('EXW');
  if (exwData.length > 0) {
    let exwCount = 0;
    for (const row of exwData) {
      const serviceName = String(row['service_name'] ?? '').trim();
      if (serviceName.toLowerCase() === 'all') continue;
      if (serviceName === 'EXW') {
        const count = toNumber(row['Distinct count of Ref (Orders)'] ?? row['Distinct count of Ref'] ?? 1);
        exwCount += count;
      }
    }
    result.set('__sensos_exw_count', exwCount);
    console.log(`[Sensos] EXW: ${exwCount} orders`);
  }

  return result;
}

export async function fillSensos(
  pricelistBuffer: Buffer,
  templateStructure: TemplateStructure,
  quantities: Map<string, number>,
  outputPath: string,
  transactions?: Transaction[],
  rawViewData?: Map<string, any[]>,
  filteredViewData?: Map<string, any[]>
): Promise<FillResult> {
  const filledRows: FillResult['filledRows'] = [];
  const errors: string[] = [];

  // Override quantity map with Sensos-specific calculated values
  const quantityViewData = filteredViewData ?? rawViewData;
  if (quantityViewData) {
    const sensosSummary = buildSensosQuantities(quantityViewData);
    console.log(`[Sensos] Summary:`, Object.fromEntries(sensosSummary));

    for (const sheet of templateStructure.sheets) {
      if (sheet.type !== 'invoice') continue;
      for (const item of sheet.lineItems) {
        const seg    = item.segment.toLowerCase();
        const clause = item.clause.toLowerCase();
        const cat    = item.category.toLowerCase();
        const key    = getLineItemKey(item);

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
        } else if (seg === 'storage' && clause.includes('space') && cat.includes('per area')) {
          const totalSqm    = sensosSummary.get('__sensos_storage_total_sqm') ?? 0;
          const rate        = item.rate ?? 0;
          const perAreaCost = totalSqm * rate;
          const minAreaItem = sheet.lineItems.find(li =>
            li.segment.toLowerCase() === 'storage' &&
            li.clause.toLowerCase().includes('space') &&
            li.category.toLowerCase().includes('minimum'));
          const minAreaRate = minAreaItem?.rate ?? 0;
          quantities.set(key, perAreaCost >= minAreaRate ? totalSqm : 0);
        } else if (seg === 'storage' && clause.includes('space') && cat.includes('minimum')) {
          const totalSqm   = sensosSummary.get('__sensos_storage_total_sqm') ?? 0;
          const minRate    = item.rate ?? 0;
          const perAreaItem = sheet.lineItems.find(li =>
            li.segment.toLowerCase() === 'storage' &&
            li.clause.toLowerCase().includes('space') &&
            li.category.toLowerCase().includes('per area'));
          const perAreaRate = perAreaItem?.rate ?? 0;
          const perAreaCost = totalSqm * perAreaRate;
          quantities.set(key, perAreaCost < minRate ? 1 : 0);
        } else if (seg === 'management' && (clause.includes('manual') || cat.includes('manual'))) {
          quantities.set(key, sensosSummary.get('__sensos_management_manual_orders') ?? 0);
        } else if (seg === 'management' && item.row === 31) {
          quantities.set(key, 1);
        } else if (seg === 'outbound' && clause.includes('vas') && cat.includes('exw')) {
          quantities.set(key, sensosSummary.get('__sensos_exw_count') ?? 0);
        }
      }
    }
  }

  // Step 1: Fill Qty/Total with ExcelJS (preserves styles)
  await fillWithExcelJS(pricelistBuffer, templateStructure, quantities, outputPath, filledRows, errors);

  // Step 2: Add raw Tableau view sheets
  const writtenBuffer = await fs.readFile(outputPath);
  const workbook      = XLSX.read(writtenBuffer, { type: 'buffer', cellStyles: true });

  if (rawViewData) {
    const getView = (name: string) => {
      if (rawViewData.has(name)) return rawViewData.get(name);
      for (const [k, v] of rawViewData.entries()) { if (k.trim() === name) return v; }
      return undefined;
    };
    const inbound    = getView('Inbound');    if (inbound)    addRawSheet(workbook, inbound,    'Inbound');
    const outbound   = getView('Outbound');   if (outbound)   addRawSheet(workbook, outbound,   'Outbound');
    const storage    = getView('Storage');    if (storage)    addRawSheet(workbook, storage,    'Storage');
    const vas        = rawViewData.get('VAS'); if (vas)       addRawSheet(workbook, vas,        'VAS');
    const management = rawViewData.get('Management') || rawViewData.get('Managment');
    if (management) addRawSheet(workbook, management, 'Management');
    const exw = rawViewData.get('EXW');       if (exw)        addRawSheet(workbook, exw,        'EXW');
  }

  XLSX.writeFile(workbook, outputPath, { cellStyles: true });
  return { success: errors.length === 0, filePath: outputPath, filledRows, errors };
}
