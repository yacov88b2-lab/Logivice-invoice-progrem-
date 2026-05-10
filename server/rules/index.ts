import type { TemplateStructure, Transaction } from '../types';
import type { FillResult } from './_base';
import { fillAfimilkPreserveTemplate, extractAfimilkStoragePeriod, buildAfimilkStorageEntries } from './afimilk';
import { fillSensos } from './sensos';
import { fillWithExcelJS } from './_base';

function detectCustomer(customerName: string): 'afimilk' | 'sensos' | 'default' {
  const name = String(customerName || '').toLowerCase();
  if (name.includes('afimilk')) return 'afimilk';
  if (name.includes('sensos'))  return 'sensos';
  return 'default';
}

export async function fillInvoice(
  pricelistBuffer: Buffer,
  templateStructure: TemplateStructure,
  quantities: Map<string, number>,
  outputPath: string,
  customerName: string,
  transactions?: Transaction[],
  rawViewData?: Map<string, any[]>,
  filteredViewData?: Map<string, any[]>,
  expectedInboundPeriod?: { mm: string; yyyy: string } | null
): Promise<FillResult> {
  const customer = detectCustomer(customerName);
  console.log(`[Rules] Customer "${customerName}" -> handler: ${customer}`);

  if (customer === 'afimilk') {
    return fillAfimilkPreserveTemplate(
      pricelistBuffer, outputPath, templateStructure, quantities,
      transactions, rawViewData, expectedInboundPeriod
    );
  }

  if (customer === 'sensos') {
    return fillSensos(
      pricelistBuffer, templateStructure, quantities, outputPath,
      transactions, rawViewData, filteredViewData
    );
  }

  // Default: standard template fill (no custom rules needed)
  const filledRows: FillResult['filledRows'] = [];
  const errors: string[] = [];

  await fillWithExcelJS(pricelistBuffer, templateStructure, quantities, outputPath, filledRows, errors, rawViewData, transactions);

  return { success: errors.length === 0, filePath: outputPath, filledRows, errors };
}

export { extractAfimilkStoragePeriod, buildAfimilkStorageEntries };
export type { FillResult };
